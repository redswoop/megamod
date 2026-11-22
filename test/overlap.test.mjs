import { subs, queue, log, ItemStack } from "@minecraft/server";
await import("./scripts/main.js");
const drain = () => { while (queue.length) queue.shift()(); };
let failed = 0;
const ok = (what, pass) => { console.log(`${pass ? "ok  " : "FAIL"} ${what}`); if (!pass) failed++; };
console.log("subscriptions:", Object.entries(subs).map(([k, v]) => `${k.replace(/^(world|system)\./, "")} x${v.length}`).join(", "));

// --- the cave rule: a roof over a zombie's head ---
const roofed = { id: "minecraft:overworld", getTopmostBlock: () => ({ y: 80, typeId: "minecraft:stone" }) };
const zombie = (nameTag = "") => ({ typeId: "minecraft:zombie", isValid: true, nameTag, tags: new Set(), dimension: roofed, location: { x: 0, y: 64, z: 0 },
  hasTag(t) { return this.tags.has(t); }, addTag(t) { this.tags.add(t); }, addEffect() {}, extinguishFire() {} });
const spawn = (z) => { for (const fn of subs["world.afterEvents.entitySpawn"]) fn({ entity: z }); drain(); return z; };
ok("a plain zombie under a roof becomes a Dark Zombie", spawn(zombie()).nameTag === "Dark Zombie");
ok("a Lightning Zombie under a roof (the Lightning House) stays one", spawn(zombie("Lightning Zombie")).nameTag === "Lightning Zombie");
ok("a Mutant Zombie under a roof stays one", spawn(zombie("Mutant Zombie")).nameTag === "Mutant Zombie");

// --- tapping blocks ---
const booms = [];
const dim = { id: "minecraft:overworld", createExplosion: (at, size) => booms.push(size), spawnParticle() {}, playSound() {}, spawnItem: (item) => log.push(`dropped ${item.typeId}`), getEntities: () => [] };
const player = (held) => ({ id: "p1", typeId: "minecraft:player", isValid: true, dimension: dim, location: { x: 0, y: 64, z: 0 }, getGameMode: () => "Creative",
  addEffect() {}, playSound() {}, sendMessage() {}, onScreenDisplay: { setTitle() {}, setActionBar() {} },
  getComponent: (c) => c.includes("equippable") ? { getEquipment: () => held, getEquipmentSlot: () => ({ getItem: () => held, setItem() {} }) } : { container: { addItem: () => undefined } } });
const block = (typeId) => ({ typeId, isValid: true, isAir: false, location: { x: 5, y: 63, z: 5 }, dimension: dim, getComponent: () => undefined });
const tap = (item, typeId) => { const ev = { itemStack: item, block: block(typeId), player: player(item), isFirstEvent: true, cancel: false };
  for (const fn of subs["world.beforeEvents.playerInteractWithBlock"]) fn(ev); drain(); return ev; };
booms.length = 0;
tap(new ItemStack("boomhammer:boom_hammer"), "minecraft:grass_block");
ok("the hammer on the ground goes boom (size 15)", booms.length === 1 && booms[0] === 15);
booms.length = 0;
const ev = tap(new ItemStack("boomhammer:boom_hammer"), "machines:combiner");
ok("the hammer on the Combiner does not go boom", booms.length === 0);
ok("...and the Combiner takes the tap", ev.cancel === true);
process.exit(failed ? 1 : 0);
