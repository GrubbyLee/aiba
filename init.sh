#!/bin/bash
set -euo pipefail
AIBA_TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$AIBA_TASK_DIR"
echo "AIBA task state"
git status --short
node -e 'const f=require("./feature_list.json").features; const done=f.filter(x=>x.passes).length; console.log(`Progress: ${done}/${f.length}`); for (const x of f.filter(x=>!x.passes)) console.log(`[${x.id}] pending: ${x.description ?? x.name ?? ""}`)'
test -d node_modules && echo "Dependencies: installed" || echo "Dependencies: run pnpm install"
