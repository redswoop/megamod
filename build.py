#!/usr/bin/env python3
"""Merge the designer's three add-ons into one behavior pack and one resource pack,
and write MegaMod.mcaddon.

  python3 build.py

Reads ../boom-hammer, ../impossible-mode and ../machines (never writes there) and
rewrites behavior_pack/ and resource_pack/ here. Everything in those two folders is
generated: change the add-ons or this file, not them.

What it does beyond copying:
- the three scripts run side by side (scripts/<key>.js), with the few edits in PATCHES
  so they stay out of each other's way;
- monsters whose look more than one add-on replaces (zombie, skeleton, creeper,
  phantom) get one look file and one render controller that knows every name.

It stops with a message, and writes no .mcaddon, if an add-on has changed in a way
the merge doesn't understand.
"""
import copy, glob, hashlib, json, os, re, shutil, subprocess, sys, tempfile, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = "Mega Mod"  # a working name; the designer hasn't picked one
KEY = "megamod"
VERSION = [0, 1, 0]  # bump whenever what is built changes (the build checks, see versions.json)
IDS = {
    "bp": "1d4d065c-b0c5-4fc9-a63a-817770cdfa70", "script": "1d0cc0b7-7a30-4e82-81df-4f7b168f0381",
    "rp": "ebbead89-e186-4137-ae09-93221a7fb814", "resources": "9d989250-277d-4978-8702-b62130646108",
}
# key (the script's file name), folder, name. The order is the order the scripts load in;
# machines is last because its starter kit is the one that drops what doesn't fit.
SOURCES = [("boomhammer", "boom-hammer", "Boom Hammer"), ("impossible", "impossible-mode", "Impossible Mode"), ("machines", "machines", "Mutant Machines")]
BASE = "machines"  # its look files are the base for shared monsters: they carry the mutant size
COMBINER = "machines:combiner"

GIVE_OLD = "  player.getComponent(\"minecraft:inventory\").container.addItem(new ItemStack(id, amount));\n"
GIVE_NEW = ("  const left = player.getComponent(\"minecraft:inventory\").container.addItem(new ItemStack(id, amount));\n"
            "  if (left) player.dimension.spawnItem(left, player.location); // [merged] three starter kits don't fit in one inventory\n")
# (script, text that must be there exactly once, replacement). Each keeps an add-on doing
# what it does alone when the other two are in the same world.
PATCHES = [
    # A zombie that already is somebody (a Lightning House's Lightning Zombie, a Mutant
    # Zombie made indoors) is not turned into a Dark Zombie for having a roof over it.
    ("impossible", "if (zombie.isValid && inCave(zombie)) darken(zombie);",
     "if (zombie.isValid && !zombie.nameTag && inCave(zombie)) darken(zombie); // [merged] not one that already has a name"),
    # Tapping the Combiner with the hammer, staff, bow or an egg puts it in; it doesn't go off.
    ("boomhammer", "  if (ev.block.getComponent(\"minecraft:inventory\")) return;\n  ev.cancel = true;\n  const { player, block } = ev;",
     f"  if (ev.block.getComponent(\"minecraft:inventory\")) return;\n  if (ev.block.typeId === \"{COMBINER}\") return; // [merged] the Combiner takes it\n  ev.cancel = true;\n  const {{ player, block }} = ev;"),
    ("boomhammer", "world.afterEvents.itemUse.subscribe((ev) => {\n",
     "world.afterEvents.itemUse.subscribe((ev) => {\n"
     f"  try {{ if (ev.source.getBlockFromViewDirection({{ maxDistance: 7 }})?.block.typeId === \"{COMBINER}\") return; }} catch {{}} // [merged] the Combiner takes it\n"),
    ("impossible", "  if (ev.block.getComponent(\"minecraft:inventory\")) return; // chests still open\n",
     f"  if (ev.block.getComponent(\"minecraft:inventory\")) return; // chests still open\n  if (ev.block.typeId === \"{COMBINER}\") return; // [merged] the Combiner takes it\n"),
    ("boomhammer", GIVE_OLD, GIVE_NEW),
    ("impossible", GIVE_OLD, GIVE_NEW),
]


