# Changelog

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
