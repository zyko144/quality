-- Deux badges changent de nom.
--
-- « Chasseur de bogues » devient « Bug Hunter », qui est le nom porte par son
-- dessin — un scarabee de circuits, legende BUG HUNTER sur la planche
-- d'origine. Un badge dont l'illustration dit un nom et dont le texte en dit un
-- autre oblige a choisir lequel est le vrai.
--
-- « Pionnier » devient « 100 premiers soutiens ». Le nom precedent ne disait pas
-- ce qui fait la valeur de ce badge : qu'il n'y a que cent places, et qu'elles
-- se ferment. « Pionnier » se comprend apres avoir lu la description ; « 100
-- premiers soutiens » se comprend avant.
--
-- Les cles ne bougent pas. Elles sont la seule chose que le code lit —
-- attribution, paliers, nom de fichier du dessin — et les renommer casserait
-- tout pour un affichage. Un nom se lit, une cle s'utilise.

update public.badges
   set nom = 'Bug Hunter'
 where cle = 'rapporteur';

update public.badges
   set nom = '100 premiers soutiens'
 where cle = 'pionnier';
