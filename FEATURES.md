# 📖 Floor796 Companion — Complete Feature Documentation

> Exhaustive reference for every feature, button, and capability in v6.0.0

---

## Table of Contents

- [Panel Overview](#panel-overview)
- [Tab 1 — 🔍 Search](#tab-1--search)
- [Tab 2 — 🗺️ Navigate](#tab-2--navigate)
- [Tab 3 — 🧩 Map](#tab-3--map)
- [Tab 4 — 🐣 Easter Eggs](#tab-4--easter-eggs)
- [Tab 5 — 👤 Characters](#tab-5--characters)
- [Tab 6 — ⚔️ Quests](#tab-6--quests)
- [Tab 7 — ⏯️ Playback](#tab-7--playback)
- [Tab 8 — 🎛️ Control](#tab-8--control)
- [Tab 9 — 🔧 Tools](#tab-9--tools)
- [Tab 10 — 📡 Traffic](#tab-10--traffic)
- [Tab 11 — 📞 Phonebook](#tab-11--phonebook)
- [Tab 12 — 🎬 Hologram](#tab-12--hologram)
- [Tab 13 — ⬇️ Ripper](#tab-13--ripper)
- [Tab 14 — 📊 DB View](#tab-14--db-view)
- [Engine Architecture](#engine-architecture)
- [URL Schemes](#url-schemes)
- [API Endpoints](#api-endpoints)
- [Keyboard Shortcuts & Interactions](#keyboard-shortcuts--interactions)

---

## Panel Overview

The companion overlay is a **420×620px draggable panel** anchored to the top-left corner of the viewport. It features:

- **Title bar** — "Floor796 Companion v6.0.0" with a close/minimize button
- **Tab bar** — 14 icon tabs in a flex-wrap layout (icons + labels visible)
- **Content area** — scrollable panel body for the active tab
- **Scan log** — bottom status bar showing the last engine log message
- **Styling** — deep black (`#0a0a0a`) background, gradient border (blue → purple), backdrop blur, neon accents

The panel is:
- Draggable via the title bar
- Remembers position across sessions
- Z-indexed above all site content
- Responsive to the site's scroll and zoom

---

## Tab 1 — 🔍 Search

**Purpose:** Full-text search across the entire floor796 changelog database (770+ items).

### How It Works
1. The script intercepts the site's `changelog.json` response (or fetches it directly with cache-busting)
2. Each item is classified by its link type (character, event, interactive, audio, image, quest)
3. The search input filters across: item title (`t`), event names (`_eventNames`), and link keywords (`_linkKeywords`)

### Features
- **Instant results** as you type (no debounce — it's fast)
- **Result count** displayed in header
- **Click any result** → animated fly-to or instant teleport to its scene coordinates
- **Type icon** badge on each result row
- **Event name** and **link keywords** shown as secondary info

---

## Tab 2 — 🗺️ Navigate

**Purpose:** Precision movement and spatial control across the floor796 world.

### Sections

#### Current Position
- Displays: Scene ID, X coordinate, Y coordinate, Zoom factor
- Auto-updates when you move

#### Teleport
- **Scene** input (1-based scene number)
- **X** and **Y** coordinate inputs
- **Snap** — instant teleport (no animation)
- **Fly To** — smooth animated pan to target

#### Zoom Control
- **Continuous slider** — 0.01× to 20× (25 zoom levels)
- **Preset buttons:** 0.1×, 0.5×, 1×, 2×, 5×, 10×
- **Max Zoom Out** / **Max Zoom In** buttons
- **Zoom bypass status** — shows whether front.js zoom arrays were successfully patched

#### World View (Experimental)
- **Full Render** toggle — forces engine to render all scene tiles (disables culling)
- **Disable Culling** toggle — prevents off-screen tile cleanup

#### Wandering Mode
- **Start** — activates the site's built-in random-walk system (same as `#wandering` URL hash)
- **Stop** — returns to manual navigation

#### Bookmarks
- **Save** current position with a custom name
- **Load** — click any bookmark to teleport there
- **Delete** — remove individual bookmarks
- Bookmarks persist across sessions via `GM_setValue`

---

## Tab 3 — 🧩 Map

**Purpose:** Bird's-eye view of the entire floor796 world grid.

### World Grid
- Built from live `matrix.json` data
- Each cell = one scene
- **Color intensity** based on item count (density heatmap)
- **Click any cell** → teleport to that scene
- **🟢 marker** = your current position
- **🟠 markers** = scenes with addon overlays

### Stats
- **World Progress** — percentage of populated scenes vs. total grid
- **Total Scenes** / **Populated Scenes** counts

### Addon Overlays
- Lists all `overlay_conditional` addons
- Shows unlock criteria (`lsb:` conditions, server checks)
- Scene number for each overlay

### Scene Item Distribution
- Sorted bar chart showing item count per scene
- Visual breakdown of where content is concentrated

---

## Tab 4 — 🐣 Easter Eggs

**Purpose:** Browse and discover all interactive elements, events, audio triggers, and image popups.

### Filters
- 🎮 **Interactive** — minigames and interactive addons (`interactive://` links)
- ⚡ **Events** — animation triggers (`event://` links + items with bound event names)
- 🔊 **Audio** — sound-playing items (`play://` links)
- 🖼️ **Images** — popup image overlays (`img://` links)

### Features
- **Type filtering** — click filter buttons to show/hide categories
- **Text search** — filters by name, event name, link keywords
- **Inline audio play** — ▶ buttons for audio items (plays from CDN)
- **Click to teleport** — fly to any item's scene location

---

## Tab 5 — 👤 Characters

**Purpose:** Dedicated browser for character references, memes, and pop-culture cameos.

### What's Included
- Items classified as `character`, `event`, or `audio` types
- Excludes: `interactive` (minigames), `quest`, `image` (posters)

### Features
- **Real-time filter** — search across names, events, keywords
- **Count display** — "142 of 180 characters"
- **Click to teleport** to character's location
- **Type badges** and link-type labels

---

## Tab 6 — ⚔️ Quests

**Purpose:** Track quest completion across the floor796 world.

### Features
- Lists all `quest://` items from the database
- **✅ DONE** / **⚔️ PENDING** status per quest
- **Click status** to toggle completion (persisted via `GM_setValue`)
- **Click quest name** to teleport to location
- Progress persists across sessions and page reloads

---

## Tab 7 — ⏯️ Playback

**Purpose:** Full control over floor796's 60-frame animation engine.

### Status Grid (auto-updating every 200ms)
| Field | Description |
|-------|-------------|
| State | Playing / Frozen |
| Frame | Current frame 01–60 of 60 |
| FPS | Measured frames per second |
| Speed | Current multiplier (e.g., 2.0×) |
| Direction | FWD / REV |
| Mode | Normal / Bounce / Reverse / Loop-Range |

### Transport Controls
| Button | Action |
|--------|--------|
| ⏸ Pause | Freeze animation (halts native loop) |
| ▶ Play | Unfreeze / resume native loop |
| ⏮ Step Back | Step one frame backward |
| ⏭ Step Forward | Step one frame forward |
| ⏪ First Frame | Jump to frame 1 |
| ⏩ Last Frame | Jump to frame 60 |
| ▶/◀ Dir Toggle | Switch forward/reverse direction |
| 〰️ Vibrate | Trigger scene vibration effect |

### Playback Modes
| Mode | Behavior |
|------|----------|
| ➡️ **Normal** | Standard forward (or reverse if direction is REV) playback |
| 🔄 **Bounce** | Ping-pong: plays forward to frame 59, reverses to 0, repeats |
| ⬅️ **Reverse** | Continuous backward playback (59→58→...→0→59→...) |
| 🔁 **Loop Range** | Plays only frames N–M in a loop (configurable start/end) |

### Loop Range
- **Start Frame** input (1–60)
- **End Frame** input (1–60)
- **Apply** button — activates loop-range mode with specified bounds
- Invalid ranges are auto-corrected (swapped if start > end)

### Frame Scrubber
- **Drag slider** (1–60) to jump to any frame
- Tick marks every 5 frames
- Current frame value display

### Speed Control
- **Slider** — continuous 0.05× to 5.0× range
- **Presets:** 0.1×, 0.25×, 0.5×, 1×, 2×, 3×, 5×
- **Reset** button (returns to 1.0×)
- Speed changes take effect immediately on the running timer

### Frame Timeline
- Visual strip showing all 60 frames
- **Current frame** highlighted
- **Loop-range bounds** colored differently
- Click any frame cell to jump to it

### Live Preview
- **Off-screen canvas** thumbnail (380×200px)
- **Toggle** real-time capture (refreshes per timer tick)
- **Snapshot** — capture current frame to preview
- Shows frame number overlay

### Frame Export
- **Save Frame** — download current frame as PNG
- **Export All 60** — sequentially step through all frames, save each as PNG (with progress bar)
- **Copy to Clipboard** — copy current frame as image data

### Technical Details
- Freezes the native `rAF`/`setTimeout` loop by setting `m._stopped = true`
- Runs its own `setInterval` at `Math.round(83 / speed)` ms
- For **canvas mode**: calls `m._displayList[slot].prepare(targetFrame)` then `m._renderDisplayList()`
- For **video mode**: calls `v.loadFrame(targetTime, true)` on all viewport videos
- Audio sources have their `playbackRate` synced automatically

---

## Tab 8 — 🎛️ Control

**Purpose:** Quest puzzle solver and live addon content manager.

### Quest 2 — Subspace Tuner
The Subspace Tuner is a puzzle involving:
- **8 binary switches** (on/off toggles)
- **15-color picker** (color wheel)
- **16-position wheel** (rotary selector)

The solver:
1. Calculates encoded hex values matching the site's internal verification
2. "Server Check" button POSTs to `/quest/quest2/check` to verify
3. Displays the initial token and final hash target

### Addon Content Browser
Browse live content from 4 addon APIs:

| Addon | API | Force Event |
|-------|-----|-------------|
| 💭 Change My Mind | `/addon/change-my-mind/random-list` | `select-change-my-mind` |
| 🎵 Melody | `/addon/melody/random-list` | `select-melody` |
| 🎨 Fun Drawing | `/addon/fun-drawing-v2/random-list` | `select-fun-drawing` |
| 📢 Free Ads | `/addon/free-ads/list` | `select-free-ads` |

Features:
- Browse / search all items in each addon
- **Force Render** — click any item to immediately display it on the scene
- Custom text input for Change My Mind
- Auto-reset timer dispatches `select-free-ads` after delay to resume rotation

---

## Tab 9 — 🔧 Tools

**Purpose:** Power-user debugging and experimentation toolkit.

### Quick Toggles
- **Debug Hitboxes** — overlay canvas showing clickable regions
- **Coord HUD** — live position bar (500ms polling)
- URL parameter toggles (`?debug`, `?nowebp`, `?novideo`, etc.)

### Render Slot Injection
Inject custom images into the scene renderer:
- Inputs: X, Y, Width, Height, Image URL
- Dispatches `inject-render-slot` event with `prepareRenderSource` callback

### CDN Override
- Set alternate `STATIC_URL` to redirect all asset loading
- Clear to restore default CDN

### Cache Management
- **Cache API** stats + clear button
- **IndexedDB** (`floor796` db v3) stats + clear button

### Interactive Launcher
- Discovers all `interactive://` URLs from the database
- Opens each in a popup window

### Site Audio Player
- Play any `play://` audio from the database via CDN URL

### Event Dispatcher
- Fire arbitrary `CustomEvent`s from front.js's event system
- One-click buttons for all known events (extracted from front.js source + changelog)
- Covers: scene events, character events, Easter egg triggers

### localStorage Viewer
- Browse all site localStorage keys
- Copy values, set new values, delete entries

### Hidden Features
- **Secret Addon Unlock** — conditional addon overlays with unlock/lock all
- **Render Engine Info** — WASM, Worker, ImageBitmap status + toggle
- **Debug Canvas** toggle
- **Extra Zoom** live inject
- **Selected Item Tracker** — polls for hovered scene elements
- **Live Globals Dump** — `Utils`, `ByteArrayReader`, `MatrixLoader`

### Changes Timeline
- Monthly bar chart of item additions over time
- Based on changelog timestamps

---

## Tab 10 — 📡 Traffic

**Purpose:** Real-time network traffic monitoring for all site communications.

### Stats
- Total intercepted requests count
- Addon responses, render JS files, WebSocket messages
- Phone / Quest-Tuner / Quest-Gems result counts
- Changelog / Matrix / Stat data capture status

### Traffic Log
- Last 100 requests in a scrollable table
- Columns: Method, Status, URL, Content-Type, Age
- Filterable by URL pattern

### Captured Addon Responses
- All intercepted `/addon/` API responses
- Shows method, URL, and content preview

### WebSocket Monitor
- Last 50 WebSocket messages
- Content preview per message

### Auto-Refresh
- Toggle 2-second auto-refresh for live monitoring

### Export
- Dump all traffic data to a JSON file

### Technical Details
All hooks installed at `document-start` on `unsafeWindow`:
- `fetch` → wrapped to intercept responses
- `XMLHttpRequest` → `open`/`send` wrapped
- `WebSocket` → `onmessage` wrapped
- `BroadcastChannel` → `onmessage` wrapped

---

## Tab 11 — 📞 Phonebook

**Purpose:** Floor796's hidden payphone system — 28 discovered numbers with audio playback.

### Discovered Numbers

| # | Name | Number | Reference |
|---|------|--------|-----------|
| 1 | Metal Gear Solid | 0014015 | Codec call frequency |
| 2 | The Fifth Element | 0119116 | Multipass scene |
| 3 | Five Nights at Freddy's | 0881987 | Freddy Fazbear |
| 4 | Silent Hill | 1031111 | Radio static |
| 5 | ??? (Secret) | 1115791 | Hidden easter egg |
| 6 | I'll Be Back | 1115792 | Terminator |
| 7 | Jesse Pinkman | 1483369 | Breaking Bad |
| 8 | God of War | 1800613 | Kratos theme |
| 9 | Biosystem | 2020327 | Sci-fi ambience |
| 10 | Aquarium | 2128506 | Akvarium (Russian band) |
| 11 | De La Soul | 2222222 | Ring Ring Ring |
| 12 | Karlson | 2232232 | Karlsson-on-the-Roof |
| 13 | Mimino | 2731977 | Soviet comedy film (1977) |
| 14 | Arthur Dent | 2741001 | Hitchhiker's Guide |
| 15 | Lyolik | 2870010 | Nu, Pogodi! cartoon |
| 16 | Funk do Yudi | 4002892 | Brazilian funk |
| 17 | The Ring | 4125518 | Samara's phone call |
| 18 | Foster Parents | 4452675 | Foster's Home |
| 19 | Irony of Fate | 4546021 | Soviet New Year classic |
| 20 | Imp | 4674355 | Doom demon |
| 21 | Hotline Miami | 5193708 | Do you like hurting other people? |
| 22 | Bruce Almighty | 5550123 | Bruce Almighty (2003) |
| 23 | GTA | 5550182 | Grand Theft Auto |
| 24 | Neo | 5550690 | The Matrix — Wake Up, Neo |
| 25 | Ghostbusters | 5552368 | Who ya gonna call? (1984) |
| 26 | Home Money | 5553535 | Home finance jingle |
| 27 | Seinfeld | 5558383 | Seinfeld theme |
| 28 | Jenny (867-5309) | 8675309 | Tommy Tutone |

### Dialer
- Large monospace input for 7-digit numbers
- **Call** button POSTs to `/quest/payphone/call` endpoint
- **Enter key** support
- Plays response audio via HTML5 `<audio>` element

### Now Playing Bar
- Shows currently playing track name
- **Stop** button to halt playback

### A–Z Contact List
- Sorted alphabetically by name
- Search box filters by name, number, reference, or filename
- Circular ▶ play buttons on each row
- Click any row to fill the dialer

### Settings
- **Auto-play** toggle (persisted via `GM_setValue`)

---

## Tab 12 — 🎬 Hologram

**Purpose:** Control the Hologram Room's movie display and inject custom content.

### Available Holograms
| ID | Movie |
|----|-------|
| 0 | 2001: A Space Odyssey |
| 1 | Cube |
| 2 | Planetes |
| 3 | The Matrix |
| 4 | Saw |
| 5 | Hackers |
| 6–13 | Reserved (404) |

### Custom Hologram Injection
- **Image URL** input (or file upload → data URL conversion)
- **Title EN** / **Title RU** inputs
- Dispatches `select-hologram-custom` event

### Scene Events
- **Naruto** — Shadow Clone Jutsu animation trigger
- **Jaws 19** — shark animation trigger

### Navigation
- **Teleport to Hologram Room** button

---

## Tab 13 — ⬇️ Ripper

**Purpose:** Discover and download all site resources.

### Scanner
- **DOM Scanner** — extracts all resource URLs from the live page DOM
- **Live HTML Scanner** — fetches raw HTML for additional URL discovery
- **front.js Analysis** — extracts resource references from the intercepted script source

### Resource Categories
| Category | Examples |
|----------|---------|
| JS | front.js, render workers |
| CSS | Stylesheets |
| Workers | WebWorkers, ServiceWorkers |
| WASM | WebAssembly modules |
| JSON | changelog.json, matrix.json |
| Images | Scene tiles, fullsize PNGs, sprites |
| Audio | Payphone MP3s, event sounds |
| Other | Miscellaneous resources |

### Per-Category Actions
- ⬇️ **Download** individual files (via `GM_xmlhttpRequest`)
- 👁️ **View** in new tab
- 📋 **Copy URLs** to clipboard
- **Batch Fetch** — download all files in a category

### Reference Data
- **19 Known API Endpoints** — complete list with methods and descriptions
- **Custom URL Schemes** — `event://`, `interactive://`, `img://`, `play://`, `quest://`

---

## Tab 14 — 📊 DB View

**Purpose:** Complete diagnostic dashboard of the site's internal state.

### Sections

#### User & Authentication
- Username, User ID, Role (anon/user/admin/superadmin)
- Cookie information

#### Live Site Globals
- `STATIC_URL`, CDN base, `IS_SMALL_VIEW`, `IS_WEBP_SUPPORTED`
- `IS_EMBEDDED_MODE`, language setting
- Detected utility classes: Utils, ByteArrayReader, MatrixLoader, EmbeddedFiles, DragController

#### Matrix Live Data
- Version number, build timestamp
- Download size, loading progress percentage
- Update dates, days since last update
- Perimeter edge scenes
- Fullsize PNG frame count and direct links

#### Session Information
- `client_id`, visit counter, `visit_time`
- `last-pos`, `last-change`
- Render engine version

#### Entity Database
- Total item count
- Breakdown by type: character, event, interactive, audio, image, quest

#### Site localStorage Keys
14 documented keys with current values:
- `client_id`, `c`, `lang`, `last-pos`, `last-change`, `visit_time`, `stat_targets`, `s`, `wandering`, `zoom_level`, `no_webp`, `no_video`, `no_hi_render`, `debug`

#### Stat Targets Bitmask
16 documented interaction tracking flags from front.js:
- Bit 0: Animation frame viewed
- Bit 1: Scene scrolled
- Bit 2: Item clicked
- ... through Bit 15

#### Hidden URL Parameters
- `?debug` — enable debug mode
- `?nowebp` — disable WebP
- `?novideo` — disable video mode
- `?zoom=N` — set initial zoom level

#### Interception Status
- front.js intercepted: yes/no
- Source URL, patched zoom array count
- Controller hooked, zoom method patched
- Current zoom level, detected version

### Actions
- **Rescan** — re-run all diagnostics
- **Retry Controller** — re-attempt engine hook
- **Clear Database** — wipe all persisted GM storage

---

## Engine Architecture

### Initialization Flow
1. `document-start` → install traffic hooks (fetch/XHR/WS/BC)
2. `MutationObserver` watches for front.js `<script>` tag
3. Intercept → fetch source → patch zoom arrays → re-inject inline
4. Poll for controller + matrix availability
5. Hook animation loop, audio sources, zoom methods
6. Build overlay panel + all 14 tabs

### Animation Pipeline
```
Native Loop (rAF/setTimeout @ ~12fps)
         │
    m._stopped = true  ←── freezeAnimation()
         │
    Custom setInterval  ←── startPlayback(speed)
         │
    ┌────┴────┐
    │ Canvas  │  m._displayList[slot].prepare(frame)
    │  Mode   │  m._renderDisplayList()
    ├─────────┤
    │ Video   │  v.loadFrame(targetTime, true)
    │  Mode   │
    └─────────┘
```

### Frame Computation (per mode)
| Mode | Logic |
|------|-------|
| Normal | `next = cur + direction; wrap 0↔59` |
| Bounce | `next = cur + bounceDir; flip at 0/59` |
| Reverse | `next = cur - 1; wrap 59→0` |
| Loop Range | `next = cur + dir; wrap at rangeStart↔rangeEnd` |

---

## URL Schemes

Floor796 uses custom URL schemes in changelog item links:

| Scheme | Purpose | Example |
|--------|---------|---------|
| `event://` | Trigger animation event | `event://naruto` |
| `interactive://` | Open minigame/addon | `interactive://racer796` |
| `img://` | Show image popup | `img://poster.jpg` |
| `play://` | Play audio file | `play://sound.mp3` |
| `quest://` | Quest interaction | `quest://quest2` |

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/data/data/changelog.json` | All scene items |
| GET | `/data/data/matrix.json` | World grid data |
| POST | `/quest/payphone/call` | Dial phone number |
| POST | `/quest/quest2/check` | Verify quest puzzle |
| GET | `/addon/change-my-mind/random-list` | Change My Mind content |
| GET | `/addon/melody/random-list` | Melody content |
| GET | `/addon/fun-drawing-v2/random-list` | Fun Drawing content |
| GET | `/addon/free-ads/list` | Free Ads content |
| POST | `/auth/login` | User login |
| POST | `/auth/signup` | User registration |
| POST | `/subscribe` | Email subscription |
| GET | `/stat` | Site statistics |

---

## Keyboard Shortcuts & Interactions

| Input | Action |
|-------|--------|
| Enter (in dialer) | Dial the entered phone number |
| Click result row | Teleport to item location |
| Drag title bar | Move the overlay panel |
| Click tab icon | Switch to that tab |
| Scroll panel body | Scroll within active tab content |

---

*Documentation for Floor796 Companion v6.0.0 — Last updated March 2026*
