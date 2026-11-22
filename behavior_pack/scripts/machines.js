// Mutant Machines (the designer picked the name from three offered). The first machine is the Combiner. "Something that combines stuff." "Two of anything."
// Tap the Combiner with one thing, then with another: one combined thing pops out.
// The combined thing is one of the two, with the other one's power.
import { world, system, ItemStack, EquipmentSlot } from "@minecraft/server";

export const VERSION = "0.1.14";

const COMBINER = "machines:combiner";
const MARK = "§dPower: "; // a lore line that starts with this names one power of a combined item
const GAS = "machines:mutant_gas"; // Mutant Gas + a monster's spawn egg = that monster's mutant egg
const MUTANT_MARK = "§aMutant"; // the lore line that marks a mutant spawn egg
const MUTANT_TAG = "machines_mutant";
// The designer: "make it so the mutant cow attacks you." A cow has no attack of its own, so the
// script makes it charge. That the other mutant animals charge too is Claude's pick.
const CHARGER_TAG = "machines_charger";
const CHARGERS = new Set(["cow", "mooshroom", "pig", "sheep", "chicken", "rabbit", "llama", "camel", "frog", "turtle", "parrot", "cat", "ocelot", "fox", "axolotl", "armadillo", "sniffer", "allay", "strider", "snow_golem", "goat", "panda"].map((m) => `minecraft:${m}`));
const CHARGE_NEAR = 20; // blocks: it charges a player this close
const CHARGE_PUSH = 0.16; // how hard it is pushed toward the player, every CHARGE_TICKS
const CHARGE_TICKS = 4;
const CHARGE_REACH = 2.3; // blocks: this close, it hits
const CHARGE_DAMAGE = 6; // three hearts
const CHARGE_REST = 20; // ticks between two hits by one mutant
const FOREVER = 20000000; // ticks; the longest an effect can last
const COOLDOWN = 10; // ticks between two uses of a power by one player

// What a thing gives when it goes into the Combiner, by words in its id. First match wins.
// Anything not listed gives "Strong".
const POWERS = [
  ["Boom", /tnt|gunpowder|creeper|fire_?work|end_crystal/],
  ["Fire", /flint_and_steel|fire_charge|blaze|lava|magma|torch|campfire|coal/],
  ["Lightning", /lightning|copper|trident/],
  ["Ice", /(^|_)ice|snow/],
  ["Fly", /feather|elytra|phantom|wind_charge|breeze/],
  ["Teleport", /ender|chorus/],
  ["Bounce", /slime|honey|piston/],
  ["Poison", /spider_eye|puffer|poison|wither/],
  ["Heal", /apple|carrot|bread|melon|cookie|cake|totem/],
];
const DEFAULT_POWER = "Strong";

function powerOf(typeId) {
  const id = typeId.replace(/^[^:]*:/, "");
  for (const [name, re] of POWERS) if (re.test(id)) return name;
  return null;
}

