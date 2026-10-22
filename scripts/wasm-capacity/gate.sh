#!/usr/bin/env bash
# Wasm capacity gate. Linux only (/proc, ulimit -v).
# Uses the shipped factory. No transform step.
# Writes capacity.json and exits with the judge's code.
set -u
# GWEN_CAPACITY_STAGE_TIMEOUT: per-stage wall-clock seconds (default 600). Timeout exits 124.
STAGE_TIMEOUT="${GWEN_CAPACITY_STAGE_TIMEOUT:-600}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WASM="${1:-packages/core/wasm}"
WORK="$(mktemp -d)"
for v in light physics2d physics3d; do
  mkdir -p "$WORK/$v"
  cp "$WASM/$v/gwen_core_factory.js" "$WASM/$v/gwen_core.js" "$WASM/$v/gwen_core_bg.wasm" "$WORK/$v/" || exit 1
done
printf '%s\n' '{"type":"module"}' > "$WORK/package.json"
for s in max2.mjs start2.mjs det.mjs leak.mjs; do
  cp "$HERE/$s" "$WORK/" || exit 1
done
cd "$WORK"
R="$WORK/results"
mkdir -p "$R"
node -p "process.arch" > "$R/arch.txt"
run() { # name, ulimit-kib|unlimited, node-flags, script args...
  local n="$1" l="$2" f="$3"
  shift 3
  local code t0 SECONDS_STAGE
  echo "wasm-capacity stage $n start" >&2
  t0=$SECONDS
  ( ulimit -v "$l"; exec timeout "$STAGE_TIMEOUT" node $f "$@" ) > "$R/$n.out" 2> "$R/$n.err"
  code=$?
  SECONDS_STAGE=$((SECONDS - t0))
  echo "$code" > "$R/$n.code"
  echo "wasm-capacity stage $n exit=$code seconds=$SECONDS_STAGE" >&2
}
G=$((1024 * 1024))
run unl-default unlimited "" max2.mjs light 40000 1000
run unl-notrap unlimited "--disable-wasm-trap-handler" max2.mjs light 40000 1000
for g in 16 32 64; do
  run "ul$g-default" $((g * G)) "" max2.mjs light 40000 1
  run "ul$g-notrap" $((g * G)) "--disable-wasm-trap-handler" max2.mjs light 40000 25
done
for v in light physics2d physics3d; do
  run "start-$v" unlimited "" start2.mjs "$v" 1000
done
run det unlimited "" det.mjs
run leak64 $((64 * G)) "" leak.mjs 3000
node "$HERE/judge.mjs" "$R" > capacity.json
code=$?
cat capacity.json
cp capacity.json "${GITHUB_WORKSPACE:-.}/capacity.json" 2>/dev/null
echo "wasm-capacity total seconds=$SECONDS" >&2
exit "$code"
