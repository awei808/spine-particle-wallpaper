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

/**
 * 运行时设置：**覆盖层（override）**的存储与合并。
 *
 * ## 为什么是"覆盖层"而不是改写 config.json
 *
 * `assets/config.json` 是**只读默认值**（打包进壁纸的资源），而用户在 WE 里改的
 * 是**个人偏好**。两者必须分开，否则：
 *   - 更新壁纸会覆盖掉用户的设置；
 *   - 同一个包没法给不同用户留不同偏好。
 *
 * ⇒ `config.json` 提供缺省，localStorage 提供覆盖，**读的时候合并**。
 *
 * ## 为什么持久化用 localStorage（而不是只靠 WE 的 userProperties）
 *
 * 1. WE 的 `applyUserProperties` 只在 **WE 环境**里才有；同一份包在普通浏览器里
 *    预览时也要能用（否则调试/验证脚本无从下手）。
 * 2. localStorage 在 WE 里同样是持久的（按壁纸隔离），等于两个入口共用一份真值。
 *
 * ⚠️ WE 某些隐私设置下 localStorage 可能抛异常 ⇒ 全部读写包 try/catch，
 * 抛了就**降级为进程内内存态**（功能不残废，只是关掉后丢）。
 *
 * ## 生效方式：**保存 → 重载页面**
 *
 * 用户拍板（`-- settings UID: 2026-09-22`）：不做运行时热切换。
 * 理由很实在 —— 气泡 DOM、常驻序列、语音播放器都是**开机一次性构造**的，
 * 热切换要为每个模块写"半初始化"的拆解逻辑，状态残留很难排；
 * 而 `location.reload()` 天然干净，代价只是切换时黑屏约 1 秒。
 */

import {
  Configs,
  FerrisWheelConfig,
  GreetMode,
  TouchFeedbackMode,
} from './config.type';
// 只为读"探针当前生效值"的缺省（见 readView）——probe 不反向依赖本模块，无循环
import { PROBE_OPTS } from './probe';

/** localStorage 键。带版本号，将来改结构时便于一次性弃用旧值 */
export const SETTINGS_STORAGE_KEY = 'wb.swe.settings.v1';

/**
 * 可被用户覆盖的设置。
 *
 * ⚠️ **刻意保持"扁平 + 显式列举"**：不用 `{ bgm: { enabled } }` 那种嵌套结构。
 * 嵌套会让"某个子字段有没有被覆盖"变成三态判断（undefined / false / true），
 * 扁平 + `undefined` = 未覆盖，语义唯一。
 *
 * `panelOpen` 是 UI 状态不是设置，但它的诉求一样（重载后要还原），放在一起省一套存储。
 */
