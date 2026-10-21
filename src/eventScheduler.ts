/**
 * 事件调度：**竞争层**（`selectEvent`）+ **限流层的状态**（`eventLog`）。
 *
 * 本文件只有纯函数与状态类型，**不碰 DOM、不碰骨架**（PLAN §10 / S5）。
 * 落点由 `index.ts` 的 `resolveEvent` 统一调用 —— 三个通道不再各写一套抽取逻辑。
 *
 * ## 关键口径（PLAN §4.2）
 *
 * | 点 | 口径 |
 * |---|---|
 * | 缺省 | `priority:0 / weight:1` ⇒ 与旧 `pickRandomFromPool` **完全等价** |
 * | 优先级 | 先取**最高档**，同档再按 `weight` 加权随机 |
 * | `weight:0` | **不参与自动抽取**（只能 `__WB_DIALOGUE__.trigger` 手动播） |
 * | 冷却 / 配额 | 在**收集阶段**剔除，不进排序（否则"高优先级但被冷却拦下"会让本次空转） |
 * | 计时 | `Date.now()`，**不用 rAF** —— WE 暂停时 rAF 停、`Date.now()` 继续走 |
 * | 互斥组 | 同组**同一 tick** 至多出一条 |
 *
 * ## 为什么 `commit` 与 `allows` 分开
 *
 * `allows` 只是**预测**（"这条现在能不能抽"），真正扣配额/写冷却必须在
 * `touchController.trigger()` **真的播起来之后**（返回 true）—— 否则一次
 * "被忙碌闸门拒绝"的抽取会白白吃掉一次配额，表现为"配了 quota 却一次都不播"。
 */

import {
  ConditionContext,
  DialogueEntry,
  EventKey,
  TriggerChannel,
  TriggerEventKind,
} from './config.type';
import { channelsOf, eventKeyOf, kindOf } from './eventModel';
import { compileCondition } from './conditions';

export const PRIORITY_DEFAULT = 0;
export const WEIGHT_DEFAULT = 1;

/** 事件的优先级（缺省 0） */
export const eventPriority = (e: DialogueEntry): number =>
  typeof e?.pick?.priority === 'number' && isFinite(e.pick.priority)
    ? e.pick.priority
    : PRIORITY_DEFAULT;

/** 事件的权重（缺省 1；`0` 是**合法**的"不自动抽"） */
export const eventWeight = (e: DialogueEntry): number =>
  typeof e?.pick?.weight === 'number' && isFinite(e.pick.weight)
    ? Math.max(0, e.pick.weight)
    : WEIGHT_DEFAULT;

/* ══════════════════════════════════════════════════════════════════════
 * 竞争层：选谁
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 从**已过 ①~③ 层**的候选里选一条；没有可选 ⇒ `null`。
 *
 * 算法（PLAN §4.2 的代码，逐行照抄语义）：
 *   ① 先剔掉 `weight <= 0`（`weight:0` = 只能手动 trigger）；
 *   ② 在**剩下的人里**取 `priority` 最高档；
 *   ③ 按 `weight` 加权随机（`rnd ∈ [0,1)` 可注入）。
 *
 * ## ★★ 为什么 ① 必须在 ② 之前（2026-10-18 修复的真实 bug）
 *
 * 旧顺序是"先取最高档 → 再在档内剔 weight:0"。只要**最高档里全是 `weight:0`**
 * 的条目，档内就空了 ⇒ 返回 `null` ⇒ **整条通道彻底哑掉**，而且不会回落到次档。
 *
 * 实战触发条件极普通：一条 `pick:{priority:80, weight:0}` 的"仅手动"事件
 * （S9 的 `custom:hold-hand` 正是）就会让**所有点击**失效 —— 触摸池 7 条、
 * 全部正常，却怎么点都没反应；`skippedCount / firedCount` 都是 0，日志一声不吭。
 * ⇒ `weight:0` 的语义是"我**不参加**自动抽取"，那它连"占一个档位"都不该做到。
 *
 * ★ 浮点边界兜底返回**档内最后一条**（与候选顺序无关的错误方向固定，便于断言）。
 */
