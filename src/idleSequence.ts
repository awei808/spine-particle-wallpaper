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
 * 常驻动作序列 —— 用「固定动作 / 固定动作序列」顶替 idle。
 *
 * ## 为什么单独一个文件
 *
 * 与 `touch.ts`（用户触发）分工：本模块**只管 track 0**，即"角色没事干的时候在演什么"。
 *
 * ## ★ 与触摸的两种共存方式（2026-09-27）
 *
 * | 场景 | 触摸怎么播 | 本模块要做什么 |
 * |---|---|---|
 * | **未启用序列**（track 0 = idle 循环） | 叠加在 track 2 | **什么都不用做**（互不干扰，播完 `clearTrack(2)` 就露出 idle） |
 * | **启用序列**（本模块接管 track 0） | **排队到 track 0 队尾，顺序播放** | `complete` 时若发现队里有东西 ⇒ **让位不推进**；对方播完调 `resume()` 继续 |
 *
 * 为什么启用序列时要改成排队：两条轨道同时播会让 track 2 的 ColorTimeline
 * **覆盖** track 0 设好的 slot 透明度，正被序列显示着的部件会被压成透明（"部件消失"）；
 * 顺序播放则同一时刻只有一条轨道在驱动骨架，从根上没有冲突。
 *
 * ## ★ 轨道与 loop 的选择（这里最容易写错）
 *
 * | `items` 长度 | 设置 | 理由 |
 * |---|---|---|
 * | **1**（固定动作） | `setAnimation(0, name, **loop=true**)` | 就是要它**反复播同一个动作** |
 * | **> 1**（序列） | `setAnimation(0, name, **loop=false**)` + 监听 `complete` 接下一条 | loop=true 的话 `complete` 的语义变成"每圈结束"，会自己拖自己 |
 *
 * ## ★ 推进为什么走 `setTimeout` 而不是在 `complete` 回调里同步 `setAnimation`
 *
 * `complete` 是在 `AnimationState.update()` 的 apply 循环**内**同步分发的；
 * 在回调里直接改 `tracks[0]` 等于边遍历边改集合。延到一个宏任务再改，
 * 与 `gapMs > 0` 共用同一条路径（`gapMs = 0` 就是 `setTimeout(..., 0)`）。
 *
 * ## 暂停语义（**不需要**额外处理）
 *
 * WE 暂停 / 标签页隐藏时 `requestAnimationFrame` 停 ⇒ `spineAnimator.update()`
 * 不跑 ⇒ track 时间不推进 ⇒ **`complete` 不会触发** ⇒ 序列自然停住。
 * 定时器只在 `complete` 之后才排，所以隐藏期间不会有"偷偷推进"。
 * ⇒ **刻意不实现 `pause()/resume()`**：两路信号调同一个函数是重复的复杂度，
 * 而且没必要（见既有教训：两路信号 ⇒ 函数必须幂等，多写一处就多一处风险）。
 */

import * as threejsSpine from 'threejs-spine-3.8-runtime-es6';
import { DialogueEntry, IdleSequenceConfig, IdleSequenceItem } from './config.type';
import { findByActionId } from './dialogue';

/** 常驻轨道。触摸/问候/待机在 track 2，互不干扰。 */
export const IDLE_TRACK = 0;

/** 解析后的一条序列项。此时动画名已确认在骨架里存在 */
export type ResolvedSequenceItem = {
  animation: string;
  /** 该项对应的念白条目；`null` = 只播动作、不出台词 */
  entry: DialogueEntry | null;
};

export type IdleSequenceController = {
  /**
   * 本序列会播到的全部动画名。
   *
   * 给 `touch.ts` 当"可接受为常驻态"的集合 —— 序列接管 track 0 后，
   * track 0 上的名字不再恒等于 `idle`，`isIdle()` 的判据必须跟着放宽，
   * 否则**触摸会永远播不出来**（判据要求 track 0 恰好是 idle）。
   */
  animationNames: () => string[];
  /**
   * 立即切到下一条（末尾回到开头）。供探针/验证脚本用，也用于 `startIndex` 之外的手动跳转。
   *
   * ⚠️ 它是 `setAnimation`（强制切换），会**丢掉队里排着的动作**（触摸）。
   * 正常玩法不走这条路；只有在调试/验证里想强行跳转时才会付这个代价。
   */
  next: () => string;
  /**
   * 把常驻轨道交还给序列，从下一条继续。**幂等**（重复调用只生效一次）。
   *
   * ## 什么时候需要它（2026-09-27）
   *
   * 触摸动作改成「排到 track 0 队尾、顺序播放」后（见 `touch.ts` 的 `queueTrack`）：
   * 序列的 `complete` 会发现自己后面排着动作 ⇒ **主动让位、不推进**。那个排队的动作
   * 播完时必须有人喊一声"该你了" —— 就是本方法。
   *
   * @param mixSeconds 交还时给新序列 entry 设的淡入时长（0 = 硬切）。
   *        由调用方（`touch.ts`）传它自己的 `TOUCH_MIX_OUT`，避免本模块重复定义常量。
   */
  resume: (mixSeconds?: number) => void;
  snapshot: () => {
    enabled: boolean;
    /** 当前项的索引 */
    index: number;
    /** 当前项在播的动画名 */
    animation: string;
    /** 序列总长 */
    count: number;
    /** 全部项的动画名（按顺序） */
    items: string[];
    gapMs: number;
    /** 该项是否带台词（actionId 命中了念白条目） */
    hasEntry: boolean;
  };
  dispose: () => void;
};