export type SettingsOverrides = {
  /**
   * **全部静音**（BGM + 念白一起不出声）。
   *
   * 与 `bgmEnabled` / `voiceEnabled` 是**两回事**：那两个是各自的独立开关，
   * 这个是压在它们之上的总闸（总闸关 ⇒ 两个都不响，但各自的开关值原样保留）。
   */
  muteAll?: boolean;
  bgmEnabled?: boolean;
  /** BGM 音量 0~1 */
  bgmVolume?: number;
  /** 字幕气泡是否显示 */
  subtitleEnabled?: boolean;
  /** 字幕位置预设：`game`（解包固定位置）/ `bottom`（底部字幕条）/ `custom`（自由定位） */
  subtitlePosition?: 'game' | 'bottom' | 'custom';
  /** 字幕水平锚点（0~1，仅 `position:'custom'` 生效；对应 config.subtitle.anchorU） */
  subtitleAnchorU?: number;
  /** 字幕垂直锚点（0~1，仅 `position:'custom'` 生效；对应 config.subtitle.anchorV） */
  subtitleAnchorV?: number;
  /** 念白语音是否播放 */
  voiceEnabled?: boolean;
  /**
   * 角色语音（念白 CV）音量 0~1。
   *
   * 对应 `config.subtitle.audio.volume`（config 缺省 **1.0**）。
   * ★ 与 `bgmVolume` 是**两条独立链路**（一个给 `voicePlayer`、一个给 `bgmPlayer`），
   *   互不影响；只有 `muteAll` 这个总闸能把两者一起压住。
   *
   * 改完需重载生效（`<audio>.volume` 在元素创建时写一次，见 `voicePlayer.ts`）。
   */
  voiceVolume?: number;
  /**
   * 是否把「问候」条目并入触摸池（对应 `config.subtitle.greetInTouchPool`）。
   *
   * 打开 ⇒ 点击热区也能随机到打招呼的语音/动作；缺省/关闭 = 只从 `subtitle.touch` 里随机。
   * 改了要重载（触摸池是开机一次性构造的，见文件头"生效方式"）。
   */
  greetInTouchPool?: boolean;
  /**
   * 摩天轮轿厢姿态角（对应 `config.ferrisWheel.cabinMode`）。
   *
   * `gravity` = 沿用解包 `startRotation`（−15°，随画面重力）；
   * `game` = 强制 0°（画布对齐，与游戏实录一致）。取证见 `config.type.ts` 的
   * `FerrisWheelConfig` 注释。切换**需重载**（spawn 时读值）。
   */
  cabinMode?: FerrisWheelConfig['cabinMode'];
  /**
   * 指针（鼠标）拖尾粒子总开关（对应 `config.pointerTrail.enabled`）。
   *
   * 打开 ⇒ 指针移动时沿轨迹留下**等距**粒子（复刻游戏 `FX_UI_CommonUI_Click` 的
   * `/5`、`/5/6`，见 `pointerTrail.ts` 与 09 文档 `19_指针拖尾_壁纸实现.md`）。
   *
   * 改了**需重载**：发射器是开机一次性构造的（纹理、几何缓冲），
   * 与 `cabinMode` 同属「画面调整」页的"构造期配置"。
   */
  pointerTrailEnabled?: boolean;
  idleSequenceEnabled?: boolean;
  /** 序列内容（**只存动画名**；`{actionId}` 形式请在 config.json 里配） */
  idleSequenceItems?: string[];
  idleSequenceGapMs?: number;
  /**
   * 待机阈值：空闲多久触发一次「待机自动播放」（秒）。
   *
   * 对应 `config.subtitle.standbyIdleMs`（面板里暴露成秒更直观）。
   * ★ 2026-09-30 起它是**共享阈值** —— 到点后播 `greet` 还是 `chat` 由下面两个开关决定
   *   （两个都开 ⇒ 随机二选一；两个都关 ⇒ 待机不播任何东西）。
   * 改完需重载生效（气泡/轮询是开机一次性构造的，见文件头"生效方式"）。
   */
  standbyIdleSec?: number;
  /**
   * 待机到点后是否自动触发「问候」（greet）事件。对应 `config.subtitle.standbyGreetEnabled`。
   *
   * 缺省 **false** —— 待机播问候是 2026-09-30 新增的能力，不影响改动前的行为。
   * 取哪一条由「问候」时段表按当前本地时刻决定，与"开机 / 回到桌面"几路同源。
   */
  standbyGreetEnabled?: boolean;
  /**
   * 待机到点后是否自动触发「触摸（touch）」事件（对应 `config.subtitle.standbyTouchEnabled`）。
   *
   * ★ 这一类是**一个池** = `standby`（休闲待机 64004）**并上** `touch`（点击触摸
   *   64005~64010），去重后随机取一条 ⇒ 64004 **不再固定播放**。
   * ★ 缺省 **false**（用户 2026-09-30 拍板）：两个开关都关 ⇒ **出厂待机不自动播任何
   *   东西**。（改动前只要配了 `subtitle.standby` 就会到点自动播，那是旧行为。）
   */
  standbyTouchEnabled?: boolean;
  /**
   * 正在播动作时**点击**该怎么处理（对应 `config.subtitle.touchFeedbackMode`）。
   *
   * ★ 语义表见 `TouchFeedbackMode` 的注释；**缺省 `'immediate'`**（面板第一档）。
   * ⚠️ 落盘即进覆盖层 ⇒ 与 `config.json` 里写的值**同名同语义**，只是优先级更高。
   */
  touchFeedbackMode?: TouchFeedbackMode;
  /**
   * 问候事件的取条方式（对应 `config.subtitle.greetMode`）。
   *
   * `'time'` = 按当前系统时刻取 `greet` 池里同一序号那条；`'random'` = 池内随机。
   * 缺省 `'time'`。
   */
  greetMode?: GreetMode;
  /**
   * 探针（调试）相关开关。对应 config 的 `probe.*` / `touch.showZones`。
   *
   * `probeEnabled` 的**缺省**取自编译期（`--env probe=off` 的包默认关），
   * 但**双向可覆盖** ⇒ 正式版里也能打开/关掉，见 `probe.ts` 的 `applyProbeConfig`。
   */
  probeEnabled?: boolean;
  /** 左上角 HUD 文字块（config.probe.hud） */
  probeHud?: boolean;
  /** 鼠标位置红圈（config.probe.crosshair） */
  probeCrosshair?: boolean;
  /** 触摸热区调试框（config.touch.showZones） */
  probeZones?: boolean;
  /** 右上角设置按钮是否显示（对应 WE 属性面板里的开关） */
  showSettings?: boolean;
  /**
   * 是否显示居中的「免责声明与许可证要求」弹窗（对应 WE 属性面板里的开关）。
   *
   * ★ 与 `showSettings` 同类：**UI 门面开关，不是配置项** ——
   * 不在 `config.json` 里、`applyOverrides` 不消费它、`readView` 也产不出它
   * （硬塞进 `SettingsView` 会让每次启动都被 `sameView` 判成"有变化"⇒ 白重载）。
   * 打开 ⇒ 弹窗**常驻**显示；关闭 ⇒ 消失。热切换，见 `index.ts` 的 `applyWePatch`。
   */
  showDisclaimer?: boolean;
  /**
   * 是否显示居中的「档案」面板（对应 WE 属性面板里的开关）。
   *
   * ★ 与 `showSettings` / `showDisclaimer` 同类：**UI 门面开关，不是配置项** ——
   * 不在 `config.json` 里、`applyOverrides` 不消费它、`readView` 也产不出它
   * （硬塞进 `SettingsView` 会让每次启动都被 `sameView` 判成"有变化"⇒ 白重载）。
   * 打开 ⇒ 面板**常驻**显示（以表格列出壁纸可能触发的事件与触发条件）；关闭 ⇒ 消失。
   * 热切换，见 `index.ts` 的 `applyWePatch`；内容由 `archive.ts` 从运行时 config 现算。
   */
  showArchive?: boolean;
  /** 设置面板当前是否展开。仅用于重载后还原 UI 状态 */
  panelOpen?: boolean;
};