def stop(msg):
    sys.exit(f"build.py: {msg}")


def load(path):
    try:
        return json.load(open(path))
    except ValueError as e:
        stop(f"{path}: {e}")


def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, "w"), indent=1, ensure_ascii=False)


def files(root):
    out = []
    for d, _, names in os.walk(root):
        for n in names:
            if n != ".DS_Store":
                out.append(os.path.relpath(os.path.join(d, n), root))
    return sorted(out)


def copy_file(src, dst):
    """Copy, refusing to let two add-ons write different files to one place."""
    if os.path.exists(dst):
        if open(src, "rb").read() != open(dst, "rb").read():
            stop(f"two add-ons both have {os.path.relpath(dst, HERE)} and they differ")
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)


def ternary(expr):
    """'A ? B : C' -> (A, B, C), splitting only outside brackets and quotes. None if it isn't one."""
    depth, quote, q, nested = 0, False, None, 0
    for i, ch in enumerate(expr):
        if ch == "'":
            quote = not quote
        elif quote:
            continue
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and ch == "?":
            if q is None:
                q = i
            else:
                nested += 1
        elif depth == 0 and ch == ":" and q is not None:
            if nested:
                nested -= 1
            else:
                return expr[:q].strip(), expr[q + 1:i].strip(), expr[i + 1:].strip()
    return None


def controllers(folder):
    """Every render controller an add-on defines: id -> (file, body)."""
    out = {}
    for path in sorted(glob.glob(f"{folder}/resource_pack/render_controllers/*.json")):
        for cid, body in load(path)["render_controllers"].items():
            out[cid] = (path, body)
    return out


def controller_ids(desc):
    return [next(iter(e)) if isinstance(e, dict) else e for e in desc["render_controllers"]]


def merge_look(mob, having, src, rp_out, dropped):
    """One client entity file and one render controller for a monster several add-ons restyle.

    The base add-on's file is kept (it has the mutant size). Each other add-on only swaps the
    skin by name, 'is_name_any(...) ? its skin : the plain one', so the merged skin is that
    test in front of whatever the next add-on would have drawn.
    """
    if BASE not in having:
        stop(f"{mob}: restyled by {having} but not by {BASE}; teach merge_look about that")
    base = copy.deepcopy(load(f"{src[BASE]}/resource_pack/entity/{mob}.entity.json"))
    desc = base["minecraft:client_entity"]["description"]
    mine = controllers(src[BASE])
    base_custom = [c for c in controller_ids(desc) if c in mine]
    if len(base_custom) > 1:
        stop(f"{mob}: {BASE} has more than one render controller of its own")
    shell = copy.deepcopy(mine[base_custom[0]][1]) if base_custom else None
    inner = shell["textures"][0] if shell else None
    swaps, at = [], None
    for key in [k for k in having if k != BASE]:
        other = load(f"{src[key]}/resource_pack/entity/{mob}.entity.json")["minecraft:client_entity"]["description"]
        for part in ("geometry", "materials"):
            for k, v in other.get(part, {}).items():
                if desc.get(part, {}).get(k) != v:
                    stop(f"{mob}: {key} changes {part}.{k}; the merge only knows skin swaps")
        for k, v in other["textures"].items():
            if desc["textures"].setdefault(k, v) != v:
                stop(f"{mob}: texture name '{k}' means two things ({key} and another add-on)")
        theirs = controllers(src[key])
        custom = [c for c in controller_ids(other) if c in theirs]
        if len(custom) != 1:
            stop(f"{mob}: expected one render controller of {key}'s own, found {custom}")
        path, body = theirs[custom[0]]
        dropped.add(os.path.relpath(path, f"{src[key]}/resource_pack"))
        if len(body["textures"]) != 1 or not ternary(body["textures"][0]):
            stop(f"{mob}: {key}'s skin isn't 'name ? skin : plain': {body['textures']}")
        cond, special, fallback = ternary(body["textures"][0])
        if "is_name_any" not in cond:
            stop(f"{mob}: {key}'s skin isn't picked by name: {cond}")
        if shell is None:  # the base add-on draws this monster with the game's controller: use this one's
            shell, inner = copy.deepcopy(body), fallback
        else:
            rest = lambda b: {k: v for k, v in b.items() if k not in ("textures", "geometry")}
            if rest(body) != rest(shell):
                stop(f"{mob}: {key}'s render controller differs from the others in more than the skin")
        i = controller_ids(other).index(custom[0])
        if at not in (None, i):
            stop(f"{mob}: the add-ons put their render controller in different places")
        at = i
        swaps.append((cond, special))
    if base_custom:
        dropped.add(os.path.relpath(mine[base_custom[0]][0], f"{src[BASE]}/resource_pack"))
        at = controller_ids(desc).index(base_custom[0])
    expr = inner
    for cond, special in reversed(swaps):
        expr = f"{cond} ? ({special}) : ({expr})"
    shell["textures"] = [expr]
    for kind, table in (("Texture", desc["textures"]), ("Geometry", desc["geometry"]), ("Material", desc["materials"])):
        for ref in re.findall(rf"{kind}\.(\w+)", json.dumps(shell)):
            if ref not in table:
                stop(f"{mob}: the merged render controller uses {kind}.{ref}, which the look file doesn't have")
    cid = f"controller.render.{KEY}_{mob}"
    entry = desc["render_controllers"][at]
    desc["render_controllers"][at] = {cid: next(iter(entry.values()))} if isinstance(entry, dict) else cid
    dump(base, f"{rp_out}/entity/{mob}.entity.json")
    dump({"format_version": "1.8.0", "render_controllers": {cid: shell}}, f"{rp_out}/render_controllers/{KEY}_{mob}.render_controllers.json")
    return expr


