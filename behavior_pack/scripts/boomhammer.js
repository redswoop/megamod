// Boom Hammer: smash the ground with it and BOOM, a crater bigger than TNT.
// The player holding the hammer is not hurt.
// Fire Staff: use it to shoot a fireball where you look.
// Lightning Bow: use it to shoot an arrow; lightning strikes where the arrow lands.
// Each shot uses up one Lightning Arrow (not in creative mode).
// Lightning Zombie: a zombie hit by lightning becomes one; it drops Lightning Shards, which make the arrows.
// Fire Skeleton: a skeleton hit by the Fire Staff becomes one; its arrows burn.
// Insomnia Creeper: comes at night to a player who didn't sleep the night before; its blast turns everything around black.
// Lightning House: a yellow copy of La Forge's forge house. While somebody is inside, a Lightning Zombie spawns every minute.
import { world, system, ItemStack, GameMode } from "@minecraft/server";

export const VERSION = "0.1.16";

const HAMMER = "boomhammer:boom_hammer";
const STAFF = "boomhammer:fire_staff";
const BOW = "boomhammer:lightning_bow";
const ARROW = "boomhammer:lightning_arrow";
const DEBUG_ARROWS = 16; // only from /scriptevent boomhammer:give; arrows are crafted
const HOUSE = "boomhammer:lightning_house";
const HOUSES = "boomhammer:houses"; // world property: a JSON list of { x, y, z, dim }, the middle of each house's floor
const HOUSE_HALF = 6; // 13 x 13. La Forge's forge house is 7 x 7; the designer asked for "a bigger version".
const HOUSE_WALL = 7; // blocks of wall under the roof (the forge house has 4)
const HOUSE_WALLS = ["minecraft:yellow_concrete", "minecraft:yellow_terracotta", "minecraft:gold_block"];
const HOUSE_LAMP = "minecraft:glowstone"; // hangs under the roof; a house whose lamp is gone stops spawning
const HOUSE_FIRST_SECONDS = 3; // the first zombie comes soon after somebody walks in (Claude's pick, so it's clear it works)
const HOUSE_SECONDS = 60; // then "every minute"
const HOUSE_MAX_ZOMBIES = 6; // no more spawn while this many Lightning Zombies are near the house
const SHARD = "boomhammer:lightning_shard";
const SHARDS_PER_ZOMBIE = 8; // enough for one craft of arrows
const ZOMBIE = "minecraft:zombie";
const ZOMBIE_TAG = "boomhammer_lightning_zombie";
const SKELETON = "minecraft:skeleton";
const SKELETON_TAG = "boomhammer_fire_skeleton";
const CREEPER = "minecraft:creeper";
const CREEPER_EGG = "boomhammer:insomnia_creeper_egg"; // tap the ground with it: an Insomnia Creeper appears (a debug tool that needs no typing)
const CREEPER_TAG = "boomhammer_insomnia_creeper";
const CREEPER_BLACK = "minecraft:black_concrete";
const CREEPER_BLACK_RADIUS = 6; // blocks around the blast that turn black
const CREEPER_SECONDS = 45; // one comes this often to a sleepless player at night
const CREEPER_MAX = 3; // not while this many are already near that player
const DAY_TICKS = 24000;
const LAST_REST = "boomhammer:last_rest"; // player property: the world's absolute time when they last slept (or first joined)
const FOREVER = 20000000; // ticks; the longest an effect can last
const BOOM_SIZE = 15; // TNT is 4. The designer asked for "bigger", then "way bigger".
const SAFE_TICKS = 200; // how long the smasher can't be hurt (the blast can throw them)
const REST_TICKS = 15; // wait between booms
const FIRE_BOOM = 3; // the fireball's explosion; it also sets fire. TNT is 4.
const FIRE_RANGE = 64; // blocks a fireball flies before it bursts by itself
const FIRE_STEP = 0.5; // blocks per check
const FIRE_STEPS_PER_TICK = 4; // so 2 blocks per tick
const FIRE_REST_TICKS = 8; // wait between shots
const ARROW_SPEED = 3; // blocks per tick
const BOW_REST_TICKS = 10; // wait between arrows
const lightningArrows = new Set(); // ids of arrows the bow shot that haven't landed
const lastArrow = new Map(); // player id -> tick of their last arrow
const lastBoom = new Map(); // player id -> tick of their last boom
const lastShot = new Map(); // player id -> tick of their last fireball

