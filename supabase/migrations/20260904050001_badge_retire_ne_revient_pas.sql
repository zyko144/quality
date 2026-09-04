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
