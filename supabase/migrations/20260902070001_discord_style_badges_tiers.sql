-- ===========================================================================
-- Paliers complets des badges style Discord, raretes et effets visuels
-- ===========================================================================

-- 1. Nettoyage et mise a jour des anciens badges pour la nouvelle structure
delete from public.badges where cle in (
  'pionnier', 'premiere-heure', 'equipe', 'rapporteur', 'fondateur',
  'espace-10', 'espace-100', 'espace-10k', 'espace-100k', 'espace-1m',
  'messages-10k', 'messages-50k', 'messages-100k', 'messages-500k', 'messages-1m',
  'vocal-10', 'vocal-50', 'vocal-100', 'vocal-150', 'vocal-300', 'vocal-500', 'vocal-1000', 'vocal-3000', 'vocal-5000',
  'fidele', 'anciennete-1an', 'anciennete-3ans', 'anciennete-5ans', 'anciennete-7ans', 'anciennete-10ans'
);

-- 2. Insertion du catalogue complet avec ordre et teintes evolutives
insert into public.badges (cle, nom, description, famille, teinte, limite, rang) values
  -- Statuts Speciaux & Soutien (Rarete Mythique / Exclusive)
  ('pionnier',        'Pionnier',            'Parmi les cent premiers comptes ouverts sur Echow. Cette course est terminee des que le centieme est arrive.', 'soutien',    '#f59e0b', 100,  1),
  ('premiere-heure',  'Premiere heure',      'Present le jour de l''ouverture. Ne pourra plus jamais etre obtenu.',                                          'soutien',    '#ec4899', null, 2),
  ('equipe',          'Equipe Echow',        'Membre de l''equipe qui construit Echow.',                                                                     'equipe',     '#6366f1', null, 3),
  ('rapporteur',      'Chasseur de bogues',  'A signale un defaut qui a ete corrige.',                                                                       'succes',     '#10b981', null, 4),

  -- Serie Batisseur d'Espace (Paliers Communaute)
  ('espace-10',       'Batisseur — 10',      'A cree un espace qui compte au moins dix membres.',                                                            'succes',     '#22c55e', null, 10),
  ('espace-10k',      'Batisseur — 10 000',  'A cree un espace qui compte au moins dix mille membres.',                                                       'succes',     '#06b6d4', null, 11),
  ('espace-100k',     'Batisseur — 100 000', 'A cree un espace qui compte au moins cent mille membres.',                                                      'succes',     '#8b5cf6', null, 12),
  ('espace-1m',       'Batisseur — 1M',      'A cree un espace qui compte au moins un million de membres. Royaume mythique.',                                 'succes',     '#f43f5e', null, 13),

  -- Serie Messagerie (Paliers Textuels)
  ('messages-10k',    'Plume — 10 000',      'A ecrit dix mille messages.',                                                                                   'succes',     '#38bdf8', null, 20),
  ('messages-50k',    'Plume — 50 000',      'A ecrit cinquante mille messages.',                                                                             'succes',     '#3b82f6', null, 21),
  ('messages-100k',   'Plume — 100 000',     'A ecrit cent mille messages.',                                                                                  'succes',     '#a855f7', null, 22),
  ('messages-500k',   'Plume — 500 000',     'A ecrit cinq cent mille messages.',                                                                             'succes',     '#f97316', null, 23),
  ('messages-1m',     'Plume — 1 million',   'A ecrit un million de messages. Une legende vivante.',                                                          'succes',     '#ec4899', null, 24),

  -- Serie Vocal (Paliers Temps en Salon Vocal)
  ('vocal-10',        'Voix — 10 h',         'A passe dix heures en salon vocal.',                                                                            'succes',     '#c084fc', null, 30),
  ('vocal-50',        'Voix — 50 h',         'A passe cinquante heures en salon vocal.',                                                                      'succes',     '#a855f7', null, 31),
  ('vocal-150',       'Voix — 150 h',        'A passe cent cinquante heures en salon vocal.',                                                                 'succes',     '#7c3aed', null, 32),
  ('vocal-500',       'Voix — 500 h',        'A passe cinq cents heures en salon vocal.',                                                                     'succes',     '#ef4444', null, 33),
  ('vocal-1000',      'Voix — 1 000 h',      'A passe mille heures en salon vocal.',                                                                          'succes',     '#eab308', null, 34),
  ('vocal-3000',      'Voix — 3 000 h',      'A passe trois mille heures en salon vocal.',                                                                    'succes',     '#06b6d4', null, 35),
  ('vocal-5000',      'Voix — 5 000 h',      'A passe cinq mille heures en salon vocal. Aura cosmique supreme.',                                              'succes',     '#d946ef', null, 36),

  -- Serie Anciennete (Paliers Annees)
  ('anciennete-1an',   'Veteran — 1 an',     'Compte ouvert depuis plus d''un an.',                                                                          'anciennete', '#94a3b8', null, 40),
  ('anciennete-3ans',  'Veteran — 3 ans',    'Compte ouvert depuis plus de trois ans.',                                                                      'anciennete', '#f59e0b', null, 41),
  ('anciennete-5ans',  'Veteran — 5 ans',    'Compte ouvert depuis plus de cinq ans.',                                                                      'anciennete', '#3b82f6', null, 42),
  ('anciennete-7ans',  'Veteran — 7 ans',    'Compte ouvert depuis plus de sept ans.',                                                                      'anciennete', '#e11d48', null, 43),
  ('anciennete-10ans', 'Veteran — 10 ans',   'Compte ouvert depuis plus de dix ans. Maitre du temps.',                                                       'anciennete', '#8b5cf6', null, 44)
on conflict (cle) do update set
  nom = excluded.nom,
  description = excluded.description,
  famille = excluded.famille,
  teinte = excluded.teinte,
  limite = excluded.limite,
  rang = excluded.rang;
