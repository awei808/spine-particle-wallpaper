# spine-particle-wallpaper

**Spine skeletons + Unity-style particle FX, turned into interactive wallpapers for Wallpaper Engine.**

Bring a Spine character from a Unity mobile game to the desktop with its feel intact: multiple touch action sets, voice lines with subtitle bubbles, BGM, pointer trails, adaptive framing, and a built-in settings panel.

[中文](./README.zh.md)

> This repository is derived from [spicy-wolf/spine-wallpaper-engine](https://github.com/spicy-wolf/spine-wallpaper-engine) (GPL-3.0),
> rebuilt from a plain Spine animation player into an interactive character wallpaper framework.
> See [NOTICE.md](./NOTICE.md) for attribution and licensing.

## How is this different from upstream?

Upstream is a **player**: drop your Spine files into `assets/` and it loops them on your desktop.

This repository grew into a **framework** on top of that rendering core:

| Capability | Upstream | Here |
| --- | --- | --- |
| Layered scenes (background / character / particles / foreground) | Yes | Yes, plus a `particle` layer and explicit z-ordering |
| Touch interaction & action scheduling | — | ✅ Hit zones, mutual exclusion and interrupt rules |
| Voice lines + subtitle bubbles | — | ✅ Anchored to the character, auto-wrapping, fade in/out |
| BGM | — | ✅ Looping playback with volume control |
| Pause / resume | — | ✅ **Unified audio master** (WE `setPaused` + page visibility) |
| Pointer trail | — | ✅ Emitted along cursor movement |
| Built-in settings panel | — | ✅ 5 tabs, edit at runtime and persist |
| Archive panel / disclaimer | — | ✅ |
| Debug probe | — | ✅ HUD plus CDP snapshot API |

## Features

- **Layered scenes** — `texture` / `spine` / `particle` / `video` layers ordered by `position.z`, with aspect-ratio fitting (`minAspect` / `maxAspect`) and DPI awareness (`dpr: "auto"`).
- **Touch interaction** — rectangular hit zones plus an action sequence; `touch` / `greet` / `standby` sources follow explicit mutual-exclusion and interrupt rules.
- **Voice & subtitles** — the bubble follows a character anchor, voice plays through a dedicated player; both are wired into the audio master.
- **Audio master** (`src/audioMaster.ts`) — BGM and voice no longer subscribe to pause signals on their own; they register with a single master that handles pause/resume for both. Voice resumes from where it was paused.
- **Particles & trails** — `ParticleAnimator` handles scene particles, `PointerTrail` handles the cursor trail; deliberately separate.
- **Settings panel** — edit options at runtime and persist them to WE properties.
- **Debug probe** — `__WB_DIALOGUE__` / `__WB_FX__` snapshot APIs, designed for headless Chrome + CDP regression runs.

## Event lists and trigger rules

What the character says, and when, is entirely driven by the `subtitle` block of `config.json`.
**Editing it does not require a rebuild**:

```json
"subtitle": {
  "greet": [64001, 64002, 64003],
  "chat":  [64004],
  "touch": [64005, 64006, 64007, 64008, 64009, 64010],
}
```

| List | When it fires | Which line is picked |
| --- | --- | --- |
| `greet` (greetings) | startup / back to desktop / window regains focus / WE resume / (optional) idle timeout | entry #1/#2/#3 by **system clock** (morning/noon/evening) |
| `chat` (idle chatter) | long inactivity (idle longer than `standbyIdleMs`) | random from `chat` + `touch` |
| `touch` | any hit zone is clicked | random from the pool |

Every entry is an `actionId` from `subtitle.dialogues` — **add a candidate by adding a number**
(e.g. `"greet": [64001, 64002, 64003, 64004]`).

> The legacy `greeting` (slot → actionId map) and `standby` (single actionId) fields are still read
> for backwards compatibility; new configs should just use the three arrays above.

## Quick start

```bash
git clone --recurse-submodules https://github.com/awei808/spine-particle-wallpaper.git
cd spine-particle-wallpaper
npm ci
```

> ⚠️ `--recurse-submodules` is required: `packages/threejs-spine-3.8-runtime-es6` is a submodule and the build fails without it.

Assets and config:

1. Copy your Spine trio (`*.skel` / `*.atlas` / `*.png`) into `public/assets/`
2. Copy the example config: `cp public/assets/config.example.json public/assets/config.json`
3. Edit `config.json` for your assets — field reference in [public/assets/README.md](./public/assets/README.md)

Preview and build:

```bash
npm start          # dev server
npm run build      # emits dist/bundle.js
```

To import into Wallpaper Engine: place the contents of `dist/` together with `assets/` into a WE project directory, then follow the [official tutorial](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html).

## Layout

```
src/
  index.ts                 Assembly and main loop
  initScene.ts             Scene, camera, aspect fitting
  audioMaster.ts           * The audio master: single pause control point for BGM + voice
  bgmPlayer.ts             BGM player
  voicePlayer.ts           Voice line player
  voiceBubble.ts           Subtitle bubble
  dialogue.ts              Voice scheduling
  touch.ts                 Hit zones and action gating
  pointerTrail.ts          Pointer trail
  settingsPanel.ts         Built-in settings panel
  settingsStore.ts         Settings read/write and overrides
  archive.ts               Archive panel
  disclaimer.ts            Disclaimer dialog
  wePauseSignal.ts         Single installation point for WE setPaused
  idleSequence.ts          Ambient action sequence
  probe.ts / probeHud.ts   Debug probe
  animator/                texture / spine / video / particle layers
_regress/                  Regression scripts (ts-node)
public/assets/             Assets and config.json (assets are gitignored)
```

## Known issues

- The pointer trail emits based on cursor speed rather than distance, so fast strokes distribute unevenly. Counting logic is correct; distribution logic needs a fix.

## Licensing

- This repository: **GPL-3.0**, see [LICENSE.txt](./LICENSE.txt).
- Spine Runtimes: **Spine Runtimes License Agreement**, see [LICENSE.spine.txt](./LICENSE.spine.txt).
- Derived from spicy-wolf/spine-wallpaper-engine (GPL-3.0), see [NOTICE.md](./NOTICE.md).

## Disclaimer

This program only brings **your own** Spine animations to the desktop. Make sure you hold the rights to any assets, audio, and text you use — this repository ships no game assets (`public/assets/*` is gitignored; only documentation and an example config are kept).

Use it at your own risk. The author is not liable for any damages arising from its use.
