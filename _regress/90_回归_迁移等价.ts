// 回归 90：**S8 迁移等价**（PLAN §5 / S8）
//
// 跑法（仓库根目录，**不需要素材、不需要浏览器、不需要那三个工程**）：
//   npx ts-node --transpile-only _regress/90_回归_迁移等价.ts
//
// `scripts/migrateEvents.ts` 的做法是「用 `normalizeEventTable` 算出结果 → 写回 JSON」。
// 所以"迁移是否等价"就等价于下面这件事能不能断言：
//
//   normalize(旧 config, 带 legacy 反推)  ==  normalize(迁移后的 config, 无 legacy)
//
// 验的六件事（对应 PLAN §5.2 / §5.3 / §11）：
//   A. 基本映射：greeting / standby / touch 三条旧路径 → on+kind+when；
//   B. `greet[]` 数组形状（S8 用的）按**下标对位**烧进条目；
//   C. `greetMode:'random'` ⇒ **不写** time 条件（PLAN §0 #3）；
//   D. 旧时段表**成员换序**不影响结果（旧实现按名取，新实现按条件）；
//   E. 迁移动机本身：迁移后**改表内顺序**，每条的时段条件仍跟着自己的 id（旧实现会漂移）；
//   F. 孤儿条目：迁移后仍是 `on: []` + `enabled:false`，绝不"默默上线"。
import { Configs, DialogueEntry, TriggerChannel } from '../src/config.type';
import { normalizeEventTable, NormalizeOptions } from '../src/eventModel';
import { describeCondition } from '../src/conditions';

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

/** 与 `index.ts` / `scripts/migrateEvents.ts` 同一套入参 */
const legacyOf = (sub: NonNullable<Configs['subtitle']>): NormalizeOptions => ({
  legacy: {
    touch: sub.touch,
    chat: sub.chat,
    standby: sub.standby,
    greet: sub.greet,
    greeting: sub.greeting,
    greetingRanges: sub.greetingRanges,
    greetMode: sub.greetMode,
  },
});

/** 语义指纹：**只看"会怎样播"的那几个字段**（`enabled` 单独看） */
const fps = (list: DialogueEntry[]): string[] =>
  list.map((e) =>
    [
      String(e.id),
      ([] as TriggerChannel[]).concat(e.on ?? []).join('+'),
      e.kind,
      describeCondition(e.when),
      e.animation,
      e.phase ?? '',
      e.text ?? '',
      e.voice ?? '',
    ].join('|')
  );

/**
 * 模拟迁移：把归一结果写成"作者会写的样子"，然后丢掉旧池键。
 * ★ 与 `scripts/migrateEvents.ts` 的写回口径一致（`enabled:true` 不落盘）。
 */
const migrate = (
  sub: NonNullable<Configs['subtitle']>
): { dialogues: DialogueEntry[]; top: Record<string, unknown> } => {
  const normalized = normalizeEventTable(sub.dialogues ?? [], legacyOf(sub));
  const dialogues = normalized.events.map((e) => {
    /** ★ 孤儿（`on: []`）显式写 `enabled:false` —— 与 `scripts/migrateEvents.ts` 一致 */
    const out: DialogueEntry = (e.on as unknown[] | undefined)?.length
      ? { ...e }
      : { ...e, enabled: false };
    if (out.enabled !== false) {
      delete out.enabled;
    }
    if (out.when === undefined) {
      delete out.when;
    }
    if (out.pick === undefined) {
      delete out.pick;
    }
    if (out.variants === undefined) {
      delete out.variants;
    }
    return out;
  });
  const top: Record<string, unknown> = {};
  Object.keys(sub).forEach((k) => {
    if (
      ['touch', 'greet', 'chat', 'standby', 'greeting', 'greetMode'].indexOf(
        k
      ) >= 0
    ) {
      return;
    }
    top[k] =
      k === 'dialogues' ? dialogues : (sub as Record<string, unknown>)[k];
  });
  return { dialogues, top };
};

const subOf = (
  patch: Record<string, unknown>
): NonNullable<Configs['subtitle']> =>
  patch as unknown as NonNullable<Configs['subtitle']>;

/* ══ A. 基本映射（S9 形状）═════════════════════════════════ */

