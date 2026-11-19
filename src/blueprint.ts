import { readAppearance } from './appearance.ts'
import type { Appearance } from './appearance.ts'
import { compatibleEditParts, palettes, partIds, readModuleEdit, slots } from './modules.ts'
import type { Composition, ModuleEdit, Slot } from './modules.ts'

export const resources = ['madeira', 'pedra', 'agua', 'fruta'] as const
export const stats = ['energia', 'fome', 'alegria', 'umidade'] as const
export const triggers = ['uso', 'chuva', 'amanhecer'] as const
export const operations = ['efeito', 'gerar', 'transferir', 'converter'] as const
export const shapes = ['bloco', 'oval', 'triangulo', 'haste', 'losango'] as const
export const colors = ['creme', 'verde', 'azul', 'laranja', 'marrom', 'rosa', 'lilas', 'amarelo'] as const

export type Resource = typeof resources[number]
export type Stat = typeof stats[number]
export type Bag = Record<Resource, number>
type PartBox = {
  cor: typeof colors[number]
  x: number
  y: number
  largura: number
  altura: number
}
type Dot = { x: number; y: number }
export type PathStep =
  | ({ op: 'M' | 'L' } & Dot)
  | ({ op: 'Q'; cx: number; cy: number } & Dot)
  | ({ op: 'C'; cx: number; cy: number; dx: number; dy: number } & Dot)
  | { op: 'Z' }
export type Part = PartBox & (
  | { forma: typeof shapes[number] }
  | { forma: 'contorno'; tracado: PathStep[] }
)
export type Rule = {
  gatilho: typeof triggers[number]
  verbo: typeof operations[number]
  alvo: Stat | Resource
  quantidade: number
  insumo: Resource | 'nenhum'
}
export type Blueprint = {
  nome: string
  tipo: 'lugar' | 'objeto'
  ideia: string
  custo: { madeira: number; pedra: number }
  materiais?: { item: string; quantity: number }[]
  aparencia?: Appearance
  pecas: Part[]
  regras: Rule[]
}
export type Renovation = {
  ideia: string
  custo: Blueprint['custo']
  visual: 'acrescentar' | 'substituir'
  aparencia?: Appearance
  modulo?: ModuleEdit | null
  pecas: Part[]
  regras: Rule[]
}

const oneOf = (values: readonly string[]) => ({ type: 'string', enum: values })
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum })
const object = (properties: Record<string, unknown>) => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
})

const ruleSchema = (gatilho: Rule['gatilho'], verbo: Rule['verbo'], alvo: readonly string[],
  quantidade: ReturnType<typeof integer>, insumo: readonly string[]) =>
  object({ gatilho: oneOf([gatilho]), verbo: oneOf([verbo]), alvo: oneOf(alvo), quantidade, insumo: oneOf(insumo) })

const simpleEffect = ruleSchema('uso', 'efeito', ['energia', 'alegria'], integer(3, 12), ['nenhum'])
const rainRule = ruleSchema('chuva', 'gerar', ['agua'], integer(1, 3), ['nenhum'])
const waterOutletRule = ruleSchema('uso', 'transferir', ['agua'], integer(1, 3), ['nenhum'])
const waterRules = { type: 'array', minItems: 2, maxItems: 2, items: { anyOf: [rainRule, waterOutletRule] } }
export const isWaterOutlet = (r: Rule) => r.gatilho === 'uso' && r.verbo === 'transferir' && r.alvo === 'agua'
export const hasWaterSupply = (rules: readonly Rule[]) => rules.some(r => r.gatilho === 'chuva' && r.verbo === 'gerar' && r.alvo === 'agua')
  && rules.some(isWaterOutlet)
const ruleVariants = [
  simpleEffect,
  ruleSchema('uso', 'efeito', ['energia', 'alegria'], integer(1, 12), resources),
  ruleSchema('uso', 'efeito', ['fome'], integer(1, 12), ['fruta']),
  ruleSchema('uso', 'efeito', ['umidade'], integer(1, 12), ['agua']),
  rainRule,
  ruleSchema('uso', 'transferir', resources, integer(1, 3), ['nenhum']),
  ruleSchema('uso', 'converter', ['madeira', 'pedra'], integer(1, 1), resources),
]

const nullable = (value: object) => ({ anyOf: [value, { type: 'null' }] })
const component = (ids: readonly string[]) => object({ peca: oneOf(ids), cor: oneOf(palettes) })
const choiceFor = (slot: Slot) => slot === 'base' ? component(partIds(slot)) : nullable(component(partIds(slot)))
const appearanceSchema = object(Object.fromEntries(slots.map(slot => [slot, choiceFor(slot)])))
const ideaSchema = { type: 'string', minLength: 8, maxLength: 130 }

export const blueprintSchema = object({
  nome: { type: 'string', minLength: 3, maxLength: 34 },
  tipo: oneOf(['lugar', 'objeto']),
  ideia: ideaSchema,
  custo: object({ madeira: integer(0, 4), pedra: integer(0, 4) }),
  aparencia: appearanceSchema,
  regras: {
    type: 'array', minItems: 1, maxItems: 4,
    items: { anyOf: ruleVariants },
  },
})

