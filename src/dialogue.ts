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
 * 念白（动作 + 字幕）的**选取逻辑**。
 *
 * 为什么单独一个文件：这里是纯函数、零副作用、零 DOM —— 便于用 Node 直接跑单测
 * （见 `_work_语音动作/` 下的验证脚本），而把"怎么画"留给 `voiceBubble.ts`、
 * 把"什么时候播"留给 `index.ts`。
 *
 * ## 三路选取
 *
 * | 场景 | 入口 | 口径 |
 * |---|---|---|
 * | 点击热区 | `pickTouchEntry` | 从 `subtitle.touch` 的 actionId 列表里**随机**取一条 |
 * | 首次打开 / 回到桌面 | `pickGreetingEntry` | 按**当前本地时刻**落在哪个时段，取对应 actionId |
 * | 空闲 N 秒 | （直接用 `subtitle.standby` 的 id 查表） | 固定条目 |
 *
 * ## ⚠️ "随机"这件事的成色
 *
 * S9 的 prefab 里**只有 1 个** `SoulSpineHitArea`（无 `_chat/_greet/_touch1` 后缀，
 * 见 `_work_热区/_out/多热区命名规律.txt` 第 22 行）。运行时是拼
 * `"SoulSpineHitArea_" .. actionName` 再 `lookupChild()`，**无后缀时走哪个兜底分支没解出来**
 * （LuaJIT 字节码被改写）。所以"1 个热区 → 随机触发 6 条"是**本工程的既定口径**
 * （用户 2026-09-17 拍板、2026-09-20 沿用），**不是游戏实证**。
 */

import {
  DialogueEntry,
  DialogueSlotKey,
  DialogueTimeRange,
} from './config.type';

/** 时段遍历顺序：按早 → 中 → 晚找第一个命中的 */
export const SLOT_ORDER: DialogueSlotKey[] = ['morning', 'noon', 'evening'];

/**
 * 缺省时段分界（本地时刻，小时）。
 *
 * ⚠️ **这是本工程用的常规值，不是解包值**。游戏里对应 `SoulSpine_MorningTime /
 * SoulSpine_NoonTime / SoulSpine_NightTime` 三个常量，但**具体时分没从字节码里解出来**，
 * 所以先用 5 / 12 / 18 这组常规分界。要改就改 `config.json` 的 `subtitle.greetingRanges`，
 * **不需要重建 bundle**。
 */
export const DEFAULT_TIME_RANGES: Record<DialogueSlotKey, DialogueTimeRange> = {
  morning: { start: 5, end: 12 },
  noon: { start: 12, end: 18 },
  evening: { start: 18, end: 5 },
};

/**
 * 判断小时是否落在时段内。**含起点、不含终点**。
 *
 * 两种边界情况都显式定义，避免"配错了导致问候永不触发"这种静默失败：
 *   - `start > end` ⇒ **跨零点**，如 `{18, 5}` = 18:00 到次日 05:00；
 *   - `start === end` ⇒ 视为**全天**（而不是空集）。
 */
export const isHourInRange = (
  hour: number,
  range: DialogueTimeRange
): boolean => {
  const h = ((hour % 24) + 24) % 24;
  const start = range.start;
  const end = range.end;
  if (start === end) {
    return true;
  }
  return start < end ? h >= start && h < end : h >= start || h < end;
};

/**
 * 当前时刻落在哪个时段。都不命中则返回 `null`
 * （`greeting` 里没配这个时段、或 `ranges` 被改坏了，都会走到这里）。
 */
export const resolveTimeSlot = (
  date: Date,
  ranges?: Partial<Record<DialogueSlotKey, DialogueTimeRange>>
): DialogueSlotKey | null => {
  const hour = date.getHours();
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    const key = SLOT_ORDER[i];
    const range = ranges?.[key] ?? DEFAULT_TIME_RANGES[key];
    if (isHourInRange(hour, range)) {
      return key;
    }
  }
  return null;
};

