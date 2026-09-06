-- La pochette ne tenait pas dans la colonne qui devait la porter.
--
-- Le defaut, tel qu'il a ete rapporte : « quand j'ecoute un son spotify les
-- autres voient pas sur mon profil l'embed, ya que moi qui vois le mien ».
--
-- Ce n'est pas un probleme de droits : la politique de lecture est
-- `using (true)`, et tout le monde peut lire la table. C'est l'ECRITURE qui
-- n'aboutissait jamais.
--
-- `image_url` porte la pochette du morceau. Elle ne vient pas d'une adresse :
-- Windows la rend sous forme d'octets, et on la reduit a 72 pixels avant de
-- l'envoyer — ce qui donne une adresse `data:` de trois mille caracteres
-- environ, mesuree a 3079 pour une image bien remplie.
--
-- La colonne en acceptait CINQ CENTS. Chaque annonce portant une pochette
-- violait donc la contrainte et etait rejetee. Comme personne ne regardait le
-- resultat de l'ecriture, et que l'interface posait l'activite dans son propre
-- etat juste apres, celui qui ecoutait voyait sa fiche parfaitement a jour.
-- Les autres ne voyaient rien, et il n'existait aucune trace de l'echec.
--
-- Les deux nombres n'ont jamais ete confrontes : la limite a ete ecrite en
-- pensant a une adresse, la reduction en pensant a des octets, et rien ne
-- reliait les deux fichiers.

/*
 * Douze mille caracteres : quatre fois ce qui est mesure.
 *
 * La marge n'est pas de la prudence vague. Une pochette photographique se
 * comprime moins bien qu'un degrade, et la reduction pourrait un jour passer a
 * quatre-vingt-seize pixels. Douze mille couvre ces cas sans ouvrir la porte a
 * une image de taille reelle — neuf kilo-octets une fois decodee, la ou une
 * pochette non reduite en pese deux cent vingt-cinq.
 *
 * La borne compte : cette ligne est lue par toute personne qui ouvre la fiche.
 * Ce qui n'est pas transmis ne coute rien a personne, et le quota d'egress est
 * deja la ou il est.
 */
alter table public.activites
  drop constraint if exists activites_image_url_check;

alter table public.activites
  add constraint activites_image_url_check
  check (image_url is null or char_length(image_url) <= 12000);

comment on column public.activites.image_url is
  'Pochette du morceau, en adresse `data:` deja reduite par le client '
  '(72 pixels, JPEG 0,7 — environ trois mille caracteres). Ce n''est pas une '
  'adresse distante : Windows rend les octets, pas un lien. La limite est '
  'tenue des deux cotes, ici et dans `ecoute.ts` : voir POCHETTE_MAX.';
