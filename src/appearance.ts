import type { Blueprint } from './blueprint.ts'
import type { Item } from './inventory.ts'
import { readComposition } from './modules.ts'
import type { Composition } from './modules.ts'
import { matchedCategory } from './identity.ts'
import type { Category } from './identity.ts'

export const styles = {
  banco: 'banco de jardim com encosto e pernas',
  abrigo: 'quiosque coberto com colunas e telhado',
  fonte: 'fonte de pedra com água corrente',
  coletor: 'cisterna com funil e bica',
  jardim: 'canteiro com folhas e flores',
  lanterna: 'poste com luminária de vidro',
  oficina: 'bancada coberta com ferramentas',
  armazem: 'armário de madeira com portas',
  cristal: 'cristal facetado num pedestal',
  monumento: 'pedestal com uma escultura decorativa',
} as const
export type Model = keyof typeof styles
export const models = Object.keys(styles) as Model[]
export const finishes = ['cedro', 'terracota', 'musgo', 'lagoa', 'lavanda', 'arenito'] as const
export const details = ['nenhum', 'flores', 'lampiao', 'trepadeira', 'placa'] as const
type LegacyAppearance = { modelo: Model; acabamento: typeof finishes[number]; detalhe: typeof details[number] }
export type Appearance = LegacyAppearance | Composition

export function readAppearance(value: unknown): Appearance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if ('base' in value) return readComposition(value)
  const { modelo, acabamento, detalhe } = value as Record<string, unknown>
  if (!models.some(m => m === modelo) || !finishes.some(f => f === acabamento) || !details.some(d => d === detalhe)) return null
  return { modelo, acabamento, detalhe } as LegacyAppearance
}

// Legacy saves keep their geometry. Only the normal rendering uses this more readable presentation.
const legacyStyles: Record<Category, LegacyAppearance> = {
  cristal: { modelo: 'cristal', acabamento: 'lavanda', detalhe: 'nenhum' },
  coletor: { modelo: 'coletor', acabamento: 'lagoa', detalhe: 'placa' },
  fonte: { modelo: 'fonte', acabamento: 'arenito', detalhe: 'flores' },
  lanterna: { modelo: 'lanterna', acabamento: 'cedro', detalhe: 'nenhum' },
  jardim: { modelo: 'jardim', acabamento: 'musgo', detalhe: 'flores' },
  abrigo: { modelo: 'abrigo', acabamento: 'terracota', detalhe: 'trepadeira' },
  banco: { modelo: 'banco', acabamento: 'cedro', detalhe: 'flores' },
  oficina: { modelo: 'oficina', acabamento: 'terracota', detalhe: 'placa' },
  armazem: { modelo: 'armazem', acabamento: 'cedro', detalhe: 'placa' },
  monumento: { modelo: 'monumento', acabamento: 'arenito', detalhe: 'flores' },
}

function legacyAppearance(plan: Blueprint): LegacyAppearance {
  if (plan.aparencia && 'modelo' in plan.aparencia) return plan.aparencia
  const matched = matchedCategory(plan)
  if (matched) return legacyStyles[matched]
  if (plan.regras.some(r => r.gatilho === 'chuva')) return { modelo: 'coletor', acabamento: 'lagoa', detalhe: 'nenhum' }
  if (plan.regras.some(r => r.alvo === 'fome' || r.alvo === 'fruta')) return { modelo: 'jardim', acabamento: 'musgo', detalhe: 'flores' }
  if (plan.regras.some(r => r.alvo === 'energia')) return { modelo: plan.tipo === 'lugar' ? 'abrigo' : 'banco', acabamento: 'cedro', detalhe: 'lampiao' }
  return { modelo: 'monumento', acabamento: 'arenito', detalhe: 'flores' }
}

export function appearanceFor(plan: Blueprint): Composition {
  if (plan.aparencia && 'base' in plan.aparencia) return plan.aparencia
  const { modelo, acabamento: cor, detalhe } = legacyAppearance(plan)
  const base: Composition['base'] = { peca: 'laje', cor: 'arenito' }
  const look: Composition = { base, suporte: null, corpo: null, topo: null,
    adorno: detalhe === 'nenhum' ? null : { peca: detalhe, cor } }
  switch (modelo) {
    case 'banco': return { ...look, corpo: { peca: 'assento', cor } }
    case 'abrigo': return { ...look, suporte: { peca: 'colunas', cor: 'cedro' }, topo: { peca: 'telhado_reto', cor } }
    case 'oficina': return { ...look, suporte: { peca: 'colunas', cor: 'cedro' }, corpo: { peca: 'mesa', cor: 'cedro' }, topo: { peca: 'telhado_reto', cor } }
    case 'fonte': return { ...look, base: { peca: 'disco', cor }, corpo: { peca: 'bacia', cor }, topo: { peca: 'jato', cor: 'lagoa' } }
    case 'coletor': return { ...look, base: { peca: 'octogono', cor: 'arenito' }, corpo: { peca: 'barril', cor }, topo: { peca: 'funil', cor } }
    case 'jardim': return { ...look, corpo: { peca: 'canteiro', cor } }
    case 'lanterna': return { ...look, suporte: { peca: 'poste', cor }, topo: { peca: 'cupula', cor } }
    case 'armazem': return { ...look, corpo: { peca: 'armario', cor } }
    case 'cristal': return { ...look, suporte: { peca: 'pedestal', cor: 'arenito' }, topo: { peca: 'gema', cor } }
    case 'monumento': return { ...look, suporte: { peca: 'pedestal', cor: 'arenito' }, topo: { peca: 'estatua', cor } }
  }
}

export function installedAppearance(item: Readonly<Item>): Composition {
  if (item.kind === 'luz') return {
    base: { peca: 'disco', cor: 'arenito' }, suporte: { peca: 'poste', cor: 'cedro' },
    corpo: null, topo: { peca: 'chama', cor: 'cobre' }, adorno: null,
  }
  if (item.kind === 'objeto') return appearanceFor({
    nome: item.name, tipo: 'objeto', ideia: item.name, custo: { madeira: 0, pedra: 0 }, pecas: [], regras: [],
  })
  return {
    base: { peca: 'octogono', cor: 'arenito' }, suporte: null, topo: null, adorno: null,
    corpo: item.capability === 'aquecer' ? { peca: 'fornalha', cor: 'terracota' } : { peca: 'mesa', cor: 'musgo' },
  }
}

export const workbenchAppearance: Composition = {
  base: { peca: 'laje', cor: 'carvao' }, suporte: null, corpo: { peca: 'mesa', cor: 'cobre' },
  topo: null, adorno: { peca: 'placa', cor: 'lagoa' },
}
