-- Ne pas afficher son pseudo sur sa fiche.
--
-- Le pseudo sert a deux choses qui n'ont rien a voir : il IDENTIFIE — c'est
-- lui qui rend une mention possible, et il doit donc rester unique et stable —
-- et il se MONTRE, sous le nom d'affichage. La seconde n'est utile que si les
-- deux different assez pour apprendre quelque chose.
--
-- Quand le nom d'affichage et le pseudo se ressemblent — « s » et « s » — la
-- ligne du dessous ne fait que repeter celle du dessus. C'est le meme
-- raisonnement qui a fait retirer la pastille C.E.O de la fiche : deux marques
-- pour un seul fait, et la plus discrete ne sert a rien.
--
-- Ce que cela coute, et qui doit le savoir
-- ----------------------------------------
-- Le pseudo cache reste le seul moyen de mentionner quelqu'un. Le masquer,
-- c'est retirer de sa fiche l'endroit ou l'on venait l'apprendre. C'est un
-- choix defendable — on le donne autrement — mais c'en est un, et l'interface
-- le dit a cote de l'interrupteur plutot que de laisser le decouvrir.
--
-- Il ne disparait donc QUE de la fiche. La recherche, les mentions et la liste
-- des membres continuent de le montrer : sans quoi ce ne serait plus un
-- reglage d'affichage mais une disparition, et deux personnes ne pourraient
-- plus se nommer.

alter table public.profiles
  add column if not exists masquer_pseudo boolean not null default false;

comment on column public.profiles.masquer_pseudo is
  'Cache le pseudo sur la FICHE de profil, et la seulement. Il reste visible '
  'partout ou il sert a identifier quelqu''un : recherche, mentions, liste des '
  'membres. Utile quand le nom d''affichage et le pseudo se repetent.';