// "minecraft:diamond_sword" -> "Diamond Sword"
function nice(typeId) {
  return typeId.replace(/^[^:]*:/, "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function powersOn(item) {
  if (!item) return [];
  try {
    return item.getLore().filter((l) => l.startsWith(MARK)).map((l) => l.slice(MARK.length));
  } catch {
    return [];
  }
}

// One of the two is kept (the base) and gets the other one's power. A thing with a
// known power gives it; if neither has one, the first is kept and gets "Strong".
// A base that is already combined keeps its old powers too.
export function combine(a, b) {
  // The designer: "If you combine it with a monster, you get the [mutant] version of that monster spawn egg."
  const isEgg = (i) => /_spawn_egg$/.test(i.typeId);
  const egg = a.typeId === GAS && isEgg(b) ? b : b.typeId === GAS && isEgg(a) ? a : null;
  if (egg) {
    const out = egg.clone();
    out.amount = 1;
    out.setLore([MUTANT_MARK]);
    out.nameTag = `§aMutant ${nice(egg.typeId)}`;
    return out;
  }
  let base = a, other = b, power = powerOf(b.typeId);
  if (!power && powerOf(a.typeId)) { base = b; other = a; power = powerOf(a.typeId); }
  if (!power) power = DEFAULT_POWER;
  const out = base.clone();
  out.amount = 1;
  const powers = powersOn(out);
  for (const p of [...powersOn(other), power]) if (!powers.includes(p)) powers.push(p);
  const rest = out.getLore().filter((l) => !l.startsWith(MARK));
  out.setLore([...powers.slice(0, 10).map((p) => MARK + p), ...rest].slice(0, 20));
  out.nameTag = `§d${powers.join(" ")} ${nice(base.typeId)}`.slice(0, 60);
  return out;
}

const isCreative = (player) => {
  try { return /creative|spectator/i.test(String(player.getGameMode())); } catch { return false; }
};

// ---- the Combiner block ----

const inside = new Map(); // "dim|x,y,z" -> the first thing put in (lost if the world closes)
const keyOf = (block) => `${block.dimension.id}|${block.location.x},${block.location.y},${block.location.z}`;
const above = (block, up = 1.2) => ({ x: block.location.x + 0.5, y: block.location.y + up, z: block.location.z + 0.5 });

function puff(dim, at, particle, n = 1) {
  for (let i = 0; i < n; i++) {
    try { dim.spawnParticle(particle, at); } catch { /* not loaded */ }
  }
}

function sound(dim, id, at) {
  try { dim.playSound(id, at); } catch { /* not loaded */ }
}

function takeOneFromHand(player) {
  const slot = player.getComponent("minecraft:equippable").getEquipmentSlot(EquipmentSlot.Mainhand);
  const item = slot.getItem();
  if (!item) return null;
  const one = item.clone();
  one.amount = 1;
  if (!isCreative(player)) {
    if (item.amount <= 1) slot.setItem(undefined);
    else { item.amount -= 1; slot.setItem(item); }
  }
  return one;
}

function useCombiner(player, block) {
  const key = keyOf(block), dim = block.dimension, top = above(block);
  const first = inside.get(key);
  const held = player.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand);
  if (!held) {
    if (!first) {
      player.onScreenDisplay.setActionBar("§dHold a thing and tap the Combiner.");
      return;
    }
    inside.delete(key); // empty hand: it gives the first thing back
    dim.spawnItem(first, top);
    sound(dim, "random.pop", top);
    return;
  }
  if (held.typeId === COMBINER) return;
  const one = takeOneFromHand(player);
  if (!one) return;
  if (!first) {
    inside.set(key, one);
    sound(dim, "random.orb", top);
    puff(dim, top, "minecraft:villager_happy", 3);
    player.onScreenDisplay.setActionBar(`§d${nice(one.typeId)} is in. Now put in one more thing!`);
    return;
  }
  inside.delete(key);
  const out = combine(first, one);
  sound(dim, "random.anvil_use", top);
  puff(dim, top, "minecraft:villager_happy", 6);
  system.runTimeout(() => {
    try {
      dim.spawnItem(out, top);
      sound(dim, "random.levelup", top);
      puff(dim, top, "minecraft:totem_particle", 4);
      puff(dim, top, "minecraft:large_explosion");
      if (player.isValid) player.onScreenDisplay.setTitle(out.nameTag, { fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 10 });
    } catch (e) {
      console.warn(`Machines: combining failed: ${e}`);
    }
  }, 15);
}

// ---- mutants ----

// Eggs whose monster has another id. The name "Mutant <Name>" comes from the monster's id, and
// the bigger look (tools/make_mutants.py) is picked by that name.
const EGG_MOBS = { "minecraft:evoker": "minecraft:evocation_illager", "minecraft:zombified_piglin": "minecraft:zombie_pigman" };

