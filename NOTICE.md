# NOTICE

**spine-wallpaper-kit**
Copyright (C) 2026 awei808

This project is licensed under the GNU General Public License v3.0 — see [LICENSE.txt](./LICENSE.txt).

---

## Derivative work

This repository is a derivative of:

> **spine-wallpaper-engine**
> <https://github.com/spicy-wolf/spine-wallpaper-engine>
> Copyright (C) 2024 Spicy Wolf
> Licensed under the GNU General Public License v3.0

The original project is a Spine animation player for Wallpaper Engine.
Its scene/rendering core (`src/initScene.ts`, `src/animator/`, `src/config.type.ts`) remains the
foundation of this project and is preserved under the same GPL-3.0 license.

## Modifications

Substantial changes have been made since 2026-09. Additions include, but are not limited to:

- `src/audioMaster.ts` — unified audio master handling pause/resume for both BGM and voice
- `src/bgmPlayer.ts`, `src/voicePlayer.ts`, `src/voiceBubble.ts`, `src/dialogue.ts` — BGM, voice lines, subtitle bubbles
- `src/touch.ts`, `src/touchZoneOverlay.ts` — hit zones and action gating
- `src/pointerTrail.ts`, `src/animator/ParticleAnimator.ts` — particle effects and cursor trail
- `src/settingsPanel.ts`, `src/settingsStore.ts`, `src/uiScale.ts` — runtime settings panel
- `src/archive.ts`, `src/disclaimer.ts` — archive panel and disclaimer dialog
- `src/wePauseSignal.ts` — single installation point for the Wallpaper Engine `setPaused` signal
- `src/idleSequence.ts` — ambient action sequence
- `src/probe.ts`, `src/probeHud.ts` — debug probe and HUD
- `_regress/` — regression scripts

## Third-party components

- **three.js** — MIT License. <https://github.com/mrdoob/three.js>
- **threejs-spine-3.8-runtime-es6** (git submodule, <https://github.com/spicy-wolf/threejs-spine-3.8-runtime-es6>)
  — subject to the Spine Runtimes License Agreement, see [LICENSE.spine.txt](./LICENSE.spine.txt).
  Using or distributing the Spine Runtimes requires a valid [Spine license](https://esotericsoftware.com/spine-purchase).

## Assets

This repository intentionally ships **no** game assets, audio, or text.
`public/assets/*` is gitignored; only documentation and `config.example.json` are tracked.
Users must supply their own assets and are responsible for holding the rights to them.
