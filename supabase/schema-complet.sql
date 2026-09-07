-- Schema complet d'Echow, pour un projet Supabase neuf.
--
-- Les 50 migrations dans l'ordre, concatenees. A coller dans
-- l'editeur SQL du nouveau projet, en une fois.
--
-- Genere automatiquement : ne pas modifier a la main. La source reste
-- `supabase/migrations/`, un fichier par changement.



-- ==========================================================================
-- 20260826120001_schema.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — schema de base
--
-- Vocabulaire : ce que Discord appelle un "serveur" s'appelle ici un "space".
-- Cela evite la confusion permanente entre le serveur d'infrastructure et la
-- communaute.
--
-- Toutes les tables vivent dans `public` et sont protegees par RLS, activee
-- dans la migration suivante. Aucune table n'est lisible sans politique.
-- ============================================================================

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- `unaccent` est marquee STABLE et non IMMUTABLE parce qu'elle depend d'un
-- dictionnaire modifiable. En figeant le dictionnaire dans l'appel, la fonction
-- redevient deterministe, ce qui autorise son usage dans une colonne generee.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

-- Vecteur de recherche : la configuration `french` apporte la racinisation et
-- les mots vides francais, `immutable_unaccent` rend "cafe" et "café"
-- equivalents. Sans cela, une recherche accentuee ne trouverait jamais sa
-- version non accentuee, ce qui est redhibitoire en francais.
create or replace function public.message_search_vector(content text)
returns tsvector
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select to_tsvector('french', public.immutable_unaccent(content))
$$;

-- Couleur d'accent deterministe, pour que chaque personne et chaque espace ait
-- une identite visuelle stable sans avoir a televerser d'image.
create or replace function public.accent_for(seed uuid)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (array[
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
  ])[1 + (abs(hashtext(seed::text)) % 10)]
$$;

create or replace function public.slugify(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select coalesce(
    nullif(
      trim(both '-' from
        regexp_replace(lower(public.immutable_unaccent(input)), '[^a-z0-9]+', '-', 'g')
      ),
      ''
    ),
    'space'
  )
$$;

-- ----------------------------------------------------------------------------
-- Profils
-- ----------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique
                  check (username ~ '^[a-z0-9_.-]{2,32}$'),
  display_name  text not null
                  check (char_length(display_name) between 1 and 48),
  accent        text not null default '#6366f1',
  avatar_url    text,
  bio           text check (char_length(bio) <= 280),
  status        text not null default 'offline'
                  check (status in ('online', 'idle', 'dnd', 'offline')),
  custom_status text check (char_length(custom_status) <= 128),
  created_at    timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (username);
-- Recherche approximative pour l'autocompletion des mentions.
create index if not exists profiles_display_name_idx
  on public.profiles using gin (public.immutable_unaccent(display_name) extensions.gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Espaces
-- ----------------------------------------------------------------------------

create table if not exists public.spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 64),
  slug        text not null unique,
  description text check (char_length(description) <= 280),
  icon_url    text,
  accent      text not null default '#6366f1',
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  -- Code d'invitation : rejoindre un espace passe uniquement par ce code, via
  -- une fonction dediee. Connaitre l'identifiant d'un espace ne suffit pas.
  --
  -- Le code derive de gen_random_uuid(), qui appartient au coeur de Postgres.
  -- gen_random_bytes() aurait ete plus direct mais vient de pgcrypto, dont le
  -- schema d'installation varie : la valeur par defaut aurait pu ne pas se
  -- resoudre selon le search_path applique a la migration.
  invite_code text not null unique
                default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at  timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id  uuid not null references public.spaces(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'admin', 'member')),
  nickname  text check (char_length(nickname) <= 48),
  joined_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists space_members_user_idx on public.space_members (user_id);

-- ----------------------------------------------------------------------------
-- Categories et salons
-- ----------------------------------------------------------------------------

create table if not exists public.categories (
  id       uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  name     text not null check (char_length(name) between 1 and 64),
  position int not null default 0
);

create index if not exists categories_space_idx on public.categories (space_id, position);

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  kind        text not null default 'text' check (kind in ('text', 'voice')),
  name        text not null check (char_length(name) between 1 and 48),
  topic       text check (char_length(topic) <= 512),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists channels_space_idx on public.channels (space_id, position);

-- ----------------------------------------------------------------------------
-- Fils de discussion
--
-- Amelioration nette par rapport a Discord : un fil porte un statut explicite
-- (ouvert / resolu). Tant qu'il est ouvert il remonte dans une barre laterale
-- dediee, donc une question posee dans un salon actif ne se perd plus dans
-- l'historique.
-- ----------------------------------------------------------------------------

create table if not exists public.threads (
  id               uuid primary key default gen_random_uuid(),
  channel_id       uuid not null references public.channels(id) on delete cascade,
  space_id         uuid not null references public.spaces(id) on delete cascade,
  root_message_id  uuid not null unique,
  title            text not null check (char_length(title) between 1 and 120),
  created_by       uuid not null references public.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  resolved         boolean not null default false,
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz
);

create index if not exists threads_channel_idx
  on public.threads (channel_id, last_activity_at desc);
create index if not exists threads_space_open_idx
  on public.threads (space_id, last_activity_at desc) where resolved = false;

create table if not exists public.thread_participants (
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  primary key (thread_id, user_id)
);

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels(id) on delete cascade,
  thread_id   uuid references public.threads(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  content     text not null check (char_length(content) <= 4000),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  reply_to_id uuid references public.messages(id) on delete set null,
  pinned      boolean not null default false,
  search_vector tsvector
    generated always as (public.message_search_vector(content)) stored
);

-- La cle de tri (created_at, id) est aussi la cle de pagination par curseur :
-- `where (created_at, id) < (?, ?)` se resout par un simple parcours d'index,
-- sans OFFSET qui devient lineaire sur un historique long.
create index if not exists messages_channel_idx
  on public.messages (channel_id, created_at desc, id desc)
  where thread_id is null;
create index if not exists messages_thread_idx
  on public.messages (thread_id, created_at, id) where thread_id is not null;
create index if not exists messages_author_idx on public.messages (author_id);
create index if not exists messages_pinned_idx
  on public.messages (channel_id, created_at desc) where pinned = true;
create index if not exists messages_search_idx
  on public.messages using gin (search_vector);

-- La contrainte d'unicite sur threads.root_message_id est posee ici, une fois
-- la table messages connue.
alter table public.threads
  drop constraint if exists threads_root_message_fk;
alter table public.threads
  add constraint threads_root_message_fk
  foreign key (root_message_id) references public.messages(id) on delete cascade;

-- ----------------------------------------------------------------------------
-- Pieces jointes et reactions
-- ----------------------------------------------------------------------------

create table if not exists public.attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  content_type text not null,
  size         bigint not null check (size >= 0),
  width        int,
  height       int
);

create index if not exists attachments_message_idx on public.attachments (message_id);

create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists reactions_message_idx on public.reactions (message_id);

-- ----------------------------------------------------------------------------
-- Etats de lecture
-- ----------------------------------------------------------------------------

create table if not exists public.read_states (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  channel_id    uuid not null references public.channels(id) on delete cascade,
  last_read_at  timestamptz not null default 'epoch',
  mention_count int not null default 0 check (mention_count >= 0),
  primary key (user_id, channel_id)
);

-- ----------------------------------------------------------------------------
-- Declencheurs
-- ----------------------------------------------------------------------------

-- Un fil remonte en tete de liste des qu'il recoit une reponse.
create or replace function public.touch_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.thread_id is not null then
    update public.threads
       set last_activity_at = new.created_at
     where id = new.thread_id;

    insert into public.thread_participants (thread_id, user_id)
    values (new.thread_id, new.author_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_touch_thread on public.messages;
create trigger messages_touch_thread
  after insert on public.messages
  for each row execute function public.touch_thread();

-- Marque `edited_at` uniquement quand le contenu change reellement, pour ne pas
-- afficher "modifie" apres un simple epinglage.
create or replace function public.mark_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_mark_edited on public.messages;
create trigger messages_mark_edited
  before update on public.messages
  for each row execute function public.mark_edited();

-- Incremente le compteur de mentions des personnes citees. L'auteur n'est
-- jamais notifie de sa propre mention.
create or replace function public.register_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mentioned text[];
  target_space uuid;
begin
  mentioned := array(
    select distinct lower(m[1])
    from regexp_matches(new.content, '@([a-zA-Z0-9_.-]{2,32})', 'g') as m
  );

  if array_length(mentioned, 1) is null then
    return new;
  end if;

  select space_id into target_space from public.channels where id = new.channel_id;

  if mentioned && array['everyone', 'here', 'tous'] then
    insert into public.read_states (user_id, channel_id, mention_count)
    select sm.user_id, new.channel_id, 1
      from public.space_members sm
     where sm.space_id = target_space
       and sm.user_id <> new.author_id
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;
  else
    insert into public.read_states (user_id, channel_id, mention_count)
    select p.id, new.channel_id, 1
      from public.profiles p
      join public.space_members sm
        on sm.user_id = p.id and sm.space_id = target_space
     where p.username = any(mentioned)
       and p.id <> new.author_id
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_register_mentions on public.messages;
create trigger messages_register_mentions
  after insert on public.messages
  for each row execute function public.register_mentions();

-- ----------------------------------------------------------------------------
-- Creation du profil a l'inscription
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted   text;
  candidate text;
  suffix   int := 0;
  new_space uuid;
begin
  -- Un pseudo valide est derive des metadonnees d'inscription, sinon de la
  -- partie locale de l'adresse e-mail.
  wanted := lower(regexp_replace(
    coalesce(
      new.raw_user_meta_data ->> 'username',
      split_part(coalesce(new.email, ''), '@', 1),
      'membre'
    ),
    '[^a-zA-Z0-9_.-]', '', 'g'
  ));

  if wanted is null or char_length(wanted) < 2 then
    wanted := 'membre';
  end if;
  wanted := left(wanted, 28);

  candidate := wanted;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := wanted || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name, accent)
  values (
    new.id,
    candidate,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), candidate),
    public.accent_for(new.id)
  );

  -- Un compte tout neuf arrive dans un espace deja utilisable plutot que
  -- devant un ecran vide.
  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    'Espace de ' || candidate,
    public.slugify(candidate) || '-' || substr(new.id::text, 1, 4),
    'Votre premier espace. Renommez-le et invitez du monde.',
    new.id,
    public.accent_for(new.id)
  )
  returning id into new_space;

  insert into public.space_members (space_id, user_id, role)
  values (new_space, new.id, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (new_space, 'general', 'text', 'Le salon principal de votre espace.', 0),
    (new_space, 'idees', 'text', 'Pour ce qui n''est pas encore mur.', 1),
    (new_space, 'Salon vocal', 'voice', null, 2);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();



-- ==========================================================================
-- 20260826120002_security.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — securite au niveau des lignes
--
-- Le client parle directement a Postgres avec la cle publique. Toute la
-- securite du produit repose donc sur ce fichier : si une politique est trop
-- large, la donnee est publique. Chaque table est verrouillee par defaut, puis
-- ouverte explicitement.
--
-- Piege classique de Postgres a connaitre ici : une politique posee sur
-- `space_members` qui interroge `space_members` provoque une recursion
-- infinie. Les fonctions d'appartenance ci-dessous sont donc SECURITY DEFINER,
-- ce qui les fait s'executer hors RLS et coupe la recursion.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fonctions d'autorisation
-- ----------------------------------------------------------------------------

create or replace function public.is_space_member(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = (select auth.uid())
  )
$$;

create or replace function public.can_manage_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = (select auth.uid())
       and role in ('owner', 'admin')
  )
$$;

create or replace function public.is_channel_member(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
      join public.space_members sm on sm.space_id = c.space_id
     where c.id = p_channel_id
       and sm.user_id = (select auth.uid())
  )
$$;

create or replace function public.can_manage_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
      join public.space_members sm on sm.space_id = c.space_id
     where c.id = p_channel_id
       and sm.user_id = (select auth.uid())
       and sm.role in ('owner', 'admin')
  )
$$;

create or replace function public.can_see_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.messages m
      join public.channels c on c.id = m.channel_id
      join public.space_members sm on sm.space_id = c.space_id
     where m.id = p_message_id
       and sm.user_id = (select auth.uid())
  )
$$;

-- Vrai si les deux personnes partagent au moins un espace. Sert a limiter la
-- visibilite des profils : un compte ne peut pas enumerer tout l'annuaire.
create or replace function public.shares_space_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.space_members mine
      join public.space_members theirs on theirs.space_id = mine.space_id
     where mine.user_id = (select auth.uid())
       and theirs.user_id = p_user_id
  )
$$;

-- ----------------------------------------------------------------------------
-- Activation de RLS
-- ----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.spaces              enable row level security;
alter table public.space_members       enable row level security;
alter table public.categories          enable row level security;
alter table public.channels            enable row level security;
alter table public.threads             enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages            enable row level security;
alter table public.attachments         enable row level security;
alter table public.reactions           enable row level security;
alter table public.read_states         enable row level security;

-- ----------------------------------------------------------------------------
-- Profils
-- ----------------------------------------------------------------------------

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_space_with(id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- L'insertion passe par le declencheur `handle_new_user`, jamais par le client.

-- ----------------------------------------------------------------------------
-- Espaces
-- ----------------------------------------------------------------------------

drop policy if exists spaces_select on public.spaces;
create policy spaces_select on public.spaces
  for select to authenticated
  using (public.is_space_member(id));

drop policy if exists spaces_insert on public.spaces;
create policy spaces_insert on public.spaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists spaces_update on public.spaces;
create policy spaces_update on public.spaces
  for update to authenticated
  using (public.can_manage_space(id))
  with check (public.can_manage_space(id));

drop policy if exists spaces_delete on public.spaces;
create policy spaces_delete on public.spaces
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Membres
--
-- Aucune politique d'insertion : rejoindre un espace passe obligatoirement par
-- `public.join_space(code)`. Connaitre l'identifiant d'un espace ne suffit donc
-- jamais a s'y inviter soi-meme.
-- ----------------------------------------------------------------------------

drop policy if exists members_select on public.space_members;
create policy members_select on public.space_members
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists members_update on public.space_members;
create policy members_update on public.space_members
  for update to authenticated
  using (
    public.can_manage_space(space_id)
    -- Chacun peut changer son propre surnom.
    or user_id = (select auth.uid())
  )
  with check (
    public.can_manage_space(space_id)
    or user_id = (select auth.uid())
  );

drop policy if exists members_delete on public.space_members;
create policy members_delete on public.space_members
  for delete to authenticated
  using (
    -- Quitter un espace soi-meme, ou etre exclu par un administrateur.
    user_id = (select auth.uid())
    or public.can_manage_space(space_id)
  );

-- ----------------------------------------------------------------------------
-- Categories et salons
-- ----------------------------------------------------------------------------

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all to authenticated
  using (public.can_manage_space(space_id))
  with check (public.can_manage_space(space_id));

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels
  for all to authenticated
  using (public.can_manage_space(space_id))
  with check (public.can_manage_space(space_id));

-- ----------------------------------------------------------------------------
-- Fils
-- ----------------------------------------------------------------------------

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads
  for select to authenticated
  using (public.is_space_member(space_id));

drop policy if exists threads_insert on public.threads;
create policy threads_insert on public.threads
  for insert to authenticated
  with check (
    public.is_channel_member(channel_id)
    and created_by = (select auth.uid())
  );

-- Marquer un fil comme resolu est un geste collaboratif : tout membre de
-- l'espace peut le faire, pas seulement l'auteur.
drop policy if exists threads_update on public.threads;
create policy threads_update on public.threads
  for update to authenticated
  using (public.is_space_member(space_id))
  with check (public.is_space_member(space_id));

drop policy if exists threads_delete on public.threads;
create policy threads_delete on public.threads
  for delete to authenticated
  using (created_by = (select auth.uid()) or public.can_manage_channel(channel_id));

drop policy if exists thread_participants_select on public.thread_participants;
create policy thread_participants_select on public.thread_participants
  for select to authenticated
  using (
    exists (
      select 1 from public.threads t
       where t.id = thread_id and public.is_space_member(t.space_id)
    )
  );

drop policy if exists thread_participants_insert on public.thread_participants;
create policy thread_participants_insert on public.thread_participants
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.threads t
       where t.id = thread_id and public.is_space_member(t.space_id)
    )
  );

drop policy if exists thread_participants_delete on public.thread_participants;
create policy thread_participants_delete on public.thread_participants
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id)
  );

-- Seul l'auteur modifie son texte. L'epinglage, qui touche le message de
-- quelqu'un d'autre, passe par `public.set_message_pinned`.
drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (author_id = (select auth.uid()) or public.can_manage_channel(channel_id));

-- ----------------------------------------------------------------------------
-- Pieces jointes
-- ----------------------------------------------------------------------------

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (public.can_see_message(message_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
       where m.id = message_id and m.author_id = (select auth.uid())
    )
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_id
         and (m.author_id = (select auth.uid()) or public.can_manage_channel(m.channel_id))
    )
  );

-- ----------------------------------------------------------------------------
-- Reactions
-- ----------------------------------------------------------------------------

drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select to authenticated
  using (public.can_see_message(message_id));

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_see_message(message_id)
  );

drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Etats de lecture : strictement prives
-- ----------------------------------------------------------------------------

drop policy if exists read_states_own on public.read_states;
create policy read_states_own on public.read_states
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));



-- ==========================================================================
-- 20260826120003_api.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — fonctions applicatives
--
-- Tout ce qui demande plus qu'un INSERT ou un SELECT simple passe par une
-- fonction. Deux raisons : garantir l'atomicite (creer un espace cree aussi son
-- appartenance et ses salons), et permettre des gestes qui touchent la ligne de
-- quelqu'un d'autre (epingler un message) sans ouvrir la politique RLS
-- correspondante a tout le monde.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Espaces
-- ----------------------------------------------------------------------------

create or replace function public.create_space(
  p_name        text,
  p_description text default null
)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me        uuid := (select auth.uid());
  base_slug text;
  candidate text;
  suffix    int := 0;
  created   public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Le nom de l''espace est obligatoire' using errcode = '22023';
  end if;

  base_slug := public.slugify(p_name);
  candidate := base_slug;
  while exists (select 1 from public.spaces where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (trim(p_name), candidate, nullif(trim(coalesce(p_description, '')), ''),
          me, public.accent_for(gen_random_uuid()))
  returning * into created;

  insert into public.space_members (space_id, user_id, role)
  values (created.id, me, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (created.id, 'general', 'text', 'Le salon principal.', 0),
    (created.id, 'Salon vocal', 'voice', null, 1);

  return created;
end;
$$;

-- Rejoindre un espace : uniquement avec le code d'invitation. C'est la seule
-- porte d'entree, puisque `space_members` n'a aucune politique d'insertion.
create or replace function public.join_space(p_invite_code text)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  target public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select * into target
    from public.spaces
   where invite_code = lower(trim(p_invite_code));

  if not found then
    raise exception 'Ce code d''invitation ne correspond a aucun espace'
      using errcode = 'P0002';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;

-- Regenere le code d'invitation, pour couper l'acces a un lien qui a fuite.
create or replace function public.rotate_invite_code(p_space_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh text;
begin
  if not public.can_manage_space(p_space_id) then
    raise exception 'Reserve aux administrateurs de l''espace' using errcode = '42501';
  end if;

  fresh := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  update public.spaces set invite_code = fresh where id = p_space_id;
  return fresh;
end;
$$;

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

-- Epingler touche le message d'autrui : la politique RLS d'UPDATE reste donc
-- limitee a l'auteur, et ce geste passe par ici.
create or replace function public.set_message_pinned(
  p_message_id uuid,
  p_pinned     boolean
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.messages;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  update public.messages
     set pinned = p_pinned
   where id = p_message_id
  returning * into updated;

  return updated;
end;
$$;

-- Ajoute la reaction si elle est absente, la retire sinon, en un aller-retour.
create or replace function public.toggle_reaction(
  p_message_id uuid,
  p_emoji      text
)
returns table (out_emoji text, out_count bigint, out_reacted_by uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  -- GET DIAGNOSTICS ... ROW_COUNT renvoie un entier : le declarer booleen
  -- provoquerait une erreur de type a l'execution.
  removed int;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  delete from public.reactions r
   where r.message_id = p_message_id
     and r.user_id = me
     and r.emoji = p_emoji;

  get diagnostics removed = row_count;

  if removed = 0 then
    insert into public.reactions (message_id, user_id, emoji)
    values (p_message_id, me, p_emoji)
    on conflict do nothing;
  end if;

  return query
    select r.emoji, count(*)::bigint, array_agg(r.user_id)
      from public.reactions r
     where r.message_id = p_message_id
     group by r.emoji
     order by min(r.created_at);
end;
$$;

-- ----------------------------------------------------------------------------
-- Fils
-- ----------------------------------------------------------------------------

create or replace function public.start_thread(
  p_message_id uuid,
  p_title      text
)
returns public.threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  root    public.messages;
  chan    public.channels;
  created public.threads;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  select * into root from public.messages where id = p_message_id;

  if root.thread_id is not null then
    raise exception 'On ne peut pas ouvrir un fil depuis une reponse de fil'
      using errcode = '22023';
  end if;

  -- Un message ne porte qu'un seul fil : on renvoie l'existant plutot que
  -- d'echouer, ce qui rend le double-clic inoffensif.
  select * into created from public.threads where root_message_id = p_message_id;
  if found then
    return created;
  end if;

  select * into chan from public.channels where id = root.channel_id;

  insert into public.threads (channel_id, space_id, root_message_id, title, created_by)
  values (root.channel_id, chan.space_id, p_message_id,
          left(coalesce(nullif(trim(p_title), ''), left(root.content, 80)), 120), me)
  returning * into created;

  -- `select distinct` plutot qu'une liste VALUES : quand on ouvre un fil sur
  -- son propre message, les deux identifiants sont les memes.
  insert into public.thread_participants (thread_id, user_id)
  select distinct created.id, candidate
    from unnest(array[root.author_id, me]) as candidate
  on conflict do nothing;

  return created;
end;
$$;

-- ----------------------------------------------------------------------------
-- Lecture
-- ----------------------------------------------------------------------------

create or replace function public.mark_channel_read(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not public.is_channel_member(p_channel_id) then
    return;
  end if;

  insert into public.read_states (user_id, channel_id, last_read_at, mention_count)
  values (me, p_channel_id, now(), 0)
  on conflict (user_id, channel_id)
    do update set last_read_at = now(), mention_count = 0;
end;
$$;

-- ----------------------------------------------------------------------------
-- Recherche
--
-- La fonction est SECURITY INVOKER : les politiques RLS s'appliquent donc
-- normalement et personne ne peut chercher dans un espace dont il n'est pas
-- membre. Le classement combine la pertinence BM25-like de Postgres
-- (`ts_rank_cd`) et la fraicheur, parce qu'un message pertinent d'hier vaut
-- generalement mieux qu'un message pertinent d'il y a trois ans.
-- ----------------------------------------------------------------------------

create or replace function public.search_messages(
  p_query          text,
  p_space_id       uuid    default null,
  p_author_id      uuid    default null,
  p_channel_id     uuid    default null,
  p_has_attachment boolean default false,
  p_pinned_only    boolean default false,
  p_before         timestamptz default null,
  p_after          timestamptz default null,
  p_limit          int     default 25,
  p_offset         int     default 0
)
returns table (
  id           uuid,
  channel_id   uuid,
  channel_name text,
  space_id     uuid,
  thread_id    uuid,
  author_id    uuid,
  content      text,
  created_at   timestamptz,
  pinned       boolean,
  rank         real,
  total_count  bigint
)
language sql
stable
set search_path = ''
as $$
  with query_input as (
    select case
             when coalesce(trim(p_query), '') = '' then null
             else websearch_to_tsquery('french', public.immutable_unaccent(p_query))
           end as tsq
  ),
  matched as (
    select m.id,
           m.channel_id,
           c.name as channel_name,
           c.space_id,
           m.thread_id,
           m.author_id,
           m.content,
           m.created_at,
           m.pinned,
           case
             when q.tsq is null then 0::real
             else ts_rank_cd(m.search_vector, q.tsq, 32)
           end as base_rank
      from public.messages m
      join public.channels c on c.id = m.channel_id
      cross join query_input q
     where (q.tsq is null or m.search_vector @@ q.tsq)
       and (p_space_id is null or c.space_id = p_space_id)
       and (p_author_id is null or m.author_id = p_author_id)
       and (p_channel_id is null or m.channel_id = p_channel_id)
       and (not p_pinned_only or m.pinned)
       and (not p_has_attachment
            or exists (select 1 from public.attachments a where a.message_id = m.id))
       and (p_before is null or m.created_at < p_before)
       and (p_after is null or m.created_at > p_after)
  )
  select id,
         channel_id,
         channel_name,
         space_id,
         thread_id,
         author_id,
         content,
         created_at,
         pinned,
         -- Decroissance douce : un facteur 0.5 environ apres un an.
         -- L'alias evite `rank`, qui est aussi une fonction de fenetrage et
         -- rendrait le ORDER BY ambigu.
         (base_rank * (1.0 / (1.0 + extract(epoch from (now() - created_at)) / 31536000.0)))::real
           + base_rank as final_rank,
         count(*) over () as total_count
    from matched
   order by final_rank desc, created_at desc
   limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ----------------------------------------------------------------------------
-- Amorcage
--
-- Un seul aller-retour rend toute l'interface affichable : espaces, salons,
-- membres, profils, fils ouverts et compteurs de non-lus. Sans cela le premier
-- rendu se ferait par morceaux, au rythme de six requetes en cascade.
-- ----------------------------------------------------------------------------

create or replace function public.bootstrap()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with me as (
    select * from public.profiles where id = (select auth.uid())
  ),
  my_spaces as (
    select s.* from public.spaces s
     where public.is_space_member(s.id)
     order by s.created_at
  ),
  my_channels as (
    select c.* from public.channels c
     where c.space_id in (select id from my_spaces)
     order by c.position, c.created_at
  ),
  unread as (
    select c.id as channel_id,
           coalesce(rs.last_read_at, 'epoch'::timestamptz) as last_read_at,
           coalesce(rs.mention_count, 0) as mention_count,
           (select count(*)
              from public.messages m
             where m.channel_id = c.id
               and m.thread_id is null
               and m.author_id <> (select auth.uid())
               and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
           ) as unread_count
      from my_channels c
      left join public.read_states rs
        on rs.channel_id = c.id and rs.user_id = (select auth.uid())
     where c.kind = 'text'
  )
  select jsonb_build_object(
    'profile',    (select to_jsonb(me.*) from me),
    'spaces',     coalesce((select jsonb_agg(to_jsonb(s.*)) from my_spaces s), '[]'::jsonb),
    'channels',   coalesce((select jsonb_agg(to_jsonb(c.*)) from my_channels c), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(cat.*) order by cat.position)
        from public.categories cat
       where cat.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(sm.*))
        from public.space_members sm
       where sm.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p.*))
        from public.profiles p
       where p.id in (
         select sm.user_id from public.space_members sm
          where sm.space_id in (select id from my_spaces)
       )
    ), '[]'::jsonb),
    'open_threads', coalesce((
      select jsonb_agg(to_jsonb(t.*) order by t.last_activity_at desc)
        from public.threads t
       where t.space_id in (select id from my_spaces)
         and t.resolved = false
    ), '[]'::jsonb),
    'read_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_id',    u.channel_id,
        'last_read_at',  u.last_read_at,
        'unread_count',  u.unread_count,
        'mention_count', u.mention_count
      )) from unread u
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Diffusion temps reel
--
-- Seules les tables dont un changement doit repeindre l'interface sont
-- publiees. Chaque table publiee a un cout permanent de replication, donc on
-- s'en tient au strict necessaire : la frappe en cours et la presence passent
-- par des canaux ephemeres, pas par la base.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

-- `ALTER PUBLICATION ... ADD TABLE` echoue si la table y figure deja : la
-- boucle garde le script rejouable sans erreur.
do $$
declare
  target text;
begin
  foreach target in array array['messages', 'reactions', 'threads', 'channels', 'profiles']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;

