// 回归 85：**条件 AST**（PLAN S4 / §2.2）
//
// 跑法：npx ts-node --transpile-only _regress/85_回归_条件AST.ts
//
// 铁律：`compileCondition(cond)` 是纯函数，时钟与上下文**全部注入** ⇒
// 所有断言都能钉死到具体日期，不依赖跑测试的那一天。
import { Condition } from '../src/config.type';
import {
  compileCondition,
  describeCondition,
  inspectCondition,
} from '../src/conditions';

let pass = 0;
let fail = 0;

const eq = (name: string, got: unknown, want: unknown): void => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log(
      '  FAIL  ' + name + '\n          got = ' + a + '\n          want= ' + b
    );
  }
};

const ok = (name: string, cond: boolean, detail = ''): void => {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  ← ' + detail : ''));
  }
};

/** 本地时间构造（避免 UTC 偏移把断言弄歪） */
const at = (h: number, min = 0, y = 2026, mo = 0, d = 15): Date =>
  new Date(y, mo, d, h, min, 0, 0);

const test = (
  cond: unknown,
  now: Date,
  ctx: Parameters<ReturnType<typeof compileCondition>>[1] = {}
): boolean => compileCondition(cond as Condition)(now, ctx);

console.log('\nA. time：跨零点 / 边界 / 全天');
const night: Condition = { time: { start: 23, end: 4 } };
eq(
  'A1 {23,4} 命中 23:30 / 03:59 / 00:00',
  [test(night, at(23, 30)), test(night, at(3, 59)), test(night, at(0, 0))],
  [true, true, true]
);
eq(
  'A2 {23,4} 不命中 04:00 / 12:00 / 22:59',
  [test(night, at(4, 0)), test(night, at(12)), test(night, at(22, 59))],
  [false, false, false]
);
const morning: Condition = { time: { start: 5, end: 12 } };
eq(
  'A3 含起点、不含终点（05:00 ✓ / 12:00 ✗）',
  [test(morning, at(5)), test(morning, at(11, 59)), test(morning, at(12))],
  [true, true, false]
);
eq(
  'A4 start === end 虽被判非法，求值仍按"全天"（不 throw）',
  [
    test({ time: { start: 8, end: 8 } }, at(8)),
    inspectCondition({ time: { start: 8, end: 8 } }).invalid.length,
  ],
  [true, 1]
);

console.log('\nB. calendar：日 / 区间（跨年）/ 星期');
eq(
  'B1 {month:2,day:14} 只命中 2 月 14 日',
  [
    test({ calendar: { month: 2, day: 14 } }, at(10, 0, 2026, 1, 14)),
    test({ calendar: { month: 2, day: 14 } }, at(10, 0, 2026, 1, 15)),
    test({ calendar: { month: 2, day: 14 } }, at(10, 0, 2026, 2, 14)),
  ],
  [true, false, false]
);
eq(
  'B2 month 单独给 ⇒ 整月',
  [
    test({ calendar: { month: 3 } }, at(0, 0, 2026, 2, 1)),
    test({ calendar: { month: 3 } }, at(0, 0, 2026, 2, 31)),
    test({ calendar: { month: 3 } }, at(0, 0, 2026, 3, 1)),
  ],
  [true, true, false]
);
const xmas: Condition = { calendar: { from: '12-24', to: '01-05' } };
eq(
  'B3 12-24 ~ 01-05 跨年',
  [
    test(xmas, at(12, 0, 2026, 11, 24)),
    test(xmas, at(12, 0, 2026, 11, 31)),
    test(xmas, at(12, 0, 2027, 0, 1)),
    test(xmas, at(12, 0, 2027, 0, 5)),
    test(xmas, at(12, 0, 2027, 0, 6)),
    test(xmas, at(12, 0, 2026, 5, 1)),
  ],
  [true, true, true, true, false, false]
);
/** 2026-01-05 是周一；2026-01-07 是周三 */
eq(
  'B4 weekday [1,3]（周一/周三）',
  [
    test({ calendar: { weekday: [1, 3] } }, at(9, 0, 2026, 0, 5)),
    test({ calendar: { weekday: [1, 3] } }, at(9, 0, 2026, 0, 6)),
    test({ calendar: { weekday: [1, 3] } }, at(9, 0, 2026, 0, 7)),
  ],
  [true, false, true]
);
eq(
  'B5 month+day+weekday 是 AND',
  [
    test(
      { calendar: { month: 1, day: 5, weekday: [1] } },
      at(9, 0, 2026, 0, 5)
    ),
    test(
      { calendar: { month: 1, day: 5, weekday: [2] } },
      at(9, 0, 2026, 0, 5)
    ),
  ],
  [true, false]
);

