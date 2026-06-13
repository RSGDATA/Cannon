# Cannon — Data Model

> "Rotten Tomatoes for classical music."
> Firestore data model design. **Status: draft for review.** No code yet.

---

## 1. The core principle

You do **not** rate a *Work*. You rate a *Recording* of a Work.

```
Composer ── writes ──▶ Work ── is recorded as ──▶ Recording ◀── reviews ── User
 Beethoven           Symphony No. 5         Kleiber / VPO / 1974      ★★★★★
```

Everything in this model flows from that one separation. A `Work` is the
abstract composition (immutable musical fact). A `Recording` is one captured
performance of it (the thing with an opinion attached). Ratings, reviews, and
scores live on **Recordings**. Works inherit *aggregate* signal from their
recordings but are never rated directly.

---

## 2. Entity map

```
                       ┌────────────┐
                       │  composers │
                       └─────┬──────┘
                             │ 1‑to‑many
                       ┌─────▼──────┐
                       │   works    │
                       └─────┬──────┘
                             │ 1‑to‑many
                       ┌─────▼──────┐        many‑to‑many (credits)
            ┌──────────│ recordings │────────────┬───────────────┐
            │          └─────┬──────┘            │               │
            │                │             ┌─────▼─────┐   ┌──────▼─────┐
       ┌────▼────┐           │             │  artists  │   │ ensembles  │
       │ reviews │           │             │(people)   │   │ (groups)   │
       └────┬────┘           │             └───────────┘   └────────────┘
            │ written by     │ referenced by
       ┌────▼────┐      ┌─────▼─────┐
       │  users  │      │   lists   │
       └─────────┘      └───────────┘
            ▲                 ▲
            └──── comments ───┘   (comments target reviews or lists)
```

**Collections (all top-level):**
`users` · `composers` · `works` · `recordings` · `artists` · `ensembles` ·
`reviews` · `lists` · `comments`

### A note on "performers / conductors / ensembles"

Your brief listed `performers`, `conductors`, and `ensembles` separately. I'm
collapsing **performers + conductors into one `artists` collection**, because in
classical music the same *person* routinely does both — Barenboim conducts *and*
plays piano; Bernstein composed, conducted, and played. Modeling them as
separate collections would duplicate that person. Instead an `artist` carries
`roles: ['conductor', 'pianist']`, and the specific role they played on a given
recording is captured per-recording in its **credits** (see §5.4).

`ensembles` stays separate because an orchestra / quartet / choir is a *group*,
not a person, and has different fields (founded year, members, type).

---

## 3. Conventions

- **IDs:** human-readable slugs where the entity is canonical and shared
  (`composers/beethoven-ludwig-van`, `works/beethoven-symphony-5`), random
  auto-IDs for user-generated content (`reviews`, `comments`, `lists`).
- **Timestamps:** `createdAt`, `updatedAt` as Firestore `Timestamp`. Set via
  server timestamp.
- **Denormalization:** child docs cache the *display* fields of their parents
  (name, title, cover) so a screen renders from one query, not N. The source of
  truth is the parent; the maintenance script (§6.3) fans out updates when a parent's display
  field changes (rare). See §7.
- **Soft delete:** user content (`reviews`, `comments`, `lists`) uses a
  `deleted: boolean` + `deletedAt` rather than hard delete, so threads and
  aggregates stay consistent. Catalog entities are admin-only and hard-deleted.
- **TS interfaces below** live in `shared/` and are imported by the React client
  and the maintenance script (and mirrored as Dart models in Flutter). There is
  no Functions backend to import them.

---

## 4. Catalog collections (admin / curated)

These are the "facts." Written by moderators/admins or an import pipeline, not
by end users. Read by everyone.

### 4.1 `composers/{slug}`

