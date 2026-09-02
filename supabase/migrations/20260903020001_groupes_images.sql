-- Une photo et une banniere pour les groupes.
--
-- Un groupe n'avait qu'un nom. Trois groupes avec les memes personnes se
-- distinguaient donc par leur intitule seul, dans une liste ou l'on reconnait
-- tout le reste a une image — les conversations a deux ont un visage, les
-- espaces ont une icone.
--
-- Les colonnes vont sur `channels` plutot que dans une table a part : un groupe
-- EST un salon, et lui inventer une table pour deux colonnes obligerait a
-- joindre partout ou l'on affiche une conversation.

alter table public.channels
  add column if not exists icon_url text,
  add column if not exists banner_url text;

/**
 * Change la photo ou la banniere d'un groupe.
 *
 * Ouverte a tout membre, comme le renommage : un groupe n'a pas de
 * proprietaire. `p_url` a `null` retire l'image et fait revenir aux initiales.
 *
 * La verification d'appartenance est faite ICI plutot que par une politique :
 * la fonction est en `security definer`, donc les politiques de `channels` ne
 * s'appliquent pas a l'ecriture qu'elle fait. C'est le prix a payer pour
 * pouvoir ecrire, et la condition doit donc etre reecrite a la main.
 */
create or replace function public.image_groupe(
  p_channel_id uuid,
  p_genre text,
  p_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  moi uuid := (select auth.uid());
begin
  if p_genre not in ('icon', 'banner') then
    raise exception 'Genre d''image inconnu' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.dm_participants
     where channel_id = p_channel_id and user_id = moi
  ) then
    raise exception 'Vous ne faites pas partie de ce groupe' using errcode = '42501';
  end if;

  update public.channels
     set icon_url   = case when p_genre = 'icon'   then p_url else icon_url end,
         banner_url = case when p_genre = 'banner' then p_url else banner_url end
   where id = p_channel_id and kind = 'group';

  if not found then
    raise exception 'Seul un groupe porte une image' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.image_groupe(uuid, text, text) from public, anon;
grant execute on function public.image_groupe(uuid, text, text) to authenticated;
