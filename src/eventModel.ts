/**
 * 自定义事件系统的**数据模型层**：身份（`EventKey`）、归一（`normalizeEventTable`）、
 * 变体抽取。全部是**纯函数**，零 DOM、零副作用 —— 可以 `ts-node` 直接跑单测。
 *
 * ## 这一层存在的理由
 *
 * config 没有 schema 校验（见 `dialogue.buildPool` 的注释），所以"归一"必须**只有一处**：
 * 补 `id` / `on` / `kind` / `when` / `pick`，夹取数值，记录 issue。
 * 下游（漏斗、档案、离线 CLI）一律消费归一后的表 —— 任何一处再补一遍默认值，
 * 就会出现"引擎按 A 口径抽、档案按 B 口径显示"。
 *
 * ## 旧口径怎么办（最重要的一段）
 *
 * 迁移（PLAN §5 / S8）落地前，真实 config 仍是 `greeting` + `standby` + `touch` 三份
 * 旧池键，条目上没有 `on` / `kind` / `when`。本模块把它们**反推**成新字段：
 *
 * | 旧 | 反推 |
 * |---|---|
 * | `touch: [64005…]` | `on: ['touch']`、`kind: 'touch'` |
 * | `chat: [64004]` / `standby: 64004` | `on: ['standby']`、`kind: 'chat'` |
 * | `greeting.morning: 64001`（`greetMode:'time'`） | `on: ['resume']`、`kind: 'greet'`、`when:{time:{5,12}}` |
 * | `greet: [a,b,c]`（`greetMode:'time'`） | 同上，按时段**下标对位**（`SLOT_ORDER`） |
 * | `greetMode:'random'` | **不写** `time` 条件（PLAN §0 #3：禁止运行期按全局开关跳过叶子） |
 *
 * 反推成功的条目会带一条 `W_LEGACY`（每工程一条，不刷屏）。
 * **没有任何旧池键引用、也没有显式 `on`** 的内置条目 ⇒ `on: []`（不可达，`W_ORPHAN`），
 * 绝不按 `['standby']` 缺省悄悄上线（PLAN §5.3 的第二个缺口）。
 */

import {
  Condition,
  DialogueEntry,
  EventKey,
  EventKeyInput,
  EventVariant,
  GreetMode,
  PickPolicy,
  TriggerChannel,
  TriggerEventKind,
} from './config.type';
import { DEFAULT_TIME_RANGES, SLOT_ORDER } from './dialogue';

/* ══════════════════════════════════════════════════════════════════════
 * 身份
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * `EventKey` 的合法形状。
 *
 * - `game:<数字>` —— 内置（游戏表出身），可反查 `actionId`；
 * - `custom:<小写字母/数字开头，后续可含 - 和 _，总长 ≤ 40>` —— 用户建的。
 */
export const EVENT_KEY_RE = /^(game:\d+|custom:[a-z0-9][a-z0-9_-]{0,39})$/;

export const isEventKey = (v: unknown): v is EventKey =>
  typeof v === 'string' && EVENT_KEY_RE.test(v);

/**
 * 把兼容输入归一成 `EventKey`；非法 ⇒ `null`（调用方决定丢弃并报 `E_ID_INVALID`）。
 *
 * | 输入 | 输出 |
 * |---|---|
 * | `64005` | `'game:64005'` |
 * | `'64005'` | `'game:64005'`（数字串也当 game — config 里手写字符串是常见笔误） |
 * | `'game:64005'` / `'custom:good-night'` | 原样 |
 * | `''` / `'GoodNight'` / `'custom:'` / `{}` | `null` |
 *
 * ⚠️ **这是两个兼容边界之一**（另一个是 `__WB_DIALOGUE__.trigger`）。归一之后
 *   内部一律用 `EventKey`，不再接受 `number`（PLAN §0 #9）。
 */
export const normalizeEventKey = (v: unknown): EventKey | null => {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? 'game:' + Math.floor(v) : null;
  }
  if (typeof v !== 'string') {
    return null;
  }
  const s = v.trim();
  if (EVENT_KEY_RE.test(s)) {
    return s;
  }
  if (/^\d+$/.test(s)) {
    return 'game:' + s;
  }
  return null;
};