```ts
interface Composer {
  id: string;                 // "beethoven-ludwig-van"
  name: string;               // "Ludwig van Beethoven"
  sortName: string;           // "Beethoven, Ludwig van"
  slug: string;
  era: Era;                   // 'baroque' | 'classical' | 'romantic' | 'modern' | 'contemporary'
  nationality?: string;       // ISO country or free text
  birthYear?: number;
  deathYear?: number | null;
  portraitUrl?: string;       // Firebase Storage
  bio?: string;               // markdown
  // denormalized aggregates (maintained by the maintenance script)
  workCount: number;
  recordingCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4.2 `works/{slug}`

The abstract composition.

```ts
interface Work {
  id: string;                 // "beethoven-symphony-5"
  composerId: string;         // → composers
  composerName: string;       // denormalized for display
  title: string;              // "Symphony No. 5"
  sortTitle: string;          // "Symphony No. 05 in C minor"
  slug: string;
  nicknames?: string[];       // ["Fate", "Schicksal"]
  form: WorkForm;             // 'symphony' | 'concerto' | 'sonata' | 'opera' | 'quartet' | 'lied' | ...
  key?: string;               // "C minor"
  catalog?: {                 // opus / catalogue number
    system: string;           // "Op." | "BWV" | "K." | "D." | "Hob."
    number: string;           // "67"
  };
  yearComposed?: number;
  instrumentation?: string[]; // ["orchestra"] or ["piano"], ["violin","piano"]
  movements?: { no: number; title: string; tempo?: string }[];
  // aggregates rolled up from recordings (maintained by the maintenance script)
  recordingCount: number;
  topRecordingId?: string;    // highest-scored recording, for "best of" links
  avgRating?: number;         // mean across all recordings' reviews (informational)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

> **Why `sortTitle` separate:** "Symphony No. 5" vs "No. 10" sort wrong as
> strings. Zero-pad in `sortTitle` for correct ordering in catalog views.

### 4.3 `artists/{slug}` (people: conductors, soloists, singers)

```ts
interface Artist {
  id: string;                 // "kleiber-carlos"
  name: string;               // "Carlos Kleiber"
  sortName: string;           // "Kleiber, Carlos"
  slug: string;
  roles: ArtistRole[];        // ['conductor'] | ['pianist','conductor'] | ['soprano']
  instruments?: string[];     // ['piano'] for soloists
  nationality?: string;
  birthYear?: number;
  deathYear?: number | null;
  photoUrl?: string;
  bio?: string;
  recordingCount: number;     // denormalized
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4.4 `ensembles/{slug}` (groups: orchestras, quartets, choirs)

```ts
interface Ensemble {
  id: string;                 // "vienna-philharmonic"
  name: string;               // "Vienna Philharmonic"
  slug: string;
  type: EnsembleType;         // 'orchestra' | 'quartet' | 'choir' | 'chamber' | 'opera-company'
  foundedYear?: number;
  nationality?: string;
  logoUrl?: string;
  recordingCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 4.5 `recordings/{slug}` — **the rateable object**

```ts
interface Recording {
  id: string;                 // "beethoven-symphony-5-kleiber-vpo-1974"
  workId: string;             // → works
  slug: string;

  // --- denormalized display snapshot (so a card renders from this doc alone) ---
  workTitle: string;          // "Symphony No. 5 in C minor"
  composerId: string;
  composerName: string;       // "Ludwig van Beethoven"
  primaryArtistName?: string; // "Carlos Kleiber" (conductor or lead soloist)
  ensembleName?: string;      // "Vienna Philharmonic"
  coverUrl?: string;          // album art (Storage)

  // --- the performance facts ---
  credits: Credit[];          // structured roster (see Credit)
  artistIds: string[];        // flat list for array-contains queries → "recordings by X"
  ensembleIds: string[];      // flat list, same purpose
  yearRecorded?: number;
  recordingType: 'studio' | 'live';
  venue?: string;
  label?: string;             // "Deutsche Grammophon"
  labelCatalogNo?: string;    // "DG 447 400-2"
  durationSec?: number;
  streaming?: {               // deep links
    spotify?: string;
    appleMusic?: string;
    youtube?: string;
  };

  // --- aggregates (maintained ONLY by the Admin-SDK maintenance script; clients never write) ---
  stats: RecordingStats;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface Credit {
  artistId?: string;          // → artists (xor ensembleId)
  ensembleId?: string;        // → ensembles
  name: string;               // denormalized display name
  role: string;               // "conductor" | "piano" | "violin" | "soprano" | "orchestra"
  isPrimary?: boolean;        // drives primaryArtistName / sort
}

interface RecordingStats {
  ratingCount: number;        // total reviews with a rating
  ratingSum: number;          // Σ ratings — enables increment-based avg
  avgRating: number;          // ratingSum / ratingCount (denormalized)
  histogram: Record<1|2|3|4|5, number>; // star distribution
  // dual scores, Rotten-Tomatoes style:
  criticCount: number;
  criticScore?: number;       // 0–100, from users with role 'critic'
  audienceScore?: number;     // 0–100, from everyone else
  bayesScore: number;         // ranking score (see §6.2) — sort key for "best of"
  lastReviewAt?: Timestamp;
}
```

> **`artistIds` / `ensembleIds`:** Firestore can't query inside the rich
> `credits[]` objects. The flat ID arrays exist purely so
> `where('artistIds','array-contains','kleiber-carlos')` powers an artist's
> "Recordings" page. The maintenance script keeps them in sync with `credits`.

---

## 5. User-generated collections

### 5.1 `users/{uid}` (doc ID = Firebase Auth uid)

```ts
interface User {
  uid: string;
  handle: string;             // "@quietcadenza", unique — enforce via /handles index doc
  displayName: string;
  photoURL?: string;
  bio?: string;
  role: 'user' | 'critic' | 'moderator' | 'admin';
  // 'critic' = verified, feeds criticScore; everyone else feeds audienceScore
  reviewCount: number;
  listCount: number;
  followerCount: number;
  followingCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Private/auth-only data (email, settings, blocked users) goes in a subcollection
`users/{uid}/private/profile` locked to the owner — never on the public doc.

### 5.2 `reviews/{recordingId}_{uid}` — **deterministic ID = no duplicate reviews**

A "rating" and a "review" are the **same object**: a review is a rating with an
optional `body`. Rating-only = `body` is empty. This avoids two parallel
collections that must agree.

The **doc ID is `{recordingId}_{uid}`**, which structurally guarantees one
review per user per recording — the "prevent duplicate reviews" requirement is
solved at the data layer for free; no function needed to police it.

```ts
interface Review {
  id: string;                 // "{recordingId}_{uid}"
  recordingId: string;        // → recordings
  authorId: string;           // → users (uid)

