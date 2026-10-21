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
 * 右上角**入口列**（6 个按钮）与它开出来的两个面板（**设置** / **调试**）。
 *
 * ## 入口列（2026-10-17 晚定稿）
 *
 * WE 的属性面板里有 5 项开关，但壁纸里能直接点到的原先只有「设置」「调试」两个。
 * 现在把它们**并成同一列**，放在**右上角纵向排列**，顺序 = WE 属性面板的顺序
 * （`showCornerButtons` 是属性面板的**第一项**，「设置」不是配置项、只是入口）：
 *
 * ```
 *  ⌃      折叠/展开（唯一常驻的那个按钮）
 *  ⚙      设置        ← 非配置项（原来那个 `showSettings` 已删除，见下）
 *  🔇     静音        ← WE `muteAll`（桌面上"一键闭嘴"，纯运行时不写配置）
 *  🐛     调试        ← WE `debugEnabled`
 *  🛡     免责声明    ← WE `showDisclaimer`
 *  📖     档案        ← WE `showArchive`
 * ```
 *
 * ★★ **整列的显隐只有一个开关**：WE 属性 `showCornerButtons`（属性面板第一项
 *   「显示右上角按钮」）。**历史上**曾有过第二个开关 `showSettings`（设置按钮显示）
 *   专门管齿轮 —— 2026-10-17 晚用户拍板撤回该"分治"方案（多了个只在开关上打架的
 *   维度），`showSettings` 已**从 WE 属性表、覆盖层、引擎全链路删除**；
 *   齿轮现在与其余 4 个入口**条件完全一致**（列可见 && 未收起）。
 *   ⚠️ 老存档/老 project.json 里残留的 `showSettings` 键会被**静默忽略**（不再被读）。
 * ★ 为什么是**右上角**：WE 自身的缓冲区/水印在右上角，但壁纸的控件必须避开
 *   左上角的探针 HUD（开发态 HUD 恒在 `left:0;top:0`）—— 且素材取景是"角色居中偏左"，
 *   右上角本来就是空场。
 * ★ 图标一律**内联 SVG**（不依赖字体 glyph —— CEF 里缺字会变豆腐块），
 *   尺寸走 `uiPx()` 与整个 UI 同源缩放。
 * ★ 4 个按钮是「开/关某个面板」的互斥切换，会在激活时高亮；
 *   「静音」是纯运行时的音量压制，图标随状态在**喇叭/喇叭打叉**之间切换。
 * ★ 折叠按钮**永远可见**（只要整列没被 WE 关掉），其余 5 个由它统一收起/展开，
 *   状态持久化在覆盖层的 `cornerCollapsed`（默认展开）。
 * ★★ 收起时会把两个面板**一起关掉**：设置面板**没有自己的关闭按钮**
 *   （开关都靠齿轮），齿轮一藏就再也关不掉 ⇒ 会留在屏幕上出不去。
 *
 * ## ★★ 调试为什么从设置面板里独立出来（用户 2026-10-15 拍板）
 *
 * 原先「调试」是设置面板里的**第 6 个分页**（总开关 / HUD / 红圈 / 热区框 4 项）。
 * 它跟其余 6 页不是一类东西：那些是**观赏设置**（调完就不管了），
 * 而调试是**诊断工具**（排查时反复开关、每次改完都要重载）。
 * ⇒ 塞在同一面板里 ⇒ 每次排查都要"开面板 → 翻到调试页 → 改 → 保存"四步。
 *
 * 改法：调试页整个撤掉，改成入口列里的一个按钮 + 一个常驻小面板，
 * 一步点到、改完就地保存。它与设置面板**互斥展开**（见 `setDebugOpen`）。
 *
 * ⚠️ 只是**搬了入口**，字段没变：4 个开关仍落在 `probeEnabled / probeHud /
 * probeCrosshair / probeZones`，存盘格式与 WE 属性面板的「调试总开关」
 * （`debugEnabled` → `probeEnabled`）**完全兼容**，老存档零影响。
 *
 * ## ★★ 必须 `stopPropagation` 的理由（不做的话会发生什么）
 *
 * `touch.ts` 把 mousedown 监听挂在 **`document`** 上，而本工程的热区是
 * **整屏一个区**（`touch.zones` 覆盖全画面）。⇒ 点入口按钮/面板会被判定成
 * "点了角色"，触摸动画照播、字幕照弹。这类"顺带触发"很容易被当成 WE 的玄学 bug。
 *
 * 而且 `SpineAnimator` 也在 `document` 上挂了 mousedown（带 `preventDefault()`），
 * 不拦的话连 focus 都可能被吃掉 ⇒ 复选框点不动。
 *
 * ⇒ 在**入口列容器**与**面板根节点**上对鼠标/触摸事件 `stopPropagation`，
 *   让事件到不了 `document`。（监听器都在冒泡阶段，目标阶段的 stopPropagation 正好能挡住。）
 *
 * ## z-index 口径
 *
 * 气泡 `2147483640` < 热区调试框 `2147483645` < 免责弹窗 `2147483646` < **本面板 `2147483647`**。
 * 设置必须盖在所有东西之上，否则被气泡挡住就点不到了。
 *
 * ## DOM 锚点
 *
 * 每个元素都带 `id`（`wb-settings-*` / `wb-corner-*`）并用 **`data-wb-set` 属性**
 * 而不是下标取元素 —— 改一次结构就让一堆验证脚本同时失效的教训已经有过一次了。
 *
 * ## ★★ 禁用 `backdrop-filter`（WE CEF 渲染进程 SIGILL，2026-09-25 实锤）
 *
 * 面板本体曾用 `backdrop-filter:blur(14px)`（齿轮 blur(6px)），在 Wallpaper Engine
 * 的 CEF（Chromium 146 / ANGLE-D3D11）上**点开面板即崩渲染进程**
 * （`Aw Snap / STATUS_ILLEGAL_INSTRUCTION`，0.2s 内必现；本机 Chrome 与 WE 内
 * 「预览窗格」均不崩 —— 只有桌面路径崩，极难排查）。
 *
 * 对照证据：
 * - 气泡 `blurLayer` 的 `backdrop-filter:blur(8.04px)`（小面积、无滚动容器）
 *   在 WE 上长期稳定（9.21 起验证）⇒ 特性本身可用；
 * - 面板差异 = 大面积 + `overflow-y:auto` 滚动容器 + `display:none→block` 动态挂载。
 *
 * 且 `panelOpen` 会被持久化 ⇒ 崩一次后 localStorage 残留 `panelOpen:true`，
 * 下次加载直接展开面板 ⇒ **加载即崩的自锁循环**（表现为"导入必崩 0.2s"）。
 *
 * ⇒ 面板/入口按钮一律用**实色半透明背景**代替毛玻璃。气泡模糊不受影响。
 */

import {
  DialogueEntry,
  EventFamily,
  TriggerChannel,
  TriggerEventKind,
  TriggerPhase,
  WallpaperSettingItem,
  WallpaperSettingsConfig,
} from './config.type';
import {
  TRIGGER_KIND_ORDER,
  buildFamilyRegistry,
  normalizeTriggerKinds,
  normalizeTriggerPhases,
} from './dialogue';
import { channelsOf, eventKeyOf } from './eventModel';
import { describeCondition } from './conditions';
import { changedEventKeys, EventState } from './eventOverrides';
import { SettingsOverrides, SettingsView } from './settingsStore';
import { UI_SCALE_VAR, fpx, getUiScale, initUiScale, uiPx } from './uiScale';

/**
 * 调试面板「触发事件」的一条候选 —— 就是事件表（`assets/events.jsonc`）里的一条。
 *
 * ★ 只带**显示用**的字段：面板不解析念白内容，触发一律交给调用方
 *   （它手里才有 `touchController` 与打断闸门）。
 *
 * ⚠️ **2026-10-20 修**：凭据从 `actionId` 换成 `EventKey`（`key`）。
 *   自定义事件**没有** `actionId`（`custom:hold-hand` 这种），旧口径下
 *   `String(e.actionId)` ⇒ 面板显示 `undefined`、多条共用 DOM id
 *   `wb-debug-ev-undefined`、点击传 `NaN` 永远播不出来。
 *   `key` 与 `__WB_DIALOGUE__.trigger` / 档案 / 漏斗用的是同一个身份，不新增第二判据。
 */
export type DebugEventItem = {
  /** 事件键（`game:64005` / `custom:hold-hand`）—— **触发的唯一凭据** */
  key: string;
  /** 面板上显示的名字：`displayName || label || key` */
  name: string;
  /** 动作表 ID（内置事件才有，**仅显示**） */
  actionId?: number;
  /** 该条对应的动画名（仅显示） */
  animation?: string;
};

export type SettingsPanelOptions = {
  /** 骨架里可用的动画名（用于序列的候选按钮 + 调试面板「触发动作」） */
  animations: string[];
  /**
   * 调试面板「触发事件」的候选条目（= 全部念白）。
   *
   * ★ 不传 / 空数组 ⇒ 面板**不建**这一组（没有念白的壁纸不该摆一排永远空着的方块，
   *   与「壁纸独立设置」页同一口径）。
   */
  events?: readonly DebugEventItem[];
  /** 当前生效值 */
  view: SettingsView;
  /**
   * 本壁纸的「壁纸独立设置」声明（对应 `config.wallpaperSettings`，见 `config.type.ts`）。
   *
   * ★ 缺省 / `items` 为空 ⇒ 面板**不建**这一页（连标签按钮一起省掉）。
   */
  wallpaperSettings?: WallpaperSettingsConfig;
  /**
   * 本壁纸的**事件族注册表**（对应 `config.subtitle.eventFamilies`，见 `config.type.ts`
   * 的 `EventFamily`）。
   *
   * ★ 缺省 / 归一后为空 ⇒ 「事件池」页**不建**「事件族」那一行
   *   （与 `wallpaperSettings` 同一口径：没有事件族的皮肤不该多出一个点不动的控件）。
   */
  eventFamilies?: EventFamily[];
  /**
   * 「spine 动作族显示」里**"不换名"那一档的显示名**（对应 `config.subtitle.actionPhaseBaseLabel`）。
   *
   * 誓约工程写「誓约前」⇒ 单选呈现 `[誓约前 | 誓约后]`。缺省 `'默认'`。
   * ★ 由调用方传原始 config 值 —— 面板不读配置文件，与 `eventFamilies` 同一口径。
   */
  actionPhaseBaseLabel?: string;
  /**
   * 右上角**整列入口**（折叠按钮 + 5 个入口）是否显示 —— WE 属性 `showCornerButtons`
   * （属性面板**第一项**「显示右上角按钮」）。缺省 `true`。
   *
   * ★★ 这是**唯一**的入口显隐开关（2026-10-17 晚）：原「设置按钮显示」（`showSettings`）
   *   已删除 ⇒ 齿轮不再有单独开关，与其余 4 个入口同进同出。
   */
  cornerVisible?: boolean;
  /**
   * 入口列是否**收起**（只留折叠按钮）。缺省 = 展开。
   * ★ 由调用方从覆盖层 `cornerCollapsed` 读出来传进来，变化时用
   *   `onCornerCollapsedChange` 回调落盘。
   */
  cornerCollapsed?: boolean;
  /**
   * 「静音」入口的初始状态（运行时静音，不是配置项）。
   *
   * ★ 面板只把它当**显示用初值**：真正的静音状态由调用方持有
   *   （`onToggleMute` 返回切换后的值），面板不自己猜。
   */
  muted?: boolean;
  /** 「免责声明」弹窗当前是否显示（仅用于入口按钮的高亮） */
  disclaimerVisible?: boolean;
  /** 「档案」面板当前是否显示（仅用于入口按钮的高亮） */
  archiveVisible?: boolean;
  /** 点「静音」入口 ⇒ 切换运行时静音，返回切换后的状态 */
  onToggleMute?: () => boolean;
  /**
   * 点「免责声明」入口 ⇒ 切换弹窗显示（并落盘），返回切换后的状态。
   *
   * ★ 弹窗本体不归面板所有（`disclaimer.ts` 是独立模块，由 `index.ts` 建）
   *   ⇒ 面板只发指令、拿回真值刷新高亮，不自己持有第二份状态。
   */
  onToggleDisclaimer?: () => boolean;
  /** 点「档案」入口 ⇒ 同 `onToggleDisclaimer` */
  onToggleArchive?: () => boolean;
  /** 面板是否初始展开 */
  open?: boolean;
  /**
   * 调试面板是否初始展开。
   *
   * ⚠️ 与 `open` **互斥**：两个都存了 `true` 时只有设置面板展开（见 `debugOpen` 初值）。
   */
  debugOpen?: boolean;
  /** 保存 ⇒ 由调用方落盘并重载 */
  onSave: (patch: SettingsOverrides) => void;
  /** 恢复默认 ⇒ 由调用方清覆盖层并重载 */
  onReset: () => void;
  /** 面板展开/收起变化时回调（用于把 `panelOpen` 也持久化） */
  onOpenChange?: (open: boolean) => void;
  /** 调试面板展开/收起变化时回调（用于把 `debugPanelOpen` 也持久化） */
  onDebugOpenChange?: (open: boolean) => void;
  /** 入口列收起/展开变化时回调（用于把 `cornerCollapsed` 也持久化） */
  onCornerCollapsedChange?: (collapsed: boolean) => void;
  /**
   * 调试面板「触发动作」：播**指定动画名**（不带台词/语音）。
   *
   * @returns 是否真的播了 —— 面板据此回显 ✓ / ×，不猜。
   */
  onPlayAnimation?: (name: string) => boolean;
  /**
   * 调试面板「触发事件」：按 **`EventKey`** 播**一整条念白**（动作+字幕+语音，走完整闸门）。
   *
   * @returns 是否真的播了（被打断规则挡下 = `false`）
   */
  onTriggerEvent?: (key: string) => boolean;
  /**
   * 「事件开关」页要展示的**事件表**（= `index.ts` 归一后的 `eventTable`，
   * `enabled` 已按用户开关压过）。
   *
   * ★ 面板**不读文件、也不自己归一** —— 档案/引擎/面板必须消费同一份表，
   *   否则"面板里列出来的条目"与"真的会播的条目"迟早对不上（PLAN 头号纪律）。
   */
  eventTable?: readonly DialogueEntry[];
  /**
   * 事件**文件**的状态（2026-10-19）。面板只拿它显示路径与错误：
   * 文件缺失 / 解析失败时显示红字（此时 `eventTable` 也必然是空的）。
   */
  eventsFile?: { path: string; error: string | null };
  /**
   * 事件开关的**初值**（`localStorage` 的 `EventState`）。
   *
   * ★ 面板把它当草稿：真正写盘在「保存并应用」里由 `onSaveEventState` 交给调用方，
   *   与设置项同一套"保存 → 重载"口径（不热切换）。
   */
  eventState?: EventState;
  /**
   * 事件**文件里的缺省开关**（键 → 是否默认开启），由 `eventOverrides.eventDefaultsOf`
   * 从 `assets/events.jsonc` 的**原始条目**算出（未压过用户开关）。
   *
   * ★ 2026-10-21：这一份数据就是本页「已改 N 项」与「恢复本页默认」的依据。
   *   不传 ⇒ 视作"全部默认开启"，两个功能降级（不会崩，只是计数不准）。
   */
  eventDefaults?: { [key: string]: boolean };
  /**
   * 保存事件开关（与设置项**同一次**保存）。
   *
   * ⚠️ 调用方必须在 `onSave` 的重载**之前**落盘 —— 否则重载后开关回到原样。
   */
  onSaveEventState?: (s: EventState) => void;
};

export type SettingsPanel = {
  /**
   * 入口列（= 右上角整列，含折叠按钮）显不显示 —— WE 属性 `showCornerButtons`。
   *
   * ★ 这是**唯一**的入口显隐 API：原 `setVisible` / `isVisible`（只控制齿轮）随
   *   WE 属性 `showSettings` 一起于 2026-10-17 晚删除。要判"入口在不在"用
   *   `isCornerVisible()`，要判"设置面板开没开"用 `isOpen()`。
   */
  setCornerVisible: (v: boolean) => void;
  isCornerVisible: () => boolean;
  /** 入口列当前是否收起（只留折叠按钮） */
  isCornerCollapsed: () => boolean;
  /**
   * 外部改了免责弹窗的显示（WE 属性热切换）后，把入口按钮的高亮同步过来。
   *
   * ★ 与「档案」那条对称：面板不持有弹窗状态，只按调用方给的真值刷高亮。
   */
  setDisclaimerVisible: (v: boolean) => void;
  /** 同 `setDisclaimerVisible`，对应「档案」入口 */
  setArchiveVisible: (v: boolean) => void;
  isOpen: () => boolean;
  /** 外部把 Séance 值改了之后刷新 UI（WE 属性下发时用） */
  refresh: (view: SettingsView) => void;
  dispose: () => void;
};

/* ── 「壁纸独立设置」页的输入规格 ───────────────────────────
 *
 * ★★ 这一页是全工程**唯一一个会按 config 出现/消失**的页：
 *   引擎是通用的（同一份 bundle 服务多张壁纸），而页里的项（摩天轮轿厢角度…）
 *   只对**声明了**的那张壁纸有意义 ⇒ 没声明的壁纸**看不到这一页**，
 *   而不是看到一个永远无效的控件（用户 2026-10-11 拍板的口径）。
 */

/** 「壁纸独立设置」页的输入规格（由 `resolveWallpaperPanelSpec` 从 config 解析而来） */
export type WallpaperPanelSpec = {
  /** 分组标题 = 本壁纸的名字（如「盛夏游乐场」） */
  label: string;
  /** 本壁纸声明的独立设置项（已过滤成面板认得的那些，见 `KNOWN_WALLPAPER_ITEMS`） */
  items: readonly WallpaperSettingItem[];
};

/** 面板**认得并能渲染**的「壁纸独立设置」项（新增一项要同时补页面里的渲染分支） */
export const KNOWN_WALLPAPER_ITEMS: readonly WallpaperSettingItem[] = [
  'cabinMode',
];

/**
 * 把 `config.wallpaperSettings` 解析成面板输入。
 *
 * - **未知项 id / 重复项 ⇒ 静默丢弃** —— 与 `dialogue.buildPool` 里"写错的 actionId
 *   只少一条候选、不会让整类失效"同一容错口径：config 里写错一个词，不该让整页消失；
 * - **过滤完一项不剩**（没声明 / `items: []` / 全是写错的 id）⇒ 返回 `null`
 *   ⇒ `createSettingsPanel` **不建这一页、也不建它的标签按钮**（见 TABS 的过滤）。
 *
 * ⚠️ 本函数**不碰任何设置值**：各项的值仍由 `view` 承载
 *   （`cabinMode` → `config.ferrisWheel.cabinMode`），这里只回答"展示哪些"。
 */
