import { useState } from 'react'
import ValleyMap from './ValleyMap'
import { InventionArt } from './InventionArt'
import { appearanceFor } from './appearance'
import { slots } from './modules'
import { Backpack, RecipePanel } from './WorkshopPanel'
import { Fighters } from './Fighters'
import type { Rule } from './blueprint'
import { clock } from './world'
import { useWorld } from './useWorld'
import './App.css'

const names = { madeira: 'Madeira', pedra: 'Pedra', agua: 'Água', fruta: 'Fruta', energia: 'Energia', fome: 'Fome', alegria: 'Alegria', umidade: 'Umidade', sede: 'Sede', hp: 'HP' }

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const shapes: Record<string, React.ReactNode> = {
    leaf: <><path d="M4 17C1 8 8 4 19 4c-1 10-6 16-15 13Z"/><path d="M3 21 14 10"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"/></>,
    moon: <path d="M20 15A8.5 8.5 0 0 1 9 4a9 9 0 1 0 11 11Z"/>,
    rain: <><path d="M5 15a4 4 0 1 1 2-7 5 5 0 0 1 10 1 3 3 0 1 1 1 6"/><path d="m8 16-2 4m6-4-2 4m6-4-2 4"/></>,
    pause: <><path d="M9 5v14m6-14v14" strokeWidth="2.5"/></>,
    play: <path d="m8 5 11 7-11 7Z" fill="currentColor" strokeWidth="1"/>,
    star: <path d="M12 3c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9Z"/>,
    book: <><path d="M5 4h14v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 1-2Z"/><path d="M4 16h15M8 8h7m-7 4h5"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>
}

function ruleLabel(r: Rule) {
  const target = names[r.alvo].toLowerCase()
  if ((r.verbo === 'gerar' && r.alvo === 'fruta') || (r.verbo === 'converter' && (r.alvo === 'agua' || r.alvo === 'fruta'))) {
    return `Regra antiga inativa: ${target} agora vem de coleta ou cultivo.`
  }
  if (r.verbo === 'gerar') return `${r.gatilho === 'chuva' ? 'Na chuva' : 'Ao amanhecer'}: guarda ${r.quantidade} de ${target}.`
  if (r.verbo === 'transferir') return `Ao recolher no local: leva até ${r.quantidade} de ${target} do estoque.`
  if (r.verbo === 'converter' && r.insumo !== 'nenhum') return `Ao usar: gasta 1 de ${names[r.insumo].toLowerCase()} e guarda 1 de ${target} no aparelho.`
  const cost = r.insumo === 'nenhum' ? '' : ` (gasta 1 de ${names[r.insumo].toLowerCase()})`
  return `Ao usar: ${r.alvo === 'fome' ? 'reduz' : 'aumenta'} ${target} em ${r.quantidade}${cost}.`
}

function journalKind(text: string): 'combate' | 'coleta' | 'pesquisa' | 'outro' {
  if (/atac|morreu|derrot|quebr|repar|HP|proteç|mordid/i.test(text)) return 'combate'
  if (/colheu|coletou|recolheu|largou|plantou|regou|comeu|bebeu|usou|guardou|soneca|dormiu|passeou|observou/i.test(text)) return 'coleta'
  if (/receita|planta|reforma|pesquis|projeto|anotou|invent|ideia/i.test(text)) return 'pesquisa'
  return 'outro'
}

