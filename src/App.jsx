import { useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)
gsap.defaults({ duration: 0.22, ease: 'power2.out' })

const isSidebarWindow = new URLSearchParams(window.location.search).get('view') === 'sidebar'

function prefersReducedMotion () {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
}

if (!window.services) {
  const fallbackDockMode = new URLSearchParams(window.location.search).get('dock') || 'rail'
  const fallbackDockState = fallbackDockMode === 'expanded'
    ? { mode: 'expanded', side: 'right', pinned: false }
    : { mode: 'rail', side: 'right', pinned: false }
  let fallbackSidebarWindow = null
  const memory = {
    items: [],
    groups: ['常用'],
    settings: {
      imageSaveDir: ''
    }
  }
  window.services = {
    captureEnter: () => null,
    history: {
      getAll: () => memory.items,
      find: (itemOrId) => {
        const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId
        const signature = typeof itemOrId === 'object' ? itemOrId.signature : itemOrId
        return memory.items.find(item => item.id === id || item.signature === signature) || null
      },
      refreshFromCloud: () => ({ ok: false }),
      saveAll: (items) => { memory.items = items },
      update: (id, patch) => {
        const targetId = typeof id === 'object' ? id.id : id
        memory.items = memory.items.map(item => item.id === targetId || item.signature === targetId ? { ...item, ...(patch || {}) } : item)
        return memory.items.find(item => item.id === targetId || item.signature === targetId) || null
      },
      add: (item) => {
        memory.items = [{ id: `clip-${Date.now()}`, createdAt: Date.now(), ...item }, ...memory.items]
      },
      onChange: () => () => {},
      remove: (itemOrId) => {
        const id = typeof itemOrId === 'object' ? itemOrId.id : itemOrId
        memory.items = memory.items.filter(item => item.id !== id && item.signature !== id)
      },
      clear: () => { memory.items = [] }
    },
    groups: {
      getAll: () => memory.groups,
      saveAll: (groups) => { memory.groups = groups }
    },
    settings: {
      get: () => memory.settings,
      set: (settings) => { memory.settings = { ...memory.settings, ...(settings || {}) } },
      chooseImageSaveDir: () => ({ ok: false, message: '浏览器预览不支持选择文件夹' })
    },
    files: {
      saveImage: () => ({ ok: false, message: '浏览器预览不支持保存文件' })
    },
    sync: {
      available: () => false,
      enabled: () => false,
      state: () => null,
      info: () => ({ available: false, enabled: false, cloudReady: false, state: null, user: null, dbPullListening: false, lastSyncPushAt: 0, lastSyncPullAt: 0, lastDbPullAt: 0, localCount: memory.items.length, cloudCount: 0, deletedCount: 0, attachmentCount: 0 }),
      now: () => ({ ok: false, message: '浏览器预览不支持 uTools 同步' }),
      selfTest: () => ({ ok: false, message: '浏览器预览不支持 uTools 同步自检' })
    },
    path: {
      exists: () => false
    },
    watch: {
      start: () => false,
      ensureStarted: () => false,
      restart: () => false,
      captureNow: () => ({ ok: false, message: '浏览器预览不支持读取系统剪贴板' }),
      stop: () => false,
      status: () => ({ running: false, subscribers: 0, clipboard: false, winFallback: false, winFallbackOk: false, winFallbackError: '', winFallbackLastReadAt: 0, winFallbackTypes: [], winFallbackTextSize: '', errors: 0, startedAt: 0, lastTickAt: 0, lastCaptureAt: 0, lastError: '' })
    },
    clipboard: {
      copyItem: (item) => navigator.clipboard?.writeText?.(item.content || item.preview || ''),
      pasteItem: (item) => navigator.clipboard?.writeText?.(item.content || item.preview || '')
    },
    dock: {
      getState: () => fallbackDockState,
      onState: (callback) => {
        if (callback) callback(fallbackDockState)
        return () => {}
      },
      setState: () => true,
      startDrag: () => true,
      moveDrag: () => true,
      endDrag: () => true
    },
    window: {
      isSidebarOpen: () => Boolean(fallbackSidebarWindow && !fallbackSidebarWindow.closed),
      closeSidebar: () => {
        if (fallbackSidebarWindow && !fallbackSidebarWindow.closed) {
          fallbackSidebarWindow.close()
          fallbackSidebarWindow = null
          return { ok: true, open: false, message: '侧栏已关闭。' }
        }
        return { ok: false, open: false, message: '侧栏未打开。' }
      },
      toggleSidebar: () => {
        if (fallbackSidebarWindow && !fallbackSidebarWindow.closed) {
          fallbackSidebarWindow.close()
          fallbackSidebarWindow = null
          return { ok: true, open: false, message: '侧栏已关闭。' }
        }
        fallbackSidebarWindow = window.open(`${window.location.origin}${window.location.pathname}?view=sidebar`, '_blank', 'width=336,height=720')
        return {
          ok: Boolean(fallbackSidebarWindow),
          open: Boolean(fallbackSidebarWindow),
          message: fallbackSidebarWindow ? '已用浏览器窗口打开侧栏。' : '浏览器阻止了侧栏窗口。'
        }
      },
      openSidebar: () => {
        fallbackSidebarWindow = window.open(`${window.location.origin}${window.location.pathname}?view=sidebar`, '_blank', 'width=336,height=720')
        return {
          ok: Boolean(fallbackSidebarWindow),
          open: Boolean(fallbackSidebarWindow),
          message: fallbackSidebarWindow ? '已用浏览器窗口打开侧栏。' : '浏览器阻止了侧栏窗口。'
        }
      }
    }
  }
}

const formatFilters = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'url', label: '链接' },
  { key: 'image', label: '图片' },
  { key: 'rich', label: '富文' },
  { key: 'file', label: '文件' },
  { key: 'code', label: '代码' },
  { key: 'favorite', label: '收藏' }
]

const sidebarFilters = formatFilters

const icons = {
  text: <><path d='M5 5h14' /><path d='M5 12h14' /><path d='M5 19h10' /></>,
  url: <><path d='M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1' /><path d='M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1' /></>,
  image: <><rect x='4' y='5' width='16' height='14' rx='2' /><path d='m7 16 4-4 3 3 2-2 3 3' /><circle cx='9' cy='9' r='1' /></>,
  rich: <><path d='M5 5h14' /><path d='M5 10h10' /><path d='M5 15h14' /><path d='M5 20h8' /></>,
  file: <><path d='M7 3h7l5 5v13H7z' /><path d='M14 3v5h5' /></>,
  code: <><path d='m8 9-4 3 4 3' /><path d='m16 9 4 3-4 3' /><path d='m14 5-4 14' /></>,
  star: <path d='m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3z' />,
  clipboard: <><path d='M9 4h6l1 2h3v15H5V6h3l1-2z' /><path d='M9 10h6' /><path d='M9 14h6' /><path d='M9 18h4' /></>,
  search: <><circle cx='11' cy='11' r='7' /><path d='m20 20-3.2-3.2' /></>,
  panel: <><path d='M4 5h16v14H4z' /><path d='M8 5v14' /></>,
  more: <><circle cx='5' cy='12' r='1' /><circle cx='12' cy='12' r='1' /><circle cx='19' cy='12' r='1' /></>,
  pin: <path d='m15 4 5 5-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5z' />,
  undock: <><path d='M8 7H5v12h12v-3' /><path d='M12 5h7v7' /><path d='m19 5-8 8' /></>,
  arrowLeft: <><path d='m15 18-6-6 6-6' /><path d='M9 12h11' /></>,
  settings: <><circle cx='12' cy='12' r='3' /><path d='M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z' /></>
}

