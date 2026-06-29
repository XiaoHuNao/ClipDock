const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')

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
const SYNC_DOC_PREFIX = 'clipdock:history:'
const SYNC_ATTACHMENT_PREFIX = 'clipdock:attachment:'
const SYNC_GROUPS_DOC_ID = 'clipdock:groups'
const SYNC_META_DOC_ID = 'clipdock:sync-meta'
const SYNC_TEST_DOC_PREFIX = 'clipdock:sync-test:'
const MAX_HISTORY = 500
const SIDEBAR_INIT_CHANNEL = 'clipboard-sidebar-init'
const SIDEBAR_COMMAND_PREFIX = 'clipboard-sidebar-command-'
const SIDEBAR_INIT_RETRY_DELAYS = [0, 80, 180, 360, 700, 1200, 2000]
const DOCK_SIZE = {
  width: 336,
  minHeight: 480,
  maxHeight: 720,
  railWidth: 38,
  railHeight: 164,
  edgeThreshold: 72,
  edgePadding: 12
}
const IMAGE_CLIPBOARD_FORMATS = [
  'image/gif',
  'image/webp',
  'image/apng',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/pjpeg',
  'image/bmp',
  'image/x-bmp',
  'image/x-ms-bmp',
  'image/dib',
  'image/x-dib',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/tiff'
]
const RAW_IMAGE_WRITE_FORMATS = ['image/gif', 'image/webp', 'image/apng', 'image/avif', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']
const BITMAP_IMAGE_CLIPBOARD_FORMATS = IMAGE_CLIPBOARD_FORMATS.filter(mime => !RAW_IMAGE_WRITE_FORMATS.includes(mime))
const IMAGE_FILE_MIME_BY_EXT = {
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.heics': 'image/heic-sequence',
  '.heifs': 'image/heif-sequence',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.dib': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.svgz': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}
const IMAGE_EXT_BY_MIME = {
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/apng': '.apng',
  'image/avif': '.avif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/heic-sequence': '.heic',
  'image/heif-sequence': '.heif',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/bmp': '.bmp',
  'image/x-bmp': '.bmp',
  'image/x-ms-bmp': '.bmp',
  'image/dib': '.bmp',
  'image/x-dib': '.bmp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/tiff': '.tiff'
}

let watchTimer = null
let lastSignature = ''
let watchCallback = null
let watchSubscribers = 0
let watchInterval = 1000
let watchErrorCount = 0
let watchStartedAt = 0
let watchLastTickAt = 0
let watchLastCaptureAt = 0
let watchLastError = ''
let winClipboardFallbackOk = false
let winClipboardFallbackError = ''
let winClipboardFallbackLastReadAt = 0
let winClipboardFallbackLastText = ''
let winClipboardFallbackLastSnapshot = null
let winClipboardFallbackLastTypes = []
let dbPullListenerBound = false
let dbPullInProgress = false
let lastSyncPushAt = 0
let lastSyncPullAt = 0
let lastDbPullAt = 0
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
const skipNextSignatures = []
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

function hasCloudDb () {
  const utools = safeUtools()
  return Boolean(utools && utools.db)
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

function skipCapturedSignature (signature) {
  if (!signature || skipNextSignatures.includes(signature)) return
  skipNextSignatures.push(signature)
  while (skipNextSignatures.length > 20) skipNextSignatures.shift()
}

function shouldSkipCapturedSignature (signature) {
  const index = skipNextSignatures.indexOf(signature)
  const shouldSkip = index >= 0
  if (shouldSkip) skipNextSignatures.splice(index, 1)
  if (shouldSkip) lastSignature = signature
  return shouldSkip
}

function clamp (value, min, max) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function byteSize (text) {
  return formatByteSize(Buffer.byteLength(String(text || ''), 'utf8'))
}

function formatByteSize (bytes) {
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

function isUrlText (text) {
  return /^https?:\/\/\S+$/i.test(String(text || '').trim())
}

function titleFromText (text, type) {
  const firstLine = String(text || '').split(/\r?\n/).find(line => line.trim()) || ''
  const title = firstLine.trim().slice(0, 32)
  if (type === 'code') return title || '代码片段'
  return title || '文本剪贴板'
}

function stripHtml (html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function titleFromUrl (url, fallback = '网页链接') {
  try {
    const parsed = new URL(String(url || '').trim())
    return parsed.hostname || fallback
  } catch (error) {
    return fallback
  }
}

function titleFromHtml (html) {
  try {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (match && match[1].trim()) return stripHtml(match[1]).slice(0, 32)
  } catch (error) {}
  return titleFromText(stripHtml(html), 'text')
}

function titleFromRtf (rtf) {
  const text = String(rtf || '')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\[a-z]+\d* ?/gi, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return titleFromText(text, 'text')
}

function parseDataUrl (value) {
  const match = String(value || '').match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i)
  if (!match) return null
  try {
    return {
      mime: match[1].toLowerCase(),
      buffer: Buffer.from(decodeURIComponent(match[3]), match[2] ? 'base64' : 'utf8')
    }
  } catch (error) {
    return null
  }
}

function dataUrlFromBuffer (mime, buffer) {
  return `data:${mime};base64,${Buffer.from(buffer || []).toString('base64')}`
}

function imageMimeFromPath (file) {
  return IMAGE_FILE_MIME_BY_EXT[path.extname(String(file || '')).toLowerCase()] || ''
}

function imageExtFromMime (mime) {
  return IMAGE_EXT_BY_MIME[String(mime || '').toLowerCase()] || '.png'
}

function safeFileName (name, fallback = 'clipdock-image') {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
  return (cleaned || fallback).slice(0, 120)
}

function uniqueTargetPath (file) {
  if (!fs.existsSync(file)) return file
  const dir = path.dirname(file)
  const ext = path.extname(file)
  const base = path.basename(file, ext)
  for (let index = 1; index < 1000; index += 1) {
    const next = path.join(dir, `${base}-${index}${ext}`)
    if (!fs.existsSync(next)) return next
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`)
}

function normalizeSettings (settings) {
  const rawTombstoneDays = Number(settings?.syncTombstoneDays || 90)
  const syncTombstoneDays = Number.isFinite(rawTombstoneDays)
    ? Math.max(7, Math.min(365, rawTombstoneDays))
    : 90
  return {
    imageSaveDir: '',
    syncEnabled: false,
    syncHistory: true,
    syncFavorites: true,
    syncImages: false,
    syncFiles: true,
    ...(settings || {}),
    syncTombstoneDays
  }
}

function hasSyncSettingsChanged (previous, next) {
  return ['syncHistory', 'syncFavorites', 'syncImages', 'syncFiles'].some(key => Boolean(previous[key]) !== Boolean(next[key]))
}

function imageDataFromDataUrl (content) {
  const parsed = parseDataUrl(content)
  if (!parsed || !IMAGE_CLIPBOARD_FORMATS.includes(parsed.mime)) return null
  return {
    mime: parsed.mime,
    content,
    size: formatByteSize(parsed.buffer.length)
  }
}

function imageTitleFromMime (mime) {
  if (mime === 'image/gif') return 'GIF 动图'
  if (mime === 'image/webp') return 'WEBP 图片'
  if (mime === 'image/avif') return 'AVIF 图片'
  if (mime === 'image/svg+xml') return 'SVG 图片'
  if (mime === 'image/tiff') return 'TIFF 图片'
  if (mime === 'image/x-icon') return 'ICO 图标'
  return '剪贴板图片'
}

function imagePreviewFromMime (mime, fallback = '图片') {
  if (mime === 'image/gif') return 'GIF 动图'
  if (mime === 'image/webp') return 'WEBP 图片'
  if (mime === 'image/avif') return 'AVIF 图片'
  if (mime === 'image/svg+xml') return 'SVG 图片'
  if (mime === 'image/tiff') return 'TIFF 图片'
  if (mime === 'image/x-icon') return 'ICO 图标'
  return mime || fallback
}

function imageSignature (mime, content) {
  return `image:${mime || 'bitmap'}:${hash(content)}`
}

function shouldUseImageFileTitle (title, mime) {
  const value = String(title || '').trim()
  return !value || value === '文件组' || value === '剪贴板图片' || value === imageTitleFromMime(mime)
}

function normalizeItem (item) {
  const type = item.type || 'text'
  if (type === 'file' && Array.isArray(item.files) && item.files.length) {
    const files = uniqueExistingFiles(item.files)
    if (files.length === 1) {
      const imageFile = readImageFileData(files[0])
      if (imageFile) {
        return {
          id: item.id || uid(),
          type: 'image',
          title: shouldUseImageFileTitle(item.title, imageFile.mime) ? imageFile.title : item.title,
          preview: imageFile.preview,
          content: imageFile.content,
          files: [],
          filePath: imageFile.filePath,
          fileUrl: imageFile.fileUrl,
          mime: imageFile.mime,
          animated: imageFile.mime === 'image/gif',
          attachmentId: item.attachmentId || '',
          hasSyncedAttachment: Boolean(item.hasSyncedAttachment),
          unsyncedContent: Boolean(item.unsyncedContent),
          source: item.source || '剪贴板',
          size: imageFile.size,
          createdAt: item.createdAt || now(),
          updatedAt: item.updatedAt || item.createdAt || now(),
          favorite: Boolean(item.favorite),
          favoriteGroup: item.favoriteGroup || '',
          favoriteAt: item.favoriteAt || (item.favorite ? item.createdAt || now() : 0),
          favoriteUpdatedAt: item.favoriteUpdatedAt || (item.favorite ? item.favoriteAt || item.updatedAt || item.createdAt || now() : 0),
          favoriteOnly: Boolean(item.favoriteOnly),
          signature: imageSignature(imageFile.mime, imageFile.content)
        }
      }
    }
  }

  const dataUrl = parseDataUrl(item.content)
  const mime = item.mime || (type === 'image' && dataUrl ? dataUrl.mime : '')
  const content = item.content || ''
  const preview = item.preview ||
    (type === 'rich'
      ? stripHtml(content).slice(0, 140)
      : type === 'image'
        ? imagePreviewFromMime(mime)
        : String(content).slice(0, 140))
  return {
    id: item.id || uid(),
    type,
    title: item.title || (type === 'image' ? imageTitleFromMime(mime) : titleFromText(content || preview, type)),
    preview,
    content,
    html: item.html || (type === 'rich' ? content : ''),
    rtf: item.rtf || '',
    url: item.url || (type === 'url' ? content : ''),
    files: Array.isArray(item.files) ? item.files : [],
    filePath: item.filePath || '',
    fileUrl: item.fileUrl || '',
    mime,
    animated: Boolean(item.animated || mime === 'image/gif'),
    attachmentId: item.attachmentId || '',
    hasSyncedAttachment: Boolean(item.hasSyncedAttachment),
    unsyncedContent: Boolean(item.unsyncedContent),
    source: item.source || '剪贴板',
    size: item.size || byteSize(item.content || item.preview || ''),
    createdAt: item.createdAt || now(),
    updatedAt: item.updatedAt || item.createdAt || now(),
    favorite: Boolean(item.favorite),
    favoriteGroup: item.favoriteGroup || '',
    favoriteAt: item.favoriteAt || (item.favorite ? item.createdAt || now() : 0),
    favoriteUpdatedAt: item.favoriteUpdatedAt || (item.favorite ? item.favoriteAt || item.updatedAt || item.createdAt || now() : 0),
    favoriteOnly: Boolean(item.favoriteOnly),
    signature: item.signature || `${type}:${hash(content || preview || item.url || item.html || item.rtf || (Array.isArray(item.files) ? item.files.join('|') : ''))}`
  }
}

function syncDocIdForSignature (signature) {
  return `${SYNC_DOC_PREFIX}${hash(signature || uid())}`
}

function syncAttachmentIdForSignature (signature) {
  return `${SYNC_ATTACHMENT_PREFIX}${hash(signature || uid())}`
}

function syncDocPayload (item, settings = normalizeSettings(dbGet(SETTINGS_KEY, {})), options = {}) {
  const normalized = normalizeItem(item)
  const payload = { ...normalized }

  if (options.favoriteOnlyMarker) {
    return {
      ...payload,
      title: '收藏状态变更',
      preview: '',
      content: '',
      html: '',
      rtf: '',
      url: '',
      files: [],
      filePath: '',
      fileUrl: '',
      source: '同步',
      size: '',
      favoriteOnly: true,
      unsyncedContent: true
    }
  }

  if (payload.type === 'image') {
    const imageContent = payload.content
    payload.attachmentId = settings.syncImages && (imageContent || payload.attachmentId) ? syncAttachmentIdForSignature(payload.signature) : payload.attachmentId || ''
    payload.hasSyncedAttachment = Boolean(settings.syncImages && payload.hasSyncedAttachment && payload.attachmentId)
    if (settings.syncImages && payload.content) {
      payload.content = ''
      payload.fileUrl = ''
      payload.unsyncedContent = true
    }
  }

  if (!settings.syncFavorites) {
    payload.favorite = false
    payload.favoriteGroup = ''
    payload.favoriteAt = 0
    payload.favoriteUpdatedAt = 0
  }

  if (!settings.syncImages && payload.type === 'image') {
    payload.content = ''
    payload.fileUrl = ''
    payload.preview = payload.preview || imagePreviewFromMime(payload.mime)
    payload.unsyncedContent = true
  }

  if (!settings.syncFiles && payload.type === 'file') {
    payload.files = []
    payload.filePath = ''
    payload.fileUrl = ''
    payload.unsyncedContent = true
  }

  return payload
}

function mergeHistoryItems (localItems, remoteItems, tombstones = []) {
  const merged = new Map()
  const deletedAtBySignature = new Map()

  for (const tombstone of tombstones || []) {
    const signature = tombstone.signature || tombstone.item?.signature
    if (!signature) continue
    deletedAtBySignature.set(signature, Math.max(
      Number(deletedAtBySignature.get(signature) || 0),
      Number(tombstone.deletedAt || tombstone.updatedAt || 0)
    ))
  }

  for (const rawItem of [...(remoteItems || []), ...(localItems || [])]) {
    const item = normalizeItem(rawItem)
    const key = item.signature || item.id
    const deletedAt = Number(deletedAtBySignature.get(key) || 0)
    if (deletedAt && deletedAt >= Number(item.updatedAt || item.createdAt || 0)) continue
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, item)
      continue
    }

    const existingUpdatedAt = Number(existing.updatedAt || existing.createdAt || 0)
    const itemUpdatedAt = Number(item.updatedAt || item.createdAt || 0)
    const existingFavoriteStateAt = Number(existing.favoriteUpdatedAt || (existing.favorite ? existing.favoriteAt || 0 : 0))
    const itemFavoriteStateAt = Number(item.favoriteUpdatedAt || (item.favorite ? item.favoriteAt || 0 : 0))
    const favoriteSource = itemFavoriteStateAt > existingFavoriteStateAt
      ? item
      : itemFavoriteStateAt < existingFavoriteStateAt
        ? existing
        : item.favorite && !existing.favorite
          ? item
          : existing

    merged.set(key, {
      ...existing,
      ...item,
      favorite: Boolean(favoriteSource.favorite),
      favoriteGroup: favoriteSource.favorite ? favoriteSource.favoriteGroup || existing.favoriteGroup || item.favoriteGroup || '' : '',
      favoriteAt: favoriteSource.favorite ? Number(favoriteSource.favoriteAt || 0) : 0,
      favoriteUpdatedAt: Number(favoriteSource.favoriteUpdatedAt || 0),
      createdAt: Math.max(Number(existing.createdAt || 0), Number(item.createdAt || 0)),
      updatedAt: Math.max(existingUpdatedAt, itemUpdatedAt),
      content: item.content || existing.content,
      files: item.files?.length ? item.files : existing.files,
      filePath: item.filePath || existing.filePath,
      fileUrl: item.fileUrl || existing.fileUrl,
      attachmentId: item.attachmentId || existing.attachmentId,
      hasSyncedAttachment: Boolean(existing.hasSyncedAttachment || item.hasSyncedAttachment),
      unsyncedContent: Boolean((existing.unsyncedContent && !existing.content) || (item.unsyncedContent && !item.content))
    })
  }

  return Array.from(merged.values())
    .filter(item => {
      const deletedAt = Number(deletedAtBySignature.get(item.signature) || 0)
      const removed = deletedAt && Number(item.updatedAt || item.createdAt || 0) <= deletedAt
      if (removed) return false
      return !(item.favoriteOnly && !item.favorite && !item.content && !item.html && !item.url && !item.filePath && !(item.files || []).length)
    })
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, MAX_HISTORY)
}

function readCloudDoc (id) {
  const utools = safeUtools()
  if (!utools || !utools.db) return null
  try {
    return utools.db.get(id)
  } catch (error) {
    return null
  }
}

function putCloudDoc (doc) {
  const utools = safeUtools()
  if (!utools || !utools.db) return null
  try {
    const current = readCloudDoc(doc._id)
    return utools.db.put({
      ...(current && current._rev ? { _rev: current._rev } : {}),
      ...doc,
      updatedAt: now()
    })
  } catch (error) {
    return null
  }
}

function dbResultOk (result) {
  return Boolean(result && result.ok !== false && !result.error)
}

function removeCloudDoc (idOrDoc) {
  const utools = safeUtools()
  if (!utools || !utools.db) return null
  try {
    return utools.db.remove(idOrDoc)
  } catch (error) {
    return null
  }
}

function postCloudAttachment (docId, buffer, mime) {
  const utools = safeUtools()
  if (!utools || !utools.db || !utools.db.postAttachment) return null
  try {
    return utools.db.postAttachment(docId, Uint8Array.from(buffer || []), mime || 'application/octet-stream')
  } catch (error) {
    return null
  }
}

function readCloudAttachment (docId) {
  const utools = safeUtools()
  if (!utools || !utools.db || !utools.db.getAttachment) return null
  try {
    const buffer = utools.db.getAttachment(docId)
    if (!buffer || !buffer.length) return null
    return Buffer.from(buffer)
  } catch (error) {
    return null
  }
}

function readCloudAttachmentType (docId) {
  const utools = safeUtools()
  if (!utools || !utools.db || !utools.db.getAttachmentType) return ''
  try {
    return utools.db.getAttachmentType(docId) || ''
  } catch (error) {
    return ''
  }
}

function removeCloudAttachment (docId) {
  if (!docId) return null
  return removeCloudDoc(docId)
}

function isSyncDoc (doc) {
  const id = String(doc?._id || '')
  return id.startsWith(SYNC_DOC_PREFIX) ||
    id.startsWith(SYNC_ATTACHMENT_PREFIX) ||
    id === SYNC_GROUPS_DOC_ID ||
    id === SYNC_META_DOC_ID
}

function pushImageAttachmentToCloud (item, payload, settings) {
  if (!settings.syncImages || payload.type !== 'image' || !item.content || !payload.attachmentId) return false
  const parsed = parseDataUrl(item.content)
  if (!parsed || !parsed.buffer.length) return false
  const result = postCloudAttachment(payload.attachmentId, parsed.buffer, payload.mime || parsed.mime || 'image/png')
  return dbResultOk(result)
}

function hydrateRemoteImagePayload (item, settings) {
  if (!item || item.type !== 'image') return item
  if (item.content || !settings.syncImages || !item.attachmentId) return item
  const buffer = readCloudAttachment(item.attachmentId)
  if (!buffer) return item
  const mime = item.mime || readCloudAttachmentType(item.attachmentId) || 'image/png'
  return {
    ...item,
    mime,
    content: dataUrlFromBuffer(mime, buffer),
    size: item.size || formatByteSize(buffer.length),
    unsyncedContent: false,
    hasSyncedAttachment: true
  }
}

function applyRemoteSyncSettings (item, settings) {
  let payload = { ...item }

  if (!settings.syncFavorites) {
    payload.favorite = false
    payload.favoriteGroup = ''
    payload.favoriteAt = 0
  }

  if (payload.type === 'image') {
    if (settings.syncImages) {
      payload = hydrateRemoteImagePayload(payload, settings)
    } else {
      payload.content = ''
      payload.fileUrl = ''
      payload.attachmentId = ''
      payload.hasSyncedAttachment = false
      payload.unsyncedContent = true
    }

    if (!settings.syncFiles) {
      payload.filePath = ''
      payload.fileUrl = ''
    }
  }

  if (payload.type === 'file' && !settings.syncFiles) {
    payload.files = []
    payload.filePath = ''
    payload.fileUrl = ''
    payload.unsyncedContent = true
  }

  return payload
}

function cloudReplicateState () {
  const utools = safeUtools()
  try {
    if (!utools || !utools.db || !utools.db.replicateStateFromCloud) return null
    return utools.db.replicateStateFromCloud()
  } catch (error) {
    return null
  }
}

function syncUser () {
  const utools = safeUtools()
  try {
    return utools && utools.getUser ? utools.getUser() : null
  } catch (error) {
    return null
  }
}

function syncAvailable () {
  return hasCloudDb()
}

function syncCloudReady () {
  const state = cloudReplicateState()
  return state === 0
}

function syncEnabled () {
  const settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))
  return Boolean(settings.syncEnabled && syncAvailable())
}

function shouldPushItemToCloud (item) {
  if (!item?.signature) return false
  const existing = readCloudDoc(syncDocIdForSignature(item.signature))
  if (!existing || !existing.deleted) return true
  const deletedAt = Number(existing.deletedAt || existing.updatedAt || 0)
  const updatedAt = Number(item.updatedAt || item.createdAt || 0)
  return updatedAt > deletedAt
}

function shouldPushFavoriteOnlyMarker (item) {
  if (!item?.signature || item.favorite) return false
  const existing = readCloudDoc(syncDocIdForSignature(item.signature))
  return Boolean(existing && !existing.deleted && existing.item && (existing.item.favorite || existing.item.favoriteOnly))
}

function pushHistoryToCloud (items = getHistory()) {
  if (!syncEnabled()) return { ok: false, message: '同步未开启。' }
  const settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))
  if (!settings.syncHistory && !settings.syncFavorites) return { ok: true, count: 0 }

  let count = 0
  for (const item of items || []) {
    const favoriteOnlyMarker = !settings.syncHistory && settings.syncFavorites && shouldPushFavoriteOnlyMarker(item)
    if (!settings.syncHistory && !(settings.syncFavorites && item.favorite) && !favoriteOnlyMarker) continue
    const payload = syncDocPayload(item, settings, { favoriteOnlyMarker })
    if (!shouldPushItemToCloud(payload)) continue
    const attachmentUploaded = pushImageAttachmentToCloud(item, payload, settings)
    if (payload.type === 'image' && settings.syncImages && payload.attachmentId) {
      payload.hasSyncedAttachment = attachmentUploaded || payload.hasSyncedAttachment
      payload.unsyncedContent = !payload.hasSyncedAttachment
    }
    const result = putCloudDoc({
      _id: syncDocIdForSignature(payload.signature),
      kind: 'history',
      signature: payload.signature,
      item: payload
    })
    if (result) count += 1
  }
  putCloudDoc({
    _id: SYNC_GROUPS_DOC_ID,
    kind: 'groups',
    groups: getGroups()
  })
  putCloudDoc({
    _id: SYNC_META_DOC_ID,
    kind: 'meta',
    pushedAt: now()
  })
  return { ok: true, count }
}

function pushDeletedHistoryToCloud (items) {
  if (!syncEnabled()) return { ok: false, message: '同步未开启。' }
  const deletedAt = now()
  let count = 0
  for (const rawItem of items || []) {
    const item = normalizeItem(rawItem)
    if (!item.signature) continue
    const result = putCloudDoc({
      _id: syncDocIdForSignature(item.signature),
      kind: 'history',
      signature: item.signature,
      deleted: true,
      deletedAt,
      item: {
        signature: item.signature,
        title: item.title,
        type: item.type,
        createdAt: item.createdAt,
        updatedAt: deletedAt
      }
    })
    if (result) count += 1
  }
  putCloudDoc({
    _id: SYNC_META_DOC_ID,
    kind: 'meta',
    pushedAt: deletedAt
  })
  return { ok: true, count }
}

function pruneDeletedHistoryFromCloud (settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))) {
  if (!syncEnabled()) return { ok: false, count: 0, message: '同步未开启。' }
  const utools = safeUtools()
  if (!utools || !utools.db) return { ok: false, count: 0, message: '当前环境不支持 uTools 数据同步。' }

  const cutoff = now() - Number(settings.syncTombstoneDays || 90) * 24 * 60 * 60 * 1000
  let count = 0

  try {
    const docs = utools.db.allDocs(SYNC_DOC_PREFIX) || []
    for (const doc of docs) {
      if (!doc || doc.kind !== 'history' || !doc.deleted) continue
      const deletedAt = Number(doc.deletedAt || doc.updatedAt || 0)
      if (!deletedAt || deletedAt > cutoff) continue
      const result = removeCloudDoc(doc)
      if (dbResultOk(result)) {
        if (doc.signature) removeCloudAttachment(syncAttachmentIdForSignature(doc.signature))
        count += 1
      }
    }
    return { ok: true, count }
  } catch (error) {
    return { ok: false, count, message: `删除标记清理失败：${error.message || error}` }
  }
}

function pullCloudHistory () {
  if (!syncEnabled()) return { ok: false, message: '同步未开启。' }
  const utools = safeUtools()
  if (!utools || !utools.db) return { ok: false, message: '当前环境不支持 uTools 数据同步。' }

  try {
    const settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))
    const docs = utools.db.allDocs(SYNC_DOC_PREFIX) || []
    const tombstones = docs
      .filter(doc => doc && doc.kind === 'history' && doc.deleted)
    const remoteItems = docs
      .filter(doc => doc && doc.kind === 'history' && !doc.deleted && doc.item)
      .map(doc => doc.item)
      .filter(item => settings.syncHistory || (settings.syncFavorites && (item.favorite || item.favoriteOnly)))
      .map(item => applyRemoteSyncSettings(item, settings))
    const merged = mergeHistoryItems(getHistory(), remoteItems, tombstones)
    dbSet(HISTORY_KEY, merged)

    const groupDoc = readCloudDoc(SYNC_GROUPS_DOC_ID)
    if (groupDoc && Array.isArray(groupDoc.groups)) {
      const groups = Array.from(new Set([...getGroups(), ...groupDoc.groups].filter(Boolean)))
      dbSet(GROUPS_KEY, groups.length ? groups : ['常用'])
    }

    notifyHistoryChanged()
    lastSyncPullAt = now()
    return { ok: true, count: remoteItems.length, history: merged }
  } catch (error) {
    return { ok: false, message: `同步读取失败：${error.message || error}` }
  }
}

function bindDbPullListener () {
  const utools = safeUtools()
  if (dbPullListenerBound || !utools || typeof utools.onDbPull !== 'function') return false
  try {
    utools.onDbPull((docs = []) => {
      if (!syncEnabled() || dbPullInProgress) return
      const changedDocs = Array.isArray(docs) ? docs : []
      if (changedDocs.length && !changedDocs.some(isSyncDoc)) return
      dbPullInProgress = true
      try {
        const result = pullCloudHistory()
        if (result?.ok) lastDbPullAt = now()
      } finally {
        dbPullInProgress = false
      }
    })
    dbPullListenerBound = true
    return true
  } catch (error) {
    return false
  }
}

function syncNow () {
  if (!syncEnabled()) return { ok: false, message: '同步未开启或当前 uTools 不支持同步。' }
  bindDbPullListener()
  const beforeState = cloudReplicateState()
  if (beforeState == null) return { ok: false, state: beforeState, message: 'uTools 数据同步未开启，当前只能写入本机数据库，无法跨设备同步。请先在 uTools 中开启数据同步。' }
  if (beforeState === 1) return { ok: false, state: beforeState, message: 'uTools 正在从云端复制数据，请等待状态变为“云端复制完成”后再同步。当前读取到的仍可能是本机旧同步库。' }
  const pulled = pullCloudHistory()
  if (!pulled.ok) return pulled
  const pushed = pushHistoryToCloud(getHistory())
  const pruned = pruneDeletedHistoryFromCloud()
  if (pushed.ok) lastSyncPushAt = now()
  const state = cloudReplicateState()
  return {
    ok: Boolean(pushed.ok),
    count: pushed.count || 0,
    pulled: pulled.count || 0,
    pruned: pruned.count || 0,
    state,
    message: pushed.ok
      ? `已提交到 uTools 本机同步库：合并 ${pulled.count || 0} 条，提交 ${pushed.count || 0} 条，清理 ${pruned.count || 0} 条删除标记。另一台设备需等待 uTools 云端拉取完成后自动合并。`
      : pushed.message
  }
}

function syncInfo () {
  const utools = safeUtools()
  const settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))
  const info = {
    available: syncAvailable(),
    enabled: syncEnabled(),
    cloudReady: syncCloudReady(),
    state: cloudReplicateState(),
    dbPullListening: dbPullListenerBound,
    lastSyncPushAt,
    lastSyncPullAt,
    lastDbPullAt,
    user: syncUser(),
    localCount: getHistory().length,
    cloudCount: 0,
    deletedCount: 0,
    attachmentCount: 0,
    totalDocCount: 0,
    syncDocCount: 0,
    hasGroupsDoc: false,
    hasMetaDoc: false,
    latestCloudUpdatedAt: 0,
    latestCloudDocId: '',
    latestMetaPushedAt: 0,
    appName: '',
    appVersion: '',
    isDev: false,
    settings
  }
  if (!utools || !utools.db) return info

  try {
    const docs = utools.db.allDocs(SYNC_DOC_PREFIX) || []
    info.cloudCount = docs.filter(doc => doc && doc.kind === 'history' && !doc.deleted).length
    info.deletedCount = docs.filter(doc => doc && doc.kind === 'history' && doc.deleted).length
    info.attachmentCount = (utools.db.allDocs(SYNC_ATTACHMENT_PREFIX) || []).length
    const allDocs = utools.db.allDocs() || []
    info.totalDocCount = allDocs.length
    info.syncDocCount = allDocs.filter(isSyncDoc).length
    info.hasGroupsDoc = Boolean(readCloudDoc(SYNC_GROUPS_DOC_ID))
    const metaDoc = readCloudDoc(SYNC_META_DOC_ID)
    info.hasMetaDoc = Boolean(metaDoc)
    info.latestMetaPushedAt = Number(metaDoc?.pushedAt || 0)
    const latest = allDocs
      .filter(isSyncDoc)
      .sort((a, b) => Number(b?.updatedAt || b?.deletedAt || 0) - Number(a?.updatedAt || a?.deletedAt || 0))[0]
    info.latestCloudUpdatedAt = Number(latest?.updatedAt || latest?.deletedAt || 0)
    info.latestCloudDocId = String(latest?._id || '')
  } catch (error) {}

  try {
    info.appName = utools.getAppName ? utools.getAppName() : ''
    info.appVersion = utools.getAppVersion ? utools.getAppVersion() : ''
    info.isDev = utools.isDev ? Boolean(utools.isDev()) : false
  } catch (error) {}

  return info
}

function syncSelfTest () {
  if (!syncAvailable()) return { ok: false, message: '当前环境不支持 uTools 数据库。' }
  const state = cloudReplicateState()
  if (state == null) return { ok: false, state, message: 'uTools 数据同步未开启，无法验证跨设备同步。' }

  const utools = safeUtools()
  const id = `${SYNC_TEST_DOC_PREFIX}${hash(`${now()}:${Math.random()}`)}`
  const attachmentId = `${SYNC_TEST_DOC_PREFIX}attachment:${hash(`${now()}:${Math.random()}`)}`
  const value = uid()

  try {
    const created = putCloudDoc({
      _id: id,
      kind: 'self-test',
      value,
      createdAt: now()
    })
    const readBack = readCloudDoc(id)
    const readable = Boolean(readBack && readBack.value === value)
    const removed = readBack ? utools.db.remove(readBack) : null
    const removedOk = dbResultOk(removed)
    const attachment = Buffer.from('clipdock-sync-self-test', 'utf8')
    const attachmentCreated = postCloudAttachment(attachmentId, attachment, 'text/plain')
    const attachmentReadBack = readCloudAttachment(attachmentId)
    const attachmentReadable = Boolean(attachmentReadBack && attachmentReadBack.toString('utf8') === attachment.toString('utf8'))
    const attachmentRemoved = removeCloudAttachment(attachmentId)
    const attachmentRemovedOk = dbResultOk(attachmentRemoved)

    return {
      ok: Boolean(
        created &&
        readable &&
        removedOk &&
        attachmentCreated &&
        attachmentReadable &&
        attachmentRemovedOk
      ),
      state: cloudReplicateState(),
      message: readable && removedOk && attachmentReadable && attachmentRemovedOk
        ? '同步自检通过：uTools 云数据库文档和附件均可写入、读取并清理。'
        : '同步自检失败：文档或附件无法完整写入、读取并清理。'
    }
  } catch (error) {
    removeCloudDoc(id)
    removeCloudAttachment(attachmentId)
    return { ok: false, state: cloudReplicateState(), message: `同步自检失败：${error.message || error}` }
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

function getRealFilePath (file) {
  try {
    return fs.realpathSync.native(file)
  } catch (error) {
    try {
      return fs.realpathSync(file)
    } catch (error) {
      return file
    }
  }
}

function uniqueExistingFiles (files) {
  const unique = new Map()

  for (const rawFile of files || []) {
    const file = String(rawFile || '').trim()
    if (!file || !path.isAbsolute(file)) continue

    try {
      if (!fs.existsSync(file)) continue
      const realPath = getRealFilePath(file)
      const key = process.platform === 'win32' ? realPath.toLowerCase() : realPath
      if (!unique.has(key)) unique.set(key, realPath)
    } catch (error) {}
  }

  return Array.from(unique.values())
}

function filesFromPlainText (text) {
  const value = String(text || '').trim()
  if (!value || value.length > 10000) return []
  const candidates = value
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

  if (!candidates.length || candidates.length > 50) return []
  if (candidates.some(line => !path.isAbsolute(line))) return []
  return uniqueExistingFiles(candidates)
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

function readClipboardImageData (formats, imageFormats = IMAGE_CLIPBOARD_FORMATS) {
  if (!clipboard) return null
  const available = new Set((formats || []).map(format => String(format).toLowerCase()))

  for (const mime of imageFormats) {
    if (!available.has(mime) && !(clipboard.has && clipboard.has(mime))) continue
    try {
      const buffer = Buffer.from(clipboard.readBuffer(mime) || [])
      if (!buffer.length) continue
      return {
        mime,
        content: dataUrlFromBuffer(mime, buffer),
        size: formatByteSize(buffer.length)
      }
    } catch (error) {}
  }
  return null
}

function readClipboardHtmlImageData (formats) {
  if (!clipboard) return null
  const available = new Set((formats || []).map(format => String(format).toLowerCase()))
  if (!available.has('text/html') && !(clipboard.has && clipboard.has('text/html'))) return null

  try {
    const html = clipboard.readHTML()
    if (!html || typeof document === 'undefined' || !document.createElement) return null

    const template = document.createElement('template')
    template.innerHTML = html
    const imageNodes = Array.from(template.content.querySelectorAll('img[src], a[href]'))
    for (const node of imageNodes) {
      const content = String(node.getAttribute('src') || node.getAttribute('href') || '').trim()
      const image = imageDataFromDataUrl(content)
      if (image) return image
    }
  } catch (error) {}

  return null
}

function readClipboardRichData (formats) {
  if (!clipboard) return null
  const available = new Set((formats || []).map(format => String(format).toLowerCase()))
  const hasHtml = available.has('text/html') || (clipboard.has && clipboard.has('text/html'))
  const hasRtf = available.has('text/rtf') || available.has('text/richtext') || (clipboard.has && (clipboard.has('text/rtf') || clipboard.has('text/richtext')))

  try {
    const html = hasHtml ? clipboard.readHTML() : ''
    const rtf = hasRtf ? clipboard.readRTF() : ''
    if (!html && !rtf) return null
    const plain = stripHtml(html) || titleFromRtf(rtf)
    const title = html ? titleFromHtml(html) : titleFromRtf(rtf)
    return {
      type: 'rich',
      title: title || '富文本',
      preview: plain.slice(0, 160) || 'HTML / RTF',
      content: html || plain,
      html,
      rtf,
      source: '剪贴板',
      size: byteSize(`${html}\n${rtf}`),
      signature: `rich:${hash(`${html}\n${rtf}`)}`
    }
  } catch (error) {
    return null
  }
}

function readClipboardBookmarkData (text) {
  if (clipboard) {
    try {
      const bookmark = clipboard.readBookmark()
      if (bookmark && bookmark.url) {
        const title = String(bookmark.title || '').trim() || titleFromUrl(bookmark.url)
        return {
          type: 'url',
          title,
          preview: bookmark.url,
          content: bookmark.url,
          url: bookmark.url,
          source: '剪贴板',
          size: byteSize(bookmark.url),
          signature: `url:${hash(bookmark.url)}`
        }
      }
    } catch (error) {}
  }

  if (isUrlText(text)) {
    const url = String(text || '').trim()
    return {
      type: 'url',
      title: titleFromUrl(url),
      preview: url,
      content: url,
      url,
      source: '剪贴板',
      size: byteSize(url),
      signature: `url:${hash(url)}`
    }
  }

  return null
}

const WINDOWS_CLIPBOARD_SNAPSHOT_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$result = [ordered]@{
  text = ''
  files = @()
  imageBase64 = ''
  imageMime = 'image/png'
}
try {
  if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
    $files = @()
    $dropList = [System.Windows.Forms.Clipboard]::GetFileDropList()
    foreach ($file in $dropList) {
      if ($file) { $files += [string]$file }
    }
    $result.files = $files
  }
} catch {}
try {
  if ([System.Windows.Forms.Clipboard]::ContainsText([System.Windows.Forms.TextDataFormat]::UnicodeText)) {
    $result.text = [System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
  } elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {
    $result.text = [System.Windows.Forms.Clipboard]::GetText()
  }
} catch {}
try {
  if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    if ($null -ne $image) {
      $stream = New-Object System.IO.MemoryStream
      try {
        $image.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $result.imageBase64 = [Convert]::ToBase64String($stream.ToArray())
      } finally {
        $stream.Dispose()
        $image.Dispose()
      }
    }
  }
} catch {}
[Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 5))
`

function parsePowerShellJson (output) {
  const text = String(output || '').trim().replace(/^\uFEFF/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    return null
  }
}

function normalizeWindowsClipboardSnapshot (raw) {
  const rawFiles = Array.isArray(raw?.files)
    ? raw.files
    : raw?.files
      ? [raw.files]
      : []
  const files = uniqueExistingFiles(rawFiles)
  const text = String(raw?.text || '').replace(/\r?\n$/, '')
  const imageMime = IMAGE_CLIPBOARD_FORMATS.includes(String(raw?.imageMime || '').toLowerCase())
    ? String(raw.imageMime).toLowerCase()
    : 'image/png'
  const imageBase64 = String(raw?.imageBase64 || '')
  let image = null

  if (imageBase64) {
    try {
      const buffer = Buffer.from(imageBase64, 'base64')
      if (buffer.length) {
        image = {
          mime: imageMime,
          content: dataUrlFromBuffer(imageMime, buffer),
          preview: imagePreviewFromMime(imageMime, 'Windows 剪贴板图片'),
          size: formatByteSize(buffer.length)
        }
      }
    } catch (error) {}
  }

  const types = []
  if (files.length) types.push('file')
  if (image) types.push('image')
  if (text) types.push('text')

  return {
    files,
    image,
    text,
    types
  }
}

function readWindowsClipboardSnapshot (options = {}) {
  if (process.platform !== 'win32') return null
  const timestamp = now()
  if (!options.refresh && timestamp - winClipboardFallbackLastReadAt < 1500) return winClipboardFallbackLastSnapshot
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-STA',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      WINDOWS_CLIPBOARD_SNAPSHOT_SCRIPT
    ], {
      encoding: 'utf8',
      timeout: 1800,
      maxBuffer: 24 * 1024 * 1024,
      windowsHide: true
    })
    const parsed = parsePowerShellJson(output)
    if (!parsed) throw new Error('Windows clipboard fallback returned invalid data')
    const snapshot = normalizeWindowsClipboardSnapshot(parsed)
    winClipboardFallbackOk = true
    winClipboardFallbackError = ''
    winClipboardFallbackLastReadAt = timestamp
    winClipboardFallbackLastText = snapshot.text
    winClipboardFallbackLastSnapshot = snapshot
    winClipboardFallbackLastTypes = snapshot.types
    return snapshot
  } catch (error) {
    winClipboardFallbackOk = false
    winClipboardFallbackError = String(error?.message || error || 'Windows clipboard fallback failed')
    winClipboardFallbackLastReadAt = timestamp
    winClipboardFallbackLastText = ''
    winClipboardFallbackLastSnapshot = null
    winClipboardFallbackLastTypes = []
    return null
  }
}

function addTextClipboardHistory (text, source = '剪贴板', options = {}) {
  if (!text) return null

  const textImage = imageDataFromDataUrl(text.trim())
  if (textImage) {
    return addCapturedImageHistory(textImage, source, options)
  }

  const bookmark = readClipboardBookmarkData(text)
  if (bookmark) {
    if (!options.force) {
      if (shouldSkipCapturedSignature(bookmark.signature)) return null
      if (bookmark.signature === lastSignature) return null
    }
    lastSignature = bookmark.signature
    return addHistory({
      ...bookmark,
      source
    })
  }

  const type = inferTextType(text)
  const signature = `${type}:${hash(text)}`
  if (!options.force) {
    if (shouldSkipCapturedSignature(signature)) return null
    if (signature === lastSignature) return null
  }
  lastSignature = signature
  return addHistory({
    type,
    title: titleFromText(text, type),
    preview: text.slice(0, 160),
    content: text,
    source,
    size: byteSize(text),
    signature
  })
}

function readImageFileData (file) {
  const mime = imageMimeFromPath(file)
  if (!mime) return null

  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) return null
    const buffer = fs.readFileSync(file)
    if (!buffer.length) return null
    return {
      mime,
      content: dataUrlFromBuffer(mime, buffer),
      title: path.basename(file),
      preview: imageTitleFromMime(mime),
      filePath: file,
      fileUrl: pathToFileURL(file).href,
      size: formatByteSize(buffer.length)
    }
  } catch (error) {
    return null
  }
}