  rating: 1 | 2 | 3 | 4 | 5;  // required (half-stars? use 1–10 instead — see §9)
  body?: string;              // markdown; absent = rating-only
  containsSpoiler?: boolean;

  // denormalized snapshots → renders a feed item with no extra reads
  recordingSnapshot: {
    workTitle: string;
    composerName: string;
    primaryArtistName?: string;
    coverUrl?: string;
  };
  authorSnapshot: {
    handle: string;
    displayName: string;
    photoURL?: string;
    isCritic: boolean;        // bucket for critic vs audience score
  };

  likeCount: number;
  commentCount: number;
  deleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 5.3 `lists/{listId}` (auto-ID)

User-curated rankings, e.g. "The 10 Beethoven 5ths worth owning."

```ts
interface List {
  id: string;
  ownerId: string;
  title: string;
  description?: string;       // markdown
  visibility: 'public' | 'unlisted' | 'private';
  items: ListItem[];          // ordered; fine up to ~hundreds. Subcollection if huge.
  itemCount: number;
  likeCount: number;
  commentCount: number;
  coverUrl?: string;
  deleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface ListItem {
  refType: 'recording' | 'work';
  refId: string;
  note?: string;              // why it's on the list
  // denormalized so the list renders standalone:
  title: string;
  subtitle?: string;          // composer / performer line
  coverUrl?: string;
}
```

### 5.4 `comments/{commentId}` (auto-ID)

Threaded discussion on a review or a list.

```ts
interface Comment {
  id: string;
  targetType: 'review' | 'list';
  targetId: string;
  authorId: string;
  authorSnapshot: { handle: string; displayName: string; photoURL?: string };
  body: string;
  parentId?: string;          // null = top-level; else reply → one-level threading
  likeCount: number;
  deleted: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 6. Ratings & scoring — the heart of the app

> **SERVERLESS — NO CLOUD FUNCTIONS.** This is a locked architectural decision
> (see [`VISION.md`](./VISION.md) §3a). Aggregation is done with Firestore
> aggregation queries (live, on read) + a local Admin-SDK maintenance script
> (for sortable fields). Do not propose Cloud Functions to "fix" this.

### 6.1 Display scores: Firestore aggregation queries (live, on read)

A recording's **average rating and review count are NOT stored** as a
client-writable field. They are computed **on read** with Firestore
**aggregation queries** over the recording's reviews:

```ts
// average + count for a recording, server-computed from real review docs
const q = query(collection(db, 'reviews'),
                where('recordingId', '==', recordingId),
                where('deleted', '==', false));
const agg = await getAggregateFromServer(q, {
  count: count(),
  avg: average('rating'),
});
```

Because the aggregation runs server-side over the actual review documents, a
client **cannot fake** a recording's score — there is no stored number to tamper
with. The **critic vs audience** split is the same query with an added
`where('authorSnapshot.isCritic', '==', true / false)`.

Both scores are expressed 0–100 for display: `score = (avg − 1) / 4 * 100`
(for a 1–5 scale; adjust if the scale changes — see §9).

### 6.2 No duplicate reviews, no client-written aggregates

- **Duplicate prevention** is structural: review doc ID is `{recordingId}_{uid}`,
  so a user can only ever have one review per recording. No server logic needed.
- **Security rules forbid clients from writing any aggregate/score field.**
  Clients write only their own review (`rating`, `body`, a few flags). See §8.

### 6.3 Ranking score (`bayesScore`): a local maintenance script

Aggregation queries are perfect for *displaying one recording*, but you can't
efficiently **sort all recordings of a Work by a computed average** that lives
only at read time. Sorting needs a **stored, indexable** number.

A naive average also lets a recording with one 5★ review outrank a classic with
400 reviews at 4.7. So the sort key is a **Bayesian (weighted) average**:

```
bayesScore = (v / (v + m)) * R  +  (m / (v + m)) * C