function boom(player, block) {
  if (!player.isValid || !block.isValid) return;
  const now = system.currentTick;
  if (now - (lastBoom.get(player.id) ?? -REST_TICKS) < REST_TICKS) return;
  lastBoom.set(player.id, now);
  player.addEffect("resistance", SAFE_TICKS, { amplifier: 255, showParticles: false });
  const at = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
  player.dimension.createExplosion(at, BOOM_SIZE, { breaksBlocks: true, causesFire: false, source: player });
}

// The game's own fireballs can't be summoned by a script ('minecraft:fireball' is not
// summonable), so the staff's fireball is a point the script flies along the player's
// aim, drawn with flame particles, that explodes on the first block or mob it meets.
function shoot(player) {
  if (!player.isValid) return;
  const now = system.currentTick;
  if (now - (lastShot.get(player.id) ?? -FIRE_REST_TICKS) < FIRE_REST_TICKS) return;
  lastShot.set(player.id, now);
  const dim = player.dimension;
  const dir = player.getViewDirection();
  const head = player.getHeadLocation();
  let pos = { x: head.x + dir.x, y: head.y + dir.y, z: head.z + dir.z };
  let flown = 0;
  player.playSound("mob.blaze.shoot");
  const run = system.runInterval(() => {
    for (let i = 0; i < FIRE_STEPS_PER_TICK; i++) {
      const next = { x: pos.x + dir.x * FIRE_STEP, y: pos.y + dir.y * FIRE_STEP, z: pos.z + dir.z * FIRE_STEP };
      flown += FIRE_STEP;
      let hit = flown >= FIRE_RANGE;
      try {
        const block = dim.getBlock(next);
        if (!block || !block.isAir) hit = true;
        const near = dim.getEntities({ location: next, maxDistance: 1.2, excludeTypes: ["minecraft:item", "minecraft:xp_orb"] });
        if (near.some((e) => e.id !== player.id)) hit = true;
        dim.spawnParticle("minecraft:basic_flame_particle", next);
      } catch {
        hit = true; // out of the world or not loaded
      }
      if (hit) {
        system.clearRun(run);
        burst(player, dim, pos); // pos is the last spot that was still air
        return;
      }
      pos = next;
    }
  }, 1);
}

function burst(player, dim, at) {
  try {
    const mine = player.isValid && player.dimension.id === dim.id;
    if (mine) {
      const p = player.location;
      // A shot at your own feet shouldn't hurt.
      if (Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) < FIRE_BOOM + 4) {
        player.addEffect("resistance", 60, { amplifier: 255, showParticles: false });
        player.addEffect("fire_resistance", 200, { showParticles: false });
      }
    }
    // Skeletons caught in the blast become Fire Skeletons (and live through it).
    for (const s of dim.getEntities({ type: SKELETON, location: at, maxDistance: FIRE_BOOM + 1 })) ignite(s);
    dim.createExplosion(at, FIRE_BOOM, { breaksBlocks: true, causesFire: true, source: mine ? player : undefined });
  } catch {
    // nothing to blow up there
  }
}

function ignite(skeleton) {
  try {
    if (!skeleton.isValid || skeleton.hasTag(SKELETON_TAG)) return;
    skeleton.addTag(SKELETON_TAG);
    skeleton.nameTag = "Fire Skeleton"; // the resource pack picks the fire skin by this name
    skeleton.addEffect("fire_resistance", FOREVER, { showParticles: false });
    skeleton.addEffect("resistance", 60, { amplifier: 255, showParticles: false });
    const health = skeleton.getComponent("minecraft:health");
    if (health) health.resetToMaxValue();
  } catch {
    // it's gone
  }
}

