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
 * 触摸/点击探针——**只做测量，不改动画逻辑**。
 *
 * 要回答的问题（按重要性排序）：
 *   Q1  WE 桌面环境下，鼠标事件到底能不能到 canvas？（mousemove / mousedown / click）
 *   Q2  模板已维护的 NDC `cursorX/cursorY` 是否真的在更新？
 *   Q3  有 mousemove、但 click 收不到时，退化的"滑过触发"能不能用？
 *   Q4  现有脊柱骨架里到底有哪些动画名？（为下一步多动画/触摸做准备）
 *
 * 这里**不碰** AnimationState：一旦改了动画，画面变化就无法区分"点击被收到"还是
 * "本来就该这么播"。探针画面 = 正常壁纸画面 + 一层 HUD，截图上既有角色又有诊断数据。
 *
 * 为什么用 DOM 画 HUD 而不是 three 贴图：HUD 必须在 3D 之上，且要显示实时计数；
 * DOM 绝对定位最省事，且不受 3D 透明排序（z 降序）影响。HUD 设 pointer-events:none，
 * 保证它自己不会把点击吃掉、污染测量。
 *
 * 关于 A/B：用户要求用"换 index.html 头像"的方式做消融，所以这里**不加 URL 参数逻辑**
 * （WE 走 file:// 时 query 行为不确定）。
 *
 * **开关有两层**（2026-09-25 起不再互斥，见 `PROBE_OPTS` 的注释）：
 *   - **编译期**：`--env probe=off` ⇒ 只把**缺省**设为"不挂"（发布包省性能）；
 *   - **运行时**：`config.json` 的 `probe` 块 + 设置面板「调试」页的覆盖层
 *     ⇒ **改 config 免重建**，且**双向可覆盖**（正式版也能打开诊断）。
 */

import * as Scene from './initScene';
import { createProbeHud } from './probeHud';
// 只引类型（编译后会被擦除）：诊断里要带上"当前生效的热区"，方便与判定结果对照
import { TouchZone } from './touch';
import { ProbeConfig } from './config.type';

/**
 * 编译期注入（见 webpack.common.js 的 DefinePlugin）。
 * 不传 `--env probe=off` 时就当探针开着，避免"忘了带参数以为探针坏了"。
 */
declare const __PROBE__: boolean;

/**
 * 探测总开关。
 *
 * **两层，但不再互斥**（2026-09-25 改）：
 *   1. 编译期 `__PROBE__` —— `npm run build -- --env probe=off` 只决定**缺省值**
 *      （发布包默认不挂探针，省性能也免得误报）；正常构建缺省为开。
 *   2. 运行时 `config.probe`（含设置面板「调试」页写下的覆盖层）—— 由
 *      `applyProbeConfig()` 注入，**两个方向都能覆盖** ⇒ 正式版里用户照样能打开诊断。
 *
 * `enabled:false` ⇒ 不挂任何监听、不建 HUD；
 * `hud:false` ⇒ 仍记数据（`readout()` 可用）但不画字，截图更干净；
 * `crosshair:false` ⇒ 不画"鼠标位置红圈"（HUD 文字照旧）。
 */
export const PROBE_OPTS = {
  enabled: typeof __PROBE__ === 'undefined' ? true : __PROBE__,
  hud: true,
  crosshair: true,
};

/**
 * 用 config 的 `probe` 块覆盖运行时开关。**必须在 `initProbe()` 之前调用。**
 *
 * ⚠️ 只覆盖**显式写了**的字段 —— 没写就保持缺省，这样老配置（完全没有 `probe` 块）表现不变。
 * ★ 以前这里有个"编译期已关就直接返回"的单向闸门；09-25 用户要求调试开关在正式版
 *   也能用 ⇒ 已去掉：`__PROBE__` 现在只是缺省值，config/覆盖层可以双向覆盖。
 */
export const applyProbeConfig = (cfg?: ProbeConfig) => {
  if (typeof cfg?.enabled === 'boolean') {
    PROBE_OPTS.enabled = cfg.enabled;
  }
  if (typeof cfg?.hud === 'boolean') {
    PROBE_OPTS.hud = cfg.hud;
  }
  if (typeof cfg?.crosshair === 'boolean') {
    PROBE_OPTS.crosshair = cfg.crosshair;
  }
};

/** 用 -1 表示"一次都没收到"，与"收到 0 次"区分开（见 READOUT.note） */
export const NO_EVENT = -1;

