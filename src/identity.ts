import type { Blueprint, Rule } from './blueprint.ts'

export const categories = ['cristal', 'coletor', 'fonte', 'lanterna', 'jardim', 'abrigo', 'banco', 'oficina', 'armazem', 'monumento'] as const
export type Category = typeof categories[number]

const patterns: readonly [RegExp, Category][] = [
  [/\b(cristal|prisma|gema|quartzo|vitral)\b/, 'cristal'],
  [/\b(coletor|cisterna|reservatorio|gira.gotas|barril)\b/, 'coletor'],
  [/\b(fonte|chafariz|cascata|bebedouro|bacia)\b/, 'fonte'],
  [/\b(lanterna|lucerna|farol|luminaria|lampiao|tocha)\b/, 'lanterna'],
  [/\b(jardim|floreira|canteiro|viveiro|pomar)\b/, 'jardim'],
  [/\b(abrigo|cabana|mirante|quiosque|refugio|tenda|pavilhao|cobertura)\b/, 'abrigo'],
  [/\b(banco|assento|cadeira|balanco|descanso)\b/, 'banco'],
  [/\b(oficina|engenho|maquina|prensa|moinho|forno|bancada)\b/, 'oficina'],
  [/\b(armazem|despensa|armario|cofre|bau)\b/, 'armazem'],
]

const normalized = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Matches only names and descriptions; returns undefined when the text says nothing about the object. */
export function matchedCategory(plan: Blueprint): Category | undefined {
  const firstMatch = (text: string) => patterns
    .map(([pattern, category]) => ({ at: text.search(pattern), category }))
    .filter(match => match.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.category
  return firstMatch(normalized(plan.nome)) ?? firstMatch(normalized(plan.ideia))
}

/** Reads the object's identity from its name, then its description, then its first function. */
export function categoryOf(plan: Blueprint): Category {
  const match = matchedCategory(plan)
  if (match) return match
  if (plan.regras.some(rule => rule.gatilho === 'chuva')) return 'coletor'
  if (plan.regras.some(rule => rule.alvo === 'fome' || rule.alvo === 'fruta')) return 'jardim'
  if (plan.regras.some(rule => rule.alvo === 'energia')) return plan.tipo === 'lugar' ? 'abrigo' : 'banco'
  return 'monumento'
}

const isWaterRule = (rule: Rule) => (rule.gatilho === 'chuva' && rule.verbo === 'gerar' && rule.alvo === 'agua')
  || (rule.gatilho === 'uso' && rule.verbo === 'transferir' && rule.alvo === 'agua')
const isFoodRule = (rule: Rule) => rule.verbo === 'efeito' && (rule.alvo === 'fome' || rule.alvo === 'umidade')
const isComfortRule = (rule: Rule) => rule.verbo === 'efeito' && (rule.alvo === 'energia' || rule.alvo === 'alegria')

function familyOf(category: Category) {
  if (category === 'fonte' || category === 'coletor') return { test: isWaterRule, minimum: 2 }
  if (category === 'jardim') return { test: isFoodRule, minimum: 1 }
  return { test: isComfortRule, minimum: 1 }
}

/**
 * One object, one function. Keeps the rules that match its identity.
 * If the name disagrees with the rules, keeps the dominant family so it still does something.
 * The result is stable and always keeps a rule that can be triggered by use.
 */
export function primaryRules(plan: Blueprint): Rule[] {
  const family = familyOf(categoryOf(plan))
  const matching = plan.regras.filter(family.test)
  if (matching.length >= family.minimum && matching.some(rule => rule.gatilho === 'uso')) return matching
  const effects = plan.regras.filter(rule => rule.verbo === 'efeito')
  const resources = plan.regras.filter(rule => rule.verbo !== 'efeito')
  const usable = [effects, resources].filter(group => group.some(rule => rule.gatilho === 'uso'))
  const dominant = usable.length
    ? usable.reduce((best, group) => group.length > best.length ? group : best)
    : effects.length >= resources.length && effects.length ? effects : resources
  const kept = dominant.length ? dominant : plan.regras.slice(0, 1)
  if (kept.some(rule => rule.gatilho === 'uso')) return kept
  return [...kept, plan.regras.find(rule => rule.gatilho === 'uso')!]
}

export function primaryPlan(plan: Blueprint): Blueprint {
  return { ...structuredClone(plan), regras: primaryRules(plan) }
}

export function ruleFamily(rule: Rule) {
  return rule.verbo === 'efeito' ? 'efeito' : 'recursos'
}

/** A new object must not mix needs effects and resource handling. */
export function isCoherent(plan: Blueprint) {
  return new Set(plan.regras.map(ruleFamily)).size <= 1
}
