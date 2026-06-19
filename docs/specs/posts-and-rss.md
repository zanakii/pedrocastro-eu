# Spec: Posts + RSS

## Problem

The site has no home for writing. Written content currently lives in beehiiv,
a third-party service on `newsletter.pedrocastro.eu` — which `docs/decisions.md`
(2026-06-19) decided to retire. Until posts live on `pedrocastro.eu` itself,
beehiiv can't actually be dropped: it's the only thing on the critical path to
removing that dependency.

Everything else planned (Media log, Links, Photos) is additive texture around
the writing. A reader landing on the site today gets a one-line bio and a *Now*
section, with nothing to actually read. This spec is the backbone: a real Posts
section with per-post pages and an RSS feed, built the standard static Astro way
— no server, no database, no new external service.

## Goal

- Author posts as plain Markdown files in the repo; `git push` publishes them.
- A `/posts/` index listing posts newest-first, and a dated per-post URL.
- A valid RSS 2.0 feed at `/rss.xml`.
- A discoverable link from the homepage to `/posts/`.
- Draft posts visible in `npm run dev`, excluded from the production build.
- Zero new infrastructure or third-party services. Pure build-time.

**Scope:** This is the first of the four content areas in `docs/decisions.md`.
Out of scope here: Media log, Links, Photos, and the beehiiv email-send
replacement (all separate, later work).

---

## User-facing behaviour

### `/posts/` — the index

A single page, same `Layout` shell and 40rem column as the homepage. Posts
listed newest-first by `pubDate`. Each row: title (links to the post), date,
and the one-line description.

```
Posts                                            ────────────

  Why I dropped beehiiv
  19 Jun 2026 · Owning my words on my own domain.

  Building a Now section that updates itself
  02 Jun 2026 · Last.fm, Goodreads, and a cron job.
```

Dates render absolute (`19 Jun 2026`, `en-GB`), not relative — posts are
dated artifacts, not "3d ago" activity like the *Now* section.

### `/posts/YYYY/MM/DD/<slug>/` — a single post

- URL is dated: `/posts/2026/06/19/why-i-dropped-beehiiv/`. The slug derives from the filename; the `YYYY/MM/DD` segments are derived from `pubDate`, so the date lives in exactly one place (frontmatter) — no filename/frontmatter drift.
- Header: title (serif `h1`), then a muted date line (`19 Jun 2026`, plus `· updated 21 Jun 2026` when `updatedDate` is set).
- Body: rendered Markdown.
- A back-link to `/posts/`.
- `<title>` and `og:` meta come from the post's `title`/`description` via the existing `Layout` props.

**Why a dated path** rather than a flat `/posts/<slug>/`: it reserves ground for
year/month archive pages (`/posts/2026/`, `/posts/2026/06/`) later, and dates the
artifact in the URL itself.

**Tradeoff, accepted deliberately:** correcting a `pubDate` after publishing
changes the post's URL. That's the cost of a dated path; we've chosen the extra
structure over link-immutability. Mitigation if it ever bites: a Cloudflare
redirect rule for the rare corrected post.

### Homepage link

`index.astro` stays a single page with its *Now* section. A text **Posts** link
is added to the header — a sibling to the existing icon link row — pointing at
`/posts/`. (The beehiiv "Newsletter" icon link stays for now; it's flagged
legacy in the README and removed when beehiiv is.)

### Feed discovery

`<link rel="alternate" type="application/rss+xml" title="Pedro Castro" href="/rss.xml">`
added to `Layout`'s `<head>` so browsers and readers auto-discover the feed.

## Data model

No database. A single Astro **content collection** backed by the Markdown files.

`src/content.config.ts`:

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  // Astro 6 content layer: load Markdown from disk.
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),         // one-liner; used on the index and in <meta> + RSS
    pubDate: z.coerce.date(),        // sort key + URL date segments; coerce so `2026-06-19` parses
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false), // hidden in prod, shown in dev
  }),
});

export const collections = { posts };
```

Example post frontmatter (`src/content/posts/why-i-dropped-beehiiv.md`):

```md
---
title: Why I dropped beehiiv
description: Owning my words on my own domain.
pubDate: 2026-06-19
---

