-- Demandes de support, et l'echange qui suit.
--
-- Pourquoi ce n'est pas une conversation privee de plus
-- -----------------------------------------------------
-- On pourrait dire « ecrivez a l'equipe » et ouvrir un salon prive. Mais une
-- demande d'aide n'est pas une discussion : elle a un sujet, un etat, et elle
-- se termine. Rangee parmi les conversations, elle se perd entre deux fils, et
-- personne ne sait plus laquelle attend encore une reponse.
--
-- Pourquoi la lecture est strictement privee
-- -------------------------------------------
-- C'est la difference essentielle avec `suggestions`, ou tout le monde lit
-- tout. Une demande de support contient ce qu'on n'ecrirait pas en public : un
-- compte pirate, un signalement, une adresse, parfois le detail d'un incident
-- qu'on prefere ne pas etaler. La regle est donc l'inverse : chacun ne voit que
-- ses propres demandes, et personne d'autre — pas meme les proprietaires
-- d'espaces, qui n'ont ici aucun statut particulier.
--
-- Le tableau de bord de l'equipe ne passe pas par ces politiques : il se
-- connecte avec la cle de service, qui contourne RLS par construction. C'est
-- assume, et c'est pour cela que cette cle ne quitte jamais la machine de
-- l'equipe. Aucune politique n'accorde donc de lecture elargie a qui que ce
-- soit : ajouter un role « support » cote base reviendrait a laisser une porte
-- que personne ne surveille.

create table if not exists public.demandes_support (
  id          uuid primary key default gen_random_uuid(),
  auteur_id   uuid not null references public.profiles (id) on delete cascade,

  -- Assez pour reconnaitre sa demande dans une liste, trop peu pour y ecrire
  -- le probleme entier : c'est le role du message.
  sujet       text not null check (char_length(trim(sujet)) between 4 and 120),

  -- Le tri de l'equipe. Une valeur libre finirait en trente orthographes du
  -- meme mot, et le filtre du tableau de bord ne servirait plus a rien.
  categorie   text not null default 'autre'
    check (categorie in ('compte', 'technique', 'moderation', 'facturation', 'autre')),

  message     text not null check (char_length(trim(message)) between 20 and 4000),

  -- `ouverte` a l'arrivee, `en-cours` quand l'equipe s'en saisit, `resolue`
  -- quand c'est fini. Trois etats et pas davantage : au-dela, on passe plus de
  -- temps a classer qu'a repondre.
  statut      text not null default 'ouverte'
    check (statut in ('ouverte', 'en-cours', 'resolue')),

  created_at  timestamptz not null default now(),

  -- Distincte de `created_at` : c'est elle qui dit depuis quand une demande
  -- attend. Une demande ouverte il y a trois semaines mais repondue hier n'est
  -- pas en retard, et un tri sur la seule date de creation le laisserait croire.
  updated_at  timestamptz not null default now()
);

comment on table public.demandes_support is
  'Demandes d''aide. Lecture strictement limitee a leur auteur : elles contiennent ce qu''on n''ecrirait pas en public.';

-- Les deux acces reels : « mes demandes, les plus recentes d'abord » cote
-- application, et « tout ce qui bouge » cote tableau de bord.
create index if not exists demandes_support_auteur_idx
  on public.demandes_support (auteur_id, updated_at desc);

create index if not exists demandes_support_recentes_idx
  on public.demandes_support (updated_at desc);

-- Le filtre par statut du tableau de bord, et le compteur des demandes
-- ouvertes qui reste affiche en permanence.
create index if not exists demandes_support_statut_idx
  on public.demandes_support (statut, updated_at desc);

create table if not exists public.reponses_support (
  id          uuid primary key default gen_random_uuid(),
  demande_id  uuid not null references public.demandes_support (id) on delete cascade,

  -- Nul pour une reponse de l'equipe : celle-ci arrive par la cle de service,
  -- sans session, donc sans profil a designer. `on delete set null` garde
  -- l'echange lisible quand un compte disparait — la reponse reste, son auteur
  -- s'efface.
  auteur_id   uuid references public.profiles (id) on delete set null,

  -- Qui parle, dit explicitement plutot que deduit de `auteur_id is null`.
  -- La deduction tomberait juste aujourd'hui et faux le jour ou un compte
  -- supprime laisse ses messages derriere lui.
  de_l_equipe boolean not null default false,

  message     text not null check (char_length(trim(message)) between 1 and 4000),
  created_at  timestamptz not null default now()
);

