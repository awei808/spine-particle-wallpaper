// 回归 83：**EventKey 泛化 + 事件表归一**（PLAN S1 + S3）
//
// 跑法（仓库根目录，**不需要素材、不需要浏览器**）：
//   npx ts-node --transpile-only _regress/83_回归_事件键与归一.ts
//
// 验的是三件事：
//   A. `EventKey`：`number` / 数字串 / `game:` / `custom:` 的归一与非法拒绝；
//   B. 旧池键 → 新字段的**反推**（这条决定了"老 config 行为不变"）；
//   C. `mergeKindPools` 的去重键（2026-10-18 的真正动机：自定义事件没有 actionId，
//      旧键会退化成 `undefined|phase` ⇒ 同族自定义事件被算成同一条、只留一条进池）。
import { DialogueEntry } from '../src/config.type';
import {
  EVENT_KEY_RE,
  eventKeyOf,
  isEventKey,
  kindOf,
  normalizeEventKey,
  normalizeEventTable,
  resolveEventVariant,
} from '../src/eventModel';
import {
  buildPool,
  findByEventKey,
  mergeKindPools,
  projectDialoguesToActionPhase,
} from '../src/dialogue';

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

/* ── A. EventKey ─────────────────────────────────────────── */

console.log('\nA. normalizeEventKey / isEventKey');

eq('A1 数字 ⇒ game:<n>', normalizeEventKey(64005), 'game:64005');
eq(
  'A2 数字串 ⇒ game:<n>（config 手写字符串的常见笔误）',
  normalizeEventKey('64005'),
  'game:64005'
);
eq('A3 合法 game 键原样', normalizeEventKey('game:64005'), 'game:64005');
eq(
  'A4 合法 custom 键原样（含 - 和 _）',
  normalizeEventKey('custom:good-night_2'),
  'custom:good-night_2'
);
eq(
  'A5 非法 ⇒ null',
  [
    normalizeEventKey(''),
    normalizeEventKey('GoodNight'),
    normalizeEventKey('custom:'),
    normalizeEventKey('custom:Bad'),
    normalizeEventKey(-1),
    normalizeEventKey(null),
    normalizeEventKey({}),
  ],
  [null, null, null, null, null, null, null]
);
ok(
  'A6 正则与实现一致（game:0 合法）',
  EVENT_KEY_RE.test('game:0') && !!normalizeEventKey(0)
);
ok(
  'A7 isEventKey 只收归一后的形状',
  isEventKey('custom:a') && !isEventKey('64005')
);

eq(
  'A8 actionId 派生键',
  eventKeyOf({ actionId: 64005, animation: 'touch1' } as DialogueEntry),
  'game:64005'
);
eq(
  'A9 id 优先于 actionId',
  eventKeyOf({ id: 'custom:x', actionId: 64005 } as DialogueEntry),
  'custom:x'
);
eq(
  'A10 两个都没有 ⇒ 空串',
  eventKeyOf({ animation: 'x' } as DialogueEntry),
  ''
);

const table: DialogueEntry[] = [
  { id: 'game:64005', actionId: 64005, animation: 'touch1' },
  { id: 'custom:goodnight', animation: 'greet' },
  { actionId: 64006, animation: 'touch1' },
];
ok('A11 findByEventKey 认 number', findByEventKey(table, 64005) === table[0]);
ok('A12 findByEventKey 认数字串', findByEventKey(table, '64006') === table[2]);
ok(
  'A13 findByEventKey 认 custom',
  findByEventKey(table, 'custom:goodnight') === table[1]
);
ok('A14 查不到 ⇒ null（不抛）', findByEventKey(table, 'custom:nope') === null);

/* ── B. 旧池反推 ─────────────────────────────────────────── */

console.log('\nB. normalizeEventTable：旧池键 ⇒ on / kind / when');

