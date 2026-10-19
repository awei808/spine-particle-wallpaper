// 回归 89：**事件开关状态**（PLAN_事件配置文件 §5.1 / §6.3）
//
// 跑法（仓库根目录，**不需要素材、不需要浏览器**）：
//   npx ts-node --transpile-only _regress/89_回归_事件开关.ts
//
// 2026-10-19 改写：原用例测的是"面板编译成事件 + added/disabled 三路合并"。
// 那两条路（`eventBuilder.ts` / `mergeEventOverrides`）已随"事件内容归文件"整体删除，
// 现在面板只写一个布尔值，所以这里只验四件事：
//   A. `normalizeEventState`：脏 localStorage 只丢那一条，不整份作废；
//   B. `applyEventState`：显式值双向生效（文件 `enabled:false` 能被**打开**，
//      这正是"只存 disabled 列表"做不到的那一格）；无关条目零拷贝；
//   C. 端到端：文件条目 + 开关 ⇒ 归一后 `enabled` 正确，且**条目不会消失**
//      （关掉 ≠ 删掉：档案与调试面板仍能看到它）；
//   D. `pruneEventState`：文件里删掉的键不会在 localStorage 里越攒越多。
import { DialogueEntry } from '../src/config.type';
import {
  applyEventState,
  EMPTY_EVENT_STATE,
  EventState,
  normalizeEventState,
  pruneEventState,
} from '../src/eventOverrides';
import { eventKeyOf, normalizeEventTable } from '../src/eventModel';

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

/* ══ A. normalizeEventState ══════════════════════════════════ */

console.log('\nA. normalizeEventState（脏数据容错）');

eq('A1 null ⇒ 空结构', normalizeEventState(null), EMPTY_EVENT_STATE);
eq('A2 字符串 ⇒ 空结构', normalizeEventState('nope'), EMPTY_EVENT_STATE);
eq(
  'A3 enabled 是数组 ⇒ 空结构',
  normalizeEventState({ schema: 1, enabled: [] }),
  EMPTY_EVENT_STATE
);
eq(
  'A4 非布尔值被丢掉（不做 truthy 转换）',
  normalizeEventState({ enabled: { 'custom:a': 'true', 'custom:b': 1 } }),
  EMPTY_EVENT_STATE
);
eq(
  'A5 非法键被丢掉，合法键保留',
  normalizeEventState({
    enabled: { 'custom:ok': false, BadKey: true, 'custom:': true },
  }),
  { schema: 1, enabled: { 'custom:ok': false } }
);
eq(
  'A6 数字串键按 game: 归一（config 里手写字符串是常见笔误）',
  normalizeEventState({ enabled: { '64005': false } }),
  { schema: 1, enabled: { 'game:64005': false } }
);
eq(
  'A7 缺 schema 也认',
  normalizeEventState({ enabled: { 'game:1': true } }),
  { schema: 1, enabled: { 'game:1': true } }
);

/* ══ B. applyEventState ══════════════════════════════════════ */

console.log('\nB. applyEventState（双向开关）');

const events: DialogueEntry[] = [
  { id: 'game:64001', animation: 'greet', enabled: true },
  { id: 'custom:valentine', animation: 'greet', enabled: false },
  { id: 'custom:untouched', animation: 'touch1' },
];

const noop = applyEventState(events, EMPTY_EVENT_STATE);
ok('B1 没有开关时**零拷贝**（同一引用）', noop[0] === events[0]);
eq('B2 空开关 ⇒ enabled 原样', noop.map((e) => e.enabled), [true, false, undefined]);

const state: EventState = {
  schema: 1,
  enabled: { 'game:64001': false, 'custom:valentine': true },
};
const applied = applyEventState(events, state);
eq('B3 显式 false 盖掉文件 true', applied[0].enabled, false);
eq('B4 显式 true 盖掉文件 false（只存 disabled 列表做不到）', applied[1].enabled, true);
ok('B5 没点过的条目仍是同一引用', applied[2] === events[2]);
ok('B6 不改原数组里的对象', events[0].enabled === true);

eq(
  'B7 其它字段逐字不变（只动 enabled）',
  [applied[0].id, applied[0].animation],
  ['game:64001', 'greet']
);

/* ══ C. 端到端（文件 → 开关 → 归一） ════════════════════════ */

console.log('\nC. 端到端：关掉 ≠ 删掉');

const table = normalizeEventTable(
  applyEventState(events, { schema: 1, enabled: { 'custom:valentine': false } })
).events;
eq('C1 三条都还在表里', table.length, 3);
eq(
  'C2 被关掉的那条 enabled=false（不是被删）',
  table.map((e) => [eventKeyOf(e), e.enabled]),
  [
    ['game:64001', true],
    ['custom:valentine', false],
    ['custom:untouched', true],
  ]
);
ok(
  'C3 关了之后仍能被 findByEventKey 找到（调试面板可手动播）',
  table.some((e) => eventKeyOf(e) === 'custom:valentine')
);

/* ══ D. pruneEventState ══════════════════════════════════════ */

console.log('\nD. pruneEventState（悬空键清理）');

const pruned = pruneEventState(
  { schema: 1, enabled: { 'game:1': false, 'custom:gone': true, 'custom:a': true } },
  ['game:1', 'custom:a']
);
eq(
  'D1 文件里已删掉的键被剪掉，现存键保留',
  pruned,
  { schema: 1, enabled: { 'game:1': false, 'custom:a': true } }
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