const HUD_LINE = {
  MOVE: 0,
  MOVE_SUB: 1,
  DOWN: 2,
  CLICK: 3,
  SCREEN: 4,
  NDC: 5,
  VIEWPORT: 6,
  RATIO: 7,
  VERDICT: 8,
  ROSTER_A: 9,
  ROSTER_B: 10,
  TRACK_A: 11,
  TRACK_B: 12,
  TOUCH_A: 13,
  TOUCH_B: 14,
  HINT: 15,
} as const;

export type ProbeRoster = {
  /** 骨架文件名 → 动画名数组 */
  skeletons: Array<{ file: string; animations: string[] }>;
  canvas: { width: number; height: number };
  meshes: number;
};

/** 一根 track 的运行时状态（由 SpineAnimator.getTrackSnapshot 提供） */
export type ProbeTrackRow = {
  track: number;
  animation: string;
  loop: boolean;
  trackTime: number;
};

/** 骨架 → 取 track 快照的只读函数 */
type TrackSampler = {
  file: string;
  sample: () => ProbeTrackRow[];
};

/** 触摸控制器的只读诊断快照（结构由 touch.ts 的 TouchController.snapshot 决定） */
export type ProbeTouchRow = {
  idleName: string;
  touchNames: string[];
  busy: boolean;
  playing: string;
  firedCount: number;
  skippedCount: number;
  /** 按下位置落在所有热区之外的次数 */
  missCount: number;
  lastPick: string;
  /** 最近一次按下的命中热区 id；没命中为空串 */
  lastHitZone: string;
  /** 当前生效的热区（与判定用的是同一组，供覆盖层/验证脚本读取） */
  zones: TouchZone[];
};

type TouchSampler = {
  file: string;
  sample: () => ProbeTouchRow;
};

export type ProbeReadout = {
  moveCount: number;
  moveRaw: number;
  movePointer: number;
  downCount: number;
  clickCount: number;
  screenPx: { x: number; y: number };
  ndc: { x: number; y: number };
  verdict: string;
  roster: ProbeRoster;
  /** 宿主视口口径——用来判断 clientX 到底是逻辑像素还是物理像素 */
  viewport: {
    innerWidth: number;
    innerHeight: number;
    dpr: number;
    /** clientX / innerWidth，理想情况应落在 [0,1] */
    ratioX: number;
    /** clientY / innerHeight，理想情况应落在 [0,1] */
    ratioY: number;
  };
  /** 各骨架的 track 快照（每帧采样） */
  tracks: Array<{ file: string; rows: ProbeTrackRow[] }>;
  /** 是否有 track>=1 卡在循环（cursorPress 未收尾的典型症状） */
  trackStuck: boolean;
  /** 触摸控制器诊断 */
  touches: Array<{ file: string; state: ProbeTouchRow }>;
};

let hud: ReturnType<typeof createProbeHud> = null;

let moveCount = NO_EVENT;
let moveRaw = NO_EVENT;
let movePointer = NO_EVENT;
let downCount = 0;
let clickCount = 0;
let lastScreenX = NaN;
let lastScreenY = NaN;

let roster: ProbeRoster = {
  skeletons: [],
  canvas: { width: 0, height: 0 },
  meshes: 0,
};

const trackSamplers: TrackSampler[] = [];
const touchSamplers: TouchSampler[] = [];

/**
 * 判断"是否有 track>=1 卡在循环"。
 *
 * 这是 probe 要回答的核心问题之一：模板 cursorPress 的
 * `setAnimation(1, name, true)` loop 写死为 true，若 mouseup 时 cursorFollow
 * 未配，track 1 会永远循环、不回 idle。
 *
 * 注：`getTrackSnapshot` 会**跳过空槽位**（`tracks[i] === null`），
 * 所以这里遍历到的都是真有动画的 track，不必再过滤 `'(empty)'`。
 */
const trackStuck = () => {
  return trackSamplers.some((s) =>
    s.sample().some((r) => r.track >= 1 && r.loop)
  );
};

const judge = () => {
  if (moveCount === NO_EVENT) {
    return '事件 0 次 —— 到不了 canvas，查 WE 权限/开关';
  }
  if (clickCount > 0) {
    return '点击可用 —— 可按原方案做热区';
  }
  if (downCount > 0) {
    return '只有按下、无 click —— 可退化为 mouseup 触发';
  }
  if (moveCount > 0) {
    return '只有移动、无点击 —— 退化为"滑过触发"';
  }
  return '待观察';
};

const fmt = (v: number, digits: number) =>
  Number.isFinite(v) ? v.toFixed(digits) : 'n/a';

/**
 * 把"宿主给的事件坐标"换算成视口比例。
 *
 * 为什么要单独看这个：WE 桌面宿主喂进来的 clientX 可能不是 CSS 像素
 * （实测出现过 clientX=2040 而屏幕宽度只有 1920 的情况）。
 * ratio 落在 [0,1] 说明口径正常；>1 说明传的是物理像素或别人家的坐标系。
 */
