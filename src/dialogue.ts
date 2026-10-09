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
 * （见 `_regress/` 下的验证脚本），而把"怎么画"留给 `voiceBubble.ts`、
 * 把"什么时候播"留给 `index.ts`。
 *
 * ## 三路选取 = 三个**触发通道**
 *
 * | 通道（`TriggerChannel`） | 面板设置项 | 入口 | 口径 |
 * |---|---|---|---|
 * | `'touch'` | 触摸可触发的事件 | `pickTouchEntry` →（`touch.ts`） | 从**勾中的类别**各自的池并成一个大池，随机取一条 |
 * | `'resume'` | 回到壁纸可触发的事件 | 载入延迟 / 回到桌面 / 回到前台 / WE 暂停恢复 | 同上（只勾 `greet` 一类时走 `pickGreetingEntry`） |
 * | `'standby'` | 长时间待机可触发的事件 | 静置到点（`index.ts` 的 `tickStandby`） | 同上 |
 *
 * ★★ **三条事件列表的头号事实（2026-10-08 改）**：`greet` / `chat` / `touch`
 *    全部统一为 **actionId 数组**，且它们是 config 里唯一的真相来源
 *    —— 用户想让某类多一条候选，往数组里加一个 id 即可，**不需要重建 bundle**。
 *    旧的 `greeting`（时段→id 映射）与 `standby`（单条 id）保留为**兼容输入**，
 *    经 `normalizeGreetIds` / `resolveChatIds` 摊平成同一种数组后再参与后续选取
 *    ⇒ **新旧两路共用同一套选取代码**，不会出现两套口径。
 *
 * ★★ **多选 = 并池**（2026-10-09 用户拍板）：一个通道勾了多类 ⇒ 把各池**并成一个大池**
 *    （`mergeKindPools`，按 actionId 去重保序）再随机 ⇒ 池内每条等概率、
 *    类别之间按条目数加权。⚠️ 唯一例外：**只勾 `greet` 一类**时走 `pickGreetingEntry`，
 *    以保住「问候触发方式」（`greetMode` 按时段 / 随机）。
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
  TriggerChannel,
  TriggerEventKind,
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
 * 选**问候来源**：`greet` 数组优先；**空数组视同没配**，退回旧时段表 `greeting`。
 *
 * ## ★★ 这一层为什么必须有（2026-10-09 修）
 *
 * 调用方原先写的是 `subtitleCfg?.greet ?? subtitleCfg?.greeting` —— 而 `??`
 * **只对 `null`/`undefined` 回退** ⇒ `"greet": []`（照抄 `config.example.json`
 * 最容易出现的形状）会把问候**整类静默关掉**，哪怕旁边 `greeting` 好好配着三个时段。
 * config 没有 schema 校验，"看着配了、其实全哑"是最难排查的一类问题。
 *
 * ★ 判据与 `resolveChatIds` 对 `chat: []` 的**完全一致**（那里也是"空数组退回旧字段"）——
 *   两条来源本来是一起改名成数组的，口径不该劈叉。
 *
 * ⚠️ 两边都没配 ⇒ `undefined`（调用方按"没配"处理，与改动前逐字一致）。
 */
export const resolveGreetSource = (
  greet: number[] | undefined,
  greeting: Partial<Record<DialogueSlotKey, number>> | undefined
): GreetSource | undefined => (greet?.length ? greet : greeting);

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
 * 把 `subtitle.touch` 归一成**去重保序**的 actionId 列表（= touch 类的池）。
 *
 * ★ 2026-10-09 删掉了原来的第三参 `greetInTouchPool`：那个布尔（"点击也随机到问候"）
 *   已被**「触摸可触发的事件」勾上 greet 类**取代，合并改由 `mergeKindPools` 统一做
 *   ⇒ 本函数只剩"去重"这一件事，不再知道问候池的存在。
 *
 * 去重细节：配重复了会让某条被随机到的概率翻倍 —— config 没有 schema 校验，
 * 这类静默偏差值得挡一道。
 *
 * ⚠️ 本函数**只产出 id 列表**，不解析条目 —— 解析交给 `buildPool`，
 * 于是"id 指向不存在的条目就静默跳过"这条兜底口径对三条来源一视同仁。
 */
