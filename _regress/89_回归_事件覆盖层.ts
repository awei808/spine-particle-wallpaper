// 回归 89：**自定义事件的覆盖层 + 面板编译**（PLAN §7 / S9）
//
// 跑法（仓库根目录，**不需要素材、不需要浏览器**）：
//   npx ts-node --transpile-only _regress/89_回归_事件覆盖层.ts
//
// 验的是四件事：
//   A. `normalizeOverrides`：脏 localStorage 不能整份作废，只能丢那一条；
//   B. `mergeEventOverrides`：config → +added → **disabled 最后盖**（关掉自定义事件
//      必须真的关掉，不能因为合并顺序复活）；
//   C. `buildCustomEvent`：面板点选结果 ⇒ 事件条目的**全部口径**
//      （多选=整包随机 / 条件模板 / 继承台词 / 优先级夹取 / 自动编号 / 不写 phase）；
//   D. 端到端：覆盖层 + 归一 ⇒ 新事件真的进了事件表，`disabled` 的条目真的不播。
import { Configs, DialogueEntry } from '../src/config.type';
import {
  EMPTY_EVENT_OVERRIDES,
  mergeEventOverrides,
  normalizeOverrides,
} from '../src/eventOverrides';
import {
  buildCustomEvent,
  conditionFromDraft,
  CustomEventDraft,
} from '../src/eventBuilder';
import { describeCondition } from '../src/conditions';
import {
  eventKeyOf,
  normalizeEventTable,
  resolveEventVariant,
} from '../src/eventModel';

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

/* ══ A. normalizeOverrides ═══════════════════════════════════ */

console.log('\nA. normalizeOverrides（脏数据容错）');

eq('A1 null ⇒ 空结构', normalizeOverrides(null), EMPTY_EVENT_OVERRIDES);
eq(
  'A2 非对象 added / disabled ⇒ 空数组',
  normalizeOverrides({ added: 'x', disabled: 3 }),
  { schema: 1, added: [], disabled: [] }
);
const a3 = normalizeOverrides({
  added: [
    { id: 'custom:a', animation: 'greet' },
    { id: 'Bad Id' },
    { actionId: 64005 },
    { id: 'custom:a', animation: 'chat' },
    'nope',
    { id: 7 },
  ],
  disabled: ['game:64001', 64002, 'game:64001', 'WHAT'],
});
eq(
  'A3 非法 id 丢弃 / added 去重保留首条 / number 归一 / disabled 去重',
  { added: a3.added.map((e) => e.id), disabled: a3.disabled },
  {
    added: ['custom:a', 'game:64005', 'game:7'],
    disabled: ['game:64001', 'game:64002'],
  }
);

/* ══ B. mergeEventOverrides ══════════════════════════════════ */

console.log('\nB. mergeEventOverrides（三路合并）');

const cfgEvents: DialogueEntry[] = [
  { actionId: 64001, animation: 'greet', text: '早' },
  { actionId: 64004, animation: 'chat', text: '闲' },
  { actionId: 64005, animation: 'touch1', text: '手' },
];
const keys = (list: DialogueEntry[]): string[] =>
  list.map((e) => eventKeyOf(e));

eq(
  'B1 空覆盖层 ⇒ 逐条等价（id/顺序不变）',
  mergeEventOverrides(cfgEvents, EMPTY_EVENT_OVERRIDES).map((e) => [
    eventKeyOf(e),
    e.animation,
    e.enabled,
  ]),
  [
    ['game:64001', 'greet', undefined],
    ['game:64004', 'chat', undefined],
    ['game:64005', 'touch1', undefined],
  ]
);
ok(
  'B2 入参不被修改（逐条浅拷贝）',
  cfgEvents.every((e) => e.enabled === undefined)
);

const b3 = mergeEventOverrides(cfgEvents, {
  schema: 1,
  added: [{ id: 'custom:hold-hand', animation: 'touch1', displayName: '牵手' }],
  disabled: [],
});
eq('B3 added 追加在尾部', keys(b3).slice(-1), ['custom:hold-hand']);

const b4 = mergeEventOverrides(cfgEvents, {
  schema: 1,
  added: [{ id: 'game:64001', animation: 'nope' }],
  disabled: [],
});
eq('B4 与内置同 id 的 added 被忽略（config 优先）', b4.length, 3);
eq('B4b 且不改内置条目的动画', b4[0].animation, 'greet');

