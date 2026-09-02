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
