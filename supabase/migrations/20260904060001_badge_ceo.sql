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