def build_resource_pack(src, rp_out, v, parts):
    looks = {}  # file name -> the add-ons that have it
    for key, folder in src.items():
        for f in sorted(glob.glob(f"{folder}/resource_pack/entity/*.json")):
            looks.setdefault(os.path.basename(f), []).append(key)
    dropped, merged = set(), {}
    for name, having in sorted(looks.items()):
        if len(having) > 1:
            mob = name.replace(".entity.json", "")
            merged[mob] = (having, merge_look(mob, having, src, rp_out, dropped))
    atlases = {"textures/item_texture.json": {}, "textures/terrain_texture.json": {}}
    blocks, lang = {}, []
    for key, folder in src.items():
        root = f"{folder}/resource_pack"
        for rel in files(root):
            if rel == "manifest.json" or rel in dropped or rel == "texts/languages.json":
                continue
            if rel.startswith("entity/") and len(looks[os.path.basename(rel)]) > 1:
                continue
            if rel in atlases:
                for k, t in load(f"{root}/{rel}")["texture_data"].items():
                    if atlases[rel].setdefault(k, t) != t:
                        stop(f"{rel}: '{k}' means two things")
            elif rel == "blocks.json":
                for k, b in load(f"{root}/{rel}").items():
                    if blocks.setdefault(k, b) != b:
                        stop(f"blocks.json: '{k}' means two things")
            elif rel == "texts/en_US.lang":
                lang += [l for l in open(f"{root}/{rel}").read().splitlines() if l.strip() and not l.startswith("pack.")]
            elif rel.startswith("texts/"):
                stop(f"{key} has {rel}; the merge only knows en_US")
            else:
                copy_file(f"{root}/{rel}", f"{rp_out}/{rel}")
    names = {"textures/item_texture.json": "atlas.items", "textures/terrain_texture.json": "atlas.terrain"}
    for rel, data in atlases.items():
        if data:
            dump({"resource_pack_name": KEY, "texture_name": names[rel], "texture_data": data}, f"{rp_out}/{rel}")
    if blocks:
        dump(blocks, f"{rp_out}/blocks.json")
    keys = [l.split("=")[0] for l in lang]
    if len(keys) != len(set(keys)):
        stop("en_US.lang: two add-ons name the same thing")
    os.makedirs(f"{rp_out}/texts", exist_ok=True)
    open(f"{rp_out}/texts/en_US.lang", "w").write("\n".join([f"pack.name={NAME}"] + lang) + "\n")
    dump(["en_US"], f"{rp_out}/texts/languages.json")
    s = ".".join(map(str, v))
    dump({"format_version": 2,
          "header": {"name": f"{NAME} {s} (art)", "description": f"Textures for {NAME}: {parts}.", "uuid": IDS["rp"], "version": v, "min_engine_version": [1, 26, 20]},
          "modules": [{"type": "resources", "uuid": IDS["resources"], "version": v}],
          "dependencies": [{"uuid": IDS["bp"], "version": v}]}, f"{rp_out}/manifest.json")
    return merged


