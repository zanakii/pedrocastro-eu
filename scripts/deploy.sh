#!/usr/bin/env bash
# Cloudflare Pages deploy script.
#
# Why this file exists: Cloudflare's dashboard input for the deploy command
# soft-wraps long commands and inserts literal newlines into the executed
# shell command, which breaks bash. Keeping the logic in a versioned script
# means the dashboard command stays a single short line.
#
# Env vars expected:
#   CF_DEPLOY_TOKEN  - Cloudflare API token with "Cloudflare Pages: Edit"
#                       (set as a build-time secret in Pages settings)
set -euo pipefail

PROJECT_NAME="pedrocastro-eu"
PRODUCTION_BRANCH="main"

# Use our scoped token (the build runtime's auto-injected CLOUDFLARE_API_TOKEN
# is more restricted and won't authenticate against the Pages API).
export CLOUDFLARE_API_TOKEN="${CF_DEPLOY_TOKEN:?CF_DEPLOY_TOKEN is not set}"

# Ensure the Pages project exists. First deploy creates it; later deploys
# get a "project already exists" non-zero exit which we ignore.
npx --yes wrangler pages project create "$PROJECT_NAME" \
  --production-branch="$PRODUCTION_BRANCH" 2>/dev/null || true

# --branch tells Pages which environment to deploy to. CF_PAGES_BRANCH is
# injected by the build runtime and matches the git branch being built —
# pushes to main go to production, branches/PRs go to preview URLs.
npx --yes wrangler pages deploy dist \
  --project-name="$PROJECT_NAME" \
  --branch="${CF_PAGES_BRANCH:-$PRODUCTION_BRANCH}"
