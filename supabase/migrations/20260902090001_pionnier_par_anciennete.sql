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