-- `old_record` complet lors des suppressions et modifications, sinon le client
-- ne recoit que la cle primaire et ne sait pas quel salon repeindre.
alter table public.messages  replica identity full;
alter table public.reactions replica identity full;
alter table public.threads   replica identity full;



-- ==========================================================================
-- 20260826120004_storage.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — stockage des fichiers
--
-- Deux compartiments aux regles opposees :
--   `avatars`     public en lecture, chacun n'ecrit que dans son dossier ;
--   `attachments` prive, lisible seulement par les membres du salon concerne.
--
-- Le nom du fichier porte l'autorisation : le premier segment du chemin est
-- l'identifiant du proprietaire (avatars) ou du salon (pieces jointes), ce qui
-- permet aux politiques de decider sans consulter d'autre table.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 25 * 1024 * 1024)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ----------------------------------------------------------------------------
-- Avatars : chemin `{user_id}/{fichier}`
-- ----------------------------------------------------------------------------

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select to public
  using (bucket_id = 'avatars');

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- Pieces jointes : chemin `{channel_id}/{fichier}`
-- ----------------------------------------------------------------------------

drop policy if exists attachments_read on storage.objects;
create policy attachments_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_write on storage.objects;
create policy attachments_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and owner_id = (select auth.uid())::text
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists attachments_remove on storage.objects;
create policy attachments_remove on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner_id = (select auth.uid())::text
      or public.can_manage_channel(((storage.foldername(name))[1])::uuid)
    )
  );



-- ==========================================================================
-- 20260826120005_moderation.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — moderation
--
-- Quatre rangs, du plus fort au plus faible : owner, admin, moderator, member.
--
-- Regle qui gouverne tout ce fichier : on n'agit jamais sur quelqu'un d'un rang
-- superieur ou egal au sien. Sans cette regle, deux moderateurs pourraient
-- s'exclure mutuellement, et un moderateur pourrait bannir le proprietaire de
-- son propre espace. La comparaison passe par `role_rank()`, seule source de
-- verite sur la hierarchie.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Le rang moderateur
-- ----------------------------------------------------------------------------

alter table public.space_members
  drop constraint if exists space_members_role_check;

alter table public.space_members
  add constraint space_members_role_check
  check (role in ('owner', 'admin', 'moderator', 'member'));

create or replace function public.role_rank(role_name text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case role_name
           when 'owner'     then 3
           when 'admin'     then 2
           when 'moderator' then 1
           else 0
         end
$$;

create or replace function public.my_rank(p_space_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.role_rank(role)
       from public.space_members
      where space_id = p_space_id and user_id = (select auth.uid())),
    -1
  )
$$;

