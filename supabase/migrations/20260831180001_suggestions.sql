-- Suggestions et votes.
--
-- Un endroit ou dire ce qui manque, et ou voir ce que les autres ont dit.
-- Sans cela, chaque idee se perd dans le salon ou elle a ete lancee : celui qui
-- la lit deux jours plus tard n'a aucun moyen de savoir si elle a deja ete
-- proposee, ni si quelqu'un d'autre la voulait aussi.
--
-- Le vote est binaire — pour ou contre — et non un compte de « j'aime ». Une
-- idee peut deranger autant qu'elle plait, et une echelle a un seul sens ne
-- dirait que la moitie de ce qu'on veut savoir.

create table if not exists public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles (id) on delete cascade,

  -- Assez pour exposer une idee, trop peu pour un cahier des charges : au-dela,
  -- personne ne lit, et la liste devient un tas.
  contenu     text not null check (char_length(trim(contenu)) between 8 and 600),

  created_at  timestamptz not null default now()
);

create index if not exists suggestions_recentes_idx
  on public.suggestions (created_at desc);

create table if not exists public.suggestion_votes (
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,

  -- `true` pour, `false` contre. Changer d'avis met a jour la ligne plutot que
  -- d'en ajouter une seconde, la cle primaire s'en chargeant.
  pour          boolean not null,
  created_at    timestamptz not null default now(),

  primary key (suggestion_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Qui peut faire quoi
-- ---------------------------------------------------------------------------

alter table public.suggestions      enable row level security;
alter table public.suggestion_votes enable row level security;

-- Tout le monde lit tout : c'est l'objet meme d'une liste publique de
-- suggestions, et cela evite qu'une idee soit proposee trois fois.
drop policy if exists suggestions_select on public.suggestions;
create policy suggestions_select on public.suggestions
  for select to authenticated using (true);

-- On ne propose que pour soi. `author_id` est verifie ici plutot que laisse au
-- client : sans cela, on pourrait deposer une suggestion au nom d'autrui.
drop policy if exists suggestions_insert on public.suggestions;
create policy suggestions_insert on public.suggestions
  for insert to authenticated
  with check (author_id = (select auth.uid()));

-- Retirer sa propre suggestion, jamais celle d'un autre.
drop policy if exists suggestions_delete on public.suggestions;
create policy suggestions_delete on public.suggestions
  for delete to authenticated
  using (author_id = (select auth.uid()));

drop policy if exists votes_select on public.suggestion_votes;
create policy votes_select on public.suggestion_votes
  for select to authenticated using (true);

drop policy if exists votes_insert on public.suggestion_votes;
create policy votes_insert on public.suggestion_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Changer d'avis. `WITH CHECK` autant que `USING` : sans lui, on pourrait
-- transformer sa propre ligne en celle de quelqu'un d'autre — c'est exactement
-- le defaut trouve sur `space_members`, et il ne coute rien de ne pas le
-- repeter.
drop policy if exists votes_update on public.suggestion_votes;
create policy votes_update on public.suggestion_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists votes_delete on public.suggestion_votes;
create policy votes_delete on public.suggestion_votes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- La liste, comptes compris
-- ---------------------------------------------------------------------------
--
-- Compter cote client demanderait de charger tous les votes de toutes les
-- suggestions pour n'en afficher que deux nombres. La base sait le faire en une
-- passe, et c'est son travail.

create or replace function public.liste_suggestions()
returns table (
  id         uuid,
  author_id  uuid,
  contenu    text,
  created_at timestamptz,
  pour       bigint,
  contre     bigint,
  mon_vote   boolean
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    s.id,
    s.author_id,
    s.contenu,
    s.created_at,
    coalesce(count(*) filter (where v.pour), 0)       as pour,
    coalesce(count(*) filter (where not v.pour), 0)   as contre,
    max(case when v.user_id = (select auth.uid()) then v.pour end) as mon_vote
  from public.suggestions s
  left join public.suggestion_votes v on v.suggestion_id = s.id
  group by s.id
  -- Les plus soutenues d'abord, puis les plus recentes : une liste
  -- chronologique enterrerait une bonne idee sous une semaine de nouvelles.
  order by (coalesce(count(*) filter (where v.pour), 0)
          - coalesce(count(*) filter (where not v.pour), 0)) desc,
           s.created_at desc
  limit 200;
$$;

comment on function public.liste_suggestions is
  'Suggestions avec leurs comptes de votes et le vote de l''appelant. Triees par soutien, puis par date.';

revoke all on function public.liste_suggestions() from public;
grant execute on function public.liste_suggestions() to authenticated;

-- ---------------------------------------------------------------------------
-- Voter, ou changer d'avis
-- ---------------------------------------------------------------------------

create or replace function public.voter_suggestion(p_suggestion uuid, p_pour boolean)
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

  -- `p_pour` a `null` retire le vote : c'est le meme geste que recliquer sur
  -- le bouton deja choisi, et cela evite une seconde fonction pour l'annuler.
  if p_pour is null then
    delete from public.suggestion_votes
     where suggestion_id = p_suggestion and user_id = me;
    return;
  end if;

  insert into public.suggestion_votes (suggestion_id, user_id, pour)
  values (p_suggestion, me, p_pour)
  on conflict (suggestion_id, user_id)
  do update set pour = excluded.pour, created_at = now();
end;
$$;

comment on function public.voter_suggestion is
  'Pose, change ou retire le vote de l''appelant. `p_pour` a NULL retire le vote.';

revoke all on function public.voter_suggestion(uuid, boolean) from public;
grant execute on function public.voter_suggestion(uuid, boolean) to authenticated;