// A Fire Skeleton's arrows are on fire, so they set what they hit alight.
world.afterEvents.entitySpawn.subscribe((ev) => {
  const arrow = ev.entity;
  if (arrow.typeId !== "minecraft:arrow") return;
  system.run(() => {
    try {
      const owner = arrow.getComponent("minecraft:projectile")?.owner;
      if (owner?.typeId === SKELETON && owner.hasTag(SKELETON_TAG)) arrow.setOnFire(100, false);
    } catch {
      // the arrow already landed
    }
  });
});
world.afterEvents.projectileHitEntity.subscribe((ev) => {
  try {
    if (ev.source?.typeId !== SKELETON || !ev.source.hasTag(SKELETON_TAG)) return;
    ev.getEntityHit()?.entity?.setOnFire(5, true);
  } catch {
    // somebody is gone
  }
});

function zap(dim, at) {
  try {
    dim.spawnEntity("minecraft:lightning_bolt", at);
  } catch {
    // out of the world or not loaded
  }
}

// Uses up one Lightning Arrow from the player's inventory. Creative players shoot for free.
function takeArrow(player) {
  if (player.getGameMode() === GameMode.Creative) return true;
  const bag = player.getComponent("minecraft:inventory").container;
  for (let i = 0; i < bag.size; i++) {
    const stack = bag.getItem(i);
    if (stack?.typeId !== ARROW) continue;
    if (stack.amount > 1) {
      stack.amount -= 1;
      bag.setItem(i, stack);
    } else {
      bag.setItem(i, undefined);
    }
    return true;
  }
  return false;
}

// The bow shoots at once, with no drawing back: it is a plain item, not a real bow.
function loose(player) {
  if (!player.isValid) return;
  const now = system.currentTick;
  if (now - (lastArrow.get(player.id) ?? -BOW_REST_TICKS) < BOW_REST_TICKS) return;
  lastArrow.set(player.id, now);
  if (!takeArrow(player)) {
    player.onScreenDisplay.setActionBar("§eYou need a Lightning Arrow!");
    player.playSound("random.click");
    return;
  }
  const dim = player.dimension;
  const dir = player.getViewDirection();
  const head = player.getHeadLocation();
  player.playSound("random.bow");
  let arrow;
  try {
    arrow = dim.spawnEntity("minecraft:arrow", { x: head.x + dir.x, y: head.y + dir.y, z: head.z + dir.z });
    const projectile = arrow.getComponent("minecraft:projectile");
    projectile.owner = player;
    projectile.shoot({ x: dir.x * ARROW_SPEED, y: dir.y * ARROW_SPEED, z: dir.z * ARROW_SPEED });
    lightningArrows.add(arrow.id);
  } catch {
    // No arrow could be shot: strike where the player is looking instead.
    if (arrow?.isValid) arrow.remove();
    const hit = player.getBlockFromViewDirection({ maxDistance: 64 });
    if (hit) zap(dim, hit.block.location);
  }
}

function landed(ev) {
  let id;
  try {
    id = ev.projectile.id;
  } catch {
    return;
  }
  if (!lightningArrows.delete(id)) return;
  zap(ev.dimension, ev.location);
  if (ev.projectile.isValid) ev.projectile.remove();
}
world.afterEvents.projectileHitBlock.subscribe(landed);
world.afterEvents.projectileHitEntity.subscribe(landed);

// A zombie hit by lightning (a storm's or the bow's) becomes a Lightning Zombie. It is still a
// plain zombie underneath: a tag, a name, sparks, and it is faster and doesn't burn.
function electrify(zombie) {
  if (!zombie.isValid || zombie.hasTag(ZOMBIE_TAG)) return;
  zombie.addTag(ZOMBIE_TAG);
  zombie.nameTag = "Lightning Zombie";
  zombie.addEffect("fire_resistance", FOREVER, { showParticles: false });
  zombie.addEffect("speed", FOREVER, { amplifier: 1, showParticles: false });
  zombie.extinguishFire();
  const health = zombie.getComponent("minecraft:health");
  if (health) health.resetToMaxValue();
}