Body text in Markdown…
```

**Why `draft` as a boolean default-false** rather than a separate folder: keeps
all posts in one place, lets a post flip to published with a one-line frontmatter
edit, and the filter lives in code where it's testable.

**Why Markdown only (no MDX):** none of the planned posts need embedded
components. `@astrojs/mdx` can be added later for a single post that needs it,
without migrating the others — `.md` and `.mdx` coexist in one collection.

## Backend changes

None. Static build only. The RSS feed is a build-time-rendered route, not a
server endpoint.

## Implementation notes

### Config

`astro.config.mjs` is currently empty (`defineConfig({})`). Add:

```js
export default defineConfig({
  site: 'https://pedrocastro.eu',
});
```

`site` is **required** for `@astrojs/rss` to emit absolute item URLs and for any
canonical/OG absolute URLs. Without it the feed links are relative and invalid.

### Files touched

- `astro.config.mjs` — add `site`.
- `src/content.config.ts` — **new**; the `posts` collection above.
- `src/content/posts/*.md` — **new**; 2 seed posts so the index and feed aren't empty.
- `src/pages/posts/index.astro` — **new**; the listing.
- `src/pages/posts/[...slug].astro` — **new**; the per-post page via `getStaticPaths` (catch-all, see below).
- `src/pages/rss.xml.ts` — **new**; the feed.
- `src/layouts/Layout.astro` — add the RSS `<link rel="alternate">`; add scoped prose styles (see below).
- `src/pages/index.astro` — add the **Posts** header link.
- `package.json` — add `@astrojs/rss`.
- `src/lib/posts.ts` — **new**; `formatDate`, `getSortedPosts()` (filters drafts + sorts), and `postPath(post)` so the index and feed share one definition of the URL shape.

### Prose styling — the one real gotcha

`Layout.astro`'s global `h2` is styled as a tiny uppercase **section label**
(`font-size: 0.72rem; text-transform: uppercase`, with a trailing rule) — correct
for "NOW"/"POSTS" eyebrows, **wrong** for an `## Heading` inside a post body.

The post body must be wrapped and scoped so Markdown headings render as real
headings:

```astro
<article class="prose">
  <Content />
</article>
```

with `.prose h2 { … }` / `.prose h3 { … }` overrides (normal weight, serif or
sans, no uppercase, no rule) plus list/blockquote/code spacing. Keep these
local to the post page (or a `.prose` block in `Layout`) so the homepage's
section labels are untouched.

### Where the logic lives

- Draft filter + sort: `src/lib/posts.ts`, consumed by both `posts/index.astro` and `rss.xml.ts`. Filter rule: `import.meta.env.PROD ? !post.data.draft : true` — drafts visible in dev, dropped in prod.
- URL shape: `postPath(post)` in `src/lib/posts.ts` returns `/posts/${yyyy}/${mm}/${dd}/${id}/`, derived from `pubDate` (UTC). Used by the index links, the post's own canonical/back context, and the RSS `link` field — defined once so they never disagree.
- Path generation in `[...slug].astro`:

```ts
import { getSortedPosts } from '../../lib/posts';

export async function getStaticPaths() {
  const posts = await getSortedPosts();
  return posts.map((post) => {
    const d = post.data.pubDate;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return {
      params: { slug: `${yyyy}/${mm}/${dd}/${post.id}` }, // catch-all flattens the multi-segment path
      props: { post },
    };
  });
}
```

The `[...slug].astro` **catch-all (rest) param** is what lets one route file emit
the multi-segment dated path; a non-rest `[slug].astro` could not.

- Rendering a post body: `import { render } from 'astro:content'; const { Content } = await render(post);` inside `[...slug].astro`.
- Feed: `@astrojs/rss`'s `rss({ title, description, site: context.site, items })`, mapping each post via `postPath(post)` to `{ title, description, pubDate, link }`.

### RSS content depth

v1 feed carries **title + description + link + pubDate** — not full post HTML.
Lighter, no HTML-sanitisation step, and it nudges readers to the site. Full-content
items (`content:encoded`) can be added later if subscribers ask. Recorded as a
deliberate v1 choice, not an oversight.

### Order of work

1. Add `site` to `astro.config.mjs`.
2. Create `src/content.config.ts` + 2 seed posts.
3. Build `[...slug].astro` with scoped `.prose` styles; verify the generated path is `/posts/2026/06/19/<slug>/`, headings render correctly, and the back-link resolves under the deeper nesting.
4. Build `posts/index.astro` (+ `src/lib/posts.ts`).
5. Add `@astrojs/rss` and `rss.xml.ts`; validate the feed XML and that item links are absolute and dated.
6. Add the homepage **Posts** link and the `<link rel="alternate">` in `Layout`.
7. `npm run build` and confirm drafts are excluded from `dist/`.

---

## Out of scope

- **Media log, Links, Photos** — the other three areas in `docs/decisions.md`.
- **beehiiv removal and the email-send replacement** — dropping beehiiv is a
  separate step once posts ship; choosing a send path (Buttondown/Listmonk/
  RSS-to-email) is its own decision.
- **Year/month archive pages** (`/posts/2026/`, `/posts/2026/06/`) — *enabled but
  deferred*: the dated URL reserves the ground for these, but they aren't built
  in v1. Add by grouping posts on the path segments when the volume justifies it.
- **Tags, categories, search, pagination** — not needed at current volume.
- **Full-content RSS** — see "RSS content depth"; deferred, not rejected.
- **MDX** — deferred until a post actually needs components.

## Open questions

- **Comments / webmentions** — none planned for v1; flag if that changes how the
  post page is structured before it ships.
