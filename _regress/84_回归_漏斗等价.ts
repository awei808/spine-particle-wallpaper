// 回归 84：**唯一漏斗的等价性**（PLAN S2）
//
// 跑法：npx ts-node --transpile-only _regress/84_回归_漏斗等价.ts
//
// 这一条是 S2 的验收：把"三通道取条"从 3 份逻辑收敛到 `resolveEvent` 之后，
// **旧 config 下取到的条目必须与改动前逐条一致**。这里用真实 config 的 10 条形状，
// 对比两套实现：
//
// | 旧 | 新 |
// |---|---|
// | `buildPool(active, 旧 id 列表, phases)` | `phased.filter(kindOf(e) === k)` |
// | `pickRandomFromPool(pool, rnd)` | `selectEvent(ready, rnd)`（缺省 priority/weight） |
// | `pickGreetingEntry(...)` 按**时段下标**取 | `when.time` 条件 + 漏斗（注入时钟） |
import * as fs from 'fs';
import * as path from 'path';
import { DialogueEntry, TriggerEventKind } from '../src/config.type';
import {
  buildPool,
  buildFamilyRegistry,
  isEntryVisibleInPhase,
  normalizeGreetIds,
  pickGreetingEntry,
  pickRandomFromPool,
  projectDialoguesToActionPhase,
  resolveActionPhase,
  resolveChatIds,
  resolveDialoguePhase,
  resolveGreetSource,
  resolvePhases,
  resolveTouchIds,
} from '../src/dialogue';
import { kindOf, normalizeEventTable, eventKeyOf } from '../src/eventModel';
import {
  createEventLog,
  resolveEventFrom,
  selectEvent,
} from '../src/eventScheduler';

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

/* ── 夹具：与 public/assets/config.json 同形状 ───────────── */
const sub = {
  touch: [64005, 64006, 64007, 64008, 64009, 64010],
  greeting: { morning: 64001, noon: 64002, evening: 64003 },
  greetingRanges: {
    morning: { start: 5, end: 12 },
    noon: { start: 12, end: 18 },
    evening: { start: 18, end: 5 },
  },
  standby: 64004,
  standbyIdleMs: 25000,
  greetMode: 'time' as const,
  eventFamilies: [
    { id: 'normal', label: '普通事件', fallback: true, default: true },
  ],
  phases: ['normal'],
};
const dialogues: DialogueEntry[] = [
  { actionId: 64001, animation: 'greet', text: 'a', phase: 'normal' },
  { actionId: 64002, animation: 'greet', text: 'b', phase: 'normal' },
  { actionId: 64003, animation: 'chat', text: 'c', phase: 'normal' },
  { actionId: 64004, animation: 'chat', text: 'd', phase: 'normal' },
  { actionId: 64005, animation: 'touch1', text: 'e', phase: 'normal' },
  { actionId: 64006, animation: 'touch1', text: 'f', phase: 'normal' },
  { actionId: 64007, animation: 'touch2', text: 'g', phase: 'normal' },
  { actionId: 64008, animation: 'touch3', text: 'h', phase: 'normal' },
  { actionId: 64009, animation: 'touch3', text: 'i', phase: 'normal' },
  { actionId: 64010, animation: 'touch2', text: 'j', phase: 'normal' },
];

const fams = buildFamilyRegistry(sub.eventFamilies);
const actionPhase = resolveActionPhase(undefined, fams);
const phases = resolvePhases(sub.phases, undefined, fams);
const phaseFilter = fams.families.length ? phases : undefined;
const projected = projectDialoguesToActionPhase(dialogues, fams, actionPhase);
const active = projected.filter((d) =>
  isEntryVisibleInPhase(d, fams, actionPhase)
);

/* ── 旧实现：三个池 ─────────────────────────────────────── */
const greetSource = resolveGreetSource(undefined, sub.greeting);
const oldPools: Record<TriggerEventKind, DialogueEntry[]> = {
  chat: buildPool(
    active,
    resolveChatIds(undefined, sub.standby),
    phaseFilter,
    fams
  ),
  greet: buildPool(active, normalizeGreetIds(greetSource), phaseFilter, fams),
  touch: buildPool(active, resolveTouchIds(sub.touch), phaseFilter, fams),
};

/* ── 新实现：归一 + 按 kind 派生 ────────────────────────── */
const normalized = normalizeEventTable(dialogues, {
  legacy: {
    touch: sub.touch,
    standby: sub.standby,
    greeting: sub.greeting,
    greetingRanges: sub.greetingRanges,
    greetMode: sub.greetMode,
  },
});
const newActive = projectDialoguesToActionPhase(
  normalized.events,
  fams,
  actionPhase
).filter((d) => isEntryVisibleInPhase(d, fams, actionPhase));
const phased = phaseFilter
  ? newActive.filter(
      (e) => phaseFilter.indexOf(resolveDialoguePhase(e, fams)) >= 0
    )
  : newActive;