/** 合并后的"当前生效值"，给面板渲染用（永远有值，无 undefined） */
export type SettingsView = {
  /** 全部静音（总闸） */
  muteAll: boolean;
  bgmEnabled: boolean;
  bgmVolume: number;
  subtitleEnabled: boolean;
  subtitlePosition: 'game' | 'bottom' | 'custom';
  /** 字幕自由定位的水平锚点（0~1，仅 custom 生效） */
  subtitleAnchorU: number;
  /** 字幕自由定位的垂直锚点（0~1，仅 custom 生效） */
  subtitleAnchorV: number;
  voiceEnabled: boolean;
  /** 角色语音（念白 CV）音量 0~1。对应 `config.subtitle.audio.volume` */
  voiceVolume: number;
  /** 是否把「问候」条目并入触摸池（对应 `config.subtitle.greetInTouchPool`） */
  greetInTouchPool: boolean;
  /** 摩天轮轿厢姿态角：`gravity` = 解包 −15°（随画面重力）/ `game` = 画布对齐 0° */
  cabinMode: 'gravity' | 'game';
  /** 指针（鼠标）拖尾粒子是否开启（对应 `config.pointerTrail.enabled`） */
  pointerTrailEnabled: boolean;
  idleSequenceEnabled: boolean;
  idleSequenceItems: string[];
  idleSequenceGapMs: number;
  /** 待机多久后触发一次「待机自动播放」（秒）。对应 config.subtitle.standbyIdleMs */
  standbyIdleSec: number;
  /** 待机到点是否自动触发「问候」（greet）事件 */
  standbyGreetEnabled: boolean;
  /** 待机到点是否自动触发「触摸」事件（池 = `chat` + `touch`，随机取一条） */
  standbyTouchEnabled: boolean;
  /** 正在播动作时点击的处理方式（对应 `config.subtitle.touchFeedbackMode`） */
  touchFeedbackMode: TouchFeedbackMode;
  /** 问候事件的取条方式（对应 `config.subtitle.greetMode`） */
  greetMode: GreetMode;
  /** 探针总开关（= 编译期闸门 ⊗ config.probe.enabled） */
  probeEnabled: boolean;
  probeHud: boolean;
  probeCrosshair: boolean;
  probeZones: boolean;
};

/** localStorage 不可用时的退路 */
let memoryFallback: SettingsOverrides = {};
let storageWarned = false;

const isPlainOverrides = (v: unknown): v is SettingsOverrides =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 读当前覆盖层。任何异常都退化为空对象（= 全用 config 默认值） */
export const readOverrides = (): SettingsOverrides => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...memoryFallback };
    }
    const parsed = JSON.parse(raw) as unknown;
    return isPlainOverrides(parsed) ? parsed : { ...memoryFallback };
  } catch (e) {
    if (!storageWarned) {
      storageWarned = true;
      console.warn(
        '[settings] localStorage 不可用，设置将只在本次会话内有效: %s',
        (e as Error)?.message ?? e
      );
    }
    return { ...memoryFallback };
  }
};

/** 合并写入并返回合并后的全量覆盖层 */
export const writeOverrides = (patch: SettingsOverrides): SettingsOverrides => {
  const next: SettingsOverrides = { ...readOverrides(), ...patch };
  memoryFallback = { ...next };
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    // 已在 readOverrides 里 warn 过，这里不再刷屏
  }
  return next;
};

export const clearOverrides = (): void => {
  memoryFallback = {};
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch (e) {
    // ignore
  }
};

/**
 * 「恢复默认」在清空覆盖层之后**额外强制写入**的少数几项。
 *
 * ## 为什么不能只调 `clearOverrides()`
 *
 * `clearOverrides()` 只是删掉 localStorage ⇒ 所有值回落到 `assets/config.json`。
 * 而本工程是**开发态探针工程**，`config.json` 里 `probe.enabled` / `probe.hud` 都是
 * `true` ⇒ 点「恢复默认」后调试总开关与 HUD 反而是**打开**的，与用户预期相反
 * （用户 2026-09-30 拍板：恢复默认应当**不勾选调试**）。
 *
 * ## 为什么是"额外强制"而不是改 `config.json` 里 `probe` 的默认值
 *
 * 那几个默认值是**开发期刻意留的**（本机调壁纸要开 HUD 看坐标／帧率／命中数）。
 * 改它会连带影响每次冷启动的初始状态 ⇒ 属于"顺手改了不相干的东西"。
 * 这里只把这几个键写进覆盖层，作用范围严格限定在「恢复默认」这一个动作上。
 */
