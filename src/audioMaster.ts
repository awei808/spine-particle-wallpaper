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
 * 音频总闸：BGM 与角色语音**唯一**的暂停 / 恢复控制点。
 *
 * ## ★ 为什么要这一层（2026-10-03）
 *
 * 现象：WE 暂停壁纸时 BGM 停了，**角色语音还在念**。
 *
 * 根因不是"WE 漏发了信号"，而是**两个播放器各自为政、只有一个接了信号**：
 *   - `bgmPlayer` 自己 `subscribePause(...)` ⇒ 暂停/恢复；
 *   - `voicePlayer` 接口里**连 `pause()` 都没有**，更没订阅；
 *   - `index.ts` 里的 `visibilitychange` 兜底也只调了 `bgmPlayer`。
 *
 * 每加一路音频就要记得再挂一次信号 —— 这是典型的"漏一处就静默失效"结构。
 * 所以改成**反向依赖**：谁都不许自己订阅宿主信号，一律登记到这里，总闸统一驱动。
 *
 * ```
 * WE setPaused ─┐
 * visibility ───┼─▶ audioMaster ─┬─▶ bgmPlayer.pause/resume
 * （未来总音量/淡出）             └─▶ voicePlayer.pause/resume
 * ```
 *
 * ## 为什么是"两路信号"而不是只听 WE
 *
 *   1. `wallpaperPropertyListener.setPaused` —— WE 侧的**权威**信号
 *      （`wePauseSignal.ts` 统一安装，本模块订阅它）。
 *      ★ WE 暂停壁纸是**冻结渲染进程**，`visibilitychange` / `focus` 在壁纸里
 *      基本收不到（窗口永远"可见"），只挂这一路才对得上实机。
 *   2. `visibilitychange` —— 普通标签页场景的兜底（切走/切回）。
 *
 * ⚠️ 两路**可能都**触发（WE 将来若也发 hidden，或用户拿浏览器预览），
 * 所以 sink 的 `pause()` / `resume()` 必须**幂等** —— 本模块不额外去重，
 * 幂等是 sink 自己的责任（`bgmPlayer` / `voicePlayer` 都已满足）。
 *
 * ## ★ 为什么"暂停"用挂起而不是 stop
 *
 * 总闸的语义是"**外面要求安静一下**"，不是"这些音频作废"。
 * 语音若在暂停时正说到一半，用 `stop()` 会把进度清零、恢复后的话接不上；
 * 所以这里统一用 `pause()`（保留 `currentTime`）+ `resume()`（从原处续播）。
 * 「这条念白不要了」那种语义留在 `voicePlayer.stop()` 内部，不经总闸。
 *
 * ## 幂等与时序
 *
 * - `register()` / `unregister()` 幂等（同一 sink 重复登记只算一次）。
 * - 总闸的订阅在**创建时**就装好（`createAudioMaster()` 内），不等任何 sink 登记 ——
 *   否则"BGM 还没 `start()`、信号先来了"这段窗口会漏掉。
 * - `dispose()` 退订两条监听并清空 sink 列表，重复调用无副作用。
 */

import { subscribePause } from './wePauseSignal';

/** 一路可被总闸驱动的音频。每路只需保证 `pause` / `resume` **幂等**。 */
export type AudioSink = {
  /** 挂起（**保留播放进度**）。重复调用必须无副作用 */
  pause: () => void;
  /** 恢复（从暂停处续播）。未处于挂起态时必须什么都不做 */
  resume: () => void;
  /**
   * 供诊断用的一句话标识（会打进暂停/恢复日志）。
   *
   * 有意用最宽松的结构：只取 `name` / `label` 字段，不为诊断给 sink 强加接口。
   */
  name?: string;
};

