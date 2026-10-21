// 回归 96：「恢复默认」的两份纯数据（2026-10-21，TODO §7）
//
// 跑法（仓库根目录，不需要浏览器）：
//   npx ts-node --transpile-only _regress/96_回归_恢复默认.ts
//
// 面板那一页在 2026-10-19 曾**删掉**「恢复默认」按钮：它需要"文件缺省值"，而当时
// 面板只拿到"已压过开关的生效值"。现在 `index.ts` 多传一份 `eventDefaults`
// （`eventDefaultsOf` 从 events.jsonc 的**原始条目**算），本回归钉住：
//   A. `eventDefaultsOf`：只认 `enabled !== false`，非法 id 不进表，末条同键覆盖
//   B. `changedEventKeys`：**按值与缺省比较**（不是按点过的键数），点回去不算改过
//   C. 与引擎口径对齐：清空 `EventState` 后 `applyEventState` 出来的生效值
//      必须逐条等于文件缺省（=「恢复本页默认」真的回到了文件设定）
import { DialogueEntry } from '../src/config.type';
import {
  applyEventState,
  changedEventKeys,
  EMPTY_EVENT_STATE,
  eventDefaultsOf,
  EventState,
} from '../src/eventOverrides';
import { eventKeyOf } from '../src/eventModel';

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

/* ══ A. eventDefaultsOf ══════════════════════════════════════ */

console.log('\nA. eventDefaultsOf（文件缺省：enabled !== false）');

const file: DialogueEntry[] = [
  { id: 'game:64001', animation: 'greet' },
  { id: 'custom:on', animation: 'chat', enabled: true },
  { id: 'custom:off', animation: 'chat', enabled: false },
  /** 只有 actionId 的旧形状（id 由 actionId 派生） */
  { actionId: 64005, animation: 'touch1' },
  /** 两个 id 都没有 ⇒ 不进表（引擎那边也归不了键） */
  { animation: 'touch2' },
];

eq('A1 缺省开 = 未写或 true；只有显式 false 才是关', eventDefaultsOf(file), {
  'game:64001': true,
  'custom:on': true,
  'custom:off': false,
  'game:64005': true,
});
eq(
  'A2 没有 id 的条目被跳过（不会造出空串键）',
  Object.keys(eventDefaultsOf(file)).indexOf('') < 0,
  true
);
eq(
  'A3 空表 ⇒ 空 map（面板不会因此崩）',
  eventDefaultsOf([]),
  {}
);

/* ══ B. changedEventKeys ═════════════════════════════════════ */

console.log('\nB. changedEventKeys（按值与缺省比较，不按点过的键数）');

const defaults = {
  'game:64001': true,
  'custom:off': false,
};
const st = (m: { [k: string]: boolean }): EventState => ({
  schema: 1,
  enabled: m,
});

eq(
  'B1 没有开关 ⇒ 0 项改动',
  changedEventKeys(defaults, EMPTY_EVENT_STATE),
  []
);
eq(
  'B2 写了一个与缺省相同的 true ⇒ 不算改动（点两下点回去的情形）',
  changedEventKeys(defaults, st({ 'game:64001': true })),
  []
);
eq(
  'B3 把默认开的关掉 ⇒ 算 1 项',
  changedEventKeys(defaults, st({ 'game:64001': false })),
  ['game:64001']
);
eq(
  'B4 把默认关的打开 ⇒ 算 1 项（文件 enabled:false 的条目也能被改回开启）',
  changedEventKeys(defaults, st({ 'custom:off': true })),
  ['custom:off']
);
eq(
  'B5 与缺省相同的 false ⇒ 不算改动',
  changedEventKeys(defaults, st({ 'custom:off': false })),
  []
);
eq(
  'B6 悬空键（文件里没有）按"缺省开"比较：置 false 算改动、置 true 不算',
  [
    changedEventKeys(defaults, st({ 'custom:gone': false })),
    changedEventKeys(defaults, st({ 'custom:gone': true })),
  ],
  [['custom:gone'], []]
);

/* ══ C. 与引擎口径对齐 ═══════════════════════════════════════ */

console.log('\nC. 清空 EventState = 回到文件缺省');

const live = applyEventState(file, {
  schema: 1,
  enabled: { 'game:64001': false, 'custom:off': true },
});
eq(
  'C1 有开关时：生效值与文件缺省**不同**',
  live.map((e) => e.enabled),
  [false, true, true, undefined, undefined]
);

const reset = applyEventState(file, EMPTY_EVENT_STATE);
eq(
  'C2 恢复默认后（空开关）：未写 enabled 的条目**零拷贝**，显式 false 原样保留',
  reset.map((e) => e.enabled),
  [undefined, true, false, undefined, undefined]
);
ok(
  'C3 恢复默认不会删条目（关 / 开 ≠ 增删）',
  reset.length === file.length &&
    reset.map(eventKeyOf).join(',') === file.map(eventKeyOf).join(',')
);

const back = eventDefaultsOf(reset);
eq(
  'C4 恢复默认后再算一次缺省 ⇒ 与原始文件缺省逐条相同（可重复恢复）',
  back,
  eventDefaultsOf(file)
);

const changedAfterReset = changedEventKeys(eventDefaultsOf(file), EMPTY_EVENT_STATE);
eq('C5 恢复默认后「已改 N 项」= 0', changedAfterReset.length, 0);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
