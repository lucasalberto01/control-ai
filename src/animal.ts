import { record } from './blueprint.ts'
import { int } from './world-values.ts'
import { pointKey, same } from './world-map.ts'
import type { Point, WorldMap } from './world-map.ts'

export type AnimalData = { id: number; at: Point; hp: number; nextBreak: number; nextBite: number }
export const ANIMAL_HP = 12
export const ANIMAL_DAMAGE = 4
/** Depois de morder, o animal espera este tanto de turnos do vale antes de morder de novo. */
export const ANIMAL_BITE_EVERY = 2

export class Animal {
  readonly id: number
  at: Point
  hp: number
  nextBreak: number
  nextBite: number

  private constructor(id: number, at: Point, hp: number, nextBreak: number, nextBite: number) {
    this.id = id
    this.at = { ...at }
    this.hp = hp
    this.nextBreak = nextBreak
    this.nextBite = nextBite
  }

  static create(id: number, at: Point): Animal {
    return new Animal(id, at, ANIMAL_HP, 0, 0)
  }

  static fromData(value: unknown, map: WorldMap, turn: number): Animal | null {
    const raw = record(value)
    const at = record(raw?.at)
    const nextBite = raw?.nextBite === undefined ? 0 : raw.nextBite
    if (!raw || !at || !int(at.x) || !int(at.y) || !map.contains(at) || !map.isWalkable(at)
      || !int(raw.id, 1, 1_000_000) || !int(raw.hp, 1, ANIMAL_HP) || !int(raw.nextBreak, 0, turn + 100)
      || !int(nextBite, 0, turn + 100)) return null
    return new Animal(raw.id, { x: at.x, y: at.y }, raw.hp, raw.nextBreak, nextBite)
  }

  get dead() { return this.hp <= 0 }
  hits(amount: number) { this.hp = Math.max(0, this.hp - Math.max(1, Math.round(amount))); return this.dead }
  fork() { return new Animal(this.id, this.at, this.hp, this.nextBreak, this.nextBite) }
  toData(): AnimalData { return { id: this.id, at: { ...this.at }, hp: this.hp, nextBreak: this.nextBreak, nextBite: this.nextBite } }
  key() { return pointKey(this.at) }
  sameAt(at: Point) { return same(this.at, at) }
}