comment on table public.reponses_support is
  'Echange attache a une demande. Visible du seul auteur de la demande, et de l''equipe via la cle de service.';

create index if not exists reponses_support_demande_idx
  on public.reponses_support (demande_id, created_at);

-- ---------------------------------------------------------------------------
-- Qui peut faire quoi
-- ---------------------------------------------------------------------------

alter table public.demandes_support enable row level security;
alter table public.reponses_support enable row level security;

-- Chacun ne voit que les siennes. C'est toute la regle, et il n'y a pas de
-- seconde politique de lecture : chaque exception ajoutee ici serait un moyen
-- de plus de lire les demandes des autres.
drop policy if exists demandes_support_select on public.demandes_support;
create policy demandes_support_select on public.demandes_support
  for select to authenticated
  using (auteur_id = (select auth.uid()));

-- On ne depose que pour soi. `auteur_id` est verifie ici plutot que laisse au
-- client : sans cela, on pourrait deposer une demande au nom d'autrui — et
-- surtout la relire ensuite, puisque la lecture suit ce meme champ.
--
-- Le statut de depart est impose : une demande qui arriverait deja marquee
-- `resolue` ne serait jamais vue par personne.
drop policy if exists demandes_support_insert on public.demandes_support;
create policy demandes_support_insert on public.demandes_support
  for insert to authenticated
  with check (
    auteur_id = (select auth.uid())
    and statut = 'ouverte'
  );

-- Pas de politique `update` ni `delete` pour les comptes ordinaires.
--
-- Volontaire. Un `update` libre laisserait reecrire le message apres coup, ou
-- rouvrir indefiniment une demande close ; un `delete` effacerait aussi la
-- moitie de l'echange ecrite par l'equipe. Le seul changement legitime cote
-- utilisateur — declarer que l'on n'a plus besoin d'aide — passe par la
-- fonction `resoudre_ma_demande` plus bas, qui ne touche que le statut.

-- Les reponses suivent leur demande : si l'on peut lire l'une, on lit l'autre.
drop policy if exists reponses_support_select on public.reponses_support;
create policy reponses_support_select on public.reponses_support
  for select to authenticated
  using (
    exists (
      select 1
        from public.demandes_support d
       where d.id = reponses_support.demande_id
         and d.auteur_id = (select auth.uid())
    )
  );