function addFileClipboardHistory (files, source = '剪贴板', options = {}) {
  const existingFiles = uniqueExistingFiles(files)
  if (!existingFiles.length) return null

  if (existingFiles.length === 1) {
    const imageFile = readImageFileData(existingFiles[0])
    if (imageFile) {
      return addCapturedImageHistory(imageFile, source, options)
    }
  }

  const signature = `file:${hash(existingFiles.join('\n'))}`
  if (!options.force) {
    if (shouldSkipCapturedSignature(signature)) return null
    if (signature === lastSignature) return null
  }
  lastSignature = signature
  return addHistory({
    type: 'file',
    title: existingFiles.length > 1 ? '文件组' : path.basename(existingFiles[0]),
    preview: existingFiles.map(file => path.basename(file)).join(' / '),
    files: existingFiles,
    source,
    size: `${existingFiles.length} 个文件`,
    signature
  })
}

function clipboardSignatureFromSnapshot (snapshot) {
  if (!snapshot) return ''
  const files = uniqueExistingFiles(snapshot.files)
  if (files.length) {
    if (files.length === 1) {
      const imageFile = readImageFileData(files[0])
      if (imageFile) return imageSignature(imageFile.mime, imageFile.content)
    }
    return `file:${hash(files.join('\n'))}`
  }
  if (snapshot.image) return imageSignature(snapshot.image.mime, snapshot.image.content)
  if (snapshot.text) {
    const bookmark = readClipboardBookmarkData(snapshot.text)
    if (bookmark) return bookmark.signature
    return `${inferTextType(snapshot.text)}:${hash(snapshot.text)}`
  }
  return ''
}

