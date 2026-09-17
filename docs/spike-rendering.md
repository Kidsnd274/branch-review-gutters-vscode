# Phase 0 spike — rendering option decision

**Outcome: Option A (Quick Diff provider via `scm.createSourceControl`).**

Environment: VS Code 1.138.0 (`7debcd0e2acdea1c52de81bf9ee1620444407dda`, arm64),
`@types/vscode@1.138.0`, git 2.50.1, node 24.5.0.

Evidence was gathered statically from the installed application bundle
(`/Applications/Visual Studio Code.app/Contents/Resources/app`) rather than from
the VS Code git repository, which is not reachable from this machine. The
bundled workbench and the bundled built-in Git extension are the exact code the
extension will run against, so this is stronger evidence than reading a source
tag, except for the visual checks noted at the bottom.

## 1. Is `window.registerQuickDiffProvider` stable?

No. `node_modules/@types/vscode/index.d.ts` at 1.138.0 contains
`QuickDiffProvider` (line 16426), `SourceControl.quickDiffProvider` (16623) and
`scm.createSourceControl(id, label, rootUri?)` (16680), but **no**
`registerQuickDiffProvider`. So we take the documented fallback: one
`SourceControl` per repository with a `quickDiffProvider` and no resource
groups.

## 2. Does the workbench merge multiple quick diff providers?

Yes. The historic "first provider wins" behaviour is gone. In
`workbench.desktop.main.js` the quick diff service exposes `getQuickDiffs()`,
which resolves **every** registered provider and returns an array of
`{ id, label, kind, originalResource }`, skipping only rejected promises and
providers the user has hidden via `toggleQuickDiffProviderVisibility`
(persisted in storage). The decorator then iterates the labelled changes of all
of them.

## 3. Primary or secondary colours?

**Primary.** The extension-host bridge registers any
`SourceControl.quickDiffProvider` with `kind: "primary"`:

```js
this._quickDiff = this._quickDiffService.addQuickDiffProvider({
  id: `${this._providerId}.quickDiffProvider`,
  label: o.quickDiffLabel ?? this.label,
  rootUri: this.rootUri,
  kind: "primary",
  getOriginalResource: ...
})
```

`kind: "secondary"` is reserved for `secondaryQuickDiffProvider`, which is a
proposed API we do not use. The decorator picks decoration options by kind —
`a.kind === "primary" || a.kind === "contributed" ? this.deletedOptions
: this.deletedSecondaryOptions` — so our markers are drawn with
`editorGutter.addedBackground` / `modifiedBackground` / `deletedBackground`,
i.e. exactly as visible as the built-in Git gutter. No
`workbench.colorCustomizations` snippet is needed in the README, and Option B's
`contributes.colors` is not needed either.

(For reference, the secondary colours are derived — `transparent(primary, .5)`
on dark, `lighten(primary, .7)` on light — which is why landing in the primary
bucket matters.)

## 4. Does the built-in Git extension already ship a merge-base quick diff?

No. The bundled Git extension registers exactly two providers, and neither uses
a merge base:

- primary, label `Git Local Changes (Working Tree)` — original is the file at
  the index/HEAD for the working-tree diff;
- secondary, label `Git Local Changes (Index)` — original is `HEAD`, and it
  returns early unless the resource is in the index resource group.

`grep` for `mergeBase` in `extensions/git/dist/main.js` returns nothing. This
extension therefore adds: merge-base baselines, manual base selection
(branch / remote branch / tag / ref / SHA), exact-commit mode, Explorer badges
driven by that baseline, a changed-files picker and a status bar.

On a clean checkout the Git extension's working-tree provider yields no changes,
so in the intended review workflow our markers are the only ones in the gutter.
With unsaved edits both render; they are distinguishable because each provider
carries its own label in the peek view's provider switcher.

## 5. Source Control view footprint

We create one `SourceControl` per repository with no resource groups and
`count = 0`. It appears in the Source Control provider list next to Git. This is
accepted as the cost of a stable API. Users who dislike the extra gutter source
can hide it from the quick diff provider menu, which the workbench persists.

## 6. Not verified statically

Runtime checks 4(a)–(d) of the plan — markers actually appearing, peek showing
our diff, next/previous inside the peek, and the visual weight of the SCM entry
— require the Extension Development Host and are covered by the manual QA
checklist in the README. Everything outside `src/rendering/` is identical under
either option, so switching to Option B stays cheap if QA contradicts the
above.

---

## Addendum — `GIT_OPTIONAL_LOCKS=0` does not cover `git diff`

Not part of the rendering decision, but found while checking the plan's
"no writes to the repository" constraint on the same machine.

The plan assumed `GIT_OPTIONAL_LOCKS=0` prevents `git diff` from writing the
index. It does not. Measured on git 2.50.1 (Apple Git-155), after touching a
tracked file so the cached stat data is stale:

| command | `.git/index` |
|---|---|
| `GIT_OPTIONAL_LOCKS=0 git status --porcelain` | unchanged |
| `git --no-optional-locks status --porcelain` | unchanged |
| `GIT_OPTIONAL_LOCKS=0 git diff --name-status <base> --` | **rewritten** |
| `git --no-optional-locks diff --name-status <base> --` | **rewritten** |

The variable suppresses the opportunistic index refresh for `status`-family
commands only; `diff` refreshes and writes regardless.

Fix: `src/git/shadowIndex.ts` copies the index to the OS temp directory
immediately before the change-set commands and points `GIT_INDEX_FILE` at the
copy. Git rewrites the copy; the repository's index is untouched. Output was
verified byte-identical to a normal invocation, and
`scripts/check-index-untouched.js` asserts the property end to end.