export type IdleSequenceOptions = {
  /** 骨架里真实存在的动画名（用来过滤无效项，避免 `setAnimation` 抛错） */
  availableAnimations: string[];
  /** 念白总表，供 `actionId` 解析 */
  entries: DialogueEntry[];
  /** 每播到一项都会回调（含首项）。`entry` 为 `null` = 该项只播动作 */
  onItem?: (entry: DialogueEntry | null, animation: string) => void;
};

/** AnimationStateListener 的占位实现（本项目不关心这些事件） */
const noop: () => void = () => undefined;

/**
 * 把 config 的 `items` 解析成"确认可播"的序列。
 *
 * 容错口径与 `dialogue.ts` 的 `buildPool` 一致：**坏项静默跳过并 warn**，
 * 而不是整块失效。config 没有 schema 校验，拼错一个动画名不该让角色白屏。
 */
export const resolveSequence = (
  cfg: IdleSequenceConfig,
  options: IdleSequenceOptions
): ResolvedSequenceItem[] => {
  const raw: IdleSequenceItem[] = cfg?.items ?? [];
  const out: ResolvedSequenceItem[] = [];
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    let animation = '';
    let entry: DialogueEntry | null = null;

    if (typeof it === 'string') {
      animation = it;
    } else if (it && typeof it === 'object') {
      if (typeof it.actionId === 'number') {
        entry = findByActionId(options.entries, it.actionId);
        animation = entry?.animation ?? it.animation ?? '';
        if (typeof it.actionId === 'number' && !entry) {
          console.warn(
            '[idleSequence] items[%d] 的 actionId=%s 在 subtitle.dialogues 里查不到 ⇒ 退化为只播动作 %s',
            i,
            it.actionId,
            it.animation ?? '(空)'
          );
        }
      } else {
        animation = it.animation ?? '';
      }
    }

    if (!animation) {
      console.warn('[idleSequence] items[%d] 没给出可用的动画名 ⇒ 跳过', i);
      continue;
    }
    if (options.availableAnimations.indexOf(animation) < 0) {
      console.warn(
        '[idleSequence] items[%d] 的动画 "%s" 不在骨架里 ⇒ 跳过（可用：%s）',
        i,
        animation,
        options.availableAnimations.join(', ')
      );
      continue;
    }
    out.push({ animation, entry });
  }
  return out;
};

/**
 * 创建常驻序列播放器。
 *
 * @returns `null` = 不接管（未启用 / items 为空 / 全部项无效）⇒ 调用方保持 idle 原状
 */
