#!/usr/bin/env python3
"""Make the flat test world "Mega Mod" by copying the flat template world:
grass surface, creative mode (every item is at hand to combine), cheats on,
the merged packs at the current version (run build.py first).

  make_world.py

Writes minecraftWorlds/megamod_lab (replacing an earlier one) and marks it as
played just now, so it is the top world in the game's list. Only run with the
game closed. The template's chunks are dropped, so the world starts empty.
"""
import json, os, shutil, struct, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "machines", "tools"))  # nbt.py lives there
import nbt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORLDS = os.path.expanduser("~/Library/Application Support/mcpelauncher/games/com.mojang/minecraftWorlds")
TEMPLATE = "ez1BFp4Wx4Y="
LAYERS = [("bedrock", 1), ("stone", 34), ("dirt", 6), ("grass_block", 1)]


def main():
    if subprocess.run(["pgrep", "-f", "mcpelauncher-client"], capture_output=True).returncode == 0:
        sys.exit("The game is running; not touching worlds.")
    dst = os.path.join(WORLDS, "megamod_lab")
    if os.path.isdir(dst):
        shutil.rmtree(dst)
    shutil.copytree(os.path.join(WORLDS, TEMPLATE), dst)
    # Drop the template's chunks and players, so the world starts empty: the designer
    # found the template's old builds annoying. The game makes a new db on first load.
    shutil.rmtree(os.path.join(dst, "db"))
    os.mkdir(os.path.join(dst, "db"))
    raw = open(os.path.join(dst, "level.dat"), "rb").read()
    version = struct.unpack("<i", raw[:4])[0]
    r = nbt.Reader(raw[8:], little=True, typed=True)
    t = r.num("b"); r.string()
    d = r.payload(t)
    name = "Mega Mod"
    d["LevelName"] = name
    d["FlatWorldLayers"] = json.dumps({
        "biome_id": 1,
        "block_layers": [{"block_name": "minecraft:" + b, "count": n} for b, n in LAYERS],
        "encoding_version": 6, "world_version": "version.post_1_18"}, separators=(",", ":")) + "\n"
    d["LastPlayed"] = nbt.L(int(time.time()))
    d["GameType"] = nbt.I(1)
    d["Difficulty"] = nbt.I(2)
    d["commandsEnabled"] = nbt.B(1)
    d["cheatsEnabled"] = nbt.B(1)
    w = nbt.Writer(True)
    w.num("b", nbt.COMPOUND); w.string(""); w.payload(d)
    body = b"".join(w.out)
    open(os.path.join(dst, "level.dat"), "wb").write(struct.pack("<ii", version, len(body)) + body)
    open(os.path.join(dst, "levelname.txt"), "w").write(name)
    for kind in ("behavior", "resource"):
        heads = [json.load(open(os.path.join(ROOT, f"{kind}_pack", "manifest.json")))["header"]]
        json.dump([{"pack_id": h["uuid"], "version": h["version"]} for h in heads], open(os.path.join(dst, f"world_{kind}_packs.json"), "w"))
        shutil.rmtree(os.path.join(dst, f"{kind}_packs"), ignore_errors=True)
    print(f"made '{name}' in megamod_lab")


if __name__ == "__main__":
    main()
