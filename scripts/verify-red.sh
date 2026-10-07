#!/usr/bin/env bash
# Copy the PR's changed test files onto a detached worktree of the PR base
# and require each NEW test name to fail there. A name that already exists in
# the base copy of the same file may pass (KEEP, with a warning). That is the
# limit of this check.
#
# tests/integration-wasm runs with vitest.wasm.config.ts when that config and
# a packages/core/wasm/**/gwen_core_bg.wasm artifact are present. The artifact
# is copied from this checkout when the base commit does not have it. A new
# test name with no config or no artifact exits 2 (not verifiable). A file
# whose names all exist on the base, and that cannot run, warns and continues.
#
# Cost: an extra git worktree. A Vitest file also runs
# `pnpm install --frozen-lockfile` once in that worktree. Nothing is built:
# the Vitest configs alias @gwenjs/* to their sources (vitest.aliases.ts).
# A Cargo file under crates/<crate>/tests/ runs `cargo test --test <stem>`.
# node:test files only need node. Skip when the PR has the label no-red-check.

set -u

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JUDGE="$SCRIPT_DIR/verify-red-judge.mjs"

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

if [ -d "$ROOT/packages/core/wasm" ]; then
  mkdir -p "$WT/packages/core/wasm"
  cp -R "$ROOT/packages/core/wasm/." "$WT/packages/core/wasm/"
fi
if [ ! -f "$WT/packages/core/vitest.wasm.config.ts" ] && [ -f "$ROOT/packages/core/vitest.wasm.config.ts" ]; then
  mkdir -p "$WT/packages/core"
  cp "$ROOT/packages/core/vitest.wasm.config.ts" "$WT/packages/core/vitest.wasm.config.ts"
fi

installed=0
not_red=0
skipped=0

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
}

# A .mjs/.js file is Vitest when it imports vitest at the top level, not when
# a string inside it mentions vitest.
is_vitest_file() {
  node "$JUDGE" is-vitest --source "$1"
}

wasm_runnable() {
  local pkg="$1"
  local config="$WT/$pkg/vitest.wasm.config.ts"
  if [ "$pkg" = "." ]; then
    config="$WT/vitest.wasm.config.ts"
  fi
  [ -f "$config" ] || return 1
  find "$WT/packages/core/wasm" -name 'gwen_core_bg.wasm' -type f -print -quit 2>/dev/null | grep -q .
}

apply_judge() {
  local rel="$1"
  local format="$2"
  local report="$3"
  local base_snapshot="$4"
  local judge_out judge_code
  if [ -n "$base_snapshot" ]; then
    judge_out=$(node "$JUDGE" judge --source "$ROOT/$rel" --base "$base_snapshot" --format "$format" --report "$report" 2>&1) || judge_code=$?
  else
    judge_out=$(node "$JUDGE" judge --source "$ROOT/$rel" --format "$format" --report "$report" 2>&1) || judge_code=$?
  fi
  judge_code=${judge_code:-0}
  printf '%s\n' "$judge_out"
  if [ "$judge_code" -eq 2 ]; then
    echo "verify-red: not verifiable $rel"
    exit 2
  fi
  local line
  while IFS= read -r line; do
    case "$line" in
      KEEP\ *)
        echo "::warning::verify-red: $rel keeps a base test that passed: ${line#KEEP }"
        echo "verify-red: warning $rel keeps ${line#KEEP } (name already on the base)"
        ;;
    esac
  done <<EOF
$judge_out
EOF
  if [ "$judge_code" -eq 0 ]; then
    echo "verify-red: RED $rel"
    return 0
  fi
  local printed=0
  while IFS= read -r line; do
    case "$line" in
      PASS\ *)
        echo "verify-red: NOT RED $rel :: ${line#PASS }"
        printed=1
        ;;
      ABSENT\ *)
        echo "verify-red: NOT RED $rel :: ${line#ABSENT } (new name not run)"
        printed=1
        ;;
    esac
  done <<EOF
$judge_out
EOF
  if [ "$printed" -eq 0 ]; then
    echo "verify-red: NOT RED $rel"
  fi
  not_red=$((not_red + 1))
}

