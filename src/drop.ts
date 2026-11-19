import { record } from './blueprint.ts'
import { Inventory, readStack } from './inventory.ts'
import type { ItemCatalog, Stack } from './inventory.ts'
import { int } from './world-values.ts'
import { same } from './world-map.ts'
import type { Point, WorldMap } from './world-map.ts'

export type DropData = { id: number; at: Point; items: Stack[] }

/** Loot on the ground. Anyone standing on the tile can take what fits. */
export class Drop {
  readonly id: number
  at: Point
  items: Stack[]

  private constructor(id: number, at: Point, items: Stack[]) {
    this.id = id
    this.at = { ...at }
    this.items = items
  }

  static create(id: number, at: Point, items: readonly Stack[]) {
    return new Drop(id, at, merge(items))
  }

  static fromData(value: unknown, catalog: ItemCatalog, map: WorldMap): Drop | null {
    const raw = record(value)
    const at = record(raw?.at)
    if (!raw || !at || !int(at.x) || !int(at.y) || !map.contains(at) || !int(raw.id, 1, 1_000_000)
      || !Array.isArray(raw.items) || raw.items.length > 32) return null
    const items: Stack[] = []
    for (const entry of raw.items) {
      const stack = readStack(entry, 512)
      if (!stack || !catalog.get(stack.item) || items.some(item => item.item === stack.item)) return null
      items.push(stack)
    }
    return items.length ? new Drop(raw.id, { x: at.x, y: at.y }, items) : null
  }

  get empty() { return this.items.length === 0 }
  fork() { return new Drop(this.id, this.at, this.items.map(item => ({ ...item }))) }
  toData(): DropData { return { id: this.id, at: { ...this.at }, items: this.items.map(item => ({ ...item })) } }

  add(items: readonly Stack[]) {
    this.items = merge([...this.items, ...items])
  }

  /** Moves what fits into the inventory; returns the taken stacks. */
  take(inventory: Inventory): Stack[] {
    const taken: Stack[] = []
    for (const stack of [...this.items]) {
      for (let quantity = stack.quantity; quantity > 0; quantity--) {
        if (!inventory.canExchange([], [{ item: stack.item, quantity }])) continue
        inventory.exchange([], [{ item: stack.item, quantity }])
        stack.quantity -= quantity
        taken.push({ item: stack.item, quantity })
        break
      }
    }
    this.items = this.items.filter(stack => stack.quantity > 0)
    return taken
  }

  sameAt(at: Point) { return same(this.at, at) }
}

function merge(items: readonly Stack[]): Stack[] {
  const totals = new Map<string, number>()
  for (const stack of items) totals.set(stack.item, (totals.get(stack.item) ?? 0) + stack.quantity)
  return [...totals].map(([item, quantity]) => ({ item, quantity }))
}