const isMutantEgg = (item) => {
  try { return !!item && /_spawn_egg$/.test(item.typeId) && item.getLore().includes(MUTANT_MARK); } catch { return false; }
};

// A mutant is the same monster underneath: a tag, a name, and it is much tougher, stronger and
// faster, with green gas coming off it. (All of that is Claude's pick.)
function spawnMutant(dim, eggId, at) {
  const plain = eggId.replace(/_spawn_egg$/, "");
  const typeId = EGG_MOBS[plain] ?? plain;
  const name = `Mutant ${nice(typeId)}`;
  // Summoned with its name, so the name is there from the monster's first moment (the bigger
  // look is picked by it). If the command fails, it is spawned and named after.
  let mob = null;
  try {
    dim.runCommand(`summon ${typeId} "${name}" ${at.x.toFixed(2)} ${at.y.toFixed(2)} ${at.z.toFixed(2)}`);
    mob = dim.getEntities({ type: typeId, name, location: at, maxDistance: 3, closest: 1, excludeTags: [MUTANT_TAG] })[0] ?? null;
  } catch { /* fall through */ }
  if (!mob) {
    mob = dim.spawnEntity(typeId, at);
    mob.nameTag = name;
  }
  mob.addTag(MUTANT_TAG);
  if (CHARGERS.has(typeId)) mob.addTag(CHARGER_TAG);
  mob.addEffect("health_boost", FOREVER, { amplifier: 9, showParticles: false }); // 20 more hearts
  mob.addEffect("strength", FOREVER, { amplifier: 1, showParticles: false });
  mob.addEffect("speed", FOREVER, { amplifier: 1, showParticles: false });
  mob.addEffect("jump_boost", FOREVER, { amplifier: 1, showParticles: false });
  system.runTimeout(() => {
    try { if (mob.isValid) mob.getComponent("minecraft:health")?.resetToMaxValue(); } catch { /* no health */ }
  }, 2);
  puff(dim, at, "minecraft:totem_particle", 4);
  sound(dim, "mob.zombie.remedy", at);
  return mob;
}

function useMutantEgg(player, item, at) {
  if (!ready(player)) return;
  try {
    spawnMutant(player.dimension, item.typeId, at);
  } catch (e) {
    player.sendMessage(`§cThat one can't be a mutant: ${e}`);
    return;
  }
  if (isCreative(player)) return;
  const slot = player.getComponent("minecraft:equippable").getEquipmentSlot(EquipmentSlot.Mainhand);
  const held = slot.getItem();
  if (!held || !isMutantEgg(held)) return;
  if (held.amount <= 1) slot.setItem(undefined);
  else { held.amount -= 1; slot.setItem(held); }
}

// Green gas comes off every mutant near a player.
system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    try {
      for (const m of p.dimension.getEntities({ tags: [MUTANT_TAG], location: p.location, maxDistance: 48 })) {
        const l = m.location;
        puff(p.dimension, { x: l.x, y: l.y + 1.2, z: l.z }, "minecraft:villager_happy");
      }
    } catch { /* between dimensions */ }
  }
}, 8);

