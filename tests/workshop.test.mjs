import assert from 'node:assert/strict'
import './legacy-solo.mjs'
import test from 'node:test'
import { World } from '../src/world.ts'
import { Inventory, ItemCatalog } from '../src/inventory.ts'
import { RecipeBook } from '../src/crafting.ts'
import { fromSave, toSave } from '../src/world-save.ts'
import { TurnPlanner } from '../src/turn-planner.ts'

const stack = (item, quantity = 1) => ({ item, quantity })
const visit = world => world.complete({ kind: 'visit_research', id: 'ir_pesquisar', at: world.researchTable, topic: { kind: 'recipe' } })
const learn = (world, recipe) => {
  const atTable = visit(world)
  return atTable.complete({ kind: 'learn', id: 'aprender', at: atTable.researchTable, recipe })
}
const examples = [
  { name: 'Forno de vale', process: 'montar', inputs: [stack('pedra', 4)], fuel: null, output: stack('forno'), newItem: null },
  { name: 'Carvão do bosque', process: 'aquecer', inputs: [stack('madeira')], fuel: stack('madeira'), output: stack('carvao'), newItem: null },
  { name: 'Tocha do trilho', process: 'montar', inputs: [stack('carvao'), stack('madeira')], fuel: null, output: stack('tocha'), newItem: null },
  { name: 'Vidro da margem', process: 'aquecer', inputs: [stack('areia', 2)], fuel: stack('carvao'), output: stack('vidro'), newItem: null },
]

test('inventário tem 32 slots, empilha e não altera nada quando a troca falha', () => {
  const inventory = new Inventory(new ItemCatalog())
  assert.equal(inventory.slots.length, 32)
  assert.ok(inventory.exchange([], [stack('pedra', 17)]))
  assert.deepEqual(inventory.slots.slice(0, 2), [stack('pedra', 16), stack('pedra')])
  assert.ok(inventory.exchange([], [stack('madeira', 480)]))
  const full = inventory.slots
  assert.ok(full.every(Boolean))
  assert.equal(inventory.exchange([stack('pedra')], [stack('vidro', 17)]), false)
  assert.deepEqual(inventory.slots, full)
  assert.ok(inventory.exchange([stack('pedra')], [stack('vidro')]))
  assert.equal(inventory.slots[1].item, 'vidro')
})

test('coleta altera grama, terra, árvore e margem; água só sai quando a mochila recebe', () => {
  let world = World.create()
  const gather = item => {
    const action = world.actions().find(a => a.kind === 'gather' && a.resource === item)
    assert.ok(action)
    world = world.complete(action)
    return action.source
  }
  const soil = gather('grama')
  assert.equal(world.surface(soil), 'terra')
  assert.deepEqual(gather('terra'), soil)
  assert.equal(world.surface(soil), 'pedra')
  const tree = gather('madeira')
  assert.equal(world.tree(tree), 'caida')
  const water = gather('agua')
  assert.equal(world.water(water), 2)
  assert.deepEqual(gather('agua'), water)
  assert.equal(world.surface(water), 'areia')
  assert.ok(world.pathTo(water))
  const snapshot = toSave(world)
  const full = World.fromState(world.map, { ...snapshot.state, inventory: Array(32).fill(stack('pedra', 16)) })
  assert.ok(full)
  assert.ok(!full.actions().some(a => a.kind === 'gather' && a.resource === 'agua'))
  assert.deepEqual(full.toState().terrain, snapshot.state.terrain)
})

