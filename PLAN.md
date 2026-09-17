# Branch Review Gutters — Implementation Plan

A private VS Code extension that overlays branch-vs-base change markers on the
normal editor gutter and the Explorer, so a feature branch can be reviewed by
browsing the repository with full language-server support instead of opening
diff editors.

This document is written for an implementing agent. Read it fully before
starting. Sections 4 and 6 are normative. Section 14 lists assumptions that were
taken as defaults and can be changed cheaply.

---

## 1. Goals and non-goals

### Goals

- Show gutter markers for added, modified and deleted lines in any open source
  file, comparing the live editor buffer against the file's content at the
  **merge base** of a base branch and HEAD, i.e. the same content as
  `git diff "$(git merge-base <base> HEAD)" -- <file>`.
- Mark changed files in the Explorer with a badge letter and colour, and offer a
  "changed files" quick pick.
- A status-bar item on the bottom right that shows on/off state and the active
  baseline, and opens a menu of all commands.
- Base can be auto-detected (`main`, `master`, configured names, remote
  fallbacks) or chosen manually as a branch, tag, ref or commit.
- Baseline and on/off state persist per repository across reloads.
- Baseline is recalculated when HEAD changes or the set of repositories changes.

### Non-goals (v1)

- No network access, no telemetry, no Marketplace publishing.
- No mutation of the repository: no writes to the index, refs, config,
  working tree or hooks. Not even the benign index refresh `git diff` performs.
- No comment/annotation features, no PR integration.
- No "committed changes only" mode; the right-hand side is always the live
  buffer (which equals the working tree when saved). Decided in discussion.
- No support for VS Code forks or the web/virtual workspace. VS Code desktop only.

---

## 2. Decisions already made (do not re-litigate)

| Topic | Decision |
|---|---|
| Right-hand side of diff | Live editor buffer (working tree + unsaved edits). Reviewer checks out a clean branch, so this equals HEAD in practice. |
| Manual selection semantics | Always apply merge base by default. Picker offers an explicit "exact commit (no merge base)" alternative. |
| Initial state | Gutters **off** until the user toggles them on; remember last state per repository per workspace. |
| Explorer badges | **Included**, plus a "changed files" quick pick and next/previous changed file commands. |
| Visual dominance | Branch-change markers should be clearly visible. The rendering spike (Section 4) decides between native Quick Diff and custom decorations. |
| Dependencies | Zero runtime dependencies. Dev dependencies allowed: `typescript`, `@types/vscode`, `@types/node`, `@vscode/vsce`. `esbuild` optional. No ESLint in v1. |
| Target editor | VS Code desktop, the installed version (1.138 at time of writing). `engines.vscode` should match the installed major/minor. |
| Identity | publisher `kidsnd274`, name `branch-review-gutters`, displayName "Branch Review Gutters". Placeholders; change in one place. |

---

## 3. Extension identity and manifest

`package.json` essentials:

```jsonc
{
  "name": "branch-review-gutters",
  "displayName": "Branch Review Gutters",
  "description": "Review a branch against its merge base using editor gutter markers, without diff editors.",
  "publisher": "kidsnd274",
  "version": "0.1.0",
  "private": true,
  "license": "UNLICENSED",
  "engines": { "vscode": "^1.138.0" },          // set to installed version
  "categories": ["SCM Providers", "Other"],
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "extensionKind": ["workspace"],
  "capabilities": {
    "untrustedWorkspaces": { "supported": false, "description": "Runs git in the workspace." },
    "virtualWorkspaces": false
  },
  "extensionDependencies": [],                    // do NOT hard-depend on vscode.git; use it opportunistically
  "contributes": { "commands": [...], "configuration": {...}, "menus": {...}, "colors": [...] }
}
```

- `extensionDependencies` stays empty so the extension still activates if the
  built-in Git extension is disabled (fallback path in 6.2).
- `contributes.colors` only under rendering Option B (6.7).
- `.vscodeignore` excludes `src/`, tests, fixtures, `node_modules` (no runtime
  deps so this is just hygiene), `.vscode/`, `PLAN.md`.

---

## 4. Phase 0 — API spike (hard gate before Phase 2)

Two rendering designs are possible. **Option A** is preferred for its small
size and native peek/navigation. It depends on VS Code behaviour that must be
verified against the installed version before building on it.

### Option A: Quick Diff provider

VS Code's built-in Git gutter is a *Quick Diff* provider: an object answering
"what is the original URI for this document?". VS Code then diffs the original
against the live buffer itself, draws the gutter, supports click-to-peek, and
provides `editor.action.dirtydiff.next/previous`. We supply the original as a
`TextDocumentContentProvider` URI that resolves to the merge-base blob.

### Option B: custom decorations

Fetch the base blob ourselves, run a vendored Myers line diff against the
buffer on change (debounced), and paint `TextEditorDecorationType`s with SVG
gutter icons. Full control over colours, more code, no native click-to-peek
(replaced by hover + commands).

### Spike procedure

1. Scaffold the minimal extension (Section 11). Create the fixture repo
   (Section 10.3).
2. Inspect `node_modules/@types/vscode/index.d.ts` for the installed version:
   - Is `vscode.window.registerQuickDiffProvider(...)` present and **stable**
     (not in a `vscode.proposed.*.d.ts`)? If yes, prefer it: it avoids creating
     a `SourceControl` entry. Record its exact signature.
   - Otherwise use `vscode.scm.createSourceControl(id, label, rootUri)` and set
     `sourceControl.quickDiffProvider = { provideOriginalResource }`.
