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
