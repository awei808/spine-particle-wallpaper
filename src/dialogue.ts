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
 *    （`mergeKindPools`，按 `actionId|phase` 去重保序）再随机 ⇒ 池内每条等概率、
 *    类别之间按条目数加权。⚠️ 唯一例外：**只勾 `greet` 一类**时走 `pickGreetingEntry`，
 *    以保住「问候触发方式」（`greetMode` 按时段 / 随机）。
 *
 * ★★ **两层筛子（2026-10-10；2026-10-17 起含义变了）**：
 *    ① **事件族闸门**（`subtitle.phases`，**全局**）—— 只有属于勾选族的条目才进任何池；
 *       一项都不勾 ⇒ 所有池为空（档案为空、任何通道都不触发）；
 *    ② **动作族**（`subtitle.actionPhase`，**全局**）—— 决定播哪套动画名，并把属别的
 *       动作族的条目挡在池外（誓约前 6 / 誓约后 9）。
 *    两者是 **AND**；再往下一层才是各通道的**类别**（`*Kinds`）并池随机。
 *
 * ★★ **动作族（2026-10-17）**：与此正交的另一层 —— `subtitle.actionPhase` 决定
 *    **播哪一套动画名**（`greet` 还是 `greet_marry`），**全局生效**（含常驻 idle）。
 *    它不筛"哪条念白"，只换名 + 决定"属别的动作族的条目能不能进池"：
 *    · `resolveEntryAnimation`       —— 单条换名（显式 `phaseAnimations` → 后缀 → 原名）；
 *    · `projectDialoguesToActionPhase` —— 整表投影（唯一入口，档案/调试面板必须复用）；
 *    · `isEntryVisibleInPhase`      —— 池成员资格（缺省族 / 当前动作族 / 无后缀族）。
 *    ⚠️ 换名只改 `animation`，**不动** `actionId` / `text` / `voice` / `phase`
 *      —— 游戏侧 CV 不分誓约前后，字幕与语音必须保持同一条。
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
  EventFamily,
  EventKeyInput,
  GreetMode,
  TriggerChannel,
  TriggerEventKind,
  TriggerPhase,
} from './config.type';
import { eventKeyOf, normalizeEventKey } from './eventModel';

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

/**
 * 按 `actionId` 在总表里查条目；查不到返回 `null`（不抛，让上层决定降级）。
 *
 * @deprecated 2026-10-18 起用 `findByEventKey`（自定义事件没有 `actionId`）。
 *   本函数保留为薄包装，**引擎内部零调用** —— 免得出现"两个身份判据"。
 */
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
 * 按 `EventKey` 查条目（唯一身份判据）。
 *
 * ★ 兼容边界在这里收口：`64005` / `'64005'` / `'game:64005'` 等价（`normalizeEventKey`）。
 * ⚠️ 表里的条目也走 `eventKeyOf`（`id` 优先、其次 `actionId` 派生），
 *   所以**归一前后的表都能查**。
 */