export function starterBlueprintSchema(safeLayout = false) {
  return object({
    ...blueprintSchema.properties,
    ...(safeLayout ? { aparencia: object({
      base: component(partIds('base')), suporte: { type: 'null' }, corpo: component(partIds('corpo')),
      topo: { type: 'null' }, adorno: nullable(component(partIds('adorno'))),
    }) } : {}),
    regras: { type: 'array', minItems: 1, maxItems: 1, items: simpleEffect },
  })
}

const affordableCost = (budget: Blueprint['custo'], cap: number) =>
  object({ madeira: integer(0, Math.min(budget.madeira, cap)), pedra: integer(0, Math.min(budget.pedra, cap)) })

export function waterBlueprintSchema(budget: Blueprint['custo'], simple: boolean) {
  const appearance = simple ? object({
    base: component(partIds('base')), suporte: { type: 'null' }, corpo: component(['bacia', 'barril']),
    topo: { type: 'null' }, adorno: nullable(component(partIds('adorno'))),
  }) : appearanceSchema
  return object({ ...blueprintSchema.properties, custo: affordableCost(budget, 4), aparencia: appearance, regras: waterRules })
}

export function materialBlueprintSchema() {
  return object({
    ...blueprintSchema.properties,
    custo: object({ madeira: integer(0, 0), pedra: integer(0, 0) }),
    materiais: { type: 'array', minItems: 2, maxItems: 4, items: object({
      item: { type: 'string', pattern: '^[a-z][a-z0-9_]{1,21}$' }, quantity: integer(1, 8),
    }) },
  })
}

/** A renovation only changes the drawing: one modular piece or its color. */
export function renovationSchema(look: Composition) {
  const edits = { anyOf: slots.flatMap(slot => {
    const variants = compatibleEditParts(look, slot)
    const ids = variants.filter((id): id is NonNullable<typeof id> => id !== null)
    if (!ids.length) return []
    const replacement = component(ids)
    return [object({ camada: oneOf([slot]), parte: variants.includes(null) && look[slot] ? nullable(replacement) : replacement })]
  }) }
  return object({
    ideia: ideaSchema,
    custo: object({ madeira: integer(0, 2), pedra: integer(0, 2) }),
    modulo: edits,
  })
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

export function inList<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some(item => item === value)
}

const boundedInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max

function readPart(value: unknown): Part | null {
  const p = record(value)
  if (!p || !inList(p.cor, colors)
    || !boundedInt(p.x, -20, 20) || !boundedInt(p.y, 0, 42)
    || !boundedInt(p.largura, 3, 40) || !boundedInt(p.altura, 3, 32)) return null
  const frame = { cor: p.cor, x: p.x, y: p.y, largura: p.largura, altura: p.altura }
  if (inList(p.forma, shapes)) return { forma: p.forma, ...frame }
  if (p.forma !== 'contorno' || !Array.isArray(p.tracado) || p.tracado.length < 3 || p.tracado.length > 9) return null
  const steps = p.tracado.map(readPathStep)
  if (!steps.every((step): step is PathStep => step !== null) || steps[0].op !== 'M'
    || steps[steps.length - 1].op !== 'Z' || steps.slice(1, -1).some(step => step.op === 'M' || step.op === 'Z')
    || (steps.length === 3 && steps[1].op === 'L')) return null
  return { forma: 'contorno', ...frame, tracado: steps }
}

function readPathStep(value: unknown): PathStep | null {
  const p = record(value)
  if (p?.op === 'Z') return { op: 'Z' }
  const good = (n: unknown): n is number => boundedInt(n, 0, 100)
  if (!p || !good(p.x) || !good(p.y)) return null
  const { op, x, y } = p
  if (op === 'M' || op === 'L') return { op, x, y }
  if (!good(p.cx) || !good(p.cy)) return null
  if (op === 'Q') return { op, x, y, cx: p.cx, cy: p.cy }
  if (op === 'C' && good(p.dx) && good(p.dy)) return { op, x, y, cx: p.cx, cy: p.cy, dx: p.dx, dy: p.dy }
  return null
}

function readRule(value: unknown): Rule | null {
  const r = record(value)
  if (!r || !inList(r.gatilho, triggers) || !inList(r.verbo, operations)
    || !boundedInt(r.quantidade, 1, 12)
    || !inList(r.insumo, ['nenhum', ...resources] as const)) return null
  if (r.verbo === 'efeito') {
    if (r.gatilho !== 'uso' || !inList(r.alvo, stats)) return null
    if (r.alvo === 'umidade' && r.insumo !== 'agua') return null
    if (r.alvo === 'fome' && r.insumo !== 'fruta') return null
  } else {
    if (!inList(r.alvo, resources) || r.quantidade > 3) return null
    if (r.verbo === 'gerar') {
      if (r.insumo !== 'nenhum') return null
      if (!(r.gatilho === 'chuva' && r.alvo === 'agua')
        && !(r.gatilho === 'amanhecer' && r.alvo === 'fruta')) return null
    } else if (r.gatilho !== 'uso'
      || (r.verbo === 'transferir' && r.insumo !== 'nenhum')
      || (r.verbo === 'converter' && (r.insumo === 'nenhum' || r.insumo === r.alvo || r.quantidade !== 1))) {
      return null
    }
  }
  return { gatilho: r.gatilho, verbo: r.verbo, alvo: r.alvo, quantidade: r.quantidade, insumo: r.insumo }
}