/**
 * 取条目的事件键：`id` 优先，否则由 `actionId` 派生。
 *
 * ⚠️ 两个都没有 ⇒ `''`（归一后的表不该出现；保留空串让"查不到"可判而不抛）。
 */
export const eventKeyOf = (e: DialogueEntry | null | undefined): EventKey => {
  if (!e) {
    return '';
  }
  const id = normalizeEventKey(e.id);
  if (id) {
    return id;
  }
  return typeof e.actionId === 'number' ? 'game:' + e.actionId : '';
};

/** 条目来自内置（有 `actionId` 或 `game:` 前缀） */
export const isBuiltinEvent = (e: DialogueEntry): boolean =>
  typeof e?.actionId === 'number' || eventKeyOf(e).indexOf('game:') === 0;

/* ══════════════════════════════════════════════════════════════════════
 * 校验 issue 的公共形状（normalize 与 validate 共用）
 * ══════════════════════════════════════════════════════════════════════ */

export type IssueDisposition = 'reject' | 'coerce' | 'report';

/** 码表见 PLAN §6.2 —— 每条码只声明一个处置，级别由处置派生 */
export type IssueCode =
  /**
   * 事件**文件**级问题（`assets/events.jsonc` 缺失 / 解析失败 / 条目不是对象）。
   * ★ 2026-10-19 起事件表只有一个来源 ⇒ 这类问题没有"降级继续"的余地，
   *   处置统一 `coerce`（= warn 级别），真正的告警由启动日志与面板红字承担。
   */
  | 'E_EVENTS_FILE'
  /** 文件 `schema` 比引擎新（向前兼容提示，不拦） */
  | 'W_EVENTS_FILE_SCHEMA'
  | 'E_ID_INVALID'
  | 'E_ID_DUP'
  | 'E_ANIM_MISSING'
  | 'E_EVENT_EMPTY'
  | 'E_ZONE_UNKNOWN'
  | 'E_COND_INVALID'
  | 'E_PARTICLES_UNKNOWN'
  | 'E_FAMILY_UNKNOWN'
  | 'E_PRIORITY_RANGE'
  | 'E_COND_UNKNOWN'
  | 'E_SUFFIX_MISSING'
  | 'E_VOICE_MISSING'
  | 'W_FAMILY_NOT_ENABLED'
  | 'W_ORPHAN'
  | 'W_TEXT_EMPTY'
  | 'W_LEGACY'
  | 'W_FX_DIVERGED';

export type Issue = {
  code: IssueCode;
  disposition: IssueDisposition;
  /** `error` / `warn` / `info` —— 由处置派生，**不单独声明** */
  level: 'error' | 'warn' | 'info';
  /** 相关事件（工程级 issue 为空串） */
  id: EventKey | '';
  /** 人话说明（进日志/档案） */
  detail: string;
};

/** 处置 ⇒ 级别（唯一映射，别在别处再写一遍） */
export const levelOf = (d: IssueDisposition): Issue['level'] =>
  d === 'reject' ? 'error' : d === 'coerce' ? 'warn' : 'info';

export const makeIssue = (
  code: IssueCode,
  disposition: IssueDisposition,
  detail: string,
  id: EventKey | '' = ''
): Issue => ({ code, disposition, level: levelOf(disposition), detail, id });

/* ══════════════════════════════════════════════════════════════════════
 * 通道 / 类别
 * ══════════════════════════════════════════════════════════════════════ */

const CHANNEL_ORDER: readonly TriggerChannel[] = ['standby', 'touch', 'resume'];

export const isChannel = (v: unknown): v is TriggerChannel =>
  v === 'standby' || v === 'touch' || v === 'resume';

export const isKind = (v: unknown): v is TriggerEventKind =>
  v === 'chat' || v === 'greet' || v === 'touch';