test('a pesquisa escolhe o próprio caminho: mesa de corte antes de qualquer forno', async () => {
  let world = World.create()
  const table = { name: 'Mesa de corte', process: 'montar', inputs: [stack('madeira')], fuel: null,
    output: stack('mesa_corte'), newItem: { id: 'mesa_corte', name: 'Mesa de corte', emoji: '🪚', kind: 'estacao', capability: 'cortar', fuel: false } }
  const tala = { name: 'Tala de madeira', process: 'cortar', inputs: [stack('madeira')], fuel: null,
    output: stack('tala'), newItem: { id: 'tala', name: 'Tala', emoji: '📏', kind: 'material', capability: 'nenhuma', fuel: false } }
  const planner = new TurnPlanner({
    async decide(_state, actions) { return { ok: true, value: Object.keys(actions)[0] } },
    async recipe(_state, options) {
      if (!world.recipes.some(recipe => recipe.output.item === 'mesa_corte')) return { ok: true, value: table }
      return { ok: true, value: options.processes.includes('cortar') ? tala : table }
    },
    async invent() { return { ok: false, error: 'Nenhum projeto adicional no teste.' } },
    async renovate() { return { ok: false, error: 'Nenhuma reforma adicional no teste.' } },
  })
  const step = async () => {
    const turn = await planner.plan(world, { model() {}, activity() {} })
    world = world.complete(turn.action, turn.postpone)
  }
  for (let i = 0; i < 50 && !world.installed.some(s => s.item === 'mesa_corte'); i++) await step()
  assert.equal(world.recipes[0].output.item, 'mesa_corte', 'O primeiro caminho é o que a IA propôs')
  assert.equal(world.recipes[0].process, 'montar')
  assert.ok(world.installed.some(s => s.item === 'mesa_corte'))
  assert.ok(world.recipeOptions().processes.includes('cortar'), 'A estação inventada libera o corte')
  assert.ok(!world.recipeOptions().processes.includes('aquecer'))
  for (let i = 0; i < 40 && !world.recipes.some(r => r.output.item === 'tala' && r.uses > 0); i++) await step()
  const learned = world.recipes.find(recipe => recipe.output.item === 'tala')
  assert.ok(learned)
  assert.equal(learned.process, 'cortar')
  assert.ok(world.item(learned.output.item))
  const restored = fromSave(JSON.parse(JSON.stringify(toSave(world))))
  assert.deepEqual(restored.toState(), world.toState())
})

test('receitas de calor exigem estação e combustível; a IA pode cadastrar item novo com emoji', () => {
  const catalog = new ItemCatalog()
  const inventory = new Inventory(catalog)
  const book = new RecipeBook()
  inventory.exchange([], [stack('madeira', 2)])
  assert.equal(book.canLearn({ ...examples[1], fuel: stack('pedra') }, catalog), false)
  assert.ok(book.learn(examples[1], catalog, 1))
  assert.equal(book.craft(1, inventory), null)
  assert.equal(inventory.count('madeira'), 2)
  const newItem = { id: 'vaso', name: 'Vaso', emoji: '🏺', kind: 'material', capability: 'nenhuma', fuel: false }
  const recipe = { ...examples[0], output: stack('vaso'), newItem }
  assert.equal(book.canLearn({ ...recipe, newItem: { ...newItem, emoji: '<svg>' } }, catalog), false)
  assert.ok(book.learn(recipe, catalog, 2))
  assert.equal(catalog.get('vaso').emoji, '🏺')
  assert.equal(catalog.freeEmojis.includes('🏺'), false)
  assert.match(book.learnIssue({ ...recipe, output: stack('outro_vaso'), newItem: { ...newItem, id: 'outro_vaso' } }, catalog), /emoji livre/)
  assert.equal(book.learn(recipe, catalog, 3), null)
})

test('forno é fabricado na bancada, levado na mochila e só aquece após ser instalado', () => {
  let world = World.create()
  const walk = () => { world = world.complete(world.actions().find(a => a.kind === 'walk')) }
  walk()
  walk()
  assert.deepEqual(world.recipeOptions().processes, ['montar'])
  world = learn(world, examples[0])
  world = world.complete(world.actions().find(a => a.kind === 'gather' && a.resource === 'pedra'))
  const furnace = world.actions().find(a => a.kind === 'craft')
  assert.deepEqual(furnace.at, world.workbench)
  assert.notDeepEqual(furnace.at, world.position)
  assert.throws(() => world.complete({ ...furnace, at: world.position }), /ação de produção/)
  const before = world.bag.pedra
  const produced = world.complete(furnace)
  assert.deepEqual(produced.benchStock, [stack('forno')])
  assert.ok(!produced.inventory.some(s => s?.item === 'forno'))
  assert.ok(!produced.actions().some(a => a.kind === 'install'))
  assert.equal(produced.recipes[0].pendingFirstPickup, true)
  const restored = fromSave(toSave(produced))
  world = restored.complete(restored.actions().find(a => a.kind === 'pickup'))
  assert.equal(world.bag.pedra, before - 4)
  assert.ok(world.inventory.some(s => s?.item === 'forno'))
  assert.equal(world.installed.length, 0)
  assert.match(world.recipeIssue(examples[1]), /Falta uma estação acessível para aquecer/)
  assert.throws(() => world.complete({ ...world.actions().find(a => a.kind === 'install'), at: world.workbench }), /ação de produção/)
  world = fromSave(toSave(world))
  const install = world.actions().find(a => a.kind === 'install')
  world = world.complete(install)
  assert.ok(!world.inventory.some(s => s?.item === 'forno'))
  assert.deepEqual(world.installed[0].at, install.at)
  assert.deepEqual(world.recipeOptions().processes, ['montar', 'aquecer'])
  assert.equal(world.recipeIssue(examples[1]), null)
  assert.match(world.recipeIssue({ ...examples[1], fuel: stack('pedra') }), /Combustível inválido/)
})

