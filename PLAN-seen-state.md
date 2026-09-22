# Plan — Marking changed files as seen (v0.1.3)

Per-file **seen / unseen** state in the **Changed Files** view, so a reviewer can
work down a long change set without losing their place — the same idea as GitHub's
"Viewed" checkbox on a pull request.

Everything renders from the `ChangeSet` the controller already owns. **No new git
subcommands**, so the whitelist in [`src/git/args.ts`](src/git/args.ts) and the
"the repository is never written to" guarantee (README §*The repository is never
written to*) stay exactly as they are. State lives in VS Code workspace storage,
never in the working tree.

## Decisions

Confirmed before implementation.

| Question | Decision |
| --- | --- |
| Affordance | Native `TreeItem.checkboxState` on file rows **plus** context-menu commands for folders and bulk |
| Staleness | Seen entries are **scoped to the resolved base commit** — moving the base resets the marks |
| Auto-mark | `reviewGutters.markSeenOnOpen` exists but **defaults to `false`** |
| Terminology | **`seen`** everywhere — command ids, types, settings, UI labels. "Review" already means the gutter feature itself, so "reviewed" would collide |
| Home | The existing `Changed Files` view only. Explorer decorations are untouched |

## 0. Version bump to 0.1.3 — done

Already applied and verified in the working tree:

- `package.json`: `"version": "0.1.2"` → `"0.1.3"`.
- `package.json` `install-local`: `branch-review-gutters-0.1.2.vsix` →
  `branch-review-gutters-0.1.3.vsix`. The filename is hardcoded, so it moves with
  the version or the local install points at a file the build no longer produces.
- `package-lock.json` synced to `0.1.3` via `npm install --package-lock-only`.
  It had been left at `0.1.1` by the previous bump, so the diff spans two versions
  — a catch-up, not churn.

Still outstanding:

- `CHANGELOG.md`: new `## 0.1.3` section above `## 0.1.2`, terse bullet style.
  Deliberately deferred until this feature has something true to describe.
- `.vscodeignore`: add `PLAN-seen-state.md` next to the existing `PLAN.md` and
  `PLAN-changed-files-view.md` entries so this file is not packaged into the VSIX.

## 1. The staleness problem, and what "seen" means

The change set comes from `nameStatusArgs` — `git diff -z --name-status
--find-renames <base>` ([`src/git/args.ts`](src/git/args.ts)) — which yields
**path and kind only, no blob hash**. So the extension cannot tell "you edited a
file you had already marked seen" apart from "nothing happened". This is the one
real design decision in the feature; the options considered:

| Policy | Behaviour | Cost |
| --- | --- | --- |
| **A. Scope to base commit** ✅ | An entry counts only while `entry.baseCommit === current resolved base` | Trivial |
| B. Path only | Seen survives everything until manually cleared | Trivial, but a review tool that hides newly-changed files is a correctness hazard |
| C. Diff identity (`git diff --raw`) | Same single git call, but `--raw` emits old/new blob SHAs → auto-unsee on re-modification | Widens `assertAllowed`, reworks `parseNameStatusZ` and its tests; untracked files get no hash |
| D. Working-tree mtime vs `seenAt` | `fs.stat` per changed file; newer mtime → unseen again | Async stat pass; false resets on checkout |

**Chosen: A.** A seen mark is meaningless if the comparison it was made against
has moved, so scoping to the base commit is both the honest reading and the safe
one. C is the right long-term answer and is kept as a separable later phase (§9).

Consequences worth stating plainly:

- Resolving a **different base** clears that repository's marks. Correct: it is a
  different diff.
- If the merge base **advances** underneath you — someone merges `main` into your
  branch overnight — the marks reset even though your own edits are unchanged.
  This is the expected complaint. It errs toward showing files again, which is
  the safe direction for a review tool.
- A file **reverted** out of the change set has its entry pruned (§4).