/** `on` 的归一：单值 / 数组都收；非法值丢弃、去重、按固定顺序 */
export const normalizeChannels = (v: unknown): TriggerChannel[] => {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  const want: TriggerChannel[] = [];
  list.forEach((c) => {
    if (isChannel(c) && want.indexOf(c) < 0) {
      want.push(c);
    }
  });
  return CHANNEL_ORDER.filter((c) => want.indexOf(c) >= 0);
};

/**
 * 通道 ⇒ 缺省类别。与 `dialogue.CHANNEL_DEFAULT_KINDS` **同一条映射**
 * （那边是"通道缺省勾哪几类"，这里是"条目没写 kind 时算哪类"；两者刻意一致）。
 */
export const defaultKindOf = (channel: TriggerChannel): TriggerEventKind =>
  channel === 'touch' ? 'touch' : channel === 'standby' ? 'chat' : 'greet';

/** 条目的生效类别：显式 `kind` 优先；否则按第一个通道推 */
export const kindOf = (
  e: DialogueEntry,
  channel?: TriggerChannel
): TriggerEventKind => {
  if (isKind(e?.kind)) {
    return e.kind;
  }
  const ch = channel ?? (Array.isArray(e?.on) ? e.on[0] : e?.on);
  if (isChannel(ch)) {
    return defaultKindOf(ch);
  }
  return 'chat';
};

/** 条目的生效通道列表（归一后应当已写死；没写 ⇒ 空 = 不可达） */
export const channelsOf = (e: DialogueEntry): TriggerChannel[] =>
  normalizeChannels(e?.on);

/* ══════════════════════════════════════════════════════════════════════
 * pick 归一
 * ══════════════════════════════════════════════════════════════════════ */

export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;

const clamp = (n: number, lo: number, hi: number): number =>
  n < lo ? lo : n > hi ? hi : n;

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === 'number' && isFinite(v) ? v : fallback;

/**
 * 归一 `pick`：越界**夹取**（`E_PRIORITY_RANGE`），非法值静默丢弃。
 *
 * ⚠️ `weight: 0` 是**合法且有意义**的（= 只能手动 trigger），绝不能被 `|| 1` 吃掉。
 */
export const normalizePick = (
  pick: unknown,
  id: EventKey
): { pick: PickPolicy | undefined; issues: Issue[] } => {
  if (!pick || typeof pick !== 'object') {
    return { pick: undefined, issues: [] };
  }
  const raw = pick as PickPolicy;
  const issues: Issue[] = [];
  const out: PickPolicy = {};
  if (typeof raw.priority === 'number' && isFinite(raw.priority)) {
    const p = clamp(Math.round(raw.priority), PRIORITY_MIN, PRIORITY_MAX);
    if (p !== raw.priority) {
      issues.push(
        makeIssue(
          'E_PRIORITY_RANGE',
          'coerce',
          'priority=' + raw.priority + ' 越界 ⇒ 夹取为 ' + p,
          id
        )
      );
    }
    out.priority = p;
  }
  if (typeof raw.weight === 'number' && isFinite(raw.weight)) {
    out.weight = Math.max(0, raw.weight);
  }
  if (typeof raw.group === 'string' && raw.group) {
    out.group = raw.group;
  }
  if (typeof raw.cooldownMs === 'number' && isFinite(raw.cooldownMs)) {
    out.cooldownMs = Math.max(0, Math.round(raw.cooldownMs));
  }
  if (raw.quota && typeof raw.quota === 'object') {
    const max = finiteOr(raw.quota.max, 0);
    const per = raw.quota.per;
    if (max > 0 && (per === 'session' || per === 'day' || per === 'ever')) {
      out.quota = { max: Math.floor(max), per };
    }
  }
  if (raw.interrupt === true) {
    out.interrupt = true;
  }
  return { pick: Object.keys(out).length ? out : undefined, issues };
};

/* ══════════════════════════════════════════════════════════════════════
 * 表归一
 * ══════════════════════════════════════════════════════════════════════ */

