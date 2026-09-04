-- Le nom d'un lien devient facultatif, et sa couleur se choisit.
-- Le statut du moment gagne une couleur et une opacite.
--
-- Trois changements qui vont ensemble : ils portent tous sur ce qu'une personne
-- montre d'elle sur sa fiche, et ils partagent la meme regle de validation des
-- couleurs.

/*
 * Un lien sans nom est un lien normal.
 *
 * `label` etait exige. Coller une adresse obligeait donc a lui inventer un
 * intitule — et l'intitule le plus honnete est souvent l'adresse elle-meme,
 * qu'on recopiait a la main a cote. L'affichage sait desormais montrer
 * l'adresse entiere quand le nom manque.
 *
 * `couleur` est facultative et bornee a une notation hexadecimale a six
 * chiffres. Bornee parce que cette valeur part directement dans une feuille de
 * style : accepter n'importe quelle chaine laisserait ecrire autre chose
 * qu'une couleur dans un attribut `style`, ce qui n'a rien a faire ici.
 */
create or replace function public.valid_profile_links(links jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(links) = 'array'
    and jsonb_array_length(links) <= 5
    and not exists (
      select 1
      from jsonb_array_elements(links) as entry
      where jsonb_typeof(entry) <> 'object'
         or entry->>'url' is null
         or char_length(entry->>'url') > 200
         or entry->>'url' !~ '^https?://'
         -- Le nom est facultatif ; s'il est la, il reste court.
         or (entry->>'label' is not null and char_length(entry->>'label') > 40)
         -- La couleur est facultative ; si elle est la, c'en est une.
         or (entry->>'couleur' is not null and entry->>'couleur' !~* '^#[0-9a-f]{6}$')
    );
$$;

/*
 * La bulle de statut : sa couleur et son opacite.
 *
 * Deux colonnes plutot qu'un objet, a la difference du cadrage de banniere :
 * ces deux valeurs se lisent et se changent separement — on garde sa couleur
 * en jouant sur l'opacite — et chacune porte sa propre contrainte, ce qui se
 * dit mal dans un seul `jsonb`.
 *
 * `null` des deux cotes signifie « comme avant » : la bulle prend la teinte de
 * la fiche. C'est ce que valent tous les profils existants.
 */
alter table public.profiles
  add column if not exists status_couleur text,
  add column if not exists status_opacite numeric;

alter table public.profiles
  drop constraint if exists profiles_status_couleur_valide;

alter table public.profiles
  add constraint profiles_status_couleur_valide check (
    status_couleur is null or status_couleur ~* '^#[0-9a-f]{6}$'
  );

/*
 * Le plancher a 0,1 n'est pas une precaution, c'est la demande.
 *
 * Une bulle entierement transparente ne disparait pas : elle laisse un texte
 * flottant sur la banniere, souvent illisible et impossible a distinguer du
 * reste. On borne donc en base plutot que dans l'interface seule — une valeur
 * ecrite par un autre chemin donnerait le meme resultat, et personne ne saurait
 * d'ou elle vient.
 */
alter table public.profiles
  drop constraint if exists profiles_status_opacite_valide;

alter table public.profiles
  add constraint profiles_status_opacite_valide check (
    status_opacite is null or (status_opacite >= 0.1 and status_opacite <= 1)
  );

comment on column public.profiles.status_couleur is
  'Couleur de la bulle de statut, #rrggbb. null = teinte de la fiche.';

comment on column public.profiles.status_opacite is
  'Opacite du fond de la bulle, de 0,1 a 1. Jamais 0 : une bulle invisible '
  'laisse un texte flottant sur la banniere.';
