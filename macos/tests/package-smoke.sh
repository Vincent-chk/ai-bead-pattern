#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'pkill -f "$tmp/output/AI拼豆图纸.app/Contents/Resources/app/server/server.js" 2>/dev/null || true; rm -rf "$tmp"' EXIT
mkdir -p "$tmp/source/server" "$tmp/source/dist"
printf '{"type":"module"}\n' > "$tmp/source/package.json"
printf 'hello' > "$tmp/source/dist/index.html"
cat > "$tmp/source/server/server.js" <<'SERVER'
import http from 'node:http';
import fs from 'node:fs';
const server = http.createServer((req, res) => res.end(fs.readFileSync(process.env.BEAD_STATIC_DIR + '/index.html')));
server.listen(0, '127.0.0.1', () => { fs.writeFileSync(process.env.TMPDIR + '/bead-smoke-port', String(server.address().port)); console.log(server.address().port); });
SERVER
BEAD_SOURCE_DIR="$tmp/source" BEAD_OUTPUT_DIR="$tmp/output" NODE_ARCHIVE="${NODE_ARCHIVE:?set NODE_ARCHIVE}" "$root/scripts/pack-macos.sh"
app="$tmp/output/AI拼豆图纸.app"
TMPDIR="$tmp" "$app/Contents/MacOS/BeadLauncher" &
launcher=$!
for i in {1..100}; do [ -f "$tmp/bead-smoke-port" ] && break; sleep .1; done
port="$(cat "$tmp/bead-smoke-port")"
[ "$(curl -fsS "http://127.0.0.1:$port/")" = hello ]
osascript -e 'tell application id "local.aibeaddrawing.app" to quit'
wait "$launcher"
if curl -fsS --connect-timeout 1 "http://127.0.0.1:$port/" >/dev/null 2>&1; then echo 'server survived application exit' >&2; exit 1; fi
echo 'macOS package smoke test passed'