export const RESET_OVERRIDES: Readonly<SettingsOverrides> = {
  probeEnabled: false,
  probeHud: false,
  probeCrosshair: false,
  probeZones: false,
};

/**
 * 把覆盖层合并进 config，得到真正生效的配置。
 *
 * ★ **不改原对象**（浅拷贝后改），因为传进来的通常就是 `await res.json()` 的结果，
 * 直接改会让"当前默认值"读不回来，面板也就无从显示"哪些是被覆盖过的"。
 */
export const applyOverrides = (cfg: Configs, o: SettingsOverrides): Configs => {
  if (!isPlainOverrides(o) || Object.keys(o).length === 0) {
    return cfg;
  }
  const out: Configs = { ...cfg };

  // 静音总闸的**值**先记下来（供面板回读）；真正的"压制"在末尾做，见下
  if (o.muteAll !== undefined) {
    out.muteAll = o.muteAll;
  }

  const needBgm = o.bgmEnabled !== undefined || o.bgmVolume !== undefined;
  if (needBgm) {
    out.bgm = { ...(cfg.bgm ?? {}) };
    if (o.bgmEnabled !== undefined) {
      out.bgm.enabled = o.bgmEnabled;
    }
    if (o.bgmVolume !== undefined) {
      out.bgm.volume = o.bgmVolume;
    }
  }

  const needSubtitle =
    o.subtitleEnabled !== undefined ||
    o.voiceEnabled !== undefined ||
    o.voiceVolume !== undefined ||
    o.greetInTouchPool !== undefined ||
    o.subtitlePosition !== undefined ||
    o.standbyGreetEnabled !== undefined ||
    o.standbyTouchEnabled !== undefined ||
    o.touchFeedbackMode !== undefined ||
    o.greetMode !== undefined;
  if (needSubtitle) {
    out.subtitle = { ...(cfg.subtitle ?? {}) };
    if (o.subtitleEnabled !== undefined) {
      out.subtitle.enabled = o.subtitleEnabled;
    }
    if (o.subtitlePosition !== undefined) {
      out.subtitle.position = o.subtitlePosition;
    }
    if (o.subtitleAnchorU !== undefined) {
      out.subtitle.anchorU = o.subtitleAnchorU;
    }
    if (o.subtitleAnchorV !== undefined) {
      out.subtitle.anchorV = o.subtitleAnchorV;
    }
    /**
     * ★ 两处 `subtitle.audio` 的 base 一律取 **`out.subtitle.audio`**（不是 `cfg.subtitle.audio`）——
     * 同一个 patch 里同时带 `voiceEnabled` 与 `voiceVolume` 时，后一个必须在**前者刚建好的
     * 那个对象**上继续改，否则会把 `enabled` 覆盖回去（同一个坑 `standbyIdleMs` 注释里写过）。
     */
    if (o.voiceEnabled !== undefined) {
      out.subtitle.audio = {
        ...(out.subtitle.audio ?? cfg.subtitle?.audio ?? {}),
      };
      out.subtitle.audio.enabled = o.voiceEnabled;
    }
    if (o.voiceVolume !== undefined) {
      out.subtitle.audio = {
        ...(out.subtitle.audio ?? cfg.subtitle?.audio ?? {}),
      };
      out.subtitle.audio.volume = o.voiceVolume;
    }
    if (o.greetInTouchPool !== undefined) {
      out.subtitle.greetInTouchPool = o.greetInTouchPool;
    }
    if (o.standbyGreetEnabled !== undefined) {
      out.subtitle.standbyGreetEnabled = o.standbyGreetEnabled;
    }
    if (o.standbyTouchEnabled !== undefined) {
      out.subtitle.standbyTouchEnabled = o.standbyTouchEnabled;
    }
    /**
     * ★★ 两个新事件的覆盖写在 `needSubtitle` 分支**之内** —— 它们都是 `subtitle` 下的字段，
     *    若像 `standbyIdleSec` 那样单独再 spread 一次 `out.subtitle`，同一 patch 里
     *    其它 subtitle 字段的修改会被它后面的分支写回旧值（该坑注释已写过两次）。
     */
    if (o.touchFeedbackMode !== undefined) {
      out.subtitle.touchFeedbackMode = o.touchFeedbackMode;
    }
    if (o.greetMode !== undefined) {
      out.subtitle.greetMode = o.greetMode;
    }
  }

  /** 摩天轮轿厢姿态角（「画面调整」页） */
  if (o.cabinMode !== undefined) {
    out.ferrisWheel = { ...(cfg.ferrisWheel ?? {}) };
    out.ferrisWheel.cabinMode = o.cabinMode;
  }

  /**
   * 指针拖尾总开关（「画面调整」页）。
   *
   * ★ 只覆写 `enabled`，其余字段（`planeZ` / `emitters`）原样沿用 config ——
   *   面板只暴露"开不开"，参数仍以 config.json 为唯一数据源。
   */
  if (o.pointerTrailEnabled !== undefined) {
    out.pointerTrail = { ...(cfg.pointerTrail ?? { emitters: [] }) };
    out.pointerTrail.enabled = o.pointerTrailEnabled;
  }

  const needSeq =
    o.idleSequenceEnabled !== undefined ||
    o.idleSequenceItems !== undefined ||
    o.idleSequenceGapMs !== undefined;
  if (needSeq) {
    out.idleSequence = { ...(cfg.idleSequence ?? {}) };
    if (o.idleSequenceEnabled !== undefined) {
      out.idleSequence.enabled = o.idleSequenceEnabled;
    }
    if (o.idleSequenceItems !== undefined) {
      out.idleSequence.items = o.idleSequenceItems.slice();
    }
    if (o.idleSequenceGapMs !== undefined) {
      out.idleSequence.gapMs = o.idleSequenceGapMs;
    }
  }

  /**
   * 待机触发聊天的延迟（秒 → 毫秒落到 `subtitle.standbyIdleMs`）。
   *
   * ★ 必须先 spread `out.subtitle`（而不是 `cfg.subtitle`）：
   * 上面的 `needSubtitle` 分支可能已改过 `out.subtitle.enabled` 等字段，
   * 直接 `{ ...cfg.subtitle }` 会把它们覆盖回去。
   */
  if (o.standbyIdleSec !== undefined) {
    out.subtitle = { ...(out.subtitle ?? cfg.subtitle ?? {}) };
    out.subtitle.standbyIdleMs =
      Math.max(0, Math.round(o.standbyIdleSec)) * 1000;
  }

  const needProbe =
    o.probeEnabled !== undefined ||
    o.probeHud !== undefined ||
    o.probeCrosshair !== undefined;
  if (needProbe) {
    out.probe = { ...(cfg.probe ?? {}) };
    if (o.probeEnabled !== undefined) {
      out.probe.enabled = o.probeEnabled;
    }
    if (o.probeHud !== undefined) {
      out.probe.hud = o.probeHud;
    }
    if (o.probeCrosshair !== undefined) {
      out.probe.crosshair = o.probeCrosshair;
    }
  }

  // 热区调试框挂在 touch 块下（数据源是同一条热区表，见 index.ts）
  if (o.probeZones !== undefined) {
    out.touch = { ...(cfg.touch ?? {}) };
    out.touch.showZones = o.probeZones;
  }

  /**
   * ★★ 静音总闸的**压制**必须放在最后：它是比 `bgmEnabled` / `voiceEnabled`
   * 更高一级的约束，放前面会被上面那两个分支覆盖回去。
   * 单向压制 —— **不回写**那两个字段，解除静音后各自的组合原样还原。
   */
  if (o.muteAll === true) {
    out.bgm = { ...(out.bgm ?? cfg.bgm ?? {}) };
    out.bgm.enabled = false;
    out.subtitle = { ...(out.subtitle ?? cfg.subtitle ?? {}) };
    out.subtitle.audio = {
      ...(out.subtitle.audio ?? cfg.subtitle?.audio ?? {}),
    };
    out.subtitle.audio.enabled = false;
  }

  return out;
};