## 2. Pure model — `src/review/seenState.ts`

No `vscode` import, matching the convention in
[`parse.ts`](src/changes/parse.ts), [`paths.ts`](src/util/paths.ts),
[`navigation.ts`](src/util/navigation.ts) and
[`changeTree.ts`](src/tree/changeTree.ts), so `node:test` covers it without an
extension host.

```ts
export interface SeenEntry {
  /** Unix ms when the reviewer marked it. */
  seenAt: number;
  /** The resolved base commit the mark was made against. */
  baseCommit: string;
}

/** Keyed by repository-relative path, exactly as FileChange.path spells it. */
export type SeenMap = Record<string, SeenEntry>;

/** An entry only counts against the base it was set on. */
export function isSeen(seen: SeenMap, relPath: string, baseCommit: string): boolean;

export function seenProgress(
  seen: SeenMap, changes: readonly FileChange[], baseCommit: string,
): { seen: number; total: number };

/** Drop entries for paths that are no longer part of the comparison. */
export function pruneSeen(seen: SeenMap, livePaths: ReadonlySet<string>): SeenMap;

/** Folder aggregate: 'none' | 'partial' | 'all'. */
export function folderSeenState(
  seen: SeenMap, filesUnderDir: readonly string[], baseCommit: string,
): 'none' | 'partial' | 'all';
```

All four are pure and total — no throwing, no I/O.

## 3. Persistence — `src/review/seenStore.ts`

A thin wrapper over `workspaceState`, mirroring
[`StateStore`](src/baseline/state.ts) in shape and care:

```jsonc
// workspaceState["reviewGutters.seen.v1"]
{
  "/home/u/repos/app": {
    "src/a.ts": { "seenAt": 1758412800000, "baseCommit": "acf5f7e2596e…" },
    "docs/b.md": { "seenAt": 1758412804000, "baseCommit": "acf5f7e2596e…" }
  }
}
```

- `get(rootFsPath): SeenMap` / `setSeen(root, rel, baseCommit)` /
  `unsetSeen(root, rel)` / `markAll(root, rels, baseCommit)` / `clear(root)`.
- `sanitize()` on **read**, like `StateStore`: drop non-object values, non-string
  keys, `seenAt` that is not a finite number, `baseCommit` that is not 40 hex
  characters. Storage is untrusted input.
- Writes are per-repository sub-map, so a mark touches one key write, and one
  repository's state can never corrupt another's.
- No `ConfigurationTarget` writes anywhere — workspace-scoped only, per the
  `PLAN.md` §9 constraints checklist.

## 4. Lifecycle and garbage collection

Unbounded growth is the failure mode of any "mark everything" feature. Rules:

1. **Prune on load.** After each *successful* `loadChangeSet()` for a
   repository, drop that repository's entries whose path is not in the new change
   set. A reverted file's mark disappears with it.
2. **Never prune on an unloaded repository.** While a change set is `undefined`
   — a root that has not been `touched` under the lazy model in
   [`controller.ts`](src/controller.ts) — pruning would wipe real state on
   startup. Prune only when a change set was actually produced.
3. **Base-commit scoping self-heals.** Stale-base entries stop counting
   immediately at read time, even before they are pruned.
4. **Hard cap.** If a repository's map exceeds ~2000 entries, drop the oldest by
   `seenAt`. A change set that large is not being reviewed in one pass anyway.

Renames are naturally handled: the mark is keyed to the new path, and the old
path leaves the change set and is pruned.

## 5. Rendering — `src/tree/changedFilesView.ts`

### Checkbox

`TreeItem.checkboxState` exists in the pinned SDK — verified against
`@types/vscode@1.138.0`: the property at `index.d.ts:12392`,
`TreeItemCheckboxState { Unchecked = 0, Checked = 1 }` at `:12458`,
`TreeView.onDidChangeCheckboxState` at `:12184`, and
`TreeCheckboxChangeEvent<T>.items: ReadonlyArray<[T, TreeItemCheckboxState]>`
at `:12139`.

