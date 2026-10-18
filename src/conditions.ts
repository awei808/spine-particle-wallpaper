/**
 * 条件 AST 的**编译 / 反序列化 / 结构体检**（PLAN §2.2 / §4.2 第 ② 层）。
 *
 * ## 三条硬规矩
 *
 * 1. **不用 `eval`、不用字符串表达式**：WE 的 CEF 里 `eval` 既受限又不可审计。
 * 2. **纯函数**：`compileCondition(cond) => (now, ctx) => boolean` —— 时钟与上下文
 *    全部由外部注入 ⇒ 单测可以把"2 月 14 日 23:30"钉死，不依赖跑测试的那一天。
 * 3. **`describeCondition` 是条件文案的唯一起点**：档案/面板预览只准调它。
 *    反过来，**任何"按全局开关跳过叶子"的路径都被禁止**（PLAN §0 #3）——
 *    否则"档案里写的条件"与"真正执行的条件"必然漂移。
 *
 * ## 未知键：恒真 + 留痕
 *
 * 与 `*Kinds` 的容错口径一致：拼错一个词不该把事件关掉 ⇒ 该叶子**按恒真**处理，
 * 同时由 `inspectCondition` 报一条 `E_COND_UNKNOWN`（coerce）。结构错误（`month: 13`、
 * `start === end`、`not` 里塞了个数字）才是 `E_COND_INVALID`（reject）。
 */

import { Condition, ConditionContext } from './config.type';

/** 编译后的判据。`now` 缺省 = 现在；`ctx` 缺省 = 空上下文 */
export type CompiledCondition = (now?: Date, ctx?: ConditionContext) => boolean;

const TRUE: CompiledCondition = () => true;

const HOUR_OK = (n: unknown): boolean =>
  typeof n === 'number' && isFinite(n) && n >= 0 && n <= 24;

/** `'MM-DD'` → `{m, d}`；非法 ⇒ `null` */
const parseMonthDay = (v: unknown): { m: number; d: number } | null => {
  if (typeof v !== 'string') {
    return null;
  }
  const m = /^(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) {
    return null;
  }
  const mo = Number(m[1]);
  const d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return null;
  }
  return { m: mo, d };
};

const isPlainObject = (v: unknown): v is { [k: string]: unknown } =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 已知的 AST 键（别的键 ⇒ `E_COND_UNKNOWN`，该叶子恒真） */
const KNOWN_KEYS = ['all', 'any', 'not', 'time', 'calendar', 'ctx'];

/**
 * 条件体检结果。
 *
 * - `unknown`：出现了不认识的键（coerce：恒真）
 * - `invalid`：结构/取值错误（reject：不可播）
 *
 * ⚠️ 两类**分开**：把"拼错"当 reject 会把事件整条关掉，把"类型错"当 coerce
 *   会让 `month: 13` 静默变成"恒真"、情人节天天过。
 */
export type ConditionInspection = {
  unknown: string[];
  invalid: string[];
};

/**
 * 结构体检（供 `eventValidate` 使用，**不参与求值**）。
 *
 * 深度遍历；同一处错误只报一次（用 `path` 定位，如 `all[1].calendar.month`）。
 */
