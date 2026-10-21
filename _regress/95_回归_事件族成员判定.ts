// 回归 95：**事件族成员判定**（2026-10-21 新增「节日事件 / 自定义事件」两族）
//
// 跑法（仓库根目录，不需要浏览器）：
//   npx ts-node --transpile-only _regress/95_回归_事件族成员判定.ts
//
// 本回归钉住三件事：
//   A. `EventFamily.keyPrefix` 的归一与判据顺序（显式 phase → 前缀 → 动画后缀 → 缺省族）
//   B. 族闸门（`resolveTriggerPhases` / `buildPool`）对"前缀归族"的条目同样生效
//   C. 现有素材（`public/assets/events.jsonc` + `config.json`）里：节日三条落在
//      `festival`、其余 `custom:*` 落在 `custom`、`game:*` 仍落 `normal`；
//      且 `W_FAMILY_NOT_ENABLED` 能报出"前缀归族"的条目（只看 `e.phase` 会漏）
//
// ⚠️ C 组只在素材存在时跑（开源仓库不带 assets）—— 缺文件时打印 SKIP，不算失败。
import * as fs from 'fs';
import * as path from 'path';
import { DialogueEntry } from '../src/config.type';
import {
  buildFamilyRegistry,
  buildPool,
  isEntryVisibleInPhase,
  resolveDialoguePhase,
  resolveTriggerPhases,
} from '../src/dialogue';
import { normalizeEventTable } from '../src/eventModel';
import { parseEventsFile } from '../src/eventsFile';
import { validateEvents } from '../src/eventValidate';

let pass = 0;
let fail = 0;
let skip = 0;

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

const skipped = (name: string, why: string): void => {
  skip++;
  console.log('  SKIP  ' + name + ' —— ' + why);
};

const E = (
  id: string,
  animation: string,
  phase?: string
): DialogueEntry => ({
  id,
  animation,
  text: 't:' + id,
  ...(phase !== undefined ? { phase } : {}),
});

/* ── 夹具：本工程的三族声明（与 public/assets/config.json 同口径） ───────── */

const THREE = [
  { id: 'normal', label: '普通事件', fallback: true, default: true },
  { id: 'festival', label: '节日事件', default: true },
  { id: 'custom', label: '自定义事件', default: true, keyPrefix: 'custom:' },
];

/* ══ A. 判据顺序 ═════════════════════════════════════════════ */

console.log('\nA. resolveDialoguePhase：显式 → 前缀 → 后缀 → 缺省');

const three = buildFamilyRegistry(THREE);
eq('A1 注册表原样归一（声明顺序不变）', three.ids, [
  'normal',
  'festival',
  'custom',
]);
eq('A2 缺省勾选 = 三个标了 default 的族', three.defaultIds, [
  'normal',
  'festival',
  'custom',
]);
eq('A3 没有 matchSuffix ⇒ 没有动作族', three.actionIds, []);
eq(
  'A4 custom:* 无 phase ⇒ 前缀归「自定义事件」',
  resolveDialoguePhase(
    E('custom:hold-hand', 'touch1'),
    three
  ),
  'custom'
);
eq(
  'A5 game:* 无 phase ⇒ 缺省族「普通事件」',
  resolveDialoguePhase(E('game:64005', 'touch1'), three),
  'normal'
);
eq(
  'A6 显式 phase 永远优先于前缀',
  resolveDialoguePhase(E('custom:valentine', 'greet', 'festival'), three),
  'festival'
);
eq(
  'A7 前缀优先于动画后缀（custom:* 即使动画叫 greet_marry 也不进动作族）',
  resolveDialoguePhase(E('custom:wedding', 'greet_marry'), buildFamilyRegistry([
    { id: 'postMarry', matchSuffix: '_marry' },
    { id: 'normal', fallback: true, default: true },
    { id: 'custom', keyPrefix: 'custom:' },
  ])),
  'custom'
);
eq(
  'A8 没有前缀族时，后缀族照旧生效（老工程不受影响）',
  resolveDialoguePhase(
    E('game:63011', 'greet_marry'),
    buildFamilyRegistry([
      { id: 'postMarry', matchSuffix: '_marry', default: true },
      { id: 'normal', fallback: true, default: true },
    ])
  ),
  'postMarry'
);
eq(
  'A9 多个族声明同一前缀 ⇒ 先声明先赢',
  resolveDialoguePhase(
    E('custom:x', 'chat'),
    buildFamilyRegistry([
      { id: 'first', keyPrefix: 'custom:' },
      { id: 'second', keyPrefix: 'custom:' },
      { id: 'normal', fallback: true },
    ])
  ),
  'first'
);
eq(
  'A10 前缀写错（漏冒号）也照字符串前缀匹配 —— 文档已写明，不静默成"没配"',
  resolveDialoguePhase(
    E('custom:x', 'chat'),
    buildFamilyRegistry([
      { id: 'customish', keyPrefix: 'custom' },
      { id: 'normal', fallback: true },
    ])
  ),
  'customish'
);
eq(
  'A11 注册表为空（本项目无族机制）⇒ 不判族，原样返回 phase',
  resolveDialoguePhase(
    E('custom:x', 'chat', 'whatever'),
    buildFamilyRegistry([])
  ),
  'whatever'
);
eq(
  'A12 无族机制时 custom:* 仍是空串（不会凭空造一个族名）',
  resolveDialoguePhase(E('custom:x', 'chat'), buildFamilyRegistry([])),
  ''
);

/* ══ B. 族闸门 ═══════════════════════════════════════════════ */

