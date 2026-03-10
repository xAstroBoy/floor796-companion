// ==UserScript==
// @name         Floor796 Companion
// @namespace    https://github.com/floor796-companion
// @version      6.1.0
// @description  Companion overlay for floor796.com — phonebook, navigation, hologram control, animation controller, quest helpers, map explorer. Community-built reference tool.
// @match        https://floor796.com/*
// @match        https://www.floor796.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      floor796.com
// @connect      static.floor796.com
// @updateURL    https://raw.githubusercontent.com/xAstroBoy/floor796-companion/master/floor796-companion.user.js
// @downloadURL  https://raw.githubusercontent.com/xAstroBoy/floor796-companion/master/floor796-companion.user.js
// @run-at       document-start
// ==/UserScript==

;(function () {
  'use strict'

  // Only run on the main floor796 page, not inside interactive minigames/popups
  // (e.g. /data/interactive/racer796/index.html)
  if (window.location.pathname !== '/') return

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 0 ─ EARLY TRAFFIC HOOKS  (MUST run before ANY other code)
  //
  //  These patch fetch / XHR / WebSocket / BroadcastChannel on unsafeWindow
  //  the instant the IIFE body begins executing at document-start.
  //  Everything here is self-contained — no dependency on log(), config,
  //  _melodyForceData, etc.  Those get wired in later via _hookBridge.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Data structures (used everywhere, defined first) ───────────────────
  const trafficLog = []
  const MAX_TRAFFIC_LOG = 500
  const intercepted = {
    changelog: null,
    matrix: null,
    addonResponses: new Map(),
    phoneResults: [],
    questTunerResults: [],
    questGemsResults: [],
    statData: null,
    wsMessages: [],
    renderJsLoaded: new Map(),
    frontJsSource: null,
    totalIntercepted: 0
  }

  function logTraffic (method, url, status, size, type) {
    const entry = { ts: Date.now(), method, url, status, size, type }
    trafficLog.push(entry)
    if (trafficLog.length > MAX_TRAFFIC_LOG) trafficLog.shift()
    return entry
  }

  // Bridge object: late-bound references to things defined in later sections.
  // Section 5 wires them after those sections are parsed.
  const _hookBridge = {
    log: function () {}, // → log() from Section 1
    onDataIntercepted: function () {}, // → onDataIntercepted() from Section 6
    getMelodyForceData: function () {
      return null
    },
    clearMelodyForceData: function () {}
  }

  // ── Save originals ────────────────────────────────────────────────────────
  const _origFetch = unsafeWindow.fetch
  const _origXHROpen = unsafeWindow.XMLHttpRequest.prototype.open
  const _origXHRSend = unsafeWindow.XMLHttpRequest.prototype.send
  const _origWS = unsafeWindow.WebSocket
  const _origBC = unsafeWindow.BroadcastChannel

  // ── FETCH HOOK ─────────────────────────────────────────────────────────────
  unsafeWindow.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
    const method = (args[1]?.method || 'GET').toUpperCase()

    // Melody force-render intercept
    if (/\/addon\/melody\/f796-custom\b/.test(url)) {
      const data = _hookBridge.getMelodyForceData()
      if (data) {
        _hookBridge.clearMelodyForceData()
        const fakeJson = JSON.stringify(data)
        logTraffic('GET', url, 200, fakeJson.length, 'melody-fake')
        return Promise.resolve(
          new Response(fakeJson, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      }
    }

    return _origFetch
      .apply(this, args)
      .then(response => {
        try {
          const ct = response.headers?.get('content-type') || ''
          const urlPath = url.replace(/^https?:\/\/[^/]+/, '')

          logTraffic(
            method,
            urlPath,
            response.status,
            0,
            ct.split(';')[0] || 'unknown'
          )
          intercepted.totalIntercepted++

          // ── Changelog ──
          if (/changelog.*\.json/.test(url)) {
            response
              .clone()
              .json()
              .then(d => {
                _hookBridge.log(
                  `🔍 Intercepted: changelog (${
                    Array.isArray(d) ? d.length : '?'
                  } items)`
                )
                intercepted.changelog = d
                _hookBridge.onDataIntercepted()
              })
              .catch(() => {})
          }
          // ── Matrix ──
          else if (/matrix\.json/.test(url)) {
            response
              .clone()
              .json()
              .then(d => {
                _hookBridge.log(
                  `🔍 Intercepted: matrix (ver=${d?.ver}, ${
                    d?.addons?.length || 0
                  } addons)`
                )
                intercepted.matrix = d
                _hookBridge.onDataIntercepted()
              })
              .catch(() => {})
          }
          // ── Addon API responses ──
          else if (/\/addon\//.test(urlPath)) {
            response
              .clone()
              .text()
              .then(text => {
                intercepted.addonResponses.set(urlPath, {
                  text,
                  method,
                  ts: Date.now()
                })
                try {
                  const d = JSON.parse(text)
                  if (/\/phone\/check/.test(urlPath) && d) {
                    intercepted.phoneResults.push({ ...d, ts: Date.now() })
                    if (d.result && d.file)
                      _hookBridge.log(`📞 Phone hit intercepted: ${d.file}`)
                  } else if (/\/quest-tuner\/check/.test(urlPath) && d) {
                    intercepted.questTunerResults.push({ ...d, ts: Date.now() })
                    if (d.result && d.token)
                      _hookBridge.log(
                        `🔧 Quest-tuner token intercepted: ${d.token}`
                      )
                  } else if (/\/quest-gems\/unlock/.test(urlPath) && d) {
                    intercepted.questGemsResults.push({ ...d, ts: Date.now() })
                    if (d.result && d.token)
                      _hookBridge.log(
                        `💎 Quest-gems token intercepted: ${d.token}`
                      )
                  } else if (
                    /\/(random-list|list|search|changes)/.test(urlPath)
                  ) {
                    _hookBridge.log(
                      `📝 Addon data intercepted: ${urlPath} (${text.length} bytes)`
                    )
                  }
                } catch {
                  /* not JSON */
                }
              })
              .catch(() => {})
          }
          // ── Render JS ──
          else if (/\/interactive\/.*\.js/.test(urlPath)) {
            response
              .clone()
              .text()
              .then(code => {
                intercepted.renderJsLoaded.set(urlPath, {
                  code,
                  ts: Date.now()
                })
                _hookBridge.log(
                  `🎭 Render JS intercepted: ${urlPath} (${code.length} chars)`
                )
              })
              .catch(() => {})
          }
          // ── User / Subs API ──
          else if (/\/user\//.test(urlPath) || /\/subs\//.test(urlPath)) {
            response
              .clone()
              .text()
              .then(text => {
                intercepted.addonResponses.set(urlPath, {
                  text,
                  method,
                  ts: Date.now()
                })
                _hookBridge.log(`🔐 User API intercepted: ${method} ${urlPath}`)
              })
              .catch(() => {})
          }
          // ── Data files ──
          else if (/\/data\//.test(urlPath)) {
            _hookBridge.log(`📁 Data file intercepted: ${urlPath}`)
          }
          // ── Workers / WASM ──
          else if (/\/workers\//.test(urlPath)) {
            _hookBridge.log(`⚙️ Worker intercepted: ${urlPath}`)
          }
        } catch {
          /* silent */
        }
        return response
      })
      .catch(err => {
        logTraffic(method, url, 0, 0, 'error')
        throw err
      })
  }

  // ── XHR HOOK ───────────────────────────────────────────────────────────────
  unsafeWindow.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._f796_url = url
    this._f796_method = method
    return _origXHROpen.call(this, method, url, ...rest)
  }
  unsafeWindow.XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this._f796_url || ''
        const method = (this._f796_method || 'GET').toUpperCase()
        const urlPath = url.replace(/^https?:\/\/[^/]+/, '')
        logTraffic(
          method,
          urlPath,
          this.status,
          (this.responseText || '').length,
          'xhr'
        )
        intercepted.totalIntercepted++

        if (/changelog.*\.json/.test(url)) {
          const d = JSON.parse(this.responseText)
          _hookBridge.log(
            `🔍 XHR intercepted: changelog (${
              Array.isArray(d) ? d.length : '?'
            } items)`
          )
          intercepted.changelog = d
          _hookBridge.onDataIntercepted()
        } else if (/matrix\.json/.test(url)) {
          const d = JSON.parse(this.responseText)
          _hookBridge.log(`🔍 XHR intercepted: matrix (ver=${d?.ver})`)
          intercepted.matrix = d
          _hookBridge.onDataIntercepted()
        } else if (/\/addon\//.test(urlPath)) {
          intercepted.addonResponses.set(urlPath, {
            text: this.responseText,
            method,
            ts: Date.now()
          })
          try {
            const d = JSON.parse(this.responseText)
            if (/\/phone\/check/.test(urlPath) && d)
              intercepted.phoneResults.push({ ...d, ts: Date.now() })
            else if (/\/quest-tuner\/check/.test(urlPath) && d)
              intercepted.questTunerResults.push({ ...d, ts: Date.now() })
            else if (/\/quest-gems\/unlock/.test(urlPath) && d)
              intercepted.questGemsResults.push({ ...d, ts: Date.now() })
          } catch {
            /* not JSON */
          }
          _hookBridge.log(`📝 XHR addon intercepted: ${method} ${urlPath}`)
        }
      } catch {
        /* silent */
      }
    })
    return _origXHRSend.apply(this, args)
  }

  // ── WEBSOCKET HOOK ─────────────────────────────────────────────────────────
  unsafeWindow.WebSocket = function (url, protocols) {
    _hookBridge.log(`🔌 WebSocket intercepted: ${url}`)
    const ws = protocols ? new _origWS(url, protocols) : new _origWS(url)

    const _origAddEL = ws.addEventListener.bind(ws)
    ws.addEventListener = function (type, handler, ...rest) {
      if (type === 'message') {
        const wrapped = function (event) {
          try {
            const data = typeof event.data === 'string' ? event.data : null
            if (data) {
              intercepted.wsMessages.push({ data, ts: Date.now(), url })
              if (intercepted.wsMessages.length > 200)
                intercepted.wsMessages.shift()
              try {
                const parsed = JSON.parse(data)
                if (parsed.online !== undefined || parsed.today !== undefined)
                  intercepted.statData = parsed
              } catch {
                /* not JSON */
              }
            }
          } catch {
            /* silent */
          }
          return handler.call(this, event)
        }
        return _origAddEL(type, wrapped, ...rest)
      }
      return _origAddEL(type, handler, ...rest)
    }

    let _onmsg = null
    Object.defineProperty(ws, 'onmessage', {
      get () {
        return _onmsg
      },
      set (handler) {
        _onmsg = function (event) {
          try {
            const data = typeof event.data === 'string' ? event.data : null
            if (data) {
              intercepted.wsMessages.push({ data, ts: Date.now(), url })
              if (intercepted.wsMessages.length > 200)
                intercepted.wsMessages.shift()
              try {
                const parsed = JSON.parse(data)
                if (parsed.online !== undefined) intercepted.statData = parsed
              } catch {
                /* not JSON */
              }
            }
          } catch {
            /* silent */
          }
          return handler.call(this, event)
        }
      }
    })

    logTraffic('WS', url, 101, 0, 'websocket')
    return ws
  }
  unsafeWindow.WebSocket.prototype = _origWS.prototype
  unsafeWindow.WebSocket.CONNECTING = _origWS.CONNECTING
  unsafeWindow.WebSocket.OPEN = _origWS.OPEN
  unsafeWindow.WebSocket.CLOSING = _origWS.CLOSING
  unsafeWindow.WebSocket.CLOSED = _origWS.CLOSED

  // ── BROADCASTCHANNEL HOOK ──────────────────────────────────────────────────
  let statBroadcastIntercepted = false
  if (_origBC) {
    unsafeWindow.BroadcastChannel = function (name) {
      const bc = new _origBC(name)
      if (name === 'stat') {
        statBroadcastIntercepted = true
        _hookBridge.log(`📡 BroadcastChannel "stat" intercepted`)
        const _origPost = bc.postMessage.bind(bc)
        bc.postMessage = function (data) {
          try {
            intercepted.wsMessages.push({
              data: JSON.stringify(data),
              ts: Date.now(),
              url: 'bc:stat'
            })
          } catch {
            /* silent */
          }
          return _origPost(data)
        }
      }
      return bc
    }
    unsafeWindow.BroadcastChannel.prototype = _origBC.prototype
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Traffic hooks are NOW LIVE.  Everything below can take its time loading.
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 1 ─ CONSTANTS & CONFIG (from front.js source analysis)
  // ═══════════════════════════════════════════════════════════════════════════

  const VERSION = '6.0.0'

  // Live data endpoints (relative → intercepted; absolute → GM_xmlhttpRequest)
  const CHANGELOG_URL = '/data/changelog.json'
  const MATRIX_URL = '/data/matrix.json'

  // GM storage keys — NEVER use localStorage
  const SK = {
    db: 'floor796_db',
    bookmarks: 'floor796_bookmarks',
    completed: 'floor796_completed',
    settings: 'floor796_settings'
  }

  // Position‐hash regex from front.js Je.parsePositionCode
  const POS_RE = /^#?([tb]\d+[lr]\d+),(\d+),(\d+)(?:,(\d+))?$/

  // ── Zoom arrays from front.js (minified variables U and V) ──────────────
  //
  //  q  = new render engine flag (WebAssembly+Canvas)
  //  O  = small mobile flag
  //
  //  U = q ? (O ? [2,1,.7,.5]
  //             : /extra-zoom/.test(location.search) ? [4,3,2,1,.7]
  //             : [2,1,.7])
  //        : [1,.9,.8,.7,.6,.5]
  //
  //  V = q ? U
  //        : [1.5,1.2,1,.9,.8,.7,.6,.5]
  //
  //  Z = q ? 50 : 20          (scroll‐step threshold, not a zoom level)
  //
  //  changeZoomFactorByDelta picks U or V based on screen width / flags,
  //  finds current zoom index, and moves ±1.  Arrays are closure‐scoped —
  //  the ONLY way to extend them is to patch the source text before
  //  execution, or monkey-patch the method that reads them.
  //
  const ZOOM_PATTERNS = [
    '[2,1,.7,.5]', // mobile   (U when q && O)
    '[4,3,2,1,.7]', // desktop  (U when q && extra-zoom)
    '[2,1,.7]', // desktop  (U when q, default)
    '[1,.9,.8,.7,.6,.5]', // old render (U when !q)
    '[1.5,1.2,1,.9,.8,.7,.6,.5]' // old render alt (V when !q)
  ]

  // Our extended zoom range (descending — 20× to 0.01×)
  const EXTENDED_ZOOM = [
    20, 16, 12, 10, 8, 6, 5, 4, 3, 2.5, 2, 1.5, 1.2, 1, 0.9, 0.8, 0.7, 0.6, 0.5,
    0.4, 0.3, 0.2, 0.1, 0.05, 0.01
  ]

  // Scene tile half‐dimensions from front.js: nt=508, it=406
  const SCENE_W = 508
  const SCENE_H = 406

  // Link-type prefix set
  const LINK_PREFIXES = [
    'interactive://',
    'event://',
    'play://',
    'play-loop://',
    'img://'
  ]

  // ── Quest Tuner constants (from quest-tuner.page.js) ────────────────────
  const QUEST_TUNER = {
    INITIAL_TOKEN: 's8fal1jd9a0s8f721n',
    FINAL_TOKEN_HASH: '22@4096009834',
    PSEUDO_RND_NUM1: [1923, 55152, 23, 5150, 3526, 9827, 29182, 7201],
    PSEUDO_RND_NUM2: [8196, 92, 174, 290187, 3236, 77244, 51, 251],
    COLORS: [
      '#db0f0f',
      '#e04f07',
      '#de9910',
      '#d6d62d',
      '#08c408',
      '#00cc88',
      '#33d4d4',
      '#00aaff',
      '#3f78eb',
      '#746dfc',
      '#9e3dff',
      '#d400ff',
      '#ff00d5',
      '#ff0080',
      '#bbbbbb'
    ]
  }

  // ── Interactive mini-games: built dynamically from live changelog data ──
  // Extracts interactive:// links from changelog items at render time
  function getInteractiveUrls () {
    const result = {}
    if (db.items && db.items.length) {
      db.items.forEach(item => {
        const link = (item.l || '').split('||')[0].trim()
        if (!link.startsWith('interactive://')) return
        const path = link.replace('interactive://', '')
        const slug = path.split('/')[0]
        if (result[slug]) return // already have it
        result[slug] = {
          name: item.t || slug,
          url: '/interactive-v2/' + path,
          id: item.id || 0
        }
      })
    }
    return result
  }

  // ── Addon renderers: built dynamically from live matrix data ──
  // Reads addons array from matrix.json at render time
  function getAddonRenderers () {
    const addons = db.matrix?.addons || []
    return addons.map(a => {
      // Derive scene from polygon string (first scene id) — field can be .p or .pts
      let scene = ''
      const polyStr = a.p || a.pts || ''
      if (polyStr) {
        const firstPart = polyStr.split(';')[0] || ''
        scene = firstPart.split(',')[0] || ''
      }
      // Derive human-friendly name from URL path
      const urlPath = (a.url || '')
        .replace(/^\/interactive\//, '')
        .replace(/\/render[^/]*\.js.*$/, '')
      const name = urlPath
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
      return {
        name,
        url: a.url || '',
        scene,
        cond: a.cond || null
      }
    })
  }

  // ── Scene grid: built dynamically from live matrix data ──
  // Reads mat array from matrix.json at render time (each cell has .id)
  function getSceneGrid () {
    const mat = db.matrix?.mat
    if (mat && Array.isArray(mat) && mat.length > 0) {
      return mat.map(row =>
        Array.isArray(row)
          ? row.map(cell => (typeof cell === 'string' ? cell : cell?.id || ''))
          : []
      )
    }
    return [] // data not loaded yet
  }

  // ── Event names: fully dynamic — pulled from live changelog + front.js source ──

  /**
   * Extract engine event names from the intercepted front.js source code.
   * Looks for document.addEventListener / window.addEventListener string args
   * and CustomEvent("name") patterns, filtering out generic DOM events.
   */
  function extractEngineEventsFromSource () {
    const src = intercepted.frontJsSource
    if (!src) return []
    const found = new Set()
    // Match: addEventListener("event-name" and CustomEvent("event-name"
    const patterns = [
      /document\.addEventListener\(["']([a-z][a-z0-9-]+)["']/g,
      /window\.addEventListener\(["']([a-z][a-z0-9-]+)["']/g,
      /new\s+CustomEvent\(["']([a-z][a-z0-9-]+)["']/g
    ]
    // Generic DOM events to skip (not site-specific)
    const skipEvents = new Set([
      'resize',
      'orientationchange',
      'click',
      'keydown',
      'keyup',
      'keypress',
      'mousedown',
      'mouseup',
      'mousemove',
      'touchstart',
      'touchend',
      'touchmove',
      'pointerdown',
      'pointerup',
      'pointermove',
      'scroll',
      'wheel',
      'focus',
      'blur',
      'change',
      'input',
      'submit',
      'load',
      'unload',
      'error',
      'message',
      'visibilitychange',
      'popstate',
      'hashchange',
      'beforeunload',
      'contextmenu',
      'dblclick',
      'dragstart',
      'drag',
      'dragend',
      'drop',
      'paste',
      'copy',
      'cut',
      'animationend',
      'transitionend',
      'fullscreenchange',
      'storage',
      'online',
      'offline',
      'pagehide',
      'pageshow',
      'f796-front-loaded',
      'enter',
      'clear'
    ])
    for (const rx of patterns) {
      let m
      while ((m = rx.exec(src)) !== null) {
        const name = m[1]
        if (!skipEvents.has(name) && !name.startsWith('state(')) found.add(name)
      }
    }
    return [...found]
  }

  function getKnownEvents () {
    const all = new Set()

    // 1. Events from changelog event:// links
    if (db.items && db.items.length) {
      db.items.forEach(item => {
        ;(item.l || '').split('||').forEach(part => {
          const link = part.trim()
          if (!link.startsWith('event://')) return
          const evName = link.replace('event://', '').split('?')[0].trim()
          if (evName) all.add(evName)
        })
      })
    }

    // 2. Engine events extracted live from front.js source
    extractEngineEventsFromSource().forEach(e => all.add(e))

    return [...all]
  }

  // ── Hidden URL parameters discovered in front.js ──
  const HIDDEN_URL_PARAMS = {
    debug: {
      desc: 'Show hitbox overlay canvas (colored polygons on every clickable area)',
      param: 'debug'
    },
    extraZoom: {
      desc: 'Enable extra zoom level (4× desktop zoom)',
      param: 'extra-zoom'
    },
    oldRender: {
      desc: 'Force old MP4/v1 renderer instead of F796/WebAssembly/v3 — uses [1,.9,.8,.7,.6,.5] zoom array',
      param: 'old-render'
    },
    cdn: {
      desc: 'Override CDN domain for asset loading — stored in localStorage "cdn"',
      param: 'cdn'
    }
  }

  // Scene grid and events are now derived from live data via getSceneGrid() and getKnownEvents()

  // ── Statistics targets bitmask (from front.js Ce constant) ──
  // These bit flags track which UI elements the user has interacted with
  const STAT_TARGETS = {
    DIALOG_ABOUT: 1,
    DIALOG_SUBSCRIBE: 2,
    CHANGES_BAR: 4,
    LANG_SWITCH: 8,
    DIALOG_DOWNLOAD_IMAGES: 16,
    LINK_EDITOR: 32,
    LINK_TELEGRAM: 64,
    LINK_HABR: 128,
    LINK_YOUTUBE: 256,
    LINK_PIKABU: 512,
    LINK_ARTSTATION: 1024,
    LINK_TWITTER: 2048,
    WANDERING: 4096,
    INTERACTIVE_CHANGES: 8192,
    LINK_REDDIT: 16384,
    LINK_RSS: 32768,
    DIALOG_DOWNLOAD_HTML: 65536
  }

  // ── Known localStorage keys used by the site (from front.js) ──
  const SITE_LS_KEYS = {
    client_id: 'UUID for stats session (auto-generated)',
    visit: 'Visit counter (incremented each session)',
    visit_time: 'Visit time epoch (grouped hourly)',
    'last-pos': 'Last camera position code (scene,y,x)',
    'low-battery': 'Battery dialog cooldown timestamp',
    'click-hint': 'Click hint tutorial shown flag',
    webp: 'WebP support detection cache (0/1)',
    'f796-render-engine-v3': 'V3 WASM renderer toggle (null/1=on, other=off)',
    'last-change': 'Last viewed changelog date',
    cdn: 'Preferred CDN domain override',
    'modern-agent': 'Browser capability flag',
    'quest-gems': 'Quest #1 state (bit flags)',
    'quest-tuner': 'Quest #2 state (bit flags)'
  }

  // Melody force-render: stored data for fetch intercept (select-melody uses id→fetch, we fake it)
  let _melodyForceData = null

  // ── Phonebook — all known valid payphone numbers (community-discovered) ──
  // Sorted by number (numeric ascending) · 37 numbers from full 0000000–9999999 bruteforce
  const PHONEBOOK = [
    {
      number: '0014015',
      file: 'mgs.mp3',
      name: 'Metal Gear Solid',
      ref: 'Codec call frequency'
    },
    {
      number: '0119116',
      file: '5th-elem-v3.mp3',
      name: 'The Fifth Element',
      ref: 'Multipass scene'
    },
    {
      number: '0881987',
      file: 'fnaf0.mp3',
      name: "Five Nights at Freddy's",
      ref: 'Freddy Fazbear'
    },
    {
      number: '1031111',
      file: 'silent-hill.mp3',
      name: 'Silent Hill',
      ref: 'Radio static'
    },
    {
      number: '1115791',
      file: 'xnaj28s6fa9d2sma.mp3',
      name: '??? (Secret)',
      ref: 'Hidden easter egg'
    },
    {
      number: '1115792',
      file: 'ill-be-back.mp3',
      name: "I'll Be Back",
      ref: 'Terminator'
    },
    {
      number: '1483369',
      file: 'jesse-pinkman.mp3',
      name: 'Jesse Pinkman',
      ref: 'Breaking Bad'
    },
    {
      number: '1800613',
      file: 'god-of-war.mp3',
      name: 'God of War',
      ref: 'Kratos theme'
    },
    {
      number: '2020327',
      file: 'biosystem.mp3',
      name: 'Biosystem',
      ref: 'Sci-fi ambience'
    },
    {
      number: '2128506',
      file: 'akvarium.mp3',
      name: 'Aquarium',
      ref: 'Akvarium (Russian band)'
    },
    {
      number: '2222222',
      file: 'de-la-soul.mp3',
      name: 'De La Soul',
      ref: 'Ring Ring Ring'
    },
    {
      number: '2232232',
      file: 'karlson.mp3',
      name: 'Karlson',
      ref: 'Karlsson-on-the-Roof'
    },
    {
      number: '2731977',
      file: 'mimino.mp3',
      name: 'Mimino',
      ref: 'Soviet comedy film (1977)'
    },
    {
      number: '2741001',
      file: 'master-dent.mp3',
      name: 'Arthur Dent',
      ref: "Hitchhiker's Guide"
    },
    {
      number: '2870010',
      file: 'lyolik.mp3',
      name: 'Lyolik',
      ref: 'Nu, Pogodi! cartoon'
    },
    {
      number: '4002892',
      file: 'funk-do-yudi.mp3',
      name: 'Funk do Yudi',
      ref: 'Brazilian funk'
    },
    {
      number: '4125518',
      file: 'the-ring.mp3',
      name: 'The Ring',
      ref: "Samara's phone call"
    },
    {
      number: '4452675',
      file: 'foster-parents.mp3',
      name: 'Foster Parents',
      ref: "Foster's Home"
    },
    {
      number: '4546021',
      file: 'ironiya-sudby.mp3',
      name: 'Irony of Fate',
      ref: 'Soviet New Year classic'
    },
    { number: '4674355', file: 'imp.mp3', name: 'Imp', ref: 'Doom demon' },
    {
      number: '5193708',
      file: 'hotline-miami.mp3',
      name: 'Hotline Miami',
      ref: 'Do you like hurting other people?'
    },
    {
      number: '5550123',
      file: 'bruce-almighty.mp3',
      name: 'Bruce Almighty',
      ref: 'Bruce Almighty (2003)'
    },
    {
      number: '5550182',
      file: 'gta.mp3',
      name: 'GTA',
      ref: 'Grand Theft Auto'
    },
    {
      number: '5550690',
      file: 'neo.mp3',
      name: 'Neo',
      ref: 'The Matrix — Wake Up, Neo'
    },
    {
      number: '5552368',
      file: 'ghostbusters.mp3',
      name: 'Ghostbusters',
      ref: 'Who ya gonna call? (1984)'
    },
    {
      number: '5553535',
      file: 'home-money.mp3',
      name: 'Home Money',
      ref: 'Home finance jingle'
    },
    {
      number: '5558383',
      file: 'seinfeld.mp3',
      name: 'Seinfeld',
      ref: 'Seinfeld theme'
    },
    {
      number: '6138840',
      file: 'god-of-war.mp3',
      name: 'God of War (alt)',
      ref: 'Kratos theme (alternate number)'
    },
    {
      number: '6330171',
      file: 'galochka.mp3',
      name: 'Galochka',
      ref: 'Ivan Vasilievich (Soviet comedy)'
    },
    {
      number: '6647665',
      file: 'scott-pilgrim.mp3',
      name: 'Scott Pilgrim',
      ref: 'Scott Pilgrim vs. the World'
    },
    {
      number: '7334141',
      file: 'if-you-are-homeless.mp3',
      name: 'If You Are Homeless',
      ref: 'Just buy a house meme'
    },
    {
      number: '7861410',
      file: 'black-meza.mp3',
      name: 'Black Mesa',
      ref: 'Half-Life — Black Mesa Research Facility'
    },
    {
      number: '8600100',
      file: '8600100.mp3',
      name: '??? (8600100)',
      ref: 'Unknown easter egg'
    },
    {
      number: '8675309',
      file: 'jenny.mp3',
      name: 'Jenny (867-5309)',
      ref: 'Tommy Tutone'
    },
    {
      number: '8872061',
      file: 'wazzap.mp3',
      name: 'Wazzup!',
      ref: 'Scary Movie / Budweiser ad'
    },
    {
      number: '9211040',
      file: 'camptain-pronin.mp3',
      name: 'Captain Pronin',
      ref: 'Russian cartoon superhero'
    },
    {
      number: '9631963',
      file: 'peppa-pig.mp3',
      name: 'Peppa Pig',
      ref: 'Peppa Pig theme'
    }
  ]

  // Scan / event log
  const scanLog = []
  function log (msg) {
    const ts = new Date().toLocaleTimeString()
    scanLog.push(`[${ts}] ${msg}`)
    if (scanLog.length > 250) scanLog.shift()
    console.log(`[F796] ${msg}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 2 ─ STORAGE  (GM_setValue / GM_getValue — NEVER localStorage)
  // ═══════════════════════════════════════════════════════════════════════════

  function storageGet (key, fallback) {
    try {
      const raw = GM_getValue(key, null)
      if (raw === null || raw === undefined) return fallback
      return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return fallback
    }
  }
  function storageSet (key, value) {
    try {
      GM_setValue(key, JSON.stringify(value))
    } catch (e) {
      log('Storage write error: ' + e.message)
    }
  }
  function storageDel (key) {
    try {
      GM_deleteValue(key)
    } catch {
      /* noop */
    }
  }

  const DEFAULT_SETTINGS = {
    phoneAutoplay: true,
    phoneSort: 'number', // 'number' (numeric ↑) or 'name' (A–Z)
    renderFull: false,
    renderNoCull: false,
    debugMode: false,
    coordHUD: false,
    animSpeed: 1.0,
    language: 'en',
    cdnOverride: ''
  }

  let settings = storageGet(SK.settings, DEFAULT_SETTINGS)
  function saveSettings () {
    storageSet(SK.settings, settings)
  }
  function setSetting (key, value) {
    settings[key] = value
    saveSettings()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 3 ─ FRONT.JS INTERCEPTION
  //
  //  MutationObserver at document-start catches <script src="…front.*.js">
  //  added by the HTML parser.  We block it, fetch the source via
  //  GM_xmlhttpRequest, replace the closure-scoped zoom arrays with our
  //  EXTENDED_ZOOM, then inject the modified source as an inline <script>.
  //
  //  If interception fails (script loaded before us, timing, etc.) we fall
  //  back to post-load monkey-patching in Section 4.
  // ═══════════════════════════════════════════════════════════════════════════

  const FRONT_JS_RE = /\/front\.[a-f0-9]+\.js/
  let frontJsIntercepted = false
  let frontJsUrl = null
  let frontJsOriginalNode = null
  let frontJsPatchCount = 0

  // ── A. MutationObserver (catches parser-inserted <script>) ──────────────
  const scriptObserver = new MutationObserver((mutations, observer) => {
    for (const { addedNodes } of mutations) {
      for (const node of addedNodes) {
        if (node.nodeType !== 1) continue
        if (node.tagName === 'SCRIPT') tryIntercept(node, observer)
        if (node.querySelectorAll) {
          node
            .querySelectorAll('script[src]')
            .forEach(s => tryIntercept(s, observer))
        }
      }
    }
  })

  function tryIntercept (scriptNode, observer) {
    const src = scriptNode.src || scriptNode.getAttribute('src') || ''
    if (!FRONT_JS_RE.test(src) || frontJsIntercepted) return

    frontJsIntercepted = true
    frontJsUrl = src
    frontJsOriginalNode = scriptNode
    log(`⚡ Intercepted front.js: ${src}`)

    // Block: change type so the browser won't execute it
    scriptNode.type = 'text/f796-blocked'
    try {
      const capturedSrc = src
      scriptNode.removeAttribute('src')
      scriptNode.textContent =
        '/* blocked by Floor796 Companion – loading modified version */'
    } catch (e) {
      log('Block warning: ' + e.message)
    }

    observer.disconnect()
    fetchModifyInject(frontJsUrl)
  }

  // Start as early as possible
  if (document.documentElement) {
    scriptObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  } else {
    // Edge case: documentElement not ready yet at document-start
    new MutationObserver((_, o) => {
      if (document.documentElement) {
        o.disconnect()
        scriptObserver.observe(document.documentElement, {
          childList: true,
          subtree: true
        })
      }
    }).observe(document, { childList: true })
  }

  // Safety timeout — give up intercepting after 15 s
  setTimeout(() => {
    if (!frontJsIntercepted) {
      scriptObserver.disconnect()
      log(
        'Interception timeout – front.js was not caught (may already be loaded)'
      )
      log('Falling back to post-load controller patching')
      waitForController()
    }
  }, 15000)

  // ── B. Fetch, patch, inject ─────────────────────────────────────────────
  function fetchModifyInject (url) {
    log(`Fetching front.js source: ${url}`)

    GM_xmlhttpRequest({
      method: 'GET',
      url: url,
      onload (resp) {
        if (resp.status !== 200) {
          log(`front.js fetch failed: HTTP ${resp.status} – injecting original`)
          injectOriginal(url)
          return
        }

        let code = resp.responseText
        intercepted.frontJsSource = code
        log(`front.js fetched: ${code.length} chars`)

        // ── Replace zoom arrays ───────────────────────────────────────
        const extStr = JSON.stringify(EXTENDED_ZOOM)
        frontJsPatchCount = 0

        for (const pattern of ZOOM_PATTERNS) {
          if (code.includes(pattern)) {
            code = code.split(pattern).join(extStr)
            frontJsPatchCount++
            log(`  ✓ Patched zoom array: ${pattern}`)
          }
        }

        // Append companion-ready event so we know the modified script ran
        code +=
          '\n;(function(){' +
          'window.__f796_companion_front_patched=true;' +
          'document.dispatchEvent(new CustomEvent("f796-front-loaded"));' +
          '})();\n'

        log(`front.js patched: ${frontJsPatchCount} zoom array(s) replaced`)

        // Inject as inline <script>
        const script = document.createElement('script')
        script.textContent = code

        const target =
          frontJsOriginalNode?.parentNode ||
          document.head ||
          document.documentElement
        try {
          if (frontJsOriginalNode?.parentNode) {
            frontJsOriginalNode.parentNode.insertBefore(
              script,
              frontJsOriginalNode.nextSibling
            )
          } else {
            target.appendChild(script)
          }
        } catch {
          ;(document.head || document.documentElement).appendChild(script)
        }

        log('✓ Modified front.js injected')
        waitForController()
      },
      onerror (err) {
        log('front.js fetch error: ' + (err?.statusText || 'network'))
        injectOriginal(url)
      }
    })
  }

  function injectOriginal (url) {
    const s = document.createElement('script')
    s.src = url
    ;(document.head || document.documentElement).appendChild(s)
    waitForController()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 4 ─ APP CONTROLLER ACCESS & ZOOM MONKEY-PATCH
  //
  //  globalThis.floor796.controller  →  root of entire application
  //    ._matrix                       →  Sn / _n  (scene matrix)
  //    ._matrix.position              →  Je        (MatrixPosition)
  //    ._matrix.position.setPositionCode(hash)     teleport
  //    ._matrix.position.getPositionCode(x, y)     read pos
  //    ._matrix.position.savePosition()            persist → URL hash
  //    ._matrix.position.transition.moveQuick(code) animated move
  //    ._matrix._options.zoomFactor                current zoom
  //    ._matrix.changeZoomFactor(f, x, y)          apply zoom
  //    ._matrix.changeZoomFactorByDelta(d, …)      scroll zoom
  //    ._changesMap._changes                       loaded changelog
  // ═══════════════════════════════════════════════════════════════════════════

  let ctrl = null // floor796 controller
  let matrix = null // ._matrix
  let pos = null // ._matrix.position
  let zoomPatched = false
  let controllerReady = false

  function waitForController () {
    let attempts = 0
    const max = 80 // 40 s
    const timer = setInterval(() => {
      attempts++
      try {
        const c =
          unsafeWindow.globalThis?.floor796?.controller ||
          unsafeWindow.floor796?.controller
        if (c && c._matrix && c._matrix.position) {
          clearInterval(timer)
          onControllerReady(c)
          return
        }
      } catch {
        /* not ready */
      }
      if (attempts >= max) {
        clearInterval(timer)
        log(
          'Controller not found after timeout – running without direct access'
        )
      }
    }, 500)
  }

  function onControllerReady (controller) {
    ctrl = controller
    matrix = ctrl._matrix
    pos = matrix.position
    controllerReady = true

    log(
      `✓ Controller hooked – zoom=${
        pos.zoomFactor ?? matrix._options?.zoomFactor ?? '?'
      }`
    )

    // If source-level patching didn't happen, monkey-patch the method
    patchZoomByDelta()

    // Apply render overrides if enabled
    applyRenderOverrides()

    // Restore debug mode if it was enabled
    if (settings.debugMode) toggleDebugMode(true)

    // Re-render current tab if panel already exists
    renderActiveTab()
  }

  // ── Monkey-patch changeZoomFactorByDelta with EXTENDED_ZOOM ─────────────
  function patchZoomByDelta () {
    if (!matrix || zoomPatched) return
    if (typeof matrix.changeZoomFactorByDelta !== 'function') {
      log('changeZoomFactorByDelta not found – zoom bypass skipped')
      return
    }

    // If the source was already patched (the arrays inside the closure are
    // already EXTENDED_ZOOM), we still apply the monkey-patch for the
    // animation wrapper so the experience is consistent.

    matrix.changeZoomFactorByDelta = function (
      delta /*, e, mouseX, mouseY, s */
    ) {
      const direction = delta < 0 ? -1 : 1 // matches original: +1 = higher idx = zoom out, -1 = lower idx = zoom in
      const current = this._options?.zoomFactor || 1

      // Nearest index in our extended list
      let best = 0,
        bestDist = Infinity
      for (let i = 0; i < EXTENDED_ZOOM.length; i++) {
        const d = Math.abs(EXTENDED_ZOOM[i] - current)
        if (d < bestDist) {
          bestDist = d
          best = i
        }
      }

      // EXTENDED_ZOOM is descending [20…0.01]
      //   scroll down (direction +1) → higher index → smaller number → zoom out
      //   scroll up   (direction -1) → lower index  → bigger number  → zoom in
      const next = Math.max(
        0,
        Math.min(EXTENDED_ZOOM.length - 1, best + direction)
      )
      const target = EXTENDED_ZOOM[next]
      if (Math.abs(target - current) < 1e-5) return

      const cx =
        arguments[2] || this.position?.width >> 1 || window.innerWidth >> 1
      const cy =
        arguments[3] || this.position?.height >> 1 || window.innerHeight >> 1

      // Smooth 5-frame animation (matches original behaviour)
      const start = current
      const step = (target - start) / 5
      let frame = 1
      const self = this

      if (self._zoomAnimReqId > 0) {
        cancelAnimationFrame(self._zoomAnimReqId)
        self._zoomAnimReqId = 0
      }

      ;(function animate () {
        self.changeZoomFactor(start + step * frame, cx, cy)
        if (++frame <= 5) self._zoomAnimReqId = requestAnimationFrame(animate)
        else self._zoomAnimReqId = 0
      })()
    }

    zoomPatched = true
    log(
      '✓ Zoom bypass active – changeZoomFactorByDelta patched with EXTENDED_ZOOM'
    )
  }

  // ── Direct zoom setter (used by slider / presets) ──
  function setZoomFactor (factor) {
    if (!matrix || !pos) {
      log('setZoom: controller not ready')
      return false
    }
    try {
      const cx = (pos.width || window.innerWidth) >> 1
      const cy = (pos.height || window.innerHeight) >> 1
      matrix.changeZoomFactor(factor, cx, cy)
      pos.savePosition()
      log(`Zoom → ${factor}`)
      return true
    } catch (e) {
      log('setZoom error: ' + e.message)
      return false
    }
  }

  function getZoomFactor () {
    return pos?.zoomFactor ?? matrix?._options?.zoomFactor ?? null
  }

  // ── Payphone audio helpers ──
  let phoneAudio = null
  let phoneAudioUrl = null
  function ensurePhoneAudio () {
    if (!phoneAudio) {
      phoneAudio = new Audio()
      phoneAudio.preload = 'auto'
      phoneAudio.crossOrigin = 'anonymous'
    }
    return phoneAudio
  }
  function getPayphoneAudioUrl (file) {
    const base =
      unsafeWindow.floor796?.STATIC_URL || 'https://static.floor796.com'
    return base.replace(/\/$/, '') + `/data/payphone/${file}`
  }
  function playPhoneAudio (url) {
    try {
      const a = ensurePhoneAudio()
      a.src = url
      a.play().catch(e => log('Phone audio play failed: ' + e.message))
    } catch (e) {
      log('Phone audio error: ' + e.message)
    }
  }
  function stopPhoneAudio () {
    if (!phoneAudio) return
    try {
      phoneAudio.pause()
      phoneAudio.currentTime = 0
    } catch {
      /* noop */
    }
  }

  // ── Render override helpers (experimental) ──
  let renderOverrideSnapshot = null
  function applyRenderOverrides () {
    if (!matrix || !matrix._options) return false
    const opts = matrix._options
    if (!renderOverrideSnapshot) {
      renderOverrideSnapshot = {
        renderAll: 'renderAll' in opts ? opts.renderAll : undefined,
        fullRender: 'fullRender' in opts ? opts.fullRender : undefined,
        disableCulling:
          'disableCulling' in opts ? opts.disableCulling : undefined,
        noCulling: 'noCulling' in opts ? opts.noCulling : undefined,
        culling: 'culling' in opts ? opts.culling : undefined
      }
    }

    let touched = false
    if ('renderAll' in opts) {
      opts.renderAll = settings.renderFull
      touched = true
    }
    if ('fullRender' in opts) {
      opts.fullRender = settings.renderFull
      touched = true
    }
    if ('disableCulling' in opts) {
      opts.disableCulling = settings.renderNoCull
      touched = true
    }
    if ('noCulling' in opts) {
      opts.noCulling = settings.renderNoCull
      touched = true
    }
    if ('culling' in opts) {
      opts.culling = settings.renderNoCull
        ? false
        : renderOverrideSnapshot.culling
      touched = true
    }

    if (touched)
      log(
        `Render overrides: full=${settings.renderFull} cull=${
          !settings.renderNoCull ? 'on' : 'off'
        }`
      )
    return touched
  }

  // ── Coordinate HUD overlay ──
  let coordHudEl = null
  let coordHudTimer = null
  function createCoordHUD () {
    if (coordHudEl) return
    coordHudEl = document.createElement('div')
    coordHudEl.id = 'f796-coord-hud'
    coordHudEl.style.cssText =
      'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(10,14,20,.85);border:1px solid #00ffc844;color:#00ffc8;padding:4px 12px;font-family:monospace;font-size:11px;border-radius:4px;z-index:999997;pointer-events:none;white-space:nowrap;display:none'
    document.body.appendChild(coordHudEl)
  }
  function updateCoordHUD () {
    if (!coordHudEl || !settings.coordHUD) return
    const p = getCurrentPosition()
    const z = getZoomFactor()
    if (p) {
      coordHudEl.textContent = `📍 ${p.scene}  x:${p.x}  y:${p.y}  zoom:${
        z != null ? z.toFixed(2) : '?'
      }×`
      coordHudEl.style.display = 'block'
    }
  }
  function toggleCoordHUD (on) {
    settings.coordHUD = on
    saveSettings()
    createCoordHUD()
    if (on) {
      coordHudEl.style.display = 'block'
      if (!coordHudTimer) coordHudTimer = setInterval(updateCoordHUD, 500)
    } else {
      coordHudEl.style.display = 'none'
      if (coordHudTimer) {
        clearInterval(coordHudTimer)
        coordHudTimer = null
      }
    }
  }

  // ── Debug mode (hitbox overlay) — mirrors front.js ?debug check ──
  function toggleDebugMode (on) {
    settings.debugMode = on
    saveSettings()
    if (ctrl && ctrl._changesMap) {
      const cm = ctrl._changesMap
      if (on && cm._canvas) {
        cm._canvas.style.cssText =
          'position:fixed;top:0;left:0;z-index:100000;pointer-events:none;opacity:0.4'
        if (!cm._canvas.parentNode) document.body.appendChild(cm._canvas)
        log('Debug hitbox overlay: ON')
      } else if (!on && cm._canvas) {
        cm._canvas.style.display = 'none'
        if (cm._canvas.parentNode) cm._canvas.parentNode.removeChild(cm._canvas)
        log('Debug hitbox overlay: OFF')
      }
    } else {
      log('Debug mode: controller._changesMap not available')
    }
  }

  // ── Animation speed control ── (real implementation in Section: ANIMATION CONTROLLER)

  // ── Interactive launcher — opens in popup like the site does ──
  function openInteractive (key) {
    const info = getInteractiveUrls()[key]
    if (!info) {
      log(`Unknown interactive: ${key}`)
      return
    }
    const url = 'https://floor796.com' + info.url
    const w = Math.min(800, window.innerWidth - 40)
    const h = Math.min(600, window.innerHeight - 40)
    const left = (window.innerWidth - w) / 2 + window.screenX
    const top2 = (window.innerHeight - h) / 2 + window.screenY
    window.open(
      url,
      'f796_interactive',
      `width=${w},height=${h},left=${left},top=${top2},resizable=yes,scrollbars=yes`
    )
    log(`Opened interactive: ${info.name}`)
  }

  // ── Audio player for play:// links ──
  let siteAudio = null
  function playSiteAudio (url) {
    if (!siteAudio) {
      siteAudio = new Audio()
      siteAudio.crossOrigin = 'anonymous'
    }
    const fullUrl = url.startsWith('http')
      ? url
      : 'https://floor796.com/' + url.replace(/^\//, '')
    siteAudio.src = fullUrl
    siteAudio.play().catch(e => log('Audio play error: ' + e.message))
    log(`Playing: ${fullUrl}`)
  }
  function stopSiteAudio () {
    if (siteAudio) {
      siteAudio.pause()
      siteAudio.currentTime = 0
    }
  }

  // ── Wandering (from front.js class De — random walk between scenes) ──
  function startWandering () {
    try {
      const trans = pos?.transition || matrix?.position?.transition
      if (trans && typeof trans.startRandomMove === 'function') {
        trans.startRandomMove()
        log('Wandering started')
        return true
      }
      // Fallback: set hash to trigger it
      window.location.hash = '#wandering'
      log('Wandering: set hash #wandering')
      return true
    } catch (e) {
      log('Wandering start error: ' + e.message)
      return false
    }
  }

  function stopWandering () {
    try {
      const trans = pos?.transition || matrix?.position?.transition
      if (trans && typeof trans.stopRandomMove === 'function') {
        trans.stopRandomMove()
        log('Wandering stopped')
        return true
      }
    } catch (e) {
      log('Wandering stop error: ' + e.message)
    }
    return false
  }

  function isWandering () {
    try {
      const trans = pos?.transition || matrix?.position?.transition
      return !!(trans && trans._isRandomMove)
    } catch {
      return false
    }
  }

  // ── Frame control (front.js: jump-frame event, detail = 1-based frame) ──
  function jumpToFrame (n) {
    n = Math.max(1, Math.min(60, +n || 1))
    document.dispatchEvent(new CustomEvent('jump-frame', { detail: n }))
    log(`Jump to frame ${n}/60`)
  }

  // ── Vibrate scene (front.js: kn=[-2,2,-1,1] pixel offsets) ──
  function vibrateScene () {
    document.dispatchEvent(new CustomEvent('vibrate-scene'))
    log('Scene vibrated')
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ██ ANIMATION CONTROLLER — Full render-loop control via front.js internals
  // ══════════════════════════════════════════════════════════════════════════
  //
  // front.js architecture (Sn = canvas/f796i, _n = video/MP4):
  //   controller._matrix = scene matrix instance
  //   ._stopped       : bool, halts the rAF/_setTimeout loop
  //   ._frame         : int 0-59, current frame index
  //   ._newFrameIsReady : gate flag for decoded frame availability
  //   ._renderBound   : bound _render() for rAF
  //   ._lastRenderTime : Date.now() of last paint
  //   ._displayList   : visible vn[] scene slot instances
  //   ._canvas        : {canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}
  //   ._render()      : main rAF loop — checks 83ms throttle + _newFrameIsReady
  //   ._requestNextFrame() : decode next frame for all slots → sets _newFrameIsReady
  //   ._renderDisplayList() : paint current frame to canvas
  //   Sn.getAvgFps()  : running average FPS from Cn[] timing array
  //   Video mode (_n): uses setTimeout with _render.timer / _render.timeout
  //
  // CONTROL STRATEGY:
  //   freeze  → set _stopped=true  (loop exits after one static paint)
  //   unfreeze→ set _stopped=false, call play() (restarts rAF loop)
  //   step    → while frozen: manually call _requestNextFrame() then _renderDisplayList()
  //   speed   → monkey-patch the 83ms timing threshold in _render via rAF wrapper
  //   capture → canvas.toDataURL() on the main scene canvas
  // ══════════════════════════════════════════════════════════════════════════

  /** Internal animation state for the controller overlay */
  const animState = {
    frozen: false,
    speed: 1.0, // 1.0 = normal (12fps), range 0.1 → 5.0
    direction: 1, // 1 = forward, -1 = reverse
    mode: 'normal', // 'normal' | 'bounce' | 'reverse' | 'loop-range'
    looping: true, // whether animation wraps around
    bounceDir: 1, // internal: current bounce direction
    rangeStart: 1, // loop-range: first frame (1-based)
    rangeEnd: 60, // loop-range: last frame  (1-based)
    _origRender: null, // backup of original _render method
    _origTimeout: null, // backup of original _render.timeout (video mode)
    _stepTimer: null, // setInterval for continuous step-play at custom speed
    _previewTimer: null, // setInterval for live preview capture
    _previewCanvas: null, // off-screen canvas for thumbnail
    _fpsTracker: [], // track custom FPS
    _lastStepTime: 0,
    _activeAudioSources: new Set(), // live BufferSourceNodes for speed sync
    _slotFrames: null // WeakMap<slot, controlledFrame> for ALL duration-based render slots (null = not tracking)
  }

  // ── Addon render frame control helpers ────────────────────────────────
  // Only "always-running" duration-based slots should be controlled by
  // the playback system.  Slots that have activateByEventName are
  // EVENT-TRIGGERED (jaws19, naruto, cable, where-is-waldo, popcorn) —
  // they start dormant (_activated=false) and only animate after user
  // interaction.  We must leave them untouched.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Returns true if a render slot is an "always-running" duration-based slot
   * that should be controlled by our playback system.
   * Excludes event-triggered slots (activateByEventName).
   */
  function isControllableSlot (s) {
    return (
      s._options?.duration > 0 && !s._options.activateByEventName // skip event-triggered slots
    )
  }

  // NOTE: We intentionally do NOT intercept 'delete-slots-by-url-pattern'.
  // Safe zone clamping keeps _internalFrameNo well within duration bounds,
  // and the post-prepare re-pin prevents prepare() from deactivating slots.
  // Blocking deletions was causing hologram movie switches to break during
  // custom speed — the old slot stayed alive while a new one was added,
  // producing duplicate/corrupt renders.

  /**
   * Compute a safe frame range for a duration-based render slot.
   * Avoids the first ~7% (fade-in) and last ~8% (fade-out / deletion trigger)
   * so addon callbacks (hologram prepareRenderSource, etc.) stay in their
   * normal rendering zone.
   * @returns {{ min: number, max: number }}
   */
  function slotSafeZone (duration) {
    if (duration <= 3) return { min: 0, max: Math.max(0, duration - 1) }
    const min = Math.max(1, Math.floor(duration * 0.07))
    const max = Math.min(duration - 2, Math.floor(duration * 0.92))
    return { min, max }
  }

  /**
   * Reset ALL tracked addon render slot frames to the start or end of their
   * safe zone.  Called by first/last frame buttons.
   * @param {'first'|'last'} edge
   */
  function resetSlotFrames (edge) {
    if (!animState._slotFrames) return
    const m = getSceneMatrix()
    if (!m?._displayList) return
    for (const s of m._displayList) {
      if (isControllableSlot(s) && animState._slotFrames.has(s)) {
        const sz = slotSafeZone(s._options.duration)
        animState._slotFrames.set(s, edge === 'first' ? sz.min : sz.max)
      }
    }
  }

  // ── Audio speed sync ─────────────────────────────────────────────────────
  // floor796 audio: controller._initAudioEvents creates an AudioContext,
  // plays BufferSourceNodes via 'play-audio' window event.
  // We hook AudioBufferSourceNode.prototype.start to track active sources
  // and set playbackRate to match animation speed.
  // ────────────────────────────────────────────────────────────────────────
  ;(function hookAudioSpeed () {
    try {
      const origStart = unsafeWindow.AudioBufferSourceNode.prototype.start
      unsafeWindow.AudioBufferSourceNode.prototype.start = function (...args) {
        // Apply current speed to this source
        try {
          this.playbackRate.value = animState.speed
        } catch {
          /* read-only or missing */
        }
        // Track it so we can update later
        animState._activeAudioSources.add(this)
        this.addEventListener('ended', () => {
          animState._activeAudioSources.delete(this)
        })
        return origStart.apply(this, args)
      }
    } catch {
      // AudioBufferSourceNode not available — no-op
    }
  })()

  /** Update playbackRate on all tracked audio sources + page video elements */
  function syncAudioSpeed (rate) {
    // Active Web Audio buffer sources
    for (const src of animState._activeAudioSources) {
      try {
        src.playbackRate.value = rate
      } catch {
        /* ended or detached */
      }
    }
    // HTML5 video elements on page (video-mode scenes + any embeds)
    try {
      const videos = unsafeWindow.document.querySelectorAll('video')
      for (const v of videos) {
        try {
          v.playbackRate = rate
        } catch {
          /* cross-origin or detached */
        }
      }
    } catch {
      /* sandbox issue */
    }
    // Our own companion audio elements
    if (siteAudio)
      try {
        siteAudio.playbackRate = rate
      } catch {}
    if (phoneAudio)
      try {
        phoneAudio.playbackRate = rate
      } catch {}
  }

  /** Get the scene matrix instance — prefer module-level var, fallback to unsafeWindow */
  function getSceneMatrix () {
    try {
      if (matrix) return matrix
      const c =
        unsafeWindow.globalThis?.floor796?.controller ||
        unsafeWindow.floor796?.controller
      return c?._matrix || null
    } catch {
      return null
    }
  }

  /** Detect render mode: 'canvas' (Sn/f796i) or 'video' (_n/MP4) or null */
  function getRenderMode () {
    const m = getSceneMatrix()
    if (!m) return null
    // Canvas mode (Sn) has _renderBound and _canvas
    if (m._renderBound && m._canvas) return 'canvas'
    // Video mode (_n) has _render.timer / _render.func
    if (m._render && typeof m._render.func === 'function') return 'video'
    return 'unknown'
  }

  /** Get full animation state snapshot */
  function getAnimationState () {
    const m = getSceneMatrix()
    if (!m) return { error: 'Matrix not found', mode: null }
    const mode = getRenderMode()
    return {
      mode,
      frozen: animState.frozen,
      speed: animState.speed,
      frame: m._frame, // 0-indexed
      frame1: m._frame + 1, // 1-indexed for display
      totalFrames: 60,
      stopped: m._stopped,
      newFrameReady: m._newFrameIsReady,
      lastRenderTime: m._lastRenderTime,
      fps:
        mode === 'canvas' && typeof m.constructor?.getAvgFps === 'function'
          ? m.constructor.getAvgFps()
          : 0,
      slotsCount: m._displayList?.length || m._videosInViewport?.size || 0,
      canvasSize: m._canvas
        ? `${m._canvas.canvas.width}×${m._canvas.canvas.height}`
        : 'N/A'
    }
  }

  /** Freeze animation — halt the render loop but keep current frame displayed */
  function freezeAnimation () {
    const m = getSceneMatrix()
    if (!m) return log('❌ Matrix not available')

    // Always stop the custom speed timer, even if already "frozen"
    if (animState._stepTimer) {
      clearInterval(animState._stepTimer)
      animState._stepTimer = null
    }

    if (animState.frozen && !animState._stepTimer) {
      // Truly frozen already (no speed timer running)
      return log('⏸️ Already frozen')
    }

    m._stopped = true
    try {
      if (typeof m.stop === 'function') m.stop()
    } catch {
      /* no .stop() */
    }
    animState.frozen = true

    // Capture only always-running duration-based render slots for frame
    // control.  Event-triggered slots (jaws19, naruto, etc.) are left alone.
    animState._slotFrames = new WeakMap()
    try {
      if (m._displayList) {
        for (const s of m._displayList) {
          if (isControllableSlot(s)) {
            const raw = s._internalFrameNo || 0
            const sz = slotSafeZone(s._options.duration)
            animState._slotFrames.set(
              s,
              Math.max(sz.min, Math.min(sz.max, raw))
            )
          }
        }
      }
    } catch {
      /* slots not available yet */
    }

    log(`⏸️ Animation FROZEN at frame ${m._frame + 1}/60`)
    return m._frame + 1
  }

  /** Unfreeze animation — resume the render loop */
  function unfreezeAnimation () {
    const m = getSceneMatrix()
    if (!m) return log('❌ Matrix not available')
    if (!animState.frozen) return log('▶️ Already playing')

    animState.frozen = false
    animState.speed = 1.0
    animState._slotFrames = null // stop controlling addon render slot frames
    m._stopped = false

    // Restore audio/video to normal speed
    syncAudioSpeed(1.0)

    try {
      const mode = getRenderMode()
      if (mode === 'canvas') {
        // Restart the rAF loop
        m._lastRenderTime = 0
        m._newFrameIsReady = true
        if (typeof m.play === 'function') m.play()
        else if (typeof m._render === 'function') m._render()
      } else if (mode === 'video') {
        // Restart the setTimeout loop
        if (typeof m.play === 'function') m.play()
        if (m._render && typeof m._render.func === 'function') {
          m._render.isStopped = false
          m._render.func()
        }
      } else {
        // Unknown mode fallback — try play(), then _render()
        if (typeof m.play === 'function') m.play()
        else if (typeof m._render === 'function') m._render()
      }
    } catch (e) {
      log('⚠ Resume error: ' + e.message)
    }

    log('▶️ Animation RESUMED')
  }

  /**
   * Step one frame forward or backward while frozen.
   * direction: 1 = forward, -1 = backward
   */
  async function stepFrame (direction = 1) {
    const m = getSceneMatrix()
    if (!m) return log('❌ Matrix not available')

    // Auto-freeze if not frozen
    if (!animState.frozen) freezeAnimation()

    const mode = getRenderMode()
    const oldFrame = m._frame
    const newFrame = (((m._frame + direction) % 60) + 60) % 60

    await stepToFrame(m, mode, newFrame, direction)

    log(`⏭️ Frame: ${oldFrame + 1} → ${newFrame + 1}/60`)
    return newFrame + 1
  }

  /**
   * Start custom playback with current animState settings.
   * Respects: speed, direction, mode (bounce/reverse/loop-range), rangeStart/End.
   *
   * IMPORTANT: This runs its own setInterval that calls stepToFrame() with an
   * absolute target frame. No modular-wrap arithmetic that would confuse
   * boundary detection.
   */
  function startPlayback (multiplier) {
    multiplier = Math.max(
      0.05,
      Math.min(10, +multiplier || animState.speed || 1)
    )
    animState.speed = multiplier

    syncAudioSpeed(multiplier) // always positive rate for audio

    const m = getSceneMatrix()
    if (!m) return log('❌ Matrix not available')

    const renderMode = getRenderMode()

    // Stop any existing custom step timer
    if (animState._stepTimer) {
      clearInterval(animState._stepTimer)
      animState._stepTimer = null
    }

    // 1x forward normal = let the native loop run (hologram room,
    // interactive addons, etc. all depend on the native render cycle)
    if (
      multiplier === 1.0 &&
      animState.direction === 1 &&
      animState.mode === 'normal'
    ) {
      // If we were frozen (from a previous bounce/reverse/range), restore native
      if (animState.frozen) unfreezeAnimation()
      log('🎚️ Speed: 1.0x (native ~12fps)')
      return
    }

    // Freeze native loop — we take full control
    if (!animState.frozen) {
      m._stopped = true
      try {
        if (typeof m.stop === 'function') m.stop()
      } catch {
        /* */
      }
      // Capture only always-running duration-based addon render slots.
      // Event-triggered slots (jaws19, naruto, etc.) are left alone.
      animState._slotFrames = new WeakMap()
      try {
        if (m._displayList) {
          for (const s of m._displayList) {
            if (isControllableSlot(s)) {
              const sz = slotSafeZone(s._options.duration)
              animState._slotFrames.set(
                s,
                Math.max(sz.min, Math.min(sz.max, s._internalFrameNo || 0))
              )
            }
          }
        }
      } catch {
        /* */
      }
    }
    animState.frozen = true

    // Base interval at 1x is ~83ms (12fps). Divide by speed multiplier.
    const interval = Math.max(16, Math.round(83 / multiplier))

    animState._stepTimer = setInterval(async () => {
      const now = performance.now()
      animState._fpsTracker.push(now)
      if (animState._fpsTracker.length > 60) animState._fpsTracker.shift()

      const cur = m._frame // 0-based, 0–59
      let next

      let holoDir = animState.direction // default holo direction

      switch (animState.mode) {
        case 'bounce': {
          // Ping-pong between 0 and 59 (or range bounds in future)
          next = cur + animState.bounceDir
          holoDir = animState.bounceDir
          if (next > 59) {
            animState.bounceDir = -1
            next = cur - 1 // reverse immediately
            if (next < 0) next = 0
            holoDir = -1
          } else if (next < 0) {
            animState.bounceDir = 1
            next = cur + 1 // reverse immediately
            if (next > 59) next = 59
            holoDir = 1
          }
          break
        }

        case 'loop-range': {
          const rs = animState.rangeStart - 1 // 0-based
          const re = animState.rangeEnd - 1
          const dir = animState.direction
          holoDir = dir
          // If outside range, jump into it
          if (cur < rs || cur > re) {
            next = dir > 0 ? rs : re
          } else {
            next = cur + dir
            if (next > re) next = rs
            else if (next < rs) next = re
          }
          break
        }

        case 'reverse': {
          next = cur - 1
          holoDir = -1
          if (next < 0) next = 59 // wrap around
          break
        }

        default: {
          // 'normal'
          next = cur + animState.direction
          holoDir = animState.direction
          if (next > 59) next = 0
          else if (next < 0) next = 59
          break
        }
      }

      await stepToFrame(m, renderMode, next, holoDir)
    }, interval)

    const effectiveFps = Math.round(1000 / interval)
    const modeLabel = animState.mode !== 'normal' ? ` [${animState.mode}]` : ''
    const dirLabel = animState.direction === -1 ? ' ◀' : ''
    log(`🎚️ Speed: ${multiplier}x (${effectiveFps}fps)${modeLabel}${dirLabel}`)
  }

  /**
   * Set animation playback speed (legacy wrapper).
   */
  function setAnimationSpeed (multiplier) {
    startPlayback(multiplier)
  }

  /**
   * Jump to an absolute frame and decode + paint it.
   * This is the core render primitive — no wrapping logic here,
   * the caller decides the exact target.
   *
   * @param {object}  m          - scene matrix instance
   * @param {string}  renderMode - 'canvas' | 'video'
   * @param {number}  targetFrame - 0-59 scene frame
   * @param {number}  [holoDir=0] - hologram step direction: 1 forward, -1 backward, 0 no change
   */
  async function stepToFrame (m, renderMode, targetFrame, holoDir = 0) {
    targetFrame = ((targetFrame % 60) + 60) % 60 // normalize to 0-59
    m._frame = targetFrame

    if (renderMode === 'canvas') {
      m._newFrameIsReady = false
      try {
        if (m._displayList?.length > 0) {
          // ── Controllable addon render frame control ──────────────────
          // Only "always-running" duration-based slots (hologram-room)
          // are controlled.  Event-triggered slots (jaws19, naruto,
          // quest-tuner-cable, where-is-waldo, etc.) are left alone so
          // user interactions still work normally.
          //
          // IMPORTANT: prepare() reads _internalFrameNo then increments
          // it, so we must pin BOTH before AND after the prepare() call.
          // Before = so prepare() decodes the frame we want.
          // After  = so render()'s prepareRenderSource sees the correct
          //          _internalFrameNo (prepare left it at pin+1).
          if (animState.frozen && animState._slotFrames) {
            for (const s of m._displayList) {
              if (isControllableSlot(s)) {
                const sz = slotSafeZone(s._options.duration)
                // Initialise tracking from the slot if we haven't captured it
                if (!animState._slotFrames.has(s)) {
                  animState._slotFrames.set(
                    s,
                    Math.max(sz.min, Math.min(sz.max, s._internalFrameNo || 0))
                  )
                }
                let cf = animState._slotFrames.get(s)
                // Advance / retreat only when an explicit direction is given
                if (holoDir !== 0) {
                  cf += holoDir
                  if (cf > sz.max) cf = sz.min
                  else if (cf < sz.min) cf = sz.max
                  animState._slotFrames.set(s, cf)
                }
                // Pin BEFORE prepare: prepare() will read this as the
                // frame to decode, then increment by 1.
                s._internalFrameNo = cf
                s._activated = true
              }
            }
          }

          await Promise.all(m._displayList.map(s => s.prepare(targetFrame)))

          // Re-pin AFTER prepare(): prepare() incremented _internalFrameNo
          // by 1 and may have set _activated=false.  We restore both so
          // render()'s prepareRenderSource callback sees the correct frame
          // and the slot stays alive.
          if (animState.frozen && animState._slotFrames) {
            for (const s of m._displayList) {
              if (isControllableSlot(s) && animState._slotFrames.has(s)) {
                s._internalFrameNo = animState._slotFrames.get(s)
                s._activated = true
              }
            }
          }
        }
        m._newFrameIsReady = true
        if (typeof m._renderDisplayList === 'function') {
          m._renderDisplayList()
        }
      } catch {
        m._newFrameIsReady = true
      }
    } else if (renderMode === 'video') {
      const targetTime = targetFrame / 12
      if (m._videosInViewport) {
        await Promise.all(
          [...m._videosInViewport].map(v => v.loadFrame(targetTime, true))
        )
      }
    }
  }

  /** Legacy delta-based step (used by stepFrame for single-step) */
  async function stepFrameInternal (m, mode, direction) {
    const newFrame = (((m._frame + direction) % 60) + 60) % 60
    await stepToFrame(m, mode, newFrame)
  }

  /** Stop custom speed playback and return to frozen state */
  function stopSpeedPlayback () {
    if (animState._stepTimer) {
      clearInterval(animState._stepTimer)
      animState._stepTimer = null
      log('⏹️ Speed playback stopped')
    }
  }

  /** Get computed FPS from the custom speed timer */
  function getCustomFps () {
    const ts = animState._fpsTracker
    if (ts.length < 2) return 0
    const span = ts[ts.length - 1] - ts[0]
    return span > 0 ? Math.round((ts.length - 1) / (span / 1000)) : 0
  }

  /**
   * Capture the current animation frame as a data URL (PNG).
   * Returns { dataUrl, width, height, frame } or null.
   */
  function captureFrame (scale = 1) {
    const m = getSceneMatrix()
    if (!m) return null

    const mode = getRenderMode()
    if (mode === 'canvas' && m._canvas?.canvas) {
      const srcCanvas = m._canvas.canvas
      if (scale === 1) {
        return {
          dataUrl: srcCanvas.toDataURL('image/png'),
          width: srcCanvas.width,
          height: srcCanvas.height,
          frame: m._frame + 1
        }
      }
      // Scaled capture
      const w = Math.round(srcCanvas.width * scale)
      const h = Math.round(srcCanvas.height * scale)
      const offscreen = document.createElement('canvas')
      offscreen.width = w
      offscreen.height = h
      const ctx = offscreen.getContext('2d')
      ctx.drawImage(srcCanvas, 0, 0, w, h)
      return {
        dataUrl: offscreen.toDataURL('image/png'),
        width: w,
        height: h,
        frame: m._frame + 1
      }
    }
    return null
  }

  /**
   * Start live preview — periodically captures the scene canvas
   * and draws a thumbnail into a target <canvas> element.
   */
  function startLivePreview (targetCanvas, fps = 8) {
    stopLivePreview()
    if (!targetCanvas) return

    const interval = Math.max(33, Math.round(1000 / fps))
    animState._previewTimer = setInterval(() => {
      const m = getSceneMatrix()
      if (!m || !m._canvas?.canvas) return

      const src = m._canvas.canvas
      const ctx = targetCanvas.getContext('2d')
      const tw = targetCanvas.width
      const th = targetCanvas.height

      // Calculate aspect-fit
      const srcAR = src.width / src.height
      const tgtAR = tw / th
      let dx = 0,
        dy = 0,
        dw = tw,
        dh = th
      if (srcAR > tgtAR) {
        dh = tw / srcAR
        dy = (th - dh) / 2
      } else {
        dw = th * srcAR
        dx = (tw - dw) / 2
      }

      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, tw, th)
      try {
        ctx.drawImage(src, dx, dy, dw, dh)
      } catch {}

      // Frame/FPS overlay
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, th - 20, tw, 20)
      ctx.fillStyle = '#00ffc8'
      ctx.font = '11px monospace'
      const state = getAnimationState()
      const fpsStr = animState._stepTimer ? getCustomFps() : state.fps
      ctx.fillText(
        `F:${String(state.frame1).padStart(2, '0')}/60  ${
          state.frozen ? '⏸' : '▶'
        }  ${fpsStr}fps  ${state.speed}x`,
        4,
        th - 6
      )
    }, interval)
    log('📺 Live preview started')
  }

  /** Stop live preview */
  function stopLivePreview () {
    if (animState._previewTimer) {
      clearInterval(animState._previewTimer)
      animState._previewTimer = null
    }
  }

  /**
   * Download the current frame as a PNG file.
   */
  function downloadFrame () {
    const cap = captureFrame(1)
    if (!cap) return log('❌ Cannot capture frame')

    const link = document.createElement('a')
    link.download = `floor796_frame_${String(cap.frame).padStart(2, '0')}.png`
    link.href = cap.dataUrl
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    log(`💾 Downloaded frame ${cap.frame}/60 (${cap.width}×${cap.height})`)
  }

  /**
   * Export all 60 frames as PNGs (zipped into a batch download).
   * Steps through every frame, captures, and triggers download for each.
   * Returns a promise that resolves when complete.
   */
  async function exportAllFrames (progressCb) {
    const m = getSceneMatrix()
    if (!m) return log('❌ Matrix not available')

    const wasFrozen = animState.frozen
    if (!wasFrozen) freezeAnimation()

    const origFrame = m._frame
    const mode = getRenderMode()
    const frames = []

    for (let i = 0; i < 60; i++) {
      await stepFrameInternal(m, mode, 0) // decode current frame
      m._frame = i
      if (mode === 'canvas' && m._displayList?.length > 0) {
        m._newFrameIsReady = false
        await Promise.all(m._displayList.map(s => s.prepare(i)))
        m._newFrameIsReady = true
        m._renderDisplayList()
      }
      // Small delay to let the canvas update
      await new Promise(r => setTimeout(r, 50))

      const cap = captureFrame(1)
      if (cap) frames.push(cap)
      if (progressCb) progressCb(i + 1, 60)
    }

    // Restore original frame
    m._frame = origFrame
    if (mode === 'canvas' && m._displayList?.length > 0) {
      m._newFrameIsReady = false
      await Promise.all(m._displayList.map(s => s.prepare(origFrame)))
      m._newFrameIsReady = true
      m._renderDisplayList()
    }

    // Download each frame
    for (const f of frames) {
      const link = document.createElement('a')
      link.download = `floor796_frame_${String(f.frame).padStart(2, '0')}.png`
      link.href = f.dataUrl
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      await new Promise(r => setTimeout(r, 100))
    }

    if (!wasFrozen) unfreezeAnimation()
    log(`📦 Exported ${frames.length} frames`)
    return frames.length
  }

  /** Get the native site FPS (from Sn.getAvgFps via Cn[] array) */
  function getNativeFps () {
    const m = getSceneMatrix()
    if (!m) return 0
    try {
      if (typeof m.constructor?.getAvgFps === 'function') {
        return m.constructor.getAvgFps()
      }
    } catch {}
    return 0
  }

  // ── Render slot injection ──
  function addRenderSlot (x, y, width, height, url) {
    document.dispatchEvent(
      new CustomEvent('add-render-slot', {
        detail: { x: +x, y: +y, width: +width, height: +height, url }
      })
    )
    log(`Render slot added: ${url} at (${x},${y}) ${width}×${height}`)
  }

  function deleteSlotsPattern (pattern) {
    document.dispatchEvent(
      new CustomEvent('delete-slots-by-url-pattern', {
        detail: new RegExp(pattern)
      })
    )
    log(`Render slots deleted matching: ${pattern}`)
  }

  // ── Cache API (front.js: caches.open('f796')) ──
  async function getCacheStats () {
    try {
      const cache = await caches.open('f796')
      const keys = await cache.keys()
      let totalSize = 0
      const entries = []
      for (const req of keys.slice(0, 200)) {
        const resp = await cache.match(req)
        const blob = resp ? await resp.clone().blob() : null
        const size = blob ? blob.size : 0
        totalSize += size
        entries.push({ url: req.url, size })
      }
      return { count: keys.length, totalSize, entries: entries.slice(0, 50) }
    } catch (e) {
      return { count: 0, totalSize: 0, entries: [], error: e.message }
    }
  }

  async function clearF796Cache () {
    try {
      await caches.delete('f796')
      log('F796 cache cleared')
      return true
    } catch (e) {
      log('Cache clear error: ' + e.message)
      return false
    }
  }

  // ── Matrix live data ──
  function getMatrixLiveData () {
    if (!matrix) return null
    const md = matrix.matrixData || matrix._matrixData || {}
    return {
      updates: md.updates || [],
      perimeter: md.perimeter || [],
      fullsizeFiles: md.fullsizeFiles || [],
      downloadSize: md.downloadSize || 0,
      time: md.time || 0,
      progress: md.progress || 0,
      ver: md.ver || '?'
    }
  }

  // ── Fullsize images ──
  function getFullsizeImages () {
    const md = getMatrixLiveData()
    if (!md) return []
    const staticUrl =
      unsafeWindow.floor796?.STATIC_URL || 'https://static.floor796.com'
    return (md.fullsizeFiles || []).map(f => {
      const [filename, size] = Array.isArray(f) ? f : [f, 0]
      return { filename, size, url: staticUrl + '/data/fullsize/' + filename }
    })
  }

  // ── Selected item tracking ──
  function getSelectedItem () {
    return unsafeWindow.__selectedItem || null
  }

  // ── Dynamic site data extraction (LIVE from globalThis.floor796) ──
  function extractLiveSiteData () {
    const f796 =
      unsafeWindow.globalThis?.floor796 || unsafeWindow.floor796 || {}
    const data = {
      STATIC_URL: f796.STATIC_URL || null,
      IS_SMALL_VIEW: f796.IS_SMALL_VIEW ?? null,
      IS_EMBEDDED_MODE: f796.IS_EMBEDDED_MODE ?? null,
      IS_WEBP_SUPPORTED: f796.IS_WEBP_SUPPORTED ?? null,
      hasUtils: !!f796.Utils,
      hasByteArrayReader: !!f796.ByteArrayReader,
      hasMatrixLoader: !!f796.MatrixLoader,
      hasEmbeddedFiles: !!f796.EmbeddedFiles,
      hasDragController: !!f796.DragController,
      hasForm: !!f796.Form,
      hasList: !!f796.List,
      hasPopupMenu: !!f796.PopupMenu,
      detectedLanguage:
        typeof f796.detectUserLanguage === 'function'
          ? f796.detectUserLanguage()
          : null
    }
    // Extract CDN info
    try {
      data.cdnFromHtml = document.documentElement?.dataset?.cdn || null
    } catch {
      data.cdnFromHtml = null
    }
    return data
  }

  // ── Site resource discovery — scan DOM + fetch HTML for all JS/CSS/asset URLs ──
  const discoveredResources = {
    js: [],
    css: [],
    workers: [],
    wasm: [],
    json: [],
    images: [],
    audio: [],
    other: []
  }

  function discoverResourcesFromDOM () {
    const resources = {
      js: new Set(),
      css: new Set(),
      workers: new Set(),
      wasm: new Set(),
      json: new Set(),
      images: new Set(),
      audio: new Set(),
      other: new Set()
    }

    // Scripts in page
    document.querySelectorAll('script[src]').forEach(s => {
      const src = s.src || s.getAttribute('src') || ''
      if (src) resources.js.add(src)
    })
    // Script data-type=js (floor796 uses this for front.js)
    document.querySelectorAll('script[data-type="js"]').forEach(s => {
      const url = s.textContent.trim()
      if (url) resources.js.add(url)
    })
    // Stylesheets
    document.querySelectorAll('link[rel="stylesheet"]').forEach(l => {
      const href = l.href || l.getAttribute('href') || ''
      if (href) resources.css.add(href)
    })
    // Images / icons
    document
      .querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]')
      .forEach(l => {
        const href = l.href || l.getAttribute('href') || ''
        if (href) resources.images.add(href)
      })
    document.querySelectorAll('img[src]').forEach(i => {
      if (i.src) resources.images.add(i.src)
    })

    // Known endpoints from front.js analysis
    const base = 'https://floor796.com'
    const staticBase = unsafeWindow.floor796?.STATIC_URL
      ? 'https://' + unsafeWindow.floor796.STATIC_URL
      : 'https://static.floor796.com'

    // Workers & WASM
    ;[
      '/workers/scene-slot-v6.js',
      '/workers/embedded-scene-slot-v1.js',
      '/workers/brotli_decompress.js'
    ].forEach(w => resources.workers.add(base + w))
    resources.wasm.add(base + '/workers/brotli_decompress_bg.wasm')
    resources.other.add(base + '/sw.js')

    // Data files
    ;['/data/changelog.json', '/data/matrix.json'].forEach(d =>
      resources.json.add(base + d)
    )
    try {
      const lang = unsafeWindow.floor796?.detectUserLanguage?.() || ''
      if (lang && lang !== 'en')
        resources.json.add(base + '/data/changelog-' + lang + '.json')
    } catch {}

    // Interactive pages (from live changelog data)
    Object.values(getInteractiveUrls()).forEach(info => {
      resources.js.add(base + info.url)
    })

    // Addon random-list endpoints
    ;[
      '/addon/change-my-mind/random-list',
      '/addon/melody/random-list',
      '/addon/fun-drawing-v2/random-list',
      '/addon/free-ads/list',
      '/addon/changes'
    ].forEach(ep => {
      resources.json.add(base + ep)
    })

    // Addon render.js files
    getAddonRenderers().forEach(a => resources.js.add(base + a.url))

    // Front.js + CSS with hash
    if (frontJsUrl) resources.js.add(frontJsUrl)

    // Fullsize images
    getFullsizeImages().forEach(f => resources.images.add(f.url))

    // Populate discoveredResources
    for (const [cat, set] of Object.entries(resources)) {
      discoveredResources[cat] = [...set].sort()
    }

    log(
      `Resource discovery: ${Object.values(discoveredResources).reduce(
        (a, b) => a + b.length,
        0
      )} total URLs found`
    )
    return discoveredResources
  }

  // ── Live fetch to discover additional JS endpoints from the site HTML ──
  function discoverFromLiveHTML () {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://floor796.com/',
        onload (r) {
          try {
            const html = r.responseText
            // Find all .js references
            const jsMatches =
              html.match(/(?:src|href|data-type="js">)[^"<]*\.js[^"<]*/g) || []
            jsMatches.forEach(m => {
              const url = m
                .replace(/^(src="|href="|data-type="js">)/, '')
                .replace(/"$/, '')
                .trim()
              if (url && !discoveredResources.js.includes(url)) {
                const full = url.startsWith('http')
                  ? url
                  : 'https://floor796.com' +
                    (url.startsWith('/') ? '' : '/') +
                    url
                discoveredResources.js.push(full)
              }
            })
            // Find all .css references
            const cssMatches = html.match(/href="[^"]*\.css[^"]*"/g) || []
            cssMatches.forEach(m => {
              const url = m
                .replace(/^href="/, '')
                .replace(/"$/, '')
                .trim()
              if (url && !discoveredResources.css.includes(url)) {
                const full = url.startsWith('http')
                  ? url
                  : 'https://floor796.com' +
                    (url.startsWith('/') ? '' : '/') +
                    url
                discoveredResources.css.push(full)
              }
            })
            // CDN domain from HTML
            const cdnMatch = html.match(/data-cdn="([^"]+)"/)
            if (cdnMatch) log(`Live HTML CDN: ${cdnMatch[1]}`)
            resolve(discoveredResources)
          } catch (e) {
            log('Live HTML parse error: ' + e.message)
            resolve(discoveredResources)
          }
        },
        onerror () {
          resolve(discoveredResources)
        }
      })
    })
  }

  // ── Download a resource and offer it as a file ──
  function downloadResource (url, filename) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        onload (r) {
          try {
            const blob = r.response || new Blob([r.responseText])
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download =
              filename || url.split('/').pop().split('?')[0] || 'download'
            document.body.appendChild(a)
            a.click()
            setTimeout(() => {
              a.remove()
              URL.revokeObjectURL(a.href)
            }, 1000)
            log(`Downloaded: ${filename || url}`)
            resolve(true)
          } catch (e) {
            log('Download error: ' + e.message)
            resolve(false)
          }
        },
        onerror () {
          log('Download failed: ' + url)
          resolve(false)
        }
      })
    })
  }

  // ── Batch downloader — fetches text content and offers as zip-like concat ──
  async function batchFetchResources (urls, progressCb) {
    const results = []
    for (let i = 0; i < urls.length; i++) {
      if (progressCb) progressCb(i, urls.length, urls[i])
      try {
        const text = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: urls[i],
            onload (r) {
              resolve({
                url: urls[i],
                status: r.status,
                size: (r.responseText || '').length,
                text: r.responseText || ''
              })
            },
            onerror () {
              resolve({ url: urls[i], status: 0, size: 0, error: 'network' })
            }
          })
        })
        results.push(text)
      } catch (e) {
        results.push({ url: urls[i], status: 0, size: 0, error: e.message })
      }
    }
    return results
  }

  // ── IndexedDB browser (floor796 db v3 — embedded_files store) ──
  async function getIndexedDBEntries () {
    try {
      return await new Promise((resolve, reject) => {
        const req = indexedDB.open('floor796', 3)
        req.onerror = () => resolve([])
        req.onsuccess = () => {
          const db2 = req.result
          if (!db2.objectStoreNames.contains('embedded_files')) {
            db2.close()
            resolve([])
            return
          }
          const tx = db2.transaction('embedded_files', 'readonly')
          const store = tx.objectStore('embedded_files')
          const all = store.getAll()
          const keys = store.getAllKeys()
          all.onsuccess = () => {
            keys.onsuccess = () => {
              const entries = (keys.result || []).map((k, i) => ({
                key: k,
                size: all.result[i]
                  ? all.result[i].byteLength ||
                    all.result[i].length ||
                    JSON.stringify(all.result[i]).length
                  : 0
              }))
              db2.close()
              resolve(entries)
            }
          }
          all.onerror = () => {
            db2.close()
            resolve([])
          }
        }
        req.onupgradeneeded = () => {
          /* don't create stores */
        }
      })
    } catch {
      return []
    }
  }

  // ── Hidden Features: Addon Condition Unlocking ──
  // Addons (extra animated overlays on the map) can have conditions:
  //   ls:KEY          — visible only when localStorage has KEY
  //   lsb:KEY,INDEX,C — visible only when localStorage[KEY][INDEX] === C
  // We can enumerate them from the live matrix and unlock/lock them.

  function getAddonConditions () {
    try {
      const matrixData =
        ctrl?._matrix?.matrixData ||
        ctrl?._matrix?._matrixData ||
        unsafeWindow.globalThis?.floor796?.controller?._matrix?.matrixData
      if (!matrixData?.addons) return []
      return matrixData.addons
        .filter(a => a.cond)
        .map(a => {
          const parsed = a.cond.split(';').map(part => {
            const [type, val] = part.split(':', 2)
            if (type === 'ls') return { type: 'ls', key: val, raw: part }
            if (type === 'lsb') {
              const [key, idx, char] = val.split(',')
              return { type: 'lsb', key, index: +idx, char, raw: part }
            }
            return { type: 'unknown', raw: part }
          })
          const isMet = parsed.every(c => {
            if (c.type === 'ls') return localStorage.getItem(c.key) !== null
            if (c.type === 'lsb') {
              const v = localStorage.getItem(c.key)
              return v && v[c.index] === c.char
            }
            return false
          })
          return { url: a.url, pts: a.pts, cond: a.cond, parsed, isMet }
        })
    } catch (e) {
      log('getAddonConditions error: ' + e.message)
      return []
    }
  }

  function unlockAllAddons () {
    const conds = getAddonConditions()
    let unlocked = 0
    for (const { parsed } of conds) {
      for (const c of parsed) {
        if (c.type === 'ls') {
          if (localStorage.getItem(c.key) === null) {
            localStorage.setItem(c.key, '1')
            log(`Unlocked addon: set localStorage['${c.key}'] = '1'`)
            unlocked++
          }
        } else if (c.type === 'lsb') {
          let val = localStorage.getItem(c.key) || ''
          // Extend string if needed
          while (val.length <= c.index) val += '0'
          if (val[c.index] !== c.char) {
            val =
              val.substring(0, c.index) + c.char + val.substring(c.index + 1)
            localStorage.setItem(c.key, val)
            log(
              `Unlocked addon: set localStorage['${c.key}'][${c.index}] = '${c.char}'`
            )
            unlocked++
          }
        }
      }
    }
    if (unlocked > 0)
      log(
        `✓ Unlocked ${unlocked} addon conditions — reload page to see changes`
      )
    else log('All addon conditions already met (or none found)')
    return unlocked
  }

  function lockAllAddons () {
    const conds = getAddonConditions()
    const keysRemoved = new Set()
    for (const { parsed } of conds) {
      for (const c of parsed) {
        if (c.type === 'ls' && !keysRemoved.has(c.key)) {
          localStorage.removeItem(c.key)
          keysRemoved.add(c.key)
        } else if (c.type === 'lsb' && !keysRemoved.has(c.key)) {
          localStorage.removeItem(c.key)
          keysRemoved.add(c.key)
        }
      }
    }
    log(`Locked ${keysRemoved.size} addon keys — reload to see changes`)
    return keysRemoved.size
  }

  // ── Hidden Features: Debug Canvas Overlay ──
  // The site creates a hidden canvas for hitbox detection.
  // ?debug makes it visible. We can toggle it programmatically.

  function enableDebugCanvas () {
    try {
      // The debug canvas is the item-detection canvas with z-index 100000
      const canvases = document.querySelectorAll('canvas')
      for (const c of canvases) {
        if (
          c.style.zIndex === '100000' ||
          c.style.cssText?.includes('z-index:100000') ||
          c.style.cssText?.includes('z-index: 100000')
        ) {
          c.style.display = 'block'
          c.style.opacity = '0.5'
          log('Debug canvas found and shown')
          return true
        }
      }
      // If not found, the canvas might be in the matrix controller
      const itemLayer =
        ctrl?._matrix?._itemsLayer || ctrl?._matrix?._changedAreas
      if (itemLayer?._canvas) {
        const cv = itemLayer._canvas
        cv.style.cssText =
          'position:fixed;top:0;left:0;z-index:100000;pointer-events:none;opacity:0.5'
        document.body.appendChild(cv)
        log('Debug canvas injected from controller')
        return true
      }
      log('Debug canvas not found — try adding ?debug to URL')
      return false
    } catch (e) {
      log('enableDebugCanvas error: ' + e.message)
      return false
    }
  }

  // ── Hidden Features: Extra Zoom without URL reload ──
  // Normally ?extra-zoom sets zoom array to [4,3,2,1,0.7].
  // We can inject this at runtime by modifying the controller.

  function enableExtraZoomLive () {
    try {
      if (!matrix) {
        log('Matrix not ready')
        return false
      }
      // The zoom array is stored in the matrix options
      const opts = matrix._options || matrix.options || {}
      const currentSteps = opts.zoomSteps || opts._zoomSteps
      const extraSteps = [4, 3, 2, 1, 0.7, 0.5, 0.3, 0.1]
      if (currentSteps && Array.isArray(currentSteps)) {
        currentSteps.length = 0
        currentSteps.push(...extraSteps)
        log(
          '✓ Extra zoom injected into existing array: ' +
            JSON.stringify(extraSteps)
        )
        return true
      }
      // Try setting via setZoomFactor directly — the zoom bypass already handles this
      log(
        'Zoom array not found — the existing zoom bypass (0.01–20) already provides better range'
      )
      return false
    } catch (e) {
      log('enableExtraZoomLive error: ' + e.message)
      return false
    }
  }

  // ── Hidden Features: Selected Item Tracker ──
  // window.__selectedItem is set whenever a user clicks an item on the map.
  // We poll it to show real-time info.

  let selectedItemPollTimer = null
  let lastSelectedItemId = null

  function startSelectedItemTracker (callback) {
    if (selectedItemPollTimer) return
    selectedItemPollTimer = setInterval(() => {
      const sel = unsafeWindow.__selectedItem
      if (sel?.item?.id !== lastSelectedItemId) {
        lastSelectedItemId = sel?.item?.id
        if (callback) callback(sel)
      }
    }, 500)
    log('Selected item tracker started')
  }

  function stopSelectedItemTracker () {
    if (selectedItemPollTimer) {
      clearInterval(selectedItemPollTimer)
      selectedItemPollTimer = null
      log('Selected item tracker stopped')
    }
  }

  // ── Hidden Features: Last Event Tracker ──
  function getLastEvent () {
    return unsafeWindow.__lastEvent || null
  }

  // ── Hidden Features: Original Fetch (bypass offline intercept) ──
  function getOriginalFetch () {
    return unsafeWindow.__oldFetch || unsafeWindow.fetch
  }

  // ── Hidden Features: Render Engine Toggle (without reload) ──
  function getRenderEngineInfo () {
    const ls = localStorage.getItem('f796-render-engine-v3')
    const isOldRenderURL = window.location.search.includes('old-render')
    const hasWASM = 'object' === typeof WebAssembly
    const hasWorker = 'Worker' in window
    const hasImageBitmap = 'createImageBitmap' in window
    const usingF796 =
      hasWASM &&
      hasWorker &&
      hasImageBitmap &&
      [null, '1'].includes(ls) &&
      !isOldRenderURL
    return {
      current: usingF796 ? 'F796 (WASM/Worker)' : 'MP4 (Legacy)',
      lsValue: ls,
      isOldRenderURL,
      hasWASM,
      hasWorker,
      hasImageBitmap,
      canUseF796: hasWASM && hasWorker && hasImageBitmap
    }
  }

  function toggleRenderEngine () {
    const current = localStorage.getItem('f796-render-engine-v3')
    if (current === '0') {
      localStorage.setItem('f796-render-engine-v3', '1')
      log('Render engine set to F796 (WASM) — reload to apply')
    } else {
      localStorage.setItem('f796-render-engine-v3', '0')
      log('Render engine set to MP4 (Legacy) — reload to apply')
    }
  }

  // ── localStorage helpers (site-specific keys) ──
  function getFloor796LocalStorage () {
    const entries = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        entries.push({ key, value: localStorage.getItem(key) })
      }
    } catch {}
    return entries.sort((a, b) => a.key.localeCompare(b.key))
  }

  // ── Scene item count per scene ──
  function getSceneStats () {
    const counts = {}
    getSceneGrid()
      .flat()
      .forEach(s => (counts[s] = 0))
    db.items.forEach(item => {
      if (item._center && item._center.scene) {
        counts[item._center.scene] = (counts[item._center.scene] || 0) + 1
      }
    })
    return counts
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 5 ─ HOOK BRIDGE WIRING
  //
  //  Section 0 installed the fetch/XHR/WS/BC hooks at the very top of the
  //  IIFE before anything else.  Now that log(), _melodyForceData, and
  //  onDataIntercepted() exist, we wire them into the bridge so the hooks
  //  can call them.
  // ═══════════════════════════════════════════════════════════════════════════

  _hookBridge.log = log
  // onDataIntercepted is defined in Section 6 (below) — deferred assignment
  // happens at the end of Section 6.
  _hookBridge.getMelodyForceData = () => _melodyForceData
  _hookBridge.clearMelodyForceData = () => {
    _melodyForceData = null
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 6 ─ DATA LAYER — fetch, parse, categorize, search
  // ═══════════════════════════════════════════════════════════════════════════

  let db = {
    items: [],
    matrix: null,
    byType: {},
    loaded: false,
    fetchedAt: null
  }

  function classifyItem (item) {
    const link = (item.l || '').split('||')[0].trim()
    const title = (item.t || '').toLowerCase()
    if (link.startsWith('interactive://'))
      return title.includes('quest') ? 'quest' : 'interactive'
    if (link.startsWith('event://')) return 'event'
    if (link.startsWith('play://') || link.startsWith('play-loop://'))
      return 'audio'
    if (link.startsWith('img://')) return 'image'
    return 'character'
  }

  function parsePolygon (p) {
    if (!p) return null
    const pts = p
      .split(';')
      .map(s => {
        const c = s.split(',')
        return c.length >= 3 ? { scene: c[0], x: +c[1], y: +c[2] } : null
      })
      .filter(Boolean)
    if (!pts.length) return null
    const counts = {}
    pts.forEach(pt => (counts[pt.scene] = (counts[pt.scene] || 0) + 1))
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    const sp = pts.filter(pt => pt.scene === main)
    return {
      scene: main,
      x: Math.round(sp.reduce((s, pt) => s + pt.x, 0) / sp.length),
      y: Math.round(sp.reduce((s, pt) => s + pt.y, 0) / sp.length),
      points: pts
    }
  }

  function buildDatabase (changelogData, matrixData) {
    const items = Array.isArray(changelogData) ? changelogData : []
    const byType = {
      interactive: [],
      event: [],
      audio: [],
      image: [],
      quest: [],
      character: []
    }

    items.forEach(item => {
      item._type = classifyItem(item)
      item._center = parsePolygon(item.p)
      // Extract all event names and link keywords for searching
      const allLinks = (item.l || '')
        .split('||')
        .map(s => s.trim())
        .filter(Boolean)
      item._eventNames = allLinks
        .filter(l => l.startsWith('event://'))
        .map(l => l.replace('event://', '').split('?')[0].trim())
        .filter(Boolean)
      item._linkKeywords = allLinks
        .map(l =>
          l
            .replace(/^(interactive|event|play|play-loop|img):[\/]+/, '')
            .split('?')[0]
            .trim()
        )
        .filter(Boolean)
      ;(byType[item._type] || byType.character).push(item)
    })

    db = {
      items,
      matrix: matrixData,
      byType,
      loaded: true,
      fetchedAt: new Date().toISOString()
    }

    storageSet(SK.db, {
      itemCount: items.length,
      types: Object.fromEntries(
        Object.entries(byType).map(([k, v]) => [k, v.length])
      ),
      fetchedAt: db.fetchedAt,
      matrixVer: matrixData?.ver || null
    })

    log(
      `Database built: ${items.length} items – ` +
        Object.entries(byType)
          .map(([k, v]) => `${k}:${v.length}`)
          .join(' ')
    )
    renderActiveTab()
  }

  function fetchLiveData () {
    log('Fetching live data…')
    let done = 0,
      cData = null,
      mData = null
    const check = () => {
      if (++done < 2) return
      const prev = db.items?.length || 0
      buildDatabase(cData, mData)
      if (prev > 0 && db.items.length !== prev)
        log(
          `♻️ Live refresh: ${prev} → ${db.items.length} items (cache was stale!)`
        )
    }

    const cacheBust = '?_=' + Date.now()

    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://floor796.com' + CHANGELOG_URL + cacheBust,
      responseType: 'json',
      headers: { 'Cache-Control': 'no-cache' },
      onload (r) {
        try {
          cData =
            typeof r.response === 'string' ? JSON.parse(r.response) : r.response
        } catch {}
        log(
          `Fetched changelog: ${
            Array.isArray(cData) ? cData.length : '?'
          } items`
        )
        check()
      },
      onerror () {
        log('changelog fetch error – using intercepted')
        cData = intercepted.changelog
        check()
      }
    })

    GM_xmlhttpRequest({
      method: 'GET',
      url: 'https://floor796.com' + MATRIX_URL + cacheBust,
      responseType: 'json',
      headers: { 'Cache-Control': 'no-cache' },
      onload (r) {
        try {
          mData =
            typeof r.response === 'string' ? JSON.parse(r.response) : r.response
        } catch {}
        log(`Fetched matrix: ver=${mData?.ver}`)
        check()
      },
      onerror () {
        log('matrix fetch error – using intercepted')
        mData = intercepted.matrix
        check()
      }
    })
  }

  function onDataIntercepted () {
    if (!db.loaded && intercepted.changelog) {
      log('Building DB from intercepted data')
      buildDatabase(intercepted.changelog, intercepted.matrix)
    }
  }

  // Wire onDataIntercepted into the early hook bridge (Section 0)
  _hookBridge.onDataIntercepted = onDataIntercepted

  function searchItems (query) {
    if (!query || query.length < 1) return db.items.slice(0, 50)
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    return db.items
      .map(item => {
        const t = (item.t || '').toLowerCase()
        const evStr = (item._eventNames || []).join(' ').toLowerCase()
        const lnkStr = (item._linkKeywords || []).join(' ').toLowerCase()
        let score = 0
        for (const term of terms) {
          const tIdx = t.indexOf(term)
          const eIdx = evStr.indexOf(term)
          const lIdx = lnkStr.indexOf(term)
          if (tIdx === -1 && eIdx === -1 && lIdx === -1) return null
          // Title match scores highest
          if (tIdx !== -1) {
            score += 100 - tIdx + term.length * 10
            if (t === query.toLowerCase()) score += 500
            else if (t.startsWith(query.toLowerCase())) score += 200
          }
          // Event name match
          if (eIdx !== -1) score += 80 + term.length * 8
          // Link keyword match
          if (lIdx !== -1) score += 50 + term.length * 5
        }
        return { item, score }
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .map(r => r.item)
      .slice(0, 50)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 7 ─ NAVIGATION — teleport via controller API or hash fallback
  // ═══════════════════════════════════════════════════════════════════════════

  function getCurrentPosition () {
    if (pos) {
      try {
        const w = pos.width || window.innerWidth
        const h = pos.height || window.innerHeight
        const code = pos.getPositionCode(w >> 1, h >> 1)
        if (code) {
          const m = POS_RE.exec(code)
          if (m)
            return { scene: m[1], x: +m[2], y: +m[3], zoom: getZoomFactor() }
        }
      } catch {}
    }
    // Hash fallback
    const m = POS_RE.exec(window.location.hash)
    if (m) return { scene: m[1], x: +m[2], y: +m[3], zoom: m[4] ? +m[4] : null }
    return null
  }

  function teleportTo (scene, x, y, animate) {
    const code = `${scene},${y},${x}` // front.js format: sceneId,row,col

    if (pos) {
      try {
        if (animate && pos.transition?.moveQuick) {
          pos.transition.moveQuick(code)
          log(`Flying to ${code}`)
        } else {
          pos.setPositionCode(code)
          pos.savePosition()
          log(`Teleported to ${code}`)
        }
        return
      } catch (e) {
        log('Controller teleport failed: ' + e.message)
      }
    }
    // Hash fallback
    log(`Teleporting via hash: #${code}`)
    window.location.hash = '#' + code
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  function teleportToItem (item, animate) {
    // From front.js _selectItem(t, e):
    //   e=false (select-custom-item default): only edge-corrects, does NOT center
    //   e=true  (changes bar click):          flies camera to bbox center + overlay
    //
    // Strategy:
    //   1. Best: call ctrl._selectItem(item, true) directly — exact changes-bar behavior
    //   2. Fallback: compute bbox center ourselves, moveQuick, then dispatch event
    //   3. Last resort: hash teleport

    // ── Path 1: direct _selectItem on controller (e=true → fly + center + highlight) ──
    if (ctrl && typeof ctrl._selectItem === 'function') {
      ctrl._selectItem(item, true).catch(() => {})
      log(`_selectItem(true): "${item.t}"`)
      return
    }

    // ── Path 2: manual center + select-custom-item ──
    if (pos && item.p) {
      try {
        // Parse position codes the same way _selectItem does:
        //   s = t.p.split(";").map(t => parsePositionCode(t))
        //   a = Ge(s)  ← bounding-box center
        //   r = getPositionCode(a.x, a.y)
        //   moveQuick(r)
        const pts = item.p
          .split(';')
          .map(c => pos.parsePositionCode(c))
          .filter(Boolean)
        if (pts.length) {
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity
          for (const pt of pts) {
            if (pt.x < minX) minX = pt.x
            if (pt.y < minY) minY = pt.y
            if (pt.x > maxX) maxX = pt.x
            if (pt.y > maxY) maxY = pt.y
          }
          const centerCode = pos.getPositionCode(
            (minX + maxX) / 2,
            (minY + maxY) / 2
          )
          if (centerCode && pos.transition?.moveQuick) {
            pos.transition.moveQuick(centerCode).then(() => {
              pos.savePosition()
              try {
                document.dispatchEvent(
                  new CustomEvent('select-custom-item', { detail: item })
                )
              } catch {}
            })
            log(`moveQuick+highlight: "${item.t}"`)
            return
          }
        }
      } catch (e) {
        log('teleportToItem center calc failed: ' + e.message)
      }
    }

    // ── Path 3: select-custom-item only (no centering) ──
    try {
      document.dispatchEvent(
        new CustomEvent('select-custom-item', { detail: item })
      )
      log(`select-custom-item (no center): "${item.t}"`)
    } catch (e) {
      // ── Path 4: hash fallback ──
      if (!item._center) item._center = parsePolygon(item.p)
      if (item._center) {
        teleportTo(item._center.scene, item._center.x, item._center.y, animate)
      } else {
        log(`Cannot navigate to "${item.t}" – no polygon data`)
      }
    }
  }

  // ── Bookmarks ──
  function getBookmarks () {
    return storageGet(SK.bookmarks, [])
  }
  function saveBookmark (n, s, x, y) {
    const bm = getBookmarks()
    bm.push({ name: n, scene: s, x, y, ts: Date.now() })
    storageSet(SK.bookmarks, bm)
  }
  function deleteBookmark (i) {
    const bm = getBookmarks()
    bm.splice(i, 1)
    storageSet(SK.bookmarks, bm)
  }

  // ── Completed quests ──
  function getCompleted () {
    return storageGet(SK.completed, [])
  }
  function toggleCompleted (id) {
    const c = getCompleted()
    const i = c.indexOf(id)
    if (i >= 0) c.splice(i, 1)
    else c.push(id)
    storageSet(SK.completed, c)
    return c.includes(id)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 8 ─ UI — CSS injection, panel, drag, tabs
  // ═══════════════════════════════════════════════════════════════════════════

  let panel = null
  let activeTab = 'search'
  let panelCollapsed = false

  const TABS = [
    { id: 'search', icon: '🔍', label: 'Search' },
    { id: 'navigate', icon: '🗺️', label: 'Navigate' },
    { id: 'map', icon: '🧩', label: 'Map' },
    { id: 'eastereggs', icon: '🐣', label: 'Easter Eggs' },
    { id: 'characters', icon: '👤', label: 'Characters' },
    { id: 'quests', icon: '⚔️', label: 'Quests' },
    { id: 'playback', icon: '⏯️', label: 'Playback' },
    { id: 'control', icon: '🎛️', label: 'Control' },
    { id: 'tools', icon: '🔧', label: 'Tools' },
    { id: 'traffic', icon: '📡', label: 'Traffic' },
    { id: 'phonebook', icon: '📞', label: 'Phonebook' },
    { id: 'hologram', icon: '🎬', label: 'Hologram' },
    { id: 'ripper', icon: '⬇️', label: 'Ripper' },
    { id: 'dbview', icon: '📊', label: 'DB' }
  ]

  const TYPE_ICONS = {
    interactive: '🎮',
    event: '⚡',
    audio: '🔊',
    image: '🖼️',
    quest: '⚔️',
    character: '👤'
  }
  const TYPE_COLORS = {
    interactive: '#ff6b9d',
    event: '#ffd93d',
    audio: '#6bcb77',
    image: '#c084fc',
    quest: '#f97316',
    character: '#67e8f9'
  }

  // ── Inject stylesheet ──
  function injectStyles () {
    const style = document.createElement('style')
    style.textContent = `
/* ─── Panel Shell ─── */
#f796-companion{position:fixed;bottom:16px;right:16px;width:420px;max-height:620px;background:#080c12;border:1px solid #00ffc855;border-radius:10px;font-family:'Consolas','Courier New',monospace;font-size:12px;color:#c5d0d8;z-index:999999;display:flex;flex-direction:column;box-shadow:0 0 30px rgba(0,255,200,.12),0 0 60px rgba(0,255,200,.04),0 8px 32px rgba(0,0,0,.7);user-select:none;transition:max-height .25s ease;direction:ltr;unicode-bidi:isolate;text-align:left;backdrop-filter:blur(8px)}
#f796-companion::before{content:'';position:absolute;inset:-1px;border-radius:10px;padding:1px;background:linear-gradient(135deg,#00ffc844,transparent 40%,transparent 60%,#00ffc822);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;z-index:1}
#f796-companion input,#f796-companion textarea,#f796-companion select{user-select:text!important;-webkit-user-select:text!important;cursor:text!important;caret-color:#00ffc8}
#f796-companion.collapsed{max-height:48px;overflow:hidden}
#f796-companion.hidden{display:none}

/* ─── Header ─── */
#f796-header{display:flex;align-items:center;gap:10px;padding:10px 14px;background:linear-gradient(135deg,#0c1018 0%,#0f1620 50%,#0c1018 100%);border-bottom:1px solid #00ffc822;cursor:move;border-radius:10px 10px 0 0;flex-shrink:0;position:relative;overflow:hidden}
#f796-header::after{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#00ffc844,transparent)}
#f796-header .hud-icon{width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#00ffc822,#00ffc808);border:1px solid #00ffc844;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;box-shadow:0 0 8px #00ffc822}
#f796-header .title-group{flex:1;min-width:0}
#f796-header .title{color:#00ffc8;font-weight:bold;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;line-height:1.2;text-shadow:0 0 8px #00ffc833}
#f796-header .subtitle{font-size:9px;color:#3d5060;letter-spacing:.5px;margin-top:1px}
#f796-header .controls{display:flex;gap:5px;flex-shrink:0}
#f796-header .controls button{background:#0a1018;border:1px solid #00ffc833;color:#00ffc8;width:26px;height:26px;font-size:13px;cursor:pointer;border-radius:5px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;transition:all .15s}
#f796-header .controls button:hover{background:#00ffc822;border-color:#00ffc8;box-shadow:0 0 6px #00ffc833}

/* ─── Tabs ─── */
#f796-tabs{display:flex;flex-wrap:wrap;background:#0a0f16;border-bottom:1px solid #00ffc818;flex-shrink:0;padding:2px 4px;gap:1px;scrollbar-width:none;-ms-overflow-style:none}
#f796-tabs::-webkit-scrollbar{display:none}
#f796-tabs .tab{flex:0 0 auto;padding:5px 7px 4px;text-align:center;cursor:pointer;font-size:11px;color:#3d5060;border-radius:5px 5px 0 0;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;min-width:0;position:relative;display:flex;flex-direction:column;align-items:center;gap:1px}
#f796-tabs .tab:hover{color:#8aa0b0;background:#0f1822}
#f796-tabs .tab.active{color:#00ffc8;border-bottom-color:#00ffc8;background:linear-gradient(180deg,#0f1822,#0a0f16)}
#f796-tabs .tab.active::before{content:'';position:absolute;bottom:0;left:20%;right:20%;height:1px;background:#00ffc8;box-shadow:0 0 6px #00ffc8}
#f796-tabs .tab .tab-icon{display:block;font-size:16px;line-height:1}
#f796-tabs .tab .tab-label{display:block;font-size:7px;line-height:1;letter-spacing:.3px;opacity:.7;margin-top:1px}

/* ─── Playback Tab Styles ─── */
.pb-status-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;background:#0a0e14;border:1px solid #1e2d3d;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-family:monospace;font-size:11px}
.pb-status-grid .st-label{color:#3d5060;font-size:8px;text-transform:uppercase;letter-spacing:.5px}
.pb-transport{display:flex;gap:4px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.pb-transport .pb-btn{background:#0c1219;border:1px solid #00ffc833;color:#00ffc8;font-size:13px;padding:6px 10px;cursor:pointer;border-radius:5px;transition:all .15s;display:flex;align-items:center;justify-content:center;min-width:36px}
.pb-transport .pb-btn:hover{background:#00ffc818;border-color:#00ffc8;box-shadow:0 0 8px #00ffc822}
.pb-transport .pb-btn:active{transform:scale(.95)}
.pb-transport .pb-btn.active{background:#00ffc822;border-color:#00ffc8;color:#fff}
.pb-transport .sep{color:#1e2d3d;font-size:14px;padding:0 2px}
.pb-modes{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
.pb-modes .mode-btn{font-size:10px;padding:4px 10px;border-radius:16px;cursor:pointer;border:1px solid #1a2a3a;background:#0c1219;color:#5a6672;transition:all .15s;letter-spacing:.3px}
.pb-modes .mode-btn:hover{border-color:#ff6b9d55;color:#ff6b9d}
.pb-modes .mode-btn.active{border-color:#ff6b9d;color:#ff6b9d;background:#ff6b9d18;box-shadow:0 0 8px #ff6b9d22}
.pb-range-row{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:10px}
.pb-range-row label{color:#5a6672;min-width:40px}
.pb-range-row input[type=number]{width:52px;background:#0c1219;border:1px solid #1a2a3a;color:#e0e6ed;padding:3px 6px;font-family:inherit;font-size:11px;border-radius:4px;outline:0;text-align:center}
.pb-range-row input[type=number]:focus{border-color:#ff6b9d}
.pb-slider-row{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.pb-slider-row .sl-label{font-size:9px;color:#5a6672;min-width:48px}
.pb-slider-row input[type=range]{flex:1;accent-color:#ff6b9d;height:18px}
.pb-slider-row .sl-val{color:#ff6b9d;font-size:12px;font-family:monospace;min-width:44px;text-align:right}
.pb-presets{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px}
.pb-presets .f796-btn{font-size:8px;padding:2px 6px}
.pb-timeline{display:flex;gap:1px;margin-bottom:8px;overflow-x:auto;padding:2px 0}
.pb-timeline .tl-frame{min-width:5px;height:20px;background:#1e2d3d;border-radius:1px;cursor:pointer;flex-shrink:0;transition:background .15s}
.pb-timeline .tl-frame.current{background:#ff6b9d;box-shadow:0 0 4px #ff6b9d}
.pb-timeline .tl-frame.in-range{background:#ff6b9d33}
.pb-section{font-size:11px;font-weight:bold;letter-spacing:.5px;padding:6px 0 4px;border-bottom:1px solid #1e2d3d;margin-bottom:6px;color:#5a6672;text-transform:uppercase}

/* ─── Content area ─── */
#f796-content{flex:1;overflow-y:auto;padding:12px;min-height:0;max-height:480px}
#f796-content::-webkit-scrollbar{width:5px}
#f796-content::-webkit-scrollbar-track{background:transparent}
#f796-content::-webkit-scrollbar-thumb{background:#00ffc833;border-radius:4px}
#f796-content::-webkit-scrollbar-thumb:hover{background:#00ffc855}

/* ─── Shared Components ─── */
.f796-input{width:100%;background:#0c1219;border:1px solid #1a2a3a;color:#e0e6ed;padding:7px 10px;font-family:inherit;font-size:12px;border-radius:5px;outline:0;box-sizing:border-box;cursor:text;caret-color:#00ffc8;direction:ltr!important;text-align:left!important;unicode-bidi:normal!important;transition:border-color .15s,box-shadow .15s}
.f796-input:focus{border-color:#00ffc8;box-shadow:0 0 0 2px #00ffc818,0 0 12px #00ffc811}
.f796-input::placeholder{color:#2d4050}
.f796-btn{background:#0c1219;border:1px solid #00ffc833;color:#00ffc8;padding:5px 12px;font-family:inherit;font-size:11px;cursor:pointer;border-radius:5px;transition:all .15s;letter-spacing:.3px}
.f796-btn:hover{background:#00ffc818;border-color:#00ffc8;box-shadow:0 0 8px #00ffc822}
.f796-btn:active{transform:scale(.97)}
.f796-btn-danger{border-color:#ff6b6b33;color:#ff6b6b}
.f796-btn-danger:hover{background:#ff6b6b18;border-color:#ff6b6b;box-shadow:0 0 8px #ff6b6b22}

/* ─── Item list ─── */
.f796-item-list{list-style:none;margin:0;padding:0}
.f796-item{display:flex;align-items:flex-start;gap:8px;padding:7px 8px;border-bottom:1px solid #111c28;cursor:pointer;transition:all .12s;border-radius:4px;margin-bottom:1px}
.f796-item:hover{background:#0f1822;border-color:#00ffc811}
.f796-item:last-child{border-bottom:none}
.f796-item .item-icon{font-size:14px;flex-shrink:0;margin-top:1px}
.f796-item .item-body{flex:1;min-width:0}
.f796-item .item-title{color:#e0e6ed;font-size:11px;line-height:1.3;word-break:break-word}
.f796-item .item-meta{font-size:9px;color:#3d5060;margin-top:2px;display:flex;gap:8px;flex-wrap:wrap}
.f796-item .item-badge{font-size:8px;padding:2px 6px;border-radius:3px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0;margin-top:2px}

/* ─── Filters ─── */
.f796-filters{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
.f796-filter{font-size:10px;padding:3px 8px;border-radius:10px;cursor:pointer;border:1px solid #1a2a3a;background:#0c1219;color:#3d5060;transition:all .15s}
.f796-filter.active{border-color:#00ffc8;color:#00ffc8;background:#00ffc811}
.f796-filter:hover{border-color:#00ffc855}

/* ─── Navigate grid ─── */
.f796-nav-grid{display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;margin-bottom:10px}
.f796-nav-label{color:#3d5060;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
.f796-nav-input{background:#0c1219;border:1px solid #1a2a3a;color:#e0e6ed;padding:5px 8px;font-family:inherit;font-size:11px;border-radius:5px;outline:0;width:100%;box-sizing:border-box;transition:border-color .15s}
.f796-nav-input:focus{border-color:#00ffc8}

/* ─── Zoom ─── */
.f796-zoom-row{display:flex;align-items:center;gap:6px;margin:8px 0}
.f796-zoom-row input[type="range"]{flex:1;accent-color:#00ffc8}
.f796-zoom-val{color:#00ffc8;font-size:11px;min-width:40px;text-align:right}

/* ─── Bookmarks ─── */
.f796-bookmark{display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid #111c28;border-radius:3px;transition:background .1s}
.f796-bookmark:hover{background:#0f1822}
.f796-bookmark .bm-name{flex:1;color:#e0e6ed;font-size:11px;cursor:pointer}
.f796-bookmark .bm-name:hover{color:#00ffc8}
.f796-bookmark .bm-pos{color:#3d5060;font-size:9px}
.f796-bookmark .bm-del{color:#ff6b6b66;cursor:pointer;font-size:12px;transition:color .15s}
.f796-bookmark .bm-del:hover{color:#ff6b6b}

/* ─── DB / Stats ─── */
.f796-stats-table{width:100%;border-collapse:collapse;margin-bottom:10px}
.f796-stats-table td{padding:4px 8px;border-bottom:1px solid #111c28;font-size:11px}
.f796-stats-table td:first-child{color:#3d5060}
.f796-stats-table td:last-child{color:#00ffc8;text-align:right;font-weight:bold}

.f796-log{background:#080c12;border:1px solid #111c28;border-radius:5px;padding:8px;max-height:200px;overflow-y:auto;font-size:9px;color:#3d5060;line-height:1.5;white-space:pre-wrap;word-break:break-all}

.f796-section{color:#00ffc8;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;margin:12px 0 6px;padding-bottom:4px;border-bottom:1px solid #00ffc818;position:relative}
.f796-section:first-child{margin-top:0}
.f796-section::before{content:'▸ ';opacity:.5}

.f796-quest-status{font-size:10px;padding:2px 8px;border-radius:4px}
.f796-quest-done{color:#6bcb77;border:1px solid #6bcb7733;background:#6bcb7708}
.f796-quest-pending{color:#ffd93d;border:1px solid #ffd93d33;background:#ffd93d08}

/* ─── Toggle button ─── */
#f796-toggle{position:fixed;bottom:16px;right:16px;width:44px;height:44px;background:#080c12;border:1px solid #00ffc855;border-radius:50%;color:#00ffc8;font-size:20px;cursor:pointer;z-index:999998;display:none;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(0,255,200,.15),0 4px 12px rgba(0,0,0,.4);transition:all .2s}
#f796-toggle:hover{background:#00ffc818;transform:scale(1.1);box-shadow:0 0 24px rgba(0,255,200,.25)}
#f796-toggle.visible{display:flex}

.f796-empty{text-align:center;color:#2d4050;padding:24px;font-size:11px}
.f796-loading{text-align:center;color:#00ffc8;padding:30px;font-size:12px}
.f796-loading::after{content:'';display:inline-block;width:12px;height:12px;border:2px solid #00ffc833;border-top-color:#00ffc8;border-radius:50%;animation:f796spin .8s linear infinite;margin-left:8px;vertical-align:middle}
@keyframes f796spin{to{transform:rotate(360deg)}}
.f796-count{font-size:9px;color:#2d4050;margin-bottom:6px}

/* ─── Scene Map ─── */
.f796-map-grid{display:grid;grid-template-columns:repeat(9,1fr);gap:2px;margin:8px 0}
.f796-map-cell{aspect-ratio:1.25;background:#0c1219;border:1px solid #1a2a3a;border-radius:3px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:7px;color:#3d5060;transition:all .15s;position:relative;overflow:hidden}
.f796-map-cell:hover{background:#142030;border-color:#00ffc855;z-index:1;transform:scale(1.08)}
.f796-map-cell.active{border-color:#00ffc8;background:#00ffc80d;box-shadow:0 0 8px #00ffc822}
.f796-map-cell.has-addon{border-color:#f9731633}
.f796-map-cell.has-addon::after{content:'';position:absolute;top:2px;right:2px;width:4px;height:4px;background:#f97316;border-radius:50%;box-shadow:0 0 4px #f9731666}
.f796-map-cell .cell-id{font-size:7px;color:#3d5060;font-weight:bold}
.f796-map-cell .cell-count{font-size:6px;color:#2d4050}
.f796-map-cell .cell-bar{position:absolute;bottom:0;left:0;height:2px;background:linear-gradient(90deg,#00ffc8,#00ffc844);transition:width .3s}

/* ─── Tools ─── */
.f796-tool-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px}
.f796-tool-btn{display:flex;flex-direction:column;align-items:center;padding:10px 4px;background:#0c1219;border:1px solid #1a2a3a;border-radius:6px;cursor:pointer;transition:all .15s;color:#c5d0d8}
.f796-tool-btn:hover{border-color:#00ffc855;background:#0f1822;box-shadow:0 0 8px #00ffc811}
.f796-tool-btn .tool-icon{font-size:20px;margin-bottom:3px}
.f796-tool-btn .tool-label{font-size:9px;color:#3d5060}
.f796-tool-btn.active{border-color:#00ffc8;background:#00ffc80d;box-shadow:0 0 10px #00ffc818}

.f796-progress-bar{background:#1a2a3a;border-radius:4px;height:6px;overflow:hidden;margin:4px 0}
.f796-progress-fill{height:100%;background:linear-gradient(90deg,#00ffc8,#00ffc855);border-radius:4px;transition:width .3s;box-shadow:0 0 6px #00ffc833}

.f796-ls-row{display:flex;align-items:center;gap:4px;padding:3px 4px;border-bottom:1px solid #111c28;font-size:9px;border-radius:2px;transition:background .1s}
.f796-ls-row:hover{background:#0f1822}
.f796-ls-key{color:#00ffc8;flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f796-ls-val{color:#3d5060;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}

/* ─── Status bar ─── */
.f796-status-bar{display:flex;gap:8px;padding:5px 14px;background:#080c12;border-top:1px solid #00ffc818;font-size:9px;color:#2d4050;flex-shrink:0;justify-content:space-between;border-radius:0 0 10px 10px}
.f796-status-bar .ok{color:#6bcb77}
.f796-status-bar .warn{color:#ffd93d}
`
    document.head.appendChild(style)
  }

  // ── Build panel DOM ──
  function createPanel () {
    panel = document.createElement('div')
    panel.id = 'f796-companion'
    panel.innerHTML =
      `<div id="f796-header">` +
      `<div class="hud-icon">⬛</div>` +
      `<div class="title-group">` +
      `<div class="title">Floor796 Companion</div>` +
      `<div class="subtitle">v${VERSION} — HUD overlay</div>` +
      `</div>` +
      `<div class="controls">` +
      `<button id="f796-collapse" title="Collapse">−</button>` +
      `<button id="f796-close" title="Hide">×</button>` +
      `</div>` +
      `</div>` +
      `<div id="f796-tabs">` +
      TABS.map(
        t =>
          `<div class="tab${t.id === activeTab ? ' active' : ''}" data-tab="${
            t.id
          }" title="${t.label}">` +
          `<span class="tab-icon">${t.icon}</span>` +
          `<span class="tab-label">${t.label}</span>` +
          `</div>`
      ).join('') +
      `</div>` +
      `<div id="f796-content"><div class="f796-loading">Loading data</div></div>` +
      `<div class="f796-status-bar">` +
      `<span id="f796-si">${
        frontJsIntercepted
          ? '<span class="ok">● front.js intercepted</span>'
          : '<span class="warn">○ front.js</span>'
      }</span>` +
      `<span id="f796-sc">${
        controllerReady
          ? '<span class="ok">● ctrl</span>'
          : '<span class="warn">○ ctrl</span>'
      }</span>` +
      `<span id="f796-sz">${
        zoomPatched
          ? '<span class="ok">● zoom</span>'
          : '<span class="warn">○ zoom</span>'
      }</span>` +
      `</div>`
    document.body.appendChild(panel)

    // Toggle button
    const toggle = document.createElement('div')
    toggle.id = 'f796-toggle'
    toggle.textContent = '⬛'
    toggle.title = 'Show Floor796 Companion'
    document.body.appendChild(toggle)

    // Events
    panel.querySelector('#f796-tabs').addEventListener('click', e => {
      const t = e.target.closest('.tab')
      if (!t) return
      activeTab = t.dataset.tab
      panel
        .querySelectorAll('.tab')
        .forEach(el =>
          el.classList.toggle('active', el.dataset.tab === activeTab)
        )
      renderActiveTab()
    })
    panel.querySelector('#f796-collapse').addEventListener('click', () => {
      panelCollapsed = !panelCollapsed
      panel.classList.toggle('collapsed', panelCollapsed)
      panel.querySelector('#f796-collapse').textContent = panelCollapsed
        ? '+'
        : '−'
    })
    panel.querySelector('#f796-close').addEventListener('click', () => {
      panel.classList.add('hidden')
      toggle.classList.add('visible')
    })
    toggle.addEventListener('click', () => {
      panel.classList.remove('hidden')
      toggle.classList.remove('visible')
    })
    makeDraggable(panel, panel.querySelector('#f796-header'))
    trapPanelKeyboard(panel)

    // Periodic status bar refresh
    setInterval(updateStatusBar, 2000)
  }

  function updateStatusBar () {
    const si = document.getElementById('f796-si')
    const sc = document.getElementById('f796-sc')
    const sz = document.getElementById('f796-sz')
    if (si)
      si.innerHTML = frontJsIntercepted
        ? `<span class="ok">● front.js (${frontJsPatchCount} patches)</span>`
        : '<span class="warn">○ front.js</span>'
    if (sc) {
      const z = getZoomFactor()
      sc.innerHTML = controllerReady
        ? `<span class="ok">● ctrl${
            z != null ? ' z=' + z.toFixed(2) : ''
          }</span>`
        : '<span class="warn">○ ctrl</span>'
    }
    if (sz)
      sz.innerHTML = zoomPatched
        ? '<span class="ok">● zoom ✓</span>'
        : '<span class="warn">○ zoom</span>'
  }

  // Stop keyboard events inside the companion from reaching the site's
  // document-level keydown handlers (which eat arrow keys, letters, etc.)
  // IMPORTANT: use bubble phase (false) — capture phase breaks input caret positioning
  function trapPanelKeyboard (panelEl) {
    for (const evt of ['keydown', 'keyup', 'keypress']) {
      panelEl.addEventListener(
        evt,
        e => {
          if (e.key === 'Escape') return
          e.stopPropagation()
        },
        false
      )
    }
  }

  function makeDraggable (el, handle) {
    let dragging = false,
      sx,
      sy,
      ox,
      oy
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return
      dragging = true
      sx = e.clientX
      sy = e.clientY
      const r = el.getBoundingClientRect()
      ox = r.left
      oy = r.top
      e.preventDefault()
    })
    document.addEventListener('mousemove', e => {
      if (!dragging) return
      el.style.left = ox + e.clientX - sx + 'px'
      el.style.top = oy + e.clientY - sy + 'px'
      el.style.right = 'auto'
      el.style.bottom = 'auto'
    })
    document.addEventListener('mouseup', () => (dragging = false))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 9 ─ TAB RENDERERS
  // ═══════════════════════════════════════════════════════════════════════════

  function renderActiveTab () {
    const c = document.getElementById('f796-content')
    if (!c) return
    if (!db.loaded) {
      c.innerHTML = '<div class="f796-loading">Loading data</div>'
      return
    }
    const renderers = {
      search: renderSearchTab,
      navigate: renderNavigateTab,
      map: renderMapTab,
      eastereggs: renderEasterEggsTab,
      characters: renderCharactersTab,
      quests: renderQuestsTab,
      playback: renderPlaybackTab,
      control: renderControlTab,
      tools: renderToolsTab,
      traffic: renderTrafficTab,
      phonebook: renderPhonebookTab,
      hologram: renderHologramTab,
      ripper: renderRipperTab,
      dbview: renderDBTab
    }
    ;(renderers[activeTab] || renderSearchTab)(c)
  }

  // ── Search ──
  function renderSearchTab (el) {
    el.innerHTML =
      `<input type="text" class="f796-input" id="f796-si2" placeholder="Search characters, easter eggs, memes…" autocomplete="off"/>` +
      `<div class="f796-count" id="f796-sc2"></div>` +
      `<ul class="f796-item-list" id="f796-sr"></ul>`
    const inp = el.querySelector('#f796-si2')
    const res = el.querySelector('#f796-sr')
    const cnt = el.querySelector('#f796-sc2')
    const doSearch = () => {
      const q = inp.value.trim()
      const items = searchItems(q)
      cnt.textContent = q
        ? `${items.length} result${items.length !== 1 ? 's' : ''}`
        : `${db.items.length} total items`
      res.innerHTML = items.map(renderItemRow).join('')
    }
    inp.addEventListener('input', doSearch)
    doSearch()
    res.addEventListener('click', e => {
      const row = e.target.closest('.f796-item')
      if (!row) return
      const item = db.items.find(i => i.id === +row.dataset.id)
      if (item) teleportToItem(item, true)
    })
    setTimeout(() => inp.focus(), 50)
  }

  // ── Navigate ──
  function renderNavigateTab (el) {
    const p = getCurrentPosition()
    const z = getZoomFactor()
    el.innerHTML =
      `<div class="f796-section">Current Position</div>` +
      `<div style="color:#00ffc8;font-size:13px;margin-bottom:8px">` +
      `${p ? `${p.scene}, ${p.x}, ${p.y}` : 'Unknown'}` +
      `${z != null ? ` &nbsp;·&nbsp; zoom: ${z.toFixed(2)}` : ''}` +
      `</div>` +
      `<div class="f796-section">Teleport</div>` +
      `<div class="f796-nav-grid">` +
      `<span class="f796-nav-label">Scene</span>` +
      `<input class="f796-nav-input" id="f796-ns" value="${
        p?.scene || 't0r0'
      }" placeholder="e.g. t0r0, b2l4"/>` +
      `<span class="f796-nav-label">X</span>` +
      `<input class="f796-nav-input" id="f796-nx" type="number" value="${
        p?.x ?? 294
      }"/>` +
      `<span class="f796-nav-label">Y</span>` +
      `<input class="f796-nav-input" id="f796-ny" type="number" value="${
        p?.y ?? 43
      }"/>` +
      `</div>` +
      `<div style="display:flex;gap:6px;margin-bottom:10px">` +
      `<button class="f796-btn" id="f796-snap" style="flex:1">⚡ Snap</button>` +
      `<button class="f796-btn" id="f796-fly"  style="flex:1">🎬 Fly To</button>` +
      `</div>` +
      `<div class="f796-section">Zoom${
        z != null ? ` (${z.toFixed(2)}×)` : ''
      }</div>` +
      `<div class="f796-zoom-row">` +
      `<span style="font-size:10px;color:#5a6672">0.01</span>` +
      `<input type="range" id="f796-zs" min="0.01" max="20" step="0.01" value="${
        z ?? 1
      }"/>` +
      `<span style="font-size:10px;color:#5a6672">20.0</span>` +
      `</div>` +
      `<div style="text-align:center">` +
      `<span class="f796-zoom-val" id="f796-zv">${
        z != null ? z.toFixed(2) : '1.00'
      }</span>` +
      `<button class="f796-btn" id="f796-za" style="margin-left:8px">Apply Zoom</button>` +
      `</div>` +
      `<div style="display:flex;gap:4px;justify-content:center;margin-top:6px">` +
      [0.1, 0.5, 1, 2, 5, 10]
        .map(
          v =>
            `<button class="f796-btn f796-zp" data-z="${v}" style="padding:2px 6px;font-size:10px">${v}×</button>`
        )
        .join('') +
      `</div>` +
      `<div style="font-size:9px;color:#3d4f5f;margin-top:6px;text-align:center">` +
      (zoomPatched
        ? '✅ Zoom bypass active — scroll wheel uses full 0.01×–20× range'
        : controllerReady
        ? '⚠️ Controller found, patching zoom…'
        : '⏳ Waiting for controller…') +
      `</div>` +
      `<div class="f796-section">World View (experimental)</div>` +
      `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">` +
      `<button class="f796-btn" id="f796-zmin" style="flex:1">🌍 Max Zoom Out</button>` +
      `<button class="f796-btn" id="f796-zmax" style="flex:1">🔎 Max Zoom In</button>` +
      `</div>` +
      `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px">` +
      `<label style="font-size:10px;color:#5a6672;display:flex;align-items:center;gap:4px">` +
      `<input type="checkbox" id="f796-rf" ${
        settings.renderFull ? 'checked' : ''
      }/> Full render` +
      `</label>` +
      `<label style="font-size:10px;color:#5a6672;display:flex;align-items:center;gap:4px">` +
      `<input type="checkbox" id="f796-rc" ${
        settings.renderNoCull ? 'checked' : ''
      }/> Disable culling` +
      `</label>` +
      `<button class="f796-btn" id="f796-rapply" style="padding:2px 6px;font-size:10px">Apply Overrides</button>` +
      `</div>` +
      `<div style="font-size:9px;color:#3d4f5f;margin-top:2px;text-align:center">` +
      `These toggles try to force full-map rendering if supported by the current engine.` +
      `</div>` +
      `<div class="f796-section">🚶 Wandering Mode</div>` +
      `<div style="display:flex;gap:6px;margin-bottom:6px">` +
      `<button class="f796-btn" id="f796-wander-start" style="flex:1">▶️ Start Wandering</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-wander-stop" style="flex:1">⏹️ Stop</button>` +
      `</div>` +
      `<div style="font-size:9px;color:#3d4f5f;text-align:center;margin-bottom:8px">` +
      `Uses site's built-in random-move system. Status: <span id="f796-wander-status" style="color:${
        isWandering() ? '#6bcb77' : '#ff6b6b'
      }">${isWandering() ? '🟢 Active' : '🔴 Idle'}</span>` +
      `</div>` +
      `<div class="f796-section">Bookmarks</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:6px">` +
      `<input class="f796-input" id="f796-bn" placeholder="Bookmark name" style="flex:1"/>` +
      `<button class="f796-btn" id="f796-bs">💾 Save</button>` +
      `</div>` +
      `<div id="f796-bl">${renderBookmarkList()}</div>`

    // Events
    const getFields = () => ({
      scene: el.querySelector('#f796-ns').value.trim(),
      x: +el.querySelector('#f796-nx').value,
      y: +el.querySelector('#f796-ny').value
    })
    el.querySelector('#f796-snap').addEventListener('click', () => {
      const f = getFields()
      teleportTo(f.scene, f.x, f.y, false)
    })
    el.querySelector('#f796-fly').addEventListener('click', () => {
      const f = getFields()
      teleportTo(f.scene, f.x, f.y, true)
    })

    const slider = el.querySelector('#f796-zs')
    const zoomVal = el.querySelector('#f796-zv')
    slider.addEventListener(
      'input',
      () => (zoomVal.textContent = (+slider.value).toFixed(2))
    )
    el.querySelector('#f796-za').addEventListener('click', () => {
      const ok = setZoomFactor(+slider.value)
      zoomVal.textContent = (+slider.value).toFixed(2) + (ok ? ' ✓' : ' ✗')
    })
    el.querySelectorAll('.f796-zp').forEach(b =>
      b.addEventListener('click', () => {
        const v = +b.dataset.z
        setZoomFactor(v)
        slider.value = v
        zoomVal.textContent = v.toFixed(2) + ' ✓'
      })
    )

    el.querySelector('#f796-zmin').addEventListener('click', () => {
      const v = 0.01
      setZoomFactor(v)
      slider.value = v
      zoomVal.textContent = v.toFixed(2) + ' ✓'
    })
    el.querySelector('#f796-zmax').addEventListener('click', () => {
      const v = 20
      setZoomFactor(v)
      slider.value = v
      zoomVal.textContent = v.toFixed(2) + ' ✓'
    })

    const rf = el.querySelector('#f796-rf')
    const rc = el.querySelector('#f796-rc')
    const applyRender = () => {
      setSetting('renderFull', !!rf.checked)
      setSetting('renderNoCull', !!rc.checked)
      applyRenderOverrides()
    }
    rf.addEventListener('change', applyRender)
    rc.addEventListener('change', applyRender)
    el.querySelector('#f796-rapply').addEventListener('click', applyRender)

    // Wandering
    el.querySelector('#f796-wander-start').addEventListener('click', () => {
      startWandering()
      const st = el.querySelector('#f796-wander-status')
      if (st) {
        st.textContent = '🟢 Active'
        st.style.color = '#6bcb77'
      }
    })
    el.querySelector('#f796-wander-stop').addEventListener('click', () => {
      stopWandering()
      const st = el.querySelector('#f796-wander-status')
      if (st) {
        st.textContent = '🔴 Idle'
        st.style.color = '#ff6b6b'
      }
    })

    el.querySelector('#f796-bs').addEventListener('click', () => {
      const name = el.querySelector('#f796-bn').value.trim()
      if (!name) return
      const cp = getCurrentPosition()
      saveBookmark(name, cp?.scene || 't0r0', cp?.x || 0, cp?.y || 0)
      el.querySelector('#f796-bn').value = ''
      el.querySelector('#f796-bl').innerHTML = renderBookmarkList()
    })
    el.querySelector('#f796-bl').addEventListener('click', e => {
      const bmEl = e.target.closest('[data-bi]')
      if (!bmEl) return
      const i = +bmEl.dataset.bi
      if (e.target.classList.contains('bm-del')) {
        deleteBookmark(i)
        el.querySelector('#f796-bl').innerHTML = renderBookmarkList()
      } else {
        const bm = getBookmarks()[i]
        if (bm) teleportTo(bm.scene, bm.x, bm.y, true)
      }
    })
  }

  function renderBookmarkList () {
    const bm = getBookmarks()
    if (!bm.length) return '<div class="f796-empty">No bookmarks yet</div>'
    return bm
      .map(
        (b, i) =>
          `<div class="f796-bookmark" data-bi="${i}">` +
          `<span class="bm-name">${escHtml(b.name)}</span>` +
          `<span class="bm-pos">${b.scene},${b.x},${b.y}</span>` +
          `<span class="bm-del" title="Delete">✕</span>` +
          `</div>`
      )
      .join('')
  }

  // ── Easter Eggs ──
  let eeFilter = 'all'
  let eeSearch = ''
  function renderEasterEggsTab (el) {
    const types = ['interactive', 'event', 'audio', 'image']
    // For the 'event' filter, also include items from other types that have bound events
    function getTypeItems (t) {
      if (t !== 'event') return db.byType[t] || []
      const primary = db.byType.event || []
      const withBoundEvents = db.items.filter(
        i => i._type !== 'event' && (i._eventNames || []).length > 0
      )
      // Deduplicate by id
      const seen = new Set(primary.map(i => i.id))
      return [...primary, ...withBoundEvents.filter(i => !seen.has(i.id))]
    }
    const all = types.flatMap(t => db.byType[t] || [])
    let pool = eeFilter === 'all' ? all : getTypeItems(eeFilter)
    const q = eeSearch.toLowerCase()
    if (q) {
      pool = pool.filter(i => {
        if ((i.t || '').toLowerCase().includes(q)) return true
        if ((i._eventNames || []).some(e => e.toLowerCase().includes(q)))
          return true
        if ((i._linkKeywords || []).some(k => k.toLowerCase().includes(q)))
          return true
        return false
      })
    }

    // Preserve input if it already exists
    if (!el.querySelector('#f796-ee-search')) {
      el.innerHTML =
        `<input type="text" class="f796-input" id="f796-ee-search" placeholder="Search easter eggs, events…" value="${escHtml(
          eeSearch
        )}"/>` +
        `<div class="f796-filters" id="f796-ee-filters"></div>` +
        `<div class="f796-count" id="f796-ee-count"></div>` +
        `<ul class="f796-item-list" id="f796-el"></ul>`

      el.querySelector('#f796-ee-search').addEventListener('input', e => {
        eeSearch = e.target.value
        renderEasterEggsTab(el)
      })
      el.querySelector('#f796-ee-filters').addEventListener('click', e => {
        const f = e.target.closest('.f796-filter')
        if (f) {
          eeFilter = f.dataset.f
          renderEasterEggsTab(el)
        }
      })
      el.querySelector('#f796-el').addEventListener('click', e => {
        const playBtn = e.target.closest('.f796-audio-inline')
        if (playBtn) {
          e.stopPropagation()
          const url = playBtn.dataset.audioUrl
          if (url) playSiteAudio(url)
          return
        }
        const row = e.target.closest('.f796-item')
        if (!row) return
        const item = db.items.find(i => i.id === +row.dataset.id)
        if (item) teleportToItem(item, true)
      })
      setTimeout(() => el.querySelector('#f796-ee-search')?.focus(), 50)
    }

    // Update filters, count, and list (preserves input + cursor)
    const evCount = getTypeItems('event').length
    el.querySelector('#f796-ee-filters').innerHTML =
      `<span class="f796-filter${
        eeFilter === 'all' ? ' active' : ''
      }" data-f="all">All (${all.length})</span>` +
      types
        .map(
          t =>
            `<span class="f796-filter${
              eeFilter === t ? ' active' : ''
            }" data-f="${t}">` +
            `${TYPE_ICONS[t]} ${t} (${
              t === 'event' ? evCount : (db.byType[t] || []).length
            })` +
            `</span>`
        )
        .join('')
    el.querySelector('#f796-ee-count').textContent = q
      ? `${pool.length} result${pool.length !== 1 ? 's' : ''}`
      : `${pool.length} items`
    el.querySelector('#f796-el').innerHTML = pool.map(renderItemRow).join('')
  }

  // ── Characters ──
  // Characters = items that are actual characters/memes/references on the floor.
  // Includes: character (https:// poster or no-link), event (triggers like Chuck
  // Norris, Naruto), audio (sound-playing chars like Goofy).
  // Excludes: interactive (minigames/addons), quest, image (posters/notes).
  const CHARACTER_TYPES = new Set(['character', 'event', 'audio'])
  let charFilter = ''
  function renderCharactersTab (el) {
    const chars = (db.items || []).filter(i => CHARACTER_TYPES.has(i._type))
    const q = charFilter.toLowerCase()
    const filt = q
      ? chars.filter(i => {
          if ((i.t || '').toLowerCase().includes(q)) return true
          if ((i._eventNames || []).some(e => e.toLowerCase().includes(q)))
            return true
          if ((i._linkKeywords || []).some(k => k.toLowerCase().includes(q)))
            return true
          return false
        })
      : chars

    // Only rebuild the full DOM on first render (no input element yet)
    if (!el.querySelector('#f796-cf')) {
      el.innerHTML =
        `<input type="text" class="f796-input" id="f796-cf" placeholder="Filter characters…" value="${escHtml(
          charFilter
        )}"/>` +
        `<div class="f796-count" id="f796-cc"></div>` +
        `<ul class="f796-item-list" id="f796-cl"></ul>`

      el.querySelector('#f796-cf').addEventListener('input', e => {
        charFilter = e.target.value
        renderCharactersTab(el)
      })
      el.querySelector('#f796-cl').addEventListener('click', e => {
        const row = e.target.closest('.f796-item')
        if (!row) return
        const item = db.items.find(i => i.id === +row.dataset.id)
        if (item) teleportToItem(item, true)
      })
      setTimeout(() => el.querySelector('#f796-cf')?.focus(), 50)
    }

    // Update only the count and list (preserves the input element + cursor)
    el.querySelector(
      '#f796-cc'
    ).textContent = `${filt.length} of ${chars.length} characters`
    el.querySelector('#f796-cl').innerHTML = filt.map(renderItemRow).join('')
  }

  // ── Quests ──
  function renderQuestsTab (el) {
    const all = db.byType.quest || []
    const completed = getCompleted()

    el.innerHTML =
      `<div class="f796-section">Quests (${all.length})</div>` +
      `<ul class="f796-item-list" id="f796-ql">` +
      all
        .map(item => {
          const done = completed.includes(item.id)
          return (
            `<li class="f796-item" data-id="${item.id}">` +
            `<span class="item-icon">${
              done ? '✅' : TYPE_ICONS[item._type] || '⚔️'
            }</span>` +
            `<div class="item-body">` +
            `<div class="item-title">${escHtml(item.t)}</div>` +
            `<div class="item-meta">` +
            `<span>${item.d}</span>` +
            `<span class="f796-quest-status ${
              done ? 'f796-quest-done' : 'f796-quest-pending'
            }">${done ? 'DONE' : 'PENDING'}</span>` +
            `</div>` +
            `</div>` +
            `<span class="item-badge" style="background:${
              TYPE_COLORS[item._type]
            }22;color:${
              TYPE_COLORS[item._type]
            };cursor:pointer" title="Toggle" data-act="toggle">${
              done ? '↩' : '✓'
            }</span>` +
            `</li>`
          )
        })
        .join('') +
      `</ul>` +
      (all.length === 0 ? '<div class="f796-empty">No quests found</div>' : '')

    el.querySelector('#f796-ql').addEventListener('click', e => {
      const row = e.target.closest('.f796-item')
      if (!row) return
      const id = +row.dataset.id
      const item = db.items.find(i => i.id === id)
      if (!item) return
      if (e.target.closest('[data-act="toggle"]')) {
        toggleCompleted(id)
        renderQuestsTab(el)
        return
      }
      teleportToItem(item, true)
    })
  }

  // ── Control (quest tuner, addon browser) ──
  let qtState = { switches: [0, 0, 0, 0, 0, 0, 0, 0], color: 0, wheel: 0 }

  function renderControlTab (el) {
    el.innerHTML =
      // ─── QUEST TUNER ───
      `<div class="f796-section">🔧 Quest 2 — Subspace Tuner</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `From quest-tuner.page.js: 8 binary switches + color picker (0–14, 15 colors) + wheel (0–15).<br>` +
      `Initial token: <span style="color:#00ffc8">${QUEST_TUNER.INITIAL_TOKEN}</span><br>` +
      `Final hash target: <span style="color:#f97316">${QUEST_TUNER.FINAL_TOKEN_HASH}</span>` +
      `</div>` +
      `<div style="font-size:10px;color:#5a6672;margin-bottom:3px">Switches (click to toggle):</div>` +
      `<div style="display:flex;gap:3px;margin-bottom:6px">` +
      Array.from(
        { length: 8 },
        (_, i) =>
          `<button class="f796-btn f796-sw" data-i="${i}" style="width:34px;padding:2px;font-size:10px;border-color:${
            qtState.switches[i] ? '#00ffc8' : '#00ffc844'
          }">S${i}:${qtState.switches[i]}</button>`
      ).join('') +
      `</div>` +
      `<div style="font-size:10px;color:#5a6672;margin-bottom:3px">Color (click swatch):</div>` +
      `<div style="display:flex;gap:2px;margin-bottom:6px" id="f796-colors">` +
      QUEST_TUNER.COLORS.map(
        (c, i) =>
          `<div data-c="${i}" style="width:18px;height:18px;background:${c};border:2px solid ${
            i === qtState.color ? '#fff' : '#333'
          };border-radius:3px;cursor:pointer" title="Color ${i}"></div>`
      ).join('') +
      `</div>` +
      `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">` +
      `<span style="font-size:10px;color:#5a6672">Wheel:</span>` +
      `<input type="range" id="f796-wheel" min="0" max="15" value="${qtState.wheel}" style="flex:1;accent-color:#00ffc8"/>` +
      `<span id="f796-wv" style="color:#00ffc8;font-size:11px;min-width:16px">${qtState.wheel}</span>` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<button class="f796-btn" id="f796-qt-calc">🧮 Calculate</button>` +
      `<button class="f796-btn" id="f796-qt-open">🎮 Open Tuner</button>` +
      `<button class="f796-btn" id="f796-qt-check">📡 Server Check</button>` +
      `</div>` +
      `<div id="f796-qt-out" style="font-size:10px;min-height:14px"></div>` +
      // ─── ADDON CONTENT BROWSER ───
      `<div class="f796-section">📝 Addon Content — Force Render</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `Browse addon submissions and <b style="color:#f97316">force-render</b> them onto the live scene ` +
      `by dispatching select-* events (from render.js analysis).<br>` +
      `After forcing, <code>unselect-item</code> fires after the delay to resume normal rotation.` +
      `</div>` +
      `<div style="display:flex;gap:4px;align-items:center;margin-bottom:6px">` +
      `<span style="font-size:10px;color:#5a6672">Reset delay (s):</span>` +
      `<input class="f796-input" id="f796-ac-resetdelay" type="number" value="5" min="0" max="120" step="1" style="width:50px;font-size:10px" title="Seconds before unselect-item resets the addon back to random. 0 = no auto-reset."/>` +
      `</div>` +
      `<div style="display:flex;gap:3px;margin-bottom:6px;flex-wrap:wrap">` +
      `<button class="f796-btn" id="f796-ac-cmm">💭 Change My Mind</button>` +
      `<button class="f796-btn" id="f796-ac-mel">🎵 Melody</button>` +
      `<button class="f796-btn" id="f796-ac-fd">🎨 Fun Drawing</button>` +
      `<button class="f796-btn" id="f796-ac-fa">📢 Free Ads</button>` +
      `</div>` +
      `<div id="f796-ac-out" style="font-size:10px;background:#131a24;border:1px solid #1e2d3d;border-radius:3px;padding:6px;min-height:20px"></div>`

    // ═══ EVENT HANDLERS ═══

    // Quest tuner — switches
    el.querySelectorAll('.f796-sw').forEach(btn =>
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i
        qtState.switches[i] = qtState.switches[i] ? 0 : 1
        btn.textContent = `S${i}:${qtState.switches[i]}`
        btn.style.borderColor = qtState.switches[i] ? '#00ffc8' : '#00ffc844'
      })
    )

    // Quest tuner — color swatches
    el.querySelectorAll('#f796-colors > div').forEach(s =>
      s.addEventListener('click', () => {
        qtState.color = +s.dataset.c
        el.querySelectorAll('#f796-colors > div').forEach(
          d => (d.style.borderColor = '#333')
        )
        s.style.borderColor = '#fff'
      })
    )

    // Quest tuner — wheel
    const wh = el.querySelector('#f796-wheel')
    wh.addEventListener('input', () => {
      qtState.wheel = +wh.value
      el.querySelector('#f796-wv').textContent = wh.value
    })

    // Quest tuner — calculate encoded values
    el.querySelector('#f796-qt-calc').addEventListener('click', () => {
      const out = el.querySelector('#f796-qt-out')
      // #getSwitchesAsNumber from quest-tuner.page.js
      let switchNum = 0
      for (let i = 0; i < 8; i++)
        switchNum += qtState.switches[i]
          ? QUEST_TUNER.PSEUDO_RND_NUM1[i]
          : QUEST_TUNER.PSEUDO_RND_NUM2[i]
      // #saveValues encoding: bits[16..9]=switches, bits[7..4]=color, bits[3..0]=wheel
      let bits = 0
      for (let i = 0; i < 8; i++) bits |= qtState.switches[i] << (16 - i)
      bits |= (qtState.color & 0xf) << 4
      bits |= qtState.wheel & 0xf
      const hex = bits.toString(16) // NO padding — matches original #saveValues
      out.innerHTML =
        `SwitchNum: <span style="color:#00ffc8">${switchNum}</span> · ` +
        `Hex: <span style="color:#00ffc8">0x${hex}</span><br>` +
        `<span style="color:#4a5568">switches=[${qtState.switches}] color=${qtState.color} wheel=${qtState.wheel}</span>`
    })

    // Quest tuner — navigate to it
    el.querySelector('#f796-qt-open').addEventListener('click', () => {
      const it = db.items.find(i => (i.l || '').includes('quest-tuner'))
      if (it) teleportToItem(it, true)
    })

    // Quest tuner — POST to server check endpoint
    el.querySelector('#f796-qt-check').addEventListener('click', () => {
      const out = el.querySelector('#f796-qt-out')
      // Build code the way quest-tuner.page.js #saveValues does: flags + token + hex (NO padStart)
      let bits = 0
      for (let i = 0; i < 8; i++) bits |= qtState.switches[i] << (16 - i)
      bits |= (qtState.color & 0xf) << 4
      bits |= qtState.wheel & 0xf
      const hex = bits.toString(16) // NO padding — matches original #saveValues
      const code = '0' + QUEST_TUNER.INITIAL_TOKEN + hex
      out.innerHTML = '<span style="color:#ffd93d">Checking…</span>'
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://floor796.com/addon/quest-tuner/check',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'code=' + encodeURIComponent(code),
        onload (r) {
          try {
            const d = JSON.parse(r.responseText)
            if (d.result && d.token)
              out.innerHTML = `<span style="color:#6bcb77">✅ New token: ${escHtml(
                d.token
              )}</span>`
            else if (d.result === false)
              out.innerHTML =
                '<span style="color:#ff6b6b">❌ Wrong combination</span>'
            else
              out.innerHTML = `<span style="color:#4a5568">${escHtml(
                JSON.stringify(d)
              )}</span>`
          } catch {
            out.innerHTML = '<span style="color:#ff6b6b">Parse error</span>'
          }
        },
        onerror () {
          out.innerHTML = '<span style="color:#ff6b6b">Request failed</span>'
        }
      })
    })

    // Addon content browser — with Force Render via select-* events (from render.js source)
    const acOut = el.querySelector('#f796-ac-out')

    // Helper: after force-rendering, dispatch 'unselect-item' after a delay
    // to clear the render.js next* variables so the randomizer resumes.
    // From render.js source: CMM sets nextText, Melody sets nextMelody,
    // Fun Drawing sets nextAnimation — all cleared by 'unselect-item'.
    let _addonResetTimer = 0
    function scheduleAddonReset () {
      clearTimeout(_addonResetTimer)
      const delaySec = +(el.querySelector('#f796-ac-resetdelay')?.value || 5)
      if (delaySec <= 0) return // 0 = no auto-reset
      _addonResetTimer = setTimeout(() => {
        document.dispatchEvent(new CustomEvent('unselect-item'))
        log(`Addon reset: dispatched unselect-item after ${delaySec}s`)
      }, delaySec * 1000)
    }

    // Helper: render a searchable list inside acOut
    // items = array, labelFn(item,idx)=>string, onSelect(idx), extraTop='' html before search
    function addonListUI (items, labelFn, onSelect, extraTop, extraBottom) {
      let sel = -1
      let _initialized = false
      const render = (filter = '') => {
        const f = filter.toLowerCase()
        const filtered = f
          ? items
              .map((v, i) => ({ v, i }))
              .filter(x => labelFn(x.v, x.i).toLowerCase().includes(f))
          : items.map((v, i) => ({ v, i }))
        const shown = filtered.slice(0, 100)

        const listHtml =
          shown
            .map(
              x =>
                `<div class="f796-al-row" data-i="${
                  x.i
                }" style="padding:3px 6px;font-size:10px;color:${
                  x.i === sel ? '#00ffc8' : '#c0c8d0'
                };background:${
                  x.i === sel ? '#1a2a3a' : 'transparent'
                };cursor:pointer;border-bottom:1px solid #1e2d3d">${escHtml(
                  labelFn(x.v, x.i)
                )}</div>`
            )
            .join('') +
          (filtered.length > 100
            ? `<div style="padding:3px 6px;font-size:9px;color:#4a5568">…${
                filtered.length - 100
              } more (refine search)</div>`
            : '') +
          (shown.length === 0
            ? `<div style="padding:3px 6px;font-size:9px;color:#4a5568">No matches</div>`
            : '')

        const bottomHtml =
          (extraBottom ? extraBottom(sel, items) : '') +
          `<div style="display:flex;gap:4px;align-items:center">` +
          `<button class="f796-btn" id="f796-al-force" style="background:#3a1a0a;border-color:#f97316;color:#f97316" ${
            sel < 0 ? 'disabled' : ''
          }>${sel >= 0 ? '📡 Force Render' : 'Select an item first'}</button>` +
          `<span style="color:#4a5568;font-size:9px">${
            sel >= 0 ? '#' + (sel + 1) + ' of ' + items.length : ''
          }</span>` +
          `</div>`

        if (!_initialized) {
          _initialized = true
          acOut.innerHTML =
            (extraTop || '') +
            `<input class="f796-input" id="f796-al-search" placeholder="Search (${
              items.length
            } items)…" value="${escHtml(
              filter
            )}" style="width:100%;margin-bottom:4px;font-size:10px"/>` +
            `<div id="f796-al-list" style="max-height:160px;overflow-y:auto;background:#0a0e14;border-radius:3px;margin-bottom:4px"></div>` +
            `<div id="f796-al-bottom"></div>`
          acOut
            .querySelector('#f796-al-search')
            .addEventListener('input', e => render(e.target.value))
        }

        // Update only the list and bottom (preserves the input element + cursor)
        acOut.querySelector('#f796-al-list').innerHTML = listHtml
        acOut.querySelector('#f796-al-bottom').innerHTML = bottomHtml
        acOut.querySelectorAll('.f796-al-row').forEach(row =>
          row.addEventListener('click', () => {
            sel = +row.dataset.i
            render(filter)
          })
        )
        acOut.querySelector('#f796-al-force').addEventListener('click', () => {
          if (sel >= 0) onSelect(sel)
        })
      }
      render()
      return { render }
    }

    // ── Change My Mind: render.js reads params.get('title') → sets nextText ──
    // You can force-render ANY custom text OR pick from the existing phrase list.
    el.querySelector('#f796-ac-cmm').addEventListener('click', () => {
      acOut.innerHTML = '<span style="color:#ffd93d">Loading…</span>'
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://floor796.com/addon/change-my-mind/random-list',
        onload (r) {
          try {
            const list = JSON.parse(r.responseText)
            const forceCMM = text => {
              const detail = 'title=' + encodeURIComponent(text)
              document.dispatchEvent(
                new CustomEvent('select-change-my-mind', { detail })
              )
              log(`Force CMM: "${text.substring(0, 40)}…"`)
            }
            const customTop =
              `<div style="color:#00ffc8;margin-bottom:4px">💭 Change My Mind</div>` +
              `<div style="margin-bottom:6px">` +
              `<div style="font-size:9px;color:#5a6672;margin-bottom:2px">Custom text (render anything you want):</div>` +
              `<div style="display:flex;gap:4px">` +
              `<textarea class="f796-input" id="f796-cmm-custom" rows="2" style="flex:1;font-size:10px;resize:vertical" placeholder="Type your own text…"></textarea>` +
              `<button class="f796-btn" id="f796-cmm-fcustom" style="background:#3a1a0a;border-color:#f97316;color:#f97316;align-self:flex-end;white-space:nowrap">📡 Force Custom</button>` +
              `</div>` +
              `</div>` +
              `<div style="font-size:9px;color:#5a6672;margin-bottom:2px">Or pick from ${list.length} existing phrases:</div>`
            const ui = addonListUI(
              list,
              t => t,
              idx => {
                forceCMM(list[idx])
                scheduleAddonReset()
                const btn = acOut.querySelector('#f796-al-force')
                btn.textContent = '✅ Sent!'
                setTimeout(() => {
                  try {
                    btn.textContent = '📡 Force Render'
                  } catch {}
                }, 1500)
              },
              customTop
            )
            // Custom text force button
            acOut
              .querySelector('#f796-cmm-fcustom')
              .addEventListener('click', () => {
                const txt = acOut.querySelector('#f796-cmm-custom').value.trim()
                if (!txt) return
                forceCMM(txt)
                scheduleAddonReset()
                const btn = acOut.querySelector('#f796-cmm-fcustom')
                btn.textContent = '✅ Sent!'
                setTimeout(() => {
                  btn.textContent = '📡 Force Custom'
                }, 1500)
              })
          } catch {
            acOut.innerHTML = '<span style="color:#ff6b6b">Error</span>'
          }
        },
        onerror () {
          acOut.innerHTML = '<span style="color:#ff6b6b">Failed</span>'
        }
      })
    })

    // ── Melody: render.js listens for 'select-melody', fetches /addon/melody/{id} ──
    // We inject melody data via our fetch intercept (fakes /addon/melody/f796-custom)
    el.querySelector('#f796-ac-mel').addEventListener('click', () => {
      acOut.innerHTML = '<span style="color:#ffd93d">Loading…</span>'
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://floor796.com/addon/melody/random-list',
        onload (r) {
          try {
            const list = JSON.parse(r.responseText)
            const getName = m => (typeof m === 'string' ? '' : m.name || '')
            const getData = m => (typeof m === 'string' ? m : m.data || '')
            const getLabel = (m, i) => getName(m) || `Melody #${i + 1}`
            const top = `<div style="color:#00ffc8;margin-bottom:4px">🎵 ${list.length} melodies</div>`
            const detail = sel =>
              sel >= 0
                ? `<div style="padding:4px;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;margin-bottom:4px;font-size:9px;color:#5a6672;max-height:60px;overflow:auto;word-break:break-all">${escHtml(
                    getData(list[sel])
                  )}</div>`
                : ''
            addonListUI(
              list,
              getLabel,
              idx => {
                const m = list[idx]
                _melodyForceData = {
                  data: getData(m),
                  name: getName(m) || 'Companion Force',
                  author: (typeof m === 'object' ? m.author : '') || ''
                }
                document.dispatchEvent(
                  new CustomEvent('select-melody', { detail: 'id=f796-custom' })
                )
                scheduleAddonReset()
                log(
                  `Force melody: "${
                    getName(m) || 'anon'
                  }" → select-melody + fetch intercept`
                )
                const btn = acOut.querySelector('#f796-al-force')
                btn.textContent = '✅ Sent!'
                setTimeout(() => {
                  try {
                    btn.textContent = '📡 Force Render'
                  } catch {}
                }, 1500)
              },
              top,
              detail
            )
          } catch {
            acOut.innerHTML = '<span style="color:#ff6b6b">Error</span>'
          }
        },
        onerror () {
          acOut.innerHTML = '<span style="color:#ff6b6b">Failed</span>'
        }
      })
    })

    // ── Fun Drawing: render.js reads params.get('data'), fetches STATIC_URL + '/data' + path ──
    el.querySelector('#f796-ac-fd').addEventListener('click', () => {
      acOut.innerHTML = '<span style="color:#ffd93d">Loading…</span>'
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://floor796.com/addon/fun-drawing-v2/random-list',
        onload (r) {
          try {
            const list = JSON.parse(r.responseText)
            const getPath = d =>
              typeof d === 'string' ? d : d.path || String(d)
            const top = `<div style="color:#00ffc8;margin-bottom:4px">🎨 ${list.length} fun drawings</div>`
            addonListUI(
              list,
              d => getPath(d),
              idx => {
                const path = getPath(list[idx])
                document.dispatchEvent(
                  new CustomEvent('select-fun-drawing', {
                    detail: 'data=' + encodeURIComponent(path)
                  })
                )
                scheduleAddonReset()
                log(`Force drawing: "${path}"`)
                const btn = acOut.querySelector('#f796-al-force')
                btn.textContent = '✅ Sent!'
                setTimeout(() => {
                  try {
                    btn.textContent = '📡 Force Render'
                  } catch {}
                }, 1500)
              },
              top
            )
          } catch {
            acOut.innerHTML = '<span style="color:#ff6b6b">Error</span>'
          }
        },
        onerror () {
          acOut.innerHTML = '<span style="color:#ff6b6b">Failed</span>'
        }
      })
    })

    // ── Free Ads: render.js reads title + data (file||link) ──
    el.querySelector('#f796-ac-fa').addEventListener('click', () => {
      acOut.innerHTML = '<span style="color:#ffd93d">Loading…</span>'
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://floor796.com/addon/free-ads/list',
        onload (r) {
          try {
            const list = JSON.parse(r.responseText)
            if (!list.length) {
              acOut.innerHTML =
                '<div style="color:#3d4f5f">No ads currently</div>'
              return
            }
            const top = `<div style="color:#00ffc8;margin-bottom:4px">📢 ${list.length} free ads</div>`
            const detail = (sel, items) =>
              sel >= 0
                ? `<div style="padding:4px;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;margin-bottom:4px"><div style="color:#e0e6ed;font-size:10px">${escHtml(
                    items[sel].title
                  )}</div><div style="font-size:9px;color:#4a5568">${
                    items[sel].date
                  } · <a href="${escHtml(
                    items[sel].link
                  )}" target="_blank" style="color:#00ffc8">${escHtml(
                    items[sel].link
                  )}</a></div><div style="font-size:9px;color:#5a6672">file: ${escHtml(
                    items[sel].file
                  )}</div></div>`
                : ''
            addonListUI(
              list,
              a => a.title + (a.date ? ' (' + a.date + ')' : ''),
              idx => {
                const a = list[idx]
                const dataVal = a.file + '||' + (a.link || '')
                const detailStr =
                  'title=' +
                  encodeURIComponent(a.title) +
                  '&data=' +
                  encodeURIComponent(dataVal)
                document.dispatchEvent(
                  new CustomEvent('select-free-ads', { detail: detailStr })
                )
                scheduleAddonReset()
                log(`Force ad: "${a.title}"`)
                const btn = acOut.querySelector('#f796-al-force')
                btn.textContent = '✅ Sent!'
                setTimeout(() => {
                  try {
                    btn.textContent = '📡 Force Render'
                  } catch {}
                }, 1500)
              },
              top,
              detail
            )
          } catch {
            acOut.innerHTML = '<span style="color:#ff6b6b">Error</span>'
          }
        },
        onerror () {
          acOut.innerHTML = '<span style="color:#ff6b6b">Failed</span>'
        }
      })
    })
  }

  // ── Scene Map ──
  function renderMapTab (el) {
    const currentPos = getCurrentPosition()
    const sceneCounts = getSceneStats()
    const maxCount = Math.max(1, ...Object.values(sceneCounts))
    const liveAddons = getAddonRenderers()
    const liveGrid = getSceneGrid()
    const addonScenes = new Set(liveAddons.map(a => a.scene))
    const progress = db.matrix?.progress || '?'
    const totalScenes = liveGrid.flat().length
    const populatedScenes = Object.values(sceneCounts).filter(v => v > 0).length

    // Build perimeter set (scenes that exist in the data)
    const perimeterSet = new Set()
    if (db.matrix?.perimeter) {
      db.matrix.perimeter.forEach(p => perimeterSet.add(p.id))
    }

    el.innerHTML =
      `<div class="f796-section">World Map (${totalScenes} scenes)</div>` +
      `<div style="display:flex;gap:8px;margin-bottom:6px;font-size:10px">` +
      `<span style="color:#5a6672">Progress: <span style="color:#00ffc8">${progress}%</span></span>` +
      `<span style="color:#5a6672">Populated: <span style="color:#00ffc8">${populatedScenes}/${totalScenes}</span></span>` +
      `<span style="color:#5a6672">Items: <span style="color:#00ffc8">${db.items.length}</span></span>` +
      `</div>` +
      `<div class="f796-progress-bar"><div class="f796-progress-fill" style="width:${progress}%"></div></div>` +
      `<div class="f796-map-grid" id="f796-map">` +
      liveGrid
        .map((row, ri) =>
          row
            .map((scene, ci) => {
              const count = sceneCounts[scene] || 0
              const pct = ((count / maxCount) * 100).toFixed(0)
              const isActive = currentPos && currentPos.scene === scene
              const hasAddon = addonScenes.has(scene)
              return (
                `<div class="f796-map-cell${isActive ? ' active' : ''}${
                  hasAddon ? ' has-addon' : ''
                }" data-scene="${scene}" title="${scene}: ${count} items${
                  hasAddon ? ' (has addons)' : ''
                }">` +
                `<span class="cell-id">${scene}</span>` +
                `<span class="cell-count">${count > 0 ? count : ''}</span>` +
                `<div class="cell-bar" style="width:${pct}%"></div>` +
                `</div>`
              )
            })
            .join('')
        )
        .join('') +
      `</div>` +
      `<div style="font-size:9px;color:#3d4f5f;margin-top:4px;text-align:center">Click any cell to teleport. 🟠 = has addon overlays. 🟢 = your position.</div>` +
      `<div class="f796-section">Addon Overlays (${liveAddons.length})</div>` +
      `<div style="max-height:140px;overflow-y:auto">` +
      liveAddons
        .map(
          a =>
            `<div style="display:flex;align-items:center;gap:6px;padding:3px 4px;border-bottom:1px solid #1a2332;cursor:pointer" class="f796-addon-row" data-scene="${a.scene}">` +
            `<span style="font-size:10px;color:#f97316">🎭</span>` +
            `<span style="font-size:10px;color:#e0e6ed;flex:1">${escHtml(
              a.name
            )}</span>` +
            `<span style="font-size:8px;color:#4a5568">${a.scene}</span>` +
            (a.cond
              ? `<span style="font-size:8px;color:#ffd93d;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(
                  a.cond
                )}">⚠ ${escHtml(a.cond)}</span>`
              : '') +
            `</div>`
        )
        .join('') +
      `</div>` +
      `<div class="f796-section">Scene Item Distribution</div>` +
      `<div style="max-height:130px;overflow-y:auto">` +
      Object.entries(sceneCounts)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([scene, count]) =>
            `<div style="display:flex;align-items:center;gap:6px;padding:2px 4px;font-size:9px;cursor:pointer" class="f796-map-scene-row" data-scene="${scene}">` +
            `<span style="color:#5a6672;width:36px">${scene}</span>` +
            `<div style="flex:1;background:#1e2d3d;border-radius:2px;height:6px;overflow:hidden">` +
            `<div style="width:${((count / maxCount) * 100).toFixed(
              0
            )}%;height:100%;background:#00ffc866;border-radius:2px"></div>` +
            `</div>` +
            `<span style="color:#00ffc8;width:24px;text-align:right">${count}</span>` +
            `</div>`
        )
        .join('') +
      `</div>`

    // Map cell click → teleport
    el.querySelectorAll('.f796-map-cell').forEach(cell =>
      cell.addEventListener('click', () => {
        const scene = cell.dataset.scene
        teleportTo(scene, SCENE_W >> 1, SCENE_H >> 1, true)
      })
    )
    // Addon row click → teleport to addon scene
    el.querySelectorAll('.f796-addon-row').forEach(row =>
      row.addEventListener('click', () => {
        teleportTo(row.dataset.scene, SCENE_W >> 1, SCENE_H >> 1, true)
      })
    )
    // Scene bar click → teleport
    el.querySelectorAll('.f796-map-scene-row').forEach(row =>
      row.addEventListener('click', () => {
        teleportTo(row.dataset.scene, SCENE_W >> 1, SCENE_H >> 1, true)
      })
    )
  }

  // ── Traffic Monitor ──
  let trafficAutoRefresh = null

  function renderTrafficTab (el) {
    const now = Date.now()
    const addonCount = intercepted.addonResponses.size
    const wsCount = intercepted.wsMessages.length
    const phoneCount = intercepted.phoneResults.length
    const qtCount = intercepted.questTunerResults.length
    const gemsCount = intercepted.questGemsResults.length
    const renderJsCount = intercepted.renderJsLoaded.size

    el.innerHTML =
      `<div class="f796-section">📡 Live Traffic Monitor</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `Comprehensive interception of ALL site traffic: fetch, XHR, WebSocket, BroadcastChannel.<br>` +
      `Hooks installed at <code>@run-at document-start</code> — captures everything before site scripts load.` +
      `</div>` +
      // ─── STATS OVERVIEW ───
      `<table class="f796-stats-table" style="margin-bottom:8px">` +
      `<tr><td>Total Intercepted</td><td><span style="color:#00ffc8">${intercepted.totalIntercepted}</span></td></tr>` +
      `<tr><td>Traffic Log</td><td>${trafficLog.length} / ${MAX_TRAFFIC_LOG}</td></tr>` +
      `<tr><td>Addon Responses</td><td><span style="color:#f97316">${addonCount}</span></td></tr>` +
      `<tr><td>Render JS Files</td><td><span style="color:#c084fc">${renderJsCount}</span></td></tr>` +
      `<tr><td>WebSocket Msgs</td><td><span style="color:#67e8f9">${wsCount}</span></td></tr>` +
      `<tr><td>Phone Results</td><td>${phoneCount}</td></tr>` +
      `<tr><td>Quest-Tuner Results</td><td>${qtCount}</td></tr>` +
      `<tr><td>Quest-Gems Results</td><td>${gemsCount}</td></tr>` +
      `<tr><td>Changelog</td><td>${
        intercepted.changelog ? '✅ Captured' : '⏳ Waiting'
      }</td></tr>` +
      `<tr><td>Matrix</td><td>${
        intercepted.matrix
          ? '✅ Captured (ver=' + (intercepted.matrix.ver || '?') + ')'
          : '⏳ Waiting'
      }</td></tr>` +
      `<tr><td>Stat Data (WS)</td><td>${
        intercepted.statData
          ? '✅ ' + JSON.stringify(intercepted.statData).substring(0, 60)
          : '⏳ Waiting'
      }</td></tr>` +
      `</table>` +
      // ─── CONTROLS ───
      `<div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap">` +
      `<button class="f796-btn" id="f796-tf-refresh">🔄 Refresh</button>` +
      `<button class="f796-btn" id="f796-tf-auto" style="border-color:${
        trafficAutoRefresh ? '#6bcb77' : '#3d4f5f'
      }">${trafficAutoRefresh ? '⏸ Stop Auto' : '▶ Auto (2s)'}</button>` +
      `<button class="f796-btn" id="f796-tf-clear" style="border-color:#ff6b6b;color:#ff6b6b">🗑 Clear Log</button>` +
      `<button class="f796-btn" id="f796-tf-export">💾 Export JSON</button>` +
      `</div>` +
      // ─── FILTER ───
      `<div style="display:flex;gap:4px;margin-bottom:6px;align-items:center">` +
      `<span style="font-size:10px;color:#5a6672">Filter:</span>` +
      `<input class="f796-input" id="f796-tf-filter" placeholder="url, method, type…" style="flex:1;font-size:10px"/>` +
      `</div>` +
      // ─── TRAFFIC LOG TABLE ───
      `<div id="f796-tf-log" style="max-height:260px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;padding:2px;font-family:monospace;font-size:9px"></div>` +
      // ─── CAPTURED ADDON RESPONSES ───
      `<div class="f796-section" style="margin-top:8px">Captured Addon Responses (${addonCount})</div>` +
      `<div id="f796-tf-addons" style="max-height:120px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;padding:2px;font-size:9px"></div>` +
      // ─── WEBSOCKET MESSAGES ───
      `<div class="f796-section" style="margin-top:8px">WebSocket Messages (${wsCount})</div>` +
      `<div id="f796-tf-ws" style="max-height:120px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;padding:2px;font-size:9px"></div>`

    // ── Render traffic log entries ──
    function renderLog (filter) {
      const logEl = el.querySelector('#f796-tf-log')
      const f = (filter || '').toLowerCase()
      const filtered = f
        ? trafficLog.filter(e =>
            (e.method + ' ' + e.url + ' ' + e.type).toLowerCase().includes(f)
          )
        : trafficLog
      const recent = filtered.slice(-100).reverse()
      logEl.innerHTML =
        recent.length === 0
          ? '<div style="padding:4px;color:#3d4f5f">No traffic captured yet. Browse the site to see requests.</div>'
          : recent
              .map(e => {
                const age = ((now - e.ts) / 1000).toFixed(0)
                const statusColor =
                  e.status >= 200 && e.status < 300
                    ? '#6bcb77'
                    : e.status >= 400
                    ? '#ff6b6b'
                    : '#ffd93d'
                const methodColor =
                  e.method === 'GET'
                    ? '#67e8f9'
                    : e.method === 'POST'
                    ? '#f97316'
                    : e.method === 'WS'
                    ? '#c084fc'
                    : '#5a6672'
                return (
                  `<div style="padding:1px 4px;border-bottom:1px solid #1a2332;display:flex;gap:6px">` +
                  `<span style="color:#3d4f5f;min-width:28px">${age}s</span>` +
                  `<span style="color:${methodColor};min-width:32px;font-weight:bold">${e.method}</span>` +
                  `<span style="color:${statusColor};min-width:20px">${
                    e.status || '—'
                  }</span>` +
                  `<span style="color:#c0c8d0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(
                    e.url
                  )}">${escHtml(e.url)}</span>` +
                  `<span style="color:#3d4f5f">${e.type || ''}</span>` +
                  `</div>`
                )
              })
              .join('')
    }

    // ── Render addon responses ──
    const addonsEl = el.querySelector('#f796-tf-addons')
    if (addonCount === 0) {
      addonsEl.innerHTML =
        '<div style="padding:4px;color:#3d4f5f">No addon responses captured yet.</div>'
    } else {
      addonsEl.innerHTML = Array.from(intercepted.addonResponses.entries())
        .map(([url, data]) => {
          const preview = (data.text || '').substring(0, 120)
          return (
            `<div style="padding:2px 4px;border-bottom:1px solid #1a2332">` +
            `<span style="color:#f97316">${escHtml(
              data.method || 'GET'
            )}</span> ` +
            `<span style="color:#00ffc8">${escHtml(url)}</span> ` +
            `<span style="color:#3d4f5f">(${
              (data.text || '').length
            }b)</span><br>` +
            `<span style="color:#5a6672">${escHtml(preview)}${
              data.text?.length > 120 ? '…' : ''
            }</span>` +
            `</div>`
          )
        })
        .join('')
    }

    // ── Render WebSocket messages ──
    const wsEl = el.querySelector('#f796-tf-ws')
    if (wsCount === 0) {
      wsEl.innerHTML =
        '<div style="padding:4px;color:#3d4f5f">No WebSocket messages captured yet.</div>'
    } else {
      wsEl.innerHTML = intercepted.wsMessages
        .slice(-50)
        .reverse()
        .map(m => {
          const age = ((now - m.ts) / 1000).toFixed(0)
          const preview = (m.data || '').substring(0, 100)
          return (
            `<div style="padding:1px 4px;border-bottom:1px solid #1a2332">` +
            `<span style="color:#3d4f5f">${age}s</span> ` +
            `<span style="color:#c084fc">${escHtml(m.url || 'ws')}</span> ` +
            `<span style="color:#c0c8d0">${escHtml(preview)}</span>` +
            `</div>`
          )
        })
        .join('')
    }

    renderLog('')

    // ── Event handlers ──
    el.querySelector('#f796-tf-filter').addEventListener('input', e =>
      renderLog(e.target.value)
    )

    el.querySelector('#f796-tf-refresh').addEventListener('click', () =>
      renderTrafficTab(el)
    )

    el.querySelector('#f796-tf-auto').addEventListener('click', () => {
      if (trafficAutoRefresh) {
        clearInterval(trafficAutoRefresh)
        trafficAutoRefresh = null
      } else {
        trafficAutoRefresh = setInterval(() => renderTrafficTab(el), 2000)
      }
      renderTrafficTab(el)
    })

    el.querySelector('#f796-tf-clear').addEventListener('click', () => {
      trafficLog.length = 0
      intercepted.addonResponses.clear()
      intercepted.wsMessages.length = 0
      intercepted.phoneResults.length = 0
      intercepted.questTunerResults.length = 0
      intercepted.questGemsResults.length = 0
      intercepted.renderJsLoaded.clear()
      intercepted.totalIntercepted = 0
      renderTrafficTab(el)
    })

    el.querySelector('#f796-tf-export').addEventListener('click', () => {
      const data = {
        exported: new Date().toISOString(),
        trafficLog: trafficLog.slice(-200),
        addonResponses: Object.fromEntries(intercepted.addonResponses),
        wsMessages: intercepted.wsMessages.slice(-100),
        phoneResults: intercepted.phoneResults,
        questTunerResults: intercepted.questTunerResults,
        questGemsResults: intercepted.questGemsResults,
        statData: intercepted.statData,
        totalIntercepted: intercepted.totalIntercepted
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json'
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `f796-traffic-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }

  // ── Phonebook Tab ──
  function phonebookSorted () {
    const mode = settings.phoneSort || 'number'
    return [...PHONEBOOK].sort((a, b) =>
      mode === 'name'
        ? a.name.localeCompare(b.name)
        : a.number.localeCompare(b.number, undefined, { numeric: true })
    )
  }
  function renderPhonebookTab (el) {
    const filterVal = el._phonebookFilter || ''
    const sorted = phonebookSorted()
    const filtered = sorted.filter(p => {
      if (!filterVal) return true
      const q = filterVal.toLowerCase()
      return (
        p.number.includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.ref.toLowerCase().includes(q) ||
        p.file.toLowerCase().includes(q)
      )
    })

    function renderRow (p, i) {
      return (
        `<div class="pb-phone-row" data-idx="${i}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #111c28;transition:background .12s;cursor:pointer;${
          i % 2 === 0 ? 'background:#0c1118' : ''
        }">` +
        `<button class="f796-btn pb-phone-play" data-file="${escHtml(
          p.file
        )}" data-number="${escHtml(
          p.number
        )}" style="font-size:14px;padding:4px 8px;min-width:34px;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center">▶</button>` +
        `<div style="flex:1;min-width:0">` +
        `<div style="display:flex;gap:8px;align-items:center">` +
        `<span style="color:#e0e6ed;font-size:12px;font-weight:600">${escHtml(
          p.name
        )}</span>` +
        `</div>` +
        `<div style="display:flex;gap:6px;align-items:center;margin-top:2px">` +
        `<span style="color:#00ffc8;font-family:monospace;font-size:11px;letter-spacing:1.5px;background:#00ffc808;padding:1px 6px;border-radius:3px;border:1px solid #00ffc822">${escHtml(
          p.number
        )}</span>` +
        `<span style="font-size:9px;color:#4a5568">${escHtml(p.ref)}</span>` +
        `</div>` +
        `</div>` +
        `<span style="font-size:8px;color:#2a3a4a;font-family:monospace">${escHtml(
          p.file
        )}</span>` +
        `</div>`
      )
    }

    el.innerHTML =
      // ─── HEADER ───
      `<div style="text-align:center;margin-bottom:10px">` +
      `<span style="font-size:15px;color:#00ffc8;font-weight:bold;letter-spacing:1px">📞 PAYPHONE DIRECTORY</span>` +
      `<div style="font-size:9px;color:#3d5060;margin-top:2px">${PHONEBOOK.length} discovered numbers · Dial any 7-digit number to try it</div>` +
      `</div>` +
      // ─── DIALER ───
      `<div style="background:#0a0e14;border:1px solid #1e2d3d;border-radius:8px;padding:10px 12px;margin-bottom:10px">` +
      `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">` +
      `<input class="f796-input" id="pb-dial-input" maxlength="7" placeholder="Enter 7 digits…" style="flex:1;font-size:16px;letter-spacing:4px;text-align:center;font-family:monospace;padding:8px 12px;background:#080c12;border-color:#00ffc833"/>` +
      `</div>` +
      `<div style="display:flex;gap:4px;align-items:center;justify-content:center">` +
      `<button class="f796-btn" id="pb-dial-call" style="background:#0f2818;border-color:#6bcb77;color:#6bcb77;padding:6px 16px;font-size:12px">📞 Dial</button>` +
      `<button class="f796-btn" id="pb-dial-stop" style="padding:6px 12px;font-size:12px">⏹ Hang Up</button>` +
      `<label style="font-size:10px;color:#5a6672;display:flex;align-items:center;gap:4px;margin-left:8px">` +
      `<input type="checkbox" id="pb-autoplay" ${
        settings.phoneAutoplay ? 'checked' : ''
      }/> Auto-play` +
      `</label>` +
      `</div>` +
      `<div id="pb-dial-out" style="font-size:10px;min-height:16px;text-align:center;margin-top:6px"></div>` +
      // ─── NOW PLAYING BAR ───
      `<div id="pb-now-playing" style="display:none;margin-top:6px;background:#111820;border:1px solid #1e2d3d;border-radius:6px;padding:6px 10px">` +
      `<div style="display:flex;align-items:center;gap:8px">` +
      `<span style="font-size:14px">🔊</span>` +
      `<div style="flex:1;min-width:0">` +
      `<div id="pb-np-title" style="color:#e0e6ed;font-size:11px;font-weight:600">--</div>` +
      `<div id="pb-np-file" style="font-size:9px;color:#4a5568">--</div>` +
      `</div>` +
      `<button class="f796-btn" id="pb-np-stop" style="font-size:10px;padding:2px 8px">⏹</button>` +
      `</div>` +
      `</div>` +
      `</div>` +
      // ─── SEARCH / FILTER ───
      `<div style="display:flex;gap:4px;margin-bottom:6px;align-items:center">` +
      `<input class="f796-input" id="pb-phone-filter" placeholder="🔍 Search by name, number, or reference…" value="${escHtml(
        filterVal
      )}" style="flex:1;font-size:11px"/>` +
      `</div>` +
      // ─── COUNT + SORT TOGGLE ───
      `<div id="pb-phone-count" style="font-size:10px;color:#3d5060;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center">` +
      `<span>Showing ${filtered.length} of ${PHONEBOOK.length}</span>` +
      `<button class="f796-btn" id="pb-sort-toggle" style="font-size:9px;padding:1px 8px;border-radius:3px">${
        (settings.phoneSort || 'number') === 'number' ? '#↑ Number' : 'A–Z Name'
      }</button>` +
      `</div>` +
      // ─── PHONE LIST ───
      `<div id="pb-phone-list" style="max-height:340px;overflow-y:auto;border:1px solid #1e2d3d;border-radius:6px;background:#0a0e14">` +
      (filtered.length > 0
        ? filtered.map((p, i) => renderRow(p, i)).join('')
        : '<div style="padding:20px;color:#3d4f5f;font-size:11px;text-align:center">No matching numbers found</div>') +
      `</div>`

    // ═══ EVENT HANDLERS ═══

    // Helper: show "now playing" bar
    function showNowPlaying (name, file, number) {
      const np = el.querySelector('#pb-now-playing')
      if (np) {
        np.style.display = 'block'
        el.querySelector('#pb-np-title').textContent =
          name || number || 'Unknown'
        el.querySelector('#pb-np-file').textContent = file
      }
    }

    // Helper: reset all play buttons
    function resetPlayBtns () {
      el.querySelectorAll('.pb-phone-play').forEach(b => {
        b.textContent = '▶'
        b.style.borderColor = ''
        b.style.color = ''
      })
    }

    // Helper: dial a number against the server
    function dialNumber (num) {
      const out = el.querySelector('#pb-dial-out')
      if (!num || num.length !== 7) {
        if (out)
          out.innerHTML =
            '<span style="color:#ff6b6b">Enter exactly 7 digits</span>'
        return
      }
      if (out)
        out.innerHTML = `<span style="color:#ffd93d">📡 Dialing ${num}…</span>`
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://floor796.com/addon/phone/check',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'phone=' + encodeURIComponent(num),
        onload (r) {
          try {
            const d = JSON.parse(r.responseText)
            if (d.result && d.file) {
              phoneAudioUrl = getPayphoneAudioUrl(d.file)
              const known = PHONEBOOK.find(p => p.number === num)
              if (out)
                out.innerHTML = `<span style="color:#6bcb77">✅ Connected!</span> <span style="color:#00ffc8">${escHtml(
                  d.file
                )}</span>`
              showNowPlaying(known?.name || num, d.file, num)
              if (settings.phoneAutoplay) playPhoneAudio(phoneAudioUrl)
            } else {
              if (out)
                out.innerHTML = `<span style="color:#ff6b6b">❌ ${num} — no answer</span>`
            }
          } catch {
            if (out)
              out.innerHTML = '<span style="color:#ff6b6b">Parse error</span>'
          }
        },
        onerror () {
          if (out)
            out.innerHTML =
              '<span style="color:#ff6b6b">Connection failed</span>'
        }
      })
    }

    // Dial button
    el.querySelector('#pb-dial-call').addEventListener('click', () => {
      const num = el.querySelector('#pb-dial-input').value.replace(/\D/g, '')
      dialNumber(num)
    })
    // Enter key on dial input
    el.querySelector('#pb-dial-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const num = el.querySelector('#pb-dial-input').value.replace(/\D/g, '')
        dialNumber(num)
      }
    })

    // Hang up
    el.querySelector('#pb-dial-stop').addEventListener('click', () => {
      stopPhoneAudio()
      resetPlayBtns()
      const np = el.querySelector('#pb-now-playing')
      if (np) np.style.display = 'none'
      const out = el.querySelector('#pb-dial-out')
      if (out) out.innerHTML = ''
    })
    el.querySelector('#pb-np-stop')?.addEventListener('click', () => {
      stopPhoneAudio()
      resetPlayBtns()
      el.querySelector('#pb-now-playing').style.display = 'none'
    })

    // Auto-play toggle
    el.querySelector('#pb-autoplay').addEventListener('change', e => {
      setSetting('phoneAutoplay', !!e.target.checked)
    })

    // Play buttons in the list
    function bindPlayButtons (container) {
      container.querySelectorAll('.pb-phone-play').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation()
          const file = btn.dataset.file
          const number = btn.dataset.number
          const url = getPayphoneAudioUrl(file)
          resetPlayBtns()
          btn.textContent = '⏹'
          btn.style.borderColor = '#6bcb77'
          btn.style.color = '#6bcb77'
          playPhoneAudio(url)
          phoneAudioUrl = url
          const known = PHONEBOOK.find(p => p.number === number)
          showNowPlaying(known?.name || number, file, number)
          // Also fill dialer input
          el.querySelector('#pb-dial-input').value = number
        })
      })
    }
    bindPlayButtons(el)

    // Row click → fill dialer
    el.querySelectorAll('.pb-phone-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.pb-phone-play')) return
        const btn = row.querySelector('.pb-phone-play')
        if (btn) {
          el.querySelector('#pb-dial-input').value = btn.dataset.number
        }
      })
      row.addEventListener('mouseenter', () => {
        row.style.background = '#0f1822'
      })
      row.addEventListener('mouseleave', () => {
        const i = +row.dataset.idx
        row.style.background = i % 2 === 0 ? '#0c1118' : ''
      })
    })

    // Helper: rebuild the phone list with current sort + filter
    function rebuildList () {
      const q = (el._phonebookFilter || '').toLowerCase()
      const cur = phonebookSorted()
      const filt = cur.filter(p => {
        if (!q) return true
        return (p.number + ' ' + p.name + ' ' + p.ref + ' ' + p.file)
          .toLowerCase()
          .includes(q)
      })
      const sortLabel =
        (settings.phoneSort || 'number') === 'number' ? '#↑ Number' : 'A–Z Name'
      const countEl = el.querySelector('#pb-phone-count')
      const listEl = el.querySelector('#pb-phone-list')
      const sortBtn = el.querySelector('#pb-sort-toggle')
      if (sortBtn) sortBtn.textContent = sortLabel
      if (countEl) {
        const span = countEl.querySelector('span')
        if (span)
          span.textContent = `Showing ${filt.length} of ${PHONEBOOK.length}`
      }
      if (listEl) {
        listEl.innerHTML =
          filt.length > 0
            ? filt.map((p, i) => renderRow(p, i)).join('')
            : '<div style="padding:20px;color:#3d4f5f;font-size:11px;text-align:center">No matching numbers found</div>'
        bindPlayButtons(listEl)
        // Re-bind row hover/click
        listEl.querySelectorAll('.pb-phone-row').forEach(row => {
          row.addEventListener('click', e => {
            if (e.target.closest('.pb-phone-play')) return
            const btn = row.querySelector('.pb-phone-play')
            if (btn)
              el.querySelector('#pb-dial-input').value = btn.dataset.number
          })
          row.addEventListener('mouseenter', () => {
            row.style.background = '#0f1822'
          })
          row.addEventListener('mouseleave', () => {
            const i = +row.dataset.idx
            row.style.background = i % 2 === 0 ? '#0c1118' : ''
          })
        })
      }
    }

    // Sort toggle button
    el.querySelector('#pb-sort-toggle').addEventListener('click', () => {
      const next =
        (settings.phoneSort || 'number') === 'number' ? 'name' : 'number'
      setSetting('phoneSort', next)
      rebuildList()
    })

    // Search filter — preserve input, only rebuild the list
    const filterInput = el.querySelector('#pb-phone-filter')
    filterInput.addEventListener('input', () => {
      el._phonebookFilter = filterInput.value
      rebuildList()
    })
  }

  // ── Hologram Room Controller ──
  // From hologram-room render.js (559 lines):
  //   6 movie holograms: 2001, Cube, Planetes, Matrix, Saw, Hackers
  //   14 buttons (0-13), 8 are 404 placeholders
  //   Events: 'pick-hologram-N' (N=0-13), 'pick-custom-hologram' (detail={file,titleEn,titleRu,src})
  //   Render slots: 'add-render-slot' event with prepareRenderSource callback
  //   ?hologram=N URL parameter for initial selection

  const HOLOGRAMS = [
    { id: 0, title: '2001: A Space Odyssey', year: 1968, available: true },
    { id: 1, title: 'Cube', year: 1997, available: true },
    { id: 2, title: 'Planetes', year: 2003, available: true },
    { id: 3, title: 'The Matrix', year: 1999, available: true },
    { id: 4, title: 'Saw', year: 2004, available: true },
    { id: 5, title: 'Hackers', year: 1995, available: true },
    { id: 6, title: '(placeholder 404)', year: 0, available: false },
    { id: 7, title: '(placeholder 404)', year: 0, available: false },
    { id: 8, title: '(placeholder 404)', year: 0, available: false },
    { id: 9, title: '(placeholder 404)', year: 0, available: false },
    { id: 10, title: '(placeholder 404)', year: 0, available: false },
    { id: 11, title: '(placeholder 404)', year: 0, available: false },
    { id: 12, title: '(placeholder 404)', year: 0, available: false },
    { id: 13, title: '(placeholder 404)', year: 0, available: false }
  ]

  function renderHologramTab (el) {
    el.innerHTML =
      `<div class="f796-section">🎬 Hologram Room Controller</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `From hologram-room render.js: 6 movie holograms on reflective surfaces.<br>` +
      `14 button slots (0–13), 8 are 404 placeholders for future content.<br>` +
      `Dispatches <code>pick-hologram-N</code> custom events to select movies.` +
      `</div>` +
      // ─── MOVIE PICKER ───
      `<div class="f796-section">🎥 Pick Hologram</div>` +
      `<div style="display:flex;flex-direction:column;gap:3px;margin-bottom:8px" id="f796-holo-list">` +
      HOLOGRAMS.map(
        h =>
          `<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:${
            h.available ? '#0d1520' : '#0a0e14'
          };border:1px solid ${
            h.available ? '#1e2d3d' : '#151a22'
          };border-radius:3px;cursor:${
            h.available ? 'pointer' : 'default'
          }" class="f796-holo-row" data-id="${h.id}">` +
          `<span style="font-size:14px">${h.available ? '🎬' : '❌'}</span>` +
          `<span style="flex:1;font-size:11px;color:${
            h.available ? '#e0e6ed' : '#3d4f5f'
          }">${escHtml(h.title)}</span>` +
          `<span style="font-size:9px;color:#4a5568">${h.year || ''}</span>` +
          `<span style="font-size:9px;color:#5a6672">#${h.id}</span>` +
          (h.available
            ? `<button class="f796-btn" style="padding:2px 8px;font-size:9px" data-pick="${h.id}">▶ Play</button>`
            : '') +
          `</div>`
      ).join('') +
      `</div>` +
      `<div id="f796-holo-status" style="font-size:10px;min-height:14px"></div>` +
      // ─── CUSTOM HOLOGRAM ───
      `<div class="f796-section">🎨 Custom Hologram Injection</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `Dispatch <code>pick-custom-hologram</code> with custom image/title.<br>` +
      `The render.js will display it on the hologram surface.` +
      `</div>` +
      `<div style="margin-bottom:4px">` +
      `<div style="font-size:9px;color:#5a6672;margin-bottom:2px">Image URL:</div>` +
      `<input class="f796-input" id="f796-holo-url" placeholder="https://… (PNG/JPG)" style="width:100%;font-size:10px;margin-bottom:4px"/>` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<div style="flex:1">` +
      `<div style="font-size:9px;color:#5a6672;margin-bottom:2px">Title (EN):</div>` +
      `<input class="f796-input" id="f796-holo-title-en" placeholder="Title" style="width:100%;font-size:10px"/>` +
      `</div>` +
      `<div style="flex:1">` +
      `<div style="font-size:9px;color:#5a6672;margin-bottom:2px">Title (RU):</div>` +
      `<input class="f796-input" id="f796-holo-title-ru" placeholder="Название" style="width:100%;font-size:10px"/>` +
      `</div>` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:6px">` +
      `<button class="f796-btn" id="f796-holo-inject" style="background:#3a1a0a;border-color:#f97316;color:#f97316">📡 Inject Custom</button>` +
      `<button class="f796-btn" id="f796-holo-file">📁 From File</button>` +
      `</div>` +
      `<div id="f796-holo-custom-out" style="font-size:10px;min-height:14px"></div>` +
      // ─── SPECIAL EVENTS ───
      `<div class="f796-section">⚡ Scene Events</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `Trigger other interactive scene events discovered from the dump.` +
      `</div>` +
      `<div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:6px">` +
      `<button class="f796-btn f796-scene-evt" data-evt="naruto" title="Shadow Clone Jutsu animation">🍥 Naruto</button>` +
      `<button class="f796-btn f796-scene-evt" data-evt="jaws19" title="Shark animation from BttF2">🦈 Jaws 19</button>` +
      `</div>` +
      `<div id="f796-holo-evt-out" style="font-size:10px;min-height:14px"></div>` +
      // ─── NAVIGATE ───
      `<div style="margin-top:8px">` +
      `<button class="f796-btn" id="f796-holo-goto">🗺️ Teleport to Hologram Room</button>` +
      `</div>`

    // ── Event handlers ──

    // Pick hologram buttons
    el.querySelectorAll('[data-pick]').forEach(btn =>
      btn.addEventListener('click', () => {
        const id = +btn.dataset.pick
        const h = HOLOGRAMS[id]
        document.dispatchEvent(new CustomEvent('pick-hologram-' + id))
        const status = el.querySelector('#f796-holo-status')
        status.innerHTML = `<span style="color:#6bcb77">▶ Playing: ${escHtml(
          h.title
        )} (hologram #${id})</span>`
        log(`🎬 Hologram: pick-hologram-${id} → ${h.title}`)
      })
    )

    // Row click also plays
    el.querySelectorAll('.f796-holo-row').forEach(row =>
      row.addEventListener('dblclick', () => {
        const id = +row.dataset.id
        const h = HOLOGRAMS[id]
        if (!h.available) return
        document.dispatchEvent(new CustomEvent('pick-hologram-' + id))
        const status = el.querySelector('#f796-holo-status')
        status.innerHTML = `<span style="color:#6bcb77">▶ Playing: ${escHtml(
          h.title
        )}</span>`
      })
    )

    // Custom hologram injection
    el.querySelector('#f796-holo-inject').addEventListener('click', () => {
      const url = el.querySelector('#f796-holo-url').value.trim()
      const titleEn =
        el.querySelector('#f796-holo-title-en').value.trim() || 'Custom'
      const titleRu =
        el.querySelector('#f796-holo-title-ru').value.trim() || titleEn
      const out = el.querySelector('#f796-holo-custom-out')

      if (!url) {
        out.innerHTML = '<span style="color:#ff6b6b">Enter an image URL</span>'
        return
      }

      // Dispatch pick-custom-hologram with the custom data
      document.dispatchEvent(
        new CustomEvent('pick-custom-hologram', {
          detail: { file: url, titleEn, titleRu, src: url }
        })
      )
      out.innerHTML = `<span style="color:#6bcb77">✅ Injected custom hologram: ${escHtml(
        titleEn
      )}</span>`
      log(`🎬 Custom hologram injected: ${titleEn} → ${url}`)
    })

    // File picker for custom hologram
    el.querySelector('#f796-holo-file').addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.addEventListener('change', () => {
        const file = input.files[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          el.querySelector('#f796-holo-url').value = reader.result // data: URL
          el.querySelector('#f796-holo-title-en').value = file.name.replace(
            /\.[^.]+$/,
            ''
          )
          const out = el.querySelector('#f796-holo-custom-out')
          out.innerHTML = `<span style="color:#00ffc8">File loaded: ${escHtml(
            file.name
          )} (${(file.size / 1024).toFixed(1)}KB)</span>`
        }
        reader.readAsDataURL(file)
      })
      input.click()
    })

    // Scene events
    el.querySelectorAll('.f796-scene-evt').forEach(btn =>
      btn.addEventListener('click', () => {
        const evt = btn.dataset.evt
        document.dispatchEvent(new CustomEvent(evt))
        const evtOut = el.querySelector('#f796-holo-evt-out')
        evtOut.innerHTML = `<span style="color:#6bcb77">⚡ Dispatched: ${escHtml(
          evt
        )}</span>`
        log(`⚡ Scene event dispatched: ${evt}`)
      })
    )

    // Teleport to hologram room
    el.querySelector('#f796-holo-goto').addEventListener('click', () => {
      const it = db.items.find(
        i =>
          (i.l || '').includes('hologram-room') ||
          (i.n || '').toLowerCase().includes('hologram')
      )
      if (it) {
        teleportToItem(it, true)
      } else {
        // Hologram room is in scene 1_3 based on analysis
        teleportTo('1_3', SCENE_W >> 1, SCENE_H >> 1, true)
      }
    })
  }

  // ── Playback ──
  function renderPlaybackTab (el) {
    const st = getAnimationState() || {}
    const modeIcons = {
      normal: '➡️',
      bounce: '🔄',
      reverse: '⬅️',
      'loop-range': '🔁'
    }
    const currentMode = animState.mode || 'normal'
    const currentDir = animState.direction || 1

    el.innerHTML =
      // ─── TITLE ───
      `<div style="text-align:center;margin-bottom:8px">` +
      `<span style="font-size:14px;color:#ff6b9d;font-weight:bold;letter-spacing:1px">🎬 PLAYBACK CONTROLLER</span>` +
      `<div style="font-size:9px;color:#3d5060;margin-top:2px">Mode: <span style="color:#ffd93d" id="pb-mode-label">${
        getRenderMode() || '?'
      }</span> · Engine: <span style="color:#00ffc8">${
        st.mode || 'detecting…'
      }</span></div>` +
      `</div>` +
      // ─── STATUS GRID ───
      `<div class="pb-status-grid">` +
      `<div><div class="st-label">State</div><span id="pb-state" style="color:#6bcb77">▶ Playing</span></div>` +
      `<div><div class="st-label">Frame</div><span id="pb-frame" style="color:#00ffc8">--/60</span></div>` +
      `<div><div class="st-label">FPS</div><span id="pb-fps" style="color:#ffd93d">--</span></div>` +
      `<div><div class="st-label">Speed</div><span id="pb-speed-lbl" style="color:#e879f9">1.0x</span></div>` +
      `<div><div class="st-label">Direction</div><span id="pb-dir-lbl" style="color:#67e8f9">${
        currentDir === 1 ? '▶ Forward' : '◀ Reverse'
      }</span></div>` +
      `<div><div class="st-label">Mode</div><span id="pb-mode-lbl" style="color:#ff6b9d">${modeIcons[currentMode]} ${currentMode}</span></div>` +
      `</div>` +
      // ─── TRANSPORT BUTTONS ───
      `<div class="pb-transport">` +
      `<button class="pb-btn" id="pb-freeze" title="Freeze / Pause">⏸</button>` +
      `<button class="pb-btn" id="pb-play" style="border-color:#6bcb77;color:#6bcb77" title="Play (normal 1x forward)">▶</button>` +
      `<span class="sep">│</span>` +
      `<button class="pb-btn" id="pb-step-back" title="Step 1 frame backward">⏮</button>` +
      `<button class="pb-btn" id="pb-step-fwd" title="Step 1 frame forward">⏭</button>` +
      `<span class="sep">│</span>` +
      `<button class="pb-btn" id="pb-first" title="Jump to first frame" style="font-size:10px">⏮ 1</button>` +
      `<button class="pb-btn" id="pb-last" title="Jump to last frame" style="font-size:10px">60 ⏭</button>` +
      `<span class="sep">│</span>` +
      `<button class="pb-btn" id="pb-dir-toggle" title="Toggle forward / reverse" style="font-size:10px">${
        currentDir === 1 ? '▶ FWD' : '◀ REV'
      }</button>` +
      `<button class="pb-btn" id="pb-vibrate" title="Shake the scene" style="font-size:10px">📳</button>` +
      `</div>` +
      // ─── PLAYBACK MODES ───
      `<div class="pb-section">Playback Mode</div>` +
      `<div class="pb-modes">` +
      `<div class="mode-btn${
        currentMode === 'normal' ? ' active' : ''
      }" data-mode="normal">➡️ Normal</div>` +
      `<div class="mode-btn${
        currentMode === 'bounce' ? ' active' : ''
      }" data-mode="bounce">🔄 Bounce</div>` +
      `<div class="mode-btn${
        currentMode === 'reverse' ? ' active' : ''
      }" data-mode="reverse">⬅️ Reverse</div>` +
      `<div class="mode-btn${
        currentMode === 'loop-range' ? ' active' : ''
      }" data-mode="loop-range">🔁 Loop Range</div>` +
      `</div>` +
      // ─── LOOP RANGE ───
      `<div id="pb-range-section" style="${
        currentMode === 'loop-range' ? '' : 'display:none'
      }">` +
      `<div class="pb-range-row">` +
      `<label>Start:</label>` +
      `<input type="number" id="pb-range-start" min="1" max="60" value="${animState.rangeStart}"/>` +
      `<label>End:</label>` +
      `<input type="number" id="pb-range-end" min="1" max="60" value="${animState.rangeEnd}"/>` +
      `<button class="f796-btn" id="pb-range-apply" style="font-size:9px;padding:3px 8px">Apply</button>` +
      `</div>` +
      `<div style="font-size:8px;color:#3d5060;margin-bottom:6px">Loops playback between frame ${animState.rangeStart} and ${animState.rangeEnd}</div>` +
      `</div>` +
      // ─── FRAME SCRUBBER ───
      `<div class="pb-section">Frame Scrubber</div>` +
      `<div class="pb-slider-row">` +
      `<span class="sl-label">Frame:</span>` +
      `<input type="range" id="pb-frame-slider" min="1" max="60" value="${
        st.frame1 || 1
      }"/>` +
      `<span class="sl-val" id="pb-frame-val">${String(st.frame1 || 1).padStart(
        2,
        '0'
      )}/60</span>` +
      `</div>` +
      // Frame tick marks
      `<div style="display:flex;justify-content:space-between;padding:0 2px;margin-top:-2px;margin-bottom:6px">` +
      Array.from(
        { length: 12 },
        (_, i) =>
          `<span style="font-size:7px;color:#2a3a4a">${i * 5 + 1}</span>`
      ).join('') +
      `</div>` +
      // ─── SPEED CONTROL ───
      `<div class="pb-section">Speed Control</div>` +
      `<div class="pb-slider-row">` +
      `<span class="sl-label">Speed:</span>` +
      `<input type="range" id="pb-speed-slider" min="5" max="500" value="${Math.round(
        animState.speed * 100
      )}" step="5" style="accent-color:#e879f9"/>` +
      `<span class="sl-val" id="pb-speed-val" style="color:#e879f9">${animState.speed.toFixed(
        animState.speed < 1 ? 2 : 1
      )}x</span>` +
      `</div>` +
      `<div class="pb-presets">` +
      `<button class="f796-btn pb-speed-preset" data-speed="10">0.1x</button>` +
      `<button class="f796-btn pb-speed-preset" data-speed="25">0.25x</button>` +
      `<button class="f796-btn pb-speed-preset" data-speed="50">0.5x</button>` +
      `<button class="f796-btn pb-speed-preset" data-speed="100" style="border-color:#6bcb77">1x</button>` +
      `<button class="f796-btn pb-speed-preset" data-speed="200">2x</button>` +
      `<button class="f796-btn pb-speed-preset" data-speed="300">3x</button>` +
      `<button class="f796-btn pb-speed-preset" data-speed="500">5x</button>` +
      `<button class="f796-btn" id="pb-speed-reset" style="border-color:#ff6b6b;color:#ff6b6b">⟳ Reset</button>` +
      `</div>` +
      // ─── FRAME TIMELINE ───
      `<div class="pb-section">🎞️ Frame Timeline</div>` +
      `<div class="pb-timeline" id="pb-timeline">` +
      Array.from(
        { length: 60 },
        (_, i) =>
          `<div class="tl-frame" data-frame="${i + 1}" title="Frame ${
            i + 1
          }"></div>`
      ).join('') +
      `</div>` +
      // ─── LIVE PREVIEW ───
      `<div class="pb-section" style="color:#67e8f9">📺 Live Preview</div>` +
      `<div style="position:relative;margin-bottom:6px">` +
      `<canvas id="pb-preview" width="380" height="200" style="width:100%;border-radius:4px;border:1px solid #1e2d3d;background:#0a0e14;cursor:crosshair"></canvas>` +
      `<div style="position:absolute;top:4px;right:4px;display:flex;gap:3px">` +
      `<button class="f796-btn" id="pb-preview-toggle" style="font-size:8px;padding:2px 6px;opacity:.8" title="Toggle live preview">👁 Live</button>` +
      `<button class="f796-btn" id="pb-preview-snap" style="font-size:8px;padding:2px 6px;opacity:.8" title="Snapshot">📸</button>` +
      `</div>` +
      `</div>` +
      // ─── FRAME EXPORT ───
      `<div style="display:flex;gap:4px;flex-wrap:wrap">` +
      `<button class="f796-btn" id="pb-dl-frame" style="font-size:10px">💾 Save Frame</button>` +
      `<button class="f796-btn" id="pb-export-all" style="font-size:10px">📦 Export 60 Frames</button>` +
      `<button class="f796-btn" id="pb-copy-frame" style="font-size:10px">📋 Copy to Clipboard</button>` +
      `</div>` +
      `<div id="pb-export-progress" style="display:none;margin-top:6px">` +
      `<div style="background:#1e2d3d;border-radius:3px;height:14px;overflow:hidden">` +
      `<div id="pb-export-bar" style="background:linear-gradient(90deg,#ff6b9d,#e879f9);height:100%;width:0%;transition:width .3s"></div>` +
      `</div>` +
      `<div id="pb-export-text" style="font-size:9px;color:#5a6672;text-align:center;margin-top:2px">0/60</div>` +
      `</div>`

    // ═══════════════════════════════════════════════════════════════
    // ██ PLAYBACK TAB — Event Handlers
    // ═══════════════════════════════════════════════════════════════
    const frameSlider = el.querySelector('#pb-frame-slider')
    const frameVal = el.querySelector('#pb-frame-val')
    const speedSlider = el.querySelector('#pb-speed-slider')
    const speedVal = el.querySelector('#pb-speed-val')
    const livePreviewCanvas = el.querySelector('#pb-preview')
    let livePreviewActive = false
    let pbStatusInterval = null

    // ── Status bar updater ──
    function updatePbStatus () {
      const s = getAnimationState()
      if (!s || s.error) return
      const stateEl = el.querySelector('#pb-state')
      const frameEl = el.querySelector('#pb-frame')
      const fpsEl = el.querySelector('#pb-fps')
      const spdEl = el.querySelector('#pb-speed-lbl')
      const dirEl = el.querySelector('#pb-dir-lbl')
      const modeEl = el.querySelector('#pb-mode-lbl')
      if (stateEl)
        stateEl.innerHTML = animState.frozen
          ? '<span style="color:#ff6b6b">⏸ Frozen</span>'
          : '<span style="color:#6bcb77">▶ Playing</span>'
      if (frameEl)
        frameEl.textContent = String(s.frame1).padStart(2, '0') + '/60'
      const fps = animState._stepTimer ? getCustomFps() : s.fps
      if (fpsEl) fpsEl.textContent = fps || '--'
      if (spdEl) spdEl.textContent = animState.speed.toFixed(1) + 'x'
      if (dirEl)
        dirEl.textContent =
          animState.direction === 1 ? '▶ Forward' : '◀ Reverse'
      const mi = {
        normal: '➡️',
        bounce: '🔄',
        reverse: '⬅️',
        'loop-range': '🔁'
      }
      if (modeEl)
        modeEl.textContent = (mi[animState.mode] || '') + ' ' + animState.mode

      // Sync frame slider
      if (!frameSlider._dragging) {
        frameSlider.value = s.frame1
        frameVal.textContent = String(s.frame1).padStart(2, '0') + '/60'
      }

      // Timeline highlight
      const rs = animState.mode === 'loop-range' ? animState.rangeStart : 1
      const re = animState.mode === 'loop-range' ? animState.rangeEnd : 60
      el.querySelectorAll('.tl-frame').forEach(f => {
        const fn = +f.dataset.frame
        f.classList.toggle('current', fn === s.frame1)
        f.classList.toggle(
          'in-range',
          animState.mode === 'loop-range' &&
            fn >= rs &&
            fn <= re &&
            fn !== s.frame1
        )
      })
    }

    pbStatusInterval = setInterval(updatePbStatus, 200)
    setTimeout(updatePbStatus, 300)

    // ── Transport ──
    el.querySelector('#pb-freeze').addEventListener('click', () => {
      freezeAnimation()
      updatePbStatus()
    })
    el.querySelector('#pb-play').addEventListener('click', () => {
      stopSpeedPlayback()
      animState.speed = 1.0
      animState.direction = 1
      animState.mode = 'normal'
      speedSlider.value = 100
      speedVal.textContent = '1.0x'
      unfreezeAnimation()
      // Reset mode buttons
      el.querySelectorAll('.mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === 'normal')
      )
      el.querySelector('#pb-dir-toggle').textContent = '▶ FWD'
      updatePbStatus()
    })
    el.querySelector('#pb-step-fwd').addEventListener('click', async () => {
      await stepFrame(1)
      updatePbStatus()
    })
    el.querySelector('#pb-step-back').addEventListener('click', async () => {
      await stepFrame(-1)
      updatePbStatus()
    })
    el.querySelector('#pb-first').addEventListener('click', async () => {
      if (!animState.frozen) freezeAnimation()
      // Reset every tracked addon render slot to the start of its safe zone
      resetSlotFrames('first')
      const m = getSceneMatrix()
      if (m) {
        await stepToFrame(m, getRenderMode(), 0) // frame 1 = index 0
        log('⏮ Jump to frame 1/60')
      }
      updatePbStatus()
    })
    el.querySelector('#pb-last').addEventListener('click', async () => {
      if (!animState.frozen) freezeAnimation()
      // Reset every tracked addon render slot to the end of its safe zone
      resetSlotFrames('last')
      const m = getSceneMatrix()
      if (m) {
        await stepToFrame(m, getRenderMode(), 59) // frame 60 = index 59
        log('⏭ Jump to frame 60/60')
      }
      updatePbStatus()
    })
    el.querySelector('#pb-vibrate').addEventListener('click', vibrateScene)

    // ── Direction toggle ──
    el.querySelector('#pb-dir-toggle').addEventListener('click', () => {
      animState.direction = animState.direction === 1 ? -1 : 1
      animState.bounceDir = animState.direction
      el.querySelector('#pb-dir-toggle').textContent =
        animState.direction === 1 ? '▶ FWD' : '◀ REV'
      // Always (re)start custom playback — native loop only goes forward
      startPlayback(animState.speed)
      updatePbStatus()
    })

    // ── Playback modes ──
    el.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode
        animState.mode = mode
        el.querySelectorAll('.mode-btn').forEach(b =>
          b.classList.toggle('active', b.dataset.mode === mode)
        )

        // Show/hide range section
        el.querySelector('#pb-range-section').style.display =
          mode === 'loop-range' ? '' : 'none'

        // Set direction for reverse mode
        if (mode === 'reverse') {
          animState.direction = -1
          el.querySelector('#pb-dir-toggle').textContent = '◀ REV'
        } else if (mode === 'normal') {
          animState.direction = 1
          el.querySelector('#pb-dir-toggle').textContent = '▶ FWD'
        }

        // Reset bounce dir
        animState.bounceDir = animState.direction

        // Always start custom playback — native loop can't do bounce/reverse/range
        startPlayback(animState.speed)
        updatePbStatus()
      })
    })

    // ── Loop Range ──
    el.querySelector('#pb-range-apply').addEventListener('click', () => {
      let rs = parseInt(el.querySelector('#pb-range-start').value) || 1
      let re = parseInt(el.querySelector('#pb-range-end').value) || 60
      rs = Math.max(1, Math.min(60, rs))
      re = Math.max(1, Math.min(60, re))
      if (rs > re) [rs, re] = [re, rs]
      animState.rangeStart = rs
      animState.rangeEnd = re
      el.querySelector('#pb-range-start').value = rs
      el.querySelector('#pb-range-end').value = re
      startPlayback(animState.speed)
      log(`🔁 Loop range set: frames ${rs}–${re}`)
      updatePbStatus()
    })

    // ── Frame scrubber ──
    frameSlider.addEventListener('mousedown', () => {
      frameSlider._dragging = true
    })
    frameSlider.addEventListener('mouseup', () => {
      frameSlider._dragging = false
    })
    frameSlider.addEventListener('touchstart', () => {
      frameSlider._dragging = true
    })
    frameSlider.addEventListener('touchend', () => {
      frameSlider._dragging = false
    })
    frameSlider.addEventListener('input', () => {
      frameVal.textContent = String(+frameSlider.value).padStart(2, '0') + '/60'
    })
    frameSlider.addEventListener('change', async () => {
      frameSlider._dragging = false
      const target = +frameSlider.value
      if (!animState.frozen) freezeAnimation()
      const m = getSceneMatrix()
      if (m) {
        await stepToFrame(m, getRenderMode(), target - 1) // 1-based → 0-based
        log(`⏭️ Scrubbed to frame ${target}/60`)
      }
      updatePbStatus()
    })

    // ── Speed slider ──
    speedSlider.addEventListener('input', () => {
      const pct = +speedSlider.value
      const mult = pct / 100
      speedVal.textContent = mult.toFixed(mult < 1 ? 2 : 1) + 'x'
    })
    speedSlider.addEventListener('change', () => {
      const mult = +speedSlider.value / 100
      startPlayback(mult)
      updatePbStatus()
    })

    // ── Speed presets ──
    el.querySelectorAll('.pb-speed-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const pct = +btn.dataset.speed
        speedSlider.value = pct
        const mult = pct / 100
        speedVal.textContent = mult.toFixed(mult < 1 ? 2 : 1) + 'x'
        startPlayback(mult)
        updatePbStatus()
      })
    })
    el.querySelector('#pb-speed-reset').addEventListener('click', () => {
      stopSpeedPlayback()
      animState.speed = 1.0
      animState.direction = 1
      animState.mode = 'normal'
      speedSlider.value = 100
      speedVal.textContent = '1.0x'
      unfreezeAnimation()
      el.querySelectorAll('.mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === 'normal')
      )
      el.querySelector('#pb-dir-toggle').textContent = '▶ FWD'
      updatePbStatus()
    })

    // ── Timeline click ──
    el.querySelectorAll('.tl-frame').forEach(f => {
      f.addEventListener('click', async () => {
        const target = +f.dataset.frame
        if (!animState.frozen) freezeAnimation()
        const m = getSceneMatrix()
        if (m) {
          m._frame = (target - 2 + 60) % 60
          await stepFrame(1)
        }
        frameSlider.value = target
        frameVal.textContent = String(target).padStart(2, '0') + '/60'
        updatePbStatus()
      })
    })

    // ── Live preview ──
    el.querySelector('#pb-preview-toggle').addEventListener('click', () => {
      livePreviewActive = !livePreviewActive
      if (livePreviewActive) {
        startLivePreview(livePreviewCanvas, 10)
        el.querySelector('#pb-preview-toggle').style.borderColor = '#6bcb77'
        el.querySelector('#pb-preview-toggle').style.color = '#6bcb77'
      } else {
        stopLivePreview()
        el.querySelector('#pb-preview-toggle').style.borderColor = ''
        el.querySelector('#pb-preview-toggle').style.color = ''
        const ctx = livePreviewCanvas.getContext('2d')
        ctx.fillStyle = '#0a0e14'
        ctx.fillRect(0, 0, livePreviewCanvas.width, livePreviewCanvas.height)
        ctx.fillStyle = '#3d4f5f'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(
          'Preview paused',
          livePreviewCanvas.width / 2,
          livePreviewCanvas.height / 2
        )
      }
    })

    // ── Snapshot ──
    el.querySelector('#pb-preview-snap').addEventListener('click', () => {
      const cap = captureFrame(1)
      if (!cap) return
      const img = new Image()
      img.onload = () => {
        const ctx = livePreviewCanvas.getContext('2d')
        const tw = livePreviewCanvas.width,
          th = livePreviewCanvas.height
        ctx.fillStyle = '#0a0e14'
        ctx.fillRect(0, 0, tw, th)
        const srcAR = img.width / img.height,
          tgtAR = tw / th
        let dx = 0,
          dy = 0,
          dw = tw,
          dh = th
        if (srcAR > tgtAR) {
          dh = tw / srcAR
          dy = (th - dh) / 2
        } else {
          dw = th * srcAR
          dx = (tw - dw) / 2
        }
        ctx.drawImage(img, dx, dy, dw, dh)
        ctx.fillStyle = 'rgba(0,0,0,.6)'
        ctx.fillRect(0, th - 18, tw, 18)
        ctx.fillStyle = '#ffd93d'
        ctx.font = '10px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(
          `📸 Frame ${cap.frame}/60 — ${cap.width}×${cap.height}`,
          4,
          th - 5
        )
      }
      img.src = cap.dataUrl
      log(`📸 Snapshot frame ${cap.frame}/60`)
    })

    // ── Frame export ──
    el.querySelector('#pb-dl-frame').addEventListener('click', downloadFrame)
    el.querySelector('#pb-export-all').addEventListener('click', async () => {
      const progDiv = el.querySelector('#pb-export-progress')
      const progBar = el.querySelector('#pb-export-bar')
      const progText = el.querySelector('#pb-export-text')
      progDiv.style.display = 'block'
      progBar.style.width = '0%'
      progText.textContent = '0/60'
      await exportAllFrames((done, total) => {
        progBar.style.width = Math.round((done / total) * 100) + '%'
        progText.textContent = `${done}/${total}`
      })
      progText.textContent = '✅ Complete!'
      setTimeout(() => {
        progDiv.style.display = 'none'
      }, 3000)
    })
    el.querySelector('#pb-copy-frame').addEventListener('click', async () => {
      const m = getSceneMatrix()
      if (!m || !m._canvas?.canvas) return log('❌ No canvas')
      try {
        const blob = await new Promise(r =>
          m._canvas.canvas.toBlob(r, 'image/png')
        )
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ])
        log(`📋 Frame ${m._frame + 1} copied to clipboard`)
      } catch (e) {
        log('❌ Clipboard write failed: ' + e.message)
      }
    })
  }

  // ── Tools ──
  function renderToolsTab (el) {
    const lsEntries = getFloor796LocalStorage()
    const siteData = extractLiveSiteData()

    el.innerHTML =
      // ─── QUICK TOGGLES ───
      `<div class="f796-section">Quick Toggles</div>` +
      `<div class="f796-tool-grid">` +
      `<div class="f796-tool-btn${
        settings.debugMode ? ' active' : ''
      }" id="f796-t-debug">` +
      `<span class="tool-icon">🔲</span><span class="tool-label">Debug Hitboxes</span></div>` +
      `<div class="f796-tool-btn${
        settings.coordHUD ? ' active' : ''
      }" id="f796-t-hud">` +
      `<span class="tool-icon">📍</span><span class="tool-label">Coord HUD</span></div>` +
      `<div class="f796-tool-btn" id="f796-t-extraurl">` +
      `<span class="tool-icon">🔗</span><span class="tool-label">?extra-zoom URL</span></div>` +
      `<div class="f796-tool-btn" id="f796-t-debugurl">` +
      `<span class="tool-icon">🐛</span><span class="tool-label">?debug URL</span></div>` +
      `<div class="f796-tool-btn" id="f796-t-oldrender">` +
      `<span class="tool-icon">🎬</span><span class="tool-label">?old-render URL</span></div>` +
      `</div>` +
      // ─── WANDERING ───
      `<div class="f796-section">🚶 Wandering (Random Walk)</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">From front.js class De: auto-walk between scenes using perimeter data. Also triggered by #wandering hash.</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:8px">` +
      `<button class="f796-btn" id="f796-wander-start" style="background:#1a3a2a;border-color:#6bcb77;color:#6bcb77">▶ Start Wandering</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-wander-stop">⏹ Stop</button>` +
      `<span id="f796-wander-status" style="font-size:10px;color:#5a6672;align-self:center">${
        isWandering() ? '🟢 Active' : '⚫ Inactive'
      }</span>` +
      `</div>` +
      // ─── RENDER SLOT INJECTION ───
      `<div class="f796-section">🖼️ Render Slot Injection</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">Inject custom image slots into the scene renderer. From front.js 'add-render-slot' event.</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px">` +
      `<input class="f796-input" id="f796-rs-x" placeholder="X" style="font-size:10px"/>` +
      `<input class="f796-input" id="f796-rs-y" placeholder="Y" style="font-size:10px"/>` +
      `<input class="f796-input" id="f796-rs-w" placeholder="Width" style="font-size:10px"/>` +
      `<input class="f796-input" id="f796-rs-h" placeholder="Height" style="font-size:10px"/>` +
      `</div>` +
      `<input class="f796-input" id="f796-rs-url" placeholder="Image URL" style="font-size:10px;margin-bottom:4px"/>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<button class="f796-btn" id="f796-rs-add">➕ Add Slot</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-rs-del">🗑️ Delete by Pattern</button>` +
      `</div>` +
      `<input class="f796-input" id="f796-rs-pattern" placeholder="RegExp pattern to delete slots" style="font-size:10px;margin-bottom:8px"/>` +
      // ─── CDN OVERRIDE ───
      `<div class="f796-section">🌐 CDN Override</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">Current STATIC_URL: <span style="color:#00ffc8">${escHtml(
        siteData.STATIC_URL || 'N/A'
      )}</span> · CDN from HTML: <span style="color:#00ffc8">${escHtml(
        siteData.cdnFromHtml || 'N/A'
      )}</span></div>` +
      `<div style="display:flex;gap:4px;margin-bottom:8px">` +
      `<input class="f796-input" id="f796-cdn-val" placeholder="CDN domain (e.g. cdn.floor796.com)" value="${escHtml(
        localStorage.getItem('cdn') || ''
      )}" style="flex:1;font-size:10px"/>` +
      `<button class="f796-btn" id="f796-cdn-set">Set CDN</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-cdn-clear">Clear</button>` +
      `</div>` +
      // ─── CACHE MANAGEMENT ───
      `<div class="f796-section">🗄️ Cache Management</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">F796 scene cache (Cache API: caches.open('f796')). Also IndexedDB floor796 db v3.</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<button class="f796-btn" id="f796-cache-stats">📊 Cache Stats</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-cache-clear">🗑️ Clear F796 Cache</button>` +
      `<button class="f796-btn" id="f796-idb-browse">📂 IndexedDB</button>` +
      `</div>` +
      `<div id="f796-cache-out" style="font-size:10px;min-height:14px;margin-bottom:8px"></div>` +
      // ─── INTERACTIVE LAUNCHER ───
      (() => {
        const _iu = getInteractiveUrls()
        return (
          `<div class="f796-section">🎮 Interactive Launcher (${
            Object.keys(_iu).length
          } mini-games)</div>` +
          `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">Opens each interactive in a popup window, just like the site does.</div>` +
          `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px">` +
          Object.entries(_iu)
            .map(
              ([key, info]) =>
                `<button class="f796-btn f796-il" data-key="${key}" style="font-size:9px;padding:3px 7px" title="${escHtml(
                  info.url
                )}">${escHtml(info.name)}</button>`
            )
            .join('') +
          `</div>`
        )
      })() +
      // ─── AUDIO PLAYER ───
      `<div class="f796-section">🔊 Site Audio Player</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">Plays audio from play:// links (extracted from changelog).</div>` +
      `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px" id="f796-audio-btns">` +
      (db.byType.audio || [])
        .map(au => {
          const playUrl = (au.l || '')
            .split('||')[0]
            .replace(/^play(-loop)?:\/\//, '')
          return `<button class="f796-btn f796-aud" data-url="${escHtml(
            playUrl
          )}" data-id="${
            au.id
          }" style="font-size:9px;padding:3px 7px" title="${escHtml(
            au.t
          )}">${escHtml(au.t)}</button>`
        })
        .join('') +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:8px">` +
      `<button class="f796-btn" id="f796-audio-stop">⏹ Stop Audio</button>` +
      `</div>` +
      // ─── EVENT DISPATCHER ───
      `<div class="f796-section">⚡ Direct Event Dispatcher</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">Fire custom events from front.js event system — triggers site animations/reactions.</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<input class="f796-input" id="f796-evt-name" placeholder="Event name (e.g. cable, naruto)" style="flex:1;font-size:10px"/>` +
      `<button class="f796-btn" id="f796-evt-fire">🔥 Fire</button>` +
      `</div>` +
      `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:8px">` +
      getKnownEvents()
        .map(
          e =>
            `<button class="f796-btn f796-evt-btn" data-ev="${e}" style="font-size:8px;padding:2px 5px">${e}</button>`
        )
        .join('') +
      `</div>` +
      // ─── LOCALSTORAGE VIEWER ───
      `<div class="f796-section">💾 localStorage Viewer (${lsEntries.length} entries)</div>` +
      `<div style="font-size:9px;color:#4a5568;margin-bottom:4px">Site's localStorage entries. Click a value to copy it.</div>` +
      `<div id="f796-ls-list" style="max-height:150px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px">` +
      (lsEntries.length > 0
        ? lsEntries
            .map(
              (e, i) =>
                `<div class="f796-ls-row" data-idx="${i}">` +
                `<span class="f796-ls-key" title="${escHtml(e.key)}">${escHtml(
                  e.key
                )}</span>` +
                `<span class="f796-ls-val" title="${escHtml(
                  e.value
                )}">${escHtml(String(e.value).substring(0, 80))}</span>` +
                `<span style="color:#ff6b6b88;cursor:pointer;font-size:10px" class="f796-ls-del" title="Delete" data-key="${escHtml(
                  e.key
                )}">✕</span>` +
                `</div>`
            )
            .join('')
        : '<div style="padding:6px;color:#3d4f5f;font-size:10px">No localStorage entries</div>') +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-top:4px;margin-bottom:8px">` +
      `<input class="f796-input" id="f796-ls-key" placeholder="Key" style="flex:1;font-size:10px"/>` +
      `<input class="f796-input" id="f796-ls-val" placeholder="Value" style="flex:2;font-size:10px"/>` +
      `<button class="f796-btn" id="f796-ls-set" style="font-size:10px">Set</button>` +
      `</div>` +
      // ─── HIDDEN FEATURES (from front.js deep analysis) ───
      `<div class="f796-section" style="color:#f97316">🔓 Hidden Features (from front.js deep analysis)</div>` +
      // Secret Addon Unlock
      `<div style="font-size:10px;color:#4a5568;margin-bottom:4px">` +
      `<b style="color:#ffd93d">Secret Scene Addons:</b> Some animated overlays require specific localStorage keys (<code>ls:</code> / <code>lsb:</code> conditions).` +
      `</div>` +
      (() => {
        const conds = getAddonConditions()
        if (!conds.length)
          return '<div style="font-size:9px;color:#3d4f5f;margin-bottom:4px">No conditional addons in current matrix data (reload if matrix not loaded yet)</div>'
        return (
          '<div style="max-height:80px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;margin-bottom:4px">' +
          conds
            .map(
              c =>
                `<div style="padding:2px 6px;border-bottom:1px solid #1a2332;font-size:8px;display:flex;gap:6px">` +
                `<span style="color:${c.isMet ? '#6bcb77' : '#ff6b6b'}">${
                  c.isMet ? '✅' : '🔒'
                }</span>` +
                `<span style="color:#f97316;flex:0 0 auto">${escHtml(
                  c.cond
                )}</span>` +
                `<span style="color:#5a6672;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(
                  c.url
                )}</span>` +
                `</div>`
            )
            .join('') +
          '</div>'
        )
      })() +
      `<div style="display:flex;gap:4px;margin-bottom:8px">` +
      `<button class="f796-btn" id="f796-unlock-addons" style="background:#1a3a2a;border-color:#6bcb77;color:#6bcb77">🔓 Unlock All Secret Addons</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-lock-addons">🔒 Lock All</button>` +
      `</div>` +
      // Render Engine
      (() => {
        const re = getRenderEngineInfo()
        return (
          `<div style="font-size:10px;color:#4a5568;margin-bottom:4px">` +
          `<b style="color:#ffd93d">Render Engine:</b> Currently <span style="color:#00ffc8">${re.current}</span> ` +
          `(WASM:${re.hasWASM ? '✅' : '❌'} Worker:${
            re.hasWorker ? '✅' : '❌'
          } ImageBitmap:${re.hasImageBitmap ? '✅' : '❌'})` +
          `</div>`
        )
      })() +
      `<div style="display:flex;gap:4px;margin-bottom:8px">` +
      `<button class="f796-btn" id="f796-toggle-render">🎬 Toggle Render Engine</button>` +
      `<button class="f796-btn" id="f796-debug-canvas">🐛 Show Debug Canvas</button>` +
      `<button class="f796-btn" id="f796-extra-zoom-live">🔎 Inject Extra Zoom</button>` +
      `</div>` +
      // Selected Item Tracker
      `<div style="font-size:10px;color:#4a5568;margin-bottom:4px">` +
      `<b style="color:#ffd93d">Selected Item Tracker:</b> Polls <code>window.__selectedItem</code> to show what the user clicked on the map.` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<button class="f796-btn" id="f796-track-sel-start">👁️ Start Tracking</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-track-sel-stop">⏹ Stop</button>` +
      `</div>` +
      `<div id="f796-sel-out" style="font-size:9px;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;padding:4px;min-height:16px;margin-bottom:4px"></div>` +
      // Last Event + Global Exports
      `<div style="font-size:10px;color:#4a5568;margin-bottom:4px">` +
      `<b style="color:#ffd93d">Live Globals:</b>` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:4px">` +
      `<button class="f796-btn" id="f796-dump-globals" style="font-size:9px">📋 Dump window.__*</button>` +
      `<button class="f796-btn" id="f796-dump-rootstate" style="font-size:9px">🌳 rootState</button>` +
      `<button class="f796-btn" id="f796-dump-floor796" style="font-size:9px">🏗️ floor796.*</button>` +
      `</div>` +
      `<div id="f796-globals-out" style="font-size:8px;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;padding:4px;min-height:16px;max-height:120px;overflow-y:auto;margin-bottom:8px;font-family:monospace;white-space:pre-wrap"></div>` +
      // ─── CHANGES TIMELINE ───
      `<div class="f796-section">📅 Changes Timeline</div>` +
      renderTimeline()

    // ═══ EVENT HANDLERS ═══

    // Debug toggle
    el.querySelector('#f796-t-debug').addEventListener('click', () => {
      const newVal = !settings.debugMode
      toggleDebugMode(newVal)
      el.querySelector('#f796-t-debug').classList.toggle('active', newVal)
    })

    // Coord HUD toggle
    el.querySelector('#f796-t-hud').addEventListener('click', () => {
      const newVal = !settings.coordHUD
      toggleCoordHUD(newVal)
      el.querySelector('#f796-t-hud').classList.toggle('active', newVal)
    })

    // Extra-zoom URL — reload with ?extra-zoom
    el.querySelector('#f796-t-extraurl').addEventListener('click', () => {
      const url = new URL(window.location.href)
      if (url.searchParams.has('extra-zoom')) {
        url.searchParams.delete('extra-zoom')
      } else {
        url.searchParams.set('extra-zoom', '1')
      }
      window.location.href = url.toString()
    })

    // Debug URL — reload with ?debug
    el.querySelector('#f796-t-debugurl').addEventListener('click', () => {
      const url = new URL(window.location.href)
      if (url.searchParams.has('debug')) {
        url.searchParams.delete('debug')
      } else {
        url.searchParams.set('debug', '1')
      }
      window.location.href = url.toString()
    })

    // Old-render URL — reload with ?old-render
    el.querySelector('#f796-t-oldrender').addEventListener('click', () => {
      const url = new URL(window.location.href)
      if (url.searchParams.has('old-render')) {
        url.searchParams.delete('old-render')
      } else {
        url.searchParams.set('old-render', '1')
      }
      window.location.href = url.toString()
    })

    // Wandering
    el.querySelector('#f796-wander-start').addEventListener('click', () => {
      startWandering()
      el.querySelector('#f796-wander-status').textContent = '🟢 Active'
    })
    el.querySelector('#f796-wander-stop').addEventListener('click', () => {
      stopWandering()
      el.querySelector('#f796-wander-status').textContent = '⚫ Inactive'
    })

    // Render slot injection
    el.querySelector('#f796-rs-add').addEventListener('click', () => {
      addRenderSlot(
        el.querySelector('#f796-rs-x').value,
        el.querySelector('#f796-rs-y').value,
        el.querySelector('#f796-rs-w').value,
        el.querySelector('#f796-rs-h').value,
        el.querySelector('#f796-rs-url').value
      )
    })
    el.querySelector('#f796-rs-del').addEventListener('click', () => {
      const pat = el.querySelector('#f796-rs-pattern').value.trim()
      if (pat) deleteSlotsPattern(pat)
    })

    // CDN override
    el.querySelector('#f796-cdn-set').addEventListener('click', () => {
      const val = el.querySelector('#f796-cdn-val').value.trim()
      if (val) {
        localStorage.setItem('cdn', val)
        log('CDN override set: ' + val)
      }
    })
    el.querySelector('#f796-cdn-clear').addEventListener('click', () => {
      localStorage.removeItem('cdn')
      el.querySelector('#f796-cdn-val').value = ''
      log('CDN override cleared')
    })

    // Cache management
    const cacheOut = el.querySelector('#f796-cache-out')
    el.querySelector('#f796-cache-stats').addEventListener(
      'click',
      async () => {
        cacheOut.innerHTML = '<span style="color:#ffd93d">Loading…</span>'
        const stats = await getCacheStats()
        const sizeMB = (stats.totalSize / 1048576).toFixed(2)
        cacheOut.innerHTML =
          `<span style="color:#00ffc8">${stats.count}</span> entries · <span style="color:#00ffc8">${sizeMB} MB</span>` +
          (stats.error
            ? ` · <span style="color:#ff6b6b">${escHtml(stats.error)}</span>`
            : '') +
          (stats.entries.length
            ? '<div style="max-height:80px;overflow-y:auto;margin-top:4px">' +
              stats.entries
                .map(
                  e =>
                    `<div style="font-size:8px;color:#5a6672;border-bottom:1px solid #1a2332;padding:1px 0">${escHtml(
                      e.url.split('/').pop()
                    )} (${(e.size / 1024).toFixed(1)}KB)</div>`
                )
                .join('') +
              '</div>'
            : '')
      }
    )
    el.querySelector('#f796-cache-clear').addEventListener(
      'click',
      async () => {
        await clearF796Cache()
        cacheOut.innerHTML = '<span style="color:#6bcb77">Cache cleared</span>'
      }
    )
    el.querySelector('#f796-idb-browse').addEventListener('click', async () => {
      cacheOut.innerHTML =
        '<span style="color:#ffd93d">Reading IndexedDB…</span>'
      const entries = await getIndexedDBEntries()
      if (!entries.length) {
        cacheOut.innerHTML =
          '<span style="color:#5a6672">No entries in IndexedDB floor796/embedded_files</span>'
        return
      }
      const totalKB = (entries.reduce((a, e) => a + e.size, 0) / 1024).toFixed(
        1
      )
      cacheOut.innerHTML =
        `<span style="color:#00ffc8">${entries.length}</span> embedded files · <span style="color:#00ffc8">${totalKB} KB</span>` +
        '<div style="max-height:100px;overflow-y:auto;margin-top:4px">' +
        entries
          .map(
            e =>
              `<div style="font-size:8px;color:#5a6672;border-bottom:1px solid #1a2332;padding:1px 0">${escHtml(
                String(e.key)
              )} (${(e.size / 1024).toFixed(1)}KB)</div>`
          )
          .join('') +
        '</div>'
    })

    // Interactive launcher
    el.querySelectorAll('.f796-il').forEach(btn =>
      btn.addEventListener('click', () => openInteractive(btn.dataset.key))
    )

    // Audio player
    el.querySelectorAll('.f796-aud').forEach(btn =>
      btn.addEventListener('click', () => playSiteAudio(btn.dataset.url))
    )
    el.querySelector('#f796-audio-stop').addEventListener(
      'click',
      stopSiteAudio
    )

    // Event dispatcher
    el.querySelector('#f796-evt-fire').addEventListener('click', () => {
      const name = el.querySelector('#f796-evt-name').value.trim()
      if (!name) return
      fireEvent(name)
    })
    el.querySelectorAll('.f796-evt-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        fireEvent(btn.dataset.ev)
        el.querySelector('#f796-evt-name').value = btn.dataset.ev
      })
    )

    // localStorage viewer
    el.querySelectorAll('.f796-ls-del').forEach(btn =>
      btn.addEventListener('click', () => {
        try {
          localStorage.removeItem(btn.dataset.key)
        } catch {}
        renderToolsTab(el)
      })
    )
    el.querySelectorAll('.f796-ls-val').forEach(cell =>
      cell.addEventListener('click', () => {
        try {
          navigator.clipboard.writeText(cell.title)
        } catch {}
      })
    )
    el.querySelector('#f796-ls-set').addEventListener('click', () => {
      const key = el.querySelector('#f796-ls-key').value.trim()
      const val = el.querySelector('#f796-ls-val').value
      if (!key) return
      try {
        localStorage.setItem(key, val)
      } catch {}
      renderToolsTab(el)
    })

    // ── Hidden Features Handlers ──

    // Addon unlock/lock
    el.querySelector('#f796-unlock-addons').addEventListener('click', () => {
      const count = unlockAllAddons()
      if (count > 0) {
        alert(
          `Unlocked ${count} secret addon condition(s)!\n\nReload the page to see the hidden scene overlays.`
        )
      } else {
        alert(
          'All addons already unlocked, or no conditional addons found.\n\nIf matrix is not loaded yet, try again after the map finishes loading.'
        )
      }
      renderToolsTab(el)
    })
    el.querySelector('#f796-lock-addons').addEventListener('click', () => {
      lockAllAddons()
      renderToolsTab(el)
    })

    // Render engine toggle
    el.querySelector('#f796-toggle-render').addEventListener('click', () => {
      toggleRenderEngine()
      alert('Render engine toggled. Reload the page to apply.')
      renderToolsTab(el)
    })

    // Debug canvas
    el.querySelector('#f796-debug-canvas').addEventListener('click', () => {
      enableDebugCanvas()
    })

    // Extra zoom live inject
    el.querySelector('#f796-extra-zoom-live').addEventListener('click', () => {
      enableExtraZoomLive()
    })

    // Selected item tracker
    const selOut = el.querySelector('#f796-sel-out')
    el.querySelector('#f796-track-sel-start').addEventListener('click', () => {
      startSelectedItemTracker(sel => {
        if (!sel?.item) {
          selOut.textContent = '(nothing selected)'
          return
        }
        const i = sel.item
        selOut.innerHTML =
          `<span style="color:#00ffc8">${escHtml(i.t || '?')}</span> ` +
          `<span style="color:#5a6672">id=${i.id || '?'}</span> ` +
          `<span style="color:#f97316">${escHtml(
            (i.l || '').substring(0, 80)
          )}</span>`
      })
      selOut.textContent = 'Tracking…'
    })
    el.querySelector('#f796-track-sel-stop').addEventListener('click', () => {
      stopSelectedItemTracker()
      selOut.textContent = 'Stopped'
    })

    // Global dumps
    const globOut = el.querySelector('#f796-globals-out')
    el.querySelector('#f796-dump-globals').addEventListener('click', () => {
      const keys = Object.keys(unsafeWindow).filter(k => k.startsWith('__'))
      const data = {}
      for (const k of keys) {
        try {
          const v = unsafeWindow[k]
          data[k] =
            typeof v === 'object'
              ? v
                ? Object.keys(v).join(', ')
                : 'null'
              : String(v).substring(0, 100)
        } catch {
          data[k] = '(error)'
        }
      }
      globOut.textContent = JSON.stringify(data, null, 2)
    })
    el.querySelector('#f796-dump-rootstate').addEventListener('click', () => {
      try {
        const rs = unsafeWindow.globalThis?.rootState
        if (!rs) {
          globOut.textContent = 'rootState not found'
          return
        }
        const snap = {}
        for (const k of Object.keys(rs)) {
          try {
            const v = rs[k]
            snap[k] =
              typeof v === 'function'
                ? '(fn)'
                : typeof v === 'object'
                ? JSON.stringify(v).substring(0, 200)
                : v
          } catch {
            snap[k] = '(error)'
          }
        }
        globOut.textContent = JSON.stringify(snap, null, 2)
      } catch (e) {
        globOut.textContent = 'Error: ' + e.message
      }
    })
    el.querySelector('#f796-dump-floor796').addEventListener('click', () => {
      try {
        const f = unsafeWindow.globalThis?.floor796 || unsafeWindow.floor796
        if (!f) {
          globOut.textContent = 'floor796 not found'
          return
        }
        const snap = {}
        for (const k of Object.keys(f)) {
          try {
            const v = f[k]
            if (v === null) snap[k] = 'null'
            else if (typeof v === 'function') snap[k] = '(class/fn)'
            else if (typeof v === 'object')
              snap[k] = `{${Object.keys(v).slice(0, 10).join(', ')}}`
            else snap[k] = String(v)
          } catch {
            snap[k] = '(error)'
          }
        }
        snap._controller_keys = ctrl
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(ctrl))
              .slice(0, 20)
              .join(', ')
          : 'N/A'
        snap._matrix_keys = matrix
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(matrix))
              .slice(0, 20)
              .join(', ')
          : 'N/A'
        globOut.textContent = JSON.stringify(snap, null, 2)
      } catch (e) {
        globOut.textContent = 'Error: ' + e.message
      }
    })
  }

  // ── Fire event — dispatches site custom events ──
  function fireEvent (name) {
    try {
      // Method 1: dispatch on document like front.js does for click handlers
      document.dispatchEvent(
        new CustomEvent('trigger-event', { detail: { name } })
      )
      // Method 2: also dispatch the direct event name (some event handlers listen for this)
      document.dispatchEvent(new CustomEvent(name))
      // Method 3: if controller has _changesMap, try to find item with event:// link and selectItem
      if (ctrl) {
        const evItem = db.items.find(i =>
          (i.l || '').includes('event://' + name)
        )
        if (evItem && typeof ctrl._selectItem === 'function') {
          ctrl._selectItem(evItem, true).catch(() => {})
        }
      }
      log(`Event fired: ${name}`)
    } catch (e) {
      log(`Event fire error: ${e.message}`)
    }
  }

  // ── Changes timeline helper ──
  function renderTimeline () {
    if (!db.loaded || !db.items.length)
      return '<div class="f796-empty">No data</div>'
    // Group items by month
    const byMonth = {}
    db.items.forEach(item => {
      const month = (item.d || '').substring(0, 7) // YYYY-MM
      if (!month) return
      byMonth[month] = (byMonth[month] || 0) + 1
    })
    const months = Object.entries(byMonth).sort((a, b) =>
      b[0].localeCompare(a[0])
    )
    const maxMonth = Math.max(1, ...months.map(m => m[1]))
    return (
      `<div style="max-height:130px;overflow-y:auto">` +
      months
        .map(
          ([month, count]) =>
            `<div style="display:flex;align-items:center;gap:6px;padding:2px 4px;font-size:9px">` +
            `<span style="color:#5a6672;width:50px">${month}</span>` +
            `<div style="flex:1;background:#1e2d3d;border-radius:2px;height:6px;overflow:hidden">` +
            `<div style="width:${((count / maxMonth) * 100).toFixed(
              0
            )}%;height:100%;background:#00ffc866;border-radius:2px"></div>` +
            `</div>` +
            `<span style="color:#00ffc8;width:24px;text-align:right">${count}</span>` +
            `</div>`
        )
        .join('') +
      `</div>`
    )
  }

  // ── Ripper / Downloader — discover & download ALL site resources ──
  let ripperState = { scanning: false, results: null, fetchResults: [] }

  function renderRipperTab (el) {
    const res = discoveredResources
    const totalUrls = Object.values(res).reduce((a, b) => a + b.length, 0)

    el.innerHTML =
      `<div class="f796-section">⬇️ Site Resource Ripper</div>` +
      `<div style="font-size:10px;color:#4a5568;margin-bottom:6px">` +
      `Discovers ALL JS, CSS, Workers, WASM, JSON, image, and audio URLs from the live site DOM + front.js analysis.<br>` +
      `Fetches resources directly via GM_xmlhttpRequest (bypasses CORS). Click individual files or batch-fetch entire categories.` +
      `</div>` +
      `<div style="display:flex;gap:4px;margin-bottom:6px">` +
      `<button class="f796-btn" id="f796-rip-scan" style="background:#1a3a2a;border-color:#6bcb77;color:#6bcb77">🔍 Scan DOM + Known Endpoints</button>` +
      `<button class="f796-btn" id="f796-rip-live">🌐 Scan Live HTML</button>` +
      `<span style="font-size:10px;color:#5a6672;align-self:center">${totalUrls} URLs found</span>` +
      `</div>` +
      `<div id="f796-rip-out" style="font-size:10px;min-height:14px;margin-bottom:6px"></div>` +
      // Resource categories
      Object.entries(res)
        .map(([cat, urls]) => {
          if (!urls.length) return ''
          const icon =
            {
              js: '📜',
              css: '🎨',
              workers: '⚙️',
              wasm: '🔧',
              json: '📋',
              images: '🖼️',
              audio: '🔊',
              other: '📁'
            }[cat] || '📄'
          return (
            `<div class="f796-section">${icon} ${cat.toUpperCase()} (${
              urls.length
            })</div>` +
            `<div style="display:flex;gap:4px;margin-bottom:4px">` +
            `<button class="f796-btn f796-rip-batch" data-cat="${cat}" style="font-size:9px">📥 Fetch All ${cat}</button>` +
            `<button class="f796-btn f796-rip-copy" data-cat="${cat}" style="font-size:9px">📋 Copy URLs</button>` +
            `</div>` +
            `<div style="max-height:120px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;margin-bottom:6px">` +
            urls
              .map((url, i) => {
                const fname = url.split('/').pop().split('?')[0]
                return (
                  `<div style="display:flex;align-items:center;gap:4px;padding:2px 6px;border-bottom:1px solid #1a2332;font-size:9px">` +
                  `<span style="color:#5a6672;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(
                    url
                  )}">${escHtml(fname)}</span>` +
                  `<button class="f796-btn f796-rip-dl" data-url="${escHtml(
                    url
                  )}" data-name="${escHtml(
                    fname
                  )}" style="font-size:8px;padding:1px 4px">⬇️</button>` +
                  `<button class="f796-btn f796-rip-view" data-url="${escHtml(
                    url
                  )}" style="font-size:8px;padding:1px 4px">👁️</button>` +
                  `</div>`
                )
              })
              .join('') +
            `</div>`
          )
        })
        .join('') +
      // Batch fetch results
      (ripperState.fetchResults.length
        ? `<div class="f796-section">📦 Fetch Results (${ripperState.fetchResults.length})</div>` +
          `<div style="max-height:120px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px">` +
          ripperState.fetchResults
            .map(
              r =>
                `<div style="padding:2px 6px;border-bottom:1px solid #1a2332;font-size:8px">` +
                `<span style="color:${
                  r.status === 200 ? '#6bcb77' : '#ff6b6b'
                }">${r.status}</span> ` +
                `<span style="color:#5a6672">${escHtml(
                  r.url.split('/').pop().split('?')[0]
                )}</span> ` +
                `<span style="color:#4a5568">${(r.size / 1024).toFixed(
                  1
                )}KB</span>` +
                `</div>`
            )
            .join('') +
          `</div>`
        : '') +
      // API Endpoints reference
      `<div class="f796-section">🔌 Known API Endpoints</div>` +
      `<div style="max-height:150px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;margin-bottom:6px">` +
      [
        { method: 'POST', url: '/user/login', desc: 'Login (l, p, r)' },
        { method: 'POST', url: '/user/signup', desc: 'Create account' },
        { method: 'POST', url: '/subs/guest-add/{email}', desc: 'Subscribe' },
        {
          method: 'POST',
          url: '/subs/unsubscribe/{email}',
          desc: 'Unsub by email'
        },
        {
          method: 'POST',
          url: '/subs/unsubscribe-by-token/{token}/{email}',
          desc: 'Unsub by token'
        },
        { method: 'GET', url: '/data/changelog.json', desc: 'Changelog data' },
        {
          method: 'GET',
          url: '/data/changelog-{lang}.json',
          desc: 'Localized changelog'
        },
        { method: 'GET', url: '/data/matrix.json', desc: 'Scene matrix' },
        { method: 'GET', url: '/addon/changes', desc: 'Addon changes list' },
        {
          method: 'POST',
          url: '/addon/phone/check',
          desc: 'Phone number check'
        },
        {
          method: 'POST',
          url: '/addon/quest-tuner/check',
          desc: 'Quest tuner verify'
        },
        {
          method: 'POST',
          url: '/addon/quest-tuner/add-winner',
          desc: 'Save winner (auth)'
        },
        {
          method: 'GET',
          url: '/addon/quest-tuner/list/{page}',
          desc: 'Winner list'
        },
        {
          method: 'POST',
          url: '/addon/quest-tuner/delete',
          desc: 'Delete entry (mod+)'
        },
        {
          method: 'GET',
          url: '/addon/change-my-mind/random-list',
          desc: 'CMM phrases'
        },
        {
          method: 'GET',
          url: '/addon/melody/random-list',
          desc: 'Melody list'
        },
        {
          method: 'GET',
          url: '/addon/fun-drawing-v2/random-list',
          desc: 'Fun drawings'
        },
        { method: 'GET', url: '/addon/free-ads/list', desc: 'Free ads' },
        { method: 'GET', url: '/addon/melody/{id}', desc: 'Melody data by ID' }
      ]
        .map(
          ep =>
            `<div style="display:flex;gap:6px;padding:2px 6px;border-bottom:1px solid #1a2332;font-size:9px">` +
            `<span style="color:${
              ep.method === 'POST' ? '#f97316' : '#6bcb77'
            };width:30px;font-weight:bold">${ep.method}</span>` +
            `<span style="color:#00ffc8;flex:1">${escHtml(ep.url)}</span>` +
            `<span style="color:#5a6672">${escHtml(ep.desc)}</span>` +
            `</div>`
        )
        .join('') +
      `</div>` +
      // Custom URL schemes
      `<div class="f796-section">🔗 Custom URL Schemes</div>` +
      `<table class="f796-stats-table">` +
      [
        ['interactive://', 'Opens interactive mini-game in iframe popup'],
        ['event://', 'Triggers site animation event on click'],
        ['play://', 'Plays audio file once'],
        ['play-loop://', 'Plays audio file in loop'],
        ['img://', 'Shows image overlay popup']
      ]
        .map(
          ([scheme, desc]) =>
            `<tr><td style="color:#f97316;font-size:10px">${escHtml(
              scheme
            )}</td><td style="font-size:9px">${escHtml(desc)}</td></tr>`
        )
        .join('') +
      `</table>`

    // Handlers
    el.querySelector('#f796-rip-scan').addEventListener('click', () => {
      el.querySelector('#f796-rip-out').innerHTML =
        '<span style="color:#ffd93d">Scanning DOM…</span>'
      discoverResourcesFromDOM()
      renderRipperTab(el)
    })
    el.querySelector('#f796-rip-live').addEventListener('click', async () => {
      el.querySelector('#f796-rip-out').innerHTML =
        '<span style="color:#ffd93d">Fetching live HTML…</span>'
      await discoverFromLiveHTML()
      renderRipperTab(el)
    })

    // Download individual files
    el.querySelectorAll('.f796-rip-dl').forEach(btn =>
      btn.addEventListener('click', () => {
        downloadResource(btn.dataset.url, btn.dataset.name)
      })
    )

    // View individual files
    el.querySelectorAll('.f796-rip-view').forEach(btn =>
      btn.addEventListener('click', () => {
        const out = el.querySelector('#f796-rip-out')
        out.innerHTML = '<span style="color:#ffd93d">Fetching…</span>'
        GM_xmlhttpRequest({
          method: 'GET',
          url: btn.dataset.url,
          onload (r) {
            const preview = escHtml((r.responseText || '').substring(0, 2000))
            out.innerHTML = `<div style="max-height:200px;overflow:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px;padding:4px;font-size:8px;white-space:pre-wrap;word-break:break-all;color:#c0c8d0">${preview}${
              r.responseText.length > 2000
                ? '\n\n… (' + r.responseText.length + ' chars total)'
                : ''
            }</div>`
          },
          onerror () {
            out.innerHTML = '<span style="color:#ff6b6b">Fetch failed</span>'
          }
        })
      })
    )

    // Copy URLs for a category
    el.querySelectorAll('.f796-rip-copy').forEach(btn =>
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat
        const urls = discoveredResources[cat] || []
        try {
          navigator.clipboard.writeText(urls.join('\n'))
        } catch {}
        btn.textContent = '✅ Copied!'
        setTimeout(() => {
          btn.textContent = '📋 Copy URLs'
        }, 1500)
      })
    )

    // Batch fetch a category
    el.querySelectorAll('.f796-rip-batch').forEach(btn =>
      btn.addEventListener('click', async () => {
        const cat = btn.dataset.cat
        const urls = discoveredResources[cat] || []
        if (!urls.length) return
        const out = el.querySelector('#f796-rip-out')
        btn.disabled = true
        btn.textContent = '⏳ Fetching…'
        const results = await batchFetchResources(urls, (i, total, url) => {
          out.innerHTML = `<span style="color:#ffd93d">Fetching ${cat}: ${
            i + 1
          }/${total} — ${escHtml(url.split('/').pop().split('?')[0])}</span>`
        })
        ripperState.fetchResults = results
        btn.disabled = false
        btn.textContent = `📥 Fetch All ${cat}`
        out.innerHTML = `<span style="color:#6bcb77">✅ Fetched ${
          results.length
        } files · ${(results.reduce((a, r) => a + r.size, 0) / 1024).toFixed(
          1
        )} KB total</span>`

        // Offer combined download
        const combined = results
          .map(
            r =>
              `// === ${r.url} === (${r.status})\n${r.text || r.error || ''}\n`
          )
          .join('\n')
        const blob = new Blob([combined], { type: 'text/plain' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `floor796-${cat}-dump.txt`
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          a.remove()
          URL.revokeObjectURL(a.href)
        }, 1000)
      })
    )
  }

  // ── DB / Diagnostics ──
  function renderDBTab (el) {
    const typeRows = db.loaded
      ? Object.entries(db.byType)
          .map(
            ([k, v]) =>
              `<tr><td>${TYPE_ICONS[k] || ''} ${k}</td><td>${
                v.length
              }</td></tr>`
          )
          .join('')
      : ''
    const matrixRows = db.matrix
      ? `<tr><td>Matrix ver</td><td>${db.matrix.ver}</td></tr>` +
        `<tr><td>Grid</td><td>${db.matrix.mat?.length || '?'}×${
          db.matrix.mat?.[0]?.length || '?'
        }</td></tr>` +
        `<tr><td>Addons</td><td>${db.matrix.addons?.length || 0}</td></tr>` +
        `<tr><td>Progress</td><td>${db.matrix.progress || '?'}%</td></tr>`
      : '<tr><td colspan="2" style="color:#3d4f5f">Not loaded</td></tr>'

    // Live site data
    const siteData = extractLiveSiteData()
    // Read user info from site singleton (read-only)
    const userInfo = (() => {
      try {
        const s = unsafeWindow.globalThis?.floor796?.Singleton?.getInstance?.()
        if (s)
          return {
            userName: s.userName || '',
            userId: s.userId || 0,
            userRole: s.userRole ?? 0,
            roleName:
              ['anon', 'user', 'admin', 'superadmin'][s.userRole] || 'unknown'
          }
      } catch {}
      return null
    })()
    const matrixLive = getMatrixLiveData()
    const fullsize = getFullsizeImages()

    el.innerHTML =
      // ─── USER / AUTH INFO ───
      `<div class="f796-section">🔐 User & Auth</div>` +
      `<table class="f796-stats-table">` +
      `<tr><td>User</td><td>${
        userInfo ? escHtml(userInfo.userName || '(anon)') : 'N/A'
      }</td></tr>` +
      `<tr><td>User ID</td><td>${userInfo?.userId || 0}</td></tr>` +
      `<tr><td>Role</td><td style="color:${
        userInfo?.userRole === 3 ? '#6bcb77' : '#ffd93d'
      }">${userInfo?.roleName || 'N/A'} (${
        userInfo?.userRole ?? '?'
      })</td></tr>` +
      `<tr><td>Cookies</td><td style="font-size:8px">__Secure-796 (session) · __Secure-user (userId:name:role)</td></tr>` +
      `</table>` +
      // ─── LIVE SITE DATA ───
      `<div class="f796-section">🌐 Live Site Globals</div>` +
      `<table class="f796-stats-table">` +
      `<tr><td>STATIC_URL</td><td style="font-size:9px">${escHtml(
        siteData.STATIC_URL || 'N/A'
      )}</td></tr>` +
      `<tr><td>CDN (HTML)</td><td style="font-size:9px">${escHtml(
        siteData.cdnFromHtml || 'N/A'
      )}</td></tr>` +
      `<tr><td>CDN (localStorage)</td><td style="font-size:9px">${escHtml(
        localStorage.getItem('cdn') || '(none)'
      )}</td></tr>` +
      `<tr><td>IS_SMALL_VIEW</td><td>${
        siteData.IS_SMALL_VIEW ?? 'N/A'
      }</td></tr>` +
      `<tr><td>IS_WEBP_SUPPORTED</td><td>${
        siteData.IS_WEBP_SUPPORTED ?? 'N/A'
      }</td></tr>` +
      `<tr><td>IS_EMBEDDED_MODE</td><td>${
        siteData.IS_EMBEDDED_MODE ?? 'N/A'
      }</td></tr>` +
      `<tr><td>Language</td><td>${
        siteData.detectedLanguage || 'N/A'
      }</td></tr>` +
      `<tr><td>Utils</td><td>${siteData.hasUtils ? '✅' : '❌'}</td></tr>` +
      `<tr><td>ByteArrayReader</td><td>${
        siteData.hasByteArrayReader ? '✅' : '❌'
      }</td></tr>` +
      `<tr><td>MatrixLoader</td><td>${
        siteData.hasMatrixLoader ? '✅' : '❌'
      }</td></tr>` +
      `<tr><td>EmbeddedFiles</td><td>${
        siteData.hasEmbeddedFiles ? '✅' : '❌'
      }</td></tr>` +
      `<tr><td>DragController</td><td>${
        siteData.hasDragController ? '✅' : '❌'
      }</td></tr>` +
      `</table>` +
      // ─── MATRIX LIVE DATA ───
      (matrixLive
        ? `<div class="f796-section">📡 Matrix Live Data</div>` +
          `<table class="f796-stats-table">` +
          `<tr><td>Version</td><td>${matrixLive.ver}</td></tr>` +
          `<tr><td>Build Time</td><td>${
            matrixLive.time
              ? new Date(matrixLive.time * 1000).toISOString()
              : 'N/A'
          }</td></tr>` +
          `<tr><td>Download Size</td><td>${(
            matrixLive.downloadSize / 1048576
          ).toFixed(2)} MB</td></tr>` +
          `<tr><td>Progress</td><td>${matrixLive.progress}%</td></tr>` +
          `<tr><td>Updates</td><td>${matrixLive.updates.length} dates</td></tr>` +
          (matrixLive.updates.length
            ? `<tr><td>Last Update</td><td style="color:#6bcb77">${escHtml(
                matrixLive.updates[0]
              )}</td></tr>` +
              `<tr><td>Days Since</td><td>${Math.floor(
                (Date.now() - new Date(matrixLive.updates[0]).getTime()) /
                  86400000
              )}</td></tr>`
            : '') +
          `<tr><td>Perimeter</td><td>${matrixLive.perimeter.length} edge scenes</td></tr>` +
          `<tr><td>Fullsize Images</td><td>${matrixLive.fullsizeFiles.length} PNGs</td></tr>` +
          `</table>`
        : '') +
      // ─── FULLSIZE IMAGES ───
      (fullsize.length
        ? `<div class="f796-section">🖼️ Fullsize Images (${fullsize.length} frames)</div>` +
          `<div style="max-height:100px;overflow-y:auto;background:#0a0e14;border:1px solid #1e2d3d;border-radius:3px">` +
          fullsize
            .slice(0, 60)
            .map(
              f =>
                `<div style="display:flex;gap:6px;padding:1px 6px;border-bottom:1px solid #1a2332;font-size:8px">` +
                `<span style="color:#5a6672;flex:1">${escHtml(
                  f.filename
                )}</span>` +
                `<span style="color:#4a5568">${
                  f.size ? (f.size / 1024).toFixed(0) + 'KB' : ''
                }</span>` +
                `<a href="${escHtml(
                  f.url
                )}" target="_blank" style="color:#00ffc8;text-decoration:none">🔗</a>` +
                `</div>`
            )
            .join('') +
          `</div>`
        : '') +
      // ─── SESSION INFO ───
      `<div class="f796-section">🔑 Session Info</div>` +
      `<table class="f796-stats-table">` +
      `<tr><td>client_id</td><td style="font-size:9px">${escHtml(
        localStorage.getItem('client_id') || 'N/A'
      )}</td></tr>` +
      `<tr><td>visit</td><td>${escHtml(
        localStorage.getItem('visit') || '0'
      )}</td></tr>` +
      `<tr><td>visit_time</td><td>${escHtml(
        localStorage.getItem('visit_time') || 'N/A'
      )}</td></tr>` +
      `<tr><td>last-pos</td><td style="font-size:9px">${escHtml(
        localStorage.getItem('last-pos') || 'N/A'
      )}</td></tr>` +
      `<tr><td>last-change</td><td>${escHtml(
        localStorage.getItem('last-change') || 'N/A'
      )}</td></tr>` +
      `<tr><td>Render Engine</td><td>${
        localStorage.getItem('f796-render-engine-v3') === null ||
        localStorage.getItem('f796-render-engine-v3') === '1'
          ? 'V3 (WASM)'
          : 'V1 (MP4)'
      }</td></tr>` +
      `</table>` +
      // ─── ENTITY DATABASE ───
      `<div class="f796-section">Entity Database</div>` +
      `<table class="f796-stats-table"><tr><td>Total items</td><td>${db.items.length}</td></tr>${typeRows}</table>` +
      `<div class="f796-section">Matrix (intercepted)</div>` +
      `<table class="f796-stats-table">${matrixRows}</table>` +
      // ─── SITE LS KEYS REFERENCE ───
      `<div class="f796-section">📖 Site localStorage Keys</div>` +
      `<table class="f796-stats-table">` +
      Object.entries(SITE_LS_KEYS)
        .map(([k, desc]) => {
          const val = localStorage.getItem(k)
          return `<tr><td style="color:#f97316;font-size:9px">${escHtml(
            k
          )}</td><td style="font-size:8px">${escHtml(
            desc
          )}<br><span style="color:#00ffc8">${
            val !== null
              ? escHtml(String(val).substring(0, 40))
              : '<span style="color:#3d4f5f">(unset)</span>'
          }</span></td></tr>`
        })
        .join('') +
      `</table>` +
      // ─── STAT TARGETS ───
      `<div class="f796-section">📊 Stat Targets Bitmask</div>` +
      `<table class="f796-stats-table">` +
      Object.entries(STAT_TARGETS)
        .map(
          ([name, val]) =>
            `<tr><td style="font-size:9px">${name}</td><td style="color:#00ffc8">${val} (0x${val.toString(
              16
            )})</td></tr>`
        )
        .join('') +
      `</table>` +
      // ─── HIDDEN URL PARAMS ───
      `<div class="f796-section">Hidden URL Parameters</div>` +
      `<table class="f796-stats-table">` +
      Object.entries(HIDDEN_URL_PARAMS)
        .map(
          ([k, v]) =>
            `<tr><td style="color:#f97316">?${
              v.param
            }</td><td style="font-size:9px">${escHtml(v.desc)}</td></tr>`
        )
        .join('') +
      `</table>` +
      // ─── INTERCEPTION STATUS ───
      `<div class="f796-section">Interception Status</div>` +
      `<table class="f796-stats-table">` +
      `<tr><td>front.js intercepted</td><td>${
        frontJsIntercepted ? '✅ Yes' : '❌ No'
      }</td></tr>` +
      `<tr><td>front.js URL</td><td style="font-size:9px;word-break:break-all">${
        frontJsUrl || 'N/A'
      }</td></tr>` +
      `<tr><td>Zoom arrays patched</td><td>${
        frontJsPatchCount > 0 ? `✅ ${frontJsPatchCount}` : '❌ 0'
      }</td></tr>` +
      `<tr><td>Controller hooked</td><td>${
        controllerReady ? '✅ Yes' : '❌ No'
      }</td></tr>` +
      `<tr><td>Zoom method patched</td><td>${
        zoomPatched ? '✅ Active' : '❌ No'
      }</td></tr>` +
      `<tr><td>Current zoom</td><td>${
        getZoomFactor()?.toFixed(3) || 'N/A'
      }</td></tr>` +
      `<tr><td>Version</td><td>v${VERSION}</td></tr>` +
      `</table>` +
      `<div style="display:flex;gap:6px;margin:10px 0">` +
      `<button class="f796-btn" id="f796-rescan">🔄 Rescan</button>` +
      `<button class="f796-btn" id="f796-retry">🔌 Retry Ctrl</button>` +
      `<button class="f796-btn f796-btn-danger" id="f796-clear">🗑️ Clear</button>` +
      `</div>` +
      `<div class="f796-section">Scan Log (last ${Math.min(
        scanLog.length,
        40
      )})</div>` +
      `<div class="f796-log" id="f796-log">${escHtml(
        scanLog.slice(-40).join('\n')
      )}</div>`

    el.querySelector('#f796-rescan').addEventListener('click', () => {
      db.loaded = false
      log('Manual rescan')
      fetchLiveData()
      renderActiveTab()
    })
    el.querySelector('#f796-retry').addEventListener('click', () => {
      log('Manual controller retry')
      waitForController()
      renderActiveTab()
    })
    el.querySelector('#f796-clear').addEventListener('click', () => {
      storageDel(SK.db)
      storageDel(SK.bookmarks)
      storageDel(SK.completed)
      db = {
        items: [],
        matrix: null,
        byType: {},
        loaded: false,
        fetchedAt: null
      }
      log('Database cleared')
      renderActiveTab()
    })
  }

  // ── Shared: render one item row ──
  function renderItemRow (item) {
    const type = item._type || 'character'
    const icon = TYPE_ICONS[type] || '❓'
    const color = TYPE_COLORS[type] || '#67e8f9'
    const c = item._center
    const pos2 = c ? `${c.scene} (${c.x},${c.y})` : '—'
    const lt = getLinkTypeLabel(item.l)
    // Inline audio play button for audio items
    let audioBtn = ''
    if (type === 'audio' && item.l) {
      const playUrl = (item.l || '')
        .split('||')[0]
        .replace(/^play(-loop)?:\/\//, '')
      audioBtn = `<span class="f796-audio-inline" data-audio-url="${escHtml(
        playUrl
      )}" style="cursor:pointer;font-size:14px;flex-shrink:0;margin-right:4px" title="Play audio">▶</span>`
    }
    return (
      `<li class="f796-item" data-id="${item.id}">` +
      `<span class="item-icon">${icon}</span>` +
      `<div class="item-body">` +
      `<div class="item-title">${escHtml(item.t)}</div>` +
      `<div class="item-meta"><span>${item.d}</span><span>${pos2}</span>${
        lt ? `<span>${lt}</span>` : ''
      }${
        (item._eventNames || []).length
          ? `<span style="color:#fbbf24">⚡ ${item._eventNames.join(
              ', '
            )}</span>`
          : ''
      }</div>` +
      `</div>` +
      audioBtn +
      `<span class="item-badge" style="background:${color}22;color:${color}">${type}</span>` +
      `</li>`
    )
  }

  function getLinkTypeLabel (link) {
    if (!link) return ''
    const labels = []
    const parts = link
      .split('||')
      .map(s => s.trim())
      .filter(Boolean)
    for (const p of parts) {
      if (p.startsWith('interactive://')) labels.push('🎮 interactive')
      else if (p.startsWith('event://')) labels.push('⚡ event')
      else if (p.startsWith('play://')) labels.push('🔊 audio')
      else if (p.startsWith('play-loop://')) labels.push('🔁 loop')
      else if (p.startsWith('img://')) labels.push('🖼️ image')
      else if (p.startsWith('http')) labels.push('🔗 link')
    }
    return labels.length ? labels.join(' + ') : ''
  }

  function escHtml (s) {
    if (!s) return ''
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECTION 10 ─ INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  log(`Floor796 Companion v${VERSION} — document-start`)
  log('Script interception armed: watching for front.*.js')

  function onReady (fn) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', fn)
    else fn()
  }

  onReady(() => {
    log('DOM ready — injecting UI')
    injectStyles()
    createPanel()
    fetchLiveData()

    // Restore persisted toggles
    if (settings.coordHUD) toggleCoordHUD(true)

    // If front.js wasn't intercepted, try controller access directly
    if (!frontJsIntercepted) {
      log('front.js was not intercepted — trying direct controller access')
      waitForController()
    }

    // Listen for event from our injected/modified front.js
    document.addEventListener('f796-front-loaded', () => {
      log('f796-front-loaded event received from modified front.js')
    })

    // Update navigate tab on hash change
    window.addEventListener('hashchange', () => {
      if (activeTab === 'navigate' || activeTab === 'map') renderActiveTab()
    })

    log(
      'Initialization complete — v' +
        VERSION +
        ' (live data mode — interactives, addons, scenes, events all fetched from server)'
    )
  })
})()