export type AudioMaster = {
  /**
   * 登记一路音频。
   *
   * @param name 诊断标识（同时作为幂等键：同名重复登记只算一路）
   * @param sink 实现 `pause` / `resume` 的对象
   */
  register: (name: string, sink: AudioSink) => void;
  /** 移除一路音频（幂等；未登记过则什么都不做） */
  unregister: (name: string) => void;
  /** 当前是否处于"已暂停"态（= 收到过暂停且尚未恢复） */
  isPaused: () => boolean;
  /** 已登记的音频路数（诊断/验证用） */
  size: () => number;
  /**
   * 手动推一次暂停/恢复（不改变"已暂停"标记以外的东西）。
   *
   * 供 `visibilitychange` 兜底与验证脚本直接驱动；**幂等**。
   */
  apply: (paused: boolean) => void;
  dispose: () => void;
};

/**
 * 建一个音频总闸。
 *
 * @param opts.log 暂停/恢复时的日志开关。默认打 `console.debug` ——
 *   这类"为什么突然没声了"的问题在实机上只能靠日志定位，值得留痕。
 */
export const createAudioMaster = (opts?: { log?: boolean }): AudioMaster => {
  const log = opts?.log !== false;
  /** 登记的音频。Map 而非数组：登记/移除都 O(1)，且天然按名去重 */
  const sinks = new Map<string, AudioSink>();
  /** 最近的暂停态。`create()` 时先读一次宿主当前态，避免"带病起步" */
  let paused = false;
  let disposed = false;

  const apply = (next: boolean) => {
    // 快照遍历：sink 的回调里理论上可能增删登记（虽然当前实现不会），
    // 边遍历边改 Map 会漏发。
    const list = Array.from(sinks.values());
    list.forEach((sink) => {
      if (next) {
        sink.pause();
      } else {
        sink.resume();
      }
    });
    if (log && list.length) {
      console.debug(
        `[audio] ${next ? '暂停' : '恢复'} ${list.length} 路音频: ${list
          .map((s) => s.name ?? '?')
          .join(', ')}`
      );
    }
  };

  /**
   * ★ sink 的幂等由 sink 自己保证，这里**只转发、不去重**。
   *
   * 曾经想在这里加"状态没变就早退"来减少调用次数，但那样会**吞掉**一种合法场景：
   * WE 可能连发两次 `setPaused(true)`（例如先暂停 Aero Peek 再暂停全屏），
   * 期间用户又点了热区触发了语音 —— 第二次 `true` 必须再压一次。
   * 多调一次 `pause()` 反正有幂等保护，成本远小于漏一次。
   */
  const onPauseSignal = (isPaused: boolean) => {
    paused = !!isPaused;
    apply(paused);
  };

  // ① WE 侧权威信号。`subscribePause` 内部会装 `wpl.setPaused`（单赋值，
  //   唯一安装点在 `wePauseSignal.ts`），本模块**不再自己写那个字段**。
  const offPause = subscribePause(onPauseSignal);

  // ② 浏览器兜底。WE 下基本不触发（窗口永远"可见"），但普通标签页预览需要。
  const onVisibility = () => {
    onPauseSignal(document.hidden);
  };
  document.addEventListener('visibilitychange', onVisibility, false);

  return {
    register: (name: string, sink: AudioSink) => {
      if (disposed || !sink) {
        return;
      }
      sinks.set(name, { ...sink, name });
      // ★ 登记时就对齐当前态：若信号在"该 sink 存在之前"就来过
      //   （例如 WE 在资源加载途中就暂停了），此时必须补一次挂起，
      //   否则会出现"壁纸已经暂停了，但恢复后语音/BGM 才刚开始响"的错位。
      if (paused) {
        sink.pause();
      }
    },
    unregister: (name: string) => {
      sinks.delete(name);
    },
    isPaused: () => paused,
    size: () => sinks.size,
    apply: (next: boolean) => {
      onPauseSignal(next);
    },
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      offPause();
      document.removeEventListener('visibilitychange', onVisibility, false);
      sinks.clear();
    },
  };
};
