// 回归 100：默认项（按宽对齐 / 节日族默认开）+ 档案分页（2026-10-21）
//
// 跑法（仓库根目录，不需要浏览器）：
//   npx ts-node --transpile-only _regress/100_回归_默认项与档案分页.ts
//
// 钉住本次三条改动里**能被纯数据验证**的部分：
//   A. `readView` 的对齐基准缺省已翻成 `'width'`（与 `initScene` 同向，见源码注释）
//   B. `mergeNewFamilyDefaults`：老存档只补"没见过的新族"，补一次即记账
//      ⇒ 用户之后取消勾选**不会**被回补（这正是"每次都补"那条做法的死穴）
//   C. 档案三种视图：切「按事件族 / 按通道分组」后行数下降、每行确实属于该族/该组，
//      空组给空态文案而不是渲染出 0 行却不说话
//   D. 档案页脚的「指南」指向 `assets/events.jsonc` 并点明自定义事件
//
// ⚠️ `100_dom_stub` 必须**第一个** import：它要在 `src/archive.ts` 求值之前
//    把 `window` / `document` / `ResizeObserver` 装好。
import { byId, click, deepText, StubEl } from './100_dom_stub';
import { Configs, DialogueEntry } from '../src/config.type';
import { buildFamilyRegistry } from '../src/dialogue';
import { createArchive } from '../src/archive';
import {
  clearOverrides,
  mergeNewFamilyDefaults,
  readView,
  SettingsOverrides,
} from '../src/settingsStore';

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

/* ══ A. 对齐基准缺省 = 按画幅宽 ══════════════════════════════ */

console.log('\nA. fitAspect 缺省（readView）');

eq('缺字段 ⇒ 按宽', readView({} as Configs).fitAspect, 'width');
eq(
  "写 'height' ⇒ 按高",
  readView({ fitAspect: 'height' } as Configs).fitAspect,
  'height'
);
eq(
  "写 'width' ⇒ 按宽",
  readView({ fitAspect: 'width' } as Configs).fitAspect,
  'width'
);
eq(
  '写无效值 ⇒ 回落按宽',
  readView({ fitAspect: 'bogus' } as Configs).fitAspect,
  'width'
);

/* ══ B. 新事件族补勾（老存档迁移） ══════════════════════════ */

console.log('\nB. mergeNewFamilyDefaults（新族自动补勾一次）');

const reg3 = buildFamilyRegistry([
  { id: 'normal', label: '普通事件', fallback: true, default: true },
  { id: 'festival', label: '节日事件', default: true },
  { id: 'custom', label: '自定义事件', default: true, keyPrefix: 'custom:' },
]);

clearOverrides();
const b1 = mergeNewFamilyDefaults({ phases: ['normal'] }, reg3);
eq('老存档 ["normal"] ⇒ 补上两族', b1.phases, ['normal', 'festival', 'custom']);
ok(
  '补完即记账（phasesSeen 含三族）',
  (b1.phasesSeen ?? []).slice().sort().join(',') === 'custom,festival,normal',
  JSON.stringify(b1.phasesSeen)
);

/** ★ 关键：用户取消勾选后再启动，不该被回补 */
const b2 = mergeNewFamilyDefaults(
  { phases: ['normal'], phasesSeen: b1.phasesSeen },
  reg3
);
eq('已记账 ⇒ 取消勾选不被回补', b2.phases, ['normal']);

/** 没写过 phases ⇒ 生效值本来就是 defaultIds，不该把"没配"固化成"写死" */
const b3 = mergeNewFamilyDefaults({}, reg3);
eq('从未写过 phases ⇒ 原样不动', b3.phases, undefined);

/** 没标 default 的族不该被强加 */
const regNoDefault = buildFamilyRegistry([
  { id: 'normal', label: '普通事件', fallback: true, default: true },
  { id: 'extra', label: '额外', default: false },
]);
clearOverrides();
const b4 = mergeNewFamilyDefaults({ phases: ['normal'] }, regNoDefault);
eq('未标 default 的族不强加', b4.phases, ['normal']);

/* ══ C. 档案分页 ════════════════════════════════════════════ */

console.log('\nC. 档案三种视图');

const entry = (
  id: string,
  kind: 'greet' | 'chat' | 'touch',
  on: string,
  phase?: string
): DialogueEntry =>
  ({
    id,
    animation: kind === 'chat' ? 'chat' : kind === 'greet' ? 'greet' : 'touch1',
    kind,
    on: [on],
    phase,
    text: id + ' 的念白',
  } as DialogueEntry);

const events: DialogueEntry[] = [
  entry('game:64001', 'greet', 'resume'),
  entry('game:64002', 'greet', 'resume'),
  entry('game:64004', 'chat', 'standby'),
  entry('game:64005', 'touch', 'touch'),
  entry('game:64006', 'touch', 'touch'),
  entry('custom:valentine', 'greet', 'resume', 'festival'),
  entry('custom:spring', 'greet', 'resume', 'festival'),
  entry('custom:mine', 'touch', 'touch'),
];

