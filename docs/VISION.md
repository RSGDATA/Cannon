# Cannon — Vision & Architecture

> **Read this first.** This is the authoritative source of truth for what Cannon
> is and how it's built. If you are an AI agent or a new contributor picking this
> up cold, read this whole file before touching anything. Companion docs:
> [`data-model.md`](./data-model.md) (Firestore schema) and
> [`deploy-setup.md`](./deploy-setup.md) (CI/CD).

---

## 1. The product

**Cannon is "Rotten Tomatoes for classical music."**

People rate and review classical music — but not abstractly. The core insight:

> You do **not** rate "Beethoven Symphony No. 5."
> You rate **a specific recording / performance** of it
> (e.g. *Carlos Kleiber / Vienna Philharmonic / 1974*).

- **Mobile-first.** The Flutter mobile app is the primary way people interact
  with Cannon. The web app is secondary.
- Users discover composers and works, then rate/review individual **recordings**,
  build **lists** ("best Beethoven 5ths"), and discuss in **comments**.
- Scores come in two flavors, Rotten-Tomatoes style: a **critic score**
  (verified reviewers) and an **audience score** (everyone).

---

## 2. Core architectural principle: Work ≠ Recording

```
Composer ──▶ Work ──▶ Recording ◀── Review ◀── User
Beethoven   Sym. 5   Kleiber/VPO/74   ★★★★★
```

The single most important modeling rule: **a `Work` is the abstract composition;
a `Recording` is one captured performance of it. Ratings/reviews attach to
`Recording`, never to `Work`.** Everything in `data-model.md` flows from this.

---

## 3. Tech stack — LOCKED DECISIONS

These are deliberate, owner-made decisions. **Do not reverse them without an
explicit request from the owner.** (They were accidentally reversed once already
by an agent that lacked this context — hence this document.)

| Layer | Choice |
|-------|--------|
| Mobile app (primary) | **Flutter** |
| Web app (secondary) | **React** (Vite), served as static files via Firebase Hosting |
| Database | **Cloud Firestore** |
| Auth | **Firebase Auth** |
| Hosting | **Firebase Hosting** |
| Backend logic | **NONE — no Cloud Functions, no Node/server backend** |
| Search (later) | Algolia or Meilisearch |
| Images/audio (later) | Firebase Storage — *deferred, requires Blaze plan* |

### 3a. ⛔ NO Cloud Functions. This is intentional.

Cannon is a **serverless, client-only** application against Firebase. There is no
`functions/` directory, no deployed backend code, and the project deliberately
stays on the **free Spark plan** (Cloud Functions and the Storage default bucket
would force the paid Blaze plan).

**Why you still see Node.js in the repo:** Node is *not* a backend here. It exists
only because Firebase's own tooling runs on it:
- The **`firebase` CLI** (`firebase-tools`) is a Node program — it's how anything
  deploys to Firebase, locally or in CI. Unavoidable.
- The **React web build** (Vite) uses npm. (If the web app were hand-written
  static HTML, even this would be gone.)

Seeing `actions/setup-node` in a GitHub workflow = "install the tool that runs
`firebase deploy`," **not** "we have a Node server." There is no contradiction
between "only Firebase" and "Node appears in tooling."

### 3b. How ratings aggregate WITHOUT Cloud Functions

The "Rotten Tomatoes" scoring is the one thing that normally wants a backend.
Here is how it works serverlessly while staying tamper-resistant:

1. **Clients write only their own review.** Review doc ID is
   `{recordingId}_{uid}`, which structurally prevents duplicate reviews.
   Security rules forbid clients from writing *any* aggregate/score field.
2. **Display scores are computed live with Firestore aggregation queries**
   (`count()`, `average('rating')`) over a recording's reviews. These are
   computed server-side from the real review documents, so a client cannot fake
   a recording's average. Critic vs audience = the same query filtered on
   `authorSnapshot.isCritic`.
3. **Ranking scores** (the sortable Bayesian score used for "best recordings of
   Work X") are written by a **local Admin-SDK maintenance script** the owner
   runs on a schedule (manually or via their own cron). This is a script on a
   trusted machine using the Firebase Admin SDK — **not** a deployed Cloud
   Function. (Admin SDK scripts are the same category as the `firebase` CLI:
   trusted tooling, not app backend.)

**Accepted tradeoffs:**
- Ranking/leaderboard scores are **eventually consistent** — they refresh when
  the maintenance script runs (e.g. nightly), not the instant a review lands.
  Fine for a "best of" list.
- **Push notifications** and **automated moderation** are **out of scope** for
  this serverless design (they genuinely need a server). Moderation is handled
  by user reports + manual admin action.

See `data-model.md` §6 for the detailed aggregation mechanics.

---

## 4. Current infrastructure state (as of 2026-06)

| Thing | Value / status |
|-------|----------------|
| Firebase project | **`cannon-music-prod`** (`cannon-prod` was taken globally) |
| Billing plan | **Spark (free)** — stays free; no Functions/Storage default bucket |
| Firestore database | ⚠️ **not yet created** (Firestore API needs enabling on the project) |
| GitHub repo | **`RSGDATA/Cannon`** — **public** |
| CI secret | `FIREBASE_SERVICE_ACCOUNT` set (firebase-adminsdk key) |
| Branch protection | on `main`: 1 approving review required |
| Deploy pipeline | `.github/workflows/deploy-prod.yml` → deploys Firestore rules/indexes (+ Hosting once `web/` is scaffolded) on push to `main` |
| `web/` (React) | **not scaffolded yet** |
| `mobile/` (Flutter) | **not scaffolded yet** |

### Single-project setup
One Firebase project (`cannon-music-prod`) serves production. PR preview channels
use the same project (preview channels are isolated temp URLs). A `staging` alias
is reserved in `.firebaserc` but unused — add a staging project later if wanted.

---

## 5. Roadmap / phases

- **Phase 0 — Foundation (in progress):** repo, CI/CD, Firebase project, data
  model, this vision doc. Enable Firestore API + create the database.
- **Phase 1 — Catalog + reads:** seed composers/works/recordings; React + Flutter
  apps that browse the catalog. Firebase Auth login.
- **Phase 2 — Reviews:** users write reviews/ratings (deterministic IDs, rules
  enforce ownership). Display scores via aggregation queries.
- **Phase 3 — Ranking + lists:** maintenance script computes Bayesian scores;
  "best of" lists; user lists; comments.
- **Phase 4 — Search:** Algolia/Meilisearch. **Storage** (album art) if Blaze is
  acceptable by then.

---

## 6. Guardrails for the next agent

- **Do not add Cloud Functions / a Node backend.** It's a locked decision (§3a).
  If a task seems to "need" a Function, prefer: aggregation queries, security
  rules, deterministic IDs, or a local Admin-SDK maintenance script.
- **Do not enable the Blaze plan** without explicit owner approval (it's a
  billing change).
- **Keep `Work` and `Recording` separate.** Ratings live on recordings.
- **Clients never write aggregate/score fields** — enforce in security rules.
- The `firebase` CLI and Admin-SDK scripts are authenticated as
  `rgviolin1234@gmail.com` / via the `FIREBASE_SERVICE_ACCOUNT` secret in CI.

---

## 7. Open decisions (not yet locked)

These are noted in `data-model.md` §9 and still need owner input:
1. **Rating scale** — 5 whole stars vs 1–10 (half-star nuance). Affects types
   everywhere.
2. **Critic verification** — how a user becomes a verified `critic`.
3. Per-movement ratings; following/activity feed scope; multi-composer works.
