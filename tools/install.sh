#!/bin/bash
# Build, then install the merged packs into the Mac's Minecraft dev packs and pin every
# world that uses them to this version. Refuses while the game is running.
#   tools/install.sh
cd "$(dirname "$0")/.." || exit 1
M="$HOME/Library/Application Support/mcpelauncher/games/com.mojang"
if pgrep -f "mcpelauncher-[c]lient" >/dev/null; then echo "The game is running; not installing."; exit 1; fi
python3 build.py || exit 1
/bin/rm -rf "$M/development_behavior_packs/MegaMod" "$M/development_resource_packs/MegaMod"
/bin/cp -R behavior_pack "$M/development_behavior_packs/MegaMod"
/bin/cp -R resource_pack "$M/development_resource_packs/MegaMod"
python3 - "$M" <<'PY'
import glob, json, os, sys
M = sys.argv[1]
bp, rp = json.load(open("behavior_pack/manifest.json")), json.load(open("resource_pack/manifest.json"))
ids, version = {bp["header"]["uuid"], rp["header"]["uuid"]}, bp["header"]["version"]
for world in glob.glob(f"{M}/minecraftWorlds/*"):
    for name in ("world_behavior_packs.json", "world_resource_packs.json"):
        path = f"{world}/{name}"
        if not os.path.exists(path):
            continue
        packs = json.load(open(path))
        ours = [p for p in packs if p.get("pack_id") in ids]
        for p in ours:
            p["version"] = version
        if ours:
            json.dump(packs, open(path, "w"), indent=2)
            print("pinned", open(f"{world}/levelname.txt").read().strip(), name, version)
PY
diff -rq behavior_pack "$M/development_behavior_packs/MegaMod" && diff -rq resource_pack "$M/development_resource_packs/MegaMod" \
  && echo "installed $(/usr/bin/grep -o 'VERSION = "[^"]*"' behavior_pack/scripts/main.js)"
