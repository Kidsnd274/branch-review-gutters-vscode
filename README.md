# Branch Review Gutters

Review a feature branch by *browsing the repository*, not by opening diff
editors. The extension marks every line that changed relative to the merge base
of a base branch and `HEAD` directly in the normal editor gutter, so Go to
Definition, Find References, call hierarchy and diagnostics all keep working
while you read the change.

Private extension. No network access, no telemetry, not published.

## What it shows

- **Gutter markers** for added, modified and deleted lines, comparing the live
  editor buffer against the file's content at
  `git merge-base <base> HEAD`. Click a marker to peek the original, exactly
  like the built-in Git gutter.
- **Explorer badges** — `A`, `U`, `M`, `R` — on every file that differs from
  the base, with the colour propagated to parent folders.
- **A status bar item** (bottom right) showing on/off state and the active
  base. Clicking it opens a menu with every command.

## How it differs from the built-in Git gutter

The built-in Git extension ships two quick diff providers: *working tree*
(HEAD/index vs the file on disk) and *index* (HEAD vs staged content). Neither
uses a merge base, so on a clean checkout of a feature branch both are empty —
the built-in gutter shows you your uncommitted edits, not your branch.

This extension adds a third provider whose original is the file at
`merge-base(main, HEAD)`. On a clean checkout its markers are the only ones in
the gutter; with unsaved edits both render, and the peek view's provider
switcher labels each one. VS Code renders every registered quick diff provider,
and a provider contributed this way is drawn in the *primary* gutter colours,
so branch markers are exactly as visible as git's own.

## Commands

All are under the **Review Gutters** category in the Command Palette.

| Command | What it does |
|---|---|
| Toggle / Enable / Disable Review Gutters | Turns markers and badges on or off for the active editor's repository |
| Select Base Branch or Commit… | Picks a local branch, remote branch, tag, or a typed ref/SHA, then merge-base or exact mode |
| Auto-detect Base Branch | Returns to automatic detection and reports what it found |
| Refresh Comparison | Re-resolves the baseline and reloads the change set |
| Clear Base Selection | Back to auto-detect; leaves the on/off state alone |
| Show Changed Files… | Quick pick of everything that differs from the base, deletions included |
| Next / Previous Changed File | Walks the sorted change set, wrapping at the ends |
| Next / Previous Change in File | Delegates to VS Code's `editor.action.dirtydiff.next` / `.previous` |
| Open Base Version of Current File | Opens the file as it is at the base, read-only |
| Compare Current File with Base | Opens a normal diff editor, on request only |
| Show Log | Reveals the "Branch Review Gutters" output channel |

Nothing is bound to a keyboard shortcut by default.

## Base detection

With the selection set to `auto`, candidates are tried in order:

1. each name in `reviewGutters.baseBranches` (default `main`, `master`);
2. each of those on the remote, e.g. `origin/main`;
3. the remote's default branch, from `refs/remotes/<remote>/HEAD`.

The first that resolves wins, and the comparison point is
`merge-base(candidate, HEAD)`. Choosing a base manually offers two modes:

- **merge base** (recommended) — only changes made on this branch since it
  diverged;
- **exact** — compares directly against the ref, so changes made *on that ref*
  since divergence also show. The mode question is skipped when the chosen ref
  is already an ancestor of `HEAD`, where the two are identical.

Selections and the on/off state are remembered per repository, per workspace.

## Settings

| Key | Default | Purpose |
|---|---|---|
| `reviewGutters.baseBranches` | `["main", "master"]` | Auto-detection candidates, in order |
| `reviewGutters.remote` | `"origin"` | Remote for `<remote>/<branch>` fallbacks |
| `reviewGutters.explorerBadges` | `true` | Explorer badges and colours |
| `reviewGutters.maxFileSizeKB` | `1024` | Skip base versions larger than this |
| `reviewGutters.excludeGlobs` | `[]` | Repo-relative globs never decorated, e.g. `["*.lock", "generated/**"]` |
| `reviewGutters.logLevel` | `"info"` | Output channel verbosity |

## Limitations

- **Non-UTF-8 files** are decoded as UTF-8; markers on them may be noisy.
- **Binary files** (a NUL in the first 8000 bytes) and files over
  `maxFileSizeKB` are skipped entirely, so no markers appear rather than
  false ones. The status bar tooltip counts them.
- **Deleted files** have no Explorer node; they appear in the changed-files
  picker and open read-only at the base version.
- **Untracked files** are marked `U` and shown as entirely added.
- The right-hand side of the comparison is always the **live buffer**, so
  uncommitted edits are included. There is no "committed changes only" mode.
- VS Code desktop only: no web, no virtual workspaces, and the extension does
  not activate in untrusted workspaces.
- One extra entry appears in the Source Control view (with no resource groups),
  because the stable API for contributing a quick diff provider goes through
  `scm.createSourceControl`. It can be hidden from the gutter's quick diff
  provider menu.

## The repository is never written to

The extension only ever runs `rev-parse`, `merge-base`, `symbolic-ref`,
`for-each-ref`, `cat-file`, `diff --name-status` and `ls-files`, always through
`execFile` with an argument array — never a shell. A whitelist in
`src/git/args.ts` enforces this and is unit-tested.

`GIT_OPTIONAL_LOCKS=0` turns out **not** to be enough: on git 2.50.1 it
suppresses the index write for `git status` but not for `git diff`, which
still refreshes and rewrites `.git/index`. So the change-set commands run
against a throwaway snapshot of the index in the OS temp directory
(`src/git/shadowIndex.ts`); git rewrites the copy and the repository's own
index is left byte-for-byte alone. Verify it at any time:

```sh
npm run compile
node scripts/check-index-untouched.js [repo-path]
```

## Development

```sh
npm install
npm run compile          # or: npm run watch
npm test                 # node:test over the pure modules
./scripts/make-fixture-repo.sh --dirty
```

Then press F5 with the **Run Extension (fixture repo)** launch configuration.

```sh
npm run package          # builds the .vsix (needs @vscode/vsce)
npm run install-local    # installs it into VS Code
```

## Manual QA checklist

Run against the fixture repository before each VSIX build.

1. Open the repo on `feature`. The status bar shows `Review: off`. Toggle on →
   `Review: main`, tooltip shows the merge-base SHA.
2. `src/modified.ts`: the edited, inserted and appended lines are marked.
   `src/added.ts`: the whole file is marked added. `src/renamed-new.ts`: only
   the one real edit is marked, not the whole file. `src/has-deletion.ts`: a
   deletion marker sits beside the surviving line, and clicking it peeks the
   removed text.
3. `src/unchanged.ts` is **not** marked — the later commit on `main` must not
   appear when reviewing `feature`.
4. The Explorer shows `M`, `A`, `R` and `U` badges with propagated folder
   colours. The changed-files picker lists them and opens the base version for
   deleted files.
5. Select base `release/1.0` → markers change. Select `HEAD~1` with "compare
   exactly" → markers reflect only the last commit.
6. `git checkout main` in a terminal → the status bar shows `(on base)` within
   a second or two. `git checkout feature` restores.
7. Make an unsaved edit → a marker appears immediately. Undo → it disappears.
8. Toggle off → all markers and badges vanish, language features unaffected.
9. Reload the window → the enabled state and base selection are restored.
10. Disable the built-in Git extension → the extension still works through
    fallback discovery.
11. `node scripts/check-index-untouched.js` exits 0, and `git status` in the
    fixture is still clean.
12. `bin/blob.bin` gets no markers; `docs/crlf.txt` shows no spurious
    whole-file modification.