export const resolveWallpaperPanelSpec = (
  raw?: WallpaperSettingsConfig
): WallpaperPanelSpec | null => {
  const items: WallpaperSettingItem[] = [];
  (raw?.items ?? []).forEach((it) => {
    if (KNOWN_WALLPAPER_ITEMS.indexOf(it) >= 0 && items.indexOf(it) < 0) {
      items.push(it);
    }
  });
  if (!items.length) {
    return null;
  }
  const label = (raw?.label ?? '').trim();
  return { label: label || '本壁纸', items };
};

/*
 * ★ 下面所有 px 一律用 uiPx()（= `calc(Npx * var(--wb-ui-s, 1))`）：
 * 面板字号/尺寸随壁纸一起缩放，避免"浏览器小窗口看着正常、WE 全屏变小"。
 * 基准 750 与气泡 voiceBubble 的 referenceHeight 同源，详见 uiScale.ts。
 */

/* ★ 字号一律走 `uiScale.fpx()`（= uiPx 再叠一层统一偏移），不要在这里另起一套 */
const BTN_PRIMARY = [
  'flex:1',
  'padding:' + uiPx(7) + ' ' + uiPx(10),
  'border:none',
  'border-radius:' + uiPx(8),
  'background:#4a90e2',
  'color:#fff',
  'font-size:' + fpx(12.5),
  'font-family:inherit',
  'cursor:pointer',
].join(';');

const BTN_GHOST = [
  'flex:0 0 auto',
  'padding:' + uiPx(7) + ' ' + uiPx(10),
  'border:' + uiPx(1) + ' solid rgba(255,255,255,0.22)',
  'border-radius:' + uiPx(8),
  'background:transparent',
  'color:rgba(238,241,246,0.8)',
  'font-size:' + fpx(12.5),
  'font-family:inherit',
  'cursor:pointer',
].join(';');

/**
 * 行内小按钮（「恢复本页默认」这类**页内**操作）。
 *
 * ★ 为什么不复用 `BTN_GHOST`：底部那两个是 12.5px + 7px 内边距的**主操作**；
 *   页内按钮排在统计行右侧，用同样的尺寸会把「事件开关」页的行高顶起来
 *   （WE 不转发滚轮 ⇒ 内容一旦超高就只能靠分页）。
 */
const BTN_TINY = [
  'flex:0 0 auto',
  'padding:' + uiPx(2) + ' ' + uiPx(8),
  'border:' + uiPx(1) + ' solid rgba(255,255,255,0.2)',
  'border-radius:' + uiPx(6),
  'background:transparent',
  'color:rgba(238,241,246,0.72)',
  'font-size:' + fpx(10.5),
  'font-family:inherit',
  'line-height:1.5',
  'cursor:pointer',
].join(';');

const FONT =
  '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';

/* ── 入口按钮的外观与图标（6 个按钮共用一套） ─────────────────────
 *
 * ★★ 图标为什么是**内联 SVG**而不是字符/图标字体：
 *   WE 的 CEF 里字体供给不可控，`⚙` 之类的码位会渲染成**豆腐块**；
 *   内联 SVG 只依赖几何路径，且能跟着 `uiPx()` 一起缩放。
 * ★ 图标取自最常见的通行画法（齿轮 / 喇叭 / 虫子 / 盾牌 / 书 / 箭头），
 *   统一 24×24 viewBox、`fill:none` + `stroke:currentColor`、线宽 1.9，
 *   与面板其它控件同一套视觉语言。
 */
const iconSvg = (inner: string, size = 19): string =>
  '<svg width="' +
  size +
  '" height="' +
  size +
  '" style="width:' +
  uiPx(size) +
  ';height:' +
  uiPx(size) +
  '" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
  'stroke-linejoin="round">' +
  inner +
  '</svg>';

/** 设置（齿轮） */
const ICON_GEAR =
  '<circle cx="12" cy="12" r="3.2"/>' +
  '<path d="M19.4 15a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83' +
  'l-.06-.06a1.6 1.6 0 0 0-1.77-.33 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 ' +
  '0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.77.33l-.06.06a2 2 0 1 ' +
  '1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 ' +
  '0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 ' +
  '0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.07A1.6 1.6 0 0 0 10 3.13V3a2 ' +
  '2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 ' +
  '0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.07a1.6 1.6 0 0 0 1.47 ' +
  '1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.47 1z"/>';

/** 调试（虫子 = 诊断，通行画法） */
const ICON_BUG =
  // 虫身 + 头
  '<rect x="6.5" y="7.5" width="11" height="12" rx="5.5"/>' +
  '<path d="M9.5 7.5 8 5.2M14.5 7.5 16 5.2"/>' +
  // 六条腿
  '<path d="M4 11h2.5M17.5 11H20M4 16h2.5M17.5 16H20M6.5 19.5 5 21.5M17.5 19.5 19 21.5"/>';

/** 未静音（喇叭 + 两道声波） */
const ICON_VOLUME_ON =
  '<path d="M11 5.5 7.2 8.9H4v6.2h3.2L11 18.5z"/>' +
  '<path d="M14.6 9.6a3.4 3.4 0 0 1 0 4.8"/>' +
  '<path d="M17.3 7.2a7.2 7.2 0 0 1 0 9.6"/>';

/** 已静音（喇叭 + 叉） */
const ICON_VOLUME_OFF =
  '<path d="M11 5.5 7.2 8.9H4v6.2h3.2L11 18.5z"/>' +
  '<path d="M15.2 9.9 20 14.1M20 9.9 15.2 14.1"/>';

/** 免责声明 / 许可证（盾牌 + 勾） */
const ICON_SHIELD =
  '<path d="M12 3.2 19 6v5.6c0 4.2-2.9 7.7-7 8.7-4.1-1-7-4.5-7-8.7V6z"/>' +
  '<path d="m9 11.9 2.1 2.1 3.9-4"/>';

/** 档案（翻开的书） */
const ICON_BOOK =
  '<path d="M4 19.3A2.6 2.6 0 0 1 6.6 16.7H20"/>' +
  '<path d="M6.6 3H20v18H6.6A2.6 2.6 0 0 1 4 18.4V5.6A2.6 2.6 0 0 1 6.6 3z"/>';

/** 收起（向上箭头）/ 展开（向下箭头）—— 箭头指向"点下去会发生什么" */
const ICON_CHEVRON_UP = '<path d="m6 14.5 6-6 6 6"/>';
const ICON_CHEVRON_DOWN = '<path d="m6 9.5 6 6 6-6"/>';

/** 入口按钮的常态 / 激活态配色（实色，不用毛玻璃 —— 见文件头） */
const ENTRY_BG_IDLE = 'rgba(20,22,30,0.82)';
const ENTRY_BG_ACTIVE = 'rgba(74,144,226,0.92)';
const ENTRY_BD_IDLE = 'rgba(255,255,255,0.28)';
const ENTRY_BD_ACTIVE = 'rgba(176,210,255,0.95)';

/**
 * 给入口按钮写「标题 + `aria-label`」。
 *
 * ★ 两处**必须同写**：`title` 是鼠标悬停提示，`aria-label` 是无障碍名字；
 *   只写一个就会出现"看得见提示、读屏软件读不到（或反之）"的偏差。
 *   `title` 还会在状态变化时被重写（如静音 ⇄ 取消静音），所以统一从这一个函数走。
 */
const setEntryLabel = (btn: HTMLElement, label: string): void => {
  btn.title = label;
  btn.setAttribute('aria-label', label);
};

/* ── 自绘控件的样式（★ 一律 `appearance:none` + 纯 DOM，不用原生 widget） ── */
const TOGGLE_BASE = [
  'flex:0 0 auto',
  'width:' + uiPx(16),
  'height:' + uiPx(16),
  'box-sizing:border-box',
  'border:' + uiPx(1) + ' solid rgba(255,255,255,0.28)',
  'border-radius:' + uiPx(4),
  'cursor:pointer',
  'color:#fff',
  'font-size:' + fpx(11),
  // line-height 跟着 font-size 一起缩放，勾号才稳稳居中
  'line-height:' + fpx(14),
  'text-align:center',
  'user-select:none',
].join(';');

const SLIDER_WRAP = [
  'position:relative',
  'width:100%',
  'height:' + uiPx(22),
  'margin-top:' + uiPx(6),
  'cursor:pointer',
  'touch-action:none',
].join(';');
const SLIDER_TRACK = [
  'position:absolute',
  'left:0',
  'right:0',
  'top:' + uiPx(9),
  'height:' + uiPx(4),
  'border-radius:' + uiPx(2),
  'background:rgba(255,255,255,0.18)',
].join(';');
const SLIDER_FILL = [
  'position:absolute',
  'left:0',
  'top:' + uiPx(9),
  'height:' + uiPx(4),
  'border-radius:' + uiPx(2),
  'background:#4a90e2',
].join(';');
const SLIDER_THUMB = [
  'position:absolute',
  'top:' + uiPx(4),
  'width:' + uiPx(14),
  'height:' + uiPx(14),
  'border-radius:50%',
  'background:#ffffff',
  'box-shadow:0 ' + uiPx(1) + ' ' + uiPx(3) + ' rgba(0,0,0,0.5)',
  'transform:translateX(-50%)',
].join(';');

const SEG_WRAP = [
  'flex:0 0 auto',
  'display:flex',
  'gap:' + uiPx(4),
  'flex-wrap:wrap',
  'justify-content:flex-end',
].join(';');
const SEG_BTN = [
  'flex:0 0 auto',
  'padding:' + uiPx(4) + ' ' + uiPx(8),
  'border:' + uiPx(1) + ' solid rgba(255,255,255,0.22)',
  'border-radius:' + uiPx(6),
  'font-size:' + fpx(11.5),
  'font-family:inherit',
  'cursor:pointer',
].join(';');

/** tab 条上的按钮（选中态的配色由 `setTab` 运行时刷） */
const TAB_BTN = [
  'flex:0 0 auto',
  'padding:' + uiPx(6) + ' ' + uiPx(14),
  'border:' + uiPx(1) + ' solid rgba(255,255,255,0.22)',
  'border-radius:' + uiPx(8),
  'background:rgba(255,255,255,0.06)',
  'color:rgba(238,241,246,0.72)',
  'font-size:' + fpx(12.5),
  'font-family:inherit',
  'cursor:pointer',
].join(';');

/** 所有可能被庄在面板上的指针/鼠标/触摸事件。漏一个就会被顺带给角色一次触摸 */
const SWALLOW_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'wheel',
  'contextmenu',
];

const createEl = (
  tag: string,
  css: string,
  parent?: HTMLElement
): HTMLElement => {
  const el = document.createElement(tag);
  el.style.cssText = css;
  if (parent) {
    parent.appendChild(el);
  }
  return el;
};

/** 拖动过程回调。坐标是**绝对** client 坐标 ⇒ 同一帧收到 mouse + pointer 两份也幂等 */
export type DragObserver = {
  /** 按下瞬间（记录基准值用） */
  down?: (x: number, y: number) => void;
  /** 拖动中（含按下那一刻） */
  move: (x: number, y: number) => void;
  /** 松开 / 取消 */
  up?: () => void;
};

/**
 * 「按下—拖动—松开」通用绑定（滑块与自绘滚动条共用）。
 *
 * ## ★ 为什么 mouse 与 pointer **两套都挂**（而不是只挂 pointer）
 *
 * WE 桌面窗口把鼠标喂进 CEF 的路径**只保证 mouse 事件**（本工程 HUD 的
 * `mousedown count` / `mousemove count` 在 WE 里确实在涨，是实测判据）；
 * `pointer*` 是否由 CEF 合成**没有保证**。拖动是"必须能用"的操作
 * （滑块、以及内容超高时的滚动条），所以两套都挂、用 `dragging` 去重。
 *
 * ## ★ 为什么监听挂在 **document 捕获阶段**
 *
 * 面板根节点对所有鼠标/指针事件 `stopPropagation()`（防止顺带触发整屏热区，
 * 见文件头），所以冒泡到 `document` 的监听永远收不到；捕获阶段不受影响，
 * 而且指针移出面板/移出窗口边缘时依然能跟踪。
 */
const bindDrag = (el: HTMLElement, obs: DragObserver): void => {
  let dragging = false;
  const onMove = (x: number, y: number) => {
    if (dragging) {
      obs.move(x, y);
    }
  };
  const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
  const onPointerMove = (e: PointerEvent) => onMove(e.clientX, e.clientY);
  const stop = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('mouseup', stop, true);
    document.removeEventListener('pointerup', stop, true);
    document.removeEventListener('pointercancel', stop, true);
    if (obs.up) {
      obs.up();
    }
  };
  const start = (e: Event) => {
    if (dragging) {
      return;
    }
    dragging = true;
    const x = (e as MouseEvent).clientX;
    const y = (e as MouseEvent).clientY;
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('mouseup', stop, true);
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('pointercancel', stop, true);
    if (obs.down) {
      obs.down(x, y);
    }
    obs.move(x, y);
    e.preventDefault();
  };
  el.addEventListener('mousedown', start);
  el.addEventListener('pointerdown', start);
};