export const inspectCondition = (
  cond: unknown,
  path = '',
  out: ConditionInspection = { unknown: [], invalid: [] }
): ConditionInspection => {
  if (cond === undefined || cond === null) {
    return out;
  }
  if (!isPlainObject(cond)) {
    out.invalid.push(path + ': 条件必须是对象');
    return out;
  }
  const keys = Object.keys(cond);
  const unknownKeys = keys.filter((k) => KNOWN_KEYS.indexOf(k) < 0);
  if (unknownKeys.length) {
    unknownKeys.forEach((k) => out.unknown.push((path ? path + '.' : '') + k));
    /** 未知键：整叶子按恒真，但**不再**继续校验它内部（那是别人的方言） */
    if (keys.length === 1) {
      return out;
    }
  }
  const known = keys.filter((k) => KNOWN_KEYS.indexOf(k) >= 0);
  if (known.length > 1) {
    out.invalid.push(
      path +
        ': 一个对象里只能有一个组合子/叶子键（实际: ' +
        known.join(', ') +
        '）'
    );
    return out;
  }
  if (!known.length) {
    return out;
  }
  const key = known[0];
  const val = cond[key];
  if (key === 'all' || key === 'any') {
    if (!Array.isArray(val)) {
      out.invalid.push(path + '.' + key + ': 必须是数组');
      return out;
    }
    val.forEach((c, i) =>
      inspectCondition(c, path + '.' + key + '[' + i + ']', out)
    );
    return out;
  }
  if (key === 'not') {
    if (!isPlainObject(val)) {
      out.invalid.push(path + '.not: 必须是条件对象');
    } else {
      inspectCondition(val, path + '.not', out);
    }
    return out;
  }
  if (key === 'time') {
    if (!isPlainObject(val)) {
      out.invalid.push(path + '.time: 必须是 {start,end}');
      return out;
    }
    const start = (val as { start?: unknown }).start;
    const end = (val as { end?: unknown }).end;
    if (!HOUR_OK(start) || !HOUR_OK(end)) {
      out.invalid.push(path + '.time: start/end 必须是 0..24 的小时');
    } else if (start === end) {
      /** 与 `dialogue.isHourInRange`（start===end = 全天）刻意不同：那是**旧函数**的兜底 */
      out.invalid.push(
        path + '.time: start 与 end 相同（要"全天"请删掉本条件）'
      );
    }
    return out;
  }
  if (key === 'calendar') {
    if (!isPlainObject(val)) {
      out.invalid.push(path + '.calendar: 必须是对象');
      return out;
    }
    const c = val as {
      month?: unknown;
      day?: unknown;
      from?: unknown;
      to?: unknown;
      weekday?: unknown;
    };
    if (
      c.month !== undefined &&
      !(typeof c.month === 'number' && c.month >= 1 && c.month <= 12)
    ) {
      out.invalid.push(path + '.calendar.month: 必须是 1..12');
    }
    if (
      c.day !== undefined &&
      !(typeof c.day === 'number' && c.day >= 1 && c.day <= 31)
    ) {
      out.invalid.push(path + '.calendar.day: 必须是 1..31');
    }
    if (c.from !== undefined && !parseMonthDay(c.from)) {
      out.invalid.push(path + '.calendar.from: 必须是 "MM-DD"');
    }
    if (c.to !== undefined && !parseMonthDay(c.to)) {
      out.invalid.push(path + '.calendar.to: 必须是 "MM-DD"');
    }
    if (c.from !== undefined && c.to === undefined) {
      out.invalid.push(path + '.calendar: 给了 from 就必须给 to');
    }
    if (c.weekday !== undefined) {
      if (!Array.isArray(c.weekday)) {
        out.invalid.push(path + '.calendar.weekday: 必须是数组');
      } else if (
        c.weekday.some(
          (d) =>
            !(typeof d === 'number' && d >= 0 && d <= 6 && Math.floor(d) === d)
        )
      ) {
        out.invalid.push(
          path + '.calendar.weekday: 元素必须是 0..6 的整数（0=周日）'
        );
      }
    }
    return out;
  }
  // ctx
  if (!isPlainObject(val)) {
    out.invalid.push(path + '.ctx: 必须是对象');
    return out;
  }
  const x = val as { idleMs?: unknown; zone?: unknown; signal?: unknown };
  if (
    x.idleMs !== undefined &&
    !(typeof x.idleMs === 'number' && isFinite(x.idleMs) && x.idleMs >= 0)
  ) {
    out.invalid.push(path + '.ctx.idleMs: 必须是 >=0 的毫秒数');
  }
  if (x.zone !== undefined && !(typeof x.zone === 'string' && x.zone)) {
    out.invalid.push(path + '.ctx.zone: 必须是非空字符串（热区 id）');
  }
  if (x.signal !== undefined) {
    const list = Array.isArray(x.signal) ? x.signal : [x.signal];
    const bad = list.filter(
      (s) => s !== 'boot' && s !== 'visible' && s !== 'focus' && s !== 'resume'
    );
    if (bad.length) {
      out.invalid.push(
        path +
          '.ctx.signal: 只支持 boot/visible/focus/resume（实际: ' +
          String(bad.join(',')) +
          '）'
      );
    }
  }
  return out;
};

