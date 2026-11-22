// A tiny fake of the game API: enough to load the scripts and fire a few events by hand.
export const subs = {}; // "world.beforeEvents.playerInteractWithBlock" -> [handlers]
const events = (path) => new Proxy({}, { get: (_, name) => ({ subscribe: (fn) => (subs[`${path}.${name}`] ??= []).push(fn) }) });
export const queue = [];
export const log = [];
export const system = {
  currentTick: 1000,
  run: (fn) => queue.push(fn), runTimeout: (fn) => queue.push(fn), runInterval: () => 1, clearRun() {}, runJob() {},
  afterEvents: events("system.afterEvents"), beforeEvents: events("system.beforeEvents"),
};
export const world = {
  afterEvents: events("world.afterEvents"), beforeEvents: events("world.beforeEvents"),
  getAllPlayers: () => [], getDimension: () => null, getDynamicProperty: () => undefined, setDynamicProperty() {},
  getAbsoluteTime: () => 0, getTimeOfDay: () => 0,
};
export class ItemStack { constructor(typeId, amount = 1) { this.typeId = typeId; this.amount = amount; this.lore = []; } getLore() { return this.lore; } setLore(l) { this.lore = l; } clone() { return Object.assign(new ItemStack(this.typeId, this.amount), { lore: [...this.lore], nameTag: this.nameTag }); } }
export const GameMode = { Creative: "Creative", Survival: "Survival" };
export const EquipmentSlot = { Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Mainhand: "Mainhand" };
