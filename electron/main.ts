import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { decide, discoverRecipe, invent, renovate } from './ollama'
import { WorldStore } from './world-store'
import type { ResearchNotice } from './world-store'
import type { Reply } from '../src/local-ai'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.cjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    title: 'Vale da Laya',
    width: 1260,
    height: 820,
    minWidth: 480,
    minHeight: 560,
    backgroundColor: '#edf1e1',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.once('closed', () => { win = null })

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

function storageReply<T>(operation: () => T): Reply<T> {
  try {
    return { ok: true, value: operation() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Houve um erro de armazenamento.' }
  }
}

function publishResearch(notice?: ResearchNotice) {
  if (!notice) return
  // Always surface the result inside the app window; the native toast is only a bonus.
  try {
    win?.webContents.send('research:result', notice)
    if (win?.isMinimized()) win.flashFrame(true)
  } catch {
    return
  }
  if (app.isPackaged && process.platform === 'win32' && Notification.isSupported()) {
    try {
      const toast = new Notification(notice)
      toast.on('click', () => {
        if (win?.isMinimized()) win.restore()
        win?.focus()
      })
      toast.show()
    } catch (error) {
      console.warn('Não foi possível exibir a notificação nativa.', error)
    }
  }
}

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

app.on('second-instance', () => {
  if (win?.isMinimized()) win.restore()
  win?.focus()
})

if (primary) void app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'local.valedalaya' : process.execPath)
  const store = new WorldStore(app.getPath('userData'))
  const away = { ok: false, error: 'A Laya precisa estar na Mesa de Pesquisa com esse estudo em andamento.' } as const
  ipcMain.handle('world:load', (event, legacy) => event.sender === win?.webContents
    ? storageReply(() => store.open(legacy)) : { ok: false, error: 'Janela não autorizada.' })
  ipcMain.handle('world:save', (event, state, map) => event.sender === win?.webContents
    ? storageReply(() => { publishResearch(store.commit(state, map)); return null }) : { ok: false, error: 'Janela não autorizada.' })
  ipcMain.handle('world:decide', (event, state, choices) => event.sender === win?.webContents
    ? decide(state, choices) : { ok: false, error: 'Janela não autorizada.' })
  ipcMain.handle('world:invent', (event, state, plotCount, first, materials, water) => event.sender === win?.webContents
    ? (store.researchKind === 'blueprint' ? invent(state, plotCount, first, materials, water) : away)
    : { ok: false, error: 'Janela não autorizada.' })
  ipcMain.handle('world:renovate', (event, state, look) => event.sender === win?.webContents
    ? (store.researchKind === 'renovation' ? renovate(state, look) : away)
    : { ok: false, error: 'Janela não autorizada.' })
  ipcMain.handle('world:recipe', (event, state, options) => event.sender === win?.webContents
    ? (store.researchKind === 'recipe' ? discoverRecipe(state, options) : away)
    : { ok: false, error: 'Janela não autorizada.' })
  createWindow()
})
