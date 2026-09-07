-- Un badge qui ne figure pas au catalogue.
--
-- Le dessin est arrive dans le depot sous son nom de telechargement —
-- `5301b03b-1378-4dad-8233-7dba7d84ad23.png` — et il ne suffit pas de le
-- deposer : le lien entre un badge et son image est le NOM DU FICHIER. Voir
-- `dessinsBadges.ts`, qui les apparie sans table a tenir a jour. Un dessin dont
-- le nom ne correspond a aucune cle n'est jamais affiche, et rien ne le
-- signale. Le fichier s'appelle donc `singe.png`, et la cle ci-dessous `singe`.
--
-- Pourquoi une colonne plutot qu'un cas particulier
-- -------------------------------------------------
-- La page « Badges » liste le catalogue par famille : tout ce qui est dans la
-- table s'y montre, obtenu ou non. C'est ce qu'on veut d'un catalogue — on y
-- vient pour savoir ce qui existe et ce qu'il reste a faire.
--
-- Un badge donne a la main n'a pas sa place dans cette liste. Il n'y a rien a
-- faire pour l'obtenir : l'y montrer poserait une question sans reponse, et la
-- seule reponse honnete — « celui-la, on ne peut pas l'avoir » — ne vaut pas
-- la peine d'etre affichee a tout le monde.
--
-- Ecarter cette cle-la dans le code de la page aurait marche aujourd'hui et
-- serait devenu faux au deuxieme badge du meme genre. La table dit donc
-- elle-meme ce qui se montre.

alter table public.badges
  add column if not exists cache boolean not null default false;

comment on column public.badges.cache is
  'Un badge cache ne figure pas au catalogue de la page « Badges ». Il '
  's''affiche normalement sur la fiche de qui le porte, et le tableau de bord '
  'de l''equipe continue de le lister : c''est de la, et de la seulement, '
  'qu''il se donne.';

/*
 * Le badge lui-meme.
 *
 * `reserve` autant que `cache`, et les deux ne disent pas la meme chose :
 * `reserve` empeche de le PRENDRE — sans quoi `attribuer_badge` l'accorderait
 * au premier demarrage venu, puisqu'aucune condition ne le protege — tandis
 * que `cache` empeche de le VOIR dans la liste. Il faut les deux : un badge
 * seulement cache serait invisible et distribue quand meme.
 *
 * Le nom visible reste a decider. « Singe » decrit ce qu'on voit, rien de
 * plus ; le changer ne coute qu'une ligne ici tant que la migration n'est pas
 * appliquee. La cle, elle, a interet a ne plus bouger : elle nomme le fichier,
 * et les deux doivent rester d'accord.
 *
 * Le neon n'est pas dans le style, il est dans l'image. Le halo du C.E.O vient
 * d'une regle CSS visant `data-badge='ceo'` ; ce dessin-ci porte le sien dans
 * ses pixels. Il n'a besoin de rien, et surtout pas qu'on elargisse cette
 * regle — elle lui ajouterait un second halo, d'une autre couleur.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang, reserve, cache)
values (
  'singe',
  'Singe',
  'Donne a la main.',
  'equipe',
  -- L'or du dessin, pour que la lueur de la vitrine s'accorde avec lui.
  '#f5a623',
  null,
  5,
  true,
  true
)
on conflict (cle) do update
   set nom         = excluded.nom,
       description = excluded.description,
       famille     = excluded.famille,
       teinte      = excluded.teinte,
       rang        = excluded.rang,
       reserve     = excluded.reserve,
       cache       = excluded.cache;
