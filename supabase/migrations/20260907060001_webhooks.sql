-- Des messages qui viennent d'ailleurs : les webhooks.
--
-- A quoi ca sert
-- --------------
-- « Si j'ai un projet Gmod, des choses a faire qui apparaissent dans le salon
-- du webhook, pour des projets externes qu'on peut relier directement. »
--
-- Un serveur de jeu, un integrateur continu, un script de sauvegarde : des
-- programmes qui n'ont pas de compte et qui ont quelque chose a dire dans un
-- salon. Leur donner un compte serait leur donner un mot de passe, une session
-- et le droit de lire tout l'espace — pour ecrire trois lignes par jour.
--
-- Un webhook est l'inverse : une adresse secrete qui ne sait faire QU'UNE
-- chose, ecrire dans UN salon, et rien d'autre. Il ne lit rien.
--
-- Pourquoi l'auteur reste une personne
-- ------------------------------------
-- `messages.author_id` ne peut pas etre nul, et `profiles.id` reference
-- `auth.users` : un webhook ne peut donc pas avoir de profil, faute de compte.
--
-- On aurait pu rendre l'auteur facultatif. Ce serait toucher a la colonne la
-- plus utilisee de la base pour un cas marginal, et rendre nullable partout ce
-- qui ne l'est jamais ailleurs.
--
-- Le message porte donc DEUX choses : son auteur — la personne qui a cree le
-- webhook, qui reste responsable de ce qui en sort — et le webhook lui-meme,
-- qui decide de ce qu'on AFFICHE. C'est plus honnete qu'un message anonyme :
-- quand un robot deraille, on sait a qui parler.

create table if not exists public.webhooks (
  id          uuid primary key default gen_random_uuid(),

  channel_id  uuid not null references public.channels (id) on delete cascade,
  -- Denormalise depuis le salon : les politiques et le tableau de bord de
  -- moderation interrogent l'espace, et remonter par le salon a chaque ligne
  -- ferait une jointure de plus sur chaque verification de droit.
  space_id    uuid not null references public.spaces (id) on delete cascade,

  nom         text not null check (char_length(trim(nom)) between 1 and 48),
  avatar_url  text check (avatar_url is null or char_length(avatar_url) <= 500),

  /*
   * Le secret. C'est lui, et lui seul, qui autorise a ecrire.
   *
   * Quarante-huit caracteres tires de `gen_random_uuid`, deux fois : le hasard
   * du coeur de Postgres, sans dependre de `pgcrypto` dont le schema
   * d'installation varie. Assez long pour qu'on ne le devine pas, assez court
   * pour tenir dans une adresse qu'on colle dans un fichier de configuration.
   */
  jeton       text not null unique
                default replace(gen_random_uuid()::text, '-', '')
                     || replace(gen_random_uuid()::text, '-', ''),

  -- Qui l'a cree. `on delete cascade` : un compte supprime emporte ses
  -- webhooks, sinon il resterait des adresses actives sans personne derriere.
  cree_par    uuid not null references public.profiles (id) on delete cascade,

  actif       boolean not null default true,

  /*
   * De quoi voir ce qu'il fait, sans ouvrir le journal.
   *
   * « Ce webhook marche-t-il ? » est la premiere question qu'on se pose apres
   * l'avoir branche, et la seule reponse jusqu'ici serait de regarder si un
   * message est arrive — ce qui ne distingue pas « il n'a rien envoye » de
   * « il a envoye et ca a ete refuse ».
   */
  appels      bigint not null default 0,
  refus       bigint not null default 0,
  dernier_le  timestamptz,

  created_at  timestamptz not null default now()
);

comment on table public.webhooks is
  'Une adresse secrete qui ne sait qu''ecrire dans un salon. Ne lit rien, n''a '
  'pas de compte, et reste attachee a la personne qui l''a creee.';

create index if not exists webhooks_salon_idx on public.webhooks (channel_id, created_at desc);

/*
 * Le message dit de quel webhook il vient.
 *
 * `on delete set null` : supprimer un webhook n'efface pas ce qu'il a ecrit.
 * L'historique d'un salon appartient au salon, pas a l'outil qui l'a rempli —
 * et effacer trois mois de rapports parce qu'on a revoque une cle serait une
 * surprise couteuse.
 */
alter table public.messages
  add column if not exists webhook_id uuid references public.webhooks (id) on delete set null;

/*
 * Le nom et l'image AU MOMENT DE L'ENVOI.
 *
 * Un webhook porte un nom par defaut, mais chaque message peut le remplacer —
 * c'est ce que fait Discord, et c'est ce qui permet a un seul webhook de
 * parler au nom de plusieurs sources : « CI », « Sauvegarde », « Serveur 2 ».
 *
 * Figes dans le message plutot que lus dans le webhook : renommer un webhook
 * ne doit pas reecrire l'histoire de ce qu'il a dit.
 */
alter table public.messages
  add column if not exists webhook_nom text check (webhook_nom is null or char_length(webhook_nom) <= 48);

alter table public.messages
  add column if not exists webhook_avatar text
    check (webhook_avatar is null or char_length(webhook_avatar) <= 500);

-- ---------------------------------------------------------------------------
-- Qui peut faire quoi
-- ---------------------------------------------------------------------------

alter table public.webhooks enable row level security;

/*
 * Seuls ceux qui administrent l'espace voient les webhooks — et donc les
 * jetons.
 *
 * Un jeton lisible par tous les membres serait un droit d'ecriture donne a
 * tous les membres, sous un autre nom : n'importe qui pourrait faire parler
 * « Serveur de sauvegarde » dans le salon des annonces.
 */