/** 与 public/assets/config.json 同形状（10 条、三份旧池键、greetMode 缺省 time） */
const LEGACY_DIALOGUES: DialogueEntry[] = [
  { actionId: 64001, animation: 'greet', text: 'a' },
  { actionId: 64002, animation: 'greet', text: 'b' },
  { actionId: 64003, animation: 'chat', text: 'c' },
  { actionId: 64004, animation: 'chat', text: 'd' },
  { actionId: 64005, animation: 'touch1', text: 'e' },
  { actionId: 64006, animation: 'touch1', text: 'f' },
  { actionId: 64007, animation: 'touch2', text: 'g' },
  { actionId: 64008, animation: 'touch3', text: 'h' },
  { actionId: 64009, animation: 'touch3', text: 'i' },
  { actionId: 64010, animation: 'touch2', text: 'j' },
];
const LEGACY = {
  touch: [64005, 64006, 64007, 64008, 64009, 64010],
  chat: undefined,
  standby: 64004,
  greet: undefined,
  greeting: { morning: 64001, noon: 64002, evening: 64003 },
  greetingRanges: {
    morning: { start: 5, end: 12 },
    noon: { start: 12, end: 18 },
    evening: { start: 18, end: 5 },
  },
  greetMode: 'time' as const,
};

const n1 = normalizeEventTable(LEGACY_DIALOGUES, { legacy: LEGACY });
eq('B1 归一后条数不变（无孤儿、无非法 id）', n1.events.length, 10);
eq(
  'B2 64001 ∈ resume / greet / 时段 5-12',
  [n1.events[0].on, kindOf(n1.events[0]), n1.events[0].when],
  [['resume'], 'greet', { time: { start: 5, end: 12 } }]
);
eq('B3 64003 的 evening 跨零点保留', n1.events[2].when, {
  time: { start: 18, end: 5 },
});
eq(
  'B4 64004 ⇒ standby / chat，无条件',
  [n1.events[3].on, kindOf(n1.events[3]), n1.events[3].when],
  [['standby'], 'chat', undefined]
);
eq(
  'B5 64005 ⇒ touch / touch',
  [n1.events[4].on, kindOf(n1.events[4])],
  [['touch'], 'touch']
);
eq(
  'B6 W_LEGACY 只报一条（工程级）',
  n1.issues.filter((i) => i.code === 'W_LEGACY').length,
  1
);
eq(
  'B7 内置条目全部可达 ⇒ 无 W_ORPHAN',
  n1.issues.filter((i) => i.code === 'W_ORPHAN').length,
  0
);

const n2 = normalizeEventTable(LEGACY_DIALOGUES, { legacy: LEGACY });
eq(
  'B8 幂等：连跑两次结果相同',
  JSON.stringify(n1.events),
  JSON.stringify(n2.events)
);

const randomMode = normalizeEventTable(LEGACY_DIALOGUES, {
  legacy: { ...LEGACY, greetMode: 'random' },
});
eq(
  'B9 greetMode=random ⇒ 不写 time 条件（PLAN §0 #3）',
  randomMode.events.slice(0, 3).map((e) => e.when),
  [undefined, undefined, undefined]
);

const orphan = normalizeEventTable(
  [{ actionId: 64099, animation: 'greet', text: '孤儿' }],
  { legacy: { touch: [64005] } }
);
eq(
  'B10 未被任何旧池引用 ⇒ on:[] + W_ORPHAN（不按 standby 缺省悄悄上线）',
  [orphan.events[0].on, orphan.issues.some((i) => i.code === 'W_ORPHAN')],
  [[], true]
);

const custom = normalizeEventTable(
  [
    {
      id: 'custom:goodnight',
      animation: 'greet',
      text: '晚安',
      on: ['resume'],
      kind: 'greet',
      when: { time: { start: 23, end: 4 } },
      pick: { priority: 120, weight: 2, quota: { max: 1, per: 'day' } },
    },
  ],
  {}
);
eq(
  'B11 自定义事件：id/on/kind 保留，priority 夹取到 100',
  [custom.events[0].id, custom.events[0].on, custom.events[0].pick?.priority],
  ['custom:goodnight', ['resume'], 100]
);
eq(
  'B12 越界 ⇒ E_PRIORITY_RANGE（coerce）',
  custom.issues.filter((i) => i.code === 'E_PRIORITY_RANGE').length,
  1
);

const dup = normalizeEventTable(
  [
    { id: 'custom:a', animation: 'greet', on: ['resume'] },
    { id: 'custom:a', animation: 'chat', on: ['standby'] },
    { id: 'Bad Id', animation: 'x' },
  ],
  {}
);
eq(
  'B13 重复 id ⇒ 保留首条 + E_ID_DUP',
  [dup.events.length, dup.issues.filter((i) => i.code === 'E_ID_DUP').length],
  [1, 1]
);
eq(
  'B14 非法 id ⇒ 丢弃 + E_ID_INVALID',
  dup.issues.filter((i) => i.code === 'E_ID_INVALID').length,
  1
);

