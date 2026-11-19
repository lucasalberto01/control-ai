import seed from './data/world.seed.json' with { type: 'json' }
import { hasWaterSupply, inList, readBlueprint, record, resources } from './blueprint.ts'
import type { Bag, Blueprint, Renovation } from './blueprint.ts'
import { Character, fighterNames } from './character.ts'
import type { CharacterId } from './character.ts'
import { Animal, ANIMAL_BITE_EVERY, ANIMAL_DAMAGE } from './animal.ts'
import type { AnimalData } from './animal.ts'
import { Drop } from './drop.ts'
import type { DropData } from './drop.ts'
import { Invention } from './invention.ts'
import type { BuildState } from './invention.ts'
import { Workshop } from './workshop.ts'
import type { WorkshopData } from './workshop.ts'
import { naturalItems, Terrain } from './terrain.ts'
import type { NaturalItem } from './terrain.ts'
import { processes, readRecipeDraft } from './crafting.ts'
import type { Process, Recipe, RecipeDraft, RecipeOptions } from './crafting.ts'
import { Inventory, fruitSeed, harvestOnlyItems, inventionKit } from './inventory.ts'
import type { ItemCatalog, Slot, Stack } from './inventory.ts'
import { pointKey, same, WorldMap } from './world-map.ts'
import type { Point } from './world-map.ts'
import { int, limit, metrics, text } from './world-values.ts'
import { appearanceFor, installedAppearance, workbenchAppearance } from './appearance.ts'
import { primaryRules } from './identity.ts'
import { appearanceKey, AppearanceRegistry } from './appearance-registry.ts'
import type { Composition } from './modules.ts'
import { updateHealth } from './vitals.ts'
import type { Vitals } from './vitals.ts'
import { readProject, readTopic } from './research.ts'
import type { ResearchProject, ResearchTopic } from './research.ts'

export type { Point } from './world-map.ts'
export { fighterNames } from './character.ts'
type LogEntry = { text: string; minute: number }
type Progress = { turn: number; minute: number; log: LogEntry[]; active: number; lastExpand: number }
export type DroughtInfo = { phase: 'none' | 'warning' | 'active'; in: number; until: number }
export type Postpone = 'idea' | 'workshop' | 'water'

type LegacyFields = {
  position: Point
  vitals: Vitals
  inventory: Slot[]
  xp: number
  alive: boolean
  equipment?: string
  rawUntil?: number
  nextIdea: number
  nextWaterIdea: number
  nextWorkshop: number
  lastAction: string
  walks: number
  kit?: { plan: Blueprint; plot: Point; atBench?: true }
  research?: ResearchTopic
  project?: ResearchProject
  projectSince?: number
}
export type WorldState = Progress & WorkshopData & LegacyFields & {
  rival?: ReturnType<Character['toData']>
  animals?: AnimalData[]
  drops?: DropData[]
  builds: BuildState[]
  terrain: ReturnType<Terrain['toData']>
}

type AttackTarget = { kind: 'character'; id: CharacterId } | { kind: 'animal'; id: number }
type ActionDetails =
  | { kind: 'rest' | 'drink' | 'water' | 'plant' | 'walk' | 'wait' }
  | { kind: 'eat'; food?: 'fruta' | 'carne_assada' }
  | { kind: 'cook' }
  | { kind: 'invent'; water?: boolean }
  | { kind: 'gather'; resource: NaturalItem; source: Point; quantity: number }
  | { kind: 'research' }
  | { kind: 'visit_research'; topic: ResearchTopic }
  | { kind: 'finish_research' }
  | { kind: 'archive_project' }
  | { kind: 'record_project'; project: ResearchProject }
  | { kind: 'learn'; recipe: RecipeDraft }
  | { kind: 'craft'; recipeId: number }
  | { kind: 'pickup'; source: 'workshop' | 'invention'; sourceId: number; item: string }
  | { kind: 'pickup_kit' }
  | { kind: 'install'; item: string }
  | { kind: 'assemble'; plan: Blueprint; plot: Point }
  | { kind: 'build' }
  | { kind: 'renovate'; objectId: number }
  | { kind: 'renovation'; objectId: number; upgrade: Renovation }
  | { kind: 'use'; objectId: number }
  | { kind: 'attack'; target: AttackTarget }
  | { kind: 'equip'; item: string }
  | { kind: 'drop'; item: string; quantity: number }
  | { kind: 'take'; dropId: number }
  | { kind: 'repair'; objectId: number }
  | { kind: 'demolish'; objectId: number }
  | { kind: 'expand' }
export type Action = ActionDetails & { id: string; label: string; at: Point; score: number }

export function clock(minute: number) {
  const day = Math.floor(minute / 1440) + 1
  const h = String(Math.floor(minute % 1440 / 60)).padStart(2, '0')
  const m = String(minute % 60).padStart(2, '0')
  return { day, time: `${h}:${m}` }
}

