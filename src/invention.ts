import { hasWaterSupply, inList, readBlueprint, readRenovation, record, resources, stats } from './blueprint.ts'
import type { Bag, Blueprint, Renovation, Resource, Rule } from './blueprint.ts'
import type { Point } from './world-map.ts'
import type { Inventory } from './inventory.ts'
import { appearanceFor } from './appearance.ts'
import { primaryRules } from './identity.ts'
import { editComposition } from './modules.ts'
import type { Composition } from './modules.ts'
import { int, limit, metrics, text } from './world-values.ts'
import type { Vitals } from './vitals.ts'

type RenovationEntry = { turn: number; text: string }
export type BuildState = {
  id: number; at: Point; plan: Blueprint; stock: Bag; uses: number; lastUse: number
  owner: string
  broken?: true
  renovations?: RenovationEntry[]
}
const STOCK_LIMIT = 8
const WATER_RESERVE = 4
const isUse = (rule: Rule) => rule.gatilho === 'uso' && rule.verbo !== 'transferir'
const RENOVATION_HISTORY = 8
const RENOVATION_LIMIT = 2
const RENOVATION_COOLDOWN = 20

export class Invention {
  readonly #build: BuildState

  private constructor(build: BuildState) {
    this.#build = build
  }

  static create(id: number, at: Point, plan: Blueprint, owner: string): Invention {
    const stored = structuredClone(plan)
    // Even a legacy kit can't bring mixed functions into the world.
    stored.regras = primaryRules(stored)
    return new Invention({ id, at: { ...at }, plan: stored, stock: { madeira: 0, pedra: 0, agua: 0, fruta: 0 }, uses: 0, lastUse: -10, owner })
  }

  static fromData(value: unknown, turn: number): Invention | null {
    const build = record(value)
    const at = record(build?.at)
    const parsed = readBlueprint(build?.plan)
    const plan = parsed && { ...parsed, regras: primaryRules(parsed) }
    const stock = metrics(build?.stock, resources, STOCK_LIMIT)
    const owner = build?.owner === undefined ? 'laya' : build.owner
    if (!build || !at || !int(at.x) || !int(at.y) || !plan || !stock
      || (owner !== 'laya' && owner !== 'kael') || (build.broken !== undefined && build.broken !== true)
      || !int(build.id, 1, turn) || !int(build.uses, 0, turn) || !int(build.lastUse, -10, turn)) return null
    const { id, uses, lastUse } = build
    const renovations: RenovationEntry[] = []
    if (build.renovations !== undefined) {
      if (!Array.isArray(build.renovations) || build.renovations.length > RENOVATION_HISTORY) return null
      let previous = id
      for (const item of build.renovations) {
        const entry = record(item)
        if (!entry || !int(entry.turn, previous + 1, turn) || !text(entry.text, 130)) return null
        renovations.push({ turn: entry.turn, text: entry.text })
        previous = entry.turn
      }
    }
    return new Invention({
      id, at: { x: at.x, y: at.y }, plan, stock, uses, lastUse, owner,
      ...(build.broken ? { broken: true as const } : {}),
      ...(renovations.length ? { renovations } : {}),
    })
  }

