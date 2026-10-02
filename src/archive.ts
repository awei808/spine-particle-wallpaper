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
 * 居中的「档案」面板 —— 以表格列出本壁纸**可能触发的事件（语音 / 动作）与触发条件**。
 *
 * ## 为什么要有它
 *
 * 壁纸的动作与语音不是"点哪里出什么"能一眼看全的：同一个点击热区会从池里**随机**取一条，
 * 问候按时段分三条、还要经过"去重 5 秒 / 恢复需离开 15 秒"这类闸门。
 * 与其让用户靠试，不如把**实际生效的那份配置**摊成一张表。
 *
 * ## ★★ 表格由**运行时 config 现算**，不是写死文案
 *
 * 传进来的 `config` 是**已合并 localStorage 覆盖层**的生效值 ⇒ 用户改了
 * 「待机时长」「touch触发greet事件」之后，表里立刻是改后的数字/池子大小。
 * 池子的构造直接复用运行时同一批纯函数（`dialogue.ts` 的
 * `resolveTouchIds` / `buildPool` / `findByActionId`），**不另写一套判据** ——
 * 否则文档与行为会慢慢漂移（这正是"新增冗余"最容易出事的地方）。
 *
 * ## ★ 显示与否只由 WE 属性 `showArchive` 决定（用户 2026-09-30 拍板）
 *
 * 打开 ⇒ 常驻显示；关掉 ⇒ 消失。**热切换，不重载页面**（同 `disclaimer.ts` /
 * `showSettings` 的口径，见 `index.ts` 的 `applyWePatch`）。
 *
 * ## ★★ 遮罩**不吃事件**（与免责弹窗刻意的差异）
 *
 * `disclaimer.ts` 的遮罩要拦"透过弹窗点到角色"那一下（它是法务性质的告示，
 * 出现时应当接管交互）。档案是**查阅性质的**：用户很可能一边看档案、一边戳角色
 * 对照"这条是不是真会触发"。所以这里：
 *   - `root` / `scrim` 一律 `pointer-events:none`（只压暗，不拦）；
 *   - 只有 `card` 自己 `pointer-events:auto`（卡片区域内不穿透，避免误触）。
 *
 * ## ★★ 不用 `backdrop-filter`（WE CEF 渲染进程 SIGILL，2026-09-25 实锤）
 *
 * 遮罩与卡片一律**实色半透明**。
 *
 * ## ★★ 内容必须一屏装得下（WE 不转发鼠标滚轮）
 *
 * `wheel` 在 WE 里永不触发、原生滚动条也拖不动（详见 `settingsPanel.ts` 文件头）。
 * ⇒ 正文超高时**等比缩小卡片内层**（`fitContent`，与 `fitPanelScale` 同一思路）；
 *   另外补一个"按住拖动滚动"的兜底 + 溢出时才出现的提示。
 *
 * ## z-index 口径
 *
 * 气泡 `2147483640` < **档案 `2147483645`** < 免责弹窗 `2147483646` < 设置面板 `2147483647`。
 * 档案不能盖住设置面板 —— 面板是用户唯一能实时改设置的入口；
 * 也不能盖住免责弹窗（法务声明优先级更高）。
 */

import { Configs, DialogueEntry, DialogueSlotKey } from './config.type';
import {
  DEFAULT_TIME_RANGES,
  SLOT_ORDER,
  buildPool,
  findByActionId,
  hasGreetingSlots,
  resolveStandbyKinds,
  resolveStandbyTouchIds,
  resolveTouchIds,
} from './dialogue';
import { UI_SCALE_VAR, fpx, getUiScale, initUiScale, uiPx } from './uiScale';

export type ArchiveOptions = {
  /** 初始是否显示（WE 属性值 → localStorage 覆盖层，由调用方决定） */
  visible: boolean;
  /**
   * **已合并覆盖层**的运行时配置。
   *
   * ★ 必须是 `applyOverrides(rawConfigs, readOverrides())` 的结果，
   *   不是 `rawConfigs` —— 否则表里显示的是"出厂值"而不是用户当前生效值。
   */
  config: Configs;
};