const viewportOf = () => {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    ratioX: lastScreenX / w,
    ratioY: lastScreenY / h,
  };
};

const renderHud = () => {
  if (!hud) {
    return;
  }

  hud.setLine(
    HUD_LINE.MOVE,
    'mousemove  count = ' +
      (moveCount === NO_EVENT ? 'NONE (0 次!)' : String(moveCount))
  );
  hud.setLine(
    HUD_LINE.MOVE_SUB,
    '  raw = ' +
      (moveRaw === NO_EVENT ? 'NONE' : String(moveRaw)) +
      '   pointer = ' +
      (movePointer === NO_EVENT ? 'NONE' : String(movePointer))
  );
  hud.setLine(HUD_LINE.DOWN, 'mousedown  count = ' + downCount);
  hud.setLine(HUD_LINE.CLICK, 'click      count = ' + clickCount);
  hud.setLine(
    HUD_LINE.SCREEN,
    '光标 px    ' + fmt(lastScreenX, 1) + ', ' + fmt(lastScreenY, 1)
  );
  hud.setLine(
    HUD_LINE.NDC,
    '光标 NDC   ' + fmt(Scene.cursorX, 4) + ', ' + fmt(Scene.cursorY, 4)
  );

  const vp = viewportOf();
  hud.setLine(
    HUD_LINE.VIEWPORT,
    '视口       ' +
      vp.innerWidth +
      'x' +
      vp.innerHeight +
      '  dpr ' +
      fmt(vp.dpr, 2)
  );
  // ratio 是"坐标口径对不对"的直接证据：正常应 <=1，>1 就是口径错了
  const bad = vp.ratioX > 1.0001 || vp.ratioY > 1.0001;
  hud.setLine(
    HUD_LINE.RATIO,
    '比例 px/视口 ' +
      fmt(vp.ratioX, 3) +
      ', ' +
      fmt(vp.ratioY, 3) +
      (bad ? '  ★越界=口径错' : '')
  );

  hud.setLine(HUD_LINE.VERDICT, '判定: ' + judge());

  const sk = roster.skeletons;
  hud.setLine(HUD_LINE.ROSTER_A, '骨架 0 ' + (sk[0] ? sk[0].file : '(未登记)'));
  hud.setLine(
    HUD_LINE.ROSTER_B,
    sk[0] ? '  动画: ' + sk[0].animations.join(' / ') : ''
  );

  // track 状态：cursorPress 机制写死 loop=true，若无 mouseup 收尾会卡住不回 idle。
  // 这里把每根 track 的动画名与 loop 标出来，桌面上一眼可判。
  // 注：getTrackSnapshot 已跳过空槽位，所以 rows 里没出现的 track 号就是"无动画"。
  const TRACK_NAME = ['track0', 'track1', 'track2', 'track3'];
  const trackText = trackSamplers
    .map((s) => {
      const rows = s.sample();
      if (!rows.length) {
        return '  ' + s.file + ' → (无动画)';
      }
      return (
        '  ' +
        rows
          .slice(0, 4)
          .map((r) => {
            const nm = TRACK_NAME[r.track] ?? 'track' + r.track;
            return nm + '=' + r.animation + (r.loop ? '(loop)' : '(once)');
          })
          .join('  ')
      );
    })
    .join(' | ');

  hud.setLine(HUD_LINE.TRACK_A, 'TRACK ' + (trackText || '(未登记)'));
  hud.setLine(
    HUD_LINE.TRACK_B,
    trackStuck() ? '  ★ track>=1 仍在循环 → 按下后卡住了，未回 idle' : ''
  );

  // 触摸控制器状态：验证"仅 idle 可触发 / 队列容量 1 / 播完回 idle / 三块热区命中"
  if (touchSamplers.length) {
    const t = touchSamplers[0].sample();
    hud.setLine(
      HUD_LINE.TOUCH_A,
      'TOUCH 可播[' +
        t.touchNames.length +
        '] 命中 ' +
        t.firedCount +
        ' 跳过 ' +
        t.skippedCount +
        ' 区外 ' +
        t.missCount +
        ' 末选 ' +
        (t.lastPick || '-') +
        (t.busy ? '  ★播放中' : '  空闲')
    );
    hud.setLine(
      HUD_LINE.TOUCH_B,
      '  仅 track0=' +
        t.idleName +
        // ★ 热区 id 直接读控制器快照，不再写死"头/手/腿"——热区现在是 config 驱动的
        ' 可触发 | 热区[' +
        t.zones.length +
        '] ' +
        (t.zones.map((z) => z.id).join('/') || '(无)') +
        ' | 本次命中 ' +
        (t.lastHitZone || '(区外)')
    );
  } else {
    hud.setLine(HUD_LINE.TOUCH_A, 'TOUCH (未登记)');
    hud.setLine(HUD_LINE.TOUCH_B, '');
  }

  hud.setLine(
    HUD_LINE.HINT,
    'canvas ' +
      roster.canvas.width +
      'x' +
      roster.canvas.height +
      '  meshes ' +
      roster.meshes +
      ' | 红圈 = 宿主给的坐标(若不在鼠标处=口径错)'
  );

  hud.setOk(clickCount > 0);
};

