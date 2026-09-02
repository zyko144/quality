-- Les paliers, tels qu'ils ont ete demandes.
--
-- Trois migrations ont touche au catalogue en une heure, et les deux dernieres
-- ne s'accordaient ni entre elles ni avec la demande. Celle-ci tranche, et
-- s'applique en dernier.
--
-- Ce qui change, et pourquoi
-- --------------------------
-- **Les espaces partent de cent membres**, pas de dix. Dix membres, c'est un
-- groupe d'amis qui vient d'ouvrir un salon : le badge serait obtenu le premier
-- week-end et ne dirait plus rien ensuite. Cent est le moment ou l'on ne
-- connait plus tout le monde de vue.
--
-- **Le vocal gagne cent et trois cents heures.** Entre cinquante et cent
-- cinquante il y avait un trou, et entre cent cinquante et cinq cents un
-- gouffre : on restait des mois sans marche devant soi, ce qui est exactement
-- ce qu'une serie doit eviter.
--
-- Les paliers ajoutes par ailleurs — mille et trois mille heures, les cinq
-- annees d'anciennete — sont gardes : ils comblent le haut de la serie, la ou
-- il ne restait rien apres cinq cents heures.
--
-- Le code ne recopie plus ces seuils : il les lit dans la cle. Voir
-- `src/features/badges/paliers.ts`. C'est ce qui empeche la prochaine
-- divergence, et non la vigilance.

-- ===========================================================================
-- 1. Les espaces partent de cent
-- ===========================================================================

delete from public.profil_badges where badge_cle = 'espace-10';
delete from public.badges where cle = 'espace-10';

insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('espace-100', 'Batisseur — 100', 'A cree un espace qui compte au moins cent membres.', 'succes', '#22c55e', null, 10)
on conflict (cle) do update set
  nom = excluded.nom,
  description = excluded.description,
  famille = excluded.famille,
  teinte = excluded.teinte,
  rang = excluded.rang;

-- ===========================================================================
-- 2. Le vocal comble ses trous
-- ===========================================================================

insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('vocal-100', 'Voix — 100 h', 'A passe cent heures en salon vocal.',             'succes', '#b47ef0', null, 315),
  ('vocal-300', 'Voix — 300 h', 'A passe trois cents heures en salon vocal.',      'succes', '#9333ea', null, 325)
on conflict (cle) do update set
  nom = excluded.nom,
  description = excluded.description,
  famille = excluded.famille,
  teinte = excluded.teinte,
  rang = excluded.rang;

/*
 * Les rangs sont reecrits pour que la serie se lise dans l'ordre.
 *
 * Les paliers precedents occupaient 30 a 36 ; y glisser cent et trois cents
 * demandait des rangs intermediaires que des entiers ne permettent pas. On
 * multiplie donc l'echelle par dix — trois cents, trois cent dix, trois cent
 * quinze — ce qui laisse de la place entre chaque marche pour celles qu'on
 * ajoutera ensuite.
 *
 * Sans cela, « 100 h » s'afficherait apres « 5 000 h », et une serie qui ne se
 * lit pas dans l'ordre n'est plus une serie.
 */
update public.badges set rang = 300 where cle = 'vocal-10';
update public.badges set rang = 310 where cle = 'vocal-50';
update public.badges set rang = 320 where cle = 'vocal-150';
update public.badges set rang = 330 where cle = 'vocal-500';
update public.badges set rang = 340 where cle = 'vocal-1000';
update public.badges set rang = 350 where cle = 'vocal-3000';
update public.badges set rang = 360 where cle = 'vocal-5000';

-- ===========================================================================
-- 3. Ce que le code sait attribuer
-- ===========================================================================
--
-- Toute cle de la forme `vocal-<n>`, `messages-<n>[k|m]`, `espace-<n>[k|m]` ou
-- `anciennete-<n>ans` est attribuee automatiquement, sans changer une ligne de
-- TypeScript. Les autres — `pionnier`, `premiere-heure`, `equipe`,
-- `rapporteur` — le sont autrement, ou a la main.
--
-- Une cle qui ne suit aucune de ces formes ne sera jamais donnee. C'est
-- volontaire : mieux vaut un badge qui n'arrive pas qu'un badge donne au
-- mauvais seuil parce qu'on aurait devine.