/** 日历是否命中（`from/to` 可跨年：`12-24` → `01-05`） */
const calendarHit = (
  c: {
    month?: unknown;
    day?: unknown;
    from?: unknown;
    to?: unknown;
    weekday?: unknown;
  },
  now: Date
): boolean => {
  if (typeof c.month === 'number' && now.getMonth() + 1 !== c.month) {
    return false;
  }
  if (typeof c.day === 'number' && now.getDate() !== c.day) {
    return false;
  }
  const from = parseMonthDay(c.from);
  const to = parseMonthDay(c.to);
  if (from && to) {
    /** 用 `MMDD` 整数比较；`from > to` ⇒ 跨年 */
    const cur = (now.getMonth() + 1) * 100 + now.getDate();
    const a = from.m * 100 + from.d;
    const b = to.m * 100 + to.d;
    const inside = a <= b ? cur >= a && cur <= b : cur >= a || cur <= b;
    if (!inside) {
      return false;
    }
  }
  if (Array.isArray(c.weekday) && c.weekday.indexOf(now.getDay()) < 0) {
    return false;
  }
  return true;
};

/**
 * 编译条件。
 *
 * | 输入 | 行为 |
 * |---|---|
 * | `undefined` / `{}`（空对象） | 恒真（老 config 无 `when` 走这里） |
 * | 未知键 / 结构错误 | **恒真**（错误由 `inspectCondition` 报，求值不许抛） |
 * | `time` / `calendar` / `ctx` | 按注入的 `now` / `ctx` 判定 |
 *
 * ★ **求值绝不 throw**：壁纸里一条坏条件炸掉整个 tick，比"这条不播"严重得多。
 */
export const compileCondition = (
  cond?: Condition | unknown
): CompiledCondition => {
  if (cond === undefined || cond === null) {
    return TRUE;
  }
  if (!isPlainObject(cond)) {
    return TRUE;
  }
  const keys = Object.keys(cond);
  if (!keys.length) {
    return TRUE;
  }
  const known = keys.filter((k) => KNOWN_KEYS.indexOf(k) >= 0);
  if (!known.length) {
    /** 只有未知键 ⇒ 恒真（coerce） */
    return TRUE;
  }
  if (known.length > 1) {
    return TRUE;
  }
  const key = known[0];
  const val = (cond as { [k: string]: unknown })[key];

  if (key === 'all' || key === 'any') {
    if (!Array.isArray(val)) {
      return TRUE;
    }
    const children = val.map((c) => compileCondition(c));
    if (!children.length) {
      /** `all: []` = 恒真；`any: []` = 恒假（空析取） */
      return key === 'all' ? TRUE : () => false;
    }
    return key === 'all'
      ? (now, ctx) => children.every((f) => f(now, ctx))
      : (now, ctx) => children.some((f) => f(now, ctx));
  }
  if (key === 'not') {
    const inner = compileCondition(val);
    return (now, ctx) => !inner(now, ctx);
  }
  if (key === 'time') {
    const t = val as { start?: unknown; end?: unknown };
    if (!HOUR_OK(t?.start) || !HOUR_OK(t?.end)) {
      return TRUE;
    }
    const start = t.start as number;
    const end = t.end as number;
    if (start === end) {
      return TRUE;
    }
    return (now) => {
      const h = (now ?? new Date()).getHours();
      return start < end ? h >= start && h < end : h >= start || h < end;
    };
  }
  if (key === 'calendar') {
    if (!isPlainObject(val)) {
      return TRUE;
    }
    const c = val as {
      month?: unknown;
      day?: unknown;
      from?: unknown;
      to?: unknown;
      weekday?: unknown;
    };
    return (now) => calendarHit(c, now ?? new Date());
  }
  // ctx
  if (!isPlainObject(val)) {
    return TRUE;
  }
  const c = val as { idleMs?: unknown; zone?: unknown; signal?: unknown };
  const wantIdle = typeof c.idleMs === 'number' ? c.idleMs : undefined;
  const wantZone = typeof c.zone === 'string' ? c.zone : undefined;
  const wantSignals: string[] | undefined = Array.isArray(c.signal)
    ? (c.signal as string[])
    : typeof c.signal === 'string'
    ? [c.signal]
    : undefined;
  return (_now, ctx) => {
    const x = ctx ?? {};
    if (
      wantIdle !== undefined &&
      !(typeof x.idleMs === 'number' && x.idleMs >= wantIdle)
    ) {
      return false;
    }
    if (wantZone !== undefined && x.zone !== wantZone) {
      return false;
    }
    if (wantSignals && (!x.signal || wantSignals.indexOf(x.signal) < 0)) {
      return false;
    }
    return true;
  };
};

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n));

