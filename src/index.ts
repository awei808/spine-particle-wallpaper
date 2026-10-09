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
import { PointerTrail } from './pointerTrail';
import {
  TouchZoneConfig,
  DialogueEntry,
  GreetMode,
  DEFAULT_CABIN_GROUPS,
} from './config.type';
import {
  buildPool,
  hasGreetIds,
  pickGreetingEntry,
  pickRandomFromPool,
  resolveStandbyKinds,
  resolveStandbyTouchIds,
  resolveTouchIds,
} from './dialogue';
import { createVoiceBubble, VoiceBubble } from './voiceBubble';
import { createVoicePlayer, voiceBasename, VoicePlayer } from './voicePlayer';
import { createBgmPlayer, BgmPlayer } from './bgmPlayer';
import { createAudioMaster, AudioMaster } from './audioMaster';
import { subscribePause } from './wePauseSignal';
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
 * WE 属性 `showSettings`（右上角齿轮**显不显示**）的最近一次权威值。
 *
 * ## ★为什么单独拎出来，而不是塞进 `SettingsView` / 走重载
 *
 * `showSettings` 不是配置项：它不在 `config.json` 里、`applyOverrides` 不消费它、
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
let weShowSettings: boolean | undefined;

/**
 * WE 属性 `showDisclaimer`（居中「免责声明与许可证要求」弹窗**显不显示**）的最近一次权威值。
 *
 * 与 `showSettings` 完全同构（同为 UI 门面开关、同样不进 `SettingsView`、同样热切换），
 * 理由不再复述，见上面 `weShowSettings` 与 `settingsStore.sameView` 的注释。
 */
let weShowDisclaimer: boolean | undefined;

/**
 * WE 属性 `showArchive`（居中「档案」面板**显不显示**）的最近一次权威值。
 *
 * 与 `showSettings` / `showDisclaimer` 完全同构（同为 UI 门面开关、同样不进
 * `SettingsView`、同样热切换），理由不再复述。
 */
let weShowArchive: boolean | undefined;