world.afterEvents.entityHurt.subscribe((ev) => {
  if (ev.damageSource.cause !== "lightning" || ev.hurtEntity.typeId !== ZOMBIE) return;
  const zombie = ev.hurtEntity;
  system.run(() => {
    try {
      electrify(zombie);
    } catch {
      // it died from the strike
    }
  });
});

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const dead = ev.deadEntity;
    if (dead.typeId !== ZOMBIE || !dead.hasTag(ZOMBIE_TAG)) return;
    dead.dimension.spawnItem(new ItemStack(SHARD, SHARDS_PER_ZOMBIE), dead.location);
  } catch {
    // already gone
  }
});

// Sparks on every Lightning Zombie, twice a second.
system.runInterval(() => {
  for (const name of ["overworld", "nether", "the_end"]) {
    try {
      for (const z of world.getDimension(name).getEntities({ type: ZOMBIE, tags: [ZOMBIE_TAG] })) {
        const at = { x: z.location.x, y: z.location.y + 1 + Math.random(), z: z.location.z };
        z.dimension.spawnParticle("minecraft:blue_flame_particle", at);
      }
      for (const k of world.getDimension(name).getEntities({ type: SKELETON, tags: [SKELETON_TAG] })) {
        k.dimension.spawnParticle("minecraft:basic_flame_particle", { x: k.location.x, y: k.location.y + 1 + Math.random(), z: k.location.z });
      }
    } catch {
      // nothing loaded there
    }
  }
}, 10);

// ---- Insomnia Creeper ----

function insomniac(dim, at) {
  const c = dim.spawnEntity(CREEPER, at);
  c.addTag(CREEPER_TAG);
  c.nameTag = "Insomnia Creeper"; // the resource pack picks the black skin by this name
  return c;
}

/** Everything around the blast turns black; nearby players get the dark too. */
function blacken(dim, at) {
  const R = CREEPER_BLACK_RADIUS;
  const c = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        if (x * x + y * y + z * z > R * R) continue;
        try {
          const b = dim.getBlock({ x: c.x + x, y: c.y + y, z: c.z + z });
          if (!b || b.isAir || b.isLiquid || b.typeId === "minecraft:bedrock" || b.getComponent("minecraft:inventory")) continue;
          b.setType(CREEPER_BLACK);
        } catch {
          // outside the world or not loaded
        }
      }
    }
  }
  for (const p of dim.getPlayers({ location: at, maxDistance: R * 2 })) {
    try {
      p.addEffect("darkness", 200, { showParticles: false });
    } catch {
      // gone
    }
  }
}

// The creeper is the source of its own explosion. The event is read-only, so the painting waits a tick (after the crater is made).
const blackened = new Set();
world.beforeEvents.explosion.subscribe((ev) => {
  const c = ev.source;
  if (!c || c.typeId !== CREEPER || !(c.hasTag(CREEPER_TAG) || c.nameTag === "Insomnia Creeper") || blackened.has(c.id)) return;
  blackened.add(c.id);
  const dim = ev.dimension;
  const at = { ...c.location };
  system.runTimeout(() => blacken(dim, at), 1);
});

