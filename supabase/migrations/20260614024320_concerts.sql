-- Live concerts: QR check-in + pre/post-concert prompts.
-- See docs/data-model.md (concerts section).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table concerts (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  venue       text,
  city        text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  qr_code     text unique not null,          -- the code printed in the program
  ensemble_id uuid references ensembles(id) on delete set null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index concerts_starts_idx on concerts (starts_at);
create trigger trg_concerts_updated before update on concerts
  for each row execute function public.set_updated_at();

-- ordered program of pieces (works) for a concert
create table concert_program (
  id         uuid primary key default gen_random_uuid(),
  concert_id uuid not null references concerts(id) on delete cascade,
  work_id    uuid not null references works(id) on delete restrict,
  position   int  not null,
  unique (concert_id, position),
  unique (concert_id, work_id)
);
create index concert_program_concert_idx on concert_program (concert_id);

-- a user's QR check-in / attendance for a concert (one per user per concert)
create table concert_checkins (
  id            uuid primary key default gen_random_uuid(),
  concert_id    uuid not null references concerts(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  before_start  boolean not null default false,   -- checked in before starts_at
  pre_done      boolean not null default false,   -- finished the "have you heard these?" prompt
  post_done     boolean not null default false,   -- finished the post-concert review
  unique (concert_id, user_id)
);
create index concert_checkins_user_idx on concert_checkins (user_id);

-- per-piece responses: pre-concert (heard_before / prior_rating) + post (live_rating)
create table concert_piece_ratings (
  id           uuid primary key default gen_random_uuid(),
  concert_id   uuid not null references concerts(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  work_id      uuid not null references works(id) on delete cascade,
  heard_before boolean,
  prior_rating smallint check (prior_rating between 1 and 5),
  live_rating  smallint check (live_rating between 1 and 5),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (concert_id, user_id, work_id)
);
create index concert_piece_ratings_concert_idx on concert_piece_ratings (concert_id);
create trigger trg_concert_piece_ratings_updated before update on concert_piece_ratings
  for each row execute function public.set_updated_at();

-- overall concert rating + review
create table concert_reviews (
  id         uuid primary key default gen_random_uuid(),
  concert_id uuid not null references concerts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (concert_id, user_id)
);
create index concert_reviews_concert_idx on concert_reviews (concert_id);
create trigger trg_concert_reviews_updated before update on concert_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table concerts             enable row level security;
alter table concert_program      enable row level security;
alter table concert_checkins     enable row level security;
alter table concert_piece_ratings enable row level security;
alter table concert_reviews      enable row level security;

-- concerts + program: world-readable (searchable); curated writes only
create policy concerts_read on concerts for select using (true);
create policy concerts_write on concerts for all
  using (public.current_user_role() in ('moderator','admin'))
  with check (public.current_user_role() in ('moderator','admin'));
create policy program_read on concert_program for select using (true);
create policy program_write on concert_program for all
  using (public.current_user_role() in ('moderator','admin'))
  with check (public.current_user_role() in ('moderator','admin'));

-- check-ins: a user manages only their own
create policy checkins_read on concert_checkins for select using (auth.uid() = user_id);
create policy checkins_write on concert_checkins for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- piece ratings: own only
create policy piece_ratings_read on concert_piece_ratings for select using (auth.uid() = user_id);
create policy piece_ratings_write on concert_piece_ratings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- concert reviews: world-readable; own writes
create policy concert_reviews_read on concert_reviews for select using (true);
create policy concert_reviews_write on concert_reviews for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Seed: a past concert, one happening now, and an upcoming one
-- ---------------------------------------------------------------------------
insert into concerts (slug, title, venue, city, starts_at, ends_at, qr_code, ensemble_id, description)
select 'vpo-musikverein-past', 'An Evening with the Vienna Philharmonic', 'Musikverein', 'Vienna',
       now() - interval '4 days', now() - interval '4 days' + interval '2 hours', 'VIENNA24',
       (select id from ensembles where slug = 'vienna-philharmonic'),
       'Beethoven and Mozart under the gilded ceiling of the Goldener Saal.'
union all
select 'recital-now', 'Lunchtime Recital', 'Wigmore Hall', 'London',
       now() - interval '30 minutes', now() + interval '90 minutes', 'NOW24', null,
       'An intimate midday program — in progress.'
union all
select 'bpo-philharmonie-upcoming', 'Berlin Philharmonic: Baroque to Beethoven', 'Philharmonie', 'Berlin',
       now() + interval '6 days', now() + interval '6 days' + interval '2 hours', 'BERLIN24',
       (select id from ensembles where slug = 'berlin-philharmonic'),
       'A journey from Bach''s Brandenburg brilliance to Beethoven''s Fifth.';

-- programs
insert into concert_program (concert_id, work_id, position)
select c.id, w.id, p.position
from (values
  ('vpo-musikverein-past',      'beethoven-symphony-5', 1),
  ('vpo-musikverein-past',      'mozart-symphony-40',   2),
  ('recital-now',               'mozart-symphony-40',   1),
  ('bpo-philharmonie-upcoming', 'bach-brandenburg-3',   1),
  ('bpo-philharmonie-upcoming', 'beethoven-symphony-5', 2)
) as p(concert_slug, work_slug, position)
join concerts c on c.slug = p.concert_slug
join works w on w.slug = p.work_slug;
