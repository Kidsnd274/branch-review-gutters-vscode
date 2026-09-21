# Repository Code Review

Date: September 17, 2026

Scope: Entire tracked repository, with emphasis on correctness, unexpected
behavior, performance, and runtime risks rather than style.

## Findings

### 1. High: A refresh failure can display changes from the wrong baseline

`src/controller.ts:255` replaces `runtime.baseline` before loading the
corresponding change set. If `loadChangeSet()` fails, the catch at line 266
retains the previous `runtime.changeSet`.

After a checkout, rebase, or base-selection change, Explorer badges and rename
mappings can therefore describe the old comparison while base content is
fetched from the new commit.

### 2. Medium: Missing base blobs are rendered as fully added files

`src/content/baseContentProvider.ts:59` does not check `entry.missing` when
deciding whether to provide an original resource.

This affects Git-ignored files because they are excluded from:

```text
git ls-files --others --exclude-standard
```

Opening an ignored file that is absent from the base can consequently produce a
false whole-file gutter. This was reproduced with `shouldProvide()` returning
`true` for such a file.

### 3. Medium: Concurrent refreshes use the same temporary index file

Save-triggered refreshes at `src/controller.ts:65` call
`refreshChangeSetOnly()` directly, bypassing the per-repository serialization in
`refresh()`.

At the same time, `src/git/shadowIndex.ts:61` derives the temporary index
filename solely from the repository path and process ID. Concurrent calls for
the same repository therefore receive the same path, allowing one operation to
overwrite or delete another operation's active index. The identical-path
collision was reproduced.

### 4. Medium: Configuration changes do not reliably update open gutters

The registration signature in `src/rendering/quickDiff.ts:63` includes only the
baseline commit and added, untracked, or renamed path mappings.

Changes to `reviewGutters.excludeGlobs` or
`reviewGutters.maxFileSizeKB` do not change this signature. Existing editors may
therefore continue using cached original-resource decisions until another
baseline or path-mapping change causes the provider to be registered again.

### 5. Medium: Git-extension and fallback transitions are incomplete

`src/git/repositories.ts:93` installs an enablement listener only when the
built-in Git extension starts disabled. If Git starts enabled and is disabled
later, this extension does not switch to fallback discovery.

In the other direction, the fallback workspace-folder listener installed at
line 157 remains active after switching to the Git API. A later workspace-folder
change can run fallback discovery again and overwrite or remove API-discovered
repositories.

### 6. Medium: Linked-worktree fallback watching misses checkout changes

`src/git/repositories.ts:291` returns the common Git directory for linked
worktrees. Branch references are stored there, but the worktree's `HEAD` is
stored in its per-worktree Git directory.

The watcher created at line 214 consequently watches the wrong `HEAD`.
Checking out another existing branch from VS Code's integrated terminal may not
refresh the extension until window focus is regained or a reference changes.

### 7. Low: Builds can package stale JavaScript

The scripts in `package.json:179` run TypeScript compilation without first
cleaning `out/`.

The inspected VSIX contained `out/src/util/disposable.js`, although there is no
corresponding source file. Deleted modules and compiled tests can persist across
builds, making build and test results depend on earlier workspace contents.

### 8. Low: Every save refreshes every active repository

The debounced callback at `src/controller.ts:65` reloads the change set for
every enabled and touched repository after a document is saved in any one
repository.

This can cause unnecessary full-repository Git operations in multi-root
workspaces and increases the likelihood of the temporary-index concurrency
problem described above.

## Verification

- `npm test`: 60 tests passed.
- TypeScript compilation passed.
- The normal shadow-index integrity fixture passed.
- `npm audit` reported no vulnerabilities.
- VSIX contents were inspected.
- The tracked source worktree was not modified during the review.

## Remaining Test Gaps

The existing tests cover pure parsing, path, URI, text, navigation, baseline
candidate, and status-rendering helpers. There is no automated runtime coverage
for the highest-risk integration areas:

- `Controller` refresh ordering and failure behavior
- `RepositoryService` lifecycle and fallback transitions
- `BaseContentProvider` missing, ignored, and cache behavior
- Concurrent shadow-index creation
- Quick Diff provider re-registration after configuration changes
- Linked-worktree filesystem watching
