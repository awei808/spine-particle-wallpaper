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
 * 右上角「设置」入口 —— 齿轮按钮 + 展开面板。
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

import { TriggerEventKind } from './config.type';
import { TRIGGER_KIND_ORDER, normalizeTriggerKinds } from './dialogue';
import { SettingsOverrides, SettingsView } from './settingsStore';
import { UI_SCALE_VAR, fpx, getUiScale, initUiScale, uiPx } from './uiScale';

export type SettingsPanelOptions = {
  /** 骨架里可用的动画名（用于序列的候选按钮） */
  animations: string[];
  /** 当前生效值 */
  view: SettingsView;
  /** 齿轮按钮是否显示（对应 WE 属性 `showSettings`） */
  visible: boolean;
  /** 面板是否初始展开 */
  open?: boolean;
  /** 保存 ⇒ 由调用方落盘并重载 */
  onSave: (patch: SettingsOverrides) => void;
  /** 恢复默认 ⇒ 由调用方清覆盖层并重载 */
  onReset: () => void;
  /** 面板展开/收起变化时回调（用于把 `panelOpen` 也持久化） */
  onOpenChange?: (open: boolean) => void;
};

export type SettingsPanel = {
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  isOpen: () => boolean;
  /** 外部把 Séance 值改了之后刷新 UI（WE 属性下发时用） */
  refresh: (view: SettingsView) => void;
  dispose: () => void;
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

  /* ── 齿轮按钮 ─────────────────────────────── */
  const gear = createEl(
    'button',
    [
      'pointer-events:auto',
      'position:absolute',
      'top:' + uiPx(14),
      'right:' + uiPx(14),
      'width:' + uiPx(38),
      'height:' + uiPx(38),
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

  const TABS: ReadonlyArray<{ id: string; label: string }> = [
    // ★ 标签 2026-09-30 由「背景音乐」改为「音乐」—— 本页现在同时管 BGM 与角色语音两条音量
    //   （`id` 仍是 `bgm`：改 id 会让验证脚本/存档里的锚点全部失效，没有收益）
    { id: 'bgm', label: '音乐' },
    { id: 'subtitle', label: '字幕气泡' },
    { id: 'sequence', label: '动作' },
    { id: 'view', label: '画面调整' },
    { id: 'debug', label: '调试' },
  ];
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

  /* ── tab 3：动作 ────────────────────────── */
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
   * 造一组「可触发的事件」chips。三个通道共用本函数 ⇒ **选项、顺序、配色、交互天然一致**
   * （这是"选项与长时间待机那项一致"这句话的落点，不是复制三遍代码）。
   *
   * @param ids 每个类别的 **DOM 锚点**（**写全字面量**：验证脚本按 id 找元素；拼出来的
   *   `'wb-set-standby-' + kind` 会被 terser 折成运行期拼接、产物里查不到字面量 ⇒ 锚点形同虚设）
   * @param get 读当前勾选（一般是 `draft.xxxKinds`）
   * @param set 把**归一后**的结果写回（归一用 `dialogue.normalizeTriggerKinds`，
   *   面板自己不排序也不去重）
   */
  const createKindChips = (
    ids: Record<TriggerEventKind, string>,
    get: () => TriggerEventKind[],
    set: (next: TriggerEventKind[]) => void
  ): { el: HTMLElement; paint: () => void } => {
    const box = createEl(
      'div',
      'display:flex;flex-wrap:wrap;gap:' + uiPx(6) + ';pointer-events:auto'
    );
    const paint = () => {
      box.innerHTML = '';
      TRIGGER_KIND_ORDER.forEach((kind) => {
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
        chip.textContent = KIND_LABEL[kind];
        chip.addEventListener('click', () => {
          const next = get().slice();
          const at = next.indexOf(kind);
          if (at >= 0) {
            next.splice(at, 1);
          } else {
            next.push(kind);
          }
          set(normalizeTriggerKinds(next));
          paint();
        });
      });
    };
    paint();
    return { el: box, paint };
  };

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
    '空闲超过上面的时长后，从「勾中的类别」的候选池里随机取一条（含动作、字幕与语音）。' +
      '勾了多类就**并成一个大池**一起随机。「chat类」= 闲聊池（缺省就勾着，与改动前"配了 standby 就一定会播"一致）；' +
      '「greet类」在只勾它时按「问候取条方式」那一项取条；「touch类」与点击是同一个池。' +
      '三类都不勾 = 待机不自动播。保存后重载生效。',
    pages.sequence,
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
    '点中角色热区时，从「勾中的类别」的候选池里随机取一条。' +
      '缺省只勾「touch类」= 只从 config 的 touch 列表里随机（与旧版一致）；' +
      '勾上「greet类」就会把问候池一起并进来（= 旧版「touch触发greet事件」开关打开的效果）；' +
      '「chat类」是新增能力：点一下也可能随机到闲聊那几条。保存后重载生效。',
    pages.sequence,
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
    '壁纸载入后、回到桌面、切回窗口、以及离开其他应用超过 15 秒再回来时，' +
      '从「勾中的类别」的候选池里随机取一条。缺省只勾「greet类」= 仍按「问候取条方式」取一条问候；' +
      '勾上其它两类就是"回来时也可能说句闲聊 / 演个触摸动作"。保存后重载生效。',
    pages.sequence,
    true
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
    '已经有动作在演的时候再点一下：「仅问候/聊天时立即」= 正在演问候或闲聊时点击会立刻改播新的，' +
      '正在演触摸动作时点击**不响应**（默认，= 旧版行为，最不打扰演出）；' +
      '「立即播放新动作」= 不管在演什么都打断并立刻播新的（最跟手，但上一条会被掐断）；' +
      '「排进播放队列」= 等当前这条演完自动接上（动作完整，代价是响应延迟 = 当前动作的剩余时长）；' +
      '「不做任何反馈」= 演的过程中点击一律无效。四档都不影响空闲时的点击。保存后重载生效。',
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
    '开机、回到桌面、回到前台、离开其他应用超过 15 秒回来，以及待机到点，都会触发一次问候。' +
      '这里决定**从 greet 列表里取哪一条**：「按系统时间」= 清晨/中午/傍晚各取对应那条；' +
      '「随机」= 不看时间，整个列表随机。列表本身在 config.json 的 subtitle.greet 里，用户可以直接增删。' +
      '保存后重载生效。',
    pages.sequence,
    true
  );

  /* ── tab 4：画面调整 ───────────────────────── */
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
    '决定画面按哪一边对齐：' +
      '「按画幅高」= 上下范围恒定、与游戏内取景一致，屏幕越窄左右裁得越多、越宽左右露得越多；' +
      '「按画幅宽」= 左右范围恒定、任何屏幕比例都不裁掉两侧内容，但整体比游戏画面小一些' +
      '（16:9 下约为按高对齐的 78%）。两种只在屏幕比例≠设计画幅比例时有差别。' +
      '保存后重载生效。',
    pages.view,
    true
  );

  /**
   * 摩天轮轿厢姿态角（二选一）。
   *
   * ★★ 为什么会有两个选项（取证见 09 文档 `04_渲染差异记录.md` §D1）：
   * 解包数据里轿厢 `startRotation` = **−15°**（美术按画面重力画），
   * 而**游戏实录**轿厢长轴 **−0.03°**（被强制对齐画布）⇒ 两边差约 15°，
   * 是游戏渲染侧行为造成的，**不是素材错**。只能交给用户选要哪一种。
   *
   * ★ 标签**不写英文配置名**（面板口径），但要点明角度与观感差异。
   */
  const selCabin = createSegmented(
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
    pages.view,
    true
  );

  /**
   * 指针（鼠标）拖尾粒子总开关。
   *
   * ★ 复刻的是游戏里"按住滑动 ⇒ 一串蓝色粒子连成轨迹"那个效果
   *   （`FX_UI_CommonUI_Click` 的 `/5`、`/5/6`，解包与实现见 09 文档 18 / 19）。
   * ★ 生效方式 = **保存后重载**：发射器与几何缓冲是开机一次性构造的。
   */
  const cbTrail = createToggle(
    'wb-set-pointertrail',
    '开启鼠标粒子拖尾效果',
    '指针在桌面移动时沿轨迹留下等距发光粒子；粒子随寿命收缩到消失'
  );

  /* ── tab 5：调试（探针） ───────────────────── */
  rowTarget = pages.debug;
  const dbgTip = createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.55;margin-bottom:' +
      uiPx(6) +
      ';line-height:1.5',
    pages.debug
  );
  dbgTip.textContent = '这些是诊断开关，改完点「保存并应用」重载生效。';
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
    selCabin.value = draft.cabinMode;
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
    // ★ 'flex'（不是 'block'）：面板是 flex column（header/tabBar/tabBody/foot）
    panel.style.display = visible && open ? 'flex' : 'none';
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
  selCabin.addEventListener('change', () => {
    const v = selCabin.value as SettingsView['cabinMode'];
    if (v === 'gravity' || v === 'game') {
      draft.cabinMode = v;
    }
  });
  cbSeq.addEventListener('change', () => {
    draft.idleSequenceEnabled = cbSeq.checked;
    syncFromDraft();
  });
  /* 指针拖尾开关 —— 保存后重载生效 */
  cbTrail.addEventListener('change', () => {
    draft.pointerTrailEnabled = cbTrail.checked;
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

  gear.addEventListener('click', () => {
    open = !open;
    applyVisibility();
    if (options.onOpenChange) {
      options.onOpenChange(open);
    }
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
      resumeKinds: draft.resumeKinds.slice(),
      touchFeedbackMode: draft.touchFeedbackMode,
      greetMode: draft.greetMode,
      probeEnabled: draft.probeEnabled,
      probeHud: draft.probeHud,
      probeCrosshair: draft.probeCrosshair,
      probeZones: draft.probeZones,
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