// Mutant animals charge the nearest player and hit when they reach them.
const lastHit = new Map(); // mutant id -> tick of its last hit
system.runInterval(() => {
  const players = world.getAllPlayers();
  const done = new Set();
  for (const p of players) {
    // After trying 0.1.8 the designer said "Somehow they're attacking me in creative mode" and,
    // asked, chose "Leave me alone."
    if (isCreative(p)) continue;
    let mobs = [];
    try { mobs = p.dimension.getEntities({ tags: [CHARGER_TAG], location: p.location, maxDistance: CHARGE_NEAR }); } catch { continue; }
    for (const m of mobs) {
      if (done.has(m.id)) continue; // the first player who finds it is the one it charges
      done.add(m.id);
      try {
        const dx = p.location.x - m.location.x, dz = p.location.z - m.location.z, dy = p.location.y - m.location.y;
        const dist = Math.hypot(dx, dz) || 0.001;
        const ux = dx / dist, uz = dz / dist;
        try { m.setRotation({ x: 0, y: (Math.atan2(-ux, uz) * 180) / Math.PI }); } catch { /* it turns by itself */ }
        if (dist > CHARGE_REACH - 0.5) m.applyImpulse({ x: ux * CHARGE_PUSH, y: 0, z: uz * CHARGE_PUSH });
        if (dist <= CHARGE_REACH && Math.abs(dy) < 3 && system.currentTick - (lastHit.get(m.id) ?? -100) >= CHARGE_REST) {
          lastHit.set(m.id, system.currentTick);
          p.applyDamage(CHARGE_DAMAGE, { cause: "entityAttack", damagingEntity: m });
          try { p.applyKnockback({ x: ux * 1.6, z: uz * 1.6 }, 0.45); } catch { /* older signature */ }
          puff(p.dimension, { x: p.location.x, y: p.location.y + 1, z: p.location.z }, "minecraft:critical_hit_emitter");
          sound(p.dimension, "mob.irongolem.throw", p.location);
        }
      } catch { /* it died or unloaded this tick */ }
    }
  }
  if (lastHit.size > 200) lastHit.clear();
}, CHARGE_TICKS);

// ---- the powers ----

const lastUse = new Map(); // player id -> tick

function ready(player) {
  const now = system.currentTick;
  if (now - (lastUse.get(player.id) ?? -100) < COOLDOWN) return false;
  lastUse.set(player.id, now);
  return true;
}

// `target` is the mob that was hit, or null when a block was tapped; `at` is where.
function firePower(power, player, at, target) {
  const dim = player.dimension;
  const mob = target?.isValid ? target : null;
  if (power === "Boom") {
    player.addEffect("resistance", 60, { amplifier: 255, showParticles: false });
    dim.createExplosion(at, 4, { breaksBlocks: true, causesFire: false });
  } else if (power === "Fire") {
    if (mob) mob.setOnFire(8);
    else {
      const air = dim.getBlock({ x: Math.floor(at.x), y: Math.floor(at.y) + 1, z: Math.floor(at.z) });
      if (air?.isAir) air.setType("minecraft:fire");
    }
    puff(dim, at, "minecraft:mobflame_single", 6);
  } else if (power === "Lightning") {
    player.addEffect("resistance", 40, { amplifier: 255, showParticles: false });
    player.addEffect("fire_resistance", 100, { showParticles: false });
    dim.spawnEntity("minecraft:lightning_bolt", at);
  } else if (power === "Ice") {
    if (mob) mob.addEffect("slowness", 120, { amplifier: 6 });
    else {
      const b = dim.getBlock({ x: Math.floor(at.x), y: Math.floor(at.y) + 1, z: Math.floor(at.z) });
      if (b?.isAir) b.setType("minecraft:snow_layer");
    }
    puff(dim, at, "minecraft:snowflake_particle", 8);
    sound(dim, "random.glass", at);
  } else if (power === "Fly") {
    (mob ?? player).addEffect("levitation", mob ? 60 : 30, { amplifier: mob ? 4 : 8 });
    if (!mob) player.addEffect("slow_falling", 200, { showParticles: false });
  } else if (power === "Teleport") {
    if (mob) {
      // The mob is sent away: up to 12 blocks off, onto the ground there.
      const x = mob.location.x + (Math.random() * 24 - 12), z = mob.location.z + (Math.random() * 24 - 12);
      const top = dim.getTopmostBlock({ x, z });
      mob.teleport({ x, y: (top?.y ?? mob.location.y) + 1, z });
    } else player.teleport({ x: at.x, y: at.y + 1, z: at.z });
    sound(dim, "mob.endermen.portal", at);
    puff(dim, at, "minecraft:portal_directional", 8);
  } else if (power === "Bounce") {
    if (mob) {
      const d = player.getViewDirection();
      try { mob.applyImpulse({ x: d.x * 2.5, y: 1.1, z: d.z * 2.5 }); } catch { mob.addEffect("levitation", 20, { amplifier: 10 }); }
    } else {
      player.addEffect("jump_boost", 200, { amplifier: 5 });
      player.addEffect("slow_falling", 200, { showParticles: false });
    }
    sound(dim, "mob.slime.big", at);
  } else if (power === "Poison") {
    if (mob) mob.addEffect("poison", 160, { amplifier: 1 });
    puff(dim, at, "minecraft:villager_angry", 3);
  } else if (power === "Heal") {
    player.addEffect("regeneration", 100, { amplifier: 2 });
    puff(dim, player.location, "minecraft:heart_particle", 4);
  } else if (power === "Strong") {
    if (mob) mob.applyDamage(6);
    puff(dim, at, "minecraft:critical_hit_emitter");
  }
}