/** 按 actionId 在总表里查条目；查不到返回 `null`（不抛，让上层决定降级） */
export const findByActionId = (
  entries: DialogueEntry[],
  actionId: number
): DialogueEntry | null => {
  if (!entries?.length || typeof actionId !== 'number') {
    return null;
  }
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.actionId === actionId) {
      return entries[i];
    }
  }
  return null;
};

/**
 * 把 actionId 列表解析成条目池。
 *
 * 列表里指向**不存在的 id** 会被静默跳过 —— 配置写错一个字时降级成"少一条候选"，
 * 而不是整块触摸失效。这样改 config 时容错更高（config 没有 schema 校验，
 * 拼错字段名只会静默不生效，所以这一层兜底是必要的）。
 */
export const buildPool = (
  entries: DialogueEntry[],
  ids: number[]
): DialogueEntry[] => {
  if (!entries?.length || !ids?.length) {
    return [];
  }
  const pool: DialogueEntry[] = [];
  for (let i = 0; i < ids.length; i++) {
    const found = findByActionId(entries, ids[i]);
    if (found) {
      pool.push(found);
    }
  }
  return pool;
};

/**
 * 由 `subtitle.{touch,greeting,greetInTouchPool}` 解析出**触摸池的 actionId 列表**。
 *
 * 开关关闭（缺省）⇒ 原样返回 `touch`，行为与改动前完全一致；
 * 开启 ⇒ 把「问候」时段表 `greeting` 里的 actionId 追加到**末尾**，
 * 让点击热区也能随机到打招呼的语音/动作，而不只靠"开机 / 回到桌面"这类自动信号。
 *
 * 口径（2026-09-29 用户确认）：**按 `greeting` 全量并入，不写死 id** ——
 * 加时段、换 id 只改 config，不需要重建 bundle。因此晚间问候
 * （`evening`，动作是 `chat` 而非 `greet`）也会进来。
 *
 * 两个去重/容错细节，避免"配重复了 ⇒ 某条被随机到的概率翻倍"这种静默偏差：
 *   - 已在 `touch` 里的 id 不再追加（保序：先原样保留，再按 `SLOT_ORDER` 补）；
 *   - 时段值非数字（`greeting` 是 `Partial`）时跳过。
 *
 * ⚠️ 本函数**只产出 id 列表**，不解析条目 —— 解析交给 `buildPool`，
 * 于是"id 指向不存在的条目就静默跳过"这条兜底口径对两条来源一视同仁。
 *
 * ★ 为什么把开关判据也放进来（而不是在 `index.ts` 里写三元）：本模块的定位就是
 * "纯选取逻辑、便于单测"（见文件头），开关两种状态都能在这里被穷举。
 */
export const resolveTouchIds = (
  touch: number[] | undefined,
  greeting: Partial<Record<DialogueSlotKey, number>> | undefined,
  greetInTouchPool: boolean | undefined
): number[] => {
  const out = (touch ?? []).slice();
  if (greetInTouchPool !== true) {
    return out;
  }
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    const id = greeting?.[SLOT_ORDER[i]];
    if (typeof id === 'number' && out.indexOf(id) < 0) {
      out.push(id);
    }
  }
  return out;
};

/**
 * 待机到点后可**自动触发**的事件类别。
 *
 * 命名沿用面板文案（「待机自动触发 greet / touch 事件」），与
 * `touch.ts` 的 `ActionSource`（`'touch' | 'greet' | 'standby'`）**刻意不同**：
 * 那边是"谁触发的"，这里是"触发的是哪一类事件" —— 二者不要互相套用。
 * ⚠️ 尤其 `'touch'` 这一类**是自动播放**，触发时给的 `ActionSource` 仍是 `'standby'`。
 */
export type StandbyEventKind = 'greet' | 'touch';

/**
 * 「待机触摸」池的 actionId 列表 = `standby`（休闲待机）+ `touch`（点击触摸），**保序去重**。
 *
 * ★ 2026-09-30 用户拍板：「开启待机自动触发 touch 事件后，**64004 到 64010 都可触发**」
 *   —— 所以 `standby` 不是单独一类，而是这个池的**第 1 条**。
 * ⚠️ 池里因此含 64004，而它**不再固定播放**（原来待机到点必播它）。
 *
 * 顺序 = `[standby, ...touch]`，重复 id 只保留首次出现（`touch` 里再写一次 `standby`
 * 不会让它被随机到的概率翻倍）。去重口径与 `resolveTouchIds` 一致。
 */