// Once a second: remember when each player sleeps, and at night send a creeper to anyone who skipped a night.
let creeperClock = 0;
system.runInterval(() => {
  creeperClock++;
  const now = world.getAbsoluteTime();
  const time = world.getTimeOfDay();
  const night = time >= 13000 && time < 23000;
  for (const p of world.getAllPlayers()) {
    try {
      const last = p.getDynamicProperty(LAST_REST);
      if (last === undefined || p.isSleeping || now < last) {
        p.setDynamicProperty(LAST_REST, now);
        continue;
      }
      if (!night || now - last < DAY_TICKS || p.dimension.id !== "minecraft:overworld" || creeperClock % CREEPER_SECONDS) continue;
      const dim = p.dimension;
      if (dim.getEntities({ type: CREEPER, tags: [CREEPER_TAG], location: p.location, maxDistance: 48 }).length >= CREEPER_MAX) continue;
      // Somewhere 10 to 16 blocks away, on the ground.
      const turn = Math.random() * Math.PI * 2, far = 10 + Math.random() * 6;
      const x = p.location.x + Math.cos(turn) * far, z = p.location.z + Math.sin(turn) * far;
      const ground = dim.getTopmostBlock({ x, z }, p.location.y + 12);
      if (ground) insomniac(dim, { x, y: ground.location.y + 1, z });
    } catch {
      // not loaded there
    }
  }
}, 20);

// ---- Lightning House ----