-- Peut moderer : moderateur ou au-dessus.
create or replace function public.can_moderate_space(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_rank(p_space_id) >= 1
$$;

-- ----------------------------------------------------------------------------
-- Sanctions
-- ----------------------------------------------------------------------------

create table if not exists public.space_bans (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  banned_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Null vaut bannissement definitif ; une date rend la sanction temporaire.
  expires_at timestamptz,
  primary key (space_id, user_id)
);

create index if not exists space_bans_user_idx on public.space_bans (user_id);

-- Exclusion temporaire de la parole : la personne reste membre et continue de
-- lire, mais ne peut plus ecrire. C'est la sanction la plus utile au quotidien,
-- et la seule qui ne detruit rien.
create table if not exists public.space_timeouts (
  space_id   uuid not null references public.spaces(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  issued_by  uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (space_id, user_id)
);

create index if not exists space_timeouts_expiry_idx
  on public.space_timeouts (space_id, expires_at);

-- Mode lent : intervalle minimal entre deux messages d'une meme personne.
alter table public.channels
  add column if not exists slowmode_seconds int not null default 0
  check (slowmode_seconds between 0 and 21600);

-- Salon verrouille : plus personne n'ecrit, sauf l'equipe de moderation.
alter table public.channels
  add column if not exists locked boolean not null default false;

-- ----------------------------------------------------------------------------
-- Journal et signalements
-- ----------------------------------------------------------------------------

create table if not exists public.moderation_log (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces(id) on delete cascade,
  actor_id   uuid references public.profiles(id) on delete set null,
  target_id  uuid references public.profiles(id) on delete set null,
  action     text not null,
  reason     text check (char_length(reason) <= 500),
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists moderation_log_space_idx
  on public.moderation_log (space_id, created_at desc);

create table if not exists public.message_reports (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages(id) on delete cascade,
  space_id    uuid not null references public.spaces(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  status      text not null default 'open'
                check (status in ('open', 'resolved', 'dismissed')),
  handled_by  uuid references public.profiles(id) on delete set null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- Un signalement par personne et par message : au-dela, c'est du bruit.
  unique (message_id, reporter_id)
);

create index if not exists message_reports_open_idx
  on public.message_reports (space_id, created_at desc) where status = 'open';

-- ----------------------------------------------------------------------------
-- Droit d'ecrire
-- ----------------------------------------------------------------------------

/**
 * Reunit toutes les conditions pour publier dans un salon : appartenance,
 * absence de bannissement, absence d'exclusion de parole, salon deverrouille,
 * et respect du mode lent.
 *
 * La verification vit dans la base et non dans le client, parce qu'un client
 * peut toujours etre contourne : sans cette fonction, une personne exclue
 * pourrait continuer a publier avec une simple requete directe.
 */
create or replace function public.can_post_in_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me         uuid := (select auth.uid());
  chan       public.channels;
  rank       int;
  last_post  timestamptz;
begin
  if me is null then
    return false;
  end if;

  select * into chan from public.channels where id = p_channel_id;
  if not found then
    return false;
  end if;

  rank := public.my_rank(chan.space_id);
  if rank < 0 then
    return false;
  end if;

  if exists (
    select 1 from public.space_bans b
     where b.space_id = chan.space_id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.space_timeouts t
     where t.space_id = chan.space_id
       and t.user_id = me
       and t.expires_at > now()
  ) then
    return false;
  end if;

  -- Verrou et mode lent ne s'appliquent pas a l'equipe de moderation, qui doit
  -- pouvoir intervenir precisement quand un salon est verrouille.
  if rank >= 1 then
    return true;
  end if;

  if chan.locked then
    return false;
  end if;

  if chan.slowmode_seconds > 0 then
    select max(created_at) into last_post
      from public.messages
     where channel_id = p_channel_id and author_id = me;

    if last_post is not null
       and last_post > now() - make_interval(secs => chan.slowmode_seconds) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- La politique d'insertion des messages tient compte des sanctions.
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.can_post_in_channel(channel_id)
  );

-- La suppression revient a l'auteur ou a l'equipe de moderation.
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.channels c
       where c.id = channel_id and public.can_moderate_space(c.space_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Actions de moderation
-- ----------------------------------------------------------------------------

/** Refuse l'action si l'acteur ne domine pas strictement sa cible. */
create or replace function public.assert_outranks(p_space_id uuid, p_target uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  mine   int := public.my_rank(p_space_id);
  theirs int;
begin
  if mine < 1 then
    raise exception 'Action reservee a l''equipe de moderation'
      using errcode = '42501';
  end if;

  if p_target = (select auth.uid()) then
    raise exception 'On ne peut pas appliquer cette action a soi-meme'
      using errcode = '42501';
  end if;

  select coalesce(public.role_rank(role), -1) into theirs
    from public.space_members
   where space_id = p_space_id and user_id = p_target;

  if theirs is null then
    theirs := -1;
  end if;

  if theirs >= mine then
    raise exception 'Cette personne a un rang egal ou superieur au votre'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.log_moderation(
  p_space_id uuid,
  p_target   uuid,
  p_action   text,
  p_reason   text default null,
  p_details  jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_log (space_id, actor_id, target_id, action, reason, details)
  values (p_space_id, (select auth.uid()), p_target, p_action, p_reason, p_details);
$$;

/** Change le rang d'un membre. Seul le proprietaire nomme des administrateurs. */
create or replace function public.set_member_role(
  p_space_id uuid,
  p_user_id  uuid,
  p_role     text
)
returns public.space_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  mine    int := public.my_rank(p_space_id);
  wanted  int := public.role_rank(p_role);
  updated public.space_members;
begin
  if p_role not in ('admin', 'moderator', 'member') then
    raise exception 'Rang inconnu ou non attribuable' using errcode = '22023';
  end if;

  perform public.assert_outranks(p_space_id, p_user_id);

  -- On ne peut pas nommer quelqu'un a un rang que l'on n'a pas soi-meme
  -- depasse : un administrateur ne fabrique donc pas un autre administrateur.
  if wanted >= mine then
    raise exception 'Vous ne pouvez pas attribuer un rang egal ou superieur au votre'
      using errcode = '42501';
  end if;

  update public.space_members
     set role = p_role
   where space_id = p_space_id and user_id = p_user_id
  returning * into updated;

  if not found then
    raise exception 'Cette personne n''est pas membre de l''espace' using errcode = 'P0002';
  end if;

  perform public.log_moderation(
    p_space_id, p_user_id, 'role_change', null, jsonb_build_object('role', p_role)
  );

  return updated;
end;
$$;

/** Exclut sans bannir : la personne peut revenir avec une nouvelle invitation. */
create or replace function public.kick_member(
  p_space_id uuid,
  p_user_id  uuid,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_outranks(p_space_id, p_user_id);

  delete from public.space_members
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(p_space_id, p_user_id, 'kick', p_reason);
end;
$$;

/** Bannit, definitivement ou jusqu'a une date. */
create or replace function public.ban_member(
  p_space_id   uuid,
  p_user_id    uuid,
  p_reason     text default null,
  p_expires_at timestamptz default null
)
returns public.space_bans
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.space_bans;
begin
  perform public.assert_outranks(p_space_id, p_user_id);

  insert into public.space_bans (space_id, user_id, reason, banned_by, expires_at)
  values (p_space_id, p_user_id, p_reason, (select auth.uid()), p_expires_at)
  on conflict (space_id, user_id) do update
    set reason = excluded.reason,
        banned_by = excluded.banned_by,
        expires_at = excluded.expires_at,
        created_at = now()
  returning * into created;

  -- Bannir implique de sortir de l'espace, sinon la personne resterait listee
  -- parmi les membres sans pouvoir rien faire.
  delete from public.space_members
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(
    p_space_id, p_user_id, 'ban', p_reason,
    jsonb_build_object('expires_at', p_expires_at)
  );

  return created;
end;
$$;

create or replace function public.unban_member(p_space_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_moderate_space(p_space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  delete from public.space_bans
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(p_space_id, p_user_id, 'unban');
end;
$$;

/** Retire la parole pour une duree donnee, en minutes. */
create or replace function public.timeout_member(
  p_space_id uuid,
  p_user_id  uuid,
  p_minutes  int,
  p_reason   text default null
)
returns public.space_timeouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.space_timeouts;
begin
  perform public.assert_outranks(p_space_id, p_user_id);

  if p_minutes is null or p_minutes < 1 or p_minutes > 40320 then
    raise exception 'La duree doit tenir entre 1 minute et 28 jours'
      using errcode = '22023';
  end if;

  insert into public.space_timeouts (space_id, user_id, reason, issued_by, expires_at)
  values (p_space_id, p_user_id, p_reason, (select auth.uid()),
          now() + make_interval(mins => p_minutes))
  on conflict (space_id, user_id) do update
    set reason = excluded.reason,
        issued_by = excluded.issued_by,
        expires_at = excluded.expires_at,
        created_at = now()
  returning * into created;

  perform public.log_moderation(
    p_space_id, p_user_id, 'timeout', p_reason,
    jsonb_build_object('minutes', p_minutes)
  );

  return created;
end;
$$;

create or replace function public.clear_timeout(p_space_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_moderate_space(p_space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  delete from public.space_timeouts
   where space_id = p_space_id and user_id = p_user_id;

  perform public.log_moderation(p_space_id, p_user_id, 'timeout_cleared');
end;
$$;

/** Verrouille ou deverrouille un salon, et regle son mode lent. */
create or replace function public.set_channel_moderation(
  p_channel_id uuid,
  p_locked     boolean default null,
  p_slowmode   int default null
)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  chan    public.channels;
  updated public.channels;
begin
  select * into chan from public.channels where id = p_channel_id;
  if not found then
    raise exception 'Salon introuvable' using errcode = 'P0002';
  end if;

  if not public.can_moderate_space(chan.space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  update public.channels
     set locked = coalesce(p_locked, locked),
         slowmode_seconds = coalesce(p_slowmode, slowmode_seconds)
   where id = p_channel_id
  returning * into updated;

  perform public.log_moderation(
    chan.space_id, null, 'channel_moderation', null,
    jsonb_build_object(
      'channel_id', p_channel_id,
      'locked', updated.locked,
      'slowmode', updated.slowmode_seconds
    )
  );

  return updated;
end;
$$;

/** Supprime un message au titre de la moderation, en gardant une trace. */
create or replace function public.moderate_delete_message(
  p_message_id uuid,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target   public.messages;
  space    uuid;
begin
  select * into target from public.messages where id = p_message_id;
  if not found then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  select space_id into space from public.channels where id = target.channel_id;

  if not public.can_moderate_space(space) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  -- Le contenu est copie dans le journal avant suppression : sans cela, la
  -- trace ne dirait pas ce qui a ete retire, et serait inexploitable en cas de
  -- contestation.
  perform public.log_moderation(
    space, target.author_id, 'message_delete', p_reason,
    jsonb_build_object(
      'channel_id', target.channel_id,
      'content', left(target.content, 500),
      'sent_at', target.created_at
    )
  );

  delete from public.messages where id = p_message_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Signalements
-- ----------------------------------------------------------------------------

create or replace function public.report_message(p_message_id uuid, p_reason text)
returns public.message_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  space   uuid;
  created public.message_reports;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  select c.space_id into space
    from public.messages m
    join public.channels c on c.id = m.channel_id
   where m.id = p_message_id;

  insert into public.message_reports (message_id, space_id, reporter_id, reason)
  values (p_message_id, space, (select auth.uid()), p_reason)
  on conflict (message_id, reporter_id) do update set reason = excluded.reason
  returning * into created;

  return created;
end;
$$;

create or replace function public.resolve_report(p_report_id uuid, p_status text)
returns public.message_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  target  public.message_reports;
  updated public.message_reports;
begin
  if p_status not in ('resolved', 'dismissed') then
    raise exception 'Statut invalide' using errcode = '22023';
  end if;

  select * into target from public.message_reports where id = p_report_id;
  if not found then
    raise exception 'Signalement introuvable' using errcode = 'P0002';
  end if;

  if not public.can_moderate_space(target.space_id) then
    raise exception 'Action reservee a l''equipe de moderation' using errcode = '42501';
  end if;

  update public.message_reports
     set status = p_status,
         handled_by = (select auth.uid()),
         handled_at = now()
   where id = p_report_id
  returning * into updated;

  return updated;
end;
$$;

-- ----------------------------------------------------------------------------
-- Un espace ne se rejoint pas quand on en a ete banni
-- ----------------------------------------------------------------------------

create or replace function public.join_space(p_invite_code text)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  target public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select * into target
    from public.spaces
   where invite_code = lower(trim(p_invite_code));

  if not found then
    raise exception 'Ce code d''invitation ne correspond a aucun espace'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.space_bans b
     where b.space_id = target.id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    raise exception 'Vous ne pouvez pas rejoindre cet espace' using errcode = '42501';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;

-- ----------------------------------------------------------------------------
-- Securite des nouvelles tables
-- ----------------------------------------------------------------------------

alter table public.space_bans      enable row level security;
alter table public.space_timeouts  enable row level security;
alter table public.moderation_log  enable row level security;
alter table public.message_reports enable row level security;

-- Les bannissements ne sont visibles que par l'equipe de moderation.
drop policy if exists bans_read on public.space_bans;
create policy bans_read on public.space_bans
  for select to authenticated
  using (public.can_moderate_space(space_id));

-- Chacun doit pouvoir constater qu'il est reduit au silence, et jusqu'a quand.
drop policy if exists timeouts_read on public.space_timeouts;
create policy timeouts_read on public.space_timeouts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_moderate_space(space_id)
  );

drop policy if exists moderation_log_read on public.moderation_log;
create policy moderation_log_read on public.moderation_log
  for select to authenticated
  using (public.can_moderate_space(space_id));

-- Un signalement est lisible par son auteur et par l'equipe de moderation,
-- jamais par la personne signalee.
drop policy if exists reports_read on public.message_reports;
create policy reports_read on public.message_reports
  for select to authenticated
  using (
    reporter_id = (select auth.uid())
    or public.can_moderate_space(space_id)
  );

-- Aucune politique d'ecriture : bans, exclusions, journal et signalements ne se
-- modifient que par les fonctions ci-dessus, qui verifient la hierarchie.

-- ----------------------------------------------------------------------------
-- Diffusion temps reel des nouvelles tables
-- ----------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['space_members', 'space_timeouts', 'message_reports']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;



-- ==========================================================================
-- 20260826120006_features.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — sondages, messages sauvegardes, historique des modifications
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Sondages
--
-- Attaches a un message plutot qu'a un type de message a part : un sondage
-- s'epingle, se cite, se cherche et vit dans un fil comme n'importe quel autre
-- message, sans code d'affichage separe.
-- ----------------------------------------------------------------------------

create table if not exists public.polls (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null unique references public.messages(id) on delete cascade,
  question     text not null check (char_length(question) between 1 and 300),
  -- Un sondage a choix multiple accepte plusieurs reponses par personne.
  multi_choice boolean not null default false,
  -- Masque les resultats jusqu'a la cloture, pour ne pas influencer les votes.
  hide_results boolean not null default false,
  closes_at    timestamptz,
  closed       boolean not null default false,
  created_by   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls(id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 120),
  position int not null default 0
);

create index if not exists poll_options_poll_idx on public.poll_options (poll_id, position);

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);

create index if not exists poll_votes_poll_idx on public.poll_votes (poll_id);

/** Vrai si le sondage n'accepte plus de vote. */
create or replace function public.poll_is_closed(p_poll public.polls)
returns boolean
language sql
stable
parallel safe
set search_path = ''
as $$
  select p_poll.closed
      or (p_poll.closes_at is not null and p_poll.closes_at <= now())
$$;

create or replace function public.create_poll(
  p_message_id   uuid,
  p_question     text,
  p_options      text[],
  p_multi_choice boolean default false,
  p_hide_results boolean default false,
  p_closes_at    timestamptz default null
)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  created public.polls;
  label   text;
  index   int := 0;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.messages where id = p_message_id and author_id = me
  ) then
    raise exception 'Un sondage ne s''attache qu''a son propre message'
      using errcode = '42501';
  end if;

  if array_length(p_options, 1) is null or array_length(p_options, 1) < 2 then
    raise exception 'Un sondage demande au moins deux reponses' using errcode = '22023';
  end if;

  if array_length(p_options, 1) > 12 then
    raise exception 'Douze reponses au maximum' using errcode = '22023';
  end if;

  insert into public.polls (message_id, question, multi_choice, hide_results, closes_at, created_by)
  values (p_message_id, p_question, p_multi_choice, p_hide_results, p_closes_at, me)
  returning * into created;

  foreach label in array p_options loop
    if char_length(trim(label)) > 0 then
      insert into public.poll_options (poll_id, label, position)
      values (created.id, trim(label), index);
      index := index + 1;
    end if;
  end loop;

  return created;
end;
$$;

create or replace function public.cast_vote(p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  poll   public.polls;
  target public.poll_options;
begin
  select * into target from public.poll_options where id = p_option_id;
  if not found then
    raise exception 'Reponse introuvable' using errcode = 'P0002';
  end if;

  select * into poll from public.polls where id = target.poll_id;

  if not public.can_see_message(poll.message_id) then
    raise exception 'Sondage introuvable' using errcode = 'P0002';
  end if;

  if public.poll_is_closed(poll) then
    raise exception 'Ce sondage est clos' using errcode = '22023';
  end if;

  -- Un second clic sur la meme reponse retire le vote : c'est le geste que
  -- tout le monde tente, autant qu'il fasse ce qu'on attend.
  if exists (
    select 1 from public.poll_votes
     where option_id = p_option_id and user_id = me
  ) then
    delete from public.poll_votes where option_id = p_option_id and user_id = me;
    return;
  end if;

  -- En choix unique, voter ailleurs deplace le vote au lieu d'en ajouter un.
  if not poll.multi_choice then
    delete from public.poll_votes where poll_id = poll.id and user_id = me;
  end if;

  insert into public.poll_votes (poll_id, option_id, user_id)
  values (poll.id, p_option_id, me)
  on conflict do nothing;
end;
$$;

create or replace function public.close_poll(p_poll_id uuid)
returns public.polls
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll    public.polls;
  space   uuid;
  updated public.polls;
begin
  select * into poll from public.polls where id = p_poll_id;
  if not found then
    raise exception 'Sondage introuvable' using errcode = 'P0002';
  end if;

  select c.space_id into space
    from public.messages m
    join public.channels c on c.id = m.channel_id
   where m.id = poll.message_id;

  if poll.created_by <> (select auth.uid()) and not public.can_moderate_space(space) then
    raise exception 'Seul l''auteur ou l''equipe de moderation peut clore un sondage'
      using errcode = '42501';
  end if;

  update public.polls set closed = true where id = p_poll_id returning * into updated;
  return updated;
end;
$$;

/**
 * Resultats d'un sondage.
 *
 * Tant que les resultats sont masques et le sondage ouvert, les decomptes sont
 * renvoyes a zero pour tout le monde sauf pour son auteur. Filtrer cote client
 * ne servirait a rien : les chiffres auraient deja quitte le serveur.
 */
create or replace function public.poll_results(p_poll_id uuid)
-- `position` est un mot-cle de Postgres : accepte comme nom de colonne dans un
-- CREATE TABLE, mais refuse comme nom de parametre de sortie ici. D'ou le
-- prefixe, qui evite d'avoir a le mettre entre guillemets partout.
returns table (
  option_id       uuid,
  label           text,
  option_position int,
  votes           bigint,
  voted           boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with poll as (
    select * from public.polls where id = p_poll_id
  ),
  visible as (
    select (not p.hide_results)
        or public.poll_is_closed(p)
        or p.created_by = (select auth.uid()) as show_counts
      from poll p
  )
  select o.id,
         o.label,
         o.position,
         case when v.show_counts
              then (select count(*) from public.poll_votes pv where pv.option_id = o.id)
              else 0::bigint
         end,
         exists (
           select 1 from public.poll_votes pv
            where pv.option_id = o.id and pv.user_id = (select auth.uid())
         )
    from public.poll_options o
    cross join visible v
   where o.poll_id = p_poll_id
   order by o.position;
$$;

-- ----------------------------------------------------------------------------
-- Messages sauvegardes
--
-- Discord n'offre que l'epinglage, qui est collectif : impossible de mettre un
-- message de cote pour soi. C'est pourtant le geste le plus courant.
-- ----------------------------------------------------------------------------

create table if not exists public.bookmarks (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  note       text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (user_id, message_id)
);

create index if not exists bookmarks_user_idx on public.bookmarks (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Historique des modifications
--
-- Discord affiche « modifie » sans jamais dire ce qui a change. Conserver les
-- versions precedentes rend la correction honnete : on voit qu'un message a
-- ete reecrit, et en quoi.
-- ----------------------------------------------------------------------------

create table if not exists public.message_edits (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  previous     text not null,
  edited_at    timestamptz not null default now()
);

create index if not exists message_edits_message_idx
  on public.message_edits (message_id, edited_at desc);

create or replace function public.record_message_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.content is distinct from old.content then
    insert into public.message_edits (message_id, previous, edited_at)
    values (old.id, old.content, now());
  end if;
  return new;
end;
$$;

drop trigger if exists messages_record_edit on public.messages;
create trigger messages_record_edit
  after update of content on public.messages
  for each row execute function public.record_message_edit();

-- ----------------------------------------------------------------------------
-- Securite
-- ----------------------------------------------------------------------------

alter table public.polls         enable row level security;
alter table public.poll_options  enable row level security;
alter table public.poll_votes    enable row level security;
alter table public.bookmarks     enable row level security;
alter table public.message_edits enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls
  for select to authenticated
  using (public.can_see_message(message_id));

drop policy if exists poll_options_read on public.poll_options;
create policy poll_options_read on public.poll_options
  for select to authenticated
  using (
    exists (
      select 1 from public.polls p
       where p.id = poll_id and public.can_see_message(p.message_id)
    )
  );

-- Les votes bruts ne sont jamais exposes : seul `poll_results` les agrege, ce
-- qui empeche de savoir qui a vote quoi dans un sondage a resultats masques.
drop policy if exists poll_votes_own on public.poll_votes;
create policy poll_votes_own on public.poll_votes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists bookmarks_own on public.bookmarks;
create policy bookmarks_own on public.bookmarks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists message_edits_read on public.message_edits;
create policy message_edits_read on public.message_edits
  for select to authenticated
  using (public.can_see_message(message_id));

-- ----------------------------------------------------------------------------
-- Amorcage enrichi
--
-- Le client a besoin de connaitre son propre rang et ses sanctions eventuelles
-- pour afficher les bons outils. Sans cela, l'interface montrerait des boutons
-- de moderation que la base refuserait ensuite.
-- ----------------------------------------------------------------------------

create or replace function public.bootstrap()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with me as (
    select * from public.profiles where id = (select auth.uid())
  ),
  my_spaces as (
    select s.* from public.spaces s
     where public.is_space_member(s.id)
     order by s.created_at
  ),
  my_channels as (
    select c.* from public.channels c
     where c.space_id in (select id from my_spaces)
     order by c.position, c.created_at
  ),
  unread as (
    select c.id as channel_id,
           coalesce(rs.last_read_at, 'epoch'::timestamptz) as last_read_at,
           coalesce(rs.mention_count, 0) as mention_count,
           (select count(*)
              from public.messages m
             where m.channel_id = c.id
               and m.thread_id is null
               and m.author_id <> (select auth.uid())
               and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
           ) as unread_count
      from my_channels c
      left join public.read_states rs
        on rs.channel_id = c.id and rs.user_id = (select auth.uid())
     where c.kind = 'text'
  )
  select jsonb_build_object(
    'profile',    (select to_jsonb(me.*) from me),
    'spaces',     coalesce((select jsonb_agg(to_jsonb(s.*)) from my_spaces s), '[]'::jsonb),
    'channels',   coalesce((select jsonb_agg(to_jsonb(c.*)) from my_channels c), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(cat.*) order by cat.position)
        from public.categories cat
       where cat.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(sm.*))
        from public.space_members sm
       where sm.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p.*))
        from public.profiles p
       where p.id in (
         select sm.user_id from public.space_members sm
          where sm.space_id in (select id from my_spaces)
       )
    ), '[]'::jsonb),
    'open_threads', coalesce((
      select jsonb_agg(to_jsonb(t.*) order by t.last_activity_at desc)
        from public.threads t
       where t.space_id in (select id from my_spaces)
         and t.resolved = false
    ), '[]'::jsonb),
    'read_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_id',    u.channel_id,
        'last_read_at',  u.last_read_at,
        'unread_count',  u.unread_count,
        'mention_count', u.mention_count
      )) from unread u
    ), '[]'::jsonb),
    -- Rang par espace, pour n'afficher que les outils reellement utilisables.
    'ranks', coalesce((
      select jsonb_object_agg(s.id::text, public.my_rank(s.id)) from my_spaces s
    ), '{}'::jsonb),
    -- Exclusions de parole en cours, pour expliquer un compositeur desactive.
    'timeouts', coalesce((
      select jsonb_agg(to_jsonb(t.*))
        from public.space_timeouts t
       where t.user_id = (select auth.uid())
         and t.expires_at > now()
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b.*) order by b.created_at desc)
        from public.bookmarks b
       where b.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Diffusion temps reel
-- ----------------------------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['polls', 'poll_votes']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end;
$$;



-- ==========================================================================
-- 20260826120007_profiles.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — profils enrichis
--
-- Un profil ne se limite plus a un pseudo et un avatar : banniere, pronoms,
-- liens, et des statistiques calculees a la demande.
--
-- Les statistiques ne sont pas stockees dans une colonne qu'il faudrait tenir
-- a jour a chaque message : elles sont comptees au moment ou on les demande.
-- Un profil s'ouvre rarement, un message s'ecrit souvent — c'est le comptage
-- qu'il vaut mieux payer.
-- ============================================================================

alter table public.profiles
  add column if not exists banner_url text,
  add column if not exists pronouns text check (char_length(pronouns) <= 32),
  -- Liens externes, sous la forme [{"label": "...", "url": "https://..."}].
  add column if not exists links jsonb not null default '[]'::jsonb,
  -- Teinte choisie par la personne, appliquee a sa carte de profil.
  add column if not exists theme_hue int check (theme_hue between 0 and 360);

/**
 * Valide la forme du tableau de liens.
 *
 * Le controle vit dans une fonction et non directement dans la contrainte :
 * Postgres refuse toute sous-requete dans un CHECK, et parcourir un tableau
 * JSON en demande une. Une fonction IMMUTABLE contourne la limite sans changer
 * la garantie — la verification reste faite en base, donc un client contourne
 * ne peut pas y echapper.
 *
 * Seuls http et https sont acceptes : un lien `javascript:` deviendrait une
 * faille des qu'il serait rendu cliquable.
 */
create or replace function public.valid_profile_links(links jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select jsonb_typeof(links) = 'array'
     and jsonb_array_length(links) <= 5
     and not exists (
       select 1
         from jsonb_array_elements(links) as entry
        where jsonb_typeof(entry) <> 'object'
           or entry->>'url' is null
           or entry->>'label' is null
           or char_length(entry->>'label') > 40
           or char_length(entry->>'url') > 200
           or entry->>'url' !~ '^https?://'
     )
$$;

alter table public.profiles
  drop constraint if exists profiles_links_shape;

alter table public.profiles
  add constraint profiles_links_shape check (public.valid_profile_links(links));

-- ----------------------------------------------------------------------------
-- Statistiques
-- ----------------------------------------------------------------------------

/**
 * Chiffres affiches sur une carte de profil.
 *
 * SECURITY INVOKER : les politiques RLS s'appliquent, donc on ne compte que
 * les messages des salons que l'on a soi-meme le droit de lire. Deux personnes
 * ne verront pas forcement le meme total, et c'est voulu — l'inverse revelerait
 * l'activite dans des espaces prives.
 */
create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'messages', (
      select count(*) from public.messages m where m.author_id = p_user_id
    ),
    'threads_opened', (
      select count(*) from public.threads t where t.created_by = p_user_id
    ),
    'reactions_given', (
      select count(*) from public.reactions r where r.user_id = p_user_id
    ),
    'shared_spaces', (
      select count(*)
        from public.space_members theirs
        join public.space_members mine
          on mine.space_id = theirs.space_id
         and mine.user_id = (select auth.uid())
       where theirs.user_id = p_user_id
    ),
    'joined_at', (
      select p.created_at from public.profiles p where p.id = p_user_id
    ),
    -- Rangs detenus dans les espaces communs, pour afficher des distinctions.
    'roles', coalesce((
      select jsonb_agg(distinct sm.role)
        from public.space_members sm
        join public.space_members mine
          on mine.space_id = sm.space_id
         and mine.user_id = (select auth.uid())
       where sm.user_id = p_user_id
         and sm.role <> 'member'
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Bannieres
--
-- Meme compartiment que les avatars : la politique existante autorise deja
-- chacun a ecrire dans le dossier portant son identifiant, et le chemin
-- `{user_id}/banner-...` la respecte sans qu'il y ait rien a ajouter.
-- ----------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 4 * 1024 * 1024
 where id = 'avatars';

-- ----------------------------------------------------------------------------
-- Amorcage : le profil complet suit les memes colonnes
-- ----------------------------------------------------------------------------

-- `bootstrap()` renvoie deja `to_jsonb(profiles.*)`, donc les nouvelles
-- colonnes y apparaissent sans modification. Rien a redefinir ici.



-- ==========================================================================
-- 20260827090001_direct_messages.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — messages prives et groupes
--
-- Choix d'architecture : une conversation privee est un salon sans espace,
-- pas une table separee.
--
-- L'alternative aurait ete un couple `conversations` / `conversation_messages`,
-- ce qui aurait oblige a dupliquer les reactions, les pieces jointes, les fils,
-- les etats de lecture, la recherche plein texte et toute la couche temps reel.
-- En rendant `channels.space_id` nullable, tout cela fonctionne sans une ligne
-- de plus, et l'interface n'a qu'un seul type de conversation a afficher.
--
-- Le prix a payer : les fonctions d'autorisation doivent desormais distinguer
-- deux cas. Elles sont regroupees ici pour que cette bifurcation reste visible
-- au meme endroit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Le salon peut ne plus appartenir a un espace
-- ----------------------------------------------------------------------------

alter table public.channels alter column space_id drop not null;

alter table public.channels drop constraint if exists channels_kind_check;
alter table public.channels
  add constraint channels_kind_check check (kind in ('text', 'voice', 'dm', 'group'));

-- Un salon appartient a un espace, ou bien est une conversation privee : jamais
-- les deux, jamais ni l'un ni l'autre.
alter table public.channels drop constraint if exists channels_space_or_dm;
alter table public.channels
  add constraint channels_space_or_dm check (
    (space_id is not null and kind in ('text', 'voice'))
    or (space_id is null and kind in ('dm', 'group'))
  );

-- Un fil ouvert dans une conversation privee n'a pas d'espace non plus.
alter table public.threads alter column space_id drop not null;

create table if not exists public.dm_participants (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  joined_at  timestamptz not null default now(),
  /** Masque la conversation de la liste sans en effacer l'historique. */
  hidden     boolean not null default false,
  primary key (channel_id, user_id)
);

create index if not exists dm_participants_user_idx
  on public.dm_participants (user_id) where hidden = false;

-- ----------------------------------------------------------------------------
-- Autorisations
-- ----------------------------------------------------------------------------

create or replace function public.is_dm_participant(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dm_participants
     where channel_id = p_channel_id
       and user_id = (select auth.uid())
  )
$$;

/**
 * Appartenance a un salon, quel que soit son type.
 *
 * Remplace la version qui ne connaissait que les espaces : sans cette
 * redefinition, aucune politique ne laisserait lire un message prive, puisque
 * la jointure vers `space_members` ne trouverait rien.
 */
create or replace function public.is_channel_member(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.channels c
      left join public.space_members sm
        on sm.space_id = c.space_id and sm.user_id = (select auth.uid())
      left join public.dm_participants dp
        on dp.channel_id = c.id and dp.user_id = (select auth.uid())
     where c.id = p_channel_id
       and (sm.user_id is not null or dp.user_id is not null)
  )
$$;

create or replace function public.can_see_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.messages m where m.id = p_message_id
  ) and public.is_channel_member(
    (select m.channel_id from public.messages m where m.id = p_message_id)
  )
$$;

-- Une conversation privee n'a ni moderation, ni verrou, ni mode lent : seule
-- l'appartenance compte.
create or replace function public.can_post_in_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me        uuid := (select auth.uid());
  chan      public.channels;
  rank      int;
  last_post timestamptz;
begin
  if me is null then
    return false;
  end if;

  select * into chan from public.channels where id = p_channel_id;
  if not found then
    return false;
  end if;

  if chan.space_id is null then
    return public.is_dm_participant(p_channel_id);
  end if;

  rank := public.my_rank(chan.space_id);
  if rank < 0 then
    return false;
  end if;

  if exists (
    select 1 from public.space_bans b
     where b.space_id = chan.space_id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.space_timeouts t
     where t.space_id = chan.space_id
       and t.user_id = me
       and t.expires_at > now()
  ) then
    return false;
  end if;

  if rank >= 1 then
    return true;
  end if;

  if chan.locked then
    return false;
  end if;

  if chan.slowmode_seconds > 0 then
    select max(created_at) into last_post
      from public.messages
     where channel_id = p_channel_id and author_id = me;

    if last_post is not null
       and last_post > now() - make_interval(secs => chan.slowmode_seconds) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- Politiques
-- ----------------------------------------------------------------------------

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select to authenticated
  using (
    (space_id is not null and public.is_space_member(space_id))
    or (space_id is null and public.is_dm_participant(id))
  );

-- L'ecriture d'un salon d'espace reste reservee aux administrateurs ; les
-- conversations privees sont creees par fonction, jamais directement.
drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels
  for all to authenticated
  using (space_id is not null and public.can_manage_space(space_id))
  with check (space_id is not null and public.can_manage_space(space_id));

drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads
  for select to authenticated
  using (public.is_channel_member(channel_id));

drop policy if exists threads_update on public.threads;
create policy threads_update on public.threads
  for update to authenticated
  using (public.is_channel_member(channel_id))
  with check (public.is_channel_member(channel_id));

alter table public.dm_participants enable row level security;

-- On voit les participants des conversations dont on fait partie.
drop policy if exists dm_participants_select on public.dm_participants;
create policy dm_participants_select on public.dm_participants
  for select to authenticated
  using (public.is_dm_participant(channel_id));

-- Chacun peut masquer sa propre conversation, rien d'autre.
drop policy if exists dm_participants_update on public.dm_participants;
create policy dm_participants_update on public.dm_participants
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- Ouvrir une conversation
-- ----------------------------------------------------------------------------

/**
 * Conversation a deux avec quelqu'un.
 *
 * Rouvre celle qui existe deja plutot que d'en creer une seconde : sans cette
 * recherche prealable, chaque clic sur un profil creerait un fil parallele et
 * l'historique se disperserait.
 */
create or replace function public.open_dm(p_other_user_id uuid)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := (select auth.uid());
  existing uuid;
  created  public.channels;
  other    public.profiles;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_other_user_id = me then
    raise exception 'On ne peut pas ouvrir une conversation avec soi-meme'
      using errcode = '22023';
  end if;

  select * into other from public.profiles where id = p_other_user_id;
  if not found then
    raise exception 'Cette personne n''existe pas' using errcode = 'P0002';
  end if;

  -- On n'ecrit qu'a des personnes avec qui on partage un espace : sans cette
  -- regle, n'importe qui pourrait envoyer un message a n'importe qui.
  if not public.shares_space_with(p_other_user_id) then
    raise exception 'Vous ne partagez aucun espace avec cette personne'
      using errcode = '42501';
  end if;

  select c.id into existing
    from public.channels c
    join public.dm_participants a on a.channel_id = c.id and a.user_id = me
    join public.dm_participants b on b.channel_id = c.id and b.user_id = p_other_user_id
   where c.kind = 'dm'
     and (select count(*) from public.dm_participants d where d.channel_id = c.id) = 2
   limit 1;

  if existing is not null then
    -- Rouvrir une conversation masquee la fait reapparaitre dans la liste.
    update public.dm_participants
       set hidden = false
     where channel_id = existing and user_id = me;

    select * into created from public.channels where id = existing;
    return created;
  end if;

  insert into public.channels (space_id, kind, name, position)
  values (null, 'dm', other.username, 0)
  returning * into created;

  insert into public.dm_participants (channel_id, user_id)
  values (created.id, me), (created.id, p_other_user_id);

  return created;
end;
$$;

/** Conversation de groupe, entre trois personnes et plus. */
create or replace function public.create_group_dm(p_user_ids uuid[], p_name text default null)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  target  uuid;
  members uuid[];
  created public.channels;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  members := array(select distinct unnest(p_user_ids) except select me);

  if array_length(members, 1) is null or array_length(members, 1) < 2 then
    raise exception 'Un groupe demande au moins deux autres personnes'
      using errcode = '22023';
  end if;
  if array_length(members, 1) > 9 then
    raise exception 'Neuf personnes au maximum, en plus de vous'
      using errcode = '22023';
  end if;

  foreach target in array members loop
    if not public.shares_space_with(target) then
      raise exception 'Vous ne partagez aucun espace avec l''une des personnes choisies'
        using errcode = '42501';
    end if;
  end loop;

  insert into public.channels (space_id, kind, name, position)
  values (null, 'group', coalesce(nullif(trim(p_name), ''), 'Groupe'), 0)
  returning * into created;

  insert into public.dm_participants (channel_id, user_id)
  select created.id, unnest(members || me);

  return created;
end;
$$;

/** Retire la conversation de sa liste sans effacer l'historique. */
create or replace function public.hide_dm(p_channel_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.dm_participants
     set hidden = true
   where channel_id = p_channel_id
     and user_id = (select auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- Amorcage : les conversations privees rejoignent la charge utile
-- ----------------------------------------------------------------------------

create or replace function public.bootstrap()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with me as (
    select * from public.profiles where id = (select auth.uid())
  ),
  my_spaces as (
    select s.* from public.spaces s
     where public.is_space_member(s.id)
     order by s.created_at
  ),
  my_dms as (
    select c.* from public.channels c
     join public.dm_participants dp
       on dp.channel_id = c.id
      and dp.user_id = (select auth.uid())
      and dp.hidden = false
     where c.space_id is null
  ),
  my_channels as (
    select c.* from public.channels c
     where c.space_id in (select id from my_spaces)
     union all
     select * from my_dms
  ),
  unread as (
    select c.id as channel_id,
           coalesce(rs.last_read_at, 'epoch'::timestamptz) as last_read_at,
           coalesce(rs.mention_count, 0) as mention_count,
           (select count(*)
              from public.messages m
             where m.channel_id = c.id
               and m.thread_id is null
               and m.author_id <> (select auth.uid())
               and m.created_at > coalesce(rs.last_read_at, 'epoch'::timestamptz)
           ) as unread_count
      from my_channels c
      left join public.read_states rs
        on rs.channel_id = c.id and rs.user_id = (select auth.uid())
     where c.kind <> 'voice'
  ),
  -- Toutes les personnes a connaitre : membres des espaces communs, et
  -- interlocuteurs des conversations privees.
  known_people as (
    select sm.user_id from public.space_members sm
     where sm.space_id in (select id from my_spaces)
    union
    select dp.user_id from public.dm_participants dp
     where dp.channel_id in (select id from my_dms)
  )
  select jsonb_build_object(
    'profile',    (select to_jsonb(me.*) from me),
    'spaces',     coalesce((select jsonb_agg(to_jsonb(s.*)) from my_spaces s), '[]'::jsonb),
    'channels',   coalesce((select jsonb_agg(to_jsonb(c.*)) from my_channels c), '[]'::jsonb),
    'dm_participants', coalesce((
      select jsonb_agg(to_jsonb(dp.*))
        from public.dm_participants dp
       where dp.channel_id in (select id from my_dms)
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(cat.*) order by cat.position)
        from public.categories cat
       where cat.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(sm.*))
        from public.space_members sm
       where sm.space_id in (select id from my_spaces)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p.*))
        from public.profiles p
       where p.id in (select user_id from known_people)
    ), '[]'::jsonb),
    'open_threads', coalesce((
      select jsonb_agg(to_jsonb(t.*) order by t.last_activity_at desc)
        from public.threads t
       where t.channel_id in (select id from my_channels)
         and t.resolved = false
    ), '[]'::jsonb),
    'read_states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_id',    u.channel_id,
        'last_read_at',  u.last_read_at,
        'unread_count',  u.unread_count,
        'mention_count', u.mention_count
      )) from unread u
    ), '[]'::jsonb),
    'ranks', coalesce((
      select jsonb_object_agg(s.id::text, public.my_rank(s.id)) from my_spaces s
    ), '{}'::jsonb),
    'timeouts', coalesce((
      select jsonb_agg(to_jsonb(t.*))
        from public.space_timeouts t
       where t.user_id = (select auth.uid())
         and t.expires_at > now()
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b.*) order by b.created_at desc)
        from public.bookmarks b
       where b.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Recherche : elle doit couvrir les conversations privees
-- ----------------------------------------------------------------------------

create or replace function public.search_messages(
  p_query          text,
  p_space_id       uuid    default null,
  p_author_id      uuid    default null,
  p_channel_id     uuid    default null,
  p_has_attachment boolean default false,
  p_pinned_only    boolean default false,
  p_before         timestamptz default null,
  p_after          timestamptz default null,
  p_limit          int     default 25,
  p_offset         int     default 0
)
returns table (
  id           uuid,
  channel_id   uuid,
  channel_name text,
  space_id     uuid,
  thread_id    uuid,
  author_id    uuid,
  content      text,
  created_at   timestamptz,
  pinned       boolean,
  rank         real,
  total_count  bigint
)
language sql
stable
set search_path = ''
as $$
  with query_input as (
    select case
             when coalesce(trim(p_query), '') = '' then null
             else websearch_to_tsquery('french', public.immutable_unaccent(p_query))
           end as tsq
  ),
  matched as (
    select m.id,
           m.channel_id,
           c.name as channel_name,
           c.space_id,
           m.thread_id,
           m.author_id,
           m.content,
           m.created_at,
           m.pinned,
           case
             when q.tsq is null then 0::real
             else ts_rank_cd(m.search_vector, q.tsq, 32)
           end as base_rank
      from public.messages m
      join public.channels c on c.id = m.channel_id
      cross join query_input q
     where (q.tsq is null or m.search_vector @@ q.tsq)
       -- Sans filtre d'espace, la recherche couvre aussi les conversations
       -- privees ; avec un filtre, elle s'y limite strictement.
       and (p_space_id is null or c.space_id = p_space_id)
       and (p_author_id is null or m.author_id = p_author_id)
       and (p_channel_id is null or m.channel_id = p_channel_id)
       and (not p_pinned_only or m.pinned)
       and (not p_has_attachment
            or exists (select 1 from public.attachments a where a.message_id = m.id))
       and (p_before is null or m.created_at < p_before)
       and (p_after is null or m.created_at > p_after)
  )
  select id, channel_id, channel_name, space_id, thread_id, author_id, content,
         created_at, pinned,
         (base_rank * (1.0 / (1.0 + extract(epoch from (now() - created_at)) / 31536000.0)))::real
           + base_rank as final_rank,
         count(*) over () as total_count
    from matched
   order by final_rank desc, created_at desc
   limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

-- ----------------------------------------------------------------------------
-- Temps reel
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'dm_participants'
  ) then
    alter publication supabase_realtime add table public.dm_participants;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Mentions dans les conversations privees
--
-- La version precedente resolvait les personnes citees via `space_members`.
-- Dans un salon sans espace cette jointure ne renvoie rien, donc une mention
-- en message prive n'incrementait aucun compteur et ne declenchait aucune
-- notification. On distingue desormais les deux cas.
-- ----------------------------------------------------------------------------

create or replace function public.register_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  mentioned    text[];
  target_space uuid;
begin
  mentioned := array(
    select distinct lower(m[1])
    from regexp_matches(new.content, '@([a-zA-Z0-9_.-]{2,32})', 'g') as m
  );

  if array_length(mentioned, 1) is null then
    return new;
  end if;

  select space_id into target_space from public.channels where id = new.channel_id;

  if target_space is null then
    -- Conversation privee : les destinataires sont les participants.
    insert into public.read_states (user_id, channel_id, mention_count)
    select dp.user_id, new.channel_id, 1
      from public.dm_participants dp
      join public.profiles p on p.id = dp.user_id
     where dp.channel_id = new.channel_id
       and dp.user_id <> new.author_id
       and (mentioned && array['everyone', 'here', 'tous'] or p.username = any(mentioned))
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;

    return new;
  end if;

  if mentioned && array['everyone', 'here', 'tous'] then
    insert into public.read_states (user_id, channel_id, mention_count)
    select sm.user_id, new.channel_id, 1
      from public.space_members sm
     where sm.space_id = target_space
       and sm.user_id <> new.author_id
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;
  else
    insert into public.read_states (user_id, channel_id, mention_count)
    select p.id, new.channel_id, 1
      from public.profiles p
      join public.space_members sm
        on sm.user_id = p.id and sm.space_id = target_space
     where p.username = any(mentioned)
       and p.id <> new.author_id
    on conflict (user_id, channel_id)
      do update set mention_count = public.read_states.mention_count + 1;
  end if;

  return new;
end;
$$;



-- ==========================================================================
-- 20260827090002_rate_limits.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — limitation de debit
--
-- Le mode lent d'un salon protege une conversation ; il ne protege pas le
-- service. Rien n'empechait jusqu'ici un script muni d'un compte valide
-- d'inserer des milliers de messages par seconde, ou de creer des espaces en
-- boucle.
--
-- Choix : les compteurs sont deduits des tables existantes plutot que stockes
-- dans une table d'evenements. Une table dediee grossirait sans fin et
-- demanderait un nettoyage periodique, alors que les messages et les reactions
-- portent deja leur horodatage. Les index partiels ci-dessous rendent ces
-- comptages quasi gratuits, puisqu'ils ne couvrent que la periode recente
-- utile.
--
-- Les seuils sont larges pour un humain et etroits pour un automate : trente
-- messages par minute, c'est deux par seconde soutenues, ce que personne ne
-- tape.
-- ============================================================================

-- Comptages sur fenetre glissante : sans ces index, chaque envoi de message
-- declencherait un parcours de toutes les lignes de l'auteur.
create index if not exists messages_author_recent_idx
  on public.messages (author_id, created_at desc);

create index if not exists reactions_user_recent_idx
  on public.reactions (user_id, created_at desc);

create index if not exists spaces_owner_recent_idx
  on public.spaces (owner_id, created_at desc);

create index if not exists reports_reporter_recent_idx
  on public.message_reports (reporter_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Seuils
-- ----------------------------------------------------------------------------

/**
 * Nombre d'actions restantes avant blocage, pour une table donnee.
 *
 * SECURITY DEFINER : le comptage doit voir toutes les lignes de la personne, y
 * compris celles de salons devenus invisibles depuis. Sinon on pourrait
 * contourner la limite en quittant un espace.
 */
create or replace function public.recent_count(
  p_table  text,
  p_column text,
  p_window interval
)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  total int;
begin
  -- `format` avec %I echappe les identifiants : le nom de table et de colonne
  -- vient du code appelant, jamais de l'utilisateur, mais la precaution coute
  -- une ligne et supprime toute possibilite d'injection.
  execute format(
    'select count(*)::int from public.%I where %I = $1 and created_at > now() - $2',
    p_table, p_column
  )
  into total
  using (select auth.uid()), p_window;

  return coalesce(total, 0);
end;
$$;

/** Limites appliquees, exprimees en actions par fenetre. */
create or replace function public.rate_limit_message()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.recent_count('messages', 'author_id', interval '1 minute') < 30
$$;

-- ----------------------------------------------------------------------------
-- Application
-- ----------------------------------------------------------------------------

/**
 * Le droit d'ecrire integre desormais la limite de debit.
 *
 * Elle s'applique a tout le monde, moderateurs compris : un compte
 * d'administration compromis est precisement celui dont on veut brider le
 * debit.
 */
create or replace function public.can_post_in_channel(p_channel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me        uuid := (select auth.uid());
  chan      public.channels;
  rank      int;
  last_post timestamptz;
begin
  if me is null then
    return false;
  end if;

  select * into chan from public.channels where id = p_channel_id;
  if not found then
    return false;
  end if;

  if not public.rate_limit_message() then
    return false;
  end if;

  if chan.space_id is null then
    return public.is_dm_participant(p_channel_id);
  end if;

  rank := public.my_rank(chan.space_id);
  if rank < 0 then
    return false;
  end if;

  if exists (
    select 1 from public.space_bans b
     where b.space_id = chan.space_id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.space_timeouts t
     where t.space_id = chan.space_id
       and t.user_id = me
       and t.expires_at > now()
  ) then
    return false;
  end if;

  if rank >= 1 then
    return true;
  end if;

  if chan.locked then
    return false;
  end if;

  if chan.slowmode_seconds > 0 then
    select max(created_at) into last_post
      from public.messages
     where channel_id = p_channel_id and author_id = me;

    if last_post is not null
       and last_post > now() - make_interval(secs => chan.slowmode_seconds) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- Reactions : soixante par minute. Cliquer plus vite releve du script.
drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_see_message(message_id)
    and public.recent_count('reactions', 'user_id', interval '1 minute') < 60
  );

/** Creation d'espace : cinq par heure. */
create or replace function public.create_space(
  p_name        text,
  p_description text default null
)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me        uuid := (select auth.uid());
  base_slug text;
  candidate text;
  suffix    int := 0;
  created   public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Le nom de l''espace est obligatoire' using errcode = '22023';
  end if;

  if public.recent_count('spaces', 'owner_id', interval '1 hour') >= 5 then
    raise exception 'Trop d''espaces crees recemment. Reessayez dans une heure.'
      using errcode = '53400';
  end if;

  base_slug := public.slugify(p_name);
  candidate := base_slug;
  while exists (select 1 from public.spaces where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (trim(p_name), candidate, nullif(trim(coalesce(p_description, '')), ''),
          me, public.accent_for(gen_random_uuid()))
  returning * into created;

  insert into public.space_members (space_id, user_id, role)
  values (created.id, me, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (created.id, 'general', 'text', 'Le salon principal.', 0),
    (created.id, 'Salon vocal', 'voice', null, 1);

  return created;
end;
$$;

/** Signalements : vingt par heure, pour eviter le harcelement par signalement. */
create or replace function public.report_message(p_message_id uuid, p_reason text)
returns public.message_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  space   uuid;
  created public.message_reports;
begin
  if not public.can_see_message(p_message_id) then
    raise exception 'Message introuvable' using errcode = 'P0002';
  end if;

  if public.recent_count('message_reports', 'reporter_id', interval '1 hour') >= 20 then
    raise exception 'Trop de signalements envoyes recemment. Reessayez plus tard.'
      using errcode = '53400';
  end if;

  select c.space_id into space
    from public.messages m
    join public.channels c on c.id = m.channel_id
   where m.id = p_message_id;

  insert into public.message_reports (message_id, space_id, reporter_id, reason)
  values (p_message_id, space, (select auth.uid()), p_reason)
  on conflict (message_id, reporter_id) do update set reason = excluded.reason
  returning * into created;

  return created;
end;
$$;

-- ----------------------------------------------------------------------------
-- Diagnostic cote client
--
-- Sans cela, une insertion refusee par la limite de debit remonterait comme un
-- refus de politique RLS, indiscernable d'un manque de droits. L'interface
-- pourrait alors afficher « acces refuse » a quelqu'un qui a simplement ecrit
-- trop vite.
-- ----------------------------------------------------------------------------

create or replace function public.my_rate_limits()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'messages_last_minute', public.recent_count('messages', 'author_id', interval '1 minute'),
    'messages_limit', 30,
    'reactions_last_minute', public.recent_count('reactions', 'user_id', interval '1 minute'),
    'reactions_limit', 60
  );
$$;



-- ==========================================================================
-- 20260827100001_oauth_profiles.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — comptes ouverts par un fournisseur tiers
--
-- Une inscription par Google arrive sans pseudo choisi, mais avec un nom
-- complet et une photo. La version precedente du declencheur les ignorait :
-- le nouveau venu se retrouvait avec un pseudo derive de son adresse et un
-- avatar en initiales, alors que les deux informations etaient disponibles.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted    text;
  candidate text;
  suffix    int := 0;
  shown     text;
  picture   text;
  new_space uuid;
begin
  -- Pseudo : celui demande a l'inscription, sinon la partie locale de
  -- l'adresse. Les fournisseurs tiers n'en proposent jamais.
  wanted := lower(regexp_replace(
    coalesce(
      meta ->> 'username',
      split_part(coalesce(new.email, ''), '@', 1),
      'membre'
    ),
    '[^a-zA-Z0-9_.-]', '', 'g'
  ));

  if wanted is null or char_length(wanted) < 2 then
    wanted := 'membre';
  end if;
  wanted := left(wanted, 28);

  candidate := wanted;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := wanted || suffix::text;
  end loop;

  -- Nom affiche : Google renseigne `full_name`, d'autres `name`.
  shown := nullif(trim(coalesce(
    meta ->> 'display_name',
    meta ->> 'full_name',
    meta ->> 'name',
    ''
  )), '');

  -- Photo : Google renseigne `avatar_url`, parfois `picture`.
  picture := nullif(trim(coalesce(
    meta ->> 'avatar_url',
    meta ->> 'picture',
    ''
  )), '');

  -- Une adresse d'image doit rester une adresse d'image : sans ce controle,
  -- une valeur `javascript:` fournie par un fournisseur mal configure
  -- deviendrait une faille des qu'elle serait rendue.
  if picture is not null and picture !~ '^https?://' then
    picture := null;
  end if;

  insert into public.profiles (id, username, display_name, accent, avatar_url)
  values (
    new.id,
    candidate,
    coalesce(shown, candidate),
    public.accent_for(new.id),
    picture
  );

  -- Un compte tout neuf arrive dans un espace deja utilisable plutot que
  -- devant un ecran vide.
  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    'Espace de ' || coalesce(shown, candidate),
    public.slugify(candidate) || '-' || substr(new.id::text, 1, 4),
    'Votre premier espace. Renommez-le et invitez du monde.',
    new.id,
    public.accent_for(new.id)
  )
  returning id into new_space;

  insert into public.space_members (space_id, user_id, role)
  values (new_space, new.id, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (new_space, 'general', 'text', 'Le salon principal de votre espace.', 0),
    (new_space, 'idees', 'text', 'Pour ce qui n''est pas encore mur.', 1),
    (new_space, 'Salon vocal', 'voice', null, 2);

  return new;
end;
$$;



-- ==========================================================================
-- 20260827110001_username_onboarding.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — choix du pseudo apres une connexion par fournisseur tiers
--
-- Une inscription par Google n'apporte aucun pseudo : le declencheur en
-- fabriquait un a partir de l'adresse e-mail. C'est fonctionnel mais subi, et
-- le pseudo est ce par quoi on est mentionne — il merite d'etre choisi.
--
-- On distingue donc un pseudo choisi d'un pseudo attribue. Le second declenche
-- un ecran de bienvenue qui demande de trancher avant d'entrer.
-- ============================================================================

alter table public.profiles
  add column if not exists username_chosen boolean not null default true;

-- Les comptes existants ont tous choisi leur pseudo a l'inscription : la
-- valeur par defaut `true` les laisse tranquilles. Seuls les comptes ouverts
-- par un fournisseur tiers a partir de maintenant partiront a `false`.

comment on column public.profiles.username_chosen is
  'Faux tant que le pseudo a ete deduit de l''adresse plutot que choisi.';

-- ----------------------------------------------------------------------------
-- Le declencheur marque les pseudos deduits
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta      jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  asked     text  := nullif(trim(coalesce(meta ->> 'username', '')), '');
  wanted    text;
  candidate text;
  suffix    int := 0;
  shown     text;
  picture   text;
  new_space uuid;
begin
  wanted := lower(regexp_replace(
    coalesce(asked, split_part(coalesce(new.email, ''), '@', 1), 'membre'),
    '[^a-zA-Z0-9_.-]', '', 'g'
  ));

  if wanted is null or char_length(wanted) < 2 then
    wanted := 'membre';
  end if;
  wanted := left(wanted, 28);

  candidate := wanted;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := wanted || suffix::text;
  end loop;

  shown := nullif(trim(coalesce(
    meta ->> 'display_name', meta ->> 'full_name', meta ->> 'name', ''
  )), '');

  picture := nullif(trim(coalesce(meta ->> 'avatar_url', meta ->> 'picture', '')), '');
  if picture is not null and picture !~ '^https?://' then
    picture := null;
  end if;

  insert into public.profiles (
    id, username, display_name, accent, avatar_url, username_chosen
  )
  values (
    new.id,
    candidate,
    coalesce(shown, candidate),
    public.accent_for(new.id),
    picture,
    -- Choisi seulement si l'inscription en portait un.
    asked is not null
  );

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    'Espace de ' || coalesce(shown, candidate),
    public.slugify(candidate) || '-' || substr(new.id::text, 1, 4),
    'Votre premier espace. Renommez-le et invitez du monde.',
    new.id,
    public.accent_for(new.id)
  )
  returning id into new_space;

  insert into public.space_members (space_id, user_id, role)
  values (new_space, new.id, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (new_space, 'general', 'text', 'Le salon principal de votre espace.', 0),
    (new_space, 'idees', 'text', 'Pour ce qui n''est pas encore mur.', 1),
    (new_space, 'Salon vocal', 'voice', null, 2);

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Verifier puis reserver un pseudo
-- ----------------------------------------------------------------------------

/**
 * Un pseudo est-il libre ?
 *
 * SECURITY DEFINER, parce que la politique de lecture des profils est limitee
 * aux personnes avec qui on partage un espace : sans cela, la verification
 * repondrait « libre » pour un pseudo qui existe hors de vue.
 *
 * Cela expose l'existence d'un pseudo, ce qui est inevitable : un formulaire
 * qui refuse un pseudo pris la revele de toute facon.
 */
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(trim(p_username)) ~ '^[a-z0-9_.-]{2,32}$'
     and not exists (
       select 1 from public.profiles
        where username = lower(trim(p_username))
          and id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
     )
$$;

/**
 * Fixe definitivement son pseudo.
 *
 * L'unicite est garantie par la contrainte de la table et non par la
 * verification prealable : entre le controle et l'ecriture, quelqu'un d'autre
 * peut avoir pris le meme. On rattrape donc la violation pour renvoyer un
 * message comprehensible plutot qu'une erreur de contrainte.
 */
create or replace function public.claim_username(p_username text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  wanted  text := lower(trim(p_username));
  updated public.profiles;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  if wanted !~ '^[a-z0-9_.-]{2,32}$' then
    raise exception 'Entre 2 et 32 caracteres : lettres, chiffres, point, tiret, souligne.'
      using errcode = '22023';
  end if;

  begin
    update public.profiles
       set username = wanted,
           username_chosen = true
     where id = me
    returning * into updated;
  exception
    when unique_violation then
      raise exception 'Ce pseudo est deja pris.' using errcode = '23505';
  end;

  return updated;
end;
$$;



-- ==========================================================================
-- 20260827120001_friends.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — relations d'amitie
--
-- Une demande est dirigee : quelqu'un demande, quelqu'un repond. Une fois
-- acceptee, la relation devient symetrique mais la ligne reste unique — la
-- dupliquer dans les deux sens obligerait a les maintenir en accord, et une
-- desynchronisation donnerait un ami d'un cote seulement.
--
-- L'unicite porte donc sur la paire ordonnee (le plus petit identifiant
-- d'abord), ce qui empeche deux demandes croisees de coexister.
-- ============================================================================

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'blocked')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,

  -- On ne devient pas son propre ami.
  constraint friendships_distinct check (requester_id <> addressee_id),

  -- Paire normalisee : le plus petit identifiant d'abord. L'index unique porte
  -- dessus, ce qui rend impossible une seconde demande en sens inverse.
  -- Remplie par le declencheur ci-dessous.
  pair_low  uuid,
  pair_high uuid
);

/**
 * Range la paire avant ecriture.
 *
 * Un declencheur plutot qu'une colonne generee : les deux conviendraient, mais
 * la colonne generee impose une expression immuable, condition qu'il vaut mieux
 * ne pas avoir a supposer.
 */
create or replace function public.normalise_friend_pair()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.pair_low  := least(new.requester_id, new.addressee_id);
  new.pair_high := greatest(new.requester_id, new.addressee_id);
  return new;
end;
$$;

drop trigger if exists friendships_normalise on public.friendships;
create trigger friendships_normalise
  before insert or update of requester_id, addressee_id on public.friendships
  for each row execute function public.normalise_friend_pair();

-- Rattrape les lignes deja presentes si la migration est rejouee apres coup.
update public.friendships
   set pair_low  = least(requester_id, addressee_id),
       pair_high = greatest(requester_id, addressee_id)
 where pair_low is null or pair_high is null;

create unique index if not exists friendships_pair_idx
  on public.friendships (pair_low, pair_high);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

-- ----------------------------------------------------------------------------
-- Lecture
-- ----------------------------------------------------------------------------

alter table public.friendships enable row level security;

-- On ne voit que les relations qui nous concernent.
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (
    requester_id = (select auth.uid())
    or addressee_id = (select auth.uid())
  );

-- Aucune politique d'ecriture : tout passe par les fonctions ci-dessous, qui
-- verifient le sens de la relation et les blocages.

/** Vrai si les deux personnes sont amies. */
create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'accepted'
       and pair_low = least(p_a, p_b)
       and pair_high = greatest(p_a, p_b)
  )
$$;

/** Vrai si l'un des deux a bloque l'autre. */
create or replace function public.is_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
     where status = 'blocked'
       and pair_low = least(p_a, p_b)
       and pair_high = greatest(p_a, p_b)
  )
