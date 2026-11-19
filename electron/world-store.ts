import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { World } from '../src/world.ts'
import { fromLegacy, fromSave, toSave } from '../src/world-save.ts'
import { WorldMap } from '../src/world-map.ts'
import type { WorldSave } from '../src/world-save.ts'
import { same } from '../src/world-map.ts'

const FILE = 'world.save.json'
const MAX_LEGACY_CHARS = 200_000
export type ResearchNotice = { title: string; body: string }

function researchNotice(previous: World, next: World): ResearchNotice | undefined {
  const researcher = previous.active
  const topic = researcher.research
  const after = next.character(researcher.id)
  if (!topic || !after || after.research || next.turn !== previous.turn + 1 || researcher.vitals.hp === 0
    || !same(researcher.at, previous.researchTable) || !same(after.at, previous.researchTable)) return
  if (topic.kind === 'recipe') {
    const recipe = next.recipes.find(r => r.id === next.turn)
    if (recipe && previous.canLearn(recipe)) return { title: `Nova receita de ${researcher.name}`, body: recipe.name }
  }
  const project = after.project
  if (!project || !previous.canRecordProject(project)) return
  if (topic.kind === 'blueprint' && project.kind === 'blueprint') {
    return { title: `Nova planta de ${researcher.name}`, body: project.plan.nome }
  }
  if (topic.kind === 'renovation' && project.kind === 'renovation' && project.objectId === topic.objectId) {
    const target = previous.builds.find(b => b.id === topic.objectId)
    if (target) return { title: `Nova reforma de ${researcher.name}`, body: target.plan.nome }
  }
}

export class WorldStore {
  readonly #directory: string
  readonly #file: string
  #current?: World

  constructor(directory: string) {
    this.#directory = directory
    this.#file = path.join(directory, FILE)
  }

  open(legacy: unknown): WorldSave {
    this.#current = undefined
    let contents: string
    try {
      contents = readFileSync(this.#file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Não foi possível ler ${FILE}.`)
      return this.#initialize(legacy)
    }
    let parsed: unknown
    try { parsed = JSON.parse(contents) } catch { throw new Error(`${FILE} não contém um JSON válido. O arquivo foi preservado.`) }
    this.#current = fromSave(parsed)
    return toSave(this.#current)
  }

  get researchKind() {
    const world = this.#current
    return world && world.vitals.hp > 0 && same(world.position, world.researchTable) ? world.researchTopic?.kind : undefined
  }

  commit(value: unknown, mapValue?: unknown): ResearchNotice | undefined {
    if (!this.#current) throw new Error('Nenhum mundo foi carregado.')
    const map = mapValue === undefined ? this.#current.map : WorldMap.fromData(mapValue)
    if (!map) throw new Error('O mapa enviado não é válido para este mundo.')
    if (map.width < this.#current.map.width || map.height < this.#current.map.height) {
      throw new Error('O mapa enviado é menor que o atual.')
    }
    const next = World.fromState(map, value)
    if (!next || next.turn <= this.#current.turn) throw new Error('O turno enviado não é válido para este mundo.')
    const notice = researchNotice(this.#current, next)
    try { this.#write(toSave(next)) } catch { throw new Error(`Não foi possível gravar ${FILE}. O save anterior foi preservado.`) }
    this.#current = next
    return notice
  }

  #initialize(legacy: unknown): WorldSave {
    if (legacy !== null && (typeof legacy !== 'string' || legacy.length > MAX_LEGACY_CHARS)) {
      throw new Error('O progresso anterior está em um formato inválido. Nenhum dado foi substituído.')
    }
    const first = legacy === null ? World.create() : fromLegacy(legacy)
    const save = toSave(first)
    try { this.#write(save) } catch { throw new Error(`Não foi possível criar ${FILE}.`) }
    this.#current = first
    return save
  }

  #write(save: WorldSave) {
    const temporary = `${this.#file}.${randomUUID()}.tmp`
    mkdirSync(this.#directory, { recursive: true })
    try {
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, `${JSON.stringify(save, null, 2)}\n`, 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporary, this.#file)
    } catch (error) {
      try { rmSync(temporary, { force: true }) } catch { /* Keep the original write error. */ }
      throw error
    }
  }
}