export const createSettingsPanel = (
  options: SettingsPanelOptions
): SettingsPanel => {
  const view: SettingsView = { ...options.view };
  /** 面板内的草稿状态（点了"保存"才落盘） */
  let draft: SettingsView = { ...options.view };
  let open = options.open === true;
  /**
   * 调试面板是否展开。
   *
   * ★ 与设置面板**互斥**：存档里两个都存了 `true`（分别开过）时**只开设置面板**，
   *   否则一进壁纸就两个面板叠在一起。
   */
  let debugOpen = options.debugOpen === true && !open;
  /**
   * 入口列显不显示 —— WE 属性 `showCornerButtons`（属性面板**第一项**「显示右上角按钮」）。
   *
   * ★★ 2026-10-17 晚口径变更：**不再有"单独控制齿轮显隐"的开关**。
   *   原 WE 属性 `showSettings`（设置按钮显示）已删除 —— 用户拍板撤回"面板里只露一个
   *   开关"的分治方案，改回"**一个开关管整列**"。齿轮的显隐现与其余 4 个入口完全一样
   *   （= 整列可见 && 未收起）。
   */
  let cornerVisible = options.cornerVisible !== false;
  /** 入口列是否收起（只留折叠按钮）—— 覆盖层 `cornerCollapsed` */
  let collapsed = options.cornerCollapsed === true;
  /** 运行时静音（显示用；真值由调用方持有，见 `muted` 的注释） */
  let muted = options.muted === true;
  /** 「免责声明」弹窗当前是否显示（只为高亮；真值在 `disclaimer.ts`） */
  let disclaimerVisible = options.disclaimerVisible === true;
  /** 「档案」面板当前是否显示（只为高亮；真值在 `archive.ts`） */
  let archiveVisible = options.archiveVisible === true;

  // ★ 先初始化 UI 缩放变量（幂等）：下面所有 px 都依赖它
  initUiScale();

  const root = createEl(
    'div',
    [
      'position:fixed',
      'top:0',
      'right:0',
      'z-index:2147483647',
      // 根节点不吃事件，只有入口按钮与面板本体吃
      'pointer-events:none',
      'font-family:' + FONT,
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';')
  );
  // ★ 根也要拦：它是 body 的子节点，事件从这里往上冒泡到 document
  SWALLOW_EVENTS.forEach((evt) => {
    root.addEventListener(
      evt,
      (e: Event) => {
        e.stopPropagation();
      },
      false
    );
  });

  /* ── 右上角入口列 ─────────────────────────────
   *
   * ★ 几何：直接挂在 `root`（`position:fixed;top:0;right:0` 的零尺寸盒）下、
   *   绝对定位到 `top/right = CORNER_TOP` ⇒ 这组 `top/right` 就是"距视口上/右缘"，
   *   与原来的齿轮/调试按钮同一套坐标口径（`syncScrollbar` 也是这么算的）。
   * ★ 为什么单独一层容器而不是 6 个按钮各自绝对定位：纵向排列 + 统一间距交给
   *   `flex-direction:column` 管，加/减按钮不用重算每一颗的 `top`
   *   （这正是原来自绘 `CORNER_TOP + (CORNER_BTN + CORNER_GAP) * n` 的毛病）。
   * ★ 容器自己 `pointer-events:none`（不吃事件、不挡画面），只有按钮吃。
   */
  const CORNER_BTN = 38;
  const CORNER_TOP = 14;
  const CORNER_GAP = 10;

  const corner = createEl(
    'div',
    [
      'position:absolute',
      'top:' + uiPx(CORNER_TOP),
      'right:' + uiPx(CORNER_TOP),
      'display:flex',
      'flex-direction:column',
      'gap:' + uiPx(CORNER_GAP),
      // 靠右对齐：按钮的右缘一致 ⇒ 与原来的齿轮保持同一个贴边位置
      'align-items:flex-end',
      'pointer-events:none',
      'font-family:' + FONT,
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';'),
    root
  );
  corner.id = 'wb-corner';
  // ★ 事件不用在这里再拦一遍：监听挂在 target 上的按钮处理器先跑，
  //   随后冒泡到 `root`，root 的 SWALLOW_EVENTS 会统一 stopPropagation。

  /**
   * 造一个入口按钮（**统一的圆钮外观**，6 个按钮共用）。
   *
   * ★ 抽成工厂函数：图标/标题/状态各不相同，但外观必须一模一样 ——
   *   各写一份样式串就是"改了 5 处漏了 1 处"的经典来源。
   * ★ `flex:0 0 auto`：列是 flex column，不写的话按钮在窄容器里会被压扁。
   */
  const makeEntryBtn = (
    id: string,
    label: string,
    svg: string
  ): HTMLButtonElement => {
    const btn = createEl(
      'button',
      [
        'pointer-events:auto',
        'flex:0 0 auto',
        'width:' + uiPx(CORNER_BTN),
        'height:' + uiPx(CORNER_BTN),
        'padding:0',
        'border:' + uiPx(1) + ' solid ' + ENTRY_BD_IDLE,
        'border-radius:50%',
        'background:' + ENTRY_BG_IDLE,
        'color:#fff',
        'cursor:pointer',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        // ★ 不用 backdrop-filter —— WE CEF 上会崩渲染进程，见文件头注释
        'transition:background .18s ease,transform .18s ease',
      ].join(';'),
      corner
    ) as HTMLButtonElement;
    btn.id = id;
    setEntryLabel(btn, label);
    btn.innerHTML = svg;
    return btn;
  };

  /** 按钮的激活态（=它对应的面板/弹窗正在显示）高亮：改背景与描边，不动图标 */
  const setEntryActive = (btn: HTMLElement, active: boolean): void => {
    btn.style.background = active ? ENTRY_BG_ACTIVE : ENTRY_BG_IDLE;
    btn.style.borderColor = active ? ENTRY_BD_ACTIVE : ENTRY_BD_IDLE;
  };

  const toggleBtn = makeEntryBtn(
    'wb-corner-toggle',
    '',
    iconSvg(ICON_CHEVRON_UP)
  );
  const gear = makeEntryBtn('wb-settings-gear', '壁纸设置', iconSvg(ICON_GEAR));
  const muteBtn = makeEntryBtn('wb-mute-btn', '静音', iconSvg(ICON_VOLUME_ON));
  const debugBtn = makeEntryBtn('wb-debug-btn', '调试', iconSvg(ICON_BUG));
  const disclaimerBtn = makeEntryBtn(
    'wb-disclaimer-btn',
    '免责声明与许可证',
    iconSvg(ICON_SHIELD)
  );
  const archiveBtn = makeEntryBtn('wb-archive-btn', '档案', iconSvg(ICON_BOOK));

  /**
   * 刷「折叠/展开」按钮的图标与提示语。
   *
   * ★ 展开时显示**向上**的箭头（点了就收起）、收起时显示**向下**的箭头（点了就下拉）——
   *   箭头指向"点下去会发生什么"，这是折叠控件最通行的读法。
   */
  const renderToggleBtn = () => {
    toggleBtn.innerHTML = iconSvg(
      collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP
    );
    setEntryLabel(toggleBtn, collapsed ? '展开入口' : '收起入口');
  };

  /** 刷「静音」按钮：图标在**喇叭**与**喇叭打叉**之间切换，并同步高亮 */
  const renderMuteBtn = () => {
    muteBtn.innerHTML = iconSvg(muted ? ICON_VOLUME_OFF : ICON_VOLUME_ON);
    setEntryLabel(muteBtn, muted ? '取消静音' : '静音');
    setEntryActive(muteBtn, muted);
  };
  renderToggleBtn();
  renderMuteBtn();

  /* ── 面板本体（居中 + 屏幕 80% + 分 tab） ─────────
   *
   * 结构：`panel`(flex column) = header → tabBar → **tabBody(唯一滚动容器)** → foot
   *
   * ★ 为什么改成居中大面板 + 分 tab（2026-09-25 用户拍板）
   *   WE 不转发鼠标滚轮（见下"自适应"段），靠滚动够到控件这条路在 WE 里走不通；
   *   小面板又必然把内容挤成一长条。⇒ 用"更宽的面积 ÷ 分页"从**结构上**消灭折叠线：
   *   面板宽 = `80vw`（视口宽 = 整屏像素）、每个 tab 只放一组相关设置，
   *   底部按钮放 tabBody **之外** ⇒ 任何 tab 下「保存并应用」都常驻可见可点。
   *
   * ★ 底部按钮必须在 tabBody 之外：否则它又会变成"折叠线以下的控件"。
   */
  const panel = createEl(
    'div',
    [
      'pointer-events:auto',
      'position:fixed',
      // 居中：translate(-50%,-50%) 配 left/top:50%（视口单位，不随局部缩放漂）
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:80vw',
      'height:80vh',
      'display:' + (cornerVisible && open ? 'flex' : 'none'),
      'flex-direction:column',
      'box-sizing:border-box',
      'padding:' + uiPx(16) + ' ' + uiPx(20) + ' ' + uiPx(14),
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.16)',
      'border-radius:' + uiPx(14),
      'background:rgba(16,18,26,0.94)',
      // ★ 不用 backdrop-filter —— WE CEF 上大面积会崩渲染进程，见文件头注释
      'box-shadow:0 ' + uiPx(10) + ' ' + uiPx(34) + ' rgba(0,0,0,0.45)',
      'color:#eef1f6',
      'font-size:' + fpx(13),
      'line-height:1.5',
    ].join(';'),
    root
  );
  panel.id = 'wb-settings-panel';

  /* ── 头部 ─────────────────────────────────── */
  const header = createEl('div', 'flex:0 0 auto', panel);
  const title = createEl(
    'div',
    'font-size:' + fpx(15) + ';font-weight:600;letter-spacing:' + uiPx(0.5),
    header
  );
  title.textContent = '壁纸设置';
  const hint = createEl(
    'div',
    'font-size:' + fpx(11) + ';opacity:.55;line-height:1.45',
    header
  );
  hint.textContent = '修改后点「保存并应用」，壁纸会重新加载以生效。';

  /* ── tab 条 ───────────────────────────────── */
  const tabBar = createEl(
    'div',
    [
      'flex:0 0 auto',
      'display:flex',
      'gap:' + uiPx(6),
      'flex-wrap:wrap',
      'margin:' + uiPx(10) + ' 0 ' + uiPx(8),
      'border-bottom:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      'padding-bottom:' + uiPx(8),
    ].join(';'),
    panel
  );

  /* ── tab 内容区（**唯一滚动容器**） ───────────── */
  const tabBody = createEl(
    'div',
    [
      'flex:1 1 auto',
      // ★ flex 子项默认 min-height:auto ⇒ 内容会把容器撑破，必须显式 0
      'min-height:0',
      'overflow-y:auto',
      // 隐藏原生滚动条（WE 里拖不动，见文件头）；正常情况下也用不到
      'scrollbar-width:none',
      '-ms-overflow-style:none',
    ].join(';'),
    panel
  );
  tabBody.id = 'wb-tab-body';

  /**
   * ★★ 「壁纸独立设置」页的输入（`config.wallpaperSettings` 解析而来）。
   *
   * `null` = 本壁纸没声明任何独立设置 ⇒ 下面 `TABS` 的过滤会把这一页
   * （标签按钮 + 页容器）整个去掉 —— 引擎是通用的，不能因为面板多了个 tab
   * 就让每一张壁纸都多出一个永远空着的页。
   */
  const wallpaperSpec = resolveWallpaperPanelSpec(options.wallpaperSettings);

  const TABS: ReadonlyArray<{ id: string; label: string }> = [
    // ★ 标签 2026-09-30 由「背景音乐」改为「音乐」—— 本页现在同时管 BGM 与角色语音两条音量
    //   （`id` 仍是 `bgm`：改 id 会让验证脚本/存档里的锚点全部失效，没有收益）
    { id: 'bgm', label: '音乐' },
    { id: 'subtitle', label: '字幕气泡' },
    // ★ 2026-10-10 用户口径重组：原「动作」→ **事件触发**（管"什么时候/在哪里触发"）、
    //   原「触摸」→ **事件池**（管"能抽到哪些内容"）。位置不变、`id` 不变。
    { id: 'sequence', label: '事件触发' },
    { id: 'touch', label: '事件池' },
    // ★ 2026-10-19：**「事件开关」** —— 事件内容在 `assets/events.jsonc`，
    //   这一页只负责每一条的开 / 关（面板内不再新建 / 删除 / 改字段）。
    { id: 'events', label: '事件开关' },
    { id: 'view', label: '画面调整' },
    // ★ 这里**没有**「调试」页了：2026-10-15 起调试独立成入口列里的一个按钮
    //   （见文件头与「调试面板」段）；字段仍是 `probeEnabled` 那四个，没改名。
    // ★ 2026-10-11 新增：**只对本壁纸生效**的设置（用户拍板放在**标签条最末**）。
    //   本页里的项由 `config.wallpaperSettings` 声明，没声明就连这个 tab 都没有（见上）。
    { id: 'wallpaper', label: '壁纸独立设置' },
  ].filter(
    /**
     * ★★ 唯一的"条件页"过滤：没声明独立设置的壁纸（如星语心恋）**看不到**这一页。
     *
     * 为什么不是"建一个空页、里面写一句'本壁纸没有独立设置'"：
     * 那种页对绝大多数壁纸都是纯噪声，而这一页本身对用户没有通用价值
     * （它的内容天然是壁纸专属的）。要出现，就得有内容。
     */
    (t) => t.id !== 'wallpaper' || wallpaperSpec !== null
  );
  const pages: { [id: string]: HTMLElement } = {};
  const tabButtons: { id: string; el: HTMLElement }[] = [];
  let activeTab = TABS[0].id;
  TABS.forEach((t) => {
    const page = createEl('div', 'display:none', tabBody);
    page.id = 'wb-tab-' + t.id;
    pages[t.id] = page;
    const btn = createEl('button', TAB_BTN, tabBar);
    btn.id = 'wb-tab-btn-' + t.id;
    btn.setAttribute('data-wb-tab', t.id);
    btn.textContent = t.label;
    btn.addEventListener('click', () => setTab(t.id));
    tabButtons.push({ id: t.id, el: btn });
  });

  /** 切换 tab（**每个 tab 内容高度不同 ⇒ 必须重算自适应缩放**） */
  const setTab = (id: string) => {
    activeTab = id;
    TABS.forEach((t) => {
      pages[t.id].style.display = t.id === id ? 'block' : 'none';
    });
    tabButtons.forEach((b) => {
      const on = b.id === id;
      b.el.style.background = on ? '#4a90e2' : 'rgba(255,255,255,0.06)';
      b.el.style.color = on ? '#ffffff' : 'rgba(238,241,246,0.72)';
      b.el.style.borderColor = on ? '#4a90e2' : 'rgba(255,255,255,0.22)';
    });
    relayoutPanel();
  };

  /**
   * 行构造器的**默认父级** = 当前 tab 页。
   *
   * 这样各控件创建处不必逐个手传 `parent`，只要在分组前 `rowTarget = pages.xxx`
   * 即可（改动最小、也不容易漏）。显式传了 `parent` 的照旧优先。
   */
  let rowTarget: HTMLElement = panel;

  /* ── 面板自适应高度：**保证永不出现折叠线** ─────────────
   *
   * ## ★★ 为什么"滚动"这条路线在 WE 里根本走不通
   *
   * WE 桌面窗口把鼠标喂进 CEF 的路径**只发 mouse move / click**：
   *   - 开源 CEF 实现 `linux-wallpaperengine` 的 `CWeb.cpp` 只调
   *     `SendMouseMoveEvent` + `SendMouseClickEvent`，**没有** `SendMouseWheelEvent`；
   *   - 另一款 CEF 壁纸程序 Sucrose 要实现滚轮，必须**自己显式**调
   *     `CefHost.SendMouseWheelEvent(...)`（issue #125）⇒ 滚轮转发是"要单独写"的；
   *   - WE 官方 wiki / 帮助只列了自定义属性、音频可视化、属性读取，从未承诺鼠标滚轮；
   *     有开发者博客直接写"壁纸形态**不支持页面点击等交互方式**"。
   *
   * ⇒ WE 里 `wheel` 事件**永远不触发**（本工程 HUD 有 `mousedown/mousemove` 计数
   *   可实测，就是没有 wheel），"滚轮滚动"无解；原生滚动条同样不可控。
   *   **唯一稳的做法：让面板根本不需要滚动。**
   *
   * ## 做法：内容超高时**只缩面板内层**
   *
   * 面板内层尺寸全走 `uiPx()` = `calc(Npx * var(--wb-ui-s))`，所以在**面板元素上**
   * 覆盖 `--wb-ui-s` 即可整块等比缩放；外框几何走 `uiPxGlobal()`（`--wb-ui-g`）
   * ⇒ 面板的 top/right/width 不跟着漂。
   *
   * 实测（2560×1600）：默认「游戏位置」内容 667 设计px（可用 668，刚好装下）；
   * 开「自由定位」= +133（锚点块）⇒ 800 设计px ⇒ 需要 k≈0.83。
   *
   * ## 兜底
   *
   * 缩放有 `K_MIN` 下限，万一还装不下（以后内容再长）就交给**自绘滚动条**：
   * 可拖、可点轨道，拖动走 mouse+pointer 双绑定（见 `bindDrag`）。
   * 这样无论如何「保存并应用」都够得着。
   *
   * ⚠ 千万不要用 `backdrop-filter` 等合成层特性（WE CEF SIGILL，见文件头）。
   */
  /** 面板局部缩放下限（再小就看不清；触底后由自绘滚动条兜底） */
  const K_MIN = 0.7;
  const SB_W = 8;
  const SB_INSET = 6;
  const SB_MIN_H = 24;
  /** 面板当前局部缩放（1 = 不缩） */
  let panelK = 1;
  const sbTrack = createEl(
    'div',
    [
      'position:absolute',
      'display:none',
      'pointer-events:auto',
      'border-radius:999px',
      'background:rgba(255,255,255,0.08)',
    ].join(';'),
    root
  );
  sbTrack.id = 'wb-settings-scrollbar';
  const sbThumb = createEl(
    'div',
    [
      'position:absolute',
      'left:0',
      'width:100%',
      'pointer-events:auto',
      'border-radius:999px',
      'background:rgba(255,255,255,0.34)',
      'cursor:grab',
      'touch-action:none',
    ].join(';'),
    sbTrack
  );
  sbThumb.id = 'wb-settings-thumb';

  /**
   * 把自绘条对齐到 **tab 内容区**当前的位置与滚动状态。
   *
   * 滚动容器从"面板"改成了 `tabBody`（面板高度固定 80vh，只有一个 tab 页可滚）——
   * 底部按钮在 tabBody 之外，永远不参与滚动。
   */
  const syncScrollbar = () => {
    const over = tabBody.scrollHeight - tabBody.clientHeight;
    const show = cornerVisible && open && over > 1;
    sbTrack.style.display = show ? 'block' : 'none';
    if (!show) {
      return;
    }
    const s = getUiScale();
    const r = tabBody.getBoundingClientRect();
    const inset = SB_INSET * s;
    // ★ 横向间距取 max(inset, 条宽)：条是"从内容区右缘往右摆"的，
    //   若间距小于条宽，条的左半截会压回内容区、盖住行尾控件（踩过）
    const gapX = Math.max(SB_INSET, SB_W) * s;
    sbTrack.style.width = SB_W * s + 'px';
    // root 是 `position:fixed;top:0;right:0` 的零尺寸盒 ⇒ 绝对子元素的
    // 原点就是**视口右上角**；直接用视口坐标换算才不会随 root 尺寸漂移
    //
    // ★ 这里用 **减** gapX（不是加）：滚动容器是**面板 padding 之内的 tabBody**，
    //   条要放到"内容区右缘**外侧**"（面板的右 padding 里），否则会压住行尾控件
    sbTrack.style.top = r.top + inset + 'px';
    sbTrack.style.right = window.innerWidth - r.right - gapX + 'px';
    const trackH = Math.max(1, r.height - inset * 2);
    sbTrack.style.height = trackH + 'px';
    const thumbH = Math.max(
      SB_MIN_H * s,
      trackH * (tabBody.clientHeight / Math.max(1, tabBody.scrollHeight))
    );
    sbThumb.style.height = thumbH + 'px';
    sbThumb.style.top =
      Math.round(Math.max(0, trackH - thumbH) * (tabBody.scrollTop / over)) +
      'px';
  };

  /**
   * 让**当前 tab** 的内容在 `tabBody` 内全部装下（必要时等比缩小面板内层）。
   *
   * ★ 面板高度固定 `80vh`、`tabBody` 是 `flex:1` ⇒ `tabBody.clientHeight`
   *   **永远**就是"可用高度"（内容多寡不影响它）⇒ 不用再反推几何上限。
   *
   * 幂等：`panelK` 不变时**不写样式** ⇒ 不会和 `ResizeObserver` 互相触发形成抖动。
   */
  const fitPanelScale = () => {
    if (!cornerVisible || !open) {
      return;
    }
    const s = getUiScale();
    for (let i = 0; i < 3; i++) {
      const avail = tabBody.clientHeight;
      const content = tabBody.scrollHeight;
      if (!(content > 0) || !(avail > 0)) {
        break;
      }
      let next = panelK;
      if (content > avail) {
        // 留 0.5% 余量，避免刚好贴边导致下一个循环又判定"超高"
        next = Math.max(K_MIN, (panelK * avail * 0.995) / content);
      } else if (panelK < 1 && content < avail - 8) {
        // 内容变矮了（比如切到行数更少的 tab）⇒ 把缩放还原回去
        next = Math.min(1, (panelK * (avail - 4)) / content);
      }
      if (Math.abs(next - panelK) < 0.002) {
        break;
      }
      panelK = next;
      panel.style.setProperty(UI_SCALE_VAR, String(s * panelK));
    }
  };

  /** 面板内容/可见性/视口变化后统一入口：先自适应，再对齐兜底滚动条 */
  const relayoutPanel = () => {
    fitPanelScale();
    syncScrollbar();
  };

  /** 可滚动的总距离（滚动条比例全部按它换算） */
  const maxScrollNow = (): number =>
    Math.max(0, tabBody.scrollHeight - tabBody.clientHeight);
  /** thumb 在轨道里能走的距离 */
  const thumbRange = (): number => {
    const trackH = sbTrack.getBoundingClientRect().height;
    const thumbH = sbThumb.getBoundingClientRect().height;
    return Math.max(1, trackH - thumbH);
  };

  /** ★ 按下瞬间的 scrollTop：拖动全程以它为基准，跟着变会累积漂移 */
  let dragStartScroll = 0;
  let dragStartY = 0;
  // ★ 拖动一律走 bindDrag（mouse + pointer 双绑定）：WE 只保证 mouse 事件可达
  bindDrag(sbThumb, {
    down: (_x, y) => {
      dragStartY = y;
      dragStartScroll = tabBody.scrollTop;
      sbThumb.style.cursor = 'grabbing';
    },
    move: (_x, y) => {
      tabBody.scrollTop =
        dragStartScroll + (y - dragStartY) * (maxScrollNow() / thumbRange());
      syncScrollbar();
    },
    up: () => {
      sbThumb.style.cursor = 'grab';
    },
  });
  /** 点轨道空白 = 跳到该处（thumb 中心对齐点击位置） */
  const jumpByTrack = (clientY: number) => {
    const r = sbTrack.getBoundingClientRect();
    const thumbH = sbThumb.getBoundingClientRect().height;
    const p = Math.min(
      1,
      Math.max(0, (clientY - r.top - thumbH / 2) / thumbRange())
    );
    tabBody.scrollTop = p * maxScrollNow();
    syncScrollbar();
  };
  // mouse 与 pointer 都挂（同一物理点击会触发两次，但"跳到绝对位置"是幂等的）
  ['mousedown', 'pointerdown'].forEach((evt) => {
    sbTrack.addEventListener(evt, (e: Event) => {
      if (e.target !== sbThumb) {
        jumpByTrack((e as MouseEvent).clientY);
      }
    });
  });

  /* ★ 手动滚轮：**只有普通浏览器里有用** —— WE 不转发 wheel（见上文）。
     保留是为了浏览器预览时手感一致；WE 里则由 fitPanelScale 保证不需要滚。 */
  tabBody.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      // deltaMode: 0=像素 1=行 2=页（Chromium 一般是 0）
      const unit =
        e.deltaMode === 1
          ? 16 * getUiScale()
          : e.deltaMode === 2
          ? tabBody.clientHeight
          : 1;
      tabBody.scrollTop += e.deltaY * unit;
      syncScrollbar();
      e.preventDefault();
    },
    { passive: false }
  );
  tabBody.addEventListener('scroll', () => syncScrollbar());
  // 内容区尺寸变化（视口缩放）也要重算。★ 不必依赖它来抓"内容变化"：
  // 内容被撑满时换内容**不改变盒子尺寸** ⇒ RO 不会触发，
  // 所以内容变化处必须显式调 relayoutPanel()（见 syncFromDraft / selPos / setTab）。
  const sbObserver = new ResizeObserver(() => relayoutPanel());
  sbObserver.observe(tabBody);
  const onWindowResize = () => {
    // 推迟到 rAF：uiScale 的 resize 监听会先写好 --wb-ui-s，样式重算后再量
    window.requestAnimationFrame(() => relayoutPanel());
  };
  window.addEventListener('resize', onWindowResize, false);

  /* ── 行构造器 ─────────────────────────────── */
  /**
   * 一行"标签 + 控件"。
   *
   * `stack=true` ⇒ **标签在上、控件独占下一行**（`display:block`）。
   * ★ 为什么需要：`segmented` 那种一排按钮（"游戏位置 / 底部字幕条 / 自由定位"）
   *   横排时会被 `justify-content:space-between` 把标签列压到只剩一个字宽，
   *   中文被迫**竖排**（2026-09-25 截图实锤）。
   *
   * `parent` 缺省 = `rowTarget`（= 当前 tab 页），见那边的说明。
   */
  const addRow = (
    labelText: string,
    control: HTMLElement,
    sub?: string,
    parent: HTMLElement = rowTarget,
    stack = false
  ): HTMLElement => {
    const row = createEl(
      'div',
      [
        stack
          ? 'display:block'
          : 'display:flex;align-items:center;justify-content:space-between' +
            ';gap:' +
            uiPx(10),
        'padding:' + uiPx(6) + ' 0',
        'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.08)',
      ].join(';'),
      parent
    );
    const labelWrap = createEl('div', stack ? '' : 'min-width:0', row);
    const label = createEl('label', 'display:block;cursor:pointer', labelWrap);
    label.textContent = labelText;
    if (sub) {
      createEl(
        'div',
        'font-size:' + fpx(11) + ';opacity:.5;margin-top:' + uiPx(1),
        labelWrap
      ).textContent = sub;
    }
    row.appendChild(control);
    if (stack) {
      // 控件独占一行并占满宽度（block 父级下 `width:100%` 才有效）
      control.style.width = '100%';
      control.style.marginTop = uiPx(5);
    }
    return row;
  };

  /**
   * 自绘开关（**不用 `<input type=checkbox>`**）。
   *
   * 对外接口保持与原生 input 一致（`checked` 读写 + `change` 事件），
   * 所以下游 `syncFromDraft` / 事件绑定不用改。
   */
  const createToggle = (id: string, labelText: string, sub?: string) => {
    const el = createEl('div', TOGGLE_BASE);
    el.id = id;
    el.setAttribute('data-wb-set', id);
    el.setAttribute('role', 'checkbox');
    el.setAttribute('aria-checked', 'false');
    let on = false;
    const paint = () => {
      el.style.background = on ? '#4a90e2' : 'rgba(255,255,255,0.10)';
      el.style.borderColor = on ? '#4a90e2' : 'rgba(255,255,255,0.28)';
      el.textContent = on ? '\u2713' : '';
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    };
    paint();
    /**
     * ★ 让 DOM 元素**自己**也支持 `checked` 读写（代理到内部值），与 `createSlider`
     * 的 `.value` 同一口径：自绘控件对"原生 input 用法"完全兼容，
     * 外部/验证脚本写 `el.checked = true` 不会静默失效（只挂了个普通属性）。
     */
    Object.defineProperty(el, 'checked', {
      configurable: true,
      get: () => on,
      set: (v: boolean) => {
        on = !!v;
        paint();
      },
    });
    el.addEventListener('click', () => {
      on = !on;
      paint();
      el.dispatchEvent(new Event('change'));
    });
    const row = addRow(labelText, el, sub);
    // 自绘开关没有原生 `<label for>` 关联 ⇒ 手动把标签文字的点击转发到开关上
    const lab = row.querySelector('label');
    if (lab) {
      lab.style.cursor = 'pointer';
      lab.addEventListener('click', () => {
        el.click();
      });
    }
    return {
      el,
      get checked() {
        return on;
      },
      set checked(v: boolean) {
        on = !!v;
        paint();
      },
      addEventListener(type: string, fn: () => void) {
        el.addEventListener(type, fn);
      },
    };
  };

  /**
   * 自绘滑块（**不用 `<input type=range>`**）。
   *
   * `value` 语义与原生 range 保持一致：字符串形式的 0~100。
   */
  const createSlider = (id: string) => {
    const wrap = createEl('div', SLIDER_WRAP);
    wrap.id = id;
    wrap.setAttribute('data-wb-set', id);
    const track = createEl('div', SLIDER_TRACK, wrap);
    const fill = createEl('div', SLIDER_FILL, wrap);
    const thumb = createEl('div', SLIDER_THUMB, wrap);
    let val = 0;
    const paint = () => {
      const p = val / 100;
      fill.style.width = (p * 100).toFixed(2) + '%';
      thumb.style.left = (p * 100).toFixed(2) + '%';
    };
    const setFromX = (clientX: number) => {
      const r = wrap.getBoundingClientRect();
      if (r.width <= 0) {
        return;
      }
      val = Math.min(
        100,
        Math.max(0, Math.round(((clientX - r.left) / r.width) * 100))
      );
      paint();
      wrap.dispatchEvent(new Event('input'));
    };
    // ★ 用 bindDrag（mouse + pointer 双绑定）：WE 只保证 mouse 事件可达，
    //   只挂 pointer 的滑块在 WE 里可能"按下去拖不动"
    bindDrag(wrap, {
      move: (x) => setFromX(x),
    });
    paint();
    /**
     * ★ 让 DOM 元素**自己**也支持 `.value` 读写（代理到内部值）。
     *
     * 自绘滑块不是 `<input>`，外部按原生习惯写 `el.value = '20'` 只会往 div 上
     * 挂个普通属性、进不到闭包里 ⇒ 静默无效（验证脚本踩过）。补上访问器后，
     * 自绘控件对"原生 input 用法"完全兼容（读写的都是同一个 `val`）。
     */
    Object.defineProperty(wrap, 'value', {
      configurable: true,
      get: () => String(val),
      set: (v: string) => {
        const n = Number(v);
        val = isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
        paint();
      },
    });
    return {
      el: wrap,
      get value() {
        return String(val);
      },
      set value(v: string) {
        const n = Number(v);
        val = isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
        paint();
      },
      addEventListener(type: string, fn: () => void) {
        wrap.addEventListener(type, fn);
      },
    };
  };

  /**
   * 自绘分段选择（**不用 `<select>`** —— 原生下拉是 CEF 上的原生 widget）。
   *
   * `value` 语义与原生 select 一致。
   *
   * `block=true` ⇒ 占满整行、左对齐（配合 `addRow(..., stack=true)` 用）。
   * 不再 `justify-content:flex-end`：单独一行时靠右看着像"飘出去"了。
   */
  const createSegmented = (
    id: string,
    opts: readonly (readonly [string, string])[],
    block = false
  ) => {
    const wrap = createEl(
      'div',
      block ? SEG_WRAP + ';width:100%;justify-content:flex-start' : SEG_WRAP
    );
    wrap.id = id;
    wrap.setAttribute('data-wb-set', id);
    let val = opts[0][0];
    const btns: HTMLElement[] = [];
    opts.forEach(([v, label]) => {
      const b = createEl('button', SEG_BTN, wrap);
      b.textContent = label;
      b.setAttribute('data-wb-opt', v);
      b.addEventListener('click', () => {
        val = v;
        paint();
        wrap.dispatchEvent(new Event('change'));
      });
      btns.push(b);
    });
    const paint = () => {
      btns.forEach((b) => {
        const on = b.getAttribute('data-wb-opt') === val;
        b.style.background = on ? '#4a90e2' : 'rgba(255,255,255,0.06)';
        b.style.color = on ? '#ffffff' : 'rgba(238,241,246,0.72)';
        b.style.borderColor = on ? '#4a90e2' : 'rgba(255,255,255,0.22)';
      });
    };
    paint();
    /**
     * ★ 与 `createSlider` / `createToggle` 同一口径：DOM 元素自己也支持 `.value`
     * 读写（代理到内部值），外部按原生 select 的习惯写 `el.value = 'bottom'`
     * 才不会静默失效。
     */
    Object.defineProperty(wrap, 'value', {
      configurable: true,
      get: () => val,
      set: (v: string) => {
        val = v;
        paint();
      },
    });
    return {
      el: wrap,
      get value() {
        return val;
      },
      set value(v: string) {
        val = v;
        paint();
      },
      addEventListener(type: string, fn: () => void) {
        wrap.addEventListener(type, fn);
      },
    };
  };

  /* ── tab 1：音乐（BGM + 角色语音） ───────────── */
  rowTarget = pages.bgm;
  /**
   * ★ 全部静音：压在 BGM / 念白之上的**总闸**。
   * WE 属性面板里也有这一项（`muteAll`），两边读写同一个覆盖层字段 ⇒ 同源。
   * 打开后下面两项会被置灰（它们的开关值**保留**，只是被总闸压住不响）。
   */
  const cbMuteAll = createToggle(
    'wb-set-muteall',
    '全部静音',
    '同时关掉背景音乐与念白语音（各自的开关值保留，解除静音后还原）'
  );
  const cbBgm = createToggle('wb-set-bgm', '背景音乐', '关闭后不播放 BGM');

  const volWrap = createEl(
    'div',
    'padding:' +
      uiPx(6) +
      ' 0;border-top:' +
      uiPx(1) +
      ' solid rgba(255,255,255,0.08)',
    pages.bgm
  );
  const volHead = createEl(
    'div',
    'display:flex;justify-content:space-between;font-size:' +
      fpx(12) +
      ';opacity:.8',
    volWrap
  );
  const volLabel = createEl('span', '', volHead);
  volLabel.textContent = '背景音乐音量';
  const volValue = createEl(
    'span',
    'font-variant-numeric:tabular-nums',
    volHead
  );
  const vol = createSlider('wb-set-volume');
  volWrap.appendChild(vol.el);
  volValue.textContent = Math.round(view.bgmVolume * 100) + '%';

  /**
   * ★ 角色语音（念白 CV）音量 —— 与上面的 BGM 音量是**两条独立链路**
   *   （BGM 走 `bgmPlayer`、语音走 `voicePlayer`，互不 ducking），只是对用户来说
   *   都属于"声音大小"，所以并排放在「音乐」页。
   *
   * ⚠️ 两者都只有 `muteAll` 总闸能一起压住；各自的滑块即使被压住也**保留数值**
   *   （与 `cbBgm` / `cbVoice` 的口径一致，见「全部静音」的说明）。
   */
  const voiceVolWrap = createEl(
    'div',
    'padding:' +
      uiPx(6) +
      ' 0;border-top:' +
      uiPx(1) +
      ' solid rgba(255,255,255,0.08)',
    pages.bgm
  );
  const voiceVolHead = createEl(
    'div',
    'display:flex;justify-content:space-between;font-size:' +
      fpx(12) +
      ';opacity:.8',
    voiceVolWrap
  );
  const voiceVolLabel = createEl('span', '', voiceVolHead);
  voiceVolLabel.textContent = '角色语音音量';
  const voiceVolValue = createEl(
    'span',
    'font-variant-numeric:tabular-nums',
    voiceVolHead
  );
  const volVoice = createSlider('wb-set-voice-volume');
  voiceVolWrap.appendChild(volVoice.el);
  voiceVolValue.textContent = Math.round(view.voiceVolume * 100) + '%';

  /* ── tab 2：字幕气泡 ──────────────────────── */
  rowTarget = pages.subtitle;
  const cbSubtitle = createToggle(
    'wb-set-subtitle',
    '字幕显示',
    '关闭后不再弹气泡'
  );
  const cbVoice = createToggle(
    'wb-set-voice',
    '念白语音',
    '关闭只留气泡、不播语音'
  );

  /* 字幕位置（三选一预设） */
  // ★ stack=true：三个按钮横排会挤爆内容宽，标签被压成竖排（见 addRow 注释）
  const selPos = createSegmented(
    'wb-set-subtitle-position',
    [
      ['game', '游戏位置'],
      ['bottom', '底部字幕条'],
      ['custom', '自由定位'],
    ] as const,
    true
  );
  addRow(
    '字幕位置',
    selPos.el,
    '游戏位置=角色旁固定点；底部字幕条=底部居中宽条；自由定位=用下方滑块调坐标',
    pages.subtitle,
    true
  );

  /* 自由定位锚点（仅自由定位时显示） */
  const anchorWrap = createEl('div', 'padding:0', pages.subtitle);
  anchorWrap.id = 'wb-anchor-wrap';
  anchorWrap.style.display = 'none';
  const slAnchorU = createSlider('wb-set-anchor-u');
  addRow('水平位置', slAnchorU.el, '0~100%（左→右）', anchorWrap);
  const slAnchorV = createSlider('wb-set-anchor-v');
  addRow('垂直位置', slAnchorV.el, '0~100%（上→下）', anchorWrap);

  /* ── tab 3：事件触发（原「动作」，2026-10-10 改名）── */
  rowTarget = pages.sequence;
  const cbSeq = createToggle(
    'wb-set-seq',
    '常驻动作序列',
    '顶替待机循环播放，按下面顺序执行'
  );

  const seqBody = createEl(
    'div',
    'padding:' +
      uiPx(8) +
      ' 0 ' +
      uiPx(2) +
      ';border-top:' +
      uiPx(1) +
      ' solid rgba(255,255,255,0.08)',
    pages.sequence
  );
  seqBody.id = 'wb-seq-body';
  const seqTip = createEl(
    'div',
    'font-size:' + fpx(11) + ';opacity:.55;margin-bottom:' + uiPx(6),
    seqBody
  );
  seqTip.textContent = '点选动画名即可按顺序加入序列（只排序列、不带台词）。';

  const chips = createEl(
    'div',
    'display:flex;flex-wrap:wrap;gap:' + uiPx(6) + ';margin-bottom:' + uiPx(8),
    seqBody
  );
  chips.id = 'wb-seq-chips';

  /**
   * ★★ 动作间隔：**必须是自绘滑块，不能是需要打字的输入框**（2026-09-27）
   *
   * 原实现是 `<input type="text">`。而**网页壁纸在 WE 里没有键盘输入** ——
   * 官方口径（Steam 社区，开发者 Tim）：键盘输入只对"从 URL 打开"的壁纸、
   * 且必须配合"隐藏桌面图标"热键才可能生效，**创意工坊 / 本地网页壁纸不支持**。
   * ⇒ 这个框在壁纸里根本打不进字，`gapMs` 恒为 0（面板上看着能改，其实改不动）。
   *
   * 面板里其它项（开关 / 分段 / 滑块）全是自绘、只用鼠标 ⇒ 只有这一项坏着，
   * 现象与"其它都能改、就间隔改不动"完全吻合。
   */
  const gapRow = createEl(
    'div',
    'display:flex;align-items:center;gap:' + uiPx(8),
    seqBody
  );
  const gapLabel = createEl(
    'span',
    'font-size:' + fpx(12) + ';opacity:.8;flex:0 0 auto',
    gapRow
  );
  gapLabel.textContent = '动作间隔';
  const gapSliderBox = createEl('div', 'flex:1 1 auto;min-width:0', gapRow);
  /** 滑块 1 格 = 100 ms ⇒ 0~100 格覆盖 0~10000 ms */
  const GAP_MS_STEP = 100;
  const gapSlider = createSlider('wb-set-gap');
  // SLIDER_WRAP 自带 margin-top（独立成行时用的）；塞进这一行里要去掉，否则会往下偏
  gapSlider.el.style.marginTop = '0';
  gapSliderBox.appendChild(gapSlider.el);
  const gapValue = createEl(
    'span',
    'font-size:' +
      fpx(11) +
      ';opacity:.75;flex:0 0 auto;font-variant-numeric:tabular-nums',
    gapRow
  );
  const paintGapValue = () => {
    gapValue.textContent = Math.round(draft.idleSequenceGapMs) + ' 毫秒';
  };

  /* 待机阈值（**必须自绘滑块，不能是需要打字的输入框** —— WE 网页壁纸无键盘输入，见动作间隔滑块注释） */
  const standbyRow = createEl(
    'div',
    'display:flex;align-items:center;gap:' + uiPx(8),
    pages.sequence
  );
  const standbyLabel = createEl(
    'span',
    'font-size:' + fpx(12) + ';opacity:.8;flex:0 0 auto',
    standbyRow
  );
  /**
   * ★ 文案 2026-09-30 由「待机触发chat事件时长」改为「待机触发事件时长」：
   *   下面新增的两个开关（问候 / 闲聊）**共用这一个阈值**，名字里再写死 "chat" 就误导了。
   */
  standbyLabel.textContent = '待机触发事件时长';
  const standbySliderBox = createEl(
    'div',
    'flex:1 1 auto;min-width:0',
    standbyRow
  );
  /** 滑块 0~100 映射 5~300 秒（覆盖 5 秒到 5 分钟） */
  const STANDBY_MIN_SEC = 5;
  const STANDBY_MAX_SEC = 300;
  const secToSlider = (sec: number): number =>
    Math.min(
      100,
      Math.max(
        0,
        Math.round(
          ((sec - STANDBY_MIN_SEC) / (STANDBY_MAX_SEC - STANDBY_MIN_SEC)) * 100
        )
      )
    );
  const sliderToSec = (s: number): number =>
    Math.round(
      STANDBY_MIN_SEC + (s / 100) * (STANDBY_MAX_SEC - STANDBY_MIN_SEC)
    );
  const fmtStandby = (sec: number): string =>
    sec >= 60
      ? Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒'
      : sec + ' 秒';
  const standbySlider = createSlider('wb-set-standby');
  // SLIDER_WRAP 自带 margin-top（独立成行时用的）；塞进这一行里要去掉，否则会往下偏
  standbySlider.el.style.marginTop = '0';
  standbySliderBox.appendChild(standbySlider.el);
  const standbyValue = createEl(
    'span',
    'font-size:' +
      fpx(11) +
      ';opacity:.75;flex:0 0 auto;font-variant-numeric:tabular-nums',
    standbyRow
  );
  const paintStandbyValue = () => {
    standbyValue.textContent = fmtStandby(Math.round(draft.standbyIdleSec));
  };

  /**
   * ★ 一行说明：**游戏内**这个间隔是 **30 秒** —— 解包取证的原版真值
   * （`MiscApi:GetSoulSpineIdleInterval()` 返回常量 30，`SoulSpineCell:StartIdleTimer`
   *   用 `Timer.New(cb, 30, -1)` 循环计时，对所有皮肤相同；
   *   原工程的解包取证归档里有完整证据链）。
   *
   * 壁纸自身**保持默认 25 秒**不变，只是把原版值告诉用户，想完全还原的人自己拖到 30 秒。
   * 样式对齐 `addRow` 的 `sub` 行（不占用 React 结构、也不需要额外 padding，因为紧贴上一行）。
   */
  createEl(
    'div',
    'font-size:' + fpx(11) + ';opacity:.5;margin-top:' + uiPx(1),
    pages.sequence
  ).textContent = '游戏内原版是 30 秒；这里默认 25 秒，想完全还原可拖到 30 秒';

  /**
   * ★★ 三个通道的「可触发的事件」（**多选**）—— 2026-10-09 由单通道（`standbyKinds`）
   * 泛化成**三项同构**设置，共用同一套选项与交互。
   *
   * | 设置项 | 通道 | config 字段 | 缺省 |
   * |---|---|---|---|
   * | 长时间待机可触发的事件 | `'standby'` | `standbyKinds` | `['chat']` |
   * | 触摸可触发的事件 | `'touch'` | `touchKinds` | `['touch']` |
   * | 回到壁纸可触发的事件 | `'resume'` | `resumeKinds` | `['greet']` |
   *
   * ★★ 三个缺省**刻意各自不同**，合起来 = "升级后行为与改动前逐字相同"：
   *   待机缺省 chat类（还原"配了 `standby` 就一定会播"的老行为）、
   *   触摸缺省 touch类（= 被删掉的 `greetInTouchPool:false`）、
   *   回到壁纸缺省 greet类（= 旧 `tryGreeting` 只播问候）。
   * 详表见 `config.type.ts` 的 `TriggerEventKind` / `TriggerChannel`。
   *
   * ★ 为什么用 chips 多选而不是几个开关：三类是**同一件事的三个选项**（从一个池里取一条），
   *   一个设置项就该占一行；观感与交互沿用「序列」页的 chips，用户已经熟悉。
   * ★ **全部自绘**（`<button>` + 内联样式）：原生表单控件在 WE 的 CEF 里首帧 SIGILL。
   */
  const KIND_LABEL: Record<TriggerEventKind, string> = {
    chat: 'chat类',
    greet: 'greet类',
    touch: 'touch类',
  };

  /**
   * 造一组「多选 chips」。三个通道 + 触摸事件族共用本函数
   * ⇒ **选项、顺序、配色、交互天然一致**（不是复制四遍代码）。
   *
   * ★ 2026-10-10 由 `createKindChips` **泛化**而来：把"顺序 / 标签 / 归一函数"提成参数，
   *   于是「类别」（chat类/greet类/touch类）与「事件族」（誓约前/誓约后/普通）
   *   用的是同一套控件实现。
   *
   * @param ids 每个选项的 **DOM 锚点**（**写全字面量**：验证脚本按 id 找元素；拼出来的
   *   `'wb-set-standby-' + kind` 会被 terser 折成运行期拼接、产物里查不到字面量 ⇒ 锚点形同虚设）
   * @param get 读当前勾选（一般是 `draft.xxxKinds` / `draft.phases`）
   * @param set 把**归一后**的结果写回（归一用 `dialogue.normalize*`，
   *   面板自己不排序也不去重）
   * @param order 选项的固定显示顺序
   * @param labels 选项的显示名
   * @param normalize 归一函数（去重 + 按 `order` 排序 + 丢非法值）
   */
  const createChips = <T extends string>(
    ids: Record<string, string>,
    get: () => T[],
    set: (next: T[]) => void,
    order: readonly T[],
    labels: Record<T, string>,
    normalize: (v: unknown) => T[]
  ): { el: HTMLElement; paint: () => void } => {
    const box = createEl(
      'div',
      'display:flex;flex-wrap:wrap;gap:' + uiPx(6) + ';pointer-events:auto'
    );
    const paint = () => {
      box.innerHTML = '';
      order.forEach((kind) => {
        const on = get().indexOf(kind) >= 0;
        const chip = createEl(
          'button',
          [
            'pointer-events:auto',
            'display:inline-flex',
            'align-items:center',
            'padding:' + uiPx(3) + ' ' + uiPx(11),
            'border-radius:999px',
            'border:' +
              uiPx(1) +
              ' solid ' +
              (on ? '#4a90e2' : 'rgba(255,255,255,0.22)'),
            'background:' +
              (on ? 'rgba(74,144,226,0.28)' : 'rgba(255,255,255,0.06)'),
            'color:' + (on ? '#dce9fb' : 'rgba(238,241,246,0.72)'),
            'font-size:' + fpx(11.5),
            'font-family:inherit',
            'cursor:pointer',
            'white-space:nowrap',
          ].join(';'),
          box
        );
        // DOM 锚点：id 与 `data-wb-opt` 都给，改结构也不会让验证脚本失锚（见文件头 DOM 锚点口径）
        chip.id = ids[kind];
        chip.setAttribute('data-wb-set', ids[kind]);
        chip.setAttribute('data-wb-opt', kind);
        chip.setAttribute('role', 'checkbox');
        chip.setAttribute('aria-checked', on ? 'true' : 'false');
        chip.textContent = labels[kind];
        chip.addEventListener('click', () => {
          const next = get().slice();
          const at = next.indexOf(kind);
          if (at >= 0) {
            next.splice(at, 1);
          } else {
            next.push(kind);
          }
          set(normalize(next));
          paint();
        });
      });
    };
    paint();
    return { el: box, paint };
  };

  /** 「可触发的事件（类别）」—— 三个通道共用，选项固定 chat类 / greet类 / touch类 */
  const createKindChips = (
    ids: Record<TriggerEventKind, string>,
    get: () => TriggerEventKind[],
    set: (next: TriggerEventKind[]) => void
  ) =>
    createChips<TriggerEventKind>(
      ids,
      get,
      set,
      TRIGGER_KIND_ORDER,
      KIND_LABEL,
      normalizeTriggerKinds
    );

  /**
   * 本壁纸的**事件族注册表**（`config.subtitle.eventFamilies` 归一而来，2026-10-15）。
   *
   * ★ 一次归一、多处复用：chips 的选项 / 顺序 / 显示名 / 归一函数全部从它取
   *   （见下面「事件族」与「spine 动作族显示」两行）。
   * ⚠️ 归一结果**为空** ⇒ 该行不建；**没声明** `eventFamilies` ⇒ 内置单族 `normal`，仍会建。
   */
  const fams = buildFamilyRegistry(options.eventFamilies);

  /**
   * ★★ **触摸热区范围改为全屏**（2026-10-10；2026-10-10 晚随页序重组移到本页）。
   *
   * 打开 ⇒ `config.touch.fullscreen = true` ⇒ `index.ts` **忽略 `touch.zones`**，
   * 整个视口 `[0,1]×[0,1]` 就是一块热区（`id = 'fullscreen'`）⇒ 点画面任何位置都算命中。
   *
   * ★ 为什么属于**本页（事件触发）**：它决定"点到哪里才算触发"，是**触发条件**；
   *   而"触发后能抽到什么"在「事件池」页 —— 这正是一行注释就能划清的分工。
   * ★ 生效方式 = **保存后重载**（热区表是 `createTouchController` 开机一次性构造的）。
   */
  const cbTouchFullscreen = createToggle(
    'wb-set-touch-fullscreen',
    '触摸热区范围改为全屏',
    '打开后整块画面都算热区，点哪里都能触发；关闭时只认热区列表里的矩形'
  );

  /**
   * ★★ 正在播动作时点击该怎么处理（2026-10-08 新增；2026-10-09 补「仅问候/聊天时立即」并定为缺省）。
   *
   * 四档语义见 `TouchFeedbackMode` 的注释；闸门判据在 `touch.decideAction`（纯函数、可单测）。
   *
   * ★ 第一档 `'legacy'` = **改动前的规则表**（触摸动作在演时点击被忽略、问候/聊天在演时被打断），
   *   放在首位是因为它是缺省档 —— 用户不动它就等于"升级后行为不变"。
   *
   * ★ 用自绘分段而不是下拉的原因与其它项一样：**原生表单控件会在 CEF 里崩**
   * （见面板文件头的环境说明），且中文长标签横排会被压成竖排 ⇒ `stack = true` 独占一行。
   */
  const selTouchFeedback = createSegmented(
    'wb-set-touch-feedback',
    [
      ['legacy', '仅问候/聊天时立即'],
      ['immediate', '立即播放新动作'],
      ['queue', '排进播放队列'],
      ['none', '不做任何反馈'],
    ] as const,
    true
  );
  addRow(
    '播放动作时点击',
    selTouchFeedback.el,
    '动作正在播放时再点一下怎么处理。默认「仅问候/聊天时立即」：演问候或闲聊时点击会立刻改播，' +
      '演触摸动作时忽略。另三档 = 一律打断 / 排队等演完 / 完全不响应。',
    pages.sequence,
    true
  );

  /**
   * ★★ 问候事件的取条方式（2026-10-08 新增）。
   *
   * 「按系统时间」= 按当前钟点在 `subtitle.greet` 池里取对应序号那条
   *   （第 1 条=清晨、第 2 条=中午、第 3 条=傍晚，分界由 `greetingRanges` 定）；
   * 「随机」= 每次从整个问候池里随机抽一条，与钟点无关。
   */
  const selGreetMode = createSegmented(
    'wb-set-greet-mode',
    [
      ['time', '按系统时间'],
      ['random', '随机触发'],
    ] as const,
    true
  );
  addRow(
    '问候触发方式',
    selGreetMode.el,
    '问候取哪一条：「按系统时间」= 清晨/中午/傍晚各取对应那条；「随机触发」= 不看时间，整表随机。',
    pages.sequence,
    true
  );

  /* ── tab 4：事件池（原「触摸」，2026-10-10 改名并接管三个通道的池）── */
  /**
   * ★★ **两页的分工**（2026-10-10 用户口径重组；此前是「动作」+「触摸」）：
   *
   * | 页 | `id` | 管什么 | 典型设置项 |
   * |---|---|---|---|
   * | **事件触发** | `sequence` | "**什么时候 / 在哪里**触发" —— 触发条件与规则 | 常驻节奏、待机时长、热区范围、播放中点击的处理、问候取条方式 |
   * | **事件池** | `touch` | "触发后**能抽到哪些内容**" —— 每个入口的取值范围 | 三个入口的类别多选（前三行）+ 点击触摸的事件族（末行） |
   *
   * ★ **为什么这样分（重叠的根源）**：重组前「触摸可触发的事件」在「动作」页，
   *   而它的**第二层筛子**（事件族）在「触摸」页 ⇒ **同一件事被劈成两页**。
   *   现在"入口 → 取值范围"全在同一页。
   * ★ **本页行序**（2026-10-11 定稿）：三个**入口**（待机 / 触摸 / 回到壁纸）先列完，
   *   再收**挂在入口上的第二层筛子**（事件族）；同构的三行不被别的项打断，
   *   事件族也不再假扮成"第四个入口"或"触摸那一行的子行"（细节见该行注释）。
   * ★ 页面顺序与 `id` 都**不变**（仍是 `touch`），只改 `label` —— 锚点与验证脚本不受影响。
   */
  rowTarget = pages.touch;
  createEl(
    'div',
    'font-size:' + fpx(11) + ';opacity:.55;margin-bottom:' + uiPx(6),
    pages.touch
  ).textContent =
    '这里设定每个入口「能抽到哪些内容」；与「事件触发」页的设定叠加生效。';

  const standbyChips = createKindChips(
    {
      chat: 'wb-set-standby-chat',
      greet: 'wb-set-standby-greet',
      touch: 'wb-set-standby-touch',
    },
    () => draft.standbyKinds,
    (v) => {
      draft.standbyKinds = v;
    }
  );
  addRow(
    '长时间待机可触发的事件',
    standbyChips.el,
    '静置超过「事件触发」页设定的时长后，从勾中的类别里随机抽一条；勾多类就合成一个池一起抽。全不勾 = 待机不自动播。',
    pages.touch,
    true
  );

  const touchChips = createKindChips(
    {
      chat: 'wb-set-touch-chat',
      greet: 'wb-set-touch-greet',
      touch: 'wb-set-touch-touch',
    },
    () => draft.touchKinds,
    (v) => {
      draft.touchKinds = v;
    }
  );
  addRow(
    '触摸可触发的事件',
    touchChips.el,
    '点中角色时，从勾中的类别里随机抽一条；勾多类就合成一个池一起抽。默认只勾「touch类」。',
    pages.touch,
    true
  );

  const resumeChips = createKindChips(
    {
      chat: 'wb-set-resume-chat',
      greet: 'wb-set-resume-greet',
      touch: 'wb-set-resume-touch',
    },
    () => draft.resumeKinds,
    (v) => {
      draft.resumeKinds = v;
    }
  );
  addRow(
    '回到壁纸可触发的事件',
    resumeChips.el,
    '壁纸载入、回到桌面、切回窗口、离开超过 15 秒再回来时，从勾中的类别里随机抽一条。默认只勾「greet类」。',
    pages.touch,
    true
  );

  /**
   * ★★ **事件族 —— 全局候选闸门**（2026-10-10 新增；2026-10-11 挪到本页末尾；
   *   **2026-10-15 改为注册表驱动**；**2026-10-17 起对所有入口生效**）。
   *
   * 它是一道**全局闸门**，与入口无关：
   *   ① 待机 / 点击 / 回到壁纸 / 常驻序列**都只从勾中的族取条**；
   *   ② **一项都不勾 ⇒ 所有池为空** ⇒ 档案里没有任何事件行、任何通道都不触发；
   *   ③ 再往下一层才是各通道勾中的**类别**并池随机（`mergeKindPools`）。
   * ⇒ 与上面三行「可触发的事件」（类别）是 **AND**，与下面的「spine 动作族显示」
   *   也是 **AND**（前者管"允不允许这一族"，后者管"播哪套动画"）。
   *
   * ## ★ 位置：仍是本页倒数第二行
   *
   * 上面三行是**三个入口**同构的"可抽到哪些类别"，先列完；下面两行是**两个全局筛子**
   * （事件族 → 动作族），相邻成组。这样"三个入口"那组不被拆开，两个筛子也不假装成
   * "第四个入口"。
   * ⚠️ 标签里**不带 `└` 前缀**，也**不再写「仅点击触摸」**（作用域已变成全局）。
   *
   * ## ★★ 选项全部来自 `config.subtitle.eventFamilies`（2026-10-15）
   *
   * 顺序 = 注册表声明顺序、显示名 = `label`、归一 = `normalizeTriggerPhases(v, reg)`。
   * ⇒ 引擎里**不再有内置族名**，也**不再限定"誓约前/誓约后/普通"**：加一族 = 改 config。
   * ⚠️ **注册表为空**（没声明且归一后无族 / 显式 `[]`）⇒ **整行不建**（与「壁纸独立设置」
   *   页同一口径）。
   * ⚠️ DOM 锚点是**按注册表拼**的 `wb-set-phase-<id>`（不再有字面量）：
   *   验证脚本请按 `data-wb-opt="<id>"` 或 `[data-wb-set^="wb-set-phase-"]` 定位。
   */
  let phaseChips: { el: HTMLElement; paint: () => void } | null = null;
  if (fams.families.length) {
    const phaseIds: Record<string, string> = {};
    const phaseLabels: Record<string, string> = {};
    fams.ids.forEach((id) => {
      phaseIds[id] = 'wb-set-phase-' + id;
      phaseLabels[id] = fams.label(id);
    });
    phaseChips = createChips<TriggerPhase>(
      phaseIds,
      () => draft.phases,
      (v) => {
        draft.phases = v;
      },
      fams.ids,
      phaseLabels,
      (v) => normalizeTriggerPhases(v, fams)
    );
    addRow(
      '事件族',
      phaseChips.el,
      '★ 对**所有入口**生效：只有勾中的族能被触发（待机 / 点击 / 回到壁纸都受它约束）。' +
        '一项都不勾 ⇒ 所有事件都不触发。与下面的「spine 动作族显示」叠加生效。',
      pages.touch,
      true
    );
  }

  /**
   * ★★ **spine 动作族显示（单选）** —— 决定"播哪一套动画名"（2026-10-17 新增）。
   *
   * | 选项 | 值 | 效果 |
   * |---|---|---|
   * | `actionPhaseBaseLabel`（誓约工程 =「誓约前」） | `''` | 播原动画名（`greet` / `chat` / `idle`） |
   * | 每个**带 `matchSuffix` 的族**（`fams.actionIds`） | 族 id | 播该族那一套（`greet_marry` / `chat2_marry` / `idle_marry`） |
   *
   * ## ★ 与上面「事件族」那行的分工（两件事，别合并）
   *
   *   · 本项 = **动作族**：全局（常驻 / 问候 / 待机 / 点击 / 序列）换动画名，
   *     并把属**别的**动作族的条目挡在池外 ⇒ 誓约前池 6 条 / 誓约后池 9 条；
   *   · 「事件族」= **候选闸门**：**全局**，决定哪些族允许被触发（`[]` = 全关）。
   *
   * ## ★ 为什么是单选 + 为什么选项由注册表推导
   *
   * 游戏里 `isOath and MarryActionState≠""` 是**一个全局状态位**，同一条 actionId
   * 只会走其中一套动画 —— 不存在"两族同时显示"。所以是单选（分段控件）。
   * 选项**没有一个是写死的**：`''` + `fams.actionIds` ⇒ 未来加自定义动作族
   * （比如「和服态」`_kimono`）只要在 config 里声明 `matchSuffix`，这里自动多一档。
   *
   * ⚠️ `fams.actionIds` 为空（非誓约工程）⇒ **整行不建**（与「事件族」行同口径）。
   * ⚠️ DOM 锚点：容器 `wb-set-action-phase`，每个选项 `data-wb-opt="<族id>"`；
   *   "不换名"那一档的 `data-wb-opt` 是**空串**（`[data-wb-opt=""]`）。
   */
  let selActionPhase: ReturnType<typeof createSegmented> | null = null;
  if (fams.actionIds.length) {
    selActionPhase = createSegmented(
      'wb-set-action-phase',
      [
        ['', options.actionPhaseBaseLabel ?? '默认'],
        ...fams.actionIds.map((id) => [id, fams.actionLabel(id)] as const),
      ],
      true
    );
    selActionPhase.addEventListener('change', () => {
      draft.actionPhase = selActionPhase.value;
    });
    addRow(
      'spine 动作族显示',
      selActionPhase.el,
      '选择播放哪一套 spine 动画：选中某个动作族后，常驻 / 问候 / 待机 / 点击都换用' +
        '本项目为该族声明的动画名，且只抽得到属于该动作族的念白。字幕与语音不受影响。',
      pages.touch,
      true
    );
  }

  /* ── tab 5：事件开关（2026-10-19） ─────────────────────────────
   *
   * ## 这一页为什么只剩开关
   *
   * 事件（内置 + 自定义）的唯一来源是 `assets/events.jsonc`：能写注释、能 diff、
   * 能离线校验、能跟着工程走。而**面板内做不了**这些事 —— WE 的 CEF 没有可靠的
   * 输入法焦点（见文件头与 PLAN §7），半套编辑能力只会造出"引擎里看不见的状态"，
   * 2026-10-18 的三个线上 bug 全是这么来的。
   *
   * ⇒ 增删改交给文件，这一页只回答一个问题：**这条在这台机器上播不播**。
   *
   * | 能力 | 落点 |
   * |---|---|
   * | 新建 / 删除 / 改条件·动作·念白·语音 | `assets/events.jsonc`（面板顶部写明路径） |
   * | 开 / 关某一条 | 本页（`EventState` → localStorage，与设置项同一次保存 → 重载） |
   * | 恢复本页默认（2026-10-21 补回） | 本页右上角按钮：清空草稿里的开关，回落到文件缺省 |
   *
   * ★ 面板**不读文件、不归一**：`eventTable` 是 `index.ts` 归一后那份（`enabled` 已压过），
   *   所以"面板列出来的"与"真的会抽的"必然是同一份。
   * ★ `eventsFile.error` 非空（文件缺失/解析失败）⇒ 顶部红字，列表仍按 0 条渲染 ——
   *   引擎那边同样是 0 条，不粉饰。
   */
  rowTarget = pages.events;

  const evInner = createEl('div', 'width:100%', pages.events);
  evInner.id = 'wb-ev-page';

  const evFile = options.eventsFile ?? {
    path: 'assets/events.jsonc',
    error: null as string | null,
  };

  /** ① 文件指引（需求要的"告知用户去专门的事件配置文件编辑"） */
  const evHint = createEl(
    'div',
    [
      'font-size:' + fpx(11),
      'opacity:.62',
      'line-height:1.6',
      'margin-bottom:' + uiPx(4),
    ].join(';'),
    evInner
  );
  evHint.id = 'wb-ev-hint';
  evHint.textContent =
    '事件内容在 ' +
    evFile.path +
    '：支持 // 与 /* */ 注释，增删事件、改触发条件 / 动作 / 粒子 / 念白 / 语音' +
    '都在这个文件里改，保存后在 WE 里重新加载壁纸生效。本页只负责开关。';

  /** ② 来源 / 错误（解析失败时把行:列原样显示出来） */
  const evSource = createEl(
    'div',
    'font-size:' + fpx(11) + ';line-height:1.6',
    evInner
  );
  evSource.id = 'wb-ev-source';

  const evRows: readonly DialogueEntry[] = options.eventTable ?? [];
  /**
   * 本页的**生效值**（草稿）。单独存一份而不是直接读 `e.enabled`：
   * 点开关时立刻重绘，不必等重载（`e.enabled` 要等保存 + 重载才变）。
   */
  const eff: { [key: string]: boolean } = {};
  evRows.forEach((e) => {
    eff[eventKeyOf(e)] = e.enabled !== false;
  });

  /**
   * 文件里的缺省开关（由调用方从 `events.jsonc` 原始条目算好传进来）。
   * ⚠️ 不传 ⇒ 全部视作默认开启（`evDefaults[k] !== false` 恒真）。
   */
  const evDefaults: { [key: string]: boolean } = options.eventDefaults ?? {};

  let evState: EventState = {
    schema: 1,
    enabled: { ...(options.eventState?.enabled ?? {}) },
  };

  /**
   * 统计行 + 「恢复本页默认」（2026-10-21 补回）。
   *
   * ★ 与底部「恢复默认」的分工：
   *   · 本按钮 = **只**把本页的开关恢复成 `events.jsonc` 的缺省（草稿），
   *     仍要按「保存并应用」才落盘 —— 与其它控件同一套"草稿 → 保存 → 重载"口径；
   *   · 底部按钮 = 清掉**全部**覆盖层（含事件开关），立即重载。
   */
  const evBar = createEl(
    'div',
    'display:flex;align-items:center;justify-content:space-between;gap:' +
      uiPx(8) +
      ';margin:' +
      uiPx(3) +
      ' 0',
    evInner
  );
  const evCount = createEl(
    'div',
    'font-size:' + fpx(11) + ';opacity:.6;min-width:0',
    evBar
  );
  evCount.id = 'wb-ev-count';
  const btnEvReset = createEl('button', BTN_TINY, evBar);
  btnEvReset.id = 'wb-ev-reset';
  btnEvReset.textContent = '恢复本页默认';
  btnEvReset.title =
    '只把这一页的开关恢复成事件文件（events.jsonc）里的默认值；还要点底部「保存并应用」才生效。';

  /** 恢复后的即时反馈（只在点过之后出现，避免常驻多占一行） */
  const evResetHint = createEl(
    'div',
    'font-size:' + fpx(10.5) + ';opacity:.55;line-height:1.5;margin-bottom:' + uiPx(3),
    evInner
  );
  evResetHint.id = 'wb-ev-reset-hint';
  /** 没点过就完全不占位（这一页在 13 条工程上已经贴着可视区底边） */
  evResetHint.style.display = 'none';

  const paintCount = () => {
    const on = Object.keys(eff).filter((k) => eff[k]).length;
    const changed = changedEventKeys(evDefaults, evState).length;
    evCount.textContent =
      '共 ' +
      evRows.length +
      ' 条 · 已开启 ' +
      on +
      ' 条' +
      (changed ? ' · 已改 ' + changed + ' 项' : '');
  };

  if (evFile.error) {
    evSource.style.color = '#ff8080';
    evSource.textContent = '⚠ ' + evFile.error;
  } else if (!evRows.length) {
    evSource.style.color = 'rgba(238,241,246,0.55)';
    evSource.textContent =
      '文件里还没有事件 —— 在 ' + evFile.path + ' 的 events 数组里加一条。';
  } else {
    evSource.style.color = 'rgba(238,241,246,0.55)';
    evSource.textContent = '来源：' + evFile.path;
  }
  paintCount();

  const evList = createEl(
    'div',
    'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.08)',
    evInner
  );
  evList.id = 'wb-ev-list';

  /**
   * 自绘小方钮（每行一个开关；比 `createToggle` 那套带标签的行更省高度）。
   *
   * @returns `set` 供「恢复本页默认」从外部把勾选状态刷回去（内部状态不暴露）
   */
  const miniToggle = (on0: boolean, onChange: (v: boolean) => void) => {
    let on = on0;
    const el = createEl(
      'div',
      [
        'flex:0 0 auto',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:' + uiPx(17),
        'height:' + uiPx(17),
        'border:' + uiPx(1) + ' solid rgba(255,255,255,0.28)',
        'border-radius:' + uiPx(4),
        'color:#fff',
        'font-size:' + fpx(11),
        'line-height:1',
        'cursor:pointer',
        'user-select:none',
      ].join(';')
    );
    const paint = () => {
      el.textContent = on ? '\u2713' : '';
      el.style.background = on ? '#4a90e2' : 'transparent';
      el.style.borderColor = on ? '#4a90e2' : 'rgba(255,255,255,0.28)';
    };
    paint();
    el.addEventListener('click', () => {
      on = !on;
      paint();
      onChange(on);
    });
    return {
      el,
      set: (v: boolean) => {
        on = v;
        paint();
      },
    };
  };

  /**
   * `on` 的显示名。★ 2026-10-21（B 案）起它**不再是"这条只能在哪些入口播"**，
   * 只是分组 / 来源标记（通道筛子已撤，见 `eventScheduler.collectCandidates`）。
   * 行里带「组:」前缀，避免被误读成可达性。
   */
  const CH_TEXT: Record<TriggerChannel, string> = {
    touch: '组:触摸',
    standby: '组:待机',
    resume: '组:回到壁纸',
  };
  /** 键里可能有 `:` ⇒ DOM id 只留安全字符（验证脚本按同样规则拼） */
  const domKey = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, '_');

  /** 每行"把勾选刷成 v"的回调（键 = 事件键）—— 供「恢复本页默认」用 */
  const evPaint: { [key: string]: (on: boolean) => void } = {};

  evRows.forEach((e) => {
    const id = eventKeyOf(e);
    const row = createEl(
      'div',
      [
        'display:flex',
        'gap:' + uiPx(7),
        'align-items:center',
        'padding:' + uiPx(3) + ' 0',
        'border-bottom:' + uiPx(1) + ' solid rgba(255,255,255,0.06)',
      ].join(';'),
      evList
    );
    row.setAttribute('data-wb-ev', id);
    row.id = 'wb-ev-row-' + domKey(id);

    const tgl = miniToggle(eff[id] !== false, (v) => {
      eff[id] = v;
      evState.enabled[id] = v;
      paintCount();
    });
    tgl.el.id = 'wb-ev-tgl-' + domKey(id);
    row.appendChild(tgl.el);
    evPaint[id] = tgl.set;

    /**
     * 一行式：`名称 · 分组 · 条件 · 动画 · #id`（省略号截断）。
     * 为什么不是两行：WE 不转发滚轮（见「面板自适应高度」那一段），
     * 两行式在 13 条工程上会把内容顶出可视区。
     */
    const name = createEl(
      'div',
      [
        'flex:0 1 auto',
        'min-width:0',
        'max-width:' + uiPx(300),
        'font-size:' + fpx(12),
        'line-height:1.4',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis',
      ].join(';'),
      row
    );
    name.textContent = e.displayName || e.label || id;
    name.title = e.text || name.textContent;

    const chans = channelsOf(e)
      .map((c) => CH_TEXT[c] || c)
      .join('/');
    const fx =
      e.particles && e.particles.length ? '·' + e.particles.join('+') : '';
    const manual = e.pick?.weight === 0 ? ' · 仅手动' : '';
    const meta = createEl(
      'div',
      [
        'flex:1 1 auto',
        'min-width:0',
        'font-size:' + fpx(10.5),
        'opacity:.55',
        'line-height:1.4',
        'white-space:nowrap',
        'overflow:hidden',
        'text-overflow:ellipsis',
      ].join(';'),
      row
    );
    meta.textContent =
      (chans || '不可达') +
      ' · ' +
      describeCondition(e.when) +
      ' · ' +
      (e.animation || '—') +
      fx +
      manual +
      ' · ' +
      id;
    meta.title = meta.textContent;
  });

  if (!evRows.length) {
    createEl(
      'div',
      'font-size:' + fpx(11) + ';opacity:.5;padding:' + uiPx(8) + ' 0',
      evList
    ).textContent = evFile.error
      ? '事件文件不可用 ⇒ 本壁纸不会触发任何事件。'
      : '事件文件里没有事件条目。';
  }

  /**
   * 「恢复本页默认」—— 清空本页草稿里的开关，全部回落到 `events.jsonc` 的缺省。
   *
   * ⚠️ **不落盘、不重载**：与别的控件同一口径（草稿 → 底部「保存并应用」→ 重载）。
   *   正因为如此，调用方（`index.ts`）在保存时看到"空 map"会直接删掉 localStorage
   *   里的 `wb.events.state.v1` —— 这样"恢复默认"留下的是一份**干净的缺省状态**，
   *   而不是一个"全是 true 的空壳 map"。
   */
  btnEvReset.addEventListener('click', () => {
    evState = { schema: 1, enabled: {} };
    evRows.forEach((e) => {
      const key = eventKeyOf(e);
      const on = evDefaults[key] !== false;
      eff[key] = on;
      if (evPaint[key]) {
        evPaint[key](on);
      }
    });
    paintCount();
    evResetHint.style.display = 'block';
    evResetHint.textContent =
      '已恢复为事件文件的默认开关（' +
      evRows.length +
      ' 条）—— 点底部「保存并应用」生效。';
  });

  createEl(
    'div',
    'font-size:' +
      fpx(10.5) +
      ';opacity:.5;margin-top:' +
      uiPx(5) +
      ';line-height:1.5',
    evInner
  ).textContent = '改动点底部「保存并应用」后生效（壁纸会重载）。';

  /* ── tab 6：画面调整 ───────────────────────── */
  rowTarget = pages.view;

  /**
   * 全屏适配的**对齐基准**（二选一）。
   *
   * ★★ 为什么会有两个选项（2026-10-08 用户拍板做成设置项）：
   * 两种基准各有可取之处，且**只影响整体放大/缩小**（不改任何层的相对摆位），
   * 所以最合适的做法是让用户自己挑，而不是替他定死。
   *
   *   · **按画幅高**（缺省）⇒ 可见高度恒等于设计画幅的高度，
   *     与**游戏内的实际取景一致**（实测与游戏实录 z=1.01、NCC 0.866）；
   *     屏幕比设计画幅窄时会裁掉左右两侧，比设计画幅宽时会多露出一些背景。
   *   · **按画幅宽** ⇒ 可见宽度恒等于底层背景的宽度，
   *     **任何屏幕比例都不会裁掉左右内容**；代价是相对游戏画面偏小
   *     （16:9 下约是按高对齐的 78%）。
   *
   * 两者在屏幕比例恰好等于设计画幅比例时**完全重合**。
   * 取证与定量关系见 `config.type.ts` 的 `fitAspect` 注释。
   */
  const selFitAspect = createSegmented(
    'wb-set-fitaspect',
    [
      ['height', '按画幅高对齐（默认）'],
      ['width', '按画幅宽对齐（左右不裁）'],
    ] as const,
    true
  );
  addRow(
    '画面对齐基准',
    selFitAspect.el,
    '「按画幅高对齐」= 上下固定、与游戏画面一致，屏幕越窄左右裁得越多；' +
      '「按画幅宽对齐」= 左右不裁，但整体偏小（16:9 时约为前者的 78%）。',
    pages.view,
    true
  );

  /**
   * 指针（鼠标）拖尾粒子总开关。
   *
   * ★ 复刻的是游戏里"按住滑动 ⇒ 一串蓝色粒子连成轨迹"那个效果
   *   （`FX_UI_CommonUI_Click` 的 `/5`、`/5/6`，解包与实现见 09 文档 18 / 19）。
   * ★ 生效方式 = **保存后重载**：发射器与几何缓冲是开机一次性构造的。
   *
   * ⚠️ 本页**只剩两项**（对齐基准 + 本开关）：原来的「摩天轮轿厢角度」已挪进
   *   「壁纸独立设置」页（它只对配了摩天轮的壁纸有意义，见该页注释）。
   */
  const cbTrail = createToggle(
    'wb-set-pointertrail',
    '开启鼠标粒子拖尾效果',
    '指针在桌面移动时沿轨迹留下等距发光粒子；粒子随寿命收缩到消失'
  );

  /* ── 调试面板（**独立**小面板，入口 = 入口列里的「调试」按钮）──────────────
   *
   * ## 为什么不再做成设置面板的一个分页
   *
   * 调试是**诊断工具**而不是观赏设置：排查时要反复开关、每次改完都得重载，
   * 塞在 6 分页的深处意味着"开面板 → 翻页 → 改 → 保存"四步。
   * 独立成一个常驻小面板后**一步点到**、改完就地保存（用户 2026-10-15 拍板）。
   *
   * ## ★ 与设置面板**互斥展开**
   *
   * 两个面板各自维护一份 `draft`；若同时开着，一边保存会把另一边没保存的
   * 草稿状态带进去（值本身不会错，但用户看到的现象是"我没改这项它却变了"）
   * ⇒ 开一个必关另一个（见下面两个 click 监听与 `setDebugOpen`）。
   *
   * ## ★ 保存只下发这 4 个键
   *
   * `writeOverrides` 是**合并写** ⇒ 不带别的键就不会动别的设置；
   * 反过来，设置面板的「保存并应用」也**不再**带这 4 个键（见 `btnSave`），
   * 两边互不覆盖。存盘字段名与旧版**完全一致**（`probeEnabled` …）⇒ 老存档兼容。
   *
   * ## ★ 不做滚动 / 不用 backdrop-filter
   *
   * 内容只有 4 行，**刻意**不设 `max-height` + `overflow:auto`：
   * WE 不转发滚轮（见上文"自适应"段），一旦需要滚动就永远滚不动。
   * 毛玻璃则在 WE CEF 上直接崩渲染进程，见文件头。
   */
  const debugPanel = createEl(
    'div',
    [
      'pointer-events:auto',
      'position:fixed',
      // ★ 挂在入口列的**左侧**、与列顶对齐（不是"挂在调试按钮正下方"）：
      //   列本身有 6 个按钮（≈278 设计px）够高，面板若接在列尾就只剩半屏可用高度，
      //   而调试面板里有两组 chips（全部动画 + 全部念白），是全工程最高的浮层。
      'top:' + uiPx(CORNER_TOP),
      'right:' + uiPx(CORNER_TOP + CORNER_BTN + CORNER_GAP),
      'width:' + uiPx(300),
      'box-sizing:border-box',
      'padding:' + uiPx(14) + ' ' + uiPx(16) + ' ' + uiPx(12),
      'display:none',
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.16)',
      'border-radius:' + uiPx(12),
      'background:rgba(16,18,26,0.94)',
      'box-shadow:0 ' + uiPx(10) + ' ' + uiPx(28) + ' rgba(0,0,0,0.45)',
      'color:#eef1f6',
      'font-size:' + fpx(13),
      'line-height:1.5',
    ].join(';'),
    root
  );
  debugPanel.id = 'wb-debug-panel';
  const dbgTitle = createEl(
    'div',
    'font-size:' + fpx(15) + ';font-weight:600;letter-spacing:' + uiPx(0.5),
    debugPanel
  );
  dbgTitle.textContent = '调试';
  const dbgTip = createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.55;margin-top:' +
      uiPx(2) +
      ';line-height:1.45',
    debugPanel
  );
  dbgTip.textContent = '诊断开关；改完点「保存并应用」，壁纸会重新加载以生效。';
  const debugBody = createEl('div', 'margin-top:' + uiPx(4), debugPanel);
  debugBody.id = 'wb-debug-body';
  /** ★ `createToggle` 走默认父级 `rowTarget` ⇒ 临时切过去再切回来 */
  const prevRowTarget = rowTarget;
  rowTarget = debugBody;
  // ★ 文案与 WE 属性面板的「调试总开关」对齐（两者是同一个字段 probeEnabled）
  const cbProbe = createToggle(
    'wb-set-probe',
    '调试总开关',
    '关闭后不挂任何监听，HUD 与红圈都不建'
  );
  const cbHud = createToggle(
    'wb-set-hud',
    '显示 HUD 文字',
    '左上角那块读数（mousemove / 坐标 / 判定）'
  );
  const cbCross = createToggle(
    'wb-set-crosshair',
    '显示鼠标位置红圈',
    '红圈若不在鼠标处 ⇒ 宿主给的坐标口径不对'
  );
  const cbZones = createToggle(
    'wb-set-zones',
    '显示触摸热区框',
    '把整屏热区边界画出来（含缩放与命中数）'
  );
  rowTarget = prevRowTarget;

  /* ── 调试触发分组：动作 / 事件（**不滚动**，见下） ───────────────────
   * ★ WE 网页壁纸**不转发滚轮** ⇒ 任何 `overflow:auto` 的容器都点不滚。
   *   所以两组 chips 直接堆在面板里、面板整体向下长（position:fixed 只定 top，
   *   高度随内容撑开）。chips 刻意做小（font 10 / padding 2·6 / gap 4）以塞更多条目。
   * 反馈：点一下**瞬时变白**、保持 3s，再**淡化**回原色（见 click 里的 transition
   * 手法：点击时把过渡压到 .12s ⇒ 白得干脆；3s 后清掉内联样式 ⇒ 回落走基础样式
   * 的 .6s ⇒ 淡回原色）。纯视觉确认，不写持久态。
   */
  const TRIGGER_CHIP = [
    'pointer-events:auto',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'padding:' + uiPx(2) + ' ' + uiPx(6),
    'border-radius:' + uiPx(6),
    'border:' + uiPx(1) + ' solid rgba(255,255,255,0.18)',
    'background:rgba(255,255,255,0.05)',
    'color:rgba(238,241,246,0.82)',
    'font-size:' + fpx(10),
    'font-family:inherit',
    'cursor:pointer',
    'white-space:nowrap',
    'line-height:1.4',
    // 淡化回原色用的过渡（变白那一瞬会被变白态的 .12s 覆盖掉，
    // 从而做出"白得干脆、淡得缓慢"的不对称手感）
    'transition:background-color .6s ease,color .6s ease,border-color .6s ease',
  ].join(';');
  /**
   * 变白态 = **基础声明块 + 追加覆盖色**（后写的赢）。
   *
   * ★★ 为什么整块存起来、而不是运行时只改 `style.background`：
   * 这些 chip 的样式是**整条内联声明块**（`createEl` 走 `style.cssText = ...`），
   * 基础色就写在这一块里。若运行时用 `chip.style.background = ''` 去"还原"，
   * CSSOM 会把 background 这条**从内联块里删掉** ⇒ 基础色也没了（没有别的 CSS 规则
   * 顶着）⇒ 落到浏览器默认按钮脸 `rgb(240,240,240)` + 黑字（实测踩过，见
   * `55_验证_调试面板.js` 的 9.x）。所以还原一律是"把整块换回基础串"。
   */
  const TRIGGER_CHIP_FLASH =
    TRIGGER_CHIP +
    ';' +
    [
      'background:#ffffff',
      'color:#14181f', // 白底必须配深色字，否则字看不见
      'border-color:#ffffff',
      'transition:background-color .12s ease,color .12s ease,border-color .12s ease',
    ].join(';');
  /**
   * 「没播出来」的反馈态（2026-10-20）。
   *
   * ★ 为什么需要：`onPlayAnimation` / `onTriggerEvent` 都返回"到底播没播"
   *   （被打断闸门 / 事件族闸门 / 找不到条目 ⇒ `false`），但此前这个返回值被**丢弃**，
   *   于是"点了、白了、没播"三者长得一模一样 —— 诊断面板最不该有这种沉默。
   *   现在成功 = 白闪，失败 = 红闪，并写 `data-wb-last="fail"` 供回归断言。
   */
  const TRIGGER_CHIP_FAIL =
    TRIGGER_CHIP +
    ';' +
    [
      'background:rgba(198,58,58,0.92)',
      'color:#fff',
      'border-color:rgba(255,140,140,0.95)',
      'transition:background-color .12s ease,color .12s ease,border-color .12s ease',
    ].join(';');

  /** 一个触发方块：`key` 是回调载荷，`domId` 只用来拼 DOM id（见下面事件组的用法） */
  type ChipItem = {
    key: string;
    text: string;
    hint?: string;
    /** 拼 `id="<前缀><domId>"` 用；缺省 = `key`。事件键含 `:`，必须换成安全字符 */
    domId?: string;
  };

  /** 渲染一组触发 chips（标题 + 说明 + 换行方块）。items 为空 ⇒ 整组不建。 */
  const makeChipGroup = (
    titleText: string,
    tip: string,
    /** chip id 前缀（如 `wb-debug-anim-`）；便于测试与用户定位单个方块 */
    idPrefix: string,
    items: ChipItem[],
    onClick: (it: ChipItem) => boolean
  ) => {
    if (!items.length) {
      return;
    }
    const wrap = createEl('div', 'margin-top:' + uiPx(10), debugPanel);
    const h = createEl(
      'div',
      'font-size:' + fpx(11) + ';font-weight:600;opacity:.9',
      wrap
    );
    h.textContent = titleText;
    const t = createEl(
      'div',
      'font-size:' +
        fpx(10) +
        ';opacity:.5;margin:' +
        uiPx(2) +
        ' 0 ' +
        uiPx(4) +
        ';line-height:1.4',
      wrap
    );
    t.textContent = tip;
    const box = createEl(
      'div',
      'display:flex;flex-wrap:wrap;gap:' + uiPx(4) + ';pointer-events:auto',
      wrap
    );
    items.forEach((it) => {
      const chip = createEl('button', TRIGGER_CHIP, box);
      chip.id = idPrefix + (it.domId ?? it.key);
      chip.textContent = it.text;
      if (it.hint) {
        chip.title = it.hint;
      }
      /** 本 chip 的"变白"倒计时；0 = 没在计时。连点则重置（重新白 3s） */
      let flashTimer = 0;
      chip.addEventListener('click', () => {
        /** ① 先看"到底播没播"（回调的返回值就是答案，别猜） */
        let played = false;
        try {
          played = onClick(it);
        } catch (_e) {
          /* 抛错也当"没播"—— 视觉反馈照给，画面不能没反应 */
          played = false;
        }
        chip.setAttribute('data-wb-last', played ? 'ok' : 'fail');
        /* ── 变白 3s → 淡化回原色 ─────────────────────────────
         * 变白态用**整块** `TRIGGER_CHIP_FLASH`（基础块 + 覆盖色），还原时整块换回
         * `TRIGGER_CHIP` —— 绝不能逐条 `style.X = ''`：基础色就写在同一条内联块里，
         * 置空等于把它也删掉（详见 TRIGGER_CHIP_FLASH 的注释）。
         * 过渡的不对称靠"块里的 transition 谁在后面"实现：
         *   变白 → 块尾是 .12s ⇒ 白得干脆；
         *   还原 → 块尾是基础 .6s ⇒ 淡回原色。
         * ★ 失败时换成红块（同一套手法），3s 后一起淡回。
         */
        chip.style.cssText = played ? TRIGGER_CHIP_FLASH : TRIGGER_CHIP_FAIL;
        if (flashTimer) {
          window.clearTimeout(flashTimer);
        }
        flashTimer = window.setTimeout(() => {
          chip.style.cssText = TRIGGER_CHIP;
          flashTimer = 0;
        }, 3000);
      });
    });
  };

  // 动作组：全部骨架动画（不带台词/语音；走与点击同路径、不过闸门）
  // ★ 2026-10-17：它会一并拉起该动画在 `config.actionEffects` 里绑定的额外粒子特效
  //   —— 补之前"从面板点任何动作都看不到特效"，见 `index.ts` 的 `onPlayAnimation` 注释。
  makeChipGroup(
    '触发动作（动画 + 特效）',
    '点一下直接播该动画，并拉起它绑定的额外粒子特效（不出台词、不带语音）',
    'wb-debug-anim-',
    (options.animations || []).map((n) => ({ key: n, text: n })),
    (it) => (options.onPlayAnimation ? options.onPlayAnimation(it.key) : false)
  );

  // 事件组：全部念白（动作+字幕+语音，走完整闸门）；无念白 ⇒ 整组不建
  if (options.events && options.events.length > 0) {
    makeChipGroup(
      '触发事件（动作+字幕+语音）',
      '点一下按事件键播整条念白（含打断闸门；白闪=播了，红闪=被挡住）',
      'wb-debug-ev-',
      options.events.map((e) => ({
        /** 载荷 = 事件键，**不是** actionId（自定义事件没有 actionId） */
        key: e.key,
        /** 显示名优先（自定义事件只有 `displayName`），缺省退回键 */
        text: e.name || e.key,
        hint: [
          e.key,
          e.actionId !== undefined ? '#' + e.actionId : '',
          e.animation ? '动画:' + e.animation : '',
        ]
          .filter(Boolean)
          .join(' ｜ '),
        /** 键里含 `:` ⇒ DOM id 只留安全字符（与「事件开关」页同一个 `domKey`） */
        domId: domKey(e.key),
      })),
      (it) => (options.onTriggerEvent ? options.onTriggerEvent(it.key) : false)
    );
  }

  const debugFoot = createEl(
    'div',
    'display:flex;gap:' + uiPx(8) + ';margin-top:' + uiPx(12),
    debugPanel
  );
  const btnDebugSave = createEl('button', BTN_PRIMARY, debugFoot);
  btnDebugSave.id = 'wb-debug-save';
  btnDebugSave.textContent = '保存并应用';
  const btnDebugClose = createEl('button', BTN_GHOST, debugFoot);
  btnDebugClose.id = 'wb-debug-close';
  btnDebugClose.textContent = '关闭';

  /* ── tab 7：壁纸独立设置（**只对本壁纸生效**；config 没声明 ⇒ 这一页整个不存在） ── */
  /**
   * ## 为什么单开一页（用户 2026-10-11 拍板）
   *
   * 「摩天轮轿厢角度」（`ferrisWheel.cabinMode`）原本在「画面调整」页，但它是
   * **盛夏游乐场那张壁纸专属**的项：换成没有摩天轮粒子组的壁纸，这一项就是
   * **永远无效的控件**（改了没有任何东西跟着变，也不会报错 —— 最坏的那种噪声）。
   * ⇒ 新开一页，把"只对本壁纸生效"的项收进来，通用页只留通用项。
   *
   * ## ★★ 内容由 config 声明，不由面板写死
   *
   * 本工程是**通用引擎**：同一份 bundle 服务多张壁纸，面板是引擎的一部分，
   * 所以"我有哪些独立设置"必须由**壁纸自己的 config** 说（`config.wallpaperSettings`）：
   *
   * ```json
   * "wallpaperSettings": { "label": "盛夏游乐场", "items": ["cabinMode"] }
   * ```
   *
   * ⚠️ 不声明 / `items` 为空 / 全是写错的 id ⇒ `resolveWallpaperPanelSpec` 返回 `null`
   *   ⇒ 上面 `TABS` 的过滤已经把这一页（**连标签按钮**）整个去掉，
   *   `pages.wallpaper` 是 `undefined` ⇒ 本段整体跳过。
   *   ⇒ 既不会留下空页，也不会渲染出没有实现的控件。
   *
   * ⚠️ 本页**只改展示位置**：各项的值仍走 `view`（`cabinMode` →
   *   `config.ferrisWheel.cabinMode`），`settingsStore` 的读写链路一行没动
   *   （`readView` / `applyOverrides` / `sameView` 照旧）⇒ 存盘格式与旧版完全兼容。
   * ⚠️ 本页所有行都**显式传 `parent`**（不复用 `rowTarget`）：这一页可能整个不存在，
   *   让它去改 `rowTarget` 只会埋一个"默认父级指向 undefined"的雷。
   */
  let selCabin: ReturnType<typeof createSegmented> | null = null;
  if (wallpaperSpec && pages.wallpaper) {
    const page = pages.wallpaper;
    createEl(
      'div',
      'font-size:' +
        fpx(11) +
        ';opacity:.55;margin-bottom:' +
        uiPx(6) +
        ';line-height:1.5',
      page
    ).textContent =
      '这一页的设置只对当前这张壁纸生效；换用别的壁纸时不会出现这些项。';

    /** 分组标题 = 本壁纸的名字（`wallpaperSettings.label`） */
    const groupHead = createEl(
      'div',
      'font-size:' +
        fpx(12.5) +
        ';font-weight:600;opacity:.9;margin-top:' +
        uiPx(2) +
        ';margin-bottom:' +
        uiPx(2),
      page
    );
    groupHead.id = 'wb-wallpaper-group';
    groupHead.setAttribute('data-wb-group', 'wallpaper');
    groupHead.textContent = wallpaperSpec.label;

    if (wallpaperSpec.items.indexOf('cabinMode') >= 0) {
      /**
       * 摩天轮轿厢姿态角（二选一）。
       *
       * ★★ 为什么会有两个选项（取证见 09 文档 `04_渲染差异记录.md` §D1）：
       * 解包数据里轿厢 `startRotation` = **−15°**（美术按画面重力画），
       * 而**游戏实录**轿厢长轴 **−0.03°**（被强制对齐画布）⇒ 两边差约 15°，
       * 是游戏渲染侧行为造成的，**不是素材错**。只能交给用户选要哪一种。
       *
       * ★ 标签**不写英文配置名**（面板口径），但要点明角度与观感差异。
       * ★ DOM 锚点 `wb-set-cabin-mode` **保持不变**（2026-10-11 只挪页、不改 id）——
       *   已验证过的脚本/存档里的锚点不会因为这次搬迁失锚。
       */
      selCabin = createSegmented(
        'wb-set-cabin-mode',
        [
          ['gravity', '解包数据（−15°，随画面重力）'],
          ['game', '游戏实测（0°，水平对齐）'],
        ] as const,
        true
      );
      addRow(
        '摩天轮轿厢角度',
        selCabin.el,
        '两种角度都来自实测：解包按画面重力倾斜 −15°，游戏里却被强制水平。选哪个都不会报错，只是观感不同。',
        page,
        true
      );
    }
  }

  /* ── 底部按钮（在 tabBody **之外** ⇒ 任何 tab 都常驻可见） ── */
  const foot = createEl(
    'div',
    'display:flex;gap:' +
      uiPx(8) +
      ';margin-top:' +
      uiPx(12) +
      ';padding-top:' +
      uiPx(10) +
      ';' +
      'border-top:' +
      uiPx(1) +
      ' solid rgba(255,255,255,0.08)',
    panel
  );
  const btnSave = createEl('button', BTN_PRIMARY, foot);
  btnSave.id = 'wb-set-save';
  btnSave.textContent = '保存并应用';
  const btnReset = createEl('button', BTN_GHOST, foot);
  btnReset.id = 'wb-set-reset';
  btnReset.textContent = '恢复默认';
  /**
   * ★ 2026-10-21：底部这一颗连**本机的事件开关**一起清（以前只清设置覆盖层，
   *   "点了恢复默认、事件开关却还是关着的"）。作用范围写在 title 里，
   *   因为按钮旁边没有地方再放一行说明。
   */
  btnReset.title =
    '清空本机全部设置与事件开关，回到 assets/config.json 与 assets/events.jsonc 的默认值（会立即重载）。';

  /**
   * 渲染"候选动画名" chips。
   *
   * 选中项按**点击顺序**加角标 —— 序列是有序的，单纯的多选表达不了顺序。
   * 再点一次移除（后面的角标自动重排）。
   */
  const renderChips = () => {
    chips.innerHTML = '';
    /**
     * ★ 2026-10-20：序列里可能还有**不是裸动画名**的项（`{key}` / `{actionId}`），
     *   本页只排动画名 ⇒ 它们没有对应的 chip。以前这种项在 `readView` 阶段就被
     *   `filter(!!s)` 吃掉，保存时被整表覆盖（**不可逆**）。现在它们以
     *   `@custom:xxx` / `#64005` 的形式留在 `draft.idleSequenceItems` 里原样保存，
     *   这里只报个数 —— 既不在页面上假装能编辑，也不会悄悄丢。
     */
    const extra = draft.idleSequenceItems.filter(
      (s) => s.charAt(0) === '@' || s.charAt(0) === '#'
    ).length;
    seqTip.textContent =
      '点选动画名即可按顺序加入序列（只排序列、不带台词）。' +
      (extra
        ? '另有 ' +
          extra +
          ' 项按「事件键 / 动作 ID」引用，本页不展示、保存时原样保留（改它们请编辑 config.json）。'
        : '');
    options.animations.forEach((name) => {
      const idx = draft.idleSequenceItems.indexOf(name);
      const on = idx >= 0;
      const chip = createEl(
        'button',
        [
          'pointer-events:auto',
          'display:inline-flex',
          'align-items:center',
          'gap:' + uiPx(4),
          'padding:' + uiPx(3) + ' ' + uiPx(9),
          'border-radius:999px',
          'border:' +
            uiPx(1) +
            ' solid ' +
            (on ? '#4a90e2' : 'rgba(255,255,255,0.22)'),
          'background:' +
            (on ? 'rgba(74,144,226,0.28)' : 'rgba(255,255,255,0.06)'),
          'color:' + (on ? '#dce9fb' : 'rgba(238,241,246,0.72)'),
          'font-size:' + fpx(11.5),
          'font-family:inherit',
          'cursor:pointer',
          'white-space:nowrap',
        ].join(';'),
        chips
      );
      chip.id = 'wb-seq-chip-' + name;
      chip.setAttribute('data-wb-seq-chip', name);
      chip.textContent = name;
      if (on) {
        const badge = createEl(
          'span',
          'display:inline-flex;align-items:center;justify-content:center;' +
            'min-width:' +
            uiPx(14) +
            ';height:' +
            uiPx(14) +
            ';padding:0 ' +
            uiPx(3) +
            ';border-radius:999px;' +
            'background:#4a90e2;color:#fff;font-size:' +
            fpx(10) +
            ';line-height:1',
          chip
        );
        badge.textContent = String(idx + 1);
      }
      chip.addEventListener('click', () => {
        const at = draft.idleSequenceItems.indexOf(name);
        if (at >= 0) {
          draft.idleSequenceItems.splice(at, 1);
        } else {
          draft.idleSequenceItems.push(name);
        }
        renderChips();
      });
    });
  };

  /** 把 draft 写回控件，或把 config 值读进 draft + 控件 */
  const syncFromDraft = () => {
    cbBgm.checked = draft.bgmEnabled;
    vol.value = String(Math.round(draft.bgmVolume * 100));
    volValue.textContent = Math.round(draft.bgmVolume * 100) + '%';
    volVoice.value = String(Math.round(draft.voiceVolume * 100));
    voiceVolValue.textContent = Math.round(draft.voiceVolume * 100) + '%';
    cbSubtitle.checked = draft.subtitleEnabled;
    selPos.value = draft.subtitlePosition;
    slAnchorU.value = String(Math.round(draft.subtitleAnchorU * 100));
    slAnchorV.value = String(Math.round(draft.subtitleAnchorV * 100));
    anchorWrap.style.display =
      draft.subtitlePosition === 'custom' ? 'block' : 'none';
    cbMuteAll.checked = draft.muteAll;
    // 总闸打开 ⇒ 下面两项置灰（值仍保留，只是被压住）
    [cbBgm, cbVoice].forEach((t) => {
      t.el.style.opacity = draft.muteAll ? '0.45' : '1';
      t.el.style.pointerEvents = draft.muteAll ? 'none' : 'auto';
    });
    cbVoice.checked = draft.voiceEnabled;
    selFitAspect.value = draft.fitAspect;
    /**
     * ★ 轿厢角度现在挂在「壁纸独立设置」页（2026-10-11）—— 本壁纸没声明该项时
     *   控件压根没建（`selCabin === null`）⇒ 必须判空。
     *   ⚠️ `draft.cabinMode` 不判空、照常带着走（见 `btnSave`）：面板里没有这一项
     *   不等于要把用户的覆盖层**抹掉**（他可能是在上一版里设过的）。
     */
    if (selCabin) {
      selCabin.value = draft.cabinMode;
    }
    cbTrail.checked = draft.pointerTrailEnabled;
    cbSeq.checked = draft.idleSequenceEnabled;
    gapSlider.value = String(
      Math.min(100, Math.round(draft.idleSequenceGapMs / GAP_MS_STEP))
    );
    paintGapValue();
    standbySlider.value = String(secToSlider(draft.standbyIdleSec));
    paintStandbyValue();
    // ★ 三个通道各重画一次（勾选态来自 draft，不是 view）
    standbyChips.paint();
    touchChips.paint();
    resumeChips.paint();
    // ★ 事件族 chips（全局闸门）；注册表为空时该行没建 ⇒ 跳过
    if (phaseChips) {
      phaseChips.paint();
    }
    // ★ 动作族单选（2026-10-17）：没有动作族的工程该行没建 ⇒ 判空
    if (selActionPhase) {
      selActionPhase.value = draft.actionPhase;
    }
    cbTouchFullscreen.checked = draft.touchFullscreen;
    selTouchFeedback.value = draft.touchFeedbackMode;
    selGreetMode.value = draft.greetMode;
    seqBody.style.opacity = draft.idleSequenceEnabled ? '1' : '0.45';
    seqBody.style.pointerEvents = draft.idleSequenceEnabled ? 'auto' : 'none';
    cbProbe.checked = draft.probeEnabled;
    cbHud.checked = draft.probeHud;
    cbCross.checked = draft.probeCrosshair;
    cbZones.checked = draft.probeZones;
    renderChips();
    // 内容可能变高/变矮（锚点块、序列区）⇒ 重算自适应缩放
    relayoutPanel();
  };

  /**
   * 刷新入口列与两个面板的显隐/高亮。**所有状态变化都只走这一处**。
   *
   * ## 显隐口径（2026-10-17 晚口径变更后）
   *
   * | 元素 | 显示条件 |
   * |---|---|
   * | 入口列容器 | `cornerVisible`（WE `showCornerButtons` =「显示右上角按钮」） |
   * | 折叠按钮 | 跟着容器（容器没了它也没意义） |
   * | 设置/静音/调试/免责/档案（5 个） | 容器 && **未收起** |
   * | 设置面板 | `cornerVisible && open` |
   * | 调试面板 | `cornerVisible && debugOpen` |
   *
   * ★ 5 个入口**条件完全一致**：`showSettings` 删除后齿轮不再有单独开关
   *   （用户 2026-10-17 晚拍板撤回"分治"，改回"一个开关管整列"）。
   * ★ 为什么两个面板都要带 `cornerVisible`：整列被 WE 关掉后按钮就点不到了，
   *   面板若还留在屏幕上，**设置面板连关都关不掉**（它没有自己的关闭按钮）。
   */
  const applyVisibility = () => {
    corner.style.display = cornerVisible ? 'flex' : 'none';
    const entries = cornerVisible && !collapsed;
    gear.style.display = entries ? 'flex' : 'none';
    muteBtn.style.display = entries ? 'flex' : 'none';
    debugBtn.style.display = entries ? 'flex' : 'none';
    disclaimerBtn.style.display = entries ? 'flex' : 'none';
    archiveBtn.style.display = entries ? 'flex' : 'none';
    // 「开/关某个面板」的四个入口在对应面板可见时高亮，一眼看出当前状态
    setEntryActive(gear, open);
    setEntryActive(debugBtn, debugOpen);
    setEntryActive(disclaimerBtn, disclaimerVisible);
    setEntryActive(archiveBtn, archiveVisible);
    // ★ 'flex'（不是 'block'）：面板是 flex column（header/tabBar/tabBody/foot）
    panel.style.display = cornerVisible && open ? 'flex' : 'none';
    debugPanel.style.display = cornerVisible && debugOpen ? 'block' : 'none';
    // 展开/收起后面板尺寸变了 ⇒ 重新自适应 + 对齐兜底滚动条
    relayoutPanel();
  };

  /**
   * 收起 / 展开入口列。
   *
   * ★★ 收起时**必须把两个面板一起关掉**：设置面板没有自己的关闭按钮
   *   （开关都靠齿轮），齿轮一藏，面板就永远留在屏幕上出不去。
   *   调试面板虽有自己的「关闭」，但一起关掉行为更一致（"收起 = 桌面清空"）。
   */
  const setCollapsed = (v: boolean) => {
    collapsed = v;
    if (collapsed) {
      if (open) {
        open = false;
        if (options.onOpenChange) {
          options.onOpenChange(false);
        }
      }
      if (debugOpen) {
        debugOpen = false;
        if (options.onDebugOpenChange) {
          options.onDebugOpenChange(false);
        }
      }
    }
    renderToggleBtn();
    applyVisibility();
    if (options.onCornerCollapsedChange) {
      options.onCornerCollapsedChange(collapsed);
    }
  };

  cbMuteAll.addEventListener('change', () => {
    draft.muteAll = cbMuteAll.checked;
    syncFromDraft();
  });
  cbBgm.addEventListener('change', () => {
    draft.bgmEnabled = cbBgm.checked;
  });
  vol.addEventListener('input', () => {
    const v = Number(vol.value);
    draft.bgmVolume = Math.min(1, Math.max(0, v / 100));
    volValue.textContent = Math.round(draft.bgmVolume * 100) + '%';
  });
  volVoice.addEventListener('input', () => {
    const v = Number(volVoice.value);
    draft.voiceVolume = Math.min(1, Math.max(0, v / 100));
    voiceVolValue.textContent = Math.round(draft.voiceVolume * 100) + '%';
  });
  cbSubtitle.addEventListener('change', () => {
    draft.subtitleEnabled = cbSubtitle.checked;
  });
  selPos.addEventListener('change', () => {
    const v = selPos.value as SettingsView['subtitlePosition'];
    if (v === 'game' || v === 'bottom' || v === 'custom') {
      draft.subtitlePosition = v;
    }
    anchorWrap.style.display =
      draft.subtitlePosition === 'custom' ? 'block' : 'none';
    // 「自由定位」会多出两根滑块（+133 设计px）⇒ 立刻重算自适应缩放
    relayoutPanel();
  });
  slAnchorU.addEventListener('input', () => {
    draft.subtitleAnchorU = Number(slAnchorU.value) / 100;
  });
  slAnchorV.addEventListener('input', () => {
    draft.subtitleAnchorV = Number(slAnchorV.value) / 100;
  });
  cbVoice.addEventListener('change', () => {
    draft.voiceEnabled = cbVoice.checked;
  });
  selFitAspect.addEventListener('change', () => {
    const v = selFitAspect.value as SettingsView['fitAspect'];
    if (v === 'height' || v === 'width') {
      draft.fitAspect = v;
    }
  });
  /**
   * 摩天轮轿厢角度（「壁纸独立设置」页）—— 只有**声明了该项的壁纸**才建得出这个控件
   * （`selCabin === null` 时整段跳过；白名单校验与其它分段控件同一口径）。
   */
  if (selCabin) {
    const sc = selCabin;
    sc.addEventListener('change', () => {
      const v = sc.value as SettingsView['cabinMode'];
      if (v === 'gravity' || v === 'game') {
        draft.cabinMode = v;
      }
    });
  }
  cbSeq.addEventListener('change', () => {
    draft.idleSequenceEnabled = cbSeq.checked;
    syncFromDraft();
  });
  /* 指针拖尾开关 —— 保存后重载生效 */
  cbTrail.addEventListener('change', () => {
    draft.pointerTrailEnabled = cbTrail.checked;
  });

  /* 触摸热区是否改为全屏（「事件触发」页）—— 保存后重载生效（热区表开机一次性构造） */
  cbTouchFullscreen.addEventListener('change', () => {
    draft.touchFullscreen = cbTouchFullscreen.checked;
  });

  const onGapChange = () => {
    const n = Number(gapSlider.value);
    draft.idleSequenceGapMs =
      isFinite(n) && n >= 0 ? Math.round(n) * GAP_MS_STEP : 0;
    paintGapValue();
  };
  gapSlider.addEventListener('input', onGapChange);
  // ★ 同时认 'change'：自绘滑块只发 'input'，但外部（含验证脚本）习惯按原生 input 发 change
  gapSlider.addEventListener('change', onGapChange);

  /* 待机触发聊天的延迟：秒 → draft，实时刷新右侧读数 */
  const onStandbyChange = () => {
    const n = Number(standbySlider.value);
    draft.standbyIdleSec = isFinite(n) ? sliderToSec(n) : 25;
    paintStandbyValue();
  };
  standbySlider.addEventListener('input', onStandbyChange);
  standbySlider.addEventListener('change', onStandbyChange);

  /* 待机可触发的事件（chips 多选；三类都不勾 ⇒ 待机不自动播）——点击处理在 chips 自身里 */

  /* 播放动作时点击怎么处理 / 问候取哪一条 —— 两个白名单校验后可写回 draft */
  selTouchFeedback.addEventListener('change', () => {
    const v = selTouchFeedback.value as SettingsView['touchFeedbackMode'];
    if (v === 'legacy' || v === 'immediate' || v === 'queue' || v === 'none') {
      draft.touchFeedbackMode = v;
    }
  });
  selGreetMode.addEventListener('change', () => {
    const v = selGreetMode.value as SettingsView['greetMode'];
    if (v === 'time' || v === 'random') {
      draft.greetMode = v;
    }
  });

  /* 调试（探针）四个开关 —— 保存后重载生效 */
  cbProbe.addEventListener('change', () => {
    draft.probeEnabled = cbProbe.checked;
  });
  cbHud.addEventListener('change', () => {
    draft.probeHud = cbHud.checked;
  });
  cbCross.addEventListener('change', () => {
    draft.probeCrosshair = cbCross.checked;
  });
  cbZones.addEventListener('change', () => {
    draft.probeZones = cbZones.checked;
  });

  /**
   * 展开/收起调试面板（**与设置面板互斥**：开一个必关另一个）。
   *
   * 为什么必须互斥：两个面板各持一份 `draft`，同时开着时一边保存会把另一边
   * **尚未保存**的草稿一起带进覆盖层 ⇒ 用户看到"我没改这项它却变了"。
   */
  const setDebugOpen = (v: boolean) => {
    debugOpen = v;
    if (debugOpen && open) {
      open = false;
      if (options.onOpenChange) {
        options.onOpenChange(false);
      }
    }
    applyVisibility();
    if (options.onDebugOpenChange) {
      options.onDebugOpenChange(debugOpen);
    }
  };

  gear.addEventListener('click', () => {
    open = !open;
    if (open && debugOpen) {
      debugOpen = false;
      if (options.onDebugOpenChange) {
        options.onDebugOpenChange(false);
      }
    }
    applyVisibility();
    if (options.onOpenChange) {
      options.onOpenChange(open);
    }
  });
  debugBtn.addEventListener('click', () => setDebugOpen(!debugOpen));
  btnDebugClose.addEventListener('click', () => setDebugOpen(false));

  /* ── 入口列：收起/展开、静音、免责声明、档案 ────────────────── */
  toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));

  /**
   * 「静音」入口：**纯运行时**切换（不写配置、不重载）。
   *
   * ★★ 为什么不落盘（用户 2026-10-17 拍板）：WE 属性里的 `muteAll` 走的是
   *   "改配置 → 重载页面"，点一下桌面就黑一秒；而这个按钮的诉求是
   *   **"我现在要让壁纸闭嘴"**这个临时动作 ⇒ 由调用方把手头两路音频的音量压到 0、
   *   再点还原，重载后回到 WE 属性/配置的值。
   * ★ 状态真值在调用方（它才知道音量），面板只拿 `onToggleMute()` 的返回值刷图标 ——
   *   面板若自己 `muted = !muted` 就是第二份真值，迟早和实际音量不符。
   */
  muteBtn.addEventListener('click', () => {
    const next = options.onToggleMute ? options.onToggleMute() : !muted;
    muted = next === true;
    renderMuteBtn();
  });

  /**
   * 「免责声明」入口：切换居中的免责弹窗（弹窗本体在 `disclaimer.ts`，
   * 由 `index.ts` 建 ⇒ 面板只发指令并拿回真值刷高亮）。
   *
   * ★ 与 WE 属性 `showDisclaimer` 落到**同一个覆盖层字段** ⇒ 点它等于在属性面板里勾选，
   *   reload 后状态保持；WE 下次下发属性时又会覆盖回来（属性面板是权威，与既有口径一致）。
   */
  disclaimerBtn.addEventListener('click', () => {
    const next = options.onToggleDisclaimer
      ? options.onToggleDisclaimer()
      : !disclaimerVisible;
    disclaimerVisible = next === true;
    applyVisibility();
  });

  /** 「档案」入口：同「免责声明」，对应覆盖层字段 `showArchive` */
  archiveBtn.addEventListener('click', () => {
    const next = options.onToggleArchive
      ? options.onToggleArchive()
      : !archiveVisible;
    archiveVisible = next === true;
    applyVisibility();
  });
  /**
   * 调试面板的保存：**只下发这 4 个键**（合并写 ⇒ 不会动别的设置）。
   *
   * ★ 与设置面板的 `btnSave` 完全对称：那边的保存**不带**这 4 个键（见下），
   *   两边各写各的，谁也不会覆盖谁。
   */
  btnDebugSave.addEventListener('click', () => {
    options.onSave({
      probeEnabled: draft.probeEnabled,
      probeHud: draft.probeHud,
      probeCrosshair: draft.probeCrosshair,
      probeZones: draft.probeZones,
      // ★ 保存即重载 ⇒ 顺手记下"面板还开着"，重载后不用再点一次
      debugPanelOpen: true,
    });
  });

  btnSave.addEventListener('click', () => {
    /**
     * ★ 事件开关与设置项**同一次保存**（2026-10-19）。
     *
     * ⚠️ 必须在 `onSave` 之前落盘：`onSave` 的调用方会**立刻重载页面**
     *   （`window.location.reload()`），晚一步写就等于"点了保存，开关又回去了"。
     */
    if (options.onSaveEventState) {
      options.onSaveEventState(evState);
    }
    options.onSave({
      muteAll: draft.muteAll,
      bgmEnabled: draft.bgmEnabled,
      bgmVolume: draft.bgmVolume,
      subtitleEnabled: draft.subtitleEnabled,
      subtitlePosition: draft.subtitlePosition,
      subtitleAnchorU: draft.subtitleAnchorU,
      subtitleAnchorV: draft.subtitleAnchorV,
      voiceEnabled: draft.voiceEnabled,
      voiceVolume: draft.voiceVolume,
      fitAspect: draft.fitAspect,
      cabinMode: draft.cabinMode,
      pointerTrailEnabled: draft.pointerTrailEnabled,
      idleSequenceEnabled: draft.idleSequenceEnabled,
      idleSequenceItems: draft.idleSequenceItems.slice(),
      idleSequenceGapMs: draft.idleSequenceGapMs,
      standbyIdleSec: draft.standbyIdleSec,
      standbyKinds: draft.standbyKinds.slice(),
      touchKinds: draft.touchKinds.slice(),
      phases: draft.phases.slice(),
      /** ★ 动作族是标量（单选）；`''` = 誓约前/不换名，是合法值 */
      actionPhase: draft.actionPhase,
      resumeKinds: draft.resumeKinds.slice(),
      touchFeedbackMode: draft.touchFeedbackMode,
      greetMode: draft.greetMode,
      /**
       * ★ 4 个调试开关**故意不带**（2026-10-15）：它们已归入口列里的调试面板管，
       *   那边保存时只下发这 4 个键 ⇒ 两边各写各的、互不覆盖。
       *   （`writeOverrides` 是合并写 ⇒ 这里不带 = 覆盖层里的调试值原样保留。）
       */
      touchFullscreen: draft.touchFullscreen,
      panelOpen: open,
    });
  });
  btnReset.addEventListener('click', () => {
    options.onReset();
  });

  /**
   * ★ 必须 slice：`{...view}` 只浅拷，数组仍是同一份 ⇒ 面板里改会串到生效值上
   *   （三个通道的 `*Kinds` 与 `idleSequenceItems` 同理）。
   */
  draft = {
    ...view,
    idleSequenceItems: view.idleSequenceItems.slice(),
    standbyKinds: view.standbyKinds.slice(),
    touchKinds: view.touchKinds.slice(),
    phases: view.phases.slice(),
    resumeKinds: view.resumeKinds.slice(),
  };
  syncFromDraft();
  applyVisibility();
  // ★ 初始化 tab 选中态（同时触发一次自适应缩放）
  setTab(activeTab);
  document.body.appendChild(root);
  // ★ `corner` 是 `root` 的子元素（右上角绝对定位），随 root 一起进退 ⇒ 不用单独挂

  return {
    setCornerVisible: (v: boolean) => {
      cornerVisible = v !== false;
      applyVisibility();
    },
    isCornerVisible: () => cornerVisible,
    isCornerCollapsed: () => collapsed,
    setDisclaimerVisible: (v: boolean) => {
      disclaimerVisible = v === true;
      applyVisibility();
    },
    setArchiveVisible: (v: boolean) => {
      archiveVisible = v === true;
      applyVisibility();
    },
    isOpen: () => open,
    refresh: (next: SettingsView) => {
      draft = {
        ...next,
        idleSequenceItems: next.idleSequenceItems.slice(),
        standbyKinds: next.standbyKinds.slice(),
        touchKinds: next.touchKinds.slice(),
        phases: next.phases.slice(),
        resumeKinds: next.resumeKinds.slice(),
      };
      syncFromDraft();
    },
    dispose: () => {
      sbObserver.disconnect();
      window.removeEventListener('resize', onWindowResize, false);
      // `corner` 是 root 的子元素 ⇒ 摘掉 root 就一起没了
      if (root.parentElement) {
        root.parentElement.removeChild(root);
      }
    },
  };
};
