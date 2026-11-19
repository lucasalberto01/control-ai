import seed from './data/items.json' with { type: 'json' }
import { inList, record } from './blueprint.ts'
import { int, text } from './world-values.ts'

export const capabilities = ['aquecer', 'misturar', 'cortar'] as const
export const kinds = ['material', 'estacao', 'luz', 'objeto'] as const
export type Capability = typeof capabilities[number]
export type Item = {
  id: string; name: string; emoji: string; kind: typeof kinds[number]
  capability: Capability | 'nenhuma'; fuel: boolean
  damage?: number
  protection?: number
}
export type Stack = { item: string; quantity: number }
export type Slot = Stack | null
export const SLOT_COUNT = 32
export const fruitSeed = 'semente_da_horta'
export const harvestOnlyItems = ['agua', 'fruta', fruitSeed] as const
export const inventionKit: Readonly<Item> = { id: '@kit', name: 'Kit de invenção', emoji: '📦', kind: 'material', capability: 'nenhuma', fuel: false }
const itemEmojis = [
  '🏺', '🧺', '🪣', '🫙', '🪴', '🌱', '🍂', '🍃', '🍄', '🌾', '🌻', '🪷', '🌼', '🌸', '🪻', '🪹',
  '🌰', '🥜', '🌽', '🥕', '🍋', '🍊', '🍐', '🍇', '🫐', '🍒', '🍓', '🍯', '🧂', '🥖', '🫖', '🥣',
  '🧵', '🪡', '🧶', '🪢', '🪶', '🧻', '🧽', '🧴', '🪥', '🪮', '🧼', '🧹', '🪤', '🧲', '🪝', '⚙️',
  '🔧', '🔩', '🔨', '🪛', '🪚', '🪓', '🛠️', '⚒️', '⛏️', '✂️', '📏', '📐', '🗜️', '⚖️', '🛢️',
  '🕯️', '🏮', '🪔', '💡', '🔦', '🪞', '🖼️', '🖌️', '🎨', '🧸', '🎐', '🎏', '🪆', '🪭', '🪁',
  '🪑', '🛋️', '🛏️', '🪜', '🚪', '🗝️', '🔒', '🔔', '🧰', '🧳', '🛍️', '🎁', '📜', '📚', '📕',
  '📝', '✏️', '🧩', '💎', '🔮', '🫧', '🧊', '⚱️', '🗿', '🛖', '🏕️', '⛲', '🪬', '🧿', '⚗️',
] as const
export const recipeBookLimit = 64 + 2 * itemEmojis.length
const MAX_ITEMS = 64 + itemEmojis.length
const emojiKey = (value: string) => value.replace(/\uFE0F/g, '')

export function itemId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{1,21}$/.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value)
}

export function readItem(value: unknown): Item | null {
  const i = record(value)
  const damage = i?.damage === undefined ? 0 : i.damage
  const protection = i?.protection === undefined ? 0 : i.protection
  if (!i || !itemId(i.id) || !text(i.name, 30) || typeof i.emoji !== 'string'
    || !/^\p{Extended_Pictographic}\uFE0F?$/u.test(i.emoji)
    || !inList(i.kind, kinds) || !inList(i.capability, ['nenhuma', ...capabilities] as const)
    || typeof i.fuel !== 'boolean' || (i.kind === 'estacao') !== (i.capability !== 'nenhuma')
    || (i.kind !== 'material' && i.fuel) || !int(damage, 0, 20) || !int(protection, 0, 20)
    || ((damage > 0 || protection > 0) && i.kind !== 'objeto')) return null
  return { id: i.id, name: i.name.trim(), emoji: i.emoji, kind: i.kind, capability: i.capability, fuel: i.fuel,
    ...(damage ? { damage } : {}), ...(protection ? { protection } : {}) }
}

export class ItemCatalog {
  readonly #items = new Map<string, Item>()
  readonly #extras: Item[] = []

