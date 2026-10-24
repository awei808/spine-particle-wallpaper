# spine-particle-wallpaper

**Spine skeletons + Unity-style particle FX, turned into interactive wallpapers for Wallpaper Engine.**

Bring a Spine character from a Unity mobile game to the desktop with its feel intact: multiple touch action sets, voice lines with subtitle bubbles, BGM, pointer trails, adaptive framing, and a built-in settings panel.

[中文](./README.zh.md)

> Derived from [spicy-wolf/spine-wallpaper-engine](https://github.com/spicy-wolf/spine-wallpaper-engine) (GPL-3.0) and extended from a Spine animation player into an interactive character wallpaper framework. See [NOTICE.md](./NOTICE.md) for attribution and licensing.

## Compared with upstream

Upstream plays Spine animations: drop your files into `assets/` and they loop on your desktop. This repository keeps that rendering core and adds a full interaction layer:

| Capability | Upstream | Here |
| --- | --- | --- |
| Layered scenes (background / character / particles / foreground) | Yes | Yes, plus a `particle` layer and explicit z-ordering |
| Touch interaction & action scheduling | — | Hit zones, mutual exclusion and interrupt rules |
| Voice lines + subtitle bubbles | — | Anchored to the character, auto-wrapping, fade in/out |
| BGM | — | Looping playback with volume control |
| Pause / resume | — | Unified audio master (WE `setPaused` + page visibility) |
| Pointer trail | — | Emitted along cursor movement |
| Built-in settings panel | — | 6 tabs (the last one, "wallpaper-specific", is config-gated), edit at runtime and persist |
| Archive panel / disclaimer | — | Archive lists the events, trigger conditions, animations, particle FX, lines and voice of the effective config |
| Debug probe | — | Dedicated entry plus HUD and CDP snapshot API |

## Features

- **Layered scenes** — `texture` / `spine` / `particle` / `video` layers ordered by `position.z`, with full-screen fitting (`fitAspect`: height- or width-locked) and DPI awareness (`dpr: "auto"`). Black-bar detection is coverage based: each layer is projected to the screen and gaps are measured per side.
- **Touch interaction** — rectangular hit zones plus an action sequence; `touch` / `greet` / `standby` sources follow explicit mutual-exclusion and interrupt rules. Hit zones are fully customizable in `config.json` (`touch.zones`: add/remove/edit, per-zone `enabled`, `priority`); when zones overlap, exactly one wins by `enabled → priority desc → area asc → array index`.
- **Voice & subtitles** — the bubble follows a character anchor, voice plays through a dedicated player; both register with the audio master.
- **Audio master** (`src/audioMaster.ts`) — BGM and voice register with a single master that owns pause/resume for both. Voice resumes from where it was paused.
- **Particles & trails** — `ParticleAnimator` handles scene particles, `PointerTrail` handles the cursor trail; the two are independent implementations.
- **Settings panel** — edit options at runtime and persist them to WE properties.
- **Debug probe** — `__WB_DIALOGUE__` / `__WB_FX__` snapshot APIs, designed for headless Chrome + CDP regression runs.

## Event lists and trigger rules

What the character says, and when, is driven by `assets/events.jsonc` (same directory as `config.json`). Each entry carries its own grouping label, conditions, animation, particles, text and voice. Edits take effect when the wallpaper is reloaded in Wallpaper Engine; no rebuild required.

Events live in their own file because it supports `//` and `/* */` comments, trailing commas, offline validation (`npm run validate-events`), and opens with a complete field table plus examples.

```jsonc
{
  "schema": 1,
  "events": [
    {
      "id": "game:64001", "actionId": 64001, "label": "Sunny morning greeting",
      "on": ["resume"], "kind": "greet",
      "when": { "time": { "start": 5, "end": 12 } },   // 05:00–12:00 (start > end wraps midnight)
      "animation": "greet",
      "text": "Good morning.", "textTime": 6,
      "voice": "CV/character/Morning_01.ogg"
    }
  ]
}
```

| Field | Description |
| --- | --- |
| `on` | Grouping label: `touch` (hit-zone click) / `standby` (idle) / `resume` (load, back to desktop, back to foreground). Accepts an array. Whether an entry can be played by a given entry point is decided by the kinds checked in the panel; use `when.ctx.signal` / `when.ctx.zone` to pin the timing. `on: []` means never played |
| `kind` | Class: `touch` / `chat` / `greet`. Inferred from `on[0]` when omitted |
| `when` | Conditions: `time{start,end}`, `calendar{month,day}`, `dates["MM-DD" / "YYYY-MM-DD", …]` (used for lunar festivals), `ctx{idleMs,zone,signal}`; combinable with `all` / `any` / `not` |
| `animation` | Spine animation name; omit for a text-only event |
| `particles` | Particle group dedicated to this entry (`config.meshes[].name`); falls back to the animation name when omitted |
| `variants` | Whole-package randomisation: animation, text and voice come from the same package |
| `pick` | `priority` (tier compared first), `weight` (weighted within a tier; `0` = manual trigger only), `group` (mutual exclusion), `cooldownMs`, `quota`, `interrupt` |
| `enabled` | `false` = off by default for the author (users can still switch it on in the panel) |

Adding an event means adding an object to the `events` array; deleting means removing that object. The per-user "event switches" in the panel are local (written to `localStorage`); `events.jsonc` stays author-maintained.

### Two levels of "restore defaults"

| Button | Location | Scope | Takes effect |
| --- | --- | --- | --- |
| **Restore this page** | Top-right of the "event switches" page | Switches on that page, falling back to each entry's `enabled` default in `events.jsonc` | After "save & apply" plus reload |
| **Restore defaults** (footer) | Panel footer, on every page | All settings overrides + local event switches | Immediately, with reload |

- "Changed N" in the summary row counts entries that differ from the file defaults; toggling a switch back to its original position is not counted.
- The footer button works on the settings layer. `wb.swe.eventlog.v1` (cooldown / quota / mutex play history) records what has already happened; clearing it makes `quota.ever` events playable again, so it is a separate operation.

Note: if every event in the kinds checked for an entry point has `weight: 0`, that entry point never auto-triggers (a warning is logged at startup). `pick.priority` is a global tier, so high-priority events can take over from every entry point; to keep entry points independent, put them in the same tier (default 0) or split them with `when`.

### Voice formats: `ogg` / `mp3` / `wav` / `m4a` in one directory

`subtitle.dialogues[].voice` holds a file name only; the extension is resolved at playback. The player first tries the name as written (`X.ogg` tries `X.ogg`), then swaps the extension of the stem along `subtitle.audio.extOrder`, trying each candidate once. Converting an unpacked voice set from ogg to mp3 needs no config change.

```json
"audio": { "enabled": true, "volume": 1.0, "path": "./assets/voice/",
           "extOrder": ["ogg", "mp3", "wav", "m4a"] }
```

| Case | Behaviour |
| --- | --- |
| `voice` has an extension | Try it first; on failure, retry the stem along `extOrder` |
| `voice` has no extension | Build candidates from `extOrder` in order (`X.ogg` → `X.mp3` → …) |
| Format clearly unsupported | Candidates rejected by `canPlayType` are skipped; if all are rejected, the original order is probed anyway |
| No candidate found | Silent playback with subtitles intact; one console warning per file |
| `extOrder: []` | Only the extension written in `voice` is tried |
| A stem last succeeded as mp3 | That stem tries mp3 first next time |

Autoplay blocked (`NotAllowedError`) is a browser policy: click once on a hit zone. `m4a` sits last because WE's CEF has unstable AAC support and would otherwise hit an undecodable candidate first.

Check the voice directory against the config offline (per-format counts, multi-format clashes on the same stem, references missing from disk):

```bash
npm run voice-manifest                            # report only
npm run voice-manifest -- --write                  # also emit voice/manifest.json
npx ts-node --transpile-only scripts/voiceManifest.ts <voice dir> <config path>
```

### Two panel pages: triggers and pools

The settings panel splits triggering into two pages (`id` values are historical; changing them breaks existing anchors and validation scripts):

| Page | `id` | Covers | Settings |
| --- | --- | --- | --- |
| **Triggers** | `sequence` | When and where it fires — trigger conditions and rules | Ambient action sequence and interval, idle duration, full-screen hit zones, click during an action, greeting mode |
| **Pools** | `touch` | What can be drawn after a trigger, and which animation set plays | Kind multi-selects for the first three entry points (identical, adjacent) + the last two rows: event families and animation-family display |

Row order: the three entry points are listed first (idle / touch / return), followed by the two filters (event families → animation-family display). The three identical rows stay adjacent, and the filters sit after the entry points.

Two behaviour switches live on the Triggers page:

- `touchFeedbackMode` — a click while an action is already playing: **`legacy`** (default; greets and chatter play immediately, clicks during a touch action are ignored) / **`immediate`** (always play the new one now) / **`queue`** (after the current one finishes) / **`none`** (no feedback).
- `greetMode` — how a greeting is chosen: **`time`** (default, by system clock) / **`random`**.

### Pools page: three "events triggerable by …" multi-selects (`*Kinds`)

Three structurally identical multi-selects, each deciding which kinds one entry point can play (options are `"chat"` / `"greet"` / `"touch"`):

| Setting | Field | Fires when | Default |
| --- | --- | --- | --- |
| Events triggerable after idle | `standbyKinds` | Idle longer than the duration set on the Triggers page | `["chat"]` |
| Events triggerable by touch | `touchKinds` | Any hit zone is clicked | `["touch"]` |
| Events triggerable on return | `resumeKinds` | Load / back to desktop / back to foreground / WE resume | `["greet"]` |

Each default covers its own entry point, so an existing config keeps its triggering behaviour unchanged. With more than one kind checked, the kinds' pools are merged into one pool and drawn uniformly (every entry equally likely, so classes are weighted by entry count); an empty array disables that entry point. Sole exception: an entry point with only `greet` checked still uses `greetMode` (clock or random), which keeps time-of-day greetings working.

### Pools page: two orthogonal filters — event families (`eventFamilies` + `phases`) and animation family (`actionPhase`)

The last two rows of the Pools page are two independent mechanisms:

| Panel item | Field | Covers | Scope |
| --- | --- | --- | --- |
| **Event families** | `subtitle.phases` | Which lines can be drawn (family-level permission) | Global: nothing checked ⇒ no event triggers |
| **Animation family** | `subtitle.actionPhase` | Which animation names play (`greet` vs `greet_alt`) | Global: ambient / greet / idle / touch / ambient sequence |

Event families apply to every entry point: checking one family removes the other families' events from greetings, idle, touch and every other channel at once; checking nothing blocks everything, and the archive lists no event rows.

#### Two families: animation family and event family

When the same action set uses different animation names in different forms (e.g. `greet` ↔ `greet_alt`), two orthogonal mechanisms handle it:

- **Animation family** (`actionPhase`) handles name substitution and whether entries from another family may enter a pool;
- **Event family** (`phases`, a global gate) decides which families may trigger; all four entry points share the same gate.

A form without a suffix belongs to the fallback family.

```jsonc
// Two families; a project with a single form can omit the whole block (see the defaults below)
"eventFamilies": [
  { "id": "alt", "label": "Variant events", "actionLabel": "Variant",
    "default": true, "matchSuffix": "_alt" },
  { "id": "normal", "label": "Normal events", "default": true, "fallback": true }
],
"phases": ["alt", "normal"],   // event families (global gate; [] = all off)
"actionPhase": "alt",          // "animation family" = variant (default)
"actionPhaseBaseLabel": "Base" // display name of the no-substitution tier
```

| Registry field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Family id referenced by an entry's `phase`; free-form string |
| `label` | | Human-readable name in the panel and archive; defaults to `id` |
| `actionLabel` | | Short name in the animation-family radio (e.g. "Variant"); defaults to `label` |
| `default` | | Checked by default in the panel (several allowed; with none marked, only the fallback family is checked) |
| `fallback` | | The fallback family (one only): entries without a family land here, and it is the family that applies no substitution |
| `matchSuffix` | | Animation-variant suffix: ① decides the family when an entry omits `phase`; ② when `actionPhase` points here, names become `name + suffix`. Declaring it also lists the family in the animation-family radio |
| `keyPrefix` | | Family membership by event-key prefix: `"custom:"` puts every `custom:*` entry here without a per-entry `phase` |

Family resolution (`dialogue.resolveDialoguePhase`) has four steps: ① an explicit `phase` present in the registry wins; ② otherwise each family's `keyPrefix` is matched against the event key (first declaration wins); ③ otherwise each family's `matchSuffix` is matched against the animation name; ④ otherwise the fallback family.

Prefixes rank before animation suffixes: an event key states provenance (`custom:` = user-created, `game:` = from the game table), which is more dependable than "animation name ends with `_alt`". Custom events that belong to an animation family declare an explicit `phase`.

#### Festival and custom families

```jsonc
"eventFamilies": [
  { "id": "normal",   "label": "Normal events",   "fallback": true, "default": true },
  { "id": "festival", "label": "Festival events", "default": true },
  { "id": "custom",   "label": "Custom events",   "default": true, "keyPrefix": "custom:" }
]
```

- **Festivals**: Valentine's Day / New Year / Spring Festival entries carry `"phase": "festival"`. Lunar festival dates drift on the Gregorian calendar, so list them in `when.dates`: `{"dates": ["2026-02-17", "2027-02-06", "2028-01-26"]}`, appending one line per year. The engine compares dates exactly; the lunar calendar is maintained on the content side, since a one-day error means the wrong festival day.
- **Custom**: all `custom:*` entries are claimed by `keyPrefix` without a per-entry `phase`, so the panel can switch off user-created events as one family while built-in events stay active.
- All three families marked `default` ⇒ the panel checks them all, matching the behaviour of a config without families.
- Storage sync: the panel writes `phases` to `localStorage`. After adding families, check them under Pools → event families (or press "restore defaults" in the footer, which clears that entry too). Unchecked families are labelled in the archive as "family 'custom' unchecked ⇒ currently unreachable".

**Name substitution** (`dialogue.resolveEntryAnimation`, three branches, explicit first): ① `DialogueEntry.phaseAnimations[actionPhase]` wins (covers irregular names such as `chat` → `chat_alt`); ② a name already ending in the family suffix is used as is; ③ otherwise `name + suffix`. Substitution touches the animation name only; `actionId` / `text` / `voice` keep their authored values.

| `subtitle.eventFamilies` | Result |
| --- | --- |
| Absent / not an array / no valid entry | Built-in default: a single `normal` family, so a single-form project shows neither the family row nor the animation-family row |
| Empty array `[]` | The family mechanism is disabled for this wallpaper: neither row is built, no family filtering, no substitution |
| Valid array | Normalised (invalid entries dropped, de-duplicated by `id`, declaration order preserved) |

| Setting | Field | Default | Notes |
| --- | --- | --- | --- |
| Full-screen hit zones | `touch.fullscreen` | `false` | On the Triggers page: when on, `touch.zones` is ignored and the whole canvas is one hit zone |
| Event families | `subtitle.phases` | The registry's default checks | On the Pools page (second-to-last row); global: family filter first, then random by kind; `[]` = all off |
| Animation family | `subtitle.actionPhase` | The first family with `matchSuffix` | On the Pools page (last row, single choice); `""` = no substitution |

`phases` defaults to the families marked `default` (or the fallback family when none is marked); an empty array turns everything off (all pools empty). An empty registry or a project without animation families means the corresponding row is not built. The three automatic channels (idle / return / ambient sequence) and touch share the same pools and the same family gate, so checking one family removes the others from all four channels at once. Pool membership is decided by `dialogue.isEntryVisibleInPhase`: under the current animation family, entries of other families stay out of the pool.

> Compatibility fields: `greeting` (slot → actionId map), `standby` (single actionId) and the booleans `standbyGreetEnabled` / `standbyTouchEnabled` are still read (the booleans apply to the idle channel), so existing configs keep working. New configs use the three arrays above plus the three `*Kinds`. An empty `greet` / `chat` array counts as unset and falls back to the legacy field, so a class of events stays active. `greetInTouchPool` is expressed by checking `greet` under "events triggerable by touch".

### "Wallpaper-specific settings" page

The last tab of the panel collects settings that matter to a single wallpaper (shared tabs keep shared options). The wallpaper declares them in its own `config.json`:

```jsonc
"wallpaperSettings": {
  "label": "This wallpaper",   // group title inside the page
  "items": ["<itemId>"]         // panel-implemented item ids, array order = row order
}
```

| Field | Meaning |
| --- | --- |
| `wallpaperSettings.label` | Group title inside the page; default `"本壁纸"` ("this wallpaper") |
| `wallpaperSettings.items` | Settings declared by this wallpaper (array order = row order) |

`items` takes ids the panel already renders (see `KNOWN_WALLPAPER_ITEMS` in `src/settingsPanel.ts`); unknown ids and duplicates are dropped silently, and a new item needs a matching render branch in the panel. With no declaration, an empty `items` array, or only invalid ids, the panel does not build this page (nor its tab button), so no page is left empty or inert.

`wallpaperSettings` declares what to show; each value stays in the field it belongs to, and override field names and the stored format stay the same. The "Framing" tab keeps the two shared settings: framing reference and mouse particle trail.

## Quick start

### Building a wallpaper (no build step, no Node.js)

Download the **engine pack** (~300 KB, engine only, no assets) from [Releases](https://github.com/awei808/spine-particle-wallpaper/releases):

1. Unzip, drop your Spine trio (`*.skel` / `*.atlas` / `*.png`) into `assets/`
2. Copy `assets/config.example.json` to `config.json` and edit it for your assets
3. Put the whole folder into `<WE>/projects/myprojects/` and apply it in Wallpaper Engine

See `使用说明.md` inside the pack. Swapping assets, editing config and writing dialogue all take effect at runtime: `config.json` and `events.jsonc` are read from `assets/`, and `bundle.js` is a generic engine — repackaging is needed only for engine changes.

### Building from source

```bash
git clone --recurse-submodules https://github.com/awei808/spine-particle-wallpaper.git
cd spine-particle-wallpaper
npm ci
```

`--recurse-submodules` is required: `packages/threejs-spine-3.8-runtime-es6` is a submodule and the build fails without it.

To produce the engine pack: `npm run pack` (builds, strips local assets, emits the zip — see `scripts/packEngine.ts`).

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
  audioMaster.ts           Audio master: pause control point for BGM + voice
  bgmPlayer.ts             BGM player
  voicePlayer.ts           Voice line player (ogg/mp3/wav/m4a fallback)
  voiceBubble.ts           Subtitle bubble
  dialogue.ts              Voice scheduling
  touch.ts                 Hit zones and action gating
  touchZones.ts            Hit-zone data layer: normalize / validate / hit-test / overlap resolve
  pointerTrail.ts          Pointer trail
  settingsPanel.ts         Built-in settings panel
  settingsStore.ts         Settings read/write and overrides
  archive.ts               Archive panel
  disclaimer.ts            Disclaimer dialog
  wePauseSignal.ts         Installation point for WE setPaused
  idleSequence.ts          Ambient action sequence
  probe.ts / probeHud.ts   Debug probe
  animator/                texture / spine / video / particle layers
_regress/                  Regression scripts (ts-node)
scripts/voiceManifest.ts   Voice manifest and reference check (npm run voice-manifest)
public/assets/             Assets and config.json (assets are gitignored)
```

## Known issues

- The pointer trail derives emission spacing from cursor speed, so fast strokes distribute unevenly. Counting logic is correct; distribution logic is pending rework.

## Licensing

- This repository: **GPL-3.0**, see [LICENSE.txt](./LICENSE.txt).
- Spine Runtimes: **Spine Runtimes License Agreement**, see [LICENSE.spine.txt](./LICENSE.spine.txt).
- Derived from spicy-wolf/spine-wallpaper-engine (GPL-3.0), see [NOTICE.md](./NOTICE.md).

### Spine Runtimes licensing (read before using)

The Spine Runtimes ship under a separate commercial licence. Per the licence text:

1. **Each user must obtain their own Spine Editor licence**;
2. **Redistribution in any form must include that licence and the copyright notice.**

In practice: this framework is free and open source, while **anyone playing Spine animations with it needs a valid Spine licence of their own**. Full text: <https://esotericsoftware.com/spine-runtimes-license>

The same notice ships inside the wallpaper — tick "显示免责声明与许可证要求" (Show disclaimer & licence notice) in the wallpaper properties to display it to end users.

## Disclaimer

- **For personal study and technical exchange only.** Non-commercial use.
- **Spine licensing is the user's own judgement and responsibility** — whether you need a Spine Editor licence and how to obtain one is your call.
- Sample assets shipped in this repository (third-party game art, Spine skeletons, voice lines and music) remain the property of their original owners and serve as a technical example only. **Do not extract or redistribute those assets on their own**, and do not present this work as official content. `public/assets/*` itself contains no assets.
- Use at your own risk. Any dispute or liability arising from asset rights, licence eligibility or any use of this software rests **solely with the user**; **the original author accepts no responsibility**.