for f in "${files[@]}"; do
  echo "verify-red: group $f"
  base_snapshot=""
  if [ -f "$WT/$f" ]; then
    base_snapshot=$(mktemp)
    cp "$WT/$f" "$base_snapshot"
  fi
  classified=$(node "$JUDGE" classify --source "$ROOT/$f" ${base_snapshot:+--base "$base_snapshot"} 2>&1) || {
    echo "verify-red: not verifiable $f"
    echo "$classified"
    exit 2
  }
  has_new=0
  if printf '%s\n' "$classified" | grep -q '^NEW '; then
    has_new=1
  fi

  case "$f" in
    */tests/integration-wasm/*)
      pkg=""
      if pkg=$(package_dir "$f"); then
        :
      else
        pkg=""
      fi
      runnable=1
      if [ -z "$pkg" ] || ! wasm_runnable "$pkg"; then
        runnable=0
      fi
      if [ "$runnable" -eq 0 ]; then
        if [ "$has_new" -eq 1 ]; then
          echo "verify-red: not verifiable $f (wasm config or artifact missing)"
          exit 2
        fi
        echo "::warning::verify-red: $f wasm is not verifiable; every test name already exists on the base"
        echo "verify-red: warning $f wasm not verifiable, names already on the base"
        skipped=$((skipped + 1))
        continue
      fi
      ;;
  esac

  mkdir -p "$WT/$(dirname "$f")"
  cp "$ROOT/$f" "$WT/$f"
  log=$(mktemp)
  report="$log"
  format=""
  case "$f" in
    *.test.mjs | *.test.cjs | *.test.js | *.spec.mjs | *.spec.js)
      if is_vitest_file "$WT/$f"; then
        ensure_js
        if ! pkg=$(package_dir "$f"); then
          echo "verify-red: no package.json for $f" >&2
          exit 2
        fi
        rel="$f"
        if [ "$pkg" != "." ]; then
          rel=${f#"$pkg"/}
        fi
        report=$(mktemp)
        (cd "$WT/$pkg" && pnpm exec vitest run --reporter=json --outputFile "$report" "$rel") >"$log" 2>&1 || true
        format=vitest
      else
        (cd "$WT" && node --test --test-reporter=tap "$f") >"$log" 2>&1 || true
        format=tap
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
      report=$(mktemp)
      if [[ "$f" == */tests/integration-wasm/* ]]; then
        (cd "$WT/$pkg" && pnpm exec vitest run --config vitest.wasm.config.ts --reporter=json --outputFile "$report" "$rel") >"$log" 2>&1 || true
      else
        (cd "$WT/$pkg" && pnpm exec vitest run --reporter=json --outputFile "$report" "$rel") >"$log" 2>&1 || true
      fi
      format=vitest
      ;;
    *_test.rs | *.test.rs)
      crate_dir=$(printf '%s\n' "$f" | awk -F/ 'NF >= 2 { print $1 "/" $2; exit }')
      stem=$(basename "$f" .rs)
      if [ -z "$crate_dir" ] || [ ! -f "$WT/$crate_dir/Cargo.toml" ]; then
        echo "verify-red: no Cargo.toml for $f" >&2
        exit 2
      fi
      (cd "$WT" && cargo test --manifest-path "$crate_dir/Cargo.toml" --test "$stem") >"$log" 2>&1 || true
      format=cargo
      ;;
    *)
      echo "verify-red: no runner for $f" >&2
      exit 2
      ;;
  esac
  cat "$log"
  apply_judge "$f" "$format" "$report" "$base_snapshot"
  rm -f "$log"
  if [ "$report" != "$log" ]; then
    rm -f "$report"
  fi
  if [ -n "$base_snapshot" ]; then
    rm -f "$base_snapshot"
  fi
done

if [ "$not_red" -ne 0 ]; then
  echo "verify-red: $not_red group(s) were not red"
  exit 1
fi
if [ "$skipped" -ne 0 ]; then
  echo "verify-red: $skipped group(s) were not verifiable and were not counted red"
fi
echo 'verify-red: every checked test group failed on the base'
exit 0
