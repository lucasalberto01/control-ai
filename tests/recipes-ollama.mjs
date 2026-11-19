import assert from 'node:assert/strict'
import './legacy-solo.mjs'
import { discoverRecipe } from '../electron/ollama.ts'
import { World } from '../src/world.ts'
import { TurnPlanner } from '../src/turn-planner.ts'
import { harvestOnlyItems } from '../src/inventory.ts'

let world = World.create()
let failure = ''
const attempts = []
const planner = new TurnPlanner({
  async decide(_state, actions) { return { ok: true, value: Object.keys(actions)[0] } },
  recipe: async (state, options) => {
    const reply = await discoverRecipe(state, options)
    attempts.push(reply.ok ? `${reply.value.name} (${reply.value.process})` : `recusada: ${reply.error}`)
    console.log(reply.ok ? `Descoberta livre: ${reply.value.name} (${reply.value.process})` : `Recusada: ${reply.error}`)
    return reply
  },
  async invent() { return { ok: false, error: 'Criações fora do escopo deste teste.' } },
  async renovate() { return { ok: false, error: 'Reformas fora do escopo deste teste.' } },
})
for (let i = 0; i < 150 && world.recipes.length < 2; i++) {
  if (!world.hasLivingCharacter) world = world.revive(world.characters[0].id)
  const turn = await planner.plan(world, {
    model(part, status) { if (part === 'generation') failure = status },
    activity() {},
  })
  world = world.complete(turn.action, turn.postpone)
  if (turn.postpone && failure && failure !== 'Criações fora do escopo deste teste.') console.log(failure)
}
assert.ok(world.recipes.length >= 1, `Esperava pelo menos uma descoberta livre. Tentativas: ${attempts.join(' | ')}`)
for (const recipe of world.recipes) {
  assert.ok(world.item(recipe.output.item), `Resultado sem item: ${recipe.output.item}`)
  assert.ok(!harvestOnlyItems.includes(recipe.output.item), 'Coleta não vira receita')
}
const restored = JSON.parse(JSON.stringify(world.toState()))
assert.deepEqual(World.fromState(world.map, restored).toState(), world.toState())
console.log(`Receitas livres: ${world.recipes.map(r => `${r.name} (${r.process}, ${r.uses}×)`).join(', ')}.`)