/**
 * 右上角设置面板。未到"资源就绪"时为 `null`。
 *
 * ★★ 声明**必须**早于 `applyWePatch`：WE 可能在 `main()` 执行前就下发属性，
 * 那时 `let settingsUI` 若还停在下面（模块后段）会处在 TDZ ⇒
 * `settingsUI?.setVisible()` 抛 `ReferenceError` ⇒ 属性被静默丢弃。
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
   * ★★ `showSettings` 特例：**热切换，不重载**。
   *
   * 它不进 `SettingsView`，所以 `sameView` 永远判它"没变化" ⇒ 指望不上 `scheduleReload`。
   * 但它改的只是一个 DOM 元素的 `display`，热切毫无副作用，还比 reload 快得多。
   * 面板尚未创建时（`settingsUI === null`）先存进 `weShowSettings`，
   * 等 `createSettingsPanel` 建好时取用（见下面 visible 那一行）。
   */
  if (typeof patch.showSettings === 'boolean') {
    weShowSettings = patch.showSettings;
    settingsUI?.setVisible(weShowSettings);
  }

  /**
   * `showDisclaimer` 同理：**热切换，不重载**。
   *
   * 弹窗尚未创建时先存进 `weShowDisclaimer`，等 `createDisclaimer` 建好时取用。
   * 用户拍板（2026-09-27）：开关打开 ⇒ 弹窗**常驻**显示，关掉才消失。
   */
  if (typeof patch.showDisclaimer === 'boolean') {
    weShowDisclaimer = patch.showDisclaimer;
    disclaimerUI?.setVisible(weShowDisclaimer);
  }

  /**
   * `showArchive` 同理：**热切换，不重载**。
   *
   * 档案面板尚未创建时先存进 `weShowArchive`，等 `createArchive` 建好时取用。
   */
  if (typeof patch.showArchive === 'boolean') {
    weShowArchive = patch.showArchive;
    archiveUI?.setVisible(weShowArchive);
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
  Scene.initScene(configs);

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
  const spineAssetManager = new threejsSpine.AssetManager(ASSET_PATH);
  const threeAssetList: { [path: string]: THREE.Texture } = {};
  const meshUpdateCallbacks: Array<(delta: number) => void> = [];
  /** 粒子系统实例（仅用于探针调试，正式构建里也是空跑一次赋值） */
  const particleAnimators: ParticleAnimator[] = [];
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
  const touchZones: TouchZoneConfig[] = touchCfg?.zones ?? [];
  if (touchEnabled && !touchZones.length) {
    console.warn(
      '[touch] config.json 缺少 touch.zones ⇒ 触摸交互已禁用（热区现在只认配置，代码里不再有兜底矩形）'
    );
  }
  const touchActive = touchEnabled && touchZones.length > 0;

  /**
   * 念白字幕（`config.json` 的 `subtitle` 块）。
   *
   * 与热区同一套架构口径：**数据与样式的唯一来源是 config，代码里不留副本**
   * ⇒ 改文案、改字号、挪气泡位置都**免重建 bundle**（与 `touch.zones` 同理）。
   */
  const subtitleCfg = configs.subtitle;
  const dialogues: DialogueEntry[] = subtitleCfg?.dialogues ?? [];
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
   * 显示一条念白的字幕。
   *
   * 停留时长 = **`min(TextTime, 该动画的 duration)`** ——
   * 动作播完气泡就先收起，不会出现"人已经站回 idle 了、字幕还挂在屏幕上"。
   * 两个来源都没给时退到保守的 6 秒，不至于一闪而过。
   */
  const showDialogue = (entry: DialogueEntry | null, animationName: string) => {
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

  /** 问候去重窗口（秒）。加载延迟、visibilitychange、focus 三个信号可能接连到来，只认第一次 */
  const GREETING_DEDUPE_SEC = 5;
  let lastGreetingAt = 0;

  /** 待机与问候的自动播放节奏（毫秒）。都可在 config 里改 */
  const standbyIdleMs = subtitleCfg?.standbyIdleMs ?? 25000;
  const greetingDelayMs = subtitleCfg?.greetingDelayMs ?? 3000;
  /**
   * ★★ 问候事件的**来源**（2026-10-08 起统一走数组 `greet`）。
   *
   * 新 config 写 `"greet": [64001, 64002, 64003]`（用户可以直接增删）；
   * 没配时才退回旧的时段表 `greeting`（**老 config 行为逐字不变**）。
   * 后面三处（触摸池合并、问候取条、待机可用性判据）全部只用这一个对象，
   * ⇒ 不会再出现"两处读了两种口径"。
   */
  const greetSource = subtitleCfg?.greet ?? subtitleCfg?.greeting;
  /** 问候的取条方式（缺省 `'time'`）。详见 `GreetMode` 的表格 */
  const greetMode: GreetMode = subtitleCfg?.greetMode ?? 'time';
  /**
   * 「待机触摸」池 —— **聊天池**（`chat`，或旧字段 `standby`）**并上** `touch`（点击触摸）
   * 解析出的条目（2026-09-30 用户修正："开启后可触发 64004 到 64010"）。
   *
   * ★ 动作与字幕**同源**（与点击触摸同一口径）：取了哪条就播它的 `animation`、
   *   显示它的台词，天然配套不会串。
   * ★ 解析复用 `dialogue.resolveStandbyTouchIds` + `buildPool` —— **不另写一套判据**，
   *   于是"id 指向不存在的条目就静默跳过"这条兜底对两条来源一视同仁（与 `touchPool` 同）。
   */
  const standbyTouchPool: DialogueEntry[] = buildPool(
    dialogues,
    resolveStandbyTouchIds(
      subtitleCfg?.standby,
      subtitleCfg?.touch,
      subtitleCfg?.chat
    )
  );

  /**
   * ★★ 待机到点后**可以播**哪些类别（`greet` / `touch`）—— 2026-09-30 新增。
   *
   * 用户拍板的口径：两个开关（「待机自动触发greet事件」/「…touch事件」）**共用**
   * `standbyIdleMs` 这一个阈值；到点后从**已启用**的类别里**随机挑一个**，
   * 两个都关 ⇒ 待机不播任何东西（等价于关掉"待机自动播放"）。
   *
   * ★ 判据集中在 `dialogue.resolveStandbyKinds`（纯函数、可单测），这里只把 config
   *   读成入参 —— 与 `resolveTouchIds` 同一套架构口径（见 `dialogue.ts` 文件头）。
   * `touch` 要求上面那个池非空，`greet` 要求问候池（`greet`）至少有一条候选。
   */
  const standbyKinds = resolveStandbyKinds(
    subtitleCfg?.standbyTouchEnabled,
    subtitleCfg?.standbyGreetEnabled,
    standbyTouchPool.length > 0,
    hasGreetIds(greetSource)
  );

  /**
   * 尝试播一条问候。**返回值 = 是否真的播了**（供待机轮询判"该不该重置计时"）。
   *
   * 四个"自动信号"都走这里：
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
   * 没有这层会出现"一句话连播三遍"。
   *
   * ★ 第 5 个入口 = **待机到点**（`tickStandby` 的 `greet` 分支，2026-09-30）。
   *   刻意复用它而不是另写一份 —— "取条 + 去重 + `trigger('greet')`"
   *   就是"触发一次问候"的完整语义，另写必然与上面几路慢慢漂移。
   *
   * ★ 取条方式由 `greetMode` 决定（`'time'` 按时段 / `'random'` 随机），
   *   与"开机 / 回到桌面"等那几路共用同一个 `pickGreetingEntry` ⇒ 口径唯一。
   */
  const tryGreeting = (reason: string): boolean => {
    if (!touchController) {
      return false;
    }
    const now = Date.now() / 1000;
    if (now - lastGreetingAt < GREETING_DEDUPE_SEC) {
      return false;
    }
    const entry = pickGreetingEntry(
      dialogues,
      greetSource,
      subtitleCfg?.greetingRanges ?? {},
      new Date(),
      greetMode
    );
    if (!entry) {
      return false;
    }
    // trigger 会在"正在播触摸"时拒绝；此时不更新去重时间，等下次信号再来
    if (touchController.trigger(entry, 'greet')) {
      lastGreetingAt = now;
      lastActivityAt = now;
      return true;
    }
    return false;
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
   * ★ 恢复后先 `markActivity()` 压住待机轮询 —— 否则 `standby` 可能抢在 `greet`
   *   前面播（两者都是自动行为，先到先得，见 `touch.ts` 的优先级表）。
   */
  const RESUME_GREET_MIN_SEC = 15;
  /** 恢复后延一拍再播：让画面先动起来，也避开与 boot/visible 撞在同一个去重窗口里 */
  const RESUME_GREET_DELAY_MS = 400;
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
    if (away < RESUME_GREET_MIN_SEC) {
      return;
    }
    markActivity();
    window.setTimeout(() => tryGreeting('resume'), RESUME_GREET_DELAY_MS);
  };

  /**
   * 待机轮询（每秒一次）。
   *
   * 为什么用轮询而不是"动作结束回调"：动作结束有三个出口
   * （自然 complete / 被点击打断 / dispose），逐个挂钩子容易漏；
   * 每秒读一次 `isBusy()` 是**单一判据**，不会漏也不会重。
   * 代价是每秒一次空转，可以忽略。
   *
   * ★★ 待机到点后播哪一类（2026-09-30）：从 `standbyKinds`（= 已启用的
   *   `greet` / `touch`，见其声明处）里**随机挑一个**；空数组 ⇒ 什么都不做。
   */
  const tickStandby = () => {
    if (!touchController) {
      return;
    }
    const now = Date.now() / 1000;
    if (touchController.isBusy()) {
      // 还有动作在播 ⇒ 视为"仍在活动"，计时重新起算
      lastActivityAt = now;
      return;
    }
    if (now - lastActivityAt < standbyIdleMs / 1000) {
      return;
    }
    if (!standbyKinds.length) {
      // 两个开关都关掉 ⇒ 待机不自动播任何东西（等价于关掉"待机自动播放"）
      return;
    }
    /**
     * ★ 随机挑一类。夹取口径与 `dialogue.pickRandomFromPool` 一致
     *   （防止注入的 random 返回 1.0 时 `floor(1.0*n)===n` 越界成 undefined）。
     */
    const idx = Math.min(
      standbyKinds.length - 1,
      Math.max(0, Math.floor(Math.random() * standbyKinds.length))
    );
    if (standbyKinds[idx] === 'touch') {
      /**
       * ★ 池里再随机取一条（64004 休闲待机 + 64005~64010 点击触摸）。
       *
       * ★★ `source` 必须给 **`'standby'`** 而不是 `'touch'`：这是**自动播放**，
       *   按 `touch.ts` 的闸门表，`'touch'` 会去**打断**正在演的问候/动作，
       *   而自动播放只该"让位不抢戏"。给了 `'touch'` 还会污染点击统计口径。
       */
      const entry = pickRandomFromPool(standbyTouchPool);
      if (entry && touchController.trigger(entry, 'standby')) {
        lastActivityAt = now;
      }
      return;
    }
    /**
     * `greet`：复用 `tryGreeting`（按时段选取 + 5 秒去重 + `trigger('greet')`）；
     * 成功时它自己会置 `lastActivityAt`。被去重挡下（返回 false）时**不重置计时**
     * ⇒ 下一秒 tick 会再试一次 —— 与 `touch` 分支"只有真播了才重置"的口径一致。
     */
    tryGreeting('standby');
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

    if (dialogues.length) {
      window.setTimeout(() => tryGreeting('boot'), greetingDelayMs);
      document.addEventListener(
        'visibilitychange',
        () => {
          if (!document.hidden) {
            tryGreeting('visible');
          }
        },
        false
      );
      window.addEventListener('focus', () => tryGreeting('focus'), false);
      // ★ WE 的暂停/恢复信号（"回到主界面"）。订阅而非直接写 `wpl.setPaused`
      //   —— 那个字段是单赋值，BGM 也在用它，写两次必有一个静默失效。
      subscribePause(onPauseChange);
    }
    /**
     * ★ 判据用 `standbyKinds`（已启用且可用）而不是"配了 `standby` 条目"：
     *   两个开关都关掉时**不必**再挂一个每秒空转的定时器。
     */
    if (standbyKinds.length) {
      window.setInterval(tickStandby, 1000);
    }
  };

  /**
   * 摩天轮轿厢姿态角（「画面调整」页的设置）。
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
            const idleName = meshConfig.animationName;
            const touchNames = allAnimations.filter((n) => n !== idleName);
            /**
             * 角色骨架判据：除常驻动画外还有别的动画可播。
             *
             * ★ 与"是否启用触摸"**拆开**：`touch.enabled=false` 只是不响应点击，
             * 不该连带把常驻动作序列也关掉（两件事）。
             */
            const isCharacter = touchNames.length > 0;

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
                  entries: dialogues,
                  onItem: (entry, animation) => showDialogue(entry, animation),
                }
              );

              if (touchActive) {
                if (touchShowZones && !zoneOverlay) {
                  zoneOverlay = createTouchZoneOverlay(touchZones);
                }

                /**
                 * 触摸池：动作与字幕**同源**。
                 * 用 `subtitle.touch` 的 actionId 列表解析出条目，
                 * 命中热区时随机取一条 ⇒ 播哪个动作就显示哪句台词，天然配套不会串。
                 *
                 * ★ `subtitle.greetInTouchPool`（缺省 false）打开时，`resolveTouchIds`
                 * 会把**问候池**（`greet`，或旧 `greeting`）的 actionId 追加进 id 列表 ——
                 * 点热区也能随机到打招呼的语音/动作。
                 * 只并 id、不改条目 ⇒ 上面那条"动作与字幕同源"的口径原样成立。
                 */
                const touchIds = resolveTouchIds(
                  subtitleCfg?.touch,
                  greetSource,
                  subtitleCfg?.greetInTouchPool
                );
                const touchPool = buildPool(dialogues, touchIds);
                if (!touchPool.length && touchIds.length > 0) {
                  console.warn(
                    '[subtitle] subtitle.touch / greeting 里的 actionId 没一条能在 subtitle.dialogues 里找到 ⇒ 退化为只播动作、不出字幕'
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
                     *   用户在「设置 → 动作」页可随时改。
                     */
                    touchFeedbackMode: subtitleCfg?.touchFeedbackMode,
                    /** 触摸播完 ⇒ 把 track 0 交还序列，从下一条继续 */
                    onActionFinished: (mixSeconds) =>
                      idleSequence?.resume(mixSeconds),
                    touchAnimations: touchNames,
                    zones: touchZones,
                    touchPool,
                    // 命中哪块就把哪块点亮——桌面上截图即可判读热区位置对不对
                    onZoneHit: (zoneId) =>
                      zoneOverlay && zoneOverlay.highlight(zoneId),
                    // 每播一条念白：刷新待机计时 + 同步字幕（动作与字幕来自同一条）
                    onAction: (payload) => {
                      markActivity();
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
              cabinGroups.indexOf(meshConfig.name) >= 0 ? cabinMode : undefined
            );
            particleAnimators.push(particleAnimator);
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
          dialogues.map((it) => ({ actionId: it.actionId, text: it.text })),
        isBusy: () => (touchController ? touchController.isBusy() : false),
        playing: () =>
          touchController ? touchController.playingAnimation() : '',
        /** 按 actionId 播一条（待机/问候同路径，走 trigger 的同一套打断规则） */
        trigger: (actionId: number, source?: string) => {
          if (!touchController) {
            return false;
          }
          const entry =
            dialogues.find((it) => it.actionId === actionId) ?? null;
          const src =
            source === 'greet' || source === 'standby' ? source : 'touch';
          return touchController.trigger(entry, src);
        },
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
          panelVisible: settingsUI ? settingsUI.isVisible() : false,
          panelOpen: settingsUI ? settingsUI.isOpen() : false,
          /** 免责声明弹窗当前是否显示（验证脚本断言开关联动用） */
          disclaimerVisible: disclaimerUI ? disclaimerUI.isVisible() : false,
          /** 档案面板当前是否显示 + 表格行数（验证脚本断言开关联动与内容渲染用） */
          archiveVisible: archiveUI ? archiveUI.isVisible() : false,
          archiveRows: archiveUI ? archiveUI.rowCount() : 0,
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
         */
        voice: () =>
          voicePlayer
            ? {
                playing: voicePlayer.isPlaying(),
                currentTime: voicePlayer.currentTime(),
                volume: voicePlayer.getVolume(),
                file: lastVoiceFile,
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
      disclaimerUI = createDisclaimer({
        visible: weShowDisclaimer ?? storedSettings.showDisclaimer === true,
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
        visible: weShowArchive ?? storedSettings.showArchive === true,
        config: configs,
      });

      settingsUI = createSettingsPanel({
        animations: Object.keys(animationDurations),
        view: readView(configs),
        // ★ WE 的 `showSettings` 优先于 localStorage：它才是"用户刚才在属性面板里勾的"
        visible: weShowSettings ?? storedSettings.showSettings !== false,
        open: storedSettings.panelOpen === true,
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
           */
          clearOverrides();
          writeOverrides({ ...RESET_OVERRIDES });
          window.location.reload();
        },
        /** 展开状态也持久化，重载后面板保持原样（否则每保存一次就"啪"地合上） */
        onOpenChange: (open) => {
          writeOverrides({ panelOpen: open });
        },
      });

      if (PROBE_OPTS.enabled) {
        (window as unknown as { __WB_FX__: unknown }).__WB_FX__ = {
          freeze: (v: boolean) => {
            fxFrozen = v;
          },
          snapshots: () => particleAnimators.map((a) => a.getSnapshot()),
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
  const render = () => {
    const now = Date.now() / 1000;
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
