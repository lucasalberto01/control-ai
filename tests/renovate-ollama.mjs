import assert from 'node:assert/strict'
import './legacy-solo.mjs'
import { World } from '../src/world.ts'
import { appearanceFor } from '../src/appearance.ts'
import { editComposition } from '../src/modules.ts'
import { readRenovation } from '../src/blueprint.ts'
import { renovate } from '../electron/ollama.ts'

const stack = (item, quantity = 1) => ({ item, quantity })
const plan = {
  nome: 'Banco do Pomar', tipo: 'objeto', ideia: 'Um assento de madeira para descansar e recuperar a energia.',
  custo: { madeira: 1, pedra: 0 },
  pecas: [
    { forma: 'bloco', cor: 'marrom', x: 0, y: 0, largura: 10, altura: 16 },
    { forma: 'oval', cor: 'azul', x: 0, y: 16, largura: 24, altura: 8 },
  ],
  regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'energia', quantidade: 6, insumo: 'nenhum' }],
}
let world = World.create()
const at = world.constructionTiles()[0]
const packed = world.complete({ id: 'montar_kit', kind: 'assemble', at: world.workbench, plot: at, plan })
const picked = packed.complete(packed.actions().find(action => action.kind === 'pickup_kit'))
world = picked.complete(picked.actions().find(action => action.kind === 'build'))
world = world.complete(world.actions().find(action => action.kind === 'use'))
for (let i = 0; i < 6 && !world.actions().some(action => action.kind === 'renovate'); i++) {
  world = world.complete(world.actions().find(action => action.kind === 'walk'))
}
const build = world.builds[0]
const before = appearanceFor(build.plan)
const reply = await renovate(
  `Reforme somente ${build.plan.nome}. Aparência atual: ${JSON.stringify(before)}. Não repita essa combinação.`,
  before,
)
assert.ok(reply.ok, reply.error)
assert.deepEqual(reply.value.regras, [], 'Reforma não carrega funções')
assert.ok(reply.value.modulo, 'A reforma precisa trocar uma peça')
const changed = editComposition(before, reply.value.modulo)
assert.ok(changed && JSON.stringify(changed) !== JSON.stringify(before), 'A aparência precisa mudar')
assert.ok(world.previewRenovation(build.id, reply.value), 'O mundo aceita a reforma visual')
assert.equal(world.previewRenovation(build.id, { ...reply.value, regras: [plan.regras[0]] }), null, 'Regras são recusadas')
assert.equal(readRenovation({ ...reply.value, regras: [plan.regras[0]] }), null)
console.log(`Reforma visual: ${build.plan.nome} · ${reply.value.modulo.camada} → ${reply.value.ideia}`)
