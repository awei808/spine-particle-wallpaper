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

| Capability                                                       | Upstream | Here                                                           |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Layered scenes (background / character / particles / foreground) | Yes      | Yes, plus a `particle` layer and explicit z-ordering           |
| Touch interaction & action scheduling                            | —        | ✅ Hit zones, mutual exclusion and interrupt rules             |
| Voice lines + subtitle bubbles                                   | —        | ✅ Anchored to the character, auto-wrapping, fade in/out       |
| BGM                                                              | —        | ✅ Looping playback with volume control                        |
| Pause / resume                                                   | —        | ✅ **Unified audio master** (WE `setPaused` + page visibility) |
| Pointer trail                                                    | —        | ✅ Emitted along cursor movement                               |
| Built-in settings panel                                          | —        | ✅ 5 tabs, edit at runtime and persist                         |
| Archive panel / disclaimer                                       | —        | ✅                                                             |
| Debug probe                                                      | —        | ✅ HUD plus CDP snapshot API                                   |

## Features

- **Layered scenes** — `texture` / `spine` / `particle` / `video` layers ordered by `position.z`, with full-screen fitting (`fitAspect`: height- or width-locked) and DPI awareness (`dpr: "auto"`). Black-bar detection is **real coverage based** (per-side, projected to screen), not an aspect-ratio threshold.
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
  "greetMode": "time",
  "touchFeedbackMode": "immediate",
  "standbyKinds": ["chat"],
  "touchKinds": ["touch"],
  "resumeKinds": ["greet"]
}
```

| List                  | When it fires                                                          | Which line is picked                                                                                            |
| --------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `greet` (greetings)   | any of the three channels with `greet` enabled (resume **by default**) | `greetMode`: `"time"` picks entry #1/#2/#3 by system clock (morning/noon/evening); `"random"` ignores the clock |
| `chat` (idle chatter) | any of the three channels with `chat` enabled (idle **by default**)    | random from the `chat` list                                                                                     |
| `touch`               | any of the three channels with `touch` enabled (click **by default**)  | random from the `touch` pool                                                                                    |

Every entry is an `actionId` from `subtitle.dialogues` — **add a candidate by adding a number**
(e.g. `"greet": [64001, 64002, 64003, 64004]`).

Two behaviour switches are also exposed on the built-in settings panel (Actions tab):

- `touchFeedbackMode` — what a click does while an action is already playing:
  **`legacy`** (default — only greets/chatter are interrupted; clicks during a touch action are
  ignored, i.e. the pre-2026-10-08 behaviour) / **`immediate`** (always play the new one now) /
  **`queue`** (after the current one finishes) / **`none`** (no feedback at all).
- `greetMode` — how a greeting is chosen: **`time`** (default, by system clock) / **`random`**.

### The three `*Kinds` multi-selects

Four trigger channels exist, and the Actions tab exposes **three structurally identical**
multi-selects, one per automatic/click entry point. All three offer the same options
(`"chat"` / `"greet"` / `"touch"`, shown as chat 类 / greet 类 / touch 类) but **different defaults**:

| Setting                       | Field          | When it fires                                      | Default     |
| ----------------------------- | -------------- | -------------------------------------------------- | ----------- |
| Events triggerable by touch   | `touchKinds`   | any hit zone is clicked                            | `["touch"]` |
| Events triggerable on return  | `resumeKinds`  | startup / back to desktop / focus gain / WE resume | `["greet"]` |
| Events triggerable after idle | `standbyKinds` | idle longer than `standbyIdleMs`                   | `["chat"]`  |

The three defaults were chosen so that **upgrading changes nothing**. When more than one kind is
selected, the kinds' pools are **merged into one pool** and picked from uniformly (every entry
equally likely, so classes are weighted by their entry count); an empty array disables that entry
point completely. Sole exception: a channel with **only `greet` selected** still uses `greetMode`
(by clock / random), otherwise time-of-day greetings would silently break.

> The legacy `greeting` (slot → actionId map), `standby` (single actionId) and the two booleans
> `standbyGreetEnabled` / `standbyTouchEnabled` are still read for backwards compatibility
> (the booleans only affect the idle channel); new configs should just use the three arrays above
> plus the three `*Kinds`. An **empty** `greet` / `chat` array counts as _not configured_ and
> falls back to the legacy field (it will not silently disable the whole event class).
> The old boolean `greetInTouchPool` (panel: "touch 触发 greet 事件") has been **removed** — its
> meaning is now expressed by enabling `greet` on the touch channel.

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