const cfg = {
  subtitle: {
    enabled: true,
    eventFamilies: [
      { id: 'normal', label: '普通事件', fallback: true, default: true },
      { id: 'festival', label: '节日事件', default: true },
      {
        id: 'custom',
        label: '自定义事件',
        default: true,
        keyPrefix: 'custom:',
      },
    ],
    standbyKinds: ['chat'],
    touchKinds: ['touch'],
    resumeKinds: ['greet'],
    standbyIdleMs: 25000,
    greetingDelayMs: 3000,
  },
  bgm: { enabled: true, file: 'bgm.ogg', volume: 0.5 },
} as unknown as Configs;

const panel = createArchive({
  visible: true,
  config: cfg,
  events,
  eventsFile: { path: 'assets/events.jsonc', error: null },
});

const rowsBox = byId('wb-archive-rows');
const rowEls = (): StubEl[] => (rowsBox ? rowsBox.children.slice() : []);

const allCount = panel.rowCount();
ok('「全部」视图有行', allCount > 0, 'rowCount=' + allCount);
eq('DOM 行数 = rowCount', rowEls().length, allCount);

/** ① 按事件族 → 节日事件 */
panel.setView('family', 'festival');
const famRows = rowEls();
ok(
  '切「按事件族」后行数下降',
  famRows.length > 0 && famRows.length < allCount,
  famRows.length + ' / ' + allCount
);
ok(
  '该页每一行都属于节日族（角标带「节日事件」）',
  famRows.length > 0 &&
    famRows.every((r) => deepText(r).indexOf('节日事件') >= 0),
  famRows.map((r) => deepText(r).slice(0, 24)).join(' | ')
);

/** ② 按通道分组 → 点击触摸 */
panel.setView('group', 'touch');
const grpRows = rowEls();
ok('切「按通道分组」后有行', grpRows.length > 0, String(grpRows.length));
ok(
  '该页每一行的事件列都以「点击触摸」开头',
  grpRows.length > 0 &&
    grpRows.every((r) => deepText(r).indexOf('点击触摸') === 0),
  grpRows.map((r) => deepText(r).slice(0, 20)).join(' | ')
);

/** ③ 子页签：三族 + BGM 那条「未分类」 */
click(byId('wb-archive-view-family'));
const subBar = byId('wb-archive-subbar');
const subLabels = subBar ? subBar.children.map((c) => c.textContent) : [];
ok(
  '「按事件族」的子页签 = 三族 + 未分类（BGM 行）',
  subLabels.join(',') === '普通事件,节日事件,自定义事件,未分类',
  subLabels.join(',')
);
ok(
  '子页签容器已显示',
  subBar?.style.display === 'flex',
  String(subBar?.style.display)
);

/**
 * ④ 子页签给了**不存在的族** ⇒ 回落到第一个页签（"绝不留在空页上"那条守卫）。
 *
 * ★ 这正是它该有的行为：页签集合只由"有行的族"构成，外面传进来的键不在集合里
 *   就只能回落，否则用户会看到一个既没有行、又没有提示的空白卡片。
 */
panel.setView('family', 'no-such-family');
eq('不存在的族 ⇒ 回落到第一个页签', panel.view().key, 'normal');
ok('回落后有行（不是空页）', panel.rowCount() > 0, String(panel.rowCount()));

/** ⑤ 回「全部」⇒ 行数复原 */
click(byId('wb-archive-view-all'));
eq('回「全部」行数复原', panel.rowCount(), allCount);
panel.dispose();

/** ⑥ 真正的空表（事件文件为空）⇒ 「全部」视图给空态文案，而不是一片空白 */
const emptyPanel = createArchive({
  visible: true,
  /** ★ 关掉 BGM：开着的话「背景音乐」那一行永远在，空表就永远不是 0 行 */
  config: { ...cfg, bgm: { enabled: false } } as unknown as Configs,
  events: [],
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
eq('空事件表 ⇒ 0 行', emptyPanel.rowCount(), 0);
const emptyRows = byId('wb-archive-rows')?.children.slice() ?? [];
ok(
  '空态有说明文案（不是一片空白）',
  emptyRows.length === 1 && deepText(emptyRows[0]).indexOf('没有事件') >= 0,
  emptyRows.map((r) => deepText(r)).join('')
);
emptyPanel.dispose();

/* ══ D. 档案页脚「指南」 ════════════════════════════════════ */

console.log('\nD. 档案指南（指路 events.jsonc + 自定义事件）');

const guide = byId('wb-archive-guide');
const guideText = guide ? deepText(guide) : '';
ok(
  '指南点名事件文件',
  guideText.indexOf('assets/events.jsonc') >= 0,
  guideText.slice(0, 40)
);
ok('指南写明"详细信息"在哪看', guideText.indexOf('详细信息') >= 0);
ok('指南写明自定义事件在哪实现', guideText.indexOf('自定义事件') >= 0);

console.log(
  '\n' +
    (fail === 0 ? '全部通过' : '有失败项') +
    '：' +
    pass +
    ' pass / ' +
    fail +
    ' fail'
);
process.exit(fail === 0 ? 0 : 1);
