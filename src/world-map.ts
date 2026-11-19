import { inList, record } from './blueprint.ts'
import { int, text } from './world-values.ts'

export type Point = Readonly<{ x: number; y: number }>
type Landmark = Readonly<{ name: string; area: readonly Point[] }>
const coreKinds = ['casa', 'horta', 'bosque', 'pedreira', 'margem'] as const
const siteKinds = [...coreKinds, 'lago', 'marco'] as const
export type Site = Landmark & Readonly<{ id: string; kind: typeof siteKinds[number] }>
export type MapData = Readonly<{
  name: string
  width: number
  height: number
  buildLimit: number
  buildMargin: number
  sites: readonly Site[]
  trails: readonly Point[]
  trees: readonly Point[]
  lookouts: readonly Point[]
  climate: Readonly<{ sunrise: number; sunset: number; cycleStart: number; phaseMinutes: number; rainPhases: readonly boolean[] }>
  fruitTree?: Point
  researchTable?: Point
}>

export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y
export const pointKey = (p: Point) => `${p.x},${p.y}`
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
const inside = (bounds: Pick<MapData, 'width' | 'height'>, p: unknown): p is Point => {
  const point = record(p)
  return !!point && int(point.x, 0, bounds.width - 1) && int(point.y, 0, bounds.height - 1)
}

export class WorldMap {
  readonly #data: MapData
  readonly #sitesByTile = new Map<string, Site>()
  readonly #trails: Set<string>
  readonly #tiles: readonly Point[]
  #fruitTree?: Point
  #researchTable?: Point

