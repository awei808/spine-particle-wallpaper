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
 * | 点击热区 | `pickTouchEntry` →（`touch.ts`） | 从 **`touch` 池**的 actionId 里**随机**取一条 |
 * | 首次打开 / 回到桌面 / 回到前台 / WE 暂停后恢复 | `pickGreetingEntry` | 从 **`greet` 池**取：按 `greetMode` = 当前时段下标 **或** 随机 |
 * | 长时间无互动（待机到点） | `resolveStandbyIntent` + `resolveStandbyKinds` | 从**已勾选的类别**（`chat`/`greet`/`touch`）里随机挑一类，再在该类**自己的池**里取一条 |
 *
 * ★★ **三条事件列表的头号事实（2026-10-08 改）**：`greet` / `chat` / `touch`
 *    全部统一为 **actionId 数组**，且它们是 config 里唯一的真相来源
 *    —— 用户想让某类多一条候选，往数组里加一个 id 即可，**不需要重建 bundle**。
 *    旧的 `greeting`（时段→id 映射）与 `standby`（单条 id）保留为**兼容输入**，
 *    经 `normalizeGreetIds` / `resolveChatIds` 摊平成同一种数组后再参与后续选取
 *    ⇒ **新旧两路共用同一套选取代码**，不会出现两套口径。
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
  GreetMode,
  StandbyEventKind,
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

/* ══════════════════════════════════════════════════════════════════════
 * 事件列表的**归一化**（2026-10-08）
 *
 * 新的写入口径一律是数组（`greet` / `chat` / `touch`），旧的口径是
 * `greeting`（时段→id 映射）与 `standby`（单条 id）。两套口径在这里摊平，
 * 后面的所有选取代码只认"去重保序的 actionId 数组"这一种形状。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 问候配置的两种形状：
 * - **数组**（新口径，`config.subtitle.greet`）；
 * - **时段映射**（旧口径，`config.subtitle.greeting`）。
 *
 * ⚠️ 两种都必须接受 —— 老 config.json 与既有回归脚本（64/65）仍在传后者。
 */
export type GreetSource = number[] | Partial<Record<DialogueSlotKey, number>>;

/**
 * 把问候来源摊平成**去重保序**的 actionId 数组。两者都不是 ⇒ 空数组（永不抛）。
 *
 * ★ 旧口径按 `SLOT_ORDER`（早→中→晚）摊平 ⇒ 数组顺序天然就是"时段序号"，
 *   这正是 `GreetMode==='time'` 按下标取条所依赖的形状（见 `pickGreetingEntry`）。
 */
export const normalizeGreetIds = (src?: GreetSource): number[] => {
  const out: number[] = [];
  const push = (id: unknown): void => {
    if (typeof id === 'number' && out.indexOf(id) < 0) {
      out.push(id);
    }
  };
  if (Array.isArray(src)) {
    src.forEach(push);
    return out;
  }
  for (let i = 0; i < SLOT_ORDER.length; i++) {
    push(src?.[SLOT_ORDER[i]]);
  }
  return out;
};

/** 问候池是否至少有一条候选（两种形状通用） */
export const hasGreetIds = (greet?: GreetSource): boolean =>
  normalizeGreetIds(greet).length > 0;

/**
 * 「聊天」池（长时间无互动时触发的那些念白）的解析。
 *
 * 新口径 = `subtitle.chat`（数组）优先；没配时才退回旧的 `subtitle.standby`（单条 id）。
 * ⇒ 只配了旧字段的老 config 行为**逐字不变**。
 */
export const resolveChatIds = (
  chat: number[] | undefined,
  standby: number | undefined
): number[] => {
  if (chat?.length) {
    const out: number[] = [];
    chat.forEach((id) => {
      if (typeof id === 'number' && out.indexOf(id) < 0) {
        out.push(id);
      }
    });
    return out;
  }
  return typeof standby === 'number' ? [standby] : [];
};