In `fileItem()`:

```ts
const seen = host.isSeen(repo, node.change.path);
item.checkboxState = seen
  ? { state: vscode.TreeItemCheckboxState.Checked, tooltip: 'Seen — click to unmark' }
  : { state: vscode.TreeItemCheckboxState.Unchecked, tooltip: 'Mark as seen' };
```

The row keeps its change-kind icon and letter badge — the reviewer still needs to
know *what* changed. The checkbox carries only the seen bit.

`TreeView` is created with **`manageCheckboxStateManually: true`**
(`index.d.ts:11917`). Without it VS Code auto-cascades a parent's checkbox into
its children, which would fight the store the moment folder checkboxes are added.

Folders get **no checkbox** in this phase. `TreeItemCheckboxState` has no
tri-state, so a partially-seen folder would read as unchecked and its first click
would mark everything — ambiguous. Folder bulk goes through the context menu
instead, where the aggregate is explicit in the label.

### Context menu encoding

`item.contextValue` is currently the bare change kind, and the menu `when`
clauses are anchored. Seen state is encoded as a suffix so each menu entry can be
shown only where it applies:

| Node | `contextValue` |
| --- | --- |
| file, unseen | `modified` |
| file, seen | `modified~seen` |
| folder, nothing seen beneath | `dir` |
| folder, some seen | `dir~partial` |
| folder, all seen | `dir~seen` |

Three existing `view/item/context` clauses **must** be updated or every menu entry
silently disappears the moment a file is marked:

```diff
- viewItem =~ /^(modified|typeChanged|renamed)$/
+ viewItem =~ /^(modified|typeChanged|renamed)(~seen)?$/

- viewItem =~ /^(added|untracked|modified|typeChanged|renamed)$/
+ viewItem =~ /^(added|untracked|modified|typeChanged|renamed)(~seen)?$/
```

New entries:

| Command | `when` |
| --- | --- |
| `markSeen` | `viewItem =~ /^(added\|untracked\|modified\|typeChanged\|renamed\|deleted)$/` |
| `markUnseen` | `viewItem =~ /~seen$/` |
| `markFolderSeen` | `viewItem =~ /^dir($\|~partial)$/` |
| `markFolderUnseen` | `viewItem =~ /^dir~(seen\|partial)$/` |

Note `deleted` is in `markSeen`'s set even though it has no other menu entry —
reviewing a deletion is a real thing, and the checkbox makes it reachable today.

### Repainting without losing the tree

`RepoTree` caches `TreeItem` instances by id and rebuilds only when mode /
exclusion signature / change-set identity / loading / has-base move. A seen
toggle changes none of those, so a naive toggle repaints nothing.

Add `invalidateSeen(repoRoot, relPaths)`:

1. Delete the cached `TreeItem` for each affected file node, **every ancestor
   folder** of each, and the repository node (its description carries the
   progress count).
2. Fire `onDidChangeTreeData` once per invalidated node. VS Code re-invokes
   `getTreeItem()` for each and repaints just those rows.
3. Bulk operations (`markAllSeen`, a folder toggle, the reset) fire
   `undefined` once — a whole-view repaint is cheaper than hundreds of small ones.

`nodeId()` stability (`repoRoot + mode + nodePath`) is what keeps expansion state
intact across the repaint. This is the same requirement that M5 called the main
trap in the tree feature; it pays off again here.

### Progress display

The repository node description grows a seen count in front of the existing
`describeCounts(...)`:

```
3/12 seen · main · 8 M, 2 A, 1 D
```

Folders get the same aggregate when it is not `none`, as a description suffix.

## 6. Controller wiring (`src/controller.ts`)

Extend `TreeHost` — the interface the view already consumes — rather than passing
the controller itself:

