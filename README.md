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
- **Changed Files view** — a **Branch Review** activity-bar panel that lays
  every file differing from the base out as a folder tree, switchable to a
  flat list. One node per repository, described by its base ref and change
  counts, coloured by the most serious change underneath it. Open a file,
  open its base version, compare with the base, or copy its path from here.
- **Seen / unseen per file** — mark a file in the Changed Files view as you
  read it and work down a long change set without losing your place, the same
  idea as GitHub's "Viewed" tick. A seen row greys out, folders carry their
  own tally, and the repository row reads `3/12 seen · main · 8 M, 2 A, 1 D`.
- **Changed-file navigation** — next/previous changed file and next/previous
  change within a file, and the view follows the active editor as you switch.
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
code --install-extension branch-review-gutters-0.1.1.vsix --force
```

## Usage

1. **Check out the branch you want to review.**
2. **Turn it on** — run *Review Gutters: Toggle Review Gutters* from the
   Command Palette, or click the status bar item at the bottom right. It goes
   from `Review: off` to `Review: main` (or whatever base it detected).
3. **Browse the code as usual.** Changed lines are marked in the gutter;
   changed files are badged in the Explorer. Click a gutter marker to peek the
   original text.
4. **Open the Branch Review view** — the activity-bar icon lists every changed
   file as a folder tree, one node per repository. The title bar toggles
   between the tree and a flat list; the node's context menu opens the file,
   its base version, or a diff, and copies its path.
5. **Jump around** with *Show Changed Files…*, *Next Changed File*, or
   *Next Change in File*.
6. **Change the base** with *Select Base Branch or Commit…* if auto-detection
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
| Show Changed Files… | Focuses the Changed Files view and reveals the file you are editing. The command id is unchanged, so existing keybindings keep working |
| Next / Previous Changed File | Walks the sorted change set, wrapping at the ends |
| Next / Previous Change in File | Delegates to VS Code's `editor.action.dirtydiff.next` / `.previous` |
| Open Base Version of Current File | Opens the file as it is at the base, read-only |
| Compare Current File with Base | Opens a normal diff editor, on request only |
| Show Log | Reveals the "Branch Review Gutters" output channel |

### Marking files as seen

Hover a file row in the Changed Files view and use the tick action on the
right; the row greys out and the tally in the folder and repository rows moves
with it. The cross action puts it back. Both are on the right-click menu too,
which is also how you mark a multi-selection in one go.

The row keeps its change-kind icon and letter badge, dimmed — a seen row still
says what happened to the file. Greying works through a
`FileDecorationProvider` keyed on a synthetic `review-seen:` uri that only this
extension answers for: a tree row cannot colour its own label, and dimming the
real file uri would grey the file out in the Explorer as well.

There is deliberately no checkbox. VS Code draws tree checkboxes on the far
left, away from the row's own actions, and `TreeItemCheckboxState` has no
tri-state — so a half-read folder would read as untouched and its first click
would mark everything inside it. Folders get the same pair of row actions as
files, with the aggregate spelled out in the menu: **Mark Folder as Seen**
appears on an untouched or half-seen folder, **Mark Folder as Unseen** on a
finished or half-seen one. A folder whose every file is seen greys out too.

Marks live in VS Code workspace storage, never in the working tree, and are
**scoped to the resolved base commit**:

- Resolving a **different base** clears that repository's marks — it is a
  different diff, so marks made against the old one mean nothing.
- If the merge base **advances** underneath you — someone merges `main` into
  your branch overnight — the marks reset too, even though your own edits are
  unchanged. Showing files again is the safe direction for a review tool.
- A file **reverted** out of the change set loses its mark with it.

Opening a file can mark it automatically via `reviewGutters.markSeenOnOpen`,
which is **off by default** — with it on, preview-clicking through the tree
marks everything it opens.

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
| `reviewGutters.viewMode` | `"tree"` | Changed Files view grouping: `"tree"` or `"list"`. The view's title-bar toggle overrides this for the workspace |
| `reviewGutters.autoReveal` | `true` | Reveal the current file in the Changed Files view when switching editors |
| `reviewGutters.markSeenOnOpen` | `false` | Mark a changed file as seen as soon as it is opened |
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
- **Deleted files** have no Explorer node; they appear in the Changed Files
  view and open read-only at the base version.
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
│   │   ├── parse.ts           # diff --name-status / ls-files parsing
│   │   └── style.ts           # kind → badge, colour, codicon, label (shared)
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
│   ├── review/
│   │   ├── seenState.ts       # Pure seen/unseen model and base-commit scoping
│   │   ├── seenStore.ts       # Per-repo seen marks in workspace storage
│   │   └── seenUri.ts         # Pure review-seen: uri, so a seen row can dim
│   ├── tree/
│   │   ├── changeTree.ts      # Pure tree/list builder over the change set
│   │   └── changedFilesView.ts# Tree data provider for the Changed Files view
│   ├── ui/
│   │   ├── pickers.ts         # Base picker and the status-bar menu
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
└── PLAN.md                    # Implementation plan, M0–M6
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

Seen marks add no git surface either. They are written to VS Code workspace
storage under `reviewGutters.seen.v1`, never to the working tree and never to
`.git`, so the whitelist and this check are unchanged by that feature.

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
   colours. The Changed Files view lists the same files and opens the base
   version for deleted ones.
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
13. The **Branch Review** activity-bar icon opens **Changed Files**: one node
    per enabled repository, described by its base ref and counts
    (`main · 4 M, 1 A, 1 U, 1 D, 1 R`), with folders coloured by the most
    serious change underneath them.
14. The title-bar toggle switches tree ⇄ list, and the choice survives a
    window reload. It overrides `reviewGutters.viewMode` for this workspace
    only; a fresh window with the toggle unused follows the setting.
15. Reveal follows the active editor: open `src/modified.ts` and the view
    selects it with its folders expanded. Open a file that is **not** in the
    change set and nothing is selected. Set `reviewGutters.autoReveal: false`
    and the view stops following.
16. A deleted file opens its base version from the tree. `Open Base Version`
    and `Compare with Base` are hidden on deleted, added and untracked nodes,
    where there is no base to open; `Copy Path` works on everything that
    still exists.
17. Add a second root that has never been on screen. Its node reads
    "not loaded yet" and `pgrep -fl "git (diff|ls-files)"` shows no git work
    started for it.
18. Expand a few folders, then hit refresh in the view title: the folders stay
    expanded. (This is what the stable `TreeItem.id` buys; without it every
    repaint collapses the tree.)
19. Toggle review off → the view empties and the welcome content offers
    **Enable Review Gutters**. With review on but no base resolvable it offers
    **Select Base Branch or Commit…**; with a base and no changes it offers
    **Refresh Comparison**.
20. Set `reviewGutters.excludeGlobs` to a glob matching a changed file → it
    disappears from the tree as well as from the Explorer.
21. Use a file row's tick action → the row greys out, its icon and letter
    badge dim with it, and the folder tally and the repository row
    (`2/7 seen · main · …`) both move. The cross action → the row un-greys
    and the counts go back down.
22. Mark a file seen, then hit refresh in the view title: the mark survives
    **and** the folders you had expanded are still expanded.
23. Mark several files seen, then **Select Base Branch or Commit…** to a
    different base → every mark in that repository is cleared. Switching back
    does not bring them back; they were made against a different diff.
24. Mark `src/modified.ts` seen, then restore it to its base content
    (`git checkout <merge-base> -- src/modified.ts`). It leaves the change
    set and its mark goes with it.
25. **Mark Folder as Seen** on a half-seen folder marks everything under it,
    the folder reads `n/n seen` and greys out, and its row action flips to
    **Mark Folder as Unseen**. An untouched folder offers *Mark Folder as
    Seen* only; a finished one offers *Mark Folder as Unseen* only. Do it on
    a folder holding **more than 24 files** and every row under it must grey
    out at once — that count is the threshold where the view switches from
    per-row repaints to one whole-view repaint.
26. Mark a file seen and check its context menu still has **Open Base
    Version**, **Compare with Base** and **Copy Path** — the `~seen` suffix
    must not have hidden them.
27. With `reviewGutters.markSeenOnOpen` **off**, opening files changes
    nothing. With it **on**, opening a file marks it, but opening a *base
    version* of a file (`Open Base Version`) does **not** mark the
    working-tree copy.
28. A second root that has never been on screen still reads "not loaded yet"
    and spawns no git process. Reload the window → marks in the repositories
    you did touch are all still there.
29. Right-click a changed file and use **Open Base Version**, **Compare with
    Base** and **Copy Path** — all three must actually act, not report that
    the file is missing. A context-menu command receives the tree element,
    not the left-click payload, and these three regressed on exactly that.
30. Right-click a **folder** row and use **Mark Folder as Seen** — it marks
    every file under that row, not whatever happens to be selected.
31. Mark a file seen while the Changed Files view is **hidden** (collapse the
    activity bar, or use `markSeenOnOpen`), then show the view again: the row
    is already grey. No stale un-greyed row may survive the repaint.
32. With `reviewGutters.excludeGlobs` hiding some changed files, the
    repository row's `n/m seen` and its `8 M, 2 A` summary must count the
    same files — the excluded ones in neither.
33. Select several file rows (ctrl/cmd-click), right-click one of them and
    **Mark as Seen** → all of them are marked. Then, with that selection
    still live, hover a *different* row and click its tick action → only the
    hovered row is marked. An inline action does not move the selection, so
    it must not act on it.

## License

Private and unpublished — see `license` in [`package.json`](package.json).