3. Register a provider that returns, for every `file:` document in the fixture
   repo, a `review-base:` URI whose content provider serves
   `git cat-file blob <HEAD~1>:<path>` (hard-coded for the spike).
4. Launch the Extension Development Host on the fixture repo and check:
   - (a) Markers appear on tracked files whose content differs from `HEAD~1`,
     while the built-in Git gutter is empty (clean checkout).
   - (b) Make an unsaved edit: both gutters render and are distinguishable.
   - (c) Clicking a marker opens the peek view showing **our** diff; next /
     previous change navigation works inside the peek.
   - (d) Source Control view footprint: if a `SourceControl` was created, is the
     extra entry acceptable / collapsible when it has no resource groups?
   - (e) Colours: are our markers rendered in the primary colours
     (`editorGutter.addedBackground` etc.) or secondary
     (`editorGutter.addedSecondaryBackground` etc.)? Are the secondary colours
     clearly visible in the default Dark Modern and Light Modern themes?
5. Read the VS Code source for the installed tag to understand provider
   ordering and primary/secondary selection:
   `src/vs/workbench/contrib/scm/browser/quickDiffModel.ts` and
   `quickDiffDecorator.ts` (older name: `dirtydiffDecorator.ts`). Historic
   behaviour used only the **first** provider that returned a URI, which would
   make the Git extension win on every tracked file. Confirm the installed
   version merges multiple providers.
6. Also check whether the built-in Git extension already ships a merge-base
   Quick Diff (search `extensions/git/src` for `mergeBase`, `quickDiff`,
   `secondary`). If it does, write down what it provides and why this
   extension still adds value (manual base selection, Explorer badges, status
   bar, exact-commit mode) before continuing.

### Decision rule

- **Choose A** if (a) and (c) pass, (d) is acceptable, and the colours in (e)
  are clearly visible. If our markers come out in secondary colours, document
  the `workbench.colorCustomizations` overrides in README rather than writing
  settings on the user's behalf.
- **Choose B** otherwise.
- Record the outcome and evidence in `docs/spike-rendering.md`. Everything
  outside `src/rendering/` is identical for both options.

---

## 5. Architecture

```
src/
  extension.ts                 activate/deactivate; wires modules
  controller.ts                orchestrates refresh, owns per-repo state
  git/
    exec.ts                    safe git spawn (execFile, no shell)
    repositories.ts            repo discovery: vscode.git API + rev-parse fallback
    refs.ts                    ref validation, rev-parse, merge-base, for-each-ref
  baseline/
    resolver.ts                base detection + merge-base → Baseline
    state.ts                   persistence in workspaceState
  changes/
    changeSet.ts               name-status -M parser, rename map, untracked files
  content/
    baseContentProvider.ts     TextDocumentContentProvider for scheme review-base
    uri.ts                     encode/decode review-base URIs
  rendering/
    quickDiff.ts               Option A
    decorations.ts + diff/myers.ts + diff/hunks.ts    Option B (only if chosen)
  explorer/
    fileDecorations.ts         Explorer badges
  ui/
    statusBar.ts
    pickers.ts                 base picker, menu, changed-files picker
  commands.ts                  command registration
  types/git.d.ts               copied from vscode repo extensions/git/src/api/git.d.ts
  util/{debounce,disposable,log}.ts
test/                          node:test unit tests for pure modules
scripts/make-fixture-repo.sh   creates a temp repo exercising every case
```

Data flow:

```
repo events / commands
        │
        ▼
   controller.refresh(repo)
        ├─► baseline.resolver → Baseline { baseRef, baseCommit, headCommit, mode, status }
        ├─► changes.changeSet(baseCommit) → ChangeSet { byPath, renames, counts }
        ├─► statusBar.render(state)
        ├─► fileDecorations.fire()
        └─► rendering.invalidate()   (A: fire onDidChangeOriginalResource if available / re-register; B: re-decorate visible editors)

editor opens file ──► rendering asks controller for (repo, baseline, changeSet) ──► content provider serves blob (cached)
```

---

## 6. Module specifications

### 6.1 `git/exec.ts`

```ts
export interface GitResult { stdout: Buffer; stderr: string; code: number }
export async function git(repoRoot: string, args: string[], opts?: { maxBuffer?: number; allowNonZero?: boolean; timeoutMs?: number }): Promise<GitResult>
```

- Uses `child_process.execFile(gitPath, args, { cwd: repoRoot, env, encoding: 'buffer', maxBuffer, timeout, windowsHide: true })`. **Never** `exec`, never `shell: true`, never string concatenation of arguments.
- `env` = process env minus `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_NAMESPACE`, plus:
  - `GIT_OPTIONAL_LOCKS=0` — prevents `git diff`/`status` from writing the index.
  - `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=` (empty) — never prompt.
  - `LC_ALL=C`, `LANG=C` — stable output.
  - `GIT_CONFIG_PARAMETERS` untouched.
- `gitPath` resolution order: vscode.git API `api.git.path` → setting `git.path` → `"git"`.
- Default timeout 15 s; on timeout kill and reject with a typed `GitError { kind: 'timeout' | 'nonzero' | 'spawn', args, stderr }`.
- Only the following subcommands are ever invoked (enforce with a whitelist in code and a unit test):
  `rev-parse`, `merge-base`, `symbolic-ref`, `for-each-ref`, `cat-file`, `diff` (with `--name-status`), `ls-files`. All are read-only.