const newPools: Record<TriggerEventKind, DialogueEntry[]> = {
  chat: phased.filter((e) => kindOf(e) === 'chat'),
  greet: phased.filter((e) => kindOf(e) === 'greet'),
  touch: phased.filter((e) => kindOf(e) === 'touch'),
};

const keys = (list: DialogueEntry[]): string[] =>
  list.map((e) => eventKeyOf(e));

console.log('\nA. 三个池的内容逐条一致');
eq('A1 chat', keys(newPools.chat), keys(oldPools.chat));
eq('A2 greet', keys(newPools.greet), keys(oldPools.greet));
eq('A3 touch', keys(newPools.touch), keys(oldPools.touch));

console.log('\nB. 缺省 priority/weight ⇒ selectEvent 等价 pickRandomFromPool');
/** 覆盖 [0,1) 的 11 个取值（含 0 与贴近 1） */
const RND = [0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.999];
(['chat', 'greet', 'touch'] as TriggerEventKind[]).forEach((kind) => {
  const pool = oldPools[kind];
  RND.forEach((r) => {
    const oldPick = pickRandomFromPool(pool, () => r);
    const newPick = selectEvent(pool, () => r);
    eq(
      'B ' + kind + ' rnd=' + r + ' ⇒ 同一条',
      eventKeyOf(oldPick),
      eventKeyOf(newPick)
    );
  });
});

console.log('\nC. resume 通道：时段下标 vs when.time（注入时钟）');
/** 三个时刻各落在 morning / noon / evening */
const HOURS: { h: number; slot: string }[] = [
  { h: 9, slot: 'morning' },
  { h: 13, slot: 'noon' },
  { h: 23, slot: 'evening' },
];
HOURS.forEach(({ h }) => {
  const date = new Date(2026, 0, 15, h, 0, 0);
  const oldPick = pickGreetingEntry(
    phased,
    greetSource,
    sub.greetingRanges,
    date,
    'time'
  );
  const newPick = resolveEventFrom(
    phased,
    { channel: 'resume', kinds: ['greet'], now: date },
    () => 0
  );
  eq(
    'C ' + h + ':00 ⇒ 旧按时段 / 新按条件 同一条',
    eventKeyOf(oldPick),
    eventKeyOf(newPick)
  );
});

console.log('\nD. 漏斗的 ①~③ 层（真实实现，非复刻）');
const customEvents = normalizeEventTable(
  [
    {
      id: 'custom:hand',
      animation: 'touch1',
      on: ['touch'],
      kind: 'touch',
      when: { ctx: { zone: 'hand' } },
    },
    {
      id: 'custom:off',
      animation: 'touch1',
      on: ['touch'],
      kind: 'touch',
      enabled: false,
    },
    {
      id: 'custom:rejected',
      animation: 'nope',
      on: ['touch'],
      kind: 'touch',
    },
    {
      id: 'custom:once',
      animation: 'touch1',
      on: ['touch'],
      kind: 'touch',
      pick: { quota: { max: 1, per: 'session' } },
    },
  ],
  {}
).events;
const log = createEventLog(null);
const OPTS = {
  channel: 'touch' as const,
  kinds: ['touch'] as const,
  log,
  unplayable: { 'custom:rejected': true },
};
eq(
  'D1 when.ctx.zone 命中 hand',
  eventKeyOf(
    resolveEventFrom(customEvents, { ...OPTS, ctx: { zone: 'hand' } }, () => 0)
  ),
  'custom:hand'
);
eq(
  'D2 热区不对 ⇒ 条件拦住（只剩无条件的那些）',
  eventKeyOf(
    resolveEventFrom(
      customEvents.filter((e) => e.id === 'custom:hand'),
      { ...OPTS, ctx: { zone: 'body' } },
      () => 0
    )
  ),
  ''
);
/** 只有 `custom:once` 没条件 ⇒ 在 body 上应选它（其余被条件/enabled/unplayable 挡掉） */
eq(
  'D3 enabled:false 与 unplayable 都被 ① 层挡掉',
  eventKeyOf(
    resolveEventFrom(customEvents, { ...OPTS, ctx: { zone: 'body' } }, () => 0)
  ),
  'custom:once'
);
const onceEntry = customEvents.find((e) => e.id === 'custom:once');
log.beginTick();
log.commit(onceEntry as DialogueEntry, Date.now());
eq(
  'D4 配额用满 ⇒ ③ 层挡掉',
  resolveEventFrom(customEvents, { ...OPTS, ctx: { zone: 'body' } }, () => 0),
  null
);

console.log('\nE. 触摸通道内部不再自己抽（PLAN §4.1 #2）');
const touchSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/touch.ts'),
  'utf8'
);
ok(
  'E1 touch.ts 不再出现 pickRandomFromPool(',
  touchSrc.indexOf('pickRandomFromPool(') < 0
);
ok(
  'E2 touch.ts 无 touchPool 选项（取条走 pick 回调）',
  touchSrc.indexOf('touchPool?:') < 0
);
ok(
  'E3 decidePlay 已导出（抢占薄包装）',
  /export const decidePlay/.test(touchSrc)
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