function Icon ({ name, size = 18 }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' width={size} height={size} aria-hidden='true'>
      {icons[name] || icons.text}
    </svg>
  )
}

function typeName (type) {
  return { text: '文本', url: '链接', image: '图片', rich: '富文本', file: '文件', code: '代码' }[type] || type
}

function imageFormatName (item) {
  const mime = item?.mime || String(item?.content || '').match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
  if (mime === 'image/gif') return 'GIF 动图'
  if (mime === 'image/webp') return 'WEBP 图片'
  if (mime === 'image/apng') return 'APNG 动图'
  if (mime === 'image/avif') return 'AVIF 图片'
  if (mime === 'image/heic' || mime === 'image/heif') return 'HEIC 图片'
  if (mime === 'image/heic-sequence' || mime === 'image/heif-sequence') return 'HEIC 序列'
  if (mime === 'image/svg+xml') return 'SVG 图片'
  if (mime === 'image/tiff') return 'TIFF 图片'
  if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') return 'ICO 图标'
  if (mime === 'image/png') return 'PNG 图片'
  if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/pjpeg') return 'JPEG 图片'
  if (mime === 'image/bmp' || mime === 'image/x-bmp' || mime === 'image/x-ms-bmp' || mime === 'image/dib' || mime === 'image/x-dib') return 'BMP 图片'
  return typeName(item?.type)
}

function formatName (item) {
  return item?.type === 'image' ? imageFormatName(item) : typeName(item?.type)
}

function imageSrc (item) {
  return item?.fileUrl || item?.content || ''
}

function pulseHistoryTarget (target) {
  if (!target || prefersReducedMotion()) return
  const icon = target.querySelector('.type-icon')
  const tl = gsap.timeline({
    defaults: {
      duration: 0.18,
      ease: 'power2.out',
      overwrite: 'auto'
    }
  })

  tl.fromTo(
    target,
    { scale: 0.992, willChange: 'transform' },
    { scale: 1, clearProps: 'transform,willChange' }
  )

  if (icon) {
    tl.fromTo(
      icon,
      { scale: 0.88 },
      { scale: 1, duration: 0.22, ease: 'back.out(1.7)', clearProps: 'transform' },
      '<'
    )
  }
}

function formatRelativeTime (time) {
  const diff = Math.max(0, Date.now() - Number(time || Date.now()))
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

function formatSyncTime (time) {
  return time ? formatRelativeTime(time) : '暂无'
}

function formatWatchTypes (types) {
  const labels = {
    text: '文本',
    image: '图片',
    file: '文件'
  }
  const list = Array.isArray(types) ? types.map(type => labels[type] || type).filter(Boolean) : []
  return list.length ? list.join(' / ') : '暂无'
}

function createTitle (item) {
  if (item.title) return item.title
  const content = String(item.content || item.preview || '')
  if (item.type === 'image') return imageFormatName(item)
  if (item.type === 'file') return item.files?.length > 1 ? '文件组' : item.files?.[0]?.split(/[\\/]/).pop() || '文件'
  return content.split(/\r?\n/)[0].slice(0, 32) || '剪贴板记录'
}

function normalizeItems (items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    favorite: false,
    favoriteGroup: '',
    attachmentId: '',
    hasSyncedAttachment: false,
    unsyncedContent: false,
    ...item,
    title: createTitle(item),
    preview: item.preview || String(item.content || '').slice(0, 120),
    createdAt: item.createdAt || Date.now(),
    updatedAt: item.updatedAt || item.createdAt || Date.now(),
    favoriteAt: item.favoriteAt || (item.favorite ? item.createdAt || Date.now() : 0),
    favoriteUpdatedAt: item.favoriteUpdatedAt || (item.favorite ? item.favoriteAt || item.updatedAt || item.createdAt || Date.now() : 0)
  }))
}

function useClipboardStore () {
  const [items, setItems] = useState(() => normalizeItems(window.services?.history?.getAll?.()))
  const [groups, setGroups] = useState(() => window.services?.groups?.getAll?.() || ['常用'])
  const [selectedId, setSelectedId] = useState(() => items[0]?.id || null)
  const [status, setStatus] = useState('')

  const refresh = () => {
    const nextItems = normalizeItems(window.services?.history?.getAll?.())
    const nextGroups = window.services?.groups?.getAll?.() || ['常用']
    setItems(nextItems)
    setGroups(nextGroups.length ? nextGroups : ['常用'])
    setSelectedId(current => nextItems.some(item => item.id === current) ? current : nextItems[0]?.id || null)
  }

  useEffect(() => {
    window.services?.history?.refreshFromCloud?.()
    refresh()
    const ensureWatch = () => window.services?.watch?.ensureStarted?.(() => refresh()) ?? window.services?.watch?.start?.(() => refresh())
    ensureWatch()
    const offHistoryChange = window.services?.history?.onChange?.(() => refresh())
    window.utools?.onPluginEnter?.((action) => {
      window.utools?.setExpendHeight?.(680)
      ensureWatch()
      window.services?.history?.refreshFromCloud?.()
      window.services?.captureEnter?.(action)
      refresh()
    })
    return () => {
      offHistoryChange?.()
    }
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 2200)
    return () => clearTimeout(timer)
  }, [status])

  const commitItems = (updater) => {
    const current = normalizeItems(window.services?.history?.getAll?.())
    const committed = typeof updater === 'function' ? updater(current) : updater
    window.services?.history?.saveAll?.(committed)
    setItems(normalizeItems(committed))
    return committed
  }

  const commitGroups = (nextGroups, options = {}) => {
    const baseGroups = window.services?.groups?.getAll?.() || groups
    const sourceGroups = options.replace ? nextGroups : [...baseGroups, ...nextGroups]
    const cleaned = Array.from(new Set(sourceGroups.map(x => x.trim()).filter(Boolean)))
    setGroups(cleaned.length ? cleaned : ['常用'])
    window.services?.groups?.saveAll?.(cleaned.length ? cleaned : ['常用'])
  }

  const selected = items.find(item => item.id === selectedId) || items[0] || null

  return {
    items,
    groups,
    selected,
    selectedId,
    status,
    setStatus,
    setSelectedId,
    refresh,
    updateItem (id, patch) {
      const updated = window.services?.history?.update?.(id, patch)
      if (updated) {
        refresh()
        return
      }
      commitItems(currentItems => currentItems.map(item => item.id === id || item.signature === id ? { ...item, ...patch } : item))
    },
    removeItem (id) {
      const item = window.services?.history?.find?.(id) || items.find(entry => entry.id === id || entry.signature === id)
      let nextItems = []
      setItems(currentItems => {
        nextItems = currentItems.filter(entry => entry.id !== id && entry.signature !== id)
        return nextItems
      })
      if (window.services?.history?.remove && item) {
        window.services.history.remove(item)
      } else {
        window.services?.history?.saveAll?.(nextItems)
      }
    },
    clearItems () {
      setSelectedId(null)
      setItems([])
      if (window.services?.history?.clear) {
        window.services.history.clear()
      } else {
        window.services?.history?.saveAll?.([])
      }
    },
    addGroup (name) {
      const currentGroups = window.services?.groups?.getAll?.() || groups
      if (!name || currentGroups.includes(name)) return
      commitGroups([...groups, name])
    },
    renameGroup (oldName, nextName) {
      const currentGroups = window.services?.groups?.getAll?.() || groups
      if (!oldName || !nextName || currentGroups.includes(nextName)) return
      commitGroups(currentGroups.map(group => group === oldName ? nextName : group), { replace: true })
      const changedAt = Date.now()
      commitItems(currentItems => currentItems.map(item => item.favoriteGroup === oldName ? { ...item, favoriteGroup: nextName, favoriteUpdatedAt: changedAt, updatedAt: changedAt } : item))
    },
    deleteGroup (name) {
      if (!name) return
      const currentGroups = window.services?.groups?.getAll?.() || groups
      const nextGroups = currentGroups.filter(group => group !== name)
      const fallback = nextGroups[0] || '常用'
      commitGroups(nextGroups.length ? nextGroups : [fallback], { replace: true })
      const changedAt = Date.now()
      commitItems(currentItems => currentItems.map(item => item.favoriteGroup === name ? { ...item, favoriteGroup: fallback, favoriteUpdatedAt: changedAt, updatedAt: changedAt } : item))
    }
  }
}