- Every command that could receive user text uses `--end-of-options` (Git ≥ 2.24) and/or `--`. Minimum supported Git: 2.24. Detect with `git --version` once and show a one-time warning if older.
- Log every invocation (args, duration, exit code) to an OutputChannel "Branch Review Gutters"; never log blob contents.

### 6.2 `git/repositories.ts`

```ts
export interface RepoInfo { rootUri: vscode.Uri; rootFsPath: string; headName?: string; headCommit?: string }
export interface RepositoryService {
  readonly repositories: readonly RepoInfo[];
  getRepositoryFor(uri: vscode.Uri): RepoInfo | undefined;
  onDidChangeRepositories: vscode.Event<void>;      // opened/closed
  onDidChangeRepositoryState: vscode.Event<RepoInfo>; // HEAD, index, working tree changed (debounced 300 ms)
}
```

- Primary implementation wraps `vscode.extensions.getExtension('vscode.git')`, `await ext.activate()`, `ext.exports.getAPI(1)`. Uses `api.repositories`, `api.getRepository(uri)`, `api.onDidOpenRepository`, `api.onDidCloseRepository`, `repository.state.onDidChange`, `repository.state.HEAD`. Copy `git.d.ts` from the VS Code repo into `src/types/`.
- Fallback when the Git extension is missing/disabled or `git.enabled` is false: for each workspace folder run `git rev-parse --show-toplevel` (via `exec.ts`) and build `RepoInfo`. HEAD changes detected by a `FileSystemWatcher` on `<root>/.git/HEAD` and `<root>/.git/refs/**` plus `onDidChangeWindowState` focus regain. Note: for worktrees `.git` is a file; parse `gitdir:` and watch that directory instead.
- Submodules and nested repos: `getRepositoryFor(uri)` returns the repo with the **longest** matching root path.

### 6.3 `baseline/resolver.ts`

```ts
export type BaseSelection =
  | { kind: 'auto' }
  | { kind: 'ref'; ref: string }          // merge-base(ref, HEAD)
  | { kind: 'exact'; ref: string };       // compare directly against ref

export type BaselineStatus = 'ok' | 'onBase' | 'noBase' | 'noMergeBase' | 'unbornHead' | 'error';

export interface Baseline {
  selection: BaseSelection;
  status: BaselineStatus;
  baseRef?: string;         // e.g. "main", "origin/main", "v1.2.0", or the literal user input
  baseCommit?: string;      // full SHA used for comparison (merge base or exact)
  headCommit?: string;
  headName?: string;        // branch name or undefined when detached
  message?: string;         // human-readable for tooltip on non-ok status
}

export async function resolveBaseline(repo: RepoInfo, selection: BaseSelection, cfg: Config): Promise<Baseline>
```

Algorithm:

1. `headCommit = rev-parse --verify --quiet HEAD`. Failure → `unbornHead`.
2. Determine candidate refs:
   - `auto`: `cfg.baseBranches` (default `["main", "master"]`), then each as `<cfg.remote>/<name>` (default remote `origin`), then the remote default branch from `git symbolic-ref --quiet refs/remotes/<remote>/HEAD` (strip `refs/remotes/`). Validate `cfg.remote` and each branch name with `git check-ref-format --branch <name>`? No — that spawns; instead a conservative regex `^[A-Za-z0-9._\/-]+$` and reject anything starting with `-`.
   - `ref` / `exact`: the single user-supplied ref, validated by the regex above (allow `~`, `^`, `@`, `{`, `}` for revision syntax; still reject leading `-`).
3. For each candidate: `git rev-parse --verify --quiet --end-of-options <candidate>^{commit}`. First success → `baseRef`, `baseRefCommit`. None → `noBase`.
4. `exact`: `baseCommit = baseRefCommit`, status `ok`. Done.
5. Otherwise `baseCommit = git merge-base <baseRefCommit> <headCommit>` (both are SHAs now, so no option-injection risk). Exit code 1 → `noMergeBase` ("unrelated histories"). Multiple merge bases: `merge-base` returns one; accept it.
6. If `headName === baseRef` or `baseCommit === headCommit` → status `onBase` with message "HEAD has no commits beyond <baseRef>". The extension **still activates** rendering in this state so uncommitted changes show, but the status bar says "(on base)". Rationale: cheap, honest, avoids a confusing empty state.
7. Return `Baseline`.

Re-resolve on: HEAD change, selection change, config change, manual refresh, repo open. Cache nothing across calls; each call is 2–4 fast spawns.

### 6.4 `baseline/state.ts`

