import { record } from './blueprint.ts'
import { World } from './world.ts'
import type { WorldState } from './world.ts'
import { WorldMap } from './world-map.ts'
import type { MapData } from './world-map.ts'

export const SAVE_VERSION = 2
export const LEGACY_SAVE_KEY = 'minimundo-laya-v1'
/** The original vale was too small for the Laya to keep inventing after a few creations. */
export const MIN_BUILD_LIMIT = 14
export type WorldSave = { version: typeof SAVE_VERSION; map: MapData; state: WorldState }

export function toSave(world: World): WorldSave {
  return { version: SAVE_VERSION, map: world.map.toData(), state: world.toState() }
}

function withRoomForNewCreations(value: unknown) {
  const map = record(value)
  if (!map) return value
  const limit = map.buildLimit
  return { ...map, buildLimit: typeof limit === 'number' && limit >= 0 ? Math.max(limit, MIN_BUILD_LIMIT) : limit }
}

export function fromSave(value: unknown): World {
  const raw = record(value)
  if (raw?.version !== SAVE_VERSION && raw?.version !== 1) throw new Error('A versão do arquivo de progresso não é compatível.')
  const map = WorldMap.fromData(withRoomForNewCreations(raw.map))
  const state = record(raw.state)
  const world = map && state && (raw.version === 1 || state.inventory !== undefined) && World.fromState(map, state)
  if (!world) throw new Error('O arquivo de progresso não passou pela validação.')
  return world
}

export function fromLegacy(legacy: string): World {
  const { map } = World.create()
  let world: World | null
  try { world = World.fromState(map, JSON.parse(legacy)) } catch { world = null }
  if (!world) throw new Error('Não foi possível importar o progresso anterior. Nenhum dado foi substituído.')
  return world
}