```ts
isSeen(repo: RepoInfo, relPath: string): boolean;
seenProgress(repo: RepoInfo): { seen: number; total: number };
setSeen(repo: RepoInfo, relPaths: readonly string[], seen: boolean): void;
```

- The controller owns the `SeenStore` and applies base-commit scoping at read
  time, so the view never reasons about staleness.
- `setSeen` writes the store, then calls `changedFilesView.invalidateSeen(...)`.
  Writes are skipped entirely when the state already matches, so a stray event
  cannot cause storage churn.
- `onDidChangeCheckboxState` maps `TreeNode` → `ChangeTarget` through the
  existing `owner` WeakMap and calls `setSeen`.
- Pruning hooks into the existing successful-load path in `loadChangeSet()`, per
  §4.
- Context keys set alongside the existing `reviewGutters.enabled` in
  `onActiveEditorChanged()`: `reviewGutters.seenCount`,
  `reviewGutters.unseenCount`, and `reviewGutters.allSeen` (for Phase 2's
  welcome state).

### Auto-mark on open (setting, default off)

`reviewGutters.markSeenOnOpen`, hooked into the existing
`onActiveEditorChanged()` rather than a new listener:

- Skip any active document whose scheme is not `file` — base-version editors use
  the custom scheme from `makeBaseUri`
  ([`src/content/uri.ts`](src/content/uri.ts)) and must not mark the working-tree
  file.
- Skip when the repository is disabled, has no base, or its change set is not
  loaded.
- Write only when the file is not already seen.
- Documented caveat: with the setting on, preview-clicking through the tree marks
  everything it opens. Gating on `tabGroups.activeTabGroup.activeTab?.isPinned`
  is the fix if that turns out to matter.

## 7. Manifest (`package.json`)

**Commands** (Phase 1): `markSeen`, `markUnseen`, `markFolderSeen`,
`markFolderUnseen`, each `category: "Branch Review"`, icons `$(check)` /
`$(close)`.

**Menus**: the four `view/item/context` entries from §5, plus the two updated
`when` clauses.

**Settings**, added to `contributes.configuration` **and** to
[`src/config.ts`](src/config.ts) `Config` + `readConfig()`:

| Setting | Type | Default |
| --- | --- | --- |
| `reviewGutters.markSeenOnOpen` | boolean | `false` |

Phase 2 adds `reviewGutters.hideSeenFiles` (boolean, `false`).

## 8. Phase 2 — filter, status bar, bulk

Separable from Phase 1; none of it changes the store.

- **Hide seen.** A title-bar toggle. Follows the existing `viewMode` pattern:
  the setting is the default, a workspace-state override wins, and it is **two**
  commands (`showUnseenOnly` / `showAllFiles`) because a single command cannot
  swap its own icon. `hideSeen` joins the `RepoTree` cache key so toggling
  rebuilds the structure.
- **Do not filter inside `visibleChanges()`.** It also feeds
  `hasVisibleChanges()` → the `reviewGutters.hasChanges` context key. Filtering
  seen files there would make a fully-seen repository read as *"Nothing changed
  against the base"*, which is false. Apply the seen filter only in
  `buildChangeTree`, and add a fifth `viewsWelcome` entry gated on
  `reviewGutters.hideSeen && reviewGutters.allSeen`: *"Nothing left to review —
  every changed file is marked seen. [Show All Files]"*.
- **Status bar**: thread a seen count through
  [`ui/statusBar.ts`](src/ui/statusBar.ts) and
  [`ui/statusText.ts`](src/ui/statusText.ts) next to the existing summary.
- **Bulk**: `markAllSeen` (`$(check-all)`) and `resetSeen` (`$(clear-all)`) in
  the view title.
- **Next/previous unseen**: reuse the existing changed-file navigation with the
  seen predicate applied, rather than a parallel implementation.

## 9. Phase 3 — auto-unsee on re-modification (optional, not in this change)