- Key: `reviewGutters.repos.v1` in `context.workspaceState`.
- Value: `Record<repoRootFsPath, { enabled: boolean; selection: BaseSelection }>`.
- Default for an unknown repo: `{ enabled: false, selection: { kind: 'auto' } }`.
- Also set context key `reviewGutters.enabled` (boolean, for the **active editor's** repo) via `setContext` so menus/keybindings can react.

### 6.5 `changes/changeSet.ts`

```ts
export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'typeChanged';
export interface FileChange { kind: ChangeKind; path: string; basePath?: string; similarity?: number }
export interface ChangeSet {
  baseCommit: string;
  byPath: Map<string, FileChange>;         // key: repo-relative POSIX path of current file
  deleted: FileChange[];                    // files that exist only at base
  basePathFor(path: string): string | undefined;   // rename-aware; returns path itself for M/T, basePath for R/C, undefined for A/untracked
  counts: Record<ChangeKind, number>;
}
export async function loadChangeSet(repo: RepoInfo, baseCommit: string): Promise<ChangeSet>
export function parseNameStatusZ(buf: Buffer): FileChange[]       // pure, unit-tested
```

Commands:

```
git diff --no-ext-diff --no-color --no-textconv -z --name-status --find-renames --end-of-options <baseCommit> --
git ls-files --others --exclude-standard -z
```

- The first compares `baseCommit` to the **working tree** (no second revision), which matches the target semantics and includes uncommitted edits.
- `-z` record grammar: status letter(s) NUL path NUL, except `R<score>` and `C<score>` which are followed by **two** paths (old, new). `T` = type change, treat as modified. Unknown letters → treat as modified and log.
- Untracked files from `ls-files` are added as `untracked` unless already present.
- Paths are repo-relative POSIX. Convert to `Uri.joinPath(repo.rootUri, ...)` at the edges only.
- Refresh triggers: baseline change, `onDidChangeRepositoryState`, `onDidSaveTextDocument` for a file in the repo, manual refresh, window focus regain. Debounce 300 ms. Keep the previous `ChangeSet` until the new one arrives (no flicker).
- Large repos: a single `diff --name-status` is typically well under a second even on large trees. If it exceeds 5 s, log a warning; do not block rendering on it (rendering only needs `basePathFor`, and falls back to "same path" when the change set is not yet available).

### 6.6 `content/baseContentProvider.ts` and `content/uri.ts`

- Scheme: `review-base`.
- URI shape: `review-base:/<repo-relative-path>?<query>` where `query = encodeURIComponent(JSON.stringify({ repo: rootFsPath, commit: baseCommit, base: basePath }))`. Path component is the *current* path so the editor tab title looks right; `base` is the rename-aware path at `commit`. For added/untracked files `base` is `null` → provider returns `""`.
- `provideTextDocumentContent(uri)`:
  1. Decode. Validate `commit` is 40 hex chars and `base` contains no `..` segments and is not absolute.
  2. Cache lookup by `${repo}\0${commit}\0${base}` → string. Blobs at a commit are immutable, so the cache is only bounded by size: LRU of 200 entries or 50 MB, whichever first. Clear on baseline change (cheap, avoids holding stale trees).
  3. `git cat-file -s <commit>:<base>`; if > `cfg.maxFileSizeKB * 1024` → return `""` and mark the file "skipped: too large" (rendering then shows the whole file as added; acceptable, but status bar tooltip lists skipped files). Prefer instead: rendering asks `shouldProvide(uri)` first, which returns false for oversized/binary files so **no markers** appear. Implement `shouldProvide`.
  4. `git cat-file blob <commit>:<base>` with `maxBuffer = cap + 1`.
  5. Binary heuristic: NUL byte in the first 8000 bytes → `shouldProvide` false.
  6. Decode as UTF-8 (strip BOM if the target document has none; keep if it has). Non-UTF-8 files are a documented limitation.
  7. EOL normalisation: if the corresponding open `TextDocument` has `eol === CRLF`, convert `\n` → `\r\n` in the served text. Prevents every line showing modified on CRLF checkouts.
- Also register the same provider for a **read-only "Open base version"** command (6.10); VS Code treats content-provider documents as read-only automatically.
- Fire `onDidChange` for a URI when its cache entry is evicted while a document for it is open (rare; mainly baseline change).

### 6.7 `rendering/` — Option A: `quickDiff.ts`

- If `window.registerQuickDiffProvider` is stable in the installed typings:
  `registerQuickDiffProvider({ scheme: 'file' }, provider, 'branchReviewGutters', 'Branch Review', rootUri?)` — use the exact signature found in the spike. One registration per repository if a `rootUri` parameter exists; otherwise one global.
- Else: `scm.createSourceControl('branchReviewGutters', 'Branch Review', repo.rootUri)` per repository; set `quickDiffProvider`; create **no** resource groups; set `sourceControl.count = 0`; dispose when the repo closes.
- `provideOriginalResource(uri, token)`:
  1. Return `undefined` unless: extension enabled for this repo, `uri.scheme === 'file'`, `uri` is inside a known repo, not under `.git/`, baseline status is `ok` or `onBase`.
  2. `rel = posixRelative(repo.rootFsPath, uri.fsPath)`.
  3. `basePath = changeSet?.basePathFor(rel) ?? rel` (rename-aware; when the change set says the file is `added`/`untracked`, `basePath = null`).
  4. If `!(await content.shouldProvide(repo, baseCommit, basePath))` → `undefined`.
  5. Return `makeBaseUri(repo, baseCommit, rel, basePath)`.
- Invalidation: when baseline or enabled state changes, the original URIs change (different `commit` in the query), so VS Code re-queries on the next document event. To force an immediate refresh of open editors, re-register the provider (dispose + register), which makes VS Code re-request originals. Verify in spike that this is enough; if not, additionally touch documents via `onDidChange` of the content provider.
- Disable: dispose registration(s). Enable: register again.
- Navigation: reuse built-ins; document `editor.action.dirtydiff.next` / `.previous` in README. Add thin commands `reviewGutters.nextChange` / `previousChange` that simply `executeCommand` those built-ins so they appear in our menu with our labels.

### 6.7-B `rendering/` — Option B: `decorations.ts`, `diff/myers.ts`, `diff/hunks.ts` (only if the spike selects B)

- `diff/myers.ts`: `export function diffLines(a: string[], b: string[]): Edit[]` — classic O(ND) Myers with linear-space refinement not required; cap at 20 000 lines per side, beyond that fall back to a simple LCS-free "all modified" marker or skip with a notice. Pure, unit-tested against known cases (empty sides, identical, single insert/delete at start/middle/end, CRLF-insensitive when trimmed).
- `diff/hunks.ts`: group edits into hunks; for each hunk with `d` deletions and `a` additions: `min(d,a)` lines → `modified`, extra additions → `added`, extra deletions → one `deleted` marker attached to the line **after** the deletion, or the last line if the deletion is at EOF. Store the deleted text for hover.
- `decorations.ts`: three `TextEditorDecorationType`s:
  - `gutterIconPath`: SVG data URIs (a 3-px vertical bar for added/modified, a small triangle for deleted), `gutterIconSize: 'contain'`, separate `light`/`dark` variants.
  - `overviewRulerColor: new ThemeColor('reviewGutters.added' | ...)`, `overviewRulerLane: Left`.
  - Contribute colours `reviewGutters.addedBackground`, `.modifiedBackground`, `.deletedBackground` with defaults matching VS Code's gutter greens/blues/reds.
  - Deleted marker decorations carry a `hoverMessage` MarkdownString: fenced code block in the document's `languageId` containing the deleted lines (cap 200 lines).
- Re-diff on `onDidChangeTextDocument` (debounce 150 ms), `onDidChangeVisibleTextEditors`, baseline/enable changes. Diff runs in the extension host (async chunking not needed at the 20 000-line cap).
- Commands: `nextChange`/`previousChange` (own implementation: jump to next hunk start), `showChangeAtCursor` (shows a hover-like QuickPick with the removed/added text), `compareWithBase` (opens `vscode.diff(baseUri, fileUri, title)` on explicit request only).

### 6.8 `explorer/fileDecorations.ts`

- `window.registerFileDecorationProvider(provider)`.
- `provideFileDecoration(uri)`: `undefined` unless enabled for the repo and `uri.scheme === 'file'`. Lookup `changeSet.byPath.get(rel)`.
- Mapping:

| kind | badge | color (ThemeColor) |
|---|---|---|
| added / untracked | `A` / `U` | `gitDecoration.addedResourceForeground` / `gitDecoration.untrackedResourceForeground` |
| modified / typeChanged | `M` | `gitDecoration.modifiedResourceForeground` |
| renamed | `R` | `gitDecoration.renamedResourceForeground` |

- `propagate: true` so folders inherit the colour (matches the Git extension). Tooltip: `"Modified vs main (merge base 1a2b3c4)"`.
- Deleted files have no Explorer node; they appear only in the changed-files picker.
- Fire `onDidChangeFileDecorations(undefined)` whenever the change set or enabled state changes.
- Setting `reviewGutters.explorerBadges` (default `true`) disables this module.

### 6.9 `ui/statusBar.ts`

- `window.createStatusBarItem('reviewGutters.status', StatusBarAlignment.Right, 95)`; `command = 'reviewGutters.showMenu'`; `name = 'Branch Review Gutters'`.
- Shows state for the **active editor's repository**; if no active editor, the first repository; if no repositories at all, **hidden**.
- States (text uses codicons):

| condition | text | background | tooltip (MarkdownString) |
|---|---|---|---|
| disabled | `$(git-compare) Review: off` | default | "Branch review gutters are off. Base would be **main** (merge base `1a2b3c4`). Click for options." |
| enabled, `ok`, `auto`/`ref` | `$(git-compare) Review: main` | default | base ref, merge-base short SHA, HEAD name, "12 files changed (8 M, 3 A, 1 D)", mode |
| enabled, `ok`, `exact` | `$(git-compare) Review: @1a2b3c4` | default | "Comparing exactly against `1a2b3c4` (tag v1.2.0), no merge base." |
| enabled, `onBase` | `$(git-compare) Review: main (on base)` | default | "HEAD has no commits beyond main; only uncommitted changes will show." |
| enabled, `noBase` | `$(warning) Review: no base` | `statusBarItem.warningBackground` | "Could not find main, master, origin/main… Click to select a base." |
| enabled, `noMergeBase` | `$(warning) Review: unrelated` | warning | "main and HEAD share no history." |
| enabled, `unbornHead`/`error` | `$(error) Review: git error` | `statusBarItem.errorBackground` | error text, link "Show log" |

- Truncate long ref names to 24 chars with `…`.
- Update on: active editor change, controller state change.

### 6.10 `commands.ts` and `ui/pickers.ts`

All commands are contributed with category "Review Gutters" and appear in the Command Palette.

| id | title | behaviour |
|---|---|---|
| `reviewGutters.toggle` | Toggle Review Gutters | flip `enabled` for the active repo; on first enable with `auto`, resolve baseline; if `noBase`, immediately open the base picker |
| `reviewGutters.enable` / `.disable` | Enable / Disable Review Gutters | explicit forms |
| `reviewGutters.selectBase` | Select Base Branch or Commit… | picker (below); saves selection, enables if disabled, refreshes |
| `reviewGutters.autoDetectBase` | Auto-detect Base Branch | set selection `auto`, refresh; toast the result ("Base: main, merge base 1a2b3c4") |
| `reviewGutters.refresh` | Refresh Comparison | re-resolve baseline, reload change set, invalidate rendering and content cache |
| `reviewGutters.clearBase` | Clear Base Selection | same as auto-detect but also disables gutters? **No**: clear = back to `auto`, keep enabled state. Rationale: "clear" refers to the selection, not the feature |
| `reviewGutters.showMenu` | Review Gutters Menu | status-bar QuickPick (below) |
| `reviewGutters.showChangedFiles` | Show Changed Files… | changed-files QuickPick |
| `reviewGutters.nextChangedFile` / `.previousChangedFile` | Next / Previous Changed File | open the next/previous file in the sorted change set relative to the active editor; wraps |
| `reviewGutters.nextChange` / `.previousChange` | Next / Previous Change in File | A: delegate to `editor.action.dirtydiff.next/previous`; B: own |
| `reviewGutters.openBaseVersion` | Open Base Version of Current File | `window.showTextDocument(baseUri, { preview: true })` read-only |
| `reviewGutters.compareWithBase` | Compare Current File with Base | `vscode.diff(baseUri, fileUri, "<name> (base ↔ working tree)")` — optional convenience, never required |
| `reviewGutters.showLog` | Show Log | reveal OutputChannel |

**Status-bar menu (`showMenu`)** — QuickPick, items in this order, dynamic text:

1. `$(circle-large-filled) Disable review gutters` or `$(circle-large-outline) Enable review gutters`
2. `$(git-branch) Select base branch or commit…` — description: current selection
3. `$(search) Auto-detect base` — description: what auto would resolve to
4. `$(list-unordered) Show changed files…` — description: `12 files`
5. `$(refresh) Refresh`
6. `$(clear-all) Clear base selection` (only when selection ≠ auto)
7. `$(output) Show log`

**Base picker (`selectBase`)** — QuickPick with `matchOnDescription`, built from one command:

```
git for-each-ref --format=%(refname:short)%00%(objectname:short)%00%(committerdate:relative)%00%(refname) refs/heads refs/remotes refs/tags
```

- Sections (QuickPickItemKind.Separator): "Local branches", "Remote branches", "Tags". Current branch excluded from local branches (or shown disabled). Each item: label = short name, description = short SHA + relative date.
- Last item: `$(edit) Enter a ref or commit manually…` → `showInputBox` with live `validateInput` that runs `rev-parse --verify --quiet --end-of-options <input>^{commit}` (debounced 200 ms) and shows the resolved short SHA or "not found".
- After a ref is chosen, a second small QuickPick asks the mode:
  - `Use merge base with HEAD (recommended)` — detail: "Shows only changes made on this branch since it diverged from <ref>."
  - `Compare exactly against <ref>` — detail: "Also shows changes made on <ref> since divergence."
  Skip this second step when the chosen ref is an ancestor of HEAD (`git merge-base --is-ancestor <sha> HEAD` exits 0), because both modes are identical then.

**Changed-files picker (`showChangedFiles`)** — QuickPick, `matchOnDescription`, items sorted by path:

- label: `$(diff-added|diff-modified|diff-removed|diff-renamed) <filename>`, description: directory, detail for renames: `from <basePath>`.
- Selecting a normal item opens the file. Selecting a deleted item opens the base version read-only (6.6).
- Header buttons: refresh.

### 6.11 `controller.ts`

Owns `Map<repoRoot, RepoRuntime { info, state, baseline?, changeSet?, refreshing: Promise }>`.

- `refresh(repo, { reason })`: serialize per repo (coalesce concurrent calls into one in-flight promise + one queued). Steps: resolve baseline → if `ok`/`onBase` load change set → clear content cache if `baseCommit` changed → notify status bar, file decorations, rendering.
- Listens to: `RepositoryService` events, `onDidChangeActiveTextEditor` (status bar only), `onDidSaveTextDocument`, `onDidChangeConfiguration('reviewGutters')`, `onDidChangeWindowState` (focused → refresh change set if > 5 s since last).
- Activation: load persisted state; for repos with `enabled: true`, run `refresh` lazily on first visible editor in that repo (avoid spawning git for all repos on startup). Status bar shows persisted state immediately.

---

## 7. Settings (`contributes.configuration`, prefix `reviewGutters`)

| key | type | default | purpose |
|---|---|---|---|
| `baseBranches` | string[] | `["main", "master"]` | auto-detect candidates, in order |
| `remote` | string | `"origin"` | remote used for `<remote>/<branch>` fallbacks and remote HEAD |
| `explorerBadges` | boolean | `true` | Explorer colours/badges |
| `maxFileSizeKB` | number | `1024` | skip base blobs larger than this |
| `excludeGlobs` | string[] | `[]` | glob patterns (repo-relative) never decorated, e.g. lockfiles, generated code |
| `logLevel` | `"info" \| "debug"` | `"info"` | OutputChannel verbosity |

Option B adds `contributes.colors` for `reviewGutters.addedBackground`, `.modifiedBackground`, `.deletedBackground`.

---

## 8. Edge cases (each needs handling and, where pure, a unit test)

1. **Renamed file** on the branch → base content fetched from `basePath`; badge `R`. Without the change set (not yet loaded) fall back to same path and re-render when it arrives.
2. **Added / untracked file** → no base; A: return `undefined` (VS Code shows nothing) or an empty original so the whole file is "added"? **Decision: empty original**, so the whole file shows as added — the reviewer needs to know it is new. Badge `A`/`U`.
3. **Deleted file** → only in the changed-files picker; opens base version.
4. **On the base branch** (`onBase`) → still active, labelled.
5. **Detached HEAD** → works; status bar shows `Review: main` with tooltip "HEAD detached at 1a2b3c4".
6. **Base branch missing locally, present on remote** → `origin/main` fallback; tooltip shows the actual ref used.
7. **Unrelated histories** → `noMergeBase` warning state.
8. **Empty repo / unborn HEAD** → error state, no rendering.
9. **Multiple repositories / multi-root** → state per repo; status bar follows active editor; each repo has its own provider registration.
10. **Submodules / nested repos** → longest-root match.
11. **Worktrees** (`.git` is a file) → `cwd`-based spawning already works; fallback watcher must parse `gitdir:`.
12. **Binary files** → no markers, no crash. `.gitattributes` `-text`/`binary` are not consulted; the NUL heuristic suffices.
13. **Huge files** → skipped via `maxFileSizeKB`; note in tooltip count "N skipped".
14. **CRLF working tree, LF in git** → served base normalised to the document EOL.
15. **Non-UTF-8 files** → documented limitation; markers may be noisy.
16. **Git older than 2.24** → one-time warning; `--end-of-options` unsupported so pass user refs only through `rev-parse --verify -- <ref>`? `rev-parse` does not accept `--` for refs. Therefore: on old Git, reject any user ref that starts with `-` via the regex (already done) and proceed without `--end-of-options`.
17. **Git extension disabled** → fallback discovery; document reduced responsiveness.
18. **User runs `git checkout`, `rebase`, `fetch` externally** → repo state event / focus regain triggers re-resolve; merge base may move after a rebase — this is correct behaviour.
19. **Paths with spaces, unicode, leading dashes** → arrays + `-z` + `--` everywhere; unit test the parser with such names.
20. **Documents not on disk** (untitled, `git:`, `output:`, settings) → ignored.
21. **Files under `.git/`** or matching `excludeGlobs` → ignored.
22. **Extension disabled while peek is open** (Option A) → disposing the provider is enough; VS Code closes/clears.

---

## 9. Constraints checklist (verify before calling the work done)

- [ ] No `require('http')`, `https`, `net`, `dns`, `fetch` anywhere. Grep the bundle.
- [ ] No telemetry APIs (`vscode.env.createTelemetryLogger`) used.
- [ ] `dependencies` in `package.json` is empty. Dev deps limited to the approved list.
- [ ] Every git spawn goes through `git/exec.ts`; `execFile` only; subcommand whitelist test passes.
- [ ] `GIT_OPTIONAL_LOCKS=0` set; manual test: run the extension for 10 minutes on a repo and confirm `.git/index` mtime does not change and `git status` remains clean.
- [ ] No write APIs touched: no `workspace.fs.write*`, no `applyEdit`, no settings writes (`ConfigurationTarget`) — grep.
- [ ] Rendering uses only decoration/quick-diff APIs; no `languages.register*` providers, so hover, definition, references and call hierarchy are untouched. Verify manually with a TypeScript project: Go to Definition and Find References still work on a decorated line.
- [ ] Extension host stays responsive: no synchronous `execFileSync`/`spawnSync`.
- [ ] Untrusted workspaces: extension does not activate (`capabilities.untrustedWorkspaces.supported: false`).

---

## 10. Testing

### 10.1 Unit tests (`node --test`, no extra deps)

Compile tests with the same `tsc` config into `out/test/`; run `node --test out/test/`. Pure modules under test:

- `parseNameStatusZ`: M/A/D/T, `R100 old new`, `C075 old new`, names with spaces/unicode/newlines, empty buffer, trailing NUL.
- Candidate-ref builder (given config → ordered list), regex validation (rejects `-foo`, accepts `feature/x`, `v1.2`, `HEAD~3`, `origin/main`).
- `review-base` URI encode/decode round trip; rejects `..` and absolute base paths.
- EOL normaliser.
- Hunk classifier and Myers diff (Option B only).
- Status-bar text/tooltip renderer given a state object (pure function).
- `exec.ts` argument builder: subcommand whitelist; `--end-of-options`/`--` presence for user-input commands (test the arg arrays, not the spawn).

Mock `vscode` for pure modules by keeping them free of `vscode` imports (pass `Uri`-like data in, return data out). Do not add a test framework.

### 10.2 Manual QA checklist (README section, run before each VSIX build)

Using the fixture repo:

1. Open repo on `feature`, status bar shows `Review: off`. Toggle on → `Review: main`, tooltip shows merge-base SHA.
2. Open `src/modified.ts`: modified lines marked; open `src/added.ts`: whole file marked added; open `src/renamed-new.ts`: only real edits marked (rename handled); `src/has-deletion.ts`: deleted marker at the right line, hover/peek shows removed text.
3. The later commit on `main` (fixture step 6) does **not** appear anywhere.
4. Explorer shows badges `M`, `A`, `R`; folders coloured. Changed-files picker lists the deleted file and opens its base version.
5. Select base `release/1.0` via picker → markers change accordingly. Choose "compare exactly" for `HEAD~1` → markers reflect only the last commit.
6. `git checkout main` in a terminal → status bar shows `(on base)` within a second or two. `git checkout feature` → restores.
7. Make an unsaved edit → marker appears immediately (Option A: automatically; B: after debounce). Revert → disappears.
8. Toggle off → all markers and badges vanish; language features still work.
9. Reload window → state and base selection restored.
10. Disable the built-in Git extension → extension still works (fallback discovery), status bar unaffected.
11. `.git/index` mtime unchanged after the session; `git status` clean.

### 10.3 Fixture repo script `scripts/make-fixture-repo.sh`

Creates `$TMPDIR/review-gutters-fixture` with:

1. `main`: `src/modified.ts`, `src/has-deletion.ts`, `src/renamed-old.ts`, `src/unchanged.ts`, `bin/blob.bin` (binary), `docs/crlf.txt` (CRLF), and commit.
2. Branch `release/1.0` from `main`.
3. Branch `feature` from `main`: modify `modified.ts` (edit, insert, append), delete lines in `has-deletion.ts`, `git mv renamed-old.ts renamed-new.ts` + small edit, add `src/added.ts`, two commits.
4. Add a `-leading-dash.ts` file and a `sp ace/üñí.ts` file on `feature`.
5. Tag `v1.0` on `release/1.0`.
6. Back on `main`: an extra commit touching `src/unchanged.ts` (must **not** show on `feature`).
7. Checkout `feature`. Optionally add an untracked file and leave one file with an uncommitted edit behind a `--dirty` flag.

---

## 11. Build, packaging, install

- `npm init -y`, then dev deps: `typescript`, `@types/vscode@<installed minor>`, `@types/node@24`, `@vscode/vsce`.
- `tsconfig.json`: `strict: true`, `module: commonjs`, `target: es2022`, `outDir: out`, `rootDir: .`, include `src` and `test`, `lib: ["es2022"]`, `types: ["node"]`.
- Scripts: `compile` (`tsc -p .`), `watch`, `test` (`npm run compile && node --test out/test/`), `package` (`vsce package --no-dependencies`), `install-local` (`code --install-extension *.vsix --force`).
- `.vscode/launch.json` with an Extension Development Host configuration whose `args` open the fixture repo.
- README: what it does, how it differs from the built-in Git gutter, commands, settings, limitations, the colour-override snippet if markers ended up secondary, the manual QA checklist.
- `CHANGELOG.md` with `0.1.0`.
- No bundler in v1. If startup time matters later, add `esbuild` as a dev dep.

---

## 12. Work order

| milestone | scope | exit criterion |
|---|---|---|
| M0 Spike | Section 4; fixture script; `docs/spike-rendering.md` | A/B decision recorded with evidence |
| M1 Skeleton | manifest, `exec.ts`, `repositories.ts`, `refs.ts`, `resolver.ts`, `state.ts`, status bar, toggle + base picker + auto-detect + refresh + clear commands, persistence, OutputChannel | status bar reflects state and baseline on the fixture; no gutters yet; unit tests for parser/validation |
| M2 Rendering | `content/`, `rendering/` (A or B), next/previous change, open base version | QA items 1–3, 7–9 pass |
| M3 Files | `changeSet.ts`, Explorer badges, changed-files picker, next/previous changed file, rename handling | QA items 4–5 pass |
| M4 Hardening | edge cases in Section 8, constraints checklist Section 9, README, CHANGELOG, VSIX build, full QA | all QA items pass; checklist all ticked |

Commit at each milestone boundary with a descriptive message. Do not push.

---

## 13. Acceptance criteria

- With gutters enabled on `feature`, every line changed relative to `merge-base(main, HEAD)` is marked, and nothing from `main`'s later commit is marked.
- Deleted ranges are visible as a marker beside the nearest surviving line, and the removed text can be seen without opening a diff editor (peek or hover).
- Renamed files show only their real edits.
- Explorer badges match `git diff --name-status --find-renames <merge-base>` plus untracked files.
- Status bar: hidden without a repo; shows off/on and the base; one click reaches every command.
- Manual base selection supports branches, remote branches, tags, and typed refs/SHAs, with merge-base and exact modes.
- HEAD change, repo open/close and manual refresh update everything within ~1 s.
- Go to Definition, Find References, Call Hierarchy and diagnostics behave identically with gutters on and off.
- `git status` stays clean and `.git/index` is not rewritten by the extension.
- Zero runtime dependencies; no network, no telemetry; all git spawns via `execFile` with argument arrays.

---

## 14. Assumptions taken as defaults (cheap to change)

- Manual selection applies merge base unless the user explicitly picks "compare exactly". (Question 1 in the discussion was left unanswered; this is the safe default.)
- "Clear base selection" returns to auto-detect and leaves the enabled state alone.
- `onBase` state keeps rendering active rather than showing nothing.
- Added files render as fully added (empty original) rather than unmarked.
- Status bar priority 95 on the right, i.e. just left of the built-in language/encoding items. Adjust if it collides with other extensions.
- Extension does not activate in untrusted workspaces.
- Publisher/name placeholders `kidsnd274` / `branch-review-gutters`.
