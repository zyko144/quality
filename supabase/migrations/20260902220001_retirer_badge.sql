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