/** 把 `idleSequence.items` 的任意写法折成一个可比较的字符串（用于"有没有变化"的判断） */
const stringifyItem = (it: unknown): string => {
  if (typeof it === 'string') {
    return it;
  }
  if (it && typeof it === 'object') {
    const obj = it as { animation?: string; actionId?: number };
    if (typeof obj.animation === 'string') {
      return obj.animation;
    }
    if (typeof obj.actionId === 'number') {
      return '#' + obj.actionId;
    }
  }
  return '';
};

/** 从（合并后的）配置读出"当前生效值"给面板渲染 */
export const readView = (cfg: Configs): SettingsView => ({
  muteAll: cfg.muteAll === true,
  bgmEnabled: cfg.bgm?.enabled !== false,
  bgmVolume: typeof cfg.bgm?.volume === 'number' ? cfg.bgm.volume : 0.5,
  subtitleEnabled: cfg.subtitle?.enabled !== false,
  subtitlePosition: cfg.subtitle?.position ?? 'custom',
  subtitleAnchorU:
    typeof cfg.subtitle?.anchorU === 'number' ? cfg.subtitle.anchorU : 0.5,
  subtitleAnchorV:
    typeof cfg.subtitle?.anchorV === 'number' ? cfg.subtitle.anchorV : 0.9,
  voiceEnabled: cfg.subtitle?.audio?.enabled !== false,
  /**
   * ★ 缺省 **1.0**，与 `voicePlayer.ts` 的 `cfg.volume ?? 1` 同一口径
   *   （语音若在这里少给默认值，会出现"面板显示 50%、实际按 100% 响"的假象）。
   */
  voiceVolume:
    typeof cfg.subtitle?.audio?.volume === 'number'
      ? cfg.subtitle.audio.volume
      : 1,
  greetInTouchPool: cfg.subtitle?.greetInTouchPool === true,
  /**
   * ★ 缺省 `gravity`（= 沿用解包 `startRotation` 的 −15°），**不是** `game`。
   *   理由：本壁纸此前的观感就是解包值，改默认等于"升级后画面悄悄变了"；
   *   想要游戏那份水平姿态的用户自己去「画面调整」页切即可。
   */
  cabinMode: cfg.ferrisWheel?.cabinMode ?? 'gravity',
  /**
   * ★ 缺省 `false`：与 `pointerTrail.ts` 的口径一致（`enabled` 必须显式为 true 才建发射器），
   *   这样没有 `pointerTrail` 块的旧 config 跑起来不会多出视觉元素。
   */
  pointerTrailEnabled: cfg.pointerTrail?.enabled === true,
  idleSequenceEnabled: cfg.idleSequence?.enabled === true,
  idleSequenceItems: (cfg.idleSequence?.items ?? [])
    .map(stringifyItem)
    .filter((s) => !!s),
  idleSequenceGapMs:
    typeof cfg.idleSequence?.gapMs === 'number' ? cfg.idleSequence.gapMs : 0,
  // 缺省 25 秒，与 config.subtitle.standbyIdleMs 的 25000ms 对齐
  standbyIdleSec:
    typeof cfg.subtitle?.standbyIdleMs === 'number'
      ? Math.round(cfg.subtitle.standbyIdleMs / 1000)
      : 25,
  /**
   * ★ 缺省 false：待机播问候是 2026-09-30 新增的能力，缺省关才不会"升级后行为悄悄变了"。
   *   判据必须写 `=== true`（而不是 `!== false`）—— 否则缺字段的旧 config 会被判成"开"。
   */
  standbyGreetEnabled: cfg.subtitle?.standbyGreetEnabled === true,
  /**
   * ★ 缺省 **false**（判据 `=== true`，用户 2026-09-30 拍板）：与 `standbyGreetEnabled`
   *   一致，两个开关**出厂都关** ⇒ 待机不自动播；想让角色自己说话就去「动作」页打开。
   *   ⚠️ 判据**不能**写成 `!== false` —— 那会让缺字段的旧 config 被判成"开"。
   */
  standbyTouchEnabled: cfg.subtitle?.standbyTouchEnabled === true,
  /**
   * ★ 缺省 `'immediate'`（见 `TouchFeedbackMode` 注释里选它的理由）。
   *
   * 判据写成"只认另两个合法值"而不是"认缺省值" ⇒ 写了无效字符串时也回落到缺省档，
   * 与 `touch.ts` 的解析口径同向（不可能拆成两种解析，否则"面板显示的和实际行为不同"）。
   */
  touchFeedbackMode:
    cfg.subtitle?.touchFeedbackMode === 'queue' ||
    cfg.subtitle?.touchFeedbackMode === 'none'
      ? cfg.subtitle.touchFeedbackMode
      : 'immediate',
  /** ★ 缺省 `'time'`（= 改动前"按时段问候"的行为）；判据同上：只认 `'random'` 这一个例外值 */
  greetMode: cfg.subtitle?.greetMode === 'random' ? 'random' : 'time',
  // ★ `enabled` 的**缺省**取决于编译期（`--env probe=off` 的发布包默认关），
  //   所以不能写死 true，否则正式版里面板会显示"开"而实际没挂（理论≠实际）。
  //   `PROBE_OPTS.enabled` 初值 = `__PROBE__`，且已被 `applyProbeConfig` 按
  //   config/覆盖层改过 ⇒ 用它兜底读到的就是"当前生效值"。
  probeEnabled: cfg.probe?.enabled ?? PROBE_OPTS.enabled,
  probeHud: cfg.probe?.hud !== false,
  probeCrosshair: cfg.probe?.crosshair !== false,
  probeZones: cfg.touch?.showZones === true,
});