/**
 * 由 `subtitle.{touch,greet,greetInTouchPool}` 解析出**触摸池的 actionId 列表**。
 *
 * 开关关闭（缺省）⇒ 原样返回 `touch`，行为与改动前完全一致；
 * 开启 ⇒ 把**问候池**的 actionId 追加到**末尾**，
 * 让点击热区也能随机到打招呼的语音/动作，而不只靠"开机 / 回到桌面"这类自动信号。
 *
 * 口径（2026-09-29 用户确认）：**按问候池全量并入，不写死 id** ——
 * 加候选、换 id 只改 config，不需要重建 bundle。因此晚间问候
 * （动作是 `chat` 而非 `greet`）也会进来。
 *
 * 去重细节：已在 `touch` 里的 id 不再追加（保序：先原样保留 `touch`，再补问候池），
 * 避免"配重复了 ⇒ 某条被随机到的概率翻倍"这种静默偏差。
 *
 * ⚠️ 本函数**只产出 id 列表**，不解析条目 —— 解析交给 `buildPool`，
 * 于是"id 指向不存在的条目就静默跳过"这条兜底口径对两条来源一视同仁。
 *
 * ★ 为什么把开关判据也放进来（而不是在 `index.ts` 里写三元）：本模块的定位就是
 * "纯选取逻辑、便于单测"（见文件头），开关两种状态都能在这里被穷举。
 */
export const resolveTouchIds = (
  touch: number[] | undefined,
  greet: GreetSource | undefined,
  greetInTouchPool: boolean | undefined
): number[] => {
  const out = (touch ?? []).slice();
  if (greetInTouchPool !== true) {
    return out;
  }
  normalizeGreetIds(greet).forEach((id) => {
    if (out.indexOf(id) < 0) {
      out.push(id);
    }
  });
  return out;
};

/**
 * 待机到点后可**自动触发**的事件类别：`chat`（闲聊）/ `greet`（问候）/ `touch`（触摸）。
 *
 * 类型本体定义在 `config.type.ts`（与 `GreetMode` / `TouchFeedbackMode` 同处），
 * 这里**再导出一次** —— 本模块是这些判据的落点，使用方就近 import 更自然。
 *
 * 命名与 `touch.ts` 的 `ActionSource`（`'touch' | 'greet' | 'standby'`）**刻意不同**：
 * 那边是"谁触发的"，这里是"触发的是哪一类事件" —— 二者不要互相套用。
 * ⚠️ 尤其这三个类别**都是自动播放**，触发时给的 `ActionSource` 一律是 `'standby'`。
 */
export type { StandbyEventKind };

/**
 * 类别的**固定顺序**（= 面板里 chips 的显示顺序）。
 *
 * ★ 归一化一律按它排序，**与用户在 config / 面板里敲的顺序无关** ——
 *   于是断言可以写死，也不会出现"同样一组勾选、两种顺序"这种不可比的状态。
 */
export const STANDBY_KIND_ORDER: readonly StandbyEventKind[] = [
  'chat',
  'greet',
  'touch',
];

/** 是不是合法的类别名（config 无 schema 校验 ⇒ 非法值静默丢弃，与 `buildPool` 同一容错口径） */
export const isStandbyEventKind = (v: unknown): v is StandbyEventKind =>
  v === 'chat' || v === 'greet' || v === 'touch';

/**
 * 把任意值归一成**合法的类别列表**：丢弃非法值、去重、按 `STANDBY_KIND_ORDER` 排序。
 *
 * ★ 面板点 chips 之后也走它 ⇒ "面板里存的顺序"与"config 里手写的顺序"永远同一种形状，
 *   不会出现"同样一组勾选、两种顺序"这种不可比的状态。
 * ⚠️ 非数组 ⇒ 空数组（调用方据此区分"没配"与"配了个空的"）。
 */
