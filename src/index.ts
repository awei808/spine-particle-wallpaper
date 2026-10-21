/**
 * @license
 * Spine Wallpaper Engine. This is a Spine animation player for wallpaper engine.
 * Copyright (C) 2023 Spicy Wolf
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import * as THREE from 'three';
import * as threejsSpine from 'threejs-spine-3.8-runtime-es6';
import {
  SpineAnimator,
  TextureAnimator,
  VideoAnimator,
  ParticleAnimator,
} from './animator';
import { Configs } from './config.type';
import { ASSET_PATH } from './constants';
import * as Scene from './initScene';
import {
  initProbe,
  registerProbeCanvas,
  registerProbeSkeleton,
  registerProbeTrackSampler,
  registerProbeTouch,
  applyProbeConfig,
  PROBE_OPTS,
} from './probe';
import { createTouchController, TouchController } from './touch';
import { createTouchZoneOverlay, TouchZoneOverlay } from './touchZoneOverlay';
import { normalizeZones, DesignFit, TouchZone } from './touchZones';
import { PointerTrail } from './pointerTrail';
import {
  TouchZoneConfig,
  DialogueEntry,
  EventKeyInput,
  GreetMode,
  TriggerChannel,
  TriggerEventKind,
  TriggerPhase,
  ActionEffectConfig,
  ActionEffectsConfig,
  DEFAULT_CABIN_GROUPS,
} from './config.type';
import {
  buildFamilyRegistry,
  findByEventKey,
  isEntryVisibleInPhase,
  mergeKindPools,
  projectDialoguesToActionPhase,
  resolveActionPhase,
  resolveAnimationName,
  resolveDialoguePhase,
  resolvePhases,
  resolveIdleAnimation,
  resolveTriggerKinds,
} from './dialogue';
import {
  channelsOf,
  eventKeyOf,
  kindOf,
  normalizeEventKey,
  normalizeEventTable,
  resolveEventVariant,
} from './eventModel';
import {
  createEventLog,
  eventWeight as eventWeightOf,
  resolveEventFrom,
} from './eventScheduler';
import {
  applyEventState,
  clearEventState,
  eventDefaultsOf,
  EventState,
  pruneEventState,
  readEventState,
  writeEventState,
} from './eventOverrides';
import { loadEventsFile } from './eventsFile';
import {
  summarizeReport,
  validateEvents,
  ValidationReport,
} from './eventValidate';
import { createVoiceBubble, VoiceBubble } from './voiceBubble';
import { createVoicePlayer, voiceBasename, VoicePlayer } from './voicePlayer';
import { createBgmPlayer, BgmPlayer } from './bgmPlayer';
import { createAudioMaster, AudioMaster } from './audioMaster';
import { subscribePause } from './wePauseSignal';
import { getWeFps, hasWeFps, installWeFpsSignal } from './weFps';
import {
  createIdleSequence,
  IDLE_TRACK,
  IdleSequenceController,
} from './idleSequence';
import { createSettingsPanel, SettingsPanel } from './settingsPanel';
import { createDisclaimer, DisclaimerModal } from './disclaimer';
import { createArchive, ArchivePanel } from './archive';
import {
  applyOverrides,
  installWallpaperPropertyListener,
  overridesFromWeProperties,
  readOverrides,
  readView,
  sameView,
  writeOverrides,
  clearOverrides,
  RESET_OVERRIDES,
} from './settingsStore';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 运行时设置：WE 属性 → localStorage 覆盖层 → 重载生效
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 两个入口共用同一份真值（`settingsStore.ts` 的 localStorage 覆盖层）：
 *   1. WE 属性面板（`project.json` 的 properties）⇒ `applyUserProperties`；
 *   2. 壁纸右上角的设置面板（真正的配置入口，能点选动画名）。
 *
 * 之所以**放在这里、而不是 `main()` 里**：WE 在页面早期就会下发属性，
 * 装晚了那一拨收不到。
 */
let reloadTimer = 0;
/** 延迟重载（WE 滑块拖动会连发多次 ⇒ 去抖，避免拖到一半就刷页面） */
const scheduleReload = (ms: number) => {
  if (reloadTimer) {
    window.clearTimeout(reloadTimer);
  }
  reloadTimer = window.setTimeout(() => {
    window.location.reload();
  }, ms);
};

/**
 * 原始 config 与"当前生效值视图"。
 *
 * 为什么要在模块级留引用：WE 属性可以在 `config.json` **取回来之前**就下发，
 * 而判断"值有没有真的变"必须拿 config 默认值当基准。没基准时只能先攒着，
 * 等 config 到位再补判（见 `main()` 里的 `pendingWePatches` 处理）。
 */
let rawConfigsRef: Configs = null;
let effectiveViewRef: ReturnType<typeof readView> = null;
let pendingWePatches: Array<Record<string, unknown>> = [];

/**
 * WE 属性 `showDisclaimer`（居中「免责声明与许可证要求」弹窗**显不显示**）的最近一次权威值。
 *
 * ## ★为什么单独拎出来，而不是塞进 `SettingsView` / 走重载
 *
 * `showDisclaimer` 不是配置项：它不在 `config.json` 里、`applyOverrides` 不消费它、
 * `readView` 也产不出它。若硬塞进 `SettingsView` 去比 `sameView`，
 * 重载后 `readView(applyOverrides(...))` 又读不到它 ⇒ 每次启动都会被判成
 * "从无到有" ⇒ **白重载一次**（正是 `sameView` 注释里警告过的坑）。
 *
 * 它只是个 UI 门面开关，改的仅是一个 DOM 元素的 `display`，
 * ⇒ **热切换最安全**：不必重建气泡/语音/序列那些开机一次性构造的东西。
 *
 * WE 可能在 `main()` 之前就回调 `applyUserProperties`（见 121 行安装点），
 * 所以这里必须能在面板还没建好时生效 —— 建好后再由下面的 `setVisible` 补一刀。
 */
let weShowDisclaimer: boolean | undefined;

/**
 * WE 属性 `showArchive`（居中「档案」面板**显不显示**）的最近一次权威值。
 *
 * 与 `showDisclaimer` 完全同构（同为 UI 门面开关、同样不进
 * `SettingsView`、同样热切换），理由不再复述。
 */
let weShowArchive: boolean | undefined;

/**
 * WE 属性 `showCornerButtons`（右上角**整列入口**显不显示）的最近一次权威值。
 *
 * 与 `showDisclaimer` / `showArchive` 完全同构（UI 门面开关、不进 `SettingsView`、
 * 热切换），理由不再复述。
 *
 * ★★ 这是入口列**唯一**的显隐开关（2026-10-17 晚）：原先并存的 `showSettings`
 *   （只管齿轮那一个按钮）已随用户拍板撤回而**全链路删除**。
 *   ⇒ 这个键在 WE 属性面板里是**第一项**（`order: 100`，文案「显示右上角按钮」）。
 */
let weShowCornerButtons: boolean | undefined;

/**
 * 右上角设置面板。未到"资源就绪"时为 `null`。
 *
 * ★★ 声明**必须**早于 `applyWePatch`：WE 可能在 `main()` 执行前就下发属性，
 * 那时 `let settingsUI` 若还停在下面（模块后段）会处在 TDZ ⇒
 * `settingsUI?.setCornerVisible()` 抛 `ReferenceError` ⇒ 属性被静默丢弃。
 * （原先只有赋值没有读取，所以这个时序坑一直没暴露。）
 */
let settingsUI: SettingsPanel = null;

/** 居中免责声明弹窗。同上：声明必须早于 `applyWePatch`，未创建时为 `null` */
let disclaimerUI: DisclaimerModal = null;

/** 居中「档案」面板。同上：声明必须早于 `applyWePatch`，未创建时为 `null` */
let archiveUI: ArchivePanel = null;

/**
 * 处理一批 WE 属性。**只在新值真的改变了生效值时才重载**。
 *
 * ★★ 守卫的核心是"比生效值"而不是"比覆盖层" —— WE 每次启动都会重发一遍
 * 当前属性值，若按覆盖层判断，首次启动（localStorage 为空）会被判成"从无到有"
 * ⇒ 每次开壁纸都白重载一次。详见 `settingsStore.sameView` 的注释。
 */
const applyWePatch = (patch: Record<string, unknown>) => {
  if (!rawConfigsRef) {
    return;
  }
  const cur = readOverrides();
  const merged = { ...cur, ...(patch as object) };
  const nextView = readView(
    applyOverrides(rawConfigsRef, merged as ReturnType<typeof readOverrides>)
  );
  const curView =
    effectiveViewRef ?? readView(applyOverrides(rawConfigsRef, cur));

  // 无论变没变都落盘：WE 的属性是权威来源，面板要显示与它一致的值
  writeOverrides(patch as ReturnType<typeof readOverrides>);

  /**
   * ★★ `showDisclaimer` 特例：**热切换，不重载**。
   *
   * 它不进 `SettingsView`，所以 `sameView` 永远判它"没变化" ⇒ 指望不上 `scheduleReload`。
   * 但它改的只是一个 DOM 元素的 `display`，热切毫无副作用，还比 reload 快得多。
   *
   * ★ 四个 UI 门面键（`showDisclaimer` / `showArchive` / `showCornerButtons`）都走这条
   *   同一套路：不进 `SettingsView` ⇒ 判据只能自己写。反之 **`muteAll` / `debugEnabled`
   *   是配置项**（都被开机装配消费：前者让两个音频播放器直接 `null`，后者决定
   *   `initProbe()` 要不要建 HUD/注册表）⇒ 它们进 `SettingsView`，由下面的
   *   `sameView` + `scheduleReload` 走重载。
   *
   * 弹窗尚未创建时先存进 `weShowDisclaimer`，等 `createDisclaimer` 建好时取用。
   * 用户拍板（2026-09-27）：开关打开 ⇒ 弹窗**常驻**显示，关掉才消失。
   */
  if (typeof patch.showDisclaimer === 'boolean') {
    weShowDisclaimer = patch.showDisclaimer;
    disclaimerUI?.setVisible(weShowDisclaimer);
    // ★ 把「免责声明」入口按钮的高亮也同步过去（同 showArchive 那条）
    settingsUI?.setDisclaimerVisible(weShowDisclaimer);
  }

  /**
   * `showArchive` 同理：**热切换，不重载**。
   *
   * 档案面板尚未创建时先存进 `weShowArchive`，等 `createArchive` 建好时取用。
   */
  if (typeof patch.showArchive === 'boolean') {
    weShowArchive = patch.showArchive;
    archiveUI?.setVisible(weShowArchive);
    // ★ 把「档案」入口按钮的高亮也同步过去（面板不持有弹窗状态，只按真值刷）
    settingsUI?.setArchiveVisible(weShowArchive);
  }

  /**
   * `showCornerButtons`（右上角**整列入口**，属性面板第一项「显示右上角按钮」）同理：
   * **热切换，不重载**。
   *
   * ★★ 这是入口列**唯一**的显隐开关（2026-10-17 晚）：原 `showSettings` 已删除
   *   ⇒ 这里**不再**有 `showSettings` 分支（老存档里残留的该键被静默忽略）。
   *
   * 整列尚未创建时先存进 `weShowCornerButtons`，等 `createSettingsPanel` 建好时取用。
   */
  if (typeof patch.showCornerButtons === 'boolean') {
    weShowCornerButtons = patch.showCornerButtons;
    settingsUI?.setCornerVisible(weShowCornerButtons);
  }

  if (sameView(curView, nextView)) {
    return;
  }
  console.info(
    '[settings] WE 属性发生变化 ⇒ 重载生效: %s',
    JSON.stringify(patch)
  );
  scheduleReload(900);
};

installWallpaperPropertyListener((properties) => {
  const patch = overridesFromWeProperties(properties);
  if (Object.keys(patch).length === 0) {
    return;
  }
  if (!rawConfigsRef) {
    // config 还没到 ⇒ 先攒着，等它到位再判（见 main()）
    pendingWePatches.push(patch);
    return;
  }
  applyWePatch(patch);
});

/**
 * 接 WE 的**帧率限制**（`applyGeneralProperties({ fps })`）。
 *
 * ★ 必须和 `installWallpaperPropertyListener` 一样在**模块顶层**安装：
 *   WE 可能在页面很早期就下发通用属性，装晚了这一拨就丢了（之后只有用户
 *   在设置里改帧率时才会再来一次）。
 * ★ 消费点在 `render()`：它每帧读 `hasWeFps()/getWeFps()` ⇒ 用户改完立刻生效，
 *   不需要重载页面。
 */
installWeFpsSignal();

