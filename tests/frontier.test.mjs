import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { WorldStore } from '../electron/world-store.ts'
import { World } from '../src/world.ts'
import { fromSave, toSave } from '../src/world-save.ts'

const preferred = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
const profile = t => {
  const root = preferred && existsSync(preferred) ? preferred : tmpdir()
  const dir = mkdtempSync(path.join(root, 'vale-frontier-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const at = (point) => `${point.x},${point.y}`
const idle = world => world.complete({ id: 'esperar', kind: 'wait', label: 'Esperar', at: world.position, score: 1 })
const advance = world => {
  if (!world.hasLivingCharacter) world = world.revive(world.characters.find(character => !character.alive).id)
  return idle(world)
}
const grown = world => {
  const action = world.actions().find(entry => entry.kind === 'expand')
  assert.ok(action, 'A fronteira precisa estar disponível')
  return world.complete(action)
}

test('animais voltam ao bosque quando o vale fica vazio e param no limite', () => {
  const base = World.create()
  let world = World.fromState(base.map, { ...base.toState(), turn: 40, animals: [] })
  assert.ok(world)
  assert.equal(world.animals.length, 0)
  world = idle(world)
  assert.equal(world.animals.length, 2, 'Um vale vazio recupera dois animais logo no turno seguinte')
  assert.equal(new Set(world.animals.map(animal => animal.id)).size, 2)

  let most = world.animals.length
  for (let i = 0; i < 80; i++) {
    world = advance(world)
    most = Math.max(most, world.animals.length)
  }
  assert.equal(most, 4, 'A fauna para de crescer no limite do bosque')
  assert.ok(world.animals.length <= 4)
  for (const animal of world.animals) {
    assert.ok(world.map.contains(animal.at))
    assert.ok(!world.characters.some(character => at(character.at) === at(animal.at)), 'Animal não nasce em cima de ninguém')
    assert.ok(!world.builds.some(build => at(build.at) === at(animal.at)), 'Animal não nasce dentro de uma criação')
  }
  assert.equal(new Set(world.animals.map(animal => animal.id)).size, world.animals.length, 'Os IDs não se repetem')
})

test('desbravar a fronteira aumenta o mapa e preserva o vale', () => {
  const focus = (world, id = 'laya') => {
    const next = World.fromState(world.map, {
      ...world.toState(), active: world.characters.findIndex(character => character.id === id),
    })
    assert.ok(next)
    return next
  }
  const plan = {
    nome: 'Banco da Fronteira', tipo: 'objeto', ideia: 'Um banco para descansar e recuperar a energia.',
    custo: { madeira: 1, pedra: 0 }, aparencia: {
      base: { peca: 'laje', cor: 'arenito' }, suporte: null, corpo: { peca: 'assento', cor: 'cedro' },
      topo: null, adorno: { peca: 'flores', cor: 'lavanda' },
    },
    regras: [{ gatilho: 'uso', verbo: 'efeito', alvo: 'energia', quantidade: 6, insumo: 'nenhum' }], pecas: [],
  }
  let built = focus(World.create())
  const gather = built.actions().find(action => action.kind === 'gather' && action.resource === 'madeira')
  assert.ok(gather)
  built = built.complete(gather)
  const left = built.harvestable(gather.source, 'madeira')
  built = focus(built)
  const plot = built.constructionTiles()[0]
  built = built.complete({ id: 'montar_kit', kind: 'assemble', at: built.workbench, plot, plan })
  built = focus(built)
  built = built.complete(built.actions().find(action => action.kind === 'pickup_kit'))
  built = focus(built)
  built = built.complete(built.actions().find(action => action.kind === 'build'))
  assert.equal(built.builds.length, 1)

  const start = World.fromState(built.map, { ...built.toState(), turn: 45, animals: [] })
  assert.ok(start)
  const other = start.characters.find(character => character.id !== start.activeId)
  const before = {
    size: [start.map.width, start.map.height],
    sites: start.map.sites.map(site => `${site.kind}:${site.name}`),
    fruitTree: start.map.fruitTree,
    researchTable: start.map.researchTable,
    other: other.at,
    build: start.builds[0].at,
    builds: start.builds.length,
  }

  const expanded = grown(start)
  assert.equal(expanded.toState().lastExpand, 46)
  assert.ok(expanded.map.width === before.size[0] + 2 || expanded.map.height === before.size[1] + 2,
    'O mapa cresce em uma das direções')
  assert.ok(expanded.map.width <= 16 && expanded.map.height <= 16)
  assert.ok(expanded.map.buildLimit > start.map.buildLimit, 'O vale ganha espaço para novas criações')
  assert.equal(expanded.map.sites.filter(site => site.kind === 'marco').length, 1)
  for (const name of before.sites) assert.ok(expanded.map.sites.some(site => `${site.kind}:${site.name}` === name),
    `O lugar ${name} continua no mapa`)
  assert.deepEqual(expanded.map.fruitTree, before.fruitTree, 'A árvore frutífera não muda de lugar')
  assert.deepEqual(expanded.map.researchTable, before.researchTable, 'A Mesa de Pesquisa não muda de lugar')
  assert.deepEqual(expanded.character(other.id).at, before.other, 'Quem não desbravou continua onde estava')
  assert.equal(expanded.builds.length, before.builds)
  assert.deepEqual(expanded.builds[0].at, before.build)
  assert.equal(expanded.harvestable(gather.source, 'madeira'), left, 'A madeira já colhida continua colhida')
  assert.ok(expanded.characters.some(character => character.xp >= 5), 'Desbravar dá XP')
  assert.ok(!expanded.actions().some(action => action.kind === 'expand'), 'A fronteira descansa antes de crescer de novo')

  const save = toSave(expanded)
  const reloaded = fromSave(JSON.parse(JSON.stringify(save)))
  assert.equal(reloaded.map.width, expanded.map.width)
  assert.equal(reloaded.map.height, expanded.map.height)
  assert.deepEqual(reloaded.map.fruitTree, before.fruitTree)
  assert.deepEqual(reloaded.toState(), expanded.toState())
})

test('a fauna nasce em pontos diferentes conforme o turno', () => {
  const base = World.create()
  const woods = base.map.findSite('bosque').area[0]
  const positions = new Set()
  let far = 0
  for (let turn = 40; turn < 58; turn++) {
    const state = { ...base.toState(), turn, animals: [], drops: [] }
    const world = World.fromState(base.map, state)
    assert.ok(world)
    const after = world.complete({ id: 'esperar', kind: 'wait', label: 'Esperar', at: world.position, score: 1 })
    assert.equal(after.animals.length, 2)
    for (const animal of after.animals) {
      positions.add(`${animal.at.x},${animal.at.y}`)
      if (Math.abs(animal.at.x - woods.x) + Math.abs(animal.at.y - woods.y) > 3) far++
    }
  }
  assert.ok(positions.size > 4, 'A fauna precisa variar de posição entre turnos')
  assert.ok(far > 0, 'Ela também precisa poder nascer longe do bosque')
})

test('a expansão espera o intervalo e a oficina grava o mapa maior', t => {
  const dir = profile(t)
  const store = new WorldStore(dir)
  const first = fromSave(store.open(null))
  assert.ok(!World.fromState(first.map, { ...first.toState(), turn: 10, animals: [] }).actions().some(action => action.kind === 'expand'),
    'A fronteira não abre no começo do vale')

  let world = World.fromState(first.map, { ...first.toState(), turn: 45, animals: [] })
  world = grown(world)
  store.commit(world.toState(), world.map.toData())
  const reopened = fromSave(new WorldStore(dir).open(null))
  assert.equal(reopened.map.width, world.map.width)
  assert.equal(reopened.map.height, world.map.height)
  assert.equal(reopened.turn, world.turn)
  assert.ok(reopened.map.sites.some(site => site.kind === 'marco'))
  assert.throws(() => store.commit({
    ...world.toState(), turn: world.turn + 1,
  }, first.map.toData()), /menor que o atual/)

  let later = World.fromState(reopened.map, { ...reopened.toState(), turn: 100, animals: [] })
  later = grown(later)
  assert.ok(later.map.width > reopened.map.width || later.map.height > reopened.map.height)
})