function captureWindowsClipboardSnapshot (source = 'Windows 剪贴板', options = {}) {
  const snapshot = readWindowsClipboardSnapshot(options)
  if (!snapshot) return null

  const fileItem = addFileClipboardHistory(snapshot.files, source, options)
  if (fileItem) return fileItem

  if (snapshot.image) {
    const imageItem = addCapturedImageHistory(snapshot.image, source, options)
    if (imageItem) return imageItem
  }

  if (snapshot.text) return addTextClipboardHistory(snapshot.text, source, options)
  return null
}

function getRawImageClipboardData (item) {
  if (!item || item.type !== 'image' || !item.content) return null
  const parsed = parseDataUrl(item.content)
  if (!parsed) return null
  const mime = (item.mime || parsed.mime || '').toLowerCase()
  if (!RAW_IMAGE_WRITE_FORMATS.includes(mime)) return null
  return {
    mime,
    buffer: parsed.buffer,
    content: item.content
  }
}

function addCapturedImageHistory (image, source = '剪贴板', options = {}) {
  const signature = imageSignature(image.mime, image.content)
  if (!options.force) {
    if (shouldSkipCapturedSignature(signature)) return null
    if (signature === lastSignature) return null
  }
  lastSignature = signature
  return addHistory({
    type: 'image',
    title: image.title || imageTitleFromMime(image.mime),
    preview: image.preview || imagePreviewFromMime(image.mime),
    content: image.content,
    filePath: image.filePath || '',
    fileUrl: image.fileUrl || '',
    mime: image.mime,
    animated: image.mime === 'image/gif',
    source,
    size: image.size,
    signature
  })
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
  const normalized = (items || []).map(normalizeItem).slice(0, MAX_HISTORY)
  dbSet(HISTORY_KEY, normalized)
  pushHistoryToCloud(normalized)
  notifyHistoryChanged()
}

