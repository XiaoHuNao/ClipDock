const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

let electron = null
try {
  electron = require('electron')
} catch (error) {
  electron = null
}

const clipboard = electron && electron.clipboard
const ipcRenderer = electron && electron.ipcRenderer
const nativeImage = electron && electron.nativeImage

const HISTORY_KEY = 'clipboard_manager_history'
const GROUPS_KEY = 'clipboard_manager_groups'
const SETTINGS_KEY = 'clipboard_manager_settings'
const MAX_HISTORY = 500
const SIDEBAR_INIT_CHANNEL = 'clipboard-sidebar-init'
const SIDEBAR_COMMAND_PREFIX = 'clipboard-sidebar-command-'
const SIDEBAR_INIT_RETRY_DELAYS = [0, 80, 180, 360, 700, 1200, 2000]
const DOCK_SIZE = {
  width: 336,
  minHeight: 480,
  maxHeight: 720,
  railWidth: 18,
  railHeight: 180,
  edgeThreshold: 72,
  edgePadding: 12
}

let watchTimer = null
let lastSignature = ''
let sidebarWindow = null
let fallbackSidebarWindow = null
let sidebarDockState = {
  mode: 'rail',
  side: 'right',
  pinned: false
}
let sidebarDrag = null
let sidebarInitTimers = []
let dockParentId = null
let dockWindowId = null
let dockState = {
  mode: 'rail',
  side: 'right',
  pinned: false
}
let pendingDockCommand = null
let remoteHistory = []
let remoteGroups = ['常用']
const dockListeners = new Set()
const historyListeners = new Set()

function now () {
  return Date.now()
}

