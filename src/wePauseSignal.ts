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
 * WE「暂停 / 恢复」信号的**唯一安装点** + 多订阅广播。
 *
 * ## 为什么要有这一层（2026-09-27）
 *
 * `window.wallpaperPropertyListener.setPaused` 是**单赋值**的：谁后写谁生效。
 * 原先只有 `bgmPlayer` 装它（用来停 BGM）；现在"回到桌面"（= 壁纸被暂停后又恢复）
 * 也要用同一个信号触发问候（`index.ts`）。两个模块各写一次 `wpl.setPaused = …`
 * ⇒ 后写的覆盖先写的 ⇒ 必有一个静默失效。
 *
 * 所以收敛成「一处安装 + 多订阅」：
 *
 *   WE 宿主 ──setPaused(isPaused)──▶ wePauseSignal ──┬─▶ bgmPlayer（停 / 续 BGM）
 *                                                   └─▶ index.ts（恢复时播问候）
 *
 * ## ★ WE 到底什么时候会暂停壁纸（决定这个功能能不能被触发）
 *
 * WE **没有**"回到桌面"事件 —— 桌面壁纸窗口永远"可见"，`visibilitychange` /
 * `focus` 在壁纸里基本收不到（早期版本就挂了这两个，实测 WE 下不触发）。
 * 可用的等价信号只有一个：用户在 WE 设置里选了
 * **「其他应用程序处于全屏 / 最大化时：暂停」**。
 * 全屏程序退出 ⇒ WE 调 `setPaused(false)` ⇒ **这就是"回到主界面"**。
 *
 * ⚠️ 若用户选的是"停止（Stop）"，壁纸会被整个卸载，恢复时页面**重新加载**
 * ⇒ 走开机问候那条路（`subtitle.greetingDelayMs`），不需要本模块。
 *
 * ## ★ 官方口径里那句 "not strictly needed" 为什么对本项目不成立
 *
 * WE 文档写 `setPaused` "not strictly needed as WE will fully freeze the process"。
 * 对**渲染**成立（rAF 停摆、动画自然停住），但有两处不成立：
 *   1. **音频解码不受冻结影响** ⇒ 不挂 `setPaused` 就是"画面停了、BGM 照常响"；
 *   2. **冻结期间 `Date.now()` 照走** ⇒ 恢复首帧 `delta` 等于整段暂停时长
 *      （可能几十秒）⇒ 骨架动画/粒子瞬间跳一大段。见 `index.ts` 的 delta clamp。
 */

/**
 * WE 注入到 `window` 上的宿主监听器。
 *
 * ★★ **这是本项目里该类型的唯一定义处**（`settingsStore.ts` 直接用在这里定义好的名字）。
 * 两处各写一份 `declare global` 会让 TS 报 "Subsequent property declarations must
 * have the same type" —— 全局增补**必须收敛到一个地方**。
 *
 * ⚠️ 字段都是**可选**：不同宿主 / 不同 WE 版本给的回调集合不一定齐全，
 * 而且本项目是"按字段往宿主对象上补"（绝不整体替换），可选才符合实际情况。
 */
export type WallpaperPropertyListener = {
  /** WE 暂停/恢复壁纸时调用。`true` = 已暂停（如全屏游戏、其他应用获得焦点）。由本模块安装 */
  setPaused?: (isPaused: boolean) => void;
  /**
   * WE 下发**通用属性**（不是本壁纸的自定义属性）时调用。
   * 目前唯一用到的是 `fps` —— 用户在「设置 → 性能 → 帧率限制」里选的值。
   *
   * ★ WE 官方《FPS Limiter》的口径：**宿主只负责告知，不负责限帧**，
   *   "the page has to honour it"。所以这个字段必须真的被消费（见 `weFps.ts`）。
   * ★ 与 `applyUserProperties` 一样：**可选**，且可能被局部更新调用
   *   （只有部分字段）⇒ 读的时候必须逐字段判空，不能整体替换。
   */
  applyGeneralProperties?: (properties: Record<string, unknown>) => void;
  /**
   * WE 下发用户属性时调用（值来自 `project.json` 的 `general.properties`）。
   * 由 `settingsStore.installWallpaperPropertyListener` 安装。
   *
   * ⚠️ 属性值的形状并不统一（有的给标量、有的包一层 `.value`），
   * 解析一律走 `settingsStore` 里的 `pickValue` / `toBool` / `toNumber`。
   */
  applyUserProperties?: (properties: Record<string, unknown>) => void;
};

