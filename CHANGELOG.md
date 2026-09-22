# Changelog

## 0.1.3

- Changed Files rows have a **seen / unseen** checkbox, so a long change set
  can be worked down without losing your place. Folders and the repository
  row carry the tally — `3/12 seen · main · 8 M, 2 A, 1 D`.
- Folder bulk is in the context menu — **Mark Folder as Seen** and
  **Mark Folder as Unseen** — where the aggregate can be named exactly,
  rather than on a checkbox that has no tri-state.
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