export const resolveTouchIds = (touch: number[] | undefined): number[] => {
  const out: number[] = [];
  (touch ?? []).forEach((id) => {
    if (typeof id === 'number' && out.indexOf(id) < 0) {
      out.push(id);
    }
  });
  return out;
};

/**
 * 可由某个触发通道自动播放的事件类别：`chat`（闲聊）/ `greet`（问候）/ `touch`（触摸）。
 *
 * 类型本体定义在 `config.type.ts`（与 `GreetMode` / `TouchFeedbackMode` 同处），
 * 这里**再导出一次** —— 本模块是这些判据的落点，使用方就近 import 更自然。
 */
export type { TriggerChannel, TriggerEventKind };

/**
 * 类别的**固定顺序**（= 面板里 chips 的显示顺序，也是并池顺序）。
 *
 * ★ 归一化一律按它排序，**与用户在 config / 面板里敲的顺序无关** ——
 *   于是断言可以写死，也不会出现"同样一组勾选、两种顺序"这种不可比的状态。
 */
export const TRIGGER_KIND_ORDER: readonly TriggerEventKind[] = [
  'chat',
  'greet',
  'touch',
];

/** 三个触发通道的固定顺序（面板「动作」页的显示顺序同此） */
export const TRIGGER_CHANNEL_ORDER: readonly TriggerChannel[] = [
  'standby',
  'touch',
  'resume',
];

/**
 * 各通道**缺省**触发哪些类别（字段缺席时用）。
 *
 * | 通道 | 缺省 | 为什么是它 |
 * |---|---|---|
 * | `'standby'` | `['chat']` | 还原"配了 `subtitle.standby`（64004）就一定会播"的老行为 |
 * | `'touch'` | `['touch']` | 点击只取 `touch` 池（= 被删掉的 `greetInTouchPool:false`） |
 * | `'resume'` | `['greet']` | 四个自动时机仍只播问候（= 旧的 `tryGreeting` 口径） |
 *
 * ★★ **三个缺省合起来 = "升级后行为与改动前逐字相同"**，这是本次改动唯一的兼容性承诺。
 * ⚠️ 返回值**每次新拷贝**一份 —— 外部若就地改它会污染这张缺省表（同一个坑
 *   `idleSequence` / `standbyKinds` 的注释里写过）。
 */
export const CHANNEL_DEFAULT_KINDS: Readonly<
  Record<TriggerChannel, readonly TriggerEventKind[]>
> = {
  standby: ['chat'],
  touch: ['touch'],
  resume: ['greet'],
};

/** 是不是合法的类别名（config 无 schema 校验 ⇒ 非法值静默丢弃，与 `buildPool` 同一容错口径） */
export const isTriggerEventKind = (v: unknown): v is TriggerEventKind =>
  v === 'chat' || v === 'greet' || v === 'touch';

/** 是不是合法的通道名 */
export const isTriggerChannel = (v: unknown): v is TriggerChannel =>
  v === 'standby' || v === 'touch' || v === 'resume';

/**
 * 把任意值归一成**合法的类别列表**：丢弃非法值、去重、按 `TRIGGER_KIND_ORDER` 排序。
 *
 * ★ 面板点 chips 之后也走它 ⇒ "面板里存的顺序"与"config 里手写的顺序"永远同一种形状，
 *   不会出现"同样一组勾选、两种顺序"这种不可比的状态。
 * ⚠️ 非数组 ⇒ 空数组（调用方据此区分"没配"与"配了个空的"）。
 */