export const createIdleSequence = (
  cfg: IdleSequenceConfig | undefined,
  skeletonMesh: threejsSpine.SkeletonMesh,
  options: IdleSequenceOptions
): IdleSequenceController | null => {
  if (cfg?.enabled !== true) {
    return null;
  }
  const state = skeletonMesh?.state;
  if (!state) {
    console.warn('[idleSequence] 骨架没有 AnimationState ⇒ 未启用');
    return null;
  }

  const items = resolveSequence(cfg, options);
  if (!items.length) {
    console.warn(
      '[idleSequence] items 为空或全部无效 ⇒ 未启用（角色继续播 idle）'
    );
    return null;
  }

  const gapMs = typeof cfg.gapMs === 'number' && cfg.gapMs > 0 ? cfg.gapMs : 0;
  const n = items.length;
  const isSingle = n === 1;

  let index = 0;
  if (typeof cfg.startIndex === 'number' && isFinite(cfg.startIndex)) {
    index = ((Math.floor(cfg.startIndex) % n) + n) % n;
  }

  /** 当前挂在 track 0 上的 entry；用于判断"complete 是不是这条发出的" */
  let activeEntry: threejsSpine.TrackEntry = null;
  /** 已排了推进定时器 ⇒ 不再重复排（`complete` 理论上只来一次，这里是幂等兜底） */
  let scheduled = false;
  let timer = 0;
  /** `resume()` 已排进宏任务 ⇒ 重复调用直接忽略（幂等） */
  let resumePending = false;
  /**
   * 已销毁。
   *
   * `resume()` 是**异步**的（走 `setTimeout`）：若销毁发生在"触摸播完 → resume 已排队"
   * 之后，那个还在路上的回调会把序列又拉起来。销毁后一律不再推进。
   * （当前 `index.ts` 没调 `dispose()`，这里是防御未来接入。）
   */
  let disposed = false;

  const onItem = options.onItem;

  const playIndex = (i: number, mixSeconds = 0): string => {
    index = ((i % n) + n) % n;
    const item = items[index];

    /**
     * ★ 单条 = "固定动作" ⇒ **loop=true**，且不挂推进监听
     * （loop 动画每圈结束也会进 `complete` 的分发路径，挂了就变成自己拖自己）。
     */
    const trackEntry = state.setAnimation(
      IDLE_TRACK,
      item.animation,
      isSingle ? true : false
    );
    if (!trackEntry) {
      return '';
    }
    /**
     * ★ 显式淡入：`AnimationState.ts:731` 只在 `last == null` 时才把 mixDuration 归 0，
     * 但 `last != null` 时取的是 `data.getMix()`，而本工程 `defaultMix` 恒为 0
     * ⇒ 不给就是硬切。交接（触摸动作 → 序列）时给一点淡入，避免姿态突跳。
     */
    if (mixSeconds > 0) {
      trackEntry.mixDuration = mixSeconds;
    }
    activeEntry = trackEntry;

    if (!isSingle) {
      trackEntry.listener = {
        start: noop,
        interrupt: noop,
        event: noop,
        end: () => {
          if (activeEntry === trackEntry) {
            activeEntry = null;
          }
        },
        dispose: () => {
          if (activeEntry === trackEntry) {
            activeEntry = null;
          }
        },
        complete: () => {
          if (activeEntry !== trackEntry) {
            return;
          }
          activeEntry = null;

          /**
           * ★★ 让位：轨道后面还排着动作（触摸）时**绝不能推进**（2026-09-27）。
           *
           * `setAnimation` → `setAnimationWith():590` 会 `disposeNext(current)`，
           * 而 `disposeNext():736` 是 `queue.dispose(next)` + `entry.next = null`
           * ⇒ **排队的触摸会被直接丢掉**（实测：触摸 0 帧未播）。
           *
           * 所以这里不排推进定时器，让队列自然接上；那个动作播完后会调 `resume()` 继续。
           */
          const head = state.tracks[IDLE_TRACK];
          if (head != null && head.next != null) {
            return;
          }

          if (scheduled) {
            return;
          }
          scheduled = true;
          timer = window.setTimeout(() => {
            scheduled = false;
            playIndex(index + 1);
          }, gapMs);
        },
      };
    }

    if (onItem) {
      onItem(item.entry, item.animation);
    }
    return item.animation;
  };

  playIndex(index);

  return {
    animationNames: () => items.map((it) => it.animation),
    next: () => {
      if (isSingle) {
        return items[index].animation;
      }
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      scheduled = false;
      resumePending = false;
      return playIndex(index + 1);
    },
    resume: (mixSeconds) => {
      if (disposed || resumePending) {
        return;
      }
      resumePending = true;
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      scheduled = false;
      /**
       * ★ 走一个宏任务再改 `tracks[0]`，与 `complete` → `playIndex` 同一理由：
       * 调用方是在 `AnimationState.update()` 的 apply 循环里**同步**收到 `complete` 的，
       * 在那里直接改轨道等于边遍历边改集合（见本文件顶部"推进为什么走 setTimeout"）。
       *
       * ★★ **无条件交还** —— 不看"之前有没有让位过"：
       * 单条序列（`isSingle`）走 `loop=true` 且不挂 `complete` 监听，压根不会进入让位分支，
       * 但触摸照样占着 track 0，同样需要把它捞回来。
       */
      timer = window.setTimeout(() => {
        timer = 0;
        resumePending = false;
        if (disposed) {
          return;
        }
        playIndex(index + 1, mixSeconds);
      }, 0);
    },
    snapshot: () => ({
      enabled: true,
      index,
      animation: items[index]?.animation ?? '',
      count: n,
      items: items.map((it) => it.animation),
      gapMs,
      hasEntry: !!items[index]?.entry,
    }),
    dispose: () => {
      disposed = true;
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      scheduled = false;
      resumePending = false;
      if (activeEntry) {
        activeEntry.listener = null;
        activeEntry = null;
      }
    },
  };
};
