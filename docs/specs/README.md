# Specs

Specification documents for features and changes. A spec is a record of
decisions made *before* building — the Problem, the Goal, the user-facing
behaviour, and the load-bearing choices with their rationale.

## Convention

- **Active specs** live directly in `docs/specs/` (e.g. `posts-and-rss.md`).
  An active spec describes work that is planned or in progress.
- **Shipped specs** move to `docs/specs/_archive/` **in the same commit that
  ships the feature.** Archiving signals "this is built; it's now a historical
  record, not a plan." The git history ties the spec to the change that
  realised it.
- A spec that is abandoned (decided against) also moves to `_archive/`, with a
  one-line note at the top recording that it was dropped and why.

## Why archive instead of delete

The decisions and rationale in a shipped spec stay useful — when revisiting the
code months later, the "why not X" notes explain choices the code can't. Keeping
them under `_archive/` preserves that context without cluttering the list of
work that's still ahead.

## Related

- `docs/decisions.md` — the running architectural decision log (shorter,
  cross-cutting). Specs are per-feature and deeper; decisions are the
  cross-feature throughline.
