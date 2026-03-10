# 🏢 Floor796 Companion

> **The ultimate companion overlay for [floor796.com](https://floor796.com)** — a community-built Tampermonkey userscript that adds a full HUD with 14 feature tabs, animation engine control, a phonebook dialer, scene navigation, traffic monitoring, resource ripping, and much more.

![Version](https://img.shields.io/badge/version-6.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-compatible-brightgreen)
![Greasemonkey](https://img.shields.io/badge/Greasemonkey-compatible-brightgreen)

---

## 📸 Preview

<p align="center">
  <img src="https://floor796.com/img/og.jpg" alt="Floor796" width="600">
</p>

> Floor796 is an ever-expanding animated pixel-art scene packed with hundreds of pop-culture references, hidden easter eggs, interactive minigames, and community content. This companion tool helps you explore, control, and understand every detail.

---

## ⚡ One-Click Install

### Requirements
- [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, Firefox, Safari, Opera)
- Or [Greasemonkey](https://www.greasespot.net/) (Firefox)
- Or [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Edge, Firefox)

### Install the Script

**👉 [Click here to install Floor796 Companion](../../raw/main/floor796-companion.user.js)**

> Your userscript manager will prompt you to install. Click **Install** / **Confirm**.

### Manual Install
1. Open your userscript manager dashboard
2. Create a new script
3. Delete the template content
4. Paste the entire contents of [`floor796-companion.user.js`](floor796-companion.user.js)
5. Save (Ctrl+S)
6. Visit [floor796.com](https://floor796.com) — the companion HUD appears in the top-left corner

---

## 🎮 Features Overview

The companion adds a **draggable overlay panel** (420×620px) with **14 tabs**:

| Tab | Icon | Description |
|-----|------|-------------|
| **Search** | 🔍 | Full-text search across all 770+ scene items with teleport-on-click |
| **Navigate** | 🗺️ | Teleport, fly-to, zoom control (0.01×–20×), bookmarks, wandering mode |
| **Map** | 🧩 | Interactive world grid with density heatmap, addon overlays, progress stats |
| **Easter Eggs** | 🐣 | Browse & filter all interactive elements, events, audio triggers, image popups |
| **Characters** | 👤 | Dedicated character/meme/reference browser with type filtering |
| **Quests** | ⚔️ | Quest tracker with completion status (persisted across sessions) |
| **Playback** | ⏯️ | Full animation engine: freeze, step, speed (0.05×–5×), bounce, reverse, loop-range, frame export |
| **Control** | 🎛️ | Quest Tuner solver + Addon Content Browser with force-render |
| **Tools** | 🔧 | Debug toggles, render injection, CDN override, cache mgmt, event dispatcher, localStorage viewer |
| **Traffic** | 📡 | Real-time network monitor (fetch, XHR, WebSocket, BroadcastChannel) |
| **Phonebook** | 📞 | 28 discovered payphone numbers with dialer + audio player |
| **Hologram** | 🎬 | Hologram Room controller (6 movies) + custom hologram injection |
| **Ripper** | ⬇️ | Site resource discovery & batch download (JS, CSS, WASM, images, audio) |
| **DB** | 📊 | Full diagnostic dashboard: auth, globals, matrix data, session, entity stats |

---

## 🔧 Detailed Feature Guide

### 🔍 Search
- Real-time incremental search across all known characters, easter eggs, memes, and scene items
- Click any result to **fly/teleport** to its exact location in the scene
- Searches across item titles, event names, and link keywords

### 🗺️ Navigate
- **Current Position** — live scene ID, X, Y, and zoom factor
- **Teleport** — enter scene/X/Y for instant snap or animated fly-to
- **Zoom Slider** — continuous 0.01×–20× range (25 levels, patched via front.js interception)
- **Zoom Presets** — 0.1×, 0.5×, 1×, 2×, 5×, 10×, Max In/Out
- **Wandering Mode** — activates the site's built-in random-walk explorer
- **Bookmarks** — save/load/delete named positions (persisted in GM storage)

### 🧩 Map
- **World Grid** — dynamically built from live matrix data, colored by item density
- Click any scene cell to **teleport** directly
- Current position marker (🟢) and addon overlay indicators (🟠)
- **World Progress** — populated vs. total scenes percentage
- **Addon Overlays** — lists all conditional addons with their unlock criteria
- **Item Distribution** — sorted bar chart of items per scene

### 🐣 Easter Eggs
- Filter by type: 🎮 Interactive, ⚡ Events, 🔊 Audio, 🖼️ Images
- Inline ▶ play buttons for audio-type items
- Click to fly to any easter egg's location

### 👤 Characters
- Dedicated browser for character/meme/reference entries
- Real-time text filter with count display
- Type badges and reference labels per entry

### ⚔️ Quests
- Lists all quest items with ✅ DONE / ⚔️ PENDING status
- Toggle completion (persisted via GM storage)
- Click to teleport to quest location

### ⏯️ Playback — Animation Engine Control
This is the **crown jewel** — full control over floor796's 60-frame animation loop:

- **Transport Controls** — Pause, Play, Step ±1, Jump to First/Last Frame, Vibrate
- **Playback Modes:**
  - ➡️ **Normal** — standard forward playback
  - 🔄 **Bounce** — ping-pong between frame 0 and 59
  - ⬅️ **Reverse** — continuous backward playback
  - 🔁 **Loop Range** — play only frames N–M in a loop
- **Speed Control** — 0.05× to 5.0× with presets and slider
- **Frame Scrubber** — drag to jump to any frame (1–60)
- **Frame Timeline** — visual 60-frame strip with current frame highlight
- **Live Preview** — real-time off-screen canvas thumbnail (380×200)
- **Frame Export** — save current frame as PNG, export all 60 frames, or copy to clipboard
- **Audio Sync** — playback speed automatically syncs to all active audio sources

### 🎛️ Control
- **Quest 2 — Subspace Tuner** — interactive solver with 8 binary switches, 15-color picker, 16-position wheel. Calculates hex values and verifies via server API.
- **Addon Content Browser** — browse & force-render content from 4 addon APIs:
  - 💭 Change My Mind — pick from existing phrases or type custom text
  - 🎵 Melody — browse/search all melodies, force any onto the scene
  - 🎨 Fun Drawing — browse community drawings
  - 📢 Free Ads — browse community ads
  - Auto-reset timer to resume random rotation

### 🔧 Tools
- **Debug Toggles** — hitbox overlay, coordinate HUD, URL parameter flags
- **Render Slot Injection** — inject custom images into the scene renderer
- **CDN Override** — redirect asset loading to alternate CDN
- **Cache Management** — view stats and clear Cache API / IndexedDB
- **Interactive Launcher** — open all discovered minigames
- **Site Audio Player** — play any audio file from the database
- **Event Dispatcher** — fire arbitrary events from front.js system with one-click buttons
- **localStorage Viewer** — browse, copy, set, delete entries
- **Hidden Features** — secret addon unlock, render engine info, debug canvas, live globals dump
- **Changes Timeline** — monthly bar chart of item additions

### 📡 Traffic
- **Live Stats** — total intercepted requests, addon responses, WebSocket messages
- **Traffic Log** — last 100 requests with method, status, URL, content type
- **Auto-refresh** mode (2-second interval)
- **Captured Responses** — view intercepted addon API responses
- **WebSocket Monitor** — last 50 WS messages
- **JSON Export** — dump all captured traffic data

### 📞 Phonebook
- **28 community-discovered phone numbers** spanning pop-culture references:
  - Metal Gear Solid, The Fifth Element, FNAF, Silent Hill, Breaking Bad, God of War, Hitchhiker's Guide to the Galaxy, Terminator, Hotline Miami, Jenny (867-5309), GTA, Ghostbusters, Seinfeld, and more
- **Integrated Dialer** — enter any 7-digit number, auto-queries the server
- **Now Playing** bar with stop button
- **A–Z sorted list** — search by name, number, reference, or filename
- Inline ▶ play buttons on every entry

### 🎬 Hologram
- **6 Movie Holograms:** 2001: A Space Odyssey, Cube, Planetes, The Matrix, Saw, Hackers
- Pick & play via custom events
- **Custom Hologram Injection** — provide image URL + titles (supports file upload → data URL)
- **Scene Events** — trigger Naruto (Shadow Clone Jutsu) and Jaws 19 animations
- Teleport to Hologram Room button

### ⬇️ Ripper
- **DOM Scanner** — discovers all JS, CSS, Workers, WASM, JSON, images, audio from live DOM
- **Live HTML Scanner** — fetches page source for additional resource URLs
- Per-category listing with download (⬇️) and view (👁️) buttons
- **Batch Fetch** — download entire categories via GM_xmlhttpRequest (CORS-bypassed)
- **Copy URLs** per category
- **Known API Endpoints** — 19 documented endpoints
- **Custom URL Schemes** — `event://`, `interactive://`, `img://`, `play://`, `quest://`

### 📊 DB — Diagnostic Dashboard
- **User & Auth** — username, ID, role, cookies
- **Live Site Globals** — STATIC_URL, CDN, view mode, WebP support, detected utilities
- **Matrix Live Data** — version, build time, size, progress, update frequency
- **Fullsize Images** — direct links to all fullsize PNG frames
- **Session Info** — client_id, visit counter, render engine version
- **Entity Database** — total items by type breakdown
- **Stat Targets Bitmask** — 16 interaction tracking flags explained
- **Hidden URL Parameters** — documented reference

---

## 🏗️ Technical Architecture

### Engine Hooks
- **front.js Interception** — A `MutationObserver` catches the `<script>` tag at `document-start`, fetches the source via `GM_xmlhttpRequest`, patches zoom arrays with a 25-level range (0.01×–20×), and re-injects the modified code inline
- **Traffic Hooks** — `fetch`, `XMLHttpRequest`, `WebSocket`, and `BroadcastChannel` are all monkey-patched on `unsafeWindow` before site code runs
- **Animation Override** — Custom `setInterval` loop replaces the native rAF/setTimeout renderer. Uses `m._displayList[slot].prepare(frame)` for canvas mode and `v.loadFrame(targetTime, true)` for video mode
- **Audio Speed Sync** — Patches `AudioContext.createBufferSource()` to track active sources and sync `playbackRate` with animation speed

### Storage
| Store | Contents |
|-------|----------|
| `GM_setValue` / `GM_getValue` | Bookmarks, quest completion, phonebook settings, DB cache |
| `Cache API` | Browser cache for floor796 assets |
| `IndexedDB` | floor796 tile database (v3) |

### Custom Events (dispatched)
| Event | Purpose |
|-------|---------|
| `jump-frame` | Jump animation to specific frame |
| `vibrate-scene` | Trigger scene vibration effect |
| `select-change-my-mind` | Force "Change My Mind" addon content |
| `select-melody` | Force melody addon content |
| `select-fun-drawing` | Force drawing addon content |
| `select-free-ads` | Force ad addon content |
| `inject-render-slot` | Inject custom image into renderer |

---

## 🤝 Contributing

Contributions are welcome! This is a community tool for a community project.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

### Guidelines
- Keep all code in a single `.user.js` file (Tampermonkey requirement)
- Test on both `floor796.com` and `www.floor796.com`
- Don't add features that could harm the site or its creator
- Document new phone numbers, easter eggs, or API endpoints you discover

---

## 📜 License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

---

## ⚠️ Disclaimer

This is an **unofficial** community tool. It is not affiliated with or endorsed by the creator of floor796. Use responsibly — this tool is for exploration and appreciation of the incredible pixel art world that is floor796.

---

## 🙏 Credits

- **[floor796.com](https://floor796.com)** — the amazing ever-expanding animated pixel art scene by its creator
- **Community** — for discovering phone numbers, easter eggs, and hidden features
- Built with ❤️ for the floor796 community
