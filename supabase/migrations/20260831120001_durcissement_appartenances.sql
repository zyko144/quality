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