function updateHistoryItem (itemOrId, patch) {
  const id = typeof itemOrId === 'object' ? itemOrId?.id : itemOrId
  const signature = typeof itemOrId === 'object' ? itemOrId?.signature : itemOrId
  const nextPatch = { ...(patch || {}) }
  const favoriteChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'favorite') || Object.prototype.hasOwnProperty.call(nextPatch, 'favoriteGroup')
  if (favoriteChanged && !nextPatch.favoriteUpdatedAt) nextPatch.favoriteUpdatedAt = now()
  let changed = false
  const next = getHistory().map(item => {
    if (item.id !== id && item.signature !== signature) return item
    changed = true
    return normalizeItem({
      ...item,
      ...nextPatch,
      updatedAt: nextPatch.updatedAt || now()
    })
  })
  if (!changed) return null
  saveHistory(next)
  return next.find(item => item.id === id || item.signature === signature) || null
}

function addHistory (item) {
  const normalized = normalizeItem(item)
  const current = getHistory()
  const existing = current.find(entry => entry.signature === normalized.signature)
  let nextItem = normalized
  if (existing) {
    nextItem = normalizeItem({
      ...existing,
      ...normalized,
      id: existing.id,
      favorite: existing.favorite,
      favoriteGroup: existing.favoriteGroup,
      favoriteAt: existing.favoriteAt,
      favoriteUpdatedAt: existing.favoriteUpdatedAt,
      createdAt: normalized.createdAt || now(),
      updatedAt: normalized.updatedAt || now()
    })
  }
  const list = current.filter(entry => entry.signature !== normalized.signature)
  list.unshift(nextItem)
  saveHistory(list)
  return nextItem
}

