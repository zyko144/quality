-- Serveurs ICE, avec identifiants temporaires.
--
-- Pourquoi cette fonction existe
-- ------------------------------
-- Masquer l'adresse IP des participants suppose de faire passer le trafic par
-- un relais TURN. Un relais ouvert a tous serait aussitot detourne : il faut
-- donc des identifiants.
--
-- Les poser dans `VITE_ICE_SERVERS` ne marche pas. Cette variable est lue a la
-- compilation et finit en clair dans le binaire distribue : n'importe qui peut
-- en extraire les chaines et se servir du relais comme d'un proxy gratuit,
-- facture a son proprietaire.
--
-- coturn accepte pour cela un mecanisme d'identifiants a duree de vie, decrit
-- par le brouillon `draft-uberti-behave-turn-rest` et active par l'option
-- `use-auth-secret` :
--
--     nom d'utilisateur = <horodatage d'expiration>:<identifiant libre>
--     mot de passe      = base64( HMAC-SHA1( secret, nom d'utilisateur ) )
--
-- Le secret ne quitte jamais le serveur. Le client recoit un couple valable une
-- heure, inutilisable ensuite. C'est ce que fait la fonction ci-dessous.
--
-- Ce qu'il reste a faire, cote administration
-- -------------------------------------------
-- Rien ici n'invente de relais. Il faut :
--
--   1. Installer coturn quelque part, avec `use-auth-secret` et un
--      `static-auth-secret` que vous choisissez.
--   2. Poser ce meme secret et l'adresse du relais dans la table de
--      configuration creee plus bas, par exemple :
--
--        insert into public.config_reseau (cle, valeur) values
--          ('turn_url',    'turn:relais.exemple.fr:3478'),
--          ('turn_secret', 'le-secret-de-coturn');
--
-- Tant que ces deux lignes n'existent pas, la fonction ne renvoie que des
-- serveurs STUN publics : l'application marche exactement comme avant, sans
-- masquage. C'est voulu — une protection a moitie posee vaut moins que pas de
-- protection du tout, puisqu'on la croit acquise.

-- ---------------------------------------------------------------------------
-- La configuration, lisible du seul serveur
-- ---------------------------------------------------------------------------

create table if not exists public.config_reseau (
  cle    text primary key,
  valeur text not null
);

alter table public.config_reseau enable row level security;

-- Aucune politique : personne n'y accede depuis un client, jamais. Seules les
-- fonctions `security definer` la lisent. Le secret de coturn est exactement le
-- genre de valeur qui ne doit avoir aucun chemin vers le navigateur.
comment on table public.config_reseau is
  'Configuration reseau du serveur. Aucune politique RLS : lisible des seules fonctions security definer.';

-- ---------------------------------------------------------------------------
-- Les identifiants temporaires
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

create or replace function public.ice_servers()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me         uuid := (select auth.uid());
  url        text;
  secret     text;
  expiration bigint;
  identifiant text;
  motdepasse  text;
  publics    jsonb := jsonb_build_array(
    jsonb_build_object('urls', 'stun:stun.l.google.com:19302'),
    jsonb_build_object('urls', 'stun:stun1.l.google.com:19302')
  );
begin
  -- Reservee aux personnes connectees : un relais est une ressource qui coute,
  -- et l'anonyme n'a aucune raison d'en obtenir l'acces.
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select valeur into url    from public.config_reseau where cle = 'turn_url';
  select valeur into secret from public.config_reseau where cle = 'turn_secret';

  -- Pas de relais configure : on rend les serveurs de decouverte, et
  -- l'application s'en contente. `reseau.ts` sait que l'absence de `turn:`
  -- signifie « masquage impossible » et le dit a l'utilisateur.
  if url is null or secret is null then
    return publics;
  end if;

  -- Une heure. Assez long pour couvrir une conversation sans renouvellement,
  -- assez court pour qu'un identifiant vole ne serve pas la semaine suivante.
  expiration := extract(epoch from (now() + interval '1 hour'))::bigint;

  -- L'identifiant de la personne est joint au nom d'utilisateur : si un relais
  -- est detourne, ses journaux disent par qui.
  identifiant := expiration || ':' || me::text;

  motdepasse := encode(
    extensions.hmac(identifiant, secret, 'sha1'),
    'base64'
  );

  return jsonb_build_array(
    jsonb_build_object(
      'urls',       url,
      'username',   identifiant,
      'credential', motdepasse
    )
  ) || publics;
end;
$$;

comment on function public.ice_servers is
  'Serveurs ICE du moment. Delivre des identifiants TURN valables une heure, pour que le secret du relais ne soit jamais compile dans le binaire client.';

revoke all on function public.ice_servers() from public;
grant execute on function public.ice_servers() to authenticated;
