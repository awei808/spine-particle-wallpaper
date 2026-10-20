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
 * WE「帧率限制」信号的**唯一消费点**。
 *
 * ## 为什么必须有它（2026-10-19 真机实测）
 *
 * WE 官方《FPS Limiter》写得很清楚：用户在「设置 → 性能 → 帧率限制」里选的值，
 * 只通过 `wallpaperPropertyListener.applyGeneralProperties({ fps })` **告知**壁纸，
 * **宿主不会替壁纸限帧** —— 原文是 "the page has to honour it"。
 *
 * 而本工程原先只消费 `setPaused`（`wePauseSignal`）与 `applyUserProperties`
 * （`settingsStore`），**从未注册这个回调** ⇒ 实测用户在 WE 里设 30fps，
 * 壁纸仍按 60fps 跑，单核占用约为限帧后的 2 倍（`docx/_archive/2026-10/REPORT_WE_CPU_定量实测`）。
 *
 * ## 语义
 *
 * | 收到的值 | 含义 | 渲染循环怎么用 |
 * |---|---|---|
 * | `fps > 0` | 用户设定的上限 | 直接当上限 |
 * | `fps === 0` | 用户在 WE 里选了「无限制」 | 不限帧（不回退 config） |
 * | 从没收到过 | 非 WE 环境 / 宿主未实现 | 回退 `config.maxFps` |
 *
 * ## 与 `config.maxFps` 的优先级：WE 有值就**完全听 WE**
 *
 * 理由：WE 的滑块是用户在界面上直接操作的权威入口。若被 config 的 30 压住，
 * "我在 WE 里调成 60"就会看起来**没生效**（这正是本模块要解决的问题本身）。
 * `config.maxFps` 因此退化为"非 WE 环境（浏览器预览）的缺省上限"。
 *
 * ## 为什么可以**随时改**
 *
 * WE 在用户改动设置时会再次调用 `applyGeneralProperties`。所以这里只存一个
 * 模块级变量，由 `render()` **每帧读取**（见 `index.ts` 的 `resolveBaseCap`）
 * —— 不缓存进闭包、不要求重载页面。
 */

import { WallpaperPropertyListener, withWallpaperPropertyListener } from './wePauseSignal';

/** 最近一次从 WE 收到的上限（`0` = 无限制） */
let weFps = 0;
/** 是否**真的收到过** WE 的取值（区分"收到 0（无限制）"与"从没收到"） */
let hasSignal = false;
/** `applyGeneralProperties` 是否已挂上（幂等） */
let armed = false;

/**
 * 宽容解析 `properties.fps`。
 *
 * WE 的官方示例给的是数字，但实测不同版本可能给 `"30"`（字符串）
 * 或包一层 `.value`。解析不出来 ⇒ 返回 `undefined`（**保持上一次的值**），
 * 绝不用一个猜出来的数字覆盖用户的设置。
 *
 * `0` 是合法值（= 无限制），不能当成"没给"。
 */
const parseFps = (raw: unknown): number | undefined => {
  const v =
    raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).value
      : raw;
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!isFinite(n) || n < 0) {
    return undefined;
  }
  return n;
};

/**
 * 挂上 `applyGeneralProperties`（幂等）。
 *
 * 走 `withWallpaperPropertyListener` 而不是直接补字段：WE 的注入脚本可能
 * 晚于 bundle 执行（真机取证里 `wpl` 最长 4s 才出现），必须带重试。
 */
export const installWeFpsSignal = (): void => {
  if (armed || typeof window === 'undefined') {
    return;
  }
  withWallpaperPropertyListener((wpl: WallpaperPropertyListener) => {
    wpl.applyGeneralProperties = (properties: Record<string, unknown>) => {
      const next = parseFps(properties?.fps);
      if (next === undefined) {
        return;
      }
      weFps = next;
      hasSignal = true;
    };
    armed = true;
  });
};

/** 当前生效的 WE 上限（`0` = 无限制；未收到过时也是 0） */
export const getWeFps = (): number => weFps;

/** 是否收到过 WE 的取值（`false` ⇒ 调用方应回退到 `config.maxFps`） */
export const hasWeFps = (): boolean => hasSignal;

/**
 * 仅测试用：重置模块状态。
 *
 * 渲染循环在同一个页面里只跑一轮，本来不需要重置；但 `_regress/42_` 要在
 * 一次运行里模拟"先没信号、再收到 30、再收到 0"三种状态，需要回到初始态。
 */
export const __resetWeFpsForTest = (): void => {
  weFps = 0;
  hasSignal = false;
  armed = false;
};
