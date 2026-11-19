import { record, stats } from './blueprint.ts'
import type { Stat } from './blueprint.ts'
import { limit, metrics } from './world-values.ts'

export type Vitals = Record<Stat, number> & { sede: number; hp: number }

export function readVitals(value: unknown): Vitals | null {
  const saved = record(value)
  return saved ? metrics({
    ...saved, sede: saved.sede === undefined ? 18 : saved.sede, hp: saved.hp === undefined ? 100 : saved.hp,
  }, [...stats, 'sede', 'hp'], 100) : null
}

export function updateHealth(vitals: Vitals) {
  const { energia, fome, alegria, sede, hp } = vitals
  const critical = [
    energia <= 15 && 'exaustão', fome >= 85 && 'fome', alegria <= 15 && 'tristeza', sede >= 85 && 'sede',
  ].filter(Boolean)
  if (critical.length) vitals.hp = limit(hp - critical.length * 4)
  return critical
}
