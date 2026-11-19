import { record } from './blueprint.ts'
import { int } from './world-values.ts'
import { pointKey, same } from './world-map.ts'
import type { Point, WorldMap } from './world-map.ts'

export const naturalItems = ['madeira', 'pedra', 'agua', 'fruta', 'grama', 'terra', 'areia'] as const
export type NaturalItem = typeof naturalItems[number]
type Cell = { wood: number; stone: number; water: number; fruit: number; layers: number; crop?: number }
type Change = Cell & { at: Point }
const MAX_WATER = 4
const GARDEN_FRUIT = 4
const WILD_FRUIT = 3
const MATURE = 7
const limits = { wood: 3, stone: 12, water: MAX_WATER, layers: 2 } as const

export class Terrain {
  readonly #map: WorldMap
  readonly #changes = new Map<string, Change>()
  readonly #trees: Set<string>
  readonly #garden: Point
  constructor(map: WorldMap) {
    this.#map = map
    this.#trees = new Set([...map.trees, map.findSite('bosque').area[0]].map(pointKey))
    this.#garden = map.findSite('horta').area[0]
  }

  static fromData(value: unknown, map: WorldMap): Terrain | null {
    if (!Array.isArray(value) || value.length > map.tiles.length) return null
    const terrain = new Terrain(map)
    const points = new Map(map.tiles.map(p => [pointKey(p), p]))
    for (const raw of value) {
      const cell = record(raw)
      const at = record(cell?.at)
      if (!cell || !at || !int(at.x) || !int(at.y)) return null
      const key = pointKey({ x: at.x, y: at.y })
      const point = points.get(key)
      if (!point || terrain.#changes.has(key)) return null
      const base = terrain.#initial(point)
      const garden = same(point, terrain.#garden)
      const crop = cell.crop
      if (!int(cell.wood, 0, base.wood) || !int(cell.stone, 0, base.stone) || !int(cell.water, 0, base.water)
        || !int(cell.fruit, 0, garden ? GARDEN_FRUIT : base.fruit) || !int(cell.layers, 0, base.layers)
        || (crop !== undefined && (!garden || !int(crop, 1, MATURE) || (crop === MATURE) !== (cell.fruit > 0)))) return null
      // Legacy gardens produced fruit without a crop. Stored inventory is not affected.
      terrain.#set(point, { wood: cell.wood, stone: cell.stone, water: cell.water, fruit: garden && !crop ? 0 : cell.fruit,
        layers: cell.layers, ...(crop ? { crop } : {}) })
    }
    return terrain
  }

  toData(): Change[] { return [...this.#changes.values()].map(c => ({ ...c, at: { ...c.at } })) }
  fork(): Terrain {
    const next = new Terrain(this.#map)
    for (const [key, change] of this.#changes) next.#changes.set(key, change)
    return next
  }
  /** Keeps every harvested cell when the vale grows and gets a bigger map. */
  rebase(map: WorldMap): Terrain {
    const next = new Terrain(map)
    for (const [key, change] of this.#changes) next.#changes.set(key, change)
    return next
  }
  tree(at: Point): 'em_pe' | 'caida' | undefined {
    return this.#trees.has(pointKey(at)) ? this.#cell(at).wood ? 'em_pe' : 'caida' : undefined
  }
  water(at: Point) { return this.#cell(at).water }
  surface(at: Point): 'grama' | 'terra' | 'pedra' | 'areia' | 'agua' {
    const c = this.#cell(at)
    if (c.water) return 'agua'
    if (!c.layers) return 'pedra'
    return this.#sandy(at) ? 'areia' : c.layers === 2 ? 'grama' : 'terra'
  }

  available(at: Point, item: NaturalItem): number {
    const cell = this.#cell(at)
    const site = this.#map.siteAt(at)?.kind
    if (item === 'agua') return cell.water
    if (cell.water) return 0
    if (item === 'madeira') return cell.wood
    if (item === 'fruta') return cell.fruit
    if (same(at, this.#map.fruitTree) && site !== 'bosque') return 0
    if (item === 'pedra') return site === 'pedreira' || !cell.layers ? cell.stone : 0
    if (cell.wood || (site && site !== 'lago' && site !== 'margem')) return 0
    return this.surface(at) === item ? 1 : 0
  }

  harvest(at: Point, item: NaturalItem, count: number): boolean {
    if (!int(count, 1, this.available(at, item))) return false
    const cell = { ...this.#cell(at) }
    switch (item) {
      case 'madeira': cell.wood -= count; break
      case 'pedra': cell.stone -= count; break
      case 'agua': cell.water -= count; break
      case 'fruta':
        cell.fruit -= count
        if (!cell.fruit) delete cell.crop
        break
      default: cell.layers--
    }
    this.#set(at, cell)
    return true
  }

  get gardenStage(): 'vazia' | 'crescendo' | 'madura' {
    const crop = this.#cell(this.#garden).crop
    return crop === MATURE ? 'madura' : crop ? 'crescendo' : 'vazia'
  }

  plant() {
    if (this.gardenStage !== 'vazia') return false
    this.#set(this.#garden, { ...this.#cell(this.#garden), crop: 1 })
    return true
  }

  growGarden(moisture: number) {
    const cell = this.#cell(this.#garden)
    if (!cell.crop || cell.crop === MATURE || moisture < 30) return false
    const crop = cell.crop + 1
    this.#set(this.#garden, { ...cell, crop, fruit: crop === MATURE ? GARDEN_FRUIT : 0 })
    return crop === MATURE
  }

  regrowWildFruit() {
    const at = this.#map.fruitTree
    const cell = this.#cell(at)
    if (cell.fruit < WILD_FRUIT) this.#set(at, { ...cell, fruit: WILD_FRUIT })
  }

  #cell(at: Point): Cell { return this.#changes.get(pointKey(at)) ?? this.#initial(at) }
  #set(at: Point, cell: Cell) { this.#changes.set(pointKey(at), { ...cell, at: { ...at } }) }
  #sandy(at: Point) {
    const kind = this.#map.siteAt(at)?.kind
    return kind === 'lago' || kind === 'margem'
  }
  #initial(at: Point): Cell {
    const site = this.#map.siteAt(at)?.kind
    return {
      wood: this.#trees.has(pointKey(at)) ? limits.wood : 0,
      stone: site === 'pedreira' ? limits.stone : 2,
      water: site === 'lago' ? MAX_WATER : 0,
      fruit: same(at, this.#map.fruitTree) ? WILD_FRUIT : 0,
      layers: site === 'pedreira' ? 0 : this.#sandy(at) ? 1 : 2,
    }
  }
}
