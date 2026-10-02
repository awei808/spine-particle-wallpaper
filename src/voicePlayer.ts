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
 * 语音播放器（`<audio>` 元素池）。
 *
 * ## 为什么用元素池而不是 `new Audio()` 现建

 * 每次播放现建一个 `Audio` 对象，会不断产生新的媒体元素；快速连点时容易堆积、
 * 且旧元素的播放不会被中断（出现两条语音叠着响）。这里**只建一个元素**、
 * 播新的先把旧的 `pause()` + `currentTime = 0`，天然互斥。
 *
 * ## 为什么不预加载全部 10 条

 * 10 条 ogg 合计 684 KB，一次性 `load()` 会占 10 个媒体元素。
 * 本项目的触发频率很低（点击/待机/问候），首次播放的加载延迟可以接受，
 * 而且浏览器本身会缓存 —— 第二次起就没有延迟。保持简单。
 *
 * ## ★ 自动播放限制（必须知道，不是 bug）

 * `play()` 返回 Promise，在"用户尚未与页面交互"时会以 `NotAllowedError` 被拒。
 * 所以：
 *   - **首次打开的问候语音大概率播不出来**（此时还没有任何点击）；
 *   - 点击触发的触摸语音一定能播（点击本身就是交互）；
 *   - 待机语音取决于此前是否点过。
 *
 * 这是浏览器/CEF 的硬限制。**字幕不受影响**（DOM 不走媒体权限），
 * 而且设计上刻意让 `voiceBubble.show()` **不等待** `play()` 的 promise ——
 * 否则一次被拒就会连带字幕也不出现。
 *
 * `play()` 的拒绝是**静默吞掉**的（只在首次失败时 `console.warn` 一次），
 * 避免每次问候都在控制台刷一屏错误。
 */

import { SubtitleAudioConfig } from './config.type';

export type VoicePlayer = {
  /** 播一条语音（`file` 是文件名，如 `Asuna_Touch_Head_03.ogg`）。返回是否成功发起播放 */
  play: (file: string) => void;
  /** 立即停止当前语音（换条/收起气泡时用）——**回到开头**，语义与 `pause()` 不同 */
  stop: () => void;
  /**
   * 挂起当前语音（WE 暂停壁纸 / 标签页隐藏），**保留 `currentTime`**。
   *
   * ★ 与 `stop()` 的区别就是这一条：挂起用于"外部要求安静一下"，
   *   恢复后从原处接着说；`stop()` 用于"这条不要了"，会把进度清零。
   *   幂等（重复调用不改变状态，也不清进度）。
   */
  pause: () => void;
  /**
   * 从暂停处续播（幂等）。
   *
   * ★ 只在 `pause()` 或 `play()` 时"正在播"才续 —— 从未播过、或已被
   *   `stop()`/`dispose()` 停掉的，不会被凭空唤醒。
   */
  resume: () => void;
  /** 当前是否在播（元素未创建时为 `false`） */
  isPlaying: () => boolean;
  /** 当前播放位置（秒）。元素未创建时为 0 */
  currentTime: () => number;
  /** 运行时改音量（0~1）。会记住，供下一次 `ensure()` 建元素时使用 */
  setVolume: (v: number) => void;
  /** 当前音量 */
  getVolume: () => number;
  dispose: () => void;
};

/** 从 `DialogueEntry.voice`（形如 `CV/Asuna/Asuna_Touch_Head_03.ogg`）取文件名 */
export const voiceBasename = (voicePath: string): string => {
  if (!voicePath) {
    return '';
  }
  const parts = voicePath.split('/');
  return parts[parts.length - 1] ?? '';
};

/** 未启用时返回 `null`，调用方判空即可 */
export const createVoicePlayer = (
  cfg?: SubtitleAudioConfig
): VoicePlayer | null => {
  if (cfg?.enabled === false) {
    return null;
  }
  const basePath = cfg?.path ?? './assets/voice/';
  /** 当前音量。`setVolume` 会改它；`ensure()` 建元素时写入，故改音量后重载才彻底生效 */
  let volume = typeof cfg?.volume === 'number' ? cfg.volume : 1;

  let el: HTMLAudioElement = null;
  /** 自动播放被拒只警告一次，避免刷屏 */
  let warnedAutoplay = false;
  /**
   * ★ "暂停前是否在播" —— 决定 `resume()` 该不该续播。
   *
   * 与 `bgmPlayer` 同一口径。不能用 `!el.paused` 反推：外部的 `pause()` 幂等保护
   * 会让第二次调用看到 `el.paused === true`，从而把已记好的意图抹成"没在播"。
   */
  let wasPlaying = false;

  const ensure = (): HTMLAudioElement => {
    if (el) {
      return el;
    }
    el = document.createElement('audio');
    el.preload = 'none';
    el.volume = volume;
    // 不进 DOM 也能播（Chrome/CEF 均支持）；不 append 是为了不干扰页面结构
    return el;
  };

  const stop = () => {
    if (!el) {
      return;
    }
    try {
      el.pause();
      el.currentTime = 0;
    } catch (e) {
      // 尚未加载任何源时设 currentTime 可能抛 —— 忽略即可
    }
    // ★ 主动停止 = 这条作废 ⇒ 清掉续播意图，否则 pause() 后 stop() 再 resume()
    //   会把一条已被换掉/收起的旧语音重新放出来。
    wasPlaying = false;
  };

  const play = (file: string) => {
    if (!file) {
      return;
    }
    const audio = ensure();
    // 先停旧的：快速连点时避免两条叠着响
    stop();
    audio.src = basePath + file;
    wasPlaying = true;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err: Error) => {
        // 被自动播放策略拒 ⇒ 实际没在播，别让 resume() 白白尝试一次
        wasPlaying = false;
        if (!warnedAutoplay) {
          warnedAutoplay = true;
          console.warn(
            '[voice] 语音播放被浏览器拒绝（自动播放限制，需先有用户交互）: %s。' +
              '字幕不受影响。后续点击触发的语音可正常播放。',
            err?.name ?? err
          );
        }
      });
    }
  };

  const pause = () => {
    if (!el || el.paused) {
      return;
    }
    wasPlaying = true;
    try {
      // ★ 只 pause()，**不动 currentTime** —— 这是"从暂停处续播"的关键。
      el.pause();
    } catch (e) {
      /* 未加载源时 pause 一般安全，保险起见吞掉 */
    }
  };

  const resume = () => {
    if (!wasPlaying || !el || !el.paused) {
      return;
    }
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* 恢复被拒（WE 内通常无交互）静默 —— 字幕不受影响 */
      });
    }
  };

  return {
    play,
    stop,
    pause,
    resume,
    isPlaying: () => !!el && !el.paused,
    currentTime: () => (el ? el.currentTime : 0),
    setVolume: (v: number) => {
      volume = Math.max(0, Math.min(1, v));
      if (el) {
        el.volume = volume;
      }
    },
    getVolume: () => volume,
    dispose: () => {
      stop();
      if (el) {
        el.removeAttribute('src');
        el = null;
      }
      wasPlaying = false;
    },
  };
};