function saveGroups (groups) {
  const cleaned = Array.from(new Set((groups || []).map(group => String(group).trim()).filter(Boolean)))
  dbSet(GROUPS_KEY, cleaned.length ? cleaned : ['常用'])
  if (syncEnabled()) {
    putCloudDoc({
      _id: SYNC_GROUPS_DOC_ID,
      kind: 'groups',
      groups: cleaned.length ? cleaned : ['常用']
    })
  }
  notifyHistoryChanged()
}

function captureClipboard (options = {}) {
  if (!clipboard) return captureWindowsClipboardSnapshot('Windows 剪贴板', options)
  let formats = []
  try {
    formats = clipboard.availableFormats() || []
  } catch (error) {
    return captureWindowsClipboardSnapshot('Windows 剪贴板', options)
  }
  const files = readClipboardFiles(formats)
  if (files.length) {
    return addFileClipboardHistory(files, '剪贴板', options)
  }

  const rawImage = readClipboardImageData(formats, RAW_IMAGE_WRITE_FORMATS)
  if (rawImage) {
    return addCapturedImageHistory(rawImage, '剪贴板', options)
  }

  const htmlImage = readClipboardHtmlImageData(formats)
  if (htmlImage) {
    return addCapturedImageHistory(htmlImage, '剪贴板', options)
  }

  let text = ''
  try {
    text = clipboard.readText()
  } catch (error) {
    text = ''
  }
  const bookmark = readClipboardBookmarkData(text)
  if (bookmark) {
    if (!options.force) {
      if (shouldSkipCapturedSignature(bookmark.signature)) return null
      if (bookmark.signature === lastSignature) return null
    }
    lastSignature = bookmark.signature
    return addHistory(bookmark)
  }

  const rich = readClipboardRichData(formats)
  if (rich) {
    if (!options.force) {
      if (shouldSkipCapturedSignature(rich.signature)) return null
      if (rich.signature === lastSignature) return null
    }
    lastSignature = rich.signature
    return addHistory(rich)
  }

  if (text) {
    const nativeSnapshot = process.platform === 'win32' ? readWindowsClipboardSnapshot(options) : null
    if (nativeSnapshot?.files?.length) {
      const nativeFiles = addFileClipboardHistory(nativeSnapshot.files, 'Windows 剪贴板', options)
      if (nativeFiles) return nativeFiles
    }
    const textFiles = filesFromPlainText(text)
    if (textFiles.length) return addFileClipboardHistory(textFiles, '剪贴板', options)
    return addTextClipboardHistory(text, '剪贴板', options)
  }

  const bitmapImage = readClipboardImageData(formats, BITMAP_IMAGE_CLIPBOARD_FORMATS)
  if (bitmapImage) {
    return addCapturedImageHistory(bitmapImage, '剪贴板', options)
  }

  const image = clipboard.readImage()
  if (image && !image.isEmpty()) {
    const dataUrl = image.toDataURL()
    return addCapturedImageHistory({
      content: dataUrl,
      mime: 'image/png',
      size: byteSize(dataUrl)
    }, '剪贴板', options)
  }

  return captureWindowsClipboardSnapshot('Windows 剪贴板', options)
}

