# Canon — Data Model

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
  truth is the parent; a Cloud Function fans out updates when a parent's display
  field changes (rare). See §7.
- **Soft delete:** user content (`reviews`, `comments`, `lists`) uses a
  `deleted: boolean` + `deletedAt` rather than hard delete, so threads and
  aggregates stay consistent. Catalog entities are admin-only and hard-deleted.
- **TS interfaces below** live in `shared/` and are imported by both Functions
  and (via codegen / hand-mirror) the Flutter + React clients.

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
  // denormalized aggregates (maintained by functions)
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
  // aggregates rolled up from recordings (maintained by functions)
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

  // --- aggregates (maintained ONLY by Cloud Functions; clients never write) ---
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
> "Recordings" page. Functions keep them in sync with `credits`.

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

### 6.1 Aggregation: how a recording's stats stay correct

All writes to `recordings.stats` happen in a Cloud Function reacting to review
changes. Clients **never** write `stats` (security rules forbid it).

`onReviewWrite` (Firestore trigger on `reviews/{id}` create/update/delete):

| Event | Effect on `recordings/{recordingId}.stats` (one transaction) |
|-------|--------------------------------------------------------------|
| create | `ratingCount += 1`, `ratingSum += rating`, `histogram[rating] += 1`, bump critic/audience bucket, recompute `avgRating`, scores |
| update (rating changed) | adjust sums by **delta**, move histogram bucket |
| delete / soft-delete | reverse the create |

Use `FieldValue.increment()` inside a transaction so concurrent reviews don't
clobber each other. Keeping `ratingSum` (not just avg) is what makes the
increment approach exact — you never recompute from scratch.

### 6.2 The two scores (Rotten Tomatoes parallel)

- **criticScore** — aggregate from `role: 'critic'` users only.
- **audienceScore** — aggregate from everyone else.

Both expressed 0–100. A 5-star → 100, mapping `score = (avg − 1) / 4 * 100`.

### 6.3 Ranking score (`bayesScore`) — why a single 5★ shouldn't win

A naive average lets a recording with one 5★ review outrank a beloved classic
with 400 reviews averaging 4.7. Use a **Bayesian (weighted) average** as the
sort key for "best recordings of Work X":

```
bayesScore = (v / (v + m)) * R  +  (m / (v + m)) * C

  v = this recording's ratingCount
  R = this recording's avgRating
  m = minimum reviews for confidence (tunable, e.g. 10)
  C = global mean rating across all recordings (a config doc, refreshed nightly)
```

With few reviews the score is pulled toward the global mean `C`; with many it
trusts the recording's own `R`. `m` and `C` live in `config/scoring` and are
refreshed by a scheduled function. This is the number `works.topRecordingId`
and all "best of" sorts are based on.

### 6.4 Roll-up to Work

`onRecordingStatsChange` recomputes the parent `works` doc's `recordingCount`,
`avgRating`, and `topRecordingId` (= recording with max `bayesScore`). Composer
counts roll up similarly when works/recordings are added.

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

Handled by triggered functions. For high-cardinality fan-out (a prolific user's
thousands of reviews) batch in chunks of 500 or queue via Tasks. Acceptable
because these edits are infrequent.

---

## 8. Security rules (sketch)

```
users/{uid}            read: all; write: request.auth.uid == uid (limited fields)
users/{uid}/private/*  read,write: owner only
composers, works,
artists, ensembles,
recordings             read: all; write: role in {moderator, admin}
recordings.stats       write: never from client (functions via Admin SDK bypass rules)
reviews/{rid_uid}      read: all (non-deleted);
                       create/update: auth.uid == uid AND id == rid+'_'+uid
                                      AND incoming has no stats/snapshot tampering
                       delete: owner or moderator (soft delete)
lists                  read: visibility=='public' OR owner; write: owner
comments               read: all (non-deleted); create: any auth user;
                       update/delete: author or moderator
```

Clients write only `rating` + `body` (+ a few flags) on reviews. All derived
data (`stats`, snapshots, counts) is function-owned and rule-blocked from
clients — this is exactly the "controlled, calculated, validated, or hidden
from the client" boundary from your brief.

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
  record is a near-direct projection. A function syncs on write.
- **Cloud Functions inventory** this model implies:
  `onReviewWrite` (aggregate stats) · `onRecordingStatsChange` (roll up to work)
  · `onCatalogDisplayChange` (denormalization fan-out) · `refreshScoringConfig`
  (scheduled, computes global mean `C`) · `syncSearchIndex` · `onUserProfileChange`.
- **`shared/` types:** every interface above becomes a TS type consumed by
  Functions and the React app; mirrored as Dart models in Flutter.
```
