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
 * 右上角两个入口 —— **设置**（齿轮按钮 + 展开面板）与**调试**（齿轮**下方**的按钮 + 小面板）。
 *
 * ## ★★ 调试为什么从设置面板里独立出来（用户 2026-10-15 拍板）
 *
 * 原先「调试」是设置面板里的**第 6 个分页**（总开关 / HUD / 红圈 / 热区框 4 项）。
 * 它跟其余 6 页不是一类东西：那些是**观赏设置**（调完就不管了），
 * 而调试是**诊断工具**（排查时反复开关、每次改完都要重载）。
 * ⇒ 塞在同一面板里 ⇒ 每次排查都要"开面板 → 翻到调试页 → 改 → 保存"四步。
 *
 * 改法：调试页整个撤掉，改成**齿轮正下方**的一个入口按钮 + 一个常驻小面板，
 * 一步点到、改完就地保存。两者**互斥展开**（见 `setDebugOpen`）。
 *
 * ⚠️ 只是**搬了入口**，字段没变：4 个开关仍落在 `probeEnabled / probeHud /
 * probeCrosshair / probeZones`，存盘格式与 WE 属性面板的「调试总开关」
 * （`debugEnabled` → `probeEnabled`）**完全兼容**，老存档零影响。
 *
 * ## ★★ 必须 `stopPropagation` 的理由（不做的话会发生什么）
 *
 * `touch.ts` 把 mousedown 监听挂在 **`document`** 上，而本工程的热区是
 * **整屏一个区**（`touch.zones` 覆盖全画面）。⇒ 点齿轮/面板会被判定成
 * "点了角色"，触摸动画照播、字幕照弹。这类"顺带触发"很容易被当成 WE 的玄学 bug。
 *
 * 而且 `SpineAnimator` 也在 `document` 上挂了 mousedown（带 `preventDefault()`），
 * 不拦的话连 focus 都可能被吃掉 ⇒ 复选框点不动。
 *
 * ⇒ 在**面板根节点**上对鼠标/触摸事件 `stopPropagation`，让事件到不了 `document`。
 *    （监听器都在冒泡阶段，目标阶段的 stopPropagation 正好能挡住。）
 *
 * ## z-index 口径
 *
 * 气泡 `2147483640` < 热区调试框 `2147483645` < **本面板 `2147483647`**。
 * 设置必须盖在所有东西之上，否则被气泡挡住就点不到了。
 *
 * ## DOM 锚点
 *
 * 每个元素都带 `id`（`wb-settings-*`）并用 **`data-wb-set` 属性**而不是下标取元素 ——
 * 改一次结构就让一堆验证脚本同时失效的教训已经有过一次了。
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
 * ⇒ 面板/齿轮一律用**实色半透明背景**代替毛玻璃。气泡模糊不受影响。
 */