function resetWatchBaseline () {
  try {
    if (clipboard) {
      const formats = clipboard.availableFormats() || []
      const files = readClipboardFiles(formats)
      if (files.length) {
        lastSignature = clipboardSignatureFromSnapshot({ files })
        return
      }
      const rawImage = readClipboardImageData(formats, RAW_IMAGE_WRITE_FORMATS)
      if (rawImage) {
        lastSignature = imageSignature(rawImage.mime, rawImage.content)
        return
      }
      const htmlImage = readClipboardHtmlImageData(formats)
      if (htmlImage) {
        lastSignature = imageSignature(htmlImage.mime, htmlImage.content)
        return
      }
      const currentText = clipboard.readText()
      const bookmark = readClipboardBookmarkData(currentText)
      if (bookmark) {
        lastSignature = bookmark.signature
        return
      }
      const rich = readClipboardRichData(formats)
      if (rich) {
        lastSignature = rich.signature
        return
      }
      if (currentText) {
        lastSignature = `${inferTextType(currentText)}:${hash(currentText)}`
        return
      }
      const bitmapImage = readClipboardImageData(formats, BITMAP_IMAGE_CLIPBOARD_FORMATS)
      if (bitmapImage) {
        lastSignature = imageSignature(bitmapImage.mime, bitmapImage.content)
        return
      }
      const image = clipboard.readImage()
      if (image && !image.isEmpty()) {
        const dataUrl = image.toDataURL()
        lastSignature = imageSignature('image/png', dataUrl)
        return
      }
    }
    lastSignature = clipboardSignatureFromSnapshot(readWindowsClipboardSnapshot({ refresh: true }))
  } catch (error) {
    lastSignature = clipboardSignatureFromSnapshot(readWindowsClipboardSnapshot({ refresh: true }))
  }
}

