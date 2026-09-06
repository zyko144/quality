-- Une demande fermee ne recoit plus rien — de personne.
--
-- Ce que cela change par rapport a la regle precedente
-- ----------------------------------------------------
-- Le commentaire de `resoudre_ma_demande` disait ceci, et c'etait un choix
-- assume :
--
--     Rouvrir se fait en repondant : la reponse remonte la demande dans la
--     file de l'equipe, ce qui est exactement l'effet recherche, sans donner
--     un second bouton qui permettrait de faire osciller un statut
--     indefiniment.
--
-- Fermer ne fermait donc rien : cela rangeait la demande jusqu'a la phrase
-- suivante. Un echange qu'on croyait termine pouvait repartir des semaines
-- plus tard, sur la meme ligne, et il fallait relire tout le fil pour
-- comprendre ce qui etait encore d'actualite.
--
-- La demande faite est l'inverse : « quand on les a fermer on peux plus ecrire
-- dedans le client et moi ». Fermer devient donc definitif pour cet
-- echange-la. Ce qui reste a dire s'ecrit dans une nouvelle demande, qui part
-- avec son propre sujet et sa propre date — et c'est plus lisible qu'un fil
-- rouvert trois fois.
--
-- Pourquoi un declencheur et non une politique
-- --------------------------------------------
-- Une politique RLS ne s'applique pas a la cle de service, et le tableau de
-- bord de l'equipe s'en sert : la moitie « et moi » de la demande serait donc
-- restee lettre morte. On peut cacher le champ dans l'interface, et il faut le
-- faire, mais une regle qui ne tient que dans l'interface n'est pas une regle
-- — c'est une convention qu'un rechargement de page suffit a oublier.
--
-- Un declencheur, lui, s'applique a tout le monde. C'est le seul endroit d'ou
-- l'on puisse dire la meme chose aux deux cotes.

create or replace function public.support_refuse_si_fermee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  etat text;
begin
  select d.statut into etat
    from public.demandes_support d
   where d.id = new.demande_id;

  /*
   * Une demande introuvable n'est pas notre affaire.
   *
   * La cle etrangere s'en charge, et mieux que nous : lever ici une exception
   * differente ferait deux messages pour un seul defaut, selon l'ordre dans
   * lequel les verifications se declenchent.
   */
  if etat is null then
    return new;
  end if;

  if etat = 'resolue' then
    raise exception 'Cette demande est fermee : elle n''accepte plus de reponse.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.support_refuse_si_fermee is
  'Refuse toute reponse a une demande resolue, quel que soit le role — la cle '
  'de service comprise. C''est la seule facon de tenir la regle des DEUX '
  'cotes : une politique RLS ne s''applique pas au tableau de bord.';

/*
 * Avant l'insertion, et avant le declencheur qui horodate.
 *
 * `reponses_support_touche` remonte la demande dans la file a chaque reponse.
 * Il ne se declenche qu'`after insert`, donc apres celui-ci : une reponse
 * refusee ne remontera pas une demande fermee au sommet de la file de
 * l'equipe.
 */
drop trigger if exists reponses_support_fermee on public.reponses_support;
create trigger reponses_support_fermee
  before insert on public.reponses_support
  for each row execute function public.support_refuse_si_fermee();

/*
 * La politique du client le dit aussi, en plus du declencheur.
 *
 * Elle fait double emploi, et c'est voulu. Le declencheur rend une erreur de
 * base — un message brut, qui traverse l'interface tel quel. La politique,
 * elle, refuse la ligne avant meme d'y arriver, ce qui est le comportement
 * ordinaire d'une ecriture interdite et ce que le client sait deja presenter.
 *
 * Aucune des deux ne suffit seule : la politique ignore la cle de service, le
 * declencheur ne sait pas parler autrement qu'en levant une exception.
 */
drop policy if exists reponses_support_insert on public.reponses_support;
create policy reponses_support_insert on public.reponses_support
  for insert to authenticated
  with check (
    auteur_id = (select auth.uid())
    and de_l_equipe = false
    and exists (
      select 1
        from public.demandes_support d
       where d.id = reponses_support.demande_id
         and d.auteur_id = (select auth.uid())
         and d.statut <> 'resolue'
    )
  );
