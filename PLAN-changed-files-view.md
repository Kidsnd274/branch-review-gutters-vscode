# Plan — Changed Files tree view (v0.1.2)

A new Activity Bar container (**Branch Review**) hosting a single `Changed Files`
view that renders the review change set as a collapsible folder tree, with a
title-bar toggle switching the same view to a flat list.

Everything reuses the existing `ChangeSet` produced by
[`src/changes/changeSet.ts`](src/changes/changeSet.ts). **No new git
subcommands**, so the "the repository is never written to" guarantee and the
whitelist in [`src/git/args.ts`](src/git/args.ts) stay untouched.

## Decisions

| Question | Decision |
| --- | --- |
| Panel home | Own `viewsContainers.activitybar` container with the extension icon |
| Tree shape | Folder tree of changed files only, switchable to a flat list |
| Multi-repo | **Assumption:** each repository is a top-level collapsible node showing its own base ref and counts (easy to flip to active-repo-only) |
| Old Quick Pick | `reviewGutters.showChangedFiles` focuses the new view |

## 1. Version bump to 0.1.2

- `package.json`: `"version": "0.1.1"` → `"0.1.2"`.
- `package.json` `install-local` script: `branch-review-gutters-0.1.1.vsix` →
  `branch-review-gutters-0.1.2.vsix` (it hardcodes the filename).
- `CHANGELOG.md`: new `## 0.1.2` section above `## 0.1.1`, matching the existing
  terse bullet style, describing the new view and the repointed command.
- `.vscodeignore`: add `PLAN-changed-files-view.md` next to the existing
  `PLAN.md` entry so this file is not packaged into the VSIX.

## 2. Manifest (`package.json`)

- `contributes.viewsContainers.activitybar`: id `reviewGutters`, title
  `Branch Review`, icon `assets/icon/icon.svg` (already present).
- `contributes.views`: `reviewGutters.changedFiles` → `Changed Files`, with
  `hideWhenEmpty: false` so the empty states are actually visible.
- New commands:
  - `reviewGutters.setTreeMode` — codicon `list-tree`, shown only in list mode.
  - `reviewGutters.setListMode` — codicon `list-flat`, shown only in tree mode.
    Two commands rather than one toggle so each can carry its own icon; a single
    command cannot change its icon per state.
  - `reviewGutters.openFromTree` — internal, opens a node.
- `contributes.menus["view/title"]`: the mode toggle plus `reviewGutters.refresh`,
  gated on `when: view == reviewGutters.changedFiles`.
- `contributes.menus["view/item/context"]`: open base version, compare with base,
  copy path — hidden for `deleted` nodes where they are meaningless.
- `contributes.viewsWelcome`: the four empty states (no repository / disabled /
  no base / no changes), each with a button calling an existing command.
- New settings, added to both `contributes.configuration` and
  [`src/config.ts`](src/config.ts) `Config` + `readConfig()`:
  - `reviewGutters.autoReveal` — boolean, default `true`.
  - `reviewGutters.viewMode` — `"tree" | "list"`, default `"tree"`.

## 3. Pure tree builder — `src/tree/changeTree.ts`

No `vscode` import, matching the convention in
[`parse.ts`](src/changes/parse.ts), [`paths.ts`](src/util/paths.ts) and
[`navigation.ts`](src/util/navigation.ts), so it is covered by `node:test`.

```ts
type TreeNode =
  | { type: 'dir'; path: string; name: string; hint: ChangeKind; children: TreeNode[] }
  | { type: 'file'; path: string; change: FileChange };

buildChangeTree(
  changes: readonly FileChange[],
  opts: { mode: 'tree' | 'list'; isExcluded(rel: string): boolean },
): TreeNode[]
```

- **Tree mode:** only directories that lead to a changed file. Intermediate
  single-child directories stay as their own nodes (Explorer-like, no path
  compaction).
- **Folder `hint`** = the highest-priority change kind beneath it, with a
  deterministic priority of `deleted > renamed > modified/typeChanged > added >
  untracked`. This drives folder colour, mirroring `propagate: true` in
  [`fileDecorations.ts`](src/explorer/fileDecorations.ts).
- **List mode:** flat `file` nodes sorted by path.
- Applies `isExcluded` and `.git` filtering at build time. Today that filtering
  happens only inside `provideFileDecoration`, so the tree must apply it
  explicitly or excluded files would appear.