function watchTick () {
  watchLastTickAt = now()
  try {
    const item = captureClipboard()
    watchErrorCount = 0
    watchLastError = ''
    if (item) watchLastCaptureAt = now()
    if (item && typeof watchCallback === 'function') watchCallback(item)
  } catch (error) {
    watchErrorCount += 1
    watchLastError = String(error?.message || error || 'unknown watch error')
    if (watchErrorCount >= 3) {
      if (watchTimer) clearInterval(watchTimer)
      watchTimer = null
      watchStartedAt = 0
      if (watchCallback && (clipboard || process.platform === 'win32')) {
        const callback = watchCallback
        const interval = watchInterval
        setTimeout(() => window.services?.watch?.start?.(callback, interval), Math.min(5000, watchErrorCount * 500))
      }
    }
  }
}

function writeItemToClipboard (item) {
  if (!clipboard || !item) return false
  const rawImage = getRawImageClipboardData(item)
  if (rawImage) {
    skipCapturedSignature(imageSignature(rawImage.mime, rawImage.content))
    clipboard.writeBuffer(rawImage.mime, rawImage.buffer)
    return true
  }
  if (item.type === 'image' && item.content && nativeImage) {
    const dataUrl = parseDataUrl(item.content)
    skipCapturedSignature(imageSignature(item.mime || dataUrl?.mime || 'image/png', item.content))
    clipboard.writeImage(nativeImage.createFromDataURL(item.content))
    const image = clipboard.readImage()
    if (image && !image.isEmpty()) {
      const writtenDataUrl = image.toDataURL()
      skipCapturedSignature(imageSignature('image/png', writtenDataUrl))
    }
    return true
  }
  if (item.type === 'file' && item.files && item.files.length) {
    skipCapturedSignature(`text:${hash(item.files.join('\n'))}`)
    clipboard.writeText(item.files.join('\n'))
    return true
  }
  if (item.type === 'rich' && (item.html || item.rtf || item.content)) {
    const html = String(item.html || item.content || '')
    const rtf = String(item.rtf || '')
    skipCapturedSignature(`rich:${hash(`${html}\n${rtf}`)}`)
    if (html && rtf) clipboard.write({ html, rtf })
    else if (html) clipboard.writeHTML(html)
    else clipboard.writeRTF(rtf)
    return true
  }
  if (item.type === 'url') {
    const url = String(item.url || item.content || item.preview || '')
    skipCapturedSignature(`url:${hash(url)}`)
    try {
      clipboard.writeBookmark(item.title || titleFromUrl(url), url)
    } catch (error) {
      clipboard.writeText(url)
    }
    return true
  }
  const text = String(item.content || item.preview || '')
  const type = inferTextType(text)
  skipCapturedSignature(`${type}:${hash(text)}`)
  clipboard.writeText(text)
  return true
}

function itemFilePaths (item) {
  const paths = []
  if (item?.filePath) paths.push(item.filePath)
  if (item?.fileUrl) {
    const filePath = fileUriToPath(item.fileUrl)
    if (filePath) paths.push(filePath)
  }
  if (Array.isArray(item?.files)) paths.push(...item.files)
  return Array.from(new Set(paths.map(file => String(file || '').trim()).filter(Boolean)))
}

function formatFilePathsForClipboard (paths) {
  return paths.map(file => `"${file}"`).join('\r\n')
}

function copyItemFilePaths (item) {
  if (!clipboard || !item) return false
  const paths = itemFilePaths(item)
  if (!paths.length) return false
  const text = formatFilePathsForClipboard(paths)
  skipCapturedSignature(`text:${hash(text)}`)
  clipboard.writeText(text)
  addHistory({
    type: 'text',
    title: paths.length > 1 ? '复制文件路径组' : '复制文件路径',
    preview: text,
    content: text,
    source: '右键菜单',
    size: byteSize(text),
    signature: `text:${hash(text)}`
  })
  return true
}

function imageSaveDialogFilters (mime) {
  const ext = imageExtFromMime(mime).slice(1)
  return [
    { name: `${ext.toUpperCase()} 图片`, extensions: [ext] },
    { name: '所有文件', extensions: ['*'] }
  ]
}

function defaultImageFileName (item, ext) {
  const sourceName = item?.filePath ? path.basename(item.filePath, path.extname(item.filePath)) : ''
  const title = sourceName || item?.title || 'clipdock-image'
  return `${safeFileName(title)}${ext}`
}

function imageBufferForSave (item) {
  if (!item || item.type !== 'image') return null
  if (item.filePath) {
    try {
      if (fs.existsSync(item.filePath) && fs.statSync(item.filePath).isFile()) {
        return {
          buffer: fs.readFileSync(item.filePath),
          mime: imageMimeFromPath(item.filePath) || item.mime || 'image/png'
        }
      }
    } catch (error) {}
  }

  const parsed = parseDataUrl(item.content)
  if (parsed) {
    return {
      buffer: parsed.buffer,
      mime: item.mime || parsed.mime || 'image/png'
    }
  }

  return null
}

function saveImageAsFile (item, options = {}) {
  const image = imageBufferForSave(item)
  if (!image || !image.buffer || !image.buffer.length) {
    return { ok: false, message: '图片内容不可用。' }
  }

  const utools = safeUtools()
  const settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))
  const ext = imageExtFromMime(image.mime)
  const fileName = defaultImageFileName(item, ext)
  let targetPath = ''

  if (options.path) {
    targetPath = String(options.path)
  } else if (settings.imageSaveDir) {
    targetPath = path.join(settings.imageSaveDir, fileName)
  } else if (utools && utools.showSaveDialog) {
    targetPath = utools.showSaveDialog({
      title: '保存图片',
      defaultPath: fileName,
      buttonLabel: '保存',
      filters: imageSaveDialogFilters(image.mime),
      properties: ['createDirectory', 'showOverwriteConfirmation']
    }) || ''
  }

  if (!targetPath) return { ok: false, canceled: true, message: '已取消保存。' }

  try {
    const stat = fs.existsSync(targetPath) ? fs.statSync(targetPath) : null
    if (stat && stat.isDirectory()) targetPath = path.join(targetPath, fileName)
    if (!path.extname(targetPath)) targetPath += ext
    if (settings.imageSaveDir && !options.path) targetPath = uniqueTargetPath(targetPath)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, image.buffer)
    return { ok: true, path: targetPath, message: `已保存：${targetPath}` }
  } catch (error) {
    return { ok: false, message: `保存失败：${error.message || error}` }
  }
}

