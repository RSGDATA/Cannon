-- Cannon — initial schema
-- "Rotten Tomatoes for classical music." See docs/data-model.md.
-- PostgreSQL (Supabase). Core rule: you rate a RECORDING, never a WORK.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
create type era             as enum ('baroque','classical','romantic','modern','contemporary');
create type work_form       as enum ('symphony','concerto','sonata','quartet','opera','lied','suite','other');
create type ensemble_type   as enum ('orchestra','quartet','choir','chamber','opera_company','other');
create type recording_type  as enum ('studio','live');
create type user_role       as enum ('user','critic','moderator','admin');
create type list_visibility as enum ('public','unlisted','private');

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text unique not null,
  display_name text not null,
  photo_url    text,
  bio          text,
  role         user_role not null default 'user',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function public.set_updated_at();

-- role lookup for RLS (security definer so policies can read role safely)
create or replace function public.current_user_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table composers (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  sort_name    text not null,
  era          era,
  nationality  text,
  birth_year   int,
  death_year   int,
  portrait_url text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_composers_updated before update on composers
  for each row execute function public.set_updated_at();

create table works (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique not null,
  composer_id    uuid not null references composers(id) on delete restrict,
  title          text not null,
  sort_title     text not null,
  nicknames      text[] not null default '{}',
  form           work_form,
  key            text,
  catalog_system text,
  catalog_number text,
  year_composed  int,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index works_composer_idx on works (composer_id);
create trigger trg_works_updated before update on works
  for each row execute function public.set_updated_at();

create table work_movements (
  id       uuid primary key default gen_random_uuid(),
  work_id  uuid not null references works(id) on delete cascade,
  position int  not null,
  title    text not null,
  tempo    text,
  unique (work_id, position)
);

create table artists (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  sort_name   text not null,
  roles       text[] not null default '{}',
  instruments text[] not null default '{}',
  nationality text,
  birth_year  int,
  death_year  int,
  photo_url   text,
  bio         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_artists_updated before update on artists
  for each row execute function public.set_updated_at();

create table ensembles (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  type         ensemble_type,
  founded_year int,
  nationality  text,
  logo_url     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_ensembles_updated before update on ensembles
  for each row execute function public.set_updated_at();

create table recordings (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  work_id          uuid not null references works(id) on delete restrict,
  year_recorded    int,
  recording_type   recording_type not null default 'studio',
  venue            text,
  label            text,
  label_catalog_no text,
  duration_sec     int,
  cover_url        text,
  spotify_url      text,
  apple_music_url  text,
  youtube_url      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index recordings_work_idx on recordings (work_id);
create trigger trg_recordings_updated before update on recordings
  for each row execute function public.set_updated_at();

create table credits (
  id           uuid primary key default gen_random_uuid(),
  recording_id uuid not null references recordings(id) on delete cascade,
  artist_id    uuid references artists(id)   on delete cascade,
  ensemble_id  uuid references ensembles(id) on delete cascade,
  role         text not null,
  is_primary   boolean not null default false,
  constraint credit_one_target check ((artist_id is not null) <> (ensemble_id is not null))
);
create index credits_recording_idx on credits (recording_id);
create index credits_artist_idx    on credits (artist_id);
create index credits_ensemble_idx  on credits (ensemble_id);

-- ---------------------------------------------------------------------------
-- Reviews / lists / comments
-- ---------------------------------------------------------------------------
create table reviews (
  id               uuid primary key default gen_random_uuid(),
  recording_id     uuid not null references recordings(id) on delete cascade,
  author_id        uuid not null references profiles(id)   on delete cascade,
  rating           smallint not null check (rating between 1 and 5),
  body             text,
  contains_spoiler boolean not null default false,
  deleted          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (recording_id, author_id)   -- one review per user per recording
);
create index reviews_recording_idx on reviews (recording_id);
create index reviews_author_idx    on reviews (author_id);
create trigger trg_reviews_updated before update on reviews
  for each row execute function public.set_updated_at();

create table lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  title       text not null,
  description text,
  visibility  list_visibility not null default 'public',
  cover_url   text,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_lists_updated before update on lists
  for each row execute function public.set_updated_at();

create table list_items (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references lists(id) on delete cascade,
  position     int  not null,
  recording_id uuid references recordings(id) on delete cascade,
  work_id      uuid references works(id)      on delete cascade,
  note         text,
  constraint list_item_one_ref check ((recording_id is not null) <> (work_id is not null)),
  unique (list_id, position)
);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references profiles(id) on delete cascade,
  review_id  uuid references reviews(id) on delete cascade,
  list_id    uuid references lists(id)   on delete cascade,
  parent_id  uuid references comments(id) on delete cascade,
  body       text not null,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comment_one_target check ((review_id is not null) <> (list_id is not null))
);
create trigger trg_comments_updated before update on comments
  for each row execute function public.set_updated_at();

create table review_likes (
  review_id uuid references reviews(id)  on delete cascade,
  user_id   uuid references profiles(id) on delete cascade,
  primary key (review_id, user_id)
);
create table list_likes (
  list_id uuid references lists(id)    on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (list_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Analytics views (replace the old "aggregation script" entirely)
-- ---------------------------------------------------------------------------
create view recording_ratings as
select
  r.id as recording_id,
  count(rv.id)                                                        as rating_count,
  round(avg(rv.rating)::numeric, 2)                                  as avg_rating,
  count(rv.id) filter (where p.role = 'critic')                      as critic_count,
  round(avg(rv.rating) filter (where p.role = 'critic')::numeric, 2)  as critic_avg,
  round(avg(rv.rating) filter (where p.role <> 'critic')::numeric, 2) as audience_avg
from recordings r
left join reviews  rv on rv.recording_id = r.id and rv.deleted = false
left join profiles p  on p.id = rv.author_id
group by r.id;

create view recording_scores as
with global as (
  select coalesce(avg(rating), 0)::numeric as c, 10::numeric as m
  from reviews where deleted = false
)
select
  rr.recording_id,
  rr.rating_count,
  rr.avg_rating,
  round(
    (rr.rating_count / (rr.rating_count + g.m)) * coalesce(rr.avg_rating, g.c)
    + (g.m / (rr.rating_count + g.m)) * g.c
  , 3) as bayes_score
from recording_ratings rr cross join global g;

create view work_stats as
select
  w.id as work_id,
  count(r.id) as recording_count,
  (select s.recording_id
     from recording_scores s
     join recordings r2 on r2.id = s.recording_id
    where r2.work_id = w.id
    order by s.bayes_score desc nulls last
    limit 1) as top_recording_id
from works w
left join recordings r on r.work_id = w.id
group by w.id;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table profiles       enable row level security;
alter table composers      enable row level security;
alter table works          enable row level security;
alter table work_movements enable row level security;
alter table artists        enable row level security;
alter table ensembles      enable row level security;
alter table recordings     enable row level security;
alter table credits        enable row level security;
alter table reviews        enable row level security;
alter table lists          enable row level security;
alter table list_items     enable row level security;
alter table comments       enable row level security;
alter table review_likes   enable row level security;
alter table list_likes     enable row level security;

-- profiles: world-readable; you manage only your own row
create policy profiles_read   on profiles for select using (true);
create policy profiles_insert on profiles for insert with check (auth.uid() = id);
create policy profiles_update on profiles for update using (auth.uid() = id);

-- catalog: world-readable; only moderators/admins write
do $$
declare t text;
begin
  foreach t in array array['composers','works','work_movements','artists','ensembles','recordings','credits']
  loop
    execute format('create policy %1$I_read on %1$I for select using (true);', t);
    execute format($f$create policy %1$I_write on %1$I for all
      using (public.current_user_role() in ('moderator','admin'))
      with check (public.current_user_role() in ('moderator','admin'));$f$, t);
  end loop;
end $$;

-- reviews: read non-deleted; author writes own
create policy reviews_read   on reviews for select using (deleted = false or auth.uid() = author_id);
create policy reviews_insert on reviews for insert with check (auth.uid() = author_id);
create policy reviews_update on reviews for update using (auth.uid() = author_id);
create policy reviews_delete on reviews for delete using (auth.uid() = author_id);

-- lists: public or owner; owner writes
create policy lists_read  on lists for select using (visibility = 'public' or owner_id = auth.uid());
create policy lists_write on lists for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy list_items_read  on list_items for select using (
  exists (select 1 from lists l where l.id = list_id and (l.visibility = 'public' or l.owner_id = auth.uid())));
create policy list_items_write on list_items for all using (
  exists (select 1 from lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from lists l where l.id = list_id and l.owner_id = auth.uid()));

-- comments: read non-deleted; any authed user creates; author edits
create policy comments_read   on comments for select using (deleted = false);
create policy comments_insert on comments for insert with check (auth.uid() = author_id);
create policy comments_update on comments for update using (auth.uid() = author_id);

-- likes: anyone reads; you manage your own
create policy review_likes_read  on review_likes for select using (true);
create policy review_likes_write on review_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy list_likes_read    on list_likes for select using (true);
create policy list_likes_write   on list_likes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