$$;

-- ----------------------------------------------------------------------------
-- Demander
-- ----------------------------------------------------------------------------

/**
 * Envoie une demande a partir d'un pseudo.
 *
 * Le pseudo plutot que l'identifiant : c'est ce qu'on se communique de vive
 * voix, et cela evite d'exposer un annuaire d'identifiants.
 *
 * Si la personne nous a deja demande en ami, la demande est acceptee au lieu
 * d'echouer sur le doublon — c'est ce que l'on veut dans les deux cas.
 */
create or replace function public.send_friend_request(p_username text)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := (select auth.uid());
  target   public.profiles;
  existing public.friendships;
  created  public.friendships;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select * into target
    from public.profiles
   where username = lower(trim(p_username));

  if not found then
    raise exception 'Aucun compte ne porte ce pseudo.' using errcode = 'P0002';
  end if;

  if target.id = me then
    raise exception 'Vous ne pouvez pas vous ajouter vous-meme.' using errcode = '22023';
  end if;

  if public.recent_count('friendships', 'requester_id', interval '1 hour') >= 20 then
    raise exception 'Trop de demandes envoyees recemment. Reessayez plus tard.'
      using errcode = '53400';
  end if;

  select * into existing
    from public.friendships
   where pair_low = least(me, target.id)
     and pair_high = greatest(me, target.id);

  if found then
    if existing.status = 'accepted' then
      raise exception 'Vous etes deja amis.' using errcode = '23505';
    end if;
    if existing.status = 'blocked' then
      raise exception 'Cette demande ne peut pas aboutir.' using errcode = '42501';
    end if;

    -- Demande croisee : les deux se sont ajoutes, on conclut directement.
    if existing.addressee_id = me then
      update public.friendships
         set status = 'accepted', responded_at = now()
       where id = existing.id
      returning * into created;
      return created;
    end if;

    raise exception 'Demande deja envoyee.' using errcode = '23505';
  end if;

  insert into public.friendships (requester_id, addressee_id)
  values (me, target.id)
  returning * into created;

  return created;
end;
$$;

/** Accepte ou refuse une demande recue. */
create or replace function public.respond_friend_request(
  p_id     uuid,
  p_accept boolean
)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  target  public.friendships;
  updated public.friendships;
begin
  select * into target from public.friendships where id = p_id;

  if not found or target.addressee_id <> me or target.status <> 'pending' then
    raise exception 'Cette demande n''est plus disponible.' using errcode = 'P0002';
  end if;

  if not p_accept then
    delete from public.friendships where id = p_id;
    return target;
  end if;

  update public.friendships
     set status = 'accepted', responded_at = now()
   where id = p_id
  returning * into updated;

  return updated;
end;
$$;

/** Retire un ami, ou annule une demande envoyee. */
create or replace function public.remove_friend(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  delete from public.friendships
   where pair_low = least(me, p_user_id)
     and pair_high = greatest(me, p_user_id)
     and status <> 'blocked';
end;
$$;

/**
 * Bloque quelqu'un.
 *
 * Le blocage remplace toute relation existante et retient qui l'a pose : sans
 * cette information, la personne bloquee pourrait lever le blocage elle-meme.
 */
create or replace function public.block_user(p_user_id uuid)
returns public.friendships
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := (select auth.uid());
  created public.friendships;
begin
  if me is null or p_user_id = me then
    raise exception 'Action impossible.' using errcode = '22023';
  end if;

  delete from public.friendships
   where pair_low = least(me, p_user_id)
     and pair_high = greatest(me, p_user_id);

  insert into public.friendships (requester_id, addressee_id, status, responded_at)
  values (me, p_user_id, 'blocked', now())
  returning * into created;

  return created;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  -- Seul l'auteur du blocage peut le lever.
  delete from public.friendships
   where status = 'blocked'
     and requester_id = me
     and addressee_id = p_user_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Ecrire a un ami
--
-- On pouvait deja ecrire aux membres d'un espace commun. L'amitie devient une
-- seconde porte : sans cela, ajouter quelqu'un en ami ne servirait a rien.
-- ----------------------------------------------------------------------------

create or replace function public.open_dm(p_other_user_id uuid)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  me       uuid := (select auth.uid());
  existing uuid;
  created  public.channels;
  other    public.profiles;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_other_user_id = me then
    raise exception 'On ne peut pas ouvrir une conversation avec soi-meme'
      using errcode = '22023';
  end if;

  select * into other from public.profiles where id = p_other_user_id;
  if not found then
    raise exception 'Cette personne n''existe pas' using errcode = 'P0002';
  end if;

  if public.is_blocked_between(me, p_other_user_id) then
    raise exception 'Cette conversation ne peut pas etre ouverte.' using errcode = '42501';
  end if;

  if not public.shares_space_with(p_other_user_id)
     and not public.are_friends(me, p_other_user_id) then
    raise exception 'Ajoutez cette personne en ami, ou rejoignez un espace commun.'
      using errcode = '42501';
  end if;

  select c.id into existing
    from public.channels c
    join public.dm_participants a on a.channel_id = c.id and a.user_id = me
    join public.dm_participants b on b.channel_id = c.id and b.user_id = p_other_user_id
   where c.kind = 'dm'
     and (select count(*) from public.dm_participants d where d.channel_id = c.id) = 2
   limit 1;

  if existing is not null then
    update public.dm_participants
       set hidden = false
     where channel_id = existing and user_id = me;

    select * into created from public.channels where id = existing;
    return created;
  end if;

  insert into public.channels (space_id, kind, name, position)
  values (null, 'dm', other.username, 0)
  returning * into created;

  insert into public.dm_participants (channel_id, user_id)
  values (created.id, me), (created.id, p_other_user_id);

  return created;
end;
$$;

-- ----------------------------------------------------------------------------
-- Charge utile
-- ----------------------------------------------------------------------------

/**
 * Amis, demandes en cours et personnes bloquees, avec leur profil.
 *
 * Une seule fonction plutot que trois requetes : la page des amis affiche les
 * trois listes en meme temps, et les profils sont communs aux trois.
 */
create or replace function public.friends_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  mine as (
    select f.*,
           case when f.requester_id = (select id from me)
                then f.addressee_id else f.requester_id end as other_id,
           f.requester_id = (select id from me) as outgoing
      from public.friendships f
     where f.requester_id = (select id from me)
        or f.addressee_id = (select id from me)
  )
  select jsonb_build_object(
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id,
                                          'since', m.responded_at))
        from mine m where m.status = 'accepted'
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id,
                                          'created_at', m.created_at))
        from mine m where m.status = 'pending' and not m.outgoing
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id,
                                          'created_at', m.created_at))
        from mine m where m.status = 'pending' and m.outgoing
    ), '[]'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'user_id', m.other_id))
        from mine m
       where m.status = 'blocked' and m.requester_id = (select id from me)
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p))
        from public.profiles p
       where p.id in (select other_id from mine)
    ), '[]'::jsonb)
  );
$$;

-- ----------------------------------------------------------------------------
-- Un ami est visible, meme sans espace commun
-- ----------------------------------------------------------------------------

create or replace function public.shares_space_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.space_members mine
      join public.space_members theirs on theirs.space_id = mine.space_id
     where mine.user_id = (select auth.uid())
       and theirs.user_id = p_user_id
  )
  -- Sans cette seconde condition, la politique de lecture des profils
  -- masquerait un ami tant qu'aucun espace n'est partage : son nom
  -- n'apparaitrait nulle part, pas meme dans la liste d'amis.
  or public.are_friends((select auth.uid()), p_user_id)
$$;

-- ----------------------------------------------------------------------------
-- Temps reel
-- ----------------------------------------------------------------------------

-- Sans cela, un evenement de suppression ne transporte que la cle primaire :
-- RLS ne peut pas evaluer la politique, et le client ne recoit rien.
alter table public.friendships replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'friendships'
  ) then
    alter publication supabase_realtime add table public.friendships;
  end if;
end;
$$;



-- ==========================================================================
-- 20260827130001_channel_deletion.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — suppression et renommage d'un salon
--
-- On pouvait creer un salon, jamais s'en debarrasser : un essai malheureux
-- restait dans la liste pour toujours.
--
-- La suppression emporte les messages par cascade. Elle est donc reservee aux
-- administrateurs, et refusee sur le dernier salon textuel d'un espace : sans
-- cette garde, on peut se retrouver dans un espace ou l'on ne peut plus rien
-- ecrire ni rien recreer depuis l'interface.
-- ============================================================================

/**
 * Supprime un salon.
 *
 * Renvoie l'espace concerne : l'appelant doit savoir vers ou se replier, et le
 * lui faire deviner reviendrait a le laisser sur un salon qui n'existe plus.
 */
create or replace function public.delete_channel(p_channel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  chan       public.channels;
  text_left  int;
begin
  select * into chan from public.channels where id = p_channel_id;

  if not found then
    raise exception 'Salon introuvable.' using errcode = 'P0002';
  end if;

  -- Une conversation privee n'appartient a aucun espace : elle se masque, elle
  -- ne se supprime pas. Les autres participants y perdraient leur historique.
  if chan.space_id is null then
    raise exception 'Une conversation privee ne se supprime pas ; masquez-la.'
      using errcode = '42501';
  end if;

  -- Rang administrateur : la suppression emporte tous les messages, ce qui est
  -- irreversible et depasse ce qu'on confie a un moderateur.
  if public.my_rank(chan.space_id) < 2 then
    raise exception 'Seuls les administrateurs peuvent supprimer un salon.'
      using errcode = '42501';
  end if;

  if chan.kind = 'text' then
    select count(*) into text_left
      from public.channels
     where space_id = chan.space_id and kind = 'text' and id <> p_channel_id;

    if text_left = 0 then
      raise exception 'Gardez au moins un salon textuel dans cet espace.'
        using errcode = '23514';
    end if;
  end if;

  delete from public.channels where id = p_channel_id;

  perform public.log_moderation(
    chan.space_id, null, 'channel_delete', null,
    jsonb_build_object('name', chan.name, 'kind', chan.kind)
  );

  return chan.space_id;
end;
$$;

/**
 * Renomme un salon, et met a jour son sujet.
 *
 * Pouvoir supprimer sans pouvoir corriger un nom pousserait a supprimer pour
 * une faute de frappe, en emportant les messages avec.
 */
create or replace function public.rename_channel(
  p_channel_id uuid,
  p_name       text,
  p_topic      text default null
)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  chan    public.channels;
  wanted  text;
  updated public.channels;
begin
  select * into chan from public.channels where id = p_channel_id;

  if not found then
    raise exception 'Salon introuvable.' using errcode = 'P0002';
  end if;
  if chan.space_id is null then
    raise exception 'Une conversation privee ne se renomme pas ici.' using errcode = '42501';
  end if;
  if not public.can_moderate_space(chan.space_id) then
    raise exception 'Action reservee a l''equipe de moderation.' using errcode = '42501';
  end if;

  wanted := trim(p_name);
  if char_length(wanted) < 1 or char_length(wanted) > 48 then
    raise exception 'Le nom doit faire entre 1 et 48 caracteres.' using errcode = '22023';
  end if;

  update public.channels
     set name  = wanted,
         topic = coalesce(nullif(trim(coalesce(p_topic, '')), ''), topic)
   where id = p_channel_id
  returning * into updated;

  return updated;
end;
$$;

-- Sans identite de replication complete, un evenement de suppression ne
-- transporte que la cle primaire : la politique RLS ne peut pas etre evaluee,
-- et le salon resterait affiche chez les autres membres jusqu'au rechargement.
alter table public.channels replica identity full;



-- ==========================================================================
-- 20260827140001_quota_espaces.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — assouplissement du quota d'espaces, et attente annoncee
--
-- Cinq espaces par heure etait trop serre. Quelqu'un qui decouvre
-- l'application en cree volontiers plusieurs d'affilee — un pour essayer, un
-- pour de vrai, un pour un projet — et se heurtait a un refus au bout de
-- quelques minutes. Le quota existe pour empecher un script d'en creer mille,
-- pas pour rationner l'exploration.
--
-- Le message annonce desormais le temps d'attente reel : « reessayez dans une
-- heure » etait faux des que la premiere creation datait de cinquante minutes.
-- ============================================================================

create or replace function public.create_space(
  p_name        text,
  p_description text default null
)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me         uuid := (select auth.uid());
  base_slug  text;
  candidate  text;
  suffix     int := 0;
  created    public.spaces;
  plus_ancien timestamptz;
  restant    interval;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'Le nom de l''espace est obligatoire' using errcode = '22023';
  end if;

  if public.recent_count('spaces', 'owner_id', interval '1 hour') >= 20 then
    -- Le delai reel plutot qu'une phrase toute faite : c'est la seule chose
    -- que la personne peut faire de cette information.
    select min(created_at) into plus_ancien
      from public.spaces
     where owner_id = me and created_at > now() - interval '1 hour';

    restant := (plus_ancien + interval '1 hour') - now();

    raise exception 'Trop d''espaces crees recemment. Reessayez dans % minutes.',
      greatest(1, ceil(extract(epoch from restant) / 60))::int
      using errcode = '53400';
  end if;

  base_slug := public.slugify(p_name);
  candidate := base_slug;
  while exists (select 1 from public.spaces where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  insert into public.spaces (name, slug, description, owner_id, accent)
  values (
    trim(p_name),
    candidate,
    nullif(trim(coalesce(p_description, '')), ''),
    me,
    public.accent_for(gen_random_uuid())
  )
  returning * into created;

  insert into public.space_members (space_id, user_id, role)
  values (created.id, me, 'owner');

  insert into public.channels (space_id, name, kind, topic, position)
  values
    (created.id, 'general', 'text', 'Le salon principal.', 0),
    (created.id, 'Salon vocal', 'voice', null, 1);

  return created;
end;
$$;



-- ==========================================================================
-- 20260828100001_profil_espaces_communs.sql
-- ==========================================================================

/*
 * Profil : les espaces en commun, nommes.
 *
 * `profile_stats` renvoyait des compteurs — messages ecrits, fils ouverts,
 * reactions posees. Un nombre de messages ne dit rien d'utile sur quelqu'un,
 * et affiche a cote d'un visage il se lit comme un score. On le retire.
 *
 * Ce qu'on garde, c'est ce qui repond a la seule question qu'on se pose en
 * ouvrant une fiche : « d'ou est-ce que je connais cette personne ? ». La
 * reponse demande les espaces eux-memes, pas leur nombre.
 *
 * SECURITY INVOKER, comme avant : la jointure sur ses propres appartenances
 * fait que l'on ne peut lister que des espaces dont on est deja membre. On
 * n'apprend donc rien de nouveau sur les autres appartenances de la personne.
 */
create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'joined_at', (
      select p.created_at from public.profiles p where p.id = p_user_id
    ),

    'mutual_spaces', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'name', s.name, 'icon_url', s.icon_url)
               order by s.name
             )
        from public.space_members theirs
        join public.space_members mine
          on mine.space_id = theirs.space_id
         and mine.user_id = (select auth.uid())
        join public.spaces s on s.id = theirs.space_id
       where theirs.user_id = p_user_id
         -- Sa propre fiche listerait tous ses espaces : sans interet, et cela
         -- ferait defiler la carte pour rien.
         and p_user_id <> (select auth.uid())
    ), '[]'::jsonb),

    -- Rangs detenus dans les espaces communs, pour afficher des distinctions.
    'roles', coalesce((
      select jsonb_agg(distinct sm.role)
        from public.space_members sm
        join public.space_members mine
          on mine.space_id = sm.space_id
         and mine.user_id = (select auth.uid())
       where sm.user_id = p_user_id
         and sm.role <> 'member'
    ), '[]'::jsonb)
  );
$$;



-- ==========================================================================
-- 20260828140001_profil_amis_communs.sql
-- ==========================================================================

/*
 * Profil : les amis en commun.
 *
 * La fiche repondait a « d'ou est-ce que je connais cette personne ? » par les
 * espaces partages. L'autre moitie de la reponse, c'est qui l'on connait tous
 * les deux — souvent plus parlant qu'un nom de serveur.
 *
 * SECURITY INVOKER : la jointure passe par ses propres amities acceptees, donc
 * on ne peut voir que des personnes que l'on connait deja. On n'apprend rien
 * du carnet d'adresses de l'autre au-dela de l'intersection avec le sien.
 */
create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with moi as (select (select auth.uid()) as id),

  -- Amis acceptes de quelqu'un, dans un sens comme dans l'autre : la table
  -- range la paire mais ne dit pas qui a demande.
  amis as (
    select f.requester_id as a, f.addressee_id as b
      from public.friendships f
     where f.status = 'accepted'
  ),

  mes_amis as (
    select case when a.a = (select id from moi) then a.b else a.a end as ami
      from amis a
     where (select id from moi) in (a.a, a.b)
  ),

  ses_amis as (
    select case when a.a = p_user_id then a.b else a.a end as ami
      from amis a
     where p_user_id in (a.a, a.b)
  )

  select jsonb_build_object(
    'joined_at', (
      select p.created_at from public.profiles p where p.id = p_user_id
    ),

    'mutual_spaces', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'name', s.name, 'icon_url', s.icon_url)
               order by s.name
             )
        from public.space_members theirs
        join public.space_members mine
          on mine.space_id = theirs.space_id
         and mine.user_id = (select id from moi)
        join public.spaces s on s.id = theirs.space_id
       where theirs.user_id = p_user_id
         -- Sa propre fiche listerait tous ses espaces : sans interet, et cela
         -- ferait defiler la carte pour rien.
         and p_user_id <> (select id from moi)
    ), '[]'::jsonb),

    'mutual_friends', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'username', p.username,
                 'display_name', p.display_name,
                 'avatar_url', p.avatar_url
               )
               order by p.display_name
             )
        from mes_amis m
        join ses_amis t on t.ami = m.ami
        join public.profiles p on p.id = m.ami
       where p_user_id <> (select id from moi)
    ), '[]'::jsonb),

    -- Rangs detenus dans les espaces communs, pour afficher des distinctions.
    'roles', coalesce((
      select jsonb_agg(distinct sm.role)
        from public.space_members sm
        join public.space_members mine
          on mine.space_id = sm.space_id
         and mine.user_id = (select id from moi)
       where sm.user_id = p_user_id
         and sm.role <> 'member'
    ), '[]'::jsonb)
  );
$$;



-- ==========================================================================
-- 20260830120001_roles.sql
-- ==========================================================================

/*
 * Roles d'espace, avec couleurs et permissions.
 *
 * Le premier jet gardait tout dans le navigateur. Un role n'a de sens que
 * partage : celui qui l'attribue et celui qui le porte ne sont pas sur la meme
 * machine, et une permission qui ne vaut que chez soi n'en est pas une.
 *
 * Le rang historique — `space_members.role`, parmi owner, admin, moderator,
 * member — reste en place et continue de porter les politiques RLS existantes.
 * Ces roles-ci s'ajoutent par-dessus : ils decrivent finement ce que chacun
 * peut faire, sans qu'il faille reecrire toute la securite d'un coup.
 */

create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid not null references public.spaces(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  /* Couleur d'affichage, en notation hexadecimale. */
  color       text not null default '#99aab5'
                check (color ~ '^#[0-9a-fA-F]{6}$'),
  /*
   * Rang dans la liste. Le plus grand l'emporte quand deux roles se
   * contredisent, et c'est lui qui donne la couleur affichee.
   */
  position    integer not null default 0,
  /* Identifiants de permissions, tels que l'interface les connait. */
  permissions text[] not null default '{}',
  /* Afficher les porteurs a part dans la liste des membres. */
  hoist       boolean not null default false,
  created_at  timestamptz not null default now(),

  unique (space_id, name)
);

create index if not exists roles_space_idx on public.roles (space_id, position desc);

create table if not exists public.member_roles (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  role_id  uuid not null references public.roles(id) on delete cascade,

  primary key (space_id, user_id, role_id)
);

