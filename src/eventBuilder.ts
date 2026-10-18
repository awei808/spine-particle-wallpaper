/**
 * 「自定义事件」面板的**纯数据层**（PLAN §7 / S9）。
 *
 * 面板只负责收集"点选"结果（`CustomEventDraft`），把它编译成一条 `DialogueEntry`
 * 的工作全部在这里 —— 纯函数、零 DOM ⇒ 回归脚本可以 `ts-node` 直接断言
 * （`_regress/89`），不必去点一遍 UI。
 *
 * ## 三条硬口径（照抄 PLAN，不要在这里"优化"）
 *
 * | 口径 | 出处 | 说明 |
 * |---|---|---|
 * | 不写 `phase` | PLAN §0 #6 | 自定义事件落在**缺省族**（不换名、恒可见）；写死族名就等于替作者决定动作族 |
 * | 多选 = 整包随机 | PLAN §2.3 | 动作 × 粒子做**交叉组合**，每包同时决定"动作 + 粒子"，不会出现动作与粒子错配 |
 * | 单组不写 `variants` | PLAN §2.3 | 只有 1 个组合时保持"不写 variants ⇒ 逐字等价现有条目" |
 *
 * ⚠️ **台词/语音是继承来的副本**（`textSourceKey` 指向一条现有事件）。之所以复制而不是
 * 引用：`DialogueEntry` 是扁平结构，没有"引用另一条"的字段；复制之后用户可以单独给它
 * 换动作/条件，而不会反噬原条目。
 */

import {
  Condition,
  DialogueEntry,
  EventKey,
  TriggerChannel,
} from './config.type';
import { defaultKindOf, eventKeyOf, normalizeChannels } from './eventModel';

/** 「触发条件」模板（面板上五个分段） */
export type CustomConditionKind = 'none' | 'time' | 'date' | 'zone' | 'idle';

export type CustomEventDraft = {
  /** 触发通道（可多值；类别按第一个推，与 `normalizeEventTable` 同一函数） */
  channels: TriggerChannel[];
  condition: CustomConditionKind;
  /** `condition:'time'` —— 小时 0..23，`start > end` = 跨零点 */
  timeStart: number;
  timeEnd: number;
  /** `condition:'date'` —— 每年这一天 */
  month: number;
  day: number;
  /** `condition:'zone'` —— 热区 id（`config.touch.zones[].id`） */
  zone?: string;
  /** `condition:'idle'` —— 静置分钟数 */
  idleMinutes?: number;
  /** 动作候选：1 个 = 固定；≥2 = 每次随机一个 */
  animations: string[];
  /** 粒子候选：0 个 = 回落 `actionEffects`；1 个 = 固定；≥2 = 每次随机一组 */
  particles?: string[];
  /** 台词/语音的来源条目键（`''` = 纯动作事件） */
  textSourceKey?: EventKey | '';
  /** 优先级档（0..100） */
  priority: number;
  /** 每天最多一次（`pick.quota`） */
  dailyOnce: boolean;
};

export type BuildDeps = {
  /** 骨架里可用的动画名（`options.animations`） */
  animations: readonly string[];
  /** 现有事件（用于继承台词/语音；缺省 ⇒ 继承不到东西） */
  events?: readonly DialogueEntry[];
  /** 已被占用的 `custom:` 键（避免重名） */
  existingKeys?: readonly EventKey[];
};

/** 草稿 ⇒ 条件 AST（非法/空 ⇒ `undefined` = 恒真） */
export const conditionFromDraft = (
  d: CustomEventDraft
): Condition | undefined => {
  switch (d.condition) {
    case 'time':
      return { time: { start: d.timeStart, end: d.timeEnd } };
    case 'date':
      return { calendar: { month: d.month, day: d.day } };
    case 'zone':
      return d.zone ? { ctx: { zone: d.zone } } : undefined;
    case 'idle':
      return { ctx: { idleMs: Math.max(1, d.idleMinutes ?? 1) * 60000 } };
    default:
      return undefined;
  }
};

/** 下一个可用的 `custom:evN`（零键盘 ⇒ 名字自动生成，跳过已占用的） */
export const nextCustomKey = (used: readonly (EventKey | '')[]): EventKey => {
  let n = 1;
  while (used.indexOf('custom:ev' + n) >= 0) {
    n += 1;
  }
  return 'custom:ev' + n;
};

/**
 * 把草稿编译成一条事件。
 *
 * @returns `null` = 缺关键字段（没有通道 / 没有可用动画）⇒ 面板提示"至少选一个"。
 */
export const buildCustomEvent = (
  d: CustomEventDraft,
  deps: BuildDeps
): DialogueEntry | null => {
  const channels = normalizeChannels(d.channels);
  if (!channels.length) {
    return null;
  }
  /** 动作：草稿没选 ⇒ 退第一个可用动画（等价"最省事的默认"） */
  const anims = d.animations.length
    ? d.animations.slice()
    : deps.animations.length
    ? [deps.animations[0]]
    : [];
  if (!anims.length) {
    return null;
  }
  const parts = (d.particles ?? []).slice();
  /**
   * ★ 整包组合：粒子挑了多组时，**每组单独成包**（"随机一组"，而不是同时播多组）。
   *   动作 × 粒子 = 笛卡尔积 ⇒ 每包是一套完整的"动作 + 粒子"。
   */
  const packages: { animation: string; particles?: string[] }[] = [];
  if (parts.length > 1) {
    anims.forEach((a) => {
      parts.forEach((p) => packages.push({ animation: a, particles: [p] }));
    });
  } else {
    anims.forEach((a) => {
      packages.push(
        parts.length
          ? { animation: a, particles: [parts[0]] }
          : { animation: a }
      );
    });
  }

  const src =
    d.textSourceKey && deps.events
      ? deps.events.find((e) => eventKeyOf(e) === d.textSourceKey) ?? null
      : null;

  const used: EventKey[] = (deps.events ?? [])
    .map((e) => eventKeyOf(e))
    .concat(deps.existingKeys ?? [])
    .filter((k): k is EventKey => !!k);
  const id = nextCustomKey(used);

  const def: DialogueEntry = {
    id,
    displayName: '自定义事件 ' + id.replace('custom:ev', ''),
    note: '面板新建',
    on: channels,
    kind: defaultKindOf(channels[0]),
    animation: packages[0].animation,
    particles: packages[0].particles,
    pick: {
      priority: Math.max(0, Math.min(100, Math.round(d.priority))),
      ...(d.dailyOnce ? { quota: { max: 1, per: 'day' as const } } : {}),
    },
  };
  const when = conditionFromDraft(d);
  if (when) {
    def.when = when;
  }
  /** 台词/语音：**继承的副本**（`undefined` 时不写键 —— 免得出现 `"text": undefined`） */
  if (src) {
    if (src.text !== undefined) {
      def.text = src.text;
    }
    if (src.voice !== undefined) {
      def.voice = src.voice;
    }
    if (src.textTime !== undefined) {
      def.textTime = src.textTime;
    }
  }
  if (packages.length > 1) {
    def.variants = packages.slice(1);
  }
  return def;
};
