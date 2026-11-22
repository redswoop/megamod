# Mega Mod

Three Minecraft Bedrock add-ons designed by kids, in one pack: **Boom Hammer**, **Impossible Mode** and **Mutant Machines**. Weapons that go boom, monsters that make the game really hard, and a machine that combines two of anything.

## Install

On the device that **hosts** the world (iPad, phone, or Windows):

1. Download **[MegaMod.mcaddon](https://github.com/redswoop/megamod/releases/latest/download/MegaMod.mcaddon)** and open it. Minecraft imports it.
2. Edit the world → **Behavior Packs** → **Available** → **Mega Mod x.y.z** → **Activate** (its art pack, **Mega Mod x.y.z (art)**, comes along automatically; if not, activate it under **Resource Packs**).
3. Play. Anyone who joins downloads the pack automatically.

Chat says which version is running when you join. Everyone gets a starter kit the first time they join; what doesn't fit in your inventory drops at your feet. On touch screens, tap a *block* (the ground), not the sky.

**Don't turn it on together with the separate [Boom Hammer](https://github.com/redswoop/boom-hammer) pack.** Everything would happen twice.

## Boom Hammer

- **Boom Hammer**: smash the ground and BOOM, a crater much bigger than TNT. The smasher isn't hurt. Recipe: like a stone pickaxe, with TNT in place of the stone.
- **Fire Staff**: shoots a fireball that explodes and sets fire. Recipe: a flint and steel on top of two sticks.
- **Lightning Bow**: shoots an arrow, and lightning strikes where it lands. Each shot uses one Lightning Arrow (free in creative).
- **Lightning Zombie**: a zombie hit by lightning turns yellow with red eyes and gets fast. It drops 8 **Lightning Shards**.
- **Lightning Arrow**: a normal arrow surrounded by 8 Lightning Shards makes 8.
- **Lightning House**: tap the ground to build a big yellow house. While somebody is inside, a Lightning Zombie spawns every minute. Smash the house and it stops.
- **Fire Skeleton**: a skeleton hit by the Fire Staff turns orange. Its arrows are on fire.
- **Insomnia Creeper**: a black creeper that comes at night if you skipped a night's sleep. When it explodes, everything around turns black and it goes dark. The egg makes one right away.

## Impossible Mode

- **Dark Zombie**: a zombie that spawns in a cave (anywhere with a roof over its head) is dark gray with red eyes, and doesn't burn in the sun. The Dark Zombie Egg makes one right away.
- **Phoenix**: a fire bird. What it bites catches fire, and the first time it dies it comes back to life. The Phoenix Egg makes one.
- **Fire Pelt**: a Phoenix drops one each time it dies. Hold Fire Pelts and tap an anvil: the armor you're wearing and the swords you're carrying become **Fireproof**. With fireproof gear, fire and lava can't hurt you and the Phoenix only does half damage.
- **Volcano**: tap the ground to build a giant volcano in front of you, with lava in the top and Ancient Debris on the rim. While somebody is near, Phoenixes come out of it.

## Mutant Machines

- **Combiner**: put it down, tap it with one thing, then with another. One combined thing pops out: one of the two, with the other one's power. TNT gives Boom, flint and steel gives Fire, copper gives Lightning, ice gives Ice, a feather gives Fly, an ender pearl gives Teleport, slime gives Bounce, a spider eye gives Poison, food gives Heal, and anything else gives Strong. The power goes off when you hit a monster or a block with it.
- **Mutant Gas**: combine it with any monster's spawn egg to get that monster's **mutant** egg. A mutant is much bigger, has 20 more hearts, and is stronger and faster. The mutant cow, zombie and creeper have their own look.
- Mutant animals (a cow, a pig, a chicken...) charge at you and hit. They leave you alone in creative mode.

## Good to know

- The special monsters are the game's own mobs with a new skin, chosen by their name. A zombie you name "Lightning Zombie" with a name tag turns yellow too.
- The pack changes how many of the game's monsters are drawn (that's how mutants get big), so it may clash with other packs that restyle the same monsters.
- A world that used the separate Boom Hammer pack keeps its items and monsters when you switch to Mega Mod, but Lightning Houses built before stop making zombies, and everyone gets the starter kit again.
- Made for Minecraft Bedrock 1.26.20 or newer.

## Building it

`behavior_pack/` and `resource_pack/` are written by `python3 build.py`, which merges the three add-ons from folders next to this one (`../boom-hammer`, `../impossible-mode`, `../machines`) and writes `MegaMod.mcaddon`. Change an add-on or `build.py`, not the built packs. `test/run.sh` checks the few places where the three add-ons had to be kept out of each other's way.