function App() {
  const simulation = useWorld()
  const [selectedId, select] = useState<number>()
  const [tab, setTab] = useState<'mochila' | 'diario' | 'criacoes' | 'oficina'>('mochila')
  const [journalFilter, setJournalFilter] = useState<'tudo' | 'combate' | 'coleta' | 'pesquisa'>('tudo')
  const [lootOpen, setLootOpen] = useState(false)
  if (!simulation.world) return <main className="app">
    <section className="status-card card">
      <h1>Vale da Laya</h1>
      <p role={simulation.storageError ? 'alert' : 'status'}>{simulation.storageError || 'Carregando o progresso…'}</p>
      {simulation.storageError && <button onClick={simulation.retryLoad}>Tentar novamente</button>}
    </section>
  </main>
  const { world, paused, setPaused, speed, setSpeed, activity, models, actor, facing, walking, destination, draft, storageError, notice } = simulation
  const { day, time } = world.time
  const { rain, night } = world.weather
  const { builds } = world
  const selected = builds.find(b => b.id === selectedId) ?? builds[builds.length - 1]
  const selectedLook = selected && appearanceFor(selected.plan)
  const uses = builds.reduce((sum, b) => sum + b.uses, 0)
  const broken = builds.filter(build => build.broken).length
  const filteredLog = world.log
    .filter(entry => journalFilter === 'tudo' || journalKind(entry.text) === journalFilter)
    .slice(0, 8)

  function inspect(id: number) {
    select(id)
    setTab('criacoes')
  }

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark"><Icon name="leaf" size={24} /></span>
          <div><p className="eyebrow">MINIMUNDO AUTÔNOMO</p><h1>{world.map.name}</h1></div>
        </div>
        <div className="header-right">
          <span className="live"><i className={paused ? 'idle-dot' : 'live-dot'} />{paused ? 'Pausado' : 'Simulação ao vivo'}</span>
          <div className="controls" aria-label="Controles do tempo">
            <button className="play-toggle" title={paused ? 'Continuar' : 'Pausar'} aria-label={paused ? 'Continuar' : 'Pausar'}
              onClick={() => setPaused(!paused)}><Icon name={paused ? 'play' : 'pause'} /></button>
            {([1, 2, 4] as const).map(s => <button key={s} aria-pressed={speed === s} aria-label={`Velocidade ${s} vezes`}
              className={speed === s ? 'chosen' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
        </div>
      </header>

      <div className="layout">
        <section className="world-card card" aria-label="Mundo">
          <div className="map-header">
            <div><p className="eyebrow">DIORAMA VIVO</p><h2>O vale</h2></div>
            <div className="map-meta">
              <span className="turn-badge">Turno <b>{world.turn}</b></span>
              <div className="weather"><Icon name={rain ? 'rain' : night ? 'moon' : 'sun'} />
                <div><strong>Dia {day} <span>·</span> {time}</strong><small>{rain ? 'Chuva' : night ? 'Noite limpa' : 'Céu limpo'}</small></div>
              </div>
            </div>
          </div>
          <div className="scene">
            <ValleyMap world={world} actor={actor} facing={facing} walking={walking} destination={destination}
              draft={draft} paused={paused} stepMs={300 / speed} selected={tab === 'criacoes' ? selected?.id : undefined} onSelect={inspect} />
          </div>
          <div className="map-footer">
            <div className="activity"><span className="star"><Icon name="star" size={16} /></span>
              <div><span className="eyebrow">{world.active.name.toUpperCase()} AGORA</span><strong>{paused ? 'Observação pausada' : activity}</strong></div>
            </div>
            <div className="map-side">
              <div className="map-pulse" aria-label="Estado do mapa">
                <span title="Javalis no vale">🐗 <b>{world.animals.length}</b></span>
                <button type="button" className={world.drops.length ? 'has-loot' : ''} aria-label="Itens no chão"
                  aria-expanded={lootOpen} onClick={() => setLootOpen(open => !open)}>
                  🎒 <b>{world.drops.length}</b>
                </button>
                <span className={broken ? 'warn' : ''} title="Criações quebradas">🪵 <b>{broken}</b></span>
              </div>
              <span className="passive-note">O vale muda sem você precisar dar ordens.</span>
              {lootOpen && <div className="loot-popover" role="dialog" aria-label="Itens no chão">
                <header><strong>Itens no chão</strong>
                  <button type="button" aria-label="Fechar itens no chão" onClick={() => setLootOpen(false)}>×</button>
                </header>
                {world.drops.length ? <ul>{world.drops.map(drop => <li key={drop.id}>
                  <b>({drop.at.x}, {drop.at.y})</b>
                  <span>{drop.items.map(stack => `${world.item(stack.item)?.name ?? stack.item} ×${stack.quantity}`).join(' · ')}</span>
                </li>)}</ul> : <p>Nenhum item no chão.</p>}
              </div>}
            </div>
          </div>
        </section>

        <aside className="sidebar" aria-label="Estado do vale">
          <Fighters world={world} onRevive={simulation.revive} />

          <section className="log-card card" aria-label="Caderno do vale">
            <div className="section-heading"><span className="star"><Icon name="book" size={16} /></span><h2>Caderno do vale</h2></div>
            <div className="tabs" aria-label="Seção do caderno">
              <button aria-pressed={tab === 'mochila'} onClick={() => setTab('mochila')}>Mochila</button>
              <button aria-pressed={tab === 'diario'} onClick={() => setTab('diario')}>Diário</button>
              <button aria-pressed={tab === 'criacoes'} onClick={() => setTab('criacoes')}>Criações <span>{builds.length}</span></button>
              <button aria-pressed={tab === 'oficina'} onClick={() => setTab('oficina')}>Oficina <span>{world.recipes.length}</span></button>
            </div>
            {tab === 'mochila' ? <Backpack world={world} />
              : tab === 'diario' ? <>
                <div className="journal-filters" aria-label="Filtrar diário">
                  {(['tudo', 'combate', 'coleta', 'pesquisa'] as const).map(filter =>
                    <button key={filter} aria-pressed={journalFilter === filter} onClick={() => setJournalFilter(filter)}>
                      {filter[0].toUpperCase()}{filter.slice(1)}
                    </button>)}
                </div>
                {filteredLog.length ? <ol className="journal">
                  {filteredLog.map((entry, i) => <li key={`${entry.minute}:${entry.text}:${i}`}>
                    <time title={`Dia ${clock(entry.minute).day}`}>{clock(entry.minute).time}</time><span>{entry.text}</span>
                  </li>)}
                </ol> : <p className="empty">Nada nesse filtro ainda.</p>}
              </>
              : tab === 'oficina' ? <RecipePanel world={world} />
              : selected ? <div className="catalog">
                <label className="catalog-picker">Invenção
                  <select value={selected.id} onChange={e => select(Number(e.target.value))}>
                    {[...builds].reverse().map(b => <option key={b.id} value={b.id}>{b.plan.nome}</option>)}
                  </select>
                </label>
                <div className="item">
                  <svg viewBox="-40 -61 80 83" aria-hidden="true"><InventionArt plan={selected.plan} /></svg>
                  <div><h3>{selected.plan.nome}</h3><p>{selected.plan.ideia}</p><small>{selected.plan.tipo === 'lugar' ? 'Lugar' : 'Objeto'} · {selected.uses} {selected.uses === 1 ? 'uso' : 'usos'}</small></div>
                </div>
                <details className="visual-parts">
                  <summary>Peças do visual</summary>
                  <ul>{slots.map(slot => {
                    const piece = selectedLook?.[slot]
                    return piece && <li key={slot}>{slot}: {piece.peca.replace(/_/g, ' ')} · {piece.cor}</li>
                  })}</ul>
                </details>
                {selected.plan.materiais && <p className="build-materials">
                  Feito com {selected.plan.materiais.map((stack, i) => {
                    const item = world.item(stack.item)
                    return <span key={stack.item}>{i > 0 && ' + '}<span className="item-emoji" aria-hidden="true">{item?.emoji}</span> {item?.name ?? stack.item} ×{stack.quantity}</span>
                  })}
                </p>}
                 {Object.values(selected.stock).some(Boolean) && <p className="build-materials">
                   Estoque no aparelho: {Object.entries(selected.stock).filter(([, quantity]) => quantity > 0)
                     .map(([id, quantity]) => `${world.item(id)?.name ?? id} ×${quantity}`).join(', ')}
                 </p>}
                 <ul>{selected.plan.regras.map((r, i) => <li key={i}>{ruleLabel(r)}</li>)}</ul>
                {!!selected.renovations?.length && <details className="renovation-history">
                  <summary>Histórico de reformas</summary>
                  <ul>{[...selected.renovations].reverse().map(entry =>
                    <li key={entry.turn}>Turno {entry.turn}: {entry.text}</li>)}</ul>
                </details>}
              </div> : <p className="empty">As invenções aparecem aqui quando alguém as constrói. Depois, você pode selecioná-las no mapa.</p>}
          </section>
        </aside>
      </div>

      <footer className="model-strip">
        <span><b>Laya 322M</b> · {models.decision}</span>
        <span><b>Qwen 3.5 4B</b> · {window.localAI ? models.generation : 'Abra pelo Electron'}</span>
        {storageError && <span role="alert">{storageError}</span>}
        {!window.worldStorage && <span>Sem save no navegador</span>}
        <span className="counts">
          {world.turn} {world.turn === 1 ? 'turno' : 'turnos'} · {builds.length} {builds.length === 1 ? 'criação' : 'criações'} · {uses} {uses === 1 ? 'uso' : 'usos'}
        </span>
      </footer>

      {notice && <aside className="research-toast" role="status" data-research-notice onClick={simulation.dismissNotice}>
        <span className="research-toast-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="12" rx="1.5" />
            <path d="M8 20h8m-4-4v4M7 9h5m-5 3h8" />
          </svg>
        </span>
        <div><strong>{notice.title}</strong><small>{notice.body}</small></div>
        <button aria-label="Fechar notificação" onClick={event => { event.stopPropagation(); simulation.dismissNotice() }}>×</button>
      </aside>}
    </main>
  )
}

export default App