/* ── C. 池 / 去重键 / 投影 ───────────────────────────────── */

console.log('\nC. buildPool / mergeKindPools / 变体换名');

eq(
  'C1 buildPool 收 EventKey（数字与字符串混写）',
  buildPool(table, ['game:64005', 64006]).length,
  2
);
eq(
  'C2 buildPool 只认表里存在的键',
  buildPool(table, ['custom:nope', 64005]).length,
  1
);

const customTwins: DialogueEntry[] = [
  { id: 'custom:a', animation: 'greet', text: 'A', phase: 'custom' },
  { id: 'custom:b', animation: 'greet', text: 'B', phase: 'custom' },
];
eq(
  'C3 ★两条同族自定义事件都留在池里（旧键 undefined|phase 会把它们并成一条）',
  mergeKindPools(['greet'], { chat: [], greet: customTwins, touch: [] }).length,
  2
);

const twins: DialogueEntry[] = [
  { actionId: 63001, animation: 'greet', text: 't', phase: 'normal' },
  { actionId: 63001, animation: 'greet', text: 't', phase: 'postMarry' },
];
const reg = {
  families: [
    { id: 'normal', fallback: true, default: true },
    { id: 'postMarry', matchSuffix: '_marry' },
  ],
  ids: ['normal', 'postMarry'],
  fallbackId: 'normal',
  defaultIds: ['normal'],
  actionIds: ['postMarry'],
  defaultActionId: 'postMarry',
  has: (v: unknown) => v === 'normal' || v === 'postMarry',
  label: (id: string) => id,
  suffixOf: (id: string) => (id === 'postMarry' ? '_marry' : ''),
  actionLabel: (id: string) => id,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const projected = projectDialoguesToActionPhase(
  twins as any,
  reg as any,
  'postMarry'
);
eq(
  'C4 换名不会 double-suffix，且判族结果被钉住',
  projected.map((e) => [e.animation, e.phase]),
  [
    ['greet_marry', 'normal'],
    ['greet_marry', 'postMarry'],
  ]
);
eq(
  'C5 mergeKindPools 按 id|phase 去重 ⇒ 孪生两族都保留',
  mergeKindPools(
    ['greet'],
    { chat: [], greet: projected, touch: [] },
    reg as any
  ).length,
  2
);

const withVariants: DialogueEntry[] = [
  {
    id: 'custom:v',
    animation: 'greet',
    text: 'base',
    variants: [
      { animation: 'chat', text: 'v1' },
      { animation: 'greet', text: 'v2' },
    ],
  },
];
const projectedVariants = projectDialoguesToActionPhase(
  withVariants,
  reg as any,
  'postMarry'
);
eq(
  'C6 ★variants[].animation 也换名（否则混族时 addAnimation 直接 throw）',
  projectedVariants[0].variants?.map((v) => v.animation),
  ['chat_marry', 'greet_marry']
);

/* ── D. 变体抽取 ─────────────────────────────────────────── */

console.log('\nD. resolveEventVariant（整包随机）');
const vEntry: DialogueEntry = {
  id: 'custom:v',
  animation: 'greet',
  text: 'base',
  voice: 'base.ogg',
  variants: [
    { weight: 1, animation: 'chat', text: 'v1', voice: 'v1.ogg' },
    { weight: 0, animation: 'touch1', text: 'v2', voice: 'v2.ogg' },
  ],
};
const pickBase = resolveEventVariant(vEntry, () => 0);
const pickFirst = resolveEventVariant(vEntry, () => 0.6);
const pickLast = resolveEventVariant(vEntry, () => 0.999);
eq(
  'D1 rnd=0 ⇒ 基准（隐式 variant#0）',
  [pickBase.animation, pickBase.text, pickBase.voice],
  ['greet', 'base', 'base.ogg']
);
eq(
  'D2 命中第一条 variant（rnd=0.6 ⇒ 落在第二档）⇒ 动作/台词/语音整套换',
  [pickFirst.animation, pickFirst.text, pickFirst.voice],
  ['chat', 'v1', 'v1.ogg']
);
eq(
  'D3 weight:0 的变体永不被抽中',
  [pickLast.animation, pickLast.text],
  ['chat', 'v1']
);
eq(
  'D4 无 variants ⇒ 原对象返回（零拷贝）',
  resolveEventVariant(vEntry, () => 0) === vEntry,
  false
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