def build_behavior_pack(src, bp_out, v, parts):
    s = ".".join(map(str, v))
    engine, api = [], set()
    for key, folder in src.items():
        root = f"{folder}/behavior_pack"
        man = load(f"{root}/manifest.json")
        engine.append(man["header"]["min_engine_version"])
        api |= {(d["module_name"], d["version"]) for d in man["dependencies"] if "module_name" in d}
        for rel in files(root):
            if rel == "manifest.json":
                continue
            if rel.startswith("scripts/"):
                if rel != "scripts/main.js":
                    stop(f"{key} has {rel}; the merge only knows one script per add-on")
                code = open(f"{root}/{rel}").read()
                if re.search(r'from "\.', code):
                    stop(f"{key}'s script imports other files; the merge only knows one script per add-on")
                for who, old, new in PATCHES:
                    if who != key:
                        continue
                    if code.count(old) != 1:
                        stop(f"{key}'s script changed: expected exactly one\n    {old.strip()}\n  (found {code.count(old)}). Update PATCHES.")
                    code = code.replace(old, new)
                os.makedirs(f"{bp_out}/scripts", exist_ok=True)
                open(f"{bp_out}/scripts/{key}.js", "w").write(code)
            else:
                copy_file(f"{root}/{rel}", f"{bp_out}/{rel}")
    if len(api) != 1:
        stop(f"the add-ons need different script APIs: {sorted(api)}")
    imports = "\n".join(f'import {{ VERSION as {key} }} from "./{key}.js";' for key in src)
    said = ", ".join(f"{name} ${{{key}}}" for key, _, name in SOURCES)
    open(f"{bp_out}/scripts/main.js", "w").write(f'''// {NAME}: Boom Hammer, Impossible Mode and Mutant Machines in one pack.
// Written by build.py. Change the add-ons or build.py, not this file.
import {{ world, system }} from "@minecraft/server";
{imports}

export const VERSION = "{s}";

world.afterEvents.playerSpawn.subscribe((ev) => {{
  if (!ev.initialSpawn) return;
  const p = ev.player;
  system.runTimeout(() => {{
    if (p.isValid) p.sendMessage(`§6{NAME} ${{VERSION}}§r is on: {said}.`);
  }}, 50);
}});
''')
    (module, api_version), = api
    dump({"format_version": 2,
          "header": {"name": f"{NAME} {s}", "description": f"{NAME} {s}: {parts}, all in one pack.", "uuid": IDS["bp"], "version": v, "min_engine_version": max(engine)},
          "modules": [{"type": "script", "language": "javascript", "uuid": IDS["script"], "entry": "scripts/main.js", "version": v}],
          "dependencies": [{"module_name": module, "version": api_version}, {"uuid": IDS["rp"], "version": v}]}, f"{bp_out}/manifest.json")


