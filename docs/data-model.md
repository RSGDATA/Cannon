# Cannon — Data Model (PostgreSQL / Supabase)

> "Rotten Tomatoes for classical music."
> **Database: PostgreSQL** (relational + analytical), accessed via **Supabase**
> (client-direct from React + Flutter, Row-Level Security, built-in Auth).
> See [`VISION.md`](./VISION.md) for the stack decision and rationale.

---

## 1. The core principle

You do **not** rate a *Work*. You rate a *Recording* of a Work.

```
composers ──< works ──< recordings >──< credits >── artists / ensembles
                            │
                            └──< reviews >── profiles (users)
```

A `work` is the abstract composition; a `recording` is one captured performance.
**Reviews/ratings reference a `recording`, never a `work`.** Works get their
aggregate signal from their recordings via SQL views (§7).

## 2. Why SQL here (and what changes vs the old NoSQL draft)

This data is **relational and analytical**, not high-scale transactional. Postgres
gives us:
- **Real joins + foreign keys** → no more copying display fields onto child rows.
  The denormalization the Firestore draft needed is **gone**.
- **Analytical SQL** → ratings, critic/audience splits, and Bayesian rankings are
  **views** (§7), not a hand-rolled aggregation script.
- **Migrations** → extend the model over time with `ALTER TABLE` / Supabase
  migration files, not ad-hoc field sprawl.

## 3. Conventions

- **Primary keys:** `uuid` default `gen_random_uuid()` for user content; for shared
  catalog entities we also keep a unique human-readable `slug` for URLs.
- **Timestamps:** `created_at timestamptz default now()`, `updated_at` maintained
  by a trigger (`moddatetime`, a Supabase-provided extension).
- **Enums:** Postgres `ENUM` types for small, stable sets (era, form, …). For sets
  likely to grow, a lookup table is the more extensible choice — noted inline.
- **No denormalized counts.** `review_count`, `recording_count`, average rating,
  etc. are **derived in views** (§7), not stored. (Add trigger-maintained cache
  columns later only if a hot query needs it.)
- **Auth:** Supabase manages `auth.users`. Our app data hangs off a `profiles`
  table whose `id` = `auth.users.id`.
- **Soft delete:** `deleted boolean default false` on user content (`reviews`,
  `comments`, `lists`) so threads/aggregates stay consistent.

```sql
-- enum types
create type era            as enum ('baroque','classical','romantic','modern','contemporary');
create type work_form      as enum ('symphony','concerto','sonata','quartet','opera','lied','suite','other');
create type ensemble_type  as enum ('orchestra','quartet','choir','chamber','opera_company','other');
create type recording_type as enum ('studio','live');
create type user_role      as enum ('user','critic','moderator','admin');
create type list_visibility as enum ('public','unlisted','private');
```

---

## 4. Catalog tables (curated; admin/moderator-written, world-readable)

```sql
create table composers (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,                 -- "Ludwig van Beethoven"
  sort_name    text not null,                 -- "Beethoven, Ludwig van"
  era          era,
  nationality  text,
  birth_year   int,
  death_year   int,
  portrait_url text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table works (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  composer_id   uuid not null references composers(id) on delete restrict,
  title         text not null,                -- "Symphony No. 5"
  sort_title    text not null,                -- "Symphony No. 05 in C minor"
  nicknames     text[] default '{}',
  form          work_form,
  key           text,                         -- "C minor"
  catalog_system text,                        -- "Op." | "BWV" | "K." | "D."
  catalog_number text,                        -- "67"
  year_composed int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on works (composer_id);

-- movements as a child table (relational, queryable, vs a jsonb blob)
create table work_movements (
  id        uuid primary key default gen_random_uuid(),
  work_id   uuid not null references works(id) on delete cascade,
  position  int  not null,                    -- 1,2,3...
  title     text not null,
  tempo     text,
  unique (work_id, position)
);

create table artists (                        -- people: conductors, soloists, singers
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,                  -- "Carlos Kleiber"
  sort_name   text not null,
  roles       text[] default '{}',            -- ['conductor'] | ['pianist','conductor']
  instruments text[] default '{}',
  nationality text,
  birth_year  int,
  death_year  int,
  photo_url   text,
  bio         text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table ensembles (                      -- groups: orchestras, quartets, choirs
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,                 -- "Vienna Philharmonic"
  type         ensemble_type,
  founded_year int,
  nationality  text,
  logo_url     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
```

> **`artists` unifies performers + conductors** (one person, e.g. Barenboim,
> both conducts and plays). `ensembles` is separate because a group ≠ a person.
> The *role on a given recording* lives in `credits` (§5).

### 4.1 `recordings` — the rateable object