export const normalizeTriggerKinds = (kinds: unknown): TriggerEventKind[] => {
  if (!Array.isArray(kinds)) {
    return [];
  }
  const want: TriggerEventKind[] = [];
  kinds.forEach((k: unknown) => {
    if (isTriggerEventKind(k) && want.indexOf(k) < 0) {
      want.push(k);
    }
  });
  return TRIGGER_KIND_ORDER.filter((k) => want.indexOf(k) >= 0);
};

/**
 * 把「通道的新多选 / 待机通道的旧两个布尔」两种口径**摊平成意向列表**
 * （只归一，不判可用性）。
 *
 * ## 两种写法
 *
 * | 口径 | config 字段 | 摊平结果 |
 * |---|---|---|
 * | **新**（推荐） | `standbyKinds` / `touchKinds` / `resumeKinds` | 原样，去重后按 `TRIGGER_KIND_ORDER` 排序 |
 * | **旧**（仅 `'standby'` 通道兼容） | `standbyGreetEnabled` / `standbyTouchEnabled` | `['chat']` **再追加**各自的 `greet` / `touch` |
 *
 * ★★ 给了**数组**（哪怕空数组）就完全以它为准：空数组 = 显式关掉该通道的自动播放。
 *   ⚠️ 唯一的例外：数组里**一个合法值都没有**（`['Chat', 3, null]` 这种拼错）⇒ 当作"没配"、
 *   退回该通道的缺省/旧口径 —— 宁可降级也不要静默把整个通道关掉（config 无 schema 校验）。
 *   写坏成**非数组**同理。
 *
 * ★★ 旧口径里 `'chat'` **恒在**，且**只对 `'standby'` 通道生效**（另外两个通道 2026-10-09
 *   才出生，没有历史口径要兼容）—— 改动前"只要配了 `subtitle.standby`（休闲待机 64004），
 *   待机到点就一定会播它"这条老行为必须还原（2026-10-09 的回归修复）。
 *
 * ⚠️ 这里**不判可用性**（池空不空）—— 那是 `resolveTriggerKinds` 的事。
 *   分两层的理由：`settingsStore.readView` 只需要"面板该勾哪几个"，
 *   它拿不到池，也不该为了显示去解析 `dialogues`。
 */
export const resolveTriggerIntent = (
  channel: TriggerChannel,
  kinds: unknown,
  /** ⚠️ 旧口径，**只有 `'standby'` 通道会读**：待机是否也自动触发问候 */
  legacyGreetEnabled?: boolean,
  /** ⚠️ 旧口径，**只有 `'standby'` 通道会读**：待机是否也自动触发触摸 */
  legacyTouchEnabled?: boolean
): TriggerEventKind[] => {
  if (Array.isArray(kinds)) {
    const want = normalizeTriggerKinds(kinds);
    /**
     * ★ 写了数组但**一个合法值都没有** ⇒ 当作"没配"，退回该通道的缺省 ——
     *   拼错一个词（`'Chat'`）不该把整个通道的自动播关掉；config 没有 schema 校验，
     *   静默失效是这个工程反复踩过的坑，这里宁可降级。
     * ⚠️ 但**空数组**是合法的显式表达（= 全关），必须原样返回、绝不退回。
     */
    if (want.length || kinds.length === 0) {
      return want;
    }
  }
  if (channel === 'standby') {
    const out: TriggerEventKind[] = ['chat'];
    if (legacyGreetEnabled === true) {
      out.push('greet');
    }
    if (legacyTouchEnabled === true) {
      out.push('touch');
    }
    return out;
  }
  return CHANNEL_DEFAULT_KINDS[channel].slice();
};

/**
 * 问候池是否非空（`greet` 这一类的可用性判据，见 `resolveTriggerKinds` 的 `hasGreeting`）。
 *
 * ⚠️ **旧名**：2026-10-08 起问候是数组，建议用 `hasGreetIds`；
 * 本函数是它的别名（两者完全等价），保留以免既有脚本失效。
 */
