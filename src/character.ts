import { inList, readBlueprint, record } from './blueprint.ts'
import type { Bag, Blueprint } from './blueprint.ts'
import { Inventory, itemId, inventionKit } from './inventory.ts'
import type { ItemCatalog, Slot } from './inventory.ts'
import { readProject, readTopic } from './research.ts'
import type { ResearchProject, ResearchTopic } from './research.ts'
import { int, limit, text } from './world-values.ts'
import { readVitals } from './vitals.ts'
import type { Vitals } from './vitals.ts'
import { same } from './world-map.ts'
import type { Point, WorldMap } from './world-map.ts'

export const characterIds = ['laya', 'kael'] as const
export type CharacterId = typeof characterIds[number]
export const fighterNames: Record<CharacterId, string> = { laya: 'Laya', kael: 'Kael' }

export type CharacterData = {
  id: CharacterId
  name: string
  at: Point
  vitals: Vitals
  bag: Slot[]
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

export type Kit = { plan: Blueprint; plot: Point; atBench?: true }
const STARTER: Bag = { madeira: 4, pedra: 3, agua: 2, fruta: 0 }

function starterInventory(catalog: ItemCatalog) {
  const inventory = new Inventory(catalog)
  if (!inventory.exchange([], Object.entries(STARTER).filter(([, n]) => n > 0).map(([item, quantity]) => ({ item, quantity })))) return null
  return inventory
}

export class Character {
  readonly id: CharacterId
  readonly name: string
  at: Point
  readonly vitals: Vitals
  readonly inventory: Inventory
  xp = 0
  alive = true
  equipment?: string
  rawUntil?: number
  nextIdea: number
  nextWaterIdea: number
  nextWorkshop: number
  lastAction = ''
  walks = 0
  kit?: Kit
  research?: ResearchTopic
  project?: ResearchProject
  projectSince?: number

  private constructor(id: CharacterId, name: string, at: Point, vitals: Vitals, inventory: Inventory, turn: number) {
    this.id = id
    this.name = name
    this.at = { ...at }
    this.vitals = vitals
    this.inventory = inventory
    this.nextIdea = turn
    this.nextWaterIdea = turn
    this.nextWorkshop = turn + 2
  }

  static create(id: CharacterId, at: Point, catalog: ItemCatalog, turn = 0): Character | null {
    const inventory = starterInventory(catalog)
    if (!inventory) return null
    return new Character(id, fighterNames[id], at, {
      energia: 82, fome: 24, alegria: 62, umidade: 36, sede: 18, hp: 100,
    }, inventory, turn)
  }

  static fromData(value: unknown, catalog: ItemCatalog, map: WorldMap, turn: number, id: CharacterId): Character | null {
    const raw = record(value)
    const at = record(raw?.at ?? raw?.position)
    const vitals = readVitals(raw?.vitals)
    const inventory = Inventory.fromData(raw?.bag ?? raw?.inventory, catalog)
    const name = typeof raw?.name === 'string' && text(raw.name, 40) ? raw.name.trim() : fighterNames[id]
    const xp = raw?.xp === undefined ? 0 : raw.xp
    const alive = raw?.alive === undefined ? true : raw.alive
    const equipment = raw?.equipment ?? raw?.weapon
    const rawUntil = raw?.rawUntil === undefined ? undefined : raw.rawUntil
    const nextWorkshop = raw?.nextWorkshop === undefined ? turn + 2 : raw.nextWorkshop
    const nextWaterIdea = raw?.nextWaterIdea === undefined ? turn : raw.nextWaterIdea
    if (!raw || !at || !int(at.x) || !int(at.y) || !map.contains(at) || !vitals || !inventory
      || typeof alive !== 'boolean' || !int(xp, 0, 1_000_000)
      || (equipment !== undefined && equipment !== null && (!itemId(equipment) || !catalog.get(equipment)))
      || (rawUntil !== undefined && !int(rawUntil, 0, turn + 100))
      || !int(nextWorkshop) || !int(nextWaterIdea)
      || !int(raw.nextIdea) || !int(raw.walks, 0, turn) || typeof raw.lastAction !== 'string' || raw.lastAction.length > 100) return null
    const character = new Character(id, name, { x: at.x, y: at.y }, vitals, inventory, turn)
    character.xp = xp
    character.alive = alive
    character.rawUntil = rawUntil
    // Equipar não tira o item da mochila; se ele não estiver mais lá, o slot fica vazio.
    character.equipment = equipment && inventory.count(equipment) > 0 ? equipment : undefined
    character.nextIdea = raw.nextIdea
    character.nextWaterIdea = nextWaterIdea
    character.nextWorkshop = nextWorkshop
    character.lastAction = raw.lastAction
    character.walks = raw.walks
    const storedKit = raw.kit === undefined ? undefined : record(raw.kit)
    const kitPlan = readBlueprint(storedKit?.plan)
    const kit: Kit | undefined = kitPlan && map.contains(storedKit?.plot)
      && (storedKit.atBench === undefined || storedKit.atBench === true)
      && !kitPlan.materiais?.some(m => catalog.get(m.item)?.kind !== 'material')
      ? { plan: kitPlan, plot: { ...storedKit.plot }, ...(storedKit.atBench ? { atBench: true as const } : {}) } : undefined
    if ((raw.kit !== undefined && !kit) || inventory.count(inventionKit.id) !== (kit && !kit.atBench ? 1 : 0)) return null
    character.kit = kit
    const research = readTopic(raw.research)
    const project = readProject(raw.project, map)
    const projectSince = raw.projectSince === undefined ? undefined
      : int(raw.projectSince, 0, turn) ? raw.projectSince : null
    if (projectSince === null || (projectSince !== undefined && !project)
      || (raw.research !== undefined && (!research || !same(character.at, map.researchTable)))
      || (raw.project !== undefined && !project) || (research && project)) return null
    character.research = research ?? undefined
    character.project = project ?? undefined
    character.projectSince = projectSince ?? undefined
    return character
  }

  get bag(): Readonly<Bag> {
    return {
      madeira: this.inventory.count('madeira'), pedra: this.inventory.count('pedra'),
      agua: this.inventory.count('agua'), fruta: this.inventory.count('fruta'),
    }
  }

  fork(catalog: ItemCatalog): Character {
    const copy = new Character(this.id, this.name, this.at, { ...this.vitals }, this.inventory.fork(catalog), this.nextIdea)
    copy.xp = this.xp
    copy.alive = this.alive
    copy.equipment = this.equipment
    copy.rawUntil = this.rawUntil
    copy.nextIdea = this.nextIdea
    copy.nextWaterIdea = this.nextWaterIdea
    copy.nextWorkshop = this.nextWorkshop
    copy.lastAction = this.lastAction
    copy.walks = this.walks
    copy.kit = this.kit && structuredClone(this.kit)
    copy.research = this.research && structuredClone(this.research)
    copy.project = this.project && structuredClone(this.project)
    copy.projectSince = this.projectSince
    return copy
  }

  damage(amount: number) {
    this.vitals.hp = limit(this.vitals.hp - Math.max(1, Math.round(amount)))
    return this.vitals.hp === 0
  }

  toData(): CharacterData {
    return {
      id: this.id, name: this.name, at: { ...this.at }, vitals: { ...this.vitals }, bag: this.inventory.slots,
      xp: this.xp, alive: this.alive, ...(this.equipment ? { equipment: this.equipment } : {}),
      ...(this.rawUntil !== undefined ? { rawUntil: this.rawUntil } : {}),
      nextIdea: this.nextIdea, nextWaterIdea: this.nextWaterIdea, nextWorkshop: this.nextWorkshop,
      lastAction: this.lastAction, walks: this.walks,
      ...(this.kit ? { kit: structuredClone(this.kit) } : {}),
      ...(this.research ? { research: structuredClone(this.research) } : {}),
      ...(this.project ? { project: structuredClone(this.project) } : {}),
      ...(this.projectSince !== undefined ? { projectSince: this.projectSince } : {}),
    }
  }
}

export function readCharacterId(value: unknown): CharacterId | null {
  return inList(value, characterIds) ? value : null
}
