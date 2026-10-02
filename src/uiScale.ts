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
 * UI 覆盖层（探针 HUD / 设置面板 / 字幕气泡）的统一缩放因子。
 *
 * ## 为什么需要它
 *
 * 探针 HUD 与设置面板原本用的是**固定 px**（`font:12px`、`width:284px` …），
 * 而 3D 场景是**铺满视口**的（`initScene.ts` 用 `window.innerWidth/Height` 定画布尺寸）
 * ⇒ 屏幕越大，同一份 12px 占屏幕的比例越小：
 * 浏览器里用小窗口预览时看着正常 / 偏大，导入 WE 后（视口 = 整屏像素）就"变小"。
 *
 * ## 口径：与字幕气泡完全对齐
 *
 * `voiceBubble.ts` 早就有 `s = window.innerHeight / referenceHeight`
 * （`referenceHeight` 缺省 **750**，见该文件 `DEFAULT_REFERENCE_HEIGHT`，
 * 以及 `config.type.ts:573` "所有设计单位都是游戏 750 高画布下的值"）。
 *
 * 本模块复用**同一个 750 基准**，保证气泡 / HUD / 设置面板三者
 * **以同一个比例缩放**，观感不随窗口尺寸漂移。
 *
 * ## 实现：CSS 自定义属性，而不是逐个改 style
 *
 * 缩放值挂在 `<html>` 的 `--wb-ui-s`（无单位数值）上，各 UI 只需把原来的
 * `12.5px` 写成 `calc(12.5px * var(--wb-ui-s, 1))`：
 *
 * - 窗口变化时本模块**只改一个变量**，浏览器自动重算所有依赖它的样式；
 *   不需要逐元素重新赋值，也不会漏改某一处。
 * - 兜底值 `1`：万一 `initUiScale` 没被调用，样式退化成原来的固定 px，
 *   不会整块失效（悬空 `var()` 会让整条声明失效，所以默认值必须给）。
 *
 * ## 幂等
 *
 * `initUiScale` 可重复调用（多次调用只挂一个 resize 监听），
 * 因为 HUD 与设置面板会各自调用它。
 */

/** 设计基准高度 —— 必须与 `voiceBubble.ts` 的 DEFAULT_REFERENCE_HEIGHT 一致 */
export const UI_REFERENCE_HEIGHT = 750;

/** 挂在 `<html>` 上的 CSS 变量名 */
export const UI_SCALE_VAR = '--wb-ui-s';

/**
 * 当前缩放因子 = `视口高 / UI_REFERENCE_HEIGHT`。
 *
 * 与气泡的 `s` 同源同理，**不做上下夹逼**：一旦这里单方面夹逼，三者在大屏
 * （或极小预览窗口）下就会彼此错位——气泡照常放大，HUD/面板却被压住，
 * 反而重新制造出"面板比画面小"的观感。
 * 若以后确实要限制极端值，请**连气泡一起改**，保持三个 UI 同源。
 * 视口读不到（0 / 未布局）时退回 1，避免除出 0 或 NaN。
 */
export const getUiScale = (): number => {
  const h = window.innerHeight;
  if (!(h > 0) || !(UI_REFERENCE_HEIGHT > 0)) {
    return 1;
  }
  const s = h / UI_REFERENCE_HEIGHT;
  return s > 0 ? s : 1;
};

let uiScaleInited = false;

/**
 * 初始化（幂等）：写一次变量 + 挂一个 resize 监听。
 * HUD 与设置面板各自调用即可，不会重复挂监听。
 */
export const initUiScale = (): void => {
  const root = document.documentElement;
  const apply = () => {
    root.style.setProperty(UI_SCALE_VAR, String(getUiScale()));
  };
  apply();
  if (uiScaleInited) {
    return;
  }
  uiScaleInited = true;
  window.addEventListener('resize', apply, false);
};

/**
 * "设计单位" → 可直接写进 style 的 px 串。
 *
 * `uiPx(12.5)` ⇒ `calc(12.5px * var(--wb-ui-s, 1))`
 *
 * 备注：传负数会得到 `calc(-9px * var(...))`，用于 `margin` 的负偏移。
 * 之所以返回 `calc()` 而不是算好的数字：这样 resize 时不需要逐元素重设
 * style，浏览器自己跟着变量变（也是"不会漏改"的原因）。
 */
export const uiPx = (v: number): string =>
  'calc(' + v + 'px * var(' + UI_SCALE_VAR + ', 1))';

/**
 * UI 覆盖层的**字号**统一偏移（用户 09-25 要求整体调小 2px）。
 *
 * 所有字号都写成 `fpx(原来的设计 px 值)` ⇒ 以后再要微调只改 `FS_OFFSET` 一个数，
 * 不会漏改某一处。`FS_MIN` 是下限：角标那类 10px 的小字减完不至于看不清。
 *
 * 之所以放在这里而不是各自文件里定义：设置面板与免责弹窗要用同一套字号口径，
 * 两处各写一份必然慢慢漂移。
 */
const FS_OFFSET = -2;
const FS_MIN = 9;

/** 字号专用换算（多一层 `FS_OFFSET` 与下限夹逼，其余同 `uiPx`） */
export const fpx = (n: number): string => uiPx(Math.max(FS_MIN, n + FS_OFFSET));