  constructor() {
    for (const value of seed) {
      const item = readItem(value)
      if (!item || this.#items.has(item.id)) throw new Error('Catálogo inicial de itens inválido.')
      this.#items.set(item.id, Object.freeze(item))
    }
  }

  static fromData(value: unknown): ItemCatalog | null {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) return null
    const catalog = new ItemCatalog()
    for (const raw of value) {
      const item = readItem(raw)
      if (!item || !catalog.add(item)) return null
    }
    return catalog
  }
  get(id: string): Readonly<Item> | undefined { return this.#items.get(id) }
  get all(): readonly Readonly<Item>[] { return [...this.#items.values()] }
  get freeEmojis() {
    const used = new Set(this.all.map(item => emojiKey(item.emoji)))
    return itemEmojis.filter(emoji => !used.has(emojiKey(emoji)))
  }
  allowsNewEmoji(emoji: string) { return this.freeEmojis.some(e => emojiKey(e) === emojiKey(emoji)) }
  stackLimit(id: string) { return id === inventionKit.id || this.get(id)?.kind === 'estacao' ? 1 : 16 }
  add(value: Item) {
    const item = readItem(value)
    if (!item || this.#items.has(item.id) || this.#items.size >= MAX_ITEMS) return false
    Object.freeze(item)
    this.#items.set(item.id, item)
    this.#extras.push(item)
    return true
  }
  toData(): Item[] { return this.#extras.map(item => ({ ...item })) }
}

export function readStack(value: unknown, max = 16): Stack | null {
  const s = record(value)
  return s && itemId(s.item) && int(s.quantity, 1, max) ? { item: s.item, quantity: s.quantity } : null
}
export class Inventory {
  readonly #catalog: ItemCatalog
  #slots: Slot[]

  constructor(catalog: ItemCatalog) {
    this.#catalog = catalog
    this.#slots = Array.from({ length: SLOT_COUNT }, () => null)
  }
  static fromData(value: unknown, catalog: ItemCatalog): Inventory | null {
    if (!Array.isArray(value) || value.length !== SLOT_COUNT) return null
    const inventory = new Inventory(catalog)
    for (const [index, raw] of value.entries()) {
      if (raw === null) continue
      const entry = record(raw)
      const slot = entry?.item === inventionKit.id && entry.quantity === 1 ? { item: inventionKit.id, quantity: 1 } : readStack(raw)
      if (!slot || (slot.item !== inventionKit.id && !catalog.get(slot.item)) || slot.quantity > catalog.stackLimit(slot.item)) return null
      inventory.#slots[index] = slot
    }
    return inventory
  }

  get slots(): Slot[] { return this.#slots.map(slot => slot && { ...slot }) }
  takeAll(): Slot[] {
    const slots = this.slots
    this.#slots = Array.from({ length: SLOT_COUNT }, () => null)
    return slots
  }
  fork(catalog = this.#catalog): Inventory {
    const next = new Inventory(catalog)
    next.#slots = this.slots
    return next
  }
  count(id: string) { return this.#slots.reduce((sum, slot) => sum + (slot?.item === id ? slot.quantity : 0), 0) }
  summarize(): Stack[] {
    const totals = new Map<string, number>()
    for (const slot of this.#slots) if (slot) totals.set(slot.item, (totals.get(slot.item) ?? 0) + slot.quantity)
    return [...totals].map(([item, quantity]) => ({ item, quantity }))
  }

  canExchange(inputs: readonly Stack[], outputs: readonly Stack[]) { return this.#exchange(inputs, outputs) !== null }
  exchange(inputs: readonly Stack[], outputs: readonly Stack[]): boolean {
    const slots = this.#exchange(inputs, outputs)
    if (!slots) return false
    this.#slots = slots
    return true
  }
  #exchange(inputs: readonly Stack[], outputs: readonly Stack[]): Slot[] | null {
    const copy = this.slots
    for (const stack of inputs) {
      if (!int(stack.quantity, 1, SLOT_COUNT * 16)) return null
      let remaining = stack.quantity
      for (let i = copy.length - 1; i >= 0 && remaining > 0; i--) {
        const slot = copy[i]
        if (slot?.item !== stack.item) continue
        const used = Math.min(slot.quantity, remaining)
        slot.quantity -= used
        remaining -= used
        if (!slot.quantity) copy[i] = null
      }
      if (remaining) return null
    }
    for (const stack of outputs) {
      if ((stack.item !== inventionKit.id && !this.#catalog.get(stack.item)) || !int(stack.quantity, 1, SLOT_COUNT * 16)) return null
      let remaining = stack.quantity
      const max = this.#catalog.stackLimit(stack.item)
      for (const slot of copy) {
        if (slot?.item !== stack.item) continue
        const added = Math.min(max - slot.quantity, remaining)
        slot.quantity += added
        remaining -= added
      }
      for (let i = 0; i < copy.length && remaining > 0; i++) {
        if (copy[i]) continue
        const quantity = Math.min(max, remaining)
        copy[i] = { item: stack.item, quantity }
        remaining -= quantity
      }
      if (remaining) return null
    }
    return copy
  }
}