const b5 = mergeEventOverrides(cfgEvents, {
  schema: 1,
  added: [{ id: 'custom:x', animation: 'greet' }],
  disabled: ['custom:x', 'game:64004'],
});
eq(
  'B5 disabled **最后**统一压 enabled:false（自定义也能关掉）',
  b5.map((e) => [eventKeyOf(e), e.enabled]),
  [
    ['game:64001', undefined],
    ['game:64004', false],
    ['game:64005', undefined],
    ['custom:x', false],
  ]
);

/* ══ C. buildCustomEvent ═════════════════════════════════════ */

console.log('\nC. buildCustomEvent（面板点选 ⇒ 事件条目）');

const anims = ['idle', 'chat', 'greet', 'touch1', 'touch2'];
const base: CustomEventDraft = {
  channels: ['touch'],
  condition: 'none',
  timeStart: 8,
  timeEnd: 22,
  month: 2,
  day: 14,
  animations: ['touch1'],
  particles: [],
  textSourceKey: '',
  priority: 80,
  dailyOnce: false,
};
const deps = {
  animations: anims,
  events: cfgEvents,
  existingKeys: [],
};

eq(
  'C1 没选通道 ⇒ null',
  buildCustomEvent({ ...base, channels: [] }, deps),
  null
);
eq(
  'C2 没有可用动画 ⇒ null',
  buildCustomEvent({ ...base, animations: [] }, { animations: [] }),
  null
);

const c3 = buildCustomEvent(base, deps)!;
eq('C3 单动作单值 ⇒ 不写 variants', c3.variants, undefined);
eq(
  'C3b 动作/通道/类别',
  [c3.animation, c3.on, c3.kind],
  ['touch1', ['touch'], 'touch']
);
eq(
  'C3c 没选粒子 ⇒ 不写 particles（回落 actionEffects）',
  c3.particles,
  undefined
);
eq('C3d 不写 phase（落在缺省族 ⇒ 不换名、恒可见）', c3.phase, undefined);
ok('C3e 自动编号 custom:ev1', c3.id === 'custom:ev1', String(c3.id));

const c4 = buildCustomEvent(
  { ...base, animations: ['greet', 'chat'], particles: ['qiqiu', 'star'] },
  deps
)!;
eq('C4 2 动作 × 2 粒子 ⇒ 1 基准 + 3 变体', 1 + (c4.variants?.length ?? 0), 4);
eq(
  'C4b 组合完整（动作 × 粒子 笛卡尔积，无重复）',
  [c4.animation + '/' + (c4.particles ?? []).join('+')].concat(
    (c4.variants ?? []).map(
      (v) => v.animation + '/' + (v.particles ?? []).join('+')
    )
  ),
  ['greet/qiqiu', 'greet/star', 'chat/qiqiu', 'chat/star']
);
/** 整包抽取：动作与粒子必须来自**同一包**（不会出现 greet+star 这种错配） */
const pair = (e: DialogueEntry): string =>
  (e.animation ?? '') + '/' + (e.particles ?? []).join('+');
const drawn = [0, 0.25, 0.5, 0.75].map((r) =>
  pair(resolveEventVariant(c4, () => r))
);
eq('C4c 整包随机（4 档 rnd 落在 4 个不同包）', new Set(drawn).size, 4);
ok(
  'C4d 每档都在合法组合里',
  drawn.every(
    (p) =>
      ['greet/qiqiu', 'greet/star', 'chat/qiqiu', 'chat/star'].indexOf(p) >= 0
  ),
  drawn.join(' ')
);

const c5 = buildCustomEvent({ ...base, textSourceKey: 'game:64005' }, deps)!;
eq('C5 继承台词/语音（副本）', [c5.text, c5.voice], ['手', undefined]);
ok(
  'C5b 继承不会挂 actionId（自定义事件没有游戏侧 id）',
  c5.actionId === undefined
);
const c5b = buildCustomEvent({ ...base, textSourceKey: 'game:64001' }, deps)!;
eq('C5c 继承到有语音的条目 ⇒ voice 一起复制', c5b.text, '早');

const c6 = buildCustomEvent({ ...base, priority: 250, dailyOnce: true }, deps)!;
eq('C6 priority 夹取到 100', c6.pick?.priority, 100);
eq('C6b 每天一次 ⇒ quota{max:1,per:day}', c6.pick?.quota, {
  max: 1,
  per: 'day',
});

