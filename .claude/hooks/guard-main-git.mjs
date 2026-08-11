#!/usr/bin/env node
// PreToolUse guard: keep feature work off main, mirroring the global pre-push
// hook rather than being stricter than it.
//
// Why: this repo's cron pushes `chore(now):` data refreshes to main every 4h, and
// the global pre-push hook rejects anything that isn't chore:/docs: on main.
// Discovering that at push time means the work is already committed on the wrong
// branch and has to be unwound. Failing here — before the commit exists — makes
// it a one-line fix.
//
// This hook allows exactly what the pre-push hook allows: chore:/docs: on main.
// A guard that has to be overridden routinely trains you to reach for the
// override, so it must not be stricter than the policy it enforces.
//
// Escape hatch: put ALLOW_MAIN=1 anywhere in the command.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ALLOWED_PREFIX = /^(chore|docs)(\([^)]*\))?!?:/i;

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

let command = '';
try {
  command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command ?? '';
} catch {
  allow(); // Unparseable payload is not this hook's problem to adjudicate.
}

const isCommit = /\bgit\s+commit\b/.test(command);
const isPush = /\bgit\s+push\b/.test(command);
if (!isCommit && !isPush) allow();
if (/\bALLOW_MAIN=1\b/.test(command)) allow();

let branch = '';
try {
  branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
} catch {
  allow(); // Not a git repo, or git unavailable — nothing to guard.
}
if (branch !== 'main') allow();

const BRANCH_HINT =
  'Run `git switch -c <branch>` and open a PR. Fetch first — the 4h cron pushes ' +
  'to main constantly, so local main is usually behind. Override: ALLOW_MAIN=1.';

// --- git commit: judge the subject line the command would produce -----------
if (isCommit) {
  // --dry-run inspects without writing, so it is always safe.
  if (/\s--dry-run\b/.test(command)) allow();

  let subject = null;
  const inline =
    command.match(/\s-m\s+'([^']*)'/) ??
    command.match(/\s-m\s+"((?:[^"\\]|\\.)*)"/) ??
    command.match(/\s--message=(?:'([^']*)'|"([^"]*)")/) ??
    command.match(/\s-m\s+(\S+)/);
  if (inline) subject = (inline[1] ?? inline[2] ?? '').split('\n')[0];

  const fromFile = command.match(/\s(?:-F|--file)\s+(?:'([^']*)'|"([^"]*)"|(\S+))/);
  if (subject == null && fromFile) {
    const path = fromFile[1] ?? fromFile[2] ?? fromFile[3];
    try {
      subject = readFileSync(path, 'utf8').split('\n')[0];
    } catch {
      subject = null;
    }
  }

  // No message on the command line (editor, or --amend reusing the old one):
  // can't judge it, so defer to the global pre-push hook rather than guess.
  if (subject == null) allow();

  if (ALLOWED_PREFIX.test(subject.trim())) allow();
  deny(
    `Refusing to commit "${subject.trim().slice(0, 60)}" on main. Only chore:/docs: ` +
      `commits belong on main here; everything else lands via PR. ${BRANCH_HINT}`,
  );
}

// --- git push: judge the commits that would actually go out -----------------
let subjects = [];
try {
  const range = `${git(['rev-parse', '--abbrev-ref', '@{upstream}'])}..HEAD`;
  subjects = git(['log', range, '--format=%s']).split('\n').filter(Boolean);
} catch {
  allow(); // No upstream to compare against — let the real pre-push hook decide.
}

if (subjects.length === 0) allow();
const offenders = subjects.filter((s) => !ALLOWED_PREFIX.test(s));
if (offenders.length === 0) allow();

deny(
  `Refusing to push ${offenders.length} non-chore/docs commit(s) to main: ` +
    `${offenders.map((s) => `"${s.slice(0, 50)}"`).join(', ')}. ${BRANCH_HINT}`,
);
