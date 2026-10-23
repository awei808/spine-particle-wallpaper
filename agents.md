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
  dialogue.ts       Voice scheduling: family registry, action-phase projection, legacy pools
  eventModel.ts     * Event identity (EventKey) + normalizeEventTable (THE single normalizer:
                    legacy greet/chat/touch pools are inferred into per-entry on/kind/when)
                    + variant picking (whole-package random).
                    `on` is a GROUPING label only since 2026-10-21 — it no longer limits
                    which channel can reach an entry (`on: []` still means unreachable)
  eventsFile.ts     * Reads `assets/events.jsonc` (JSONC: //, /* */, trailing commas, BOM).
                    THE ONLY event source since 2026-10-19 — no fallback to config.
                    Comment stripping is offset-preserving so parse errors report the real
                    file's line:column
  eventOverrides.ts * Per-user event SWITCHES (localStorage `wb.events.state.v1`:
                    `{enabled: {key: boolean}}`). `applyEventState` is the only merge point and
                    must run BEFORE normalize. It NEVER creates/edits/deletes an event
  conditions.ts     * Condition AST: compile / inspect / describe (pure, injectable clock)
  eventScheduler.ts * selectEvent (priority tier + weighted random) + eventLog state
                    (cooldown / quota / mutex group; quota.day|ever persisted in localStorage).
                    The funnel's only per-entry permission test is `enabled` + `on` non-empty
                    + `kind` being one of the user-checked kinds — `on` is NOT a channel gate
  eventValidate.ts  * 16-code validation, 3 dispositions (reject / coerce / report);
                    wiring point is the funnel in index.ts, NOT the consumers
  touch.ts          Hit zones + action gating (mutual exclusion / interrupt rules);
                    takes a `pick(zoneId)` callback — it does NOT select entries itself
  touchZones.ts     * THE hit-zone data layer: normalize / validate / hit-test / overlap
                    arbitration. A zone may be authored either as `design:{x,y,w,h}`
                    (design-canvas pixels, denominator = `config.width × config.height`,
                    top-left origin) or as `u0..v1` **plus `fit`/`aspect`** (fractions of the
                    aligned frame: `fit:'width'` default ⇒  visible w = design w,  visible
                    h = design w / A; `aspect` = the viewport aspect you measured on, default
                    = design aspect). BOTH are turned into design-canvas pixels and projected
                    at assembly, then re-projected on resize via `normalizeZones(raw, fit)`
                    — so zones follow the framing instead of being glued to the screen
                    (that glue was the 2026-10-22 bug: switching 按宽/按高 moved the character
                    but not the zones). `u/v` → design px is `fitRectToDesign`, the inverse is
                    `designRectToFit`, and the 高⇄宽 conversion is `convertFitRect`
                    (a single uniform scale `k = (Wd/Hd)/A` about `(0.5,1)`).
                    **Calling `normalizeZones` without a `fit` drops every `design` zone**
                    with `E_ZONE_GEOM` (and passes `u/v` through raw) — that is exactly how
                    `_regress/77`'s C4 once kept passing while silently testing a single zone;
                    `_regress/102` pins the conversion math. Why it matters: with
                    `fitAspect:'width'` the visible WIDTH is constant but the visible HEIGHT
                    follows the aspect, so a hand measured at v=0.128 (1700×750) sits at
                    v≈0.316 on 1920×1080. **Never convert measured pixels to `u/v`** — write
                    `design` pixels, or write `u/v` AND record the `fit`/`aspect` you measured on.
  touchZoneOverlay.ts  Visual overlay for hit zones
  pointerTrail.ts   Cursor trail (deliberately separate from scene particles)
  settingsPanel.ts  Built-in settings panel (6 tabs — the last one, "壁纸独立设置", is
                    config-gated: only built when config.wallpaperSettings declares items)
                    + the separate debug panel (with trigger chips for every animation /
                    dialogue entry). Both are opened from the TOP-RIGHT ENTRY COLUMN this
                    module also owns: a collapse/expand toggle plus five round buttons in
                    the SAME ORDER as the WE property list — settings (gear), mute,
                    debug (bug), disclaimer (shield), archive (book). Each button is an
                    inline SVG (CEF has no reliable icon font) and highlights while its
                    panel is open; the mute one only swaps volume, it does NOT write config.
                    The WHOLE column has exactly ONE visibility switch, the WE property
                    `showCornerButtons` ("显示右上角按钮", the first item in the property
                    panel). There is deliberately no per-button `showSettings` any more —
                    it was removed on 2026-10-17 as a redundant second switch over the same
                    column; stale keys are silently ignored.
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
scripts/           Offline CLIs (voiceManifest.ts, validateEvents.ts, migrateEvents.ts,
                    deployWe.ts — copies dist/ into a Wallpaper Engine project dir; it does
                    NOT write project.json when one already exists, and `--audio-check`
                    repoints that project's `file` to audio-check.html so the self-test runs
                    inside WE's own CEF instead of a normal browser)
_regress/          Regression scripts (run with ts-node); 83~90 = custom-event system
public/audio-check.html  Audio-format self-test page (canPlayType + real decode +
                    a MediaRecorder-generated AAC/MP4 round-trip) — used to answer
                    "can WE's CEF decode m4a" without needing an m4a sample
```

## Setup & build — read this before running anything

> **Deploying to Wallpaper Engine?** The authoritative procedure for the three shipped
> skins (S8 / S6 / S9) — source→target paths, the `21_` full-sync commands, festival voice
> file locations, and the "new year has no voice line" rule — lives in the **wallpaper
> project tree** (outside this repo; assets are not tracked here):
> `docs/02_部署与发布.md` → 「三个壁纸工程的标准部署」.
> Do not duplicate it here.

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
- **Local dev assets must be a REAL project's `config.json` + `assets/`** (this working copy carries a
  full 22-layer scene with its own `config.json`, voice/BGM and an `index.html`). Do **not** develop or
  review framing against a hand-made one-background sample config: with `fitAspect: 'height'` a single
  background layer runs out of artwork around aspect 1.65 ~ 1.68, so an ordinary maximised browser
  window (~2.0) then reports black bars that are _technically correct_ while looking like a regression.
  Backgrounds differ per scene, so the numbers do not transfer between configs — always measure on the
  assets you actually ship.

## Config-driven changes (NO rebuild needed)

Voice lines, trigger conditions, and several runtime switches are driven entirely by the
`subtitle` block of `public/assets/config.json`. Editing it does **not** require a rebuild —
copy `config.example.json` to `config.json`, edit, reload.

**Since 2026-10-19 `assets/events.jsonc` is the only truth** (see
`PLAN_事件配置文件_2026-10-19.md`). Events — built-in and custom alike — live in that one
JSONC file, so authors get comments, diffs and offline validation; `config.json` keeps only
environment parameters (subtitle styling, hit zones, volumes…). `subtitle.dialogues` is a
**legacy field**: the engine ignores it (and `src/eventsFile.ts` has no fallback), the
migration tool removes it.

**The settings panel no longer authors events.** Its tab is 「事件开关」 and only toggles each
entry on/off (per-machine, `localStorage`). Adding / removing / editing an event = editing the
file. Never add authoring UI back into the panel: WE's CEF has no reliable IME focus, and a
half-capable editor is exactly what produced the "state the engine cannot see" bugs.

```jsonc
// assets/events.jsonc
{ "schema": 1,
  "events": [
    { "id": "game:64001", "actionId": 64001, "animation": "greet",
      "on": ["resume"], "kind": "greet",
      "when": { "time": { "start": 5, "end": 12 } },   // 05:00–12:00 (start>end ⇒ crosses midnight)
      "text": "…", "voice": "CV/…/x.ogg", "textTime": 6 },
    { "id": "game:64004", "actionId": 64004, "animation": "chat",
      "on": ["standby"], "kind": "chat", "text": "…" },
    { "id": "game:64005", "actionId": 64005, "animation": "touch1",
      "on": ["touch"], "kind": "touch", "text": "…" },
    { "id": "custom:valentine", "displayName": "情人节问候", "animation": "greet",
      "on": ["resume"], "kind": "greet", "phase": "festival",
      "when": { "calendar": { "month": 2, "day": 14 } },
      "pick": { "priority": 50, "quota": { "max": 1, "per": "day" } },
      "variants": [ { "text": "…", "voice": "…" } ] },  // whole-package random
    { "id": "custom:spring-festival", "displayName": "春节问候", "animation": "greet",
      "on": ["resume"], "kind": "greet", "phase": "festival",
      "when": { "dates": ["2026-02-17", "2027-02-06"] } }  // lunar: list the dates
  ] }
```

…and `config.json` keeps the **environment / user-switch** half (never per-event data):

```jsonc
"subtitle": {
  "touchFeedbackMode": "immediate", // legacy | immediate | queue | none
  "standbyKinds": ["chat"],         // what may fire after a long idle: chat | greet | touch
  "touchKinds": ["touch"],          // what a hit-zone click may fire: chat | greet | touch
  "resumeKinds": ["greet"],         // what the four auto signals may fire (startup/visible/focus/resume)
  "eventFamilies": [                 // which families exist; add only what the project really uses
    { "id": "normal", "label": "普通事件", "fallback": true, "default": true },
    { "id": "festival", "label": "节日事件", "default": true },
    { "id": "custom", "label": "自定义事件", "default": true, "keyPrefix": "custom:" }
  ]
}
```

Field semantics live in `config.type.ts` (`DialogueEntry`) and
`PLAN_自定义事件系统_2026-10-18.md`; the file format itself is documented **inside**
`public/assets/events.jsonc` (header comment block — keep it there, it is the only doc an
author ever opens).

Tools:
- `scripts/migrateEvents.ts <assetsDir> --to-file [--write]` — move `subtitle.dialogues` into
  `events.jsonc` (with the header) and drop it from config; refuses to overwrite with an empty
  table, so it is safe to re-run.
- `scripts/validateEvents.ts <assetsDir>` — offline check (reads `events.jsonc` first).
- `_regress/91` — parser/JSONC; `_regress/89` — switch state. Both are `ts-node`, no DOM.

The three `*Kinds` fields are **structurally identical multi-selects**, one per trigger channel,
with **deliberately different defaults** so that upgrading changes nothing:

| Field          | Channel     | Trigger                                                     | Default     |
| -------------- | ----------- | ----------------------------------------------------------- | ----------- |
| `resumeKinds`  | `'resume'`  | startup delay / page visible / focus gain / WE pause-resume | `["greet"]` |
| `touchKinds`   | `'touch'`   | any hit-zone click (user action)                            | `["touch"]` |
| `standbyKinds` | `'standby'` | idle longer than `standbyIdleMs`                            | `["chat"]`  |

`*Kinds` is **required reading** for event scheduling. Each kind draws from **its own pool**
(entries whose `kind` matches), and a candidate must also list that channel in `on` — the
only funnel is `index.ts`'s `resolveEvent` → `eventScheduler.resolveEventFrom`
(permission → condition → quota/cooldown → priority tier + weighted random). When more than one
kind is enabled the pools are **merged into one pool** and picked uniformly
(`dialogue.mergeKindPools`), so classes are weighted by entry count. An empty array disables that
entry point.

The old boolean `greetInTouchPool` was **removed**; "clicks may also trigger greetings" is now
`touchKinds: ["touch", "greet"]` **plus** those entries listing `on: ["touch"]`. The legacy
booleans `standbyGreetEnabled` / `standbyTouchEnabled` are still read but only affect the
`standby` channel.

Custom events created from the panel live **outside** config.json: they are an overlay in
`localStorage` (`wb.swe.events.v1`, `{added, disabled}`) merged by `eventOverrides.ts` before
normalization. `disabled` is applied last on purpose (a custom event you switched off must stay
off). The panel page is **zero-keyboard** — animation/particle/condition are point-and-click and
`text`/`voice` are inherited from an existing entry; adding free-text input is v2 (PLAN §7).

**`pick.weight: 0` means "manual only" and it must NOT occupy a priority tier.** `selectEvent`
therefore filters `weight:0` out **before** computing the top tier. Doing it the other way round
("pick the top tier, then drop zero-weight entries") lets one `{priority: 80, weight: 0}` entry
kill the whole channel: the tier contains only that entry, becomes empty after filtering, and the
funnel returns `null` — with **no log at all** (click is detected, pools look full,
`firedCount`/`skippedCount` stay 0). That shipped once (2026-10-18, the `custom:hold-hand`
sample); `_regress/86` A6b/A6c pin it, and `index.ts` warns at startup when an entire channel is
manual-only.

**Event families are a config-declared registry** (`subtitle.eventFamilies`, since 2026-10-15),
and since 2026-10-17 they carry **two orthogonal jobs** — do not merge them again:

| Job                                | Field                                                             | Scope                                                                    |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Which **families** may fire at all | `subtitle.phases` (panel「事件族」)                               | **global** — every channel; `[]` ⇒ every pool empty, nothing can trigger |
| Which **animation set** plays      | `subtitle.actionPhase` (panel「spine 动作族显示」, single-select) | **global**: idle / greet / standby / touch / idle-sequence               |

The two gates are **AND**. `phases` used to be `touchPhases` and used to apply to the touch
channel only (2026-10-17: renamed + widened); the old key is still read **only when `phases` is
absent**, so old configs and localStorage overrides keep working. One pool set serves all
channels (`KIND_POOLS`) — do **not** reintroduce a touch-only pool set, and note that
`pickGreetingEntry` (the single-`greet` path) must be fed `phasedDialogues`, otherwise it
bypasses the gate.

An entry's family = explicit `DialogueEntry.phase` → per-family **`keyPrefix`** on the event key
(`"custom:"` ⇒ every `custom:*` entry lands in that family without writing `phase`; added
2026-10-21) → per-family `matchSuffix` on the animation name → the `fallback` family. The prefix
sits **before** the suffix on purpose: the event key is a provenance statement, the animation
suffix is only a heuristic. A family **with** `matchSuffix` is an _action family_: it is the only
source of the single-select's options (`FamilyRegistry.actionIds`), and that suffix is the rename
rule (`greet` → `greet_marry`). Entries that need a non-suffix name (S8's `chat` →
`chat2_marry`) declare `DialogueEntry.phaseAnimations[<familyId>] = "<name>"`. Because a family
can be resolved without any `phase` field, `validateEvents` takes an optional
`familyOf` callback — judging `W_FAMILY_NOT_ENABLED` by `e.phase` alone silently misses
prefix-resolved entries.

Lunar festivals cannot be expressed as `calendar.month/day` (Spring Festival drifts across
Jan 21 – Feb 20). Use the `when.dates` leaf: `{"dates": ["2026-02-17", "2027-02-06"]}` —
`"MM-DD"` = every year, `"YYYY-MM-DD"` = that year only. The engine ships **no** lunar
conversion table; authors append the next year's date. A malformed `dates` leaf evaluates
**false** (unlike `time`, which fails open) so a typo cannot mean "festival every day".

`actionPhase` defaults to **the first action family** (`""` = explicit "no rename"), and entries
belonging to _another_ action family are excluded from every pool (`isEntryVisibleInPhase`)
⇒ oath wallpapers get 6 touch entries pre-oath (`TouchFeedback`) and 9 post-oath (+`MarryAction`),
matching the game. The per-line rename, the table projection and the visibility test live in
`dialogue.ts` (`resolveEntryAnimation` / `projectDialoguesToActionPhase` /
`isEntryVisibleInPhase`); `archive.ts`, the debug chips and `__WB_DIALOGUE__.trigger` **must**
reuse that projection — a second copy of the rename logic is how "the archive says `greet_marry`
but it plays `greet`" happens.

**`preMarry` no longer exists** (2026-10-17): pre-oath and normal share one candidate pool in the
game, so those entries are plain `normal`. Never reintroduce hardcoded family names — see
`dialogue.ts` (`buildFamilyRegistry` / `resolveDialoguePhase`) and `config.type.ts`
(`EventFamily`, `SubtitleConfig.actionPhase`). **Undeclared ⇒ one built-in family `normal`**
(no action family ⇒ neither panel row is built, nothing is renamed); **`[]` ⇒ no event families
at all**. Two traps: `AnimationState.addAnimation` **throws** on an unknown name, so renames must
be validated against the skeleton (`resolveIdleAnimation` + `touch.ts`'s guard), and `isIdle()`
keys off `idleNames`, so a renamed idle must be passed to `createTouchController` too.

The **archive panel** (`src/archive.ts`) renders the _effective_ config as a table:
event / trigger condition / animation / **particle FX** / line / voice. Two hard rules:

- **Never re-derive anything locally.** Pools come from `dialogue.*` (`resolveTriggerKinds` /
  `buildPool` / `mergeKindPools`), and the FX column comes from `index.ts`'s
  `actionEffectNames` (the flattened form of `actionEffectIndex`, rebuilt in the same place).
  A second copy of either judgement is exactly how the panel starts silently lying about
  behaviour. ⚠️ The touch channel has **two** pool sets (`pools` = fallback family only,
  used by standby/resume; `touchPools` = filtered by `touchPhases`) — quoting the wrong one
  in the notes is a real bug that shipped once (it said "池 3 条" next to 6 table rows).
- **Trigger conditions stay terse and family-free** (2026-10-17). Event-family text is
  deliberately absent from the condition column — a line's family is shown by the `#id`
  badge suffix in the _line_ column instead. The note list under the table is kept to
  ~5 short lines: WE does not forward the wheel, so anything longer just pushes the card
  into overflow.
- **Three paging views** (2026-10-21): 全部 / 按事件族 / 按通道分组, each of the latter two
  with a second row of sub-tabs. Paging **filters rows only** — it never re-derives or
  rewrites a cell; the sole inputs are `Row.grp` (resume / standby / touch / sequence /
  custom / bgm) and `Row.fam` (from `dialogue.resolveDialoguePhase`, the same call that
  builds the badge suffix). `rowCount()` reports the **current view's** row count.

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
   **There is NO aspect gate any more (2026-10-10).** `minAspect` / `maxAspect` are deprecated and
   ignored; the canvas is **always the full viewport** (no clamping, no letterbox). Instead the fit
   computes, per frame, the visible rect and every `texture`/`video` layer's coverage **projected to
   screen NDC** (each layer divided by _its own_ `|z|·tan(fov/2)·aspect` in x and `|z|·tan(fov/2)` in
   y — perspective means a deep layer covers less screen than a near one of the same world size), then
   subtracts per side. Any side short by more than `LEAK_EPS` (0.5 px) raises the red `__fitErr` bar,
   which names the leaking sides in pixels. Never reintroduce an aspect-ratio proxy for this: a
   mismatch between the proxy and reality is _silent_ black at the edges.
4. **Config and bundle must be updated in pairs.** A `config.json` change that affects framing
   (e.g. `fitAspect`, `fov`, `cameraX`, `dpr`) only takes effect with a matching bundle reload.
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
