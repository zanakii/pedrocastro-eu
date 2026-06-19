---
title: A Now section that updates itself
description: Last.fm, Goodreads, and a cron job.
pubDate: 2026-06-02
---

The *Now* section on the homepage shows what I'm currently listening to,
reading, and watching. I didn't want to hand-edit it, so it updates itself.

A small script runs every four hours inside a GitHub Actions workflow. It pulls
my latest scrobble from Last.fm, my current book from the Goodreads RSS feed,
and my last film from Letterboxd. If anything changed, it commits the new data
and redeploys.

## Why these sources

- **Last.fm** over Spotify directly: one API key and a single GET, instead of an
  OAuth refresh-token dance and somewhere to store a rotating token. Scrobble
  Spotify into Last.fm and the history stays centralised anyway.
- **Goodreads RSS**: their official API died in 2020, but the per-shelf feeds
  still work. The script reads the `currently-reading` shelf.
- **Letterboxd RSS**: same idea — the public feed has everything needed.

No backend, no database. The data is a JSON file in the repo that a cron job
keeps fresh. It's the same pattern everything else here is built on.