function uid () {
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeUtools () {
  return window.utools || null
}

function hasDbStorage () {
  const utools = safeUtools()
  return Boolean(utools && utools.dbStorage)
}

function dbGet (key, fallback) {
  try {
    const utools = safeUtools()
    if (!utools || !utools.dbStorage) {
      if (key === HISTORY_KEY) return remoteHistory
      if (key === GROUPS_KEY) return remoteGroups
      return fallback
    }
    const value = utools.dbStorage.getItem(key)
    return value == null ? fallback : value
  } catch (error) {
    return fallback
  }
}

function dbSet (key, value) {
  try {
    const utools = safeUtools()
    if (utools && utools.dbStorage) {
      utools.dbStorage.setItem(key, value)
      return
    }
    if (key === HISTORY_KEY) remoteHistory = Array.isArray(value) ? value : []
    if (key === GROUPS_KEY) remoteGroups = Array.isArray(value) && value.length ? value : ['常用']
  } catch (error) {}
}

function hash (value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex')
}

function clamp (value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function byteSize (text) {
  const bytes = Buffer.byteLength(String(text || ''), 'utf8')
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function inferTextType (text) {
  const trimmed = String(text || '').trim()
  if (/^https?:\/\//i.test(trimmed)) return 'text'
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) return 'code'
  if (/^(const|let|var|function|import|export|class)\s/.test(trimmed)) return 'code'
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return 'code'
  return 'text'
}

function titleFromText (text, type) {
  const firstLine = String(text || '').split(/\r?\n/).find(Boolean) || ''
  if (type === 'code') {
    if (firstLine.trim().startsWith('{')) return 'JSON 配置片段'
    return firstLine.slice(0, 32) || '代码片段'
  }
  return firstLine.slice(0, 32) || '文本剪贴板'
}

function normalizeItem (item) {
  const type = item.type || 'text'
  return {
    id: item.id || uid(),
    type,
    title: item.title || titleFromText(item.content || item.preview, type),
    preview: item.preview || String(item.content || '').slice(0, 140),
    content: item.content || '',
    files: Array.isArray(item.files) ? item.files : [],
    source: item.source || '剪贴板',
    size: item.size || byteSize(item.content || item.preview || ''),
    createdAt: item.createdAt || now(),
    favorite: Boolean(item.favorite),
    favoriteGroup: item.favoriteGroup || '',
    signature: item.signature || `${type}:${hash(item.content || item.preview || (Array.isArray(item.files) ? item.files.join('|') : ''))}`
  }
}

function decodeNullSeparatedBuffer (buffer, encoding) {
  return Buffer.from(buffer || [])
    .toString(encoding)
    .replace(/\0+$/g, '')
    .split('\0')
    .map(file => file.trim())
    .filter(Boolean)
}

function fileUriToPath (uri) {
  try {
    const value = String(uri || '').trim()
    if (!value || !value.startsWith('file://')) return ''
    const url = new URL(value)
    let filePath = decodeURIComponent(url.pathname)
    if (process.platform === 'win32') {
      if (url.hostname) filePath = `\\\\${url.hostname}${filePath}`
      if (/^\/[a-zA-Z]:/.test(filePath)) filePath = filePath.slice(1)
      filePath = filePath.replace(/\//g, '\\')
    }
    return filePath
  } catch (error) {
    return ''
  }
}

function parseUriList (text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line !== 'copy' && line !== 'cut')
    .map(fileUriToPath)
    .filter(Boolean)
}

function uniqueExistingFiles (files) {
  return Array.from(new Set((files || [])
    .map(file => String(file || '').trim())
    .filter(file => file && path.isAbsolute(file))
    .filter(file => {
      try {
        return fs.existsSync(file)
      } catch (error) {
        return false
      }
    })))
}

function readClipboardFiles (formats) {
  if (!clipboard) return []
  const files = []
  const hasFormat = format => formats.includes(format) || (clipboard.has && clipboard.has(format))

  try {
    if (hasFormat('FileNameW')) files.push(...decodeNullSeparatedBuffer(clipboard.readBuffer('FileNameW'), 'utf16le'))
    if (hasFormat('FileName')) files.push(...decodeNullSeparatedBuffer(clipboard.readBuffer('FileName'), 'utf8'))
  } catch (error) {}

  for (const format of ['text/uri-list', 'x-special/gnome-copied-files']) {
    try {
      if (hasFormat(format)) files.push(...parseUriList(clipboard.read(format)))
    } catch (error) {}
  }

  return uniqueExistingFiles(files)
}

function getWorkAreaForBounds (bounds) {
  const utools = safeUtools()
  try {
    const display = (utools && bounds && utools.getDisplayMatching && utools.getDisplayMatching(bounds)) ||
      (utools && utools.getPrimaryDisplay && utools.getPrimaryDisplay())
    if (display && display.workArea) return display.workArea
  } catch (error) {}
  return { x: 0, y: 0, width: 1280, height: 800 }
}

function normalizeDockState (state, base = {}) {
  const next = {
    ...base,
    ...(state || {})
  }
  return {
    ...next,
    mode: ['floating', 'expanded', 'rail'].includes(next.mode) ? next.mode : 'expanded',
    side: next.side === 'right' ? 'right' : 'left',
    pinned: Boolean(next.pinned)
  }
}

function calculateDockBounds (state, currentBounds) {
  const safeState = normalizeDockState(state, sidebarDockState)
  const workArea = getWorkAreaForBounds(currentBounds)
  const expandedHeight = Math.min(DOCK_SIZE.maxHeight, Math.max(DOCK_SIZE.minHeight, workArea.height - 80))
  const railHeight = Math.min(DOCK_SIZE.railHeight, Math.max(120, workArea.height - 80))
  const sideX = safeState.side === 'right'
    ? workArea.x + workArea.width - DOCK_SIZE.width
    : workArea.x
  const railX = safeState.side === 'right'
    ? workArea.x + workArea.width - DOCK_SIZE.railWidth
    : workArea.x
  const requestedY = Number.isFinite(safeState.y) ? safeState.y : currentBounds?.y || workArea.y + 40

  if (safeState.mode === 'rail') {
    return {
      x: railX,
      y: clamp(requestedY, workArea.y + DOCK_SIZE.edgePadding, workArea.y + workArea.height - railHeight - DOCK_SIZE.edgePadding),
      width: DOCK_SIZE.railWidth,
      height: railHeight
    }
  }

  if (safeState.mode === 'floating') {
    const requestedX = Number.isFinite(safeState.x) ? safeState.x : currentBounds?.x || sideX
    return {
      x: clamp(requestedX, workArea.x + DOCK_SIZE.edgePadding, workArea.x + workArea.width - DOCK_SIZE.width - DOCK_SIZE.edgePadding),
      y: clamp(requestedY, workArea.y + DOCK_SIZE.edgePadding, workArea.y + workArea.height - expandedHeight - DOCK_SIZE.edgePadding),
      width: DOCK_SIZE.width,
      height: expandedHeight
    }
  }

  return {
    x: sideX,
    y: clamp(requestedY, workArea.y + DOCK_SIZE.edgePadding, workArea.y + workArea.height - expandedHeight - DOCK_SIZE.edgePadding),
    width: DOCK_SIZE.width,
    height: expandedHeight
  }
}

function postDockStateToSidebar () {
  if (!ipcRenderer || !sidebarWindow || sidebarWindow.isDestroyed?.()) return
  try {
    ipcRenderer.sendTo(sidebarWindow.webContents.id, SIDEBAR_INIT_CHANNEL, {
      windowId: sidebarWindow.webContents.id,
      state: sidebarDockState,
      ...buildHistoryPayload()
    })
  } catch (error) {}
}

function clearSidebarInitTimers () {
  sidebarInitTimers.forEach(timer => clearTimeout(timer))
  sidebarInitTimers = []
}

function scheduleSidebarDockInit () {
  if (!sidebarWindow || sidebarWindow.isDestroyed?.()) return
  clearSidebarInitTimers()
  const targetWindow = sidebarWindow
  sidebarInitTimers = SIDEBAR_INIT_RETRY_DELAYS.map(delay => setTimeout(() => {
    if (sidebarWindow !== targetWindow || targetWindow.isDestroyed?.()) return
    postDockStateToSidebar()
  }, delay))
}

function applySidebarDockState (patch) {
  if (!sidebarWindow || sidebarWindow.isDestroyed?.()) return sidebarDockState
  const nextState = normalizeDockState(patch, sidebarDockState)
  const bounds = calculateDockBounds(nextState, sidebarWindow.getBounds?.())
  sidebarDockState = { ...nextState, ...bounds }
  sidebarWindow.setResizable?.(nextState.mode === 'floating')
  sidebarWindow.setBounds?.(bounds)
  sidebarWindow.moveTop?.()
  postDockStateToSidebar()
  return sidebarDockState
}

function stateFromDraggedBounds (bounds) {
  const workArea = getWorkAreaForBounds(bounds)
  const nearLeft = bounds.x <= workArea.x + DOCK_SIZE.edgeThreshold
  const nearRight = bounds.x + bounds.width >= workArea.x + workArea.width - DOCK_SIZE.edgeThreshold
  if (nearLeft || nearRight) {
    return {
      mode: 'rail',
      side: nearRight ? 'right' : 'left',
      pinned: false,
      y: bounds.y
    }
  }
  return {
    mode: 'floating',
    side: bounds.x + bounds.width / 2 > workArea.x + workArea.width / 2 ? 'right' : 'left',
    pinned: true,
    x: bounds.x,
    y: bounds.y
  }
}

function bindSidebarDockChannel (win) {
  if (!ipcRenderer || !win?.webContents?.id) return
  const windowId = win.webContents.id
  const channel = `${SIDEBAR_COMMAND_PREFIX}${windowId}`
  const handler = (event, command = {}) => {
    if (!sidebarWindow || sidebarWindow.isDestroyed?.()) return
    if (command.type === 'state') {
      applySidebarDockState(command.state)
      return
    }
    if (command.type === 'drag-start') {
      const bounds = sidebarWindow.getBounds()
      sidebarDrag = {
        offsetX: Number(command.screenX) - bounds.x,
        offsetY: Number(command.screenY) - bounds.y
      }
      applySidebarDockState({ mode: 'floating', pinned: true, x: bounds.x, y: bounds.y })
      return
    }
    if (command.type === 'drag-move' && sidebarDrag) {
      const current = sidebarWindow.getBounds()
      const workArea = getWorkAreaForBounds(current)
      const nextBounds = {
        x: clamp(Number(command.screenX) - sidebarDrag.offsetX, workArea.x, workArea.x + workArea.width - current.width),
        y: clamp(Number(command.screenY) - sidebarDrag.offsetY, workArea.y, workArea.y + workArea.height - current.height),
        width: current.width,
        height: current.height
      }
      sidebarDockState = { ...sidebarDockState, mode: 'floating', x: nextBounds.x, y: nextBounds.y }
      sidebarWindow.setBounds?.(nextBounds)
      return
    }
    if (command.type === 'drag-end') {
      sidebarDrag = null
      applySidebarDockState(stateFromDraggedBounds(sidebarWindow.getBounds()))
    }
  }
  ipcRenderer.on(channel, handler)
  const scheduleInit = () => scheduleSidebarDockInit()
  win.webContents?.on?.('dom-ready', scheduleInit)
  win.webContents?.on?.('did-finish-load', scheduleInit)
  win.webContents?.on?.('did-navigate', scheduleInit)
  win.on?.('closed', () => {
    clearSidebarInitTimers()
    ipcRenderer.off?.(channel, handler)
    win.webContents?.off?.('dom-ready', scheduleInit)
    win.webContents?.off?.('did-finish-load', scheduleInit)
    win.webContents?.off?.('did-navigate', scheduleInit)
    if (sidebarWindow === win) sidebarWindow = null
  })
}

function notifyDockListeners () {
  dockListeners.forEach(listener => {
    try {
      listener(dockState)
    } catch (error) {}
  })
}

if (ipcRenderer) {
  ipcRenderer.on(SIDEBAR_INIT_CHANNEL, (event, config = {}) => {
    dockParentId = event.senderId
    dockWindowId = config.windowId
    dockState = normalizeDockState(config.state, dockState)
    if (!hasDbStorage()) {
      remoteHistory = Array.isArray(config.history) ? config.history : remoteHistory
      remoteGroups = Array.isArray(config.groups) && config.groups.length ? config.groups : remoteGroups
      notifyHistoryListeners()
    }
    notifyDockListeners()
    if (pendingDockCommand && dockParentId && dockWindowId) {
      const command = pendingDockCommand
      pendingDockCommand = null
      setTimeout(() => sendDockCommand(command), 0)
    }
  })
}

function sendDockCommand (command) {
  if (ipcRenderer && dockParentId && dockWindowId) {
    pendingDockCommand = null
    ipcRenderer.sendTo(dockParentId, `${SIDEBAR_COMMAND_PREFIX}${dockWindowId}`, command)
    return true
  }
  if (command.type === 'state') {
    pendingDockCommand = command
    dockState = normalizeDockState(command.state, dockState)
    notifyDockListeners()
    return true
  }
  if (command.type === 'drag-start') {
    dockState = normalizeDockState({ ...dockState, mode: 'floating', pinned: true }, dockState)
    notifyDockListeners()
    return true
  }
  return false
}

function getHistory () {
  return (dbGet(HISTORY_KEY, []) || []).map(normalizeItem)
}

function getGroups () {
  const groups = dbGet(GROUPS_KEY, ['常用'])
  return Array.isArray(groups) && groups.length ? groups : ['常用']
}

function buildHistoryPayload () {
  return {
    history: getHistory(),
    groups: getGroups()
  }
}

function notifyHistoryListeners () {
  const payload = {
    history: getHistory(),
    groups: getGroups()
  }
  historyListeners.forEach(listener => {
    try {
      listener(payload)
    } catch (error) {}
  })
}

function notifyHistoryChanged () {
  notifyHistoryListeners()
  postDockStateToSidebar()
}

function saveHistory (items) {
  dbSet(HISTORY_KEY, (items || []).map(normalizeItem).slice(0, MAX_HISTORY))
  notifyHistoryChanged()
}

function addHistory (item) {
  const normalized = normalizeItem(item)
  const list = getHistory().filter(existing => existing.signature !== normalized.signature)
  list.unshift(normalized)
  saveHistory(list)
  return normalized
}

function saveGroups (groups) {
  const cleaned = Array.from(new Set((groups || []).map(group => String(group).trim()).filter(Boolean)))
  dbSet(GROUPS_KEY, cleaned.length ? cleaned : ['常用'])
  notifyHistoryChanged()
}

function captureClipboard () {
  if (!clipboard) return null
  const formats = clipboard.availableFormats() || []
  const files = readClipboardFiles(formats)
  if (files.length) {
    const signature = `file:${hash(files.join('\n'))}`
    if (signature === lastSignature) return null
    lastSignature = signature
    return addHistory({
      type: 'file',
      title: files.length > 1 ? '文件组' : path.basename(files[0]),
      preview: files.map(file => path.basename(file)).join(' / '),
      files,
      source: '剪贴板',
      size: `${files.length} 个文件`,
      signature
    })
  }

  const text = clipboard.readText()
  if (text) {
    const type = inferTextType(text)
    const signature = `${type}:${hash(text)}`
    if (signature === lastSignature) return null
    lastSignature = signature
    return addHistory({
      type,
      title: titleFromText(text, type),
      preview: text.slice(0, 160),
      content: text,
      source: '剪贴板',
      size: byteSize(text),
      signature
    })
  }

  const image = clipboard.readImage()
  if (image && !image.isEmpty()) {
    const dataUrl = image.toDataURL()
    const signature = `image:${hash(dataUrl.slice(0, 2048))}`
    if (signature === lastSignature) return null
    lastSignature = signature
    return addHistory({
      type: 'image',
      title: '剪贴板图片',
      preview: formats.join(', ') || '图片',
      content: dataUrl,
      source: '剪贴板',
      size: byteSize(dataUrl),
      signature
    })
  }
  return null
}

function writeItemToClipboard (item) {
  if (!clipboard || !item) return false
  if (item.type === 'image' && item.content && nativeImage) {
    clipboard.writeImage(nativeImage.createFromDataURL(item.content))
    return true
  }
  if (item.type === 'file' && item.files && item.files.length) {
    clipboard.writeText(item.files.join('\n'))
    return true
  }
  clipboard.writeText(String(item.content || item.preview || ''))
  return true
}

function pasteItem (item) {
  const utools = safeUtools()
  if (!item) return false
  try {
    if (utools && item.type === 'text') {
      utools.hideMainWindowPasteText(String(item.content || item.preview || ''))
      return true
    }
    if (utools && item.type === 'code') {
      utools.hideMainWindowPasteText(String(item.content || item.preview || ''))
      return true
    }
    if (utools && item.type === 'image' && item.content) {
      utools.hideMainWindowPasteImage(item.content)
      return true
    }
    if (utools && item.type === 'file' && item.files && item.files.length) {
      utools.hideMainWindowPasteFile(item.files)
      return true
    }
  } catch (error) {}
  writeItemToClipboard(item)
  return true
}

function getIndexUrl (query) {
  const utools = safeUtools()
  if (utools && utools.isDev && utools.isDev()) return `http://localhost:5173/${query}`
  return `index.html${query}`
}

function getSidebarWindowUrl () {
  return 'sidebar.html'
}

function isSidebarWindowOpen () {
  return Boolean(sidebarWindow && !sidebarWindow.isDestroyed?.())
}

function isFallbackSidebarWindowOpen () {
  return Boolean(fallbackSidebarWindow && !fallbackSidebarWindow.closed)
}

function closeSidebarWindow () {
  if (!isSidebarWindowOpen()) {
    sidebarWindow = null
    return false
  }

  const win = sidebarWindow
  sidebarWindow = null
  sidebarDrag = null
  clearSidebarInitTimers()

  try {
    if (win.close) win.close()
    else if (win.destroy) win.destroy()
    else win.hide?.()
    return true
  } catch (error) {
    return false
  }
}

function closeFallbackSidebarWindow () {
  if (!isFallbackSidebarWindowOpen()) {
    fallbackSidebarWindow = null
    return false
  }

  try {
    fallbackSidebarWindow.close()
    fallbackSidebarWindow = null
    return true
  } catch (error) {
    return false
  }
}

function fallbackOpenSidebarWindow () {
  try {
    if (isFallbackSidebarWindowOpen()) {
      fallbackSidebarWindow.focus?.()
      return {
        ok: true,
        open: true,
        message: '侧栏已打开。'
      }
    }
    fallbackSidebarWindow = window.open(getIndexUrl('?view=sidebar'), '_blank', 'width=336,height=720')
    return {
      ok: Boolean(fallbackSidebarWindow),
      open: Boolean(fallbackSidebarWindow),
      message: '已用备用窗口打开侧栏。'
    }
  } catch (error) {
    return {
      ok: false,
      open: false,
      message: `侧栏打开失败：${error.message || error}`
    }
  }
}

function fallbackToggleSidebarWindow () {
  if (isFallbackSidebarWindowOpen()) {
    const closed = closeFallbackSidebarWindow()
    return {
      ok: closed,
      open: false,
      message: closed ? '侧栏已关闭。' : '侧栏关闭失败。'
    }
  }
  return fallbackOpenSidebarWindow()
}

window.services = {
  captureEnter (action) {
    if (!action) return null
    if (action.type === 'over' || action.type === 'regex') {
      const text = String(action.payload || '').trim()
      if (!text) return null
      return addHistory({
        type: inferTextType(text),
        content: text,
        preview: text.slice(0, 160),
        source: action.from || 'uTools'
      })
    }
    if (action.type === 'img') {
      return addHistory({
        type: 'image',
        title: '超级面板图片',
        preview: '来自 uTools 超级面板',
        content: action.payload,
        source: '超级面板'
      })
    }
    if (action.type === 'files') {
      const files = (action.payload || []).map(file => file.path).filter(Boolean)
      return addHistory({
        type: 'file',
        title: files.length > 1 ? '文件组' : path.basename(files[0] || '文件'),
        preview: files.map(file => path.basename(file)).join(' / '),
        files,
        source: '超级面板',
        size: `${files.length} 个文件`
      })
    }
    return null
  },
  history: {
    getAll: getHistory,
    saveAll: saveHistory,
    add: addHistory,
    onChange (callback) {
      if (typeof callback !== 'function') return () => {}
      historyListeners.add(callback)
      return () => historyListeners.delete(callback)
    },
    clear () {
      dbSet(HISTORY_KEY, [])
      notifyHistoryChanged()
    }
  },
  groups: {
    getAll: getGroups,
    saveAll: saveGroups
  },
  settings: {
    get () {
      return dbGet(SETTINGS_KEY, {})
    },
    set (settings) {
      dbSet(SETTINGS_KEY, settings || {})
    }
  },
  watch: {
    start (callback, interval = 1000) {
      if (watchTimer || !clipboard) return false
      const currentText = clipboard.readText()
      lastSignature = currentText ? `text:${hash(currentText)}` : ''
      watchTimer = setInterval(() => {
        const item = captureClipboard()
        if (item && typeof callback === 'function') callback(item)
      }, interval)
      return true
    },
    stop () {
      if (watchTimer) clearInterval(watchTimer)
      watchTimer = null
    }
  },
  clipboard: {
    copyItem: writeItemToClipboard,
    pasteItem
  },
  dock: {
    getState () {
      return dockState
    },
    onState (callback) {
      if (typeof callback !== 'function') return () => {}
      dockListeners.add(callback)
      callback(dockState)
      return () => dockListeners.delete(callback)
    },
    setState (state) {
      return sendDockCommand({ type: 'state', state })
    },
    startDrag (point) {
      return sendDockCommand({ type: 'drag-start', ...point })
    },
    moveDrag (point) {
      return sendDockCommand({ type: 'drag-move', ...point })
    },
    endDrag (point) {
      return sendDockCommand({ type: 'drag-end', ...point })
    }
  },
  window: {
    isSidebarOpen () {
      return isSidebarWindowOpen() || isFallbackSidebarWindowOpen()
    },
    closeSidebar () {
      const closed = closeSidebarWindow() || closeFallbackSidebarWindow()
      return {
        ok: closed,
        open: false,
        message: closed ? '侧栏已关闭。' : '侧栏未打开。'
      }
    },
    toggleSidebar () {
      const utools = safeUtools()
      if (!utools || !utools.createBrowserWindow) return fallbackToggleSidebarWindow()
      if (isSidebarWindowOpen()) {
        const closed = closeSidebarWindow()
        return {
          ok: closed,
          open: false,
          message: closed ? '侧栏已关闭。' : '侧栏关闭失败。'
        }
      }
      return window.services.window.openSidebar()
    },
    openSidebar () {
      try {
        const utools = safeUtools()
        if (!utools || !utools.createBrowserWindow) return fallbackOpenSidebarWindow()
        if (isSidebarWindowOpen()) {
          applySidebarDockState({ mode: 'rail', pinned: false })
          sidebarWindow.show?.()
          sidebarWindow.focus?.()
          return {
            ok: true,
            open: true,
            message: `侧栏已吸附到屏幕${sidebarDockState.side === 'right' ? '右侧' : '左侧'}，悬浮窄条展开。`
          }
        }
        const display = utools.getPrimaryDisplay ? utools.getPrimaryDisplay() : null
        const workArea = display ? display.workArea : { x: 0, y: 0, width: 1280, height: 800 }
        const initialBounds = calculateDockBounds(sidebarDockState, workArea)
        sidebarWindow = utools.createBrowserWindow(getSidebarWindowUrl(), {
          title: '剪贴板侧栏',
          x: initialBounds.x,
          y: initialBounds.y,
          width: initialBounds.width,
          height: initialBounds.height,
          show: true,
          frame: false,
          transparent: false,
          resizable: false,
          movable: true,
          minimizable: false,
          maximizable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          hasShadow: true,
          webPreferences: {
            preload: 'preload/services.js',
            devTools: Boolean(utools.isDev && utools.isDev())
          }
        }, () => {
          bindSidebarDockChannel(sidebarWindow)
          applySidebarDockState(sidebarDockState)
          sidebarWindow.show()
          sidebarWindow.focus?.()
          scheduleSidebarDockInit()
        })
        return {
          ok: true,
          open: true,
          message: `正在吸附到屏幕${sidebarDockState.side === 'right' ? '右侧' : '左侧'}，悬浮窄条展开。`
        }
      } catch (error) {
        console.error('[clipdock] openSidebar failed', error)
        return {
          ok: false,
          open: false,
          message: `侧栏打开失败：${error.message || error}`
        }
      }
    }
  }
}
