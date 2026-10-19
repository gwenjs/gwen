#!/bin/bash
# Read one toolchain pin from wasm-size.json. The caller sets PROJECT_ROOT.

read_pin() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["toolchain"][sys.argv[2]])' \
    "$PROJECT_ROOT/wasm-size.json" "$1"
}
