// Impossible Mode: new monsters that make the game really hard.
// Dark Zombie: a zombie that spawns in a cave becomes one. Dark gray with red eyes.
// Fire Pelt: the Phoenix drops it. Hold it and tap an anvil: your armor and sword become fireproof.
// Volcano: a big black cone with lava in the top. Phoenixes come out of it while somebody is near.
// Phoenix: a fire bird (a phantom underneath). It sets you on fire, and comes back to life once.
import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";

export const VERSION = "0.1.15";

const ZOMBIE = "minecraft:zombie";
const DARK_TAG = "impossible_dark_zombie";
const DARK_NAME = "Dark Zombie"; // the black skin is picked by this name (resource_pack/render_controllers)
const DARK_EGG = "impossible:dark_zombie_egg"; // tap the ground with it: a Dark Zombie appears (a test tool that needs no typing)
const FOREVER = 20000000; // ticks; the longest an effect can last
const PHANTOM = "minecraft:phantom";
const PHOENIX_TAG = "impossible_phoenix";
const PHOENIX_REBORN_TAG = "impossible_phoenix_reborn"; // it has already come back once
const PHOENIX_NAME = "Phoenix"; // the fire skin is picked by this name
const PHOENIX_EGG = "impossible:phoenix_egg"; // tap the ground with it: a Phoenix appears above
const PHOENIX_BURN_SECONDS = 5; // how long a player it hits burns
const PHOENIX_REBIRTH_TICKS = 40; // flames where it died, then it is back
const FIRE_PELT = "impossible:fire_pelt"; // a Phoenix drops one each time it dies
const FIREPROOF = "§6Fireproof"; // the lore line that marks a fireproof sword or piece of armor
const ARMOR_SLOTS = [EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet];
const VOLCANO = "impossible:volcano"; // tap the ground with it: a volcano is built in front of you
const VOLCANOES = "impossible:volcanoes"; // world property: a JSON list of { x, y, z, dim }, each volcano's magma core (under the lava)
// 0.1.11 was 15 / 5 / 16. The designer: "Make it way, way, way, way, way bigger."
const VOLCANO_RADIUS = 40; // at the ground
const VOLCANO_TOP = 9; // radius at the rim
const VOLCANO_HEIGHT = 44;
const VOLCANO_RIM = 6; // top layers that are a hollow rim: lava in the lower half, air above
const VOLCANO_CORE_DOWN = VOLCANO_RIM + 1; // layers from the top down to the magma core
const VOLCANO_ROCK = ["minecraft:basalt", "minecraft:blackstone", "minecraft:blackstone", "minecraft:smooth_basalt", "minecraft:deepslate"];
const VOLCANO_PRIZE = "minecraft:ancient_debris"; // the designer: nobody goes there "unless there was a prize"
const VOLCANO_PRIZE_CHANCE = 0.4; // of the rim's top two layers: about 100 on the giant volcano. It was 0.14 of the top layer; the designer: "There should be more ancient debris."
const VOLCANO_CORE = "minecraft:magma"; // a volcano whose core is gone is forgotten
const VOLCANO_NEAR = 80; // blocks: Phoenixes come while a player is this close
const VOLCANO_FIRST_SECONDS = 5; // the first Phoenix comes soon after somebody arrives
const VOLCANO_SECONDS = 30; // then one this often
const VOLCANO_MAX = 3; // not while this many Phoenixes are already around it
const PHOENIX_LEASH = 28; // blocks: a Phoenix farther than this from every player flies back in
const PHOENIX_RETURN_UP = 9; // blocks above the player it comes back at

// It is still a plain zombie underneath: a tag and a name. It doesn't burn (Claude's pick,
// so one made with the egg in daylight lives long enough to look at).
function darken(zombie) {
  if (!zombie.isValid || zombie.hasTag(DARK_TAG)) return;
  zombie.addTag(DARK_TAG);
  zombie.nameTag = DARK_NAME;
  zombie.addEffect("fire_resistance", FOREVER, { showParticles: false });
  zombie.extinguishFire();
}