/* ── WE 属性桥 ───────────────────────────────────────────── */

/**
 * WE 注入到 `window` 上的宿主监听器。**类型定义在 `wePauseSignal.ts`**（那里是本项目
 * 唯一的 `declare global` 位置），这里只是 import 过来用 —— 全局增补写两处会冲突。
 */
import {
  ensureWallpaperPropertyListener,
  WallpaperPropertyListener,
} from './wePauseSignal';

/**
 * 安装 `applyUserProperties`。必须在业务初始化**之前**调用 ——
 * WE 可能在页面很早期就下发属性，装晚了那一拨就丢了。
 *
 * ## ★★ 这个对象**必须我们自建**（2026-09-26 修正，旧注释"绝不自建"是错的）
 *
 * 旧规写的是"只补字段、绝不自建"，理由是怕 `hasWallpaperPause()` 判据失真。
 * 真机取证证明那条旧规**直接导致 WE 属性全线失效**：
 * `wallpaperPropertyListener` 按官方口径本就是**壁纸作者创建**的对象，
 * WE 只往上面**补** `applyUserProperties` / `setPaused`；我们从不建它 ⇒
 * WE 的注入脚本在 `window.wallpaperPropertyListener.xxx = …` 处整个中断 ⇒
 * 属性面板里**所有选项勾了都没反应**（实测 `wpl` 全程 `undefined`）。
 *
 * 判据失真的问题由 `ensureWallpaperPropertyListener` 里的 **WE 环境闸门**解决：
 * 它只在 `window.___wpxUnpause`（WE 专有全局）存在时才建对象，
 * ⇒ 普通浏览器里依然"没有 listener"，`hasWallpaperPause()` 仍为 `false`。
 *
 * ## 为什么要轮询重试
 *
 * `index.html` 里已尽量早地建过一次，但宿主对象**也可能比本模块晚一点**才可用。
 * 等一小会儿再补，覆盖面更全；一直拿不到就停（不无限轮询）。
 *
 * @param handler 收到 WE 属性时调用
 * @param retryMs 重试间隔（毫秒）；`0` = 不重试
 * @param maxRetries 最多重试次数
 */
