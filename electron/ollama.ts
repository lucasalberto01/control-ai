import {
  blueprintSchema, readBlueprint, readRenovation, record, renovationSchema,
  hasWaterSupply, inList, materialBlueprintSchema, starterBlueprintSchema, waterBlueprintSchema,
} from '../src/blueprint.ts'
import type { Blueprint, Renovation } from '../src/blueprint.ts'
import { readRecipeDraft, readRecipeOptions, recipeSchema } from '../src/crafting.ts'
import type { RecipeDraft } from '../src/crafting.ts'
import { harvestOnlyItems } from '../src/inventory.ts'
import { int } from '../src/world-values.ts'
import type { Idea, Reply } from '../src/local-ai.ts'
import { compatibleEditParts, editComposition, palettes, partsBySlot, readComposition, slots } from '../src/modules.ts'

const HOST = 'http://127.0.0.1:11434'
const LAYA = 'laya:322m-multilingual-bf16'
const QWEN = 'qwen3.5:4b'

async function request(path: string, body: object, timeout: number): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${HOST}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout), redirect: 'error',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('Ollama demorou para responder.')
    throw new Error('Sem conexão com o Ollama local.')
  }
  const data = record(await response.json())
  if (!response.ok) {
    if (response.status === 404 && String(data?.error).includes('model')) {
      throw new Error(`Baixe o modelo: ollama pull ${'model' in body ? body.model : ''}`)
    }
    throw new Error(`Ollama respondeu com erro ${response.status}.`)
  }
  if (!data) throw new Error('Resposta inválida do Ollama.')
  return data
}

const message = (error: unknown) => error instanceof Error ? error.message : 'Falha no Ollama local.'