```sql
create table recordings (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  work_id         uuid not null references works(id) on delete restrict,
  year_recorded   int,
  recording_type  recording_type not null default 'studio',
  venue           text,
  label           text,                        -- "Deutsche Grammophon"
  label_catalog_no text,
  duration_sec    int,
  cover_url       text,
  spotify_url     text,
  apple_music_url text,
  youtube_url     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on recordings (work_id);
```

No `work_title` / `composer_name` columns — we **join** to `works`/`composers`.

### 4.2 `credits` — recording ↔ artist/ensemble (many-to-many, with role)

```sql
create table credits (
  id           uuid primary key default gen_random_uuid(),
  recording_id uuid not null references recordings(id) on delete cascade,
  artist_id    uuid references artists(id)   on delete cascade,
  ensemble_id  uuid references ensembles(id) on delete cascade,
  role         text not null,                 -- 'conductor' | 'piano' | 'violin' | 'orchestra'
  is_primary   boolean not null default false,
  -- exactly one of artist_id / ensemble_id must be set:
  constraint credit_one_target check (
    (artist_id is not null) <> (ensemble_id is not null)
  )
);
create index on credits (recording_id);
create index on credits (artist_id);
create index on credits (ensemble_id);
```

"Recordings by Carlos Kleiber" is now a join, not a flat ID array:
`select r.* from recordings r join credits c on c.recording_id = r.id where c.artist_id = $1;`

---

## 5. User-generated tables

```sql
-- profiles: 1:1 with Supabase auth.users
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text unique not null,          -- "quietcadenza"
  display_name text not null,
  photo_url    text,
  bio          text,
  role         user_role not null default 'user',  -- 'critic' feeds critic score
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table reviews (
  id              uuid primary key default gen_random_uuid(),
  recording_id    uuid not null references recordings(id) on delete cascade,
  author_id       uuid not null references profiles(id)   on delete cascade,
  rating          smallint not null check (rating between 1 and 5),  -- scale: open decision §8
  body            text,                        -- null/empty = rating-only
  contains_spoiler boolean not null default false,
  deleted         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- one review per user per recording, enforced by the DB:
  unique (recording_id, author_id)
);
create index on reviews (recording_id);
create index on reviews (author_id);
```

> The `UNIQUE (recording_id, author_id)` constraint is the native, bullet-proof
> version of "no duplicate reviews" — no app logic needed.

```sql
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

create table list_items (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references lists(id) on delete cascade,
  position     int  not null,
  recording_id uuid references recordings(id) on delete cascade,
  work_id      uuid references works(id)      on delete cascade,
  note         text,
  constraint list_item_one_ref check (
    (recording_id is not null) <> (work_id is not null)
  ),
  unique (list_id, position)
);

create table comments (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references profiles(id) on delete cascade,
  -- polymorphic target: exactly one of review_id / list_id
  review_id  uuid references reviews(id) on delete cascade,
  list_id    uuid references lists(id)   on delete cascade,
  parent_id  uuid references comments(id) on delete cascade,  -- threading
  body       text not null,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comment_one_target check (
    (review_id is not null) <> (list_id is not null)
  )
);

-- generic likes (reviews / comments / lists) via separate small tables keeps FKs clean:
create table review_likes  (review_id  uuid references reviews(id)  on delete cascade,
                            user_id uuid references profiles(id) on delete cascade,
                            primary key (review_id, user_id));
create table list_likes    (list_id    uuid references lists(id)    on delete cascade,
                            user_id uuid references profiles(id) on delete cascade,
                            primary key (list_id, user_id));
```

---

## 6. Scoring & analytics — this is where SQL shines

