-- Le cadrage de la banniere de profil.
--
-- La banniere etait posee en `object-fit: cover`, ce qui la centre et rogne le
-- reste. Une image dont le sujet n'est pas au milieu — un visage a gauche, un
-- titre en haut — se retrouvait donc coupee, sans aucun moyen d'y remedier
-- autre que rouvrir un editeur d'images et recadrer le fichier avant de
-- l'envoyer. Sur telephone, ou l'on choisit une photo prise a l'instant, cela
-- revenait a ne pas pouvoir se servir de la fonction.
--
-- Trois nombres suffisent a tout dire : ou regarder, et de combien grossir.
--
-- Une colonne `jsonb` plutot que trois colonnes numeriques. Ces trois nombres
-- ne veulent rien dire l'un sans les autres — on ne cherchera jamais les
-- profils par leur decalage horizontal — et ils vont toujours ensemble, en
-- lecture comme en ecriture. Une colonne se lit, se remet a `null` et se
-- transporte d'un bloc.
--
-- `null` signifie « cadrage par defaut », c'est-a-dire centre sans
-- grossissement. C'est ce que valent tous les profils existants, et cela evite
-- d'ecrire une valeur a des gens qui n'ont rien demande.

alter table public.profiles
  add column if not exists banner_frame jsonb;

/*
 * La forme est verifiee par la base, pas seulement par l'application.
 *
 * `profiles` s'ecrit directement depuis le client — il n'y a pas de fonction
 * intermediaire pour la modification de son propre profil. Sans contrainte
 * ici, n'importe quoi pourrait s'y loger : un objet vide, une chaine, un zoom
 * a mille qui rendrait la fiche illisible pour tous ceux qui l'ouvrent.
 *
 * Les bornes sont celles de l'interface, un cran plus larges : x et y sont des
 * pourcentages, le grossissement va de un a trois. Au-dela de trois, une image
 * de banniere ordinaire devient une bouillie de pixels ; en dessous de un, elle
 * ne remplirait plus le cadre et laisserait paraitre le fond.
 */
alter table public.profiles
  drop constraint if exists profiles_banner_frame_valide;

alter table public.profiles
  add constraint profiles_banner_frame_valide check (
    banner_frame is null
    or (
      jsonb_typeof(banner_frame) = 'object'
      and jsonb_typeof(banner_frame -> 'x') = 'number'
      and jsonb_typeof(banner_frame -> 'y') = 'number'
      and jsonb_typeof(banner_frame -> 'zoom') = 'number'
      and (banner_frame ->> 'x')::numeric between 0 and 100
      and (banner_frame ->> 'y')::numeric between 0 and 100
      and (banner_frame ->> 'zoom')::numeric between 1 and 3
    )
  );

comment on column public.profiles.banner_frame is
  'Cadrage de la banniere : {"x": 0-100, "y": 0-100, "zoom": 1-3}. '
  'x et y sont un object-position en pourcentage, zoom un facteur d''echelle. '
  'null vaut centre et sans grossissement.';