export async function decide(state: unknown, input: unknown): Promise<Reply<string>> {
  const candidates = record(input)
  const entries = candidates && Object.entries(candidates)
  if (typeof state !== 'string' || state.length > 1000 || !entries || entries.length < 2 || entries.length > 8
    || !entries.every(([key, value]) => /^[a-z][a-z_0-9]{0,24}$/.test(key) && typeof value === 'string' && value.length <= 145)) {
    return { ok: false, error: 'Opções de ação inválidas.' }
  }
  try {
    const data = await request('/v1/systemone', {
      model: LAYA, state, keep_alive: '5m',
      questions: { acao: {
        type: 'choice',
        instructions: 'Escolha a próxima ação útil para a personagem. Considere necessidades, prioridades e evite repetição.',
        criteria: Object.fromEntries(entries),
      } },
    }, 35_000)
    const id = record(record(data.answers)?.acao)?.choice
    if (typeof id !== 'string' || !entries.some(([key]) => key === id)) {
      return { ok: false, error: 'A Laya não escolheu uma ação válida.' }
    }
    return { ok: true, value: id }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

const artGuide = `O jogo monta peças SVG prontas. Em "aparencia", dê base, suporte, corpo, topo e adorno. Cada parte é {peca,cor}; use null para camadas vazias. Sempre coloque base e pelo menos corpo ou topo. Nunca escreva SVG ou coordenadas.
${Object.entries(partsBySlot).map(([slot, parts]) => `${slot}: ${Object.entries(parts).map(([id, label]) => `${id} (${label})`).join(', ')}`).join('\n')}
Cores por peça: ${palettes.join(', ')}. Use duas ou três cores, com contraste moderado.
Encaixes: colunas requerem telhado e telhado requer colunas. Poste não carrega corpo. Pedestal só carrega bacia, cascata, barril ou um topo sem corpo. Bica/jato exigem bacia/cascata; funil exige barril. Cúpula, gema, estátua ou chama só vão sobre mesa, armário ou sem corpo.
Exemplo de banco: {"base":{"peca":"disco","cor":"arenito"},"suporte":null,"corpo":{"peca":"assento","cor":"cedro"},"topo":null,"adorno":{"peca":"flores","cor":"lavanda"}}.`

const ruleGuide = `As regras têm gatilho, verbo, alvo, quantidade e insumo.
- "efeito" ao "uso": altera energia, alegria, fome ou umidade de 1 a 12. Fome baixa; outras sobem. Para umidade, insumo "agua" obrigatório; para fome, "fruta" obrigatório. Nos demais, pode ser "nenhum". Insumo custa uma unidade do estoque local ou da bolsa.
- "gerar" ao gatilho "chuva" (alvo "agua"): capta 1 a 3 unidades de chuva no estoque do objeto. Insumo "nenhum". Frutas vêm só de árvores e do cultivo.
- "transferir" ao "uso": habilita uma ação separada para recolher de 1 a 3 unidades já guardadas no objeto. Laya precisa estar no tile do aparelho. Insumo "nenhum".
- "converter" ao "uso": consome uma unidade da bolsa e guarda uma unidade de "madeira" ou "pedra" no aparelho, para recolher em outra ação. Não cria água ou frutas.`

const waterGuide = `Objetivo obrigatório: projete um aparelho que capte chuva e a guarde no próprio estoque. Laya vai até o tile do aparelho e aciona a retirada em outro turno para levar a água à mochila. Use duas regras diferentes: uma "chuva"/"gerar"/"agua" e uma "uso"/"transferir"/"agua". Insumo "nenhum"; prefira quantidade 2 ou 3 em ambas. Escolha a própria ideia. O custo precisa ser maior que zero e caber na bolsa indicada.`

function readWaterBudget(raw: unknown): Blueprint['custo'] | null {
  const budget = record(raw)
  if (!budget || !int(budget.madeira, 0, 4) || !int(budget.pedra, 0, 4) || budget.madeira + budget.pedra === 0) return null
  return { madeira: budget.madeira, pedra: budget.pedra }
}

const guide = `Você interpreta Laya, inventora de um pequeno vale isométrico. Faça UMA invenção original e útil, em português brasileiro. Pode ser um lugar visitável ou um objeto instalado. Escreva a ideia em uma frase completa com até 100 caracteres e descreva só efeitos que a simulação realmente executa. Não copie invenções existentes.
Responda em JSON com "terreno" (índice de uma das opções) e "planta" (nome, tipo, ideia, custo, aparencia, regras).
Custo: madeira e pedra são inteiros de 0 a 4, pelo menos um maior que zero, sem exceder a bolsa.
${artGuide}
Use 1 a 4 regras, sendo pelo menos uma de uso, preferencialmente executável agora. Escolha UMA família de função: só efeitos nas necessidades (energia, alegria, fome, umidade) ou só recursos (guardar, retirar, converter). Nunca misture as duas: um banco não guarda água, uma cisterna não dá energia.
${ruleGuide}`

const remodelGuide = `Você interpreta Laya, mudando só o desenho de uma invenção existente no vale. Não crie um novo lugar, não mude o nome, não mova a invenção e não altere nenhuma função. Responda em JSON com ideia, custo e modulo. "modulo" é {camada,parte}, onde parte é {peca,cor}, ou null para remover uma parte opcional. Em ideia escreva em português uma frase curta e concreta sobre o desenho novo.
Custo: gaste 1 ou 2 de madeira ou pedra disponíveis, com 0 onde não usar. Não ultrapasse a bolsa.
Troque, repinte, acrescente ou remova uma única peça. Use apenas as peças compatíveis enviadas na mensagem. Nunca repita o mesmo ID e cor da peça atual. Não escreva SVG, regras nem funções.`

async function generate(system: string, state: string, format: object) {
  const data = await request('/api/chat', {
    model: QWEN, format, stream: false, think: false, keep_alive: '5m',
    options: { num_ctx: 4096, num_predict: 1500, temperature: 0.7, presence_penalty: 0.2 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: state }],
  }, 45_000)
  const content = record(data.message)?.content
  return typeof content === 'string' ? parseJson(content) : null
}

export async function invent(state: unknown, plotCount: unknown, first: unknown = false, materials: unknown = false,
  waterInput?: unknown): Promise<Reply<Idea>> {
  const water = readWaterBudget(waterInput)
  if (typeof state !== 'string' || state.length > 4000 || typeof plotCount !== 'number'
    || !Number.isInteger(plotCount) || plotCount < 1 || plotCount > 8 || typeof first !== 'boolean' || typeof materials !== 'boolean'
    || (waterInput !== undefined && !water)) {
    return { ok: false, error: 'Terrenos inválidos.' }
  }
  try {
    for (const simple of [false, true]) {
      const format = {
        type: 'object', additionalProperties: false, required: ['terreno', 'planta'],
        properties: {
          terreno: { type: 'integer', minimum: 0, maximum: plotCount - 1 },
          planta: water ? waterBlueprintSchema(water, simple)
            : first || simple ? starterBlueprintSchema(simple) : materials ? materialBlueprintSchema() : blueprintSchema,
        },
      }
      const prompt = [state]
      if (water) prompt.push(waterGuide)
      else if (first || simple) prompt.push('Use exatamente uma regra: gatilho uso, verbo efeito, alvo energia ou alegria, insumo nenhum.')
      if (simple) prompt.push('Use uma base e um corpo completos; suporte e topo ficam null. Adorno é opcional.')
      if (!water && !simple && materials && !first) prompt.push('Substitua o custo antigo (madeira e pedra ficam 0) por "materiais": combine de 2 a 4 tipos da mochila com {item,quantity}. Use pelo menos um material além de madeira e pedra e não ultrapasse o que está na mochila.')
      const draft = record(await generate(guide, prompt.join('\n'), format))
      const plot = draft?.terreno
      const plan = readBlueprint(draft?.planta)
      const immediate = plan?.regras.some(r => r.gatilho === 'uso' && r.verbo === 'efeito'
        && (r.alvo === 'energia' || r.alvo === 'alegria') && r.insumo === 'nenhum')
      if (plan?.aparencia && 'base' in plan.aparencia && !plan.pecas.length
        && (water ? hasWaterSupply(plan.regras) && !plan.materiais && plan.custo.madeira <= water.madeira
          && plan.custo.pedra <= water.pedra : immediate || !first)
        && typeof plot === 'number' && Number.isInteger(plot) && plot >= 0 && plot < plotCount) {
        return { ok: true, value: { plan, plot } }
      }
      if (process.env.VALE_DEBUG_AI === '1') console.warn('Projeto rejeitado:', JSON.stringify(draft))
    }
    return { ok: false, error: 'O projeto inventado não passou pelas regras do mundo.' }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

export async function renovate(state: unknown, input: unknown): Promise<Reply<Renovation>> {
  const look = readComposition(input)
  if (typeof state !== 'string' || state.length > 12_000 || !look) {
    return { ok: false, error: 'Dados da reforma inválidos.' }
  }
  try {
    const choices = slots.map(slot => `${slot}: ${compatibleEditParts(look, slot).map(p => p ?? 'null').join(', ')}`).join('; ')
    const prompt = `${state}\nPeças compatíveis por camada: ${choices}. Cores: ${palettes.join(', ')}.`
    for (const simple of [false, true]) {
      const draft = await generate(remodelGuide, simple
        ? `${prompt}\nRepinte apenas uma peça existente com outra cor, mantendo as demais camadas.`
        : prompt, renovationSchema(look))
      const proposal = readRenovation(draft)
      if (proposal?.modulo) {
        const changed = editComposition(look, proposal.modulo)
        if (changed && JSON.stringify(changed) !== JSON.stringify(look)) return { ok: true, value: proposal }
      }
      if (process.env.VALE_DEBUG_AI === '1') console.warn('Reforma rejeitada:', JSON.stringify(draft))
    }
    return { ok: false, error: 'A proposta de reforma não passou pelas regras do mundo.' }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

function parseJson(input: string): unknown {
  try { return JSON.parse(input) } catch { return null }
}

const recipeGuide = `Crie UMA receita para o Vale da Laya em português brasileiro. Montar acontece na bancada; aquecer, cortar e misturar exigem estações próprias. O resultado fica no estoque do aparelho até ser recolhido no local. Use somente os processos e insumos oferecidos. Não fabrique água, frutas nem sementes: vêm da coleta. Não repita receitas conhecidas e escolha livremente o que descobrir agora — não existe alvo obrigatório.
Resposta JSON: name (nome da receita), process (montar, aquecer, misturar ou cortar), inputs (1 a 4 pilhas distintas {item,quantity}), fuel (pilha extra obrigatória para aquecer, null nos demais), output (uma pilha), newItem (null para resultado do catálogo). Use os IDs informados exatamente como escritos e quantidades inteiras de 1 a 8. Ingredientes podem vir da mochila ou de fontes de coleta informadas, e serão debitados ao fabricar. Um combustível consome unidades separadas dos ingredientes, mesmo quando é o mesmo tipo de item.
Prefira criar um item novo com newItem: {id,name,emoji,kind,capability,fuel,damage,protection}. Use um ID novo (minúsculas, sem acentos) igual a output.item, nome em português e um emoji da lista livre no formato. kind material para insumos; objeto, estacao ou luz para objetos que poderão ser instalados. Estação tem capability aquecer, misturar ou cortar; outros têm "nenhuma". Só materiais podem ser combustíveis. Para uma arma, use kind objeto, damage entre 4 e 12 e protection 0. Para uma armadura, use kind objeto, protection entre 2 e 8 e damage 0. Um item misto pode ter os dois, com valores moderados (por exemplo, damage 4 e protection 3). Só kind objeto pode ter damage ou protection; nos demais, use 0 nos dois. Não use imagens, código ou marcação.`

export async function discoverRecipe(state: unknown, value: unknown): Promise<Reply<RecipeDraft>> {
  const options = readRecipeOptions(value)
  if (typeof state !== 'string' || state.length > 10_000 || !options) {
    return { ok: false, error: 'Dados de pesquisa inválidos.' }
  }
  try {
    if (!options.inputs.length || !options.processes.some(p => p !== 'aquecer' || options.fuels.length)) {
      return { ok: false, error: 'Sem insumos ou combustível para pesquisar essa receita.' }
    }
    let issue = ''
    const schema = recipeSchema(options)
    for (const retry of [false, true]) {
      const raw = await generate(recipeGuide, retry ? `${state}\n${issue} Refaça com poucos ingredientes e siga o formato.` : state, schema)
      const recipe = readRecipeDraft(raw)
      const missing = recipe?.inputs.find(i => !options.inputs.includes(i.item))
      if (!recipe) issue = 'A proposta não seguiu o formato da receita.'
      else if (!options.processes.includes(recipe.process)) issue = `Falta estação para ${recipe.process}.`
      else if (inList(recipe.output.item, harvestOnlyItems)) issue = 'Água, frutas e sementes vêm da coleta, não da fabricação.'
      else if (missing) issue = `Insumo indisponível: ${missing.item}.`
      else if (recipe.fuel && !options.fuels.includes(recipe.fuel.item)) issue = `Combustível indisponível: ${recipe.fuel.item}.`
      else if (recipe.newItem && options.outputs.includes(recipe.newItem.id)) issue = `O ID ${recipe.newItem.id} já existe; use outro ou deixe newItem como null.`
      else if (recipe.newItem && !options.emojis.includes(recipe.newItem.emoji)) issue = 'Use um emoji livre da lista.'
      else if (!recipe.newItem && !options.outputs.includes(recipe.output.item)) issue = `Resultado ${recipe.output.item} não cadastrado; preencha newItem.`
      else return { ok: true, value: recipe }
      if (process.env.VALE_DEBUG_AI === '1') console.warn('Receita rejeitada:', JSON.stringify(raw))
    }
    return { ok: false, error: issue }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}