const condCases: [string, Partial<CustomEventDraft>, unknown, string][] = [
  [
    'C7a 时段（跨零点）',
    { condition: 'time', timeStart: 23, timeEnd: 4 },
    { time: { start: 23, end: 4 } },
    '时段 23:00–04:00（跨零点）',
  ],
  [
    'C7b 日期',
    { condition: 'date', month: 2, day: 14 },
    { calendar: { month: 2, day: 14 } },
    '2月14日',
  ],
  [
    'C7c 热区',
    { condition: 'zone', zone: 'hit1' },
    { ctx: { zone: 'hit1' } },
    '热区 "hit1"',
  ],
  [
    'C7d 静置 5 分钟',
    { condition: 'idle', idleMinutes: 5 },
    { ctx: { idleMs: 300000 } },
    '静置 ≥ 300 秒',
  ],
];
condCases.forEach(([name, patch, ast, text]) => {
  const d = { ...base, ...patch } as CustomEventDraft;
  eq(name + ' → AST', conditionFromDraft(d), ast);
  eq(
    name + ' → 文案（describeCondition 唯一来源）',
    describeCondition(conditionFromDraft(d)),
    text
  );
});
eq(
  'C7e 热区为空 ⇒ 条件缺省（不写恒假的 ctx.zone）',
  conditionFromDraft({ ...base, condition: 'zone', zone: '' }),
  undefined
);

const c8 = buildCustomEvent(base, {
  ...deps,
  existingKeys: ['custom:ev1', 'custom:ev2'],
})!;
eq('C8 编号避让已占用的键', c8.id, 'custom:ev3');

/* ══ D. 端到端：覆盖层 + 归一 ══════════════════════════════ */

console.log('\nD. 端到端：overrides ⇒ normalizeEventTable');

const cfg: Configs = {
  subtitle: {
    dialogues: [
      { actionId: 64001, animation: 'greet', text: '早', phase: 'normal' },
      { actionId: 64005, animation: 'touch1', text: '手', phase: 'normal' },
    ],
  },
} as unknown as Configs;

const userEvent = buildCustomEvent(
  {
    ...base,
    channels: ['resume'],
    condition: 'date',
    animations: ['greet'],
    textSourceKey: 'game:64001',
    dailyOnce: true,
  },
  { animations: anims, events: cfg.subtitle!.dialogues!, existingKeys: [] }
)!;

const merged = mergeEventOverrides(cfg.subtitle!.dialogues!, {
  schema: 1,
  added: [userEvent],
  disabled: ['game:64005'],
});
const table = normalizeEventTable(merged).events;

eq('D1 表里 3 条（2 内置 + 1 新建）', table.length, 3);
eq(
  'D2 新建条目进了表，且 on/kind/when 全部落实',
  (() => {
    const e = table.find((x) => eventKeyOf(x) === 'custom:ev1')!;
    return [e.on, e.kind, describeCondition(e.when), e.pick?.quota?.per];
  })(),
  [['resume'], 'greet', '2月14日', 'day']
);
eq(
  'D3 被 disabled 的内置条目仍在表里但 enabled:false',
  (() => {
    const e = table.find((x) => eventKeyOf(x) === 'game:64005')!;
    return e.enabled;
  })(),
  false
);
ok(
  'D4 自定义事件没有 W_ORPHAN（on 是显式写的；内置那两条本夹具没写 on，按设计算孤儿）',
  normalizeEventTable(merged).issues.filter(
    (i) => i.code === 'W_ORPHAN' && i.id === 'custom:ev1'
  ).length === 0
);

/* ══ E. `weight:0` 的语义（2026-10-18 示例事件暴露出来的那条） ══ */

console.log('\nE. weight:0 = 仅手动（不参与自动抽取）');

const e1 = buildCustomEvent({ ...base, priority: 80 }, deps)!;
ok(
  'E1 buildCustomEvent 不写 weight（缺省 1 ⇒ 正常参与抽取）',
  e1.pick?.weight === undefined
);
const e2: DialogueEntry = { ...e1, pick: { ...e1.pick, weight: 0 } };
const table2 = normalizeEventTable([e2]).events;
eq(
  'E2 归一后 weight:0 原样保留（不被 ||1 吃掉 —— pick 归一里最容易犯的错）',
  table2[0].pick?.weight,
  0
);

console.log(
  '\n' + (fail ? '❌' : '✅') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail ? 1 : 0);