// "In a cave": in the overworld, with a roof over its head that isn't a tree.
function inCave(zombie) {
  if (zombie.dimension.id !== "minecraft:overworld") return false;
  const { x, y, z } = zombie.location;
  const top = zombie.dimension.getTopmostBlock({ x, z });
  if (!top || top.y <= y + 1) return false;
  return !/leaves|log|wood/.test(top.typeId);
}

world.afterEvents.entitySpawn.subscribe((ev) => {
  const zombie = ev.entity;
  if (!zombie.isValid || zombie.typeId !== ZOMBIE) return;
  system.run(() => {
    try {
      if (zombie.isValid && !zombie.nameTag && inCave(zombie)) darken(zombie); // [merged] not one that already has a name
    } catch (e) {
      console.warn(`Impossible Mode: dark zombie check failed: ${e}`);
    }
  });
});

// A Phoenix is a phantom underneath: a tag and a name. It doesn't burn up in daylight.
function spawnPhoenix(dim, at, reborn = false) {
  const bird = dim.spawnEntity(PHANTOM, at);
  bird.addTag(PHOENIX_TAG);
  if (reborn) bird.addTag(PHOENIX_REBORN_TAG);
  bird.nameTag = PHOENIX_NAME;
  bird.addEffect("fire_resistance", FOREVER, { showParticles: false });
  return bird;
}

function flame(dim, at, spread, count) {
  for (let i = 0; i < count; i++) {
    try {
      dim.spawnParticle("minecraft:basic_flame_particle", { x: at.x + (Math.random() - 0.5) * spread, y: at.y + (Math.random() - 0.5) * spread, z: at.z + (Math.random() - 0.5) * spread });
    } catch {}
  }
}

// What a Phoenix hits catches fire.
world.afterEvents.entityHurt.subscribe((ev) => {
  const by = ev.damageSource.damagingEntity;
  if (!by?.isValid || by.typeId !== PHANTOM || !by.hasTag(PHOENIX_TAG) || !ev.hurtEntity.isValid) return;
  const hurt = ev.hurtEntity;
  // Fireproof gear halves the Phoenix's bite and stops the burning: half the damage is given back at
  // once. (The designer: the Phoenix could still hurt him, "but half damage was okay". This API
  // version can't change the hit itself.)
  if (hurt.typeId === "minecraft:player" && hasFireproof(hurt)) {
    const health = hurt.getComponent("minecraft:health");
    if (health && health.currentValue > 0) health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + ev.damage / 2));
    hurt.extinguishFire();
    hurt.onScreenDisplay.setActionBar("§6Fireproof!§r The Phoenix only does half damage.");
    return;
  }
  hurt.setOnFire(PHOENIX_BURN_SECONDS, true);
});

// A Phoenix drops a Fire Pelt each time it dies (so two in all). The first time it dies, flames burn where it fell and it comes back. The second time it stays dead.
world.afterEvents.entityDie.subscribe((ev) => {
  const dead = ev.deadEntity;
  try {
    if (dead.typeId !== PHANTOM || !dead.hasTag(PHOENIX_TAG)) return;
    const dim = dead.dimension;
    const at = { ...dead.location };
    dim.spawnItem(new ItemStack(FIRE_PELT, 1), at);
    if (dead.hasTag(PHOENIX_REBORN_TAG)) return;
    const burn = system.runInterval(() => flame(dim, at, 1.5, 6), 2);
    system.runTimeout(() => {
      system.clearRun(burn);
      try {
        flame(dim, at, 3, 40);
        spawnPhoenix(dim, at, true);
      } catch (e) {
        console.warn(`Impossible Mode: phoenix rebirth failed: ${e}`);
      }
    }, PHOENIX_REBIRTH_TICKS);
  } catch {}
});