const FISTS = 2
const ANIMAL_XP = 12
const CRAFT_XP = 2
const GATHER_XP = 1
const USE_XP = 2
const REPAIR_XP = 2
const DEMOLISH_XP = 3
const EXPAND_XP = 5
const EXPAND_COOLDOWN = 45
const ANIMAL_TARGET = 4
const ANIMAL_SPAWN_EVERY = 8
const RAW_MEAT_LIFE = 12
const DROUGHT_CYCLE = 120
const DROUGHT_WARNING = 78
const DROUGHT_START = 90
const DROUGHT_END = 110
const MAX_MAP_SIDE = 16
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** Ordena os tiles de forma estável, mas diferente a cada turno, para a fauna não nascer sempre no mesmo canto. */
const spawnRank = (at: Point, seed: number) => {
  let hash = Math.imul(at.x + 17, 374761393) ^ Math.imul(at.y + 31, 668265263) ^ Math.imul(seed + 7, 2147483647)
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

function pickSpawnSpots(tiles: readonly Point[], count: number, seed: number) {
  const ranked = [...tiles].sort((a, b) => spawnRank(a, seed) - spawnRank(b, seed))
  const chosen: Point[] = []
  for (const at of ranked) {
    if (chosen.every(other => distance(other, at) >= 2)) chosen.push(at)
    if (chosen.length === count) return chosen
  }
  for (const at of ranked) {
    if (!chosen.includes(at)) chosen.push(at)
    if (chosen.length === count) break
  }
  return chosen
}

export class World {
  readonly #map: WorldMap
  readonly #progress: Progress
  readonly #characters: Character[]
  readonly #inventions: Invention[]
  readonly #workshop: Workshop
  readonly #terrain: Terrain
  readonly #animals: Animal[]
  readonly #drops: Drop[]

  private constructor(map: WorldMap, progress: Progress, characters: Character[], inventions: Invention[],
    workshop: Workshop, terrain: Terrain, animals: Animal[], drops: Drop[]) {
    this.#map = map
    this.#progress = progress
    this.#characters = characters
    this.#inventions = inventions
    this.#workshop = workshop
    this.#terrain = terrain
    this.#animals = animals
    this.#drops = drops
  }

  static create(): World {
    const map = WorldMap.fromData(seed.map)
    const initial = record(seed.initial)
    const { minute, position, arrival } = initial ?? {}
    const workshop = Workshop.create()
    if (seed.version !== 1 || !map || !int(minute, 0, 1439) || !text(arrival, 320)
      || !map.isWalkable(position) || !map.pathTo(position, map.findSite('casa').area[0])) {
      throw new Error('Configuração inicial do vale inválida.')
    }
    const laya = Character.create('laya', position, workshop.catalog, 0)
    const home = map.findSite('casa').area[0]
    const kaelAt = same(home, position) ? World.#freeNeighbor(map, home) : home
    const kael = kaelAt && Character.create('kael', kaelAt, workshop.catalog, 0)
    if (!laya || !kael) throw new Error('Configuração inicial do vale inválida.')
    const animals = World.#spawnAnimals(map, [], [], 2)
    return new World(map, {
      turn: 0, minute, log: [{ text: arrival, minute }], active: 0, lastExpand: 0,
    }, [laya, kael], [], workshop, new Terrain(map), animals, [])
  }

  static fromState(map: WorldMap, value: unknown): World | null {
    const state = record(value)
    if (!state || !int(state.turn) || !int(state.minute)
      || !Array.isArray(state.builds) || state.builds.length > map.buildLimit
      || !Array.isArray(state.log) || state.log.length > 24) return null
    const { turn, minute } = state
    const lastExpand = state.lastExpand === undefined ? 0 : state.lastExpand
    if (!int(lastExpand, 0, turn)) return null
    const modern = state.inventory !== undefined
    const workshop = modern ? Workshop.fromData(state, turn) : Workshop.create()
    if (!workshop) return null
    const terrain = modern ? Terrain.fromData(state.terrain, map) : new Terrain(map)
    if (!terrain) return null
    const catalog = workshop.catalog

    let layaSource: Record<string, unknown> = state
    if (!modern) {
      const bag = metrics(state.bag, resources, 12)
      const inventory = bag && World.#inventoryFromBag(catalog, bag)
      if (!inventory) return null
      layaSource = { ...state, bag: undefined, inventory: inventory.slots }
    }
    const laya = Character.fromData(layaSource, catalog, map, turn, 'laya')
    if (!laya) return null

    const rivalSource = state.rival === undefined ? null : record(state.rival)
    const home = map.findSite('casa').area[0]
    const kael = rivalSource
      ? Character.fromData({ ...rivalSource, name: rivalSource.name ?? fighterNames.kael }, catalog, map, turn, 'kael')
      : World.#freshKael(map, laya.at, catalog, turn)
    if (!kael) return null
    for (const character of [laya, kael]) {
      if (character.inventory.count('carne_crua') > 0 && character.rawUntil === undefined) {
        character.rawUntil = turn + RAW_MEAT_LIFE
      }
    }

    const active = state.active === undefined ? 0 : state.active
    if (!int(active, 0, 1)) return null
    const water = (p: Point) => terrain.water(p) > 0
    for (const character of [laya, kael]) {
      if (!map.pathTo(character.at, home, water)) return null
    }

    const inventions: Invention[] = []
    const ids = new Set<number>()
    const occupied = new Set<string>()
    for (const item of state.builds) {
      const invention = Invention.fromData(item, turn)
      if (!invention) return null
      const { id, at } = invention
      const key = pointKey(at)
      if (ids.has(id) || occupied.has(key) || !map.isBuildTile(at, !water(at)) || !map.pathTo(home, at, water)
        || invention.toData().plan.materiais?.some(m => catalog.get(m.item)?.kind !== 'material')) return null
      ids.add(id)
      occupied.add(key)
      inventions.push(invention)
    }
    for (const character of [laya, kael]) {
      if ((character.research?.kind === 'renovation' && !ids.has(character.research.objectId))
        || (character.project?.kind === 'renovation' && !ids.has(character.project.objectId))) return null
    }
    const installed = workshop.installed
    for (const entry of installed) {
      const { at } = entry
      if (occupied.has(pointKey(at)) || !map.isBuildTile(at, !water(at)) || terrain.tree(at) === 'em_pe'
        || !map.pathTo(home, at, water)) return null
      occupied.add(pointKey(at))
    }
    const looks = [
      { turn: 0, look: workbenchAppearance, replace: () => {} },
      ...inventions.map(invention => ({ turn: invention.id, look: invention.appearance,
        replace: (look: Composition) => invention.setAppearance(look) })),
      ...installed.map(entry => ({ turn: entry.turn, look: entry.aparencia ?? installedAppearance(catalog.get(entry.item)!),
        replace: (look: Composition) => workshop.setAppearance(entry.turn, look) })),
    ].sort((a, b) => a.turn - b.turn)
    const gallery = new AppearanceRegistry(looks.map(entry => entry.look))
    const seen = new Set<string>()
    for (const { look, replace } of looks) {
      const key = appearanceKey(look)
      if (!seen.has(key)) {
        seen.add(key)
        continue
      }
      const unique = gallery.available(look)
      if (!unique) return null
      replace(unique)
      gallery.reserve(unique)
    }

    const animals: Animal[] = []
    if (state.animals !== undefined) {
      if (!Array.isArray(state.animals) || state.animals.length > 6) return null
      const animalIds = new Set<number>()
      const animalKeys = new Set<string>()
      for (const raw of state.animals) {
        const animal = Animal.fromData(raw, map, turn)
        if (!animal || animalIds.has(animal.id) || animalKeys.has(pointKey(animal.at))) return null
        animalIds.add(animal.id)
        animalKeys.add(pointKey(animal.at))
        animals.push(animal)
      }
    } else {
      animals.push(...World.#spawnAnimals(map, [laya, kael], inventions, 2, workshop.installed.map(entry => entry.at), turn))
    }
    const drops: Drop[] = []
    if (state.drops !== undefined) {
      if (!Array.isArray(state.drops) || state.drops.length > 8) return null
      const dropIds = new Set<number>()
      for (const raw of state.drops) {
        const drop = Drop.fromData(raw, catalog, map)
        if (!drop || dropIds.has(drop.id)) return null
        dropIds.add(drop.id)
        drops.push(drop)
      }
    }

    const log: LogEntry[] = []
    for (const item of state.log) {
      const entry = record(item)
      if (!entry || !text(entry.text, 400) || !int(entry.minute, 0, minute)) return null
      log.push({ text: entry.text, minute: entry.minute })
    }
    return new World(map, { turn, minute, log, active, lastExpand }, [laya, kael], inventions, workshop, terrain, animals, drops)
  }

  static #inventoryFromBag(catalog: ItemCatalog, bag: Bag) {
    const inventory = new Inventory(catalog)
    const items = Object.entries(bag).filter(([, quantity]) => quantity > 0).map(([item, quantity]) => ({ item, quantity }))
    return inventory.exchange([], items) ? inventory : null
  }

  static #freshKael(map: WorldMap, layaAt: Point, catalog: ItemCatalog, turn: number) {
    const home = map.findSite('casa').area[0]
    const at = same(home, layaAt) ? World.#freeNeighbor(map, home) : home
    return at ? Character.create('kael', at, catalog, turn) : null
  }

  static #freeNeighbor(map: WorldMap, at: Point): Point | undefined {
    return [{ x: at.x + 1, y: at.y }, { x: at.x - 1, y: at.y }, { x: at.x, y: at.y + 1 }, { x: at.x, y: at.y - 1 }]
      .find(point => map.isWalkable(point) && map.pathTo(point, map.findSite('casa').area[0]))
  }

  static #spawnAnimals(map: WorldMap, characters: readonly Character[], inventions: readonly Invention[], count: number,
    installed: readonly Point[] = [], seed = 0) {
    if (count <= 0) return []
    const woods = map.findSite('bosque').area[0]
    const home = map.findSite('casa').area[0]
    const blocked = new Set([
      ...characters.map(character => pointKey(character.at)),
      ...inventions.map(invention => pointKey(invention.at)),
      ...installed.map(at => pointKey(at)),
      ...map.sites.flatMap(site => site.area.map(pointKey)), ...map.trees.map(pointKey),
      pointKey(home), pointKey(map.workbench), pointKey(map.researchTable),
      pointKey(map.fruitTree),
    ])
    const spots = pickSpawnSpots(map.tiles
      .filter(at => !blocked.has(pointKey(at)) && map.isWalkable(at) && map.pathTo(woods, at))
      .filter(at => characters.every(character => distance(character.at, at) >= 3))
      .filter(at => distance(home, at) >= 3), count, seed)
    return spots.map((at, index) => Animal.create(index + 1, at))
  }

  // ---- world and characters ------------------------------------------------

  get map() { return this.#map }
  get turn() { return this.#progress.turn }
  get minute() { return this.#progress.minute }
  get characters(): readonly Character[] { return this.#characters }
  get active(): Character { return this.#characters[this.#progress.active] }
  get activeId(): CharacterId { return this.active.id }
  get opponent(): Character { return this.#characters[1 - this.#progress.active] }
  get hasLivingCharacter() { return this.#characters.some(character => character.alive) }
  get animals() { return this.#animals.map(animal => animal.toData()) }
  get drops() { return this.#drops.map(drop => drop.toData()) }
  get position(): Point { return { ...this.active.at } }
  get vitals(): Readonly<Vitals> { return { ...this.active.vitals } }
  get bag(): Readonly<Bag> { return this.active.bag }
  get inventory() { return this.active.inventory.slots }
  get xp() { return this.active.xp }
  get items() { return this.#workshop.catalog.all }
  get recipes() { return this.#workshop.book.toData() }
  get installed() { return this.#workshop.installed }
  get workbench() { return this.map.workbench }
  get researchTable() { return this.map.researchTable }
  get researchTopic() { return this.active.research && { ...this.active.research } }
  get researchProject() { return this.active.project && structuredClone(this.active.project) }
  get benchStock() { return this.#workshop.benchStock }
  get benchKit() { return this.active.kit?.atBench ? this.active.kit.plan.nome : undefined }
  get gardenStage() { return this.#terrain.gardenStage }
  get lakeReserve() { return this.map.tiles.reduce((sum, at) => sum + this.water(at), 0) }
  get lastAction() { return this.active.lastAction }
  get weather() {
    const weather = this.map.weatherAt(this.minute)
    return this.#droughtInfo().phase === 'active' ? { ...weather, rain: false } : weather
  }
  get drought(): DroughtInfo { return this.#droughtInfo() }
  get time() { return clock(this.minute) }
  get log(): readonly LogEntry[] { return this.#progress.log.map(entry => ({ ...entry })) }
  get builds(): readonly BuildState[] { return this.#inventions.map(invention => invention.toData()) }
  item(id: string) {
    if (id === inventionKit.id) return this.active.kit && { ...inventionKit, name: `Kit: ${this.active.kit.plan.nome}` }
    return this.#workshop.catalog.get(id)
  }
  itemCounts() { return this.active.inventory.summarize().filter(stack => stack.item !== inventionKit.id) }
  surface(at: Point) { return this.#terrain.surface(at) }
  tree(at: Point) { return this.#terrain.tree(at) }
  water(at: Point) { return this.#terrain.water(at) }
  harvestable(at: Point, item: NaturalItem) { return this.#terrain.available(at, item) }
  character(id: CharacterId) { return this.#characters.find(character => character.id === id) }

  toState(): WorldState {
    const [laya, kael] = this.#characters
    const layaData = laya.toData()
    const kaelData = kael.toData()
    return {
      ...this.#progress, ...this.#workshop.toData(),
      position: layaData.at, vitals: layaData.vitals, inventory: layaData.bag, xp: layaData.xp,
      alive: layaData.alive, ...(layaData.equipment ? { equipment: layaData.equipment } : {}),
      ...(layaData.rawUntil !== undefined ? { rawUntil: layaData.rawUntil } : {}),
      nextIdea: layaData.nextIdea, nextWaterIdea: layaData.nextWaterIdea, nextWorkshop: layaData.nextWorkshop,
      lastAction: layaData.lastAction, walks: layaData.walks,
      ...(layaData.kit ? { kit: layaData.kit } : {}),
      ...(layaData.research ? { research: layaData.research } : {}),
      ...(layaData.project ? { project: layaData.project } : {}),
      ...(layaData.projectSince !== undefined ? { projectSince: layaData.projectSince } : {}),
      rival: kaelData,
      animals: this.animals,
      drops: this.drops,
      log: [...this.log], builds: [...this.builds], terrain: this.#terrain.toData(),
    }
  }

  // ---- helpers -------------------------------------------------------------

  pathTo(to: Point) { return this.map.pathTo(this.active.at, to, p => !!this.water(p)) }
  constructionTiles() {
    const occupied = [this.workbench, this.researchTable, this.map.fruitTree, ...this.#characters.map(c => c.at),
      ...this.#inventions.map(b => b.at), ...this.installed.map(s => s.at),
      ...this.map.tiles.filter(p => this.tree(p) === 'em_pe')]
    return this.map.availablePlots(this.active.at, occupied, 8, p => !!this.water(p))
  }
  describePlot(at: Point): string {
    const landmarks = this.#inventions.filter(b => b.kind === 'lugar').map(b => ({ name: b.name, area: [b.at] }))
    const name = this.map.closestLandmark(at, landmarks)
    return name ? `perto de ${name}` : 'terreno livre'
  }
  canBuild(plan: Blueprint, at: Point): boolean { return this.previewAssembly(plan, at) !== null }

  #blockedTiles(extra: readonly Point[] = []) {
    return new Set([
      this.workbench, this.researchTable, ...this.#inventions.map(b => b.at), ...this.installed.map(s => s.at),
      ...this.#characters.map(character => character.at), ...this.#animals.map(animal => animal.at), ...extra,
    ].map(pointKey))
  }

  #canPlace(plan: Blueprint, at: Point) {
    const identity = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const name = identity(plan.nome)
    return this.#inventions.length < this.map.buildLimit
      && name.length >= 2 && !this.#inventions.some(b => identity(b.name) === name)
      && this.map.contains(at) && this.map.isBuildTile(at, !this.water(at)) && !this.water(at)
      && !same(at, this.workbench) && !same(at, this.researchTable) && !same(at, this.map.fruitTree)
      && this.tree(at) !== 'em_pe' && !!this.pathTo(at)
      && !this.#inventions.some(b => same(b.at, at)) && !this.installed.some(s => same(s.at, at))
      && !this.#characters.some(character => same(character.at, at))
  }

  #kitCost(plan: Blueprint) { return plan.materiais ?? this.#materialCost(plan.custo) }
  #kitOutput() { return [{ item: inventionKit.id, quantity: 1 }] }

  previewAssembly(plan: Blueprint, at: Point): Blueprint | null {
    const validated = readBlueprint(plan)
    if (!validated || this.active.kit || !this.#canPlace(validated, at) || !this.pathTo(this.workbench)
      || validated.materiais?.some(m => m.item === fruitSeed || this.#workshop.catalog.get(m.item)?.kind !== 'material')
      || !this.active.inventory.canExchange(this.#kitCost(validated), [])) return null
    return { ...validated, regras: primaryRules(validated) }
  }

  previewBuild(at: Point): Blueprint | null {
    const plan = this.active.kit?.plan
    if (!plan || this.active.kit?.atBench || !this.#canPlace(plan, at)) return null
    const look = appearanceFor(plan)
    const distinct = this.#appearanceRegistry().available(look)
    return distinct === look ? structuredClone(plan) : distinct ? { ...structuredClone(plan), aparencia: distinct } : null
  }

  #appearanceRegistry(except?: number): AppearanceRegistry {
    return new AppearanceRegistry([
      workbenchAppearance,
      ...this.#inventions.filter(b => b.id !== except).map(b => b.appearance),
      ...this.installed.map(s => s.aparencia ?? installedAppearance(this.item(s.item)!)),
    ])
  }

  #installationLook(id: string): Composition | null {
    const item = this.item(id)
    return item ? this.#appearanceRegistry().available(installedAppearance(item)) : null
  }

  mustPrioritize(action: Action): boolean {
    return action.score >= 100 || (action.kind === 'research' && this.turn >= this.active.nextWorkshop + 2)
      || ((action.kind === 'invent' || action.kind === 'renovate') && this.turn >= this.active.nextIdea + 2)
  }

  previewRenovation(id: number, upgrade: Renovation): Blueprint | null {
    const target = this.#renovationTarget(id)
    return target ? this.#prepareRenovation(target, upgrade)?.plan ?? null : null
  }

  #renovationTarget(id: number) {
    return this.#inventions.find(b => b.id === id && b.canRenovate(this.turn))
  }

  #canAfford(cost: Blueprint['custo']): boolean {
    const bag = this.bag
    return bag.madeira >= cost.madeira && bag.pedra >= cost.pedra
  }

  availableMaterials() {
    const found = new Set(this.itemCounts().map(s => s.item))
    const collectable = new Set<NaturalItem>()
    const blocked = this.#blockedTiles()
    blocked.delete(pointKey(this.active.at))
    for (const item of naturalItems) {
      if (this.map.tiles.some(at => !blocked.has(pointKey(at)) && this.harvestable(at, item) > 0
        && this.#gatherLocations(at, item).some(p => this.pathTo(p)))) collectable.add(item)
    }
    for (const item of collectable) found.add(item)
    if (collectable.has('agua')) found.add('areia')
    if (collectable.has('grama')) found.add('terra')
    return [...found]
  }

  #locations(process: Process) {
    return this.#workshop.locations(process, this.workbench).filter(p => this.pathTo(p) !== null)
  }

  recipeOptions(): RecipeOptions {
    const reachable = processes.filter(process => this.#locations(process).length > 0)
    const sources = new Set(this.availableMaterials())
    for (const place of this.#workshopStocks()) {
      if (this.pathTo(place.at)) for (const stack of place.stock) sources.add(stack.item)
    }
    const known = this.recipes.filter(r => reachable.includes(r.process) && !inList(r.output.item, harvestOnlyItems))
    for (let changed = true; changed;) {
      changed = false
      for (const r of known) {
        if (!sources.has(r.output.item) && [...r.inputs, ...(r.fuel ? [r.fuel] : [])].every(i => sources.has(i.item))) {
          sources.add(r.output.item)
          changed = true
        }
      }
    }
    const inputs = [...sources].filter(id => id !== fruitSeed && this.item(id)?.kind === 'material')
    const fuels = inputs.filter(id => this.item(id)?.fuel)
    return { inputs, fuels, processes: reachable,
      emojis: this.#workshop.catalog.freeEmojis, outputs: this.items.map(item => item.id) }
  }

  recipeIssue(value: unknown): string | null {
    const recipe = readRecipeDraft(value)
    if (!recipe) return 'O formato da receita é inválido.'
    const issue = this.#workshop.book.learnIssue(recipe, this.#workshop.catalog)
    if (issue) return issue
    if (!this.#locations(recipe.process).length) return `Falta uma estação acessível para ${recipe.process}.`
    const options = this.recipeOptions()
    const missing = recipe.inputs.find(i => !options.inputs.includes(i.item))
    if (missing) return `Insumo indisponível no vale: ${this.item(missing.item)?.name ?? missing.item}.`
    if (recipe.fuel && !options.fuels.includes(recipe.fuel.item)) return `Combustível indisponível: ${this.item(recipe.fuel.item)?.name ?? recipe.fuel.item}.`
    return null
  }

  canLearn(recipe: RecipeDraft) { return this.recipeIssue(recipe) === null }

  #gatherLocations(source: Point, item: NaturalItem): Point[] {
    return item === 'agua' ? [
      { x: source.x + 1, y: source.y }, { x: source.x - 1, y: source.y },
      { x: source.x, y: source.y + 1 }, { x: source.x, y: source.y - 1 },
    ] : [source]
  }

  #gatherAction(item: NaturalItem, score: number): Action | null {
    const inventory = this.active.inventory
    const blocked = this.#blockedTiles()
    blocked.delete(pointKey(this.active.at))
    let best: { source: Point; at: Point; quantity: number; distance: number } | undefined
    for (const source of this.map.tiles) {
      if (blocked.has(pointKey(source))) continue
      let quantity = Math.min(item === 'agua' ? 2 : 3, this.harvestable(source, item))
      while (quantity > 0 && !inventory.canExchange([], [{ item, quantity }])) quantity--
      if (!quantity) continue
      for (const at of this.#gatherLocations(source, item)) {
        const route = this.pathTo(at)
        if (route && (!best || route.length < best.distance)) best = { source, at, quantity, distance: route.length }
      }
    }
    if (!best) return null
    const label = item === 'fruta' ? `Colher frutas ${same(best.source, this.map.fruitTree) ? 'da árvore' : 'da horta'}`
      : `Coletar ${this.item(item)?.name ?? item} (${best.source.x},${best.source.y})`
    return { id: item, kind: 'gather', resource: item, at: best.at, source: best.source, quantity: best.quantity, label, score }
  }

  #needsWaterProject() {
    return this.turn >= this.active.nextWaterIdea && !this.#inventions.some(b => b.suppliesWater)
      && !this.active.kit && this.lakeReserve <= 6 && this.bag.agua <= 3
  }

  #waterProjectActions(add: (action: Action) => void, gather: (item: NaturalItem, score: number) => boolean) {
    if (!this.#needsWaterProject() || this.active.project || this.active.research
      || !this.pathTo(this.researchTable) || !this.pathTo(this.workbench)) return
    const at = this.constructionTiles()[0]
    if (!at || this.#inventions.length >= this.map.buildLimit) return
    if (this.bag.madeira + this.bag.pedra < 1) {
      if (!gather('madeira', 112) && !gather('pedra', 112) && !gather('terra', 111)) gather('grama', 111)
    } else {
      add({ id: 'projetar_agua', kind: 'invent', water: true, label: 'Projetar uma fonte própria de água', at: this.researchTable, score: 117 })
    }
  }

  #workshopStocks() {
    return [{ id: 0, at: this.workbench, name: 'Bancada de trabalho', stock: this.benchStock },
      ...this.installed.map(entry => ({ id: entry.turn, at: entry.at, name: this.item(entry.item)!.name, stock: entry.stock ?? [] }))]
  }

  #workshopActions(add: (action: Action) => void, gather: (item: NaturalItem, score: number) => boolean) {
    const plots = this.constructionTiles()
    for (const { item } of this.itemCounts()) {
      if (!plots.length || !this.#workshop.canInstall(item, this.active.inventory)) continue
      const entry = this.item(item)!
      if (this.installed.some(s => s.item === item)) continue
      add({ id: `instalar_${item}`.slice(0, 25), kind: 'install', item, label: `Instalar ${entry.name} no mapa`, at: plots[0], score: 115 })
      break
    }

    const stored = this.#workshopStocks().filter(place => place.stock.length && this.pathTo(place.at))
    const readyItems = new Set(stored.flatMap(place => place.stock.map(stack => stack.item)))
    for (const place of stored) {
      for (const [index, { item }] of place.stock.entries()) {
        if (!this.#workshop.canPickup(place.id, place.at, this.workbench, item, this.active.inventory)) continue
        add({ id: `retirar_${place.id}_${index}`, kind: 'pickup', source: 'workshop', sourceId: place.id, item, at: place.at,
          label: `Recolher ${this.item(item)?.name ?? item} · ${place.name}`, score: 105 })
      }
    }
    const all = this.recipes
    const queueRecipe = (recipe: Recipe, visited: ReadonlySet<string>, depth: number): boolean => {
      if (depth > 6 || visited.has(recipe.output.item) || inList(recipe.output.item, harvestOnlyItems)) return false
      if (recipe.inputs.some(input => (input.item === 'agua' && this.bag.agua - input.quantity < 2 && this.vitals.sede >= 35)
        || (input.item === 'fruta' && this.bag.fruta - input.quantity < 1 && this.vitals.fome >= 35)
        || (input.item === fruitSeed && this.active.inventory.count(fruitSeed) - input.quantity < 1))) return false
      const locations = this.#locations(recipe.process)
      if (!locations.length) return false
      if (this.active.inventory.count(recipe.output.item) >= 3
        || this.installed.some(s => s.item === recipe.output.item)) return false
      if (readyItems.has(recipe.output.item)) return true
      const at = locations.find(p => this.#workshop.canCraft(recipe, p, this.workbench, this.active.inventory))
      if (at) {
        add({ id: `fabricar_${recipe.id}`, kind: 'craft', recipeId: recipe.id,
          label: `Fabricar ${this.item(recipe.output.item)?.name ?? recipe.name}`, at, score: recipe.uses === 0 ? 94 : 71 })
        return true
      }
      if (depth === 0 && recipe.uses > 0) return false
      const required = new Map<string, number>()
      for (const { item, quantity } of [...recipe.inputs, ...(recipe.fuel ? [recipe.fuel] : [])]) {
        required.set(item, (required.get(item) ?? 0) + quantity)
      }
      let queued = false
      const nextVisited = new Set([...visited, recipe.output.item])
      for (const [item, quantity] of required) {
        if (this.active.inventory.count(item) >= quantity) continue
        if (readyItems.has(item)) queued = true
        else if (inList(item, naturalItems) && gather(item, 110)) queued = true
        else if (item === 'areia' && gather('agua', 109)) queued = true
        else if (item === 'terra' && gather('grama', 109)) queued = true
        else if (item === 'pedra' && (gather('terra', 109) || gather('grama', 109))) queued = true
        else if (all.filter(r => r.output.item === item).some(r => queueRecipe(r, nextVisited, depth + 1))) queued = true
      }
      return queued
    }
    const progress = all.slice(-4).reverse().map(recipe => queueRecipe(recipe, new Set(), 0)).some(Boolean)
    const options = !progress && !this.#workshop.book.full && this.turn >= this.active.nextWorkshop
      ? this.recipeOptions() : undefined
    if (!this.active.project && !this.active.research && this.pathTo(this.researchTable)
      && options?.processes.length && options.inputs.length) {
      const score = all.length === 0 ? 101 : all.length < 2 ? 95 : 72
      add({ id: 'pesquisar', kind: 'research', label: 'Descobrir uma receita nova com os materiais do vale',
        at: this.researchTable, score })
    }
  }

  // ---- combat helpers ------------------------------------------------------

  #attackSpot(target: Point): Point | undefined {
    const blocked = new Set([
      this.workbench, this.researchTable, ...this.#inventions.map(b => b.at), ...this.installed.map(s => s.at),
      ...this.#characters.filter(character => character !== this.active).map(character => character.at),
      ...this.#animals.map(animal => animal.at),
    ].map(pointKey))
    return [{ x: target.x + 1, y: target.y }, { x: target.x - 1, y: target.y },
      { x: target.x, y: target.y + 1 }, { x: target.x, y: target.y - 1 }]
      .find(at => this.map.isWalkable(at) && !blocked.has(pointKey(at)) && this.pathTo(at) !== null)
  }

  #equipmentOf(actor: Character) {
    const id = actor.equipment
    if (!id || actor.inventory.count(id) < 1) return undefined
    return this.#workshop.catalog.get(id)
  }

  #damageOf(actor: Character) { return this.#equipmentOf(actor)?.damage ?? FISTS }
  #protectionOf(actor: Character) { return this.#equipmentOf(actor)?.protection ?? 0 }

  #attackActions(add: (action: Action) => void) {
    const actor = this.active
    if (!actor.alive) return
    for (const animal of this.#animals) {
      const spot = this.#attackSpot(animal.at)
      if (!spot) continue
      const near = Math.abs(animal.at.x - actor.at.x) + Math.abs(animal.at.y - actor.at.y) <= 2
      add({ id: `atacar_animal_${animal.id}`, kind: 'attack', target: { kind: 'animal', id: animal.id }, at: spot,
        label: `Atacar o animal (${animal.hp} HP)`, score: near ? 128 : 92 })
    }
    const opponent = this.opponent
    if (opponent.alive) {
      const spot = this.#attackSpot(opponent.at)
      if (spot) {
        add({ id: `atacar_${opponent.id}`, kind: 'attack', target: { kind: 'character', id: opponent.id }, at: spot,
          label: `Atacar ${opponent.name} (${opponent.vitals.hp} HP)`, score: actor.id === 'kael' ? 58 : 22 })
      }
    }
  }

  #socialActions(add: (action: Action) => void) {
    const actor = this.active
    const opponent = this.opponent
    const gear = actor.inventory.summarize().flatMap(stack => {
      const item = this.#workshop.catalog.get(stack.item)
      return item && stack.item !== actor.equipment
        && ((item.damage ?? 0) > 0 || (item.protection ?? 0) > 0) ? [{ stack, item }] : []
    })
    const current = this.#equipmentOf(actor)
    const damage = current?.damage ?? 0
    const protection = current?.protection ?? 0
    const near = this.#animals.some(animal => distance(animal.at, actor.at) <= 3)
      || (opponent.alive && distance(opponent.at, actor.at) <= 2)
    const weapon = gear.filter(entry => (entry.item.damage ?? 0) > damage)
      .sort((a, b) => (b.item.damage ?? 0) - (a.item.damage ?? 0))[0]
    if (weapon) {
      add({ id: `equipar_${weapon.stack.item}`, kind: 'equip', item: weapon.stack.item, at: actor.at,
        label: `Equipar ${weapon.item.name} (Dano ${weapon.item.damage ?? 0}`
          + `${weapon.item.protection ? ` · Proteção ${weapon.item.protection}` : ''})`,
        score: near ? 86 : 52 })
    }
    const armor = gear.filter(entry => (entry.item.protection ?? 0) > protection)
      .sort((a, b) => (b.item.protection ?? 0) - (a.item.protection ?? 0))[0]
    if (armor) {
      add({ id: `equipar_${armor.stack.item}`, kind: 'equip', item: armor.stack.item, at: actor.at,
        label: `Vestir ${armor.item.name} (Proteção ${armor.item.protection ?? 0}`
          + `${armor.item.damage ? ` · Dano ${armor.item.damage}` : ''})`,
        score: near ? 90 : 46 })
    }
    for (const drop of this.#drops) {
      if (!this.pathTo(drop.at)) continue
      const summary = drop.items.slice(0, 3).map(stack => `${this.item(stack.item)?.name ?? stack.item} ×${stack.quantity}`).join(', ')
      add({ id: `pegar_drop_${drop.id}`, kind: 'take', dropId: drop.id, at: drop.at,
        label: `Recolher do chão: ${summary}${drop.items.length > 3 ? '…' : ''}`,
        score: 90 + (same(drop.at, actor.at) ? 8 : 0) + this.#dropValue(drop, actor) })
    }
    const usedSlots = actor.inventory.slots.filter(Boolean).length
    if (usedSlots >= 30 && opponent.alive && distance(opponent.at, actor.at) <= 2) {
      const surplus = this.active.inventory.summarize().find(stack => stack.quantity >= 3 && stack.item !== inventionKit.id)
      if (surplus) {
        add({ id: `largar_${surplus.item}`, kind: 'drop', item: surplus.item, quantity: 1, at: actor.at,
          label: `Largar ${this.item(surplus.item)?.name} para ${opponent.name} (mochila cheia)`, score: 18 })
      }
    }
  }

  #dropValue(drop: Drop, actor: Character) {
    const has = (id: string) => drop.items.some(stack => stack.item === id)
    let value = 0
    if (has('agua') && (actor.vitals.sede > 35 || actor.inventory.count('agua') < 2)) value += 38
    if (['fruta', 'carne_assada'].some(has)
      && (actor.vitals.fome > 35 || actor.inventory.count('fruta') < 2)) value += 34
    if (drop.items.some(stack => {
      const item = this.#workshop.catalog.get(stack.item)
      return (item?.damage ?? 0) > 0 || (item?.protection ?? 0) > 0
    })) value += 40
    if (['madeira', 'pedra', 'couro', 'carne_crua'].some(has)) value += 12
    if (has(fruitSeed) && actor.inventory.count(fruitSeed) < 2) value += 6
    return Math.min(40, value)
  }

  #structureActions(add: (action: Action) => void) {
    for (const invention of this.#inventions) {
      const spot = this.#attackSpot(invention.at)
      if (!spot) continue
      if (invention.broken && this.bag.madeira > 0) {
        add({ id: `reparar_${invention.id}`, kind: 'repair', objectId: invention.id, at: spot,
          label: `Reparar ${invention.name}`, score: 112 })
      }
      if (invention.owner !== this.activeId) {
        add({ id: `demolir_${invention.id}`, kind: 'demolish', objectId: invention.id, at: spot,
          label: `Destruir ${invention.name}`, score: this.activeId === 'kael' ? 34 : 12 })
      }
    }
  }

  // ---- actions -------------------------------------------------------------

  actions(): Action[] {
    const actor = this.active
    if (!actor.alive) return [{ id: 'esperar', kind: 'wait', label: `${actor.name} precisa ser revivida`, at: actor.at, score: 1 }]
    const { vitals, lastAction, walks, nextIdea } = actor
    const bag = this.bag
    const { energia, fome, alegria, umidade, sede } = vitals
    const { map } = this
    const casa = map.findSite('casa')
    const horta = map.findSite('horta')
    const choices: Action[] = []
    const add = (a: Action) => {
      // A outra personagem ocupa o tile: melhor não planejar a mesma ação para o mesmo lugar.
      // Dormir em casa é exceção: as duas podem dividir o abrigo quando a energia aperta.
      const other = this.opponent
      if (other.alive && a.kind !== 'rest' && !same(other.at, actor.at) && same(a.at, other.at)) return
      const scored = { ...a, score: a.score - (a.id === lastAction && a.score < 108 ? 12 : 0) }
      const index = choices.findIndex(c => c.id === a.id)
      if (index < 0) choices.push(scored)
      else if (choices[index].score < scored.score) choices[index] = scored
    }
    const gather = (item: NaturalItem, score: number) => {
      const action = this.#gatherAction(item, score)
      if (action) add(action)
      return !!action
    }
    if (energia < 83 || vitals.hp < 90) {
      const score = energia < 24 ? 134 : vitals.hp < 50 ? 122 : vitals.hp < 90 ? 95 : 79 - energia
      add({ id: 'descansar', kind: 'rest', label: `Dormir para recuperar energia · ${casa.name}`, at: casa.area[0], score })
    }
    if (fome > 32 && bag.fruta > 0) add({ id: 'comer', kind: 'eat', food: 'fruta', label: 'Comer uma fruta da mochila', at: actor.at,
      score: fome >= 75 ? 144 : fome >= 52 ? 124 : fome + 1 })
    if (fome > 32 && actor.inventory.count('carne_assada') > 0) {
      add({ id: 'comer_carne_assada', kind: 'eat', food: 'carne_assada', at: actor.at,
        label: 'Comer carne assada da mochila', score: fome >= 75 ? 150 : 130 })
    }
    const fuel = ['madeira', 'carvao'].find(id => actor.inventory.count(id) > 0)
    const kitchen = this.#locations('aquecer')[0]
    if (kitchen && fuel && actor.inventory.count('carne_crua') > 0) {
      const soon = actor.rawUntil !== undefined && actor.rawUntil - this.turn <= 3
      add({ id: 'assar_carne', kind: 'cook', at: kitchen,
        label: `Assar carne no forno (gasta 1 ${this.item(fuel)?.name})`, score: soon ? 126 : 88 })
    }
    if (bag.fruta < 3) gather('fruta', bag.fruta === 0 ? (fome >= 62 ? 133 : 105) : this.gardenStage === 'madura' ? 104 : 63)
    if (this.gardenStage === 'vazia' && actor.inventory.count(fruitSeed) > 0 && this.pathTo(horta.area[0])) {
      add({ id: 'plantar', kind: 'plant', label: `Plantar semente de fruta · ${horta.name}`, at: horta.area[0], score: bag.fruta < 3 ? 110 : 96 })
    }
    if (sede >= 42 && bag.agua > 0) add({ id: 'beber', kind: 'drink', label: 'Beber água da mochila', at: actor.at,
      score: sede >= 70 ? 145 : 121 })
    if (bag.madeira < 6) gather('madeira', bag.madeira < 2 ? 55 : 25)
    if (bag.pedra < 5) gather('pedra', bag.pedra < 2 ? 52 : 21)
    if (bag.agua < 2) {
      const draw = this.#inventions.find(b => this.pathTo(b.at) && b.collectable('agua', actor.inventory))
      if (draw) add({ id: `retirar_agua_${draw.id}`, kind: 'pickup', source: 'invention', sourceId: draw.id, item: 'agua', at: draw.at,
        label: `Retirar água de ${draw.name}`, score: bag.agua === 0 && sede >= 48 ? 138 : 106 })
      else if (bag.agua === 0 && sede >= 28) gather('agua', sede >= 62 ? 139 : 113)
    }
    if (bag.agua < 5) gather('agua', bag.agua === 0 ? 46 : 18)
    for (const item of ['grama', 'terra', 'areia'] as const) {
      if (actor.inventory.count(item) < 4) gather(item, 31)
    }
    if (this.gardenStage === 'crescendo' && umidade < 42 && (bag.agua >= 2 || (bag.agua === 1 && sede < 27))) {
      add({ id: 'regar', kind: 'water', label: `Regar o cultivo com água da mochila · ${horta.name}`, at: horta.area[0], score: bag.fruta < 2 ? 118 : 103 })
    }
    const walk = map.lookouts[walks % map.lookouts.length]
    add({ id: 'passear', kind: 'walk', label: 'Passear e observar o vale', at: walk, score: alegria < 24 ? 125 : 32 + (100 - alegria) / 5 })
    this.#workshopActions(add, gather)
    this.#attackActions(add)
    this.#socialActions(add)
    this.#structureActions(add)
    const project = this.#projectAction()
    if (project) add(project)
    else if (this.#projectImpossible()) add({ kind: 'archive_project', id: 'arquivar_projeto',
      label: 'Arquivar projeto sem condições de execução', at: actor.at, score: 103 })

    const kit = actor.kit
    if (kit?.atBench) {
      if (this.pathTo(this.workbench) && actor.inventory.canExchange([], this.#kitOutput())) {
        add({ id: 'recolher_kit', kind: 'pickup_kit', at: this.workbench, label: `Recolher kit de ${kit.plan.nome} na bancada`,
          score: hasWaterSupply(kit.plan.regras) ? 129 : 117 })
      }
    } else if (kit) {
      const at = this.previewBuild(kit.plot) ? kit.plot : this.constructionTiles().find(plot => this.previewBuild(plot))
      if (at) add({ id: 'construir', kind: 'build', at, label: `Instalar ${kit.plan.nome} no mapa`, score: hasWaterSupply(kit.plan.regras) ? 128 : 116 })
    }
    for (const b of this.#inventions) {
      if (!this.pathTo(b.at)) continue
      for (const item of resources) {
        if (!b.collectable(item, actor.inventory)) continue
        add({ id: `retirar_${item}_${b.id}`, kind: 'pickup', source: 'invention', sourceId: b.id, item, at: b.at,
          label: `Retirar ${this.item(item)?.name.toLowerCase()} de ${b.name}`, score: item === 'agua' ? 83 : b.uses === 0 ? 102 : 98 })
      }
    }
    this.#waterProjectActions(add, gather)

    if (!actor.project && !actor.research && bag.madeira + bag.pedra > 0) {
      const candidates = this.#inventions.filter(b => b.canRenovate(this.turn))
        .sort((a, b) => a.lastRenovation - b.lastRenovation || b.uses - a.uses || b.id - a.id).slice(0, 2)
      for (const b of candidates) {
        add({ id: `reformar_${b.id}`, kind: 'renovate', objectId: b.id, at: b.at,
          label: `Reformar ${b.name} para mudar o desenho`, score: 75 })
      }
    }
    if (!actor.project && !actor.research && this.pathTo(this.researchTable)
      && this.turn >= nextIdea && this.itemCounts().some(s => this.item(s.item)?.kind === 'material')) {
      const newBuild = !kit && !!this.pathTo(this.workbench) && this.#inventions.length < map.buildLimit && this.constructionTiles().length > 0
      if (newBuild) add({ id: 'inventar', kind: 'invent', label: 'Projetar uma invenção para montar na bancada', at: this.researchTable, score: 87 })
    }
    const nearby = this.#inventions.filter(b => b.canUse(this.turn, actor.inventory, vitals))
      .sort((a, b) => a.uses - b.uses || b.id - a.id).slice(0, 3)
    for (const b of nearby) {
      add({
        id: `usar_${b.id}`, kind: 'use', at: b.at, objectId: b.id,
        label: `Usar ${b.name}: ${b.description.slice(0, 68)}`, score: b.uses === 0 ? 102 : 58,
      })
    }
    if (!choices.length) add({ id: 'esperar', kind: 'wait', label: 'Esperar o vale seguir', at: actor.at, score: 1 })
    const expansion = this.#prepareExpansion()
    if (expansion) {
      add({ id: 'expandir', kind: 'expand', at: expansion.at,
        label: `Desbravar a fronteira e expandir o vale (${this.map.width} × ${this.map.height})`,
        score: this.#expansionScore() })
    }
    return choices.sort((a, b) => b.score - a.score)
  }

  // ---- frontier ------------------------------------------------------------

  #expansionScore() {
    const tight = this.#inventions.length >= this.map.buildLimit - 2 || this.constructionTiles().length === 0
    return tight ? 93 : 61
  }

  #expansionOrder(): ('leste' | 'sul')[] {
    const order: ('leste' | 'sul')[] = this.map.width <= this.map.height ? ['leste', 'sul'] : ['sul', 'leste']
    return order.filter(direction => direction === 'leste'
      ? this.map.width + 2 <= MAX_MAP_SIDE
      : this.map.height + 2 <= MAX_MAP_SIDE)
  }

  #frontierSpot(direction: 'leste' | 'sul'): Point | undefined {
    const { map } = this
    const blocked = new Set([
      this.workbench, this.researchTable, ...this.#inventions.map(invention => invention.at),
      ...this.installed.map(entry => entry.at), ...this.#animals.map(animal => animal.at),
    ].map(pointKey))
    const edge = direction === 'leste'
      ? map.tiles.filter(at => at.x === map.width - 1)
      : map.tiles.filter(at => at.y === map.height - 1)
    return edge
      .filter(at => !blocked.has(pointKey(at)) && map.isWalkable(at) && this.tree(at) !== 'em_pe' && this.pathTo(at))
      .sort((a, b) => distance(this.active.at, a) - distance(this.active.at, b))[0]
  }

  #prepareExpansion(): { at: Point; direction: 'leste' | 'sul'; map: WorldMap } | null {
    if (this.turn < this.#progress.lastExpand + EXPAND_COOLDOWN) return null
    for (const direction of this.#expansionOrder()) {
      const map = this.#growMap(direction)
      if (!map) continue
      const at = this.#frontierSpot(direction)
      if (at) return { at, direction, map }
    }
    return null
  }

  #growMap(direction: 'leste' | 'sul'): WorldMap | null {
    const data = this.map.toData()
    const east = direction === 'leste'
    if ((east ? data.width : data.height) + 2 > MAX_MAP_SIDE) return null
    const width = data.width + (east ? 2 : 0)
    const height = data.height + (east ? 0 : 2)
    const strip: Point[] = []
    if (east) {
      for (let x = data.width; x < width; x++) for (let y = 0; y < height; y++) strip.push({ x, y })
    } else {
      for (let y = data.height; y < height; y++) for (let x = 0; x < width; x++) strip.push({ x, y })
    }
    const used = new Set([...data.trees, ...data.lookouts, ...data.trails, ...data.sites.flatMap(site => site.area)].map(pointKey))
    const free = strip.filter(at => !used.has(pointKey(at)))
    if (!free.length) return null
    const middle = { x: Math.floor(width / 2), y: Math.floor(height / 2) }
    const siteAt = free.find(at => east ? at.x === width - 1 && at.y === middle.y : at.y === height - 1 && at.x === middle.x) ?? free[0]
    const rest = free.filter(at => !same(at, siteAt))
    const lookout = rest[0]
    const trees = rest.filter(at => !lookout || !same(at, lookout)).slice(0, 2)
    return WorldMap.fromData({
      ...data, width, height, buildLimit: Math.min(40, data.buildLimit + 4),
      sites: [...data.sites, {
        id: `marco-${direction}-${width}x${height}`, kind: 'marco',
        name: east ? 'Marco do Leste' : 'Marco do Sul', area: [siteAt],
      }],
      trees: [...data.trees, ...trees],
      lookouts: lookout ? [...data.lookouts, lookout] : [...data.lookouts],
      fruitTree: this.map.fruitTree, researchTable: this.map.researchTable,
    })
  }

  #projectAction(): Action | null {
    const project = this.active.project
    if (project?.kind === 'blueprint' && this.previewAssembly(project.plan, project.plot)) {
      return { kind: 'assemble', id: 'montar_kit', label: `Montar o kit de ${project.plan.nome} na bancada`,
        at: this.workbench, plot: structuredClone(project.plot), plan: structuredClone(project.plan),
        score: hasWaterSupply(project.plan.regras) ? 128 : 116 }
    }
    if (project?.kind === 'renovation') {
      const target = this.#renovationTarget(project.objectId)
      if (target && this.pathTo(target.at) && this.#prepareRenovation(target, project.upgrade)) {
        return { kind: 'renovation', id: `reformar_${project.objectId}`, label: `Reformar ${target.name}`, at: target.at,
          objectId: project.objectId, upgrade: structuredClone(project.upgrade), score: 116 }
      }
    }
    return null
  }

  #projectImpossible() {
    const project = this.active.project
    if (!project) return false
    const stale = this.turn - (this.active.projectSince ?? 0) > 30
    if (project.kind === 'renovation') return stale || !this.#inventions.some(build => build.id === project.objectId)
    return stale || !this.#canPlace(project.plan, project.plot)
  }

  #atResearchTable(at: Point) {
    return same(at, this.researchTable) && same(this.active.at, at) && !!this.active.research
  }

  canRecordProject(value: unknown) {
    const project = readProject(value, this.map)
    const topic = this.active.research
    if (!project || !topic) return false
    if (project.kind === 'blueprint' && topic.kind === 'blueprint') {
      return !!this.previewAssembly(project.plan, project.plot) && (!topic.water || hasWaterSupply(project.plan.regras))
    }
    return project.kind === 'renovation' && topic.kind === 'renovation' && topic.objectId === project.objectId
      && !!this.previewRenovation(project.objectId, project.upgrade)
  }

  // ---- turn ----------------------------------------------------------------

  complete(action: Action, postpone?: Postpone): World {
    const actor = this.active
    if (!actor.alive) throw new Error(`${actor.name} precisa ser revivida antes de agir.`)
    const route = this.pathTo(action.at)
    if (!route) throw new Error('O destino da ação não é acessível.')
    const assembled = action.kind === 'assemble' && same(action.at, this.workbench) ? this.previewAssembly(action.plan, action.plot) : null
    if (action.kind === 'assemble' && !assembled) throw new Error('O kit precisa ser montado na bancada com os materiais necessários.')
    const built = action.kind === 'build' ? this.previewBuild(action.at) : null
    if (action.kind === 'build' && !built) throw new Error('A construção não é válida para este mundo.')
    const target = action.kind === 'renovation' ? this.#renovationTarget(action.objectId) : undefined
    const renovation = action.kind === 'renovation' && target && same(target.at, action.at)
      ? this.#prepareRenovation(target, action.upgrade) : null
    if (action.kind === 'renovation' && !renovation) throw new Error('A reforma não é válida para este mundo.')
    if (!this.#validWorkshopAction(action)) throw new Error('A ação de produção ou coleta não é válida para este mundo.')
    const expansion = action.kind === 'expand' ? this.#prepareExpansion() : null
    if (action.kind === 'expand' && !expansion) throw new Error('A fronteira não pode crescer agora.')
    const steps = route.length
    const next = new World(expansion?.map ?? this.map, {
      ...this.#progress, turn: this.#progress.turn + 1, minute: this.#progress.minute + 25 + steps * 3,
    }, this.#characters.map(character => character.fork(this.#workshop.catalog)),
    this.#inventions.map(invention => invention.fork()), this.#workshop.fork(),
    expansion ? this.#terrain.rebase(expansion.map) : this.#terrain.fork(),
    this.#animals.map(animal => animal.fork()), this.#drops.map(drop => drop.fork()))
    next.active.at = { ...action.at }
    next.active.lastAction = action.id
    next.active.nextIdea = postpone === 'idea' ? this.turn + 3 : actor.nextIdea
    next.active.nextWaterIdea = postpone === 'water' ? this.turn + 3 : actor.nextWaterIdea
    next.active.nextWorkshop = postpone === 'workshop' ? this.turn + 6 : actor.nextWorkshop
    if (expansion) next.#progress.lastExpand = next.turn
    next.#advanceEnvironment(this.minute, steps)
    // Repõe a fauna antes da ação: um abate no mesmo turno não é desfeito na hora.
    next.#replenishAnimals()
    if (next.active.alive) {
      if (action.kind !== 'visit_research') delete next.active.research
      next.#applyAction(action, assembled ?? built, renovation, expansion?.direction)
    }
    // A personagem resolve o turno dela antes de o bicho revidar.
    next.#advanceAnimals()
    if (next.active.alive) next.#advanceHealth()
    if (action.kind !== 'plant' && next.#terrain.growGarden(next.active.vitals.umidade)) {
      next.#addLog(`As frutas que ${actor.name} plantou na horta amadureceram.`)
    }
    next.#progress.active = next.#nextActive()
    return next
  }

  #nextActive() {
    const current = this.#progress.active
    const other = 1 - current
    if (this.#characters[other].alive) return other
    if (this.#characters[current].alive) return current
    return current
  }

  #addLog(message: string) {
    this.#progress.log = [{ text: message, minute: this.minute }, ...this.#progress.log].slice(0, 24)
  }

  #nextDropId() {
    return Math.max(this.turn, ...this.#drops.map(drop => drop.id)) + 1
  }

  #advanceEnvironment(previousMinute: number, steps: number) {
    const actor = this.active
    const { vitals } = actor
    const bag = actor.inventory
    this.#ageRawMeat()
    const { rain } = this.weather
    const dawn = this.map.crossedSunrise(previousMinute, this.minute)
    if (dawn) this.#terrain.regrowWildFruit()
    vitals.energia = limit(vitals.energia - 3 - Math.floor(steps / 2))
    vitals.fome = limit(vitals.fome + 5)
    vitals.sede = limit(vitals.sede + 3 + Number(steps >= 5))
    vitals.alegria = limit(vitals.alegria - 2)
    vitals.umidade = limit(vitals.umidade + (rain ? 3 : -4))
    for (const invention of this.#inventions) {
      for (const effect of invention.tick(rain, dawn, bag, vitals)) this.#addLog(`${invention.name} ${effect}.`)
    }
  }

  /** The woods recover a small fauna over time so the vale never stays empty. */
  #replenishAnimals() {
    if (this.#animals.length >= ANIMAL_TARGET) return
    const urgent = this.#animals.length === 0
    if (!urgent && this.turn % ANIMAL_SPAWN_EVERY !== 0) return
    const count = Math.min(urgent ? 2 : 1, ANIMAL_TARGET - this.#animals.length)
    const spots = this.#animalSpots(count)
    if (!spots.length) return
    let id = Math.max(0, ...this.#animals.map(animal => animal.id)) + 1
    for (const at of spots) this.#animals.push(Animal.create(id++, at))
    this.#addLog(spots.length > 1 ? 'Animais novos apareceram em terreno livre do vale.' : 'Um animal novo apareceu em terreno livre do vale.')
  }

  #animalSpots(count: number) {
    const woods = this.map.findSite('bosque').area[0]
    const home = this.map.findSite('casa').area[0]
    const blocked = new Set([
      ...this.map.sites.flatMap(site => site.area), this.map.fruitTree,
      this.workbench, this.researchTable, ...this.#inventions.map(invention => invention.at),
      ...this.installed.map(entry => entry.at), ...this.#animals.map(animal => animal.at),
      ...this.#drops.map(drop => drop.at),
      ...this.map.trees.filter(at => this.tree(at) === 'em_pe'),
    ].map(pointKey))
    const living = this.#characters.filter(character => character.alive)
    return pickSpawnSpots(this.map.tiles
      .filter(at => !blocked.has(pointKey(at)) && this.map.isWalkable(at) && this.map.pathTo(woods, at))
      .filter(at => living.every(character => distance(character.at, at) >= 3))
      .filter(at => distance(home, at) >= 3), count, this.turn)
  }

  #advanceAnimals() {
    for (const animal of [...this.#animals]) {
      // Saves antigos podiam deixar bichos dentro da casa; devolve o bicho ao terreno livre.
      if (this.map.siteAt(animal.at) || this.tree(animal.at) === 'em_pe') {
        const spot = this.#animalSpots(1)[0]
        if (spot) animal.at = spot
      }
      const living = this.#characters.filter(character => character.alive)
      if (!living.length) continue
      const chosen = living.slice().sort((a, b) =>
        Math.abs(a.at.x - animal.at.x) + Math.abs(a.at.y - animal.at.y) - Math.abs(b.at.x - animal.at.x) - Math.abs(b.at.y - animal.at.y))[0]
      const distance = Math.abs(chosen.at.x - animal.at.x) + Math.abs(chosen.at.y - animal.at.y)
      if (distance === 1) {
        if (this.turn >= animal.nextBite) {
          const bite = Math.max(1, ANIMAL_DAMAGE - this.#protectionOf(chosen))
          chosen.damage(bite)
          animal.nextBite = this.turn + ANIMAL_BITE_EVERY
          this.#addLog(`Um animal atacou ${chosen.name} (−${bite} HP).${bite < ANIMAL_DAMAGE ? ' A proteção absorveu parte do golpe.' : ''}`)
          if (chosen.vitals.hp === 0) this.#kill(chosen)
        }
        continue
      }
      if (distance <= 6) {
        const step = this.#animalStep(animal, chosen.at)
        if (step) animal.at = step
        continue
      }
      if (this.turn >= animal.nextBreak) {
        const near = this.#inventions.find(invention => !invention.broken
          && Math.abs(invention.at.x - animal.at.x) + Math.abs(invention.at.y - animal.at.y) <= 1)
        if (near?.breakDown()) {
          this.#addLog(`Um animal quebrou ${near.name}. É preciso reparar.`)
          animal.nextBreak = this.turn + 8
        }
      }
    }
  }

  #animalStep(animal: Animal, target: Point): Point | undefined {
    const blocked = this.#blockedTiles()
    for (const site of this.map.sites) for (const at of site.area) blocked.add(pointKey(at))
    for (const at of this.map.trees) if (this.tree(at) === 'em_pe') blocked.add(pointKey(at))
    blocked.add(pointKey(this.map.fruitTree))
    const here = Math.abs(animal.at.x - target.x) + Math.abs(animal.at.y - target.y)
    const options = [{ x: animal.at.x + 1, y: animal.at.y }, { x: animal.at.x - 1, y: animal.at.y },
      { x: animal.at.x, y: animal.at.y + 1 }, { x: animal.at.x, y: animal.at.y - 1 }]
      .filter(at => this.map.isWalkable(at) && !blocked.has(pointKey(at)))
      .filter(at => Math.abs(at.x - target.x) + Math.abs(at.y - target.y) < here)
      .sort((a, b) => Math.abs(a.x - target.x) + Math.abs(a.y - target.y) - Math.abs(b.x - target.x) - Math.abs(b.y - target.y))
    return options[0]
  }

  #advanceHealth() {
    const actor = this.active
    const previous = actor.vitals.hp
    const causes = updateHealth(actor.vitals)
    if (actor.vitals.hp === 0) {
      this.#kill(actor)
    } else if (actor.vitals.hp < previous) {
      this.#addLog(`${actor.name} perdeu ${previous - actor.vitals.hp} HP por ${causes.join(', ')}.`)
    }
  }

  #kill(victim: Character, killer?: Character) {
    if (!victim.alive) return
    victim.alive = false
    victim.vitals.hp = 0
    const loot: Stack[] = []
    for (const slot of victim.inventory.slots) {
      if (slot && slot.item !== inventionKit.id) loot.push({ item: slot.item, quantity: slot.quantity })
    }
    victim.inventory.takeAll()
    victim.equipment = undefined
    victim.rawUntil = undefined
    victim.kit = undefined
    victim.research = undefined
    victim.project = undefined
    victim.projectSince = undefined
    if (loot.length) {
      const drop = this.#drops.find(entry => same(entry.at, victim.at))
      if (drop) drop.add(loot)
      else this.#drops.push(Drop.create(this.#nextDropId(), victim.at, loot))
    }
    if (killer) {
      const stolen = Math.floor(victim.xp * 0.5)
      killer.xp += stolen
      victim.xp = 0
      this.#addLog(`${killer.name} derrotou ${victim.name} e levou ${stolen} XP. A mochila ficou no chão.`)
    } else {
      victim.xp = 0
      this.#addLog(`${victim.name} morreu. A mochila ficou no chão.`)
    }
  }

  /** User action: brings a dead character back with nothing. */
  revive(id: CharacterId): World {
    const victim = this.character(id)
    if (!victim || victim.alive) return this
    const home = this.map.findSite('casa').area[0]
    const occupied = new Set(this.#characters.filter(character => character.alive).map(character => pointKey(character.at)))
    const spot = [home, ...this.map.tiles]
      .find(at => this.map.isWalkable(at) && !occupied.has(pointKey(at)) && this.map.pathTo(home, at) !== null) ?? home
    const next = new World(this.map, { ...this.#progress, active: this.#characters.indexOf(victim) },
      this.#characters.map(character => character.fork(this.#workshop.catalog)),
      this.#inventions.map(invention => invention.fork()), this.#workshop.fork(), this.#terrain.fork(),
      this.#animals.map(animal => animal.fork()), this.#drops.map(drop => drop.fork()))
    const revived = next.character(id)!
    revived.inventory.takeAll()
    revived.alive = true
    revived.at = { ...spot }
    revived.vitals.hp = 100
    revived.vitals.energia = 82
    revived.vitals.fome = 24
    revived.vitals.sede = 18
    revived.vitals.alegria = 62
    revived.vitals.umidade = 36
    revived.xp = 0
    revived.equipment = undefined
    revived.rawUntil = undefined
    revived.kit = undefined
    revived.research = undefined
    revived.project = undefined
    revived.projectSince = undefined
    revived.nextIdea = next.turn
    revived.nextWaterIdea = next.turn
    revived.nextWorkshop = next.turn + 2
    revived.lastAction = ''
    next.#addLog(`${revived.name} voltou ao vale sem nada.`)
    return next
  }

  #prepareRenovation(target: Invention, upgrade: Renovation) {
    const prepared = target.previewRenovation(upgrade)
    if (!prepared || !this.#canAfford(prepared.upgrade.custo)) return null
    const look = appearanceFor(prepared.plan)
    const previous = target.appearance
    const summary = prepared.upgrade.ideia
    if (appearanceKey(look) === appearanceKey(previous)) return { ...prepared, summary }
    const distinct = this.#appearanceRegistry(target.id).available(look, prepared.upgrade.modulo?.camada, previous)
    if (!distinct) return null
    if (distinct === look) return { ...prepared, summary }
    const slot = prepared.upgrade.modulo?.camada ?? 'aparência'
    return { ...prepared, plan: { ...prepared.plan, aparencia: distinct },
      summary: `A reforma variou a ${slot} para não repetir o visual de outra criação.` }
  }

  // ---- applying actions ----------------------------------------------------

  #applyAction(action: Action, built: Blueprint | null, renovation: { upgrade: Renovation; plan: Blueprint; summary: string } | null,
    expansion?: 'leste' | 'sul') {
    const actor = this.active
    const { vitals } = actor
    const bag = actor.inventory
    switch (action.kind) {
      case 'wait':
        break
      case 'expand':
        actor.xp += EXPAND_XP
        this.#addLog(`${actor.name} desbravou a fronteira ${expansion ?? ''} do vale. O mapa agora tem ${this.map.width} × ${this.map.height}.`)
        break
      case 'rest': {
        vitals.energia = limit(vitals.energia + 48)
        let healed = 0
        if (vitals.fome <= 65 && vitals.sede <= 65 && vitals.hp < 100) {
          healed = Math.min(8, 100 - vitals.hp)
          vitals.hp += healed
        }
        this.#addLog(`${actor.name} tirou uma soneca em ${this.map.findSite('casa').name}.`
          + (healed ? ` Recuperou ${healed} HP.` : ''))
        break
      }
      case 'eat': {
        const food = action.food === 'carne_assada' ? 'carne_assada' : 'fruta'
        if (!bag.exchange([{ item: food, quantity: 1 }], [])) break
        const label = food === 'carne_assada' ? 'carne assada' : 'uma fruta'
        vitals.fome = limit(vitals.fome - (food === 'carne_assada' ? 70 : 57))
        this.#addLog(`${actor.name} comeu ${label} da mochila.`)
        break
      }
      case 'cook': {
        const station = this.installed.find(entry => same(entry.at, action.at)
          && this.item(entry.item)?.capability === 'aquecer')
        const fuel = ['madeira', 'carvao'].find(id => bag.count(id) > 0)
        if (!station || !fuel) break
        if (!bag.exchange([
          { item: 'carne_crua', quantity: 1 }, { item: fuel, quantity: 1 },
        ], [{ item: 'carne_assada', quantity: 1 }])) break
        actor.xp += 1
        this.#addLog(`${actor.name} assou carne em ${this.item(station.item)?.name} e gastou 1 ${this.item(fuel)?.name}.`)
        break
      }
      case 'drink':
        if (!bag.exchange([{ item: 'agua', quantity: 1 }], [])) break
        vitals.sede = limit(vitals.sede - 62)
        this.#addLog(`${actor.name} bebeu uma unidade de água da mochila.`)
        break
      case 'gather': {
        const { resource, quantity, source } = action
        const output: Stack[] = [{ item: resource, quantity }]
        const withSeed = [...output, { item: fruitSeed, quantity: 1 }]
        const keptSeed = resource === 'fruta' && bag.count(fruitSeed) < 3 && bag.canExchange([], withSeed)
        if (bag.exchange([], keptSeed ? withSeed : output)) {
          actor.xp += GATHER_XP
          const before = this.tree(source)
          this.#terrain.harvest(source, resource, quantity)
          const fell = before === 'em_pe' && this.tree(source) === 'caida'
          if (resource === 'fruta') {
            this.#addLog(`${actor.name} colheu ${quantity}× fruta ${same(source, this.map.fruitTree) ? 'da árvore' : 'da horta'}.`
              + (keptSeed ? ' Guardou uma semente.' : ''))
          } else this.#addLog(`${actor.name} coletou ${quantity}× ${this.item(resource)?.name}.`
            + (fell ? ' A árvore caiu.' : resource === 'agua' ? ' O nível do lago baixou.' : ''))
        }
        break
      }
      case 'learn': {
        const recipe = this.#workshop.book.learn(action.recipe, this.#workshop.catalog, this.turn)
        if (recipe) {
          actor.xp += 3
          this.#addLog(`${actor.name} anotou a receita ${recipe.name} na Mesa de Pesquisa.`)
        }
        actor.nextWorkshop = this.turn + 3
        break
      }
      case 'visit_research':
        actor.research = readTopic(action.topic)!
        break
      case 'finish_research':
        this.#addLog('A Mesa de Pesquisa não encontrou um resultado válido.')
        break
      case 'record_project': {
        const project = readProject(action.project, this.map)!
        actor.project = project
        actor.projectSince = this.turn
        const name = project.kind === 'blueprint' ? project.plan.nome : this.#inventions.find(b => b.id === project.objectId)?.name
        this.#addLog(`${actor.name} recebeu ${project.kind === 'blueprint' ? 'a planta' : 'o projeto de reforma'} de ${name} na Mesa de Pesquisa.`)
        break
      }
      case 'archive_project':
        actor.project = undefined
        actor.projectSince = undefined
        this.#addLog(`${actor.name} arquivou um projeto que não podia mais executar.`)
        break
      case 'craft': {
        const recipe = this.#workshop.craft(action.recipeId, action.at, this.workbench, bag)
        if (recipe) {
          actor.xp += CRAFT_XP
          const where = recipe.process === 'montar' ? 'Bancada de trabalho' : this.item(this.installed.find(s => same(s.at, action.at))!.item)!.name
          this.#addLog(`${actor.name} produziu ${recipe.output.quantity}× ${this.item(recipe.output.item)?.name ?? recipe.name}. Ficou no estoque de ${where}.`)
        }
        break
      }
      case 'pickup': {
        const here = actor.at
        const target = action.source === 'invention' ? this.#inventions.find(b => b.id === action.sourceId && same(b.at, here)) : undefined
        const quantity = target && inList(action.item, resources) ? target.withdraw(action.item, bag)
          : action.source === 'workshop' ? this.#workshop.pickup(action.sourceId, here, this.workbench, action.item, bag) : 0
        if (quantity) {
          const name = target?.name ?? this.#workshopStocks().find(s => s.id === action.sourceId)?.name ?? 'aparelho'
          this.#addLog(`${actor.name} recolheu ${quantity}× ${this.item(action.item)?.name ?? action.item} de ${name} para a mochila.`)
        }
        break
      }
      case 'install': {
        const look = this.#installationLook(action.item)
        if (look && this.#workshop.install(action.item, action.at, this.turn, look, bag)) {
          this.#addLog(`${actor.name} instalou ${this.item(action.item)?.name} no mapa.`)
        }
        break
      }
      case 'water':
        if (!bag.exchange([{ item: 'agua', quantity: 1 }], [])) break
        vitals.umidade = limit(vitals.umidade + 38)
        this.#addLog(`${actor.name} regou o cultivo em ${this.map.findSite('horta').name}.`)
        break
      case 'plant':
        if (bag.exchange([{ item: fruitSeed, quantity: 1 }], []) && this.#terrain.plant()) {
          actor.xp += GATHER_XP
          this.#addLog(`${actor.name} plantou uma semente de fruta na horta.`)
        }
        break
      case 'walk':
        actor.walks++
        vitals.alegria = limit(vitals.alegria + 13)
        this.#addLog(`${actor.name} passeou e observou os arredores.`)
        break
      case 'assemble':
        if (!built) break
        if (!bag.exchange(this.#kitCost(built), [])) break
        actor.xp += CRAFT_XP
        actor.kit = { plan: built, plot: { ...action.plot }, atBench: true }
        if (actor.project?.kind === 'blueprint') {
          actor.project = undefined
          actor.projectSince = undefined
        }
        this.#addLog(`${actor.name} montou o kit de ${built.nome} e deixou na bancada para recolher.`)
        break
      case 'pickup_kit': {
        const kit = actor.kit
        if (!kit?.atBench || !bag.exchange([], this.#kitOutput())) break
        actor.kit = { plan: kit.plan, plot: kit.plot }
        this.#addLog(`${actor.name} recolheu o kit de ${kit.plan.nome} da bancada para a mochila.`)
        break
      }
      case 'build':
        if (!built || !bag.exchange(this.#kitOutput(), [])) break
        actor.kit = undefined
        actor.xp += CRAFT_XP
        this.#inventions.push(Invention.create(this.turn, action.at, built, actor.id))
        actor.nextIdea = this.turn + 7
        this.#addLog(`${actor.name} instalou ${built.nome}. ${built.ideia}`)
        break
      case 'renovation': {
        const target = this.#inventions.find(b => b.id === action.objectId)
        if (!target || !renovation) break
        if (!bag.exchange(this.#materialCost(renovation.upgrade.custo), [])) break
        target.applyRenovation(renovation.plan, this.turn, renovation.summary)
        if (actor.project?.kind === 'renovation' && actor.project.objectId === action.objectId) {
          actor.project = undefined
          actor.projectSince = undefined
        }
        this.#addLog(`${actor.name} reformou ${target.name}. ${renovation.summary}`)
        break
      }
      case 'use': {
        const invention = this.#inventions.find(item => item.id === action.objectId)
        const effects = invention?.use(this.turn, bag, vitals)
        if (invention && effects?.length) {
          actor.xp += USE_XP
          this.#addLog(`${actor.name} usou ${invention.name}: ${effects.join(', ')}.`)
        }
        break
      }
      case 'equip': {
        const item = this.item(action.item)
        if (bag.count(action.item) > 0 && item && ((item.damage ?? 0) > 0 || (item.protection ?? 0) > 0)) {
          actor.equipment = action.item
          const attributes = [item.damage ? `Dano ${item.damage}` : '', item.protection ? `Proteção ${item.protection}` : '']
            .filter(Boolean).join(' · ')
          this.#addLog(`${actor.name} equipou ${item.name}${attributes ? ` (${attributes})` : ''}.`)
        }
        break
      }
      case 'attack': {
        if (action.target.kind === 'animal') {
          const animal = this.#animals.find(entry => entry.id === action.target.id)
          if (!animal) break
          const damage = this.#damageOf(actor)
          const dead = animal.hits(damage)
          this.#addLog(`${actor.name} atacou o animal (−${damage} HP).`)
          if (dead) {
            this.#animals.splice(this.#animals.indexOf(animal), 1)
            actor.xp += ANIMAL_XP
            const loot: Stack[] = [{ item: 'carne_crua', quantity: 2 }, { item: 'couro', quantity: 1 }]
            const drop = this.#drops.find(entry => same(entry.at, animal.at))
            const left = !!drop || this.#drops.length < 8
            if (drop) drop.add(loot)
            else if (left) this.#drops.push(Drop.create(this.#nextDropId(), animal.at, loot))
            this.#addLog(`O animal caiu. ${actor.name} ganhou ${ANIMAL_XP} XP.`
              + (left ? ' Deixou 2 carnes cruas e 1 couro no chão.' : ''))
          }
          break
        }
        const victim = this.character(action.target.id)
        if (!victim || !victim.alive) break
        const damage = Math.max(1, this.#damageOf(actor) - this.#protectionOf(victim))
        const dead = victim.damage(damage)
        this.#addLog(`${actor.name} atacou ${victim.name} (−${damage} HP).`)
        if (dead) this.#kill(victim, actor)
        break
      }
      case 'drop': {
        if (!bag.exchange([{ item: action.item, quantity: action.quantity }], [])) break
        if (actor.equipment === action.item && bag.count(action.item) === 0) actor.equipment = undefined
        const drop = this.#drops.find(entry => same(entry.at, actor.at))
        if (drop) drop.add([{ item: action.item, quantity: action.quantity }])
        else this.#drops.push(Drop.create(this.#nextDropId(), actor.at, [{ item: action.item, quantity: action.quantity }]))
        this.#addLog(`${actor.name} largou ${action.quantity}× ${this.item(action.item)?.name} no chão.`)
        break
      }
      case 'take': {
        const drop = this.#drops.find(entry => entry.id === action.dropId)
        if (!drop || !same(drop.at, actor.at)) break
        const taken = drop.take(bag)
        if (taken.length) this.#addLog(`${actor.name} recolheu ${taken.map(stack => `${stack.quantity}× ${this.item(stack.item)?.name ?? stack.item}`).join(', ')} do chão.`)
        if (drop.empty) this.#drops.splice(this.#drops.indexOf(drop), 1)
        break
      }
      case 'repair': {
        const target = this.#inventions.find(item => item.id === action.objectId)
        if (!target?.broken || !bag.exchange([{ item: 'madeira', quantity: 1 }], [])) break
        target.repair()
        actor.xp += REPAIR_XP
        this.#addLog(`${actor.name} reparou ${target.name}.`)
        break
      }
      case 'demolish': {
        const target = this.#inventions.find(item => item.id === action.objectId)
        if (!target || target.owner === actor.id) break
        this.#inventions.splice(this.#inventions.indexOf(target), 1)
        actor.xp += DEMOLISH_XP
        this.#addLog(`${actor.name} destruiu ${target.name}.`)
        break
      }
    }
    // O item equipado vive na mochila; se foi gasto ou largado, o slot esvazia.
    if (actor.equipment && bag.count(actor.equipment) === 0) actor.equipment = undefined
    if (actor.inventory.count('carne_crua') > 0) {
      if (actor.rawUntil === undefined) actor.rawUntil = this.turn + RAW_MEAT_LIFE
    } else actor.rawUntil = undefined
  }

  #ageRawMeat() {
    for (const character of this.#characters) {
      const raw = character.inventory.count('carne_crua')
      if (!raw) { character.rawUntil = undefined; continue }
      if (character.rawUntil === undefined) {
        character.rawUntil = this.turn + RAW_MEAT_LIFE
        continue
      }
      if (this.turn < character.rawUntil) continue
      if (character.inventory.exchange([{ item: 'carne_crua', quantity: raw }], [])) {
        character.rawUntil = undefined
        this.#addLog(`A carne crua de ${character.name} estragou.`)
      }
    }
  }

  // ---- validation ----------------------------------------------------------

  #materialCost(cost: Blueprint['custo']): Stack[] {
    return Object.entries(cost).filter(([, quantity]) => quantity > 0).map(([item, quantity]) => ({ item, quantity }))
  }

  #validWorkshopAction(action: Action): boolean {
    const actor = this.active
    switch (action.kind) {
      case 'invent':
      case 'research':
      case 'renovate':
        return false
      case 'wait':
      case 'demolish':
      case 'attack':
      case 'equip':
      case 'drop':
      case 'take':
      case 'repair':
        return this.#validCombatAction(action)
      case 'visit_research': {
        const topic = readTopic(action.topic)
        if (!topic || actor.research || actor.project || !same(action.at, this.researchTable)) return false
        return this.actions().some(choice => (topic.kind === 'recipe' && choice.kind === 'research')
          || (topic.kind === 'blueprint' && choice.kind === 'invent' && !!topic.water === !!choice.water)
          || (topic.kind === 'renovation' && choice.kind === 'renovate' && topic.objectId === choice.objectId))
      }
      case 'finish_research':
        return this.#atResearchTable(action.at)
      case 'record_project':
        return this.#atResearchTable(action.at) && this.canRecordProject(action.project)
      case 'archive_project':
        return this.#projectImpossible() && same(action.at, actor.at)
      case 'expand': {
        const expansion = this.#prepareExpansion()
        return !!expansion && same(action.at, expansion.at)
      }
      case 'eat': {
        const food = action.food === 'carne_assada' ? 'carne_assada' : 'fruta'
        return same(action.at, actor.at) && actor.inventory.count(food) > 0
      }
      case 'cook': {
        const station = this.installed.find(entry => same(entry.at, action.at)
          && this.item(entry.item)?.capability === 'aquecer')
        return !!station && actor.inventory.count('carne_crua') > 0
          && ['madeira', 'carvao'].some(id => actor.inventory.count(id) > 0)
      }
      case 'drink':
        return same(action.at, actor.at) && this.bag.agua > 0
      case 'plant':
        return same(action.at, this.map.findSite('horta').area[0]) && this.gardenStage === 'vazia'
          && actor.inventory.count(fruitSeed) > 0
      case 'water':
        return same(action.at, this.map.findSite('horta').area[0]) && this.gardenStage === 'crescendo' && this.bag.agua > 0
      case 'pickup': {
        if (action.source === 'workshop') return this.#workshop.canPickup(action.sourceId, action.at, this.workbench, action.item, actor.inventory)
        const target = this.#inventions.find(item => item.id === action.sourceId)
        return action.source === 'invention' && !!target && same(action.at, target.at) && inList(action.item, resources)
          && target.collectable(action.item, actor.inventory) > 0
      }
      case 'pickup_kit':
        return !!actor.kit?.atBench && same(action.at, this.workbench)
          && actor.inventory.canExchange([], this.#kitOutput())
      case 'use': {
        const target = this.#inventions.find(item => item.id === action.objectId)
        return !!target && same(action.at, target.at) && target.canUse(this.turn, actor.inventory, actor.vitals)
      }
      case 'gather': {
        if (!this.map.contains(action.source) || !inList(action.resource, naturalItems)
          || !int(action.quantity, 1, Math.min(3, this.harvestable(action.source, action.resource)))) return false
        const accessible = action.resource === 'agua'
          ? Math.abs(action.at.x - action.source.x) + Math.abs(action.at.y - action.source.y) === 1
          : same(action.at, action.source)
        return accessible && !same(this.workbench, action.source) && !same(this.researchTable, action.source)
          && !this.installed.some(s => same(s.at, action.source))
          && !this.#inventions.some(b => same(b.at, action.source))
          && actor.inventory.canExchange([], [{ item: action.resource, quantity: action.quantity }])
      }
      case 'learn':
        return this.#atResearchTable(action.at) && actor.research?.kind === 'recipe'
          && this.turn >= actor.nextWorkshop && this.canLearn(action.recipe)
      case 'craft': {
        const recipe = this.#workshop.book.get(action.recipeId)
        return !!recipe && this.#workshop.canCraft(recipe, action.at, this.workbench, actor.inventory)
      }
      case 'install':
        return this.#workshop.canInstall(action.item, actor.inventory) && this.constructionTiles().some(p => same(p, action.at))
          && !!this.#installationLook(action.item)
      default:
        return true
    }
  }

  #validCombatAction(action: Action): boolean {
    const actor = this.active
    switch (action.kind) {
      case 'wait':
        return true
      case 'attack': {
        if (action.target.kind === 'animal') {
          const animal = this.#animals.find(entry => entry.id === action.target.id)
          const spot = animal ? this.#attackSpot(animal.at) : undefined
          return !!spot && same(action.at, spot)
        }
        const target = this.character(action.target.id)
        const spot = target?.alive ? this.#attackSpot(target.at) : undefined
        return !!spot && same(action.at, spot)
      }
      case 'equip': {
        const item = this.item(action.item)
        return same(action.at, actor.at) && actor.inventory.count(action.item) > 0
          && !!item && ((item.damage ?? 0) > 0 || (item.protection ?? 0) > 0)
      }
      case 'drop':
        return same(action.at, actor.at) && int(action.quantity, 1, 8) && actor.inventory.count(action.item) >= action.quantity
          && this.opponent.alive
          && Math.abs(this.opponent.at.x - actor.at.x) + Math.abs(this.opponent.at.y - actor.at.y) <= 2
      case 'take': {
        const drop = this.#drops.find(entry => entry.id === action.dropId)
        return !!drop && same(action.at, drop.at)
      }
      case 'repair': {
        const target = this.#inventions.find(item => item.id === action.objectId)
        const spot = target ? this.#attackSpot(target.at) : undefined
        return !!target && target.broken && !!spot && same(action.at, spot) && this.bag.madeira > 0
      }
      case 'demolish': {
        const target = this.#inventions.find(item => item.id === action.objectId)
        const spot = target ? this.#attackSpot(target.at) : undefined
        return !!target && target.owner !== actor.id && !!spot && same(action.at, spot)
      }
      default:
        return true
    }
  }
}