No aggregation script, no maintained `stats` columns. Scores are **views** over
the real review rows: always correct, always live, impossible for clients to fake
(they can't write a view).

```sql
-- 6.1 per-recording rating summary (live)
create view recording_ratings as
select
  r.id as recording_id,
  count(*)                                              as rating_count,
  round(avg(rv.rating)::numeric, 2)                     as avg_rating,
  count(*) filter (where p.role = 'critic')             as critic_count,
  round(avg(rv.rating) filter (where p.role = 'critic')::numeric, 2)  as critic_avg,
  round(avg(rv.rating) filter (where p.role <> 'critic')::numeric, 2) as audience_avg
from recordings r
left join reviews  rv on rv.recording_id = r.id and rv.deleted = false
left join profiles p  on p.id = rv.author_id
group by r.id;
```

```sql
-- 6.2 Bayesian ranking — so 1×5★ doesn't outrank a classic with 400 reviews.
--     bayes = (v/(v+m))*R + (m/(v+m))*C   with global mean C and prior weight m.
create view recording_scores as
with global as (
  select avg(rating)::numeric as c, 10::numeric as m   -- m = prior weight (tunable)
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
```

"Best recordings of a work" is then just:
`select * from recording_scores s join recordings r on r.id = s.recording_id
   where r.work_id = $1 order by s.bayes_score desc;`

```sql
-- 6.3 work-level roll-up (recording count + best recording)
create view work_stats as
select w.id as work_id,
       count(r.id) as recording_count,
       (select s.recording_id from recording_scores s
          join recordings r2 on r2.id = s.recording_id
         where r2.work_id = w.id order by s.bayes_score desc limit 1) as top_recording_id
from works w left join recordings r on r.work_id = w.id
group by w.id;
```

> If any of these get hot at scale, convert to a **materialized view** refreshed
> on a schedule (Supabase `pg_cron`) — a one-line change, still no app backend.

---

## 7. Row-Level Security (RLS) — Supabase's "security rules"

RLS is enforced *in Postgres*, so client-direct queries are safe.

```sql
alter table reviews enable row level security;

-- anyone can read non-deleted reviews
create policy reviews_read on reviews for select
  using (deleted = false);

-- a user may write only their own review
create policy reviews_write on reviews for insert
  with check (auth.uid() = author_id);
create policy reviews_update on reviews for update
  using (auth.uid() = author_id);
```

Sketch for the rest:
- `profiles`: read all; update only `auth.uid() = id`.
- catalog tables (`composers`, `works`, `recordings`, …): read all; write only if
  the caller's `profiles.role in ('moderator','admin')`.
- `lists`: read if `visibility = 'public'` or `owner_id = auth.uid()`; write owner.
- `comments`: read non-deleted; insert any authed user; update/delete author or moderator.
- Views inherit the RLS of their underlying tables — clients see only permitted rows.

---

## 8. Open decisions (need your call)

1. **Rating scale** — `check (rating between 1 and 5)` now. Switch to **1–10** for
   half-star nuance? One-line CHECK change; do it before data exists.
2. **Critic verification** — how does `profiles.role` become `'critic'`? Manual
   admin grant to start?
3. **Per-movement ratings** — keep recording as the smallest rateable unit (v1), or
   later allow rating individual `work_movements`?
4. **Following / activity feed** — add a `follows (follower_id, followee_id)` table +
   a feed query now, or later?
5. **Multi-composer works** (Mozart Requiem completions) — add a
   `work_composers` join table instead of a single `works.composer_id`?

---

## 9. Migrations & extensibility

Schema lives in **Supabase migration files** (`supabase/migrations/*.sql`), version
controlled in this repo. Extending the model = a new migration (`alter table …`),
applied locally then pushed. This is the "add on to the data model" path you wanted —
explicit, reviewable, and reversible, unlike schemaless drift.

---

## 10. Live concerts

A second rating world: real concerts you attend. A QR/code in the program links to
a `concerts` row; attendees check in and get timed prompts.

```sql
concerts (id, slug, title, venue, city, starts_at, ends_at,
          qr_code unique,         -- the code printed in the program
          ensemble_id → ensembles, description)

concert_program (concert_id → concerts, work_id → works, position)  -- ordered pieces

-- one row per (user, concert), created on QR check-in; flags drive the prompt queue
concert_checkins (concert_id, user_id → profiles,
                  checked_in_at, before_start, pre_done, post_done,
                  unique (concert_id, user_id))

-- per-piece responses: pre-concert (heard_before / prior_rating) + post (live_rating)
concert_piece_ratings (concert_id, user_id, work_id,
                       heard_before, prior_rating, live_rating,
                       unique (concert_id, user_id, work_id))

-- overall concert rating + text
concert_reviews (concert_id, user_id, rating 1–5, body, unique (concert_id, user_id))
```

**Prompt phases (computed from `now()` vs `starts_at`/`ends_at`):**
- before `ends_at` → **pre** prompt ("have you heard these? rate the ones you know").
- after `ends_at` → **post** prompt ("how was the concert + each piece live").
- **Prompt queue** (client): outstanding **post** reviews (ended, `post_done=false`)
  first, then **pre** prompts for upcoming concerts. Surfaced as a banner on login.

**RLS:** `concerts` / `concert_program` / `concert_reviews` are world-readable
(concerts are searchable; reviews public); `concert_checkins` and
`concert_piece_ratings` are **owner-only** (`auth.uid() = user_id`).

**Aggregate views** (so the public sees scores without exposing private responses):

```sql
create view concert_score as            -- overall, from concert_reviews
  select concert_id, count(*) ratings, round(avg(rating),2) avg_rating
  from concert_reviews group by concert_id;

create view concert_piece_score as      -- per-piece live score, from concert_piece_ratings
  select concert_id, work_id, count(live_rating) live_count,
         round(avg(live_rating),2) live_avg,
         count(*) filter (where heard_before) heard_count
  from concert_piece_ratings group by concert_id, work_id;

grant select on concert_score, concert_piece_score to anon, authenticated;
```

These views are owned by `postgres`, so they bypass the owner-only RLS on the base
tables and return only aggregates — individual `heard_before` / per-user ratings
stay private.