create index if not exists member_roles_lookup_idx
  on public.member_roles (space_id, user_id);

alter table public.roles        enable row level security;
alter table public.member_roles enable row level security;

/* --------------------------------------------------------------------------
   Lecture : tout membre de l'espace
   --------------------------------------------------------------------------
   Les roles ne sont pas un secret. Il faut les lire pour colorer un nom dans
   la liste des membres, et pour savoir a quoi l'on a droit soi-meme.
   -------------------------------------------------------------------------- */

drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (
    exists (
      select 1 from public.space_members m
       where m.space_id = roles.space_id
         and m.user_id = (select auth.uid())
    )
  );

drop policy if exists member_roles_select on public.member_roles;
create policy member_roles_select on public.member_roles
  for select to authenticated
  using (
    exists (
      select 1 from public.space_members m
       where m.space_id = member_roles.space_id
         and m.user_id = (select auth.uid())
    )
  );

/* --------------------------------------------------------------------------
   Ecriture : l'administration de l'espace
   --------------------------------------------------------------------------
   `can_manage_space` existe deja et sert aux salons comme a la moderation :
   on s'appuie dessus plutot que de redire la meme condition autrement, ce qui
   finirait par diverger.
   -------------------------------------------------------------------------- */

drop policy if exists roles_write on public.roles;
create policy roles_write on public.roles
  for all to authenticated
  using (public.can_manage_space(space_id))
  with check (public.can_manage_space(space_id));

drop policy if exists member_roles_write on public.member_roles;
create policy member_roles_write on public.member_roles
  for all to authenticated
  using (public.can_manage_space(space_id))
  with check (
    public.can_manage_space(space_id)
    /* Le role attribue doit appartenir a l'espace : sans cette verification,
       on pourrait coller a quelqu'un un role venu d'ailleurs. */
    and exists (
      select 1 from public.roles r
       where r.id = member_roles.role_id
         and r.space_id = member_roles.space_id
    )
    /* Et la personne doit etre membre. */
    and exists (
      select 1 from public.space_members m
       where m.space_id = member_roles.space_id
         and m.user_id = member_roles.user_id
    )
  );

/* --------------------------------------------------------------------------
   Diffusion en temps reel
   -------------------------------------------------------------------------- */

do $$
declare
  target text;
begin
  foreach target in array array['roles', 'member_roles'] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;

alter table public.roles        replica identity full;
alter table public.member_roles replica identity full;

/*
 * Vrai si la personne detient la permission demandee dans cet espace.
 *
 * Trois chemins mènent au oui, du plus fort au plus faible : etre proprietaire
 * de l'espace, porter un role marque « administrator », ou porter un role qui
 * nomme explicitement la permission. Le proprietaire passe avant tout, sans
 * quoi il pourrait se retirer lui-meme l'acces a son propre espace et n'aurait
 * plus aucun moyen d'y revenir.
 */
create or replace function public.has_space_permission(
  p_space_id uuid,
  p_permission text,
  p_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.space_members m
       where m.space_id = p_space_id
         and m.user_id = coalesce(p_user_id, (select auth.uid()))
         and m.role = 'owner'
    )
    or exists (
      select 1
        from public.member_roles mr
        join public.roles r on r.id = mr.role_id
       where mr.space_id = p_space_id
         and mr.user_id = coalesce(p_user_id, (select auth.uid()))
         and ('administrator' = any (r.permissions) or p_permission = any (r.permissions))
    );
$$;

comment on function public.has_space_permission is
  'Permission effective dans un espace : proprietaire, role administrateur, ou role la nommant.';



-- ==========================================================================
-- 20260830140001_banniere_espace.sql
-- ==========================================================================

/*
 * Banniere d'espace.
 *
 * L'icone existait deja — la pastille du rail — mais rien ne donnait son
 * caractere a un espace une fois entre dedans. La banniere coiffe la liste des
 * salons, la ou l'on passe ses journees.
 *
 * Aucune politique nouvelle : la colonne suit celles de `spaces`, ou la lecture
 * est ouverte aux membres et l'ecriture reservee a l'administration.
 */
alter table public.spaces
  add column if not exists banner_url text;

comment on column public.spaces.banner_url is
  'Image large affichee en tete de la liste des salons. Nulle par defaut.';



-- ==========================================================================
-- 20260831120001_durcissement_appartenances.sql
-- ==========================================================================

-- ============================================================================
-- Orbit — durcissement des appartenances
--
-- Corrige deux elevations de privileges ouvertes par une seule politique, puis
-- resserre trois points mineurs.
--
-- L'origine du probleme est `members_update`, posee dans
-- `20260826120002_security.sql` :
--
--     using       (can_manage_space(space_id) or user_id = auth.uid())
--     with check  (can_manage_space(space_id) or user_id = auth.uid())
--
-- L'intention etait « chacun peut changer son propre surnom ». Mais une
-- politique RLS choisit des LIGNES, pas des COLONNES : autoriser quelqu'un a
-- modifier sa ligne l'autorise a en modifier toutes les colonnes, y compris
-- `role`, `space_id` et `user_id`.
--
-- Deux consequences, toutes deux exploitables depuis le client avec la seule
-- cle publique :
--
--   1. Se nommer proprietaire de son propre espace :
--        update space_members set role = 'owner' where user_id = auth.uid();
--      La contrainte de table accepte 'owner', la politique accepte la ligne.
--      Toute la hierarchie de `set_member_role` est contournee.
--
--   2. Bien pire — deplacer sa ligne vers un AUTRE espace :
--        update space_members set space_id = '<espace vise>'
--         where space_id = '<mon espace>' and user_id = auth.uid();
--      Le `with check` ne regarde que `user_id`, qui n'a pas bouge : il passe.
--      Comme chacun est deja 'owner' de l'espace cree a son inscription, il
--      suffit de connaitre l'identifiant d'un espace pour en devenir
--      proprietaire, lire tout son historique et en exclure le vrai
--      proprietaire. Ni code d'invitation, ni bannissement ne s'y opposent :
--      `join_space` est simplement court-circuite.
--
-- On ne peut pas corriger cela dans la politique elle-meme : une politique RLS
-- ne compare pas l'ancienne ligne a la nouvelle. `USING` juge l'ancienne,
-- `WITH CHECK` la nouvelle, jamais les deux ensemble. Il faut un declencheur.
--
-- Le declencheur ci-dessous rejoue les invariants que `set_member_role`
-- applique deja, ce qui a deux vertus : le chemin legitime continue de passer,
-- et la regle tient meme si quelqu'un affaiblit un jour cette fonction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Appartenances : le rang et l'identite de la ligne deviennent intouchables
--    hors du chemin prevu
-- ----------------------------------------------------------------------------

create or replace function public.space_members_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Une appartenance ne se deplace jamais : ni vers un autre espace, ni vers
  -- quelqu'un d'autre. C'est la faille la plus grave des deux, et c'est aussi
  -- la plus simple a fermer — ces deux colonnes forment la cle primaire, elles
  -- n'ont aucune raison de bouger. Pour changer d'espace on en rejoint un ;
  -- pour changer de personne on cree une autre ligne.
  if new.space_id is distinct from old.space_id
     or new.user_id is distinct from old.user_id then
    raise exception
      'Une appartenance ne peut changer ni d''espace ni de personne'
      using errcode = '42501';
  end if;

  -- Le rang ne bouge que sous les memes conditions que `set_member_role` :
  --   - l'auteur du geste appartient a l'equipe de moderation,
  --   - il ne se l'applique pas a lui-meme,
  --   - il surclasse strictement la personne visee,
  --   - et le rang attribue reste strictement sous le sien.
  --
  -- `assert_outranks` porte les trois premieres. Elle refuse notamment que la
  -- cible soit l'appelant, ce qui suffit a fermer l'auto-promotion, y compris
  -- pour un moderateur qui voudrait se hisser plus haut.
  if new.role is distinct from old.role then
    perform public.assert_outranks(old.space_id, old.user_id);

    if public.role_rank(new.role) >= public.my_rank(old.space_id) then
      raise exception
        'Vous ne pouvez pas attribuer un rang egal ou superieur au votre'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.space_members_garde is
  'Interdit le deplacement d''une appartenance et l''auto-promotion : une politique RLS ne sait pas comparer l''ancienne ligne a la nouvelle.';

drop trigger if exists space_members_garde on public.space_members;
create trigger space_members_garde
  before update on public.space_members
  for each row
  execute function public.space_members_garde();

-- Note pour plus tard : une eventuelle fonction de transmission de propriete
-- devra etre ajoutee ici, sans quoi ce declencheur la bloquera. C'est voulu —
-- mieux vaut un refus visible qu'une porte laissee entrouverte.

-- ----------------------------------------------------------------------------
-- 2. Avatars : une mise a jour ne doit pas pouvoir deplacer le fichier
--
-- `avatars_update_own` portait un `USING` sans `WITH CHECK`. L'ancienne ligne
-- etait donc verifiee, la nouvelle pas du tout : rien n'empechait de renommer
-- son propre objet vers `{autre_identifiant}/avatar.png` et d'ecraser — ou de
-- prendre — l'emplacement de quelqu'un d'autre. Le compartiment etant public
-- en lecture, l'image usurpee s'affichait ensuite partout.
-- ----------------------------------------------------------------------------

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ----------------------------------------------------------------------------
-- 3. Adresses d'images de profil : forme et longueur
--
-- `avatar_url` et `banner_url` sont deux colonnes `text` libres, que chacun
-- ecrit sur sa propre ligne et que tout le monde affiche. Rien n'y imposait ni
-- schema ni longueur : on pouvait y loger un `data:` de plusieurs mega-octets,
-- retelecharge par chaque personne ouvrant la fiche.
--
-- La contrainte n'empeche pas de pointer vers un hote tiers — c'est la
-- politique de securite de contenu de l'application qui s'en charge, et
-- `SECURITE.md` explique pourquoi elle est le vrai rempart ici. Elle ecarte
-- seulement ce qui n'a aucune raison d'etre la.
--
-- Ajoutee NOT VALID a dessein : la contrainte s'applique aux ecritures futures
-- sans rejouer tout l'existant, ce qui evite qu'une migration echoue sur une
-- ligne heritee. A valider quand vous aurez verifie les donnees en place :
--   alter table public.profiles validate constraint profiles_images_forme;
-- ----------------------------------------------------------------------------

alter table public.profiles
  drop constraint if exists profiles_images_forme;

alter table public.profiles
  add constraint profiles_images_forme check (
    (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 512))
    and
    (banner_url is null or (banner_url ~ '^https://' and char_length(banner_url) <= 512))
  ) not valid;

-- ----------------------------------------------------------------------------
-- 4. Codes d'invitation : une date d'expiration facultative
--
-- Un code reste valable indefiniment tant que personne ne le fait tourner.
-- La colonne ci-dessous permet de lui donner un terme. Elle vaut NULL par
-- defaut, ce qui conserve exactement le comportement actuel : rien ne change
-- pour les espaces existants tant que personne ne pose de date.
-- ----------------------------------------------------------------------------

alter table public.spaces
  add column if not exists invite_expires_at timestamptz;

comment on column public.spaces.invite_expires_at is
  'Terme du code d''invitation. NULL = sans expiration.';

-- `join_space` est reprise telle qu'elle existe apres la migration de
-- moderation — verification du bannissement comprise — augmentee du seul
-- controle de la date. Le message d'erreur reste volontairement le meme qu'un
-- code inconnu : distinguer les deux cas apprendrait a un inconnu qu'un code
-- a existe.
create or replace function public.join_space(p_invite_code text)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  target public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select * into target
    from public.spaces
   where invite_code = lower(trim(p_invite_code));

  if not found then
    raise exception 'Ce code d''invitation ne correspond a aucun espace'
      using errcode = 'P0002';
  end if;

  if target.invite_expires_at is not null
     and target.invite_expires_at <= now() then
    raise exception 'Ce code d''invitation ne correspond a aucun espace'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.space_bans b
     where b.space_id = target.id
       and b.user_id = me
       and (b.expires_at is null or b.expires_at > now())
  ) then
    raise exception 'Vous ne pouvez pas rejoindre cet espace' using errcode = '42501';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. `has_space_permission` : ne renseigner que les membres
--
-- La fonction accepte un identifiant de personne en argument et s'execute en
-- SECURITY DEFINER. Elle n'accorde rien par elle-meme, mais elle repond sur
-- n'importe quel espace, y compris ceux dont l'appelant ne fait pas partie :
-- on pouvait y sonder qui administre quoi ailleurs. Une question sur un espace
-- n'a de sens que posee par quelqu'un qui en est membre.
-- ----------------------------------------------------------------------------