console.log('\nA. greeting / standby / touch → on + kind + when');

const s9 = subOf({
  dialogues: [
    { actionId: 64001, animation: 'greet', text: '早', label: '上午' },
    { actionId: 64002, animation: 'greet', text: '中', label: '下午' },
    { actionId: 64003, animation: 'chat', text: '晚', label: '晚间' },
    { actionId: 64004, animation: 'chat', text: '闲', label: '待机' },
    { actionId: 64005, animation: 'touch1', text: '手', label: '摸手' },
  ],
  greeting: { morning: 64001, noon: 64002, evening: 64003 },
  greetingRanges: {
    morning: { start: 5, end: 12 },
    noon: { start: 12, end: 18 },
    evening: { start: 18, end: 5 },
  },
  standby: 64004,
  touch: [64005],
});
const oldA = normalizeEventTable(s9.dialogues ?? [], legacyOf(s9));
const migA = migrate(s9);
const newA = normalizeEventTable(migA.dialogues, {});

eq('A1 迁移前后"会怎样播"逐条相同', fps(newA.events), fps(oldA.events));
eq(
  'A2 三条问候各自带上自己的时段',
  newA.events.slice(0, 3).map((e) => describeCondition(e.when)),
  ['时段 05:00–12:00', '时段 12:00–18:00', '时段 18:00–05:00（跨零点）']
);
eq('A3 待机条目 = on standby / chat 类', newA.events[3].on, ['standby']);
eq('A3b 待机的 kind', newA.events[3].kind, 'chat');
eq('A4 触摸条目 = on touch', newA.events[4].on, ['touch']);
eq('A5 旧池键已删除', Object.keys(migA.top), ['dialogues', 'greetingRanges']);
eq(
  'A6 旧配置有 1 条 W_LEGACY，迁移后 0 条',
  [
    oldA.issues.filter((i) => i.code === 'W_LEGACY').length,
    newA.issues.filter((i) => i.code === 'W_LEGACY').length,
  ],
  [1, 0]
);

/* ══ B. `greet[]` 数组形状 ════════════════════════════════ */

console.log('\nB. greet[]（S8 形状：按下标对位）');

const s8 = subOf({
  dialogues: [
    { actionId: 63001, animation: 'greet', text: 'a' },
    { actionId: 63002, animation: 'greet', text: 'b' },
    { actionId: 63003, animation: 'touch2', text: 'c' },
    { actionId: 63011, animation: 'chat', text: 'd' },
  ],
  greet: [63001, 63002, 63003],
  greetingRanges: {
    morning: { start: 6, end: 11 },
    noon: { start: 11, end: 19 },
    evening: { start: 19, end: 6 },
  },
  standby: 63011,
  touch: [63003],
});
const oldB = normalizeEventTable(s8.dialogues ?? [], legacyOf(s8));
const newB = normalizeEventTable(migrate(s8).dialogues, {});
eq('B1 迁移前后逐条等价', fps(newB.events), fps(oldB.events));
eq(
  'B2 下标对位：第 1/2/3 条分别拿到 morning/noon/evening（自定义分界）',
  newB.events.slice(0, 3).map((e) => describeCondition(e.when)),
  ['时段 06:00–11:00', '时段 11:00–19:00', '时段 19:00–06:00（跨零点）']
);
eq(
  'B3 `greet` 非空时不看旧时段表 `greeting`（优先级不变）',
  newB.events.filter((e) => (e.on as string[]).indexOf('resume') >= 0).length,
  3
);

/* ══ C. greetMode:'random' ════════════════════════════════ */

console.log('\nC. greetMode:random ⇒ 不写 time 条件');

const sRnd = subOf({
  dialogues: [
    { actionId: 1, animation: 'greet', text: 'x' },
    { actionId: 2, animation: 'greet', text: 'y' },
  ],
  greeting: { morning: 1, noon: 2 },
  greetingRanges: {
    morning: { start: 5, end: 12 },
    noon: { start: 12, end: 18 },
  },
  greetMode: 'random',
});
const newRnd = normalizeEventTable(migrate(sRnd).dialogues, {}).events;
eq(
  'C1 random 模式迁移后不带任何时段（条件恒真 ⇒ 任何时刻都能播）',
  newRnd.map((e) => describeCondition(e.when)),
  ['恒真', '恒真']
);
eq(
  'C2 但通道/类别照常写上',
  newRnd.map((e) => [e.on, e.kind]),
  [
    [['resume'], 'greet'],
    [['resume'], 'greet'],
  ]
);

