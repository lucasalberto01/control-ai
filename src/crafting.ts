import { inList, record } from './blueprint.ts'
import { capabilities, harvestOnlyItems, itemId, kinds, readItem, readStack, recipeBookLimit } from './inventory.ts'
import type { Capability, Inventory, Item, ItemCatalog, Stack } from './inventory.ts'
import type { Point } from './world-map.ts'
import { int, text } from './world-values.ts'
import { readComposition } from './modules.ts'
import type { Composition } from './modules.ts'
import { OutputStock } from './output-stock.ts'

export const processes = ['montar', ...capabilities] as const
export type Process = typeof processes[number]
export type RecipeDraft = {
  name: string; process: Process; inputs: Stack[]; fuel: Stack | null; output: Stack; newItem: Item | null
}
export type Recipe = RecipeDraft & { id: number; uses: number; pendingFirstPickup?: true }
export const PLACEMENT_LIMIT = 32
export type RecipeOptions = { inputs: string[]; fuels: string[]; processes: Process[]; emojis: string[]; outputs: string[] }

export function readRecipeOptions(value: unknown): RecipeOptions | null {
  const o = record(value)
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= recipeBookLimit && v.every(itemId)
  if (!o || !ids(o.inputs) || !o.inputs.length || !ids(o.fuels) || !ids(o.outputs) || !o.outputs.length
    || !Array.isArray(o.processes) || !o.processes.length || o.processes.length > processes.length
    || !o.processes.every(p => inList(p, processes))
    || !Array.isArray(o.emojis) || o.emojis.length > recipeBookLimit
    || !o.emojis.every(e => typeof e === 'string' && /^\p{Extended_Pictographic}\uFE0F?$/u.test(e))) return null
  const { inputs, fuels, processes: methods, emojis, outputs } = o
  if (fuels.some(fuel => !inputs.includes(fuel))) return null
  return { inputs, fuels, processes: methods, emojis, outputs }
}

const enumOf = (items: readonly string[]) => ({ type: 'string', enum: items })
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const idSchema = { type: 'string', pattern: '^[a-z][a-z0-9_]{1,21}$' }
const quantity = { type: 'integer', minimum: 1, maximum: 8 }
export function recipeSchema(options: RecipeOptions) {
  const itemIds = options.inputs
  const newItem = object({
    id: idSchema, name: { type: 'string', minLength: 2, maxLength: 30 }, emoji: enumOf(options.emojis),
    kind: enumOf(kinds), capability: enumOf(['nenhuma', ...capabilities]), fuel: { type: 'boolean' },
    damage: { type: 'integer', minimum: 0, maximum: 12 },
    protection: { type: 'integer', minimum: 0, maximum: 12 },
  })
  const existing = options.outputs.filter(id => !inList(id, harvestOnlyItems))
  const variants = options.processes.flatMap(process => {
    const heat = process === 'aquecer'
    const fuels = options.fuels
    if (heat && !fuels.length) return []
    const amount = heat ? { ...quantity, maximum: 3 } : quantity
    const stack = object({ item: enumOf(itemIds), quantity: amount })
    const base = {
      name: { type: 'string', minLength: 3, maxLength: 48 },
      process: enumOf([process]),
      inputs: { type: 'array', items: stack, minItems: 1, maxItems: 4 },
      fuel: heat ? object({ item: enumOf(fuels), quantity: amount }) : { type: 'null' },
    }
    const known = object({ ...base, output: object({ item: enumOf(existing), quantity }), newItem: { type: 'null' } })
    if (!options.emojis.length) return [known]
    // A fresh output id must always come with its newItem, otherwise the recipe is rejected.
    const fresh = object({ ...base, output: object({ item: idSchema, quantity }), newItem })
    return [known, fresh]
  })
  return variants.length === 1 ? variants[0] : { anyOf: variants }
}

export function readRecipeDraft(value: unknown): RecipeDraft | null {
  const raw = record(value)
  if (!raw || !text(raw.name, 48) || !inList(raw.process, processes)
    || !Array.isArray(raw.inputs) || raw.inputs.length < 1 || raw.inputs.length > 4) return null
  const inputs = raw.inputs.map(i => readStack(i, 8))
  const fuel = readStack(raw.fuel, 8)
  const output = readStack(raw.output, 8)
  const newItem = readItem(raw.newItem)
  if (!inputs.every((i): i is Stack => !!i) || new Set(inputs.map(i => i.item)).size !== inputs.length
    || !output || inputs.some(i => i.item === output.item) || fuel?.item === output.item
    || (raw.process === 'aquecer' ? !fuel : raw.fuel !== null)
    || (raw.newItem !== null && (!newItem || newItem.id !== output.item))
    || output.quantity > inputs.reduce((sum, i) => sum + i.quantity, 0)) return null
  return { name: raw.name.trim(), process: raw.process, inputs, fuel, output, newItem }
}

function signature(recipe: RecipeDraft) {
  return JSON.stringify([recipe.process, [...recipe.inputs].sort((a, b) => a.item.localeCompare(b.item)), recipe.fuel, recipe.output.item])
}

