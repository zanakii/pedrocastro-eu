# Decisions

A running log of architectural decisions for pedrocastro.eu. Newest first.
Each entry records *what* was decided and *why*, so future changes have context.

---

## 2026-09-14 — Bring series back via Simkl, refreshed by hand

**Context.** Series were dropped on 4 August 2026, when Trakt deleted the API
application behind the feed and gated a replacement behind VIP. Simkl was the
runner-up then, and episodes are now logged there.

**Decided:** Simkl feeds `series` in `now.json` and `media.json` again, but
**only on manual workflow runs**. Simkl's API rules ask apps not to run
unconditional background polling without user interaction, so the 4-hourly cron
skips it (`SIMKL_REFRESH` is set for `workflow_dispatch` alone) and carries the
last snapshot forward. A manual run checks `/sync/activities` first and pulls the
library only if TV or anime activity has moved since the stamp saved in
`media.json` as `seriesActivity`.

**Rejected.** A daily cron — still a timer, just a slower one. Fetching on visit
— it needs a Worker to keep the token out of the page and a cache so every visit
isn't a call, which is a backend and a datastore; and a visitor isn't the account
owner interacting anyway. The Colophon states the manual-only rule, so it has to
stay true.

**Costs.** Series go stale until a refresh is triggered; relative dates stay right
because every rebuild recomputes them. Simkl's payload has no episode titles, so
rows show `S2E5` and nothing more. The token comes from Simkl's PIN flow, lasts
about five years and can't be refreshed — re-run `scripts/simkl-token.mjs` when it
lapses, around September 2031. The API is free for non-commercial use; each row
linking to its Simkl page covers attribution. Posters come from Simkl, so TMDB
stays gone.

## 2026-08-11 — Group music by album, not by track

**Context.** Listening is mostly album-based, so the five music rows in
`media.json` were routinely five consecutive songs off one record — same artist,
same cover art, same afternoon. Two months of listening were being represented
by two artists, and the `/before/` timeline lost most of its time coverage.

**Decided:** collapse album listening into one row per album in the fetcher,
keyed on artist + album name (trimmed, lower-cased — Last.fm is inconsistent
about both). The row carries the album's distinct-track count and its most recent
play. Grouping spans the whole fetched history rather than consecutive runs, so
an album played in June and again in July is one row dated July.

**Why not group everything:** shuffle and playlist listening would produce a
wall of "1 track" albums, which is strictly worse than the tracks themselves. So
a group only collapses at **3+ distinct tracks**; below that the rows stay
per-track. `music[]` therefore holds both shapes, discriminated by `kind`, and
`describeListening` (`src/lib/now.ts`) is the single place either becomes card
text — shared by the homepage *Now* section and the `/before/` timeline so the
two can't drift.

**Homepage rule:** a *now playing* track stays track-shaped (that's the whole
point of "now"); once the moment has passed the card shows the album. This falls
out of the fetcher writing `now.listening` as `music[0]`.

**Costs.** The Last.fm `limit` went 30 → 200 (Last.fm's per-page max), since 30
scrobbles is only about three records and five album rows need the headroom.
Per-track granularity is not kept in `media.json` once grouped — recovering it
means refetching, which Last.fm's history supports. Album pages aren't in the
`recenttracks` payload, so the URL is built as `/music/<artist>/<album>` and
falls back to the track URL if either name is missing.

## 2026-06-19 — Expand the site into a Harper-style personal hub

**Context.** The site is a static Astro build deployed to Cloudflare Pages.
A GitHub Actions cron (`scripts/fetch-now.mjs`, every 4h) pulls Last.fm +
Goodreads + Letterboxd into `src/data/now.json`, commits any change, and
redeploys. The newsletter lives separately on beehiiv.

Inspired by [harper.blog](https://harper.blog/about/), we want to grow the
site into four content areas while keeping the static, build-time, no-server,
no-database model. Each area below is its own decision.

### 1. Scope: four content areas, all static & build-time

We add, on top of the existing *Now* section:

- **Posts** — a real blog with per-post pages and an RSS feed.
- **Media** — a running *log* (not just a snapshot) of music, books, and films.
- **Links** — a curated feed of things worth sharing.
- **Photos** — a gallery.

Everything stays static and build-time on Cloudflare Pages. No server, no
database. This is an evolution of the existing cron-fetch-to-JSON pattern plus
standard Astro content collections — not new infrastructure.

### 2. Drop beehiiv; posts + RSS become canonical

**Decided:** retire beehiiv. The Posts section + RSS feed become the canonical
home for written content. The email *send* path (e.g. Buttondown, Listmonk, or
RSS-to-email) is a **separate, later decision** — dropping beehiiv does not
block building posts+RSS, and we do not want to couple the two.

**Why:** keeping content on our own domain (`pedrocastro.eu`) is simpler than
syndicating out of beehiiv, removes a third-party dependency, and gives us full
control over presentation and the feed. The archive becomes the posts pages
themselves.

**Implication:** `newsletter.pedrocastro.eu` (beehiiv custom domain + CNAME) and
the beehiiv signup component become legacy to be removed once posts ship. The
README's beehiiv section will be retired at that point.

### 3. Posts via Astro content collections; RSS via `@astrojs/rss`

**Decided:** Markdown/MDX files in a `posts` content collection, rendered by a
`[slug]` page + an index, with the feed generated by `@astrojs/rss`.

**Why:** this is the standard, lowest-risk Astro path. Pure build-time, no new
services. Lets us decouple from beehiiv (decision 2) with no added infra.

### 4. Media: extend the cron into a history log

**Decided:** evolve the data model from a single *current* snapshot to an
append-style **log** of recent items (music / books / films), sourced from the
same Last.fm + Goodreads + Letterboxd feeds already in use. The *Now* section
keeps showing the latest item; the Media section shows the running history.

**Why:** we already fetch this data. The only change is persisting history
instead of overwriting. No new dependency.

### 5. Links: automate from Raindrop

**Decided:** source the curated Links feed automatically from
[Raindrop.io](https://raindrop.io) via its API, pulled by the cron alongside the
other media sources — not hand-maintained in Markdown/JSON.

**Why:** the user already wants a low-friction capture flow; Raindrop has a
clean API and a free tier, and bookmarking happens there naturally. This keeps
Links current without manual edits, matching the automation level of the rest of
the site. Cost: one more API token in the workflow secrets.

### 6. Photos: optimize for ease of upload (storage approach deferred)

**Priority (decided):** the photo workflow must make **uploading easy** — that
is the primary constraint, ahead of any particular storage backend.

**Decided so far:** committing full-size images into git (`public/photos`) is
*not* the target as a primary path — it bloats the repo and makes uploading a
git chore. We want a low-friction "drop it and it shows up" flow.

**Deferred:** the exact backend (Cloudflare R2 + a small upload/sync step,
Cloudflare Images with direct upload, or a watched drop-folder that syncs) is an
open decision to be made when the gallery is actually built. Whatever is chosen
is judged first by upload friction. Staying within the existing Cloudflare
ecosystem is preferred, all else equal.

### Build order

Posts + RSS first (backbone, lowest risk, enables dropping beehiiv), then Media
log, then Links, then Photos.
