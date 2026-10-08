#!/usr/bin/env bash
# Copy the PR's changed test files onto a detached worktree of the PR base
# and require each NEW test name to fail there. A name is the describe path
# plus the title. A name that already exists in the base copy of the same file
# may pass (KEEP, with a warning). A dynamic title (template with ${}, it.each
# placeholder, variable) is matched as a pattern; it may pass only when the
# base copy has the same title. A NEW name that the runner never reports, and a
# passing runner name that matches no source name (renamed or aliased runner,
# test.extend), fail the check. A file with no new name prints KEEP-ONLY.
# A file with no describe/it/test call (tests built by a helper) is skipped
# with a warning. In a file with its own calls, a passing name the scan cannot
# place blocks, unless the base copy of the file, run on the base, passes it
# too (an old test a helper registers): then it warns. Those are the limits of
# this check.
#
# A file that does not load on the base (it imports a module the PR adds) is
# run on this checkout too: when it loads here, its new names count red; when
# it fails here as well, it exits 2 (not verifiable).
#
# tests/integration-wasm runs with vitest.wasm.config.ts when that config and
# a packages/core/wasm/**/gwen_core_bg.wasm artifact are present. The untracked
# packages/*/wasm and packages/*/build-tools directories are copied from this
# checkout (CI: the verify-red job downloads them from the rust job). A new
# test name with no config or no artifact exits 2 (not verifiable). A file
# whose names all exist on the base, and that cannot run, warns and continues.
#
# Cost: an extra git worktree. A Vitest file also runs
# `pnpm install --frozen-lockfile` once in that worktree. Nothing is built:
# the Vitest configs alias @gwenjs/* to their sources (vitest.aliases.ts).
# A Cargo integration test (crates/<crate>/tests/<stem>.rs) runs
# `cargo test -p <crate> --test <stem>`; when it does not compile on the base
# (it uses an API the PR adds) it is a load error, run on the head as above.
# A Cargo group whose new tests are all #[wasm_bindgen_test] or
# cfg(target_arch = "wasm32"), or that runs 0 tests natively on the base and
# on the head, prints KEEP-ONLY (not verifiable natively) and does not block.
# Each tree builds in its own Cargo target dir.
# Any other changed .rs file whose diff adds a #[test] function (inline
# #[cfg(test)] tests, *_test.rs modules) cannot be run by test name: it prints
# KEEP-ONLY (not verifiable) and does not block.
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

# crates/<crate>/tests/<stem>.rs: a Cargo integration test target.
is_cargo_test() {
  [[ "$1" =~ ^crates/[^/]+/tests/[^/]+\.rs$ ]]
}

files=()
names=$(git diff --name-only --diff-filter=AMR "$BASE...HEAD") || {
  echo 'verify-red: git diff failed' >&2
  exit 2
}
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    *.test.mjs | *.test.js | *.test.cjs | *.test.ts | *.test.tsx | *.test.mts | *.spec.ts | *.spec.tsx | *.spec.mjs | *.spec.js)
      if [ -f "$ROOT/$f" ]; then
        files+=("$f")
      fi
      ;;
    *.rs)
      [ -f "$ROOT/$f" ] || continue
      if is_cargo_test "$f"; then
        files+=("$f")
      elif case "$f" in *_test.rs | *.test.rs) true ;; *) false ;; esac ||
        git diff "$BASE...HEAD" -- "$f" | grep -v '^+++' | grep -qE '^\+.*#\[(tokio::)?(test|wasm_bindgen_test|rstest|test_case)\b'; then
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

