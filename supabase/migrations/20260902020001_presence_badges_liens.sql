-- Presence reelle, badges, comptes lies et signalements.
--
-- Quatre sujets dans une seule migration, ce qui demande une justification.
-- Ils partagent tous la meme table — `profiles` — et le meme moment
-- d'application : une maintenance. Les separer obligerait a quatre passages
-- successifs sur une base ou personne ne peut entrer entre-temps, sans qu'aucun
-- des quatre ne soit utile seul.

-- ===========================================================================
-- 1. La presence, mesuree plutot que declaree
-- ===========================================================================
--
-- `profiles.status` est pose a « en ligne » a la connexion et remis a « hors
-- ligne » a la fermeture, par une requete envoyee pendant que la page
-- disparait. Cela marche quand on ferme proprement — et seulement dans ce cas.
--
-- Une machine mise en veille, un processus tue, une coupure de reseau, un
-- plantage : la requete d'adieu ne part jamais, et le compte reste « en ligne »
-- indefiniment. C'est le defaut rapporte, et il ne se corrige pas en soignant
-- l'adieu, car il n'y a pas d'adieu a soigner dans ces cas-la.
--
-- On mesure donc au lieu de declarer. L'application dit « je suis la » a
-- intervalle regulier ; qui cesse de le dire cesse d'etre en ligne, sans que
-- personne ait a l'annoncer. Un signal qui doit etre renouvele ne peut pas
-- rester vrai par accident.

alter table public.profiles
  add column if not exists derniere_presence timestamptz;

-- Les listes d'amis et de membres trient par presence : sans index, chaque
-- ouverture parcourt la table entiere.
create index if not exists profiles_derniere_presence_idx
  on public.profiles (derniere_presence desc nulls last);

-- Ce qui existe deja part avec une presence ancienne plutot que nulle : sans
-- cela, tout le monde apparaitrait « jamais vu » a la premiere ouverture, y
-- compris ceux qui sont connectes a l'instant meme.
update public.profiles
   set derniere_presence = now() - interval '1 day'
 where derniere_presence is null;

/*
 * Le battement.
 *
 * Volontairement minuscule : c'est l'ecriture la plus frequente de toute
 * l'application — une par minute et par personne connectee — et tout ce qu'on
 * y ajouterait serait paye a ce rythme.
 *
 * Il met aussi `status` a jour quand on le lui donne, ce qui evite une seconde
 * requete au changement d'etat.
 */
