# Deploy setup — GitHub repo + reviewed-deploy pipeline

This repo is wired for **deploy-to-production-on-review**:

- `main` is the production branch and is **protected** — changes land only via an approved PR.
- Every PR runs **`.github/workflows/pr-checks.yml`**: web/functions/Flutter checks plus a
  temporary Hosting **preview channel** with a live URL commented on the PR.
- Merging an approved PR pushes to `main`, which triggers
  **`.github/workflows/deploy-prod.yml`** → deploys hosting, functions, Firestore rules/indexes,
  and Storage rules to the `cannon-music-prod` Firebase project.
- The `production` GitHub Environment adds an optional second manual approval gate before deploy.

The files are committed, but a few **one-time, interactive/outward-facing steps** require your
own authenticated CLIs (a fork could not run `gh`/`firebase` auth or create the remote). Run these
once from the repo root.

---

## 1. Firebase projects

**Single-project setup for now.** `cannon-music-prod` is **already created** — production
deploys and PR preview channels both target it (preview channels are isolated temporary URLs and
never touch the live site). A separate staging project is deferred; `.firebaserc` keeps a
`staging` → `cannon-music-staging` alias reserved so you can add it later with no code changes.

```bash
firebase login   # only if not already authenticated
# prod already exists; to add staging later:
# firebase projects:create cannon-music-staging --display-name "Cannon (staging)"
```

`.firebaserc` maps `default`/`prod` → `cannon-music-prod` (and `staging` → `cannon-music-staging`, reserved).

## 2. Service-account key for CI

CI authenticates with one service-account JSON key (no personal login on the runner). One key
covers both prod deploys and PR preview channels since they share the project.

```bash
gcloud iam service-accounts create gha-deployer --project cannon-music-prod
gcloud projects add-iam-policy-binding cannon-music-prod \
  --member="serviceAccount:gha-deployer@cannon-music-prod.iam.gserviceaccount.com" \
  --role="roles/firebase.admin"
gcloud iam service-accounts keys create prod-sa.json \
  --iam-account=gha-deployer@cannon-music-prod.iam.gserviceaccount.com
```

> `roles/firebase.admin` is broad but simplest. For least-privilege, scope to
> `firebasehosting.admin`, `cloudfunctions.developer`, `datastore.owner`, `firebaserules.admin`.
> A more secure alternative to JSON keys is Workload Identity Federation — see step 6.

## 3. Create the GitHub repo and push

```bash
git init -b main
git add .
git commit -m "Initial commit: Firebase config + CI/CD pipeline"
gh repo create Cannon --private --source=. --remote=origin --push
```

## 4. Store the secrets in GitHub

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT < prod-sa.json
rm prod-sa.json   # do not commit this
```

## 5. Branch protection + production environment (the "reviewed" gate)

```bash
# Require an approving review and passing PR checks before merge to main
gh api -X PUT repos/:owner/Cannon/branches/main/protection \
  -f required_pull_request_reviews.required_approving_review_count=1 \
  -F enforce_admins=true \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=Web (lint, typecheck, build)' \
  -f 'required_status_checks.contexts[]=Functions (lint, build, test)' \
  -F restrictions=
```

Then in **Settings → Environments → New environment → `production`**, add yourself as a
**required reviewer**. That makes the prod deploy itself pause for a manual click after merge —
remove it if merge-equals-deploy is enough.

## 6. (Optional) Workload Identity Federation instead of JSON keys

Avoids long-lived keys. Configure a WIF pool/provider bound to this repo, then replace the
`credentials_json` input in `deploy-prod.yml` with `workload_identity_provider` +
`service_account`. The `google-github-actions/auth` action supports both.

---

## What each file does

| File | Role |
|------|------|
| `firebase.json` | Hosting/Firestore/Functions/Storage config + local emulator ports |
| `.firebaserc` | Maps `prod`/`staging` aliases to project IDs |
| `firestore.rules`, `storage.rules` | Security rules (currently locked-down placeholders) |
| `firestore.indexes.json` | Composite index definitions |
| `.github/workflows/pr-checks.yml` | Per-PR checks + preview channel |
| `.github/workflows/deploy-prod.yml` | Prod deploy on push to `main` |

## Notes / caveats

- The workflows **guard on file existence** (`web/package.json`, `functions/package.json`,
  `mobile/pubspec.yaml`), so they pass cleanly now and activate as each part is scaffolded.
- Replace the placeholder **security rules** before any real data goes live — current rules deny
  all client access.
- **Mobile is not deployed by this pipeline.** App Store / Play release needs signed builds and
  store review. Add a `build-mobile.yml` later to ship to TestFlight / Play internal testing; user
  release stays a separate gate.