// A Phoenix never gets away: one that has flown too far from every player comes back, above the nearest one.
// (0.1.4: the designer said "sometimes it disappears". Phantoms wander off high and far.)
system.runInterval(() => {
  for (const name of ["overworld", "nether", "the_end"]) {
    const dim = world.getDimension(name);
    const players = dim.getPlayers();
    if (!players.length) continue;
    for (const bird of dim.getEntities({ type: PHANTOM, tags: [PHOENIX_TAG] })) {
      let near = null, best = Infinity;
      for (const p of players) {
        const d = Math.hypot(p.location.x - bird.location.x, p.location.y - bird.location.y, p.location.z - bird.location.z);
        if (d < best) (best = d), (near = p);
      }
      if (best <= PHOENIX_LEASH) continue;
      const turn = Math.random() * Math.PI * 2;
      const to = { x: near.location.x + Math.cos(turn) * 8, y: near.location.y + PHOENIX_RETURN_UP, z: near.location.z + Math.sin(turn) * 8 };
      try {
        bird.teleport(to, { facingLocation: near.location });
        flame(dim, to, 2, 20);
      } catch {}
    }
  }
}, 20);

// A trail of fire behind every Phoenix.
system.runInterval(() => {
  for (const name of ["overworld", "nether", "the_end"]) {
    for (const bird of world.getDimension(name).getEntities({ type: PHANTOM, tags: [PHOENIX_TAG] })) flame(bird.dimension, bird.location, 1.5, 6);
  }
}, 2);

function spawnDark(dim, at) {
  darken(dim.spawnEntity(ZOMBIE, at));
}

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const id = ev.itemStack?.typeId;
  if ((id !== DARK_EGG && id !== PHOENIX_EGG && id !== VOLCANO) || !ev.isFirstEvent) return;
  if (ev.block.getComponent("minecraft:inventory")) return; // chests still open
  if (ev.block.typeId === "machines:combiner") return; // [merged] the Combiner takes it
  ev.cancel = true;
  const at = { x: ev.block.location.x + 0.5, y: ev.block.location.y + 1, z: ev.block.location.z + 0.5 };
  const dim = ev.player.dimension;
  const player = ev.player;
  const ground = { ...ev.block.location };
  system.run(() => {
    if (id === DARK_EGG) return spawnDark(dim, at);
    if (id === VOLCANO) return placeVolcano(player, ground);
    // It flies up and away at once, so say where to look (0.1.3: the designer thought it hadn't spawned).
    spawnPhoenix(dim, { x: at.x, y: at.y + 1, z: at.z });
    flame(dim, { x: at.x, y: at.y + 1, z: at.z }, 2, 40);
    if (player.isValid) {
      player.onScreenDisplay.setTitle("§6Phoenix!", { subtitle: "Look up!", fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 10 });
      player.playSound("mob.blaze.shoot");
    }
  });
});

function isFireproof(item) {
  return !!item && item.getLore().includes(FIREPROOF);
}

function hasFireproof(player) {
  const worn = player.getComponent("minecraft:equippable");
  return [...ARMOR_SLOTS, EquipmentSlot.Mainhand].some((slot) => isFireproof(worn.getEquipment(slot)));
}

function fireproofed(item) {
  item.setLore([...item.getLore(), FIREPROOF]);
  return item;
}

// Holding Fire Pelts and tapping an anvil: each pelt makes one thing fireproof, the armor you wear
// first, then the swords you carry. (The game's own anvil screen can't be given new recipes.)
function forgeFireproof(player, anvil) {
  if (!player.isValid) return;
  const worn = player.getComponent("minecraft:equippable");
  const bag = player.getComponent("minecraft:inventory").container;
  const hand = worn.getEquipment(EquipmentSlot.Mainhand);
  if (!hand || hand.typeId !== FIRE_PELT) return;
  let pelts = hand.amount;
  let made = 0;
  for (const slot of ARMOR_SLOTS) {
    const item = worn.getEquipment(slot);
    if (!pelts || !item || isFireproof(item)) continue;
    worn.setEquipment(slot, fireproofed(item));
    pelts--, made++;
  }
  for (let i = 0; i < bag.size && pelts; i++) {
    const item = bag.getItem(i);
    if (!item || !item.typeId.endsWith("_sword") || isFireproof(item)) continue;
    bag.setItem(i, fireproofed(item));
    pelts--, made++;
  }
  if (!made) {
    player.onScreenDisplay.setActionBar("Wear armor or carry a sword, then tap the anvil with the Fire Pelt.");
    return;
  }
  if (pelts) {
    hand.amount = pelts;
    worn.setEquipment(EquipmentSlot.Mainhand, hand);
  } else worn.setEquipment(EquipmentSlot.Mainhand, undefined);
  player.onScreenDisplay.setTitle("§6Fireproof!", { fadeInDuration: 0, stayDuration: 40, fadeOutDuration: 10 });
  player.playSound("random.anvil_use");
  flame(player.dimension, { x: anvil.x + 0.5, y: anvil.y + 1.2, z: anvil.z + 0.5 }, 1, 30);
}

