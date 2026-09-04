-- Les couleurs d'une fiche de profil.
--
-- `theme_hue` existait deja et ne servait a RIEN : la teinte etait posee en
-- variable CSS `--hue-primary` sur la carte, et aucune regle ne la lisait. On
-- proposait donc huit couleurs qui ne changeaient rien, ce qui se remarque
-- surtout quand on les essaie toutes.
--
-- La colonne reste — elle ne gene personne, et l'effacer demanderait une
-- migration de plus pour une valeur que rien ne lit. C'est `profil_couleurs`
-- qui decide desormais.

/*
 * Une colonne plutot que trois.
 *
 * Ces valeurs n'ont aucun sens l'une sans les autres : une seconde couleur ne
 * veut rien dire sans le style qui l'emploie, et un style « degrade » sans
 * seconde couleur n'a rien a degrader. On ne cherchera jamais les profils par
 * leur couleur secondaire. Elles se lisent et s'ecrivent ensemble.
 */
alter table public.profiles
  add column if not exists profil_couleurs jsonb;

alter table public.profiles
  drop constraint if exists profiles_profil_couleurs_valide;

/*
 * La forme est verifiee par la base, pas seulement par l'application.
 *
 * `profiles` s'ecrit directement depuis le client : sans contrainte ici,
 * n'importe quoi pourrait se loger dans une valeur qui part telle quelle dans
 * un attribut `style`. Les couleurs sont donc bornees a une notation
 * hexadecimale a six chiffres, et le style a trois valeurs connues.
 */
alter table public.profiles
  add constraint profiles_profil_couleurs_valide check (
    profil_couleurs is null
    or (
      jsonb_typeof(profil_couleurs) = 'object'
      and profil_couleurs ->> 'a' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'b' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'style' in ('unique', 'duo', 'degrade')
    )
  );

comment on column public.profiles.profil_couleurs is
  'Couleurs de la fiche : {"a": "#rrggbb", "b": "#rrggbb", "style": '
  '"unique" | "duo" | "degrade"}. En « unique » seule `a` sert ; `b` reste '
  'renseignee pour qu''un retour au duo retrouve le choix precedent. '
  'null = couleurs de l''application.';
