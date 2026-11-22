#!/bin/bash
# Build, then load the merged scripts against a fake game API and try the cases where the
# three add-ons used to step on each other. Proves the logic only: looks need the real game.
cd "$(dirname "$0")/.." || exit 1
python3 build.py >/dev/null || exit 1
T=$(mktemp -d) && trap '/bin/rm -rf "$T"' EXIT
mkdir -p "$T/node_modules" "$T/scripts"
/bin/cp -R test/fake/@minecraft "$T/node_modules/@minecraft"
echo '{"name":"@minecraft/server","type":"module","main":"index.js"}' > "$T/node_modules/@minecraft/server/package.json"
echo '{"type":"module"}' > "$T/package.json"
/bin/cp behavior_pack/scripts/*.js "$T/scripts/" && /bin/cp test/overlap.test.mjs "$T/"
cd "$T" && node overlap.test.mjs