// Wearing fireproof armor or holding a fireproof sword: fire and lava can't hurt you.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      if (!hasFireproof(player)) continue;
      player.addEffect("fire_resistance", 60, { showParticles: false });
      player.extinguishFire();
    } catch {}
  }
}, 20);

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  if (ev.itemStack?.typeId !== FIRE_PELT || !ev.block.typeId.includes("anvil")) return;
  ev.cancel = true;
  if (!ev.isFirstEvent) return;
  const { player } = ev;
  const anvil = { ...ev.block.location };
  system.run(() => {
    try {
      forgeFireproof(player, anvil);
    } catch (e) {
      console.warn(`Impossible Mode: fireproofing failed: ${e}`);
      if (player.isValid) player.sendMessage(`Fireproofing failed: ${e}`);
    }
  });
});

function volcanoes() {
  try {
    return JSON.parse(world.getDynamicProperty(VOLCANOES) ?? "[]");
  } catch {
    return [];
  }
}

// The cone, layer by layer from the ground up, 800 blocks a tick. `base` is the middle of its
// bottom layer. The top VOLCANO_RIM layers are a hollow rim, with lava in the lower half and room above it.
function* volcanoJob(dim, base) {
  const H = VOLCANO_HEIGHT;
  let n = 0;
  const missed = []; // [at, id] of blocks in ground that wasn't loaded yet
  for (let layer = 0; layer < H; layer++) {
    const r = VOLCANO_RADIUS - ((VOLCANO_RADIUS - VOLCANO_TOP) * layer) / (H - 1);
    const crater = layer >= H - VOLCANO_RIM;
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r + (Math.random() - 0.5)) continue; // a ragged edge
        const at = { x: base.x + dx, y: base.y + layer, z: base.z + dz };
        let id = VOLCANO_ROCK[Math.floor(Math.random() * VOLCANO_ROCK.length)];
        if (crater && d <= r - 2.5) id = layer < H - VOLCANO_RIM / 2 ? "minecraft:lava" : "minecraft:air";
        else if (layer >= H - 2 && Math.random() < VOLCANO_PRIZE_CHANCE) id = VOLCANO_PRIZE; // the prize, on the rim
        else if (layer > H * 0.6 && Math.random() < 0.12) id = "minecraft:magma";
        if (layer === H - VOLCANO_CORE_DOWN && dx === 0 && dz === 0) id = VOLCANO_CORE;
        try {
          dim.setBlockType(at, id);
        } catch {
          missed.push([at, id]);
        }
        if (++n % 800 === 0) yield;
      }
    }
  }
  system.runJob(volcanoFinish(dim, base, missed, 0));
}

// 0.1.13 left flat sides where the far chunks hadn't loaded in time (the designer: "kind of flat on
// the edges because it was in multiple chunks"). So the blocks that couldn't be set are tried again,
// once a second, until all are in or 60 s have passed.
function* volcanoFinish(dim, base, missed, round) {
  const H = VOLCANO_HEIGHT;
  const still = [];
  let n = 0;
  for (const [at, id] of missed) {
    try {
      dim.setBlockType(at, id);
    } catch {
      still.push([at, id]);
    }
    if (++n % 800 === 0) yield;
  }
  if (still.length && round < 60) {
    system.runTimeout(() => system.runJob(volcanoFinish(dim, base, still, round + 1)), 20);
    return;
  }
  if (still.length) console.warn(`Impossible Mode: volcano left ${still.length} blocks unbuilt`);
  const core = { x: base.x, y: base.y + H - VOLCANO_CORE_DOWN, z: base.z, dim: dim.id };
  world.setDynamicProperty(VOLCANOES, JSON.stringify([...volcanoes(), core]));
  flame(dim, { x: base.x + 0.5, y: base.y + H + 1, z: base.z + 0.5 }, 6, 60);
  try {
    dim.runCommand("tickingarea remove impossible_volcano");
  } catch {}
}