drop policy if exists webhooks_lecture on public.webhooks;
create policy webhooks_lecture on public.webhooks
  for select to authenticated
  using (public.my_rank(space_id) >= 2);

drop policy if exists webhooks_ecriture on public.webhooks;
create policy webhooks_ecriture on public.webhooks
  for all to authenticated
  using (public.my_rank(space_id) >= 2)
  with check (
    public.my_rank(space_id) >= 2
    and cree_par = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Ecrire par un webhook
-- ---------------------------------------------------------------------------
--
-- La fonction est le SEUL chemin. Elle vit en `security definer` et se charge
-- de tout ce qui doit etre vrai : le jeton existe, le webhook est actif, le
-- debit est tenu, le contenu est borne.
--
-- Pourquoi ici et non dans la fonction serveur : celle-ci s'execute avec la
-- cle de service, qui peut tout. Y laisser la verification reviendrait a faire
-- reposer la securite sur le fait que le code appelant pense a la faire. En
-- base, la regle tient meme si l'on se trompe ailleurs.

/*
 * Combien de messages un webhook peut envoyer par minute.
 *
 * Trente : de quoi supporter une rafale — un deploiement qui rapporte ses
 * etapes, un serveur qui redemarre — sans qu'une boucle mal ecrite puisse
 * noyer un salon. Discord tient une limite du meme ordre, et pour la meme
 * raison : ce n'est pas le debit qui pose probleme, c'est la boucle infinie
 * qu'on decouvre le lendemain.
 */
create or replace function public.poster_par_webhook(
  p_jeton   text,
  p_contenu text,
  p_nom     text default null,
  p_avatar  text default null
)
returns table (message_id uuid, refuse text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  crochet public.webhooks%rowtype;
  recents integer;
  nouveau uuid;
begin
  select * into crochet from public.webhooks where jeton = p_jeton;

  /*
   * Un jeton inconnu et un webhook eteint rendent la MEME reponse.
   *
   * Les distinguer dirait a qui tatonne si le jeton essaye existe — c'est-a-
   * dire lui offrir un moyen de les enumerer, une reponse a la fois.
   */
  if not found or not crochet.actif then
    return query select null::uuid, 'jeton inconnu'::text;
    return;
  end if;

  if char_length(trim(coalesce(p_contenu, ''))) = 0 then
    update public.webhooks set refus = refus + 1 where id = crochet.id;
    return query select null::uuid, 'message vide'::text;
    return;
  end if;

  -- Le debit se compte sur les messages reellement poses : c'est la seule
  -- mesure qui ne se contourne pas en changeant de chemin.
  select count(*) into recents
    from public.messages
   where webhook_id = crochet.id
     and created_at > now() - interval '1 minute';

  if recents >= 30 then
    update public.webhooks set refus = refus + 1 where id = crochet.id;
    return query select null::uuid, 'trop de messages'::text;
    return;
  end if;

  insert into public.messages (channel_id, author_id, content, webhook_id, webhook_nom, webhook_avatar)
  values (
    crochet.channel_id,
    -- L'auteur reste la personne qui a cree le webhook : c'est elle qui en
    -- repond, et c'est a elle qu'on s'adresse si le robot deraille.
    crochet.cree_par,
    left(trim(p_contenu), 4000),
    crochet.id,
    nullif(left(trim(coalesce(p_nom, '')), 48), ''),
    nullif(left(trim(coalesce(p_avatar, '')), 500), '')
  )
  returning id into nouveau;

  update public.webhooks
     set appels = appels + 1,
         dernier_le = now()
   where id = crochet.id;

  return query select nouveau, null::text;
end;
$$;

comment on function public.poster_par_webhook is
  'Le seul chemin par lequel un webhook ecrit. Verifie le jeton, l''etat, le '
  'debit et le contenu — en base, pour que la regle tienne meme si le code '
  'appelant l''oublie.';

/*
 * Personne ne l'appelle depuis l'application.
 *
 * Elle est faite pour la fonction serveur, qui parle avec la cle de service.
 * L'ouvrir aux comptes connectes permettrait d'ecrire au nom de n'importe quel
 * webhook dont on aurait vu le jeton passer.
 */
revoke all on function public.poster_par_webhook(text, text, text, text) from public;
revoke all on function public.poster_par_webhook(text, text, text, text) from anon;
revoke all on function public.poster_par_webhook(text, text, text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- Regenerer un jeton
-- ---------------------------------------------------------------------------
--
-- Un jeton se fuite : colle dans un depot public, laisse dans une capture
-- d'ecran, garde par quelqu'un qui a quitte l'equipe. Sans ce chemin, la seule
-- issue serait de supprimer le webhook — donc de perdre son historique et de
-- reconfigurer tout ce qui pointe dessus.

create or replace function public.roter_jeton_webhook(p_webhook uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  neuf text;
  espace uuid;
begin
  select space_id into espace from public.webhooks where id = p_webhook;
  if not found then
    return null;
  end if;

  -- La fonction contourne RLS : le droit se verifie donc ici, explicitement.
  if public.my_rank(espace) < 2 then
    raise exception 'Droits insuffisants pour ce webhook';
  end if;

  neuf := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.webhooks set jeton = neuf where id = p_webhook;

  return neuf;
end;
$$;

revoke all on function public.roter_jeton_webhook(uuid) from public;
grant execute on function public.roter_jeton_webhook(uuid) to authenticated;