export function readBlueprint(value: unknown): Blueprint | null {
  const b = record(value)
  const cost = record(b?.custo)
  const appearance = readAppearance(b?.aparencia)
  if (!b || !cost || typeof b.nome !== 'string' || typeof b.ideia !== 'string'
    || !inList(b.tipo, ['lugar', 'objeto'] as const)
    || !boundedInt(cost.madeira, 0, 4) || !boundedInt(cost.pedra, 0, 4)
    || (b.aparencia !== undefined && !appearance)
    || !Array.isArray(b.regras) || b.regras.length < 1 || b.regras.length > 6) return null

  const nome = b.nome.trim()
  const ideia = b.ideia.trim()
  if (nome.length < 3 || nome.length > 34 || ideia.length < 8 || ideia.length > 130
    || /[\u2028\u2029]/u.test(nome) || nome.includes('\n') || nome.includes('\r')) return null
  const parts = b.pecas === undefined && appearance ? [] : b.pecas
  if (!Array.isArray(parts) || parts.length > 8 || (parts.length < 2 && (!appearance || parts.length !== 0))) return null
  const pecas = parts.map(readPart)
  const regras = b.regras.map(readRule)
  if (!pecas.every((p): p is Part => p !== null) || !regras.every((r): r is Rule => r !== null)
    || (pecas.length > 0 && !pecas.some(p => p.y <= 5))
    || !regras.some(r => r.gatilho === 'uso') || (regras.length > 4 && !hasWaterSupply(regras))
    || new Set(regras.map(ruleKey)).size !== regras.length) return null
  const total = cost.madeira + cost.pedra
  if (b.materiais === undefined && !total) return null
  const materiais: NonNullable<Blueprint['materiais']> = []
  if (b.materiais !== undefined) {
    if (total || !Array.isArray(b.materiais) || b.materiais.length < 2 || b.materiais.length > 4) return null
    for (const entry of b.materiais) {
      const s = record(entry)
      if (!s || typeof s.item !== 'string' || !/^[a-z][a-z0-9_]{1,21}$/.test(s.item)
        || !boundedInt(s.quantity, 1, 8) || materiais.some(m => m.item === s.item)) return null
      materiais.push({ item: s.item, quantity: s.quantity })
    }
  }
  return { nome, tipo: b.tipo, ideia, custo: { madeira: cost.madeira, pedra: cost.pedra }, pecas, regras,
    ...(materiais.length ? { materiais } : {}), ...(appearance ? { aparencia: appearance } : {}) }
}

export const ruleKey = (r: Rule) => `${r.gatilho}:${r.verbo}:${r.alvo}`

export function readRenovation(value: unknown): Renovation | null {
  const raw = record(value)
  const cost = record(raw?.custo)
  const appearance = readAppearance(raw?.aparencia)
  const edit = readModuleEdit(raw?.modulo)
  const declaredRules = raw?.regras === undefined ? [] : raw.regras
  if (!raw || !cost || typeof raw.ideia !== 'string' || (raw.aparencia !== undefined && !appearance)
    || (raw.modulo !== undefined && (appearance || (raw.modulo !== null && !edit)))
    || !boundedInt(cost.madeira, 0, 2) || !boundedInt(cost.pedra, 0, 2) || cost.madeira + cost.pedra < 1
    || !Array.isArray(declaredRules) || declaredRules.length > 0) return null
  const modular = raw.modulo !== undefined
  const visual = raw.visual === undefined && (appearance || modular) ? 'acrescentar' : raw.visual
  const parts = raw.pecas === undefined && (appearance || modular) ? [] : raw.pecas
  if (!inList(visual, ['acrescentar', 'substituir'] as const)
    || !Array.isArray(parts) || parts.length > 8 || (visual === 'substituir' && parts.length < 2)
    || (modular && parts.length > 0)
    || (!appearance && !edit && parts.length === 0)) return null
  const ideia = raw.ideia.trim()
  const pecas = parts.map(readPart)
  if (ideia.length < 8 || ideia.length > 130 || !pecas.every((p): p is Part => p !== null)) return null
  return { ideia, visual, custo: { madeira: cost.madeira, pedra: cost.pedra }, pecas, regras: [],
    ...(appearance ? { aparencia: appearance } : {}), ...(modular ? { modulo: edit } : {}) }
}
