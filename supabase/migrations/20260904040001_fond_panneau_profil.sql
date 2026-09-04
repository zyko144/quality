-- Le fond du panneau de droite, dans les couleurs de la fiche.
--
-- La contrainte posee par `20260904030001` exige un objet fait de `a`, `b` et
-- `style`, et rien d'autre n'y est prevu. Elle refuserait donc `panneau`, et le
-- refus porterait sur l'ecriture ENTIERE du profil : quelqu'un qui touche a la
-- couleur de son panneau ne pourrait plus rien enregistrer du tout.
--
-- Le champ est facultatif : `null` et l'absence valent « gris », ce que valent
-- toutes les fiches existantes.

alter table public.profiles
  drop constraint if exists profiles_profil_couleurs_valide;

alter table public.profiles
  add constraint profiles_profil_couleurs_valide check (
    profil_couleurs is null
    or (
      jsonb_typeof(profil_couleurs) = 'object'
      and profil_couleurs ->> 'a' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'b' ~* '^#[0-9a-f]{6}$'
      and profil_couleurs ->> 'style' in ('unique', 'duo', 'degrade')
      -- Trois valeurs neutres, et seulement celles-la : c'est la colonne qui se
      -- lit, et une couleur y disputerait la lisibilite du texte.
      and (
        profil_couleurs ->> 'panneau' is null
        or profil_couleurs ->> 'panneau' in ('noir', 'gris', 'blanc')
      )
    )
  );

comment on column public.profiles.profil_couleurs is
  'Couleurs de la fiche : {"a": "#rrggbb", "b": "#rrggbb", "style": '
  '"unique" | "duo" | "degrade", "panneau": "noir" | "gris" | "blanc"}. '
  'En « unique » seule `a` sert ; `b` reste renseignee pour qu''un retour au '
  'duo retrouve le choix precedent. `panneau` absent vaut « gris ». '
  'null = couleurs de l''application.';