export const findByEventKey = (
  entries: DialogueEntry[],
  key: EventKeyInput
): DialogueEntry | null => {
  const want = normalizeEventKey(key);
  if (!entries?.length || !want) {
    return null;
  }
  for (let i = 0; i < entries.length; i++) {
    if (eventKeyOf(entries[i]) === want) {
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
  ids: EventKeyInput[],
  /**
   * 允许的**事件族**（2026-10-10 新增，可选）。
   *
   * · **不给**（缺省）⇒ 不看 `phase`，行为与改动前逐字相同。
   * · **给了** ⇒ 只收 `phase` 落在其中的条目。
   *   ⚠️ 注册表为空的工程（`eventFamilies: []`）**应当传 `undefined`**（= 不按族筛，
   *     所有条目一视同仁）—— 见 `index.ts` / `archive.ts` 的 `*Filter` 判据。
   *
   * ★★ 为什么是"**收全命中**"而不是像旧实现那样 `findByActionId` 取首个：
   *   同一动作的不同族孪生条目**共用 `actionId`**（游戏里本就是"同一条动作、两套动画"）。
   *   取首个的话，勾了 `['normal','postMarry']` 时孪生**永远轮不到**（静默偏向普通态）。
   *   收全之后由 `mergeKindPools` 按 `id|phase` 去重，两条都留在池里。
   *   ⚠️ 对既有 config（一个 id 只对应一条）**结果完全相同**。
   *
   * ★ 2026-10-18：`ids` 收 `EventKeyInput`（`number` / `'64005'` / `'game:64005'` /
   *   `'custom:xxx'`）；匹配走 `eventKeyOf` —— 自定义事件没有 `actionId` 也能进池。
   */
  phases?: readonly TriggerPhase[],
  /** 事件族注册表（决定"条目属于哪一族"；缺省 = 内置单族 `normal`） */
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): DialogueEntry[] => {
  if (!entries?.length || !ids?.length) {
    return [];
  }
  /** 先把 id 列表归成 `EventKey` 集合（`number` / 数字串都等价） */
  const want: string[] = [];
  ids.forEach((raw) => {
    const k = normalizeEventKey(raw);
    if (k && want.indexOf(k) < 0) {
      want.push(k);
    }
  });
  if (!want.length) {
    return [];
  }
  const pool: DialogueEntry[] = [];
  for (let i = 0; i < want.length; i++) {
    for (let j = 0; j < entries.length; j++) {
      const e = entries[j];
      if (!e || eventKeyOf(e) !== want[i]) {
        continue;
      }
      if (phases && phases.indexOf(resolveDialoguePhase(e, reg)) < 0) {
        continue;
      }
      pool.push(e);
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
export type GreetSource =
  | EventKeyInput[]
  | Partial<Record<DialogueSlotKey, EventKeyInput>>;

/**
 * 把问候来源摊平成**去重保序**的 id 列表。两者都不是 ⇒ 空数组（永不抛）。
 *
 * ★ 旧口径按 `SLOT_ORDER`（早→中→晚）摊平 ⇒ 数组顺序天然就是"时段序号"，
 *   这正是 `GreetMode==='time'` 按时段取条所依赖的形状（见 `normalizeEventTable`
 *   对 `greet` 数组的**下标对位**）。
 * ★ 2026-10-18 起元素可以是 `EventKey`；**保留原始写法**（`64005` 不会变成 `'game:64005'`），
 *   去重按归一后的键判断（`64005` 与 `'64005'` 算同一条）。
 */
export const normalizeGreetIds = (src?: GreetSource): EventKeyInput[] => {
  const out: EventKeyInput[] = [];
  const seen: string[] = [];
  const push = (id: unknown): void => {
    const key = normalizeEventKey(id);
    if (!key || seen.indexOf(key) >= 0) {
      return;
    }
    seen.push(key);
    out.push(id as EventKeyInput);
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
  greet: EventKeyInput[] | undefined,
  greeting: Partial<Record<DialogueSlotKey, EventKeyInput>> | undefined
): GreetSource | undefined => (greet?.length ? greet : greeting);

/**
 * 「聊天」池（长时间无互动时触发的那些念白）的解析。
 *
 * 新口径 = `subtitle.chat`（数组）优先；没配时才退回旧的 `subtitle.standby`（单条 id）。
 * ⇒ 只配了旧字段的老 config 行为**逐字不变**。
 */
export const resolveChatIds = (
  chat: EventKeyInput[] | undefined,
  standby: EventKeyInput | undefined
): EventKeyInput[] => {
  const toList = (list: EventKeyInput[]): EventKeyInput[] => {
    const out: EventKeyInput[] = [];
    const seen: string[] = [];
    list.forEach((raw) => {
      const k = normalizeEventKey(raw);
      if (k && seen.indexOf(k) < 0) {
        seen.push(k);
        out.push(raw);
      }
    });
    return out;
  };
  if (chat?.length) {
    return toList(chat);
  }
  const one = normalizeEventKey(standby);
  return one ? [standby as EventKeyInput] : [];
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
export const resolveTouchIds = (
  touch: EventKeyInput[] | undefined
): EventKeyInput[] => {
  const out: EventKeyInput[] = [];
  const seen: string[] = [];
  (touch ?? []).forEach((id) => {
    const k = normalizeEventKey(id);
    if (k && seen.indexOf(k) < 0) {
      seen.push(k);
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

/** 三个触发通道的固定顺序（面板「事件池」页的显示顺序同此） */
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

/* ══════════════════════════════════════════════════════════════════════
 * 事件族注册表（`EventFamily` / `TriggerPhase`）
 * —— 2026-10-10 引入，2026-10-15 由写死的三族改为**注册表制**，
 *    2026-10-17 起同时承担「动画变体」职责（`actionPhase`）
 *
 * 族的定义见 `config.type.ts` 的 `EventFamily`；本节只放"纯函数口径"：
 * 归一化注册表、缺省、以及"条目属于哪一族"的判据。
 * ⚠️ 按族**筛候选**是**全局**的（`subtitle.phases`，2026-10-17 起对所有入口生效）；
 *    按族**换动画名**（`subtitle.actionPhase`）同样全局 —— 两件事别混。
 * ══════════════════════════════════════════════════════════════════════ */

export type { EventFamily, TriggerPhase };

/**
 * 内置**缺省注册表** —— config 没声明 `eventFamilies` 时用它。
 *
 * ★ **只有一族 `normal`（普通事件）**：非誓约皮肤（如 S9 阿丝娜时装）本就没有
 *   「誓约前/誓约后」这套，给一个永远为空的族只会让面板多出几个点了没用的勾
 *   ⇒ 缺省就只留"普通事件"这一族（= 所有条目）。
 * ⚠️ 誓约皮肤要的是三族，必须**自己声明**（见 `config.type.ts` 的 `EventFamily` 示例）。
 */
export const DEFAULT_EVENT_FAMILIES: readonly EventFamily[] = [
  { id: 'normal', label: '普通事件', fallback: true, default: true },
];

/**
 * 归一后的**事件族注册表** —— 一次摊平、处处复用
 * （`index.ts` / `archive.ts` / 设置面板 / `settingsStore` 共用同一份判据）。
 *
 * ★ 与 `resolveTriggerIntent` 对 `*Kinds` 的关系一样：把"config 里怎么写的"摊平成
 *   "运行时怎么算"，避免各处各写一套 if。
 */
export type FamilyRegistry = {
  /** 归一后的族列表（保持声明顺序；已丢非法项、按 `id` 去重） */
  families: EventFamily[];
  /** 合法族 id 列表（= 面板 chips 的显示顺序，也是 `*Phases` 的排序依据） */
  ids: string[];
  /** 缺省族 id（`fallback` 标记的那个；没标取首项；**注册表为空 ⇒ `null`**） */
  fallbackId: string | null;
  /** 缺省勾选的族（`default` 标记的那些；都没标 ⇒ `[缺省族]`；注册表为空 ⇒ `[]`） */
  defaultIds: string[];
  /**
   * **动作族** id 列表 = 声明了非空 `matchSuffix` 的族（声明顺序）。
   *
   * 它们就是「spine 动作族显示」单选里除"不换名"之外的可选项
   * （`subtitle.actionPhase` 的合法取值域）。**注册表为空 ⇒ `[]`**。
   */
  actionIds: string[];
  /**
   * 动作族的**缺省** id（= `actionIds[0]`；没有动作族 ⇒ `''`）。
   * `subtitle.actionPhase` 缺席时取它 —— "誓约工程默认显示誓约后动画"就落在这里，
   * 引擎不需要知道 `postMarry` 这个名字。
   */
  defaultActionId: string;
  /** 是不是合法族 id */
  has: (v: unknown) => boolean;
  /** 取族的显示名（没写 / 写空 `label` ⇒ 回落成 `id`） */
  label: (id: string) => string;
  /** 取族的**动作变体后缀**（没有 / 非动作族 ⇒ `''`） */
  suffixOf: (id: string) => string;
  /** 取动作族的**短名**（`actionLabel` → `label` → `id`） */
  actionLabel: (id: string) => string;
};

/** 注册表项是否合法：`id` 必须是非空字符串（config 无 schema 校验 ⇒ 非法项静默丢弃） */
const isValidFamily = (v: unknown): v is EventFamily =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as EventFamily).id === 'string' &&
  (v as EventFamily).id.length > 0;

/** 取某族的**动作变体后缀**：非空字符串才算动作族（`""` / 非字符串 ⇒ 不是） */
const suffixOfFamily = (f: EventFamily | undefined): string =>
  f && typeof f.matchSuffix === 'string' ? f.matchSuffix : '';

/**
 * 把 `config.subtitle.eventFamilies` 归一成注册表。
 *
 * | 输入 | 结果 |
 * |---|---|
 * | 没配 / 非数组 / 数组里**一个合法项都没有**（拼错） | 内置缺省（单族 `normal`） |
 * | **空数组 `[]`** | **空注册表**（= 本项目无事件族机制） |
 * | 合法数组 | 归一：丢非法项、按 `id` 去重、**保持声明顺序** |
 *
 * ★ 容错口径与 `resolveTriggerIntent` 对 `*Kinds` 完全一致：拼错一个词不该静默把机制
 *   关掉（宁可降级到内置缺省），但空数组是合法的显式表达。
 * ⚠️ 数组是**新拷贝**，不会就地改到调用方的 config 对象。
 */
export const buildFamilyRegistry = (raw: unknown): FamilyRegistry => {
  let families: EventFamily[];
  if (Array.isArray(raw)) {
    const want: EventFamily[] = [];
    const seen: string[] = [];
    raw.forEach((f: unknown) => {
      if (isValidFamily(f) && seen.indexOf(f.id) < 0) {
        seen.push(f.id);
        want.push(f);
      }
    });
    families =
      want.length > 0 || raw.length === 0
        ? want
        : DEFAULT_EVENT_FAMILIES.slice();
  } else {
    families = DEFAULT_EVENT_FAMILIES.slice();
  }

  const ids = families.map((f) => f.id);
  /** 缺省族：标 `fallback` 的第一项；没标取首项；空注册表 ⇒ 无 */
  const fb = families.find((f) => f.fallback === true);
  const fallback = fb ?? (families.length ? families[0] : undefined);
  const fallbackId = fallback ? fallback.id : null;
  /** 缺省勾选：标 `default` 的那些；都没标 ⇒ 只勾缺省族；空注册表 ⇒ 空 */
  const marked = families.filter((f) => f.default === true).map((f) => f.id);
  const defaultIds = marked.length
    ? marked
    : fallbackId !== null
    ? [fallbackId]
    : [];
  /**
   * 动作族 = 声明了非空 `matchSuffix` 的族（声明顺序）。
   * ★ 这是「spine 动作族显示」单选的**唯一**数据源 —— 引擎里没有族名字面量。
   */
  const actionIds = families
    .filter((f) => suffixOfFamily(f) !== '')
    .map((f) => f.id);
  const defaultActionId = actionIds.length ? actionIds[0] : '';
  /** 按 id 取族（找不到 ⇒ `undefined`；`suffixOf` / `actionLabel` 共用） */
  const findFamily = (id: string): EventFamily | undefined =>
    families.find((x) => x.id === id);

  return {
    families,
    ids,
    fallbackId,
    defaultIds,
    actionIds,
    defaultActionId,
    has: (v: unknown): v is string =>
      typeof v === 'string' && ids.indexOf(v) >= 0,
    label: (id: string): string => {
      const f = findFamily(id);
      return f && typeof f.label === 'string' && f.label ? f.label : id;
    },
    suffixOf: (id: string): string => suffixOfFamily(findFamily(id)),
    actionLabel: (id: string): string => {
      const f = findFamily(id);
      if (f && typeof f.actionLabel === 'string' && f.actionLabel) {
        return f.actionLabel;
      }
      return f && typeof f.label === 'string' && f.label ? f.label : id;
    },
  };
};

/** 内置缺省注册表（`DEFAULT_EVENT_FAMILIES` 的归一结果）—— 供缺省参数复用，避免每处各建一份 */
export const DEFAULT_FAMILY_REGISTRY: FamilyRegistry =
  buildFamilyRegistry(undefined);

/**
 * 判某条念白属于哪一族（**注册表驱动的三段判据**）。
 *
 * ① 条目**显式 `phase`** 且是注册表里的 id ⇒ 就是它；
 * ② 否则按注册表各族的 `matchSuffix` 匹配动画名（**先声明先赢**）；
 * ③ 都不中 ⇒ **缺省族**。
 *
 * ⚠️ 注册表为空（本项目无事件族机制）⇒ **不判族**：原样返回条目自己的 `phase`
 *   （没有则 `''`），只为 `mergeKindPools` 的去重键保留区分度（此时不按族筛，见 `buildPool`）。
 */
export const resolveDialoguePhase = (
  e: DialogueEntry,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): TriggerPhase => {
  if (!reg.families.length) {
    return typeof e?.phase === 'string' ? e.phase : '';
  }
  if (typeof e?.phase === 'string' && reg.has(e.phase)) {
    return e.phase;
  }
  const anim = typeof e?.animation === 'string' ? e.animation : '';
  if (anim) {
    for (let i = 0; i < reg.families.length; i++) {
      const suf = reg.families[i].matchSuffix;
      if (typeof suf === 'string' && suf && anim.endsWith(suf)) {
        return reg.families[i].id;
      }
    }
  }
  return reg.fallbackId ?? '';
};

/**
 * 把任意值归一成**注册表内合法的事件族列表**：丢弃非法值、去重、按**注册表声明顺序**排序。
 *
 * ★ 与 `normalizeTriggerKinds` 同一条口径：面板里敲的顺序无关紧要，归一后永远同一种形状。
 * ⚠️ 非数组 ⇒ 空数组（调用方据此区分"没配"与"配了个空的"）。
 */
export const normalizeTriggerPhases = (
  phases: unknown,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): TriggerPhase[] => {
  if (!Array.isArray(phases)) {
    return [];
  }
  const want: string[] = [];
  phases.forEach((p: unknown) => {
    if (reg.has(p) && want.indexOf(p as string) < 0) {
      want.push(p as string);
    }
  });
  return reg.ids.filter((id) => want.indexOf(id) >= 0);
};

/**
 * 摊平「触摸可触发的事件族」—— 只归一，不判可用性。
 *
 * | 输入 | 结果 |
 * |---|---|
 * | 没配 / 非数组 | 注册表的**缺省勾选**（`reg.defaultIds`） |
 * | 合法数组（含**空数组**） | 归一后的列表；**空数组 = 显式全关**（绝不退回缺省） |
 * | 数组里一个合法值都没有（拼错） | 当作"没配"，退回缺省（config 无 schema 校验，宁可降级） |
 *
 * ★ 与 `resolveTriggerIntent` 对 `*Kinds` 的口径**完全一致**（同一个理由：拼错一个词
 *   不该静默把整条通道关掉；但空数组是合法的显式表达）。
 * ⚠️ **注册表为空 ⇒ 恒返回 `[]`**，且此时调用方**不按族筛**（见 `buildPool` 的 `phases`）。
 * ⚠️ 返回值**每次新拷贝**一份 —— 外部就地改它会污染缺省表。
 */
export const resolveTriggerPhases = (
  phases: unknown,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): TriggerPhase[] => {
  if (Array.isArray(phases)) {
    const want = normalizeTriggerPhases(phases, reg);
    if (want.length || phases.length === 0) {
      return want;
    }
  }
  return reg.defaultIds.slice();
};

/**
 * 摊平「**允许触发的事件族**」—— 面板「事件池 → 事件族」那一项（`subtitle.phases`）。
 *
 * ★★ **2026-10-17 起它对所有入口生效**（此前只作用于点击触摸，字段名因此叫
 *   `touchPhases`）。现在它是一道**全局闸门**：
 *
 * | 勾选 | 结果 |
 * |---|---|
 * | 勾了若干族 | **任何**通道（待机 / 点击 / 回到壁纸 / 常驻序列）都只从这些族取条 |
 * | **一项都不勾**（`[]`） | **所有池为空** ⇒ 档案里没有任何事件行，任何通道都不触发 |
 * | 没配 | 注册表的缺省勾选（`defaultIds`）；注册表为空 ⇒ `[]`（但此时也不按族筛） |
 *
 * ## 旧字段兼容（`touchPhases`）
 *
 * 改名前的 config / localStorage 覆盖层里写的是 `subtitle.touchPhases`。
 * 判据 = **新字段优先，旧字段仅在新字段缺席时读取**：
 *
 * | `phases` | `touchPhases` | 用哪个 |
 * |---|---|---|
 * | 给了（含空数组） | 任意 | `phases` —— ⚠️ **空数组是显式全关，绝不退回旧字段** |
 * | 没给 | 给了 | `touchPhases`（老存档照常生效） |
 * | 都没给 | — | 注册表缺省勾选 |
 *
 * ★ 为什么用 `!== undefined` 而不是 `??`：语义上两者等价（`??` 也只对 null/undefined 回退），
 *   但这里要**显式**表达"空数组是合法值"——`resolveTriggerPhases` 内部已按这个口径处理，
 *   直接传它即可。
 */
export const resolvePhases = (
  phases: unknown,
  legacyTouchPhases: unknown,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): TriggerPhase[] =>
  resolveTriggerPhases(phases !== undefined ? phases : legacyTouchPhases, reg);

/* ══════════════════════════════════════════════════════════════════════
 * 动作族（`subtitle.actionPhase`）—— 决定**播哪一套动画名**（2026-10-17）
 *
 * 与上面「哪些念白能被抽到」正交：这里只回答两件事
 *   ① 某条念白在当前状态下**播哪个动画名**（换名）；
 *   ② 某条念白在当前状态下**能不能进池**（属别的动作族的条目不能）。
 *
 * ⚠️ 换名**永远不动** `actionId` / `text` / `voice` / `phase`：
 *   游戏侧同一条 actionId 的 CV 不分誓约前后（`SoulSpineCell.PlayAction`），
 *   字幕与语音必须与换名前完全一致 —— 否则"动作换了、台词也对不上"。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 摊平「当前显示的动作族」。
 *
 * | 输入 | 结果 |
 * |---|---|
 * | **没配**（`undefined` / 非字符串） | `reg.defaultActionId`（第一个动作族；没有动作族 ⇒ `""`） |
 * | **空串 `""`** | `""`（= **显式**选"不换名"那一档） |
 * | 合法动作族 id | 原样 |
 * | 非法值 / 指向没有 `matchSuffix` 的族 | `""`（降级成不换名，绝不换到错误后缀） |
 *
 * ★ 缺省取"第一个动作族"而不是 `""`：誓约工程的 config 一旦声明了 `_marry` 后缀、
 *   就等于宣告"本壁纸有誓约态"，此时**出厂即婚后**（用户 2026-10-17 拍板）。
 *   非誓约工程没有任何动作族 ⇒ 恒 `""` ⇒ 行为与改动前逐字相同。
 * ⚠️ 与 `*Kinds` 的容错口径一致：拼错一个词只降级、不改语义。
 */
export const resolveActionPhase = (
  raw: unknown,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): TriggerPhase => {
  if (typeof raw === 'string') {
    return reg.suffixOf(raw) ? raw : '';
  }
  return reg.defaultActionId;
};

/**
 * 把一个**裸动画名**换到指定动作族（`resolveEntryAnimation` 的分支 ②③ 部分）。
 *
 * ★ 单独抽出来是给**常驻 idle** 用的：`meshConfig.animationName` 不是念白条目
 *   （`idle` 本来就不在 `dialogues` 里），但它同样要跟着动作族走
 *   （游戏 `GotoIdleState` 在誓约后用 `idle_marry`）。
 * ⚠️ 没有条目级的 `phaseAnimations` 覆盖可用 ⇒ 只认后缀 —— 所以调用方**必须**
 *   拿骨架的动画表核一次存在性（`index.ts` 的 `idleAnimation`）。
 */
export const resolveAnimationName = (
  base: string,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY,
  actionPhase: TriggerPhase = ''
): string => {
  if (!base) {
    return '';
  }
  const suffix = reg.suffixOf(actionPhase);
  if (!suffix) {
    return base;
  }
  return base.slice(-suffix.length) === suffix ? base : base + suffix;
};

/**
 * **常驻动画**换名 + 骨架存在性核对（`meshConfig.animationName` 专用）。
 *
 * 与念白条目的区别：条目可以有 `phaseAnimations` 显式覆盖，常驻动画只有"原名 + 后缀"
 * 一条路 ⇒ **必须**拿骨架动画表核一次，不然 `state.addAnimation` 遇未知名字会
 * **直接 throw**（`AnimationState.ts:601-603`，不是静默失败）。
 *
 * @param available 该骨架里真实存在的动画名（`skeletonData.animations`）
 * @returns `name` = 实际要播的常驻动画；`want` = 按规则算出来的（可能不存在）；
 *          `fallback` = 是否因为骨架里没有而退回原名（挂件骨架 / 非誓约皮肤属正常）
 */
export const resolveIdleAnimation = (
  base: string,
  available: readonly string[],
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY,
  actionPhase: TriggerPhase = ''
): { name: string; want: string; fallback: boolean } => {
  const want = resolveAnimationName(base, reg, actionPhase);
  if (!base || want === base) {
    return { name: base, want, fallback: false };
  }
  /** 没有动画表 ⇒ 不敢换（宁可保持原样，也不要 throw） */
  if (!available || !available.length) {
    return { name: base, want, fallback: true };
  }
  if (available.indexOf(want) >= 0) {
    return { name: want, want, fallback: false };
  }
  return { name: base, want, fallback: true };
};

/**
 * 某条念白在**指定动作族**下要播的动画名（换名的唯一判据）。
 *
 * 三分支，**显式优先**：
 *   ① 条目写了 `phaseAnimations[actionPhase]` ⇒ 用它（解决 `chat` → `chat2_marry`
 *      这种"不是原名加后缀"的个例，见 `DialogueEntry.phaseAnimations`）；
 *   ② 原名已以该族后缀结尾 ⇒ 原样（`greet_marry` 不会变成 `greet_marry_marry`）；
 *   ③ 否则 ⇒ `原名 + 后缀`。
 *
 * ⚠️ `actionPhase` 为空 / 无后缀族 ⇒ **恒返回原名**（分支 ①②③ 都不触发）。
 * ⚠️ 本函数是**纯字符串**运算，不知道骨架里到底有没有这条动画 ——
 *   存在性校验由 `index.ts` 拿 `skeletonData.animations` 做一次集中核对。
 */
export const resolveEntryAnimation = (
  e: DialogueEntry,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY,
  actionPhase: TriggerPhase = ''
): string => {
  const base = typeof e?.animation === 'string' ? e.animation : '';
  if (!base) {
    return '';
  }
  const suffix = reg.suffixOf(actionPhase);
  if (!suffix) {
    return base;
  }
  const map = e?.phaseAnimations;
  const override =
    map && typeof map === 'object' ? map[actionPhase] : undefined;
  if (typeof override === 'string' && override) {
    return override;
  }
  return resolveAnimationName(base, reg, actionPhase);
};

/**
 * 把整张念白表**投影**到某个动作族：返回新数组（每条浅拷贝），只改 `animation`。
 *
 * ★★ 这是"当前状态"的**唯一投影入口** —— `index.ts` / `archive.ts` / 调试面板
 *   必须都调它，**禁止**各自再写一份换名逻辑（否则"档案说会播 greet_marry、
 *   实际播 greet"这类漂移必然出现）。
 *
 * ★ 为什么同时**钉住 `phase`**：投影后动画名带了后缀，`resolveDialoguePhase` 的
 *   ② "按后缀判族"会把本来没有 `phase` 的条目判成该动作族 —— 从而改变它在池里的
 *   归类（`phases` 闸门、`mergeKindPools` 的去重键）。投影前先把判族结果写死，
 *   后续一切判据都基于**原动画名**，与"没投影"时完全一致。
 *
 * ⚠️ 无后缀（`actionPhase` 为空 / 非法）⇒ 原样返回**数组浅拷贝**（不克隆条目，
 *   因为什么都没变，克隆只会白白增加对象数）。
 */
export const projectDialoguesToActionPhase = (
  entries: DialogueEntry[],
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY,
  actionPhase: TriggerPhase = ''
): DialogueEntry[] => {
  if (!entries?.length) {
    return [];
  }
  if (!reg.suffixOf(actionPhase)) {
    return entries.slice();
  }
  return entries.map((e) => {
    if (!e) {
      return e;
    }
    /**
     * ★★ **每个 variant 也要换名**（2026-10-18，PLAN §2.3）。
     *   只换 `e.animation` 的话，混族时抽到 `variants[1]` 会播婚前动画名
     *   （`addAnimation` 直接 throw ⇒ 整次点击丢失）。
     */
    const variants = Array.isArray(e.variants)
      ? e.variants.map((v) =>
          v && typeof v.animation === 'string' && v.animation
            ? {
                ...v,
                animation: resolveAnimationName(v.animation, reg, actionPhase),
              }
            : v
        )
      : e.variants;
    return {
      ...e,
      animation: resolveEntryAnimation(e, reg, actionPhase),
      variants,
      /** 钉住投影前的判族结果（见上面的"为什么同时钉住 phase"） */
      phase: resolveDialoguePhase(e, reg),
    };
  });
};

/**
 * 某条念白在**当前动作族**下能不能进池。
 *
 * | 条件 | 结果 |
 * |---|---|
 * | 注册表为空（本项目没有事件族机制） | `true`（不筛） |
 * | 属**缺省族**（`fallbackId`） | `true`（誓约前/后都可用 —— 游戏里 `TouchFeedback` 的常态） |
 * | 属**当前动作族** | `true`（如誓约后的 `MarryAction` 三条） |
 * | 属**没有后缀的纯分类族** | `true`（它无法被表达成某个动作态 ⇒ 不因状态而消失；老 config 兜底） |
 * | 属**另一个动作族** | `false`（誓约前抽不到誓约后的专属念白 —— 与游戏婚前池 6 条一致） |
 *
 * ★ 这就是"婚前 6 / 婚后 9"的落点：S8 的 9 个 touch id 里 3 条属 `postMarry`，
 *   在 `actionPhase: ""` 时被挡掉，剩 6 条 = 游戏 `TouchFeedback` 的 6 个触摸位。
 */
export const isEntryVisibleInPhase = (
  e: DialogueEntry,
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY,
  actionPhase: TriggerPhase = ''
): boolean => {
  if (!reg.families.length) {
    return true;
  }
  const ph = resolveDialoguePhase(e, reg);
  if (ph === reg.fallbackId) {
    return true;
  }
  if (actionPhase && ph === actionPhase) {
    return true;
  }
  /** 无后缀的族不是"动作态"，不参与状态筛选（老 config 的 preMarry 等纯分类族走这里） */
  return reg.suffixOf(ph) === '';
};

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
  pools: Readonly<Record<TriggerEventKind, DialogueEntry[]>>,
  /** 事件族注册表（去重键里的族由它判定；缺省 = 内置单族 `normal`） */
  reg: FamilyRegistry = DEFAULT_FAMILY_REGISTRY
): DialogueEntry[] => {
  const out: DialogueEntry[] = [];
  /**
   * 去重键 = **`EventKey|phase`**（2026-10-10 起含族；2026-10-18 起换成 `EventKey`）。
   *
   * ★★ 同一动作的不同族孪生条目**共用 `actionId`** ⇒ 只按 id 去重会把孪生**静默丢掉**。
   *   ⚠️ 对既有 config（一个 id 只对应 `'normal'` 一条）**结果完全相同**
   *   —— 同一个 id 的 key 仍只有一个。
   * ★★ 为什么必须从 `e.actionId` 换成 `eventKeyOf(e)`：自定义事件**没有 `actionId`**
   *   ⇒ 旧键退化成 `undefined|phase`，**同族所有自定义事件被算成同一条**、
   *   只留一条进池、其余静默消失（PLAN §3 的真正理由）。
   */
  const seen: string[] = [];
  /** 逐类拼接；按 `EventKey|phase` 去重（既防跨类重复，也保住不同族的孪生） */
  TRIGGER_KIND_ORDER.forEach((kind) => {
    if (kinds.indexOf(kind) < 0) {
      return;
    }
    (pools[kind] ?? []).forEach((e) => {
      if (!e) {
        return;
      }
      const key = eventKeyOf(e) + '|' + resolveDialoguePhase(e, reg);
      if (seen.indexOf(key) >= 0) {
        return;
      }
      seen.push(key);
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

/**
 * 按时段取问候条目；该时段没配或条目缺失时返回 `null`。
 *
 * @deprecated 2026-10-18：漏斗（`index.ts` 的 `resolveEvent`）改用 `when.time` 条件，
 *   本函数只剩历史回归脚本在用。**新代码不要调它** —— 它的 `?? pickRandomFromPool`
 *   兜底与"作者期校验报错"直接对立（PLAN §5.3 已裁决为"接受不播"）。
 */
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
  const byTime = findByEventKey(entries, idForSlot(greet, slot) ?? '');
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
): EventKeyInput | undefined =>
  Array.isArray(greet) ? greet[SLOT_ORDER.indexOf(slot)] : greet?.[slot];