test('pesquisa livre propõe item novo com emoji e só libera corte quando a estação chega ao mapa', () => {
  const initial = World.create()
  const state = initial.toState()
  state.turn = 5
  state.recipes = examples.map((recipe, i) => ({ ...recipe, id: i + 1, uses: 1 }))
  const world = World.fromState(initial.map, state)
  const options = world.recipeOptions()
  assert.deepEqual(options.processes, ['montar'])
  assert.ok(!options.inputs.includes('vidro'), 'já fabricado não significa que pode ser fabricado de novo sem o forno')
  assert.match(world.recipeIssue({ ...examples[0], name: 'Outro nome' }), /Receita já conhecida/)
  const newItem = { id: 'mesa_corte', name: 'Mesa de Corte', emoji: '🪚', kind: 'estacao', capability: 'cortar', fuel: false }
  const draft = { name: 'Montar mesa', process: 'montar', inputs: [stack('madeira')], fuel: null, output: stack(newItem.id), newItem }
  const learned = learn(world, draft)
  assert.equal(learned.item(newItem.id).emoji, '🪚')
  const produced = learned.complete(learned.actions().find(a => a.kind === 'craft'))
  const packed = produced.complete(produced.actions().find(a => a.kind === 'pickup'))
  assert.deepEqual(packed.recipeOptions().processes, ['montar'])
  const installed = packed.complete(packed.actions().find(a => a.kind === 'install'))
  assert.deepEqual(installed.recipeOptions().processes, ['montar', 'cortar'])
  assert.equal(fromSave(toSave(installed)).item(newItem.id).kind, 'estacao')
  const cutItem = { id: 'tala', name: 'Tala', emoji: '📏', kind: 'material', capability: 'nenhuma', fuel: false }
  const cutRecipe = { name: 'Cortar tala', process: 'cortar', inputs: [stack('madeira')], fuel: null,
    output: stack(cutItem.id), newItem: cutItem }
  const withRecipe = learn(installed, cutRecipe)
  const cut = withRecipe.complete(withRecipe.actions().find(a => a.kind === 'craft' && a.recipeId === withRecipe.turn))
  assert.ok(!cut.inventory.some(slot => slot?.item === 'tala'))
  assert.deepEqual(cut.installed[0].stock, [stack('tala')])
  const ready = cut.complete(cut.actions().find(a => a.kind === 'pickup' && a.item === 'tala'))
  assert.ok(ready.inventory.some(slot => slot?.item === 'tala'))
  assert.equal(ready.installed[0].stock, undefined)
})