/** The blocks of the house, as offsets from the middle of its floor. `front` is the side with the doorway. */
function housePlan(front) {
  const R = HOUSE_HALF, H = HOUSE_WALL;
  const turn = { south: (a, b) => [a, b], north: (a, b) => [-a, -b], east: (a, b) => [b, -a], west: (a, b) => [-b, a] }[front];
  const mix = (x, y, z) => HOUSE_WALLS[(((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % HOUSE_WALLS.length];
  const out = [];
  const put = (a, y, b, block) => {
    const [x, z] = turn(a, b);
    out.push({ x, y, z, block: block ?? mix(x, y, z) });
  };
  for (let a = -R; a <= R; a++) {
    for (let b = -R; b <= R; b++) {
      put(a, -1, b); // floor
      put(a, H, b, HOUSE_WALLS[0]); // roof
      if (Math.abs(a) < R && Math.abs(b) < R) put(a, H + 1, b, HOUSE_WALLS[0]); // roof cap
      const edge = Math.abs(a) === R || Math.abs(b) === R;
      for (let y = 0; y < H; y++) {
        const door = b === R && Math.abs(a) <= 2 && y <= 4;
        const window = Math.abs(a) === R && Math.abs(b) <= 1 && y >= 2 && y <= 4;
        put(a, y, b, edge && !door && !window ? undefined : "minecraft:air");
      }
    }
  }
  put(0, H - 1, 0, HOUSE_LAMP);
  return out;
}

function loadHouses() {
  try {
    return JSON.parse(world.getDynamicProperty(HOUSES) ?? "[]");
  } catch {
    return [];
  }
}

function saveHouses(list) {
  world.setDynamicProperty(HOUSES, JSON.stringify(list));
}

/** Build a Lightning House with its floor middle at `at`, the doorway toward the player. */
function buildHouse(player, at) {
  const dim = player.dimension;
  const dx = player.location.x - (at.x + 0.5), dz = player.location.z - (at.z + 0.5);
  const front = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "east" : "west") : dz > 0 ? "south" : "north";
  for (const p of housePlan(front)) {
    try {
      const b = dim.getBlock({ x: at.x + p.x, y: at.y + p.y, z: at.z + p.z });
      if (!b || b.typeId === "minecraft:bedrock" || b.getComponent("minecraft:inventory")) continue;
      b.setType(p.block);
    } catch {
      // outside the world or not loaded: skip that block
    }
  }
  const list = loadHouses().filter((h) => !(h.x === at.x && h.y === at.y && h.z === at.z && h.dim === dim.id));
  list.push({ x: at.x, y: at.y, z: at.z, dim: dim.id });
  saveHouses(list);
  dim.playSound("random.anvil_use", at);
  player.onScreenDisplay.setActionBar("§eLightning House built! Walk in...");
}

/** Put the house down on the block the player tapped. Survival players use up the item. */
function placeHouse(player, block) {
  if (player.getGameMode() !== GameMode.Creative) {
    const inv = player.getComponent("minecraft:inventory").container;
    const slot = player.selectedSlotIndex;
    const held = inv.getItem(slot);
    if (held?.typeId !== HOUSE) return;
    if (held.amount > 1) {
      held.amount -= 1;
      inv.setItem(slot, held);
    } else inv.setItem(slot, undefined);
  }
  buildHouse(player, { x: block.location.x, y: block.location.y + 1, z: block.location.z });
}

// Once a second: count how long somebody has been inside each house, and spawn a Lightning Zombie when it's time.
const houseClock = new Map(); // "dim x y z" -> seconds somebody has been inside since the last zombie (or since they walked in)
system.runInterval(() => {
  const list = loadHouses();
  if (!list.length) return;
  const players = world.getAllPlayers();
  let changed = false;
  const keep = [];
  for (const h of list) {
    const key = `${h.dim} ${h.x} ${h.y} ${h.z}`;
    let stays = true;
    try {
      const dim = world.getDimension(h.dim);
      const inside = players.some((p) => {
        if (p.dimension.id !== h.dim) return false;
        const l = p.location;
        return Math.abs(l.x - (h.x + 0.5)) <= HOUSE_HALF && Math.abs(l.z - (h.z + 0.5)) <= HOUSE_HALF && l.y >= h.y - 1 && l.y < h.y + HOUSE_WALL;
      });
      if (!inside) houseClock.delete(key);
      else {
        const lamp = dim.getBlock({ x: h.x, y: h.y + HOUSE_WALL - 1, z: h.z });
        if (lamp && lamp.typeId !== HOUSE_LAMP) stays = false; // the house was smashed
        else if (lamp) {
          const t = (houseClock.get(key) ?? HOUSE_SECONDS - HOUSE_FIRST_SECONDS) + 1;
          if (t < HOUSE_SECONDS) houseClock.set(key, t);
          else {
            houseClock.set(key, 0);
            const centre = { x: h.x + 0.5, y: h.y, z: h.z + 0.5 };
            const near = dim.getEntities({ type: ZOMBIE, tags: [ZOMBIE_TAG], location: centre, maxDistance: 16 }).length;
            if (near < HOUSE_MAX_ZOMBIES) {
              electrify(dim.spawnEntity(ZOMBIE, centre));
              dim.playSound("ambient.weather.thunder", centre, { volume: 0.4 });
            }
          }
        }
      }
    } catch {
      // not loaded: leave it be
    }
    if (stays) keep.push(h);
    else {
      changed = true;
      houseClock.delete(key);
    }
  }
  if (changed) saveHouses(keep);
}, 20);

// Tapping a block fires this on touch screens too. The event is read-only, so the work is deferred.
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const id = ev.itemStack?.typeId;
  if ((id !== HAMMER && id !== STAFF && id !== BOW && id !== HOUSE && id !== CREEPER_EGG) || !ev.isFirstEvent) return;
  // Chests and other blocks with an inventory still open.
  if (ev.block.getComponent("minecraft:inventory")) return;
  if (ev.block.typeId === "machines:combiner") return; // [merged] the Combiner takes it
  ev.cancel = true;
  const { player, block } = ev;
  if (id === CREEPER_EGG) {
    const at = { x: ev.block.location.x + 0.5, y: ev.block.location.y + 1, z: ev.block.location.z + 0.5 };
    const dim = ev.player.dimension;
    system.run(() => insomniac(dim, at));
    return;
  }
  system.run(() => (id === HAMMER ? boom(player, block) : id === STAFF ? shoot(player) : id === HOUSE ? placeHouse(player, block) : loose(player)));
});

// Using the staff or the bow while pointing at the air (mouse and controller; touch screens only get the block tap).
world.afterEvents.itemUse.subscribe((ev) => {
  try { if (ev.source.getBlockFromViewDirection({ maxDistance: 7 })?.block.typeId === "machines:combiner") return; } catch {} // [merged] the Combiner takes it
  if (ev.itemStack.typeId === STAFF) shoot(ev.source);
  if (ev.itemStack.typeId === BOW) loose(ev.source);
});