export const selectEvent = (
  ready: readonly DialogueEntry[],
  rnd: () => number = Math.random
): DialogueEntry | null => {
  if (!ready || !ready.length) {
    return null;
  }
  /** ① `weight:0` 在这一步就出局（不是"进档再剔"） */
  const eligible = ready.filter((e) => eventWeight(e) > 0);
  if (!eligible.length) {
    /** 全是 `weight:0` ⇒ 自动通道永不选中 */
    return null;
  }
  /** ② 最高档只在 `eligible` 里算 */
  let top = PRIORITY_DEFAULT;
  eligible.forEach((e) => {
    const p = eventPriority(e);
    if (p > top) {
      top = p;
    }
  });
  const tier = eligible.filter((e) => eventPriority(e) === top);
  const total = tier.reduce((s, e) => s + eventWeight(e), 0);
  let r = rnd() * total;
  for (let i = 0; i < tier.length; i++) {
    r -= eventWeight(tier[i]);
    if (r < 0) {
      return tier[i];
    }
  }
  return tier[tier.length - 1];
};

/* ══════════════════════════════════════════════════════════════════════
 * 限流层的状态：事件日志
 * ══════════════════════════════════════════════════════════════════════ */

/** 单条事件的运行记录 */
export type EventLogEntry = {
  /** 上次**真的播出去**的时刻（毫秒，`Date.now()`） */
  lastAt: number;
  /** `quota.ever` 的累计（持久化） */
  total: number;
  /** 本会话内的次数（**不持久化**：`quota.session` 的语义就是"这次开机"） */
  session: number;
  /** `quota.day` 的日期键（`YYYY-MM-DD`） */
  day: string;
  /** 该日期键下的次数（持久化） */
  dayCount: number;
};

export type EventLogState = {
  version: 1;
  entries: { [key: string]: EventLogEntry };
  /** 互斥组 → 最后一次消费它的 tick 号 */
  groups: { [group: string]: number };
};

export const EVENT_LOG_STORAGE_KEY = 'wb.swe.eventlog.v1';

/** 最小存储接口（Node 单测传 `null`；浏览器传 `window.localStorage`） */
export type LogStorage = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
};

const emptyEntry = (): EventLogEntry => ({
  lastAt: 0,
  total: 0,
  session: 0,
  day: '',
  dayCount: 0,
});

/** 本地日期键（**按本地时区**跨零点重置 —— 用户说的"每天"就是本地每天） */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (
    d.getFullYear() +
    '-' +
    (m < 10 ? '0' + m : m) +
    '-' +
    (day < 10 ? '0' + day : day)
  );
};

export type EventLog = {
  /** 开一个新 tick（互斥组的作用域）；返回 tick 号 */
  beginTick: () => number;
  /** 当前 tick 号 */
  tick: () => number;
  /** 预测：这条现在能不能被自动抽中（不动状态） */
  allows: (e: DialogueEntry, nowMs: number) => boolean;
  /** 真播之后记账（写冷却 / 配额 / 互斥组） */
  commit: (e: DialogueEntry, nowMs: number) => void;
  /** 读某条记录（探针/档案用；没有 ⇒ `undefined`） */
  peek: (key: EventKey) => EventLogEntry | undefined;
  /** 整份快照（只读拷贝） */
  snapshot: () => EventLogState;
  /** 清空（回归/调试用） */
  reset: () => void;
};

/**
 * 创建事件日志。
 *
 * @param storage `localStorage`（`quota.ever` / `quota.day` 跨重载生效）；
 *                `null` ⇒ 纯内存（单测、隐私模式、localStorage 抛异常时）
 */
