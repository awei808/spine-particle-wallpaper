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
 * 触摸热区的**可视化覆盖层**（调试用）。
 *
 * 为什么需要：热区是 config 里的归一化矩形，位置对不对只能"看"。
 * WE 跑在桌面时看不到 DevTools，所以把各块区域直接画在页面上，截图就能判读
 * （和 `probeHud.ts` 的 HUD 是同一套理由）。用户 2026-09-17 明确要求
 * "直接在 html 上显示触发区域"。
 *
 * 由 `config.json` 的 `touch.showZones` 开关控制（**默认关**），
 * 与 `touch.enabled`（是否响应点击）**互相独立** —— 可以"只看框不响应"。
 *
 * 用 DOM 绝对定位 + 百分比：
 *   - 百分比 → 区域坐标天然与分辨率无关，不必关心视口是 2560x1600 还是别的；
 *   - 设 `pointer-events:none` → 绝不能把点击吃掉，否则热区测量本身就失真。
 */

import { TouchZone } from './touch';

/** 各区配色（按数组顺序取，超出则循环），仅用于肉眼区分 */
const PALETTE = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6'];

const OVERLAY_ID = 'spine-touch-zones';

export type TouchZoneOverlay = {
  /** 高亮命中的区域；传 `null` 取消全部高亮 */
  highlight: (zoneId: string | null) => void;
  dispose: () => void;
};

/**
 * 创建区域覆盖层。
 *
 * @param zones 与传给 `createTouchController` 的**同一组**热区，保证画面与判定一致
 */
export const createTouchZoneOverlay = (
  zones: TouchZone[]
): TouchZoneOverlay => {
  const container = document.createElement('div');
  container.id = OVERLAY_ID;
  container.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:100%',
    'height:100%',
    'margin:0',
    'z-index:2147483645', // 比 HUD(2147483647) 低一层，别盖住诊断文字
    'pointer-events:none',
    'user-select:none',
  ].join(';');

  const boxes = zones.map((z, i) => {
    const color = PALETTE[i % PALETTE.length];
    /**
     * ★ 只画**视口内可见**的那部分。
     *
     * 热区允许大于视口 —— 解包数据里真实存在：Asuna S9 的通用区是
     * `u[-2.609, 1.590] v[-4.197, 3.089]`（覆盖整屏还各多出 1.6~3 倍）。
     * 直接用原值画，四条边框全部落在画面之外 ⇒ 看起来像"开关没生效"。
     * **命中判定仍用原始 u/v**（`hitTestZones`），这里只决定"怎么画"。
     */
    const x0 = Math.max(0, z.u0);
    const x1 = Math.min(1, z.u1);
    const y0 = Math.max(0, z.v0);
    const y1 = Math.min(1, z.v1);
    if (x1 <= x0 || y1 <= y0) {
      // 完全落在视口外 —— 画不了。保留占位以防 zones 下标错位
      return null;
    }
    const box = document.createElement('div');
    box.style.cssText = [
      'position:absolute',
      'left:' + x0 * 100 + '%',
      'top:' + y0 * 100 + '%',
      'width:' + (x1 - x0) * 100 + '%',
      'height:' + (y1 - y0) * 100 + '%',
      'box-sizing:border-box',
      'border:3px dashed ' + color,
      'background:' + color + '22',
    ].join(';');

    /** 被视口截断过就标出来，免得把"截断后的框"误读成热区的真实边界 */
    const clipped = z.u0 < 0 || z.v0 < 0 || z.u1 > 1 || z.v1 > 1;
    const tag = document.createElement('div');
    tag.textContent =
      (z.label ?? z.id) + ' (' + z.id + ')' + (clipped ? ' ⤢超出视口' : '');
    tag.style.cssText = [
      'position:absolute',
      'left:0',
      'top:0',
      'padding:2px 8px',
      'background:' + color,
      'color:#000000',
      'font:bold 20px/1.4 Consolas,Menlo,monospace',
      'white-space:nowrap',
    ].join(';');
    box.appendChild(tag);

    container.appendChild(box);
    return box;
  });

  const boot = () => {
    if (!document.body) {
      // 脚本在 <head> 里执行时 body 还不存在，等下一帧
      requestAnimationFrame(boot);
      return;
    }
    document.body.appendChild(container);
  };
  boot();

  return {
    highlight: (zoneId: string | null) => {
      zones.forEach((z, i) => {
        const box = boxes[i];
        if (!box) {
          return;
        }
        const color = PALETTE[i % PALETTE.length];
        const on = !!zoneId && z.id === zoneId;
        // 只换边框粗细/线型与底色浓度：命中瞬间肉眼能看出"亮起来的是哪块"
        box.style.border = on ? '8px solid ' + color : '3px dashed ' + color;
        box.style.background = color + (on ? '66' : '22');
      });
    },
    dispose: () => {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
};
