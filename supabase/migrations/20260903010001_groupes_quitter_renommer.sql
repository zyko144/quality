-- Quitter un groupe, et le renommer.
--
-- Un groupe se creait et ne se gouvernait plus : on ne pouvait ni en sortir ni
-- changer son nom. `hide_dm` existait, mais elle ne fait que retirer la
-- conversation de SA PROPRE liste — les autres continuent de vous y compter, et
-- le moindre message la fait reapparaitre. Masquer n'est pas partir.
--
-- Un groupe qu'on ne peut pas quitter est un groupe dont on depend de la
-- bienveillance des autres pour en sortir. C'est le genre de detail qui ne se
-- remarque qu'au mauvais moment.

/**
 * Quitte un groupe.
 *
 * Reservee aux salons de type `group` : une conversation a deux ne se quitte
 * pas, elle se masque. En sortir laisserait l'autre devant un fil dont la
 * moitie des interlocuteurs a disparu, sans avoir rien demande.
 */
create or replace function public.quitter_groupe(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
  genre text;
  restants integer;
begin
  select c.kind into genre
    from public.channels c
   where c.id = p_channel_id;

  if genre is distinct from 'group' then
    raise exception 'Seul un groupe se quitte' using errcode = '42501';
  end if;

  delete from public.dm_participants
   where channel_id = p_channel_id and user_id = moi;

  if not found then
    raise exception 'Vous ne faites pas partie de ce groupe' using errcode = '42501';
  end if;

  /*
   * Le dernier parti emporte le groupe.
   *
   * Un groupe sans personne dedans ne se retrouve plus : il n'apparait dans
   * aucune liste et personne ne peut y revenir. Le laisser serait accumuler des
   * salons invisibles pour toujours.
   */
  select count(*) into restants
    from public.dm_participants
   where channel_id = p_channel_id;

  if restants = 0 then
    delete from public.channels where id = p_channel_id;
  end if;
end;
$$;

/**
 * Renomme un groupe.
 *
 * N'importe quel membre le peut : un groupe n'a pas de proprietaire, et
 * inventer un role pour trois personnes qui se parlent serait une ceremonie
 * pour rien. Le nom vide revient au defaut plutot que de laisser une entree
 * sans etiquette dans la liste.
 */
create or replace function public.renommer_groupe(p_channel_id uuid, p_nom text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.dm_participants
     where channel_id = p_channel_id and user_id = moi
  ) then
    raise exception 'Vous ne faites pas partie de ce groupe' using errcode = '42501';
  end if;

  update public.channels
     set name = coalesce(nullif(trim(p_nom), ''), 'Groupe')
   where id = p_channel_id and kind = 'group';

  if not found then
    raise exception 'Seul un groupe se renomme' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.quitter_groupe(uuid) from public, anon;
revoke all on function public.renommer_groupe(uuid, text) from public, anon;
grant execute on function public.quitter_groupe(uuid) to authenticated;
grant execute on function public.renommer_groupe(uuid, text) to authenticated;
