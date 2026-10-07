#!/usr/bin/env bash
# Copy the PR's changed test files onto a detached worktree of origin/v1-alpha
# and require each file to fail there. One changed test file is one group.
#
# Cost: an extra git worktree. A Vitest file also runs
# `pnpm install --frozen-lockfile` and `pnpm build:ts` once in that worktree.
# A Cargo file under crates/<crate>/tests/ runs `cargo test --test <stem>`.
# node:test files only need node. Skip when the PR has the label no-red-check.

set -u

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

gh_args=(pr view)
if [ -n "${PR_NUMBER:-}" ]; then
  gh_args+=("$PR_NUMBER")
fi
if [ -n "${PR_REPO:-}" ]; then
  gh_args+=(--repo "$PR_REPO")
fi
gh_args+=(--json labels --jq '.labels[].name')
if labels=$(gh "${gh_args[@]}" 2>/dev/null); then
  if printf '%s\n' "$labels" | grep -qx 'no-red-check'; then
    echo 'verify-red: skip (label no-red-check)'
    exit 0
  fi
fi

BASE=${HYGIENE_BASE:-origin/v1-alpha}
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  git fetch --no-tags origin v1-alpha:refs/remotes/origin/v1-alpha
fi

files=()
names=$(git diff --name-only --diff-filter=AMR "$BASE...HEAD") || {
  echo 'verify-red: git diff failed' >&2
  exit 2
}
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    *.test.mjs | *.test.js | *.test.cjs | *.test.ts | *.test.tsx | *.test.mts | *.spec.ts | *.spec.tsx | *.spec.mjs | *.spec.js | *_test.rs | *.test.rs)
      if [ -f "$ROOT/$f" ]; then
        files+=("$f")
      fi
      ;;
  esac
done <<EOF
$names
EOF

if [ "${#files[@]}" -eq 0 ]; then
  echo 'verify-red: no changed test files'
  exit 0
fi

echo "verify-red: extra worktree of $BASE (${#files[@]} test file group(s))"

WT=$(mktemp -d /tmp/gwen-verify-red.XXXXXX)
rmdir "$WT"
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$WT"
}
trap cleanup EXIT

if ! git -C "$ROOT" worktree add --detach "$WT" "$BASE"; then
  echo 'verify-red: worktree add failed' >&2
  exit 2
fi

installed=0
built=0
not_red=0

package_dir() {
  local rel="$1"
  local dir="$WT/$(dirname "$rel")"
  while true; do
    if [ -f "$dir/package.json" ]; then
      if [ "$dir" = "$WT" ]; then
        printf '%s' '.'
      else
        printf '%s' "${dir#"$WT"/}"
      fi
      return 0
    fi
    if [ "$dir" = "$WT" ] || [ "$dir" = "/" ]; then
      return 1
    fi
    dir=$(dirname "$dir")
  done
}

ensure_js() {
  if [ "$installed" -eq 0 ]; then
    echo 'verify-red: pnpm install --frozen-lockfile in the base worktree'
    if ! (cd "$WT" && pnpm install --frozen-lockfile); then
      echo 'verify-red: install failed' >&2
      exit 2
    fi
    installed=1
  fi
  if [ "$built" -eq 0 ]; then
    echo 'verify-red: pnpm build:ts in the base worktree'
    if ! (cd "$WT" && pnpm build:ts); then
      echo 'verify-red: build:ts failed' >&2
      exit 2
    fi
    built=1
  fi
}

for f in "${files[@]}"; do
  mkdir -p "$WT/$(dirname "$f")"
  cp "$ROOT/$f" "$WT/$f"
  echo "verify-red: group $f"
  code=0
  case "$f" in
    *.test.mjs | *.test.cjs | *.test.js | *.spec.mjs | *.spec.js)
      if grep -E -q "from ['\"]vitest['\"]|require\\(['\"]vitest['\"]\\)" "$WT/$f"; then
        ensure_js
        if ! pkg=$(package_dir "$f"); then
          echo "verify-red: no package.json for $f" >&2
          exit 2
        fi
        rel="$f"
        if [ "$pkg" != "." ]; then
          rel=${f#"$pkg"/}
        fi
        (cd "$WT/$pkg" && pnpm exec vitest run "$rel")
        code=$?
      else
        (cd "$WT" && node --test "$f")
        code=$?
      fi
      ;;
    *.test.ts | *.test.tsx | *.test.mts | *.spec.ts | *.spec.tsx)
      ensure_js
      if ! pkg=$(package_dir "$f"); then
        echo "verify-red: no package.json for $f" >&2
        exit 2
      fi
      rel="$f"
      if [ "$pkg" != "." ]; then
        rel=${f#"$pkg"/}
      fi
      (cd "$WT/$pkg" && pnpm exec vitest run "$rel")
      code=$?
      ;;
    *_test.rs | *.test.rs)
      crate_dir=$(printf '%s\n' "$f" | awk -F/ 'NF >= 2 { print $1 "/" $2; exit }')
      stem=$(basename "$f" .rs)
      if [ -z "$crate_dir" ] || [ ! -f "$WT/$crate_dir/Cargo.toml" ]; then
        echo "verify-red: no Cargo.toml for $f" >&2
        exit 2
      fi
      (cd "$WT" && cargo test --manifest-path "$crate_dir/Cargo.toml" --test "$stem")
      code=$?
      ;;
    *)
      echo "verify-red: no runner for $f" >&2
      exit 2
      ;;
  esac
  if [ "$code" -eq 0 ]; then
    echo "verify-red: NOT RED $f (passed on $BASE)"
    not_red=$((not_red + 1))
  else
    echo "verify-red: RED $f (exit $code)"
  fi
done

if [ "$not_red" -ne 0 ]; then
  echo "verify-red: $not_red group(s) were not red"
  exit 1
fi
echo 'verify-red: every changed test group failed on the base'
exit 0
