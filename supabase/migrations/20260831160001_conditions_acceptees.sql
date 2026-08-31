-- Acceptation des conditions d'utilisation.
--
-- Pourquoi en base, et pas dans le navigateur
-- --------------------------------------------
-- Une acceptation rangee dans le stockage local ne prouve rien : elle
-- disparait au premier nettoyage, ne suit pas d'un appareil a l'autre, et
-- surtout, elle est ecrite par la machine de celui qui accepte. Ce qu'on
-- consigne ici, c'est une date et un numero de version, cote serveur, sur la
-- ligne de la personne concernee.
--
-- La version compte autant que la date. Des que les conditions changent sur le
-- fond, on incremente `CONDITIONS_VERSION` cote application : celles et ceux
-- qui n'ont accepte qu'une version anterieure la revoient. Sans ce numero, il
-- faudrait effacer les acceptations pour toutes et tous a chaque virgule
-- corrigee, ou faire semblant qu'une acceptation de l'an dernier vaut pour un
-- texte reecrit depuis.

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     integer;

comment on column public.profiles.terms_accepted_at is
  'Date d''acceptation des conditions. NULL tant que rien n''a ete accepte.';
comment on column public.profiles.terms_version is
  'Version des conditions acceptees. Comparee a celle de l''application : une version plus recente redemande l''acceptation.';

-- ---------------------------------------------------------------------------
-- L'ecriture passe par une fonction, pas par une mise a jour libre
-- ---------------------------------------------------------------------------
--
-- La politique `profiles_update_own` autorise chacun a modifier sa propre
-- ligne, ce qui suffirait techniquement. Mais une acceptation antidatee n'est
-- pas une acceptation : si la date vient du client, elle vaut ce que vaut la
-- montre de celui qui la pose — et rien n'empeche d'ecrire une date d'il y a
-- deux ans, ou une version qu'on n'a jamais vue.
--
-- La fonction pose `now()`, cote serveur, et n'accepte que la version que
-- l'application lui annonce. C'est peu, mais c'est la difference entre une
-- trace et une declaration.

create or replace function public.accepter_conditions(p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  if p_version is null or p_version < 1 then
    raise exception 'Version de conditions invalide' using errcode = '22023';
  end if;

  update public.profiles
     set terms_accepted_at = now(),
         terms_version     = p_version
   where id = me;
end;
$$;

comment on function public.accepter_conditions is
  'Consigne l''acceptation des conditions pour l''appelant. La date vient du serveur : une date fournie par le client ne vaudrait que ce que vaut sa montre.';

revoke all on function public.accepter_conditions(integer) from public;
grant execute on function public.accepter_conditions(integer) to authenticated;
