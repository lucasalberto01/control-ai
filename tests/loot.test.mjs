import assert from 'node:assert/strict'
import test from 'node:test'
import { World } from '../src/world.ts'
import { fromSave, toSave } from '../src/world-save.ts'
import { TurnPlanner } from '../src/turn-planner.ts'

const focus = (world, id = 'laya') => {
  const next = World.fromState(world.map, {
    ...world.toState(), active: world.characters.findIndex(character => character.id === id),
  })
  assert.ok(next)
  return next
}

const addToBag = (state, items, who = 'laya') => {
  const slots = [...(who === 'laya' ? state.inventory : state.rival.bag)]
  for (const item of items) {
    const index = slots.findIndex(slot => !slot || (slot.item === item && slot.quantity < 16))
    assert.ok(index >= 0)
    slots[index] = slots[index]?.item === item
      ? { item, quantity: slots[index].quantity + 1 }
      : { item, quantity: 1 }
  }
  if (who === 'laya') state.inventory = slots
  else state.rival = { ...state.rival, bag: slots }
  return state
}

function hunt(hp = 2) {
  const base = World.create()
  const laya = base.characters[0]
  const at = { x: laya.at.x + 1, y: laya.at.y }
  const state = { ...base.toState(), active: 0, animals: [{ id: 1, at, hp, nextBreak: 0, nextBite: 0 }] }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const attack = world.actions().find(action => action.kind === 'attack' && action.target.kind === 'animal')
  assert.ok(attack)
  return { world: world.complete(attack), at }
}

test('matar um javali deixa carne crua e couro no chão', () => {
  const { world, at } = hunt()
  const drop = world.drops.find(entry => entry.at.x === at.x && entry.at.y === at.y)
  assert.ok(drop, 'O loot precisa ficar no tile do animal')
  assert.deepEqual(drop.items.slice().sort((a, b) => a.item.localeCompare(b.item)),
    [{ item: 'carne_crua', quantity: 2 }, { item: 'couro', quantity: 1 }])
  assert.equal(world.animals.length, 0)
  assert.ok(world.character('laya').xp >= 12)
  assert.match(world.log[0].text, /2 carnes cruas e 1 couro/)
  assert.deepEqual(fromSave(JSON.parse(JSON.stringify(toSave(world)))).toState(), world.toState())
})

test('o loot se junta a um item que já estava no chão e pode ser recolhido', () => {
  const base = World.create()
  const laya = base.characters[0]
  const at = { x: laya.at.x + 1, y: laya.at.y }
  const state = {
    ...base.toState(), active: 0,
    animals: [{ id: 1, at, hp: 2, nextBreak: 0, nextBite: 0 }],
    drops: [{ id: 9, at, items: [{ item: 'pedra', quantity: 2 }] }],
  }
  let world = World.fromState(base.map, state)
  assert.ok(world)
  world = world.complete(world.actions().find(action => action.kind === 'attack' && action.target.kind === 'animal'))
  assert.equal(world.drops.length, 1)
  assert.deepEqual(world.drops[0].items.slice().sort((a, b) => a.item.localeCompare(b.item)), [
    { item: 'carne_crua', quantity: 2 }, { item: 'couro', quantity: 1 }, { item: 'pedra', quantity: 2 },
  ])

  world = focus(world)
  const take = world.actions().find(action => action.kind === 'take')
  assert.ok(take)
  world = world.complete(take)
  assert.equal(world.character('laya').inventory.count('carne_crua'), 2)
  assert.equal(world.character('laya').inventory.count('couro'), 1)
  assert.equal(world.drops.length, 0)
})

test('carne crua e assada alimentam a personagem', () => {
  const base = World.create()
  const raw = addToBag({ ...base.toState(), active: 0, animals: [], vitals: { ...base.toState().vitals, fome: 90 } }, ['carne_crua'])
  let world = World.fromState(base.map, raw)
  assert.ok(world)
  const eatRaw = world.actions().find(action => action.kind === 'eat' && action.food === 'carne_crua')
  assert.ok(eatRaw)
  world = world.complete(eatRaw)
  assert.equal(world.character('laya').vitals.fome, 50, 'Carne crua tira 45 de fome (o turno soma 5)')
  assert.equal(world.character('laya').inventory.count('carne_crua'), 0)

  const cooked = addToBag({ ...base.toState(), active: 0, animals: [], vitals: { ...base.toState().vitals, fome: 90 } }, ['carne_assada'])
  let meal = World.fromState(base.map, cooked)
  assert.ok(meal)
  const eatCooked = meal.actions().find(action => action.kind === 'eat' && action.food === 'carne_assada')
  assert.ok(eatCooked)
  meal = meal.complete(eatCooked)
  assert.equal(meal.character('laya').vitals.fome, 25, 'Carne assada tira 70 de fome (o turno soma 5)')
  assert.equal(meal.character('laya').inventory.count('carne_assada'), 0)
})

test('carne e couro entram nas opções de receita do vale', () => {
  const base = World.create()
  const state = addToBag({ ...base.toState(), active: 0, animals: [] }, ['carne_crua', 'couro'])
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const options = world.recipeOptions()
  assert.ok(options.inputs.includes('carne_crua'))
  assert.ok(options.inputs.includes('couro'))
})

test('itens no chão entram nas escolhas e são prioritários quando falta água ou comida', async () => {
  const base = World.create()
  const laya = base.characters[0]
  const state = {
    ...base.toState(), active: 0, animals: [],
    vitals: { ...base.toState().vitals, sede: 70, fome: 70 },
    drops: [{ id: 5, at: laya.at, items: [{ item: 'agua', quantity: 2 }, { item: 'fruta', quantity: 2 }, { item: 'couro', quantity: 1 }] }],
  }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  const take = world.actions().find(action => action.kind === 'take')
  assert.ok(take)
  assert.ok(take.score >= 100, 'Água e comida no chão precisam ser prioridade')

  let keys = []
  const planner = new TurnPlanner({
    async decide(_state, choices) { keys = Object.keys(choices); return { ok: true, value: keys[0] } },
    async invent() { return { ok: false, error: 'Sem projeto.' } },
    async renovate() { return { ok: false, error: 'Sem reforma.' } },
  })
  await planner.plan(world, { model() {}, activity() {} })
  assert.ok(keys.some(key => key.startsWith('pegar_drop_')), 'O loot precisa chegar às escolhas do Qwen')
})

test('a personagem só larga item para a outra quando a mochila está cheia', () => {
  const base = World.create()
  const state = { ...base.toState(), active: 0, animals: [] }
  state.rival = { ...state.rival, at: { x: base.characters[0].at.x + 1, y: base.characters[0].at.y } }
  const world = World.fromState(base.map, state)
  assert.ok(world)
  assert.ok(!world.actions().some(action => action.kind === 'drop'), 'Mochila com espaço não deve largar itens')
})
