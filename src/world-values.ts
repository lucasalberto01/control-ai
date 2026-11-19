import { record } from './blueprint.ts'

export const int = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max

export const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max

export function metrics<K extends string>(value: unknown, keys: readonly K[], max: number): Record<K, number> | null {
  const raw = record(value)
  if (!raw || !keys.every(k => int(raw[k], 0, max))) return null
  return Object.fromEntries(keys.map(k => [k, raw[k]])) as Record<K, number>
}

export const limit = (n: number, max = 100) => Math.max(0, Math.min(max, n))
