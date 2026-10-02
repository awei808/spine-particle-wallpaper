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
 * 背景音乐播放器（单个 `<audio>` 元素，循环播放）。
 *
 * ## 与 `voicePlayer.ts` 的差异（有意为之）
 *
 * | 维度 | 语音 | BGM |
 * |---|---|---|
 * | 元素数 | 1（互斥，播新停旧） | 1（**常驻**，不换源） |
 * | `loop` | 否（单次） | **是**（循环到天荒地老） |
 * | `preload` | `none`（10 条太重，按需加载） | **`auto`**（只有 1 条，提前缓冲） |
 * | 生命周期 | 随时 `play(file)` | **只 `start()` 一次**，之后只有暂停/恢复 |
 *
 * 刻意**不复用** `voicePlayer`：两者语义不同（语音是"播一条就完"，BGM 是"一直响"），
 * 硬塞进一个类会到处 `if (isBgm)`。宁可 40 行重复，不要一个带分支的通用播放器。
 *
 * ## ★ 浏览器自动播放限制（与语音同源，但后果更严重）
 *
 * 首次打开壁纸时页面**尚无任何用户交互**（WE 里通常永远不会有），
 * `play()` 会以 `NotAllowedError` 被拒。
 *
 * 语音被拒顶多"这次没声音"，BGM 被拒就是**整场无声**，所以这里比 `voicePlayer`
 * 多做一步：**注册一次性交互监听**，首次 `pointerdown`/`keydown`/`touchstart`
 * 时自动重试 `start()`。这样"首次被拒 ⇒ 用户点一下热区就响起来"，
 * 而不是必须刷新页面。WE 侧若给了交互（点击壁纸）也能自然解锁。
 *
 * ## ★ 暂停/恢复：控制权已交给 `audioMaster`（2026-10-03）
 *
 * WE 里 `visibilitychange` **不会触发** —— 壁纸窗口始终"可见"，WE 暂停壁纸的方式是
 * 冻结渲染进程 + 调 `window.wallpaperPropertyListener.setPaused(true)`，
 * 并没有把文档变成 hidden。
 *
 * （WE 官方文档的 `setPaused` 条目有句 "not strictly needed as WE will fully freeze
 * the process" —— 那句对**渲染**成立，但音频解码常驻宿主侧，不受冻结影响，
 * 所以"不处理也行"这个说法对本场景**不成立**。Steam 社区帖里官方自己给的解法就是挂
 * `setPaused` 手动 `audio.pause()`。）
 *
 * ★ **本模块不再自己订阅任何宿主信号**。原先 `start()` 里的 `armWallpaperPause()`
 *   已删除，改由 `audioMaster` 统一驱动 BGM + 角色语音（见 `audioMaster.ts`
 *   顶部说明：以前"谁响起谁自己挂信号"，漏一路就静默失效 —— 现象就是
 *   暂停时 BGM 停了、语音还在念）。
 *
 * 对外的 `pause()` / `resume()` 语义**完全不变**（仍是幂等、仍记"暂停前在播"），
 * 所以现有验证脚本与设置面板链路都不受影响。
 */

import { BgmConfig } from './config.type';
import { isPauseSignalArmed } from './wePauseSignal';

/**
 * ★ `WallpaperPropertyListener` 类型与 `ensureWallpaperPropertyListener()`
 * 已于 2026-09-27 迁到 `wePauseSignal.ts` —— 那里是 `setPaused` 的**唯一安装点**，
 * 类型定义与 `declare global` 跟着走，才能守住"全局增补只有一处"的硬约束。
 * 本模块改为订阅那个信号（`subscribePause`），不再自己写 `wpl.setPaused = …`。
 *
 * ★★ 2026-10-03：连**订阅**也一并交出去了 —— 现在由 `audioMaster` 统一驱动
 *   本模块的 `pause()` / `resume()`，本模块对宿主信号**零依赖**。
 *   保留 `isPauseSignalArmed` 的导入仅供 `hasWallpaperPause()` 报"宿主是否接管了暂停"。
 */

export type BgmPlayer = {
  /** 开始循环播放（幂等：已在播则什么都不做） */
  start: () => void;
  /** 暂停（幂等；记下"暂停前在播"，供 `resume()` 判断） */
  pause: () => void;
  /** 恢复播放（幂等；仅当此前是播放态） */
  resume: () => void;
  /** 当前是否正在播放 */
  isPlaying: () => boolean;
  /** 当前播放位置（秒）。元素未创建时为 0 */
  currentTime: () => number;
  /** 音频总时长（秒）。未加载完为 NaN */
  duration: () => number;
  /** 运行时改音量（0~1） */
  setVolume: (v: number) => void;
  /** 当前音量 */
  getVolume: () => number;
  /**
   * WE 宿主是否已接管暂停（即 `setPaused` 已装上）。
   *
   * 供探针/验证脚本判"这是 WE 环境还是普通浏览器"——**不猜环境，读事实**。
   */
  hasWallpaperPause: () => boolean;
  dispose: () => void;
};

/** 从 `BgmConfig.file`（形如 `bgm/foo.ogg` 或 `foo.ogg`）取文件名 */
export const bgmBasename = (filePath: string): string => {
  if (!filePath) {
    return '';
  }
  const parts = filePath.split('/');
  return parts[parts.length - 1] ?? '';
};