export class RecipeBook {
  readonly #recipes = new Map<number, Recipe>()
  static fromData(value: unknown, catalog: ItemCatalog, turn: number): RecipeBook | null {
    if (!Array.isArray(value) || value.length > recipeBookLimit) return null
    const book = new RecipeBook()
    for (const raw of value) {
      const source = record(raw)
      const draft = readRecipeDraft(raw)
      if (!source || !draft || !int(source.id, 1, turn) || !int(source.uses, 0, turn) || book.#recipes.has(source.id)
        || (source.pendingFirstPickup !== undefined && (source.pendingFirstPickup !== true || source.uses === 0))
        || book.#issue(draft, catalog, true)) return null
      book.#recipes.set(source.id, { ...draft, id: source.id, uses: source.uses,
        ...(source.pendingFirstPickup ? { pendingFirstPickup: true } : {}) })
    }
    return book
  }
  toData(): Recipe[] { return [...this.#recipes.values()].map(r => structuredClone(r)) }
  fork(): RecipeBook {
    const book = new RecipeBook()
    for (const [id, recipe] of this.#recipes) book.#recipes.set(id, { ...recipe })
    return book
  }
  get(id: number): Recipe | undefined {
    const recipe = this.#recipes.get(id)
    return recipe && structuredClone(recipe)
  }
  get full() { return this.#recipes.size >= recipeBookLimit }
  learnIssue(value: unknown, catalog: ItemCatalog): string | null {
    const draft = readRecipeDraft(value)
    if (!draft) return 'O formato da receita é inválido.'
    if (this.full) return 'O caderno de receitas está cheio.'
    return this.#issue(draft, catalog, false)
  }
  canLearn(value: unknown, catalog: ItemCatalog) {
    return this.learnIssue(value, catalog) === null
  }
  learn(value: unknown, catalog: ItemCatalog, id: number): Recipe | null {
    const draft = readRecipeDraft(value)
    if (!draft || this.#recipes.has(id) || !this.canLearn(draft, catalog)) return null
    if (draft.newItem && !catalog.add(draft.newItem)) return null
    const recipe = { ...draft, id, uses: 0 }
    this.#recipes.set(id, recipe)
    return structuredClone(recipe)
  }
  canCraft(id: number, inventory: Inventory, destination?: OutputStock, station?: CraftingStation): boolean {
    const r = this.#recipes.get(id)
    return !!r && !inList(r.output.item, harvestOnlyItems) && (r.process === 'montar' || station?.supports(r.process) === true)
      && destination?.canStore(r.output) === true && inventory.canExchange([...r.inputs, ...(r.fuel ? [r.fuel] : [])], [])
  }
  craft(id: number, inventory: Inventory, destination?: OutputStock, station?: CraftingStation): Recipe | null {
    const r = this.#recipes.get(id)
    if (!r || !destination || !this.canCraft(id, inventory, destination, station)
      || !inventory.exchange([...r.inputs, ...(r.fuel ? [r.fuel] : [])], [])) return null
    destination.store(r.output)
    if (!r.uses) r.pendingFirstPickup = true
    r.uses++
    return structuredClone(r)
  }
  acknowledgePickup(item: string) {
    for (const recipe of this.#recipes.values()) {
      if (recipe.output.item === item) delete recipe.pendingFirstPickup
    }
  }
  #issue(draft: RecipeDraft, catalog: ItemCatalog, loading: boolean): string | null {
    if (!loading && inList(draft.output.item, harvestOnlyItems)) return 'Água, frutas e sementes são obtidas no vale, não na bancada.'
    const output = catalog.get(draft.output.item)
    const unknown = draft.inputs.find(input => !catalog.get(input.item))
    if (unknown) return `Insumo fora do catálogo: ${unknown.item}.`
    if (draft.fuel && !catalog.get(draft.fuel.item)?.fuel) return `Combustível inválido: ${draft.fuel.item}.`
    if (draft.newItem) {
      if (loading && (!output || JSON.stringify(output) !== JSON.stringify(draft.newItem))) return 'Item novo não confere com o catálogo.'
      if (!loading && output) return `O item ${output.name} já existe no catálogo.`
      if (!loading && !catalog.allowsNewEmoji(draft.newItem.emoji)) return 'Escolha um emoji livre do catálogo.'
    } else if (!output) return `Resultado fora do catálogo: ${draft.output.item}.`
    if ([...this.#recipes.values()].some(recipe => signature(recipe) === signature(draft))) return 'Receita já conhecida.'
    return null
  }
}

export type Installed = { item: string; at: Point; turn: number; aparencia?: Composition; stock?: Stack[] }

export class CraftingStation {
  readonly #entry: Omit<Installed, 'stock'>
  readonly #item: Readonly<Item>
  readonly output: OutputStock
  private constructor(entry: Omit<Installed, 'stock'>, item: Readonly<Item>, output: OutputStock) {
    this.#entry = entry
    this.#item = item
    this.output = output
  }
  static fromData(value: unknown, catalog: ItemCatalog, turn: number) {
    const d = record(value)
    const at = record(d?.at)
    const item = itemId(d?.item) ? catalog.get(d.item) : undefined
    const appearance = readComposition(d?.aparencia)
    const output = OutputStock.fromData(d?.stock, catalog)
    if (!d || !at || !int(at.x) || !int(at.y) || !int(d.turn, 1, turn) || !item || item.kind === 'material'
      || !output || (item.kind !== 'estacao' && output.data.length) || (d.aparencia !== undefined && !appearance)) return null
    return new CraftingStation({ item: item.id, at: { x: at.x, y: at.y }, turn: d.turn,
      ...(appearance ? { aparencia: appearance } : {}) }, item, output)
  }
  get name() { return this.#item.name }
  get at(): Point { return { ...this.#entry.at } }
  get kind() { return this.#item.kind }
  get item() { return this.#entry.item }
  get turn() { return this.#entry.turn }
  supports(capability: Capability) { return this.kind === 'estacao' && this.#item.capability === capability }
  toData(): Installed {
    const stock = this.output.data
    return { ...structuredClone(this.#entry), ...(stock.length ? { stock } : {}) }
  }
  fork() { return new CraftingStation(this.#entry, this.#item, this.output.fork()) }
  withAppearance(look: Composition) {
    return new CraftingStation({ ...this.#entry, aparencia: structuredClone(look) }, this.#item, this.output.fork())
  }
}
