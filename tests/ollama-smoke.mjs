import assert from 'node:assert/strict'
import { decide, invent } from '../electron/ollama.ts'
import { World } from '../src/world.ts'

const world = World.create()
const plots = world.constructionTiles()
const choices = { inventar: 'Inventar algo para o vale', dormir: 'Dormir para recuperar energia' }
const decision = await decide('Energia 82, fome 24. A personagem precisa criar algo novo no vale.', choices)
assert.ok(decision.ok, decision.error)
assert.ok(decision.value in choices)
console.log(`Laya 322M respondeu: ${decision.value}`)

const drafted = await invent(
  `Madeira 4, pedra 3, agua 2, fruta 2. Energia 82, alegria 62, fome 24, umidade 36. Não há invenções. Terrenos ${plots.map((p, i) => `${i}: (${p.x},${p.y})`).join('; ')}. Invente algo que pode ser usado já, sem precisar esperar por chuva ou amanhecer.`,
  plots.length, true,
)
assert.ok(drafted.ok, drafted.error)
const { plan, plot } = drafted.value
const at = plots[plot]
assert.ok(world.canBuild(plan, at), 'O Qwen deve propor algo com nome, custo e terreno disponíveis.')
const staged = world.complete({ id: 'montar_kit', label: 'Montar kit', at: world.workbench, kind: 'assemble', score: 0, plan, plot: at })
const packed = staged.complete(staged.actions().find(action => action.kind === 'pickup_kit'))
let built = packed.complete(packed.actions().find(action => action.kind === 'build'))
for (let i = 0; i < 55 && built.builds[0].uses === 0; i++) {
  const choices = built.actions()
  const next = choices.find(action => action.kind === 'use') ?? choices.find(action => action.kind !== 'invent')
  built = built.complete(next)
}
assert.ok(built.builds[0].uses > 0, 'A invenção gerada deve ter algum efeito utilizável.')
console.log(`Qwen criou ${plan.nome}; ${built.log.find(entry => entry.text.startsWith('Laya usou')).text}`)