const main = async () => {
  /**
   * ★ 运行时设置：`config.json` 是**只读默认值**，用户在 WE / 右上角面板里改的是
   * localStorage 覆盖层，两者在这里合并成真正生效的 `configs`。
   *
   * 顺序很重要：**先读原始 config，再合并覆盖层**，其余代码一律只看 `configs`，
   * 这样"面板里显示当前生效值"与"实际行为"永远同源。
   */
  const rawConfigs: Configs = await (
    await fetch('./assets/config.json')
  ).json();
  const configs: Configs = applyOverrides(rawConfigs, readOverrides());
  /**
   * ★★ **事件表文件**（`assets/events.jsonc`，2026-10-19）—— 事件的**唯一来源**。
   *
   * config 只管环境参数（字幕样式、热区几何、音量…），事件（内置 + 自定义）
   * 全部在这里。理由与格式见 `src/eventsFile.ts` 文件头。
   *
   * ⚠️ 没有 fallback：文件缺失 / 解析失败 ⇒ 0 条事件 + 控制台报错（含行:列）
   *   + 面板红字。回退到 config 会把"语法写错了"伪装成"事件变少了但还能播"。
   */
  const eventsFile = await loadEventsFile();
  if (!eventsFile.ok) {
    console.error('[events] ' + (eventsFile.error ?? '事件文件不可用'));
  }
  eventsFile.issues.forEach((it) => console.warn('[events] ' + it.detail));
  /**
   * ★ `'width'` 基准下剔除「黑遮幅」（`limitEdge` 标记的层）。
   *
   * 遮幅钉在世界坐标上，职责是盖住「超出设计画幅的部分」—— 这在**按高**下是对的
   * （纵向恒 = 设计高，永不超出；只有超宽屏时左右两条生效）。
   * 但 `'width'` 把可见高放大成 `1700 / A`：窄视口（16:10, A=1.6）下 1062.5 > 750，
   * **纵向超出设计画幅** ⇒ 下遮幅侵入可见区，画面底部出现 **104px 大黑带**
   * （1920×1200 实测；摘掉该层后 → 0）。
   *
   * 用户诉求是「按宽 = 完整看设计画幅」⇒ 直接剔除这些层。
   * 放在这里（`Scene.initScene` 之前）是为了让它们连**露黑检测**也不参与 ——
   * 否则遮幅会以"自己盖黑了自己"的方式把 `detectLeak` 骗过去，报"未露黑"。
   *
   * 详见 `config.type.ts` 的 `limitEdge`。缺省（`'height'`）与老工程都不受影响。
   */
  if (configs.fitAspect === 'width' && configs.meshes) {
    const kept = configs.meshes.filter(
      (m) => !('limitEdge' in m && m.limitEdge)
    );
    if (kept.length !== configs.meshes.length) {
      console.info(
        '[fit] 按宽基准：已剔除 %d 个黑遮幅层（limitEdge）',
        configs.meshes.length - kept.length
      );
      configs.meshes = kept;
    }
  }
  const fitApi = Scene.initScene(configs);

  /**
   * config 到位 ⇒ 补判"比我们更早到达"的那批 WE 属性。
   *
   * 这一步不能省：WE 在页面极早期就下发属性，那时 `fetch` 还没回来，
   * 上面只能先攒着。若不在这里补判，用户改的属性在本次启动会被静默丢弃。
   */
  rawConfigsRef = rawConfigs;
  effectiveViewRef = readView(configs);
  if (pendingWePatches.length) {
    const queued = pendingWePatches;
    pendingWePatches = [];
    queued.forEach((p) => applyWePatch(p));
  }

  // 探针：只挂监听 + HUD，不改任何动画逻辑。见 src/probe.ts
  //
  // ★ 先用 config 的 `probe` 块覆盖运行时开关（**必须在 initProbe() 之前**）：
  //   发布正式壁纸时把 config 的 `probe.enabled` 设 false 即可隐藏诊断 HUD，
  //   无需重新构建（前提是 bundle 用 `probe=on` 编的）。
  applyProbeConfig(configs.probe);
  initProbe();
  // ★ 传**视口**尺寸而不是 config 的设计画幅：HUD 第 7 行"比例 px/视口"与
  //   第 15 行"canvas WxH"要按真实视口判读（全屏适配后二者已不等）。
  registerProbeCanvas(
    window.innerWidth,
    window.innerHeight,
    configs?.meshes?.length ?? 0
  );

  /**
   * start here
   */
  let lastFrameTime = Date.now() / 1000;
  /**
   * 限帧的**累加器**（毫秒）与上一次 rAF 的时刻。
   *
   * ★ 与 `lastFrameTime` 的分工：`lastFrameTime` 记"上一次推进动画的时刻"，
   *   被节流跳过的帧**不更新它** ⇒ 省下的时间累加进下一帧 delta
   *   ⇒ 动画按真实经过的时间推进，不会变慢。
   *
   * ★★ 为什么用 `performance.now()` 而不是 `Date.now()`（2026-10-19）：
   *   `Date.now()` 只有**整数毫秒**精度。120fps 需要 8.33ms 间隔，整数只能取 9ms
   *   ⇒ 封顶 ~111fps（−7.5%）；60/30fps 也被系统性压低（58.8 / 29.4）。
   *   `performance.now()` 亚毫秒且**单调**（不受系统校时跳变影响）。
   *   ⚠️ 动画 delta 仍走 `Date.now()`（`lastFrameTime`）：那是墙钟语义，
   *   与 WE 暂停恢复时的钳位配套，不跟着换。
   *
   * ★★ 为什么不能只比较"距上次渲染是否够一个 gap"（2026-10-19 实测）：
   *   当 rAF 的节奏（如 6.1ms）**不能整除**目标间隔（120fps ⇒ 8.33ms）时，
   *   `now - lastRender` 会在 6.1 / 12.2 / 6.1 / 12.2 … 之间跳，
   *   于是只有"12.2 那一拍"能过 ⇒ 实际渲染间隔 12.2ms ⇒ **82fps**（目标 120，−32%）。
   *   这不是精度问题，是**丢帧**。
   *   累加器（WE 官方《FPS Limiter》用的也是这个写法）把每次 rAF 的间隔攒起来，
   *   够一帧才渲染并**只减一帧的额度**（余量保留）⇒ 平均节奏精确等于目标。
   */
  let capAccumMs = 0;
  let lastTickMs = performance.now();
  /** 上一帧的 cap（变化时重置累加器，避免把上一档的余量带过来） */
  let lastCapForAccum = 0;
  const spineAssetManager = new threejsSpine.AssetManager(ASSET_PATH);
  const threeAssetList: { [path: string]: THREE.Texture } = {};
  const meshUpdateCallbacks: Array<(delta: number) => void> = [];
  /** 粒子系统实例（仅用于探针调试，正式构建里也是空跑一次赋值） */
  const particleAnimators: ParticleAnimator[] = [];
  /**
   * **粒子组名 → 实例** 的索引（2026-10-14 新增，`config.actionEffects` 用）。
   *
   * 为什么要它：`actionEffects[].particles` 里写的是 `config.meshes[].name`（字符串），
   * 而重播要的是**实例**。两个数组 `configs.meshes` 与 `particleAnimators` 的**下标并不对应**
   * （前者含 texture/spine 层），所以不能按下标硬凑 —— 必须按 `meshConfig.name` 建表。
   *
   * ⚠️ 重名（同一个 `name` 出现两次）时**后者覆盖前者**（与构造顺序一致），
   *   这与 `cabinGroups.indexOf(name)` 那套"按名匹配"的口径相同。
   */
  const particleByName: { [name: string]: ParticleAnimator } = {};
  /**
   * 指针拖尾（仅 `config.pointerTrail.enabled` 为真时创建）。
   *
   * 与 `particleAnimators` 分开持有：两者发射模型不同（外部指针驱动 vs 自发射），
   * 探针也要分别取快照 —— 理由见 `pointerTrail.ts` 顶部注释。
   */
  let pointerTrail: PointerTrail | null = null;
  /** 探针用：冻结粒子推进，改为定步长手动推进（保证验证可复现） */
  let fxFrozen = false;

  /**
   * 热区可视化覆盖层：**只在 `touch.showZones = true` 时挂**（默认关）。
   * 只建一次（多骨架时以第一个挂了触摸控制器的为准，本工程只有角色骨架有触摸动画）。
   */
  let zoneOverlay: TouchZoneOverlay = null;

  /**
   * 触摸配置（2026-09-20 起由 `config.json` 的 `touch` 块驱动）。
   *
   * 两个开关互相独立：
   *   - `enabled`（缺省 **true**）：false ⇒ 完全不挂监听、不响应点击；
   *   - `showZones`（缺省 **false**）：true ⇒ 把热区框画在页面上（不吃点击，仅调试）。
   * 缺 `zones` 或 zones 为空 ⇒ 视为未配置，禁用触摸并 console.warn（不再有代码内兜底矩形）。
   */
  const touchCfg = configs.touch;
  const touchEnabled = touchCfg?.enabled !== false;
  const touchShowZones = touchCfg?.showZones === true;
  /**
   * ★ **热区范围改为全屏**（`config.touch.fullscreen`，2026-10-10；面板「事件触发」页）。
   *
   * `true` ⇒ **忽略 `zones`**，整个视口 `[0,1]×[0,1]` 就是一块热区（`id = 'fullscreen'`）
   * ⇒ 点画面任何位置都算命中。`false` / 未给 ⇒ 用 `zones`（原行为，逐字不变）。
   * `hitTestZones` 的判据是 `u0 <= u <= u1`（含端点）⇒ 全屏区在边缘处也命中。
   */
  const touchFullscreen = touchCfg?.fullscreen === true;
  const FULLSCREEN_ZONE: TouchZone = {
    id: 'fullscreen',
    label: '全屏',
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
  };
  /**
   * ★★ 热区**先归一再装配**（2026-10-17）。
   *
   * `normalizeZones` 做四件事：剔除非法项（id 空 / 重复 / 几何不是数）、
   * 端点反向**自动交换**（解包坐标系 y 轴向上、视口向下，换算漏翻转时救一次）、
   * `priority` 归一（非有限数按 0）、产出校验告警。
   *
   * 为什么必须在装配期做一次而不是只靠作者自觉：热区现在是**可以自定义的**
   * （`touch.zones` 是唯一落点），而自定义最容易犯的就是 id 撞车与坐标写反；
   * 这类错误在旧口径下表现为"点了没反应 / 反应错区"，没有任何报错。
   *
   * ⚠️ `fullscreen` 打开 ⇒ **整张表被忽略**，只剩一块全屏区（与改动前一致），
   *    所以那条分支不过归一（只有一个常量区，没有可错的地方）。
   */
  /**
   * ★ **设计画幅 → 视口** 的投影参数（2026-10-21，`zones[].design` 专用）。
   *
   * 只在装配期算一次（resize 时重算），不每帧算 —— 热区不跟动画走。
   * 分母用 `config.width × config.height`（与 `subtitle.charAnchor` 同一套），
   * `halfH/halfHD/aspect` 取自 `initScene` 的 `calc()`（**单一真相**，这里不重算取景）。
   * 取景量拿不到（`halfH/halfHD` 非正）⇒ 返回 undefined ⇒ 写了 `design` 的区会报
   * `E_ZONE_GEOM` 并丢弃（而不是静默用错的坐标）。
   */
  const designFitOf = (): DesignFit | undefined => {
    const v = fitApi && fitApi.calc();
    const dw = configs.width;
    const dh = configs.height;
    if (!v || !(v.halfH > 0) || !(v.halfHD > 0) || !(dw > 0) || !(dh > 0)) {
      return undefined;
    }
    return {
      halfH: v.halfH,
      halfHD: v.halfHD,
      aspect: v.aspect,
      aspectD: dw / dh,
      designW: dw,
      designH: dh,
    };
  };
  const normalizedZones = normalizeZones(touchCfg?.zones, designFitOf());
  const touchZones: TouchZone[] = touchFullscreen
    ? [FULLSCREEN_ZONE]
    : normalizedZones.zones;
  normalizedZones.issues.forEach((issue) => {
    const tag = issue.level === 'error' ? 'error' : 'warn';
    console[tag](
      '[touch.zones] %s [%s] %s',
      issue.id,
      issue.code,
      issue.message
    );
  });
  if (touchEnabled && !touchZones.length) {
    console.warn(
      '[touch] config.json 缺少 touch.zones ⇒ 触摸交互已禁用（热区现在只认配置，代码里不再有兜底矩形）'
    );
  }
  const touchActive = touchEnabled && touchZones.length > 0;

  /**
   * ★ 换分辨率 / 窗口比例 ⇒ **重投影** `design` 热区（2026-10-21）。
   *
   * 原地改 `touchZones`（`touch` 控制器与覆盖层持有的是**同一个数组引用**），
   * 覆盖层若已建则 dispose ⇒ 下一帧按新矩形重建（它的框用百分比定位，不重建就是旧值）。
   *
   * 只有 `zones[].design` 的工程会真的变；纯 `u0..v1` 的工程重算结果与原来一致（幂等）。
   * 为什么要监听尺寸而不只在启动算一次：`fitAspect: 'width'` 下可见高随比例变，
   * 拖窗口 / 换显示器 / 多屏跨 DPI 都会让设计画幅的落点变，热区不跟着改就点不中。
   */
  if (touchEnabled && !touchFullscreen && touchZones.length) {
    let lastAspect = window.innerWidth / window.innerHeight;
    window.addEventListener('resize', () => {
      const a = window.innerWidth / window.innerHeight;
      if (Math.abs(a - lastAspect) < 1e-9) {
        return;
      }
      lastAspect = a;
      const next = normalizeZones(touchCfg?.zones, designFitOf());
      touchZones.length = 0;
      touchZones.push(...next.zones);
      if (zoneOverlay) {
        zoneOverlay.dispose();
        zoneOverlay = null;
      }
    });
  }

  /**
   * 念白字幕（`config.json` 的 `subtitle` 块）。
   *
   * 与热区同一套架构口径：**数据与样式的唯一来源是 config，代码里不留副本**
   * ⇒ 改文案、改字号、挪气泡位置都**免重建 bundle**（与 `touch.zones` 同理）。
   */
  const subtitleCfg = configs.subtitle;
  /**
   * ★★ 事件表 = `assets/events.jsonc` 的内容（**逐字**，未归一）。
   *
   * ⚠️ `subtitle.dialogues` **不再参与**（2026-10-19）。它现在是历史字段：
   *   迁移器（`scripts/migrateEvents.ts --to-file`）会把它搬进事件文件并从 config 删掉。
   */
  const dialogues: DialogueEntry[] = eventsFile.events;
  /** 气泡实例；未启用（`enabled:false`）或没配底图时为 `null` ⇒ 只播动作、不出字幕 */
  const voiceBubble: VoiceBubble = createVoiceBubble(subtitleCfg);
  /**
   * 语音播放器。未启用（`subtitle.audio.enabled:false`）时为 `null` ⇒ 静音播放。
   *
   * ⚠️ 首次打开的问候语音**很可能播不出来**（浏览器自动播放限制，那时还没有用户交互）。
   * 详见 `voicePlayer.ts` 的注释 —— 这是硬限制，不是 bug。
   */
  const voicePlayer: VoicePlayer = createVoicePlayer(subtitleCfg?.audio);

  /**
   * 背景音乐（`config.json` 的 `bgm` 块）。与字幕**平级**，互不依赖
   * （念白关掉时 BGM 仍应能响）。
   *
   * 未启用、或没配 `file` 时为 `null` ⇒ 静音（不是错误）。
   * 与语音同一套自动播放口径：首次很可能被拒，`bgmPlayer` 内部挂了
   * 一次性交互解锁，首次点击/按键后会自动重试 —— 属预期行为，不是 bug。
   *
   * ★ **不在这里 `start()`**：等到 `startAutoPlay()`（资源就绪、进入可交互的那一刻）
   *   再起播，避免把"骨架 367 KB + 贴图数 MB"的加载耗时算成"开场就响了"。
   */
  const bgmPlayer: BgmPlayer = createBgmPlayer(configs.bgm);

  /**
   * ★ 音频总闸（2026-10-03）：BGM 与角色语音的**唯一**暂停/恢复控制点。
   *
   * 背景：此前只有 `bgmPlayer` 自己订阅了 WE 的暂停信号，`voicePlayer`
   * 连 `pause()` 都没有 ⇒ 现象是"暂停壁纸时 BGM 停了、角色语音还在念"。
   * 现在两路都登记到这里，由总闸统一驱动（`audioMaster.ts` 顶部有完整说明）。
   *
   * ★ **必须在 `startAutoPlay()` 之前建好并登记**：总闸一创建就装上宿主订阅，
   *   登记时还会对齐当前暂停态 ⇒ 不存在"BGM 已 start 但信号被漏掉"的窗口。
   *   （未启用的播放器为 `null`，跳过登记即可 —— 那条路本来就没声音。）
   */
  const audioMaster: AudioMaster = createAudioMaster();
  if (bgmPlayer) {
    audioMaster.register('bgm', bgmPlayer);
  }
  if (voicePlayer) {
    audioMaster.register('voice', voicePlayer);
  }

  /**
   * 运行时静音（入口列里的「静音」按钮，2026-10-17）。
   *
   * ## ★★ 为什么不走配置（用户拍板）
   *
   * WE 属性里的 `muteAll` 是**配置层**静音：改覆盖层 → 重载页面才生效
   * （`settingsStore.applyOverrides` 里 `muteAll` 直接把 `bgm.enabled` /
   * `subtitle.audio.enabled` 压成 false）。那是"我这张壁纸就是不要声音"。
   * 而这个按钮的诉求是**"我现在要让壁纸闭嘴"**这一下的临时动作 ⇒ 不落盘、不重载，
   * 直接把两路音频的音量压到 0，再点还原。
   *
   * ## 口径
   *
   * - 基准音量在**创建时各取一次**（= 配置里生效的音量）。之后靠面板改音量是
   *   "保存 → 重载"，会连同这里一起重建 ⇒ 不存在"基准过期"的窗口。
   * - 播放器可能为 `null`（没配 BGM / 语音被配置关掉）⇒ 逐个判空，不假设它们存在。
   * - 只压音量、**不动 `enabled`**：`voicePlayer.setVolume` 会把值记住，
   *   下次 `ensure()` 建元素时写进去 ⇒ 静音期间新起的语音也是静音的。
   * - ⚠️ 与 WE 的暂停**正交**：暂停走 `audioMaster`（`pause()` 保进度），
   *   本开关走音量 ⇒ 恢复播放时音量仍是 0，符合"我按了静音"的预期。
   */
  const bgmBaseVolume = bgmPlayer ? bgmPlayer.getVolume() : 0;
  const voiceBaseVolume = voicePlayer ? voicePlayer.getVolume() : 0;
  let runtimeMuted = false;
  const applyRuntimeMute = (v: boolean): void => {
    runtimeMuted = v;
    if (bgmPlayer) {
      bgmPlayer.setVolume(runtimeMuted ? 0 : bgmBaseVolume);
    }
    if (voicePlayer) {
      voicePlayer.setVolume(runtimeMuted ? 0 : voiceBaseVolume);
    }
  };

  /**
   * 骨架动画名 → 时长（秒）。用来把字幕停留夹到"动作播完"为止。
   *
   * ★ 必须**按骨架分开存**，不能用一个全局字典。
   * 若场景里有 2 个 spine 骨架（例如角色层与背景层），
   * 遍历 `configs.meshes` 时后者会把前者覆盖掉 —— 而背景层只有 `idle` 一个动画，
   * 于是 `chat/greet/touch1~3` 的时长全部查不到，字幕时长静默退化成 `TextTime`。
   * 这个 bug 不会报错、只会让"动作播完气泡就收起"这条规则失效，属于典型的静默失效。
   *
   * 只有**挂了触摸控制器的那个骨架**（即角色）才往里写。
   */
  const animationDurations: { [name: string]: number } = {};
  /** 触摸控制器。装配完成前为 `null`，待机/问候的定时器要判空 */
  let touchController: TouchController = null;
  /**
   * 常驻动作序列控制器（`config.json` 顶层 `idleSequence`）。
   * 未启用时为 `null` ⇒ 角色照旧一直播 idle。
   */
  let idleSequence: IdleSequenceController = null;
  // ★ `settingsUI` 的声明已上移到 `applyWePatch` 之前（TDZ 时序要求），这里不再重复声明

  /**
   * 最近一帧的**限帧决策**（只给探针/回归读，不参与渲染逻辑）。
   *
   * 为什么要暴露它：`_regress/42_` 要验证"空闲降帧 / 交互恢复 / WE 优先"，
   * 光看 fps 会被软渲染抖动和加载期噪声污染（实测同一配置能差 6 倍）。
   * 直接读决策（cap / baseCap / idle / 光标年龄）就能把"逻辑对不对"和
   * "这台机器跑不跑得动"分开判。
   *
   * 声明在这里（而不是 render 旁边）：`__WB_FX__`（约 2400 行）要闭包引用它，
   * 必须在 `if (PROBE_OPTS.enabled)` 分支执行前完成声明。
   */
  let lastCapInfo = {
    cap: 0,
    baseCap: 0,
    idle: false,
    cursorAgeMs: 0,
    /** 生效的 idleFps（0 = 关闭空闲降帧）—— 排查"为什么没降"时第一眼看这个 */
    idleFps: 0,
    /** 生效的空闲阈值（ms） */
    idleAfterMs: 0,
  };

  /**
   * 最近一次发起播放的语音文件名。只用于诊断/验证。
   *
   * 为什么需要它：播放器刻意**不把 `<audio>` 元素挂进 DOM**（免得干扰页面结构），
   * 所以外部 `document.querySelector('audio')` 找不到它，无法核对"点这条念白
   * 到底去加载了哪个文件"。这个变量把那次决策记下来。
   */
  let lastVoiceFile = '';

  /** 最近一次"有活动"的时刻（秒）。待机计时从这里重新起算 */
  let lastActivityAt = Date.now() / 1000;
  const markActivity = () => {
    lastActivityAt = Date.now() / 1000;
  };

  /**
   * 「动作 → 额外特效」索引：`动画名 → 绑定列表`（2026-10-14）。
   *
   * 数据来自 `config.actionEffects`（见 `ActionEffectsConfig` 的完整说明）——
   * 复刻游戏 `CfgSoulSpineActionTable` 的 `EffectId` / `MarryEffectId`：
   * 某条动作播的时候额外拉起一簇粒子。
   *
   * ★★ 为什么按**动画名**建索引、而不是 actionId：
   *   游戏侧绑的是 `actionId`，但壁纸侧的动作播放在 `touch.ts` 里是**按动画名**驱动的
   *   （`entry.animation`），而且同一条 `actionId` 在誓约前后走两个不同动画
   *   （`SoulActionState` / `MarryActionState`）—— 特效也分 `EffectId` / `MarryEffectId` 两套，
   *   恰好一一对应。用动画名作键天然覆盖"多条念白共用同一动画"（S8 的 `63007/63008/63013` 都是 `touch1`）。
   *
   * ⚠️ **本索引在资源加载之前就建好**（`configs` 已到手），`particleByName` 是后填的
   *   ⇒ 查表时**必须再判一次** `particleByName[name]` 是否存在（那才是"这一组真的建起来了"）。
   */
  const actionEffectIndex: { [animation: string]: ActionEffectConfig[] } = {};
  /**
   * 「动画名 → 绑定的粒子组名」的**扁平**表（2026-10-17 新增）。
   *
   * ★ 为什么单独存一份：档案面板（`archive.ts`）与探针钩子（`__WB_FX__.actionEffects()`）
   *   都只要**名字列表**，而 `actionEffectIndex` 的值是完整的 `ActionEffectConfig[]`
   *   （还带 `restart` 等字段）。两处各写一遍 `.map(b => b.particles).flat()` 迟早漂移
   *   ⇒ 只在重建索引时算一次，随 `actionEffectIndex` 一起重建、一起清空。
   */
  const actionEffectNames: { [animation: string]: string[] } = {};
  /** 已经因为"名字写错"报过 warn 的组名 —— 避免同一处每播一次刷一条日志 */
  const warnedEffectNames: { [name: string]: boolean } = {};

  /**
   * 重建「动画名 → 绑定」索引。
   *
   * ★ 抽成函数（而不是就地写一段 forEach）是为了让**探针**能在运行时替换它
   *   （`__WB_FX__.setActionEffects`，见下）—— 验收脚本要验"绑上之后真的会重播"，
   *   而 `actionEffects` 是 config 里的块、**不在设置覆盖层的取值域里**
   *   （`applyOverrides` 只覆盖已有设置项），靠 localStorage 注入不了。
   *   两处若各写一份索引逻辑，迟早会漂移 ⇒ 只留这一个入口。
   */
  const rebuildActionEffectIndex = (list?: ActionEffectsConfig): void => {
    Object.keys(actionEffectIndex).forEach((k) => delete actionEffectIndex[k]);
    Object.keys(actionEffectNames).forEach((k) => delete actionEffectNames[k]);
    (list ?? []).forEach((bind) => {
      if (!bind || !bind.animation || !(bind.particles ?? []).length) {
        console.warn(
          '[actionEffects] 有一条绑定缺 animation / particles，已忽略:',
          bind
        );
        return;
      }
      (actionEffectIndex[bind.animation] ??= []).push(bind);
      /** 扁平表与索引**同一处**写入 ⇒ 两者永远一致（少一处就少一个漂移点） */
      (actionEffectNames[bind.animation] ??= []).push(...bind.particles);
    });
  };
  rebuildActionEffectIndex(configs.actionEffects);

  /**
   * 播放某条动作时，拉起它绑定的额外粒子组。**三条通道共用**（在 `showDialogue` 里调用）。
   *
   * @param animationName 本次要播的动画名（与 `DialogueEntry.animation` 同一口径）
   * @returns 实际重播/激活的组数（0 = 这条动画没绑特效，或绑的组名都不存在）
   */
  const playActionEffects = (
    animationName: string,
    /**
     * 本次要播的**事件**（可选）。写了 `particles` ⇒ **只播这几个组**
     * （五要素里的粒子是显式的，PLAN §5.5）；没写 ⇒ 回落到按动画名查 `actionEffects`。
     */
    entry?: DialogueEntry | null
  ): number => {
    /**
     * ★ 事件级 `particles` 优先：空数组也**算显式**（= 这条不要特效），
     *   不能退化成 `?? 回落`（那样"显式关掉"会被 `actionEffects` 又拉起来）。
     */
    if (entry && Array.isArray(entry.particles)) {
      let n = 0;
      entry.particles.forEach((name) => {
        const anim = particleByName[name];
        if (!anim) {
          if (!warnedEffectNames[name]) {
            warnedEffectNames[name] = true;
            console.warn(
              '[subtitle] 事件 "%s" 的 particles 里找不到粒子组 "%s" ⇒ 跳过；请核对 config.meshes[].name',
              eventKeyOf(entry),
              name
            );
          }
          return;
        }
        anim.restart();
        n++;
      });
      return n;
    }
    const binds = actionEffectIndex[animationName];
    if (!binds || !binds.length) {
      return 0;
    }
    let n = 0;
    binds.forEach((bind) => {
      bind.particles.forEach((name) => {
        const anim = particleByName[name];
        if (!anim) {
          /**
           * 名字写错**只 warn 不抛** —— 宁可少一个特效，也不要整条通道挂掉。
           * 去重后只报一次（`warnedEffectNames`），免得每次点击都刷屏。
           */
          if (!warnedEffectNames[name]) {
            warnedEffectNames[name] = true;
            console.warn(
              '[actionEffects] 找不到粒子组 "%s"（动画 %s 绑定的）⇒ 跳过；' +
                '请核对 config.meshes[].name',
              name,
              bind.animation
            );
          }
          return;
        }
        /**
         * 缺省 `restart !== false` ⇒ 清空并从头播（= 游戏侧每次动作都重新 `PlayEffect`）。
         *
         * ★★ **不要写成 `restart(bind.restart !== false)`**（2026-10-14 实测踩到的坑）：
         *   `restart(rePrewarm)` 的第二参是"是否**强制**预热"，传 `true` 会让
         *   `autoplay: false` 的一次性特效组也去跑 `prewarm()`。而 `prewarm()` 是按
         *   "模拟到稳态"**推进系统时钟**的（最长 30 s）⇒ 时钟一上来就被推到
         *   `startDelay` 附近、甚至远远越过发射窗口：
         *     · `fx_chat_lizi_san`（delay=7 / cycle=1 / looping=false）prewarm 停在 **4.02 s**
         *       ⇒ 特效迟到约 3 s（要等时钟从 4 s 慢慢走到 7 s）；
         *     · `fx_chat_glow01_1`（`maxNumParticles = 1`）prewarm 直接跑到 **7 s**，
         *       **在预热期间就把唯一那颗粒子发掉了** ⇒ 触发瞬间看到的是"已经播到一半"。
         *   实测（`_tmp_探针_触发前后.js`，原子读数）：触发前后 `systemTime` 14.59 → 4.02（而非 0）。
         *
         *   不传参数 ⇒ `restart` 退回 `cfg.prewarm`（本工程 7 个特效组**全 false**）
         *   ⇒ 时钟**干净归零**，特效严格按 `startDelay` 在动作开始后 7 s / 1.6 s 出现。
         *
         * `restart === false` ⇒ 只保证它开跑、按自己的自然周期继续跑（**不**复位时钟）。
         * 用 `ensureStarted()` 表达 —— 它的语义就是"置 `started = true`"，不碰时钟 / 粒子。
         */
        if (bind.restart === false) {
          anim.ensureStarted();
        } else {
          anim.restart();
        }
        n++;
      });
    });
    return n;
  };

  /**
   * 显示一条念白的字幕。
   *
   * 停留时长 = **`min(TextTime, 该动画的 duration)`** ——
   * 动作播完气泡就先收起，不会出现"人已经站回 idle 了、字幕还挂在屏幕上"。
   * 两个来源都没给时退到保守的 6 秒，不至于一闪而过。
   */
  const showDialogue = (entry: DialogueEntry | null, animationName: string) => {
    /**
     * ★★ 「动作 → 额外特效」的**唯一触发点**（2026-10-14）。
     *
     * 放在这里而不是 `TouchController.onAction`：那是**触摸路径专属**的回调，
     * 覆盖不到 boot 问候 / 长时间待机这两条自动通道。而本函数是
     * **三条通道（触摸 / 问候 / 待机）的唯一汇合处** —— 见调用点
     * `index.ts` 的 `onAction`（触摸）与 `idleSequence.onItem`（序列/问候/待机）。
     *
     * ⚠️ 必须**在 `entry` 为空时也照常触发**：动作与特效是两件事，
     *   念白缺失（`entry=null`）只意味着"不出字幕"，不意味着"不播特效"。
     */
    playActionEffects(animationName, entry);
    if (!entry) {
      // 本次动作没配字幕 ⇒ 收起上一条，免得"动作换了、台词还是上一句"
      if (voiceBubble) {
        voiceBubble.hide();
      }
      if (voicePlayer) {
        voicePlayer.stop();
      }
      return;
    }

    /**
     * ★ 先起语音、再显示字幕，且**不等待 `play()` 的 promise**。
     *
     * 等它的话，一次自动播放被拒（首次打开时必然发生）就会连带字幕也不出现 ——
     * 字幕是 DOM、不经过媒体权限，没理由被语音的失败拖累。
     */
    if (voicePlayer) {
      lastVoiceFile = voiceBasename(entry.voice ?? '');
      voicePlayer.play(lastVoiceFile);
    }

    if (!voiceBubble) {
      return;
    }

    const animDur = animationDurations[animationName] ?? 0;
    const textTime = entry.textTime ?? 0;
    let duration = 6;
    if (textTime > 0 && animDur > 0) {
      duration = Math.min(textTime, animDur);
    } else if (textTime > 0) {
      duration = textTime;
    } else if (animDur > 0) {
      duration = animDur;
    }
    voiceBubble.show(entry, duration);
  };

  /**
   * 「回到壁纸」通道的去重窗口（秒）。加载延迟、visibilitychange、focus、WE 恢复
   * 四个信号可能接连到来，只认第一次 —— ★ 2026-10-09 起它管**整个通道**
   * （勾了 chat类 / touch类 时同样会被连播，去重不能只管 greet类）。
   */
  const GREETING_DEDUPE_SEC = 5;
  let lastGreetingAt = 0;

  /** 待机与「回到壁纸」的自动播放节奏（毫秒）。都可在 config 里改 */
  const standbyIdleMs = subtitleCfg?.standbyIdleMs ?? 25000;
  const greetingDelayMs = subtitleCfg?.greetingDelayMs ?? 3000;
  /**
   * 问候的取条方式（缺省 `'time'`）。详见 `GreetMode` 的表格。
   *
   * ★ 2026-10-18 起它**只喂归一函数**（决定要不要给问候条目写 `when.time`），
   *   运行期不再有"按全局开关跳过条件"的分支（PLAN §0 #3）。
   *   新 config 写 `"greet": [...]`；没配/空数组才回退旧时段表 `greeting`
   *   —— 判据在 `dialogue.resolveGreetSource`，与 `chat: []` 退 `standby` 同一口径。
   */
  const greetMode: GreetMode = subtitleCfg?.greetMode ?? 'time';
  /**
   * ★★「闲聊」池 —— `chat` 数组（**没配时**退回旧字段 `standby`，即 S9 的休闲待机 64004）。
   *
   * 三个通道勾上 chat类 时都从这个池取条（并池见 `pickChannelEntry`）。
   */
  /**
   * ★★ **事件族注册表（2026-10-15 起）** —— 见 `config.type.ts` 的 `EventFamily`。
   *
   * · 注册表本身由 `config.subtitle.eventFamilies` 声明
   *   （**没声明 ⇒ 内置单族 `normal`** ⇒ 非誓约皮肤既看不到「事件族」行、
   *   也看不到「spine 动作族显示」行）；
   * · **候选闸门**：用户在面板「事件池」页勾的 `subtitle.phases`
   *   （缺省 = 注册表的缺省勾选 `defaultIds`）；
   *   ★★ **2026-10-17 起对所有入口生效**（字段此前叫 `touchPhases`、只作用于点击触摸）——
   *      一项都不勾 ⇒ **所有池为空** ⇒ 任何通道都不触发、档案里没有任何事件行。
   * · **动作族**（2026-10-17）：`subtitle.actionPhase` 决定播哪一套动画名。
   * · 注册表**为空**（config 写了 `eventFamilies: []` = 本项目无事件族机制）
   *   ⇒ 不按族筛、不换名，所有条目一视同仁。
   *
   * ★★ **两层正交的闸门，别再合并**：
   *   ① **事件族**（`phases`，全局）：用户允不允许这一族 —— 一项都不勾就是"全关"；
   *   ② **动作族**（`actionPhase`，全局）：决定"播哪套动画"，并把属**别的**动作族的
   *      条目挡在池外 —— 誓约前池 6 条 / 誓约后池 9 条就靠这一层。
   *   两者是 **AND**。⚠️ 早先 `chatPool` / `greetPool` 被按**缺省族**预筛过（`autoFilter`）——
   *      那是把"动作族"错误地实现成了"池筛子"；现在两层分别由 `phaseFilter` /
   *      `isEntryVisibleInPhase` 表达，互不兼任。
   */
  const fams = buildFamilyRegistry(subtitleCfg?.eventFamilies);
  /**
   * ★★ **全局事件族闸门**（`subtitle.phases`；旧字段 `touchPhases` 仅在新字段缺席时读）。
   * ⚠️ 注册表为空 ⇒ `undefined`（= 不按族筛）；否则是用户勾选的族列表（`[]` = 全关）。
   */
  const phases = resolvePhases(
    subtitleCfg?.phases,
    subtitleCfg?.touchPhases,
    fams
  );
  /**
   * ★ 当前动作族（`subtitle.actionPhase`）。
   * ⚠️ 面板上单选那一档写的是**空串**（= 不换名）—— 与"没配"是两种输入：
   *   没配 ⇒ 取 `fams.defaultActionId`（誓约工程 = 婚后）；空串 ⇒ 保持原动画名。
   */
  const actionPhase = resolveActionPhase(subtitleCfg?.actionPhase, fams);
  if (
    typeof subtitleCfg?.actionPhase === 'string' &&
    subtitleCfg.actionPhase &&
    !fams.suffixOf(subtitleCfg.actionPhase)
  ) {
    console.warn(
      '[subtitle] actionPhase="%s" 不是带 matchSuffix 的动作族 ⇒ 按"不换名"处理（可选：%s）',
      subtitleCfg.actionPhase,
      fams.actionIds.length ? fams.actionIds.join(' / ') : '(无)'
    );
  }
  /**
   * 族筛（**全通道共用**；注册表为空 ⇒ `undefined` = 不筛）。
   * ⚠️ 空数组 `[]` 会原样传下去 ⇒ `buildPool` 收 0 条 ⇒ 所有池为空（用户要的"全关"）。
   */
  const phaseFilter: readonly TriggerPhase[] | undefined = fams.families.length
    ? phases
    : undefined;
  /**
   * ★★ **事件表归一（唯一入口）** —— 2026-10-18（PLAN §3 / S3）。
   *
   * 补 `id` / `on` / `kind` / `when` / `pick`，并把旧池键（`greeting` / `standby` /
   * `touch` / `greet` / `chat`）**反推**成条目上的字段（`W_LEGACY`）。
   *
   * ⚠️ 从这里往下**只认 `eventTable`**：池、漏斗、档案、探针全部消费它。
   *   任何一处再补一遍默认值，就会出现"引擎按 A 口径抽、档案按 B 口径显示"。
   */
  /**
   * ★★ **事件开关**（用户侧，`localStorage`）—— 2026-10-19 起面板只做这一件事：
   *   决定某条事件在这台机器上播不播。增删改一律改 `assets/events.jsonc`。
   *
   * ⚠️ 必须在 `normalizeEventTable` **之前**压：`enabled` 也在那一层被归成布尔
   *   （见 `eventOverrides.ts` 文件头）。
   */
  const eventState = readEventState();
  /**
   * 事件**文件里的缺省开关**（未压过用户开关的那一份）。
   *
   * ★ 只喂面板：它要算「已改 N 项」并实现「恢复本页默认」。引擎自己不消费 ——
   *   引擎的口径始终是"文件缺省 + 用户显式覆盖"（`applyEventState`）。
   */
  const eventDefaults = eventDefaultsOf(dialogues);
  const eventSource: DialogueEntry[] = applyEventState(dialogues, eventState);
  const normalizedTable = normalizeEventTable(eventSource, {
    legacy: {
      touch: subtitleCfg?.touch,
      chat: subtitleCfg?.chat,
      standby: subtitleCfg?.standby,
      greet: subtitleCfg?.greet,
      greeting: subtitleCfg?.greeting,
      greetingRanges: subtitleCfg?.greetingRanges,
      greetMode,
    },
  });
  /**
   * 事件表的问题分两段：
   *   ① 文件本身（缺失 / 语法 / 形状）—— `eventsFile.issues`；
   *   ② 归一（`E_ID_INVALID` / `E_ID_DUP` / `E_PRIORITY_RANGE` / `W_LEGACY` …）。
   * 运行时校验的 issue 在骨架就绪后再合并进来（见 `validationReport`）。
   */
  const normalizeIssues = eventsFile.issues.concat(normalizedTable.issues);
  /** 归一后的事件表（**未**投影；投影会改动画名，校验要用原名） */
  const eventTable: DialogueEntry[] = normalizedTable.events;
  if (eventTable.length === 0) {
    /**
     * 事件表空了 = 整个壁纸不会播任何念白/动作事件。
     * 最常见的两种原因：`events.jsonc` 的 `events` 是空数组，或文件根本没进包。
     * 只 warn 一行（不要 error 刷屏）—— 画面本身还能正常渲染。
     */
    console.warn(
      '[events] 事件表为空 ⇒ 不会触发任何念白/动作事件。检查 assets/events.jsonc 的 events 数组。'
    );
  }

  /**
   * ★★ **投影到当前动作族**：动画名换成该族那一套（`greet` → `greet_marry`），
   *   并把条目按 `isEntryVisibleInPhase` 剔掉"本状态不存在"的那些。
   *
   * ⇒ 往下所有池、字幕、档案、调试面板**只认这一份数组**，
   *   不可能出现"点击播 `greet`、档案写 `greet_marry`"这种漂移。
   */
  const dialoguesAuto: DialogueEntry[] = projectDialoguesToActionPhase(
    eventTable,
    fams,
    actionPhase
  );
  /** 本状态下**存在**的条目（= 池的候选总集；自动通道与触摸通道共用） */
  const activeDialogues: DialogueEntry[] = dialoguesAuto.filter((d) =>
    isEntryVisibleInPhase(d, fams, actionPhase)
  );

  /**
   * ★★ **再按全局事件族闸门筛一遍**的表 = 漏斗的候选总集。
   *
   * 判据与 `buildPool` 的 `phases` 参数**完全一致**（都是 `resolveDialoguePhase`），
   * 不存在第二套口径。
   */
  const phasedDialogues: DialogueEntry[] =
    phaseFilter === undefined
      ? activeDialogues
      : activeDialogues.filter(
          (e) => phaseFilter.indexOf(resolveDialoguePhase(e, fams)) >= 0
        );

  /**
   * 校验后被判 `reject` 的事件（漏斗第 ① 层用）。骨架就绪后由
   * `validateEvents()` 填充；在此之前为空 ⇒ 与"没校验"等价。
   */
  const unplayable: { [key: string]: boolean } = {};
  /** 校验报告（骨架就绪后填充；`__WB_DIALOGUE__.validation()` 与档案共用） */
  let validationReport: ValidationReport | null = null;

  /**
   * ★★ **三个通道共用的一套池**（`TriggerEventKind` → 条目池）。
   *
   * 2026-10-18 起**由事件表派生**（此前是 `buildPool(activeDialogues, 旧 id 列表)`）：
   *   - 旧 config 的 `on` / `kind` 由 `normalizeEventTable` 反推 ⇒ 池内容逐条不变；
   *   - 自定义事件（显式 `on`）**自动**进对应池，不需要再往三个旧数组里登记。
   *
   * ⚠️ **不要再拆出"触摸专用池"**：事件族闸门对所有入口生效，
   *   三个通道看见的候选必须完全一致 —— 否则"表里说待机能播、实际抽不出"必然出现。
   */
  const poolOfKind = (kind: TriggerEventKind): DialogueEntry[] =>
    phasedDialogues.filter(
      /** ⚠️ `on: []`（不可达）不进池 —— 否则池大小会虚高，档案/面板读数跟着撒谎 */
      (e) => kindOf(e) === kind && channelsOf(e).length > 0
    );
  const chatPool: DialogueEntry[] = poolOfKind('chat');
  const greetPool: DialogueEntry[] = poolOfKind('greet');
  const touchBasePool: DialogueEntry[] = poolOfKind('touch');

  /**
   * 三个通道各自的「可触发的事件」候选池（`TriggerEventKind` → 条目池）。
   * ★ 三个通道**共用同一份池**（`chat` / `greet` / `touch` 各算一次），
   *   差别只在"勾了哪几个"⇒ 不会出现"同一个类在两个通道里内容不同"这种漂移。
   */
  const KIND_POOLS: Record<TriggerEventKind, DialogueEntry[]> = {
    chat: chatPool,
    greet: greetPool,
    touch: touchBasePool,
  };

  /**
   * ★★ 三个触发通道**真正会播**哪些类别（2026-10-09 起每个通道各一项多选）。
   *
   * | 通道 | config 字段 | 缺省 | 触发时机 |
   * |---|---|---|---|
   * | `'standby'` | `standbyKinds` | `['chat']` | 静置超过 `standbyIdleMs` |
   * | `'touch'` | `touchKinds` | `['touch']` | 点中任一热区（用户操作） |
   * | `'resume'` | `resumeKinds` | `['greet']` | 载入后延迟 / 回到桌面 / 回到前台 / WE 暂停恢复 |
   *
   * ## ★★ 三个缺省合起来 = "升级后行为与改动前逐字相同"
   *
   *   - 待机 `['chat']` ⇒ 修掉 2026-09-30「出厂待机什么都不播」的回归；
   *   - 触摸 `['touch']` ⇒ 点击只取 `touch` 池（= 被删掉的 `greetInTouchPool:false`）；
   *   - 回到壁纸 `['greet']` ⇒ 四个自动时机仍只播问候（旧 `tryGreeting` 的口径）。
   *
   * ★ 旧 config 的两个布尔（`standbyGreetEnabled` / `standbyTouchEnabled`）仍被读取，
   *   但**只作用于 `'standby'` 通道** —— 摊平口径在 `dialogue.resolveTriggerIntent`
   *   （纯函数、可单测），这里不另写一套 if。
   * ★ 池空的类别会被整类剔除（判据同样集中在那里）。
   */
  const standbyKinds = resolveTriggerKinds(
    'standby',
    subtitleCfg?.standbyKinds,
    subtitleCfg?.standbyGreetEnabled,
    subtitleCfg?.standbyTouchEnabled,
    chatPool.length > 0,
    greetPool.length > 0,
    touchBasePool.length > 0
  );
  const touchKinds = resolveTriggerKinds(
    'touch',
    subtitleCfg?.touchKinds,
    undefined,
    undefined,
    // ★ 可用性必须按**筛过之后还剩多少**算（否则会出现"勾了却永远抽不出"的假象）——
    //   现在三个通道共用同一套池，`phaseFilter` 已经把"一项都不勾 ⇒ 全空"表达掉了
    chatPool.length > 0,
    greetPool.length > 0,
    touchBasePool.length > 0
  );
  const resumeKinds = resolveTriggerKinds(
    'resume',
    subtitleCfg?.resumeKinds,
    undefined,
    undefined,
    chatPool.length > 0,
    greetPool.length > 0,
    touchBasePool.length > 0
  );

  /**
   * ★★ 触摸池（传给 `createTouchController` 的固定候选表）—— 由「触摸可触发的事件」
   * **并池**而来：勾了多类就并成一个大池随机。
   *
   * ⇒ 勾 `['touch','greet']` 与**改动前的 `greetInTouchPool:true` 是同一份候选**
   *   （旧实现也是把问候池的 id 追加进触摸池、再在整个大池里随机；同一条 id 不重复追加）。
   *   ⚠️ 池内**顺序**不同（这里按 `chat→greet→touch` 归一，旧实现是追加到末尾）——
   *   均匀随机下概率分布完全相同，只有归档面板的列举次序会变。
   * 缺省 `['touch']` ⇒ 与 `greetInTouchPool:false` 等价。
   *
   * ★ 取的是 `KIND_POOLS`（三个通道**共用**那一套，已按全局事件族闸门 `phases` 筛过）
   *   —— 这就是"先按族筛、再按类并池"的两层顺序。⚠️ 2026-10-17 起族筛对所有入口生效，
   *   所以**不再有**"触摸专用池"：三通道看见的候选完全一致。
   */
  const touchPool: DialogueEntry[] = mergeKindPools(
    touchKinds,
    KIND_POOLS,
    fams
  );

  /**
   * ══════════════════════════════════════════════════════════════════════
   * **唯一漏斗 `resolveEvent`**（PLAN §4.2 / S2 + S5）
   * ══════════════════════════════════════════════════════════════════════
   *
   * 四层顺序**写死**，别在各调用点自己排：
   *
   * ```
   * ① 权限层  enabled + on(通道) + kind(用户勾选) + phases(事件族) + unplayable
   * ② 条件层  when                                  ← 纯函数，注入 now/ctx
   * ③ 限流层  pick.group / quota / cooldownMs        ← 状态在 eventLog
   * ④ 竞争层  priority 最高档 → 同档按 weight 加权随机
   * ```
   *
   * ★ 2026-10-18 之前这里有 **3 份选择逻辑 + 2 份存在性校验副本**
   *   （`pickChannelEntry`、`touch.ts` 的 `pickRandomFromPool`、`idleSequence` 的自查、
   *   `missingAnims` 的 ad-hoc 检查、`pickGreetingEntry` 的时段下标）。现在只剩这一处：
   *   三个通道的差别只有"哪个 channel + 勾了哪几类"。
   * ★ **同一 tick 全局最多一条**（track 2 只有一个）；互斥组 `pick.group` 靠 `eventLog` 的
   *   tick 号实现"同组同 tick 至多一条"。
   * ★ 配额/冷却在**收集阶段**剔除 ⇒ 不会"选到高优先级却被冷却拦下、本次空转"。
   * ★ 计时用 `Date.now()`，**不用 rAF**：WE 暂停时 rAF 停、`Date.now()` 继续走。
   */
  const eventLog = createEventLog(
    typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null
  );
  /** 可注入的随机源（回归脚本可以换成固定序列；引擎里就是 `Math.random`） */
  const eventRandom: () => number = Math.random;
  /** 漏斗的运行上下文（由信号方注入，事件不可改） */
  type ResolveContext = {
    /** 已静置毫秒数（standby 通道） */
    idleMs?: number;
    /** 命中的热区 id（touch 通道） */
    zone?: string;
    /** resume 通道的具体信号来源 */
    signal?: 'boot' | 'visible' | 'focus' | 'resume';
  };
  /** 漏斗本体在 `eventScheduler.resolveEventFrom`（纯函数，回归可拿真实实现对照旧行为） */
  const resolveEvent = (
    channel: TriggerChannel,
    kinds: readonly TriggerEventKind[],
    ctx: ResolveContext = {}
  ): DialogueEntry | null =>
    resolveEventFrom(
      phasedDialogues,
      { channel, kinds, ctx, unplayable, log: eventLog },
      eventRandom
    );

  /**
   * 取条 → 抽变体 → 真播。**三个通道共用**。
   *
   * @returns 是否真的播了（`trigger` 的忙碌闸门拒绝时返回 false ⇒ 配额不会被吃掉）
   */
  const playEvent = (
    channel: TriggerChannel,
    kinds: readonly TriggerEventKind[],
    source: 'touch' | 'greet' | 'standby',
    ctx: ResolveContext = {}
  ): boolean => {
    if (!touchController) {
      return false;
    }
    const picked = resolveEvent(channel, kinds, ctx);
    if (!picked) {
      return false;
    }
    /**
     * ★ 变体在**这里**抽（整包一起换）—— 冷却/配额/互斥组只看事件，
     *   与抽中哪个变体无关，所以必须等"已经决定播它"之后再抽。
     */
    const entry = resolveEventVariant(picked, eventRandom);
    if (!entry.animation) {
      return false;
    }
    /**
     * ⚠️ 记账（`eventLog.commit`）**不在这里**：由 `onAction` 在"真的开始播"时统一做。
     *   否则一次被忙碌闸门拒绝的抽取会白白吃掉一次配额。
     */
    return touchController.trigger(entry, source);
  };

  /**
   * 触发一次「回到壁纸」事件。**返回值 = 是否真的播了**（供调用方判后续动作）。
   *
   * 这就是"回到壁纸可触发的事件"（`resumeKinds`）那**四个自动信号**的唯一落点：
   *   1. 页面加载完成后延迟 `greetingDelayMs`（= "初次打开壁纸"）；
   *   2. `visibilitychange` 从隐藏回到可见（= "回到桌面"）；
   *   3. `window` 重新获得焦点；
   *   4. WE 暂停后恢复（"回到主界面"，见 `onPauseChange`）。
   *
   * ⚠️ **信号 2/3 在 WE 里默认是收不到的**：桌面壁纸窗口常驻"可见"状态，
   * 不随前台窗口切换而 hidden。只有当用户在 WE 设置里开了
   * 「其他应用最大化时暂停/停止壁纸」，壁纸窗口才会真的隐藏、回到桌面才恢复。
   * 所以这两个监听是**零成本的尽力而为** —— 命中就播，不命中就退化成"只在打开时播"。
   *
   * 用 `lastGreetingAt` 做 5 秒去重：几个信号常在同一时刻接连触发，
   * 没有这层会出现"一句话连播三遍"。★ 去重**管整个通道**（不只是 greet类）——
   * 勾上 chat类 / touch类 之后同样会被几个信号连播。
   *
   * ★ `reason` 现在**参与条件求值**（`when.ctx.signal`）：作者可以写"只在 boot 播"。
   */
  const tryResumeEvent = (reason: string): boolean => {
    if (!touchController) {
      return false;
    }
    const now = Date.now() / 1000;
    /**
     * ★★ 5 秒去重。**必须判负差**（2026-10-21）：改系统日期（验收节日）会让
     *   `now` 退到 `lastGreetingAt` 之前，负差恒 `< 5` ⇒ 问候通道**整体静默**
     *   （连普通问候都不播），且只 `return false`、不留一行日志。
     *   口径：负差 = 时钟被回拨 ⇒ 去重无意义，照常尝试。
     */
    const sinceLast = now - lastGreetingAt;
    if (sinceLast >= 0 && sinceLast < GREETING_DEDUPE_SEC) {
      return false;
    }
    const signal =
      reason === 'boot' || reason === 'visible' || reason === 'focus'
        ? reason
        : 'resume';
    /**
     * ★★ 语音还在念 ⇒ 这次问候**整体跳过**（2026-10-20）。
     *
     * 场景：语音比动作长（或语音来自常驻序列项 ⇒ 不占 `activeEntry`），
     * 暂停/恢复时它被总闸续播着，紧接着 400ms 后这里又要播一条问候 ——
     * `voicePlayer.play()` 的第一步就是 `stop()`，等于把刚续上的那句掐断。
     * 动作闸门（`touch.ts` 的 `decidePlay`）只看**轨道**、看不见语音，挡不住它。
     *
     * ★ 选择"跳过"而不是"等它念完再播"：恢复问候的价值在于"你回来了"这个时刻，
     *   延后十几秒再冒一句更奇怪；而那句正在续播的念白本身就是招呼。
     * ★ 不更新 `lastGreetingAt`（= 不消耗去重窗口）：等语音念完，下一次信号
     *   （如 focus）仍可正常触发。
     */
    if (voicePlayer && voicePlayer.isPlaying()) {
      console.info(
        '[subtitle] 语音仍在播 ⇒ 本次「%s」问候跳过（不掐断续播）',
        reason
      );
      return false;
    }
    const played = playEvent('resume', resumeKinds, 'greet', { signal });
    if (!played) {
      if (reason !== 'boot' && reason !== 'visible' && reason !== 'focus') {
        console.warn('[subtitle] 回到壁纸事件没有可播条目: %s', reason);
      }
      return false;
    }
    lastGreetingAt = now;
    lastActivityAt = now;
    return true;
  };

  /**
   * ★★「回到主界面」问候（2026-09-27）
   *
   * 游戏里每次回主界面会触发 `greet`；桌面上**没有**"回到桌面"事件 —— 桌面壁纸窗口
   * 永远"可见"，`visibilitychange` / `focus` 在 WE 下实测都收不到。
   * 唯一等价信号 = **WE 暂停壁纸之后又恢复**（全屏游戏退出 / 从最大化窗口切回桌面）。
   *
   * 前提（用户侧）：WE 设置 → 性能 →「其他应用程序处于全屏 / 最大化时」= **暂停**。
   * 若选了"停止"，壁纸会被整个卸载、恢复时重新加载页面 ⇒ 走开机问候那条路
   * （`subtitle.greetingDelayMs`），不需要本段。
   *
   * ★ 只有**离开得够久**才打招呼：切个窗口几秒就回来也说一句会很烦。
   * ★ 恢复后**无条件** `markActivity()` 压住待机轮询 —— 否则 `standby` 可能抢在
   *   `greet` 前面播（两者都是自动行为，先到先得，见 `touch.ts` 的优先级表）；
   *   短暂停（< 15s、不播问候）同样需要它，见 `onPauseChange` 里的注释。
   */
  const RESUME_GREET_MIN_SEC = 15;
  /** 恢复后延一拍再播：让画面先动起来，也避开与 boot/visible 撞在同一个去重窗口里 */
  const RESUME_GREET_DELAY_MS = 400;
  /**
   * 「回到壁纸」问候这一路是否**真的可用**（通道里有事件 且 用户勾了类目）。
   *
   * ★ 抽成常量（2026-10-20）：同一个判据现在有**两个**用处 ——
   *   ① 决定要不要挂 boot / visible / focus 三个问候信号；
   *   ② `onPauseChange` 决定"恢复后要不要真去播问候"（它还要复位活动计时，
   *      所以订阅本身不能只挂在问候上，见 `startAutoPlay`）。
   *   两处各写一遍 `eventSource.length && resumeKinds.length` 迟早漂移成
   *   "订阅了却不播"或"没订阅却以为会播"。
   */
  const resumeGreetEnabled = eventSource.length > 0 && resumeKinds.length > 0;
  /** 进入暂停的时刻（秒）。`0` = 当前没在暂停中 */
  let pausedAt = 0;
  const onPauseChange = (isPaused: boolean) => {
    if (isPaused) {
      pausedAt = Date.now() / 1000;
      return;
    }
    // 没经历过暂停（宿主上线时可能补发一次 setPaused(false)）⇒ 不当成"回主界面"
    if (pausedAt <= 0) {
      return;
    }
    const away = Date.now() / 1000 - pausedAt;
    pausedAt = 0;
    /**
     * ★★ 恢复时**无条件**复位活动计时（2026-10-20）。
     *
     * 暂停期间 `Date.now()` 照走（WE 冻结的是渲染进程，墙钟不停），而 `lastActivityAt`
     * 还停在暂停前那一秒 ⇒ 不复位时，"离开的这段时间"全被算成静置
     * ⇒ 恢复后第一个 `tickStandby`（最多 1 秒后）就满足 `standbyIdleMs`，
     *   在语音刚续播起来的时候插一条待机念白，把它掐掉。
     *
     * ⚠️ 必须在下面 `away < RESUME_GREET_MIN_SEC` 的**早退之前** ——
     *   短暂停（切个窗口几秒）同样要复位，那是最常见的一档。
     */
    markActivity();
    /**
     * ★★ 时钟回退（改系统日期做节日验收）会让 `away` 为负。旧写法 `away < 15`
     *   把负差当成"刚暂停就回来"⇒ 恢复问候**永不触发**。负差 = 时钟被回拨，
     *   按"离开很久"处理（放行到下面的问候）。
     */
    if (away >= 0 && away < RESUME_GREET_MIN_SEC) {
      return;
    }
    // 问候这一路没开（通道空 / 用户把三类全关了）⇒ 到这里就结束，只要上面那次复位
    if (!resumeGreetEnabled) {
      return;
    }
    window.setTimeout(() => tryResumeEvent('resume'), RESUME_GREET_DELAY_MS);
  };

  /**
   * 待机轮询（每秒一次）。
   *
   * 为什么用轮询而不是"动作结束回调"：动作结束有三个出口
   * （自然 complete / 被点击打断 / dispose），逐个挂钩子容易漏；
   * 每秒读一次 `isBusy()` 是**单一判据**，不会漏也不会重。
   * 代价是每秒一次空转，可以忽略。
   *
   * ★★ 待机到点后播哪一类（2026-10-09 起是「长时间待机可触发的事件」多选）：
   *   从 `standbyKinds`（= 勾了且可用的 `chat` / `greet` / `touch`）取条 ——
   *   2026-10-18 起走**唯一漏斗** `resolveEvent`（四层：权限 → 条件 → 限流 → 竞争），
   *   与另外两个通道同一份代码；空数组（显式全关）⇒ 什么都不做。
   */
  const tickStandby = () => {
    if (!touchController) {
      return;
    }
    const now = Date.now() / 1000;
    /**
     * ★★ 暂停期间不推进待机（2026-10-20）。
     *
     * 两条理由：
     *   ① 总闸暂停时**不放任何自动事件** —— 此刻起播只会被 `voicePlayer` 记成
     *      `deferredFile`，恢复时从头重跑（等于"暂停里偷偷排了一条"）；
     *   ② 计入静置就更糟：恢复瞬间 `idleMs` 直接过线，念白在画面还没动时就冒出来。
     * ⚠️ 不能只依赖"WE 会冻结进程" —— 冻结边界上那一两个 tick 仍可能落地。
     */
    if (audioMaster.isPaused()) {
      lastActivityAt = now;
      return;
    }
    /**
     * ★ `isBusy()` 只看得见**轨道**（动作），看不见语音。而念白比动作长是常态
     *   ⇒ 语音还在念时同样要算"有事在做"，否则待机会在上一句刚说完半截时插一条新的。
     */
    if (touchController.isBusy() || (voicePlayer && voicePlayer.isPlaying())) {
      // 还有动作/念白在播 ⇒ 视为"仍在活动"，计时重新起算
      lastActivityAt = now;
      return;
    }
    const idleMs = (now - lastActivityAt) * 1000;
    if (idleMs < standbyIdleMs) {
      return;
    }
    if (!standbyKinds.length) {
      // 显式把三类都关掉（`standbyKinds: []`）⇒ 待机不自动播任何东西
      return;
    }
    /**
     * ★★ `source` 必须给 **`'standby'`** 而不是 `'touch'`：这是**自动播放**，
     *   按 `touch.ts` 的闸门表，`'touch'` 会去**打断**正在演的问候/动作，
     *   而自动播放只该"让位不抢戏"。给了 `'touch'` 还会污染点击统计口径。
     *
     * ★ `idleMs` 注入条件层：作者可以写 `when.ctx.idleMs: 60000` 表达"静置满一分钟"，
     *   不必再往事件上挂一个 `requiresIdle` 字段（PLAN §0 #8）。
     * ★ 只有**真播了**才重置计时：闸门挡下（返回 false）时不重置，下一秒 tick 会再试。
     */
    if (playEvent('standby', standbyKinds, 'standby', { idleMs })) {
      lastActivityAt = now;
    }
  };

  /** 资源全部就绪后启动自动播放（只在 `waitLoad` 里调一次） */
  const startAutoPlay = () => {
    /**
     * ★ 计时起点必须是**"可交互"这一刻**，不能沿用模块加载时刻。
     *
     * `lastActivityAt` 的初值在模块加载时就设了，而资源加载（骨架 367 KB + 贴图数 MB）
     * 可能耗时数秒。若不移位，慢机器上会出现"刚进画面、还没看清就播待机"——
     * 因为 `now - lastActivityAt` 已经把加载耗时算成了空闲时间。
     */
    markActivity();

    /**
     * 背景音乐：在这里起播（资源已就绪 = "开场"）。
     *
     * ★ 与 `dialogues` 无关 —— 必须放在 `if (dialogues.length)` **之外**，
     *   否则"把念白全删掉"会连带 BGM 也哑掉（两件事本无依赖）。
     *
     * 首次 `play()` 大概率被自动播放策略拒（此时还没有用户交互），
     * `bgmPlayer` 内部会挂一次性交互解锁 —— 首次点击/按键后自动重试。
     */
    if (bgmPlayer) {
      bgmPlayer.start();
      /**
       * ★ 暂停/恢复**不再在这里挂监听**。
       *
       *   1. **WE 侧（权威）**：`window.wallpaperPropertyListener.setPaused` ——
       *      ★ WE 暂停壁纸时**只会**发这个，**不会**触发 `visibilitychange`
       *      （壁纸窗口始终"可见"，WE 是冻结渲染进程）。
       *      早期版本只挂了 `visibilitychange` ⇒ 现象是"画面停了、BGM 照常响"。
       *   2. **浏览器侧（兜底）**：普通标签页切走/切回。
       *
       * 两条现在都由 `audioMaster` 统一处理（见上面的 `createAudioMaster()`），
       * 且**同时覆盖 BGM 与角色语音** —— 以前这里只调 `bgmPlayer`，
       * 语音会漏。两路的幂等在各自播放器内已保证，重复触发无副作用。
       */
    }

    /**
     * ★★「回到壁纸可触发的事件」（`resumeKinds`）的**前三个**信号入口 ——
     *   第四个（WE 暂停/恢复）在下面单独订阅，因为它的订阅条件更宽。
     *
     * 判据用 `resumeKinds`（已勾选**且**可用）而不是"配了 greet 条目"：
     * 用户把三类**显式全关**（`resumeKinds: []`）时，不必再挂一堆永远返回 false 的监听。
     * ⚠️ 反过来说：**缺省（没配 `resumeKinds`）会勾上 `greet`** ⇒ 只要配了问候就一定会挂。
     */
    if (resumeGreetEnabled) {
      window.setTimeout(() => tryResumeEvent('boot'), greetingDelayMs);
      document.addEventListener(
        'visibilitychange',
        () => {
          if (!document.hidden) {
            tryResumeEvent('visible');
          }
        },
        false
      );
      window.addEventListener('focus', () => tryResumeEvent('focus'), false);
    }
    /**
     * ★ WE 的暂停/恢复信号（"回到主界面"）。订阅而非直接写 `wpl.setPaused`
     *   —— 那个字段是单赋值，BGM 也在用它，写两次必有一个静默失效。
     *
     * ★★ 订阅条件**不再等于**"问候可用"（2026-10-20）：`onPauseChange` 还负责
     *   恢复时复位活动计时（见那里的注释）。若只挂了待机通道、问候全关，
     *   没有这个订阅就没人复位 ⇒ 恢复后第一个 tick 立刻弹待机念白。
     *   ⇒ 只要**待机或问候**有一路要用，就得订阅；播不播问候由 `onPauseChange` 内部判。
     */
    if (resumeGreetEnabled || standbyKinds.length) {
      subscribePause(onPauseChange);
    }
    /**
     * ★ 判据用 `standbyKinds`（已勾选**且**可用）而不是"配了 `chat` / `standby` 条目"：
     *   用户把三类**显式全关**（`standbyKinds: []`）时，不必再挂一个每秒空转的定时器。
     *   ⚠️ 反过来说：**缺省（没配 `standbyKinds`）会勾上 `chat`** ⇒ 只要配了闲聊就一定有这个定时器。
     */
    if (standbyKinds.length) {
      window.setInterval(tickStandby, 1000);
    }
  };

  /**
   * 摩天轮轿厢姿态角（面板「壁纸独立设置」页的设置；2026-10-11 从「画面调整」页挪走）。
   *
   * ★ 在这里**一次算好**再传给各粒子系统：`startRotation` 是粒子**出生时**读的，
   *   切模式必须重载页面才生效（与气泡 DOM / 语音播放器同为开机一次性构造）。
   *
   * ★ 只给"轿厢组"传，其余粒子系统一律 `undefined` ⇒ `ParticleAnimator` 不干预
   *   它们的出生朝向（飞鸟/气球/云各有各的 `startRotation`，不能被误伤）。
   */
  const cabinMode = configs.ferrisWheel?.cabinMode ?? 'gravity';
  const cabinGroups = configs.ferrisWheel?.cabinGroups ?? DEFAULT_CABIN_GROUPS;
  /**
   * 轿厢**图元自带**的重力倾角（度）：抵消素材里那一份（2026-10-11 修正的远古 bug）。
   *
   * ★ 缺省 **15**（本项目实测：图元按画面重力画的，相对画布歪约 15°）——
   *   不补的话「解包数据」会渲染成 −30°、「游戏实测」会渲染成 −15°，两个档位都多歪 15°。
   * ★ 与 `cabinMode` 一样**只给轿厢组传**：其余 6 组粒子没有"实录"这种绝对参照，
   *   一律传 0（`ParticleAnimator` 里也按 0 兜底）⇒ 解包原样不动。
   * ★ 取值理由与量法见 `config.type.ts` 的 `FerrisWheelConfig.spriteTiltDeg`。
   */
  const cabinSpriteTiltDeg = configs.ferrisWheel?.spriteTiltDeg ?? 15;

  /**
   * loader
   */
  configs?.meshes?.forEach((meshConfig) => {
    switch (meshConfig?.type) {
      case 'spine': {
        // load scheleton
        if (meshConfig.skeletonFileName) {
          spineAssetManager.loadBinary(meshConfig.skeletonFileName);
        } else if (meshConfig.jsonFileName) {
          spineAssetManager.loadText(meshConfig.jsonFileName);
        } else {
          throw 'missing skeleton file';
        }
        // load atlas
        if (meshConfig.atlasFileName) {
          spineAssetManager.loadTextureAtlas(
            meshConfig.atlasFileName,
            // onLoad callback
            () => {
              // skip
            },
            // onError callback
            (path: string, error: string) => {
              console.error('Cannot load spine', path, error, meshConfig);
            }
          );
        }
        break;
      }
      case 'texture':
      case 'particle': {
        if (!meshConfig.textureFileName) {
          throw 'missing texture file path';
        }
        /**
         * particle 可能有第二张贴图（`_mask` 槽）。**必须一起加载**：
         * `UVliudong` 的片元要 `texture2D(_mask, maskUV)` 与 `_Texture` 相乘，
         * 缺它遮罩就没了（而"08 合成成品图"那条路已被证伪 —— shader 是两次独立采样，
         * 且 `_Texture` 走流动 UV、`_mask` 走静止 UV，合成会把两者混成一个）。
         */
        const texNames: string[] = [meshConfig.textureFileName];
        if (meshConfig.type === 'particle' && meshConfig.maskFileName) {
          texNames.push(meshConfig.maskFileName);
        }
        for (const texName of texNames) {
          if (!!threeAssetList[texName]) {
            // texture has been loaded, skip
            continue;
          }
          threeAssetList[texName] = null;
          const textureLoader = new THREE.TextureLoader();
          textureLoader.load(
            ASSET_PATH + texName,
            // onLoad callback
            (texture: THREE.Texture) => {
              threeAssetList[texName] = texture;
            },
            // onProgress callback currently not supported
            undefined,
            // onError callback
            (err: ErrorEvent) => {
              console.error('Cannot load texture', err, meshConfig);
            }
          );
        }
        break;
      }
      case 'video': {
        // video texture is loaded from <video> dom element
        break;
      }
      default:
        break;
    }
  });

  /**
   * 指针拖尾的贴图。
   *
   * 刻意走**同一个 `threeAssetList`** —— 这样 `waitLoad` 那句
   * "threeAssetList 里没有 null"的判据自动把它算进去，不必另写一套等待逻辑；
   * 缺了这张图时 `waitLoad` 会一直轮询（与背景贴图同一行为，便于早发现）。
   */
  (configs.pointerTrail?.emitters || []).forEach((emitter) => {
    const texName = emitter.textureFileName;
    if (!texName || !!threeAssetList[texName]) {
      return;
    }
    threeAssetList[texName] = null;
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      ASSET_PATH + texName,
      (texture: THREE.Texture) => {
        threeAssetList[texName] = texture;
      },
      undefined,
      (err: ErrorEvent) => {
        console.error('Cannot load pointerTrail texture', err, emitter);
      }
    );
  });

  /**
   * when everthing is fully loaded, setup each animation update() function
   */
  const waitLoad = () => {
    // if spine assets are loaded and three assets are also loaded
    if (
      spineAssetManager.isLoadingComplete() &&
      !Object.entries(threeAssetList).some(([assetPath, texture]) => !texture)
    ) {
      configs?.meshes?.forEach((meshConfig) => {
        switch (meshConfig.type) {
          case 'spine': {
            const spineAnimator = new SpineAnimator(
              meshConfig,
              spineAssetManager
            );
            // 探针：登记骨架里真实存在的动画名（读运行时数据，不重复解析 .skel）
            const skeletonData = spineAnimator.getSkeletonData();
            const skeletonFile =
              meshConfig.skeletonFileName ?? meshConfig.jsonFileName ?? '';
            const allAnimations =
              skeletonData?.animations?.map((it) => it.name) ?? [];
            registerProbeSkeleton(skeletonFile, allAnimations);
            // 探针：登记 track 采样器，用于观察触摸动画是否卡循环
            registerProbeTrackSampler(
              skeletonFile,
              spineAnimator.getTrackSnapshot
            );

            /**
             * 角色骨架判定：仅对**角色骨架**做触摸交互与常驻序列。
             *
             * 为什么不给所有 spine mesh 都挂：爱心层（BJ_01）只有 idle 一个动画，
             * 没有可播的触摸动画，挂上去只会白白多一个监听器。
             * 判据 = 「除常驻动画外还有别的动画可播」。
             */
            const baseIdleName = meshConfig.animationName;
            /**
             * ★★ **常驻动画跟着动作族换名**（2026-10-17）—— 游戏 `GotoIdleState` 在
             *   誓约后用 `idle_marry`，壁纸侧必须一致，否则"誓约后"只换了触摸动作、
             *   待机仍是婚前的（戒指不戴），一眼看出没复刻。
             *
             * ★ 换名规则与念白条目**同一个纯函数**（`resolveAnimationName`）；
             *   是否真换由骨架动画表决定：挂件骨架（`*_BJ_*`）根本没有 `_marry` 动画
             *   ⇒ 保持原常驻动画，**不算错**（`resolveIdleAnimation.fallback` 只是"没换"）。
             */
            const idleResolved = resolveIdleAnimation(
              baseIdleName,
              allAnimations,
              fams,
              actionPhase
            );
            const idleName = idleResolved.name;
            if (idleResolved.fallback) {
              const suffix = fams.suffixOf(actionPhase);
              const hasAnyVariant =
                !!suffix && allAnimations.some((n) => n.endsWith(suffix));
              /**
               * ★ 两种"没换"要分开报：骨架里**一条该族的动画都没有**（挂件骨架、
               *   非誓约皮肤）属正常 ⇒ `info`；**有变体却唯独缺常驻那条** ⇒ `warn`
               *   （config 写错了动画名才会走到这里，必须能在控制台看见）。
               */
              const msg =
                '[subtitle] %s: 动作族 "%s" 的常驻动画应播 "%s"，骨架里没有 ⇒ 保持 "%s"';
              if (hasAnyVariant) {
                console.warn(
                  msg,
                  skeletonFile,
                  actionPhase,
                  resolveAnimationName(baseIdleName, fams, actionPhase),
                  baseIdleName
                );
              } else {
                console.info(
                  msg,
                  skeletonFile,
                  actionPhase,
                  idleResolved.want,
                  baseIdleName
                );
              }
            } else if (idleName !== baseIdleName) {
              spineAnimator.setIdleAnimation(idleName);
            }
            /**
             * ★ `touchNames` 同时排除**原常驻名**与**换名后的常驻名**：
             *   否则 `idle_marry` 会被当成"可触摸动作"混进兜底池（池为空时的随机动画名单）。
             */
            const touchNames = allAnimations.filter(
              (n) => n !== idleName && n !== baseIdleName
            );
            /**
             * 角色骨架判据。
             *
             * ★ 优先用**显式声明** `meshConfig.isCharacter`（2026-10-13 新增，见 `config.type.ts`）：
             *   启发式「除常驻动画外还有别的动画可播」会被**多带一个动画的挂件骨架**骗过
             *   —— 蝶语吟花 `SoulDress_Freesia_06_BJ_04.skel` 有 `['idle','idle2']`，
             *   于是挂件被当成角色、把 `animationDurations` 覆盖掉并抢走 `touchController`
             *   ⇒ 触摸/问候/待机全部静默失效（点了没反应、不报错）。
             * ★ 字段**缺席 ⇒ 仍走原启发式**：老工程（S8/S9）行为逐字不变。
             */
            const isCharacter =
              typeof meshConfig.isCharacter === 'boolean'
                ? meshConfig.isCharacter
                : touchNames.length > 0;

            if (isCharacter) {
              /**
               * 只有角色骨架往 `animationDurations` 里写（见该变量的声明处注释）。
               * 必须在挂控制器之前填好 —— `onAction` 回调里会立刻查这张表算字幕时长。
               */
              (skeletonData?.animations ?? []).forEach((anim) => {
                animationDurations[anim.name] = anim.duration ?? 0;
              });
              console.info(
                '[subtitle] 角色骨架动画时长表: %s',
                Object.keys(animationDurations)
                  .map((k) => k + '=' + animationDurations[k].toFixed(2) + 's')
                  .join('  ')
              );

              /**
               * ★★ **事件表校验的唯一接线点**（2026-10-18，PLAN §6.3）。
               *
               * 骨架就绪 + 热区/粒子组已知 ⇒ 一次性算出：
               *   - `unplayable`：`validate:'strict'` 下被判 `reject` 的事件（漏斗第 ① 层依据）；
               *   - `fixed`：`coerce` 补丁（**就地应用**，`phasedDialogues` 与池共享对象引用）；
               *   - `validationReport`：档案汇总 + `__WB_DIALOGUE__.validation()` 用。
               *
               * ⚠️ 门禁**不散落到消费点**：只把 `unplayable` 塞进漏斗。
               * ⚠️ 运行时不报 `E_VOICE_MISSING`（`file://` + CORS 无法遍历目录，见
               *   `eventValidate.ts` 文件头）—— 语音只靠 `voicePlayer` 的降级链。
               */
              const particleNames = (configs.meshes ?? [])
                .map((m) => (m as { name?: string })?.name)
                .filter((n): n is string => typeof n === 'string' && !!n);
              /**
               * ⚠️ 校验用 **`activeDialogues`**（事件族闸门**之前**）：
               *   `W_FAMILY_NOT_ENABLED` 的意义正是"这条属于未勾选的族"——
               *   若拿 `phasedDialogues`，它们已被筛掉，这条永远报不出来。
               *   （动画存在性仍只对"当前动作族可见"的条目判，别的动作族不在
               *   `activeDialogues` 里，不会误报。）
               */
              validationReport = validateEvents(activeDialogues, {
                animations: allAnimations,
                particleNames,
                zoneIds: touchZones.map((z) => z.id),
                familyIds: fams.families.length ? fams.ids : null,
                fallbackFamilyId: fams.fallbackId,
                enabledFamilyIds: fams.families.length ? phases : null,
                /** ★ 用**推导后**的族：`keyPrefix` / `matchSuffix` 归族的条目不写 `phase` */
                familyOf: (e) => resolveDialoguePhase(e, fams),
                actionPhase,
                projectAnimation: (n) =>
                  resolveAnimationName(n, fams, actionPhase),
                mode: subtitleCfg?.validate ?? 'warn',
              });
              /** 归一阶段 + 校验阶段的 issue 合并（`validation()` / 档案看到的是全集） */
              validationReport.issues = normalizeIssues.concat(
                validationReport.issues
              );
              /** 应用 `coerce` 补丁（就地改：池、档案、播放共享同一批对象） */
              Object.keys(validationReport.fixed).forEach((key) => {
                const target =
                  findByEventKey(phasedDialogues, key) ??
                  findByEventKey(eventTable, key);
                if (target) {
                  Object.assign(target, validationReport?.fixed[key]);
                }
              });
              validationReport.unplayable.forEach((k) => {
                unplayable[k] = true;
              });
              /**
               * 日志：`error` 逐条（`reject` 会让事件不播，必须能看见原因）；
               * 其余只打一行汇总，避免刷屏。
               */
              validationReport.issues.forEach((it) => {
                if (it.level === 'error') {
                  console.error(
                    '[subtitle] %s %s: %s',
                    it.code,
                    it.id || '(工程)',
                    it.detail
                  );
                }
              });
              if (validationReport.issues.length) {
                console.info(
                  '[subtitle] %s（validate=%s，unplayable=%d）',
                  summarizeReport(validationReport),
                  subtitleCfg?.validate ?? 'warn',
                  validationReport.unplayable.length
                );
              }
              /**
               * ★★ **整条通道全是 `weight:0` 的启动告警**（2026-10-18 线上 bug 的守门）。
               *
               * `weight:0` = "只手动播"。若某个通道**所有**候选都这么写，那这个通道
               * 永远抽不出东西 —— 而运行时完全静默：`firedCount`/`skippedCount` 都不涨、
               * 没有异常、池大小看着还挺正常。用户只能看到"点了完全没反应"。
               *
               * 档案面板会把这类条目标「仅手动」，但那只在打开档案时才看得见；
               * ⇒ 启动时打一行 warn，把"点不动"和"配置写错"直接连起来。
               */
              (
                [
                  ['touch', touchKinds],
                  ['standby', standbyKinds],
                  ['resume', resumeKinds],
                ] as [TriggerChannel, TriggerEventKind[]][]
              ).forEach(([ch, ks]) => {
                /**
                 * ★ 2026-10-21（B 案）：`on` 不再限制通道 ⇒ 这里**不能再按通道过滤**，
                 *   否则告警会漏报（勾了 touch 类的待机通道，实际候选全在这里）。
                 *   只保留"非空 = 可达"这一条，与漏斗 / `poolOfKind` 同口径。
                 */
                const pool = mergeKindPools(ks, KIND_POOLS, fams).filter(
                  (e) => channelsOf(e).length > 0
                );
                if (!pool.length) {
                  return;
                }
                if (pool.some((e) => eventWeightOf(e) > 0)) {
                  return;
                }
                console.warn(
                  '[subtitle] 「%s」通道的 %d 条候选**全部**是 pick.weight:0 ⇒ 该通道永远不会自动触发' +
                    '（只能从调试面板手动播）。去掉 weight 或改成 >0 即可恢复：%s',
                  ch,
                  pool.length,
                  pool.map((e) => eventKeyOf(e)).join(', ')
                );
              });

              /**
               * 常驻动作序列（config 顶层 `idleSequence`）：顶替 idle 占住 track 0。
               *
               * ★ 必须在 `createTouchController` **之前**建：控制器要拿它的
               * `animationNames()` 放宽"是否处于常驻态"的判据 —— 否则序列一启用，
               * track 0 的名字不再恒等于 idle，**触摸会彻底播不出来**（点了没反应、不报错）。
               *
               * ★ 每播到一项都走 `showDialogue`：给了 `actionId` 就连台词+语音一起播，
               * 只给动画名则走 `entry=null` 分支（收起气泡 + 停掉上一条语音）。
               */
              idleSequence = createIdleSequence(
                configs.idleSequence,
                spineAnimator.getSkeletonMesh(),
                {
                  availableAnimations: allAnimations,
                  /**
                   * ★ 传**投影后**的念白表：序列项若写 `actionId`，播的必须是当前动作族的
                   *   那条动画名（`chat` vs `chat2_marry`），否则序列会绕过动作族。
                   */
                  entries: dialoguesAuto,
                  /**
                   * 裸动画名（`"items": ["idle", …]`）也跟动作族走 —— 规则与念白同源
                   * （`resolveAnimationName`），本模块只负责"收到名字就换"。
                   */
                  resolveAnimation: (name) =>
                    resolveAnimationName(name, fams, actionPhase),
                  /**
                   * ★ 事件族是**全局闸门**（2026-10-17）：被勾掉的族的条目不能经由常驻序列
                   *   漏出来 ⇒ 序列项写 `key` / `actionId` 时先问一句"这个 id 现在允许吗"。
                   *   ⚠️ 判据来自 `phasedDialogues`（同一套闸门），本模块不自己判族。
                   *
                   * ★★ 2026-10-20 修：入参是 `idleSequence.resolveSequence` **归一后的
                   *   `EventKey`（字符串）**，而表里的 `actionId` 是 `number` ——
                   *   `d.actionId === id` 恒假 ⇒ 所有 `{actionId}` / `{key}` 项都被误判成
                   *   "所属事件族未勾选"整项跳过（内置事件也一样）。必须两边都归一再比。
                   */
                  isActionAllowed: (id) => {
                    const key = normalizeEventKey(id);
                    return (
                      !!key &&
                      phasedDialogues.some((d) => eventKeyOf(d) === key)
                    );
                  },
                  onItem: (entry, animation) => showDialogue(entry, animation),
                }
              );

              if (touchActive) {
                if (touchShowZones && !zoneOverlay) {
                  zoneOverlay = createTouchZoneOverlay(touchZones);
                }

                /**
                 * 触摸池：动作与字幕**同源**。
                 *
                 * ★★ 2026-10-18 起**通道内不再自己抽**（PLAN §4.1 的 #2）：控制器拿的是
                 * `pick(zoneId)` 回调，真正的取条走唯一漏斗 `resolveEvent('touch', ...)`
                 * —— 条件 / 冷却 / 配额 / 优先级 / 变体全部在那一处。
                 * ⇒ 播哪个动作就显示哪句台词，天然配套不会串。
                 *
                 * ⚠️ 控制器是**开机一次性构造**（见 `settingsStore` 文件头的"生效方式"）
                 * ⇒ 改设置要**重载**才生效。
                 */
                if (!touchPool.length && subtitleCfg?.touch?.length) {
                  console.warn(
                    '[subtitle] 触摸可触发的事件里没有任何可播条目（subtitle.touch 的 id 没一条能在 subtitle.dialogues 里找到）⇒ 退化为只播动作、不出字幕'
                  );
                }

                touchController = createTouchController(
                  spineAnimator.getSkeletonMesh(),
                  {
                    skeletonFile,
                    idleAnimationName: idleName,
                    extraIdleAnimations: idleSequence?.animationNames() ?? [],
                    /**
                     * ★ 序列接管 track 0 时，触摸改成「排队到 track 0 顺序播放」。
                     *
                     * 叠加（原行为）会让 track 2 的 ColorTimeline 压掉序列设好的
                     * slot 透明度 ⇒ 正被序列显示着的部件透明消失。
                     * 未启用序列时传 `undefined` ⇒ 触摸继续叠加在 track 2，行为不变。
                     */
                    queueTrack: idleSequence ? IDLE_TRACK : undefined,
                    /**
                     * ★ 正在播动作时点击该怎么处理（`config.subtitle.touchFeedbackMode`，
                     *   缺省 `'immediate'` = 打断并立刻播新的）。三档语义见该类型的注释，
                     *   用户在「设置 → 事件触发」页可随时改。
                     */
                    touchFeedbackMode: subtitleCfg?.touchFeedbackMode,
                    /** 触摸播完 ⇒ 把 track 0 交还序列，从下一条继续 */
                    onActionFinished: (mixSeconds) =>
                      idleSequence?.resume(mixSeconds),
                    touchAnimations: touchNames,
                    zones: touchZones,
                    /** ★ 唯一漏斗：命中哪个热区 → 哪一条（由 `resolveEvent` 决定） */
                    pick: (zoneId) =>
                      resolveEvent('touch', touchKinds, { zone: zoneId }),
                    poolSize: touchPool.length,
                    // 命中哪块就把哪块点亮——桌面上截图即可判读热区位置对不对；
                    // ★ 同时把"本次命中的全部候选"传进去 ⇒ 重叠处能看出谁赢、谁被压住
                    onZoneHit: (hit) =>
                      zoneOverlay &&
                      zoneOverlay.highlight(
                        hit?.zone?.id ?? null,
                        hit ? hit.candidates.map((z) => z.id) : []
                      ),
                    // 每播一条念白：刷新待机计时 + 同步字幕（动作与字幕来自同一条）
                    onAction: (payload) => {
                      markActivity();
                      /**
                       * ★★ **漏斗的记账点**（PLAN §4.2 第 ③ 层）。
                       *
                       * 三个通道都汇到这里，且只有**真的开始播**才会回调
                       * ⇒ 冷却 / 配额 / 互斥组不会被"抽到了但被闸门拒绝"白白消耗。
                       */
                      if (payload.entry) {
                        eventLog.commit(payload.entry, Date.now());
                      }
                      showDialogue(payload.entry, payload.animation);
                    },
                  }
                );
                registerProbeTouch(skeletonFile, touchController.snapshot);
              }
            }

            meshUpdateCallbacks.push(function (delta: number) {
              spineAnimator.update(delta);
            });
            break;
          }
          case 'texture': {
            const textureAnimator = new TextureAnimator(
              meshConfig,
              threeAssetList[meshConfig?.textureFileName]
            );
            meshUpdateCallbacks.push(function (delta: number) {
              textureAnimator.update(delta);
            });
            break;
          }
          case 'particle': {
            /**
             * 粒子：与分层背景共用同一个 three.js 场景与渲染循环，
             * 只靠 `position.z` 决定它夹在哪两层之间 —— 这样"Layer_01 的粒子在
             * 背景层之间、Layer_02 的粒子在角色之前/之后"不需要另开渲染通道。
             * 参数与依据见 src/animator/ParticleAnimator.ts 顶部注释。
             *
             * `maskFileName` 只有 saoguang 有；其余 7 个为 undefined ⇒ 构造里
             * 用 1×1 白图代替（等价于 Unity 空槽采样得 (1,1,1,1)）。
             */
            const particleAnimator = new ParticleAnimator(
              meshConfig,
              threeAssetList[meshConfig?.textureFileName],
              meshConfig.maskFileName
                ? threeAssetList[meshConfig.maskFileName]
                : null,
              // ★ 只有轿厢组才传姿态模式；其余传 undefined（不干预）
              cabinGroups.indexOf(meshConfig.name) >= 0 ? cabinMode : undefined,
              // ★ 同理：只有轿厢组才补"图元自带倾角"，其余传 0（保持解包原样）
              cabinGroups.indexOf(meshConfig.name) >= 0 ? cabinSpriteTiltDeg : 0
            );
            particleAnimators.push(particleAnimator);
            // ★ `config.actionEffects` 按名字找实例 ⇒ 建索引（见 `particleByName` 的说明）
            if (meshConfig.name) {
              particleByName[meshConfig.name] = particleAnimator;
            }
            meshUpdateCallbacks.push(function (delta: number) {
              particleAnimator.update(delta);
            });
            break;
          }
          case 'video': {
            const videoAnimator = new VideoAnimator(meshConfig);
            // meshUpdateCallbacks.push(function (delta: number) {
            //   videoAnimator.update(delta);
            // });
            break;
          }
          default:
            break;
        }
      });

      /**
       * 指针（鼠标）拖尾粒子（可选）。
       *
       * 与背景粒子共用同一个场景与渲染循环 —— `update` 挂进 `meshUpdateCallbacks`，
       * 于是 WE 暂停恢复时的"delta 钳位"（见 render() 的注释）对它同样是同一套保护，
       * 不必再写一遍。
       */
      if (configs.pointerTrail?.enabled) {
        pointerTrail = new PointerTrail(configs.pointerTrail, threeAssetList);
        meshUpdateCallbacks.push(function (delta: number) {
          if (pointerTrail) {
            pointerTrail.update(delta);
          }
        });
      }

      requestAnimationFrame(render);

      // 资源就绪 ⇒ 启动"首次打开问候"与"空闲待机"的自动播放
      startAutoPlay();

      /**
       * 探针（**只在 `--env probe=on` 的构建里存在**）：把粒子系统暴露给 CDP，
       * 并允许"冻结 + 定步长推进"。
       *
       * 为什么需要它：粒子的位置/速度/寿命是**时间相关**的量，
       * 靠截图只能看出"有没有"，量不出"每秒走多少像素"。
       * 而验证"速度是不是按游戏数据来的"必须读运行时真值；
       * 定步长推进则保证这一步可复现（rAF 的 dt 每次都不同）。
       * 用 `PROBE_OPTS.enabled` 把关，正式壁纸里这段会被编译掉。
       */
      /**
       * 念白控制器的**只读 + 主动触发**钩子。
       *
       * 为什么需要：待机/问候/打断规则都跟**真实时间**挂钩（25 秒空闲、5 秒问候去重），
       * 而无头截图的虚拟时间会把这些定时器快进、`setInterval` 的边界行为也不可信，
       * 靠截图测不出"队列容量 1"这种时序规则。有了这个钩子就能在真实页面里
       * 精确驱动：等 idle → 点 → 立刻再点 → 读 snapshot 的命中/跳过计数。
       *
       * `trigger` 只接受 actionId（不接受任意动画名），避免被当成"随便播动画"的后门。
       */
      (window as unknown as { __WB_DIALOGUE__?: unknown }).__WB_DIALOGUE__ = {
        snapshot: () => (touchController ? touchController.snapshot() : null),
        /**
         * 角色骨架的「动画名 → 时长(秒)」表。
         *
         * 为什么要暴露：字幕停留 = `min(TextTime, 动画时长)`，而当
         * `TextTime <= 动画时长` 时两种取值结果相同 ⇒ **光看字幕停留测不出这张表有没有填对**。
         * 有了它就能直接断言，而不是靠间接推断。
         */
        durations: () => animationDurations,
        /** 最近一次发起播放的语音文件名（'' = 没播过）。见 `lastVoiceFile` 的注释 */
        lastVoice: () => lastVoiceFile,
        /**
         * 全部念白的文案（只读）。给"字幕排版能力"的测量脚本用。
         *
         * 为什么暴露它：换行阈值要**拿真实文案去量**才有意义 ——
         * 用假字符串测出来的"能放几个字"无法回答"这 10 条里有没有会换行的"。
         */
        probeTexts: () =>
          eventTable.map((it) => ({
            actionId: it.actionId,
            /** 自定义事件没有 actionId ⇒ 用 `id` 定位 */
            id: it.id,
            text: it.text,
          })),
        isBusy: () => (touchController ? touchController.isBusy() : false),
        /**
         * **事件表快照**（只读）—— 归一 + 覆盖层之后的真相。
         *
         * 为什么需要：验收「自定义事件」时必须能回答"面板里新建的那条到底有没有进表、
         * `on` / `when` 是不是我以为的那样"，而不是靠截图猜。
         */
        events: () =>
          eventTable.map((e) => ({
            id: eventKeyOf(e),
            name: e.displayName || e.label || '',
            on: channelsOf(e),
            kind: kindOf(e),
            when: e.when ?? null,
            animation: e.animation,
            particles: e.particles ?? null,
            voice: e.voice ?? null,
            enabled: e.enabled !== false,
          })),
        playing: () =>
          touchController ? touchController.playingAnimation() : '',
        /**
         * 按 `EventKey` 播一条（待机/问候同路径，走 `trigger` 的同一套打断规则）。
         *
         * ★ 2026-10-18：收 `number | string`（`64005` / `'64005'` / `'game:64005'` /
         *   `'custom:xxx'`），归一后查表。**仍然拒绝任意动画名** —— 后门口径不变
         *   （查不到条目 ⇒ `null` ⇒ 不播）。
         * ★ `weight:0` 的事件只能从这里手动播（自动通道永不选中它）。
         */
        trigger: (key: EventKeyInput, source?: string) => {
          if (!touchController) {
            return false;
          }
          /**
           * ★★★ 从 `phasedDialogues` 找（= 动作族投影 + 存在性 + **全局事件族闸门**）
           *   —— 与真实点击/待机**完全同源**。
           *   ⚠️ 不能退化成 `activeDialogues`：那样探针会绕过事件族，读数与真实行为不符。
           */
          const entry = findByEventKey(phasedDialogues, key);
          const src =
            source === 'greet' || source === 'standby' ? source : 'touch';
          return entry ? touchController.trigger(entry, src) : false;
        },
        /**
         * **事件表校验报告**（PLAN §6.3）。回归断言用。
         *
         * `null` = 还没跑到校验（骨架未就绪）。
         */
        validation: () => validationReport,
        /** 事件日志快照（冷却/配额/互斥组的运行时真值，调试用） */
        eventLog: () => eventLog.snapshot(),
        /** 模拟一次热区点击（与真实 mousedown 走完全相同的代码路径） */
        click: (u = 0.5, v = 0.5) => {
          document.dispatchEvent(
            new MouseEvent('mousedown', {
              clientX: window.innerWidth * u,
              clientY: window.innerHeight * v,
              bubbles: true,
            })
          );
        },
        /**
         * 背景音乐状态（只读）。给验证脚本断言"BGM 真的在响"用。
         *
         * 为什么需要：BGM 的 `<audio>` 元素**不进 DOM**（与语音同一口径），
         * `document.querySelector('audio')` 找不到它 ⇒ 只能靠这个钩子。
         *
         * `playing` 为 false 不一定是 bug：首次自动播放被拒属预期
         * （此时 `unlocked` 仍是 false，等首次点击会自愈）。
         */
        /**
         * 常驻动作序列状态（只读）。未启用时返回 `null`。
         *
         * 为什么需要：序列跑在 track 0 上、是"自己播自己的"，
         * 靠截图只能看出"这一帧在演什么"，量不出"有没有真的往下一条走"。
         */
        /**
         * 运行时设置（只读）。给验证脚本断言"面板里显示的值 == 真正在跑的值"用。
         *
         * 为什么需要：`configs` 是模块内的局部变量，外部看不到；
         * 而"面板显示 80%"和"BGM 实际音量 0.8"是不是一回事，必须能核对。
         */
        settings: () => ({
          overrides: readOverrides(),
          view: readView(configs),
          defaultView: readView(rawConfigs),
          /** 设置面板当前是否展开（判"入口在不在"用下面的 `cornerVisible`） */
          panelOpen: settingsUI ? settingsUI.isOpen() : false,
          /** 免责声明弹窗当前是否显示（验证脚本断言开关联动用） */
          disclaimerVisible: disclaimerUI ? disclaimerUI.isVisible() : false,
          /** 档案面板当前是否显示 + 表格行数（验证脚本断言开关联动与内容渲染用） */
          archiveVisible: archiveUI ? archiveUI.isVisible() : false,
          archiveRows: archiveUI ? archiveUI.rowCount() : 0,
          /**
           * 右上角入口列的状态（验证脚本断言"折叠/静音按钮真的改了东西"用）。
           *
           * ★ 为什么要把这三个读成快照而不是看 DOM：`display` 是**结果**，
           *   而"面板自己的状态变量"才是判据（例如收起时面板应被一起关掉 ——
           *   只看 DOM 也能看出来，但 `open` 状态是持久化的，必须一并核对）。
           * ★ `cornerVisible` = 整列（含折叠按钮）显不显示 = WE `showCornerButtons`；
           *   自 2026-10-17 晚起它是**唯一**的入口显隐真值（`panelVisible` 已随之删除）。
           */
          cornerVisible: settingsUI ? settingsUI.isCornerVisible() : false,
          cornerCollapsed: settingsUI ? settingsUI.isCornerCollapsed() : false,
          /** 运行时静音当前是否生效（= `runtimeMuted`，不是配置里的 `muteAll`） */
          muted: runtimeMuted,
        }),
        idleSeq: () => (idleSequence ? idleSequence.snapshot() : null),
        /** 手动把常驻序列推到下一条（验证脚本用，避免干等动画播完） */
        idleSeqNext: () => (idleSequence ? idleSequence.next() : ''),
        bgm: () =>
          bgmPlayer
            ? {
                playing: bgmPlayer.isPlaying(),
                volume: bgmPlayer.getVolume(),
                file: configs.bgm?.file ?? '',
                /**
                 * 当前播放位置（秒）。给验证脚本断言"真的在解码"用 ——
                 * 光看 `playing` 不够：`paused=false` 也可能是"假播放"（卡在 0）。
                 */
                currentTime: bgmPlayer.currentTime(),
                /** 音频总时长（秒）。加载前为 NaN */
                duration: bgmPlayer.duration(),
                /**
                 * ★ `wallpaperPropertyListener.setPaused` 是否已装上。
                 *
                 * `true` = 跑在 WE 里（暂停信号已接管）；`false` = 普通浏览器。
                 * 有了它，验证脚本可以**读事实**而不是猜"我是不是在 WE 里"。
                 */
                wePause: bgmPlayer.hasWallpaperPause(),
              }
            : null,
        /**
         * ★ 角色语音状态（只读）。2026-10-03 新增。
         *
         * 为什么需要：语音的 `<audio>` 同样不进 DOM，而"WE 暂停时语音有没有
         * 跟着停"是这次修复的核心断言 —— 必须在暂停前后各读一次
         * `playing` + `currentTime`，才能证明"暂停时停住、恢复时从原处续播"。
         *
         * ★ 2026-10-17 补 `resolved`：多格式兜底后，"config 里写 `X.ogg`、
         *   实际响的是 `X.mp3`"是**正常**结果。只报 `file`（config 里那个名字）
         *   会让排查者以为播放器读错了文件 —— 实际命中的候选单独报。
         */
        voice: () =>
          voicePlayer
            ? {
                playing: voicePlayer.isPlaying(),
                currentTime: voicePlayer.currentTime(),
                volume: voicePlayer.getVolume(),
                file: lastVoiceFile,
                resolved: voicePlayer.resolvedUrl(),
              }
            : null,
        /**
         * ★ 音频总闸状态（只读）。验证"两路音频确实挂在同一个总闸上"用。
         */
        audio: () => ({
          paused: audioMaster.isPaused(),
          sinks: audioMaster.size(),
        }),
        /**
         * 手动推一次暂停/恢复（走总闸的完整链路，与宿主 `setPaused` 同一条路）。
         * 给验证脚本用 —— 不用真的去触发 WE 的暂停。
         */
        audioPause: (v: boolean) => {
          audioMaster.apply(!!v);
        },
      };

      /**
       * 右上角设置面板。**放在这里**而不是 `main()` 开头：
       * 它需要 `animationDurations`（已经写好的"动画名 → 时长"表）当序列的候选动画名，
       * 而那张表要等骨架解析完才有。
       */
      const storedSettings = readOverrides();

      /**
       * 居中「免责声明与许可证要求」弹窗。
       *
       * ★ 显示与否的优先级与设置面板一致：**WE 属性 > localStorage 覆盖层**。
       *   WE 每次启动都会重发当前属性值 ⇒ 用户"刚才在属性面板里勾的"才是权威。
       * ★ 缺省 **false**（不显示）：弹窗会盖住画面，默认不打扰；
       *   需要对外分发（如上传创意工坊）时再在属性面板里勾开。
       */
      /**
       * ★★ 弹窗/面板的**初始可见性**只在这里算一次，下面三处（建弹窗、建面板、
       *   把初值交给入口列的高亮）共用 —— 各写一遍 `weShowX ?? stored === true`
       *   迟早会出现"弹窗开着、按钮不亮"这种两处口径不一致的偏差。
       * 优先级：**WE 属性 > localStorage 覆盖层**（同 `showCornerButtons`）。
       */
      const disclaimerVisible0 =
        weShowDisclaimer ?? storedSettings.showDisclaimer === true;
      const archiveVisible0 =
        weShowArchive ?? storedSettings.showArchive === true;

      disclaimerUI = createDisclaimer({
        visible: disclaimerVisible0,
        /**
         * ★ 文案里要不要点名素材来源（`《XXX》官方…`），由使用者在 `assets/config.json`
         *   的 `disclaimer` 段配置。**不配就不点名** —— 仓库默认不含任何作品名。
         */
        sourceName: configs.disclaimer?.sourceName,
        rightsHolder: configs.disclaimer?.rightsHolder,
      });

      /**
       * 居中「档案」面板：以表格列出**当前生效配置**下壁纸可能触发的事件与触发条件。
       *
       * ★ 传 `configs`（已合并覆盖层）而不是 `rawConfigs` —— 表里要显示用户当前的
       *   实际参数（待机时长、点击池大小…），见 `archive.ts` 文件头。
       * ★ 显示与否的优先级同上：**WE 属性 > localStorage 覆盖层**；缺省 false。
       */
      archiveUI = createArchive({
        visible: archiveVisible0,
        config: configs,
        /**
         * ★★ 事件表由**这里**传入（2026-10-19）：档案不再自己从 config 归一。
         *   传归一后的 `eventTable`（`enabled` 已按用户开关压过）——
         *   表里列出的就是引擎真的会抽的那一份。
         */
        events: eventTable,
        /**
         * ★ 把「动画 → 特效」映射交给档案面板显示「特效」列（2026-10-17）。
         *
         * 传的是**上面那份已建好的扁平索引**，不是让面板自己再解析一遍
         * `config.actionEffects` —— 那份索引才是"到底会拉起哪些组"的权威判据
         * （见 `actionEffectNames` 与 `archive.ts` 的 `ActionEffectNames` 说明）。
         */
        actionEffects: actionEffectNames,
        /** ★ 校验报告（getter）：档案「细则」首行显示 `0 reject / N coerce / …` */
        validation: () => validationReport,
      });

      settingsUI = createSettingsPanel({
        animations: Object.keys(animationDurations),
        view: readView(configs),
        /**
         * ★ 本壁纸的「壁纸独立设置」声明（`config.wallpaperSettings`，详见 `config.type.ts`）。
         *
         * 面板据此决定**要不要建**最后那一页（连标签按钮一起）：没声明 / `items` 为空
         * ⇒ 不建 ⇒ 没有独立设置的壁纸（如星语心恋）不会多出一个永远空着的页。
         * ⚠️ 传的是**原始 config 的值** —— 它只描述"展示什么"，各设置项的值另有字段
         *   （如 `cabinMode` → `config.ferrisWheel.cabinMode`），不从这里读。
         */
        wallpaperSettings: configs.wallpaperSettings,
        /**
         * ★ 事件族注册表（`config.subtitle.eventFamilies`，见 `config.type.ts` 的 `EventFamily`）。
         *
         * 面板据此建「事件池」页的「事件族」（全局闸门）与「spine 动作族显示」两行：
         * **注册表为空**（含显式 `[]`）⇒ 两行都不建 —— 没有事件族的皮肤不该多出
         * 永远点不动的控件（与上面「壁纸独立设置」页同一口径）。
         * ⚠️ 传的是**原始 config 的值**，归一（丢非法项 / 去重 / 定缺省族）在面板与
         *   `dialogue.buildFamilyRegistry` 里做。
         */
        eventFamilies: configs.subtitle?.eventFamilies,
        /**
         * ★ 「spine 动作族显示」里"不换名"那一档的显示名（`config.subtitle.actionPhaseBaseLabel`）。
         *   誓约工程写「誓约前」⇒ 单选呈现 `[誓约前 | 誓约后]`；引擎不内置业务词。
         */
        actionPhaseBaseLabel: configs.subtitle?.actionPhaseBaseLabel,
        /**
         * ★★ 右上角**整列入口**（折叠按钮 + 5 个入口）是否显示 —— WE 属性 `showCornerButtons`
         * （属性面板**第一项**「显示右上角按钮」）。
         *
         * ★ 这是入口列**唯一**的显隐开关（2026-10-17 晚）：原来并存的 `showSettings`
         *   （只管齿轮）已全链路删除 ⇒ 这里不再传 `visible`。
         * 缺省 `true`（老存档里没这个键 ⇒ 照常显示）。
         */
        cornerVisible:
          weShowCornerButtons ?? storedSettings.showCornerButtons !== false,
        /** 入口列的展开/收起状态（覆盖层 `cornerCollapsed`；缺省展开） */
        cornerCollapsed: storedSettings.cornerCollapsed === true,
        /** 运行时静音初值（本轮会话才有效，重载即回到配置值） */
        muted: runtimeMuted,
        /** 「免责声明」「档案」入口的高亮初值（与上面两个 `*Visible0` 同源，不另算） */
        disclaimerVisible: disclaimerVisible0,
        archiveVisible: archiveVisible0,
        /** 「静音」入口：运行时压/还原两路音量，返回切换后的状态 */
        onToggleMute: () => {
          applyRuntimeMute(!runtimeMuted);
          return runtimeMuted;
        },
        /**
         * 「免责声明」入口：切换居中弹窗，并把它落回**同一个覆盖层字段**
         * （`showDisclaimer`）⇒ 与 WE 属性同源、重载后状态保持。
         *
         * ★ 不走 `applyWePatch`：那是"WE 下发属性"的入口，会连别的键一起判。
         *   这里只动一个字段，直接改 DOM + `writeOverrides` 最直白，
         *   也不会因为 `sameView` 判"没变化"而白重载（`showDisclaimer` 本就不进视图）。
         */
        onToggleDisclaimer: () => {
          const next = !(disclaimerUI && disclaimerUI.isVisible());
          if (disclaimerUI) {
            disclaimerUI.setVisible(next);
          }
          writeOverrides({ showDisclaimer: next });
          return next;
        },
        /** 「档案」入口：同「免责声明」，对应覆盖层字段 `showArchive` */
        onToggleArchive: () => {
          const next = !(archiveUI && archiveUI.isVisible());
          if (archiveUI) {
            archiveUI.setVisible(next);
          }
          writeOverrides({ showArchive: next });
          return next;
        },
        /** 入口列收起/展开 ⇒ 落盘（重载后保持原样） */
        onCornerCollapsedChange: (collapsed) => {
          writeOverrides({ cornerCollapsed: collapsed });
        },
        open: storedSettings.panelOpen === true,
        /**
         * 调试面板的展开状态（**入口在齿轮下方**，2026-10-15 从设置面板里独立出来）。
         *
         * ⚠️ 与 `open` 互斥由面板内部保证（两个都存了 `true` ⇒ 只开设置面板）。
         */
        debugOpen: storedSettings.debugPanelOpen === true,
        /**
         * 生效方式：写盘 → **重载页面**。
         *
         * 为什么不做热切换：气泡 DOM / 语音播放器 / 常驻序列都是开机一次性构造的，
         * 热拆 may 留下半初始化状态，排查成本远高于"重载黑屏 1 秒"。
         */
        onSave: (patch) => {
          writeOverrides(patch);
          window.location.reload();
        },
        onReset: () => {
          /**
           * 恢复默认 = 清空覆盖层（所有值回落到 `assets/config.json`）**再加一次定向压制**。
           *
           * ★ 为什么不能只 `clearOverrides()`：本工程是开发态探针工程，`config.json` 里
           *   `probe.enabled` / `probe.hud` 都是 `true` ⇒ 只清覆盖层的话，点「恢复默认」
           *   之后**调试反而是勾上的**，与预期相反（用户 2026-09-30 拍板：不默认勾选调试）。
           *   详见 `settingsStore.RESET_OVERRIDES` 的注释。
           *
           * ★★ 2026-10-21：**连本机的事件开关一起清**。事件开关是另一份存储
           *   （`wb.events.state.v1`，见 `eventOverrides.ts`），不清的话"恢复默认"之后
           *   事件仍是用户上次关掉的那几条 —— 用户说的"默认"显然包括它们。
           *
           * ⚠️ **不**碰 `wb.swe.eventlog.v1`（冷却 / 配额 / 互斥组的播放记录）：
           *   那是"已经发生过什么"的历史，不是设置。清掉它会让 `quota.ever` 的事件
           *   突然又能再播一次 —— 那不是恢复默认，是抹掉记录。
           */
          clearOverrides();
          writeOverrides({ ...RESET_OVERRIDES });
          clearEventState();
          window.location.reload();
        },
        /** 展开状态也持久化，重载后面板保持原样（否则每保存一次就"啪"地合上） */
        onOpenChange: (open) => {
          writeOverrides({ panelOpen: open });
        },
        /** 调试面板同理（与上面互相独立地各存各的，互斥由面板内部处理） */
        onDebugOpenChange: (open) => {
          writeOverrides({ debugPanelOpen: open });
        },
        /**
         * 调试面板「触发动作」：播**指定动画名**（不带台词/语音）。
         * 走与真实点击同路径、不过闸门 —— 排查时"正在播也能强行换一条"。
         */
        /**
         * ★★ 2026-10-17 补 `playActionEffects`：本条通道原本**只播动画**，
         *   于是「在调试面板点任何动作都看不到额外粒子特效」—— 因为特效的**唯一触发点**
         *   是 `showDialogue`，而这里（与 `touchController.trigger` 不同）不经过它。
         *   排查"某个动作到底绑没绑特效"时，这条捷径恰恰是最需要的 ⇒ 补上。
         *
         * 语义仍与真实播放一致：`playActionEffects` 只按 `actionEffects` 表拉起绑定的组，
         * **没绑的动画自然什么都不做**（这正是它该有的行为，见 `playActionEffects` 的注释）。
         */
        onPlayAnimation: (name: string) => {
          if (!touchController) {
            return false;
          }
          const ok = touchController.playAnimation(name);
          playActionEffects(name);
          return ok;
        },
        /**
         * 调试面板「触发事件」：按 **`EventKey`** 播**一整条念白**（动作+字幕+语音，
         * 走完整打断闸门）。找不到该键 ⇒ 返回 false（面板据此回显 ✗/红闪）。
         *
         * ★★ 2026-10-20：凭据从 `actionId` 换成 `EventKey`。自定义事件没有 actionId，
         *   旧写法（`find(it => it.actionId === actionId)`）对它们恒为 `undefined`/`NaN`
         *   ⇒ 面板显示 undefined、点了不播。查表改用 `findByEventKey` —— 与
         *   `__WB_DIALOGUE__.trigger`（下面 2055 行）**同一条**路径，不新增第二判据。
         */
        onTriggerEvent: (key: string) => {
          if (!touchController) {
            return false;
          }
          /**
           * ★★ 从 `phasedDialogues` 里找（动作族投影 + 存在性 + **全局事件族闸门**）：
           *   ① 用 `activeDialogues` 会播婚前动画名，看起来像"动作族没生效"；
           *   ② 不过闸门 ⇒ 点一条被事件族勾掉的条目居然能播，与真实触发不符。
           *   条目被闸门挡住时返回 false，面板红闪 —— 这正是它该有的诊断信息。
           */
          const entry = findByEventKey(phasedDialogues, key);
          return touchController.trigger(entry, 'touch');
        },
        /**
         * 调试面板「触发事件」的候选 = 本状态下**存在**的全部念白（`activeDialogues`）。
         *
         * ★ 这里**故意不按事件族闸门收窄**：被勾掉的条目也要能看见、能试着点一下，
         *   否则"为什么这条不触发"就查不到原因。真点下去时由 `onTriggerEvent` 的闸门
         *   判定（返回 false ⇒ 面板红闪），两者分工明确。
         * ★ 2026-10-20：`key` = `eventKeyOf(d)`（自定义事件靠它定位），
         *   `name` = `displayName || label || key` —— 面板不再拿 actionId 当显示名。
         */
        events: activeDialogues.map((d) => ({
          key: eventKeyOf(d),
          name: d.displayName || d.label || eventKeyOf(d),
          actionId: d.actionId,
          animation: d.animation,
        })),
        /**
         * ★★ 「事件开关」页（2026-10-19）—— 面板只**展示 + 开关**，不自己归一：
         *   传归一后的 `eventTable`（`enabled` 已按用户开关压过）。
         */
        eventTable,
        /**
         * 事件**来源**：面板据此显示路径、条数与"解析失败：第 N 行 第 M 列"。
         * ⚠️ 只传路径与错误，不传文件内容 —— 面板不需要、也不许有第二份表。
         */
        eventsFile: {
          path: 'assets/events.jsonc',
          error: eventsFile.ok ? null : eventsFile.error ?? '事件文件不可用',
        },
        /** 事件开关初值（本机点过的键） */
        eventState,
        /** 文件缺省开关（面板「已改 N 项 / 恢复本页默认」的依据） */
        eventDefaults,
        /**
         * 与设置项**同一次**保存：`onSave` 的重载之前落盘。
         * ★ 顺手把文件里已删掉的键剪掉（悬空键不会越攒越多）。
         * ★ 空表 ⇒ **直接删键**（「恢复本页默认」的落点）：留一个 `{enabled:{}}`
         *   在语义上等价，但会让"有没有改过"这件事永远看起来像是改过。
         */
        onSaveEventState: (s: EventState) => {
          const pruned = pruneEventState(s, eventTable.map(eventKeyOf));
          if (Object.keys(pruned.enabled).length) {
            writeEventState(pruned);
          } else {
            clearEventState();
          }
        },
      });

      if (PROBE_OPTS.enabled) {
        (window as unknown as { __WB_FX__: unknown }).__WB_FX__ = {
          freeze: (v: boolean) => {
            fxFrozen = v;
          },
          /**
           * 最近一帧的限帧决策（`_regress/42_` 用）。
           * 字段：`cap` 生效上限 / `baseCap` 基准上限（WE 或 config）/ `idle` 是否空闲 /
           * `cursorAgeMs` 距最近一次光标更新多久。
           */
          idleState: () => lastCapInfo,
          snapshots: () => particleAnimators.map((a) => a.getSnapshot()),
          /**
           * 「动作 → 额外特效」的**只读**读数（2026-10-14）。
           *
           * 为什么需要：这个钩子的效果是"动作播的时候某组粒子从头重播"，
           * 而**粒子系统本来就在自己循环**（`rateOverTime > 0` 的那些一直在发）——
           * 光看截图分不出"是被动作拉起来的"还是"它本来就在跑"。
           * 有了它就能断言"这条动画确实绑了 N 组、且组名都真的存在"。
           *
           * 返回：`{ bindings: {animation → 组名[]}, resolvable: 组名 → 是否真建起来了 }`
           */
          actionEffects: () => ({
            /** ★ 直接用重建时算好的扁平表（与档案面板同一个数据源，见 `actionEffectNames`） */
            bindings: actionEffectNames,
            resolvable: Object.keys(particleByName).reduce(
              (acc: { [k: string]: boolean }, k) => {
                acc[k] = !!particleByName[k];
                return acc;
              },
              {}
            ),
          }),
          /**
           * 直接驱动一次"动作特效"（只读语义：不播动作、不出字幕，只拉起粒子）。
           *
           * 为什么单独给这个：`__WB_DIALOGUE__.trigger()` 走的是完整播放路径
           * （要过打断闸门、要等前一条播完），验证"特效钩子"本身时没必要背那套时序。
           */
          playActionEffects: (animationName: string) =>
            playActionEffects(animationName),
          /**
           * **调试用**：替换「动作 → 特效」绑定表（仅探针开启时可用）。
           *
           * 为什么必须开这个口子：`actionEffects` 是 `config.json` 里的块，
           * 而设置覆盖层（`applyOverrides`）**只覆盖已存在的设置项** ⇒ 验收脚本
           * 没法靠 localStorage 注入它。要验"绑上之后真的会从头重播"，
           * 就得能在运行时改这张表。
           *
           * ⚠️ 它**只改内存里的索引**（不落盘、不影响 `config.json`）⇒ 重载即还原。
           * ⚠️ 只在 `PROBE_OPTS.enabled` 时暴露（与 `__WB_FX__` 整体同一门槛），
           *    发布态拿不到这个后门。
           *
           * @returns 重建后实际生效的绑定条数
           */
          setActionEffects: (list: ActionEffectsConfig) => {
            rebuildActionEffectIndex(list);
            return Object.keys(actionEffectIndex).reduce(
              (n, k) => n + actionEffectIndex[k].length,
              0
            );
          },
          /** 指针拖尾快照（未启用时为 null）；字段见 pointerTrail.ts 的 snapshot() */
          trailSnapshot: () => (pointerTrail ? pointerTrail.snapshot() : null),
          /** 定步长推进 n 步（每步 dt 秒） */
          step: (dt: number, n: number) => {
            for (let i = 0; i < n; i++) {
              particleAnimators.forEach((a) => a.update(dt));
            }
            return particleAnimators.length;
          },
        };
      }
    } else {
      requestAnimationFrame(waitLoad);
    }
  };

  // Render Loop
  //
  // ★★ 帧率上限 + 空闲降帧（2026-10-19）
  //
  // 三层上限，**每帧重算**（三层都能在运行时立刻生效）：
  //   ① WE 的「帧率限制」—— 用户界面上设的权威值（`applyGeneralProperties({fps})`）。
  //      此前完全没接：真机实测用户在 WE 里设 30，壁纸仍按 60 跑，单核占用差 2 倍。
  //   ② `config.maxFps` —— 只在 WE 没给值时兜底（浏览器预览 / 宿主不实现该回调）。
  //   ③ 空闲降帧 —— 连续 `idleAfterSec` 没有鼠标或事件活动 ⇒ 压到 `idleFps`。
  //      这是"看壁纸时流畅、用电脑时省电"的那一层，不依赖 WE 的暂停规则
  //      （WE 只认全屏/最大化/焦点，窗口化时永远不暂停）。
  //
  // ★ 为什么"到点就 return"而不是排队补帧：那才是真节流（省下的是**整个回调**）。
  //   若被节流掉时仍然执行回调再 return，等于没节流。
  // ★★ `lastFrameTime` **只在真正渲染时更新** —— 被跳过的帧的时间会累加到下一帧的
  //   delta 上，动画按**真实经过的时间**推进，不会因为限帧/降帧而变慢。
  // ★★ 恢复必须"立刻"：鼠标一动 ⇒ `getLastCursorAtMs()` 变新 ⇒ 下一帧 idle=false
  //   ⇒ 上限回到基准值；累加器检测到 cap 变化会**重置**，下一帧就按新上限放行 ⇒ 当帧恢复。
  const maxFpsCfg = configs.maxFps ?? 0;
  /** 空闲帧率（`0` = 关闭空闲降帧；缺省关闭，避免改变未配置工程的行为） */
  const idleFps = Math.max(0, configs.idleFps ?? 0);
  /** 多久没有交互算"空闲"（秒） */
  const idleAfterMs = Math.max(0, (configs.idleAfterSec ?? 10) * 1000);

  /**
   * 基准上限（不含空闲降帧）。
   * ★ WE 给过值就**完全听 WE**（包括它给 `0` = 无限制）；否则回退 `config.maxFps`。
   *   理由见 `weFps.ts` 文件头：WE 的滑块是用户直接操作的权威入口，
   *   若被 config 的固定值压住，"我在 WE 里调成 60"就会看起来没生效。
   */
  const resolveBaseCap = (): number => (hasWeFps() ? getWeFps() : maxFpsCfg);

  const render = () => {
    // ★ 两套时钟，别混：
    //   nowMs   = Date.now()         → 墙钟（动画 delta / 空闲判据 / 探针读数）
    //   nowPerf = performance.now()  → 单调（限帧节流，见 capAccumMs 的注释）
    const nowMs = Date.now();
    const nowPerf = performance.now();
    const baseCap = resolveBaseCap();
    /**
     * 空闲判据**只看鼠标**（`mousemove` / `mousedown` 在 `initScene` 里打点）。
     *
     * ★★ 为什么不把"事件播放"算进来（2026-10-19 实测踩到）：
     *   待机事件是**自动播放**的（`standbyKinds` + `tickStandby` 每秒轮询），
     *   `playEvent` 成功后会把 `lastActivityAt` 刷新成"刚刚"
     *   ⇒ 空闲判据永远不成立 ⇒ 降帧**一次都不会触发**（实测 `idle` 恒 false、`cap` 恒 30）。
     *   这个判据要回答的是"**用户**在不在"，不是"壁纸自己在不在动"。
     *   用户点出来的动作本来就伴随 `mousedown`（已计入），不需要额外补偿。
     */
    const lastInputMs = Scene.getLastCursorAtMs();
    const isIdle = idleFps > 0 && nowMs - lastInputMs >= idleAfterMs;
    const capFps = isIdle
      ? baseCap > 0
        ? Math.min(baseCap, idleFps)
        : idleFps
      : baseCap;

    // 诊断读数（探针可见）：即使本帧被节流掉也要更新，否则读数会落后一整拍
    lastCapInfo = {
      cap: capFps,
      baseCap,
      idle: isIdle,
      cursorAgeMs: nowMs - Scene.getLastCursorAtMs(),
      idleFps,
      idleAfterMs,
    };

    if (capFps !== lastCapForAccum) {
      // 上限变了（交互↔空闲、用户在 WE 里改 fps）⇒ 重置累加器，从这一刻重新计时
      capAccumMs = 0;
      lastTickMs = nowPerf;
      lastCapForAccum = capFps;
    }

    if (capFps > 0) {
      const frameMs = 1000 / capFps;
      // ★ 累加 rAF 的实际间隔（`performance.now()`，亚毫秒 + 单调），够一帧才渲染。
      //   只减一个 frameMs ⇒ 余量保留，平均节奏精确等于目标（不会像简单比较那样丢帧）。
      capAccumMs += nowPerf - lastTickMs;
      lastTickMs = nowPerf;
      if (capAccumMs < frameMs) {
        requestAnimationFrame(render);
        return;
      }
      capAccumMs -= frameMs;
      // 长时间卡顿（或标签页刚回来）后不要连发：最多欠一帧
      if (capAccumMs > frameMs) {
        capAccumMs = frameMs;
      }
    } else {
      // 不限帧：只推进时钟，不攒额度
      lastTickMs = nowPerf;
      capAccumMs = 0;
    }

    const now = nowMs / 1000;
    const delta = now - lastFrameTime;
    lastFrameTime = now;
    /**
     * ★ 钳住单帧步长（2026-09-27）
     *
     * WE 暂停壁纸时会**冻结渲染进程**：`rAF` 停摆，但 `Date.now()` 照走
     * ⇒ 恢复首帧的 `delta` 等于**整段暂停时长**（几十秒很常见）⇒ 骨架动画 /
     * 粒子瞬移一大段，常驻序列甚至会连着推进好几项、念白刷屏。
     * 上限取 0.1s（等效最慢 10fps 的单步）；标签页切回来同理。
     */
    const step = delta > 0 ? Math.min(delta, 0.1) : 0;
    // 冻结时传 0：只重画、不推进（探针测速时用）
    const d = fxFrozen ? 0 : step;
    meshUpdateCallbacks.forEach((callback) => callback(d));
    Scene.renderer?.render(Scene.scene, Scene.camera);
    requestAnimationFrame(render);
  };

  requestAnimationFrame(waitLoad);
};

main();
