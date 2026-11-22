// TEST ONLY: lives in the installed copy, never in the repo. Lines up every special monster
// in front of the player and reports what the merged pack did.
import { world, system } from "@minecraft/server";
const say = (p, s) => { console.warn(`MEGATEST ${s}`); try { p.sendMessage(`§7${s}`); } catch {} };
let started = false;
world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn || started) return;
  started = true;
  const p = ev.player;
  system.runTimeout(() => {
    const dim = p.dimension;
    const o = { x: Math.floor(p.location.x) + 0.5, y: Math.floor(p.location.y), z: Math.floor(p.location.z) + 0.5 };
    const cmd = (c) => { try { p.runCommand(c); } catch (e) { say(p, `command failed: ${c}: ${e}`); } };
    cmd("time set 6000"); cmd("gamerule dodaylightcycle false"); cmd("gamerule domobspawning false"); cmd("weather clear");
    cmd("kill @e[type=!player,type=!item]");
    for (const c of ["boomhammer:zombie", "boomhammer:skeleton", "boomhammer:creeper", "impossible:zombie", "impossible:phoenix", "machines:mutant zombie", "machines:mutant skeleton", "machines:mutant creeper", "machines:mutant cow"]) cmd(`scriptevent ${c}`);
    system.runTimeout(() => {
      // one row, 3 blocks apart, 9 blocks in front (the player looks toward +z)
      const row = [
        ["Lightning Zombie", "minecraft:zombie"], ["Dark Zombie", "minecraft:zombie"], ["Mutant Zombie", "minecraft:zombie"], [null, "minecraft:zombie"],
        ["Fire Skeleton", "minecraft:skeleton"], ["Mutant Skeleton", "minecraft:skeleton"], ["Insomnia Creeper", "minecraft:creeper"], ["Mutant Creeper", "minecraft:creeper"],
        [null, "minecraft:creeper"], ["Mutant Cow", "minecraft:cow"], ["Phoenix", "minecraft:phantom"],
      ];
      row.forEach(([name, type], i) => {
        const at = { x: o.x + (i - (row.length - 1) / 2) * 3, y: o.y, z: o.z + 9 };
        try {
          let mob = name ? dim.getEntities({ type, name })[0] : dim.spawnEntity(type, at);
          if (!mob) return say(p, `MISSING ${name}`);
          mob.teleport(at, { facingLocation: o });
          say(p, `${name ?? "plain " + type}: tags [${mob.getTags().join(",")}] name "${mob.nameTag}"`);
        } catch (e) { say(p, `row ${name}: ${e}`); }
      });
      cmd("effect @e[type=!player] slowness 600 255 true"); cmd("effect @e[type=!player] fire_resistance 600 0 true");
      p.teleport({ x: o.x, y: o.y, z: o.z }, { facingLocation: { x: o.x, y: o.y + 1.5, z: o.z + 9 } });
      // the cave rule, in the real game: a roof, then a named and an unnamed zombie under it
      cmd(`fill ${o.x - 2} ${o.y + 4} ${o.z - 12} ${o.x + 2} ${o.y + 4} ${o.z - 8} stone`);
      cmd(`summon zombie "Mutant Zombie" ${o.x - 1} ${o.y} ${o.z - 10}`);
      cmd(`summon zombie "Lightning Zombie" ${o.x} ${o.y} ${o.z - 10}`);
      cmd(`summon zombie ${o.x + 1} ${o.y} ${o.z - 10}`);
      system.runTimeout(() => {
        const under = dim.getEntities({ type: "minecraft:zombie", location: { x: o.x, y: o.y, z: o.z - 10 }, maxDistance: 4 }).map((z) => z.nameTag).sort();
        say(p, `under a roof: ${JSON.stringify(under)} (want Dark, Lightning, Mutant)`);
        const inv = p.getComponent("minecraft:inventory").container;
        let used = 0; for (let i = 0; i < inv.size; i++) if (inv.getItem(i)) used++;
        const drops = dim.getEntities({ type: "minecraft:item", location: p.location, maxDistance: 12 }).map((d) => d.getComponent("minecraft:item")?.itemStack?.typeId);
        say(p, `inventory ${used}/${inv.size} used; on the ground: ${JSON.stringify(drops)}`);
        say(p, "DONE");
      }, 30);
    }, 20);
  }, 160);
});