export const installWallpaperPropertyListener = (
  handler: (properties: Record<string, unknown>) => void,
  retryMs = 200,
  maxRetries = 25
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const tryAttach = (): boolean => {
    // ★ 无则建空壳、有则补字段：整体覆盖会丢 WE 早先下发的其它回调（`setPaused` 等）
    const wpl: WallpaperPropertyListener | null =
      ensureWallpaperPropertyListener();
    if (!wpl) {
      return false;
    }
    wpl.applyUserProperties = handler;
    return true;
  };

  if (tryAttach()) {
    return;
  }
  if (!retryMs || maxRetries <= 0) {
    return;
  }
  let tries = 0;
  const timer = window.setInterval(() => {
    tries++;
    if (tryAttach() || tries >= maxRetries) {
      window.clearInterval(timer);
    }
  }, retryMs);
};

/* ── WE 属性值的类型宽容解析 ─────────────────────────────── */

/**
 * WE 下发的属性值形状并不统一：官方文档示例是 `.value`，但布尔/滑块在不同版本里
 * 也可能直接给标量。这里两种都吃，解析不出来返回 `undefined`（= **当作没配**，
 * 不用猜测值去覆盖用户的 localStorage）。
 */
export const pickValue = (raw: unknown): unknown =>
  raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
    ? (raw as Record<string, unknown>).value
    : raw;

export const toBool = (raw: unknown): boolean | undefined => {
  const v = pickValue(raw);
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'number') {
    return v !== 0;
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') {
      return true;
    }
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') {
      return false;
    }
  }
  return undefined;
};

export const toNumber = (raw: unknown): number | undefined => {
  const v = pickValue(raw);
  if (typeof v === 'number' && isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (isFinite(n)) {
      return n;
    }
  }
  return undefined;
};

/** 宽容的枚举字符串解析：只接受 `allowed` 里的值（大小写不敏感），否则 undefined */
export const toEnum = <T extends string>(
  raw: unknown,
  allowed: readonly T[]
): T | undefined => {
  const v = pickValue(raw);
  if (typeof v !== 'string') {
    return undefined;
  }
  const s = v.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s);
};

/**
 * 把 WE 下发的一批属性翻译成覆盖层补丁。**只认已知的键**，其余忽略。
 *
 * ## ★★ WE 属性面板只暴露 **5 项**（2026-09-26 拍板 3 项，09-27 增补第 4 项，09-30 增补第 5 项）
 *
 * | WE 属性键 | 含义 | 落到的覆盖层字段 |
 * |---|---|---|
 * | `showSettings` | 设置按钮显示 | `showSettings` |
 * | `muteAll` | 全部静音 | `muteAll` |
 * | `debugEnabled` | 调试总开关 | `probeEnabled`（与面板「调试」页同一个字段 ⇒ 两边同源） |
 * | `showDisclaimer` | 显示免责声明与许可证要求 | `showDisclaimer`（居中弹窗，常驻显示） |
 * | `showArchive` | 显示档案 | `showArchive`（居中「档案」面板，常驻显示） |
 *
 * 其余小项（BGM 开关/音量、字幕显示/位置、念白语音、常驻动作序列）
 * **一律不进 WE 属性面板** —— 它们都在右上角设置面板里，那儿能点选动画名、
 * 有滑块和预设，比 WE 的 combo/text 好用得多。
 *
 * ⚠️ 因此下面**故意不认** `bgmEnabled` / `bgmVolume` / `subtitleEnabled` /
 * `subtitlePosition` / `voiceEnabled` / `idleSequenceEnabled`：
 * 即使旧版 `project.json` 或用户存档里还留着这些键，也会被静默忽略，
 * 不会污染覆盖层。
 */
