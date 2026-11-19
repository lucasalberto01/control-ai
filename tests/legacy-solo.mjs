// Keeps the legacy single-hero tests deterministic now that the vale has two characters and wild animals.
// Every world created or advanced here focuses Laya and leaves the animals out.
import { World } from '../src/world.ts'

const create = World.create
World.create = function () {
  const world = create()
  return World.fromState(world.map, { ...world.toState(), active: 0, animals: [] }) ?? world
}

const original = World.prototype.complete
World.prototype.complete = function (action, postpone) {
  const focused = World.fromState(this.map, { ...this.toState(), active: 0, animals: [] })
  if (!focused) throw new Error('Não foi possível focar a Laya no mundo de teste.')
  const next = original.call(focused, action, postpone)
  return World.fromState(next.map, { ...next.toState(), active: 0, animals: [] }) ?? next
}
