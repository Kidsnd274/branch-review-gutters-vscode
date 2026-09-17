<div align="center">

<img src="assets/icon/icon.png" alt="Branch Review Gutters icon" width="128" height="128" />

# Branch Review Gutters

**Review a feature branch by browsing your repo — not by opening diff editors.**

A VS Code extension that marks every line changed since your branch diverged
from `main`, right in the normal editor gutter. Go to Definition, Find
References, call hierarchy and diagnostics all keep working while you read.

[![Platform: VS Code](https://img.shields.io/badge/VS%20Code-1.138%2B-007ACC?logo=visualstudiocode&logoColor=white)](#requirements)
[![Built with TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Read-only](https://img.shields.io/badge/git-read--only-2E7D32)](#the-repository-is-never-written-to)
[![No telemetry](https://img.shields.io/badge/telemetry-none-lightgrey)](#faq)

</div>

---

> [!NOTE]
> This is a private, unpublished extension. It is installed from a local
> `.vsix`, makes no network calls, and collects no telemetry.

## Why Branch Review Gutters?

Reviewing a branch in a diff editor means reading code in a stripped-down
view: no Go to Definition, no Find References, no hover types, no diagnostics.
You end up flipping between the diff and the real file just to understand what
a changed line does.

The obvious fix is to browse the repository normally and have the editor tell
you what changed — but VS Code's built-in Git gutter can't do that. It ships
two quick diff providers, *working tree* (HEAD vs disk) and *index* (HEAD vs
staged). Neither uses a merge base, so on a clean checkout of a feature branch
**both are empty**. The built-in gutter shows your uncommitted edits, not your
branch.

**This extension adds a third provider** whose "original" is the file at
`git merge-base <base> HEAD`. Open any file in the repo and the gutter shows
what your branch did to it, with every language feature intact.

## Features

- **Gutter markers** for added, modified and deleted lines, comparing the live
  editor buffer against the file at the merge base. Click a marker to peek the
  original, exactly like the built-in Git gutter.
- **Explorer badges** — `A`, `U`, `M`, `R` — on every file that differs from
  the base, with the colour propagated up to parent folders.
- **Status bar item** showing on/off state and the active base; click it for a
  menu of every command.
- **Automatic base detection** — `main`, `master`, `origin/<name>`, then the
  remote's default branch — or pick any branch, tag, ref or SHA yourself.
- **Merge-base or exact comparison**, so you can review "everything my branch
  did" or "just this one commit".
- **Changed-file navigation** — a quick pick of everything that differs from
  the base (deletions included), plus next/previous changed file and
  next/previous change within a file.
- **Live** — unsaved edits show up immediately, and checking out another
  branch in a terminal updates the gutter within a second or two.
- **Read-only by construction** — a whitelist of git subcommands, `execFile`
  only (never a shell), and a shadow index so `.git/index` is never rewritten.
- **Per-repository state**, remembered per workspace.

## Requirements

- **VS Code 1.138 or newer**, desktop only — no web, no virtual workspaces,
  and it does not activate in untrusted workspaces.
- **git** on your `PATH`.

The built-in Git extension is used when present, but is not required; the
extension falls back to discovering repositories itself.

## Installation

Build the `.vsix` and install it:

```sh
npm install
npm run build          # needs @vscode/vsce and librsvg
npm run install-local
```

Or install the packaged file directly:

```sh
code --install-extension branch-review-gutters-0.1.0.vsix --force
```

## Usage

1. **Check out the branch you want to review.**
2. **Turn it on** — run *Review Gutters: Toggle Review Gutters* from the
   Command Palette, or click the status bar item at the bottom right. It goes
   from `Review: off` to `Review: main` (or whatever base it detected).
3. **Browse the code as usual.** Changed lines are marked in the gutter;
   changed files are badged in the Explorer. Click a gutter marker to peek the
   original text.
4. **Jump around** with *Show Changed Files…*, *Next Changed File*, or
   *Next Change in File*.
5. **Change the base** with *Select Base Branch or Commit…* if auto-detection
   picked the wrong one — pick a branch, tag or SHA, then choose merge-base or
   exact mode.

Nothing is bound to a keyboard shortcut by default; bind whatever you reach
for most in **Keyboard Shortcuts**.

### Commands

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

### Base detection

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

### Settings

| Key | Default | Purpose |
|---|---|---|
| `reviewGutters.baseBranches` | `["main", "master"]` | Auto-detection candidates, in order |
| `reviewGutters.remote` | `"origin"` | Remote for `<remote>/<branch>` fallbacks |
| `reviewGutters.explorerBadges` | `true` | Explorer badges and colours |
| `reviewGutters.maxFileSizeKB` | `1024` | Skip base versions larger than this |
| `reviewGutters.excludeGlobs` | `[]` | Repo-relative globs never decorated, e.g. `["*.lock", "generated/**"]` |
| `reviewGutters.logLevel` | `"info"` | Output channel verbosity |

## How it compares

| | Branch Review Gutters | Built-in Git gutter | Diff editor / PR view |
|---|:---:|:---:|:---:|
| Marks changes vs. the merge base | Yes | No | Yes |
| Shows anything on a clean checkout | Yes | No | Yes |
| Go to Definition, Find References | Yes | Yes | Limited |
| Diagnostics and hover types | Yes | Yes | Limited |
| Browse unchanged files in context | Yes | Yes | No |
| Changed-file list and navigation | Yes | No | Yes |

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
- One extra entry appears in the Source Control view (with no resource
  groups), because the stable API for contributing a quick diff provider goes
  through `scm.createSourceControl`. It can be hidden from the gutter's quick
  diff provider menu.

## FAQ

**Will this conflict with the built-in Git gutter?**
No. VS Code renders every registered quick diff provider, so on a clean
checkout only the branch markers appear; with unsaved edits both render, and
the peek view's provider switcher labels each one. A provider contributed this
way is drawn in the *primary* gutter colours, so branch markers are exactly as
visible as git's own.

**Can it modify my repository?**
No — see [below](#the-repository-is-never-written-to). It runs a whitelist of
read-only git subcommands and diffs against a throwaway copy of the index, so
even `.git/index` is left byte-for-byte alone. There's a script to verify it.

**Does it send anything over the network?**
No. Everything is local git invocations. No telemetry, no update checks.

**Why is there an empty entry in my Source Control view?**
That's the quick diff provider registration. `scm.createSourceControl` is the
only stable API for contributing one, and it creates a source control entry as
a side effect. It has no resource groups and does nothing.

**It says `(on base)` — what does that mean?**
You're checked out on the base branch itself, so there's nothing to compare.
Check out your feature branch, or pick a different base.

---

# For developers

Everything below is for people hacking on the extension itself.

## Table of contents

- [Repository architecture](#repository-architecture)
- [The repository is never written to](#the-repository-is-never-written-to)
- [Building from source](#building-from-source)
- [Manual QA checklist](#manual-qa-checklist)

## Repository architecture

A plain TypeScript VS Code extension — no bundler, `tsc` straight to `out/`.

```text
code-review-git-diff-gutters/
├── src/
│   ├── extension.ts           # Activation; wires up the controller
│   ├── controller.ts          # Per-repository state machine and event plumbing
│   ├── commands.ts            # Command registrations
│   ├── config.ts              # Typed access to reviewGutters.* settings
│   ├── baseline/
│   │   ├── candidates.ts      # Auto-detection candidate list
│   │   ├── resolver.ts        # Resolves a candidate to a baseline commit
│   │   ├── selection.ts       # Manual selection model (ref + merge-base/exact)
│   │   └── state.ts           # Per-repo persistence in workspace state
│   ├── changes/
│   │   ├── changeSet.ts       # The set of files differing from the base
│   │   └── parse.ts           # diff --name-status / ls-files parsing
│   ├── content/
│   │   ├── baseContentProvider.ts  # TextDocumentContentProvider for base blobs
│   │   ├── text.ts            # EOL and BOM normalisation
│   │   └── uri.ts             # The review-gutters: URI scheme
│   ├── explorer/
│   │   └── fileDecorations.ts # A/U/M/R badges and folder colour propagation
│   ├── git/
│   │   ├── args.ts            # Subcommand whitelist (unit-tested)
│   │   ├── exec.ts            # execFile wrapper, never a shell
│   │   ├── refs.ts            # rev-parse / merge-base / for-each-ref helpers
│   │   ├── repositories.ts    # Git extension API, with standalone fallback
│   │   └── shadowIndex.ts     # Throwaway index snapshot (see below)
│   ├── rendering/
│   │   └── quickDiff.ts       # The QuickDiffProvider itself
│   ├── ui/
│   │   ├── pickers.ts         # Base and changed-file quick picks
│   │   ├── statusBar.ts       # Status bar item
│   │   └── statusText.ts      # Label and tooltip formatting (unit-tested)
│   └── util/                  # debounce, log, navigation, paths
├── test/                      # node:test over the pure modules
├── assets/icon/               # icon.svg is the source; icon.png is generated
├── scripts/
│   ├── build-icon.sh          # SVG → PNG (npm run icon)
│   ├── build-vsix.sh          # Full release build (npm run build)
│   ├── make-fixture-repo.sh   # Builds a repo with every change shape
│   └── check-index-untouched.js
├── docs/
│   └── spike-rendering.md     # Why Quick Diff, with evidence
└── PLAN.md                    # Implementation plan, M0–M4
```

The rendering approach is not obvious and was decided by a spike — read
[`docs/spike-rendering.md`](docs/spike-rendering.md) before changing anything
in `src/rendering/`.

## The repository is never written to

The extension only ever runs `rev-parse`, `merge-base`, `symbolic-ref`,
`for-each-ref`, `cat-file`, `diff --name-status` and `ls-files`, always through
`execFile` with an argument array — never a shell. The whitelist in
[`src/git/args.ts`](src/git/args.ts) enforces this and is unit-tested.

`GIT_OPTIONAL_LOCKS=0` turns out **not** to be enough: on git 2.50.1 it
suppresses the index write for `git status` but not for `git diff`, which
still refreshes and rewrites `.git/index`. So the change-set commands run
against a throwaway snapshot of the index in the OS temp directory
([`src/git/shadowIndex.ts`](src/git/shadowIndex.ts)); git rewrites the copy and
the repository's own index is left byte-for-byte alone. Verify it at any time:

```sh
npm run compile
node scripts/check-index-untouched.js [repo-path]
```

## Building from source

```sh
npm install
npm run compile          # or: npm run watch
npm test                 # node:test over the pure modules
./scripts/make-fixture-repo.sh --dirty
```

Then press <kbd>F5</kbd> with the **Run Extension (fixture repo)** launch
configuration.

```sh
npm run build            # icon + compile + tests + .vsix, via scripts/build-vsix.sh
npm run install-local    # installs the .vsix into VS Code
```

`npm run icon` alone re-renders `assets/icon/icon.png` from the SVG (needs
`brew install librsvg`); `npm run package` alone builds the `.vsix` without
re-running the icon or tests.

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

## License

Private and unpublished — see `license` in [`package.json`](package.json).
