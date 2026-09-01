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