- Renames appear at the **new** path; `basePath` stays tooltip-only, consistent
  with the existing Explorer badges.

## 4. Tree data provider — `src/tree/changedFilesView.ts`

`vscode.TreeDataProvider<TreeNode>`, shaped like
`ReviewFileDecorationProvider` (own `onDidChangeTreeData` emitter plus a
`refresh()` method).

- **Stable `TreeItem.id`** = `repoRoot + mode + nodePath`. Without stable ids
  every refresh collapses the whole tree — the main UX trap in this feature.
- `TreeItem` instances cached by id so labels and collapse state do not churn.
- Kind styling comes from a shared map extracted from `fileDecorations.ts` into
  `src/changes/style.ts` (pure: kind → badge, theme colour id, codicon, label),
  consumed by the decorations **and** the tree instead of duplicating `STYLES`
  and `ICONS`.
- Deleted files: `command` opens the base blob through the existing
  `openChange()` path and `makeBaseUri`, never the missing working-tree file.
- A repository node shows `baseRef` and `describeCounts(counts)` as its
  description.
- **Respects the lazy-touch model** from `touchVisibleRepositories()` in
  [`controller.ts`](src/controller.ts): a repository that has not been `touched`
  shows "not loaded yet" and must **not** trigger a refresh, otherwise the view
  breaks the deliberate "no git fan-out on startup" design for multi-root
  workspaces.
- Skips building entirely when `treeView.visible === false`.

## 5. Controller wiring (`src/controller.ts`)

- Add an `onDidChangeChangeSets` event, fired at each existing
  `this.decorations.refresh()` site (`doRefresh`, `refreshChangeSetOnly`,
  `onRepositoriesChanged`, `setEnabled`), so the tree hooks one point instead
  of being sprinkled through the refresh paths.
- Tree refresh debounced ~120 ms so a multi-repo refresh causes one repaint, not
  N.
- Set context keys alongside the existing `reviewGutters.enabled` in
  `onActiveEditorChanged()`: `reviewGutters.hasRepository`,
  `reviewGutters.hasChanges`, `reviewGutters.viewMode`. These drive the welcome
  content and the toggle icon.
- **`autoReveal`:** on `onDidChangeActiveTextEditor`, call
  `treeView.reveal(uri, { expand: true, select: true })` only when the view is
  visible and the file is in the change set — never on refresh, so it cannot
  fight the user's collapse state.
- `viewMode` is read from config and persisted through
  [`StateStore`](src/baseline/state.ts) semantics on toggle (workspace-scoped).

## 6. Repoint the old picker

`reviewGutters.showChangedFiles` becomes
`vscode.commands.executeCommand('reviewGutters.changedFiles.focus')` plus a
`reveal` of the active file.

- The command id is preserved so existing user keybindings keep working.
- The `Show changed files…` entry in `showMenu`
  ([`ui/pickers.ts`](src/ui/pickers.ts)) keeps working unchanged.
- The old Quick Pick body (`showChangedFiles`, `buildChangedFileItems`, `ICONS`)
  becomes dead code and is removed, with `ICONS` superseded by
  `src/changes/style.ts`.

## 7. Verification

- `npm run compile && npm test` — new `test/changeTree.test.ts` covering: tree
  shape, single-child directories, hint priority, list-mode ordering, exclusion
  filtering, renames, deletions, deep paths, empty input.
- `node scripts/check-index-untouched.js` still exits `0` (no new git surface).
- `npm run build`, then <kbd>F5</kbd> **Run Extension (fixture repo)** with the
  README QA checklist extended to:
  1. Tree/list toggle works and persists across a window reload.
  2. Reveal follows the active editor.
  3. A deleted file opens its base version.
  4. A second root that was never touched shows "not loaded yet" and spawns no
     git process.
  5. Toggling review off empties the view.
  6. Excluded globs never appear in the tree.

## 8. Docs

- `README.md`: Features, Commands, Settings, the architecture tree diagram, and
  the new manual QA steps.
- `PLAN.md`: add an M5 section recording the tree/list decision and the stable-id
  requirement.

## Main risks

1. **Expansion reset on refresh** — mitigated by stable `TreeItem.id` and a
   single debounced repaint.
2. **Startup git fan-out** — mitigated by never refreshing untouched repos from
   the view.
3. **Large change sets** — the build is O(n) and cached by change-set reference;
   VS Code virtualises rendering.
4. **`reveal` noise** — gated on view visibility and on editor-change only.