function give(player, id, amount = 1) {
  const left = player.getComponent("minecraft:inventory").container.addItem(new ItemStack(id, amount));
  if (left) player.dimension.spawnItem(left, player.location); // [merged] three starter kits don't fit in one inventory
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  system.runTimeout(() => {
    if (!p.isValid) return;
    p.sendMessage(`§cBoom Hammer ${VERSION}§r: smash the ground with the hammer. BOOM! Shoot fire with the Fire Staff. Shoot lightning with the Lightning Bow. Tap the ground with the Lightning House to build it.`);
    for (const [prop, id] of [["boomhammer:starter", HAMMER], ["boomhammer:starter_staff", STAFF], ["boomhammer:starter_bow", BOW], ["boomhammer:starter_house", HOUSE], ["boomhammer:starter_creeper_egg", CREEPER_EGG]]) {
      if (p.getDynamicProperty(prop)) continue;
      give(p, id);
      p.setDynamicProperty(prop, true);
    }
  }, 60);
});

// Debug: /scriptevent boomhammer:give (all items)   boomhammer:boom (a boom under your feet)   boomhammer:fire (one shot)   boomhammer:zombie (a Lightning Zombie in front of you)   boomhammer:skeleton (a Fire Skeleton in front of you)   boomhammer:creeper (an Insomnia Creeper in front of you)   boomhammer:nosleep (count as having skipped a night)   boomhammer:shards (16 shards)   boomhammer:house (a Lightning House in front of you)   boomhammer:houses (list them)
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const p = ev.sourceEntity;
  if (!p || p.typeId !== "minecraft:player") return;
  if (ev.id === "boomhammer:give") {
    give(p, HAMMER);
    give(p, STAFF);
    give(p, BOW);
    give(p, ARROW, DEBUG_ARROWS);
    give(p, HOUSE);
    give(p, CREEPER_EGG);
  }
  if (ev.id === "boomhammer:house") {
    const dir = p.getViewDirection();
    const far = Math.abs(dir.x) > Math.abs(dir.z) ? { x: Math.sign(dir.x) * 6, z: 0 } : { x: 0, z: Math.sign(dir.z) * 6 };
    buildHouse(p, { x: Math.floor(p.location.x) + far.x, y: Math.floor(p.location.y), z: Math.floor(p.location.z) + far.z });
  }
  if (ev.id === "boomhammer:houses") p.sendMessage(`Lightning Houses: ${world.getDynamicProperty(HOUSES) ?? "[]"}`);
  if (ev.id === "boomhammer:boom") {
    const b = p.dimension.getBlock({ x: p.location.x, y: p.location.y - 1, z: p.location.z });
    lastBoom.delete(p.id);
    if (b) boom(p, b);
  }
  if (ev.id === "boomhammer:zombie") {
    const dir = p.getViewDirection();
    const z = p.dimension.spawnEntity(ZOMBIE, { x: p.location.x + dir.x * 4, y: p.location.y, z: p.location.z + dir.z * 4 });
    electrify(z);
  }
  if (ev.id === "boomhammer:skeleton") {
    const dir = p.getViewDirection();
    ignite(p.dimension.spawnEntity(SKELETON, { x: p.location.x + dir.x * 6, y: p.location.y, z: p.location.z + dir.z * 6 }));
  }
  if (ev.id === "boomhammer:creeper") {
    const dir = p.getViewDirection();
    insomniac(p.dimension, { x: p.location.x + dir.x * 6, y: p.location.y, z: p.location.z + dir.z * 6 });
  }
  if (ev.id === "boomhammer:nosleep") {
    p.setDynamicProperty(LAST_REST, world.getAbsoluteTime() - DAY_TICKS);
    p.sendMessage("You haven't slept. Insomnia Creepers will come tonight.");
  }
  if (ev.id === "boomhammer:shards") give(p, SHARD, 16);
  if (ev.id === "boomhammer:fire") {
    lastShot.delete(p.id);
    shoot(p);
  }
});
