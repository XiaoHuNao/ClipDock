import { useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)
gsap.defaults({ duration: 0.22, ease: 'power2.out' })

const isSidebarWindow = new URLSearchParams(window.location.search).get('view') === 'sidebar'

function prefersReducedMotion () {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
}

const fallbackItems = [
  {
    id: 'demo-1',
    type: 'text',
    title: '会议纪要 - 剪贴板侧栏交互',
    preview: '确认第一版范围：文本、图片、文件历史；主窗口左侧历史，右侧预览。',
    content: '确认第一版范围：\n\n1. 文本、图片、文件历史。\n2. 主窗口左侧历史，右侧预览。\n3. 收藏与分类。\n4. 侧边栏吸附，悬浮展开。\n5. 双击记录复制到系统剪贴板。',
    source: '示例',
    size: '1.8 KB',
    createdAt: Date.now() - 2 * 60 * 1000,
    favorite: true,
    favoriteGroup: '常用'
  },
  {
    id: 'demo-2',
    type: 'image',
    title: 'screenshot_2026-06-26.png',
    preview: '1280 x 720 PNG，来自截图工具',
    content: '',
    source: 'Snipaste',
    size: '418 KB',
    createdAt: Date.now() - 8 * 60 * 1000,
    favorite: false,
    favoriteGroup: ''
  },
  {
    id: 'demo-3',
    type: 'file',
    title: '产品资料文件组',
    preview: '需求说明.docx / 界面截图.png / 导入模板.xlsx',
    content: '',
    files: ['D:\\Projects\\clipboard\\docs\\需求说明.docx', 'D:\\Projects\\clipboard\\docs\\界面截图.png', 'D:\\Projects\\clipboard\\docs\\导入模板.xlsx'],
    source: '资源管理器',
    size: '3 个文件',
    createdAt: Date.now() - 18 * 60 * 1000,
    favorite: false,
    favoriteGroup: ''
  },
  {
    id: 'demo-4',
    type: 'code',
    title: 'JSON 配置片段',
    preview: '{ "capture": true, "maxHistory": 500 }',
    content: '{\n  "capture": true,\n  "maxHistory": 500,\n  "autoCleanDays": 30,\n  "formats": ["text", "image", "file", "code"]\n}',
    source: 'Cursor',
    size: '620 B',
    createdAt: Date.now() - 2 * 60 * 60 * 1000,
    favorite: true,
    favoriteGroup: '常用'
  }
]