Switch the diff invocation to `git diff -z --raw --find-renames`, which carries
old and new blob SHAs in **the same single git call**. Then `SeenEntry` gains
`newBlobSha` and `isSeen` compares it, so a file un-marks itself the moment its
content changes again.

Deliberately kept out of this change because it is the only step that touches the
git argument policy: `--raw` must be added to `assertAllowed`, and
`parseNameStatusZ` plus its tests reworked. Untracked files come from
`ls-files --others` and have no hash, so they keep base-commit scoping
regardless. Revisit if "I marked it seen, then edited it, and it stayed hidden"
turns out to be a real pain point.

## 10. Verification

- `npm run compile && npm test`
  - New `test/seenState.test.ts`: base-commit scoping (matching base counts,
    different base does not), `seenProgress` over mixed kinds, `pruneSeen` keeps
    live paths and drops stale ones, `folderSeenState` across none/partial/all,
    empty and single-file inputs.
  - Extend `test/changeTree.test.ts` for the Phase 2 `hideSeen` path: a folder
    whose every child is seen disappears; a partially-seen folder keeps only
    unseen children.
- `node scripts/check-index-untouched.js` still exits `0` — no new git surface.
  Needs the fixture first: `bash scripts/make-fixture-repo.sh` (it is `.sh`, not
  `.js`).
- `npm run build`, then <kbd>F5</kbd> **Run Extension (fixture repo)**. Add to
  the README manual QA checklist:
  1. Clicking a checkbox marks the row seen; the count in the repository row
     updates.
  2. The mark survives a refresh **and** the tree stays expanded where it was.
  3. Switching the base clears every mark in that repository.
  4. Reverting a file out of the change set removes its mark.
  5. A second root that was never touched still shows "not loaded yet" and
     spawns no git process.
  6. Marking a file seen does not remove the existing *Open base version* /
     *Compare with base* / *Copy path* menu entries.
  7. With `markSeenOnOpen` off, opening files changes nothing; with it on, a
     base-version editor does **not** mark the working-tree file.
  8. Reload the window — marks persist.

## 11. Docs

- `README.md`: Features, Commands, Settings, the architecture tree diagram, and
  the new QA items.
- `CHANGELOG.md`: the `## 0.1.3` section deferred from §0.
- `PLAN.md`: an **M6 — Seen state** section in §12 Work order, recording the
  base-commit scoping decision, the `manageCheckboxStateManually` requirement,
  and the targeted-repaint rule.
- `.vscodeignore`: add `PLAN-seen-state.md`.

## 12. Main risks

1. **Marks reset when the merge base moves** — inherent to policy A. Mitigated by
   being explicit in the README and by the cheap `resetSeen` escape hatch; fully
   solved only by Phase 3.
2. **Repaint churn / collapse loss** — mitigated by stable `TreeItem.id` and
   targeted per-node invalidation instead of a whole-view repaint per toggle.
3. **Storage growth** — bounded by prune-on-load, the ~2000-entry cap, and
   base-commit scoping making stale entries inert even before deletion.
4. **Two windows on one workspace** — the per-repository sub-map write is
   last-write-wins. Accepted limitation; per-entry writes are the fix if it
   bites.
5. **Menu regressions from the `contextValue` change** — the three existing
   anchored `when` clauses must gain `(~seen)?` or every tree menu entry
   disappears. Highest-probability mistake in the whole change.
6. **Auto-mark over-marking** — why the setting defaults off.
7. **Checkbox visual density** — if it turns out unwelcome, the same state drives
   a dimmed row with a `check` codicon instead, and the store, controller and
   commands are unchanged either way.

## 13. Out of scope

- Seen state in Explorer badges — they are driven by change kind, and a `✓`
  would fight the letter badge.
- Per-hunk or per-line seen state.
- Syncing seen state between machines, or into a PR provider.
- Any write to the git repository.