create or replace function public.has_space_permission(
  p_space_id uuid,
  p_permission text,
  p_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_space_member(p_space_id)
    and (
      exists (
        select 1 from public.space_members m
         where m.space_id = p_space_id
           and m.user_id = coalesce(p_user_id, (select auth.uid()))
           and m.role = 'owner'
      )
      or exists (
        select 1
          from public.member_roles mr
          join public.roles r on r.id = mr.role_id
         where mr.space_id = p_space_id
           and mr.user_id = coalesce(p_user_id, (select auth.uid()))
           and ('administrator' = any (r.permissions) or p_permission = any (r.permissions))
      )
    );
$$;

comment on function public.has_space_permission is
  'Permission effective dans un espace : proprietaire, role administrateur, ou role la nommant. Repond false si l''appelant n''est pas membre de l''espace.';



-- ==========================================================================
-- 20260831140001_serveurs_ice.sql
-- ==========================================================================

-- Serveurs ICE, avec identifiants temporaires.
--
-- Pourquoi cette fonction existe
-- ------------------------------
-- Masquer l'adresse IP des participants suppose de faire passer le trafic par
-- un relais TURN. Un relais ouvert a tous serait aussitot detourne : il faut
-- donc des identifiants.
--
-- Les poser dans `VITE_ICE_SERVERS` ne marche pas. Cette variable est lue a la
-- compilation et finit en clair dans le binaire distribue : n'importe qui peut
-- en extraire les chaines et se servir du relais comme d'un proxy gratuit,
-- facture a son proprietaire.
--
-- coturn accepte pour cela un mecanisme d'identifiants a duree de vie, decrit
-- par le brouillon `draft-uberti-behave-turn-rest` et active par l'option
-- `use-auth-secret` :
--
--     nom d'utilisateur = <horodatage d'expiration>:<identifiant libre>
--     mot de passe      = base64( HMAC-SHA1( secret, nom d'utilisateur ) )
--
-- Le secret ne quitte jamais le serveur. Le client recoit un couple valable une
-- heure, inutilisable ensuite. C'est ce que fait la fonction ci-dessous.
--
-- Ce qu'il reste a faire, cote administration
-- -------------------------------------------
-- Rien ici n'invente de relais. Il faut :
--
--   1. Installer coturn quelque part, avec `use-auth-secret` et un
--      `static-auth-secret` que vous choisissez.
--   2. Poser ce meme secret et l'adresse du relais dans la table de
--      configuration creee plus bas, par exemple :
--
--        insert into public.config_reseau (cle, valeur) values
--          ('turn_url',    'turn:relais.exemple.fr:3478'),
--          ('turn_secret', 'le-secret-de-coturn');
--
-- Tant que ces deux lignes n'existent pas, la fonction ne renvoie que des
-- serveurs STUN publics : l'application marche exactement comme avant, sans
-- masquage. C'est voulu — une protection a moitie posee vaut moins que pas de
-- protection du tout, puisqu'on la croit acquise.

-- ---------------------------------------------------------------------------
-- La configuration, lisible du seul serveur
-- ---------------------------------------------------------------------------

create table if not exists public.config_reseau (
  cle    text primary key,
  valeur text not null
);

alter table public.config_reseau enable row level security;

-- Aucune politique : personne n'y accede depuis un client, jamais. Seules les
-- fonctions `security definer` la lisent. Le secret de coturn est exactement le
-- genre de valeur qui ne doit avoir aucun chemin vers le navigateur.
comment on table public.config_reseau is
  'Configuration reseau du serveur. Aucune politique RLS : lisible des seules fonctions security definer.';

-- ---------------------------------------------------------------------------
-- Les identifiants temporaires
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

create or replace function public.ice_servers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me         uuid := (select auth.uid());
  url        text;
  secret     text;
  expiration bigint;
  identifiant text;
  motdepasse  text;
  publics    jsonb := jsonb_build_array(
    jsonb_build_object('urls', 'stun:stun.l.google.com:19302'),
    jsonb_build_object('urls', 'stun:stun1.l.google.com:19302')
  );
begin
  -- Reservee aux personnes connectees : un relais est une ressource qui coute,
  -- et l'anonyme n'a aucune raison d'en obtenir l'acces.
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select valeur into url    from public.config_reseau where cle = 'turn_url';
  select valeur into secret from public.config_reseau where cle = 'turn_secret';

  -- Pas de relais configure : on rend les serveurs de decouverte, et
  -- l'application s'en contente. `reseau.ts` sait que l'absence de `turn:`
  -- signifie « masquage impossible » et le dit a l'utilisateur.
  if url is null or secret is null then
    return publics;
  end if;

  -- Une heure. Assez long pour couvrir une conversation sans renouvellement,
  -- assez court pour qu'un identifiant vole ne serve pas la semaine suivante.
  expiration := extract(epoch from (now() + interval '1 hour'))::bigint;

  -- L'identifiant de la personne est joint au nom d'utilisateur : si un relais
  -- est detourne, ses journaux disent par qui.
  identifiant := expiration || ':' || me::text;

  motdepasse := encode(
    extensions.hmac(identifiant, secret, 'sha1'),
    'base64'
  );

  return jsonb_build_array(
    jsonb_build_object(
      'urls',       url,
      'username',   identifiant,
      'credential', motdepasse
    )
  ) || publics;
end;
$$;

comment on function public.ice_servers is
  'Serveurs ICE du moment. Delivre des identifiants TURN valables une heure, pour que le secret du relais ne soit jamais compile dans le binaire client.';

revoke all on function public.ice_servers() from public;
grant execute on function public.ice_servers() to authenticated;



-- ==========================================================================
-- 20260831160001_conditions_acceptees.sql
-- ==========================================================================

-- Acceptation des conditions d'utilisation.
--
-- Pourquoi en base, et pas dans le navigateur
-- --------------------------------------------
-- Une acceptation rangee dans le stockage local ne prouve rien : elle
-- disparait au premier nettoyage, ne suit pas d'un appareil a l'autre, et
-- surtout, elle est ecrite par la machine de celui qui accepte. Ce qu'on
-- consigne ici, c'est une date et un numero de version, cote serveur, sur la
-- ligne de la personne concernee.
--
-- La version compte autant que la date. Des que les conditions changent sur le
-- fond, on incremente `CONDITIONS_VERSION` cote application : celles et ceux
-- qui n'ont accepte qu'une version anterieure la revoient. Sans ce numero, il
-- faudrait effacer les acceptations pour toutes et tous a chaque virgule
-- corrigee, ou faire semblant qu'une acceptation de l'an dernier vaut pour un
-- texte reecrit depuis.

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     integer;

comment on column public.profiles.terms_accepted_at is
  'Date d''acceptation des conditions. NULL tant que rien n''a ete accepte.';
comment on column public.profiles.terms_version is
  'Version des conditions acceptees. Comparee a celle de l''application : une version plus recente redemande l''acceptation.';

-- ---------------------------------------------------------------------------
-- L'ecriture passe par une fonction, pas par une mise a jour libre
-- ---------------------------------------------------------------------------
--
-- La politique `profiles_update_own` autorise chacun a modifier sa propre
-- ligne, ce qui suffirait techniquement. Mais une acceptation antidatee n'est
-- pas une acceptation : si la date vient du client, elle vaut ce que vaut la
-- montre de celui qui la pose — et rien n'empeche d'ecrire une date d'il y a
-- deux ans, ou une version qu'on n'a jamais vue.
--
-- La fonction pose `now()`, cote serveur, et n'accepte que la version que
-- l'application lui annonce. C'est peu, mais c'est la difference entre une
-- trace et une declaration.

create or replace function public.accepter_conditions(p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  if p_version is null or p_version < 1 then
    raise exception 'Version de conditions invalide' using errcode = '22023';
  end if;

  update public.profiles
     set terms_accepted_at = now(),
         terms_version     = p_version
   where id = me;
end;
$$;

comment on function public.accepter_conditions is
  'Consigne l''acceptation des conditions pour l''appelant. La date vient du serveur : une date fournie par le client ne vaudrait que ce que vaut sa montre.';

revoke all on function public.accepter_conditions(integer) from public;
grant execute on function public.accepter_conditions(integer) to authenticated;



-- ==========================================================================
-- 20260831180001_suggestions.sql
-- ==========================================================================

-- Suggestions et votes.
--
-- Un endroit ou dire ce qui manque, et ou voir ce que les autres ont dit.
-- Sans cela, chaque idee se perd dans le salon ou elle a ete lancee : celui qui
-- la lit deux jours plus tard n'a aucun moyen de savoir si elle a deja ete
-- proposee, ni si quelqu'un d'autre la voulait aussi.
--
-- Le vote est binaire — pour ou contre — et non un compte de « j'aime ». Une
-- idee peut deranger autant qu'elle plait, et une echelle a un seul sens ne
-- dirait que la moitie de ce qu'on veut savoir.

create table if not exists public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,

  -- Assez pour exposer une idee, trop peu pour un cahier des charges : au-dela,
  -- personne ne lit, et la liste devient un tas.
  contenu     text not null check (char_length(trim(contenu)) between 8 and 600),

  created_at  timestamptz not null default now()
);

create index if not exists suggestions_recentes_idx
  on public.suggestions (created_at desc);

create table if not exists public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,

  -- `true` pour, `false` contre. Changer d'avis met a jour la ligne plutot que
  -- d'en ajouter une seconde, la cle primaire s'en chargeant.
  pour          boolean not null,
  created_at    timestamptz not null default now(),

  primary key (suggestion_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Qui peut faire quoi
-- ---------------------------------------------------------------------------

alter table public.suggestions      enable row level security;
alter table public.suggestion_votes enable row level security;

-- Tout le monde lit tout : c'est l'objet meme d'une liste publique de
-- suggestions, et cela evite qu'une idee soit proposee trois fois.
drop policy if exists suggestions_select on public.suggestions;
create policy suggestions_select on public.suggestions
  for select to authenticated using (true);

-- On ne propose que pour soi. `author_id` est verifie ici plutot que laisse au
-- client : sans cela, on pourrait deposer une suggestion au nom d'autrui.
drop policy if exists suggestions_insert on public.suggestions;
create policy suggestions_insert on public.suggestions
  for insert to authenticated
  with check (author_id = (select auth.uid()));

-- Retirer sa propre suggestion, jamais celle d'un autre.
drop policy if exists suggestions_delete on public.suggestions;
create policy suggestions_delete on public.suggestions
  for delete to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists votes_select on public.suggestion_votes;
create policy votes_select on public.suggestion_votes
  for select to authenticated using (true);

drop policy if exists votes_insert on public.suggestion_votes;
create policy votes_insert on public.suggestion_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Changer d'avis. `WITH CHECK` autant que `USING` : sans lui, on pourrait
-- transformer sa propre ligne en celle de quelqu'un d'autre — c'est exactement
-- le defaut trouve sur `space_members`, et il ne coute rien de ne pas le
-- repeter.
drop policy if exists votes_update on public.suggestion_votes;
create policy votes_update on public.suggestion_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists votes_delete on public.suggestion_votes;
create policy votes_delete on public.suggestion_votes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- La liste, comptes compris
-- ---------------------------------------------------------------------------
--
-- Compter cote client demanderait de charger tous les votes de toutes les
-- suggestions pour n'en afficher que deux nombres. La base sait le faire en une
-- passe, et c'est son travail.

create or replace function public.liste_suggestions()
returns table (
  id         uuid,
  author_id  uuid,
  contenu    text,
  created_at timestamptz,
  pour       bigint,
  contre     bigint,
  mon_vote   boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    s.id,
    s.author_id,
    s.contenu,
    s.created_at,
    coalesce(count(*) filter (where v.pour), 0)       as pour,
    coalesce(count(*) filter (where not v.pour), 0)   as contre,
    -- `bool_or` filtre sur la seule ligne qui nous concerne : la cle primaire
    -- garantit au plus un vote par personne et par suggestion, donc l'agregat
    -- rend cette valeur telle quelle, ou NULL si l'on n'a pas vote.
    --
    -- `max()` avait ete employe ici et n'existe pas pour les booleens en
    -- PostgreSQL : la migration echouait a cette ligne.
    bool_or(v.pour) filter (where v.user_id = (select auth.uid())) as mon_vote
  from public.suggestions s
  left join public.suggestion_votes v on v.suggestion_id = s.id
  group by s.id
  -- Les plus soutenues d'abord, puis les plus recentes : une liste
  -- chronologique enterrerait une bonne idee sous une semaine de nouvelles.
  order by (coalesce(count(*) filter (where v.pour), 0)
          - coalesce(count(*) filter (where not v.pour), 0)) desc,
           s.created_at desc
  limit 200;
$$;

comment on function public.liste_suggestions is
  'Suggestions avec leurs comptes de votes et le vote de l''appelant. Triees par soutien, puis par date.';

revoke all on function public.liste_suggestions() from public;
grant execute on function public.liste_suggestions() to authenticated;

-- ---------------------------------------------------------------------------
-- Voter, ou changer d'avis
-- ---------------------------------------------------------------------------

create or replace function public.voter_suggestion(p_suggestion uuid, p_pour boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  -- `p_pour` a `null` retire le vote : c'est le meme geste que recliquer sur
  -- le bouton deja choisi, et cela evite une seconde fonction pour l'annuler.
  if p_pour is null then
    delete from public.suggestion_votes
     where suggestion_id = p_suggestion and user_id = me;
    return;
  end if;

  insert into public.suggestion_votes (suggestion_id, user_id, pour)
  values (p_suggestion, me, p_pour)
  on conflict (suggestion_id, user_id)
  do update set pour = excluded.pour, created_at = now();
end;
$$;

comment on function public.voter_suggestion is
  'Pose, change ou retire le vote de l''appelant. `p_pour` a NULL retire le vote.';

revoke all on function public.voter_suggestion(uuid, boolean) from public;
grant execute on function public.voter_suggestion(uuid, boolean) to authenticated;



-- ==========================================================================
-- 20260901120001_support.sql
-- ==========================================================================

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



-- ==========================================================================
-- 20260901160001_journal.sql
-- ==========================================================================

-- Le journal de l'application.
--
-- Pourquoi une table plutot que la console du navigateur
-- ------------------------------------------------------
-- Un defaut signale par quelqu'un d'autre n'est jamais reproductible sur la
-- machine de celui qui doit le corriger. « Le partage a coupe » n'apprend rien ;
-- « le partage a coupe apres douze secondes, en 1440p, avec deux pairs, sur un
-- peripherique a 44,1 kHz » se corrige. La console du navigateur contient tout
-- cela et n'en sort jamais : elle vit sur la machine ou personne ne la lit.
--
-- Ce qui n'entre jamais ici
-- -------------------------
-- Aucun contenu de message, aucun nom de fichier partage, aucune adresse IP.
-- Le journal sert a comprendre un defaut, pas a savoir ce que les gens se
-- disent — et une table de diagnostic finit toujours par etre lue plus
-- largement que prevu. Ce qu'on n'y met pas ne peut pas fuir.
--
-- `detail` est volontairement du jsonb libre, avec une borne de taille : le
-- format d'un diagnostic change a chaque defaut poursuivi, et une colonne par
-- champ obligerait a une migration pour chaque question nouvelle.
--
-- Qui lit
-- -------
-- Personne, par l'API publique : aucune politique de lecture n'est posee. La
-- console de l'equipe se connecte avec la cle de service, qui contourne RLS par
-- construction, et cette cle ne quitte pas la machine de l'equipe. Un role
-- « lecteur du journal » cote base serait une porte que personne ne surveille.

create table if not exists public.journal (
  id          bigint generated always as identity primary key,
  au          timestamptz not null default now(),

  -- Quatre niveaux, pas davantage. Au-dela, on passe plus de temps a choisir le
  -- niveau qu'a ecrire la ligne, et le filtre cesse de vouloir dire quelque chose.
  niveau      text not null default 'info'
    check (niveau in ('trace', 'info', 'alerte', 'erreur')),

  -- La partie de l'application concernee : `vocal`, `partage`, `reseau`,
  -- `session`, `interface`, `mise-a-jour`… Libre, mais borne : c'est ce qui
  -- permet de suivre un defaut sans connaitre d'avance son nom.
  domaine     text not null check (char_length(domaine) between 2 and 40),

  -- Court par construction. Un journal se lit en diagonale ; ce qui est long va
  -- dans `detail`, ou l'on ne descend que lorsqu'on a trouve la bonne ligne.
  message     text not null check (char_length(message) between 1 and 300),

  -- Borne a huit kilo-octets sous forme texte. Sans borne, une trace d'appel
  -- profonde ou un objet d'erreur circulaire remplirait la table a lui seul.
  detail      jsonb check (detail is null or octet_length(detail::text) <= 8192),

  -- Nul avant la connexion : les defauts d'ouverture de session sont
  -- precisement ceux qu'on ne peut rattacher a personne, et ce sont aussi ceux
  -- qu'on a le plus besoin de voir.
  auteur_id   uuid references public.profiles (id) on delete set null,

  -- Identifiant de l'execution en cours, tire au lancement. C'est lui qui
  -- permet de recoudre les lignes d'une meme seance quand plusieurs personnes
  -- ecrivent en meme temps — l'auteur ne suffit pas, on ouvre deux fenetres.
  seance      text check (seance is null or char_length(seance) between 4 and 40),

  version     text check (version is null or char_length(version) <= 20),

  plateforme  text check (plateforme is null or plateforme in ('bureau', 'web'))
);

-- Le journal se lit toujours du plus recent au plus ancien : c'est l'ordre de
-- toutes les questions qu'on lui pose.
create index if not exists journal_au_idx on public.journal (au desc);

-- Deux filtres suffisent a couvrir l'usage reel : « montre-moi les erreurs » et
-- « montre-moi ce qu'a vecu cette personne ».
create index if not exists journal_niveau_au_idx on public.journal (niveau, au desc);
create index if not exists journal_auteur_au_idx on public.journal (auteur_id, au desc);
create index if not exists journal_domaine_au_idx on public.journal (domaine, au desc);

alter table public.journal enable row level security;

/*
 * On ecrit, on ne lit pas.
 *
 * L'insertion est ouverte aux visiteurs non connectes autant qu'aux membres :
 * un echec d'ouverture de session n'a pas d'auteur, et c'est exactement le
 * moment ou l'on voudrait une ligne. Le prix est un risque d'ecriture abusive,
 * qu'on accepte en connaissance de cause — la table est bornee en taille par
 * ses contraintes, et la console offre une purge.
 *
 * Ce qui n'est PAS accepte, c'est qu'on ecrive au nom d'un autre : `auteur_id`
 * doit etre nul ou le sien. Sans ce test, n'importe qui pourrait fabriquer un
 * journal accablant pour quelqu'un d'autre.
 */
drop policy if exists "journal: ecrire pour soi" on public.journal;
create policy "journal: ecrire pour soi"
  on public.journal for insert
  to anon, authenticated
  with check (auteur_id is null or auteur_id = auth.uid());

-- Aucune politique de lecture, de modification ou de suppression : voir l'en-tete.

/*
 * La console suit le journal en direct.
 *
 * Sans cela, il faudrait reinterroger la table a intervalle regulier pour voir
 * arriver une erreur — et l'interet d'un journal, quand on accompagne quelqu'un
 * au telephone, est precisement de voir la ligne apparaitre pendant qu'il parle.
 */
alter table public.journal replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'journal'
  ) then
    alter publication supabase_realtime add table public.journal;
  end if;
end $$;



-- ==========================================================================
-- 20260901160002_suspension.sql
-- ==========================================================================

-- La suspension d'un compte.
--
-- Ce qui manquait
-- ---------------
-- Un espace pouvait deja bannir quelqu'un de chez lui (`space_bans`), et c'est
-- la bonne granularite pour un desaccord entre membres. Mais rien ne permettait
-- de repondre a ce qui ne concerne pas un espace en particulier : un compte qui
-- fait le tour des espaces publics, un robot, un compte pirate. Il fallait
-- supprimer le compte — c'est-a-dire emporter ses messages et ses amities pour
-- un incident qui dure trois jours.
--
-- Une suspension est donc datee, jamais definitive
-- ------------------------------------------------
-- `suspendu_jusqu_a` porte une echeance, et la levee se fait toute seule. Un
-- drapeau booleen aurait demande qu'on pense a le retirer, ce que personne ne
-- fait : les suspensions « temporaires » deviennent perpetuelles par oubli.
-- Pour une suspension sans terme prevu, on pose une date lointaine — mais on la
-- pose, et elle se relit.
--
-- Ce que la suspension empeche, et ce qu'elle n'empeche pas
-- ---------------------------------------------------------
-- Elle empeche d'ECRIRE : envoyer un message, rejoindre un espace, proposer une
-- suggestion. Elle n'empeche pas de lire, ni de se connecter, ni d'ecrire au
-- support — c'est justement la qu'on conteste une suspension, et couper cette
-- porte-la ne laisserait aucun recours a une decision qui peut etre une erreur.
--
-- Le motif est lu par l'interessé
-- -------------------------------
-- `suspendu_motif` remonte dans l'application, sur la personne concernee. Une
-- sanction dont on ignore la cause ne corrige rien : elle apprend seulement que
-- l'endroit est hostile.

alter table public.profiles
  add column if not exists suspendu_jusqu_a timestamptz,
  add column if not exists suspendu_motif text check (
    suspendu_motif is null or char_length(suspendu_motif) between 4 and 300
  );

/*
 * Le test, ecrit une fois.
 *
 * `security definer` parce qu'il lit `profiles` depuis des politiques qui
 * s'appliquent a d'autres tables : sans cela, la politique de `messages`
 * dependrait de celle de `profiles`, et une personne qui ne peut pas voir un
 * profil verrait sa propre ecriture refusee pour la mauvaise raison.
 *
 * `search_path` vide : sans lui, un schema pose devant `public` par un appelant
 * pourrait detourner la fonction vers une table `profiles` de son choix — la
 * fonction s'executant avec les droits de son proprietaire, ce serait une
 * elevation de privileges.
 */
create or replace function public.est_suspendu(qui uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = qui
       and p.suspendu_jusqu_a is not null
       and p.suspendu_jusqu_a > now()
  );
$$;

revoke all on function public.est_suspendu(uuid) from public;
grant execute on function public.est_suspendu(uuid) to authenticated;

/*
 * Les trois portes d'ecriture.
 *
 * Les politiques sont reecrites en entier plutot que completees : PostgreSQL ne
 * sait pas ajouter une condition a une politique existante, et une politique
 * supplementaire s'ajouterait en OU — elle ELARGIRAIT l'acces au lieu de le
 * restreindre, ce qui est l'inverse exact du but.
 *
 * La condition est donc recopiee telle quelle, avec le test en plus. Toute
 * modification ulterieure de ces politiques doit le reporter ici.
 */

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_channel_member(channel_id)
    and not public.est_suspendu((select auth.uid()))
  );

drop policy if exists suggestions_insert on public.suggestions;
create policy suggestions_insert on public.suggestions
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and not public.est_suspendu((select auth.uid()))
  );

/*
 * Rejoindre un espace passe par `public.join_space`, pas par une
 * politique : la fonction est `security definer` et contourne donc RLS. Le test
 * doit y etre pose a la main, et il l'est ci-dessous — sans quoi une suspension
 * n'empecherait rien de ce qui compte le plus, l'arrivee dans un espace neuf.
 */

create or replace function public.join_space(p_invite_code text)
returns public.spaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := (select auth.uid());
  target public.spaces;
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  -- Le test tient ici et non dans une politique : cette fonction contourne RLS
  -- par construction, puisque `space_members` n'a aucune politique d'insertion.
  if public.est_suspendu(me) then
    raise exception 'Votre compte est suspendu' using errcode = '42501';
  end if;

  select * into target
    from public.spaces
   where invite_code = lower(trim(p_invite_code));

  if not found then
    raise exception 'Ce code d''invitation ne correspond a aucun espace'
      using errcode = 'P0002';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target.id, me, 'member')
  on conflict (space_id, user_id) do nothing;

  return target;
end;
$$;



-- ==========================================================================
-- 20260902020001_presence_badges_liens.sql
-- ==========================================================================

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
--
-- `at time zone 'UTC'` n'est pas une precaution de style : `date_trunc` sur un
-- horodatage AVEC fuseau depend du fuseau de la session, et Postgres refuse
-- d'indexer une expression dont le resultat peut changer d'une connexion a
-- l'autre. Le ramener a UTC le rend fixe, donc indexable — et c'est de toute
-- facon ce qu'on veut : deux personnes dans deux fuseaux ne doivent pas obtenir
-- deux fenetres differentes.
create unique index if not exists signalements_sans_doublon
  on public.signalements (
    auteur_id,
    cible_type,
    cible_id,
    (date_trunc('hour', cree_le at time zone 'UTC'))
  );

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
  insert into public.ia_usage as u (profil_id, jour, appels, jetons)
  values ((select auth.uid()), current_date, 1, greatest(p_jetons, 0))
  on conflict (profil_id, jour) do update
    -- L'alias, et non le nom qualifie : dans la clause de mise a jour d'un
    -- `on conflict`, la table cible se designe par son alias ou son nom nu.
    -- `public.ia_usage.appels` y serait lu comme la colonne « appels » de la
    -- table « ia_usage » du schema « public » pris pour une table, et Postgres
    -- refuse avec « missing FROM-clause entry for table public ».
    set appels = u.appels + 1,
        jetons = u.jetons + greatest(p_jetons, 0);
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



-- ==========================================================================
-- 20260902060001_paliers_badges.sql
-- ==========================================================================

-- Les badges par paliers, et le temps passe en vocal.
--
-- Deux badges uniques devenaient deux series. « A ecrit mille messages » et
-- « a passe dix heures en vocal » se decrochent en une semaine et ne disent
-- plus rien ensuite : ce sont des seuils de depart, pas des recompenses. Une
-- serie garde une marche devant soi pendant des annees.
--
-- Le temps en vocal, lui, n'etait mesure nulle part. Un badge qui recompense
-- une chose qu'on ne compte pas ne peut pas etre attribue.

-- ===========================================================================
-- 1. Le temps passe en salon vocal
-- ===========================================================================
--
-- Un total cumule, en secondes, et rien d'autre. On pourrait garder chaque
-- session — qui, quel salon, de quand a quand — et cela permettrait des
-- statistiques. Mais ce serait un journal de presence : qui etait ou, avec qui,
-- pendant combien de temps, conserve indefiniment. Un total ne dit que « a
-- beaucoup discute », ce qui est tout ce dont un badge a besoin.
--
-- Les secondes plutot que les heures : une session de vingt minutes ne doit pas
-- disparaitre dans un arrondi, et trois cents sessions de vingt minutes font
-- cent heures.

create table if not exists public.temps_vocal (
  profil_id uuid primary key references public.profiles (id) on delete cascade,
  secondes  bigint not null default 0 check (secondes >= 0),
  maj_le    timestamptz not null default now()
);

alter table public.temps_vocal enable row level security;

-- Lisible par tous : les badges qui en decoulent s'affichent sur les profils,
-- et cacher le total tout en montrant le badge n'aurait pas de sens.
drop policy if exists temps_vocal_lecture on public.temps_vocal;
create policy temps_vocal_lecture on public.temps_vocal for select to authenticated
  using (true);

/*
 * Ajoute du temps au total.
 *
 * Le plafond par appel est la seule protection qui compte ici : sans lui, un
 * appel bricole pourrait s'attribuer mille heures d'un coup, et un badge
 * « cinq mille heures » obtenu en une requete ne vaudrait plus rien.
 *
 * Quinze minutes, pour un rapport attendu toutes les cinq : trois fois la
 * marge. Un rapport retarde par une machine en veille passe ; un total invente
 * ne passe pas. Au pire, quelqu'un qui triche gagne quinze minutes par appel,
 * ce qui demande vingt mille appels pour le dernier palier.
 */
create or replace function public.ajouter_temps_vocal(p_secondes integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.temps_vocal as t (profil_id, secondes)
  values ((select auth.uid()), least(greatest(p_secondes, 0), 900))
  on conflict (profil_id) do update
    set secondes = t.secondes + least(greatest(p_secondes, 0), 900),
        maj_le = now();
$$;

grant execute on function public.ajouter_temps_vocal(integer) to authenticated;

-- ===========================================================================
-- 2. Les paliers
-- ===========================================================================
--
-- Les deux badges uniques disparaissent au profit de leurs series. Leurs
-- attributions partent avec eux : personne ne les avait obtenus autrement
-- qu'en passant le premier palier, qui existe toujours sous un autre nom.

delete from public.profil_badges where badge_cle in ('bavard', 'veilleur');
delete from public.badges where cle in ('bavard', 'veilleur');

/*
 * Le temps en vocal, en sept marches.
 *
 * Les intervalles s'ecartent a mesure qu'on monte : dix, cinquante, cent, cent
 * cinquante, trois cents, cinq cents, cinq mille. C'est ce qui garde une marche
 * atteignable au debut et une marche lointaine a la fin — une serie reguliere
 * serait trop lente au depart et trop rapide ensuite.
 *
 * Cinq mille heures, c'est sept mois de conversation continue. Il est possible
 * que personne ne l'obtienne jamais, et c'est tres bien : un dernier palier
 * qu'on atteint n'est plus un dernier palier.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('vocal-10',   'Voix — 10 h',    'A passe dix heures en salon vocal.',                                  'succes', '#9b59b6', null, 40),
  ('vocal-50',   'Voix — 50 h',    'A passe cinquante heures en salon vocal.',                            'succes', '#9b59b6', null, 41),
  ('vocal-100',  'Voix — 100 h',   'A passe cent heures en salon vocal.',                                 'succes', '#8e44ad', null, 42),
  ('vocal-150',  'Voix — 150 h',   'A passe cent cinquante heures en salon vocal.',                       'succes', '#8e44ad', null, 43),
  ('vocal-300',  'Voix — 300 h',   'A passe trois cents heures en salon vocal.',                          'succes', '#7d3c98', null, 44),
  ('vocal-500',  'Voix — 500 h',   'A passe cinq cents heures en salon vocal.',                           'succes', '#6c3483', null, 45),
  ('vocal-5000', 'Voix — 5000 h',  'A passe cinq mille heures en salon vocal. Sept mois de conversation.', 'succes', '#4a235a', null, 46)
on conflict (cle) do nothing;

/*
 * Les messages, en cinq marches.
 *
 * Mille etait un seuil de depart : on le franchit en une semaine, et le badge
 * ne dit plus rien ensuite. La serie commence donc a dix mille, et le dernier
 * palier — un million — est du meme ordre que les cinq mille heures : une borne
 * qu'on regarde plus qu'on ne l'atteint.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('messages-10k',  'Plume — 10 000',    'A ecrit dix mille messages.',                             'succes', '#00a8fc', null, 50),
  ('messages-50k',  'Plume — 50 000',    'A ecrit cinquante mille messages.',                       'succes', '#0091d5', null, 51),
  ('messages-100k', 'Plume — 100 000',   'A ecrit cent mille messages.',                            'succes', '#0079b0', null, 52),
  ('messages-500k', 'Plume — 500 000',   'A ecrit cinq cent mille messages.',                       'succes', '#00618c', null, 53),
  ('messages-1m',   'Plume — 1 million', 'A ecrit un million de messages. Personne n''a fait cela.', 'succes', '#004a68', null, 54)
on conflict (cle) do nothing;

-- ===========================================================================
-- 3. Fondateur, en paliers
-- ===========================================================================
--
-- « Dix membres » etait un seuil de depart, comme les mille messages : on le
-- franchit le premier week-end. La serie va de cent a un million, ce qui couvre
-- toute la vie d'un espace — du groupe d'amis qui a pris a la communaute qu'on
-- ne connait plus en entier.

delete from public.profil_badges where badge_cle = 'fondateur';
delete from public.badges where cle = 'fondateur';

/*
 * Les quatre marches d'un espace.
 *
 * Cent, dix mille, cent mille, un million. L'ecart entre la premiere et la
 * seconde est enorme, et c'est voulu : entre les deux il n'y a pas de palier
 * parce qu'il n'y a pas de difference de nature. Un espace de mille membres et
 * un de cinq mille se ressemblent ; un de cent et un de dix mille n'ont plus
 * rien a voir.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('espace-100',  'Fondateur — 100',    'A cree un espace qui compte au moins cent membres.',                            'succes', '#3ba55d', null, 60),
  ('espace-10k',  'Fondateur — 10 000', 'A cree un espace qui compte au moins dix mille membres.',                       'succes', '#2d8a4a', null, 61),
  ('espace-100k', 'Fondateur — 100 000','A cree un espace qui compte au moins cent mille membres.',                      'succes', '#1f6e38', null, 62),
  ('espace-1m',   'Fondateur — 1 million', 'A cree un espace qui compte au moins un million de membres.',                'succes', '#145227', null, 63)
on conflict (cle) do nothing;



-- ==========================================================================
-- 20260902070001_discord_style_badges_tiers.sql
-- ==========================================================================

﻿-- ===========================================================================
-- Paliers complets des badges style Discord, raretes et effets visuels
-- ===========================================================================

-- 1. Nettoyage et mise a jour des anciens badges pour la nouvelle structure
delete from public.badges where cle in (
  'pionnier', 'premiere-heure', 'equipe', 'rapporteur', 'fondateur',
  'espace-10', 'espace-100', 'espace-10k', 'espace-100k', 'espace-1m',
  'messages-10k', 'messages-50k', 'messages-100k', 'messages-500k', 'messages-1m',
  'vocal-10', 'vocal-50', 'vocal-100', 'vocal-150', 'vocal-300', 'vocal-500', 'vocal-1000', 'vocal-3000', 'vocal-5000',
  'fidele', 'anciennete-1an', 'anciennete-3ans', 'anciennete-5ans', 'anciennete-7ans', 'anciennete-10ans'
);

-- 2. Insertion du catalogue complet avec ordre et teintes evolutives
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  -- Statuts Speciaux & Soutien (Rarete Mythique / Exclusive)
  ('pionnier',        'Pionnier',            'Parmi les cent premiers comptes ouverts sur Echow. Cette course est terminee des que le centieme est arrive.', 'soutien',    '#f59e0b', 100,  1),
  ('premiere-heure',  'Premiere heure',      'Present le jour de l''ouverture. Ne pourra plus jamais etre obtenu.',                                          'soutien',    '#ec4899', null, 2),
  ('equipe',          'Equipe Echow',        'Membre de l''equipe qui construit Echow.',                                                                     'equipe',     '#6366f1', null, 3),
  ('rapporteur',      'Chasseur de bogues',  'A signale un defaut qui a ete corrige.',                                                                       'succes',     '#10b981', null, 4),

  -- Serie Batisseur d'Espace (Paliers Communaute)
  ('espace-10',       'Batisseur — 10',      'A cree un espace qui compte au moins dix membres.',                                                            'succes',     '#22c55e', null, 10),
  ('espace-10k',      'Batisseur — 10 000',  'A cree un espace qui compte au moins dix mille membres.',                                                       'succes',     '#06b6d4', null, 11),
  ('espace-100k',     'Batisseur — 100 000', 'A cree un espace qui compte au moins cent mille membres.',                                                      'succes',     '#8b5cf6', null, 12),
  ('espace-1m',       'Batisseur — 1M',      'A cree un espace qui compte au moins un million de membres. Royaume mythique.',                                 'succes',     '#f43f5e', null, 13),

  -- Serie Messagerie (Paliers Textuels)
  ('messages-10k',    'Plume — 10 000',      'A ecrit dix mille messages.',                                                                                   'succes',     '#38bdf8', null, 20),
  ('messages-50k',    'Plume — 50 000',      'A ecrit cinquante mille messages.',                                                                             'succes',     '#3b82f6', null, 21),
  ('messages-100k',   'Plume — 100 000',     'A ecrit cent mille messages.',                                                                                  'succes',     '#a855f7', null, 22),
  ('messages-500k',   'Plume — 500 000',     'A ecrit cinq cent mille messages.',                                                                             'succes',     '#f97316', null, 23),
  ('messages-1m',     'Plume — 1 million',   'A ecrit un million de messages. Une legende vivante.',                                                          'succes',     '#ec4899', null, 24),

  -- Serie Vocal (Paliers Temps en Salon Vocal)
  ('vocal-10',        'Voix — 10 h',         'A passe dix heures en salon vocal.',                                                                            'succes',     '#c084fc', null, 30),
  ('vocal-50',        'Voix — 50 h',         'A passe cinquante heures en salon vocal.',                                                                      'succes',     '#a855f7', null, 31),
  ('vocal-150',       'Voix — 150 h',        'A passe cent cinquante heures en salon vocal.',                                                                 'succes',     '#7c3aed', null, 32),
  ('vocal-500',       'Voix — 500 h',        'A passe cinq cents heures en salon vocal.',                                                                     'succes',     '#ef4444', null, 33),
  ('vocal-1000',      'Voix — 1 000 h',      'A passe mille heures en salon vocal.',                                                                          'succes',     '#eab308', null, 34),
  ('vocal-3000',      'Voix — 3 000 h',      'A passe trois mille heures en salon vocal.',                                                                    'succes',     '#06b6d4', null, 35),
  ('vocal-5000',      'Voix — 5 000 h',      'A passe cinq mille heures en salon vocal. Aura cosmique supreme.',                                              'succes',     '#d946ef', null, 36),

  -- Serie Anciennete (Paliers Annees)
  ('anciennete-1an',   'Veteran — 1 an',     'Compte ouvert depuis plus d''un an.',                                                                          'anciennete', '#94a3b8', null, 40),
  ('anciennete-3ans',  'Veteran — 3 ans',    'Compte ouvert depuis plus de trois ans.',                                                                      'anciennete', '#f59e0b', null, 41),
  ('anciennete-5ans',  'Veteran — 5 ans',    'Compte ouvert depuis plus de cinq ans.',                                                                      'anciennete', '#3b82f6', null, 42),
  ('anciennete-7ans',  'Veteran — 7 ans',    'Compte ouvert depuis plus de sept ans.',                                                                      'anciennete', '#e11d48', null, 43),
  ('anciennete-10ans', 'Veteran — 10 ans',   'Compte ouvert depuis plus de dix ans. Maitre du temps.',                                                       'anciennete', '#8b5cf6', null, 44)
on conflict (cle) do update set
  nom = excluded.nom,
  description = excluded.description,
  famille = excluded.famille,
  teinte = excluded.teinte,
  limite = excluded.limite,
  rang = excluded.rang;



-- ==========================================================================
-- 20260902080001_paliers_demandes.sql
-- ==========================================================================

-- Les paliers, tels qu'ils ont ete demandes.
--
-- Trois migrations ont touche au catalogue en une heure, et les deux dernieres
-- ne s'accordaient ni entre elles ni avec la demande. Celle-ci tranche, et
-- s'applique en dernier.
--
-- Ce qui change, et pourquoi
-- --------------------------
-- **Les espaces partent de cent membres**, pas de dix. Dix membres, c'est un
-- groupe d'amis qui vient d'ouvrir un salon : le badge serait obtenu le premier
-- week-end et ne dirait plus rien ensuite. Cent est le moment ou l'on ne
-- connait plus tout le monde de vue.
--
-- **Le vocal gagne cent et trois cents heures.** Entre cinquante et cent
-- cinquante il y avait un trou, et entre cent cinquante et cinq cents un
-- gouffre : on restait des mois sans marche devant soi, ce qui est exactement
-- ce qu'une serie doit eviter.
--
-- Les paliers ajoutes par ailleurs — mille et trois mille heures, les cinq
-- annees d'anciennete — sont gardes : ils comblent le haut de la serie, la ou
-- il ne restait rien apres cinq cents heures.
--
-- Le code ne recopie plus ces seuils : il les lit dans la cle. Voir
-- `src/features/badges/paliers.ts`. C'est ce qui empeche la prochaine
-- divergence, et non la vigilance.

-- ===========================================================================
-- 1. Les espaces partent de cent
-- ===========================================================================

delete from public.profil_badges where badge_cle = 'espace-10';
delete from public.badges where cle = 'espace-10';

insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('espace-100', 'Batisseur — 100', 'A cree un espace qui compte au moins cent membres.', 'succes', '#22c55e', null, 10)
on conflict (cle) do update set
  nom = excluded.nom,
  description = excluded.description,
  famille = excluded.famille,
  teinte = excluded.teinte,
  rang = excluded.rang;

-- ===========================================================================
-- 2. Le vocal comble ses trous
-- ===========================================================================

insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('vocal-100', 'Voix — 100 h', 'A passe cent heures en salon vocal.',             'succes', '#b47ef0', null, 315),
  ('vocal-300', 'Voix — 300 h', 'A passe trois cents heures en salon vocal.',      'succes', '#9333ea', null, 325)
on conflict (cle) do update set
  nom = excluded.nom,
  description = excluded.description,
  famille = excluded.famille,
  teinte = excluded.teinte,
  rang = excluded.rang;

/*
 * Les rangs sont reecrits pour que la serie se lise dans l'ordre.
 *
 * Les paliers precedents occupaient 30 a 36 ; y glisser cent et trois cents
 * demandait des rangs intermediaires que des entiers ne permettent pas. On
 * multiplie donc l'echelle par dix — trois cents, trois cent dix, trois cent
 * quinze — ce qui laisse de la place entre chaque marche pour celles qu'on
 * ajoutera ensuite.
 *
 * Sans cela, « 100 h » s'afficherait apres « 5 000 h », et une serie qui ne se
 * lit pas dans l'ordre n'est plus une serie.
 */
update public.badges set rang = 300 where cle = 'vocal-10';
update public.badges set rang = 310 where cle = 'vocal-50';
update public.badges set rang = 320 where cle = 'vocal-150';
update public.badges set rang = 330 where cle = 'vocal-500';
update public.badges set rang = 340 where cle = 'vocal-1000';
update public.badges set rang = 350 where cle = 'vocal-3000';
update public.badges set rang = 360 where cle = 'vocal-5000';

-- ===========================================================================
-- 3. Ce que le code sait attribuer
-- ===========================================================================
--
-- Toute cle de la forme `vocal-<n>`, `messages-<n>[k|m]`, `espace-<n>[k|m]` ou
-- `anciennete-<n>ans` est attribuee automatiquement, sans changer une ligne de
-- TypeScript. Les autres — `pionnier`, `premiere-heure`, `equipe`,
-- `rapporteur` — le sont autrement, ou a la main.
--
-- Une cle qui ne suit aucune de ces formes ne sera jamais donnee. C'est
-- volontaire : mieux vaut un badge qui n'arrive pas qu'un badge donne au
-- mauvais seuil parce qu'on aurait devine.



-- ==========================================================================
-- 20260902090001_pionnier_par_anciennete.sql
-- ==========================================================================

-- « Pionnier » se merite par la date d'inscription, pas par la vitesse.
--
-- Ce fichier existe a part parce que le precedent etait deja applique quand le
-- defaut a ete vu. Une migration appliquee ne se modifie pas : la base ne la
-- rejouerait pas, et le fichier local dirait alors quelque chose que la base ne
-- fait pas — le pire des deux mondes, puisqu'on croirait le probleme regle.

-- ===========================================================================
-- 4. « Pionnier » se merite par la date d'inscription, pas par la vitesse
-- ===========================================================================
--
-- Le badge dit « parmi les cent premiers comptes ouverts sur Echow ». Il etait
-- pourtant attribue dans l'ordre des DEMANDES : le premier a rouvrir
-- l'application prenait la premiere place, quelle que soit la date de son
-- compte.
--
-- Les consequences sont deux, et les deux sont injustes. Le compte numero cent
-- cinquante qui ouvre l'application avant le numero cinq prend sa place. Et le
-- numero trois, absent une semaine, revient pour trouver la course close alors
-- qu'il etait la des le debut.
--
-- Le rang d'inscription est un fait deja ecrit dans la base. On le lit plutot
-- que de le remplacer par un reflexe.

create or replace function public.rang_inscription()
returns integer
language sql
security definer
stable
set search_path = ''
as $$
  select (
    select count(*)::integer + 1
      from public.profiles autres
     where autres.created_at < moi.created_at
  )
    from public.profiles moi
   where moi.id = (select auth.uid());
$$;

grant execute on function public.rang_inscription() to authenticated;

/*
 * Le rang decide, et la place obtenue le reflete.
 *
 * `position` portait le rang de DEMANDE ; elle porte maintenant le rang
 * d'inscription. C'est ce qui donne son sens a « n°7 » affiche sur un profil :
 * septieme a rejoindre Echow, et non septieme a avoir rouvert l'application un
 * mardi.
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
  rang integer;
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

  /*
   * Un badge limite se merite par l'anciennete du compte.
   *
   * Le plafond reste verifie ensuite : il borne le nombre d'attributions meme
   * si le rang venait a manquer, et les deux disent la meme chose quand tout va
   * bien.
   */
  if plafond is not null then
    rang := public.rang_inscription();

    if rang is null or rang > plafond then
      return false;
    end if;
  end if;

  if plafond is not null and deja >= plafond then
    return false;
  end if;

  insert into public.profil_badges (profil_id, badge_cle, position)
  values (moi, cle_badge, coalesce(rang, deja + 1))
  on conflict do nothing;

  return found;
end;
$$;

grant execute on function public.attribuer_badge(text) to authenticated;



-- ==========================================================================
-- 20260902100001_rangs_et_attribution_manuelle.sql
-- ==========================================================================

-- Les places deja prises, recalculees, et les badges donnes a la main.
--
-- Encore un fichier a part : le precedent etait deja applique quand ce manque a
-- ete vu. C'est la deuxieme fois, et la lecon est la meme — une migration
-- appliquee ne se modifie pas, sous peine que le fichier local decrive quelque
-- chose que la base ne fait pas.

-- ===========================================================================
-- Les places deja prises sont recalculees
-- ===========================================================================
--
-- Les attributions faites avant cette migration portent le rang de DEMANDE. Les
-- laisser telles quelles donnerait un catalogue a deux regles : « n°1 » voudrait
-- dire « premier a rouvrir l'application » pour les uns et « premier inscrit »
-- pour les autres, sans qu'on puisse les distinguer.
--
-- Une place affichee qui ne veut pas la meme chose selon la ligne est pire
-- qu'une place absente : on la lit sans savoir qu'il faut se mefier.

update public.profil_badges pb
   set position = classement.rang
  from (
    select
      pb2.profil_id,
      pb2.badge_cle,
      rank() over (
        partition by pb2.badge_cle
        order by p.created_at
      )::integer as rang
      from public.profil_badges pb2
      join public.profiles p on p.id = pb2.profil_id
      join public.badges b on b.cle = pb2.badge_cle
     where b.limite is not null
  ) as classement
 where pb.profil_id = classement.profil_id
   and pb.badge_cle = classement.badge_cle
   and pb.position is distinct from classement.rang;

-- ===========================================================================
-- Donner un badge a la main
-- ===========================================================================
--
-- Deux badges ne se calculent pas : « Equipe Echow » et « Chasseur de bogues ».
-- Ils ne se calculaient pas non plus a la main — rien nulle part ne pouvait les
-- attribuer. Deux badges impossibles a obtenir, ce qui revient a deux badges
-- qui n'existent pas.
--
-- Cette fonction repare cela, et elle est reservee a la cle de service : la
-- console de l'equipe s'en sert, aucun compte ordinaire n'y a acces. Un badge
-- qu'on peut se donner soi-meme ne vaut rien.

create or replace function public.donner_badge(p_profil uuid, p_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  plafond integer;
  deja integer;
begin
  select limite into plafond from public.badges where cle = p_badge;
  if not found then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_badge));
  select count(*) into deja from public.profil_badges where badge_cle = p_badge;

  -- Le plafond vaut aussi pour une attribution manuelle : pouvoir depasser une
  -- limite a la main viderait de son sens la rarete qu'elle protege.
  if plafond is not null and deja >= plafond then
    return false;
  end if;

  insert into public.profil_badges (profil_id, badge_cle, position)
  values (p_profil, p_badge, deja + 1)
  on conflict do nothing;

  return found;
end;
$$;

/*
 * Aucun droit accorde a `authenticated`, et c'est le point.
 *
 * Seule la cle de service peut appeler cette fonction. La console de l'equipe
 * l'utilise ; l'application, elle, n'y touche jamais.
 */
revoke all on function public.donner_badge(uuid, text) from public;
revoke all on function public.donner_badge(uuid, text) from authenticated;



-- ==========================================================================
-- 20260902200001_donner_badge_reserve.sql
-- ==========================================================================

-- `donner_badge` etait appelable par n'importe qui.
--
-- La migration precedente revoquait les droits sur `public` et `authenticated`.
-- Ce n'etait pas suffisant : PostgREST execute les requetes anonymes sous le
-- role `anon`, qui n'etait nomme nulle part. Un appel avec la cle publique de
-- l'application — celle qu'embarque chaque client, et qui n'est donc pas un
-- secret — s'executait normalement.
--
-- Verifie plutot que suppose : un appel a `rpc/donner_badge` avec cette cle
-- rendait `false`, c'est-a-dire le resultat de la fonction pour un badge
-- inexistant. Une fonction protegee aurait rendu une erreur de permission.
--
-- N'importe qui pouvait donc s'attribuer n'importe quel badge, « Pionnier »
-- compris. Les cent places n'en protegeaient plus aucune : la rarete, qui est
-- tout ce qui donne sa valeur a un badge, tenait a une revocation incomplete.
--
-- Ce qui change
-- -------------
-- La revocation nomme desormais chaque role, et `security definer` est double
-- d'une verification a l'interieur : meme si un droit revenait un jour — une
-- restauration, un `create or replace` distrait — la fonction refuserait.
-- Une protection qui tient a un `grant` absent tombe des qu'il reparait.

revoke all on function public.donner_badge(uuid, text) from public;
revoke all on function public.donner_badge(uuid, text) from anon;
revoke all on function public.donner_badge(uuid, text) from authenticated;

create or replace function public.donner_badge(p_profil uuid, p_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  plafond integer;
  deja integer;
begin
  /*
   * La ceinture, en plus des bretelles.
   *
   * `auth.role()` rend le role de l'appelant tel que PostgREST l'a pose. La
   * cle de service arrive en `service_role` ; tout le reste — anonyme, connecte
   * — n'a rien a faire ici. Refuser depuis l'interieur rend la fonction sure
   * independamment des droits qui lui sont accordes.
   */
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'donner_badge est reserve a la cle de service';
  end if;

  select limite into plafond from public.badges where cle = p_badge;
  if not found then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_badge));
  select count(*) into deja from public.profil_badges where badge_cle = p_badge;

  -- Le plafond vaut aussi pour une attribution manuelle : pouvoir depasser une
  -- limite a la main viderait de son sens la rarete qu'elle protege.
  if plafond is not null and deja >= plafond then
    return false;
  end if;

  insert into public.profil_badges (profil_id, badge_cle, position)
  values (p_profil, p_badge, deja + 1)
  on conflict do nothing;

  return found;
end;
$$;

revoke all on function public.donner_badge(uuid, text) from public;
revoke all on function public.donner_badge(uuid, text) from anon;
revoke all on function public.donner_badge(uuid, text) from authenticated;



-- ==========================================================================
-- 20260902210001_noms_des_badges.sql
-- ==========================================================================

-- Deux badges changent de nom.
--
-- « Chasseur de bogues » devient « Bug Hunter », qui est le nom porte par son
-- dessin — un scarabee de circuits, legende BUG HUNTER sur la planche
-- d'origine. Un badge dont l'illustration dit un nom et dont le texte en dit un
-- autre oblige a choisir lequel est le vrai.
--
-- « Pionnier » devient « 100 premiers soutiens ». Le nom precedent ne disait pas
-- ce qui fait la valeur de ce badge : qu'il n'y a que cent places, et qu'elles
-- se ferment. « Pionnier » se comprend apres avoir lu la description ; « 100
-- premiers soutiens » se comprend avant.
--
-- Les cles ne bougent pas. Elles sont la seule chose que le code lit —
-- attribution, paliers, nom de fichier du dessin — et les renommer casserait
-- tout pour un affichage. Un nom se lit, une cle s'utilise.

update public.badges
   set nom = 'Bug Hunter'
 where cle = 'rapporteur';

update public.badges
   set nom = '100 premiers soutiens'
 where cle = 'pionnier';



-- ==========================================================================
-- 20260902220001_retirer_badge.sql
-- ==========================================================================

-- Retirer un badge donne par erreur.
--
-- `donner_badge` existait sans son inverse : une attribution ratee — mauvais
-- pseudo, mauvais badge, essai — restait pour toujours. Sur un badge limite,
-- c'est pire qu'un desagrement : la place prise ne revenait jamais, et le
-- compteur des cent places montait sans que personne ne les ait meritees.
--
-- Les rangs se referment derriere
-- -------------------------------
-- Retirer le septieme laisserait un trou : le huitieme resterait « n°8 » alors
-- qu'il est desormais le septieme a l'avoir. Les rangs suivants sont donc
-- decales. Sans cela, « n°8 » sur cent places finirait par ne plus rien vouloir
-- dire — et c'est tout ce que ce nombre a a dire.

create or replace function public.retirer_badge(p_profil uuid, p_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  rang integer;
begin
  -- La meme reserve que pour l'attribution : seule la cle de service passe.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'retirer_badge est reserve a la cle de service';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_badge));

  select position into rang
    from public.profil_badges
   where profil_id = p_profil and badge_cle = p_badge;

  if not found then
    return false;
  end if;

  delete from public.profil_badges
   where profil_id = p_profil and badge_cle = p_badge;

  -- Les rangs suivants avancent d'un cran.
  if rang is not null then
    update public.profil_badges
       set position = position - 1
     where badge_cle = p_badge and position > rang;
  end if;

  return true;
end;
$$;

revoke all on function public.retirer_badge(uuid, text) from public;
revoke all on function public.retirer_badge(uuid, text) from anon;
revoke all on function public.retirer_badge(uuid, text) from authenticated;



-- ==========================================================================
-- 20260902230001_amis_communs_visibles.sql
-- ==========================================================================

-- Les amis en commun ne s'affichaient jamais.
--
-- `profile_stats` est en SECURITY INVOKER, et son commentaire en faisait une
-- garantie : « la jointure passe par ses propres amities acceptees, donc on ne
-- peut voir que des personnes que l'on connait deja ».
--
-- L'intention etait juste. La mise en oeuvre ne pouvait pas marcher : la
-- politique de lecture sur `friendships` ne laisse voir que les lignes ou l'on
-- est soi-meme partie prenante. La sous-requete `ses_amis` — les amities de
-- l'AUTRE — ne renvoyait donc jamais rien, et l'intersection etait vide par
-- construction. Pour tout le monde, tout le temps.
--
-- Rien ne le signalait : le client normalise un `mutual_friends` absent en
-- liste vide, et une liste vide s'affiche « Aucune connaissance commune ».
-- Une phrase parfaitement plausible, qui n'etait jamais fausse a l'ecran et
-- toujours fausse dans les faits.
--
-- Ce qui change
-- -------------
-- La fonction passe en SECURITY DEFINER, ce qui lui donne le droit de lire les
-- deux carnets. Elle n'en rend que l'INTERSECTION — c'est la garantie que le
-- commentaire promettait, et elle est desormais tenue par le calcul plutot que
-- par une politique qui l'empechait de fonctionner.
--
-- On n'apprend donc rien du carnet de l'autre au-dela de ce qu'on connait deja
-- soi-meme : chaque personne rendue est quelqu'un dont on est deja l'ami.

create or replace function public.profile_stats(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with moi as (select (select auth.uid()) as id),

  amis as (
    select f.requester_id as a, f.addressee_id as b
      from public.friendships f
     where f.status = 'accepted'
  ),

  mes_amis as (
    select case when a.a = (select id from moi) then a.b else a.a end as ami
      from amis a
     where (select id from moi) in (a.a, a.b)
  ),

  ses_amis as (
    select case when a.a = p_user_id then a.b else a.a end as ami
      from amis a
     where p_user_id in (a.a, a.b)
  )

  select jsonb_build_object(
    'joined_at', (
      select p.created_at from public.profiles p where p.id = p_user_id
    ),

    'mutual_spaces', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', s.id, 'name', s.name, 'icon_url', s.icon_url)
               order by s.name
             )
        from public.space_members mine
        join public.space_members theirs on theirs.space_id = mine.space_id
        join public.spaces s on s.id = mine.space_id
       where mine.user_id = (select id from moi)
         and theirs.user_id = p_user_id
         and p_user_id <> (select id from moi)
    ), '[]'::jsonb),

    'mutual_friends', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'username', p.username,
                 'display_name', p.display_name,
                 'avatar_url', p.avatar_url
               )
               order by p.display_name
             )
        from mes_amis m
        join ses_amis t on t.ami = m.ami
        join public.profiles p on p.id = m.ami
       where p_user_id <> (select id from moi)
    ), '[]'::jsonb),

    'roles', coalesce((
      select jsonb_agg(distinct sm.role)
        from public.space_members sm
        join public.space_members mine
          on mine.space_id = sm.space_id
         and mine.user_id = (select id from moi)
       where sm.user_id = p_user_id
         and sm.role <> 'member'
    ), '[]'::jsonb)
  );