export const createEventLog = (storage?: LogStorage | null): EventLog => {
  let state: EventLogState = { version: 1, entries: {}, groups: {} };
  let tick = 0;

  /** 读盘：任何异常都退回内存态（WE 里 localStorage 可能被策略禁用） */
  try {
    const raw = storage ? storage.getItem(EVENT_LOG_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as EventLogState;
      if (parsed && parsed.version === 1 && parsed.entries && parsed.groups) {
        state = parsed;
        /** `session` 从不持久化（它表示"这次开机"） */
        Object.keys(state.entries).forEach((k) => {
          state.entries[k].session = 0;
        });
      }
    }
  } catch (err) {
    state = { version: 1, entries: {}, groups: {} };
  }

  const save = (): void => {
    if (!storage) {
      return;
    }
    try {
      const copy: EventLogState = { version: 1, entries: {}, groups: {} };
      Object.keys(state.entries).forEach((k) => {
        const e = state.entries[k];
        copy.entries[k] = { ...e, session: 0 };
      });
      copy.groups = { ...state.groups };
      storage.setItem(EVENT_LOG_STORAGE_KEY, JSON.stringify(copy));
    } catch (err) {
      /** 写失败不影响本次会话（只是重载后配额会重置） */
    }
  };

  const get = (key: EventKey): EventLogEntry =>
    state.entries[key] ?? (state.entries[key] = emptyEntry());

  return {
    beginTick: () => ++tick,
    tick: () => tick,
    allows: (e, nowMs) => {
      const key = eventKeyOf(e);
      if (!key) {
        return false;
      }
      const rec = state.entries[key];
      const pick = e.pick;

      /** ③-a 互斥组：本 tick 已经出过同组的一条 */
      if (pick?.group && state.groups[pick.group] === tick) {
        return false;
      }
      if (!rec) {
        return true;
      }
      /** ③-b 冷却 */
      if (pick?.cooldownMs && rec.lastAt > 0) {
        /**
         * ★★ 2026-10-21：**时钟回退**（把系统日期改到 `lastAt` 之前）会让
         *   `nowMs - rec.lastAt` 变成负数，而负差恒 `< cooldownMs` ⇒ 这条事件
         *   **永久冷却**，且没有任何日志。改系统日期做节日验收时会稳定踩到。
         *   口径：负差 = "上次播放发生在未来" ⇒ 冷却已无意义，直接放行。
         */
        const dt = nowMs - rec.lastAt;
        if (dt >= 0 && dt < pick.cooldownMs) {
          return false;
        }
      }
      /** ③-c 配额 */
      const quota = pick?.quota;
      if (quota && quota.max > 0) {
        if (quota.per === 'session' && rec.session >= quota.max) {
          return false;
        }
        if (quota.per === 'ever' && rec.total >= quota.max) {
          return false;
        }
        if (quota.per === 'day') {
          const today = dayKey(nowMs);
          if (rec.day === today && rec.dayCount >= quota.max) {
            return false;
          }
        }
      }
      return true;
    },
    commit: (e, nowMs) => {
      const key = eventKeyOf(e);
      if (!key) {
        return;
      }
      const rec = get(key);
      const today = dayKey(nowMs);
      rec.lastAt = nowMs;
      rec.total += 1;
      rec.session += 1;
      if (rec.day !== today) {
        rec.day = today;
        rec.dayCount = 0;
      }
      rec.dayCount += 1;
      if (e.pick?.group) {
        state.groups[e.pick.group] = tick;
      }
      save();
    },
    peek: (key) => state.entries[key],
    snapshot: () => JSON.parse(JSON.stringify(state)) as EventLogState,
    reset: () => {
      state = { version: 1, entries: {}, groups: {} };
      tick = 0;
      save();
    },
  };
};

/* ══════════════════════════════════════════════════════════════════════
 * 漏斗本体（PLAN §4.2 的 ①~④）
 *
 * ★ 2026-10-18 从 `index.ts` 抽出来：**纯函数 + 显式状态** ⇒ 回归可以拿真实实现
 *   对照旧 `pickRandomFromPool`（`_regress/84`），而不是在测试里复刻一份漏斗。
 * ══════════════════════════════════════════════════════════════════════ */

/** 条件编译缓存（按条目对象；条目在生命周期内不变） */
const compiledCache = new WeakMap<
  DialogueEntry,
  (now?: Date, ctx?: ConditionContext) => boolean
>();

const compiledWhen = (
  e: DialogueEntry
): ((now?: Date, ctx?: ConditionContext) => boolean) => {
  let fn = compiledCache.get(e);
  if (!fn) {
    fn = compileCondition(e.when);
    compiledCache.set(e, fn);
  }
  return fn;
};

export type ResolveOptions = {
  channel: TriggerChannel;
  /** 该通道**勾选且可用**的类别（`resolveTriggerKinds` 的产物） */
  kinds: readonly TriggerEventKind[];
  ctx?: ConditionContext;
  /** 注入时钟（回归用）；缺省 `new Date()` */
  now?: Date;
  /** `reject` 的事件键集合（校验产物） */
  unplayable?: { [key: string]: boolean };
  /** 限流状态；不传 ⇒ 不判冷却/配额/互斥组 */
  log?: EventLog;
};