/* ══ D. 旧时段表换序 ══════════════════════════════════════ */

console.log('\nD. greeting 对象换序 ⇒ 结果不变');

const sOrder = subOf({
  dialogues: [
    { actionId: 1, animation: 'greet', text: 'x' },
    { actionId: 2, animation: 'greet', text: 'y' },
  ],
  // ★ 键值不变、书写顺序变了（JS 对象保序，旧实现若按下标取就会错）
  greeting: { noon: 2, morning: 1 },
  greetingRanges: {
    morning: { start: 5, end: 12 },
    noon: { start: 12, end: 18 },
  },
});
const newOrder = normalizeEventTable(migrate(sOrder).dialogues, {}).events;
eq(
  'D1 条件仍跟着"时段名"，不跟书写顺序',
  newOrder.map((e) => [String(e.id), describeCondition(e.when)]),
  [
    ['game:1', '时段 05:00–12:00'],
    ['game:2', '时段 12:00–18:00'],
  ]
);

/* ══ E. 迁移动机：表内顺序不再影响条件 ═══════════════════ */

console.log('\nE. 迁移后改表内顺序 ⇒ 条件跟着 id 走（旧实现会漂移）');

const migE = migrate(s9);
const reordered: DialogueEntry[] = [
  migE.dialogues[2],
  migE.dialogues[0],
  migE.dialogues[1],
].concat(migE.dialogues.slice(3));
const newE = normalizeEventTable(reordered, {}).events;
const condById = (list: DialogueEntry[]): Record<string, string> => {
  const out: Record<string, string> = {};
  list.forEach((e) => {
    out[String(e.id)] = describeCondition(e.when);
  });
  return out;
};
/** 对象键顺序不参与比较 ⇒ 排序后再比 */
const sortedConds = (list: DialogueEntry[]): [string, string][] => {
  const m = condById(list);
  return Object.keys(m)
    .sort()
    .map((k) => [k, m[k]] as [string, string]);
};
eq(
  'E1 换序后每条的条件与换序前一致',
  sortedConds(newE),
  sortedConds(newA.events)
);
ok(
  'E2 若仍靠"下标对位"（旧实现），换序会让 64003 拿到上午时段 ⇒ 本断言正是防这个',
  condById(newE)['game:64003'] === '时段 18:00–05:00（跨零点）',
  condById(newE)['game:64003']
);

/* ══ F. 孤儿条目 ══════════════════════════════════════════ */

console.log('\nF. 表内孤儿（没被任何旧池引用）');

const sOrphan = subOf({
  dialogues: [
    { actionId: 1, animation: 'greet', text: 'x' },
    { actionId: 99, animation: 'chat', text: '没人引用我' },
  ],
  greeting: { morning: 1 },
  greetingRanges: { morning: { start: 5, end: 12 } },
});
const oldOrphan = normalizeEventTable(
  sOrphan.dialogues ?? [],
  legacyOf(sOrphan)
);
const migOrphan = migrate(sOrphan);
const newOrphan = normalizeEventTable(migOrphan.dialogues, {});
eq(
  'F1 迁移前就报 W_ORPHAN（on 为空 ⇒ 永不播放）',
  oldOrphan.issues.filter((i) => i.code === 'W_ORPHAN').map((i) => i.id),
  ['game:99']
);
eq(
  'F2 迁移后仍是 on: []，并写 enabled:false（绝不默默上线）',
  (() => {
    const e = newOrphan.events.find((x) => String(x.id) === 'game:99')!;
    return [e.on, e.enabled];
  })(),
  [[], false]
);
eq(
  'F3 迁移后 `when` 没有被"按通道推"的默认值污染',
  newOrphan.events.find((x) => String(x.id) === 'game:99')!.when,
  undefined
);

console.log(
  '\n' + (fail ? '❌' : '✅') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail ? 1 : 0);