console.log('\nB. 族闸门对"前缀归族"的条目同样生效');

const table: DialogueEntry[] = [
  E('game:64005', 'touch1'),
  E('game:64006', 'touch2'),
  E('custom:valentine', 'greet', 'festival'),
  E('custom:hold-hand', 'touch1'),
];

eq(
  'B1 缺省勾选（三族全开）⇒ 一条不少',
  buildPool(table, ['game:64005', 'game:64006', 'custom:valentine', 'custom:hold-hand'], undefined, three)
    .length,
  4
);
eq(
  'B2 只勾「普通事件」⇒ 节日 / 自定义都被挡（前缀归族的也算）',
  buildPool(
    table,
    ['game:64005', 'custom:valentine', 'custom:hold-hand'],
    ['normal'],
    three
  ).map((e) => e.id),
  ['game:64005']
);
eq(
  'B3 只勾「自定义事件」⇒ 只出 custom:*（festival 是显式族，不在其中）',
  buildPool(
    table,
    ['game:64005', 'custom:valentine', 'custom:hold-hand'],
    ['custom'],
    three
  ).map((e) => e.id),
  ['custom:hold-hand']
);
eq(
  'B4 只勾「节日事件」⇒ 只出显式标了 festival 的',
  buildPool(
    table,
    ['game:64005', 'custom:valentine', 'custom:hold-hand'],
    ['festival'],
    three
  ).map((e) => e.id),
  ['custom:valentine']
);
eq(
  'B5 phases 没配 ⇒ 缺省 = 三族全开',
  resolveTriggerPhases(undefined, three),
  ['normal', 'festival', 'custom']
);
eq(
  'B6 写法顺序无关（归一后按注册表顺序）',
  resolveTriggerPhases(['custom', 'normal'], three),
  ['normal', 'custom']
);
ok(
  'B7 纯分类族（无 matchSuffix）不因动作族而消失',
  isEntryVisibleInPhase(E('custom:x', 'chat'), three, 'postMarry') &&
    isEntryVisibleInPhase(E('custom:valentine', 'greet', 'festival'), three, '')
);

/* ══ C. 真实素材 ═════════════════════════════════════════════ */

console.log('\nC. 现有素材：节日 / 自定义 / 普通 三族的实际归属');

const assets = path.join(__dirname, '..', 'public', 'assets');
const eventsPath = path.join(assets, 'events.jsonc');
const configPath = path.join(assets, 'config.json');

if (!fs.existsSync(eventsPath) || !fs.existsSync(configPath)) {
  skipped('C 组（真实素材）', 'public/assets 下没有 events.jsonc / config.json');
} else {
  const parsed = parseEventsFile(fs.readFileSync(eventsPath, 'utf8'));
  ok('C1 事件文件可解析', parsed.ok, parsed.error ?? '');
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const reg = buildFamilyRegistry(cfg?.subtitle?.eventFamilies);
  const events = normalizeEventTable(parsed.events).events;
  const byId = (id: string) => events.filter((e) => e.id === id);

  eq(
    'C2 三条节日问候都标了 phase=festival',
    ['custom:valentine-greet', 'custom:newyear-greet', 'custom:spring-festival-greet'].map(
      (id) => byId(id).map((e) => e.phase)
    ),
    [['festival'], ['festival'], ['festival']]
  );
  eq(
    'C3 其余 custom:* 由 keyPrefix 落到「自定义事件」',
    [
      'custom:hold-hand',
      'custom:dawn-greet',
      'custom:headpat-soft',
    ].map((id) => byId(id).map((e) => resolveDialoguePhase(e, reg))),
    [['custom'], ['custom'], ['custom']]
  );
  eq(
    'C4 内置事件仍是「普通事件」',
    resolveDialoguePhase(byId('game:64005')[0], reg),
    'normal'
  );
  eq(
    'C5 注册表缺省勾选包含三族 ⇒ 全部事件都可触发',
    resolveTriggerPhases(cfg?.subtitle?.phases, reg),
    reg.defaultIds.length === 3 ? ['normal', 'festival', 'custom'] : reg.defaultIds
  );

  /**
   * C6/C7 测的是 2026-10-21 补的 `familyOf`：
   * 以前只认显式 `e.phase` ⇒ 前缀归族的条目被闸门挡掉时**一声不吭**。
   */
  const report = validateEvents(events, {
    animations: null,
    particleNames: null,
    zoneIds: null,
    familyIds: reg.ids,
    fallbackFamilyId: reg.fallbackId,
    enabledFamilyIds: ['normal'],
    actionPhase: '',
    familyOf: (e) => resolveDialoguePhase(e, reg),
    mode: 'warn',
  });
  const notEnabled = report.issues
    .filter((it) => it.code === 'W_FAMILY_NOT_ENABLED')
    .map((it) => it.id);
  ok(
    'C6 只勾「普通事件」时，节日 + 自定义（前缀归族）都报 W_FAMILY_NOT_ENABLED',
    notEnabled.indexOf('custom:hold-hand') >= 0 &&
      notEnabled.indexOf('custom:valentine-greet') >= 0,
    notEnabled.join(',')
  );
  ok(
    'C7 内置事件不误报',
    notEnabled.indexOf('game:64005') < 0,
    notEnabled.join(',')
  );
}

console.log(
  '\n' +
    (fail === 0 ? '✅' : '❌') +
    ' ' +
    pass +
    ' PASS / ' +
    fail +
    ' FAIL' +
    (skip ? ' / ' + skip + ' SKIP' : '')
);
process.exit(fail === 0 ? 0 : 1);
