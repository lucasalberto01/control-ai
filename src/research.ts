import { inList, readBlueprint, readRenovation, record } from './blueprint.ts'
import type { Blueprint, Renovation } from './blueprint.ts'
import type { Point, WorldMap } from './world-map.ts'
import { int } from './world-values.ts'

export type ResearchTopic = { kind: 'recipe' } | { kind: 'blueprint'; water?: boolean }
  | { kind: 'renovation'; objectId: number }
export type ResearchProject = { kind: 'blueprint'; plan: Blueprint; plot: Point }
  | { kind: 'renovation'; objectId: number; upgrade: Renovation }

export function readTopic(value: unknown): ResearchTopic | null {
  const r = record(value)
  if (!r || !inList(r.kind, ['recipe', 'blueprint', 'renovation'] as const)
    || (r.water !== undefined && typeof r.water !== 'boolean')) return null
  if (r.kind === 'recipe') return { kind: r.kind }
  if (r.kind === 'blueprint') return { kind: r.kind, ...(r.water ? { water: true } : {}) }
  return int(r.objectId, 1) ? { kind: r.kind, objectId: r.objectId } : null
}

export function readProject(value: unknown, map: WorldMap): ResearchProject | null {
  const r = record(value)
  if (r?.kind === 'blueprint') {
    const plan = readBlueprint(r.plan)
    return plan && map.contains(r.plot) ? { kind: r.kind, plan, plot: { ...r.plot } } : null
  }
  if (r?.kind === 'renovation') {
    const upgrade = readRenovation(r.upgrade)
    return int(r.objectId, 1) && upgrade ? { kind: r.kind, objectId: r.objectId, upgrade } : null
  }
  return null
}