function chooseImageSaveDir () {
  const utools = safeUtools()
  if (!utools || !utools.showOpenDialog) {
    return { ok: false, message: '当前环境不支持选择文件夹。' }
  }

  const settings = normalizeSettings(dbGet(SETTINGS_KEY, {}))
  const selected = utools.showOpenDialog({
    title: '选择图片保存位置',
    defaultPath: settings.imageSaveDir || undefined,
    buttonLabel: '选择',
    properties: ['openDirectory', 'createDirectory']
  })
  const dir = Array.isArray(selected) ? selected[0] : ''
  if (!dir) return { ok: false, canceled: true, message: '已取消选择。' }

  const nextSettings = normalizeSettings({
    ...settings,
    imageSaveDir: dir
  })
  dbSet(SETTINGS_KEY, nextSettings)
  return { ok: true, path: dir, settings: nextSettings }
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
    if (utools && item.type === 'rich') {
      utools.hideMainWindowPasteText(String(item.preview || stripHtml(item.html || item.content || '')))
      return true
    }
    if (utools && item.type === 'url') {
      utools.hideMainWindowPasteText(String(item.url || item.content || item.preview || ''))
      return true
    }
    if (utools && item.type === 'image' && item.content) {
      const rawImage = getRawImageClipboardData(item)
      utools.hideMainWindowPasteImage(rawImage ? rawImage.buffer : item.content)
      return true
    }
    if (utools && item.type === 'file' && item.files && item.files.length) {
      utools.hideMainWindowPasteFile(item.files)
      return true
    }
  } catch (error) {}
  writeItemToClipboard(item)
  return false
}

function getIndexUrl (query) {
  const utools = safeUtools()
  if (utools && utools.isDev && utools.isDev()) return `http://127.0.0.1:5173/${query}`
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
      if (isUrlText(text)) {
        return addHistory({
          type: 'url',
          title: titleFromUrl(text),
          preview: text,
          content: text,
          url: text,
          source: action.from || 'uTools',
          size: byteSize(text),
          signature: `url:${hash(text)}`
        })
      }
      if (/<[a-z][\s\S]*>/i.test(text)) {
        return addHistory({
          type: 'rich',
          title: titleFromHtml(text),
          preview: stripHtml(text).slice(0, 160),
          content: text,
          html: text,
          source: action.from || 'uTools',
          size: byteSize(text),
          signature: `rich:${hash(text)}`
        })
      }
      return addHistory({
        type: inferTextType(text),
        content: text,
        preview: text.slice(0, 160),
        source: action.from || 'uTools'
      })
    }
    if (action.type === 'img') {
      const dataUrl = parseDataUrl(action.payload)
      const mime = dataUrl?.mime || ''
      return addHistory({
        type: 'image',
        title: imageTitleFromMime(mime),
        preview: imagePreviewFromMime(mime, '来自 uTools 超级面板'),
        content: action.payload,
        mime,
        animated: mime === 'image/gif',
        source: '超级面板'
      })
    }
    if (action.type === 'files') {
      const files = uniqueExistingFiles((action.payload || []).map(file => file.path).filter(Boolean))
      if (files.length === 1) {
        const imageFile = readImageFileData(files[0])
        if (imageFile) {
          return addCapturedImageHistory(imageFile, '超级面板')
        }
      }

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
    find (itemOrId) {
      const id = typeof itemOrId === 'object' ? itemOrId?.id : itemOrId
      const signature = typeof itemOrId === 'object' ? itemOrId?.signature : itemOrId
      return getHistory().find(item => item.id === id || item.signature === signature) || null
    },
    refreshFromCloud () {
      return pullCloudHistory()
    },
    saveAll: saveHistory,
    add: addHistory,
    update: updateHistoryItem,
    remove (itemOrId) {
      const current = getHistory()
      const removed = current.filter(item => item.id === itemOrId || item.signature === itemOrId || item.id === itemOrId?.id || item.signature === itemOrId?.signature)
      const next = current.filter(item => !removed.some(target => target.signature === item.signature || target.id === item.id))
      dbSet(HISTORY_KEY, next)
      pushDeletedHistoryToCloud(removed)
      notifyHistoryChanged()
      return removed.length
    },
    onChange (callback) {
      if (typeof callback !== 'function') return () => {}
      historyListeners.add(callback)
      return () => historyListeners.delete(callback)
    },
    clear () {
      const removed = getHistory()
      dbSet(HISTORY_KEY, [])
      pushDeletedHistoryToCloud(removed)
      notifyHistoryChanged()
    }
  },
  groups: {
    getAll: getGroups,
    saveAll: saveGroups
  },
  settings: {
    get () {
      return normalizeSettings(dbGet(SETTINGS_KEY, {}))
    },
    set (settings) {
      const previous = normalizeSettings(dbGet(SETTINGS_KEY, {}))
      const next = normalizeSettings(settings)
      dbSet(SETTINGS_KEY, next)
      if (next.syncEnabled) bindDbPullListener()
      if (!previous.syncEnabled && next.syncEnabled) syncNow()
      else if (next.syncEnabled && hasSyncSettingsChanged(previous, next) && syncCloudReady()) pushHistoryToCloud()
    },
    chooseImageSaveDir
  },
  sync: {
    available: syncAvailable,
    enabled: syncEnabled,
    state: cloudReplicateState,
    info: syncInfo,
    now: syncNow,
    selfTest: syncSelfTest
  },
  files: {
    saveImage: saveImageAsFile
  },
  path: {
    exists (value) {
      try {
        return Boolean(value && fs.existsSync(value))
      } catch (error) {
        return false
      }
    }
  },
  watch: {
    start (callback, interval = 1000) {
      if (!clipboard && process.platform !== 'win32') return false
      watchCallback = typeof callback === 'function' ? callback : watchCallback
      watchInterval = Number(interval) > 0 ? Number(interval) : 1000
      watchSubscribers += 1
      if (watchTimer) return true
      watchErrorCount = 0
      watchLastError = ''
      resetWatchBaseline()
      watchTimer = setInterval(watchTick, watchInterval)
      watchStartedAt = now()
      return true
    },
    ensureStarted (callback, interval = 1000) {
      if (watchTimer) {
        if (typeof callback === 'function') watchCallback = callback
        watchSubscribers = Math.max(1, watchSubscribers)
        return true
      }
      return window.services.watch.start(callback, interval)
    },
    restart (callback, interval = watchInterval) {
      if (!clipboard && process.platform !== 'win32') return false
      if (watchTimer) clearInterval(watchTimer)
      watchTimer = null
      watchCallback = typeof callback === 'function' ? callback : watchCallback
      watchInterval = Number(interval) > 0 ? Number(interval) : watchInterval
      watchSubscribers = Math.max(1, watchSubscribers)
      watchErrorCount = 0
      watchLastError = ''
      resetWatchBaseline()
      watchTimer = setInterval(watchTick, watchInterval)
      watchStartedAt = now()
      return true
    },
    captureNow () {
      const item = captureClipboard({ force: true, refresh: true })
      if (item) {
        watchLastCaptureAt = now()
        if (typeof watchCallback === 'function') watchCallback(item)
        return {
          ok: true,
          item,
          message: `已读取当前剪贴板：${item.title || item.preview || item.type}`
        }
      }
      return {
        ok: false,
        message: winClipboardFallbackError || '当前剪贴板没有可记录的内容'
      }
    },
    stop () {
      watchSubscribers = Math.max(0, watchSubscribers - 1)
      if (watchSubscribers > 0) return
      watchCallback = null
    },
    forceStop () {
      if (watchTimer) clearInterval(watchTimer)
      watchTimer = null
      watchCallback = null
      watchSubscribers = 0
      watchErrorCount = 0
      watchStartedAt = 0
    },
    status () {
      return {
        running: Boolean(watchTimer),
        subscribers: watchSubscribers,
        interval: watchInterval,
        errors: watchErrorCount,
        startedAt: watchStartedAt,
        lastTickAt: watchLastTickAt,
        lastCaptureAt: watchLastCaptureAt,
        lastError: watchLastError,
        clipboard: Boolean(clipboard),
        winFallback: process.platform === 'win32',
        winFallbackOk: winClipboardFallbackOk,
        winFallbackError: winClipboardFallbackError,
        winFallbackLastReadAt: winClipboardFallbackLastReadAt,
        winFallbackTypes: winClipboardFallbackLastTypes,
        winFallbackTextSize: winClipboardFallbackLastText ? byteSize(winClipboardFallbackLastText) : ''
      }
    }
  },
  clipboard: {
    copyItem: writeItemToClipboard,
    copyFilePaths: copyItemFilePaths,
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
          sidebarWindow.blurWebView?.()
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
          transparent: true,
          backgroundColor: '#00000000',
          resizable: false,
          movable: true,
          minimizable: false,
          maximizable: false,
          focusable: false,
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
          sidebarWindow.blurWebView?.()
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

if (syncEnabled()) bindDbPullListener()
window.services.watch.ensureStarted()
