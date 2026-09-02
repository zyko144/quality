-- Les badges par paliers, et le temps passe en vocal.
--
-- Deux badges uniques devenaient deux series. « A ecrit mille messages » et
-- « a passe dix heures en vocal » se decrochent en une semaine et ne disent
-- plus rien ensuite : ce sont des seuils de depart, pas des recompenses. Une
-- serie garde une marche devant soi pendant des annees.
--
-- Le temps en vocal, lui, n'etait mesure nulle part. Un badge qui recompense
-- une chose qu'on ne compte pas ne peut pas etre attribue.

-- ===========================================================================
-- 1. Le temps passe en salon vocal
-- ===========================================================================
--
-- Un total cumule, en secondes, et rien d'autre. On pourrait garder chaque
-- session — qui, quel salon, de quand a quand — et cela permettrait des
-- statistiques. Mais ce serait un journal de presence : qui etait ou, avec qui,
-- pendant combien de temps, conserve indefiniment. Un total ne dit que « a
-- beaucoup discute », ce qui est tout ce dont un badge a besoin.
--
-- Les secondes plutot que les heures : une session de vingt minutes ne doit pas
-- disparaitre dans un arrondi, et trois cents sessions de vingt minutes font
-- cent heures.

create table if not exists public.temps_vocal (
  profil_id uuid primary key references public.profiles (id) on delete cascade,
  secondes  bigint not null default 0 check (secondes >= 0),
  maj_le    timestamptz not null default now()
);

alter table public.temps_vocal enable row level security;

-- Lisible par tous : les badges qui en decoulent s'affichent sur les profils,
-- et cacher le total tout en montrant le badge n'aurait pas de sens.
drop policy if exists temps_vocal_lecture on public.temps_vocal;
create policy temps_vocal_lecture on public.temps_vocal for select to authenticated
  using (true);

/*
 * Ajoute du temps au total.
 *
 * Le plafond par appel est la seule protection qui compte ici : sans lui, un
 * appel bricole pourrait s'attribuer mille heures d'un coup, et un badge
 * « cinq mille heures » obtenu en une requete ne vaudrait plus rien.
 *
 * Quinze minutes, pour un rapport attendu toutes les cinq : trois fois la
 * marge. Un rapport retarde par une machine en veille passe ; un total invente
 * ne passe pas. Au pire, quelqu'un qui triche gagne quinze minutes par appel,
 * ce qui demande vingt mille appels pour le dernier palier.
 */
create or replace function public.ajouter_temps_vocal(p_secondes integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.temps_vocal as t (profil_id, secondes)
  values ((select auth.uid()), least(greatest(p_secondes, 0), 900))
  on conflict (profil_id) do update
    set secondes = t.secondes + least(greatest(p_secondes, 0), 900),
        maj_le = now();
$$;

grant execute on function public.ajouter_temps_vocal(integer) to authenticated;

-- ===========================================================================
-- 2. Les paliers
-- ===========================================================================
--
-- Les deux badges uniques disparaissent au profit de leurs series. Leurs
-- attributions partent avec eux : personne ne les avait obtenus autrement
-- qu'en passant le premier palier, qui existe toujours sous un autre nom.

delete from public.profil_badges where badge_cle in ('bavard', 'veilleur');
delete from public.badges where cle in ('bavard', 'veilleur');

/*
 * Le temps en vocal, en sept marches.
 *
 * Les intervalles s'ecartent a mesure qu'on monte : dix, cinquante, cent, cent
 * cinquante, trois cents, cinq cents, cinq mille. C'est ce qui garde une marche
 * atteignable au debut et une marche lointaine a la fin — une serie reguliere
 * serait trop lente au depart et trop rapide ensuite.
 *
 * Cinq mille heures, c'est sept mois de conversation continue. Il est possible
 * que personne ne l'obtienne jamais, et c'est tres bien : un dernier palier
 * qu'on atteint n'est plus un dernier palier.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('vocal-10',   'Voix — 10 h',    'A passe dix heures en salon vocal.',                                  'succes', '#9b59b6', null, 40),
  ('vocal-50',   'Voix — 50 h',    'A passe cinquante heures en salon vocal.',                            'succes', '#9b59b6', null, 41),
  ('vocal-100',  'Voix — 100 h',   'A passe cent heures en salon vocal.',                                 'succes', '#8e44ad', null, 42),
  ('vocal-150',  'Voix — 150 h',   'A passe cent cinquante heures en salon vocal.',                       'succes', '#8e44ad', null, 43),
  ('vocal-300',  'Voix — 300 h',   'A passe trois cents heures en salon vocal.',                          'succes', '#7d3c98', null, 44),
  ('vocal-500',  'Voix — 500 h',   'A passe cinq cents heures en salon vocal.',                           'succes', '#6c3483', null, 45),
  ('vocal-5000', 'Voix — 5000 h',  'A passe cinq mille heures en salon vocal. Sept mois de conversation.', 'succes', '#4a235a', null, 46)
on conflict (cle) do nothing;

/*
 * Les messages, en cinq marches.
 *
 * Mille etait un seuil de depart : on le franchit en une semaine, et le badge
 * ne dit plus rien ensuite. La serie commence donc a dix mille, et le dernier
 * palier — un million — est du meme ordre que les cinq mille heures : une borne
 * qu'on regarde plus qu'on ne l'atteint.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('messages-10k',  'Plume — 10 000',    'A ecrit dix mille messages.',                             'succes', '#00a8fc', null, 50),
  ('messages-50k',  'Plume — 50 000',    'A ecrit cinquante mille messages.',                       'succes', '#0091d5', null, 51),
  ('messages-100k', 'Plume — 100 000',   'A ecrit cent mille messages.',                            'succes', '#0079b0', null, 52),
  ('messages-500k', 'Plume — 500 000',   'A ecrit cinq cent mille messages.',                       'succes', '#00618c', null, 53),
  ('messages-1m',   'Plume — 1 million', 'A ecrit un million de messages. Personne n''a fait cela.', 'succes', '#004a68', null, 54)
on conflict (cle) do nothing;

-- ===========================================================================
-- 3. Fondateur, en paliers
-- ===========================================================================
--
-- « Dix membres » etait un seuil de depart, comme les mille messages : on le
-- franchit le premier week-end. La serie va de cent a un million, ce qui couvre
-- toute la vie d'un espace — du groupe d'amis qui a pris a la communaute qu'on
-- ne connait plus en entier.

delete from public.profil_badges where badge_cle = 'fondateur';
delete from public.badges where cle = 'fondateur';

/*
 * Les quatre marches d'un espace.
 *
 * Cent, dix mille, cent mille, un million. L'ecart entre la premiere et la
 * seconde est enorme, et c'est voulu : entre les deux il n'y a pas de palier
 * parce qu'il n'y a pas de difference de nature. Un espace de mille membres et
 * un de cinq mille se ressemblent ; un de cent et un de dix mille n'ont plus
 * rien a voir.
 */
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  ('espace-100',  'Fondateur — 100',    'A cree un espace qui compte au moins cent membres.',                            'succes', '#3ba55d', null, 60),
  ('espace-10k',  'Fondateur — 10 000', 'A cree un espace qui compte au moins dix mille membres.',                       'succes', '#2d8a4a', null, 61),
  ('espace-100k', 'Fondateur — 100 000','A cree un espace qui compte au moins cent mille membres.',                      'succes', '#1f6e38', null, 62),
  ('espace-1m',   'Fondateur — 1 million', 'A cree un espace qui compte au moins un million de membres.',                'succes', '#145227', null, 63)
on conflict (cle) do nothing;