// Built away from the player, so nobody is buried: its near edge is 3 blocks past the tapped block.
function placeVolcano(player, ground) {
  if (!player.isValid) return;
  const dir = player.getViewDirection();
  const far = VOLCANO_RADIUS + 3;
  const step = Math.abs(dir.x) > Math.abs(dir.z) ? { x: Math.sign(dir.x) * far, z: 0 } : { x: 0, z: Math.sign(dir.z) * far };
  const base = { x: ground.x + step.x, y: ground.y + 1, z: ground.z + step.z };
  player.onScreenDisplay.setTitle("§cVolcano!", { subtitle: "Phoenixes live here", fadeInDuration: 0, stayDuration: 50, fadeOutDuration: 10 });
  player.playSound("random.explode");
  // Its far side is past the ground the game keeps loaded around a player, so load it first.
  const dim = player.dimension;
  try {
    dim.runCommand("tickingarea remove impossible_volcano");
  } catch {}
  try {
    dim.runCommand(`tickingarea add circle ${base.x} ${base.y} ${base.z} 4 impossible_volcano`);
  } catch (e) {
    console.warn(`Impossible Mode: volcano ticking area failed: ${e}`);
  }
  // Start once the four far edges are loaded, or after 10 s anyway (what is missed is tried again).
  let waited = 0;
  const wait = system.runInterval(() => {
    const R = VOLCANO_RADIUS;
    const ready = [[R, 0], [-R, 0], [0, R], [0, -R], [R, R], [-R, -R], [R, -R], [-R, R]].every(([dx, dz]) => {
      try {
        return !!dim.getBlock({ x: base.x + dx, y: base.y, z: base.z + dz });
      } catch {
        return false;
      }
    });
    if (!ready && ++waited < 20) return;
    system.clearRun(wait);
    system.runJob(volcanoJob(dim, base));
  }, 10);
}

// While somebody is near a volcano, Phoenixes come out of the top.
const volcanoNext = new Map(); // "x,y,z,dim" -> the tick its next Phoenix comes (set when somebody arrives)
system.runInterval(() => {
  const list = volcanoes();
  if (!list.length) return;
  const kept = [];
  for (const v of list) {
    const key = `${v.x},${v.y},${v.z},${v.dim}`;
    const dim = world.getDimension(v.dim);
    const at = { x: v.x, y: v.y, z: v.z };
    const near = dim.getPlayers({ location: at, maxDistance: VOLCANO_NEAR });
    if (!near.length) {
      volcanoNext.delete(key);
      kept.push(v);
      continue;
    }
    let core;
    try {
      core = dim.getBlock(at);
    } catch {}
    if (!core) {
      kept.push(v); // not loaded: can't tell
      continue;
    }
    if (core.typeId !== VOLCANO_CORE) continue; // blown up or dug out: forgotten
    kept.push(v);
    const now = system.currentTick;
    if (!volcanoNext.has(key)) volcanoNext.set(key, now + VOLCANO_FIRST_SECONDS * 20);
    if (now < volcanoNext.get(key)) continue;
    volcanoNext.set(key, now + VOLCANO_SECONDS * 20);
    if (dim.getEntities({ type: PHANTOM, tags: [PHOENIX_TAG], location: at, maxDistance: VOLCANO_NEAR + PHOENIX_LEASH }).length >= VOLCANO_MAX) continue;
    const top = { x: v.x + 0.5, y: v.y + VOLCANO_CORE_DOWN + 5, z: v.z + 0.5 };
    try {
      spawnPhoenix(dim, top);
      flame(dim, top, 3, 50);
      for (const p of near) p.playSound("mob.blaze.shoot");
    } catch (e) {
      console.warn(`Impossible Mode: volcano spawn failed: ${e}`);
    }
  }
  if (kept.length !== list.length) world.setDynamicProperty(VOLCANOES, JSON.stringify(kept));
}, 20);