/** 未启用或没配文件时返回 `null`，调用方判空即可 */
export const createBgmPlayer = (cfg?: BgmConfig): BgmPlayer | null => {
  if (cfg?.enabled === false) {
    return null;
  }
  const file = bgmBasename(cfg?.file ?? '');
  if (!file) {
    // 没配文件 = 没得播。静默返回 null（与 subtitle.audio 不配就无声同一口径）
    return null;
  }
  const basePath = cfg?.path ?? './assets/bgm/';
  const initialVolume = typeof cfg?.volume === 'number' ? cfg.volume : 0.5;
  const loop = cfg?.loop !== false; // 缺省循环

  let el: HTMLAudioElement = null;
  /** 当前音量（`ensure()` 创建元素时写进去；`setVolume` 也改它） */
  let volume = initialVolume;
  /** 自动播放被拒只警告一次，避免刷屏 */
  let warnedAutoplay = false;
  /** ★ "暂停前是否在播" —— 决定 `resume()` 该不该续播 */
  let wasPlaying = false;
  /** 是否已解锁过（首次交互后置位，避免重复重试） */
  let unlocked = false;

  const ensure = (): HTMLAudioElement => {
    if (el) {
      return el;
    }
    el = document.createElement('audio');
    // ★ 只有 1 条、且一开场就要响 ⇒ 提前缓冲（语音侧是 none，因为 10 条太重）
    el.preload = 'auto';
    el.loop = loop;
    el.volume = volume;
    el.src = basePath + file;
    // 不进 DOM（Chrome/CEF 均支持无声元素播放），避免干扰页面结构
    return el;
  };

  /** 首次用户交互时自动重试（只挂一次、只解一次锁） */
  const armUnlock = () => {
    const onInteract = () => {
      unlocked = true;
      // 交互已获得 ⇒ 直接重试。成功与否都由 play() 内部判（不再重复 warn）
      const audio = ensure();
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* 交互后仍失败（极少见）不再刷屏 */
        });
      }
      document.removeEventListener('pointerdown', onInteract, true);
      document.removeEventListener('keydown', onInteract, true);
      document.removeEventListener('touchstart', onInteract, true);
    };
    document.addEventListener('pointerdown', onInteract, true);
    document.addEventListener('keydown', onInteract, true);
    document.addEventListener('touchstart', onInteract, true);
  };

  const start = () => {
    if (el && !el.paused) {
      return; // 幂等
    }
    // ★ 不在这里订阅任何宿主信号 —— 由 `audioMaster` 统一驱动（见文件头说明）。
    //   副作用是"此刻若正处于暂停态"，`start()` 仍会把 BGM 放起来。
    //   这不会发生：`audioMaster.register()` 在登记时就已对齐过当前暂停态，
    //   且 WE 暂停时 rAF 停摆 ⇒ 本函数在暂停期间根本不会被调用。
    const audio = ensure();
    wasPlaying = true;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err: Error) => {
        wasPlaying = false;
        if (!warnedAutoplay) {
          warnedAutoplay = true;
          console.warn(
            '[bgm] 背景音乐被浏览器拒绝（自动播放限制，需先有用户交互）: %s。' +
              '已挂一次性交互监听，首次点击/按键后会自动重试。',
            err?.name ?? err
          );
        }
        if (!unlocked) {
          armUnlock();
        }
      });
    }
  };

  const pause = () => {
    if (!el) {
      return;
    }
    // ★ 幂等：两路信号（WE setPaused + visibilitychange）可能都触发。
    //   若不判就无条件 `wasPlaying = !el.paused`，第二次调用会把已经写好的
    //   `wasPlaying=true` 覆盖成 `false`（因为 el.paused 这时已是 true）⇒ 恢复不了。
    if (el.paused) {
      return;
    }
    wasPlaying = true;
    try {
      el.pause();
    } catch (e) {
      // 未加载源时 pause 一般安全，但保险起见吞掉
    }
  };

  const resume = () => {
    // ★ 只在"此前在播"时续播：避免把 enabled:false / 从未 start 的场景唤醒
    if (!wasPlaying || !el) {
      return;
    }
    // 幂等：已在播就别再调 play()（省一次 promise + 避免重复触发解锁路径）
    if (!el.paused) {
      return;
    }
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* 恢复被拒（如仍无交互）静默 —— 交互监听已在 armUnlock 里兜底 */
      });
    }
  };

  return {
    start,
    pause,
    resume,
    isPlaying: () => !!el && !el.paused,
    currentTime: () => (el ? el.currentTime : 0),
    duration: () => (el ? el.duration : Number.NaN),
    setVolume: (v: number) => {
      volume = Math.max(0, Math.min(1, v));
      if (el) {
        el.volume = volume;
      }
    },
    getVolume: () => volume,
    hasWallpaperPause: isPauseSignalArmed,
    dispose: () => {
      if (el) {
        try {
          el.pause();
        } catch (e) {
          /* ignore */
        }
        el.removeAttribute('src');
        el = null;
      }
      wasPlaying = false;
      // ★ 无需退订：本模块 2026-10-03 起不再自己订阅 `subscribePause`，
      //   暂停/恢复一律由 `audioMaster` 驱动（那边 `dispose()` 时统一退订）。
    },
  };
};