function fireAll(player, item, at, target) {
  const powers = powersOn(item);
  if (!powers.length || !ready(player)) return;
  for (const p of powers) {
    try {
      firePower(p, player, at, target);
    } catch (e) {
      console.warn(`Machines: power ${p} failed: ${e}`);
    }
  }
}

// Hitting a mob with a combined thing.
world.afterEvents.entityHurt.subscribe((ev) => {
  const player = ev.damageSource.damagingEntity;
  if (!player || player.typeId !== "minecraft:player" || ev.damageSource.cause !== "entityAttack") return;
  const mob = ev.hurtEntity;
  if (!mob?.isValid) return;
  const held = player.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand);
  const at = { x: mob.location.x, y: mob.location.y, z: mob.location.z };
  fireAll(player, held, at, mob);
});

world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const { block, player } = ev;
  if (block.typeId === COMBINER) {
    ev.cancel = true;
    if (!ev.isFirstEvent) return;
    system.run(() => {
      try {
        if (block.isValid && block.typeId === COMBINER && ready(player)) useCombiner(player, block);
      } catch (e) {
        console.warn(`Machines: combiner failed: ${e}`);
      }
    });
    return;
  }
  // A mutant egg makes the mutant, not the plain monster.
  if (isMutantEgg(ev.itemStack)) {
    ev.cancel = true;
    if (!ev.isFirstEvent) return;
    const item = ev.itemStack, at = { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 };
    system.run(() => useMutantEgg(player, item, at));
    return;
  }
  // Tapping a block with a combined thing. Chests and the like open as usual.
  if (!ev.isFirstEvent || !powersOn(ev.itemStack).length) return;
  if (block.getComponent("minecraft:inventory")) return;
  const item = ev.itemStack;
  const at = { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 };
  system.run(() => fireAll(player, item, at, null));
});

// Hitting (the other button) works too. 0.1.0 only answered the use button, and the designer
// said "The iron sword didn't work any different."
world.afterEvents.entityHitBlock.subscribe((ev) => {
  const player = ev.damagingEntity, block = ev.hitBlock;
  if (!player || player.typeId !== "minecraft:player" || !block?.isValid) return;
  try {
    if (block.typeId === COMBINER) {
      if (ready(player)) useCombiner(player, block);
      return;
    }
    const held = player.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Mainhand);
    if (isMutantEgg(held)) {
      useMutantEgg(player, held, { x: block.location.x + 0.5, y: block.location.y + 1, z: block.location.z + 0.5 });
      return;
    }
    fireAll(player, held, { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 }, null);
  } catch (e) {
    console.warn(`Machines: hit failed: ${e}`);
  }
});

// In creative a hit breaks the block at once. A Combiner hit with something in hand
// (not a pickaxe) stays: the hit puts the thing in instead.
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.block.typeId !== COMBINER) return;
  const held = ev.itemStack;
  if (!held || /pickaxe/.test(held.typeId)) return;
  ev.cancel = true;
  const { player, block } = ev;
  system.run(() => {
    try {
      if (block.isValid && block.typeId === COMBINER && ready(player)) useCombiner(player, block);
    } catch (e) {
      console.warn(`Machines: combiner failed: ${e}`);
    }
  });
});

