# pedrocastro.eu

Personal site. Astro static build, deployed to Cloudflare Pages.

A *Now* section (auto-refreshed) and a **Posts** section with an RSS feed.
We're growing it into a Harper-style personal hub — Posts + RSS (done), plus a
**Media** log, **Links**, and **Photos** — all kept static and build-time, no
server or database. The old beehiiv newsletter has been removed from the site in
favour of self-hosted posts + RSS.

> **Direction & rationale:** see [docs/decisions.md](docs/decisions.md) for the
> decisions behind this (why drop beehiiv, how each section is sourced, build
> order) and [docs/specs/](docs/specs/) for per-feature specs.

## Local dev

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
npm run preview  # serve the built site
```

## Now + Media data (listening / reading / watching)

`scripts/fetch-now.mjs` pulls recent listening (Last.fm), reading (Goodreads),
watching films (Letterboxd) and watching series (Trakt, with TMDB posters) and
writes two files:

- `src/data/now.json` — the single latest item per type (the *Now* section).
- `src/data/media.json` — up to 5 per type within the last 3 months (the
  `/before/` timeline, merged into one reverse-chronological stream by
  `src/lib/media.ts`).

It runs every 4 hours inside the
[Build and deploy workflow](.github/workflows/deploy.yml) — the workflow commits
any change to either file and then redeploys.

To run it locally, drop credentials in a `.env` (gitignored) and:

```sh
node --env-file=.env scripts/fetch-now.mjs
```

Required env vars (each source is independent — leave one out to disable it):

| Var                     | Source     | How to get it |
| ----------------------- | ---------- | ------------- |
| `LASTFM_API_KEY`        | Last.fm    | <https://www.last.fm/api/account/create> |
| `LASTFM_USERNAME`       | Last.fm    | your handle |
| `GOODREADS_USER_ID`     | Goodreads  | numeric ID from your profile URL (`goodreads.com/user/show/<id>-name`) |
| `LETTERBOXD_USERNAME`   | Letterboxd | your handle |

> Reading data uses the public per-shelf RSS feeds (Goodreads killed their
> official API in 2020 but the feeds still work). *Now* reads the
> `currently-reading` shelf; the Media timeline reads the `read` shelf (finished
> books). Make sure neither is set to private in Goodreads → Settings.

> **Link fixes baked into the fetcher:** Last.fm URLs are re-encoded (`+` → `%20`,
> else their site 406s), Goodreads links point at the book (`/book/show/<id>`)
> rather than the review, and Letterboxd links point at the canonical film page
> (`/film/<slug>/`) rather than the personal diary entry.

See [docs/specs/_archive/media-log.md](docs/specs/_archive/media-log.md) for the
Media timeline design.

Add the same names as **repository secrets** under *Settings → Secrets and
variables → Actions* for the workflow.

> Why Last.fm and not Spotify directly? Spotify needs an OAuth refresh-token
> dance and a place to store the rotating token. Last.fm is one API key, one
> GET. Scrobble Spotify → Last.fm and you keep all your listening history
> centralised anyway.

## Posts

Posts are Markdown files in `src/content/posts/`, surfaced as a `posts`
[content collection](src/content.config.ts). Each post is a `.md` file with
`title`, `description`, and `pubDate` frontmatter (plus optional `updatedDate`
and `draft`). Publishing is `git push`.

- Index at `/posts/`; each post at `/posts/YYYY/MM/DD/<slug>/` (date segments
  derived from `pubDate`).
- RSS feed at `/rss.xml` via `@astrojs/rss`.
- `draft: true` posts show in `npm run dev` and are excluded from the production
  build.
- Shared list/sort/URL logic lives in `src/lib/posts.ts` so the index and feed
  never disagree.

See [docs/specs/_archive/posts-and-rss.md](docs/specs/_archive/posts-and-rss.md)
for the full design and rationale.

## Newsletter (beehiiv) — _removed_

The beehiiv newsletter has been removed from the site: the signup component and
all links to `newsletter.pedrocastro.eu` are gone. An email-send replacement
(Buttondown / Listmonk / RSS-to-email) is a separate, later decision.

> **Manual teardown still needed (outside this repo):** delete the
> `newsletter.pedrocastro.eu` CNAME in the Cloudflare DNS zone, and remove the
> Custom Web Domain + form in the beehiiv dashboard. Until then the subdomain
> may still resolve even though nothing here links to it.

## Deploy (Cloudflare Pages via GitHub Actions)

Deploys run from GitHub Actions, not from Cloudflare's build runtime. The
Pages project (`pedrocastro-eu`) just receives uploads — no git integration,
no build/deploy command in the dashboard. This avoids the unified-Workers
flow's auto-injected token + dashboard-line-wrapping headaches.

Required GitHub repo secrets (*Settings → Secrets and variables → Actions*):

| Var                     | What                                       |
| ----------------------- | ------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | API token with **Cloudflare Pages: Edit** scope |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID                 |
| `LASTFM_API_KEY`        | (also used by the cron refresh step)       |
| `LASTFM_USERNAME`       | ″                                          |
| `GOODREADS_USER_ID`     | ″                                          |
| `LETTERBOXD_USERNAME`   | ″                                          |

DNS for `pedrocastro.eu` runs on Cloudflare (zone managed there).
Attach the custom domain in the Pages project once via *Custom domains*.

## Structure

```
src/
  data/
    now.json                 # latest item per type (the Now section)
    media.json               # up to 5 per type within 3 months (the Before timeline)
  content.config.ts          # posts + flashes content collections (schema + loader)
  content/posts/*.md         # the posts themselves
  content/flashes/*.md       # the photolog entries (one per image)
  lib/
    now.ts                   # typed Now loader + relative-time + stars helpers
    posts.ts                 # posts list/sort/draft filter + URL + date helpers
    media.ts                 # timeline loader + merged reverse-chron stream
  layouts/Layout.astro       # base shell, sticky header nav, global styles
  components/
    NowCard.astro            # label + title + subtitle row (reused by Before)
  pages/
    index.astro              # homepage (bio + Now + Flashes preview + "Before →")
    posts/index.astro        # posts listing
    posts/[...slug].astro    # dated per-post page
    flashes/index.astro      # the photolog gallery
    before/index.astro       # the Before timeline (was /media/; not in nav)
    rss.xml.ts               # RSS feed
public/
  admin/                     # Sveltia CMS (index.html + config.yml)
  uploads/                   # CMS-uploaded images
scripts/
  fetch-now.mjs              # Last.fm + Goodreads + Letterboxd + Trakt → now + media
.github/workflows/
  deploy.yml                 # push + cron + manual; builds and deploys
```

## TODO before launch

- [x] Replace the placeholder bio + location in `src/pages/index.astro`.
- [x] Fill in real external links (GitHub, LinkedIn) in the same file.
- [x] Replace `public/favicon.svg` with something not-Astro-default (PC monogram in Fraunces).
- [ ] Write a real first post (the two seed posts are `draft: true`).

## Roadmap

Build order and rationale live in [docs/decisions.md](docs/decisions.md).

**Done:**

1. ~~**Posts + RSS** — Astro content collections + `@astrojs/rss`.~~ ✅
2. ~~**Media log** — music / books / films / series timeline from the cron feeds.~~ ✅
3. ~~**Photos** — a browse-only *Flashes* gallery, edited via Sveltia CMS.~~ ✅
4. ~~**Now** — homepage Now section with Binging/Seen cards, ordered chronologically.~~ ✅
5. ~~**Dark-mode toggle** + `prefers-reduced-motion` support — light/dark palettes with
   a header toggle, system-preference default, no-flash resolution, persisted choice.~~ ✅
6. ~~**View Transitions** — Astro's native `<ClientRouter />` for cross-page morphing;
   theme toggle rebound via document delegation so it survives body swaps.~~ ✅
7. ~~**SEO baseline** — `@astrojs/sitemap` (+ `robots.txt`), `BlogPosting` JSON-LD on
   posts, self-referential `<link rel="canonical">` + `og:url`, discoverable RSS
   `<link rel="alternate">`.~~ ✅
8. ~~**Analytics** — Cloudflare Web Analytics beacon (cookieless, no consent banner),
   production-only so dev browsing doesn't count.~~ ✅

**Planned.** Foundational polish is done; what's left is reordered to do the
low-effort, no-input work first and park anything that needs writing, personal
data, or a product decision until the end.

_Do next — little or no input needed:_

9. **Per-post OG images** — generated share cards (`astro-og` / Satori). Purely
   technical; first up.
10. **/colophon** — how the site is built, plus the privacy stance stated plainly:
    privacy-friendly, **cookieless** analytics (per #8), not "no analytics."
    Drafted from the repo; light edit pass only.

_Needs input — the personal / content-heavy pages:_

11. **/about** — the longer story + contact (homepage only has a one-line bio).
12. **/now** — a standalone status page (distinct from the auto-fed *Now* section);
    list it on nownownow.com.
13. **/uses** — hardware / software / config.
14. **Notes / digital garden** — a short, evergreen link-with-commentary stream,
    separate from the dated Posts. Open task first: nail the Notes-vs-Posts framing
    so Notes reads as genuine, not a second blog.

> **Dropped:** _Links (curated Raindrop feed)_ — no Raindrop account, and Notes
> already covers hand-picked "link + commentary." _Webmentions / IndieWeb POSSE
> backfeed_ — no social syndication to backfeed from.
>
> **Parked:** _Guestbook_ — privacy-friendly visitor messages; the only feature
> needing dynamic handling (storage + form + spam defense). Skipped for now; if
> revived, the clean fit is a Cloudflare Worker + D1 + Turnstile.
