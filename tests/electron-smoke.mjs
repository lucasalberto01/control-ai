import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, copyFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as wait } from 'node:timers/promises'
import electron from 'electron'

const preferred = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
const tempRoot = preferred && existsSync(preferred) ? preferred : tmpdir()
const profile = await mkdtemp(path.join(tempRoot, 'vale-smoke-'))
// A small deterministic vale: two characters and one used creation.
await copyFile(fileURLToPath(new URL('./fixtures/smoke-world.json', import.meta.url)), path.join(profile, 'world.save.json'))
const child = spawn(electron, ['.', `--user-data-dir=${profile}`, '--remote-debugging-port=0'], { stdio: 'ignore' })
let socket

async function eventually(fn, timeout) {
  const end = Date.now() + timeout
  while (Date.now() < end && child.exitCode === null) {
    const result = await fn()
    if (result) return result
    await wait(250)
  }
  throw new Error('O app não atingiu o estado esperado no prazo.')
}

try {
  const port = await eventually(() => readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
    .then(text => Number(text.split('\n')[0])).catch(() => null), 10_000)
  const page = await eventually(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json())
    return targets.find(item => item.type === 'page' && item.url.startsWith('file:'))
  }, 10_000)
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let id = 0
  const cdp = (method, params) => new Promise((resolve, reject) => {
    const request = ++id
    function listener(event) {
      const data = JSON.parse(event.data)
      if (data.id !== request) return
      socket.removeEventListener('message', listener)
      if (data.error || data.result.exceptionDetails) reject(new Error(JSON.stringify(data.error ?? data.result.exceptionDetails)))
      else resolve(data.result.result?.value)
    }
    socket.addEventListener('message', listener)
    socket.send(JSON.stringify({ id: request, method, params }))
  })
  const evaluate = expression => cdp('Runtime.evaluate', { expression, returnByValue: true })

  await eventually(() => evaluate('!!window.localAI && !!window.worldStorage && !!document.querySelector(".valley-svg")'), 10_000)
  await evaluate(`document.querySelector('[aria-label="Pausar"]')?.click()`)
  const saveFile = path.join(profile, 'world.save.json')
  const initial = JSON.parse(await readFile(saveFile, 'utf8'))
  assert.equal(initial.version, 2)
  assert.equal(initial.map.name, 'Vale da Laya')
  assert.equal(await evaluate('document.querySelectorAll(".bag-slot").length'), 32)
  assert.ok(await evaluate('!!document.querySelector("[data-workbench]")'))
  const researchTile = await evaluate('document.querySelector("[data-research-table]")?.dataset.researchTable')
  assert.match(researchTile, /^\d+,\d+$/)
  assert.ok(await evaluate('!!document.querySelector("[data-fruit-tree]")'))
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.fighters .fighter header strong')].map(e => e.textContent.replace('agindo','').replace('esperando','').trim())`),
    ['Laya', 'Kael'])
  assert.equal(await evaluate(`document.querySelectorAll('.fighter-hp progress').length`), 1,
    'Só o Kael, ferido, mostra a barra no cartão')
  assert.ok(await evaluate('!!document.querySelector(".fighter.laya .fighter-hp.full")'))
  assert.ok(await evaluate('document.querySelectorAll(".valley-svg [data-health-bar]").length >= 3'),
    'Javali ferido, Kael ferido e criação quebrada precisam mostrar a barra no mapa')
  assert.ok(await evaluate('!!document.querySelector(".valley-svg [data-health-value=\\"0\\"]")'),
    'A criação quebrada mostra a barra vazia')
  assert.ok(await evaluate('!!document.querySelector("[aria-label=\\"Aumentar zoom\\"]")'))
  const defaultView = await evaluate('document.querySelector("[data-map-view]")?.getAttribute("transform")')
  await evaluate('document.querySelector("[aria-label=\\"Aumentar zoom\\"]").click()')
  const zoomedView = await evaluate('document.querySelector("[data-map-view]")?.getAttribute("transform")')
  assert.notEqual(zoomedView, defaultView, 'O botão de zoom precisa transformar o mapa')
  await evaluate('document.querySelector("[aria-label=\\"Restaurar mapa\\"]").click()')
  assert.equal(await evaluate('document.querySelector("[data-map-view]")?.getAttribute("transform")'), 'translate(0 0) scale(1)')
  const mapBox = JSON.parse(await evaluate('JSON.stringify(document.querySelector(".valley-svg").getBoundingClientRect())'))
  const cx = Math.round(mapBox.x + mapBox.width / 2)
  const cy = Math.round(mapBox.y + mapBox.height / 2)
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'middle', buttons: 4, clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + 45, y: cy + 25, button: 'middle', buttons: 4 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 45, y: cy + 25, button: 'middle', buttons: 0, clickCount: 1 })
  assert.notEqual(await evaluate('document.querySelector("[data-map-view]")?.getAttribute("transform")'),
    'translate(0 0) scale(1)', 'Arrastar com o botão do meio precisa mover o mapa')
  await evaluate('document.querySelector("[aria-label=\\"Restaurar mapa\\"]").click()')
  await evaluate('document.querySelector("[aria-label=\\"Itens no chão\\"]").click()')
  assert.ok(await evaluate('!!document.querySelector(".loot-popover")'), 'O contador de itens precisa abrir o conteúdo das pilhas')
  await evaluate('document.querySelector("[aria-label=\\"Fechar itens no chão\\"]").click()')
  assert.match(await evaluate('document.querySelector(".fighter.laya .fighter-gear")?.innerText ?? ""'), /Espada de Smoke/)
  assert.match(await evaluate('document.querySelector(".fighter.laya .fighter-gear")?.innerText ?? ""'), /Dano 6/)
  assert.ok(await evaluate('!!document.querySelector(".backpack .bag-slot.equipped")'))
  await evaluate(`document.querySelector('[aria-label="Continuar"]')?.click()`)
  await evaluate(`document.querySelector('[aria-label="Velocidade 4 vezes"]').click()`)
  let status = ''
  const researched = new Set()
  let sawNotice = false
  async function readState() {
    const { state } = JSON.parse(await readFile(saveFile, 'utf8'))
    if (state.research) {
      assert.equal(`${state.position.x},${state.position.y}`, researchTile)
      researched.add(state.research.kind)
    }
    if (state.rival?.research) {
      assert.equal(`${state.rival.at.x},${state.rival.at.y}`, researchTile)
      researched.add(state.rival.research.kind)
    }
    sawNotice ||= await evaluate('!!document.querySelector("[data-research-notice]")')
    return state
  }
  if (process.argv.includes('--oficina')) {
    let workshop = ''
    let usedWorkbench = false
    const result = await eventually(async () => {
      status = await evaluate('`${document.querySelector(".model-strip")?.innerText} | agora: ${document.querySelector(".activity strong")?.innerText}`')
      const state = await readState()
      workshop = JSON.stringify({ recipes: state.recipes, installed: state.installed, log: state.log.slice(0, 4) })
      usedWorkbench ||= state.log.some(entry => /produziu .*Ficou no estoque de/.test(entry.text))
      return state.recipes.length >= 1 && state
    }, 220_000).catch(error => { throw new Error(`${error.message} Último estado: ${status}\nOficina: ${workshop}`) })
    assert.ok(result.recipes.every(recipe => !['agua', 'fruta', 'semente_da_horta'].includes(recipe.output.item)))
    assert.ok(researched.has('recipe'))
    const noticeSeen = await eventually(() => evaluate('!!document.querySelector("[data-research-notice]")'), 8000).catch(() => false)
    assert.ok(noticeSeen || sawNotice, 'Cada descoberta aceita deve aparecer como aviso dentro da janela do Electron.')
    await evaluate('document.querySelector(".tabs button:last-child").click()')
    assert.ok(await evaluate(`document.querySelectorAll(".recipe").length >= ${Math.min(result.recipes.length, 2)}`))
    console.log(`Oficina livre: ${result.recipes.map(recipe => `${recipe.name} (${recipe.process}, ${recipe.uses}×)`).join(', ')}.${usedWorkbench ? ' Fabricou na bancada.' : ''}`)
  } else {
    const build = initial.state.builds.find(entry => entry.uses > 0)
    assert.ok(build, 'O vale de teste começa com uma criação usada')
    assert.ok(build.plan.aparencia)
    assert.equal(build.plan.nome, 'Banco do Smoke')
    assert.ok(await evaluate('document.querySelectorAll(".map-invention").length > 0'))
    status = await evaluate('document.querySelector(".model-strip")?.innerText')
    const turn = initial.state.turn
    const later = await eventually(async () => {
      status = await evaluate('document.querySelector(".model-strip")?.innerText')
      const state = await readState()
      return state.turn >= turn + 2 && state
    }, 90_000).catch(error => { throw new Error(`${error.message} Último estado: ${status}`) })
    assert.ok(later.rival, 'O rival continua no save')
    assert.ok(await evaluate('document.querySelectorAll(".valley-svg [data-animal]").length >= 2'),
      'Os animais que voltaram ao bosque precisam aparecer no mapa')
    await evaluate(`document.querySelector('[aria-label="Pausar"]').click()`)
    assert.ok(await evaluate(`!!document.querySelector('[aria-label="Continuar"]')`))
    await evaluate('window.__beforeReload = true')
    await cdp('Page.reload')
    await eventually(() => evaluate('!window.__beforeReload && document.querySelectorAll(".fighter").length === 2 && document.querySelectorAll(".map-invention").length > 0').catch(() => false), 10_000)
    assert.match(await evaluate('document.querySelector(".fighter.laya .fighter-gear")?.innerText ?? ""'), /Espada de Smoke/,
      'O equipamento precisa continuar após recarregar o save')
    const mapTarget = `.map-invention[data-invention-id="${build.id}"]`
    await evaluate(`document.querySelector(${JSON.stringify(mapTarget)}).dispatchEvent(new MouseEvent("click", { bubbles: true }))`)
    assert.ok(await evaluate('!!document.querySelector(".catalog h3")'))
    assert.ok(await evaluate('document.querySelectorAll(".fighter").length === 2'))
    console.log(`Electron: ${build.plan.nome} estava no save; Laya e Kael aparecem e o vale avançou ${later.turn - turn} turnos.`)
    console.log(status)
  }
} finally {
  socket?.close()
  if (child.exitCode === null) {
    child.kill()
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), wait(2000)])
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
}
