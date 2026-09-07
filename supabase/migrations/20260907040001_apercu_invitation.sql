-- De quoi montrer un espace avant d'y entrer.
--
-- Le defaut, tel qu'il a ete rapporte : « les liens d'invite marchent pas ».
-- Ils avaient trois problemes qui se cumulaient — l'adresse produite,
-- l'adresse servie, et ce qu'on voit avant de cliquer. Cette migration ne
-- traite que le troisieme.
--
-- Un lien d'invitation s'envoie, la plupart du temps, DANS Echow. Ce qu'on
-- voyait alors etait une adresse nue : douze caracteres au hasard derriere un
-- nom de domaine. Rien ne disait de quel serveur il s'agissait, et l'on
-- cliquait — ou non — sans savoir.
--
-- Pourquoi une fonction plutot qu'une politique de lecture
-- --------------------------------------------------------
-- La table des espaces n'est lisible que de ses membres, et c'est ce qu'il
-- faut : la liste des serveurs de quelqu'un ne regarde personne. Mais celui a
-- qui l'on envoie une invitation n'est, par definition, pas encore membre.
--
-- Ouvrir la lecture aux non-membres reviendrait a publier le nom et l'image de
-- tous les espaces a qui sait lire une table. Une fonction `security definer`
-- ne rend que ce qui est demande, pour UN code precis — et c'est exactement le
-- droit qu'une invitation confere : connaitre le code, c'est deja pouvoir
-- entrer.
--
-- Ce qu'elle ne rend pas
-- ----------------------
-- Ni la liste des membres, ni les salons, ni l'identifiant de l'espace. Le
-- nom, les deux images, le nombre de membres, et la date d'expiration. De quoi
-- decider si l'on entre, pas de quoi observer un serveur sans y etre.

create or replace function public.apercu_invitation(p_code text)
returns table (
  nom         text,
  icone_url   text,
  banniere_url text,
  membres     bigint,
  expire      boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    e.name,
    e.icon_url,
    e.banner_url,
    (select count(*) from public.space_members m where m.space_id = e.id),
    /*
     * L'expiration est rendue plutot que filtree.
     *
     * Ne rien rendre pour un code perime donnerait le meme resultat qu'un code
     * inexistant, et les deux n'appellent pas la meme phrase : « ce lien a
     * expire, redemandez-en un » se corrige, « ce lien n'existe pas » non.
     */
    (e.invite_expires_at is not null and e.invite_expires_at < now())
  from public.spaces e
  where e.invite_code = lower(trim(p_code))
  limit 1;
$$;

comment on function public.apercu_invitation is
  'Ce qu''on peut montrer d''un espace a qui detient son code d''invitation, '
  'sans en etre membre : le nom, les images, le nombre de membres. Ni les '
  'salons, ni les membres, ni l''identifiant.';

/*
 * Ouverte a tous, y compris hors session.
 *
 * Un lien d'invitation s'ouvre souvent avant de se connecter — c'est meme le
 * cas le plus courant pour quelqu'un qui decouvre Echow. Lui montrer une carte
 * vide jusqu'a ce qu'il ait un compte serait lui demander de s'inscrire pour
 * savoir a quoi.
 */
revoke all on function public.apercu_invitation(text) from public;
grant execute on function public.apercu_invitation(text) to anon, authenticated;