  get id() { return this.#build.id }
  get at(): Point { return { ...this.#build.at } }
  get name() { return this.#build.plan.nome }
  get description() { return this.#build.plan.ideia }
  get kind() { return this.#build.plan.tipo }
  get appearance() { return appearanceFor(this.#build.plan) }
  get uses() { return this.#build.uses }
  get owner() { return this.#build.owner }
  get broken() { return this.#build.broken === true }
  get suppliesWater() { return !this.broken && hasWaterSupply(this.#build.plan.regras) }
  get collectsRain() { return !this.broken && this.#build.plan.regras.some(r => r.verbo === 'gerar' && r.alvo === 'agua' && r.gatilho === 'chuva') }
  get lastRenovation() {
    const history = this.#build.renovations
    return history?.[history.length - 1]?.turn ?? 0
  }

  canRenovate(turn: number) {
    const renovations = this.#build.renovations?.length ?? 0
    return this.uses >= 1 && renovations < RENOVATION_LIMIT && turn - this.id >= 3
      && (!this.lastRenovation || turn - this.lastRenovation >= RENOVATION_COOLDOWN)
  }

  previewRenovation(value: unknown): { upgrade: Renovation; plan: Blueprint } | null {
    const upgrade = readRenovation(value)
    if (!upgrade) return null
    const current = this.#build.plan
    const added = new Set(current.pecas.map(part => JSON.stringify(part)))
    const pieces = upgrade.visual === 'substituir' ? upgrade.pecas : [
      ...current.pecas, ...upgrade.pecas.filter(part => {
        const key = JSON.stringify(part)
        if (added.has(key)) return false
        added.add(key)
        return true
      }),
    ]
    // A reforma é só desenho: as regras do objeto ficam congeladas desde a criação.
    const originalLook = appearanceFor(current)
    const editedLook = upgrade.modulo ? editComposition(originalLook, upgrade.modulo) : null
    if (upgrade.modulo && !editedLook) return null
    const appearance = editedLook ?? upgrade.aparencia
    const plan = readBlueprint({ ...current, pecas: pieces, ...(appearance ? { aparencia: appearance } : {}) })
    const changesLook = !!plan && JSON.stringify(appearanceFor(plan)) !== JSON.stringify(originalLook)
    if (!plan || (!changesLook && JSON.stringify(plan.pecas) === JSON.stringify(current.pecas))) return null
    return { upgrade, plan }
  }

  applyRenovation(plan: Blueprint, turn: number, summary: string) {
    this.#build.plan = structuredClone(plan)
    const history = this.#build.renovations ?? []
    this.#build.renovations = [...history, { turn, text: summary }].slice(-RENOVATION_HISTORY)
  }

  setAppearance(appearance: Composition) {
    this.#build.plan = { ...this.#build.plan, aparencia: structuredClone(appearance) }
  }

  breakDown() {
    if (this.broken) return false
    this.#build.broken = true
    return true
  }

  repair() {
    if (!this.broken) return false
    delete this.#build.broken
    return true
  }

  toData(): BuildState { return structuredClone(this.#build) }
  fork(): Invention {
    // A reforma troca o plano e o histórico no próximo turno sem alterar os valores anteriores.
    return new Invention({ ...this.#build, stock: { ...this.#build.stock } })
  }

  canUse(turn: number, bag: Inventory, vitals: Vitals) {
    return !this.broken && turn - this.#build.lastUse >= 3
      && this.#apply(isUse, { ...this.#build.stock }, bag.fork(), { ...vitals }).length > 0
  }

  collectable(resource: Resource, bag: Inventory) {
    if (this.broken) return 0
    const rules = this.#build.plan.regras
    const outlet = rules.find(r => r.gatilho === 'uso' && r.verbo === 'transferir' && r.alvo === resource)
    const canConvert = (resource === 'madeira' || resource === 'pedra') && rules.some(r => r.verbo === 'converter' && r.alvo === resource)
    const capacity = resource === 'agua' ? WATER_RESERVE - bag.count(resource) : STOCK_LIMIT
    for (let quantity = Math.min(this.#build.stock[resource], capacity, outlet?.quantidade ?? (canConvert ? 3 : 0)); quantity > 0; quantity--) {
      if (bag.canExchange([], [{ item: resource, quantity }])) return quantity
    }
    return 0
  }

  withdraw(resource: Resource, bag: Inventory) {
    const quantity = this.collectable(resource, bag)
    if (!quantity || !bag.exchange([], [{ item: resource, quantity }])) return 0
    this.#build.stock[resource] -= quantity
    this.#build.uses++
    return quantity
  }

  use(turn: number, bag: Inventory, vitals: Vitals): string[] {
    if (this.broken) return []
    this.#build.lastUse = turn
    const effects = this.#apply(isUse, this.#build.stock, bag, vitals)
    if (effects.length) this.#build.uses++
    return effects
  }

  tick(rain: boolean, dawn: boolean, bag: Inventory, vitals: Vitals): string[] {
    if (this.broken) return []
    return this.#apply(r => (r.gatilho === 'chuva' && rain) || (r.gatilho === 'amanhecer' && dawn),
      this.#build.stock, bag, vitals)
  }

  #apply(matches: (rule: Rule) => boolean, stock: Bag, bag: Inventory, vitals: Vitals) {
    return this.#build.plan.regras.filter(matches)
      .map(rule => this.#applyRule(rule, stock, bag, vitals)).filter(Boolean)
  }

  #applyRule(rule: Rule, stock: Bag, bag: Inventory, vitals: Vitals): string {
    const { verbo, alvo, insumo, quantidade } = rule
    if (verbo === 'efeito' && inList(alvo, stats)) {
      const delta = alvo === 'fome' ? -quantidade : quantidade
      const next = limit(vitals[alvo] + delta)
      if (next === vitals[alvo]) return ''
      if (insumo !== 'nenhum') {
        if (stock[insumo] > 0) stock[insumo]--
        else if (!bag.exchange([{ item: insumo, quantity: 1 }], [])) return ''
      }
      const difference = next - vitals[alvo]
      vitals[alvo] = next
      return `${alvo} ${difference > 0 ? '+' : ''}${difference}`
    }
    if (!inList(alvo, resources)) return ''
    if (verbo === 'gerar') {
      if (alvo !== 'agua') return '' // Fruit now comes from actual plants, not passive invention rules in old saves.
      const before = stock[alvo]
      stock[alvo] = limit(before + quantidade, STOCK_LIMIT)
      return stock[alvo] > before ? `guardou ${stock[alvo] - before} ${alvo}` : ''
    }
    if (verbo === 'converter' && alvo !== 'agua' && alvo !== 'fruta' && insumo !== 'nenhum'
      && stock[alvo] < STOCK_LIMIT && bag.exchange([{ item: insumo, quantity: 1 }], [])) {
      stock[alvo]++
      return `transformou ${insumo} em ${alvo} e guardou no estoque`
    }
    return ''
  }
}