console.log('\nC. ctx：静置 / 热区 / 信号');
const idle: Condition = { ctx: { idleMs: 60000 } };
eq(
  'C1 idleMs 是 ">=" 判据（60000 恰好命中）',
  [
    test(idle, at(12), { idleMs: 60000 }),
    test(idle, at(12), { idleMs: 59999 }),
    test(idle, at(12), {}),
  ],
  [true, false, false]
);
eq(
  'C2 zone 精确匹配',
  [
    test({ ctx: { zone: 'hand' } }, at(12), { zone: 'hand' }),
    test({ ctx: { zone: 'hand' } }, at(12), { zone: 'body' }),
    test({ ctx: { zone: 'hand' } }, at(12), {}),
  ],
  [true, false, false]
);
eq(
  'C3 signal 是"之一"',
  [
    test({ ctx: { signal: ['boot', 'focus'] } }, at(12), { signal: 'boot' }),
    test({ ctx: { signal: ['boot'] } }, at(12), { signal: 'resume' }),
  ],
  [true, false]
);
eq(
  'C4 ctx 多字段是 AND',
  test({ ctx: { idleMs: 1000, zone: 'hand' } }, at(12), {
    idleMs: 2000,
    zone: 'body',
  }),
  false
);

console.log('\nD. 组合子 / 未知键 / 非法结构');
eq(
  'D1 all / any / not',
  [
    test(
      { all: [{ time: { start: 5, end: 12 } }, { calendar: { month: 1 } }] },
      at(9)
    ),
    test(
      { all: [{ time: { start: 5, end: 12 } }, { calendar: { month: 2 } }] },
      at(9)
    ),
    test(
      { any: [{ time: { start: 5, end: 12 } }, { calendar: { month: 2 } }] },
      at(9)
    ),
    test({ not: { time: { start: 5, end: 12 } } }, at(9)),
  ],
  [true, false, true, false]
);
eq(
  'D2 all:[] = 恒真 / any:[] = 恒假',
  [test({ all: [] }, at(9)), test({ any: [] }, at(9))],
  [true, false]
);
eq('D3 没写 when ⇒ 恒真', test(undefined, at(9)), true);
eq(
  'D4 未知键 ⇒ 恒真 + 报 unknown（不关事件）',
  [test({ chance: 0.1 }, at(9)), inspectCondition({ chance: 0.1 }).unknown],
  [true, ['chance']]
);
eq(
  'D5 已知键 + 未知键并存 ⇒ 已知键仍生效',
  test({ time: { start: 5, end: 12 }, foo: 1 }, at(20)),
  false
);
eq(
  'D6 结构错误：month 13 / from 无 to / weekday 7 / not 不是对象',
  [
    inspectCondition({ calendar: { month: 13 } }).invalid.length,
    inspectCondition({ calendar: { from: '12-24' } }).invalid.length,
    inspectCondition({ calendar: { weekday: [7] } }).invalid.length,
    inspectCondition({ not: 3 }).invalid.length,
  ],
  [1, 1, 1, 1]
);
ok(
  'D7 求值绝不 throw（垃圾输入）',
  (() => {
    const junk = [
      null,
      3,
      'x',
      { all: 'x' },
      { time: { start: 'a' } },
      { not: 5 },
    ];
    try {
      junk.forEach((c) => test(c, at(9)));
      return true;
    } catch (err) {
      return false;
    }
  })()
);

console.log('\nE. describeCondition（唯一文案起点）');
eq(
  'E1 2月14日 ∧ 时段 23:00–04:00（跨零点标注）',
  describeCondition({
    all: [{ calendar: { month: 2, day: 14 } }, { time: { start: 23, end: 4 } }],
  }),
  '2月14日 ∧ 时段 23:00–04:00（跨零点）'
);
eq(
  'E2 区间 + 星期',
  describeCondition({ calendar: { from: '12-24', to: '01-05', weekday: [1] } }),
  '12-24 ~ 01-05 ∧ 周一'
);
eq(
  'E3 上下文',
  describeCondition({
    all: [{ ctx: { idleMs: 30000 } }, { ctx: { zone: 'hand' } }],
  }),
  '静置 ≥ 30 秒 ∧ 热区 "hand"'
);
eq('E4 未知键', describeCondition({ chance: 0.1 }), '未知条件（按恒真处理）');
eq('E5 缺省', describeCondition(undefined), '恒真');
eq(
  'E6 同一 AST 输出稳定（连跑两次相同）',
  describeCondition(night) === describeCondition(night),
  true
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
