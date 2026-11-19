import { readStack } from './inventory.ts'
import type { Inventory, ItemCatalog, Stack } from './inventory.ts'
import { int } from './world-values.ts'

const CAPACITY = 16

/** Finished goods, not extra backpack slots. One stock per physical workshop device. */
export class OutputStock {
  readonly #units = new Map<string, number>()

  static fromData(value: unknown, catalog: ItemCatalog): OutputStock | null {
    const stock = new OutputStock()
    if (value === undefined) return stock
    if (!Array.isArray(value) || value.length > CAPACITY) return null
    for (const raw of value) {
      const item = readStack(raw, CAPACITY)
      if (!item || !catalog.get(item.item) || stock.#units.has(item.item) || !stock.store(item)) return null
    }
    return stock
  }

  get data(): Stack[] { return [...this.#units].map(([item, quantity]) => ({ item, quantity })) }

  fork() {
    const copy = new OutputStock()
    for (const [item, quantity] of this.#units) copy.#units.set(item, quantity)
    return copy
  }

  canStore(stack: Stack) {
    return int(stack.quantity, 1, CAPACITY)
      && this.data.reduce((sum, entry) => sum + entry.quantity, stack.quantity) <= CAPACITY
  }

  store(stack: Stack) {
    if (!this.canStore(stack)) return false
    this.#units.set(stack.item, (this.#units.get(stack.item) ?? 0) + stack.quantity)
    return true
  }

  collectable(item: string, inventory: Inventory) {
    for (let quantity = this.#units.get(item) ?? 0; quantity > 0; quantity--) {
      if (inventory.canExchange([], [{ item, quantity }])) return quantity
    }
    return 0
  }

  collect(item: string, inventory: Inventory) {
    const quantity = this.collectable(item, inventory)
    if (!quantity || !inventory.exchange([], [{ item, quantity }])) return 0
    const remaining = this.#units.get(item)! - quantity
    if (remaining) this.#units.set(item, remaining)
    else this.#units.delete(item)
    return quantity
  }
}
