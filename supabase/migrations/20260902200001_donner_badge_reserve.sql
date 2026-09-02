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