function useFilteredItems (items, filter, favoriteGroup, query, favoriteSort = 'favoriteAt') {
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = items.filter(item => {
      if (filter === 'favorite') {
        if (!item.favorite) return false
        if (favoriteGroup !== '全部' && item.favoriteGroup !== favoriteGroup) return false
      } else if (filter !== 'all' && item.type !== filter) {
        return false
      }
      if (!q) return true
      return [item.title, item.preview, item.content, item.source, item.favoriteGroup].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
    if (filter !== 'favorite') return filtered
    return [...filtered].sort((a, b) => {
      const left = favoriteSort === 'createdAt' ? a.createdAt : a.favoriteAt || a.createdAt
      const right = favoriteSort === 'createdAt' ? b.createdAt : b.favoriteAt || b.createdAt
      return Number(right || 0) - Number(left || 0)
    })
  }, [items, filter, favoriteGroup, query, favoriteSort])
}

function AnimatedPopover ({ open, className, children, origin = 'top right' }) {
  const popoverRef = useRef(null)
  const [rendered, setRendered] = useState(open)

  useEffect(() => {
    if (open) setRendered(true)
  }, [open])

  useGSAP(() => {
    const node = popoverRef.current
    if (!node) return

    const reduced = prefersReducedMotion()
    gsap.killTweensOf(node)

    if (open) {
      gsap.fromTo(
        node,
        {
          autoAlpha: 0,
          y: reduced ? 0 : -6,
          scale: reduced ? 1 : 0.98,
          transformOrigin: origin,
          willChange: 'transform, opacity'
        },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: reduced ? 0 : 0.16,
          ease: 'power2.out',
          clearProps: 'willChange'
        }
      )
      return
    }

    gsap.to(node, {
      autoAlpha: 0,
      y: reduced ? 0 : -4,
      scale: reduced ? 1 : 0.98,
      duration: reduced ? 0 : 0.12,
      ease: 'power1.in',
      onComplete: () => setRendered(false)
    })
  }, { dependencies: [open, rendered], scope: popoverRef })

  if (!rendered) return null
  return <div ref={popoverRef} className={className}>{children}</div>
}

function AnimatedStatus ({ message, className = '' }) {
  const statusRef = useRef(null)
  const [renderedMessage, setRenderedMessage] = useState(message)
  const centered = className.includes('toast')

  useEffect(() => {
    if (message) setRenderedMessage(message)
  }, [message])

  useGSAP(() => {
    const node = statusRef.current
    if (!node) return

    const reduced = prefersReducedMotion()
    gsap.killTweensOf(node)

    if (message) {
      gsap.fromTo(
        node,
        {
          autoAlpha: 0,
          xPercent: centered ? -50 : 0,
          y: reduced ? 0 : 10,
          scale: reduced ? 1 : 0.98,
          willChange: 'transform, opacity'
        },
        {
          autoAlpha: 1,
          xPercent: centered ? -50 : 0,
          y: 0,
          scale: 1,
          duration: reduced ? 0 : 0.2,
          ease: 'power2.out',
          clearProps: 'willChange'
        }
      )
      return
    }

    gsap.to(node, {
      autoAlpha: 0,
      xPercent: centered ? -50 : 0,
      y: reduced ? 0 : 8,
      scale: reduced ? 1 : 0.98,
      duration: reduced ? 0 : 0.16,
      ease: 'power1.in',
      onComplete: () => setRenderedMessage('')
    })
  }, { dependencies: [message, renderedMessage, centered], scope: statusRef })

  if (!renderedMessage) return null
  return <div ref={statusRef} className={className}>{renderedMessage}</div>
}

function itemFilePaths (item) {
  return [
    item?.filePath,
    item?.fileUrl,
    ...(Array.isArray(item?.files) ? item.files : [])
  ].filter(Boolean)
}

function canCopyFilePath (item) {
  return itemFilePaths(item).length > 0
}

