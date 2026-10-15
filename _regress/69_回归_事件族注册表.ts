// 回归：**事件族注册表**（2026-10-15 由写死的 `'preMarry' | 'postMarry' | 'normal'` 三族
// 改为 `config.subtitle.eventFamilies` 注册表制）。
//
// 跑法（在仓库根目录，**不需要任何外部素材**）：
//   npx ts-node --transpile-only _regress/69_回归_事件族注册表.ts
//
// 为什么不需要 config：要验的全是 `dialogue.ts` 里的**纯函数**
// （`buildFamilyRegistry` / `resolveDialoguePhase` / `normalizeTriggerPhases` /
//  `resolveTriggerPhases` / `buildPool` / `mergeKindPools`），直接 import 源码即可。
// 只有最后一段"产物里不该再留写死的族名"要读 `dist/bundle.js`（**存在才跑**）。
//
// ⚠️ 本工程的缺省口径（2026-10-15 用户拍板）：**没声明 `eventFamilies` ⇒ 内置单族 `normal`**
// ——非誓约皮肤不再凭空多出「誓约前/誓约后事件」。誓约工程要三族必须自己声明。
import * as fs from 'fs';
import { DialogueEntry } from '../src/config.type';
import {
  buildFamilyRegistry,
  buildPool,
  mergeKindPools,
  normalizeTriggerPhases,
  resolveDialoguePhase,
  resolveTriggerPhases,
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

/* ── 夹具 ────────────────────────────────────────────────── */

/** 造一条念白（只有本回归用得到的字段） */
const E = (
  actionId: number,
  animation: string,
  phase?: string
): DialogueEntry => ({
  actionId,
  animation,
  text: 't' + actionId,
  ...(phase !== undefined ? { phase } : {}),
});

/**
 * 誓约工程（S8/603）的注册表 —— ★ 这是**内容分类口径**（工程侧写进 config），
 * **不是引擎规则**：引擎只按 id 认族，认不出 `preMarry` 有什么特殊。
 */
const VOW = [
  { id: 'preMarry', label: '誓约前事件' },
  {
    id: 'postMarry',
    label: '誓约后事件',
    default: true,
    matchSuffix: '_marry',
  },
  { id: 'normal', label: '普通事件', default: true, fallback: true },
];

/** 一张**与誓约无关**的皮肤注册表（证明"允许别的事件族"） */
const SEASON = [
  { id: 'summer', label: '夏日事件', default: true },
  { id: 'winter', label: '冬日事件' },
];

/* ── A. 注册表归一 `buildFamilyRegistry` ─────────────────── */

console.log('\nA. 注册表归一（buildFamilyRegistry）');

const def = buildFamilyRegistry(undefined);
eq('A1 没配 ⇒ 内置单族 normal', def.ids, ['normal']);
eq('A2 没配 ⇒ 缺省族 = normal', def.fallbackId, 'normal');
eq('A3 没配 ⇒ 缺省勾选 = [normal]', def.defaultIds, ['normal']);
eq('A4 没配 ⇒ 显示名取自内置 label', def.label('normal'), '普通事件');
ok(
  'A5 负向：缺省注册表里**没有**誓约族',
  def.ids.indexOf('preMarry') < 0 && def.ids.indexOf('postMarry') < 0
);

eq(
  'A6 非数组（拼错成字符串）⇒ 退回内置缺省',
  buildFamilyRegistry('normal').ids,
  ['normal']
);
eq('A7 非数组（null）⇒ 退回内置缺省', buildFamilyRegistry(null).ids, [
  'normal',
]);

const empty = buildFamilyRegistry([]);
eq('A8 空数组 ⇒ 空注册表（本项目无事件族机制）', empty.ids, []);
eq('A9 空注册表 ⇒ fallbackId = null', empty.fallbackId, null);
eq('A10 空注册表 ⇒ 缺省勾选为空', empty.defaultIds, []);
ok('A11 空注册表 ⇒ has() 一律 false', empty.has('normal') === false);

const vow = buildFamilyRegistry(VOW);
eq('A12 誓约注册表 ⇒ 保持声明顺序', vow.ids, [
  'preMarry',
  'postMarry',
  'normal',
]);
eq('A13 誓约注册表 ⇒ 缺省族 = 标 fallback 的那个', vow.fallbackId, 'normal');
eq('A14 誓约注册表 ⇒ 缺省勾选 = 标 default 的两个', vow.defaultIds, [
  'postMarry',
  'normal',
]);
eq('A15 誓约注册表 ⇒ 显示名取自 label', vow.label('postMarry'), '誓约后事件');

const season = buildFamilyRegistry(SEASON);
eq('A16 自定义族（非誓约）⇒ 原样可用', season.ids, ['summer', 'winter']);
eq('A17 自定义族 ⇒ 没标 fallback ⇒ 取首项', season.fallbackId, 'summer');
eq('A18 自定义族 ⇒ 只有 summer 标 default', season.defaultIds, ['summer']);

eq(
  'A19 非法项静默丢弃（缺 id / 空 id / 非字符串 id）',
  buildFamilyRegistry([
    {},
    { id: '' },
    { id: 123 },
    { label: 'x' },
    { id: 'ok' },
  ]).ids,
  ['ok']
);
eq(
  'A20 没写 label ⇒ 显示名回落成 id',
  buildFamilyRegistry([{ id: 'foo' }]).label('foo'),
  'foo'
);
eq(
  'A21 重复 id ⇒ 去重且保首个（先声明先赢）',
  buildFamilyRegistry([
    { id: 'a', label: 'A1' },
    { id: 'a', label: 'A2' },
  ]).label('a'),
  'A1'
);
eq(
  'A22 数组里一个合法项都没有（拼错）⇒ 退回内置缺省（宁可降级，不静默关机制）',
  buildFamilyRegistry([{ nope: 1 }, null, 'x']).ids,
  ['normal']
);
eq(
  'A23 多个 fallback ⇒ 取首个',
  buildFamilyRegistry([
    { id: 'a', fallback: true },
    { id: 'b', fallback: true },
  ]).fallbackId,
  'a'
);
eq(
  'A24 洗牌输入 ⇒ 归一后仍按声明顺序（与输入顺序无关）',
  buildFamilyRegistry([{ id: 'b' }, { id: 'a' }]).ids,
  ['b', 'a']
);
ok(
  'A25 非数组时也是**新拷贝**：改返回值不会污染内置缺省表',
  (() => {
    const r1 = buildFamilyRegistry(undefined);
    r1.ids.push('polluted');
    r1.families.push({ id: 'polluted' });
    const r2 = buildFamilyRegistry(undefined);
    return r2.ids.length === 1 && r2.ids[0] === 'normal';
  })()
);

/* ── B. 条目判族 `resolveDialoguePhase` ──────────────────── */

console.log('\nB. 条目判族（resolveDialoguePhase 三段判据）');

eq(
  'B1 缺省注册表 + 无 phase ⇒ normal',
  resolveDialoguePhase(E(64001, 'greet'), def),
  'normal'
);
eq(
  'B2 缺省注册表 + phase 写了誓约族（不在注册表）⇒ 回落缺省族 normal',
  resolveDialoguePhase(E(63004, 'touch1_marry', 'postMarry'), def),
  'normal'
);
eq(
  'B3 誓约注册表 + 显式 phase ⇒ 就是它',
  resolveDialoguePhase(E(63004, 'touch1_marry', 'postMarry'), vow),
  'postMarry'
);
eq(
  'B4 誓约注册表 + 显式 preMarry ⇒ preMarry',
  resolveDialoguePhase(E(63006, 'touch1', 'preMarry'), vow),
  'preMarry'
);
eq(
  'B5 誓约注册表 + 没写 phase && 动画 `_marry` 结尾 ⇒ 按 matchSuffix 归 postMarry',
  resolveDialoguePhase(E(63004, 'touch1_marry'), vow),
  'postMarry'
);
eq(
  'B6 誓约注册表 + 没写 phase && 普通动画 ⇒ 缺省族 normal',
  resolveDialoguePhase(E(64001, 'greet'), vow),
  'normal'
);
eq(
  'B7 誓约注册表 + phase 非法值 ⇒ 先看 matchSuffix（`_marry` ⇒ postMarry）',
  resolveDialoguePhase(E(63004, 'touch1_marry', 'typo'), vow),
  'postMarry'
);
eq(
  'B8 誓约注册表 + phase 非法值 && 普通动画 ⇒ 缺省族',
  resolveDialoguePhase(E(64001, 'greet', 'typo'), vow),
  'normal'
);
eq(
  'B9 自定义族 + 显式 summer ⇒ summer',
  resolveDialoguePhase(E(1, 'idle', 'summer'), season),
  'summer'
);
eq(
  'B10 空注册表 ⇒ 不判族：原样返回条目自己的 phase',
  resolveDialoguePhase(E(1, 'idle', 'whatever'), empty),
  'whatever'
);
eq(
  'B11 空注册表 + 无 phase ⇒ 空串（只为去重键保留区分度）',
  resolveDialoguePhase(E(1, 'idle'), empty),
  ''
);
ok(
  'B12 负向：引擎里**不再**把 `_marry` 写死成 postMarry —— 注册表没写 matchSuffix 时它不算数',
  resolveDialoguePhase(E(1, 'touch1_marry'), season) === 'summer'
);

/* ── C. 归一勾选 `normalizeTriggerPhases` ───────────────── */

console.log('\nC. 归一勾选（normalizeTriggerPhases）');

eq('C1 非数组 ⇒ 空数组', normalizeTriggerPhases('preMarry', vow), []);
eq(
  'C2 丢非法值 + 去重 + 按注册表声明顺序',
  normalizeTriggerPhases(['normal', 'preMarry', 'normal', 'xxx'], vow),
  ['preMarry', 'normal']
);
eq(
  'C3 输入顺序颠倒 ⇒ 输出仍按注册表顺序',
  normalizeTriggerPhases(['normal', 'postMarry', 'preMarry'], vow),
  ['preMarry', 'postMarry', 'normal']
);
eq('C4 空数组 ⇒ 空数组', normalizeTriggerPhases([], vow), []);
eq(
  'C5 缺省注册表 + 誓约族 ⇒ 全被丢弃（不在注册表里）',
  normalizeTriggerPhases(['postMarry', 'normal'], def),
  ['normal']
);

/* ── D. 摊平缺省 `resolveTriggerPhases` ─────────────────── */

console.log('\nD. 摊平缺省（resolveTriggerPhases）');

eq(
  'D1 没配 ⇒ 注册表缺省勾选（誓约 ⇒ postMarry+normal）',
  resolveTriggerPhases(undefined, vow),
  ['postMarry', 'normal']
);
eq('D2 没配 ⇒ 缺省注册表 ⇒ [normal]', resolveTriggerPhases(undefined, def), [
  'normal',
]);
eq('D3 空数组 ⇒ 显式全关（**不**退回缺省）', resolveTriggerPhases([], vow), []);
eq('D4 全非法值 ⇒ 当作没配、退回缺省', resolveTriggerPhases(['oops'], vow), [
  'postMarry',
  'normal',
]);
eq('D5 合法数组 ⇒ 归一', resolveTriggerPhases(['normal'], vow), ['normal']);
eq('D6 空注册表 ⇒ 恒为空', resolveTriggerPhases(['normal'], empty), []);
ok(
  'D7 返回值是**新拷贝**（外部就地改它不会污染缺省表）',
  (() => {
    const a = resolveTriggerPhases(undefined, vow);
    a.push('polluted');
    return (
      JSON.stringify(resolveTriggerPhases(undefined, vow)) ===
      JSON.stringify(['postMarry', 'normal'])
    );
  })()
);

/* ── E. 建池按族筛 `buildPool` ──────────────────────────── */

console.log('\nE. 建池按族筛（buildPool）');

const DIALOGUES: DialogueEntry[] = [
  E(63004, 'touch1_marry', 'postMarry'),
  E(63006, 'touch1', 'preMarry'),
  E(63010, 'touch3_marry', 'postMarry'),
  E(64005, 'touch1'), // 无 phase ⇒ 缺省族 normal
  E(64011, 'greet'), // 无 phase ⇒ normal
];

eq(
  'E1 phases = [postMarry] ⇒ 只收 postMarry',
  buildPool(DIALOGUES, [63004, 63010], ['postMarry'], vow).map(
    (e) => e.actionId
  ),
  [63004, 63010]
);
eq(
  'E2 phases = [preMarry] ⇒ 只收 preMarry',
  buildPool(DIALOGUES, [63006, 63004], ['preMarry'], vow).map(
    (e) => e.actionId
  ),
  [63006]
);
eq(
  'E3 ★ 孪生：同一 actionId 分属两族 ⇒ 两个都收（收全命中，不是取首个）',
  (() => {
    const twins = [
      E(63004, 'touch1_marry', 'postMarry'),
      E(63004, 'touch1', 'normal'),
    ];
    return buildPool(twins, [63004], ['postMarry', 'normal'], vow).length;
  })(),
  2
);
eq(
  'E4 phases 不给 ⇒ 不按族筛（全收）',
  buildPool(DIALOGUES, [63004, 64005], undefined, vow).map((e) => e.actionId),
  [63004, 64005]
);
eq(
  'E5 空注册表 + 不传 phases ⇒ 全收（本项目无事件族机制）',
  buildPool(DIALOGUES, [63004, 63006], undefined, empty).map((e) => e.actionId),
  [63004, 63006]
);
eq(
  'E6 缺省注册表：勾 [normal] ⇒ 只收缺省族（誓约族条目落进 normal 也在内）',
  buildPool(DIALOGUES, [63004, 64005], ['normal'], def).map((e) => e.actionId),
  [63004, 64005]
);

/* ── F. 并池去重键 `actionId|phase` ─────────────────────── */

console.log('\nF. 并池去重（mergeKindPools）');

const twinPost = E(63004, 'touch1_marry', 'postMarry');
const twinNormal = E(63004, 'touch1', 'normal');
const poolsVow: Record<'chat' | 'greet' | 'touch', DialogueEntry[]> = {
  chat: [twinPost],
  greet: [],
  touch: [twinNormal],
};
eq(
  'F1 ★ 同 actionId、不同族（跨池）⇒ 两条都留（孪生不丢）',
  mergeKindPools(['chat', 'touch'], poolsVow, vow).map((e) => e.phase),
  ['postMarry', 'normal']
);
ok(
  'F2 同 actionId、**同**族重复 ⇒ 去重',
  mergeKindPools(
    ['chat', 'touch'],
    { chat: [twinNormal], greet: [], touch: [twinNormal] },
    vow
  ).length === 1
);
eq(
  'F3 收录顺序按 TRIGGER_KIND_ORDER（chat → greet → touch）',
  (() => {
    const a = E(1, 'a', 'normal');
    const b = E(2, 'b', 'normal');
    const c = E(3, 'c', 'normal');
    return mergeKindPools(
      ['touch', 'chat', 'greet'],
      { chat: [a], greet: [c], touch: [b] },
      vow
    ).map((e) => e.actionId);
  })(),
  [1, 3, 2]
);

/* ── G. 缺省勾选口径：注册表空 ⇒ 调用方不应按族筛 ──────── */

console.log('\nG. 注册表为空时的运行时口径');

ok(
  'G1 空注册表 ⇒ fallbackId = null ⇒ index/archive 的族筛退化为 undefined（= 不筛）',
  empty.fallbackId === null
);
eq(
  'G2 复现调用方判据：fams.families.length ? [fams.fallbackId] : undefined',
  (() => {
    const mk = (f: ReturnType<typeof buildFamilyRegistry>) =>
      f.families.length ? [f.fallbackId] : undefined;
    return [mk(vow), mk(def), mk(empty)];
  })(),
  [['normal'], ['normal'], null]
);

/* ── H. 产物：不再含写死的族名 ───────────────────────────── */

console.log('\nH. 产物检查（dist/bundle.js；不存在则跳过）');

const BUNDLE = process.argv[2] || process.env.WK_BUNDLE || 'dist/bundle.js';
if (fs.existsSync(BUNDLE)) {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  for (const word of ['preMarry', 'postMarry', '誓约前事件', '誓约后事件']) {
    ok(
      'H  负向：bundle 里**没有**写死的族名/族标签「' + word + '」',
      src.indexOf(word) < 0
    );
  }
  ok(
    'H  正面：bundle 含注册表字段名 eventFamilies',
    src.indexOf('eventFamilies') >= 0
  );
  ok(
    'H  正面：bundle 含注册表函数 buildFamilyRegistry',
    src.indexOf('buildFamilyRegistry') >= 0
  );
  ok(
    'H  正面：bundle 含动态 DOM 锚点前缀 wb-set-phase-',
    src.indexOf('wb-set-phase') >= 0
  );
} else {
  console.log('  SKIP  ' + BUNDLE + ' 不存在（先 npm run build）');
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