/**
 * 条件 → 人话（**档案条件列与面板预览只准调它**）。
 *
 * 输出刻意稳定：同样的 AST 永远得到同一串文本（回归里写死断言）。
 * 例：`2月14日 ∧ 时段 23:00–04:00`。
 */
export const describeCondition = (
  cond?: Condition | unknown,
  /** 嵌套层：`all`/`any`/`not` 内部才需要括号，顶层不加（档案列更短） */
  nested = false
): string => {
  if (cond === undefined || cond === null) {
    return '恒真';
  }
  if (!isPlainObject(cond)) {
    return '未知条件（按恒真处理）';
  }
  const keys = Object.keys(cond);
  if (!keys.length) {
    return '恒真';
  }
  const known = keys.filter((k) => KNOWN_KEYS.indexOf(k) >= 0);
  if (!known.length) {
    return '未知条件（按恒真处理）';
  }
  if (known.length > 1) {
    return '未知条件（按恒真处理）';
  }
  const key = known[0];
  const val = (cond as { [k: string]: unknown })[key];
  if (key === 'all' || key === 'any') {
    const list = Array.isArray(val) ? val : [];
    if (!list.length) {
      return key === 'all' ? '恒真' : '恒假';
    }
    const inner = list.map((c) => describeCondition(c, true));
    const text = inner.join(key === 'all' ? ' ∧ ' : ' ∨ ');
    return list.length > 1 && nested ? '(' + text + ')' : text;
  }
  if (key === 'not') {
    return '¬(' + describeCondition(val, true) + ')';
  }
  if (key === 'time') {
    const t = val as { start?: unknown; end?: unknown };
    if (!HOUR_OK(t?.start) || !HOUR_OK(t?.end)) {
      return '时段（非法）';
    }
    const s = t.start as number;
    const e = t.end as number;
    if (s === e) {
      return '时段（非法：起止相同）';
    }
    return (
      '时段 ' + pad2(s) + ':00–' + pad2(e) + ':00' + (s > e ? '（跨零点）' : '')
    );
  }
  if (key === 'calendar') {
    if (!isPlainObject(val)) {
      return '日历（非法）';
    }
    const c = val as {
      month?: unknown;
      day?: unknown;
      from?: unknown;
      to?: unknown;
      weekday?: unknown;
    };
    const parts: string[] = [];
    if (typeof c.month === 'number' && typeof c.day === 'number') {
      parts.push(c.month + '月' + c.day + '日');
    } else if (typeof c.month === 'number') {
      parts.push(c.month + '月');
    } else if (typeof c.day === 'number') {
      parts.push('每月' + c.day + '日');
    }
    const from = parseMonthDay(c.from);
    const to = parseMonthDay(c.to);
    if (from && to) {
      parts.push(
        pad2(from.m) +
          '-' +
          pad2(from.d) +
          ' ~ ' +
          pad2(to.m) +
          '-' +
          pad2(to.d)
      );
    }
    if (Array.isArray(c.weekday) && c.weekday.length) {
      const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      parts.push(
        c.weekday.map((d) => names[d as number] ?? String(d)).join('/')
      );
    }
    return parts.length ? parts.join(' ∧ ') : '日历（无判据）';
  }
  // ctx
  if (!isPlainObject(val)) {
    return '上下文（非法）';
  }
  const c = val as { idleMs?: unknown; zone?: unknown; signal?: unknown };
  const parts: string[] = [];
  if (typeof c.idleMs === 'number') {
    parts.push('静置 ≥ ' + Math.round(c.idleMs / 1000) + ' 秒');
  }
  if (typeof c.zone === 'string' && c.zone) {
    parts.push('热区 "' + c.zone + '"');
  }
  if (c.signal !== undefined) {
    const list = Array.isArray(c.signal) ? c.signal : [c.signal];
    parts.push('信号 ' + list.join('/'));
  }
  return parts.length ? parts.join(' ∧ ') : '上下文（无判据）';
};