if (!window.services) {
  const fallbackDockMode = new URLSearchParams(window.location.search).get('dock') || 'rail'
  const fallbackDockState = fallbackDockMode === 'expanded'
    ? { mode: 'expanded', side: 'right', pinned: false }
    : { mode: 'rail', side: 'right', pinned: false }
  let fallbackSidebarWindow = null
  const memory = {
    items: fallbackItems,
    groups: ['常用']
  }
  window.services = {
    captureEnter: () => null,
    history: {
      getAll: () => memory.items,
      saveAll: (items) => { memory.items = items },
      add: (item) => {
        memory.items = [{ id: `dev-${Date.now()}`, createdAt: Date.now(), ...item }, ...memory.items]
      },
      onChange: () => () => {},
      clear: () => { memory.items = [] }
    },
    groups: {
      getAll: () => memory.groups,
      saveAll: (groups) => { memory.groups = groups }
    },
    watch: {
      start: () => false,
      stop: () => false
    },
    clipboard: {
      copyItem: (item) => navigator.clipboard?.writeText?.(item.content || item.preview || '')
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
  { key: 'image', label: '图片' },
  { key: 'file', label: '文件' },
  { key: 'code', label: '代码' },
  { key: 'favorite', label: '收藏' }
]

const sidebarFilters = formatFilters.filter(item => item.key !== 'favorite')

const icons = {
  text: <><path d='M5 5h14' /><path d='M5 12h14' /><path d='M5 19h10' /></>,
  image: <><rect x='4' y='5' width='16' height='14' rx='2' /><path d='m7 16 4-4 3 3 2-2 3 3' /><circle cx='9' cy='9' r='1' /></>,
  file: <><path d='M7 3h7l5 5v13H7z' /><path d='M14 3v5h5' /></>,
  code: <><path d='m8 9-4 3 4 3' /><path d='m16 9 4 3-4 3' /><path d='m14 5-4 14' /></>,
  star: <path d='m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3z' />,
  clipboard: <><path d='M9 4h6l1 2h3v15H5V6h3l1-2z' /><path d='M9 10h6' /><path d='M9 14h6' /><path d='M9 18h4' /></>,
  search: <><circle cx='11' cy='11' r='7' /><path d='m20 20-3.2-3.2' /></>,
  panel: <><path d='M4 5h16v14H4z' /><path d='M8 5v14' /></>,
  more: <><circle cx='5' cy='12' r='1' /><circle cx='12' cy='12' r='1' /><circle cx='19' cy='12' r='1' /></>,
  pin: <path d='m15 4 5 5-4 4v5l-2 2-5-5-4 4-1-1 4-4-5-5 2-2h5z' />,
  undock: <><path d='M8 7H5v12h12v-3' /><path d='M12 5h7v7' /><path d='m19 5-8 8' /></>
}

function Icon ({ name, size = 18 }) {
  return (
    <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' width={size} height={size} aria-hidden='true'>
      {icons[name] || icons.text}
    </svg>
  )
}

function typeName (type) {
  return { text: '文本', image: '图片', file: '文件', code: '代码' }[type] || type
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

function createTitle (item) {
  if (item.title) return item.title
  const content = String(item.content || item.preview || '')
  if (item.type === 'image') return '剪贴板图片'
  if (item.type === 'file') return item.files?.length > 1 ? '文件组' : item.files?.[0]?.split(/[\\/]/).pop() || '文件'
  return content.split(/\r?\n/)[0].slice(0, 32) || '剪贴板记录'
}

function normalizeItems (items) {
  return (Array.isArray(items) && items.length ? items : fallbackItems).map(item => ({
    favorite: false,
    favoriteGroup: '',
    ...item,
    title: createTitle(item),
    preview: item.preview || String(item.content || '').slice(0, 120),
    createdAt: item.createdAt || Date.now()
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
    refresh()
    window.services?.watch?.start?.(() => refresh())
    const offHistoryChange = window.services?.history?.onChange?.(() => refresh())
    window.utools?.onPluginEnter?.((action) => {
      window.utools?.setExpendHeight?.(680)
      window.services?.captureEnter?.(action)
      refresh()
    })
    window.utools?.onPluginOut?.(() => {
      window.services?.watch?.stop?.()
    })
    return () => {
      offHistoryChange?.()
      window.services?.watch?.stop?.()
    }
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(''), 2200)
    return () => clearTimeout(timer)
  }, [status])

  const commitItems = (nextItems) => {
    setItems(nextItems)
    window.services?.history?.saveAll?.(nextItems)
  }

  const commitGroups = (nextGroups) => {
    const cleaned = Array.from(new Set(nextGroups.map(x => x.trim()).filter(Boolean)))
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
      commitItems(items.map(item => item.id === id ? { ...item, ...patch } : item))
    },
    removeItem (id) {
      commitItems(items.filter(item => item.id !== id))
    },
    addGroup (name) {
      if (!name || groups.includes(name)) return
      commitGroups([...groups, name])
    },
    renameGroup (oldName, nextName) {
      if (!oldName || !nextName || groups.includes(nextName)) return
      commitGroups(groups.map(group => group === oldName ? nextName : group))
      commitItems(items.map(item => item.favoriteGroup === oldName ? { ...item, favoriteGroup: nextName } : item))
    },
    deleteGroup (name) {
      if (!name) return
      const nextGroups = groups.filter(group => group !== name)
      const fallback = nextGroups[0] || '常用'
      commitGroups(nextGroups.length ? nextGroups : [fallback])
      commitItems(items.map(item => item.favoriteGroup === name ? { ...item, favoriteGroup: fallback } : item))
    }
  }
}

function useFilteredItems (items, filter, favoriteGroup, query) {
  return useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(item => {
      if (filter === 'favorite') {
        if (!item.favorite) return false
        if (favoriteGroup !== '全部' && item.favoriteGroup !== favoriteGroup) return false
      } else if (filter !== 'all' && item.type !== filter) {
        return false
      }
      if (!q) return true
      return [item.title, item.preview, item.content, item.source, item.favoriteGroup].filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [items, filter, favoriteGroup, query])
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

function HistoryItem ({ item, active, compact, onClick, onDoubleClick }) {
  return (
    <button className={`history-item ${compact ? 'compact' : ''} ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onDoubleClick}>
      <span className={`type-icon ${item.type}`}><Icon name={item.type} /></span>
      <span className='item-main'>
        <span className='item-title'>{item.title}</span>
        <span className='item-preview'>{item.preview}</span>
        <span className='item-meta'>
          <span>{typeName(item.type)}</span>
          {item.favorite && <span>{item.favoriteGroup || '常用'}</span>}
          <span>{formatRelativeTime(item.createdAt)}</span>
        </span>
      </span>
      <span className='star'>{item.favorite && <Icon name='star' size={16} />}</span>
    </button>
  )
}

function Preview ({ item }) {
  if (!item) {
    return <div className='empty-preview'>没有选中的记录</div>
  }

  if (item.type === 'image') {
    return (
      <div className='image-preview'>
        {item.content
          ? <img src={item.content} alt={item.title} />
          : <div className='mock-image' role='img' aria-label='图片预览' />}
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

  return <pre className='text-preview'>{item.content || item.preview}</pre>
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [favoriteMenuOpen, setFavoriteMenuOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const visible = useFilteredItems(store.items, filter, favoriteGroup, query)
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

  const toggleFavorite = () => {
    if (!selected) return
    const next = !selected.favorite
    store.updateItem(selected.id, {
      favorite: next,
      favoriteGroup: next ? (selected.favoriteGroup || store.groups[0] || '常用') : ''
    })
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
        <button className={`tool-btn ${sidebarOpen ? 'active' : ''}`} onClick={toggleSidebar} title={sidebarOpen ? '关闭吸附侧栏' : '打开吸附侧栏'}>
          <Icon name='panel' />
        </button>
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
                            if (selected) store.updateItem(selected.id, { favoriteGroup: moveGroup })
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
                  <span className='type-pill'>{typeName(selected.type)}</span>
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
                      if (selected) store.removeItem(selected.id)
                      setMenuOpen(false)
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
              ['格式', typeName(selected.type)],
              ['大小', selected.size || '-'],
              ['来源', selected.source || '-'],
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
      <AnimatedStatus message={store.status} className='toast' />
    </main>
  )
}

function SidebarApp ({ store }) {
  const dockRef = useRef(null)
  const sidebarItemsRef = useRef(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [dockState, setDockState] = useState(() => window.services?.dock?.getState?.() || { mode: 'rail', side: 'right', pinned: false })
  const [dragging, setDragging] = useState(false)
  const visible = useFilteredItems(store.items, filter, '全部', query)
  const selected = store.selected
  const collapsed = dockState.mode === 'rail'
  const floating = dockState.mode === 'floating'
  const side = dockState.side === 'right' ? 'right' : 'left'
  const visibleKey = visible.map(item => item.id).join('|')

  useEffect(() => {
    return window.services?.dock?.onState?.(setDockState)
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
    const direction = side === 'right' ? 1 : -1

    if (collapsed) {
      const handle = root.querySelector('.dock-rail-handle')
      if (!handle) return
      gsap.fromTo(
        handle,
        {
          autoAlpha: 0,
          x: reduced ? 0 : 10 * direction,
          scaleX: reduced ? 1 : 0.92,
          transformOrigin: side === 'right' ? 'right center' : 'left center',
          willChange: 'transform, opacity'
        },
        {
          autoAlpha: 1,
          x: 0,
          scaleX: 1,
          duration: reduced ? 0 : 0.18,
          ease: 'power2.out',
          clearProps: 'transform,opacity,visibility,willChange'
        }
      )
      return
    }

    const panel = root.querySelector('.dock-runtime-panel')
    if (!panel) return

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
  }, { dependencies: [visibleKey, collapsed], scope: sidebarItemsRef, revertOnUpdate: true })

  const copyItem = (item = selected) => {
    if (!item) return
    window.services?.clipboard?.copyItem?.(item)
    store.setStatus(`已复制：${item.title}`)
  }

  const updateDock = (patch) => {
    window.services?.dock?.setState?.({ ...dockState, ...patch })
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
    updateDock({ mode: 'expanded', pinned: false })
  }

  const collapseIfNeeded = () => {
    if (dockState.pinned || dragging || floating) return
    updateDock({ mode: 'rail' })
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
      onMouseEnter={expandFromRail}
      onMouseLeave={collapseIfNeeded}
    >
      {collapsed
        ? (
          <button className='dock-rail-handle' onClick={expandFromRail} aria-label='展开剪贴板侧栏'>
            <span />
            <span />
            <span />
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
                  <button key={item.key} className={`chip ${item.key === filter ? 'active' : ''}`} onClick={() => setFilter(item.key)}>{item.label}</button>
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
                  onClick={() => store.setSelectedId(item.id)}
                  onDoubleClick={event => {
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