export const hasGreetingSlots = (greeting?: GreetSource): boolean =>
  hasGreetIds(greeting);

/**
 * 把某个通道「勾中的类别」各自的池**并成一个大池**（去重保序，按 `TRIGGER_KIND_ORDER`）。
 *
 * ## ★★ 为什么是"并池"而不是"先随机挑一类再类内随机"（2026-10-09 用户拍板）
 *
 *   并池 ⇒ **池内每条等概率**，类别之间按各自的条目数加权。
 *   于是 `['touch','greet']` 与**被删掉的 `greetInTouchPool:true` 是同一份候选**：
 *   旧实现就是把问候池的 id 追加进触摸池、再在整个大池里随机，且**同一条 id 不重复追加**
 *   ⇒ "某条被随机到的概率"一致（去重正是为此）。
 *   ⚠️ 唯一的差别是**池内顺序**：旧实现是"touch 在前、greet 追加在后"，
 *   这里一律按 `TRIGGER_KIND_ORDER` 归一（greet 在前）——顺序只影响归档面板的列举次序，
 *   均匀随机下**概率分布完全相同**。之所以不按调用方给的顺序，是为了"同样一组勾选
 *   永远得到同一个池"（与 `normalizeTriggerKinds` 同一条口径）。
 *
 * ⚠️ 传进来的池必须是**已解析好的条目池**（`buildPool` 的产物）；本函数不碰 `dialogues`。
 */
export const mergeKindPools = (
  kinds: readonly TriggerEventKind[],
  pools: Readonly<Record<TriggerEventKind, DialogueEntry[]>>
): DialogueEntry[] => {
  const out: DialogueEntry[] = [];
  const seen: number[] = [];
  /** 逐类拼接；按 actionId 去重（同一个 id 出现在两个池里时不重复收） */
  TRIGGER_KIND_ORDER.forEach((kind) => {
    if (kinds.indexOf(kind) < 0) {
      return;
    }
    (pools[kind] ?? []).forEach((e) => {
      if (!e || seen.indexOf(e.actionId) >= 0) {
        return;
      }
      seen.push(e.actionId);
      out.push(e);
    });
  });
  return out;
};

/**
 * 解析「某个触发通道**真正会播**哪些类别」—— 纯函数，判据集中在这里，便于单测。
 *
 * 两步：`resolveTriggerIntent`（摊平口径）⇒ 按**可用性**过滤（该类别的池非空）。
 *
 * ★★ 三个缺省各自不同（见 `CHANNEL_DEFAULT_KINDS`），合起来 = "升级后行为逐字不变"：
 *   - `standby` ⇒ `['chat']`（修掉 2026-09-30「出厂待机什么都不播」的回归）；
 *   - `touch`   ⇒ `['touch']`（= 旧 `greetInTouchPool:false`）；
 *   - `resume`  ⇒ `['greet']`（= 旧 `tryGreeting`）。
 *
 * ★ 返回顺序**恒为 `['chat','greet','touch']` 的子序列**（见 `TRIGGER_KIND_ORDER`），
 *   与传参顺序无关，便于断言；调用方把它交给 `mergeKindPools` 并池后随机取一条。
 *
 * ⚠️ 三个 `has*` 由调用方传入（通常是"`buildPool(...)` 的长度 > 0"）：
 *   本函数只回答"口径 + 可用性"这一层，**不碰 `dialogues`**，所以能脱离骨架单测。
 */
export const resolveTriggerKinds = (
  channel: TriggerChannel,
  kinds: unknown,
  legacyGreetEnabled: boolean | undefined,
  legacyTouchEnabled: boolean | undefined,
  hasChat: boolean,
  hasGreeting: boolean,
  hasTouch: boolean
): TriggerEventKind[] =>
  resolveTriggerIntent(
    channel,
    kinds,
    legacyGreetEnabled,
    legacyTouchEnabled
  ).filter((k) =>
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