/** `window.wallpaperPropertyListener` 的挂载点（非 WE 环境为 undefined） */
declare global {
  interface Window {
    wallpaperPropertyListener?: WallpaperPropertyListener;
  }
}

/**
 * ★★ 保证 `window.wallpaperPropertyListener` 存在（幂等）。**本项目的统一入口**，
 * 本模块（挂 `setPaused`）与 `settingsStore`（挂 `applyUserProperties`）都走它。
 *
 * ## 为什么必须**我们自己建**这个对象（2026-09-26 真机取证）
 *
 * 官方口径：这个对象是**壁纸作者创建的**，不是 WE 创建的。
 *   - WE 文档给的写法就是 `window.wallpaperPropertyListener = { applyUserProperties(){…} }`；
 *   - 官方自带工程 `corsair_o_tron/js/main.js:328` 同样是壁纸自己
 *     `window.wallpaperPropertyListener = { … }`。
 *
 * WE 的注入脚本是**往这个对象上补方法**（`setPaused` / `applyUserProperties` /
 * `applyGeneralProperties` / `userDirectoryFilesAddedOrChanged`…），形如
 * `window.wallpaperPropertyListener.applyUserProperties = …`。
 * 对象不存在 ⇒ 这些赋值全是 `undefined.xxx` ⇒ 注入整段中断 ⇒
 * **属性面板里怎么勾都不生效**。
 *
 * 真机证据（43/44 号取证，读 CEF leveldb）：
 *   - 未自建时：`wpl` 从 0.5s 到 4s 全程 `undefined`，`navN=1`（页面没重载过）、无脚本报错；
 *     但同一宿主注入的 `___wpxUnpause` / `wallpaperRegisterAudioListener` 都是 function
 *     ⇒ 注入脚本**跑过**，只卡在给 listener 补方法这一步。
 *   - 在 bundle 之前补一句 `… = … || {}` 后：WE 随即补齐 `applyUserProperties` +
 *     `applyGeneralProperties` 并**真的调用**，实测入参含
 *     `bgmEnabled / bgmVolume / showSettings / subtitleEnabled / subtitlePosition / voiceEnabled`
 *     全部自定义键，重载一次后依然有效。
 *     （★ 这是**当时**实测到的入参快照 —— 其中 `showSettings` 已于 2026-10-17 晚从属性表删除；
 *      该列表只作为"WE 确实会把自定义键全量下发"的证据，**不是**当前属性表的清单。）
 *
 * ## 为什么用 `___wpxUnpause` 当"是否跑在 WE 里"的闸门
 *
 * 那个全局只可能由 WE 注入脚本创建（普通浏览器恒为 undefined）。
 * 拿它当闸门 ⇒ **普通浏览器里不会凭空多出一个 listener 对象**，
 * `isPauseSignalArmed()` 作为"是否跑在 WE 里"的环境判据才不会失真。
 *
 * @returns 宿主 listener 对象；非 WE 环境返回 `null`（调用方应静默跳过）
 */
export const ensureWallpaperPropertyListener = (): WallpaperPropertyListener | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  // ① 宿主/壁纸已经建过（含验证脚本用 addScriptToEvaluateOnNewDocument 预注入的场景）
  //    ⇒ 直接用它，只补字段，绝不整体替换（会丢别人早先挂的回调）。
  if (window.wallpaperPropertyListener) {
    return window.wallpaperPropertyListener;
  }

  // ② 还没建 ⇒ 先确认"是不是真的跑在 WE 里"。判据用 WE 注入脚本**专有**的全局：
  //    普通浏览器里这两个恒为 undefined ⇒ 不会凭空造出一个 listener ⇒
  //    isPauseSignalArmed() 作为环境判据不失真。
  const w = window as unknown as {
    ___wpxUnpause?: unknown;
    wallpaperRegisterAudioListener?: unknown;
  };
  const isWeHost =
    typeof w.___wpxUnpause === 'function' ||
    typeof w.wallpaperRegisterAudioListener === 'function';
  if (!isWeHost) {
    // 普通浏览器预览：维持"没有宿主对象"的原状，靠 visibilitychange 兜底
    return null;
  }

  window.wallpaperPropertyListener = {};
  return window.wallpaperPropertyListener;
};

