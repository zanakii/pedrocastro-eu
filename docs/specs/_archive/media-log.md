# Spec: Media log

## Problem

The *Now* section shows a single current item per type — one track, one book,
one film. But everything before "now" is thrown away on each cron refresh. There
is no record of what was listened to last week or watched last month.

`docs/decisions.md` (2026-06-19, decision #4) committed to evolving the cron from
a *snapshot* into a *history* — the second content area after Posts. This spec
builds that: a `/media/` page showing a running timeline of music, books, and
films, sourced from the same Last.fm / Goodreads / Letterboxd feeds already in
use. Links (from Raindrop) remain the separate next step.

## Goal

- A `/media/` page: one combined, reverse-chronological timeline mixing music,
  books, and films — each row tagged with its kind (Harper-style).
- Keep the most recent ~20 items **per type**, refreshed every cron run.
- A "Before now →" link under the homepage *Now* section, into the timeline.
- Reuse the existing build-time, no-server, cron-to-JSON pattern. No new service.
- Add a **Media** item to the global header nav.

**Scope:** Music / books / films only. Out of scope: Links, Photos, and a
dedicated media RSS feed (all deferred — see Out of scope).

---

## User-facing behaviour

### `/media/` — the timeline

A single reverse-chronological list. Every item is one `NowCard` (reused from the
homepage), tagged by kind, sorted by its natural timestamp:

| Kind  | Timestamp used | Title        | Subtitle              |
|-------|----------------|--------------|-----------------------|
| Music | scrobble time  | track        | artist · album        |
| Book  | date finished  | book title   | author                |
| Film  | date watched   | title (year) | ★★★½ · rewatch         |

```
Media                                            ────────────

 [img] MUSIC
       Let Alone The One You Love
       Olivia Dean · The Art of Loving
       2h ago

 [img] FILM
       The Devil Wears Prada 2 (2026)
       ★★
       watched 9 May

 [img] BOOK
       Lost Lambs
       Madeline Cash
       finished 14 May
```

Each title links to the corrected destination from the link fixes shipped
alongside this (Last.fm `%20` URLs, Goodreads `/book/show/`, Letterboxd
`/film/`). Dates render relative (`2h ago`, `14 May`) via the existing
`formatRelative` in `src/lib/now.ts`.

**Music dominates recent entries** — twenty scrobbles can all be from today,
pushing books/films down. This is accepted: it's a listening-heavy log. Two
mitigations in the data: consecutive identical tracks are collapsed to one, and
a *now playing* track sorts to the top using the current time.

### Homepage — "Before now →"

Under the *Now* section on `index.astro`, a small text link to `/media/`,
labelled **Before now →**. It plays on the "Now" framing: the timeline is
everything that came before now. Subtle (muted, small), not a loud button.

### Header nav

`Home · Posts · Media`. The `Media` link is active on `/media/` (the nav lives in
`Layout.astro`; adding one array entry is the whole change).

## Data model

A new `src/data/media.json`, written by the same cron script. Per-type arrays —
kept separate in storage (readable, debuggable); merged + sorted into one
timeline at build time.

```jsonc
{
  "updatedAt": "2026-06-19T...Z",
  "music": [
    { "track": "...", "artist": "...", "album": "...", "url": "...",
      "image": "...", "playedAt": "2026-06-19T..Z", "nowPlaying": false }
    // up to 20, newest first
  ],
  "books": [
    { "title": "...", "author": "...", "url": "https://www.goodreads.com/book/show/..",
      "cover": "...", "readAt": "2026-05-14T..Z" }
    // up to 20
  ],
  "films": [
    { "title": "...", "year": "2026", "rating": 2, "rewatch": false,
      "url": "https://letterboxd.com/film/..", "poster": "...", "watchedAt": "2026-05-09T..Z" }
    // up to 20
  ]
}
```

**Why per-type arrays, not a pre-merged list:** the three feeds have different
date semantics and refresh independently; keeping them separate makes the JSON
legible and the merge logic testable in one place (`src/lib/media.ts`). The
combined-timeline decision is a *display* concern, resolved at build time.

## Backend changes

None. The cron writes a second static JSON file; the page renders it at build.

## Implementation notes

### Sourcing — extend `scripts/fetch-now.mjs`

The script already fetches all three sources for *Now*. It grows to also emit the
lists. Where a list and the Now item share a query, fetch once and derive both.

- **Music** — `user.getrecenttracks` with `limit=30`. `now.listening` = item `[0]`
  (unchanged). For media: collapse consecutive duplicate tracks, take 20. A
  `nowplaying` track has no `playedAt`; store `nowPlaying: true` and let the lib
  assign sort time.
- **Books** — a **new** fetch of the Goodreads `read` shelf
  (`?shelf=read`), newest first, take 20. `readAt` = `user_read_at` →
  fall back to `user_date_added`. (Distinct from `now.reading`, which stays on the
  `currently-reading` shelf — a book being read isn't a book finished.)
- **Films** — the diary loop already collects every dated entry; instead of
  keeping only the max, sort by `watchedDate` desc and take 20. `now.watching`
  = `[0]`.

All three reuse the link-correction helpers (`fixLastfmUrl`, `book/show/<id>`,
`letterboxdFilmUrl`) added in the link-fix change.

### Files touched

- `scripts/fetch-now.mjs` — emit `media.json` alongside `now.json`; add the `read`-shelf fetch; return lists from the three fetchers.
- `src/data/media.json` — **new**; generated artifact (seeded with empty arrays until the cron runs).
- `src/lib/media.ts` — **new**; types + `getMediaTimeline()` that normalises each kind to `{ kind, title, subtitle, href, image, date }` and returns one array sorted by `date` desc.
- `src/pages/media/index.astro` — **new**; maps the timeline to `NowCard`s.
- `src/layouts/Layout.astro` — add `{ label: 'Media', href: '/media/' }` to `nav`.
- `src/pages/index.astro` — add the "Before now →" link under the Now section.
- `.github/workflows/deploy.yml` — the commit step stages only `now.json`; extend it to also stage/commit `src/data/media.json`.
- `README.md` — document the media log + the new data file.

### Where the logic lives

- Normalisation + merge + sort: `getMediaTimeline()` in `src/lib/media.ts`, the single place display order is decided.
- Sort key: each item's own date. `nowPlaying` music → `Date.now()` so it leads.
- Relative dates: import `formatRelative` from `src/lib/now.ts` (already does `2h ago` / `14 May` / `Mar 2026`).

### Order of work

1. Extend `fetch-now.mjs`: return lists, add `read`-shelf fetch, write `media.json`.
2. Add `src/data/media.json` (empty arrays as a committed placeholder so the build is green before the first cron run).
3. `src/lib/media.ts` — types + `getMediaTimeline()`.
4. `src/pages/media/index.astro` — render the timeline with `NowCard`.
5. Add the `Media` nav entry + the homepage "Before now →" link.
6. Update `deploy.yml` to commit `media.json`; update README.
7. `npm run build`; eyeball `/media/`.

---

## Out of scope

- **Links** — the curated Raindrop feed; the separate next content area.
- **Photos** — area #4.
- **Media RSS** (`/media/rss.xml`) — deferred; the page is enough for now. The
  `@astrojs/rss` setup is already in place to add it later.
- **Unbounded archive** — we keep ~20 per type, not full history; accumulation +
  dedup is a later change if a real archive is wanted.
- **Filtering/toggles by kind** — a single mixed stream for now.

## Open questions

- **First populate of `media.json`** — locally we can't run the fetcher (`.env`
  is access-restricted), so the file ships with empty arrays and fills on the
  first CI cron run. If you'd rather it launch pre-filled, trigger the workflow
  manually before deploy.