/** 旧口径输入（迁移前的 config 形状）—— 只用于**反推** `on` / `kind` / `when` */
export type LegacyEventSource = {
  /** `subtitle.touch` */
  touch?: EventKeyInput[];
  /** `subtitle.chat` */
  chat?: EventKeyInput[];
  /** 旧的单值 `subtitle.standby` */
  standby?: EventKeyInput;
  /** `subtitle.greet`（数组） */
  greet?: EventKeyInput[];
  /** 旧时段表 `subtitle.greeting` */
  greeting?: Partial<Record<string, EventKeyInput>>;
  /** 时段分界（缺省 `DEFAULT_TIME_RANGES`） */
  greetingRanges?: Partial<Record<string, { start: number; end: number }>>;
  /** 问候取条方式（`'time'` 才写时段条件） */
  greetMode?: GreetMode;
};

export type NormalizeOptions = {
  legacy?: LegacyEventSource;
};

export type NormalizeResult = {
  events: DialogueEntry[];
  issues: Issue[];
};

/** 把 id 列表摊平（兼容 number / EventKey，去重保序） */
const toKeyList = (ids: EventKeyInput[] | undefined): EventKey[] => {
  const out: EventKey[] = [];
  (ids ?? []).forEach((raw) => {
    const k = normalizeEventKey(raw);
    if (k && out.indexOf(k) < 0) {
      out.push(k);
    }
  });
  return out;
};

/**
 * 把 config 的 `subtitle.dialogues` 归一成**事件表**。
 *
 * 产出保证：
 *   1. `id` 一定是合法 `EventKey`（非法/重复的条目被丢弃并记账）；
 *   2. `on` 一定存在（可能是 `[]` = 不可达，而非"缺省 standby"）；
 *   3. `kind` 一定存在（显式 > 旧池反推 > 按通道推）；
 *   4. `when` / `pick` / `variants` / `particles` 已归一。
 *
 * ⚠️ **不修改入参**（逐条浅拷贝；`pick` / `variants` 是新建对象）。
 */