export type ArchivePanel = {
  /** 热切换显示/隐藏 */
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  /** 表格**数据行**数（不含表头）—— 给验证脚本断言"内容真的渲染出来了" */
  rowCount: () => number;
  dispose: () => void;
};

const FONT =
  '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';

/**
 * 卡片内需要**拦下**的事件。
 *
 * 与 `disclaimer.ts` 的不同：那边挂在全屏 `root` 上（连点空白也拦），
 * 这边只挂在 `card` 上 —— 卡外的点击照常落到角色身上（见文件头）。
 */
const SWALLOW_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'contextmenu',
];

/** 表格列宽（百分比）。顺序 = 事件 / 触发条件 / 动作 / 念白 / 语音 */
const COLS: readonly string[] = ['13%', '23%', '9%', '39%', '16%'];

const SLOT_LABEL: Record<DialogueSlotKey, string> = {
  morning: '上午',
  noon: '下午',
  evening: '晚间',
};

/** 一条表格数据 */
type Row = {
  /** 事件名（如「问候 · 上午」） */
  event: string;
  /** 触发条件 */
  cond: string;
  /** spine 动画名 */
  action: string;
  /** 念白标识（`#64005` + 官方动作名） */
  tag: string;
  /** 念白正文 */
  text: string;
  /** 语音文件名（只取 basename） */
  voice: string;
};

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

/** `5` → `05`。不用 `padStart`（`tsconfig.target = es6`，lib 里没有 ES2017） */
const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n));

const fmtSec = (sec: number): string =>
  sec >= 60 ? Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒';

const hourRangeText = (start: number, end: number): string =>
  start === end
    ? '全天 24 小时'
    : pad2(start) +
      ':00–' +
      pad2(end) +
      ':00' +
      (start > end ? '（跨零点）' : '');

/**
 * 官方动作名取末段：`时装-盛夏游乐场-问候-晴天上午` → `晴天上午`。
 *
 * 面板只讲人话（不显示英文配置名），但动作表里那串前缀对用户没有信息量。
 */
const shortLabel = (label?: string): string => {
  if (!label) {
    return '';
  }
  const parts = label.split('-');
  return (parts[parts.length - 1] || label).trim();
};

/** 语音路径只留文件名（`CV/Asuna/xxx.ogg` → `xxx.ogg`），整条太长会把列撑开 */
const voiceBase = (voice?: string): string => {
  if (!voice) {
    return '—';
  }
  const parts = voice.split('/');
  return parts[parts.length - 1] || voice;
};

const makeRow = (event: string, cond: string, e: DialogueEntry): Row => {
  const short = shortLabel(e.label);
  return {
    event,
    cond,
    action: e.animation,
    tag: '#' + e.actionId + (short ? ' ' + short : ''),
    text: e.text,
    voice: voiceBase(e.voice),
  };
};

/**
 * 按**生效配置**算出事件表。
 *
 * 顺序刻意与"运行时可能发生的先后"无关，而与「触发入口」分组：
 * 问候（自动）→ 待机（自动）→ 点击（交互）→ 常驻序列（若启用）→ BGM（环境）。
 */