export const overridesFromWeProperties = (
  properties: Record<string, unknown>
): SettingsOverrides => {
  const patch: SettingsOverrides = {};
  if (!properties || typeof properties !== 'object') {
    return patch;
  }
  const b = (key: string): boolean | undefined =>
    key in properties ? toBool(properties[key]) : undefined;

  /** 右上角设置按钮显不显示（UI 门面开关，不是配置项） */
  const showSettings = b('showSettings');
  if (showSettings !== undefined) {
    patch.showSettings = showSettings;
  }

  /**
   * 居中「免责声明与许可证要求」弹窗显不显示。
   *
   * ★ 与 `showSettings` 同一类：只管一个 DOM 的 `display`，
   * 不进 `SettingsView` ⇒ `sameView` 判不出变化 ⇒ 由 `index.ts` 热切换。
   */
  const showDisclaimer = b('showDisclaimer');
  if (showDisclaimer !== undefined) {
    patch.showDisclaimer = showDisclaimer;
  }

  /**
   * 居中「档案」面板显不显示（列出壁纸可能触发的事件与触发条件）。
   *
   * ★ 与 `showDisclaimer` 同一类：只管一个 DOM 的 `display`，
   * 不进 `SettingsView` ⇒ `sameView` 判不出变化 ⇒ 由 `index.ts` 热切换。
   */
  const showArchive = b('showArchive');
  if (showArchive !== undefined) {
    patch.showArchive = showArchive;
  }

  /** 全部静音（BGM + 念白一起关） */
  const muteAll = b('muteAll');
  if (muteAll !== undefined) {
    patch.muteAll = muteAll;
  }

  /**
   * 调试总开关 ⇒ 落到 **`probeEnabled`**（复用面板「调试」页已有的字段）。
   *
   * 为什么不新建一个 `debugEnabled` 字段：那会和面板里的「探针总开关」
   * 变成**两套真值**，谁最后写谁生效，用户会看到面板和 WE 面板打架。
   */
  const debugEnabled = b('debugEnabled');
  if (debugEnabled !== undefined) {
    patch.probeEnabled = debugEnabled;
  }
  return patch;
};

/**
 * 两个**生效值视图**是否完全一致。
 *
 * ## ★★ 为什么"值没变就不重载"必须比视图，而不是比覆盖层
 *
 * 早期写法是 `diffOverrides(改动前的覆盖层, 改动后的覆盖层)`，看着对，**实则会漏**：
 * 首次启动时 localStorage 是空的，WE 下发的属性值哪怕和 `config.json` 默认值
 * **完全相同**（比如都是"开"），也会被判成"从无到有 = 有变化" ⇒ 白重载一次。
 *
 * 正确的判据是**"新值有没有改变当前生效值"** —— 生效值 = `config` 默认值 ⊗ 覆盖层。
 * 只有它变了才值得重启一次。
 */
export const sameView = (a: SettingsView, b: SettingsView): boolean => {
  if (
    a.muteAll !== b.muteAll ||
    a.bgmEnabled !== b.bgmEnabled ||
    a.subtitleEnabled !== b.subtitleEnabled ||
    a.subtitlePosition !== b.subtitlePosition ||
    a.subtitleAnchorU !== b.subtitleAnchorU ||
    a.subtitleAnchorV !== b.subtitleAnchorV ||
    a.voiceEnabled !== b.voiceEnabled ||
    // ★ 问候是否入触摸池也要比：否则"只改了这一项"会被判成"没变化"而不重载
    a.greetInTouchPool !== b.greetInTouchPool ||
    // ★ 轿厢姿态也要比：否则"只改了画面调整页"会被判成"没变化"而不重载
    a.cabinMode !== b.cabinMode ||
    // ★ 指针拖尾开关同理：它只改 pointerTrail.enabled，漏比就会"只改这项不重载"
    a.pointerTrailEnabled !== b.pointerTrailEnabled ||
    a.idleSequenceEnabled !== b.idleSequenceEnabled ||
    a.idleSequenceGapMs !== b.idleSequenceGapMs ||
    // ★ 调试项也要比：否则"只改了 HUD/红圈"会被判成"没变化"而不重载
    a.probeEnabled !== b.probeEnabled ||
    a.probeHud !== b.probeHud ||
    a.probeCrosshair !== b.probeCrosshair ||
    a.probeZones !== b.probeZones ||
    // ★ 待机延迟也要比：否则"只改了等待时长"会被判成"没变化"而不重载
    a.standbyIdleSec !== b.standbyIdleSec ||
    // ★ 待机自动触发的两个类别开关也要比（2026-09-30）：漏比 ⇒"只改了这项"不重载
    a.standbyGreetEnabled !== b.standbyGreetEnabled ||
    a.standbyTouchEnabled !== b.standbyTouchEnabled ||
    // ★ 触摸反馈策略也要比（2026-10-08）：漏比 ⇒"只改了这一档"不重载
    a.touchFeedbackMode !== b.touchFeedbackMode ||
    // ★ 问候触发方式同理（2026-10-08）：漏比 ⇒"只改了这一项"不重载
    a.greetMode !== b.greetMode
  ) {
    return false;
  }
  // 音量按 1% 粒度比较：WE 滑块是整数百分比，浮点直接 === 会有无意义的抖动
  if (Math.round(a.bgmVolume * 100) !== Math.round(b.bgmVolume * 100)) {
    return false;
  }
  // ★ 角色语音音量同理（同 1% 粒度）：漏比 ⇒"只拖了语音音量"不重载
  if (Math.round(a.voiceVolume * 100) !== Math.round(b.voiceVolume * 100)) {
    return false;
  }
  if (a.idleSequenceItems.length !== b.idleSequenceItems.length) {
    return false;
  }
  for (let i = 0; i < a.idleSequenceItems.length; i++) {
    if (a.idleSequenceItems[i] !== b.idleSequenceItems[i]) {
      return false;
    }
  }
  return true;
};