# Build outputs are not tracked. Copy the ones this checkout has (the CI job
# downloads them from the rust job) so the base runs with the same artifacts
# and a missing artifact never looks like a red test.
for artifact in "$ROOT"/packages/*/wasm "$ROOT"/packages/*/build-tools; do
  [ -d "$artifact" ] || continue
  rel_artifact=${artifact#"$ROOT"/}
  [ -e "$WT/$rel_artifact" ] && continue
  mkdir -p "$WT/$rel_artifact"
  cp -R "$artifact/." "$WT/$rel_artifact/"
done
if [ ! -f "$WT/packages/core/vitest.wasm.config.ts" ] && [ -f "$ROOT/packages/core/vitest.wasm.config.ts" ]; then
  mkdir -p "$WT/packages/core"
  cp "$ROOT/packages/core/vitest.wasm.config.ts" "$WT/packages/core/vitest.wasm.config.ts"
fi

installed=0
head_installed=0
not_red=0
skipped=0
keep_only=0

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

# pnpm install once per tree: the base worktree always, this checkout only
# when a base load failure needs a head run and it has no node_modules.
ensure_js() {
  local tree="$1"
  if [ "$tree" = "$WT" ]; then
    [ "$installed" -eq 1 ] && return 0
    installed=1
  else
    [ "$head_installed" -eq 1 ] && return 0
    head_installed=1
    [ -d "$tree/node_modules" ] && return 0
  fi
  echo "verify-red: pnpm install --frozen-lockfile in $tree"
  if ! (cd "$tree" && pnpm install --frozen-lockfile); then
    echo 'verify-red: install failed' >&2
    exit 2
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

# run_tests <tree> <file> <report> <log>: run one test file inside <tree>
# (the base worktree or this checkout). Sets $format.
run_tests() {
  local tree="$1"
  local f="$2"
  local out="$3"
  local log="$4"
  local pkg rel crate_dir stem crate
  case "$f" in
    *.test.mjs | *.test.cjs | *.test.js | *.spec.mjs | *.spec.js)
      if ! is_vitest_file "$ROOT/$f"; then
        (cd "$tree" && node --test --test-reporter=tap "$f") >"$out" 2>&1 || true
        cat "$out" >"$log"
        format=tap
        return 0
      fi
      ;;
    *.test.ts | *.test.tsx | *.test.mts | *.spec.ts | *.spec.tsx) ;;
    *.rs)
      crate_dir=$(printf '%s\n' "$f" | awk -F/ 'NF >= 2 { print $1 "/" $2; exit }')
      stem=$(basename "$f" .rs)
      if [ -z "$crate_dir" ] || [ ! -f "$tree/$crate_dir/Cargo.toml" ]; then
        echo "verify-red: no Cargo.toml for $f" >&2
        exit 2
      fi
      crate=$(awk '/^\[package\]/ { p = 1; next } /^\[/ { p = 0 } p && /^name[[:space:]]*=/ { sub(/^[^"]*"/, ""); sub(/".*$/, ""); print; exit }' "$tree/$crate_dir/Cargo.toml")
      if [ -z "$crate" ]; then
        echo "verify-red: no package name in $crate_dir/Cargo.toml" >&2
        exit 2
      fi
      # One target dir per tree: a shared CARGO_TARGET_DIR would let the head
      # run reuse the test binary built for the base.
      local target="${CARGO_TARGET_DIR:-}"
      if [ "$tree" = "$WT" ]; then
        target="$WT/target"
      fi
      # Plain output: the CI toolchain step sets CARGO_TERM_COLOR=always and
      # the judge reads the Cargo lines as text.
      if [ -n "$target" ]; then
        (cd "$tree" && CARGO_TERM_COLOR=never NO_COLOR=1 CARGO_TARGET_DIR="$target" cargo test --manifest-path "$crate_dir/Cargo.toml" -p "$crate" --test "$stem") >"$out" 2>&1 || true
      else
        (cd "$tree" && env -u CARGO_TARGET_DIR CARGO_TERM_COLOR=never NO_COLOR=1 cargo test --manifest-path "$crate_dir/Cargo.toml" -p "$crate" --test "$stem") >"$out" 2>&1 || true
      fi
      cat "$out" >"$log"
      format=cargo
      return 0
      ;;
    *)
      echo "verify-red: no runner for $f" >&2
      exit 2
      ;;
  esac
  ensure_js "$tree"
  if ! pkg=$(package_dir "$f"); then
    echo "verify-red: no package.json for $f" >&2
    exit 2
  fi
  rel="$f"
  if [ "$pkg" != "." ]; then
    rel=${f#"$pkg"/}
  fi
  : >"$out"
  if [[ "$f" == */tests/integration-wasm/* ]]; then
    (cd "$tree/$pkg" && pnpm exec vitest run --config vitest.wasm.config.ts --reporter=json --outputFile "$out" "$rel") >"$log" 2>&1 || true
  else
    (cd "$tree/$pkg" && pnpm exec vitest run --reporter=json --outputFile "$out" "$rel") >"$log" 2>&1 || true
  fi
  format=vitest
}

# judge_file <file> <base report> <base snapshot> [head report]: prints the
# judge lines and sets $judge_out and $judge_code.
judge_file() {
  local rel="$1"
  local base_report="$2"
  local base_snapshot="$3"
  local head_report="${4:-}"
  local args=(judge --source "$ROOT/$rel" --file "$rel" --format "$format" --report "$base_report")
  if [ -n "$base_snapshot" ]; then
    args+=(--base "$base_snapshot")
  fi
  if [ -n "$head_report" ]; then
    args+=(--head-report "$head_report")
  fi
  if [ -n "$base_run" ]; then
    args+=(--base-run "$base_run")
  fi
  judge_code=0
  judge_out=$(node "$JUDGE" "${args[@]}" 2>&1) || judge_code=$?
  printf '%s\n' "$judge_out"
}

apply_judge() {
  local rel="$1"
  if [ "$judge_code" -eq 2 ] || [ "$judge_code" -eq 3 ]; then
    echo "verify-red: not verifiable $rel"
    exit 2
  fi
  local line
  while IFS= read -r line; do
    case "$line" in
      KEEP\ *)
        echo "::warning::verify-red: $rel keeps ${line#KEEP } without a red proof"
        echo "verify-red: warning $rel keeps ${line#KEEP } (on the base, dynamic, or not run)"
        ;;
      WARN\ *)
        echo "::warning::verify-red: $rel ${line#WARN }"
        echo "verify-red: warning $rel ${line#WARN }"
        ;;
    esac
  done <<JUDGE_LINES
$judge_out
JUDGE_LINES
  if [ "$judge_code" -eq 0 ]; then
    # No new name: nothing was proven red, every name was only kept.
    if [ "$has_new" -eq 0 ]; then
      echo "verify-red: KEEP-ONLY $rel (no new test name)"
      keep_only=$((keep_only + 1))
      return 0
    fi
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
  done <<JUDGE_LINES
$judge_out
JUDGE_LINES
  if [ "$printed" -eq 0 ]; then
    echo "verify-red: NOT RED $rel"
  fi
  not_red=$((not_red + 1))
}

for f in "${files[@]}"; do
  echo "verify-red: group $f"
  case "$f" in
    *.rs)
      if ! is_cargo_test "$f"; then
        # Inline #[cfg(test)] tests run with the whole crate: no per-name run.
        echo "::warning::verify-red: $f adds inline Rust tests; not verifiable by test name"
        echo "verify-red: KEEP-ONLY $f (inline Rust tests: not verifiable by test name)"
        keep_only=$((keep_only + 1))
        continue
      fi
      ;;
  esac
  base_snapshot=""
  if [ -f "$WT/$f" ]; then
    # Keep the file name: the judge picks its scanner from the extension.
    snap_dir=$(mktemp -d "${TMPDIR:-/tmp}/vr-base.XXXXXX")
    base_snapshot="$snap_dir/$(basename "$f")"
    cp "$WT/$f" "$base_snapshot"
  fi
  if ! classified=$(node "$JUDGE" classify --source "$ROOT/$f" ${base_snapshot:+--base "$base_snapshot"} 2>&1); then
    # No describe/it/test call in the file: its tests come from a helper,
    # which this check does not read. Nothing here can be judged.
    echo "::warning::verify-red: $f has no test call to judge"
    echo "verify-red: warning $f has no test call to judge ($classified)"
    skipped=$((skipped + 1))
    [ -n "$base_snapshot" ] && rm -rf "$(dirname "$base_snapshot")"
    continue
  fi
  has_new=0
  if printf '%s\n' "$classified" | grep -q '^NEW '; then
    has_new=1
  fi
  if is_cargo_test "$f" && [ "$has_new" -eq 0 ] && printf '%s\n' "$classified" | grep -q '^NEW-WASM '; then
    # Every new test is #[wasm_bindgen_test] or cfg(target_arch = "wasm32"):
    # a native cargo run never reports it.
    echo "::warning::verify-red: $f adds wasm-only Rust tests; not verifiable natively"
    echo "verify-red: KEEP-ONLY $f (wasm-only Rust tests: not verifiable natively)"
    keep_only=$((keep_only + 1))
    [ -n "$base_snapshot" ] && rm -rf "$(dirname "$base_snapshot")"
    continue
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
  report=$(mktemp)
  format=""
  base_run=""
  head_report=""
  run_tests "$WT" "$f" "$report" "$log"
  cat "$log"
  judge_file "$f" "$report" "$base_snapshot"
  if [ "$judge_code" -eq 3 ] || [ "$judge_code" -eq 4 ]; then
    # The file does not load on the base (for example it imports a module
    # this PR adds). Run it on this checkout: when it loads here, every new
    # name it reports counts red; when it fails here too, it needs something
    # neither tree has (a WASM build) and is not verifiable. Exit 4: a Cargo
    # target that runs no test on the base; 0 tests on the head too is 5.
    echo "verify-red: $f does not load or runs no test on the base; running it on the head"
    head_report=$(mktemp)
    run_tests "$ROOT" "$f" "$head_report" "$log"
    cat "$log"
    judge_file "$f" "$report" "$base_snapshot" "$head_report"
  fi
  if [ "$judge_code" -eq 1 ] && [ -n "$base_snapshot" ] &&
    printf '%s\n' "$judge_out" | grep -q '(runner name not in source)$'; then
    # A passing name the scan cannot place: run the base copy on the base.
    # A name that passes there too is an old test (a helper's) and only warns.
    echo "verify-red: $f has passing names outside the source; running the base copy on the base"
    base_run=$(mktemp)
    cp "$base_snapshot" "$WT/$f"
    run_tests "$WT" "$f" "$base_run" "$log"
    cp "$ROOT/$f" "$WT/$f"
    judge_file "$f" "$report" "$base_snapshot" "$head_report"
    rm -f "$base_run"
  fi
  [ -n "$head_report" ] && rm -f "$head_report"
  if [ "$judge_code" -eq 5 ]; then
    echo "::warning::verify-red: $f runs no test natively on the base or the head; not verifiable"
    echo "verify-red: KEEP-ONLY $f (no test runs natively on the base or the head)"
    keep_only=$((keep_only + 1))
    rm -f "$log" "$report"
    [ -n "$base_snapshot" ] && rm -rf "$(dirname "$base_snapshot")"
    continue
  fi
  apply_judge "$f"
  rm -f "$log" "$report"
  if [ -n "$base_snapshot" ]; then
    rm -rf "$(dirname "$base_snapshot")"
  fi
done

if [ "$not_red" -ne 0 ]; then
  echo "verify-red: $not_red group(s) were not red"
  exit 1
fi
if [ "$skipped" -ne 0 ]; then
  echo "verify-red: $skipped group(s) were not verifiable and were not counted red"
fi
if [ "$keep_only" -ne 0 ]; then
  echo "verify-red: $keep_only group(s) had no new test name (KEEP-ONLY)"
  echo 'verify-red: every checked group with a new test name failed on the base'
  exit 0
fi
echo 'verify-red: every checked test group failed on the base'
exit 0