const buildRows = (cfg: Configs): Row[] => {
  const sub = cfg.subtitle;
  const dialogues: DialogueEntry[] = sub?.dialogues ?? [];
  const rows: Row[] = [];

  /* ① 时段问候 —— 顺序用 SLOT_ORDER，与运行时"找第一个命中的时段"一致 */
  SLOT_ORDER.forEach((slot) => {
    const id = sub?.greeting?.[slot];
    const e = typeof id === 'number' ? findByActionId(dialogues, id) : null;
    if (!e) {
      return;
    }
    const r = sub?.greetingRanges?.[slot] ?? DEFAULT_TIME_RANGES[slot];
    rows.push(
      makeRow(
        '问候 · ' + SLOT_LABEL[slot],
        hourRangeText(r.start, r.end) + ' ＋ 问候时机',
        e
      )
    );
  });

  /* ② 待机自动触发 —— 到点后从**已启用**的类别里随机挑一条 */
  const standbySec = Math.max(
    0,
    Math.round((sub?.standbyIdleMs ?? 25000) / 1000)
  );
  /**
   * ★ 池与判据都复用**运行时同一套**纯函数（`resolveStandbyTouchIds` + `buildPool` +
   *   `resolveStandbyKinds`），不在这里另写 if —— 否则表与行为会随配置漂移。
   */
  const standbyTouchPool = buildPool(
    dialogues,
    resolveStandbyTouchIds(sub?.standby, sub?.touch)
  );
  const standbyKinds = resolveStandbyKinds(
    sub?.standbyTouchEnabled,
    sub?.standbyGreetEnabled,
    standbyTouchPool.length > 0,
    hasGreetingSlots(sub?.greeting)
  );
  if (standbyKinds.length) {
    const gate = '无操作静置 ' + fmtSec(standbySec);
    const twoWay = standbyKinds.length > 1 ? ' · 随机二选一' : '';
    /* 问候：仅当勾了「待机自动触发greet事件」才占行（3 条按时段，与上面 ① 同一批条目） */
    if (standbyKinds.indexOf('greet') >= 0) {
      SLOT_ORDER.forEach((slot) => {
        const id = sub?.greeting?.[slot];
        const e = typeof id === 'number' ? findByActionId(dialogues, id) : null;
        if (!e) {
          return;
        }
        rows.push(
          makeRow('待机问候 · ' + SLOT_LABEL[slot], gate + twoWay + ' · 按时段', e)
        );
      });
    }
    /**
     * 触摸：**整个池只占 1 行**（64004 那条）。
     *
     * ★ 池里其余条目（`subtitle.touch` 的 6 条）**就是上面 ③「点击触摸」那 6 行** ——
     *   逐条再列一遍会让表里出现两遍同样的念白，行数也会顶穿一屏。
     *   池的构成写在「触发条件」列里，一眼能看出"静置到点会从 7 条里随机"。
     */
    if (
      standbyKinds.indexOf('touch') >= 0 &&
      typeof sub?.standby === 'number'
    ) {
      const e = findByActionId(dialogues, sub.standby);
      if (e) {
        rows.push(
          makeRow(
            '待机闲聊',
            gate +
              twoWay +
              ' · 池内随机 1 条（共 ' +
              standbyTouchPool.length +
              ' 条：休闲待机 + 点击触摸）',
            e
          )
        );
      }
    }
  }

  /* ③ 点击触摸 —— 池子用运行时同一套纯函数现算 */
  const pool = buildPool(
    dialogues,
    resolveTouchIds(sub?.touch, sub?.greeting, sub?.greetInTouchPool)
  );
  const touchCount = (sub?.touch ?? []).length;
  pool.forEach((e, i) => {
    const seat =
      '池 #' +
      (i + 1) +
      '/' +
      pool.length +
      (sub?.greetInTouchPool === true && i >= touchCount ? '（问候并入）' : '');
    rows.push(makeRow('点击触摸 #' + (i + 1), '点击角色热区 · ' + seat, e));
  });

  /* ④ 常驻动作序列（仅启用时列出；否则不占行） */
  const seq = cfg.idleSequence;
  if (seq?.enabled === true && (seq.items ?? []).length) {
    const gapMs = typeof seq.gapMs === 'number' ? seq.gapMs : 0;
    (seq.items ?? []).forEach((it, i) => {
      const actionId = it && typeof it === 'object' ? it.actionId : undefined;
      const anim = it && typeof it === 'object' ? it.animation : (it as string);
      const e =
        typeof actionId === 'number'
          ? findByActionId(dialogues, actionId)
          : null;
      const cond =
        '常驻循环 ' +
        (i + 1) +
        '/' +
        (seq.items ?? []).length +
        ' · 间隔 ' +
        gapMs +
        ' ms';
      if (e) {
        rows.push(makeRow('常驻序列 #' + (i + 1), cond, e));
      } else {
        rows.push({
          event: '常驻序列 #' + (i + 1),
          cond,
          action: anim || '—',
          tag: '—',
          text: '（只播动作，不出台词、不出语音）',
          voice: '—',
        });
      }
    });
  }

  /* ⑤ 背景音乐（环境音，不是"触发"但也应当能查到） */
  if (cfg.bgm?.enabled !== false && cfg.bgm?.file) {
    rows.push({
      event: '背景音乐',
      cond: '壁纸加载后自动播放 · 暂停壁纸即暂停',
      action: '—',
      tag: '循环',
      text:
        '音量 ' +
        Math.round((cfg.bgm.volume ?? 0.5) * 100) +
        '%' +
        (cfg.bgm.loop === false ? '，不循环' : ''),
      voice: cfg.bgm.file,
    });
  }

  return rows;
};

