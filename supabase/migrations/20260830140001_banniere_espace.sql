/*
 * Banniere d'espace.
 *
 * L'icone existait deja — la pastille du rail — mais rien ne donnait son
 * caractere a un espace une fois entre dedans. La banniere coiffe la liste des
 * salons, la ou l'on passe ses journees.
 *
 * Aucune politique nouvelle : la colonne suit celles de `spaces`, ou la lecture
 * est ouverte aux membres et l'ecriture reservee a l'administration.
 */
alter table public.spaces
  add column if not exists banner_url text;

comment on column public.spaces.banner_url is
  'Image large affichee en tete de la liste des salons. Nulle par defaut.';