import {
  EventFamily,
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
import { SettingsOverrides, SettingsView } from './settingsStore';
import { UI_SCALE_VAR, fpx, getUiScale, initUiScale, uiPx } from './uiScale';

/**
 * 调试面板「触发事件」的一条候选 —— 就是 `config.subtitle.dialogues` 里的一条念白。
 *
 * ★ 只带**显示用**的字段（actionId / 动作名 / 动画名）：面板不解析念白内容，
 *   触发一律交给调用方（它手里才有 `touchController` 与打断闸门）。
 */
export type DebugEventItem = {
  /** 动作表 ID（`CfgSoulSpineActionTable.Id`）—— **触发的唯一凭据** */
  actionId: number;
  /** 官方动作名（仅显示） */
  label?: string;
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
   * ★ 缺省 / 归一后为空 ⇒ 「事件池」页**不建**「事件族（仅点击触摸）」那一行
   *   （与 `wallpaperSettings` 同一口径：没有事件族的皮肤不该多出一个点不动的控件）。
   */
  eventFamilies?: EventFamily[];
  /** 齿轮按钮是否显示（对应 WE 属性 `showSettings`） */
  visible: boolean;
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
  /**
   * 调试面板「触发动作」：播**指定动画名**（不带台词/语音）。
   *
   * @returns 是否真的播了 —— 面板据此回显 ✓ / ×，不猜。
   */
  onPlayAnimation?: (name: string) => boolean;
  /**
   * 调试面板「触发事件」：按 actionId 播**一整条念白**（动作+字幕+语音，走完整闸门）。
   *
   * @returns 是否真的播了（被打断规则挡下 = `false`）
   */
  onTriggerEvent?: (actionId: number) => boolean;
};

export type SettingsPanel = {
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
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

const FONT =
  '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';

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
  let visible = options.visible !== false;

  // ★ 先初始化 UI 缩放变量（幂等）：下面所有 px 都依赖它
  initUiScale();

  const root = createEl(
    'div',
    [
      'position:fixed',
      'top:0',
      'right:0',
      'z-index:2147483647',
      // 根节点不吃事件，只有齿轮与面板本体吃
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

  /* ── 右上角按钮列的几何（齿轮在上、调试在它**正下方**）─────────
   *
   * ★ root 是 `position:fixed;top:0;right:0` 的零尺寸盒 ⇒ 绝对定位子元素的原点
   *   就是**视口右上角**，所以这里的 top/right 直接就是"距视口上/右缘"的距离。
   */
  const CORNER_BTN = 38;
  const CORNER_TOP = 14;
  const CORNER_GAP = 10;

  /* ── 齿轮按钮 ─────────────────────────────── */
  const gear = createEl(
    'button',
    [
      'pointer-events:auto',
      'position:absolute',
      'top:' + uiPx(CORNER_TOP),
      'right:' + uiPx(CORNER_TOP),
      'width:' + uiPx(CORNER_BTN),
      'height:' + uiPx(CORNER_BTN),
      'padding:0',
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.28)',
      'border-radius:50%',
      'background:rgba(20,22,30,0.82)',
      'color:#fff',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      // ★ 不用 backdrop-filter —— WE CEF 上会崩渲染进程，见文件头注释
      'transition:background .18s ease,transform .18s ease',
    ].join(';'),
    root
  );
  gear.id = 'wb-settings-gear';
  gear.title = '壁纸设置';
  gear.setAttribute('aria-label', '壁纸设置');
  // 内联 SVG 齿轮：不依赖字体里的 glyph，避免 CEF 里显示成豆腐块
  // ★ 图标跟着按钮缩放：style 里的 calc 会覆盖上面的 width/height 属性
  gear.innerHTML =
    '<svg width="19" height="19" style="width:' +
    uiPx(19) +
    ';height:' +
    uiPx(19) +
    '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M19.4 15a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83' +
    'l-.06-.06a1.6 1.6 0 0 0-1.77-.33 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 ' +
    '0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.77.33l-.06.06a2 2 0 1 ' +
    '1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 ' +
    '0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 ' +
    '0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6h.07A1.6 1.6 0 0 0 10 3.13V3a2 ' +
    '2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 ' +
    '0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.07a1.6 1.6 0 0 0 1.47 ' +
    '1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.47 1z"/></svg>';

  /* ── 调试入口按钮（齿轮**正下方**）─────────────────────────────
   *
   * ★ 几何：与齿轮同列、紧跟其下（`CORNER_TOP + CORNER_BTN + CORNER_GAP`）。
   * ★ 图标 = bug（诊断），同样内联 SVG + 跟着 `uiPx` 缩放，理由同齿轮。
   * ★ 显隐跟随 `visible`（= WE 属性 `showSettings`）：它是"桌面 UI"的一员，
   *   用户把设置按钮藏起来时不该再多出一个按钮。
   */
  const debugBtn = createEl(
    'button',
    [
      'pointer-events:auto',
      'position:absolute',
      'top:' + uiPx(CORNER_TOP + CORNER_BTN + CORNER_GAP),
      'right:' + uiPx(CORNER_TOP),
      'width:' + uiPx(CORNER_BTN),
      'height:' + uiPx(CORNER_BTN),
      'padding:0',
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.28)',
      'border-radius:50%',
      'background:rgba(20,22,30,0.82)',
      'color:#fff',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      // ★ 不用 backdrop-filter —— WE CEF 上会崩渲染进程，见文件头注释
      'transition:background .18s ease,transform .18s ease',
    ].join(';'),
    root
  );
  debugBtn.id = 'wb-debug-btn';
  debugBtn.title = '调试';
  debugBtn.setAttribute('aria-label', '调试');
  debugBtn.innerHTML =
    '<svg width="19" height="19" style="width:' +
    uiPx(19) +
    ';height:' +
    uiPx(19) +
    '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" ' +
    'stroke-linejoin="round">' +
    // 虫身 + 头
    '<rect x="6.5" y="7.5" width="11" height="12" rx="5.5"/>' +
    '<path d="M9.5 7.5 8 5.2M14.5 7.5 16 5.2"/>' +
    // 六条腿
    '<path d="M4 11h2.5M17.5 11H20M4 16h2.5M17.5 16H20M6.5 19.5 5 21.5M17.5 19.5 19 21.5"/>' +
    '</svg>';

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
      'display:' + (visible && open ? 'flex' : 'none'),
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
    { id: 'view', label: '画面调整' },
    // ★ 这里**没有**「调试」页了：2026-10-15 起调试独立成齿轮下方的入口
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
    const show = visible && open && over > 1;
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
    if (!visible || !open) {
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
   * @param get 读当前勾选（一般是 `draft.xxxKinds` / `draft.touchPhases`）
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
   *   （见下面「事件族（仅点击触摸）」）。
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
   * ★★ **事件族 —— 点击触摸的第二层筛子**（2026-10-10 新增；2026-10-11 挪到本页**最后一行**；
   *   **2026-10-15 改为注册表驱动**）。
   *
   * 它**只作用于点击触摸这一个入口**：
   *   ① 先按本项勾中的**事件族**筛候选；
   *   ② 再在勾中的**类别**里并池随机（`mergeKindPools`）。
   * ⇒ 与上面「触摸可触发的事件」**叠加生效**，互不覆盖。
   *
   * ## ★ 为什么排在本页最后（用户 2026-10-11 拍板）
   *
   * 上面三行是**三个入口**（待机 / 触摸 / 回到壁纸）**同构**的"可抽到哪些类别"，
   * 是一组平级的项目；而本项是**挂在其中一个入口上的第二层筛子**，不是第四个入口。
   * 夹在中间会让"三个入口"这组读起来断成两截（还会被迫带一个 `└` 前缀去指向上面的行，
   * 而它本来就不是那个入口的子行）⇒ 收在本页末尾，与前一组**分开**。
   * ⚠️ 标签里因此**不带 `└` 前缀**（2026-10-11 用户拍板），措辞「（仅点击触摸）」
   *   已经把作用域交代清楚了。
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
      () => draft.touchPhases,
      (v) => {
        draft.touchPhases = v;
      },
      fams.ids,
      phaseLabels,
      (v) => normalizeTriggerPhases(v, fams)
    );
    addRow(
      '事件族（仅点击触摸）',
      phaseChips.el,
      '在勾中的类别里再按事件族筛一层，两层叠加生效；选项与本项目的事件族一致' +
        '（缺省勾选见 config 的 eventFamilies）。',
      pages.touch,
      true
    );
  }

  /* ── tab 5：画面调整 ───────────────────────── */
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

  /* ── 调试面板（**独立**小面板，入口 = 齿轮下方那个按钮）──────────────
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
      // 挂在调试按钮**下方**（与齿轮同一列）
      'top:' + uiPx(CORNER_TOP + (CORNER_BTN + CORNER_GAP) * 2),
      'right:' + uiPx(CORNER_TOP),
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
   * 反馈：点一下瞬时把方块染绿/红（✓/✗）600ms 后复原（不写持久态，纯视觉确认）。
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
  ].join(';');

  /** 渲染一组触发 chips（标题 + 说明 + 换行方块）。items 为空 ⇒ 整组不建。 */
  const makeChipGroup = (
    titleText: string,
    tip: string,
    /** chip id 前缀（如 `wb-debug-anim-`）；便于测试与用户定位单个方块 */
    idPrefix: string,
    items: { key: string; text: string; hint?: string }[],
    onClick: (it: { key: string; text: string; hint?: string }) => boolean
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
      chip.id = idPrefix + it.key;
      chip.textContent = it.text;
      if (it.hint) {
        chip.title = it.hint;
      }
      chip.addEventListener('click', () => {
        let ok = false;
        try {
          ok = onClick(it);
        } catch (_e) {
          ok = false;
        }
        chip.style.borderColor = ok ? '#46c46a' : '#e25555';
        chip.style.background = ok
          ? 'rgba(70,196,106,0.22)'
          : 'rgba(226,85,85,0.22)';
        chip.style.color = ok ? '#d6f5de' : '#f7d6d6';
        window.setTimeout(() => {
          chip.style.borderColor = '';
          chip.style.background = '';
          chip.style.color = '';
        }, 600);
      });
    });
  };

  // 动作组：全部骨架动画（只播动画，不带台词/语音；走与点击同路径、不过闸门）
  makeChipGroup(
    '触发动作（仅动画）',
    '点一下直接播该动画，不出台词、不带语音',
    'wb-debug-anim-',
    (options.animations || []).map((n) => ({ key: n, text: n })),
    (it) => (options.onPlayAnimation ? options.onPlayAnimation(it.key) : false)
  );

  // 事件组：全部念白（动作+字幕+语音，走完整闸门）；无念白 ⇒ 整组不建
  if (options.events && options.events.length > 0) {
    makeChipGroup(
      '触发事件（动作+字幕+语音）',
      '点一下按 actionId 播整条念白（含打断闸门）',
      'wb-debug-ev-',
      options.events.map((e) => ({
        key: String(e.actionId),
        text: String(e.actionId),
        hint: [e.label, e.animation ? '动画:' + e.animation : '']
          .filter(Boolean)
          .join(' ｜ '),
      })),
      (it) =>
        options.onTriggerEvent ? options.onTriggerEvent(Number(it.key)) : false
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
   * 渲染"候选动画名" chips。
   *
   * 选中项按**点击顺序**加角标 —— 序列是有序的，单纯的多选表达不了顺序。
   * 再点一次移除（后面的角标自动重排）。
   */
  const renderChips = () => {
    chips.innerHTML = '';
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
    // ★ 触摸页的事件族 chips 同理（2026-10-10）；注册表为空时该行没建 ⇒ 跳过
    if (phaseChips) {
      phaseChips.paint();
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

  const applyVisibility = () => {
    gear.style.display = visible ? 'flex' : 'none';
    debugBtn.style.display = visible ? 'flex' : 'none';
    // ★ 'flex'（不是 'block'）：面板是 flex column（header/tabBar/tabBody/foot）
    panel.style.display = visible && open ? 'flex' : 'none';
    debugPanel.style.display = visible && debugOpen ? 'block' : 'none';
    // 展开/收起后面板尺寸变了 ⇒ 重新自适应 + 对齐兜底滚动条
    relayoutPanel();
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
      touchPhases: draft.touchPhases.slice(),
      resumeKinds: draft.resumeKinds.slice(),
      touchFeedbackMode: draft.touchFeedbackMode,
      greetMode: draft.greetMode,
      /**
       * ★ 4 个调试开关**故意不带**（2026-10-15）：它们已归齿轮下方的调试面板管，
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
    touchPhases: view.touchPhases.slice(),
    resumeKinds: view.resumeKinds.slice(),
  };
  syncFromDraft();
  applyVisibility();
  // ★ 初始化 tab 选中态（同时触发一次自适应缩放）
  setTab(activeTab);
  document.body.appendChild(root);

  return {
    setVisible: (v: boolean) => {
      visible = v !== false;
      applyVisibility();
    },
    isVisible: () => visible,
    isOpen: () => open,
    refresh: (next: SettingsView) => {
      draft = {
        ...next,
        idleSequenceItems: next.idleSequenceItems.slice(),
        standbyKinds: next.standbyKinds.slice(),
        touchKinds: next.touchKinds.slice(),
        touchPhases: next.touchPhases.slice(),
        resumeKinds: next.resumeKinds.slice(),
      };
      syncFromDraft();
    },
    dispose: () => {
      sbObserver.disconnect();
      window.removeEventListener('resize', onWindowResize, false);
      if (root.parentElement) {
        root.parentElement.removeChild(root);
      }
    },
  };
};