  v = this recording's ratingCount   (from an aggregation query)
  R = this recording's avgRating      (from an aggregation query)
  m = minimum reviews for confidence (tunable, e.g. 10)
  C = global mean rating across all recordings
```

**How it gets written (no Cloud Function):** a **local Node maintenance script**
using the Firebase **Admin SDK**, run by the owner on a schedule (manually, or
the owner's own cron). It:

1. computes `C` (global mean) across all reviews,
2. for each recording, runs the count/avg aggregation, computes `bayesScore`,
   and writes `stats` + `bayesScore` to the recording doc (Admin SDK bypasses
   security rules — that's why only this trusted script may write these fields),
3. rolls up `works` (`recordingCount`, `avgRating`, `topRecordingId` = max
   `bayesScore`) and `composers` counts.

This is the same category of tool as the `firebase` CLI — trusted local tooling,
**not** deployed app backend. Lives at e.g. `scripts/recompute-scores.ts`.

**Tradeoff:** ranking/leaderboard values are **eventually consistent** — they
update when the script runs (e.g. nightly), not the instant a review lands. Live
per-recording display scores (§6.1) are always current; only the *sortable* roll-ups lag.

### 6.4 `RecordingStats` is script-owned, read-only to clients

The `stats` block on a recording (and `works` roll-ups) is written **only** by
the maintenance script. Clients read it for sorting/leaderboards but can never
write it (enforced in rules). For an always-fresh single-recording score, clients
use the §6.1 aggregation query rather than trusting stored `stats`.

---

## 7. Denormalization & fan-out

Cached display fields keep reads cheap but must be refreshed when the source
changes. These are *rare* (an admin fixing a composer's name), so fan-out cost
is acceptable.

| When this changes | Fan out to |
|-------------------|------------|
| `composer.name` | its `works.composerName`, `recordings.composerName` |
| `work.title` | its `recordings.workTitle`, any `reviews.recordingSnapshot` |
| `user.displayName/photoURL` | that user's `reviews.authorSnapshot`, `comments.authorSnapshot` |
| `recording` cover/primary artist | that recording's `reviews.recordingSnapshot` |

Handled by the **local Admin-SDK maintenance script** (same one as §6.3), not a
Cloud Function. Because these source edits are *rare* (an admin fixing a
composer's name), refreshing the denormalized copies on the next script run — or
a targeted one-off script invocation — is fine. For high-cardinality fan-out (a
prolific user's thousands of reviews) the script batches writes in chunks of 500.
Brief staleness of a cached display name between edit and script run is acceptable.

---

## 8. Security rules (sketch)

```
users/{uid}            read: all; write: request.auth.uid == uid (limited fields)
users/{uid}/private/*  read,write: owner only
composers, works,
artists, ensembles,
recordings             read: all; write: role in {moderator, admin};
                       recordings.stats / bayesScore: NEVER from client
                       (only the Admin-SDK maintenance script writes these —
                        Admin SDK bypasses rules)
reviews/{rid_uid}      read: all (non-deleted);
                       create/update: auth.uid == uid AND id == rid+'_'+uid
                                      AND request only touches rating/body/flags
                                      (no stats/snapshot/count tampering)
                       delete: owner or moderator (soft delete)
lists                  read: visibility=='public' OR owner; write: owner
comments               read: all (non-deleted); create: any auth user;
                       update/delete: author or moderator
```

Clients write only `rating` + `body` (+ a few flags) on reviews. All derived
data (`stats`, `bayesScore`, snapshots, counts) is **script-owned** and
rule-blocked from clients. There is **no Cloud Function** — the trust boundary is
held by (a) security rules that reject client writes to derived fields, (b)
live aggregation queries computed server-side from real review docs (§6.1), and
(c) the trusted local Admin-SDK script for sortable roll-ups (§6.3).

---

## 9. Open decisions (need your call before scaffolding)

1. **Rating scale.** 5 stars (whole) is simplest. But classical reviewers love
   nuance — consider **1–10** (half-star feel) or even 0–100. Changes the
   `rating` type everywhere. *My lean: 1–10, displayed as 5 stars w/ halves.*
2. **Critic verification.** How does someone become `role: 'critic'`? Manual
   admin grant to start? Affects whether `criticScore` is meaningful at launch.
3. **Movements / timings per recording.** Do you want per-movement durations and
   eventually per-movement ratings, or is the recording the smallest unit? (I'd
   keep recording as the unit for v1; movements optional metadata.)
4. **Following / activity feed.** Implied by `followerCount`. In scope for the
   data model now, or add the `follows` collection + feed fan-out later?
5. **Works with multiple composers** (collaborations, completions — Mozart
   Requiem). Rare; model `composerId` as primary + optional `additionalComposerIds[]`?

---

## 10. What this sets up for later

- **Algolia/Meilisearch:** index `works`, `recordings`, `composers`, `artists`,
  `ensembles`. Searchable fields are already denormalized onto each doc
  (composer + work + performer names all live on the recording), so the search
  record is a near-direct projection. The **maintenance script** pushes records
  to the search index (no Cloud Function); acceptable since the catalog changes
  slowly.
- **Maintenance script** (`scripts/`, Admin SDK, run by owner — NOT a deployed
  Function) owns all derived data: recompute `bayesScore` + roll-ups (§6.3),
  denormalization fan-out (§7), and search-index sync. This is the only
  "backend" Cannon has, and it runs on a trusted machine, not in the cloud.
- **`shared/` types:** every interface above becomes a TS type consumed by the
  React app + the maintenance script; mirrored as Dart models in Flutter.
```