-- Repondre chez soi, en son nom, et jamais au nom de l'equipe : sans le
-- troisieme test, n'importe qui pourrait fabriquer une reponse officielle dans
-- sa propre demande — et la capture d'ecran qui en resulterait ressemblerait
-- trait pour trait a une reponse du support.
drop policy if exists reponses_support_insert on public.reponses_support;
create policy reponses_support_insert on public.reponses_support
  for insert to authenticated
  with check (
    auteur_id = (select auth.uid())
    and de_l_equipe = false
    and exists (
      select 1
        from public.demandes_support d
       where d.id = reponses_support.demande_id
         and d.auteur_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- La date de derniere activite se pose toute seule
-- ---------------------------------------------------------------------------
--
-- Laisser le client ecrire `updated_at` reviendrait a lui demander l'heure : la
-- valeur vaudrait ce que vaut sa montre, et une demande pourrait remonter en
-- tete de la file de l'equipe en se declarant plus recente qu'elle n'est.

create or replace function public.support_touche_demande()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.demandes_support
     set updated_at = new.created_at
   where id = new.demande_id;
  return new;
end;
$$;

drop trigger if exists reponses_support_touche on public.reponses_support;
create trigger reponses_support_touche
  after insert on public.reponses_support
  for each row execute function public.support_touche_demande();

create or replace function public.support_horodate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists demandes_support_horodate on public.demandes_support;
create trigger demandes_support_horodate
  before update on public.demandes_support
  for each row execute function public.support_horodate();

-- ---------------------------------------------------------------------------
-- Mes demandes, avec ce qu'il faut pour les lire dans une liste
-- ---------------------------------------------------------------------------
--
-- Compter les reponses cote client demanderait de charger tout l'echange de
-- toutes les demandes pour n'afficher qu'un nombre par ligne. La base le fait
-- en une passe.
--
-- `security definer` avec le filtre sur `auth.uid()` ecrit dans la requete :
-- la fonction contourne RLS par nature, c'est donc ici, et nulle part ailleurs,
-- que se joue la confidentialite.

create or replace function public.mes_demandes_support()
returns table (
  id             uuid,
  auteur_id      uuid,
  sujet          text,
  categorie      text,
  message        text,
  statut         text,
  created_at     timestamptz,
  updated_at     timestamptz,
  reponses       bigint,
  derniere_reponse_de_l_equipe boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    d.id,
    d.auteur_id,
    d.sujet,
    d.categorie,
    d.message,
    d.statut,
    d.created_at,
    d.updated_at,
    count(r.id) as reponses,
    -- Vrai quand la derniere prise de parole vient de l'equipe : c'est le seul
    -- cas ou la liste doit attirer l'oeil, puisqu'il y a quelque chose de neuf
    -- a lire.
    coalesce(
      (select r2.de_l_equipe
         from public.reponses_support r2
        where r2.demande_id = d.id
        order by r2.created_at desc
        limit 1),
      false
    ) as derniere_reponse_de_l_equipe
  from public.demandes_support d
  left join public.reponses_support r on r.demande_id = d.id
  where d.auteur_id = (select auth.uid())
  group by d.id
  -- Par derniere activite : une demande a laquelle on vient de repondre est
  -- celle qu'on veut relire, meme si elle a ete ouverte il y a un mois.
  order by d.updated_at desc
  limit 200;
$$;

comment on function public.mes_demandes_support is
  'Demandes de l''appelant, avec le nombre de reponses et qui a parle en dernier. Triees par derniere activite.';

revoke all on function public.mes_demandes_support() from public;
grant execute on function public.mes_demandes_support() to authenticated;

-- ---------------------------------------------------------------------------
-- Declarer qu'on n'a plus besoin d'aide
-- ---------------------------------------------------------------------------
--
-- Le seul changement de statut ouvert a l'utilisateur, et il ne va que dans un
-- sens. Rouvrir se fait en repondant : la reponse remonte la demande dans la
-- file de l'equipe, ce qui est exactement l'effet recherche, sans donner un
-- second bouton qui permettrait de faire osciller un statut indefiniment.

create or replace function public.resoudre_ma_demande(p_demande uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
begin
  if moi is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  update public.demandes_support
     set statut = 'resolue'
   where id = p_demande
     and auteur_id = moi;

  -- Aucune ligne touchee : soit la demande n'existe pas, soit elle appartient a
  -- quelqu'un d'autre. On ne distingue pas les deux cas — repondre « elle
  -- existe mais elle n'est pas a vous » revient a confirmer un identifiant.
  if not found then
    raise exception 'Demande introuvable' using errcode = '42704';
  end if;
end;
$$;

comment on function public.resoudre_ma_demande is
  'Marque comme resolue une demande de l''appelant. Ne touche que le statut, et seulement dans ce sens.';

revoke all on function public.resoudre_ma_demande(uuid) from public;
grant execute on function public.resoudre_ma_demande(uuid) to authenticated;

/* --------------------------------------------------------------------------
   Diffusion en temps reel
   --------------------------------------------------------------------------
   Le tableau de bord de l'equipe s'abonne a ces deux tables plutot que
   d'interroger la base en boucle : une demande deposee doit paraitre a l'ecran
   sans que personne n'ait a rafraichir, et un sondage assez rapide pour donner
   la meme impression ferait des milliers de requetes pour rien.

   Cote application, le meme flux fait paraitre la reponse de l'equipe dans la
   demande ouverte. Les politiques RLS s'appliquent aussi a ce flux : on ne
   recoit que les lignes qu'on aurait le droit de lire par requete.
   -------------------------------------------------------------------------- */

do $$
declare
  cible text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach cible in array array['demandes_support', 'reponses_support'] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = cible
    ) then
      execute format('alter publication supabase_realtime add table public.%I', cible);
    end if;
  end loop;
end $$;

-- Sans `replica identity full`, une mise a jour ne transmet que les colonnes
-- de la cle : le changement de statut arriverait au tableau de bord sans dire
-- vers quel statut.
alter table public.demandes_support replica identity full;
alter table public.reponses_support replica identity full;