export const normalizeStandbyKinds = (kinds: unknown): StandbyEventKind[] => {
  if (!Array.isArray(kinds)) {
    return [];
  }
  const want: StandbyEventKind[] = [];
  kinds.forEach((k: unknown) => {
    if (isStandbyEventKind(k) && want.indexOf(k) < 0) {
      want.push(k);
    }
  });
  return STANDBY_KIND_ORDER.filter((k) => want.indexOf(k) >= 0);
};

/**
 * 把「新多选 / 旧两个布尔」两种口径**摊平成意向列表**（只归一，不判可用性）。
 *
 * ## 两种写法
 *
 * | 口径 | config 字段 | 摊平结果 |
 * |---|---|---|
 * | **新**（推荐） | `subtitle.standbyKinds`（`'chat'|'greet'|'touch'` 的子集） | 原样，去重后按 `STANDBY_KIND_ORDER` 排序 |
 * | **旧**（兼容） | `standbyGreetEnabled` / `standbyTouchEnabled` 两个布尔 | `['chat']` **再追加**各自的 `greet` / `touch` |
 *
 * ★★ 旧口径里 `'chat'` **恒在**：改动前"只要配了 `subtitle.standby`（休闲待机 64004），
 *   待机到点就一定会播它" —— 这条老行为必须还原（2026-10-09 的回归修复）。
 *   两个旧布尔只**追加**自己那一类，不会把 `chat` 挤掉。
 *
 * ★ 给了**数组**（哪怕空数组）就完全以它为准：空数组 = 显式关掉"待机自动播放"。
 *   ⚠️ 唯一的例外：数组里**一个合法值都没有**（`['Chat', 3, null]` 这种拼错）⇒ 当作"没配"、
 *   退回旧口径 —— 宁可降级也不要静默把待机自动播整个关掉（config 无 schema 校验）。
 *   写坏成**非数组**同理，一律退回旧口径。
 *
 * ⚠️ 这里**不判可用性**（池空不空）—— 那是 `resolveStandbyKinds` 的事。
 *   分两层的理由：`settingsStore.readView` 只需要"面板该勾哪几个"，
 *   它拿不到池，也不该为了显示去解析 `dialogues`。
 */
export const resolveStandbyIntent = (
  kinds: unknown,
  greetEnabled: boolean | undefined,
  touchEnabled: boolean | undefined
): StandbyEventKind[] => {
  if (Array.isArray(kinds)) {
    const want = normalizeStandbyKinds(kinds);
    /**
     * ★ 写了数组但**一个合法值都没有** ⇒ 当作"没配"，退回旧口径 ——
     *   拼错一个词（`'Chat'`）不该把"待机自动播"整个关掉；config 没有 schema 校验，
     *   静默失效是这个工程反复踩过的坑，这里宁可降级。
     * ⚠️ 但**空数组**是合法的显式表达（= 全关），必须原样返回、绝不退回。
     */
    if (want.length || kinds.length === 0) {
      return want;
    }
  }
  const out: StandbyEventKind[] = ['chat'];
  if (greetEnabled === true) {
    out.push('greet');
  }
  if (touchEnabled === true) {
    out.push('touch');
  }
  return out;
};

/**
 * 问候池是否非空（`greet` 这一类的可用性判据，见 `resolveStandbyKinds` 的 `hasGreeting`）。
 *
 * ⚠️ **旧名**：2026-10-08 起问候是数组，建议用 `hasGreetIds`；
 * 本函数是它的别名（两者完全等价），保留以免既有脚本失效。
 */
export const hasGreetingSlots = (greeting?: GreetSource): boolean =>
  hasGreetIds(greeting);