// A test kit, so fireproofing can be tried without first winning five fights.
const KIT = [["minecraft:anvil", 1], [FIRE_PELT, 5], ["minecraft:iron_sword", 1], ["minecraft:iron_helmet", 1], ["minecraft:iron_chestplate", 1], ["minecraft:iron_leggings", 1], ["minecraft:iron_boots", 1], ["minecraft:lava_bucket", 1]];

// The designer asked for diamond armor (0.1.10); he can't type /give.
const DIAMOND = ["minecraft:diamond_helmet", "minecraft:diamond_chestplate", "minecraft:diamond_leggings", "minecraft:diamond_boots"];

function give(player, id, amount = 1) {
  const left = player.getComponent("minecraft:inventory").container.addItem(new ItemStack(id, amount));
  if (left) player.dimension.spawnItem(left, player.location); // [merged] three starter kits don't fit in one inventory
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  system.runTimeout(() => {
    if (!p.isValid) return;
    p.sendMessage(`§cImpossible Mode ${VERSION}§r is on. Zombies in caves are Dark Zombies. The Phoenix sets you on fire. Tap the ground with the Volcano to build one. Good luck.`);
    for (const [prop, id] of [["impossible:starter_dark_egg", DARK_EGG], ["impossible:starter_phoenix_egg", PHOENIX_EGG]]) {
      if (p.getDynamicProperty(prop)) continue;
      give(p, id, 16);
      p.setDynamicProperty(prop, true);
    }
    if (!p.getDynamicProperty("impossible:starter_kit")) {
      for (const [id, n] of KIT) give(p, id, n);
      p.setDynamicProperty("impossible:starter_kit", true);
    }
    if (!p.getDynamicProperty("impossible:starter_volcano5")) {
      give(p, VOLCANO, 2); // "volcano4": given again in 0.1.12 (the prize), 0.1.13 (the giant one) and 0.1.14 (no flat sides)
      p.setDynamicProperty("impossible:starter_volcano5", true); // a new number each version that changes the volcano, so a new one can be built
    }
    if (!p.getDynamicProperty("impossible:starter_diamond")) {
      for (const id of DIAMOND) give(p, id);
      p.setDynamicProperty("impossible:starter_diamond", true);
    }
  }, 60);
});

// Debug: /scriptevent impossible:give (16 of each egg, 4 Fire Pelts)   impossible:zombie (a Dark Zombie in front of you)   impossible:phoenix (a Phoenix in front of you)   impossible:kit (anvil, 5 pelts, iron sword and armor, lava)   impossible:diamond (diamond armor)   impossible:volcano (a Volcano item)   impossible:volcanoes (list them)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const p = ev.sourceEntity;
  if (!p || p.typeId !== "minecraft:player") return;
  if (ev.id === "impossible:give") {
    give(p, DARK_EGG, 16);
    give(p, PHOENIX_EGG, 16);
    give(p, FIRE_PELT, 4);
  }
  if (ev.id === "impossible:volcano") give(p, VOLCANO);
  if (ev.id === "impossible:volcanoes") p.sendMessage(`Volcanoes: ${world.getDynamicProperty(VOLCANOES) ?? "[]"}`);
  if (ev.id === "impossible:diamond") for (const id of DIAMOND) give(p, id);
  if (ev.id === "impossible:kit") for (const [id, n] of KIT) give(p, id, n);
  if (ev.id === "impossible:phoenix") {
    const dir = p.getViewDirection();
    spawnPhoenix(p.dimension, { x: p.location.x + dir.x * 6, y: p.location.y + 3, z: p.location.z + dir.z * 6 });
  }
  if (ev.id === "impossible:zombie") {
    const dir = p.getViewDirection();
    spawnDark(p.dimension, { x: p.location.x + dir.x * 5, y: p.location.y, z: p.location.z + dir.z * 5 });
  }
});