export const normalizeEventTable = (
  raw: DialogueEntry[] | undefined,
  options: NormalizeOptions = {}
): NormalizeResult => {
  const issues: Issue[] = [];
  const legacy = options.legacy ?? {};
  const ranged = legacy.greetingRanges ?? DEFAULT_TIME_RANGES;

  /** 旧池 → 事件键 → 通道集合 */
  const legacyChannels: { [key: string]: TriggerChannel[] } = {};
  const legacyKinds: { [key: string]: TriggerEventKind } = {};
  const legacyTimes: { [key: string]: { start: number; end: number } } = {};
  const mark = (
    key: EventKey,
    ch: TriggerChannel,
    kind: TriggerEventKind
  ): void => {
    const arr = legacyChannels[key] ?? (legacyChannels[key] = []);
    if (arr.indexOf(ch) < 0) {
      arr.push(ch);
    }
    if (!legacyKinds[key]) {
      legacyKinds[key] = kind;
    }
  };

  toKeyList(legacy.touch).forEach((k) => mark(k, 'touch', 'touch'));
  /**
   * ⚠️ 与 `dialogue.resolveChatIds` **同一条优先级**：`chat` 非空时**不看** `standby`
   *   （旧口径是"chat 优先，空数组才退回 standby"）。两条都标会把旧 config 里
   *   本该失效的那一条悄悄复活。
   */
  const chatKeys = toKeyList(legacy.chat);
  chatKeys.forEach((k) => mark(k, 'standby', 'chat'));
  if (!chatKeys.length) {
    toKeyList(
      typeof legacy.standby === 'undefined' ? [] : [legacy.standby]
    ).forEach((k) => mark(k, 'standby', 'chat'));
  }

  /**
   * 问候：`greet` 数组与旧时段表 `greeting` 共用一条反推规则。
   * ⚠️ 只有 `greetMode === 'time'`（缺省）才写时段条件 —— `'random'` 下写进去
   *   等于运行期按全局开关跳过叶子，`describeCondition` 会与实际执行不一致（PLAN §0 #3）。
   */
  /**
   * ⚠️ 与 `dialogue.resolveGreetSource` **同一条优先级**：`greet` 数组非空时
   *   **不看**旧时段表 `greeting`（那里"空数组才回退"）。
   */
  const greetArrayKeys = toKeyList(legacy.greet);
  const timeMode = (legacy.greetMode ?? 'time') === 'time';
  const slotOfKey: { [key: string]: string } = {};
  if (greetArrayKeys.length) {
    /** 数组形状：**下标对位**（`SLOT_ORDER` 的顺序 = 早/中/晚） */
    greetArrayKeys.forEach((k, i) => {
      if (SLOT_ORDER[i]) {
        slotOfKey[k] = SLOT_ORDER[i];
      }
    });
    greetArrayKeys.forEach((k) => mark(k, 'resume', 'greet'));
  } else {
    SLOT_ORDER.forEach((slot) => {
      const fromObject = normalizeEventKey(legacy.greeting?.[slot]);
      if (fromObject) {
        slotOfKey[fromObject] = slot;
        mark(fromObject, 'resume', 'greet');
      }
    });
  }
  if (timeMode) {
    Object.keys(slotOfKey).forEach((k) => {
      const slot = slotOfKey[k];
      const range = ranged[slot] ?? DEFAULT_TIME_RANGES[slot as 'morning'];
      if (range) {
        legacyTimes[k] = { start: range.start, end: range.end };
      }
    });
  }

  const events: DialogueEntry[] = [];
  const seen: EventKey[] = [];
  const usedLegacy: { [key: string]: boolean } = {};

  (raw ?? []).forEach((rawEntry, idx) => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      issues.push(
        makeIssue('E_ID_INVALID', 'reject', 'dialogues[' + idx + '] 不是对象')
      );
      return;
    }
    const key = normalizeEventKey(
      rawEntry.id !== undefined ? rawEntry.id : rawEntry.actionId
    );
    if (!key) {
      issues.push(
        makeIssue(
          'E_ID_INVALID',
          'reject',
          'dialogues[' +
            idx +
            '] 的 id/actionId 非法: ' +
            JSON.stringify(
              rawEntry.id !== undefined ? rawEntry.id : rawEntry.actionId
            ),
          ''
        )
      );
      return;
    }
    if (seen.indexOf(key) >= 0) {
      issues.push(
        makeIssue('E_ID_DUP', 'reject', '重复的 id（保留首条，丢弃本条）', key)
      );
      return;
    }
    seen.push(key);

    const explicitOn = normalizeChannels(rawEntry.on);
    const derivedOn = legacyChannels[key] ?? [];
    const on = explicitOn.length ? explicitOn : derivedOn;
    /** 旧池反推生效 ⇒ 记 `W_LEGACY`（每工程汇总一次，见下面） */
    if (!explicitOn.length && derivedOn.length) {
      usedLegacy[key] = true;
    }
    /** 既不是自定义、又没被任何旧池引用、也没显式 on ⇒ 不可达（`W_ORPHAN`） */
    const isCustom = key.indexOf('custom:') === 0;
    const finalOn = on.length
      ? on
      : isCustom
      ? ['standby' as TriggerChannel]
      : [];

    const explicitKind = isKind(rawEntry.kind) ? rawEntry.kind : undefined;
    const kind =
      explicitKind ??
      legacyKinds[key] ??
      (finalOn.length ? defaultKindOf(finalOn[0]) : 'chat');

    const pr = normalizePick(rawEntry.pick, key);
    pr.issues.forEach((it) => issues.push(it));

    const variants = normalizeVariants(rawEntry.variants, key, issues);

    events.push({
      ...rawEntry,
      id: key,
      on: finalOn,
      kind,
      when: rawEntry.when ?? timeCondition(legacyTimes[key]),
      pick: pr.pick,
      variants,
      enabled: rawEntry.enabled !== false,
    });

    if (!finalOn.length) {
      issues.push(
        makeIssue(
          'W_ORPHAN',
          'report',
          '没有任何通道可达（旧池未引用、也没写 on）⇒ 永不播放',
          key
        )
      );
    }
  });

  /** `W_LEGACY` 只报一条（工程级），列出受影响的条目，避免每行一条 */
  const legacyKeys = Object.keys(usedLegacy);
  if (legacyKeys.length) {
    issues.push(
      makeIssue(
        'W_LEGACY',
        'report',
        legacyKeys.length +
          ' 条事件的条件/通道由旧池键派生（' +
          legacyKeys.slice(0, 6).join(', ') +
          (legacyKeys.length > 6 ? ' …' : '') +
          '）—— 建议跑迁移',
        ''
      )
    );
  }

  return { events, issues };
};