/**
 * 收集**过了 ①~③ 层**的候选（不排序、不记账）。
 *
 * 顺序写死：权限 → 条件 → 限流；`kind` 判据用 `kindOf(e, channel)`。
 *
 * ## ★★ 2026-10-21：`on` **不再限制通道**（B 案，开源口径「把权限放开」）
 *
 * 从前这里有一条 `channelsOf(e).indexOf(channel) < 0 ⇒ 丢弃`。它与设置面板
 * 「事件池」页的三行**类别多选**是两根不同的轴，撞在一起就出了静默失效：
 * 面板说"待机勾 touch 类就能播"，而 `events.jsonc` 里每条内置事件的 `on` 都是
 * 迁移时从旧三池（`touch` / `chat` / `greeting`）**1:1 反推**成单通道的
 * ⇒ 跨类选择在漏斗里被整条挡光（触摸通道还会退化成"只播动画、没声音"）。
 *
 * 现在唯一的口径是：**`kind` 管类别（唯一筛子），`on` 只是一份"分组 / 来源"标记**
 * （缺省 `kind` 由 `on[0]` 推、档案与调试面板按它分组显示）。
 * 作者若真要"这条只准某个信号/热区触发"，请用条件而不是通道：
 * `when.ctx.signal`（boot / visible / focus / resume）、`when.ctx.zone`（热区 id）——
 * 那两条在闸门撤掉之后依然有效（见 `conditions.ts`）。
 *
 * ⚠️ 唯一保留的 `on` 判据是**非空**：`on: []` 仍永远抽不到 —— 与 `index.ts` 的
 * `poolOfKind`、`eventModel` 的 `W_ORPHAN`、档案的「不可达」完全同一口径。
 * 这条不能省：否则"池/档案里查不到、运行时却在播"会成为新的静默谎言。
 *
 * ⚠️ 放开后的已知代价（作者侧）：`pick.priority` 是**全局档位**，不再按通道隔离
 * ⇒ 一条 `priority: 20` 的触摸事件会夺走待机/问候的档位（`weight: 0` 除外）。
 * 要把某条约束在某个入口，只能靠 `when`。
 */
export const collectCandidates = (
  events: readonly DialogueEntry[],
  options: ResolveOptions
): DialogueEntry[] => {
  const { channel, kinds } = options;
  if (!kinds.length) {
    return [];
  }
  const now = options.now ?? new Date();
  const ctx = options.ctx ?? {};
  const unplayable = options.unplayable ?? {};
  const ready: DialogueEntry[] = [];
  events.forEach((e) => {
    /** ① 权限层 */
    if (e.enabled === false) {
      return;
    }
    const key = eventKeyOf(e);
    if (!key || unplayable[key]) {
      return;
    }
    /**
     * ★★ 2026-10-21：**不再判"包含本通道"** —— `on` 只是分组标记，不是一个闸门。
     * 只保留"非空 = 可达"（`on: []` 是显式的"这条不播"，见函数注释）。
     */
    if (!channelsOf(e).length) {
      return;
    }
    if (kinds.indexOf(kindOf(e, channel)) < 0) {
      return;
    }
    /** ② 条件层 */
    if (!compiledWhen(e)(now, ctx)) {
      return;
    }
    /** ③ 限流层 */
    if (options.log && !options.log.allows(e, now.getTime())) {
      return;
    }
    ready.push(e);
  });
  return ready;
};

/**
 * 漏斗终点：①~③ 收集 + ④ 竞争。返回"这一 tick 该播哪条"。
 *
 * ⚠️ **不记账**（不写冷却/配额）—— 记账由调用方在**真的播出去之后**做
 *   （`touchController.trigger` 返回 true），否则被忙碌闸门拒绝的抽取会白吃配额。
 */
export const resolveEventFrom = (
  events: readonly DialogueEntry[],
  options: ResolveOptions,
  rnd: () => number = Math.random
): DialogueEntry | null => {
  if (options.log) {
    options.log.beginTick();
  }
  const ready = collectCandidates(events, options);
  return selectEvent(ready, rnd);
};