/**
 * 由 index.ts 把 SkeletonMesh 的动画清单登记进来。
 *
 * 为什么在这里而不是自己解析 .skel：探针不该重复实现一套解析器（那是冗余），
 * 直接读运行时已经加载好的 `skeletonMesh.skeleton.data.animations` 最可信。
 */
export const registerProbeSkeleton = (
  fileName: string,
  animations: string[]
) => {
  roster.skeletons.push({ file: fileName || '(unnamed)', animations });
  renderHud();
};

/** 由 index.ts 登记画布与 mesh 数量（放进同一条 HUD 里，省一块截图） */
export const registerProbeCanvas = (
  width: number,
  height: number,
  meshes: number
) => {
  roster.canvas = { width, height };
  roster.meshes = meshes;
  renderHud();
};

/**
 * 由 index.ts 登记"取 track 快照"的只读函数。
 *
 * 传的是函数本身（`SpineAnimator.getTrackSnapshot`，已 bind 成箭头函数），
 * 而不是快照值 —— 因为 track 状态每帧都在变，必须实时取。
 */
export const registerProbeTrackSampler = (
  fileName: string,
  sample: () => ProbeTrackRow[]
) => {
  trackSamplers.push({ file: fileName || '(unnamed)', sample });
  renderHud();
};

/** 由 index.ts 登记触摸控制器的只读诊断快照 */
export const registerProbeTouch = (
  fileName: string,
  sample: () => ProbeTouchRow
) => {
  touchSamplers.push({ file: fileName || '(unnamed)', sample });
  renderHud();
};

export const getProbeReadout = (): ProbeReadout => ({
  moveCount,
  moveRaw,
  movePointer,
  downCount,
  clickCount,
  screenPx: { x: lastScreenX, y: lastScreenY },
  ndc: { x: Scene.cursorX, y: Scene.cursorY },
  verdict: judge(),
  roster,
  viewport: viewportOf(),
  tracks: trackSamplers.map((s) => ({ file: s.file, rows: s.sample() })),
  trackStuck: trackStuck(),
  touches: touchSamplers.map((s) => ({ file: s.file, state: s.sample() })),
});

const touch = (event: MouseEvent | PointerEvent) => {
  lastScreenX = event.clientX;
  lastScreenY = event.clientY;
  if (hud) {
    hud.setCross(lastScreenX, lastScreenY);
    renderHud();
  }
};

export const initProbe = () => {
  if (!PROBE_OPTS.enabled) {
    return;
  }

  hud = createProbeHud(PROBE_OPTS.hud, PROBE_OPTS.crosshair);

  document.addEventListener(
    'mousemove',
    (event: MouseEvent) => {
      moveRaw = (moveRaw === NO_EVENT ? 0 : moveRaw) + 1;
      moveCount = (moveCount === NO_EVENT ? 0 : moveCount) + 1;
      touch(event);
    },
    false
  );

  document.addEventListener(
    'pointermove',
    (event: PointerEvent) => {
      movePointer = (movePointer === NO_EVENT ? 0 : movePointer) + 1;
      touch(event);
    },
    false
  );

  document.addEventListener(
    'mousedown',
    () => {
      downCount++;
      renderHud();
    },
    false
  );

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      clickCount++;
      touch(event);
    },
    false
  );

  // 事件监听挂完先刷一次，保证即使 0 次事件也有可读的初始值
  renderHud();

  /**
   * track 状态是**每帧变化**的（动画在推进），只在事件时刷会读到过期值。
   * 这里用 rAF 每帧刷一次 HUD —— 只改 DOM 文本，开销极小，且不碰任何动画状态。
   */
  const tick = () => {
    renderHud();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // 暴露到全局：挂上 DevTools（WE 的 cefcommandline 可开远程调试）时能直接
  // 在控制台敲 `__spineProbe()` 拿读数，不必从截图上认字。
  (window as unknown as { __spineProbe?: () => ProbeReadout }).__spineProbe =
    getProbeReadout;
};