test('fornalha guarda vidro em estoque persistente; só sai no tile, na quantidade que cabe', () => {
  const initial = World.create()
  const at = initial.constructionTiles()[0]
  const state = { ...initial.toState(), turn: 8, recipes: [{ ...examples[3], id: 1, uses: 0 }],
    installed: [{ item: 'forno', at, turn: 2 }], inventory: Array(32).fill(stack('pedra', 16)) }
  state.inventory[0] = stack('areia', 16)
  state.inventory[1] = stack('carvao', 16)
  const world = World.fromState(initial.map, state)
  const craft = { kind: 'craft', id: 'fabricar_1', recipeId: 1, at }
  assert.throws(() => world.complete({ ...craft, at: world.workbench }), /produção ou coleta/)
  const fired = world.complete(craft)
  assert.deepEqual(world.installed[0].stock, undefined, 'O turno anterior não muda')
  assert.deepEqual(fired.position, at)
  assert.deepEqual(fired.inventory.slice(0, 2), [stack('areia', 14), stack('carvao', 15)])
  assert.ok(!fired.inventory.some(slot => slot?.item === 'vidro'))
  assert.deepEqual(fired.installed[0].stock, [stack('vidro')])
  const pickup = { kind: 'pickup', id: 'retirar_vidro', source: 'workshop', sourceId: 2, item: 'vidro', at }
  assert.throws(() => fired.complete(pickup), /produção ou coleta/)
  assert.deepEqual(fired.installed[0].stock, [stack('vidro')])
  const saved = toSave(fired)
  const reopened = fromSave(saved)
  assert.deepEqual(reopened.toState(), fired.toState())
  const full = World.fromState(initial.map, { ...reopened.toState(), installed: [{ ...reopened.installed[0], stock: [stack('vidro', 16)] }] })
  assert.throws(() => full.complete(craft), /produção ou coleta/)
  assert.deepEqual(full.inventory, fired.inventory)
  const bag = full.inventory
  bag[2] = stack('vidro', 15)
  const ready = World.fromState(initial.map, { ...full.toState(), inventory: bag })
  assert.throws(() => ready.complete({ ...pickup, at: world.workbench }), /produção ou coleta/)
  const picked = ready.complete(pickup)
  assert.deepEqual(picked.inventory[2], stack('vidro', 16))
  assert.deepEqual(picked.installed[0].stock, [stack('vidro', 15)])
  assert.equal(picked.recipes[0].pendingFirstPickup, undefined)
})

test('uma invenção SVG pode gastar o vidro produzido e outro material da mochila', () => {
  const initial = World.create()
  const inventory = initial.inventory
  inventory[inventory.indexOf(null)] = stack('vidro', 2)
  const world = World.fromState(initial.map, { ...initial.toState(), inventory })
  const place = world.constructionTiles()[0]
  const plan = {
    nome: 'Vitral do Vale', tipo: 'objeto', ideia: 'Um vitral que dá alegria à Laya quando ela visita.',
    custo: { madeira: 0, pedra: 0 }, materiais: [stack('vidro', 2), stack('madeira')],
    pecas: [
      { forma: 'bloco', cor: 'marrom', x: 0, y: 0, largura: 18, altura: 12 },
      { forma: 'losango', cor: 'azul', x: 0, y: 10, largura: 22, altura: 22 },
    ],
    regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'alegria', quantidade: 6, insumo: 'nenhum' }],
  }
  assert.ok(world.canBuild(plan, place))
  assert.equal(initial.canBuild(plan, place), false)
  const fullBag = Array(32).fill(stack('pedra', 16))
  fullBag[0] = stack('vidro', 3)
  fullBag[1] = stack('madeira', 2)
  const full = World.fromState(world.map, { ...world.toState(), inventory: fullBag })
  assert.equal(full.canBuild(plan, place), true)
  const leftOnBench = full.complete({ id: 'montar_kit', kind: 'assemble', at: full.workbench, plan, plot: place })
  assert.equal(leftOnBench.benchKit, plan.nome)
  assert.ok(!leftOnBench.actions().some(a => a.kind === 'pickup_kit'))
  assert.deepEqual(full.inventory, fullBag)
  const staged = world.complete({ id: 'montar_kit', label: 'Montar kit', kind: 'assemble', at: world.workbench, score: 0, plan, plot: place })
  const packed = staged.complete(staged.actions().find(a => a.kind === 'pickup_kit'))
  assert.ok(!packed.itemCounts().some(s => s.item === 'vidro'))
  assert.equal(packed.bag.madeira, world.bag.madeira - 1)
  const built = packed.complete(packed.actions().find(a => a.kind === 'build'))
  assert.deepEqual(built.bag, packed.bag)
  assert.deepEqual(fromSave(toSave(built)).builds[0].plan.materiais, plan.materiais)
})
