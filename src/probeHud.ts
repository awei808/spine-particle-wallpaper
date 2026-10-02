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
 * 探测用的屏幕覆盖层（HUD）。
 *
 * 为什么要有它：桌面上的点击事件能不能到 canvas、`cursorX/cursorY` 有没有在动，
 * 都只能"看"出来。但 WE 跑在桌面时看不到 DevTools，所以把结论画在自己画布上，
 * 用截图就能读——这样判据是客观的，不靠"我感觉点了有反应"。
 *
 * 用 DOM（绝对定位的 div）而不是 three 里的贴图：HUD 必须在 3D 之上，
 * 且要能实时显示事件计数，DOM 最省事且不受任何 3D 排序影响。
 *
 * 消融实验（A/B）用两种控制方式，任选其一即可：
 *   1) 改 PROBE_OPTS.enabled（源码）           —— 最干净，需重新构建
 *   2) 在 index.html 的 URL 上带 ?probe=on/off —— 不用重新构建，但要求项目走 HTTP
 * 若两者都没有显式给，则按 NO_EVENTS_AT_ALL 自动判断：一次 mousemove 都没收到
 * 就说明事件确实到不了，此时必须显示 HUD（否则用户看不到任何反馈）。
 */

import { initUiScale, uiPx } from './uiScale';

export const NO_EVENTS_AT_ALL = -1;

const HUD_ID = 'spine-probe-hud';
/** 红圈的 id —— 给验证脚本一个稳定锚点（"红圈能单独关"要有实测判据） */
const CROSS_ID = 'spine-probe-cross';

/**
 * 创建并挂上 HUD，返回更新函数。
 *
 * @param visible 初始是否显示 HUD **文字块**
 * @param crosshair 是否画"鼠标位置红圈"（缺省 true）。独立于 `visible`：
 *   录屏时常用"关红圈、留文字"。关掉后 `setCross` 只记录坐标不动 DOM。
 * @returns 每次事件后调用即可刷新显示
 */
export const createProbeHud = (visible: boolean, crosshair = true) => {
  // ★ 必须先初始化：下面每个 px 都依赖 --wb-ui-s（没初始化时回落 1 = 原行为）
  initUiScale();
  const el = document.createElement('div');
  el.id = HUD_ID;
  // 全部写成内联样式：不依赖任何外部 CSS，也不受 index.html 的 body flex 布局影响
  // ★ px 一律走 uiPx()：随壁纸一起缩放。原来写死 12px，浏览器小窗口看着正常，
  //   导入 WE（视口 = 整屏像素）就"变小" —— 与气泡 voiceBubble 不同步的根因。
  el.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'z-index:2147483647',
    'margin:0',
    'padding:' + uiPx(10) + ' ' + uiPx(14),
    'background:rgba(0,0,0,0.72)',
    'color:#ffffff',
    // 拆成三行而不是 `font:12px/1.5` —— font 简写里塞 calc() 没把握，拆开最稳
    'font-size:' + uiPx(12),
    'line-height:1.5',
    'font-family:Consolas,Menlo,monospace',
    'white-space:pre',
    'pointer-events:none',
    'user-select:none',
    'display:' + (visible ? 'block' : 'none'),
  ].join(';');

  const cross = document.createElement('div');
  cross.id = CROSS_ID;
  cross.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:' + uiPx(18),
    'height:' + uiPx(18),
    'margin:' + uiPx(-9) + ' 0 0 ' + uiPx(-9),
    'border:' + uiPx(1) + ' solid #ff0000',
    'border-radius:50%',
    'z-index:2147483646',
    'pointer-events:none',
    'display:none',
  ].join(';');

  const boot = () => {
    if (!document.body) {
      // 脚本在 <head> 里执行时 body 还不存在，等下一帧
      requestAnimationFrame(boot);
      return;
    }
    document.body.appendChild(el);
    document.body.appendChild(cross);
  };
  boot();

  const lines: string[] = [];
  /**
   * ★ 内容没变就**完全不碰 DOM**（2026-09-28 性能修复）。
   *
   * 原实现是"每次 setLine 都 `el.textContent = lines.join('\n')`"，
   * 而 `probe.ts` 的 rAF 每帧会调 16 次 setLine（`HUD_LINE` 0~15）
   * ⇒ 每帧 16 次 textContent 赋值 ⇒ 持续触发 layout。
   *
   * 实测（`_work_性能诊断/70_内存与性能采样.py`，1700×750、无头 165fps、3 分钟）：
   *   - 探针开（hud=true）: `LayoutCount` 375 → 26644 ≈ **145 次/秒**；
   *   - 探针关            : 4 → 29 ≈ **0.15 次/秒**  ⇒ 差约 **1000 倍**；
   *   - 同期 `TaskDuration` 53.86s vs 32.79s（+64%）。
   * 而 HUD 里绝大多数行（mousemove 计数、TRACK 名、骨架名、视口…）在**静置时根本不变**,
   * 只有鼠标移动 / 点击 / 动画切换时才变。加一次字符串比较即可把静置开销压到零,
   * 且**不引入节流延迟**——内容一变立刻写，探针的实时性不受影响。
   */
  const setLine = (index: number, text: string) => {
    if (lines[index] === text) {
      return;
    }
    lines[index] = text;
    el.textContent = lines.join('\n');
  };

  const setVisible = (on: boolean) => {
    el.style.display = on ? 'block' : 'none';
    if (!on) {
      cross.style.display = 'none';
    }
  };

  /** 上一次 setCross 写下的坐标（避免 mousemove 高频重复写 style） */
  let lastCrossX = NaN;
  let lastCrossY = NaN;

  /** 把十字准星挪到当前坐标上——用眼睛就能确认换算结果对不对 */
  const setCross = (screenX: number, screenY: number) => {
    // ★ 关掉红圈时**不碰 DOM**（只让坐标继续更新）—— 免得"关了又被 setCross 打开"
    if (!crosshair) {
      return;
    }
    /**
     * ★ 坐标没变 / 已经显示着 ⇒ 不重复写 style（2026-09-28，同 setLine 的理由）。
     * `mousemove` 触发频率很高，每次写 `left/top` 都会让这个 fixed 元素重新布局。
     */
    if (cross.style.display === 'block' && screenX === lastCrossX && screenY === lastCrossY) {
      return;
    }
    lastCrossX = screenX;
    lastCrossY = screenY;
    cross.style.display = 'block';
    cross.style.left = screenX + 'px';
    cross.style.top = screenY + 'px';
  };

  const setOk = (ok: boolean) => {
    el.style.borderLeft = uiPx(4) + ' solid ' + (ok ? '#22c55e' : '#ef4444');
  };

  return { setLine, setVisible, setCross, setOk };
};