/**
 * 表格下方的「细则」——那些**跨行共享**的闸门，逐行重复写在表格里会淹掉信息。
 */
const buildNotes = (cfg: Configs): string[] => {
  const sub = cfg.subtitle;
  const notes: string[] = [];
  const delaySec = Math.max(
    0,
    Math.round((sub?.greetingDelayMs ?? 3000) / 1000)
  );
  const standbySec = Math.max(
    0,
    Math.round((sub?.standbyIdleMs ?? 25000) / 1000)
  );
  /**
   * ★ 与 `buildRows` 用**同一个**判据函数（`dialogue.resolveStandbyKinds`）现算，
   *   不在这里另写一套 if —— 否则表格与细则会随配置漂移。
   * ⚠️ `buildNotes` 里没有 `dialogues` 局部量（那是 `buildRows` 的），故直接取 `sub?.dialogues`。
   */
  const standbyTouchPool = buildPool(
    sub?.dialogues ?? [],
    resolveStandbyTouchIds(sub?.standby, sub?.touch)
  );
  const standbyKinds = resolveStandbyKinds(
    sub?.standbyTouchEnabled,
    sub?.standbyGreetEnabled,
    standbyTouchPool.length > 0,
    hasGreetingSlots(sub?.greeting)
  );
  const which =
    standbyKinds.length > 1
      ? '从「问候 / 触摸」里随机挑一类'
      : standbyKinds[0] === 'greet'
      ? '播一条按时段的问候'
      : '从「休闲待机 + 点击触摸」那 ' + standbyTouchPool.length + ' 条里随机播一条';

  notes.push(
    '「问候时机」= 下列任一：① 壁纸载入后 ' +
      delaySec +
      ' 秒；② 页面重新变为可见；③ 窗口重新获得焦点；④ Wallpaper Engine 暂停后恢复' +
      '（恢复这一路还要求离开不少于 15 秒，切一下窗口马上回来不会触发）' +
      (standbyKinds.indexOf('greet') >= 0 ? '；⑤ 待机静置到点' : '') +
      '。相邻两次问候至少间隔 5 秒；若此刻正在播触摸动作则跳过，等下一个信号。'
  );
  notes.push(
    standbyKinds.length
      ? '「待机自动触发」的计时从壁纸载入起算；只要有任何动作正在播放就重新起算，' +
          '所以不会在演出中途插话。静置 ' +
          fmtSec(standbySec) +
          ' 秒后' +
          which +
          '（「动作」页两个开关决定播哪一类，共用同一个时长）。'
      : '「待机自动触发」的两类都关掉了 —— 静置再久也不会自动说话。'
  );
  notes.push(
    '「点击触摸」= 点中任一热区后从池中随机取 1 条；池 = 配置里的 ' +
      ((sub?.touch ?? []).length || 0) +
      ' 条触碰念白' +
      (sub?.greetInTouchPool === true
        ? '，另并入 3 条时段问候（开关已打开）'
        : '') +
      '。同一条念白对应的动画只有 5 个（greet / chat / touch1 / touch2 / touch3）——' +
      '多条念白共用同一个动作是骨架资源本身的情况。'
  );
  notes.push(
    '念白播放时同时出字幕与语音；字幕停留取「念白标注时长」与「动画实际时长」中较短的那个。'
  );
  notes.push(
    '触摸的动作与语音有「叠加 / 排队」两种模式；若启用了常驻动作序列，触摸会排到序列之后。'
  );

  return notes;
};