/**
 * 往 `window.wallpaperPropertyListener` 上**补一个字段**，带重试（幂等）。
 *
 * ## 为什么需要重试
 *
 * WE 的注入脚本不一定在 bundle 之前跑完：早期真机取证里 `wpl` 从 0.5s 到 4s
 * 全程 `undefined`，之后才被补上。所以"挂一次、失败就放弃"会静默丢信号。
 *
 * ## 为什么收敛到这里（而不是每个模块各写一份）
 *
 * `settingsStore.installWallpaperPropertyListener`（`applyUserProperties`）、
 * `weFps.installWeFpsSignal`（`applyGeneralProperties`）、
 * `wePauseSignal.install`（`setPaused`）三处都需要同一套"补字段 + 重试"。
 * 各自抄一遍就会出现三份 200ms × 25 的循环 —— 这正是本文件头注释里
 * 收敛"单赋值信号"的同一个理由。
 *
 * @param apply 拿到 listener 对象后要做的补字段动作（可重复调用，必须幂等）
 * @param retryMs 重试间隔（毫秒）；`0` = 不重试
 * @param maxRetries 最多重试次数
 */
export const withWallpaperPropertyListener = (
  apply: (wpl: WallpaperPropertyListener) => void,
  retryMs = 200,
  maxRetries = 25
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const tryAttach = (): boolean => {
    const wpl = ensureWallpaperPropertyListener();
    if (!wpl) {
      return false;
    }
    apply(wpl);
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

/** 订阅者：`true` = 已暂停 */
export type PauseListener = (isPaused: boolean) => void;

const listeners: PauseListener[] = [];
/** `setPaused` 是否已装上（= 我们是否已接管宿主信号） */
let armed = false;
/** 最近一次宿主下发的暂停态（供订阅者在订阅时对齐，也供探针读） */
let paused = false;

/**
 * 装一次 `wpl.setPaused`（幂等）。
 *
 * ★ 只**补字段、绝不整体替换**：WE 早先可能已在同一对象上挂了
 * `applyUserProperties` / `applyGeneralProperties`，整体覆盖会把它们一起丢掉。
 */
const install = (): boolean => {
  const wpl = ensureWallpaperPropertyListener();
  if (!wpl) {
    return false;
  }
  wpl.setPaused = (isPaused: boolean) => {
    paused = !!isPaused;
    // ★ 快照遍历：订阅者回调里可能反订阅（dispose），边遍历边改数组会漏发
    listeners.slice().forEach((fn) => fn(paused));
  };
  armed = true;
  return true;
};

/**
 * 订阅 WE 的暂停 / 恢复信号。
 *
 * 幂等安装：第一个订阅者到来时装 `setPaused`，最后一个退订时摘掉
 * （摘掉的是**我们装的字段**，不是整个 listener 对象 —— 那个对象归 WE 所有）。
 *
 * @returns 退订函数（幂等）
 */
export const subscribePause = (cb: PauseListener): (() => void) => {
  listeners.push(cb);
  if (!armed) {
    install();
  }
  return () => {
    const at = listeners.indexOf(cb);
    if (at >= 0) {
      listeners.splice(at, 1);
    }
    if (!listeners.length && armed) {
      armed = false;
      if (typeof window !== 'undefined' && window.wallpaperPropertyListener) {
        delete window.wallpaperPropertyListener.setPaused;
      }
    }
  };
};

/** 当前是否处于 WE 暂停态（未收到过信号时为 `false`） */
export const isPaused = (): boolean => paused;

/**
 * WE 宿主是否已接管暂停（即 `setPaused` 已装上）。
 *
 * 供探针/验证脚本判"这是 WE 环境还是普通浏览器"——**不猜环境，读事实**。
 */
export const isPauseSignalArmed = (): boolean =>
  armed &&
  typeof window !== 'undefined' &&
  !!window.wallpaperPropertyListener &&
  typeof window.wallpaperPropertyListener.setPaused === 'function';