create or replace function public.battement(nouvel_etat text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set derniere_presence = now(),
         status = coalesce(
           nullif(nouvel_etat, ''),
           status
         )
   where id = (select auth.uid());
$$;

grant execute on function public.battement(text) to authenticated;

-- ===========================================================================
-- 2. Les badges
-- ===========================================================================
--
-- Un catalogue et des attributions, plutot qu'une colonne de texte sur le
-- profil. La difference se voit le jour ou l'on veut savoir combien de gens ont
-- un badge, ou retirer celui qui a ete donne par erreur.
--
-- La rarete est le sujet, pas la decoration. Un badge que tout le monde obtient
-- ne dit rien ; ce qui fait sa valeur, c'est de ne plus pouvoir l'obtenir. D'ou
-- `limite` : passe ce nombre d'attributions, le badge se ferme et personne ne
-- l'aura plus jamais.

create table if not exists public.badges (
  -- Une cle lisible plutot qu'un identifiant tire au hasard : elle apparait
  -- dans le code qui les attribue, et « premiers-cent » s'y relit mieux qu'un
  -- UUID.
  cle         text primary key check (cle ~ '^[a-z0-9-]{3,40}$'),

  nom         text not null check (char_length(trim(nom)) between 2 and 40),

  -- Courte par construction : elle est lue dans une bulle au survol, pas dans
  -- une page.
  description text not null check (char_length(trim(description)) between 8 and 200),

  -- Le rangement de la liste. Libre serait ingerable ; ces cinq familles
  -- couvrent ce qu'on sait attribuer aujourd'hui.
  famille     text not null default 'succes'
    check (famille in ('soutien', 'anciennete', 'succes', 'equipe', 'evenement')),

  -- La teinte de la pastille, en hexadecimal. Le style viendra plus tard :
  -- pour l'instant on ne pose que la couleur, qui suffit a distinguer les
  -- familles d'un coup d'oeil.
  teinte      text not null default '#8b93a7'
    check (teinte ~ '^#[0-9a-fA-F]{6}$'),

  -- Nombre maximal d'attributions, ou `null` pour illimite. C'est ce qui rend
  -- un badge definitivement inaccessible une fois la course terminee.
  limite      integer check (limite is null or limite > 0),

  -- L'ordre d'affichage. Les plus rares en tete.
  rang        integer not null default 100,

  cree_le     timestamptz not null default now()
);

create table if not exists public.profil_badges (
  profil_id  uuid not null references public.profiles (id) on delete cascade,
  badge_cle  text not null references public.badges (cle) on delete cascade,

  -- Le rang d'obtention : « 7e a rejoindre » vaut plus que « fait partie des
  -- cent premiers », et l'information est perdue si on ne la garde pas au
  -- moment ou on l'attribue.
  position   integer,

  obtenu_le  timestamptz not null default now(),

  primary key (profil_id, badge_cle)
);

create index if not exists profil_badges_profil_idx on public.profil_badges (profil_id);

alter table public.badges enable row level security;
alter table public.profil_badges enable row level security;

-- Le catalogue est public : un badge qu'on ne peut pas voir avant de l'obtenir
-- n'incite a rien, et c'est bien d'une course qu'il s'agit.
drop policy if exists badges_lecture on public.badges;
create policy badges_lecture on public.badges for select to authenticated using (true);

-- Les attributions aussi : elles s'affichent sur les profils.
drop policy if exists profil_badges_lecture on public.profil_badges;
create policy profil_badges_lecture on public.profil_badges for select to authenticated using (true);

/*
 * Attribue un badge, si la course n'est pas close.
 *
 * Tout est fait ici, en une seule instruction, et c'est necessaire : deux
 * personnes qui arrivent en meme temps sur la centieme place liraient toutes
 * deux « quatre-vingt-dix-neuf attribues » avant que l'une des deux n'ecrive.
 * Le compte et l'insertion doivent donc etre indissociables.
 */
create or replace function public.attribuer_badge(cle_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
  plafond integer;
  deja integer;
begin
  if moi is null then
    return false;
  end if;

  select limite into plafond from public.badges where cle = cle_badge;
  if not found then
    return false;
  end if;

  -- Le verrou porte sur la cle du badge : deux candidats a la meme place
  -- attendent l'un apres l'autre, deux candidats a des badges differents ne
  -- s'attendent pas.
  perform pg_advisory_xact_lock(hashtext(cle_badge));

  select count(*) into deja from public.profil_badges where badge_cle = cle_badge;

  if plafond is not null and deja >= plafond then
    return false;
  end if;

  insert into public.profil_badges (profil_id, badge_cle, position)
  values (moi, cle_badge, deja + 1)
  on conflict do nothing;

  return found;
end;
$$;

grant execute on function public.attribuer_badge(text) to authenticated;

-- Le catalogue de depart. `on conflict do nothing` : la migration doit pouvoir
-- etre rejouee sans ecraser une description qu'on aurait reecrite depuis.
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('pionnier',        'Pionnier',        'Parmi les cent premiers comptes ouverts sur Echow. Cette course est terminee des que le centieme est arrive.', 'soutien',    '#f0b232', 100,  1),
  ('premiere-heure',  'Premiere heure',  'Present le jour de l''ouverture. Ne pourra plus jamais etre obtenu.',                                          'soutien',    '#eb459e', null, 2),
  ('equipe',          'Equipe',          'Membre de l''equipe qui construit Echow.',                                                                     'equipe',     '#5865f2', null, 3),
  ('fondateur',       'Fondateur',       'A cree un espace qui compte au moins dix membres.',                                                            'succes',     '#3ba55d', null, 10),
  ('bavard',          'Bavard',          'A ecrit mille messages.',                                                                                      'succes',     '#00a8fc', null, 20),
  ('veilleur',        'Veilleur',        'A passe dix heures en salon vocal.',                                                                           'succes',     '#9b59b6', null, 21),
  ('rapporteur',      'Rapporteur',      'A signale un defaut qui a ete corrige.',                                                                       'succes',     '#e67e22', null, 22),
  ('fidele',          'Fidele',          'Compte ouvert depuis plus d''un an.',                                                                          'anciennete', '#95a5a6', null, 30)
on conflict (cle) do nothing;

-- ===========================================================================
-- 3. Les comptes lies
-- ===========================================================================
--
-- Ce que quelqu'un ecoute, ce qu'il diffuse, ou le retrouver ailleurs. Chacun
-- decide service par service si cela parait sur son profil : lier un compte et
-- l'afficher sont deux gestes differents, et les confondre reviendrait a
-- publier ce qu'on voulait seulement connecter.

create table if not exists public.comptes_lies (
  profil_id   uuid not null references public.profiles (id) on delete cascade,

  service     text not null
    check (service in ('spotify', 'twitch', 'youtube', 'roblox', 'steam', 'github')),

  -- L'identifiant chez le service, et le nom qu'on y porte. Le second sert a
  -- l'affichage, le premier au lien.
  identifiant text not null check (char_length(identifiant) between 1 and 120),
  nom_affiche text not null check (char_length(nom_affiche) between 1 and 120),

  -- Afficher sur le profil, ou non. Lier sans montrer est un cas legitime :
  -- on peut vouloir la synchronisation sans la vitrine.
  visible     boolean not null default true,

  lie_le      timestamptz not null default now(),

  primary key (profil_id, service)
);

alter table public.comptes_lies enable row level security;

-- On lit ce qui est affiche, et tout ce qui est a soi. La distinction est le
-- coeur de la table : sans elle, `visible` ne voudrait rien dire.
drop policy if exists comptes_lies_lecture on public.comptes_lies;
create policy comptes_lies_lecture on public.comptes_lies for select to authenticated
  using (visible or profil_id = (select auth.uid()));

drop policy if exists comptes_lies_ecriture on public.comptes_lies;
create policy comptes_lies_ecriture on public.comptes_lies for all to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

-- L'activite du moment : ce qu'on ecoute, ce qu'on diffuse.
--
-- Separee des comptes lies parce qu'elle a une duree de vie de quelques
-- minutes, la ou un compte lie dure des annees. Les melanger obligerait a
-- reecrire une ligne durable a chaque changement de morceau.
create table if not exists public.activites (
  profil_id  uuid primary key references public.profiles (id) on delete cascade,

  genre      text not null check (genre in ('ecoute', 'direct', 'jeu')),
  service    text not null,

  titre      text not null check (char_length(titre) between 1 and 200),
  detail     text check (detail is null or char_length(detail) <= 200),
  image_url  text check (image_url is null or char_length(image_url) <= 500),
  lien_url   text check (lien_url is null or char_length(lien_url) <= 500),

  -- Pour la barre de progression d'un morceau. Nuls pour un direct.
  debut_le   timestamptz,
  duree_ms   integer check (duree_ms is null or duree_ms > 0),

  vu_le      timestamptz not null default now()
);

alter table public.activites enable row level security;

drop policy if exists activites_lecture on public.activites;
create policy activites_lecture on public.activites for select to authenticated using (true);

drop policy if exists activites_ecriture on public.activites;
create policy activites_ecriture on public.activites for all to authenticated
  using (profil_id = (select auth.uid()))
  with check (profil_id = (select auth.uid()));

-- ===========================================================================
-- 4. Les signalements
-- ===========================================================================
--
-- Le bouton existait et n'ecrivait nulle part : signaler ne faisait donc rien,
-- silencieusement, ce qui est pire que de ne pas proposer le bouton — on croit
-- avoir prevenu quelqu'un.

create table if not exists public.signalements (
  id           uuid primary key default gen_random_uuid(),

  auteur_id    uuid not null references public.profiles (id) on delete cascade,

  -- Ce qui est signale. Un seul des trois est renseigne, et l'on garde le
  -- texte du message a part : il peut etre efface entre le signalement et sa
  -- lecture, et c'est justement dans ce cas qu'on en a le plus besoin.
  cible_type   text not null check (cible_type in ('message', 'profil', 'espace')),
  cible_id     uuid not null,
  espace_id    uuid references public.spaces (id) on delete set null,
  extrait      text check (extrait is null or char_length(extrait) <= 2000),

  motif        text not null
    check (motif in ('harcelement', 'contenu-choquant', 'pourriel', 'usurpation', 'menace', 'autre')),

  detail       text check (detail is null or char_length(detail) <= 2000),

  etat         text not null default 'ouvert'
    check (etat in ('ouvert', 'en-cours', 'traite', 'rejete')),

  traite_par   uuid references public.profiles (id) on delete set null,
  traite_le    timestamptz,
  note_equipe  text check (note_equipe is null or char_length(note_equipe) <= 2000),

  cree_le      timestamptz not null default now()
);

create index if not exists signalements_etat_idx on public.signalements (etat, cree_le desc);
create index if not exists signalements_cible_idx on public.signalements (cible_type, cible_id);

alter table public.signalements enable row level security;

/*
 * On ecrit le sien, on relit le sien, et rien d'autre.
 *
 * Aucune politique de lecture elargie, pour la meme raison que le support : un
 * signalement contient ce qu'on n'ecrirait pas en public, et il nomme
 * quelqu'un. La console de l'equipe passe par la cle de service, qui contourne
 * RLS — c'est assume, et c'est pourquoi cette cle ne quitte pas leur machine.
 */
drop policy if exists signalements_ecriture on public.signalements;
create policy signalements_ecriture on public.signalements for insert to authenticated
  with check (auteur_id = (select auth.uid()));

drop policy if exists signalements_lecture on public.signalements;
create policy signalements_lecture on public.signalements for select to authenticated
  using (auteur_id = (select auth.uid()));

-- Un meme signalement, envoye trois fois de suite par impatience, ne vaut pas
-- trois signalements. La contrainte porte sur l'heure : signaler la meme chose
-- le lendemain reste possible, et c'est alors une information.
create unique index if not exists signalements_sans_doublon
  on public.signalements (auteur_id, cible_type, cible_id, date_trunc('hour', cree_le));

-- ===========================================================================
-- 5. Signaler un message envoye en prive
-- ===========================================================================
--
-- `message_reports.space_id` etait `not null`, et la fonction qui y insere le
-- deduit du salon : une conversation privee n'appartient a aucun espace, donc
-- la colonne valait `null`, donc l'insertion echouait. Signaler un message
-- privé rendait une erreur de contrainte, presentee comme un refus.
--
-- C'est le cas ou signaler compte le plus. Un message deplace dans un salon
-- public est vu par tout le monde et se moderera de lui-meme ; un message
-- envoye en prive n'est vu que de celui qui le recoit, et lui retirer le seul
-- recours dont il dispose est le pire endroit ou placer ce defaut.
--
-- La colonne devient donc facultative. Un signalement sans espace ne releve
-- d'aucune moderation locale — il n'y a pas de proprietaire a prevenir — et
-- part a l'equipe, qui lit par la cle de service.

alter table public.message_reports
  alter column space_id drop not null;

/*
 * Chacun relit les siens, y compris ceux qui n'ont pas d'espace.
 *
 * Sans cette politique, un signalement prive serait ecrit puis invisible a
 * celui qui l'a envoye : il ne saurait meme pas s'il est parti.
 */
drop policy if exists message_reports_les_miens on public.message_reports;
create policy message_reports_les_miens on public.message_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- ===========================================================================
-- 6. Le compteur d'usage de l'assistant
-- ===========================================================================
--
-- Chaque appel a Gemini est facture. Sans compteur, un compte seul peut vider
-- le budget — volontairement, ou par une boucle mal ecrite qui repose la meme
-- question mille fois.
--
-- Le compte est tenu ici et non dans la fonction : une fonction de bord n'a pas
-- de memoire d'un appel a l'autre, elle peut s'executer sur une machine
-- differente a chaque fois. Compter en memoire reviendrait a ne pas compter.
--
-- Une ligne par personne et par jour. La remise a zero est implicite : demain
-- est une autre ligne, et il n'y a donc aucune tache d'entretien a oublier.

create table if not exists public.ia_usage (
  profil_id uuid not null references public.profiles (id) on delete cascade,
  jour      date not null default current_date,

  appels    integer not null default 0,
  -- Les jetons servent au suivi du cout, pas a la limite : c'est le nombre
  -- d'appels qui est plafonne, parce qu'il se comprend sans calcul.
  jetons    bigint  not null default 0,

  primary key (profil_id, jour)
);

alter table public.ia_usage enable row level security;

-- Chacun voit sa propre consommation, et rien d'autre. Savoir combien de
-- questions les autres posent ne regarde personne.
drop policy if exists ia_usage_les_miens on public.ia_usage;
create policy ia_usage_les_miens on public.ia_usage for select to authenticated
  using (profil_id = (select auth.uid()));

/*
 * Incremente le compteur du jour.
 *
 * `on conflict` plutot qu'un « lire puis ecrire » : deux questions posees en
 * meme temps liraient toutes deux la meme valeur, et l'une des deux ne serait
 * jamais comptee. Ici la base additionne, et deux appels simultanes font deux.
 */
create or replace function public.ia_compter(p_jetons bigint default 0)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ia_usage (profil_id, jour, appels, jetons)
  values ((select auth.uid()), current_date, 1, greatest(p_jetons, 0))
  on conflict (profil_id, jour) do update
    set appels = public.ia_usage.appels + 1,
        jetons = public.ia_usage.jetons + greatest(p_jetons, 0);
$$;

grant execute on function public.ia_compter(bigint) to authenticated;

/*
 * Le total du jour, tous comptes confondus.
 *
 * La limite par personne protege contre un compte qui s'emballe ; elle ne
 * protege pas contre trente comptes qui se servent normalement le meme jour, ni
 * contre des comptes crees pour l'occasion. Le palier gratuit de Gemini est
 * commun a tous : il faut donc un compteur commun.
 *
 * `security definer` parce que la politique de lecture ne montre a chacun que
 * sa propre ligne — c'est voulu, savoir combien les autres consomment ne
 * regarde personne — et que ce total-la doit pourtant etre lisible.
 */
create or replace function public.ia_total_du_jour()
returns bigint
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(sum(appels), 0)::bigint
    from public.ia_usage
   where jour = current_date;
$$;

grant execute on function public.ia_total_du_jour() to authenticated;