// A broken Combiner drops what was in it.
world.afterEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.brokenBlockPermutation.type.id !== COMBINER) return;
  const key = keyOf(ev.block), first = inside.get(key);
  if (!first) return;
  inside.delete(key);
  try { ev.dimension.spawnItem(first, above(ev.block, 0.5)); } catch { /* not loaded */ }
});

function give(player, id, n = 1) {
  const inv = player.getComponent("minecraft:inventory").container;
  const left = inv.addItem(new ItemStack(id, n));
  if (left) player.dimension.spawnItem(left, player.location);
}

// Things to try in the Combiner, so nobody has to dig through the creative menu first.
const KIT = [
  ["minecraft:diamond_sword", 1], ["minecraft:iron_sword", 1], ["minecraft:stick", 4], ["minecraft:tnt", 4],
  ["minecraft:flint_and_steel", 1], ["minecraft:feather", 4], ["minecraft:ender_pearl", 4], ["minecraft:ice", 4],
  ["minecraft:slime_ball", 4], ["minecraft:copper_ingot", 4], ["minecraft:apple", 4],
];

const GAS_KIT = [[GAS, 8], ["minecraft:zombie_spawn_egg", 4], ["minecraft:creeper_spawn_egg", 4], ["minecraft:skeleton_spawn_egg", 4], ["minecraft:spider_spawn_egg", 4]];

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  system.runTimeout(() => {
    if (!p.isValid) return;
    p.sendMessage(`§dMutant Machines ${VERSION}§r is on. Put down the Combiner. Tap it with one thing, then with another. Mutant Gas and a monster egg make a mutant egg.`);
    if (!p.getDynamicProperty("machines:starter")) {
      give(p, COMBINER, 2);
      for (const [id, n] of KIT) give(p, id, n);
      p.setDynamicProperty("machines:starter", true);
    }
    if (!p.getDynamicProperty("machines:starter_gas")) {
      for (const [id, n] of GAS_KIT) give(p, id, n);
      p.setDynamicProperty("machines:starter_gas", true);
    }
  }, 60);
});

// Debug: /scriptevent machines:give (Combiners and the kit), machines:inside (what the Combiners hold),
// machines:combine <id> <id> (what those two make, handed to you).
system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const p = ev.sourceEntity;
  if (!p || p.typeId !== "minecraft:player") return;
  if (ev.id === "machines:give") {
    give(p, COMBINER, 2);
    for (const [id, n] of KIT) give(p, id, n);
  }
  if (ev.id === "machines:gas") for (const [id, n] of GAS_KIT) give(p, id, n);
  if (ev.id === "machines:mutant") {
    const d = p.getViewDirection();
    try {
      spawnMutant(p.dimension, `minecraft:${ev.message.trim() || "zombie"}_spawn_egg`, { x: p.location.x + d.x * 4, y: p.location.y, z: p.location.z + d.z * 4 });
    } catch (e) {
      p.sendMessage(`§c${e}`);
    }
  }
  if (ev.id === "machines:inside") {
    p.sendMessage(`Combiners holding something: ${[...inside].map(([k, i]) => `${k} ${i.typeId}`).join("; ") || "none"}`);
  }
  if (ev.id === "machines:combine") {
    try {
      const [a, b] = ev.message.trim().split(/\s+/).map((id) => new ItemStack(id.includes(":") ? id : `minecraft:${id}`, 1));
      const out = combine(a, b);
      p.getComponent("minecraft:inventory").container.addItem(out);
      p.sendMessage(`Made ${out.nameTag}§r (${out.typeId}): ${powersOn(out).join(", ")}`);
    } catch (e) {
      p.sendMessage(`§c${e}`);
    }
  }
});
