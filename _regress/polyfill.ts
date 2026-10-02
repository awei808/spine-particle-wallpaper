/**
 * 回归测试用的**最小浏览器环境替身**。
 *
 * ★ 必须作为**第一个** import 被加载：ES import 按源码顺序求值，
 *   后面的 `src/touch.ts` / `src/idleSequence.ts` 在模块初始化时就要求
 *   `window` / `document` 已存在。
 *
 * ★ `setTimeout` 做成**同步队列**：Node 里没法边同步推帧边等异步回调。
 *   主循环每帧开头调 `flushTimers()`，等价于"上一帧结束时排的宏任务
 *   在下一帧 rAF 之前执行"——正是浏览器的真实时序
 *   （`complete` → `setTimeout(0)` → 下一帧之前跑掉）。
 */

type Timer = { id: number; fn: () => void };

const timers: Timer[] = [];
let nextId = 1;

(globalThis as any).window = {
  setTimeout: (fn: () => void) => {
    const id = nextId++;
    timers.push({ id, fn });
    return id;
  },
  clearTimeout: (id: number) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) {
      timers.splice(i, 1);
    }
  },
  innerWidth: 1700,
  innerHeight: 750,
};

(globalThis as any).document = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

/** 把当前已排队的定时器当作"下一帧之前的宏任务"全部执行（新排的留到下次） */
export const flushTimers = (): number => {
  const batch = timers.splice(0, timers.length);
  batch.forEach((t) => t.fn());
  return batch.length;
};

/** 还剩几个定时器没跑（用于判断"序列是不是卡住了"） */
export const pendingTimers = (): number => timers.length;
