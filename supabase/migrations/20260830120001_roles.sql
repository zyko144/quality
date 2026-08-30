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
