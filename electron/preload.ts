import { ipcRenderer, contextBridge } from 'electron'
import type { LocalAI, ResearchNotices, WorldStorage } from '../src/local-ai'

const localAI: LocalAI = {
  decide: (state, choices) => ipcRenderer.invoke('world:decide', state, choices),
  invent: (state, plotCount, first, materials, water) => ipcRenderer.invoke('world:invent', state, plotCount, first, materials, water),
  renovate: (state, look) => ipcRenderer.invoke('world:renovate', state, look),
  recipe: (state, options) => ipcRenderer.invoke('world:recipe', state, options),
}
contextBridge.exposeInMainWorld('localAI', localAI)

const worldStorage: WorldStorage = {
  load: legacy => ipcRenderer.invoke('world:load', legacy),
  save: (state, map) => ipcRenderer.invoke('world:save', state, map),
}
contextBridge.exposeInMainWorld('worldStorage', worldStorage)

const researchNotices: ResearchNotices = {
  onResult: listener => {
    const handle = (_event: unknown, notice: Parameters<typeof listener>[0]) => listener(notice)
    ipcRenderer.on('research:result', handle)
    return () => { ipcRenderer.removeListener('research:result', handle) }
  },
}
contextBridge.exposeInMainWorld('researchNotices', researchNotices)
