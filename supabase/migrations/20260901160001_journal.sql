-- Le journal de l'application.
--
-- Pourquoi une table plutot que la console du navigateur
-- ------------------------------------------------------
-- Un defaut signale par quelqu'un d'autre n'est jamais reproductible sur la
-- machine de celui qui doit le corriger. « Le partage a coupe » n'apprend rien ;
-- « le partage a coupe apres douze secondes, en 1440p, avec deux pairs, sur un
-- peripherique a 44,1 kHz » se corrige. La console du navigateur contient tout
-- cela et n'en sort jamais : elle vit sur la machine ou personne ne la lit.
--
-- Ce qui n'entre jamais ici
-- -------------------------
-- Aucun contenu de message, aucun nom de fichier partage, aucune adresse IP.
-- Le journal sert a comprendre un defaut, pas a savoir ce que les gens se
-- disent — et une table de diagnostic finit toujours par etre lue plus
-- largement que prevu. Ce qu'on n'y met pas ne peut pas fuir.
--
-- `detail` est volontairement du jsonb libre, avec une borne de taille : le
-- format d'un diagnostic change a chaque defaut poursuivi, et une colonne par
-- champ obligerait a une migration pour chaque question nouvelle.
--
-- Qui lit
-- -------
-- Personne, par l'API publique : aucune politique de lecture n'est posee. La
-- console de l'equipe se connecte avec la cle de service, qui contourne RLS par
-- construction, et cette cle ne quitte pas la machine de l'equipe. Un role
-- « lecteur du journal » cote base serait une porte que personne ne surveille.

create table if not exists public.journal (
  id          bigint generated always as identity primary key,
  au          timestamptz not null default now(),

  -- Quatre niveaux, pas davantage. Au-dela, on passe plus de temps a choisir le
  -- niveau qu'a ecrire la ligne, et le filtre cesse de vouloir dire quelque chose.
  niveau      text not null default 'info'
    check (niveau in ('trace', 'info', 'alerte', 'erreur')),

  -- La partie de l'application concernee : `vocal`, `partage`, `reseau`,
  -- `session`, `interface`, `mise-a-jour`… Libre, mais borne : c'est ce qui
  -- permet de suivre un defaut sans connaitre d'avance son nom.
  domaine     text not null check (char_length(domaine) between 2 and 40),

  -- Court par construction. Un journal se lit en diagonale ; ce qui est long va
  -- dans `detail`, ou l'on ne descend que lorsqu'on a trouve la bonne ligne.
  message     text not null check (char_length(message) between 1 and 300),

  -- Borne a huit kilo-octets sous forme texte. Sans borne, une trace d'appel
  -- profonde ou un objet d'erreur circulaire remplirait la table a lui seul.
  detail      jsonb check (detail is null or octet_length(detail::text) <= 8192),

  -- Nul avant la connexion : les defauts d'ouverture de session sont
  -- precisement ceux qu'on ne peut rattacher a personne, et ce sont aussi ceux
  -- qu'on a le plus besoin de voir.
  auteur_id   uuid references public.profiles (id) on delete set null,

  -- Identifiant de l'execution en cours, tire au lancement. C'est lui qui
  -- permet de recoudre les lignes d'une meme seance quand plusieurs personnes
  -- ecrivent en meme temps — l'auteur ne suffit pas, on ouvre deux fenetres.
  seance      text check (seance is null or char_length(seance) between 4 and 40),

  version     text check (version is null or char_length(version) <= 20),

  plateforme  text check (plateforme is null or plateforme in ('bureau', 'web'))
);

-- Le journal se lit toujours du plus recent au plus ancien : c'est l'ordre de
-- toutes les questions qu'on lui pose.
create index if not exists journal_au_idx on public.journal (au desc);

-- Deux filtres suffisent a couvrir l'usage reel : « montre-moi les erreurs » et
-- « montre-moi ce qu'a vecu cette personne ».
create index if not exists journal_niveau_au_idx on public.journal (niveau, au desc);
create index if not exists journal_auteur_au_idx on public.journal (auteur_id, au desc);
create index if not exists journal_domaine_au_idx on public.journal (domaine, au desc);

alter table public.journal enable row level security;

/*
 * On ecrit, on ne lit pas.
 *
 * L'insertion est ouverte aux visiteurs non connectes autant qu'aux membres :
 * un echec d'ouverture de session n'a pas d'auteur, et c'est exactement le
 * moment ou l'on voudrait une ligne. Le prix est un risque d'ecriture abusive,
 * qu'on accepte en connaissance de cause — la table est bornee en taille par
 * ses contraintes, et la console offre une purge.
 *
 * Ce qui n'est PAS accepte, c'est qu'on ecrive au nom d'un autre : `auteur_id`
 * doit etre nul ou le sien. Sans ce test, n'importe qui pourrait fabriquer un
 * journal accablant pour quelqu'un d'autre.
 */
drop policy if exists "journal: ecrire pour soi" on public.journal;
create policy "journal: ecrire pour soi"
  on public.journal for insert
  to anon, authenticated
  with check (auteur_id is null or auteur_id = auth.uid());

-- Aucune politique de lecture, de modification ou de suppression : voir l'en-tete.

/*
 * La console suit le journal en direct.
 *
 * Sans cela, il faudrait reinterroger la table a intervalle regulier pour voir
 * arriver une erreur — et l'interet d'un journal, quand on accompagne quelqu'un
 * au telephone, est precisement de voir la ligne apparaitre pendant qu'il parle.
 */
alter table public.journal replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'journal'
  ) then
    alter publication supabase_realtime add table public.journal;
  end if;
end $$;