function HistoryItem ({ item, active, compact, onClick, onDoubleClick, onContextMenu }) {
  return (
    <button className={`history-item ${compact ? 'compact' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
      <span className={`type-icon ${item.type}`}><Icon name={item.type} /></span>
      <span className='item-main'>
        <span className='item-title'>{item.title}</span>
        <span className='item-preview'>{item.preview}</span>
        <span className='item-meta'>
          <span>{formatName(item)}</span>
          {item.favorite && <span>{item.favoriteGroup || '常用'}</span>}
          <span>{formatRelativeTime(item.createdAt)}</span>
        </span>
      </span>
      <span className='star'>{item.favorite && <Icon name='star' size={16} />}</span>
    </button>
  )
}

function canSaveAsFile (item) {
  return item?.type === 'image'
}

function HistoryContextMenu ({ state, onClose, onCopy, onCopyFilePath, onSaveAsFile, onToggleFavorite, onDelete }) {
  const menuRef = useRef(null)

  useEffect(() => {
    if (!state.open) return
    const close = () => onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
      window.removeEventListener('resize', close)
    }
  }, [state.open, onClose])

  useGSAP(() => {
    if (!state.open || !menuRef.current) return
    const reduced = prefersReducedMotion()
    gsap.fromTo(
      menuRef.current,
      { autoAlpha: 0, y: reduced ? 0 : 6, scale: reduced ? 1 : 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: reduced ? 0 : 0.14, ease: 'power2.out' }
    )
  }, { dependencies: [state.open, state.x, state.y], scope: menuRef })

  if (!state.open || !state.item) return null

  const item = state.item
  return (
    <div
      ref={menuRef}
      className='context-menu'
      style={{ left: state.x, top: state.y }}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.preventDefault()}
    >
      <button type='button' onClick={() => onCopy(item)}>复制内容</button>
      {canCopyFilePath(item) && <button type='button' onClick={() => onCopyFilePath(item)}>复制文件路径</button>}
      {canSaveAsFile(item) && <button type='button' onClick={() => onSaveAsFile(item)}>保存为文件</button>}
      <button type='button' onClick={() => onToggleFavorite(item)}>{item.favorite ? '取消收藏' : '收藏'}</button>
      <button type='button' className='danger' onClick={() => onDelete(item)}>删除</button>
    </div>
  )
}

function Preview ({ item }) {
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [item?.id, item?.fileUrl, item?.content])

  if (!item) {
    return <div className='empty-preview'>没有选中的记录</div>
  }

  if (item.type === 'image') {
    const src = imageFailed ? item.content || '' : imageSrc(item)
    return (
      <div className='image-preview'>
        {src
          ? <img src={src} alt={item.title} onError={() => setImageFailed(true)} />
          : <div className='empty-preview'>{item.unsyncedContent ? '图片内容未同步或附件不可用' : '图片内容不可用'}</div>}
      </div>
    )
  }

  if (item.type === 'file') {
    return (
      <div className='file-preview'>
        {(item.files || []).map(file => (
          <div className='file-row' key={file}>
            <span className='type-icon file'><Icon name='file' /></span>
            <span>
              <strong>{file.split(/[\\/]/).pop()}</strong>
              <small>{file}</small>
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (item.type === 'url') {
    return (
      <div className='url-preview'>
        <strong>{item.title}</strong>
        <a href={item.url || item.content} target='_blank' rel='noreferrer'>{item.url || item.content}</a>
      </div>
    )
  }

  if (item.type === 'rich') {
    return item.html || item.content?.startsWith?.('<')
      ? <iframe className='rich-preview' title={item.title} sandbox='' srcDoc={item.html || item.content} />
      : <pre className='text-preview'>{item.preview || item.content}</pre>
  }

  return <pre className='text-preview'>{item.content || item.preview}</pre>
}

function SettingsPage ({ settings, syncAvailable, syncState, syncInfo, watchInfo, onBack, onChange, onChooseImageSaveDir, onRestartWatch, onReadClipboardNow, onSyncNow, onSyncSelfTest, onSave }) {
  const [imageSaveDir, setImageSaveDir] = useState(settings.imageSaveDir || '')

  useEffect(() => {
    setImageSaveDir(settings.imageSaveDir || '')
  }, [settings.imageSaveDir])

  const updateImageSaveDir = (value) => {
    setImageSaveDir(value)
    onChange({ imageSaveDir: value })
  }

  return (
    <main className='app-shell settings-shell'>
      <header className='topbar'>
        <div className='brand'>
          <button className='tool-btn back-btn' type='button' onClick={onBack} title='返回历史'>
            <Icon name='arrowLeft' />
          </button>
          <div className='logo'><Icon name='settings' /></div>
          <div>
            <div className='brand-title'>设置</div>
            <div className='brand-sub'>保存位置与插件行为</div>
          </div>
        </div>
      </header>

      <section className='settings-page'>
        <div className='settings-section'>
          <div>
            <h1>图片保存</h1>
            <p>右键图片记录选择“保存为文件”时，优先保存到这里；留空则每次弹出保存位置。</p>
          </div>
          <div className='setting-row'>
            <label htmlFor='image-save-dir'>默认保存目录</label>
            <div className='path-control'>
              <input
                id='image-save-dir'
                value={imageSaveDir}
                onChange={event => updateImageSaveDir(event.target.value)}
                placeholder='留空时每次选择保存位置'
              />
              <button type='button' onClick={onChooseImageSaveDir}>选择</button>
            </div>
          </div>
          <div className='settings-actions'>
            <button type='button' onClick={() => updateImageSaveDir('')}>清空目录</button>
            <button type='button' className='primary' onClick={() => onSave({ imageSaveDir })}>保存设置</button>
          </div>
        </div>

        <div className='settings-section'>
          <div>
            <h1>剪贴板监听</h1>
            <p>监听由插件预加载层持续运行，不依赖主窗口或侧栏是否打开。</p>
          </div>
          <div className='sync-status'>
            <span>{watchInfo?.clipboard ? '剪贴板 API 可用' : '剪贴板 API 不可用'}</span>
            <span>{watchInfo?.winFallback ? `Windows 兜底${watchInfo.winFallbackOk ? '可用' : '待验证'}` : '无系统兜底'}</span>
            <span>{watchInfo?.running ? '监听运行中' : '监听未运行'}</span>
            <span>最近轮询 {formatSyncTime(watchInfo?.lastTickAt)}</span>
            <span>最近捕获 {formatSyncTime(watchInfo?.lastCaptureAt)}</span>
            <span>兜底读取 {formatSyncTime(watchInfo?.winFallbackLastReadAt)}</span>
            <span>兜底类型 {formatWatchTypes(watchInfo?.winFallbackTypes)}</span>
            {watchInfo?.winFallbackTextSize && <span>兜底文本 {watchInfo.winFallbackTextSize}</span>}
            {watchInfo?.lastError && <span>错误：{watchInfo.lastError}</span>}
            {watchInfo?.winFallbackError && <span>兜底错误：{watchInfo.winFallbackError}</span>}
          </div>
          <div className='settings-actions'>
            <button type='button' onClick={onRestartWatch}>重启监听</button>
            <button type='button' className='primary' onClick={onReadClipboardNow}>读取当前剪贴板</button>
          </div>
        </div>

        <div className='settings-section'>
          <div>
            <h1>跨设备同步</h1>
            <p>跟随当前登录的 uTools 账号，通过 uTools 数据库同步能力合并多设备历史和收藏。图片内容默认不同步，避免云端数据过大。</p>
          </div>
          <div className='setting-grid'>
            <label className='toggle-row'>
              <input
                type='checkbox'
                checked={Boolean(settings.syncEnabled)}
                disabled={!syncAvailable}
                onChange={event => onChange({ syncEnabled: event.target.checked })}
              />
              <span>启用同步</span>
            </label>
            <label className='toggle-row'>
              <input
                type='checkbox'
                checked={Boolean(settings.syncHistory)}
                disabled={!settings.syncEnabled}
                onChange={event => onChange({ syncHistory: event.target.checked })}
              />
              <span>同步历史记录</span>
            </label>
            <label className='toggle-row'>
              <input
                type='checkbox'
                checked={Boolean(settings.syncFavorites)}
                disabled={!settings.syncEnabled}
                onChange={event => onChange({ syncFavorites: event.target.checked })}
              />
              <span>同步收藏记录</span>
            </label>
            <label className='toggle-row'>
              <input
                type='checkbox'
                checked={Boolean(settings.syncFiles)}
                disabled={!settings.syncEnabled}
                onChange={event => onChange({ syncFiles: event.target.checked })}
              />
              <span>同步文件路径</span>
            </label>
            <label className='toggle-row'>
              <input
                type='checkbox'
                checked={Boolean(settings.syncImages)}
                disabled={!settings.syncEnabled}
                onChange={event => onChange({ syncImages: event.target.checked })}
              />
              <span>同步图片内容</span>
            </label>
          </div>
          <div className='setting-row compact-setting'>
            <label htmlFor='sync-tombstone-days'>删除标记保留天数</label>
            <input
              id='sync-tombstone-days'
              type='number'
              min='7'
              max='365'
              step='1'
              value={settings.syncTombstoneDays || 90}
              disabled={!settings.syncEnabled}
              onChange={event => onChange({ syncTombstoneDays: Number(event.target.value) })}
            />
          </div>
          <div className='sync-status'>
            <span>{syncAvailable ? '当前环境支持 uTools 数据同步' : '当前环境不支持 uTools 数据同步'}</span>
            <span>{syncInfo?.user?.nickname ? `账号：${syncInfo.user.nickname}` : '未获取到 uTools 账号信息'}</span>
            <span>{syncState == null ? 'uTools 数据同步未开启' : syncState === 1 ? '云端复制中' : '云端复制完成'}</span>
            <span>{syncInfo?.dbPullListening ? '已监听云端拉取' : '未监听云端拉取'}</span>
            <span>本地 {syncInfo?.localCount || 0} 条</span>
            <span>云端 {syncInfo?.cloudCount || 0} 条</span>
            <span>云库总文档 {syncInfo?.totalDocCount || 0} 个</span>
            <span>同步文档 {syncInfo?.syncDocCount || 0} 个</span>
            <span>图片附件 {syncInfo?.attachmentCount || 0} 个</span>
            <span>删除标记 {syncInfo?.deletedCount || 0} 条</span>
            <span>{syncInfo?.hasMetaDoc ? '存在 meta 文档' : '没有 meta 文档'}</span>
            <span>{syncInfo?.hasGroupsDoc ? '存在分组文档' : '没有分组文档'}</span>
            <span>最近提交 {formatSyncTime(syncInfo?.lastSyncPushAt)}</span>
            <span>最近拉取 {formatSyncTime(syncInfo?.lastDbPullAt || syncInfo?.lastSyncPullAt)}</span>
            <span>云库最新 {formatSyncTime(syncInfo?.latestCloudUpdatedAt)}</span>
            <span>meta 提交 {formatSyncTime(syncInfo?.latestMetaPushedAt)}</span>
            <span>运行环境 {syncInfo?.isDev ? '开发模式' : '生产/导入模式'}</span>
            {syncInfo?.isDev && <span>开发模式与生产/导入模式不同步</span>}
            <span>uTools {syncInfo?.appVersion || '-'}</span>
            <span className='wide'>最新文档 {syncInfo?.latestCloudDocId || '-'}</span>
          </div>
          <div className='settings-actions'>
            <button type='button' disabled={!syncAvailable} onClick={onSyncSelfTest}>同步自检</button>
            <button type='button' disabled={!settings.syncEnabled || !syncAvailable} onClick={onSyncNow}>立即同步</button>
            <button type='button' className='primary' onClick={() => onSave(settings)}>保存设置</button>
          </div>
        </div>
      </section>
    </main>
  )
}

function MainApp ({ store }) {
  const shellRef = useRef(null)
  const historyListRef = useRef(null)
  const previewRef = useRef(null)
  const [filter, setFilter] = useState('all')
  const [favoriteGroup, setFavoriteGroup] = useState('全部')
  const [query, setQuery] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [moveGroup, setMoveGroup] = useState('常用')
  const [favoriteSort, setFavoriteSort] = useState('favoriteAt')
  const [menuOpen, setMenuOpen] = useState(false)
  const [favoriteMenuOpen, setFavoriteMenuOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, item: null })
  const [view, setView] = useState('history')
  const [settings, setSettings] = useState(() => window.services?.settings?.get?.() || { imageSaveDir: '' })
  const [syncState, setSyncState] = useState(() => window.services?.sync?.state?.())
  const [syncInfo, setSyncInfo] = useState(() => window.services?.sync?.info?.() || {})
  const [watchInfo, setWatchInfo] = useState(() => window.services?.watch?.status?.() || {})
  const syncAvailable = Boolean(window.services?.sync?.available?.())

  const visible = useFilteredItems(store.items, filter, favoriteGroup, query, favoriteSort)
  const selected = store.selected
  const favoriteTabs = ['全部', ...store.groups]
  const favoriteCount = store.items.filter(item => item.favorite).length
  const visibleKey = visible.map(item => item.id).join('|')

  useEffect(() => {
    if (!visible.some(item => item.id === store.selectedId)) {
      store.setSelectedId(visible[0]?.id || null)
    }
  }, [visible, store.selectedId])

  useEffect(() => {
    if (filter === 'favorite' && store.groups.includes(favoriteGroup)) {
      setRenameValue(favoriteGroup)
      setMoveGroup(favoriteGroup)
    } else {
      setRenameValue('')
      setMoveGroup(store.groups[0] || '常用')
    }
  }, [filter, favoriteGroup, store.groups])

  useEffect(() => {
    if (filter !== 'favorite') setFavoriteMenuOpen(false)
  }, [filter])

  useEffect(() => {
    if (view === 'settings') {
      setSyncState(window.services?.sync?.state?.())
      setSyncInfo(window.services?.sync?.info?.() || {})
      setWatchInfo(window.services?.watch?.status?.() || {})
    }
  }, [view])

  useEffect(() => {
    if (view !== 'settings') return
    const timer = setInterval(() => {
      setSyncState(window.services?.sync?.state?.())
      setSyncInfo(window.services?.sync?.info?.() || {})
      setWatchInfo(window.services?.watch?.status?.() || {})
    }, 1200)
    return () => clearInterval(timer)
  }, [view])

  useGSAP(() => {
    const reduced = prefersReducedMotion()
    const tl = gsap.timeline({
      defaults: {
        duration: reduced ? 0 : 0.24,
        ease: 'power2.out'
      }
    })

    tl.fromTo(
      '.topbar',
      { autoAlpha: 0, y: reduced ? 0 : -8 },
      { autoAlpha: 1, y: 0 }
    )
      .fromTo(
        '.filter-panel',
        { autoAlpha: 0, x: reduced ? 0 : -8 },
        { autoAlpha: 1, x: 0 },
        '<0.05'
      )
      .fromTo(
        '.preview-header, .preview-card, .properties',
        { autoAlpha: 0, y: reduced ? 0 : 8 },
        { autoAlpha: 1, y: 0, stagger: 0.04 },
        '<0.04'
      )
  }, { scope: shellRef })

  useGSAP(() => {
    const list = historyListRef.current
    if (!list) return

    const reduced = prefersReducedMotion()
    const items = Array.from(list.querySelectorAll('.history-item')).slice(0, 18)
    const empty = list.querySelector('.status-card')
    const targets = items.length ? items : empty ? [empty] : []
    if (!targets.length) return

    gsap.fromTo(
      targets,
      {
        autoAlpha: 0,
        y: reduced ? 0 : 8,
        willChange: 'transform, opacity'
      },
      {
        autoAlpha: 1,
        y: 0,
        duration: reduced ? 0 : 0.2,
        stagger: reduced ? 0 : 0.025,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility,willChange'
      }
    )
  }, { dependencies: [visibleKey], scope: historyListRef, revertOnUpdate: true })

  useGSAP(() => {
    const panel = previewRef.current
    if (!panel) return

    const reduced = prefersReducedMotion()
    const targets = [
      panel.querySelector('.preview-header h1'),
      ...panel.querySelectorAll('.preview-meta span'),
      panel.querySelector('.preview-card'),
      ...panel.querySelectorAll('.property')
    ].filter(Boolean)
    if (!targets.length) return

    gsap.fromTo(
      targets,
      {
        autoAlpha: 0,
        y: reduced ? 0 : 6,
        willChange: 'transform, opacity'
      },
      {
        autoAlpha: 1,
        y: 0,
        duration: reduced ? 0 : 0.2,
        stagger: reduced ? 0 : 0.025,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility,willChange'
      }
    )
  }, { dependencies: [selected?.id, selected?.favorite, selected?.favoriteGroup], scope: previewRef, revertOnUpdate: true })

  useGSAP(() => {
    if (filter !== 'favorite') return
    const reduced = prefersReducedMotion()
    gsap.fromTo(
      '.favorite-panel',
      { autoAlpha: 0, y: reduced ? 0 : -6 },
      { autoAlpha: 1, y: 0, duration: reduced ? 0 : 0.18, ease: 'power2.out' }
    )
  }, { dependencies: [filter], scope: shellRef, revertOnUpdate: true })

  const copyItem = (item = selected) => {
    if (!item) return
    window.services?.clipboard?.copyItem?.(item)
    store.setStatus(`已复制：${item.title}`)
  }

  const copyFilePath = (item = selected) => {
    if (!item) return
    const copied = window.services?.clipboard?.copyFilePaths?.(item)
    store.setStatus(copied === false ? '该记录没有可复制的文件路径' : `已复制文件路径：${item.title}`)
    setContextMenu({ open: false, x: 0, y: 0, item: null })
  }

  const saveImageAsFile = (item = selected) => {
    if (!item) return
    const result = window.services?.files?.saveImage?.(item)
    setContextMenu({ open: false, x: 0, y: 0, item: null })
    store.setStatus(result?.message || (result?.ok ? '图片已保存' : '图片保存失败'))
  }

  const saveSettings = (nextSettings) => {
    const merged = { ...settings, ...(nextSettings || {}) }
    window.services?.settings?.set?.(merged)
    setSettings(window.services?.settings?.get?.() || merged)
    setSyncState(window.services?.sync?.state?.())
    setSyncInfo(window.services?.sync?.info?.() || {})
    setWatchInfo(window.services?.watch?.status?.() || {})
    store.setStatus('设置已保存')
  }

  const chooseImageSaveDir = () => {
    const result = window.services?.settings?.chooseImageSaveDir?.()
    if (result?.ok) {
      setSettings(result.settings || window.services?.settings?.get?.() || settings)
      store.setStatus(`图片保存目录：${result.path}`)
    } else {
      store.setStatus(result?.message || '未选择保存目录')
    }
  }

  const syncNow = () => {
    saveSettings(settings)
    const result = window.services?.sync?.now?.()
    setSyncState(window.services?.sync?.state?.())
    setSyncInfo(window.services?.sync?.info?.() || {})
    setWatchInfo(window.services?.watch?.status?.() || {})
    store.refresh()
    store.setStatus(result?.message || (result?.ok ? '同步完成' : '同步失败'))
  }

  const syncSelfTest = () => {
    saveSettings(settings)
    const result = window.services?.sync?.selfTest?.()
    setSyncState(window.services?.sync?.state?.())
    setSyncInfo(window.services?.sync?.info?.() || {})
    setWatchInfo(window.services?.watch?.status?.() || {})
    store.setStatus(result?.message || (result?.ok ? '同步自检通过' : '同步自检失败'))
  }

  const restartWatch = () => {
    const ok = window.services?.watch?.restart?.(() => store.refresh())
    setWatchInfo(window.services?.watch?.status?.() || {})
    store.setStatus(ok ? '剪贴板监听已重启' : '当前环境不支持剪贴板监听')
  }

  const readClipboardNow = () => {
    const result = window.services?.watch?.captureNow?.()
    store.refresh()
    setWatchInfo(window.services?.watch?.status?.() || {})
    store.setStatus(result?.message || (result?.ok ? '已读取当前剪贴板' : '读取当前剪贴板失败'))
  }

  const toggleFavoriteItem = (item = selected) => {
    if (!item) return
    const next = !item.favorite
    const changedAt = Date.now()
    store.updateItem(item.id, {
      favorite: next,
      favoriteGroup: next ? (item.favoriteGroup || store.groups[0] || '常用') : '',
      favoriteAt: next ? (item.favoriteAt || changedAt) : 0,
      favoriteUpdatedAt: changedAt,
      updatedAt: changedAt
    })
    setContextMenu({ open: false, x: 0, y: 0, item: null })
  }

  const toggleFavorite = () => {
    toggleFavoriteItem(selected)
  }

  const deleteItem = (item) => {
    if (!item) return
    store.removeItem(item.id)
    store.setStatus(`已删除：${item.title}`)
    setMenuOpen(false)
    setContextMenu({ open: false, x: 0, y: 0, item: null })
  }

  const openContextMenu = (event, item) => {
    event.preventDefault()
    store.setSelectedId(item.id)
    setMenuOpen(false)
    setFavoriteMenuOpen(false)
    const width = 156
    const height = 76 + (canCopyFilePath(item) ? 36 : 0) + (canSaveAsFile(item) ? 36 : 0)
    const x = Math.min(event.clientX, Math.max(8, window.innerWidth - width - 8))
    const y = Math.min(event.clientY, Math.max(8, window.innerHeight - height - 8))
    setContextMenu({ open: true, x, y, item })
  }

  const createGroup = (event) => {
    event.preventDefault()
    const name = newGroup.trim()
    if (!name) return
    store.addGroup(name)
    setNewGroup('')
    setFilter('favorite')
    setFavoriteGroup(name)
    setFavoriteMenuOpen(false)
  }

  const clearHistory = () => {
    store.clearItems()
    store.setStatus('已清空剪贴板历史')
    setMenuOpen(false)
    setFavoriteMenuOpen(false)
    setContextMenu({ open: false, x: 0, y: 0, item: null })
  }

  const toggleSidebar = () => {
    store.setStatus(sidebarOpen ? '正在关闭侧栏...' : '正在打开侧栏...')
    const result = window.services?.window?.toggleSidebar?.() || window.services?.window?.openSidebar?.()
    const ok = typeof result === 'object' ? Boolean(result.ok) : Boolean(result)
    const open = typeof result === 'object' && 'open' in result ? Boolean(result.open) : ok
    setSidebarOpen(open)
    store.setStatus(
      typeof result === 'object'
        ? result.message
        : ok
          ? '正在打开侧栏到屏幕右侧。'
          : '当前环境不支持创建侧栏窗口，请在 uTools 中运行。'
    )
  }

  if (view === 'settings') {
    return (
      <>
        <SettingsPage
          settings={settings}
          syncAvailable={syncAvailable}
          syncState={syncState}
          syncInfo={syncInfo}
          watchInfo={watchInfo}
          onBack={() => setView('history')}
          onChange={patch => setSettings(current => ({ ...current, ...patch }))}
          onChooseImageSaveDir={chooseImageSaveDir}
          onRestartWatch={restartWatch}
          onReadClipboardNow={readClipboardNow}
          onSyncNow={syncNow}
          onSyncSelfTest={syncSelfTest}
          onSave={saveSettings}
        />
        <AnimatedStatus message={store.status} className='toast' />
      </>
    )
  }

  return (
    <main className='app-shell' ref={shellRef}>
      <header className='topbar'>
        <div className='brand'>
          <div className='logo'><Icon name='clipboard' /></div>
          <div>
            <div className='brand-title'>ClipDock</div>
            <div className='brand-sub'>uTools 插件</div>
          </div>
        </div>
        <label className='search'>
          <Icon name='search' />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索历史、来源、文件名或内容' />
        </label>
        <div className='topbar-actions'>
          <button className={`tool-btn ${sidebarOpen ? 'active' : ''}`} onClick={toggleSidebar} title={sidebarOpen ? '关闭吸附侧栏' : '打开吸附侧栏'}>
            <Icon name='panel' />
          </button>
          <button className='tool-btn' onClick={() => setView('settings')} title='设置'>
            <Icon name='settings' />
          </button>
        </div>
      </header>

      <div className='main-layout'>
        <aside className='left-pane'>
          <div className='filter-panel'>
            <div className='filter-list'>
              {formatFilters.map(item => (
                <button
                  key={item.key}
                  className={`chip filter-chip ${item.key === 'favorite' ? 'favorite-chip' : ''} ${item.key === filter ? 'active' : ''}`}
                  onClick={() => {
                    setFilter(item.key)
                    if (item.key !== 'favorite') setFavoriteGroup('全部')
                  }}
                >
                  {item.key === 'favorite' && <Icon name='star' size={13} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {filter === 'favorite' && (
              <div className='favorite-panel'>
                <div className='favorite-toolbar'>
                  <span className='favorite-count'>{favoriteCount} 条</span>
                  <div className='favorite-sort'>
                    <button
                      type='button'
                      className={favoriteSort === 'favoriteAt' ? 'active' : ''}
                      onClick={() => setFavoriteSort('favoriteAt')}
                    >收藏时间
                    </button>
                    <button
                      type='button'
                      className={favoriteSort === 'createdAt' ? 'active' : ''}
                      onClick={() => setFavoriteSort('createdAt')}
                    >复制时间
                    </button>
                  </div>
                  <form className='favorite-create' onSubmit={createGroup}>
                    <input value={newGroup} onChange={event => setNewGroup(event.target.value)} maxLength={8} placeholder='新分类' />
                    <button type='submit'>+</button>
                  </form>
                  <div className='favorite-menu'>
                    <button className='favorite-more' type='button' onClick={() => setFavoriteMenuOpen(!favoriteMenuOpen)} title='管理收藏分类'>
                      <Icon name='more' size={15} />
                    </button>
                    <AnimatedPopover open={favoriteMenuOpen} className='favorite-popover'>
                      <div className='favorite-row'>
                        <input
                          value={renameValue}
                          disabled={!store.groups.includes(favoriteGroup)}
                          onChange={event => setRenameValue(event.target.value)}
                          placeholder='重命名当前分类'
                        />
                        <button
                          type='button'
                          disabled={!store.groups.includes(favoriteGroup)}
                          onClick={() => {
                            store.renameGroup(favoriteGroup, renameValue.trim())
                            setFavoriteMenuOpen(false)
                          }}
                        >改名
                        </button>
                        <button
                          type='button' className='danger' disabled={!store.groups.includes(favoriteGroup)} onClick={() => {
                            store.deleteGroup(favoriteGroup)
                            setFavoriteGroup('全部')
                            setFavoriteMenuOpen(false)
                          }}
                        >删除
                        </button>
                      </div>
                      <div className='favorite-row compact'>
                        <select value={moveGroup} onChange={event => setMoveGroup(event.target.value)} disabled={!selected?.favorite}>
                          {store.groups.map(group => <option key={group} value={group}>{group}</option>)}
                        </select>
                        <button
                          type='button'
                          disabled={!selected?.favorite}
                          onClick={() => {
                            if (selected) {
                              const changedAt = Date.now()
                              store.updateItem(selected.id, { favoriteGroup: moveGroup, favoriteUpdatedAt: changedAt, updatedAt: changedAt })
                            }
                            setFavoriteMenuOpen(false)
                          }}
                        >移动
                        </button>
                      </div>
                    </AnimatedPopover>
                  </div>
                </div>
                <div className='favorite-tabs'>
                  {favoriteTabs.map(group => (
                    <button
                      key={group}
                      className={`chip ${group === favoriteGroup ? 'active' : ''}`}
                      onClick={() => {
                        setFavoriteGroup(group)
                        setFavoriteMenuOpen(false)
                      }}
                    >{group}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className='history-toolbar'>
              <span>{visible.length} / {store.items.length} 条</span>
              <button type='button' disabled={!store.items.length} onClick={clearHistory}>清空</button>
            </div>
          </div>

          <div className='history-list' ref={historyListRef}>
            {visible.map(item => (
              <HistoryItem
                key={item.id}
                item={item}
                active={item.id === store.selectedId}
                onClick={() => store.setSelectedId(item.id)}
                onDoubleClick={event => {
                  pulseHistoryTarget(event.currentTarget)
                  copyItem(item)
                }}
                onContextMenu={event => openContextMenu(event, item)}
              />
            ))}
            {!visible.length && <div className='status-card'>没有匹配的剪贴板记录。</div>}
          </div>
        </aside>

        <section className='right-pane' ref={previewRef}>
          <div className='preview-header'>
            <div>
              <h1>{selected?.title || '没有选中的记录'}</h1>
              {selected && (
                <div className='preview-meta'>
                  <span className='type-pill'>{formatName(selected)}</span>
                  <span>{selected.favorite ? `收藏：${selected.favoriteGroup || '常用'}` : '未收藏'}</span>
                  <span>{formatRelativeTime(selected.createdAt)}</span>
                  <span>{selected.source}</span>
                </div>
              )}
            </div>
            <div className='preview-actions'>
              <div className='action-menu'>
                <button className='action-btn icon-btn' onClick={() => setMenuOpen(!menuOpen)}><Icon name='more' size={15} /></button>
                <AnimatedPopover open={menuOpen} className='action-popover'>
                  <button onClick={toggleFavorite}>{selected?.favorite ? '取消收藏' : '收藏'}</button>
                  <button
                    className='danger'
                    onClick={() => {
                      deleteItem(selected)
                    }}
                  >删除
                  </button>
                </AnimatedPopover>
              </div>
            </div>
          </div>
          <div className='preview-body'><div className='preview-card'><Preview item={selected} /></div></div>
          <div className='properties'>
            {selected && [
              ['格式', formatName(selected)],
              ['大小', selected.size || '-'],
              ['来源', selected.source || '-'],
              ...(selected.url ? [['链接', selected.url]] : []),
              ...(selected.filePath ? [['文件', selected.filePath]] : []),
              ...(selected.type === 'image' && selected.attachmentId ? [['云端附件', selected.hasSyncedAttachment ? '已同步' : '未同步']] : []),
              ['收藏分类', selected.favorite ? selected.favoriteGroup || '常用' : '未收藏']
            ].map(([label, value]) => (
              <div className='property' key={label}>
                <div className='property-label'>{label}</div>
                <div className='property-value'>{value}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <HistoryContextMenu
        state={contextMenu}
        onClose={() => setContextMenu({ open: false, x: 0, y: 0, item: null })}
        onCopy={(item) => {
          copyItem(item)
          setContextMenu({ open: false, x: 0, y: 0, item: null })
        }}
        onCopyFilePath={copyFilePath}
        onSaveAsFile={saveImageAsFile}
        onToggleFavorite={toggleFavoriteItem}
        onDelete={deleteItem}
      />
      <AnimatedStatus message={store.status} className='toast' />
    </main>
  )
}

function SidebarApp ({ store }) {
  const dockRef = useRef(null)
  const sidebarItemsRef = useRef(null)
  const collapseTimerRef = useRef(null)
  const expandTimerRef = useRef(null)
  const itemClickTimerRef = useRef(null)
  const expandLockUntilRef = useRef(0)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [dockState, setDockState] = useState(() => window.services?.dock?.getState?.() || { mode: 'rail', side: 'right', pinned: false })
  const [dragging, setDragging] = useState(false)
  const visible = useFilteredItems(store.items, filter, '全部', query)
  const selected = store.selected
  const collapsed = dockState.mode === 'rail'
  const floating = dockState.mode === 'floating'
  const side = dockState.side === 'right' ? 'right' : 'left'
  const filterKey = `${filter}:${query.trim().toLowerCase()}`

  useEffect(() => {
    document.documentElement.classList.add('dock-sidebar-page')
    document.body.classList.add('dock-sidebar-body')
    document.documentElement.classList.toggle('dock-collapsed-page', collapsed)
    document.body.classList.toggle('dock-collapsed-body', collapsed)

    return () => {
      document.documentElement.classList.remove('dock-sidebar-page', 'dock-collapsed-page')
      document.body.classList.remove('dock-sidebar-body', 'dock-collapsed-body')
    }
  }, [collapsed])

  useEffect(() => {
    return window.services?.dock?.onState?.(setDockState)
  }, [])

  useEffect(() => {
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current)
      if (itemClickTimerRef.current) clearTimeout(itemClickTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!visible.some(item => item.id === store.selectedId)) {
      store.setSelectedId(visible[0]?.id || null)
    }
  }, [visible, store.selectedId])

  useGSAP(() => {
    const root = dockRef.current
    if (!root) return

    const reduced = prefersReducedMotion()

    if (collapsed) {
      const handle = root.querySelector('.dock-rail-handle')
      if (!handle) return
      gsap.killTweensOf(handle)
      gsap.set(handle, {
        autoAlpha: 1,
        x: 0,
        scaleX: 1,
        transformOrigin: side === 'right' ? 'right center' : 'left center',
        clearProps: 'transform,opacity,visibility,willChange'
      })
      return
    }

    const panel = root.querySelector('.dock-runtime-panel')
    if (!panel) return
    const direction = side === 'right' ? 1 : -1

    const tl = gsap.timeline({
      defaults: {
        duration: reduced ? 0 : 0.2,
        ease: 'power2.out'
      }
    })

    tl.fromTo(
      panel,
      {
        autoAlpha: 0,
        x: floating || reduced ? 0 : 14 * direction,
        scale: floating && !reduced ? 0.985 : 1,
        willChange: 'transform, opacity'
      },
      {
        autoAlpha: 1,
        x: 0,
        scale: 1,
        clearProps: 'transform,opacity,visibility,willChange'
      }
    )
      .fromTo(
        panel.querySelectorAll('.grabbar, .sidebar-search'),
        { autoAlpha: 0, y: reduced ? 0 : -6 },
        { autoAlpha: 1, y: 0, stagger: reduced ? 0 : 0.035 },
        '<0.04'
      )
  }, { dependencies: [collapsed, floating, side], scope: dockRef, revertOnUpdate: true })

  useGSAP(() => {
    const list = sidebarItemsRef.current
    if (!list || collapsed) return

    const reduced = prefersReducedMotion()
    const items = Array.from(list.querySelectorAll('.history-item')).slice(0, 14)
    const empty = list.querySelector('.status-card')
    const targets = items.length ? items : empty ? [empty] : []
    if (!targets.length) return

    gsap.fromTo(
      targets,
      {
        autoAlpha: 0,
        y: reduced ? 0 : 7,
        willChange: 'transform, opacity'
      },
      {
        autoAlpha: 1,
        y: 0,
        duration: reduced ? 0 : 0.18,
        stagger: reduced ? 0 : 0.022,
        ease: 'power2.out',
        clearProps: 'transform,opacity,visibility,willChange'
      }
    )
  }, { dependencies: [filterKey, collapsed], scope: sidebarItemsRef, revertOnUpdate: true })

  const copyItem = (item = selected) => {
    if (!item) return
    window.services?.clipboard?.copyItem?.(item)
    store.setStatus(`已复制：${item.title}`)
  }

  const pasteItem = (item = selected) => {
    if (!item) return
    const pasted = window.services?.clipboard?.pasteItem?.(item)
    store.setStatus(pasted === false ? `已复制：${item.title}` : `已粘贴：${item.title}`)
  }

  const clearItemClickTimer = () => {
    if (!itemClickTimerRef.current) return
    clearTimeout(itemClickTimerRef.current)
    itemClickTimerRef.current = null
  }

  const schedulePasteItem = (item) => {
    clearItemClickTimer()
    itemClickTimerRef.current = setTimeout(() => {
      itemClickTimerRef.current = null
      pasteItem(item)
    }, 180)
  }

  const updateDock = (patch) => {
    window.services?.dock?.setState?.({ ...dockState, ...patch })
  }

  const clearCollapseTimer = () => {
    if (!collapseTimerRef.current) return
    clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }

  const clearExpandTimer = () => {
    if (!expandTimerRef.current) return
    clearTimeout(expandTimerRef.current)
    expandTimerRef.current = null
  }

  const togglePin = () => {
    const pinned = !dockState.pinned
    updateDock({
      pinned,
      mode: pinned ? 'expanded' : 'rail'
    })
  }

  const undock = () => {
    updateDock({
      mode: 'floating',
      pinned: true
    })
  }

  const expandFromRail = () => {
    if (!collapsed) return
    clearExpandTimer()
    clearCollapseTimer()
    expandLockUntilRef.current = Date.now() + 700
    updateDock({ mode: 'expanded', pinned: false })
  }

  const scheduleExpandFromRail = () => {
    if (!collapsed || expandTimerRef.current) return
    clearCollapseTimer()
    expandTimerRef.current = setTimeout(() => {
      expandTimerRef.current = null
      expandLockUntilRef.current = Date.now() + 700
      updateDock({ mode: 'expanded', pinned: false })
    }, 120)
  }

  const collapseIfNeeded = () => {
    clearExpandTimer()
    if (collapsed || dockState.pinned || dragging || floating) return
    if (Date.now() < expandLockUntilRef.current) return
    clearCollapseTimer()
    collapseTimerRef.current = setTimeout(() => {
      updateDock({ mode: 'rail' })
      collapseTimerRef.current = null
    }, 180)
  }

  const pointerPoint = (event) => ({
    screenX: event.screenX,
    screenY: event.screenY
  })

  const startDrag = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    window.services?.dock?.startDrag?.(pointerPoint(event))
  }

  const moveDrag = (event) => {
    if (!dragging) return
    window.services?.dock?.moveDrag?.(pointerPoint(event))
  }

  const endDrag = (event) => {
    if (!dragging) return
    setDragging(false)
    window.services?.dock?.endDrag?.(pointerPoint(event))
  }

  return (
    <main
      className={`dock-runtime ${side} ${collapsed ? 'collapsed' : ''} ${floating ? 'floating' : ''}`}
      ref={dockRef}
      onMouseEnter={clearCollapseTimer}
      onMouseLeave={collapseIfNeeded}
    >
      {collapsed
        ? (
          <button
            className='dock-rail-handle'
            onMouseEnter={scheduleExpandFromRail}
            onMouseLeave={clearExpandTimer}
            onFocus={scheduleExpandFromRail}
            onBlur={clearExpandTimer}
            onClick={expandFromRail}
            aria-label='展开剪贴板侧栏'
          >
            <span className='rail-cap' aria-hidden='true'>
              <span className='rail-mark' />
              <span className='rail-grip'>
                <span />
                <span />
                <span />
              </span>
              <span className='rail-dot' />
            </span>
          </button>
          )
        : (
          <aside className='dock-runtime-panel'>
            <div
              className='grabbar'
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div><Icon name='more' size={15} />最近剪贴板</div>
              <div className='dock-controls'>
                <button
                  className={`pin-btn ${dockState.pinned ? 'active' : ''}`}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={togglePin}
                  title={dockState.pinned ? '取消固定并收起' : '固定展开'}
                >
                  <Icon name='pin' size={15} />
                </button>
                <button
                  className={`pin-btn ${floating ? 'active' : ''}`}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={undock}
                  title='取消吸附，改为浮动窗口'
                >
                  <Icon name='undock' size={15} />
                </button>
              </div>
            </div>
            <div className='sidebar-search'>
              <label className='search'>
                <Icon name='search' />
                <input value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索剪贴板' />
              </label>
              <div className='sidebar-filters'>
                {sidebarFilters.map(item => (
                  <button
                    key={item.key}
                    className={`chip ${item.key === 'favorite' ? 'favorite-chip' : ''} ${item.key === filter ? 'active' : ''}`}
                    onClick={() => setFilter(item.key)}
                  >
                    {item.key === 'favorite' && <Icon name='star' size={13} />}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className='sidebar-items' ref={sidebarItemsRef}>
              {visible.map(item => (
                <HistoryItem
                  key={item.id}
                  item={item}
                  compact
                  active={item.id === store.selectedId}
                  onClick={() => {
                    store.setSelectedId(item.id)
                    schedulePasteItem(item)
                  }}
                  onDoubleClick={event => {
                    clearItemClickTimer()
                    pulseHistoryTarget(event.currentTarget)
                    copyItem(item)
                  }}
                />
              ))}
              {!visible.length && <div className='status-card'>没有匹配的剪贴板记录。</div>}
            </div>
            <AnimatedStatus message={store.status} className='dock-status' />
          </aside>
          )}
    </main>
  )
}

export default function App () {
  const store = useClipboardStore()
  return isSidebarWindow ? <SidebarApp store={store} /> : <MainApp store={store} />
}