def check(bp_out, rp_out):
    """The same checks the add-ons' own check_pack.py makes, on the merged packs."""
    bad, data = [], {}
    for path in glob.glob(f"{bp_out}/**/*.json", recursive=True) + glob.glob(f"{rp_out}/**/*.json", recursive=True):
        data[path] = load(path)
    art = lambda t: any(os.path.exists(f"{rp_out}/{t}.{ext}") for ext in ("png", "tga"))
    atlas = data.get(f"{rp_out}/textures/item_texture.json", {}).get("texture_data", {})
    terrain = data.get(f"{rp_out}/textures/terrain_texture.json", {}).get("texture_data", {})
    for name, table in (("item_texture.json", atlas), ("terrain_texture.json", terrain)):
        bad += [f"{name}: missing {t['textures']}" for t in table.values() if not art(t["textures"])]
    for path, d in data.items():
        if "/blocks/" in path and "minecraft:block" in d:
            for m in d["minecraft:block"]["components"]["minecraft:material_instances"].values():
                if m["texture"] not in terrain:
                    bad.append(f"{path}: texture {m['texture']} isn't in terrain_texture.json")
        if "/items/" in path and "minecraft:item" in d:
            icon = d["minecraft:item"]["components"]["minecraft:icon"]["textures"]["default"]
            if icon not in atlas:
                bad.append(f"{path}: icon {icon} isn't in item_texture.json")
        if path.endswith(".entity.json"):
            desc = d["minecraft:client_entity"]["description"]
            for t in desc["textures"].values():
                if re.match(r"textures/entity/(%s)/" % "|".join(k for k, _, _ in SOURCES), t) and not art(t):
                    bad.append(f"{path}: missing {t}")
    ids = [d[k]["description"]["identifier"] for d in data.values() for k in ("minecraft:item", "minecraft:block") if k in d]
    bad += [f"two things are called {i}" for i in set(ids) if ids.count(i) > 1]
    node = shutil.which("node")
    if node:
        with tempfile.TemporaryDirectory() as tmp:
            for f in glob.glob(f"{bp_out}/scripts/*.js"):
                m = os.path.join(tmp, os.path.basename(f).replace(".js", ".mjs"))
                shutil.copyfile(f, m)
                r = subprocess.run([node, "--check", m], capture_output=True, text=True)
                if r.returncode:
                    bad.append(f"{f}: {r.stderr.strip()}")
    if bad:
        stop("\n  " + "\n  ".join(bad))
    return len(data), bool(node)


def content_hash(*roots):
    h = hashlib.sha256()
    for root in roots:
        for rel in files(root):
            h.update(rel.encode())
            h.update(open(os.path.join(root, rel), "rb").read())
    return h.hexdigest()[:16]


def main():
    os.chdir(HERE)
    src = {key: os.path.join("..", folder) for key, folder, _ in SOURCES}
    versions = {}
    for key, folder, name in SOURCES:
        if subprocess.run([sys.executable, f"{src[key]}/tools/check_pack.py"], capture_output=True).returncode:
            stop(f"{folder} doesn't pass its own check_pack.py; fix that first")
        versions[key] = ".".join(map(str, load(f"{src[key]}/behavior_pack/manifest.json")["header"]["version"]))
    parts = ", ".join(f"{name} {versions[key]}" for key, _, name in SOURCES)
    for out in ("behavior_pack", "resource_pack"):
        shutil.rmtree(out, ignore_errors=True)
    merged = build_resource_pack(src, "resource_pack", VERSION, parts)
    build_behavior_pack(src, "behavior_pack", VERSION, parts)
    count, node = check("behavior_pack", "resource_pack")

    # A pack is known to the game by its id and version, so different contents need a new version.
    s, digest = ".".join(map(str, VERSION)), content_hash("behavior_pack", "resource_pack")
    seen = load("versions.json") if os.path.exists("versions.json") else {}
    if seen.get(s, digest) != digest:
        stop(f"the packs changed since {NAME} {s} was first built. Bump VERSION in build.py.")
    seen[s] = digest
    json.dump(seen, open("versions.json", "w"), indent=1)

    target = "MegaMod.mcaddon"
    if os.path.exists(target):
        os.remove(target)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for root in ("behavior_pack", "resource_pack"):
            for rel in files(root):
                z.write(os.path.join(root, rel), f"{root}/{rel}")
    print(f"{NAME} {s} = {parts}")
    for mob, (having, expr) in merged.items():
        print(f"  merged look, {mob} ({' + '.join(having)}): {expr}")
    print(f"  {count} JSON files parse, art is all there" + (", scripts parse" if node else ", scripts NOT checked (no node)"))
    print(f"built {target} ({os.path.getsize(target) // 1024} KB)")


if __name__ == "__main__":
    main()
