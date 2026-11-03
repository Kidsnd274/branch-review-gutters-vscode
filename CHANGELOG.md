# Changelog

## 0.2.0

- **Deleted lines in the normal editor.** Wherever the branch deleted or
  replaced lines, a faint red label such as `− 3 lines deleted` sits at the end
  of the line. Hover the label to read the removed lines as a diff, with a link
  to open the file as an inline diff. `reviewGutters.deletedLineHints` turns
  the labels off.
- **Inline diff mode.** A new title-bar toggle in the Changed Files view, also
  the `reviewGutters.openMode` setting, makes clicking a modified or renamed
  file open it as a diff against the base, with deleted lines as red rows.
  Added files still open normally. The first diff of a session offers to switch
  VS Code's diff editors to inline view, since that is a single user setting
  shared by every diff editor; nothing changes unless you accept.
- **Deleted files painted red.** A deleted file opens as its base version, red
  from top to bottom, with a `Deleted on this branch` banner and a
  *Mark as Seen* / *Mark as Unseen* action above line 1.
- New command *Open Current File as Inline Diff*, also a diff button in the
  editor title bar of any modified or renamed file and *Open as Inline Diff* on
  a Changed Files row's right-click menu, so a diff is one click away without
  hovering a deleted-line label.
- **Fixed:** opening a deleted file or a base version could fail with
  "Could NOT open editor" after the extension host restarted, which is what
  installing a new build does. VS Code kept a stale copy of the document; the
  open now retries under a fresh uri.

## 0.1.4

- **Fixed:** auto-detection took the first configured name that existed, so a
  local `master` that had not been pulled won over a fresh `origin/master`,
  and `master` won over `develop` for a branch cut from `develop` — either
  way showing other people's merged commits as yours. Candidates are now
  measured by `merge-base` and the one `HEAD` forked from most recently wins;
  a candidate that already contains `HEAD` ranks last.
- *Auto-detect Base Branch* now shows that ranking as a menu — commits ahead
  and fork point per candidate, the recommendation first — instead of applying
  silently.
- A commit sha typed by hand that is an ancestor of `HEAD` asks whether it is
  the commit the branch was cut from (excluded) or the branch's first commit
  (included, via `<sha>^`).
- The base picker no longer lists the current branch's upstream.
- `rev-list --count` joins the read-only git allow-list, for the ranking.
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