$$;

-- Une fonction en SECURITY DEFINER doit rester joignable par les comptes
-- connectes : c'est eux qui ouvrent des fiches de profil.
grant execute on function public.profile_stats(uuid) to authenticated;



-- ==========================================================================
-- 20260903010001_groupes_quitter_renommer.sql
-- ==========================================================================

-- Quitter un groupe, et le renommer.
--
-- Un groupe se creait et ne se gouvernait plus : on ne pouvait ni en sortir ni
-- changer son nom. `hide_dm` existait, mais elle ne fait que retirer la
-- conversation de SA PROPRE liste — les autres continuent de vous y compter, et
-- le moindre message la fait reapparaitre. Masquer n'est pas partir.
--
-- Un groupe qu'on ne peut pas quitter est un groupe dont on depend de la
-- bienveillance des autres pour en sortir. C'est le genre de detail qui ne se
-- remarque qu'au mauvais moment.

/**
 * Quitte un groupe.
 *
 * Reservee aux salons de type `group` : une conversation a deux ne se quitte
 * pas, elle se masque. En sortir laisserait l'autre devant un fil dont la
 * moitie des interlocuteurs a disparu, sans avoir rien demande.
 */
create or replace function public.quitter_groupe(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
  genre text;
  restants integer;
begin
  select c.kind into genre
    from public.channels c
   where c.id = p_channel_id;

  if genre is distinct from 'group' then
    raise exception 'Seul un groupe se quitte' using errcode = '42501';
  end if;

  delete from public.dm_participants
   where channel_id = p_channel_id and user_id = moi;

  if not found then
    raise exception 'Vous ne faites pas partie de ce groupe' using errcode = '42501';
  end if;

  /*
   * Le dernier parti emporte le groupe.
   *
   * Un groupe sans personne dedans ne se retrouve plus : il n'apparait dans
   * aucune liste et personne ne peut y revenir. Le laisser serait accumuler des
   * salons invisibles pour toujours.
   */
  select count(*) into restants
    from public.dm_participants
   where channel_id = p_channel_id;

  if restants = 0 then
    delete from public.channels where id = p_channel_id;
  end if;
end;
$$;

/**
 * Renomme un groupe.
 *
 * N'importe quel membre le peut : un groupe n'a pas de proprietaire, et
 * inventer un role pour trois personnes qui se parlent serait une ceremonie
 * pour rien. Le nom vide revient au defaut plutot que de laisser une entree
 * sans etiquette dans la liste.
 */
create or replace function public.renommer_groupe(p_channel_id uuid, p_nom text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.dm_participants
     where channel_id = p_channel_id and user_id = moi
  ) then
    raise exception 'Vous ne faites pas partie de ce groupe' using errcode = '42501';
  end if;

  update public.channels
     set name = coalesce(nullif(trim(p_nom), ''), 'Groupe')
   where id = p_channel_id and kind = 'group';

  if not found then
    raise exception 'Seul un groupe se renomme' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.quitter_groupe(uuid) from public, anon;
revoke all on function public.renommer_groupe(uuid, text) from public, anon;
grant execute on function public.quitter_groupe(uuid) to authenticated;
grant execute on function public.renommer_groupe(uuid, text) to authenticated;



-- ==========================================================================
-- 20260903020001_groupes_images.sql
-- ==========================================================================

-- Une photo et une banniere pour les groupes.
--
-- Un groupe n'avait qu'un nom. Trois groupes avec les memes personnes se
-- distinguaient donc par leur intitule seul, dans une liste ou l'on reconnait
-- tout le reste a une image — les conversations a deux ont un visage, les
-- espaces ont une icone.
--
-- Les colonnes vont sur `channels` plutot que dans une table a part : un groupe
-- EST un salon, et lui inventer une table pour deux colonnes obligerait a
-- joindre partout ou l'on affiche une conversation.

alter table public.channels
  add column if not exists icon_url text,
  add column if not exists banner_url text;

/**
 * Change la photo ou la banniere d'un groupe.
 *
 * Ouverte a tout membre, comme le renommage : un groupe n'a pas de
 * proprietaire. `p_url` a `null` retire l'image et fait revenir aux initiales.
 *
 * La verification d'appartenance est faite ICI plutot que par une politique :
 * la fonction est en `security definer`, donc les politiques de `channels` ne
 * s'appliquent pas a l'ecriture qu'elle fait. C'est le prix a payer pour
 * pouvoir ecrire, et la condition doit donc etre reecrite a la main.
 */
create or replace function public.image_groupe(
  p_channel_id uuid,
  p_genre text,
  p_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
begin
  if p_genre not in ('icon', 'banner') then
    raise exception 'Genre d''image inconnu' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.dm_participants
     where channel_id = p_channel_id and user_id = moi
  ) then
    raise exception 'Vous ne faites pas partie de ce groupe' using errcode = '42501';
  end if;

  update public.channels
     set icon_url   = case when p_genre = 'icon'   then p_url else icon_url end,
         banner_url = case when p_genre = 'banner' then p_url else banner_url end
   where id = p_channel_id and kind = 'group';

  if not found then
    raise exception 'Seul un groupe porte une image' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.image_groupe(uuid, text, text) from public, anon;
grant execute on function public.image_groupe(uuid, text, text) to authenticated;



-- ==========================================================================
-- 20260904010001_cadrage_banniere.sql
-- ==========================================================================

-- Le cadrage de la banniere de profil.
--
-- La banniere etait posee en `object-fit: cover`, ce qui la centre et rogne le
-- reste. Une image dont le sujet n'est pas au milieu — un visage a gauche, un
-- titre en haut — se retrouvait donc coupee, sans aucun moyen d'y remedier
-- autre que rouvrir un editeur d'images et recadrer le fichier avant de
-- l'envoyer. Sur telephone, ou l'on choisit une photo prise a l'instant, cela
-- revenait a ne pas pouvoir se servir de la fonction.
--
-- Trois nombres suffisent a tout dire : ou regarder, et de combien grossir.
--
-- Une colonne `jsonb` plutot que trois colonnes numeriques. Ces trois nombres
-- ne veulent rien dire l'un sans les autres — on ne cherchera jamais les
-- profils par leur decalage horizontal — et ils vont toujours ensemble, en
-- lecture comme en ecriture. Une colonne se lit, se remet a `null` et se
-- transporte d'un bloc.
--
-- `null` signifie « cadrage par defaut », c'est-a-dire centre sans
-- grossissement. C'est ce que valent tous les profils existants, et cela evite
-- d'ecrire une valeur a des gens qui n'ont rien demande.

alter table public.profiles
  add column if not exists banner_frame jsonb;

/*
 * La forme est verifiee par la base, pas seulement par l'application.
 *
 * `profiles` s'ecrit directement depuis le client — il n'y a pas de fonction
 * intermediaire pour la modification de son propre profil. Sans contrainte
 * ici, n'importe quoi pourrait s'y loger : un objet vide, une chaine, un zoom
 * a mille qui rendrait la fiche illisible pour tous ceux qui l'ouvrent.
 *
 * Les bornes sont celles de l'interface, un cran plus larges : x et y sont des
 * pourcentages, le grossissement va de un a trois. Au-dela de trois, une image
 * de banniere ordinaire devient une bouillie de pixels ; en dessous de un, elle
 * ne remplirait plus le cadre et laisserait paraitre le fond.
 */
alter table public.profiles
  drop constraint if exists profiles_banner_frame_valide;

alter table public.profiles
  add constraint profiles_banner_frame_valide check (
    banner_frame is null
    or (
      jsonb_typeof(banner_frame) = 'object'
      and jsonb_typeof(banner_frame -> 'x') = 'number'
      and jsonb_typeof(banner_frame -> 'y') = 'number'
      and jsonb_typeof(banner_frame -> 'zoom') = 'number'
      and (banner_frame ->> 'x')::numeric between 0 and 100
      and (banner_frame ->> 'y')::numeric between 0 and 100
      and (banner_frame ->> 'zoom')::numeric between 1 and 3
    )
  );

comment on column public.profiles.banner_frame is
  'Cadrage de la banniere : {"x": 0-100, "y": 0-100, "zoom": 1-3}. '
  'x et y sont un object-position en pourcentage, zoom un facteur d''echelle. '
  'null vaut centre et sans grossissement.';



-- ==========================================================================
-- 20260904020001_liens_et_statut.sql
-- ==========================================================================

-- Le nom d'un lien devient facultatif, et sa couleur se choisit.
-- Le statut du moment gagne une couleur et une opacite.
--
-- Trois changements qui vont ensemble : ils portent tous sur ce qu'une personne
-- montre d'elle sur sa fiche, et ils partagent la meme regle de validation des
-- couleurs.

/*
 * Un lien sans nom est un lien normal.
 *
 * `label` etait exige. Coller une adresse obligeait donc a lui inventer un
 * intitule — et l'intitule le plus honnete est souvent l'adresse elle-meme,
 * qu'on recopiait a la main a cote. L'affichage sait desormais montrer
 * l'adresse entiere quand le nom manque.
 *
 * `couleur` est facultative et bornee a une notation hexadecimale a six
 * chiffres. Bornee parce que cette valeur part directement dans une feuille de
 * style : accepter n'importe quelle chaine laisserait ecrire autre chose
 * qu'une couleur dans un attribut `style`, ce qui n'a rien a faire ici.
 */
create or replace function public.valid_profile_links(links jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(links) = 'array'
    and jsonb_array_length(links) <= 5
    and not exists (
      select 1
      from jsonb_array_elements(links) as entry
      where jsonb_typeof(entry) <> 'object'
         or entry->>'url' is null
         or char_length(entry->>'url') > 200
         or entry->>'url' !~ '^https?://'
         -- Le nom est facultatif ; s'il est la, il reste court.
         or (entry->>'label' is not null and char_length(entry->>'label') > 40)
         -- La couleur est facultative ; si elle est la, c'en est une.
         or (entry->>'couleur' is not null and entry->>'couleur' !~* '^#[0-9a-f]{6}$')
    );
$$;

/*
 * La bulle de statut : sa couleur et son opacite.
 *
 * Deux colonnes plutot qu'un objet, a la difference du cadrage de banniere :
 * ces deux valeurs se lisent et se changent separement — on garde sa couleur
 * en jouant sur l'opacite — et chacune porte sa propre contrainte, ce qui se
 * dit mal dans un seul `jsonb`.
 *
 * `null` des deux cotes signifie « comme avant » : la bulle prend la teinte de
 * la fiche. C'est ce que valent tous les profils existants.
 */
alter table public.profiles
  add column if not exists status_couleur text,
  add column if not exists status_opacite numeric;

alter table public.profiles
  drop constraint if exists profiles_status_couleur_valide;

alter table public.profiles
  add constraint profiles_status_couleur_valide check (
    status_couleur is null or status_couleur ~* '^#[0-9a-f]{6}$'
  );

/*
 * Le plancher a 0,1 n'est pas une precaution, c'est la demande.
 *
 * Une bulle entierement transparente ne disparait pas : elle laisse un texte
 * flottant sur la banniere, souvent illisible et impossible a distinguer du
 * reste. On borne donc en base plutot que dans l'interface seule — une valeur
 * ecrite par un autre chemin donnerait le meme resultat, et personne ne saurait
 * d'ou elle vient.
 */
alter table public.profiles
  drop constraint if exists profiles_status_opacite_valide;

alter table public.profiles
  add constraint profiles_status_opacite_valide check (
    status_opacite is null or (status_opacite >= 0.1 and status_opacite <= 1)
  );

comment on column public.profiles.status_couleur is
  'Couleur de la bulle de statut, #rrggbb. null = teinte de la fiche.';

comment on column public.profiles.status_opacite is
  'Opacite du fond de la bulle, de 0,1 a 1. Jamais 0 : une bulle invisible '
  'laisse un texte flottant sur la banniere.';



-- ==========================================================================
-- 20260904030001_couleurs_profil.sql
-- ==========================================================================

-- Les couleurs d'une fiche de profil.
--
-- `theme_hue` existait deja et ne servait a RIEN : la teinte etait posee en
-- variable CSS `--hue-primary` sur la carte, et aucune regle ne la lisait. On
-- proposait donc huit couleurs qui ne changeaient rien, ce qui se remarque
-- surtout quand on les essaie toutes.
--
-- La colonne reste — elle ne gene personne, et l'effacer demanderait une
-- migration de plus pour une valeur que rien ne lit. C'est `profil_couleurs`
-- qui decide desormais.

/*
 * Une colonne plutot que trois.
 *
 * Ces valeurs n'ont aucun sens l'une sans les autres : une seconde couleur ne
 * veut rien dire sans le style qui l'emploie, et un style « degrade » sans
 * seconde couleur n'a rien a degrader. On ne cherchera jamais les profils par
 * leur couleur secondaire. Elles se lisent et s'ecrivent ensemble.
 */
alter table public.profiles
  add column if not exists profil_couleurs jsonb;

alter table public.profiles
  drop constraint if exists profiles_profil_couleurs_valide;

/*
 * La forme est verifiee par la base, pas seulement par l'application.
 *
 * `profiles` s'ecrit directement depuis le client : sans contrainte ici,
 * n'importe quoi pourrait se loger dans une valeur qui part telle quelle dans
 * un attribut `style`. Les couleurs sont donc bornees a une notation
 * hexadecimale a six chiffres, et le style a trois valeurs connues.
 */
alter table public.profiles
  add constraint profiles_profil_couleurs_valide check (
    profil_couleurs is null
    or (
      jsonb_typeof(profil_couleurs) = 'object'
      and profil_couleurs ->> 'a' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'b' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'style' in ('unique', 'duo', 'degrade')
    )
  );

comment on column public.profiles.profil_couleurs is
  'Couleurs de la fiche : {"a": "#rrggbb", "b": "#rrggbb", "style": '
  '"unique" | "duo" | "degrade"}. En « unique » seule `a` sert ; `b` reste '
  'renseignee pour qu''un retour au duo retrouve le choix precedent. '
  'null = couleurs de l''application.';



-- ==========================================================================
-- 20260904040001_fond_panneau_profil.sql
-- ==========================================================================

-- Le fond du panneau de droite, dans les couleurs de la fiche.
--
-- La contrainte posee par `20260904030001` exige un objet fait de `a`, `b` et
-- `style`, et rien d'autre n'y est prevu. Elle refuserait donc `panneau`, et le
-- refus porterait sur l'ecriture ENTIERE du profil : quelqu'un qui touche a la
-- couleur de son panneau ne pourrait plus rien enregistrer du tout.
--
-- Le champ est facultatif : `null` et l'absence valent « gris », ce que valent
-- toutes les fiches existantes.

alter table public.profiles
  drop constraint if exists profiles_profil_couleurs_valide;

alter table public.profiles
  add constraint profiles_profil_couleurs_valide check (
    profil_couleurs is null
    or (
      jsonb_typeof(profil_couleurs) = 'object'
      and profil_couleurs ->> 'a' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'b' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'style' in ('unique', 'duo', 'degrade')
      -- Trois valeurs neutres, et seulement celles-la : c'est la colonne qui se
      -- lit, et une couleur y disputerait la lisibilite du texte.
      and (
        profil_couleurs ->> 'panneau' is null
        or profil_couleurs ->> 'panneau' in ('noir', 'gris', 'blanc')
      )
    )
  );

comment on column public.profiles.profil_couleurs is
  'Couleurs de la fiche : {"a": "#rrggbb", "b": "#rrggbb", "style": '
  '"unique" | "duo" | "degrade", "panneau": "noir" | "gris" | "blanc"}. '
  'En « unique » seule `a` sert ; `b` reste renseignee pour qu''un retour au '
  'duo retrouve le choix precedent. `panneau` absent vaut « gris ». '
  'null = couleurs de l''application.';



-- ==========================================================================
-- 20260904050001_badge_retire_ne_revient_pas.sql
-- ==========================================================================

-- Un badge retire a la main ne se redonne pas tout seul.
--
-- Le defaut, tel qu'il a ete rapporte : « j'arrive pas a enlever le role 100
-- premiers soutiens ». Le retrait FONCTIONNAIT — `retirer_badge` rendait bien
-- `true`, et la ligne disparaissait. Mais l'application, au demarrage suivant,
-- tente d'obtenir les badges qui ne se mesurent pas :
--
--     await tenter('pionnier', true);
--
-- Elle ne saute que si l'on a DEJA le badge. Retire, la place redevenait libre,
-- et il etait aussitot repris. Vu du dehors, le bouton « Retirer » ne servait a
-- rien.
--
-- On garde donc une trace des retraits volontaires. C'est la seule facon de
-- distinguer « cette personne n'a jamais eu ce badge » de « on le lui a
-- retire » — deux situations que la table des badges obtenus decrit de la meme
-- maniere, c'est-a-dire par une absence.

create table if not exists public.profil_badges_retires (
  profil_id  uuid not null references public.profiles (id) on delete cascade,
  badge_cle  text not null references public.badges (cle) on delete cascade,
  retire_le  timestamptz not null default now(),

  primary key (profil_id, badge_cle)
);

/*
 * Personne ne lit ni n'ecrit cette table depuis le client.
 *
 * Elle ne sert qu'aux deux fonctions ci-dessous, qui sont en `security
 * definer` et passent donc outre. Aucune politique n'est posee : sans
 * politique, RLS refuse tout, ce qui est exactement ce qu'on veut ici.
 */
alter table public.profil_badges_retires enable row level security;

/*
 * Le retrait laisse sa marque.
 *
 * `insert ... on conflict do nothing` : retirer deux fois de suite n'est pas
 * une erreur, c'est la meme intention repetee.
 */
create or replace function public.retirer_badge(p_profil uuid, p_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existait boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'retirer_badge est reserve a la cle de service';
  end if;

  delete from public.profil_badges
   where profil_id = p_profil and badge_cle = p_badge;

  get diagnostics existait = row_count;

  insert into public.profil_badges_retires (profil_id, badge_cle)
  values (p_profil, p_badge)
  on conflict do nothing;

  return existait;
end;
$$;

/*
 * Et l'attribution automatique la respecte.
 *
 * Seule l'attribution AUTOMATIQUE, celle que l'application tente au demarrage.
 * `donner_badge`, qui passe par la cle de service et demande un geste humain,
 * efface au contraire la marque : c'est une decision, et elle doit pouvoir
 * revenir sur la precedente.
 */
create or replace function public.attribuer_badge(cle_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
  limite integer;
  pris integer;
  place integer;
begin
  if moi is null then
    return false;
  end if;

  -- Un badge retire a la main ne se reprend pas tout seul.
  if exists (
    select 1 from public.profil_badges_retires
     where profil_id = moi and badge_cle = cle_badge
  ) then
    return false;
  end if;

  select b.limite into limite
    from public.badges b
   where b.cle = cle_badge;

  if not found then
    return false;
  end if;

  if exists (
    select 1 from public.profil_badges
     where profil_id = moi and badge_cle = cle_badge
  ) then
    return false;
  end if;

  /*
   * La place est calculee et posee dans la MEME instruction.
   *
   * Compter d'abord puis inserer laisse une fenetre entre les deux : deux
   * comptes ouverts en meme temps y lisent le meme total et recoivent la meme
   * place. Les traces en portent la marque — quatre comptes se partagent la
   * place 2 du badge « 100 premiers soutiens ».
   *
   * `on conflict do nothing` sur la cle primaire couvre le reste : deux
   * tentatives du meme compte ne font qu'une ligne.
   */
  if limite is null then
    insert into public.profil_badges (profil_id, badge_cle, position)
    values (moi, cle_badge, null)
    on conflict do nothing;

    return true;
  end if;

  select count(*) into pris
    from public.profil_badges
   where badge_cle = cle_badge;

  if pris >= limite then
    return false;
  end if;

  insert into public.profil_badges (profil_id, badge_cle, position)
  select moi, cle_badge, coalesce(max(pb.position), 0) + 1
    from public.profil_badges pb
   where pb.badge_cle = cle_badge
  on conflict do nothing;

  get diagnostics place = row_count;
  return place > 0;
end;
$$;



-- ==========================================================================
-- 20260904060001_badge_ceo.sql
-- ==========================================================================

-- Le badge « C.E.O », et les badges qui ne se gagnent pas.
--
-- Un badge peut se meriter — mille heures en vocal, cent mille messages — ou
-- se donner. Jusqu'ici la base ne faisait pas la difference : `attribuer_badge`
-- accordait n'importe quelle cle du catalogue a qui la demandait, du moment que
-- la limite n'etait pas atteinte.
--
-- L'application ne demande que les cles qu'elle connait, ce qui suffisait tant
-- qu'aucun badge n'etait unique. Mais rien n'empeche d'appeler la fonction
-- directement avec la cle de son choix : la protection tenait a ce que
-- l'interface ne le fasse pas, pas a ce que la base le refuse. Ce n'est pas une
-- protection.

/*
 * Un badge reserve ne s'attribue jamais tout seul.
 *
 * `false` par defaut : tous les badges existants gardent leur comportement, et
 * seuls ceux qu'on marque explicitement deviennent hors d'atteinte.
 */
alter table public.badges
  add column if not exists reserve boolean not null default false;

comment on column public.badges.reserve is
  'Un badge reserve ne peut etre obtenu que par `donner_badge`, c''est-a-dire '
  'par la cle de service. `attribuer_badge` le refuse toujours.';

/*
 * Le badge lui-meme.
 *
 * `rang 0` : il passe devant tous les autres. Le tri d'une vitrine montre ce
 * qu'on a de mieux en premier, et celui-ci n'a pas de concurrent.
 *
 * `limite` reste nulle plutot que valoir 1. Une limite decrit une COURSE — les
 * cent premiers, et la place obtenue compte. Ce badge n'est pas une course : il
 * se donne, et `reserve` dit deja que personne ne peut se servir.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang, reserve)
values (
  'ceo',
  'C.E.O',
  'Fondateur d''Echow.',
  'equipe',
  '#ff2233',
  null,
  0,
  true
)
on conflict (cle) do update
   set nom         = excluded.nom,
       description = excluded.description,
       famille     = excluded.famille,
       teinte      = excluded.teinte,
       rang        = excluded.rang,
       reserve     = excluded.reserve;

/*
 * `attribuer_badge` refuse ce qui est reserve.
 *
 * Le test est pose AVANT tout le reste : inutile de compter les places d'un
 * badge qu'on ne donnera pas.
 */
create or replace function public.attribuer_badge(cle_badge text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
  limite integer;
  est_reserve boolean;
  pris integer;
  place integer;
begin
  if moi is null then
    return false;
  end if;

  select b.limite, b.reserve into limite, est_reserve
    from public.badges b
   where b.cle = cle_badge;

  if not found then
    return false;
  end if;

  -- Un badge reserve ne se prend pas : il se donne.
  if est_reserve then
    return false;
  end if;

  -- Un badge retire a la main ne se reprend pas tout seul.
  if exists (
    select 1 from public.profil_badges_retires
     where profil_id = moi and badge_cle = cle_badge
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.profil_badges
     where profil_id = moi and badge_cle = cle_badge
  ) then
    return false;
  end if;

  /*
   * La place est calculee et posee dans la MEME instruction.
   *
   * Compter d'abord puis inserer laisse une fenetre entre les deux : deux
   * comptes ouverts en meme temps y lisent le meme total et recoivent la meme
   * place. Les traces en portent la marque — quatre comptes se partagent la
   * place 2 du badge « 100 premiers soutiens ».
   */
  if limite is null then
    insert into public.profil_badges (profil_id, badge_cle, position)
    values (moi, cle_badge, null)
    on conflict do nothing;

    return true;
  end if;

  select count(*) into pris
    from public.profil_badges
   where badge_cle = cle_badge;

  if pris >= limite then
    return false;
  end if;

  insert into public.profil_badges (profil_id, badge_cle, position)
  select moi, cle_badge, coalesce(max(pb.position), 0) + 1
    from public.profil_badges pb
   where pb.badge_cle = cle_badge
  on conflict do nothing;

  get diagnostics place = row_count;
  return place > 0;
end;
$$;



-- ==========================================================================
-- 20260906010001_pochette_dans_activite.sql
-- ==========================================================================

-- La pochette ne tenait pas dans la colonne qui devait la porter.
--
-- Le defaut, tel qu'il a ete rapporte : « quand j'ecoute un son spotify les
-- autres voient pas sur mon profil l'embed, ya que moi qui vois le mien ».
--
-- Ce n'est pas un probleme de droits : la politique de lecture est
-- `using (true)`, et tout le monde peut lire la table. C'est l'ECRITURE qui
-- n'aboutissait jamais.
--
-- `image_url` porte la pochette du morceau. Elle ne vient pas d'une adresse :
-- Windows la rend sous forme d'octets, et on la reduit a 72 pixels avant de
-- l'envoyer — ce qui donne une adresse `data:` de trois mille caracteres
-- environ, mesuree a 3079 pour une image bien remplie.
--
-- La colonne en acceptait CINQ CENTS. Chaque annonce portant une pochette
-- violait donc la contrainte et etait rejetee. Comme personne ne regardait le
-- resultat de l'ecriture, et que l'interface posait l'activite dans son propre
-- etat juste apres, celui qui ecoutait voyait sa fiche parfaitement a jour.
-- Les autres ne voyaient rien, et il n'existait aucune trace de l'echec.
--
-- Les deux nombres n'ont jamais ete confrontes : la limite a ete ecrite en
-- pensant a une adresse, la reduction en pensant a des octets, et rien ne
-- reliait les deux fichiers.

/*
 * Douze mille caracteres : quatre fois ce qui est mesure.
 *
 * La marge n'est pas de la prudence vague. Une pochette photographique se
 * comprime moins bien qu'un degrade, et la reduction pourrait un jour passer a
 * quatre-vingt-seize pixels. Douze mille couvre ces cas sans ouvrir la porte a
 * une image de taille reelle — neuf kilo-octets une fois decodee, la ou une
 * pochette non reduite en pese deux cent vingt-cinq.
 *
 * La borne compte : cette ligne est lue par toute personne qui ouvre la fiche.
 * Ce qui n'est pas transmis ne coute rien a personne, et le quota d'egress est
 * deja la ou il est.
 */
alter table public.activites
  drop constraint if exists activites_image_url_check;

alter table public.activites
  add constraint activites_image_url_check
  check (image_url is null or char_length(image_url) <= 12000);

comment on column public.activites.image_url is
  'Pochette du morceau, en adresse `data:` deja reduite par le client '
  '(72 pixels, JPEG 0,7 — environ trois mille caracteres). Ce n''est pas une '
  'adresse distante : Windows rend les octets, pas un lien. La limite est '
  'tenue des deux cotes, ici et dans `ecoute.ts` : voir POCHETTE_MAX.';



-- ==========================================================================
-- 20260907010001_demande_fermee.sql
-- ==========================================================================

-- Une demande fermee ne recoit plus rien — de personne.
--
-- Ce que cela change par rapport a la regle precedente
-- ----------------------------------------------------
-- Le commentaire de `resoudre_ma_demande` disait ceci, et c'etait un choix
-- assume :
--
--     Rouvrir se fait en repondant : la reponse remonte la demande dans la
--     file de l'equipe, ce qui est exactement l'effet recherche, sans donner
--     un second bouton qui permettrait de faire osciller un statut
--     indefiniment.
--
-- Fermer ne fermait donc rien : cela rangeait la demande jusqu'a la phrase
-- suivante. Un echange qu'on croyait termine pouvait repartir des semaines
-- plus tard, sur la meme ligne, et il fallait relire tout le fil pour
-- comprendre ce qui etait encore d'actualite.
--
-- La demande faite est l'inverse : « quand on les a fermer on peux plus ecrire
-- dedans le client et moi ». Fermer devient donc definitif pour cet
-- echange-la. Ce qui reste a dire s'ecrit dans une nouvelle demande, qui part
-- avec son propre sujet et sa propre date — et c'est plus lisible qu'un fil
-- rouvert trois fois.
--
-- Pourquoi un declencheur et non une politique
-- --------------------------------------------
-- Une politique RLS ne s'applique pas a la cle de service, et le tableau de
-- bord de l'equipe s'en sert : la moitie « et moi » de la demande serait donc
-- restee lettre morte. On peut cacher le champ dans l'interface, et il faut le
-- faire, mais une regle qui ne tient que dans l'interface n'est pas une regle
-- — c'est une convention qu'un rechargement de page suffit a oublier.
--
-- Un declencheur, lui, s'applique a tout le monde. C'est le seul endroit d'ou
-- l'on puisse dire la meme chose aux deux cotes.

create or replace function public.support_refuse_si_fermee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  etat text;
begin
  select d.statut into etat
    from public.demandes_support d
   where d.id = new.demande_id;

  /*
   * Une demande introuvable n'est pas notre affaire.
   *
   * La cle etrangere s'en charge, et mieux que nous : lever ici une exception
   * differente ferait deux messages pour un seul defaut, selon l'ordre dans
   * lequel les verifications se declenchent.
   */
  if etat is null then
    return new;
  end if;

  if etat = 'resolue' then
    raise exception 'Cette demande est fermee : elle n''accepte plus de reponse.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.support_refuse_si_fermee is
  'Refuse toute reponse a une demande resolue, quel que soit le role — la cle '
  'de service comprise. C''est la seule facon de tenir la regle des DEUX '
  'cotes : une politique RLS ne s''applique pas au tableau de bord.';

/*
 * Avant l'insertion, et avant le declencheur qui horodate.
 *
 * `reponses_support_touche` remonte la demande dans la file a chaque reponse.
 * Il ne se declenche qu'`after insert`, donc apres celui-ci : une reponse
 * refusee ne remontera pas une demande fermee au sommet de la file de
 * l'equipe.
 */
drop trigger if exists reponses_support_fermee on public.reponses_support;
create trigger reponses_support_fermee
  before insert on public.reponses_support
  for each row execute function public.support_refuse_si_fermee();

/*
 * La politique du client le dit aussi, en plus du declencheur.
 *
 * Elle fait double emploi, et c'est voulu. Le declencheur rend une erreur de
 * base — un message brut, qui traverse l'interface tel quel. La politique,
 * elle, refuse la ligne avant meme d'y arriver, ce qui est le comportement
 * ordinaire d'une ecriture interdite et ce que le client sait deja presenter.
 *
 * Aucune des deux ne suffit seule : la politique ignore la cle de service, le
 * declencheur ne sait pas parler autrement qu'en levant une exception.
 */
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
         and d.statut <> 'resolue'
    )
  );



-- ==========================================================================
-- 20260907020001_pseudo_dune_lettre.sql
-- ==========================================================================

-- Un pseudo d'une seule lettre, et lui seul.
--
-- La demande tient en deux phrases : « change mon pseudo vq met juste s » et
-- « les autres doivent mettre 2 lettres min ». La seconde est deja vraie —
-- `^[a-z0-9_.-]{2,32}$` en base, et la meme regle a l'inscription — et c'est
-- justement pourquoi la premiere est impossible sans toucher a la contrainte.
--
-- Ce qui est fait ici, et ce qui ne l'est pas
-- -------------------------------------------
-- On ne descend PAS le minimum a une lettre pour tout le monde. Un pseudo
-- d'une lettre est une place rare — il y en a trente-six — et l'ouvrir a
-- l'inscription les ferait disparaitre en une soiree, au premier venu plutot
-- qu'a qui que ce soit en particulier.
--
-- La contrainte accepte donc une lettre, et un declencheur refuse ce cas a
-- tout ce qui parle avec une SESSION. Restent la cle de service et les
-- migrations : c'est-a-dire un geste deliberé de l'equipe, ce qu'est
-- exactement l'attribution d'une place rare.
--
-- Le nom de personne n'est ecrit nulle part dans cette regle. Ecrire un
-- identifiant dans une contrainte aurait marche aujourd'hui et serait devenu
-- incomprehensible au premier autre cas.

alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[a-z0-9_.-]{1,32}$');

/*
 * Deux lettres au minimum, sauf pour l'equipe.
 *
 * `auth.role()` vaut `authenticated` pour quelqu'un de connecte, `anon` pour
 * une session ouverte sans compte, `service_role` pour le tableau de bord, et
 * rien du tout quand la requete ne porte pas de jeton — le cas d'une migration.
 *
 * On refuse donc les deux premiers et l'on laisse passer les deux derniers.
 * Formuler la regle par ce qu'on REFUSE plutot que par ce qu'on autorise :
 * un role nouveau, ajoute un jour par Supabase, sera alors soumis a la regle
 * par defaut plutot que dispense sans qu'on s'en apercoive.
 */
create or replace function public.pseudo_assez_long()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rien ne change dans le pseudo : ce declencheur n'a pas son mot a dire.
  -- Sans ce test, quelqu'un a qui l'on a donne une lettre ne pourrait plus
  -- modifier sa bio ni sa photo.
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if char_length(new.username) < 2
     and coalesce(auth.role(), '') in ('authenticated', 'anon')
  then
    raise exception 'Un pseudo fait au moins deux caracteres.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.pseudo_assez_long is
  'Impose deux caracteres a qui choisit son pseudo depuis l''application. Les '
  'pseudos d''une lettre restent possibles, mais seulement par la cle de '
  'service : c''est une place rare, elle se donne, elle ne se prend pas.';

drop trigger if exists profiles_pseudo_assez_long on public.profiles;
create trigger profiles_pseudo_assez_long
  before insert or update on public.profiles
  for each row execute function public.pseudo_assez_long();

/*
 * Et la place est donnee.
 *
 * Par le pseudo actuel plutot que par l'identifiant : c'est ce que la demande
 * nommait, et cela rend la ligne lisible sans avoir a chercher a qui
 * appartient un uuid. Si `vq` n'existe plus, la migration ne fait rien plutot
 * que d'echouer — rejouer une migration sur une base ou le changement a deja
 * eu lieu ne doit pas la bloquer.
 *
 * `where not exists` protege du cas ou `s` aurait ete pris entre-temps :
 * l'unicite leverait sinon une erreur au milieu d'une migration, ce qui est le
 * plus mauvais endroit pour decouvrir un conflit.
 */
update public.profiles
   set username = 's'
 where username = 'vq'
   and not exists (select 1 from public.profiles autre where autre.username = 's');



-- ==========================================================================
-- 20260907030001_masquer_le_pseudo.sql
-- ==========================================================================

-- Ne pas afficher son pseudo sur sa fiche.
--
-- Le pseudo sert a deux choses qui n'ont rien a voir : il IDENTIFIE — c'est
-- lui qui rend une mention possible, et il doit donc rester unique et stable —
-- et il se MONTRE, sous le nom d'affichage. La seconde n'est utile que si les
-- deux different assez pour apprendre quelque chose.
--
-- Quand le nom d'affichage et le pseudo se ressemblent — « s » et « s » — la
-- ligne du dessous ne fait que repeter celle du dessus. C'est le meme
-- raisonnement qui a fait retirer la pastille C.E.O de la fiche : deux marques
-- pour un seul fait, et la plus discrete ne sert a rien.
--
-- Ce que cela coute, et qui doit le savoir
-- ----------------------------------------
-- Le pseudo cache reste le seul moyen de mentionner quelqu'un. Le masquer,
-- c'est retirer de sa fiche l'endroit ou l'on venait l'apprendre. C'est un
-- choix defendable — on le donne autrement — mais c'en est un, et l'interface
-- le dit a cote de l'interrupteur plutot que de laisser le decouvrir.
--
-- Il ne disparait donc QUE de la fiche. La recherche, les mentions et la liste
-- des membres continuent de le montrer : sans quoi ce ne serait plus un
-- reglage d'affichage mais une disparition, et deux personnes ne pourraient
-- plus se nommer.

alter table public.profiles
  add column if not exists masquer_pseudo boolean not null default false;

comment on column public.profiles.masquer_pseudo is
  'Cache le pseudo sur la FICHE de profil, et la seulement. Il reste visible '
  'partout ou il sert a identifier quelqu''un : recherche, mentions, liste des '
  'membres. Utile quand le nom d''affichage et le pseudo se repetent.';



-- ==========================================================================
-- 20260907040001_apercu_invitation.sql
-- ==========================================================================

-- De quoi montrer un espace avant d'y entrer.
--
-- Le defaut, tel qu'il a ete rapporte : « les liens d'invite marchent pas ».
-- Ils avaient trois problemes qui se cumulaient — l'adresse produite,
-- l'adresse servie, et ce qu'on voit avant de cliquer. Cette migration ne
-- traite que le troisieme.
--
-- Un lien d'invitation s'envoie, la plupart du temps, DANS Echow. Ce qu'on
-- voyait alors etait une adresse nue : douze caracteres au hasard derriere un
-- nom de domaine. Rien ne disait de quel serveur il s'agissait, et l'on
-- cliquait — ou non — sans savoir.
--
-- Pourquoi une fonction plutot qu'une politique de lecture
-- --------------------------------------------------------
-- La table des espaces n'est lisible que de ses membres, et c'est ce qu'il
-- faut : la liste des serveurs de quelqu'un ne regarde personne. Mais celui a
-- qui l'on envoie une invitation n'est, par definition, pas encore membre.
--
-- Ouvrir la lecture aux non-membres reviendrait a publier le nom et l'image de
-- tous les espaces a qui sait lire une table. Une fonction `security definer`
-- ne rend que ce qui est demande, pour UN code precis — et c'est exactement le
-- droit qu'une invitation confere : connaitre le code, c'est deja pouvoir
-- entrer.
--
-- Ce qu'elle ne rend pas
-- ----------------------
-- Ni la liste des membres, ni les salons, ni l'identifiant de l'espace. Le
-- nom, les deux images, le nombre de membres, et la date d'expiration. De quoi
-- decider si l'on entre, pas de quoi observer un serveur sans y etre.

create or replace function public.apercu_invitation(p_code text)
returns table (
  nom         text,
  icone_url   text,
  banniere_url text,
  membres     bigint,
  expire      boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    e.name,
    e.icon_url,
    e.banner_url,
    (select count(*) from public.space_members m where m.space_id = e.id),
    /*
     * L'expiration est rendue plutot que filtree.
     *
     * Ne rien rendre pour un code perime donnerait le meme resultat qu'un code
     * inexistant, et les deux n'appellent pas la meme phrase : « ce lien a
     * expire, redemandez-en un » se corrige, « ce lien n'existe pas » non.
     */
    (e.invite_expires_at is not null and e.invite_expires_at < now())
  from public.spaces e
  where e.invite_code = lower(trim(p_code))
  limit 1;
$$;

comment on function public.apercu_invitation is
  'Ce qu''on peut montrer d''un espace a qui detient son code d''invitation, '
  'sans en etre membre : le nom, les images, le nombre de membres. Ni les '
  'salons, ni les membres, ni l''identifiant.';

/*
 * Ouverte a tous, y compris hors session.
 *
 * Un lien d'invitation s'ouvre souvent avant de se connecter — c'est meme le
 * cas le plus courant pour quelqu'un qui decouvre Echow. Lui montrer une carte
 * vide jusqu'a ce qu'il ait un compte serait lui demander de s'inscrire pour
 * savoir a quoi.
 */
revoke all on function public.apercu_invitation(text) from public;
grant execute on function public.apercu_invitation(text) to anon, authenticated;



-- ==========================================================================
-- 20260907050001_badge_singe.sql
-- ==========================================================================

-- Un badge qui ne figure pas au catalogue.
--
-- Le dessin est arrive dans le depot sous son nom de telechargement —
-- `5301b03b-1378-4dad-8233-7dba7d84ad23.png` — et il ne suffit pas de le
-- deposer : le lien entre un badge et son image est le NOM DU FICHIER. Voir
-- `dessinsBadges.ts`, qui les apparie sans table a tenir a jour. Un dessin dont
-- le nom ne correspond a aucune cle n'est jamais affiche, et rien ne le
-- signale. Le fichier s'appelle donc `singe.png`, et la cle ci-dessous `singe`.
--
-- Pourquoi une colonne plutot qu'un cas particulier
-- -------------------------------------------------
-- La page « Badges » liste le catalogue par famille : tout ce qui est dans la
-- table s'y montre, obtenu ou non. C'est ce qu'on veut d'un catalogue — on y
-- vient pour savoir ce qui existe et ce qu'il reste a faire.
--
-- Un badge donne a la main n'a pas sa place dans cette liste. Il n'y a rien a
-- faire pour l'obtenir : l'y montrer poserait une question sans reponse, et la
-- seule reponse honnete — « celui-la, on ne peut pas l'avoir » — ne vaut pas
-- la peine d'etre affichee a tout le monde.
--
-- Ecarter cette cle-la dans le code de la page aurait marche aujourd'hui et
-- serait devenu faux au deuxieme badge du meme genre. La table dit donc
-- elle-meme ce qui se montre.

alter table public.badges
  add column if not exists cache boolean not null default false;

comment on column public.badges.cache is
  'Un badge cache ne figure pas au catalogue de la page « Badges ». Il '
  's''affiche normalement sur la fiche de qui le porte, et le tableau de bord '
  'de l''equipe continue de le lister : c''est de la, et de la seulement, '
  'qu''il se donne.';

/*
 * Le badge lui-meme.
 *
 * `reserve` autant que `cache`, et les deux ne disent pas la meme chose :
 * `reserve` empeche de le PRENDRE — sans quoi `attribuer_badge` l'accorderait
 * au premier demarrage venu, puisqu'aucune condition ne le protege — tandis
 * que `cache` empeche de le VOIR dans la liste. Il faut les deux : un badge
 * seulement cache serait invisible et distribue quand meme.
 *
 * Le nom visible reste a decider. « Singe » decrit ce qu'on voit, rien de
 * plus ; le changer ne coute qu'une ligne ici tant que la migration n'est pas
 * appliquee. La cle, elle, a interet a ne plus bouger : elle nomme le fichier,
 * et les deux doivent rester d'accord.
 *
 * Le neon n'est pas dans le style, il est dans l'image. Le halo du C.E.O vient
 * d'une regle CSS visant `data-badge='ceo'` ; ce dessin-ci porte le sien dans
 * ses pixels. Il n'a besoin de rien, et surtout pas qu'on elargisse cette
 * regle — elle lui ajouterait un second halo, d'une autre couleur.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang, reserve, cache)
values (
  'singe',
  'Singe',
  'Donne a la main.',
  'equipe',
  -- L'or du dessin, pour que la lueur de la vitrine s'accorde avec lui.
  '#f5a623',
  null,
  5,
  true,
  true
)
on conflict (cle) do update
   set nom         = excluded.nom,
       description = excluded.description,
       famille     = excluded.famille,
       teinte      = excluded.teinte,
       rang        = excluded.rang,
       reserve     = excluded.reserve,
       cache       = excluded.cache;



-- ==========================================================================
-- 20260907060001_webhooks.sql
-- ==========================================================================

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
