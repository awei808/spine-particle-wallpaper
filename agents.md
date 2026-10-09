# Agents

Guidance for AI coding agents (Claude Code, Cursor, WorkBuddy, Copilot, …) working in this repository.

## What this repo is

An **interactive Wallpaper Engine wallpaper framework** built on top of a Spine 3.8
rendering core. It turns a Spine character (typically unpacked from a Unity mobile game)
into a desktop wallpaper with layered scenes, touch action sets, voice lines + subtitle
bubbles, BGM, pointer trails, adaptive framing, and a built-in settings panel.

- Derived from [`spicy-wolf/spine-wallpaper-engine`](https://github.com/spicy-wolf/spine-wallpaper-engine)
  (GPL-3.0). The scene/rendering core (`src/initScene.ts`, `src/animator/`, `src/config.type.ts`)
  is preserved from upstream; the interactive layer is new.
- License: **GPL-3.0** (see `LICENSE.txt`). Spine runtime is under the **Spine Runtimes
  License Agreement** (see `LICENSE.spine.txt`). Attribution lives in `NOTICE.md`.
- This repo ships **no game assets, audio, or text**. `public/assets/*` is gitignored;
  only docs and `config.example.json` are tracked.

## Repository layout

```
src/
  index.ts          Assembly + main loop
  initScene.ts      * Scene, camera, aspect-ratio / DPI fitting (SINGLE SOURCE OF TRUTH for framing)
  audioMaster.ts    * Unified pause/resume control point for BGM + voice
  bgmPlayer.ts      BGM player (registers with audioMaster)
  voicePlayer.ts    Voice-line player (resumes from paused position; registers with audioMaster)
  voiceBubble.ts    Subtitle bubble (follows a character anchor)
  dialogue.ts       Voice scheduling
  touch.ts          Hit zones + action gating (mutual exclusion / interrupt rules)
  touchZoneOverlay.ts  Visual overlay for hit zones
  pointerTrail.ts   Cursor trail (deliberately separate from scene particles)
  settingsPanel.ts  Built-in settings panel (5 tabs)
  settingsStore.ts  Settings read/write + overrides
  uiScale.ts        Panel scaling
  archive.ts        Archive panel
  disclaimer.ts     Disclaimer dialog
  wePauseSignal.ts  * Single installation point for WE `setPaused`
  idleSequence.ts   Ambient action sequence
  probe.ts / probeHud.ts  Debug probe + HUD (__WB_DIALOGUE__ / __WB_FX__ snapshot APIs)
  animator/         texture / spine / video / particle layer animators
  config.type.ts    Config TypeScript types
packages/
  threejs-spine-3.8-runtime-es6/   Git SUBMODULE — required for build
public/assets/     Assets + config.json (gitignored except README*.md + config.example.json)
dist/              Build output (gitignored)
_regress/          Regression scripts (run with ts-node)
```

## Setup & build — read this before running anything

```bash
git clone --recurse-submodules https://github.com/awei808/spine-particle-wallpaper.git
cd spine-particle-wallpaper
npm ci
npm start          # webpack dev server (opens browser)
npm run build      # emits dist/bundle.js
```

**CRITICAL:** `packages/threejs-spine-3.8-runtime-es6` is a **git submodule**. A plain
`git clone` without `--recurse-submodules` (or `git submodule update --init` afterwards)
leaves it empty and the build **fails**. Always verify the submodule is present before building.

Notes:

- `dist/` and `public/assets/*` are gitignored by design. `dist/bundle.js` is a build artifact.
- `npm run format` runs Prettier over the tree; `ts-loader` + webpack handle TS compilation.

## Config-driven changes (NO rebuild needed)

Voice lines, greeting/chat/touch behaviour, and several runtime switches are driven entirely
by the `subtitle` block of `public/assets/config.json`. Editing it does **not** require a
rebuild — copy `config.example.json` to `config.json`, edit, reload.

```jsonc
"subtitle": {
  "greet": [64001, 64002, 64003],   // startup / resume / focus-gain greetings
  "chat":  [64004],                 // idle chatter — fires after standbyIdleMs, only if 'chat' is enabled below
  "touch": [64005, 64006, 64007],   // any hit-zone click
  "greetMode": "time",              // "time" (by clock) | "random"
  "touchFeedbackMode": "immediate", // legacy | immediate | queue | none
  "standbyKinds": ["chat"],         // what may fire after a long idle: chat | greet | touch
  "touchKinds": ["touch"],          // what a hit-zone click may fire: chat | greet | touch
  "resumeKinds": ["greet"]          // what the four auto signals may fire (startup/visible/focus/resume)
}
```

The three `*Kinds` fields are **structurally identical multi-selects**, one per trigger channel,
with **deliberately different defaults** so that upgrading changes nothing:

| Field          | Channel     | Trigger                                                     | Default     |
| -------------- | ----------- | ----------------------------------------------------------- | ----------- |
| `resumeKinds`  | `'resume'`  | startup delay / page visible / focus gain / WE pause-resume | `["greet"]` |
| `touchKinds`   | `'touch'`   | any hit-zone click (user action)                            | `["touch"]` |
| `standbyKinds` | `'standby'` | idle longer than `standbyIdleMs`                            | `["chat"]`  |

`*Kinds` is **required reading** for event scheduling. Each kind draws from **its own pool**
(`chat` → the `chat` array, `greet` → the `greet` pool, `touch` → the `touch` array). When more
than one kind is enabled the pools are **merged into one pool** and picked uniformly
(`dialogue.mergeKindPools`), so classes are weighted by entry count. An empty array disables that
entry point. Sole exception: a channel with **only `greet` enabled** goes through
`pickGreetingEntry` so that `greetMode` (by clock / random) keeps working.

The old boolean `greetInTouchPool` was **removed**; "clicks may also trigger greetings" is now
`touchKinds: ["touch", "greet"]`. The legacy booleans `standbyGreetEnabled` /
`standbyTouchEnabled` are still read but only affect the `standby` channel.

Every entry is an `actionId` from `subtitle.dialogues`. To add a candidate, append a number
to the relevant array — no code change required.

Other config knobs (meshes, layers, `minAspect` / `maxAspect`, `dpr: "auto"`, panel
`fitAspect`) are described in `public/assets/README.md`.

## Architecture invariants (respect these — breaking them causes silent regressions)

1. **Audio master is the ONLY pause control point.** `src/audioMaster.ts` owns pause/resume
   for both BGM and voice. Do NOT add new `subscribePause` / visibility listeners in
   `bgmPlayer.ts` or `voicePlayer.ts` — register with the master instead. Voice must resume
   from where it was paused.
2. **`wePauseSignal.ts` is the ONLY place that assigns WE `setPaused`.** It uses a single
   assignment + reference counting so multiple subscribers can't clobber each other. Add new
   pause subscribers via `subscribePause()`, never by reassigning the handler. The wallpaper
   must create an empty `window.wallpaperPropertyListener` object itself before anything
   subscribes.
3. **`initScene.ts` is the single source of truth for framing/aspect fitting.** Visible width
   at design aspect is locked to the bottom-most (`z` smallest) texture layer; `fov` does NOT
   change it. To reframe, **move the mesh's `y`, not the FOV** — changing FOV shifts every
   layer's z-plane compensation at once.
   **The `[minAspect, maxAspect]` gate is bound to `fitAspect` (2026-10-09).** The two baselines
   lock different quantities, so each one's *leak* is on the opposite side and the artwork, not the
   config, decides that side: `'width'` locks visible width to the base layer ⇒ **the lower bound is
   the artwork** (`base.bw/base.bh`, a smaller `minAspect` is ignored); `'height'` locks visible
   height to `2·|base.z|·tan(fov/2)` ⇒ **the upper bound is the artwork**
   (`2 × min(cameraX→union-left, union-right→cameraX)` ÷ that visible height — the union of all
   `texture`/`video` layer x-ranges, taking the **tighter side**, because the window is centred on
   `cameraX` and the union is usually asymmetric; a larger `maxAspect` is ignored). Beyond those bounds the frame letterboxes
   and shows the red `__fitErr` bar — that path is the *only* supported failure mode; never let a
   baseline silently render clear-color black at the edges.
4. **Config and bundle must be updated in pairs.** A `config.json` change that affects framing
   (e.g. `fitAspect`, `minAspect`) only takes effect with a matching bundle reload.
5. **Frame-driven fades freeze on WE pause.** WE web wallpaper stops `requestAnimationFrame`
   on pause, but `Date.now()` keeps advancing. Any opacity/audio fade that is frame-driven
   will freeze mid-transition when paused — drive audio fades with `setTimeout` instead.

## Wallpaper Engine web-wallpaper constraints (easy to forget)

- **No keyboard input, no wheel forwarding** from WE to the page.
- **Native form controls crash on the first frame** in WE's CEF — the settings panel is
  self-drawn (canvas/DOM), not `<input>`/`<select>` where avoidable.
- **Large `backdrop-filter` areas cause high crash rates** — keep blur to small surfaces only.
- Resolution is determined solely by the CEF viewport × `config.dpr`; it is NOT tied to any
  fixed canvas size in code.

## Code conventions

- TypeScript throughout; strict-ish config in `tsconfig.json`.
- Run `npm run format` (Prettier) before committing.
- Do **not** hardcode absolute local paths in scripts — accept `argv[N]`, `env.WK_*`, or
  relative defaults so the tooling is portable.

## Regression

`_regress/*.ts` are ts-node scripts for headless Chrome + CDP runs. They rely on the probe
snapshot APIs (`__WB_DIALOGUE__`, `__WB_FX__`) exposed by `src/probe.ts`. Output logs match
`_regress/_out_*.txt` (gitignored). Use these to verify idle/greet/touch scheduling and
audio-master edge cases after changes.

## Licensing red lines (do not violate)

- Never commit game assets, audio, or text into `public/assets/` (it is gitignored anyway).
- Preserve `NOTICE.md` and the GPL-3.0 + Spine runtime license headers.
- When adding a new Spine/physics/audio dependency, confirm its license is compatible with
  GPL-3.0 distribution.

## Commit & push conventions

- Keep commits focused; follow the existing conventional-commit style already in the history.
- Preserve upstream attribution in `NOTICE.md` when modifying derived core files.
- `main` is the default branch; push to `origin` (`awei808/spine-particle-wallpaper`).
