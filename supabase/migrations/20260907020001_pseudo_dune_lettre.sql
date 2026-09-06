-- Un pseudo d'une seule lettre, et lui seul.
--
-- La demande tient en deux phrases : « change mon pseudo vq met juste s » et
-- « les autres doivent mettre 2 lettres min ». La seconde est deja vraie —
-- `^[a-z0-9_.-]{2,32}$` en base, et la meme regle a l'inscription — et c'est
-- justement pourquoi la premiere est impossible sans toucher a la contrainte.
--
-- Ce qui est fait ici, et ce qui ne l'est pas
-- -------------------------------------------
-- On ne descend PAS le minimum a une lettre pour tout le monde. Un pseudo
-- d'une lettre est une place rare — il y en a trente-six — et l'ouvrir a
-- l'inscription les ferait disparaitre en une soiree, au premier venu plutot
-- qu'a qui que ce soit en particulier.
--
-- La contrainte accepte donc une lettre, et un declencheur refuse ce cas a
-- tout ce qui parle avec une SESSION. Restent la cle de service et les
-- migrations : c'est-a-dire un geste deliberé de l'equipe, ce qu'est
-- exactement l'attribution d'une place rare.
--
-- Le nom de personne n'est ecrit nulle part dans cette regle. Ecrire un
-- identifiant dans une contrainte aurait marche aujourd'hui et serait devenu
-- incomprehensible au premier autre cas.

alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[a-z0-9_.-]{1,32}$');

/*
 * Deux lettres au minimum, sauf pour l'equipe.
 *
 * `auth.role()` vaut `authenticated` pour quelqu'un de connecte, `anon` pour
 * une session ouverte sans compte, `service_role` pour le tableau de bord, et
 * rien du tout quand la requete ne porte pas de jeton — le cas d'une migration.
 *
 * On refuse donc les deux premiers et l'on laisse passer les deux derniers.
 * Formuler la regle par ce qu'on REFUSE plutot que par ce qu'on autorise :
 * un role nouveau, ajoute un jour par Supabase, sera alors soumis a la regle
 * par defaut plutot que dispense sans qu'on s'en apercoive.
 */
create or replace function public.pseudo_assez_long()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rien ne change dans le pseudo : ce declencheur n'a pas son mot a dire.
  -- Sans ce test, quelqu'un a qui l'on a donne une lettre ne pourrait plus
  -- modifier sa bio ni sa photo.
  if tg_op = 'UPDATE' and new.username is not distinct from old.username then
    return new;
  end if;

  if char_length(new.username) < 2
     and coalesce(auth.role(), '') in ('authenticated', 'anon')
  then
    raise exception 'Un pseudo fait au moins deux caracteres.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.pseudo_assez_long is
  'Impose deux caracteres a qui choisit son pseudo depuis l''application. Les '
  'pseudos d''une lettre restent possibles, mais seulement par la cle de '
  'service : c''est une place rare, elle se donne, elle ne se prend pas.';

drop trigger if exists profiles_pseudo_assez_long on public.profiles;
create trigger profiles_pseudo_assez_long
  before insert or update on public.profiles
  for each row execute function public.pseudo_assez_long();

/*
 * Et la place est donnee.
 *
 * Par le pseudo actuel plutot que par l'identifiant : c'est ce que la demande
 * nommait, et cela rend la ligne lisible sans avoir a chercher a qui
 * appartient un uuid. Si `vq` n'existe plus, la migration ne fait rien plutot
 * que d'echouer — rejouer une migration sur une base ou le changement a deja
 * eu lieu ne doit pas la bloquer.
 *
 * `where not exists` protege du cas ou `s` aurait ete pris entre-temps :
 * l'unicite leverait sinon une erreur au milieu d'une migration, ce qui est le
 * plus mauvais endroit pour decouvrir un conflit.
 */
update public.profiles
   set username = 's'
 where username = 'vq'
   and not exists (select 1 from public.profiles autre where autre.username = 's');
