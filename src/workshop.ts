import { CraftingStation, PLACEMENT_LIMIT, RecipeBook } from './crafting.ts'
import type { Installed, Recipe, RecipeDraft } from './crafting.ts'
import { ItemCatalog } from './inventory.ts'
import type { Inventory, Item, Stack } from './inventory.ts'
import { same } from './world-map.ts'
import type { Point } from './world-map.ts'
import type { Composition } from './modules.ts'
import { OutputStock } from './output-stock.ts'

export type WorkshopData = {
  items: Item[]; recipes: Recipe[]; installed: Installed[]; benchStock?: Stack[]
}

/** Shared bench, stations and recipe book. Each character brings its own backpack. */
export class Workshop {
  readonly catalog: ItemCatalog
  readonly book: RecipeBook
  readonly #installed: CraftingStation[]
  readonly #bench: OutputStock

  private constructor(catalog: ItemCatalog, book: RecipeBook, installed: CraftingStation[], bench: OutputStock) {
    this.catalog = catalog
    this.book = book
    this.#installed = installed
    this.#bench = bench
  }

  static create() {
    return new Workshop(new ItemCatalog(), new RecipeBook(), [], new OutputStock())
  }

  static fromData(data: Record<string, unknown>, turn: number) {
    const catalog = ItemCatalog.fromData(data.items)
    const book = catalog && RecipeBook.fromData(data.recipes, catalog, turn)
    const bench = catalog && OutputStock.fromData(data.benchStock, catalog)
    if (!catalog || !book || !bench || !Array.isArray(data.installed) || data.installed.length > PLACEMENT_LIMIT) return null
    const stations: CraftingStation[] = []
    const installationTurns = new Set<number>()
    for (const raw of data.installed) {
      const station = CraftingStation.fromData(raw, catalog, turn)
      if (!station || stations.some(s => same(s.at, station.at)) || installationTurns.has(station.turn)) return null
      installationTurns.add(station.turn)
      stations.push(station)
    }
    const workshop = new Workshop(catalog, book, stations, bench)
    return book.toData().some(recipe => recipe.pendingFirstPickup && !workshop.hasOutput(recipe.output.item)) ? null : workshop
  }

  toData(): WorkshopData {
    const benchStock = this.benchStock
    return { items: this.catalog.toData(), recipes: this.book.toData(), installed: this.installed,
      ...(benchStock.length ? { benchStock } : {}) }
  }
  get benchStock() { return this.#bench.data }
  get installed(): Installed[] { return this.#installed.map(s => s.toData()) }
  fork(): Workshop {
    const catalog = ItemCatalog.fromData(this.catalog.toData())!
    return new Workshop(catalog, this.book.fork(), this.#installed.map(s => s.fork()), this.#bench.fork())
  }

  locations(process: RecipeDraft['process'], bench: Point): Point[] {
    return process === 'montar' ? [bench] : this.#installed.filter(s => s.supports(process)).map(s => s.at)
  }

  canCraft(recipe: Recipe, at: Point, bench: Point, inventory: Inventory) {
    const station = this.#installed.find(s => same(s.at, at))
    const stock = recipe.process === 'montar' ? (same(at, bench) ? this.#bench : undefined) : station?.output
    return this.book.canCraft(recipe.id, inventory, stock, station)
  }
  craft(id: number, at: Point, bench: Point, inventory: Inventory) {
    const recipe = this.book.get(id)
    if (!recipe) return null
    const station = this.#installed.find(s => same(s.at, at))
    const stock = recipe.process === 'montar' ? (same(at, bench) ? this.#bench : undefined) : station?.output
    return this.book.craft(id, inventory, stock, station)
  }
  hasOutput(item: string) {
    return this.benchStock.some(s => s.item === item) || this.#installed.some(s => s.output.data.some(entry => entry.item === item))
  }
  #pickupStock(source: number, at: Point, bench: Point) {
    if (source === 0) return same(at, bench) ? this.#bench : undefined
    const station = this.#installed.find(s => s.turn === source && same(s.at, at))
    return station?.output
  }
  canPickup(source: number, at: Point, bench: Point, item: string, inventory: Inventory) {
    return (this.#pickupStock(source, at, bench)?.collectable(item, inventory) ?? 0) > 0
  }
  pickup(source: number, at: Point, bench: Point, item: string, inventory: Inventory) {
    const stock = this.#pickupStock(source, at, bench)
    const quantity = stock?.collect(item, inventory) ?? 0
    if (quantity) this.book.acknowledgePickup(item)
    return quantity
  }
  canInstall(item: string, inventory: Inventory) {
    const entry = this.catalog.get(item)
    return !!entry && entry.kind !== 'material' && (entry.damage ?? 0) === 0 && (entry.protection ?? 0) === 0
      && this.#installed.length < PLACEMENT_LIMIT && inventory.count(item) > 0
  }
  install(item: string, at: Point, turn: number, appearance: Composition, inventory: Inventory) {
    if (!this.canInstall(item, inventory) || this.#installed.some(s => same(s.at, at))) return false
    const station = CraftingStation.fromData({ item, at, turn, aparencia: appearance }, this.catalog, turn)
    if (!station || !inventory.exchange([{ item, quantity: 1 }], [])) return false
    this.#installed.push(station)
    return true
  }
  setAppearance(turn: number, look: Composition) {
    const index = this.#installed.findIndex(s => s.turn === turn)
    if (index >= 0) this.#installed[index] = this.#installed[index].withAppearance(look)
  }
}
