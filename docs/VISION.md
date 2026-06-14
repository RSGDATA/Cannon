# New Canon — Vision & Architecture

> **Read this first.** Authoritative source of truth for what the project is and
> how it's built. If you are an AI agent or new contributor picking this up cold,
> read this whole file before touching anything. Companion: [`data-model.md`](./data-model.md).

---

## 1. The product

**New Canon is "Rotten Tomatoes for classical music."**

> You do **not** rate "Beethoven Symphony No. 5." You rate **a specific
> recording/performance** of it (e.g. *Carlos Kleiber / Vienna Philharmonic / 1974*).

Two rating worlds:
- **Recordings** — released/studio performances, with **critic** and **audience** scores.
- **Live concerts** — a concertgoer scans a **QR/code** in the program to check in,
  gets a **pre-concert** prompt ("have you heard these pieces? rate the ones you
  know") and, after, a **post-concert** prompt ("how was it — rate the concert and
  each piece live"). Concerts are searchable; everyone sees aggregate scores.

Mobile-first is the long-term goal (Flutter); the React web app exists today.

---

## 2. Core principle: Work ≠ Recording

```
composers ──< works ──< recordings >──< credits >── artists / ensembles
                  │                          │
                  │                          └──< reviews >── profiles (users)
                  └──< concert_program >── concerts >──< checkins / piece_ratings / reviews >── profiles
```

A `work` is the abstract composition; a `recording` is one captured performance;
a `concert` is a live event with a program of works. Ratings attach to
**recordings** and to **concerts/pieces**, never to abstract works.

---

## 3. The stack (LOCKED) — PostgreSQL via Supabase, zero cost

> The project pivoted **off Firebase** early on. The data is relational +
> analytical (joins, aggregates, rankings), which Postgres fits and Firestore did
> not. **Do not reintroduce Firebase or a separate backend server.**

| Layer | Choice |
|-------|--------|
| Database | **PostgreSQL** via **Supabase** |
| Data access | **Supabase client, direct from the app** (`@supabase/supabase-js`) — no custom backend |
| Security | **Row-Level Security (RLS)** policies in Postgres |
| Auth | **Supabase Auth** (email/password) |
| Analytics/scores | **SQL views** (e.g. `recording_scores`, `concert_score`, `concert_piece_score`) |
| Web app | **React + Vite + TypeScript** in `web/` |
| Web hosting | **Firebase Hosting** — serves the static React build only; the database/auth stay on Supabase (the two are independent and compatible) |
| Mobile app | **Flutter** — *not built yet* |
| Admin/seed tooling | **local Node/Python scripts** using the service-role key (`scripts/`) — trusted local tooling, **not** a deployed backend |

**Overriding constraint: ZERO COST.** Everything used is on Supabase's free tier;
the app runs locally (`cd web && npm run dev`). Don't introduce anything that
needs a paid plan/billing without explicit owner approval. No Cloud Functions, no
backend server — when something must be hidden/aggregated, use **RLS + SQL views**,
or a **local script** for one-off admin tasks.

> **Firebase Hosting is in scope** (it's where the web app deploys). That is *only*
> static file serving for the React build and is **not** a backend — it's fully
> compatible with the Supabase database. "No Firebase" means no Firestore /
> Cloud Functions / Firebase as a backend, **not** "no Firebase Hosting."

---

## 4. Current state (as of 2026-06)

| Thing | Value / status |
|-------|----------------|
| Supabase project | **New_Cannon** — ref `oqxfuwangycnsshpchfp`, org `phxgbotlvsjewcpzhmpe`, region West US, free tier |
| App env | `web/.env.local` (gitignored): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Schema | `supabase/migrations/*` — applied with `supabase db push` (needs the DB password) |
| Demo data | `scripts/seed_reviews.py`, `scripts/seed_concerts.py` (run with the service-role key in env) |
| Repo | GitHub `RSGDATA/Cannon` (public); CI = `.github/workflows/pr-checks.yml` (web build), required on `main` |
| Run it | `cd web && npm install && npm run dev` → http://localhost:5173 |

**Built and working:** catalog browsing (composers → works → recordings),
critic/audience scores, sign-in, writing reviews/ratings, recording detail pages,
and the full live-concert flow (search, QR/code check-in, pre/post prompts,
aggregate concert + per-piece scores, concert reviews).

**Demo accounts:** `alice@example.com` / `bob@…` / `carol@…`, password `password123`
(alice is a `critic`). Concert codes: `VIENNA24` (past), `NOW24` (live), `BERLIN24` (upcoming).

---

## 5. Guardrails for the next agent

- **No Firestore, no backend server, no Cloud Functions.** Database + auth = Supabase;
  use RLS + SQL views, or a local `scripts/` task. **Firebase Hosting IS used** —
  but only to serve the static web build (project `cannon-music-prod`), which is
  static hosting, not a backend. Don't delete that project.
- **Don't introduce paid services** without explicit owner approval (zero-cost).
- **Clients never write aggregate/score fields** — derived data lives in SQL views
  (owned by `postgres`, so they bypass RLS to aggregate) granted to `anon`/`authenticated`.
- **Keep `Work` / `Recording` / `Concert` distinct.** Ratings attach to recordings & concerts.
- Schema changes = a new **Supabase migration** in `supabase/migrations/`, then `db push`.

---

## 6. Not done yet / ideas
- Deploy the web app to **Firebase Hosting** (`cannon-music-prod`):
  `cd web && npm run build && firebase deploy --only hosting`. Supabase is already
  hosted. A CI auto-deploy can be re-added later (needs a fresh Firebase CI
  service-account key, since the old `FIREBASE_SERVICE_ACCOUNT` secret was removed).
- Real **camera QR scanning** (currently a typed code).
- **Sign-up** needs "Confirm email" turned off in Supabase Auth settings for instant prototype logins (sign-in with seeded accounts works now).
- Flutter mobile app. Composer pages. Concerts in the global search bar.
- Open data-model decisions: rating scale (1–5 vs 1–10), critic verification flow — see `data-model.md`.