export const createArchive = (options: ArchiveOptions): ArchivePanel => {
  let visible = options.visible === true;
  const cfg = options.config;
  const rows = buildRows(cfg);
  const notes = buildNotes(cfg);

  // ★ 先初始化 UI 缩放变量（幂等）：下面所有 px 都依赖它
  initUiScale();

  /* ── 全屏层 ───────────────────────────────────
   * ★ `pointer-events:none`：本面板**不接管交互**，卡外的点击照常到角色（见文件头）。
   */
  const root = createEl(
    'div',
    [
      'position:fixed',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'z-index:2147483645',
      'pointer-events:none',
      'display:' + (visible ? 'block' : 'none'),
      'font-family:' + FONT,
      'color:#eef1f6',
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';')
  );
  root.id = 'wb-archive-root';

  /* 半透明遮罩：只压暗、不吃事件（不用 backdrop-filter，见文件头） */
  createEl(
    'div',
    [
      'position:absolute',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'background:rgba(0,0,0,0.30)',
    ].join(';'),
    root
  ).id = 'wb-archive-scrim';

  /* ── 卡片（居中 + 固定视口比例）─────────────────
   * ★ 尺寸与设置面板**完全一致**：`80vw × 80vh`（用户 2026-09-30 明确要求）。
   * ★ 外框几何用 vw/vh（不随 UI 缩放漂），缩放只作用于内层 ⇒ `fitContent` 才有意义。
   */
  const card = createEl(
    'div',
    [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:80vw',
      'height:80vh',
      'pointer-events:auto',
      'display:flex',
      'flex-direction:column',
      'box-sizing:border-box',
      'padding:' + uiPx(16) + ' ' + uiPx(20) + ' ' + uiPx(12),
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.16)',
      'border-radius:' + uiPx(14),
      'background:rgba(16,18,26,0.94)',
      'box-shadow:0 ' + uiPx(10) + ' ' + uiPx(34) + ' rgba(0,0,0,0.45)',
    ].join(';'),
    root
  );
  card.id = 'wb-archive-card';
  SWALLOW_EVENTS.forEach((evt) => {
    card.addEventListener(
      evt,
      (e: Event) => {
        e.stopPropagation();
      },
      false
    );
  });

  /* ── 头部 ─────────────────────────────────── */
  const header = createEl('div', 'flex:0 0 auto', card);
  createEl(
    'div',
    'font-size:' + fpx(15) + ';font-weight:600;letter-spacing:' + uiPx(0.5),
    header
  ).textContent = '档案 · 可能触发的事件';
  createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.55;line-height:1.45;margin-top:' +
      uiPx(3),
    header
  ).textContent =
    '下表按当前生效的配置实时生成（改过设置后，这里的数字与池子会跟着变）。';

  /* ── 正文（唯一滚动容器）───────────────────── */
  const body = createEl(
    'div',
    [
      'flex:1 1 auto',
      // ★ flex 子项默认 min-height:auto ⇒ 内容会把容器撑破，必须显式 0
      'min-height:0',
      'overflow-y:auto',
      'margin-top:' + uiPx(8),
      'padding-top:' + uiPx(6),
      'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      // 隐藏原生滚动条（WE 里拖不动）；正常情况下 fitContent 已保证不需要滚
      'scrollbar-width:none',
      '-ms-overflow-style:none',
    ].join(';'),
    card
  );
  body.id = 'wb-archive-body';

  /* ── 表格 ─────────────────────────────────────
   * 用 flex 行 + 百分比列宽（不用 `<table>`）：列宽要与设置面板的阅读节奏一致，
   * 且 `<table>` 的默认样式（cellpadding/border-spacing）要清零一遍更麻烦。
   */
  const table = createEl('div', 'display:flex;flex-direction:column', body);
  table.id = 'wb-archive-table';

  const makeCells = (
    parent: HTMLElement,
    texts: readonly string[],
    css: string
  ): void => {
    COLS.forEach((w, i) => {
      const c = createEl(
        'div',
        'width:' +
          w +
          ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
          uiPx(7) +
          ';' +
          css,
        parent
      );
      c.textContent = texts[i] ?? '';
    });
  };

  /* 表头 + `|---|` 分隔线（md 表格的观感） */
  const head = createEl(
    'div',
    'display:flex;flex:0 0 auto;font-size:' +
      fpx(12) +
      ';font-weight:600;color:#9fc5f0;padding:' +
      uiPx(3) +
      ' 0',
    table
  );
  head.id = 'wb-archive-head';
  makeCells(head, ['事件', '触发条件', '动作', '念白', '语音'], '');
  createEl(
    'div',
    'flex:0 0 auto;height:' +
      uiPx(1) +
      ';background:rgba(159,197,240,0.42);margin:0 0 ' +
      uiPx(2),
    table
  ).id = 'wb-archive-hr';

  rows.forEach((r, i) => {
    const row = createEl(
      'div',
      'display:flex;flex:0 0 auto;align-items:flex-start;padding:' +
        uiPx(6) +
        ' 0' +
        (i === rows.length - 1
          ? ''
          : ';border-bottom:' + uiPx(1) + ' solid rgba(255,255,255,0.07)'),
      table
    );
    row.id = 'wb-archive-row-' + (i + 1);
    row.setAttribute('data-wb-archive-row', String(i + 1));

    /* 事件：名字 + 序号色块 */
    const cEvent = createEl(
      'div',
      'width:' +
        COLS[0] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(14) +
        ';font-weight:600',
      row
    );
    cEvent.textContent = r.event;

    /* 触发条件 */
    const cCond = createEl(
      'div',
      'width:' +
        COLS[1] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(12) +
        ';line-height:1.6;opacity:.86',
      row
    );
    cCond.textContent = r.cond;

    /* 动作：等宽字体，方便与骨架动画名对照 */
    const cAction = createEl(
      'div',
      'width:' +
        COLS[2] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(12) +
        ';font-family:Consolas,Menlo,monospace;color:#ffd98a',
      row
    );
    cAction.textContent = r.action;

    /* 念白：上标 id/动作名（淡），下面正文 */
    const cLine = createEl(
      'div',
      'width:' +
        COLS[3] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7),
      row
    );
    createEl(
      'div',
      'font-size:' +
        fpx(11) +
        ';opacity:.5;font-family:Consolas,Menlo,monospace;line-height:1.4',
      cLine
    ).textContent = r.tag;
    createEl(
      'div',
      'font-size:' + fpx(12) + ';line-height:1.6;opacity:.92',
      cLine
    ).textContent = r.text;

    /* 语音 */
    const cVoice = createEl(
      'div',
      'width:' +
        COLS[4] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(11) +
        ';font-family:Consolas,Menlo,monospace;opacity:.7;word-break:break-all;line-height:1.5',
      row
    );
    cVoice.textContent = r.voice;
  });

  /* ── 细则（跨行共享的闸门）──────────────────── */
  const noteBox = createEl(
    'div',
    'flex:0 0 auto;margin-top:' +
      uiPx(9) +
      ';padding-top:' +
      uiPx(7) +
      ';border-top:' +
      uiPx(1) +
      ' solid rgba(255,255,255,0.10)',
    table
  );
  noteBox.id = 'wb-archive-notes';
  createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';font-weight:600;color:#9fc5f0;margin-bottom:' +
      uiPx(3),
    noteBox
  ).textContent = '触发细则';
  notes.forEach((n) => {
    createEl(
      'div',
      'font-size:' +
        fpx(11) +
        ';line-height:1.62;opacity:.72;margin-bottom:' +
        uiPx(2),
      noteBox
    ).textContent = '· ' + n;
  });

  /* ── 底部（怎么关掉它 + 溢出提示）───────────── */
  const foot = createEl(
    'div',
    [
      'flex:0 0 auto',
      'margin-top:' + uiPx(8),
      'padding-top:' + uiPx(7),
      'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      'font-size:' + fpx(11),
      'opacity:.55',
      'line-height:1.45',
    ].join(';'),
    card
  );
  foot.id = 'wb-archive-foot';
  foot.textContent =
    '关闭方式：在 Wallpaper Engine 的壁纸属性面板中取消勾选「显示档案」即可隐藏本窗口（无需重启）。';

  /**
   * 溢出提示 —— 只在**真的需要滚**时出现。
   *
   * 之所以要明说"按住拖动"：WE 不转发滚轮、原生滚动条也点不动（见文件头），
   * 用户无从得知这里其实可以拖。
   */
  const overflowHint = createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.85;color:#ffd98a;margin-top:' +
      uiPx(2) +
      ';display:none',
    foot
  );
  overflowHint.id = 'wb-archive-overflow-hint';
  overflowHint.textContent = '内容超出卡片高度：按住表格区域上下拖动即可滚动。';

  /* ── 自适应：正文在当前卡片里完整装下（与 fitPanelScale 同一思路）──
   *
   * 卡片高度固定 80vh、body 是 flex:1 ⇒ `body.clientHeight` 就是可用高度；
   * 超高时按比例覆盖卡片上的 `--wb-ui-s`（内层字号/间距全走 uiPx ⇒ 整块等比缩）。
   * `K_MIN` 取 0.55（比免责弹窗的 0.62 更宽），因为本表行数会随配置变多。
   * 幂等：`bodyK` 不变时不写样式 ⇒ 不会与 ResizeObserver 互相触发形成抖动。
   */
  const K_MIN = 0.55;
  let bodyK = 1;
  const fitContent = () => {
    if (!visible) {
      return;
    }
    const s = getUiScale();
    for (let i = 0; i < 3; i++) {
      const avail = body.clientHeight;
      const content = body.scrollHeight;
      if (!(avail > 0) || !(content > 0)) {
        break;
      }
      let next = bodyK;
      if (content > avail) {
        // 留 0.5% 余量，避免刚好贴边导致下一轮又判定"超高"
        next = Math.max(K_MIN, (bodyK * avail * 0.995) / content);
      } else if (bodyK < 1 && content < avail - 8) {
        next = Math.min(1, (bodyK * (avail - 4)) / content);
      }
      if (Math.abs(next - bodyK) < 0.002) {
        break;
      }
      bodyK = next;
      card.style.setProperty(UI_SCALE_VAR, String(s * bodyK));
    }
    // 缩小到 K_MIN 仍装不下 ⇒ 提示可拖动
    overflowHint.style.display =
      body.scrollHeight > body.clientHeight + 1 ? 'block' : 'none';
  };

  /* ── 兜底：按住拖动滚动（WE 里滚轮/原生滚动条都不可用）── */
  let dragging = false;
  let dragFromY = 0;
  let dragFromTop = 0;
  body.addEventListener('mousedown', (e: MouseEvent) => {
    if (body.scrollHeight <= body.clientHeight) {
      return;
    }
    dragging = true;
    dragFromY = e.clientY;
    dragFromTop = body.scrollTop;
  });
  const onDragMove = (e: MouseEvent) => {
    if (!dragging) {
      return;
    }
    body.scrollTop = dragFromTop - (e.clientY - dragFromY);
  };
  const onDragUp = () => {
    dragging = false;
  };
  window.addEventListener('mousemove', onDragMove, false);
  window.addEventListener('mouseup', onDragUp, false);

  const applyVisibility = () => {
    root.style.display = visible ? 'block' : 'none';
    if (visible) {
      fitContent();
    }
  };

  const onWindowResize = () => {
    // 推迟到 rAF：uiScale 的 resize 监听会先写好 --wb-ui-s，样式重算后再量
    window.requestAnimationFrame(() => fitContent());
  };
  window.addEventListener('resize', onWindowResize, false);
  const ro = new ResizeObserver(() => fitContent());
  ro.observe(body);

  // ★ 必须先上屏再量：未 append 时 clientHeight 恒为 0，fitContent 量不出东西
  document.body.appendChild(root);
  applyVisibility();

  return {
    setVisible: (v: boolean) => {
      visible = v === true;
      applyVisibility();
    },
    isVisible: () => visible,
    rowCount: () => rows.length,
    dispose: () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize, false);
      window.removeEventListener('mousemove', onDragMove, false);
      window.removeEventListener('mouseup', onDragUp, false);
      if (root.parentElement) {
        root.parentElement.removeChild(root);
      }
    },
  };
};
