// Mega Mod: Boom Hammer, Impossible Mode and Mutant Machines in one pack.
// Written by build.py. Change the add-ons or build.py, not this file.
import { world, system } from "@minecraft/server";
import { VERSION as boomhammer } from "./boomhammer.js";
import { VERSION as impossible } from "./impossible.js";
import { VERSION as machines } from "./machines.js";

export const VERSION = "0.1.0";

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  const p = ev.player;
  system.runTimeout(() => {
    if (p.isValid) p.sendMessage(`§6Mega Mod ${VERSION}§r is on: Boom Hammer ${boomhammer}, Impossible Mode ${impossible}, Mutant Machines ${machines}.`);
  }, 50);
});