/**
 * 解析「待机到点后**真正会播**哪些类别」—— 纯函数，判据集中在这里，便于单测。
 *
 * 两步：`resolveStandbyIntent`（摊平口径）⇒ 按**可用性**过滤（该类别的池非空）。
 *
 * ## 三个类别与各自的池（2026-10-09 起 `chat` 与 `touch` **分家**）
 *
 * | 类别 | 池 | 池空时 |
 * |---|---|---|
 * | `chat` | `chat` 数组（没配时退回旧字段 `standby` 那一条） | 整类剔除 |
 * | `greet` | `greet` 池（或旧时段表 `greeting`） | 整类剔除 |
 * | `touch` | `touch` 数组（与**点击**同一口径，含 `greetInTouchPool` 的并入） | 整类剔除 |
 *
 * ★★ 缺省 = **只有 `chat`**（用户 2026-10-09 拍板）：出厂"静置一会儿自己说句闲聊"
 *   直接可用，**不必先去开任何开关** —— 这正是 2026-09-30 那次"出厂两个开关都关
 *   ⇒ 连原来会播的 `chat` 也不播了"的回归修复。
 *   `greet` / `touch` 依旧是**要显式勾选**才加进来的能力（老 config 经
 *   `resolveStandbyIntent` 的旧口径分支推导）。
 *
 * ★ 返回顺序**恒为 `['chat','greet','touch']` 的子序列**（见 `STANDBY_KIND_ORDER`），
 *   与传参顺序无关，便于断言；调用方从返回值里**随机挑一类**，再在该类自己的池里取一条。
 *
 * ⚠️ 三个 `has*` 由调用方传入（通常是"`buildPool(...)` 的长度 > 0"）：
 *   本函数只回答"口径 + 可用性"这一层，**不碰 `dialogues`**，所以能脱离骨架单测。
 */
export const resolveStandbyKinds = (
  kinds: unknown,
  greetEnabled: boolean | undefined,
  touchEnabled: boolean | undefined,
  hasChat: boolean,
  hasGreeting: boolean,
  hasTouch: boolean
): StandbyEventKind[] =>
  resolveStandbyIntent(kinds, greetEnabled, touchEnabled).filter((k) =>
    k === 'chat' ? hasChat : k === 'greet' ? hasGreeting : hasTouch
  );

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
  greet: GreetSource | undefined,
  ranges: Partial<Record<DialogueSlotKey, DialogueTimeRange>>,
  date: Date,
  /** 'time' = 按时段取（缺省，= 改动前的行为）；'random' = 池内随机 */
  mode: GreetMode = 'time',
  /** 随机源（`random` 模式下 + 降级路径都会用；可注入便于单测） */
  random: () => number = Math.random
): DialogueEntry | null => {
  const ids = normalizeGreetIds(greet);
  if (!ids.length) {
    return null;
  }
  const pool = buildPool(entries, ids);
  if (!pool.length) {
    return null;
  }
  /** 随机模式：与时刻无关，直接从池里抽一条 */
  if (mode === 'random') {
    return pickRandomFromPool(pool, random);
  }
  /**
   * 按时模式：**按时段取对应的那一条**。
   *
   * | 形状 | 取值方式 |
   * |---|---|
   * | **数组**（新口径） | `greet[slotIndex]`，morning→0 / noon→1 / evening→2（约定见 `GreetMode` 注释） |
   * | **旧时段表** | 直接 `greeting[slot]`（与改动前**逐字一致**） |
   */
  const slot = resolveTimeSlot(date, ranges);
  if (!slot) {
    // 时段被改坏（ranges 覆盖不到全天）⇒ 沿用改动前的口径：不猜、返回 null
    return null;
  }
  const byTime = findByActionId(entries, idForSlot(greet, slot));
  /**
   * ★ 降级而非静默失效：按序号找不到（池的顺序与时段不对位，或池不足 3 条）
   *   ⇒ **池内随机**。宁可是"时段对不上"，也不要"到点了什么都不播"。
   */
  return byTime ?? pickRandomFromPool(pool, random);
};

/**
 * 按时段取**问候池**里对应的 actionId（不存在 ⇒ `undefined`）。
 *
 * ★ 两种形状各按各自的约定取、互不借用 —— 旧 config 的行为因此不会被改坏。
 */
export const idForSlot = (
  greet: GreetSource | undefined,
  slot: DialogueSlotKey
): number | undefined =>
  Array.isArray(greet) ? greet[SLOT_ORDER.indexOf(slot)] : greet?.[slot];