export const resolveStandbyTouchIds = (
  standby: number | undefined,
  touch: number[] | undefined
): number[] => {
  const out: number[] = [];
  const push = (id: unknown): void => {
    if (typeof id === 'number' && out.indexOf(id) < 0) {
      out.push(id);
    }
  };
  push(standby);
  (touch ?? []).forEach(push);
  return out;
};

/** `subtitle.greeting` 里是否至少配了一个时段的 actionId（`standbyGreetEnabled` 的可用性判据） */
export const hasGreetingSlots = (
  greeting: Partial<Record<DialogueSlotKey, number>> | undefined
): boolean => {
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    if (typeof greeting?.[SLOT_ORDER[i]] === 'number') {
      return true;
    }
  }
  return false;
};

/**
 * 解析「待机到点后**可以播**哪些类别」—— 纯函数，开关判据集中在这里，便于单测。
 *
 * ## 两条候选与各自口径
 *
 * | 类别 | 开关（缺省） | 还需要 config 里有 |
 * |---|---|---|
 * | `greet` | `standbyGreetEnabled`（**false**） | `greeting` 至少一个时段 |
 * | `touch` | `standbyTouchEnabled`（**false**） | `standby` + `touch` 解析出的池非空 |
 *
 * ★★ **两个开关都缺省关**（用户 2026-09-30 拍板）：两者都是"新增能力"，
 *   出厂不自动播任何东西；想让角色"静置一会儿自己说话"要由用户打开其中一个。
 *   ⚠️ 因此**两个判据都必须写 `=== true`** —— 写成 `!== false` 会让缺字段的旧
 *   config 被判成"开"，行为当场变（这正是本项目反复强调的静默失效）。
 *
 * ★ 返回顺序**恒为 `['greet','touch']`**（与传参顺序无关，便于断言）；
 *   调用方从返回值里**随机**挑一个（两个都可用 ⇒ 各 50%）。
 *
 * ⚠️ `hasTouchPool` 由调用方传入，通常是"`buildPool(dialogues, resolveStandbyTouchIds(...))`
 *   的长度 > 0" —— 本函数只回答"开关 + 可用性"这一层，不碰 `dialogues`。
 */
export const resolveStandbyKinds = (
  touchEnabled: boolean | undefined,
  greetEnabled: boolean | undefined,
  hasTouchPool: boolean,
  hasGreeting: boolean
): StandbyEventKind[] => {
  const out: StandbyEventKind[] = [];
  if (greetEnabled === true && hasGreeting) {
    out.push('greet');
  }
  if (touchEnabled === true && hasTouchPool) {
    out.push('touch');
  }
  return out;
};

/**
 * 从池里随机取一条。
 *
 * `random` 可注入（测试用固定序列）。对注入值做了夹取 ——
 * 若调用方传了个会返回 1.0 的 random，`Math.floor(1.0 * n) === n` 会越界成 `undefined`，
 * 这里用 `Math.min` 兜住，返回最后一条而不是空。
 */
export const pickRandomFromPool = (
  pool: DialogueEntry[],
  random: () => number = Math.random
): DialogueEntry | null => {
  if (!pool?.length) {
    return null;
  }
  const i = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(random() * pool.length))
  );
  return pool[i] ?? null;
};

/** 按时段取问候条目；该时段没配或条目缺失时返回 `null` */
export const pickGreetingEntry = (
  entries: DialogueEntry[],
  greeting: Partial<Record<DialogueSlotKey, number>>,
  ranges: Partial<Record<DialogueSlotKey, DialogueTimeRange>>,
  date: Date
): DialogueEntry | null => {
  const slot = resolveTimeSlot(date, ranges);
  if (!slot) {
    return null;
  }
  const actionId = greeting?.[slot];
  return typeof actionId === 'number'
    ? findByActionId(entries, actionId)
    : null;
};
