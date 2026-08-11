# pedrocastro.eu

Personal site. Astro static build → Cloudflare Pages. No backend, no database,
no framework in the browser.

## Commands

```sh
npm run dev                                  # local dev server
npm run build                                # static output in dist/
npm run preview                              # serve the built site
node --env-file=.env scripts/fetch-now.mjs   # refresh Now + Before data
```

`astro check` is **not installed** — don't run it, it triggers an interactive
installer. `npm run build` is the verification command.

## How it fits together

- `src/pages/` — routes. `index.astro` is the homepage (Now section, scraps,
  flashes). `before/` is the media timeline.
- `src/content/` — three collections: `posts`, `scraps`, `flashes`. Markdown.
  Posts with `draft: true` are excluded from PROD builds, so they 404 live.
- `src/data/now.json`, `src/data/media.json` — **generated**, see below.
- `src/lib/` — `now.ts` (types + card text), `media.ts` (timeline), `posts.ts`,
  `scraps.ts`.
- `.github/workflows/deploy.yml` — builds and deploys; a cron at `17 */4 * * *`
  also refreshes the data files, commits any change, and redeploys.

## The generated data files

`scripts/fetch-now.mjs` pulls Last.fm, Goodreads, and Letterboxd into
`now.json` (latest item per type) and `media.json` (up to 5 per type, 3-month
window). Rules that matter:

- **Never hand-edit or hand-merge these files.** On a merge conflict, take
  `origin`'s version and re-run the fetcher. Resolving the JSON by hand produces
  data that disagrees with what the next cron run will write.
- **Rebase before regenerating**, never after — otherwise you regenerate, hit a
  conflict, and throw the work away.
- Music rows are album-grouped at 3+ distinct tracks, otherwise per-track;
  `music[]` holds both shapes, discriminated by `kind`. `describeListening()` in
  `src/lib/now.ts` is the single place either shape becomes card text — the
  homepage and `/before/` both go through it, so they can't drift. Add rendering
  there, not at the call sites.
- Each source fails soft: a failed fetch preserves the previous value rather than
  blanking the site. Keep it that way.
- The local `.env` has no `LETTERBOXD_USERNAME`, so local runs skip films and
  fall back to whatever is committed. CI has the secret. Don't "fix" a frozen
  film entry locally — check the env first.

## Hard constraints

- **Static, build-time, no backend, no database.** Don't propose a solution that
  needs a server or a datastore. If something seems to need one, say so and stop.
- **Keep the 4-hourly cron cheap.** Free API tiers only, and it must fail soft.
  A change that could blank the site on a bad fetch is not acceptable.
- Minimal client-side JavaScript. Prefer build-time.

## Workflow

- **Plan first.** For anything touching code, present the approach and wait for a
  yes before editing files. Don't start implementing off an ambiguous ask.
- **`git fetch` before you begin.** The cron pushes to `main` every 4 hours, so
  local `main` is almost always behind. Check drift at the start, not at push.
- **Feature work never lands directly on `main`.** It goes on a branch and lands
  via PR. `chore:` and `docs:` commits *are* allowed straight to main — that's
  what the cron uses. A global pre-push hook enforces this, and a project
  PreToolUse hook (`.claude/hooks/guard-main-git.mjs`) applies the same rule to
  `git commit`, so a misplaced commit fails before it exists rather than at push.
  Deliberate override: prefix `ALLOW_MAIN=1`.
- Conventional commits (`feat(now):`, `chore(now):`, `docs:`).
- `docs/decisions.md` is a dated log, newest first — append an entry when a
  decision has a rationale worth keeping. Not required for every change.

## Definition of done

1. `npm run build` succeeds with no new errors.
2. **Verify the rendered output in `dist/`** — grep the built HTML and confirm
   the change actually appears on the page. A clean build is not proof the
   render path works.

## Prose and voice

You can edit reader-facing copy directly. Match what's there:

- **British spelling in prose** (behaviour, colour, optimise). Code and CSS stay
  American (`color:`) because the language forces it.
- First person, plain, dry. Em dashes for asides. No marketing register, no
  exclamation marks, no "delve" / "unlock" / "seamless".
- Long dates in prose: `23 July 2026`. Formatters elsewhere use `en-GB`.
- Say the honest thing — including when something is unfinished or was dropped.

## Gotchas

- **Shell:** the Bash tool is Git Bash on Windows. PowerShell here-strings
  (`@'...'@`) are a parse error there. Multi-line commit messages go through
  `git commit -F <file>`, never `-m` with embedded newlines.
- **Counting matches in built HTML:** use `grep -o … | wc -l`. Astro emits one
  long line, so `grep -c` counts lines and always reports 1.
- **Rebase inverts `--ours`/`--theirs`.** During a rebase, `--theirs` is the
  commit being replayed, not upstream. Prefer `git checkout <ref> -- <path>`.
- **Python on Windows** defaults to cp1252 and chokes on the accented artist and
  book names in the data files. Pass `encoding='utf-8'` explicitly.
- **Never write a raw control character into a file.** Write the escape sequence
  as text (backslash-u-0-0-0-0), not the character itself. A single NUL byte makes
  git reclassify the file as binary, killing diffs and blame on it permanently.
