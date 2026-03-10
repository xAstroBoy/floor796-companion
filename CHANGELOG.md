# Changelog

All notable changes to Floor796 Companion are documented here.

## [6.0.0] — 2026-03-10

### ⏯️ Playback Tab — Complete Animation Engine
- **New Playback tab** with full animation engine control
- Transport controls: Pause, Play, Step ±1, First/Last frame, Vibrate
- **Bounce mode** — ping-pong playback between frame 0 and 59
- **Reverse mode** — continuous backward playback
- **Loop-Range mode** — play only a configurable subset of frames (N–M)
- Direction toggle (forward/reverse)
- Frame scrubber slider (1–60)
- Speed slider (0.05×–5.0×) with 7 presets
- Frame timeline strip with current frame highlight
- Live preview canvas (380×200) with real-time capture
- Frame export: save PNG, export all 60 frames, copy to clipboard
- Custom `stepToFrame()` render primitive for absolute frame targeting
- Audio speed sync for all active sources

### 📞 Phonebook Tab — Full Redesign
- **28 discovered phone numbers** including new finds: GTA, Bruce Almighty, Neo, Ghostbusters, Home Money, Seinfeld
- Added phone #22: Hotline Miami (5193708)
- Integrated dialer with large monospace input
- "Now Playing" bar with stop button
- Sorted A–Z contact list with circular play buttons
- Row click fills dialer, Enter key support
- Removed duplicate dialer from Control tab

### 🎛️ Control Tab
- Removed phone dialer (moved to dedicated Phonebook tab)
- Quest Tuner + Addon Browser remain

### 🐛 Bug Fixes
- Fixed bounce mode: no longer wraps via modular arithmetic (used integer clamping)
- Fixed reverse mode: direction flag now always starts custom timer
- Fixed loop-range: Apply button now always starts playback
- Fixed mode buttons not starting playback when native loop was running
- Fixed frame scrubber using fragile delta math (now uses stepToFrame directly)

---

## [5.0.0] — 2026-03

### 🏷️ Tab Bar Overhaul
- Changed tab labels from hidden to visible flex-wrap layout
- All 14 tabs show both icon and text label
- Tab bar wraps to multiple rows on narrow panels

### 🐛 Bug Fixes
- Fixed freeze not working during custom speed (always kill `_stepTimer` first)
- Fixed animation controller not respecting frozen state

---

## [4.0.0] — 2026-02

### 🔍 Search & Classification
- Added `extractEngineEventsFromSource()` — dynamically extracts event names from front.js
- Fixed `classifyItem()` to check all link segments (pipe-separated)
- Added `_eventNames` and `_linkKeywords` to each changelog item
- Characters tab filters by `CHARACTER_TYPES = new Set(['character', 'event', 'audio'])`

### 🎨 HUD Redesign
- Bigger panel: 420×620px
- Deeper black background (`#0a0a0a`)
- Gradient border (blue → purple)
- Backdrop blur effect
- Larger icons in tab bar

### 📊 Engine Events
- Removed hardcoded `ENGINE_EVENTS` constant
- Events now extracted live from front.js source code

---

## [3.0.0] — 2026-02

### 🔄 Dynamic Data
- Replaced all hardcoded constants with live getter functions
- `getInteractiveUrls()` — extracts from live changelog
- `getAddonRenderers()` — extracts from live changelog
- `getSceneGrid()` — extracts from live matrix
- `getKnownEvents()` — extracts from front.js source
- PHONEBOOK stays hardcoded (server-sided data)

### 🐛 Bug Fixes
- Fixed stale cached `changelog.json` with cache-busting (`?_=timestamp`)
- Fixed backward text/cursor in textbox by preserving input DOM element

---

## [2.0.0] — 2026-01

### 📞 Phonebook
- Added 21 discovered phone numbers
- Payphone dialer UI
- Audio playback integration

### 🔒 Security Cleanup
- Removed all malicious/harmful features from base script
- Cleaned up code for community use

---

## [1.0.0] — 2026-01

### 🎉 Initial Release
- 14-tab companion overlay
- Search, Navigate, Map, Easter Eggs, Characters, Quests
- Control tab with Quest Tuner and Addon Browser
- Tools tab with debug toggles and power-user features
- Traffic monitor (fetch, XHR, WebSocket, BroadcastChannel)
- Hologram Room controller
- Resource Ripper
- DB diagnostic dashboard
- front.js interception and zoom bypass (0.01×–20×)
- Draggable panel with persistent position
