#!/usr/bin/env bash
# Creates a throwaway repository that exercises every case the extension has to
# handle. Safe to re-run: the target directory is deleted first.
#
#   ./scripts/make-fixture-repo.sh [--dirty]
#
# --dirty  leaves an uncommitted edit and an untracked file behind.

set -euo pipefail

DIRTY=0
if [[ "${1:-}" == "--dirty" ]]; then
	DIRTY=1
fi

TARGET="${TMPDIR:-/tmp}"
TARGET="${TARGET%/}/review-gutters-fixture"

rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"

git init --quiet --initial-branch=main .
git config user.name 'Fixture'
git config user.email 'fixture@example.invalid'
git config commit.gpgsign false

mkdir -p src bin docs 'sp ace'

# ---------------------------------------------------------------- 1. main ----

cat > src/modified.ts <<'TS'
export function alpha(): string {
	return 'alpha';
}

export function beta(): string {
	return 'beta';
}

export function gamma(): string {
	return 'gamma';
}
TS

cat > src/has-deletion.ts <<'TS'
export const keep1 = 1;
export const removeMe1 = 2;
export const removeMe2 = 3;
export const keep2 = 4;
export const tailRemoved1 = 5;
export const tailRemoved2 = 6;
TS

cat > src/renamed-old.ts <<'TS'
export const renamedValue = 'original';
export const untouchedA = 'a';
export const untouchedB = 'b';
export const untouchedC = 'c';
export const untouchedD = 'd';
export const untouchedE = 'e';
export const untouchedF = 'f';
export const untouchedG = 'g';
export const untouchedH = 'h';
export const untouchedI = 'i';
TS

cat > src/unchanged.ts <<'TS'
export const stable = 'never edited on the feature branch';
TS

# A binary file: NUL bytes in the first few bytes.
printf 'BIN\000\001\002\003payload' > bin/blob.bin

# A CRLF file, committed with CRLF bytes in the blob.
printf 'line one\r\nline two\r\nline three\r\n' > docs/crlf.txt

git add -A
git commit --quiet -m 'main: initial tree'

# ------------------------------------------------------- 2. release branch ----

git branch release/1.0

# ------------------------------------------------------- 3. feature branch ----

git switch --quiet -c feature

# An edit in the middle, an insertion, and an append.
cat > src/modified.ts <<'TS'
export function alpha(): string {
	return 'ALPHA (edited on feature)';
}

export function inserted(): string {
	return 'inserted on feature';
}

export function beta(): string {
	return 'beta';
}

export function gamma(): string {
	return 'gamma';
}

export function appended(): string {
	return 'appended on feature';
}
TS

# Deletions in the middle and at the end of the file.
cat > src/has-deletion.ts <<'TS'
export const keep1 = 1;
export const keep2 = 4;
TS

git mv src/renamed-old.ts src/renamed-new.ts
cat > src/renamed-new.ts <<'TS'
export const renamedValue = 'edited after the rename';
export const untouchedA = 'a';
export const untouchedB = 'b';
export const untouchedC = 'c';
export const untouchedD = 'd';
export const untouchedE = 'e';
export const untouchedF = 'f';
export const untouchedG = 'g';
export const untouchedH = 'h';
export const untouchedI = 'i';
TS

cat > src/added.ts <<'TS'
export function brandNew(): string {
	return 'this whole file is new on feature';
}
TS

git add -A
git commit --quiet -m 'feature: edit, delete, rename and add'

# -------------------------------------------- 4. awkward names on feature ----

cat > ./-leading-dash.ts <<'TS'
export const leadingDash = true;
TS

cat > 'sp ace/üñí.ts' <<'TS'
export const unicodeAndSpaces = true;
TS

git add -A -- .
git commit --quiet -m 'feature: files with awkward names'

# ------------------------------------------------------------- 5. the tag ----

git tag v1.0 release/1.0

# ------------------------------- 6. a later commit on main (must not show) ----

git switch --quiet main
cat > src/unchanged.ts <<'TS'
export const stable = 'never edited on the feature branch';
export const addedOnMainAfterDivergence = 'must NOT appear when reviewing feature';
TS
git add -A
git commit --quiet -m 'main: a commit after the branch point'

# ----------------------------------------------------- 7. back to feature ----

git switch --quiet feature

if [[ "$DIRTY" == "1" ]]; then
	printf '\nexport const uncommitted = true;\n' >> src/modified.ts
	cat > src/untracked.ts <<'TS'
export const neverCommitted = true;
TS
fi

echo "Fixture repository: $TARGET"
echo
git --no-pager log --oneline --graph --all --decorate
echo
echo "Changes on feature vs merge-base(main, HEAD):"
git --no-pager diff --name-status --find-renames "$(git merge-base main HEAD)" --
