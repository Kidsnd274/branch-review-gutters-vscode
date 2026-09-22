# Changelog

## Unreleased

- Seen rows now **grey out** — label, change-kind icon and letter badge — so a
  reviewed file reads as done at a glance instead of only by its tick.
- The seen/unseen control moved off the left-hand checkbox onto the row's own
  tick / cross actions on the right, next to the rest of the row's commands.
  Folders get the same pair. VS Code cannot right-align a tree checkbox, so
  the checkbox is gone rather than relocated.
- **Fixed:** a seen mark could leave the view showing the row's old state.
  Rendered rows are cached against the inputs the tree is built from, and the
  seen state is not one of them, so any whole-view repaint reused stale rows —
  which is what happened after marking a folder of more than 24 files, and
  after any mark made while the view was hidden.
- **Fixed:** the repository row mixed two denominators, counting `excludeGlobs`
  files in its `8 M, 2 A, 1 D` summary but not in its `3/12 seen` tally.

## 0.1.3

- Changed Files rows can be marked **seen / unseen**, so a long change set
  can be worked down without losing your place. Folders and the repository
  row carry the tally — `3/12 seen · main · 8 M, 2 A, 1 D`.
- Folder bulk is **Mark Folder as Seen** and **Mark Folder as Unseen**, where
  the aggregate can be named exactly, rather than a checkbox with no
  tri-state.
- Marks are scoped to the base commit they were made against: resolving a
  different base clears that repository's marks, and a file reverted out of
  the change set loses its mark along with it.
- `reviewGutters.markSeenOnOpen` marks a changed file as soon as it is
  opened. Off by default, because previewing through the view would mark
  everything it opens.
- Seen state lives in VS Code workspace storage and adds no git subcommands,
  so the read-only guarantee is unchanged.
- **Fixed:** *Open Base Version*, *Compare with Base* and *Copy Path* from
  the Changed Files tree reported "that file is no longer in the change
  set" instead of acting. A context-menu command is handed the tree element
  itself; only left-click receives the payload baked into
  `TreeItem.command.arguments`. Every tree command now resolves either shape,
  so the commands work from the menu and from a click alike.

## 0.1.2

- Added a **Branch Review** activity bar view listing every file that differs
  from the base as a collapsible folder tree, with a flat-list alternative
  behind a title-bar toggle.
- Deleted files can be opened at their base version, and compared with the
  base, straight from the tree.
- Repositories that are not on screen show "not loaded yet" and spawn no git,
  so multi-root startup cost is unchanged.
- `Show Changed Files…` now focuses the new view instead of opening a quick
  pick. The command id is unchanged, so existing keybindings keep working.

## 0.1.1

- Hardened repository discovery against edge cases and serialised per-repo
  refreshes to avoid racing state updates.

## 0.1.0

First version.

- Gutter markers for lines that differ from `merge-base(<base>, HEAD)`,
  rendered through VS Code's Quick Diff so peek and dirty-diff navigation work
  natively.
- Base auto-detection (`main`, `master`, `<remote>/<name>`, the remote's
  default branch) and manual selection of any branch, tag, ref or commit, in
  merge-base or exact mode.
- Explorer badges and folder colours for changed files, plus a changed-files
  picker that can open the base version of deleted files.
- Status bar item showing on/off state and the active baseline, with a menu of
  every command.
- Per-repository enabled state and base selection persisted per workspace.
- Rename-aware base lookup; binary and oversized files skipped; base content
  normalised to the document's EOL and BOM.
- Read-only by construction: whitelisted git subcommands, `execFile` only, and
  change-set diffs run against a snapshot of the index so `.git/index` is never
  rewritten.