/** `{start,end}` → `{time:{...}}`；没有 ⇒ `undefined`（= 恒真） */
const timeCondition = (
  range: { start: number; end: number } | undefined
): Condition | undefined =>
  range ? { time: { start: range.start, end: range.end } } : undefined;

/** 变体归一：丢非对象、`weight` 夹取；字段逐个校验类型 */
const normalizeVariants = (
  raw: unknown,
  id: EventKey,
  issues: Issue[]
): EventVariant[] | undefined => {
  if (!Array.isArray(raw) || !raw.length) {
    return undefined;
  }
  const out: EventVariant[] = [];
  raw.forEach((v, i) => {
    if (!v || typeof v !== 'object') {
      issues.push(
        makeIssue(
          'E_COND_INVALID',
          'coerce',
          'variants[' + i + '] 不是对象 ⇒ 丢弃',
          id
        )
      );
      return;
    }
    const src = v as EventVariant;
    const item: EventVariant = {};
    if (typeof src.weight === 'number' && isFinite(src.weight)) {
      item.weight = Math.max(0, src.weight);
    }
    if (typeof src.animation === 'string' && src.animation) {
      item.animation = src.animation;
    }
    if (Array.isArray(src.particles)) {
      item.particles = src.particles.filter((n) => typeof n === 'string' && n);
    }
    if (typeof src.text === 'string') {
      item.text = src.text;
    }
    if (typeof src.voice === 'string' && src.voice) {
      item.voice = src.voice;
    }
    if (typeof src.textTime === 'number' && isFinite(src.textTime)) {
      item.textTime = src.textTime;
    }
    out.push(item);
  });
  return out.length ? out : undefined;
};

/* ══════════════════════════════════════════════════════════════════════
 * 变体抽取（PLAN §2.3）
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 把一条事件 + 抽中的变体**合成**成"这次真正要播的那条"。
 *
 * - 不写 `variants` ⇒ 原样返回（逐字等价旧行为，零拷贝）；
 * - 写了 ⇒ 基准字段仍参与（隐式 variant#0，`weight` 缺省 1），
 *   抽中的变体逐字段覆盖基准；**整包一起换**（动作/粒子/台词/语音）。
 *
 * ⚠️ 配额 / 冷却 / 互斥组只看**事件**，与抽中哪个变体无关 —— 所以本函数
 *   只在"已经决定播这条"之后调用。
 */
export const resolveEventVariant = (
  e: DialogueEntry,
  rnd: () => number = Math.random
): DialogueEntry => {
  const list = e?.variants;
  if (!list || !list.length) {
    return e;
  }
  /** 基准 = 隐式 variant#0 */
  const all: EventVariant[] = [{}, ...list];
  const weights = all.map((v) =>
    typeof v.weight === 'number' && isFinite(v.weight)
      ? Math.max(0, v.weight)
      : 1
  );
  const total = weights.reduce((s, w) => s + w, 0);
  let chosen = 0;
  if (total > 0) {
    let r = rnd() * total;
    for (let i = 0; i < all.length; i++) {
      r -= weights[i];
      if (r < 0) {
        chosen = i;
        break;
      }
      chosen = i;
    }
  }
  const v = all[chosen];
  return {
    ...e,
    animation: v.animation ?? e.animation,
    particles: v.particles ?? e.particles,
    text: v.text ?? e.text,
    voice: v.voice ?? e.voice,
    textTime: v.textTime ?? e.textTime,
  };
};