  private constructor(data: MapData) {
    this.#data = data
    for (const site of data.sites) for (const at of site.area) this.#sitesByTile.set(pointKey(at), site)
    this.#trails = new Set(data.trails.map(pointKey))
    this.#tiles = Object.freeze(Array.from({ length: this.width * this.height }, (_, i) =>
      Object.freeze({ x: i % this.width, y: Math.floor(i / this.width) })))
  }

  static fromData(value: unknown): WorldMap | null {
    const raw = record(value)
    if (!raw || !text(raw.name, 60) || !int(raw.width, 4, 16) || !int(raw.height, 4, 16)
      || !int(raw.buildLimit, 0, 40) || !int(raw.buildMargin, 0, 2)
      || !Array.isArray(raw.sites) || raw.sites.length > 24) return null
    const { name, width, height, buildLimit, buildMargin } = raw
    const points = (value: unknown): readonly Point[] | null => {
      if (!Array.isArray(value) || value.length > width * height || !value.every(p => inside({ width, height }, p))) return null
      const result = value.map(({ x, y }) => Object.freeze({ x, y }))
      return new Set(result.map(pointKey)).size === result.length ? Object.freeze(result) : null
    }
    const sites: Site[] = []
    for (const site of raw.sites) {
      const s = record(site)
      if (!s || !text(s.id, 48) || !text(s.name, 48) || !inList(s.kind, siteKinds)) return null
      const area = points(s.area)
      if (!area?.length) return null
      sites.push(Object.freeze({ id: s.id, kind: s.kind, name: s.name, area }))
    }
    const occupied = sites.flatMap(site => site.area.map(pointKey))
    if (new Set(occupied).size !== occupied.length || new Set(sites.map(site => site.id)).size !== sites.length
      || !coreKinds.every(kind => sites.filter(site => site.kind === kind).length === 1)) return null

    const trails = points(raw.trails)
    const trees = points(raw.trees)
    const lookouts = points(raw.lookouts)
    const landmark = (value: unknown): Point | undefined | null => value === undefined ? undefined
      : inside({ width, height }, value) ? Object.freeze({ x: value.x, y: value.y }) : null
    const fruitTree = landmark(raw.fruitTree)
    const researchTable = landmark(raw.researchTable)
    const climate = record(raw.climate)
    if (!trails || !trees || !lookouts?.length || fruitTree === null || researchTable === null || !climate
      || !int(climate.sunrise, 0, 1439) || !int(climate.sunset, climate.sunrise + 1, 1439)
      || !int(climate.cycleStart, 0, 1439) || !int(climate.phaseMinutes, 1, 1440)
      || !Array.isArray(climate.rainPhases) || climate.rainPhases.length < 1 || climate.rainPhases.length > 24
      || !climate.rainPhases.every(item => typeof item === 'boolean')) return null
    const { sunrise, sunset, cycleStart, phaseMinutes, rainPhases } = climate
    const map = new WorldMap({
      name, width, height, buildLimit, buildMargin, sites: Object.freeze(sites), trails, trees, lookouts,
      ...(fruitTree ? { fruitTree } : {}), ...(researchTable ? { researchTable } : {}),
      climate: Object.freeze({ sunrise, sunset, cycleStart, phaseMinutes, rainPhases: Object.freeze([...rainPhases]) }),
    })
    if ([...trails, ...trees, ...(fruitTree ? [fruitTree] : []), ...(researchTable ? [researchTable] : [])].some(p => map.isWater(p))) return null
    const home = map.findSite('casa').area[0]
    return [...lookouts, ...sites.filter(s => s.kind !== 'lago').map(s => s.area[0])]
      .every(p => map.pathTo(home, p) !== null) ? map : null
  }

  get name() { return this.#data.name }
  get width() { return this.#data.width }
  get height() { return this.#data.height }
  get buildLimit() { return this.#data.buildLimit }
  get sites() { return this.#data.sites }
  get trees() { return this.#data.trees }
  get lookouts() { return this.#data.lookouts }
  get tiles() { return this.#tiles }
  get workbench(): Point {
    const home = this.findSite('casa').area[0]
    // A tile that legacy builds could never occupy. On a cramped custom map, use the porch.
    return this.tiles.find(at => distance(at, home) === 1 && !this.isBuildTile(at)
      && !this.siteAt(at) && !this.trees.some(tree => same(tree, at))) ?? home
  }
  get fruitTree(): Point {
    if (this.#data.fruitTree) return this.#data.fruitTree
    if (this.#fruitTree) return this.#fruitTree
    const woods = this.findSite('bosque').area[0]
    const bench = this.workbench
    // Use spare non-building ground so migration never displaces installed objects.
    return this.#fruitTree = this.tiles.filter(at => !same(at, bench) && !this.siteAt(at) && !this.isBuildTile(at)
      && !this.trees.some(tree => same(tree, at)) && this.pathTo(woods, at))
      .sort((a, b) => distance(a, woods) - distance(b, woods))[0] ?? woods
  }
  get researchTable(): Point {
    if (this.#data.researchTable) return this.#data.researchTable
    if (this.#researchTable) return this.#researchTable
    const home = this.findSite('casa').area[0]
    const bench = this.workbench
    const tree = this.fruitTree
    // Don't take a previously buildable tile or move an existing tree when opening an old save.
    const candidates = this.tiles.filter(at => !same(at, bench) && !same(at, tree) && !this.siteAt(at)
      && !this.isBuildTile(at) && !this.trees.some(tree => same(tree, at)) && this.pathTo(home, at))
    return this.#researchTable = candidates.sort((a, b) => distance(a, home) - distance(b, home))[0] ?? home
  }

  toData(): MapData { return structuredClone(this.#data) }

  findSite(kind: typeof coreKinds[number]): Site {
    return this.sites.find(site => site.kind === kind)!
  }

  siteAt(at: Point) { return this.#sitesByTile.get(pointKey(at)) }
  hasTrail(at: Point) { return this.#trails.has(pointKey(at)) }
  isWater(at: Point) { return this.siteAt(at)?.kind === 'lago' }
  isWalkable(at: unknown): at is Point { return inside(this, at) && !this.isWater(at) }

  isBuildTile(at: unknown, exposedLake = false): at is Point {
    const { buildMargin } = this.#data
    return inside(this, at) && at.x >= buildMargin && at.y >= buildMargin
      && at.x < this.width - buildMargin && at.y < this.height - buildMargin
      && (!this.siteAt(at) || (exposedLake && this.isWater(at)))
  }

  availablePlots(from: Point, occupied: readonly Point[], max: number, water = (p: Point) => this.isWater(p)): Point[] {
    const used = new Set(occupied.map(pointKey))
    const candidates = this.tiles.filter(p => this.isBuildTile(p, !water(p)) && !used.has(pointKey(p)))
      .sort((a, b) => distance(a, from) - distance(b, from))
    const reachable: Point[] = []
    for (const point of candidates) {
      if (this.pathTo(from, point, water)) reachable.push(point)
      if (reachable.length === max) break
    }
    return reachable
  }

  closestLandmark(at: Point, extra: readonly Landmark[]): string | undefined {
    let closest: Landmark | undefined
    let minimumDistance = Infinity
    for (const landmark of [...extra, ...this.sites]) {
      const steps = Math.min(...landmark.area.map(p => distance(p, at)))
      if (steps < minimumDistance) {
        closest = landmark
        minimumDistance = steps
      }
    }
    return closest?.name
  }

  weatherAt(minute: number) {
    const { sunrise, sunset, cycleStart, phaseMinutes, rainPhases } = this.#data.climate
    const minuteOfDay = minute % 1440
    const phase = Math.floor(Math.max(0, minute - cycleStart) / phaseMinutes) % rainPhases.length
    return { rain: rainPhases[phase], night: minuteOfDay < sunrise || minuteOfDay >= sunset }
  }

  crossedSunrise(from: number, to: number) {
    const { sunrise } = this.#data.climate
    return Math.floor((from - sunrise) / 1440) !== Math.floor((to - sunrise) / 1440)
  }

  contains(at: unknown): at is Point { return inside(this, at) }

  pathTo(from: Point, to: Point, water = (p: Point) => this.isWater(p)): Point[] | null {
    const walkable = (p: Point) => this.contains(p) && !water(p)
    if (!walkable(from) || !walkable(to)) return null
    const queue = [from]
    const parents = new Map<string, Point | null>([[pointKey(from), null]])
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]
      if (same(p, to)) {
        const route: Point[] = []
        for (let current: Point | null = p; current && !same(current, from); current = parents.get(pointKey(current)) ?? null) {
          route.unshift(current)
        }
        return route
      }
      const neighbors = [{ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 }]
      for (const next of neighbors) {
        const key = pointKey(next)
        if (!walkable(next) || parents.has(key)) continue
        queue.push(next)
        parents.set(key, p)
      }
    }
    return null
  }
}
