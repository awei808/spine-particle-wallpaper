// 回归 101：档案「已停用」视图 + 档案/事件开关两处翻页（2026-10-22）
//
// 跑法（仓库根目录，不需要浏览器）：
//   npx ts-node --transpile-only _regress/101_回归_档案停用与两处翻页.ts
//
// 钉住三件事（都是**用户可见行为**，不是实现细节）：
//   A. 档案**主表**跟着「事件开关 / 事件族」变 —— 关掉一条就少一行、
//      取消勾选一个族就少一片（2026-10-21 那版"纹丝不动"的行为即为本次 bug）
//   B. 被停用的条目没丢 ⇒ 在「已停用」视图里逐条给出原因
//   C. 两处翻页：每页 6 条、翻页真的换了行、翻页条只在够翻时出现
//
// ⚠️ `100_dom_stub` 必须**第一个** import：它要在 `src/archive.ts`
//    / `src/settingsPanel.ts` 求值之前把 `window` / `document` 装好。
import { byId, click, deepText, StubEl } from './100_dom_stub';
import { Configs, DialogueEntry } from '../src/config.type';
import { createArchive } from '../src/archive';
import { createSettingsPanel } from '../src/settingsPanel';
import { readView } from '../src/settingsStore';

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

/* ── 素材 ──────────────────────────────────────────────────── */

const entry = (
  id: string,
  kind: 'greet' | 'chat' | 'touch',
  on: 'resume' | 'standby' | 'touch',
  phase?: string,
  enabled?: boolean
): DialogueEntry =>
  ({
    id,
    animation: kind === 'chat' ? 'chat' : kind === 'greet' ? 'greet' : 'touch1',
    kind,
    on: [on],
    phase,
    enabled,
    text: id + ' 的念白',
  } as DialogueEntry);

const cfg = (phases: string[]): Configs =>
  ({
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
      phases,
      standbyKinds: ['chat'],
      touchKinds: ['touch'],
      resumeKinds: ['greet'],
    },
    bgm: { enabled: false },
  } as unknown as Configs);

/** 5 条：2 greet / 1 chat / 2 touch（其中 2 条属节日族） */
const base: DialogueEntry[] = [
  entry('game:64001', 'greet', 'resume'),
  entry('custom:valentine', 'greet', 'resume', 'festival'),
  entry('game:64004', 'chat', 'standby'),
  entry('game:64005', 'touch', 'touch'),
  entry('custom:mine', 'touch', 'touch'),
];

const off = (events: DialogueEntry[], key: string): DialogueEntry[] =>
  events.map((e) => (e.id === key ? { ...e, enabled: false } : e));

const rowsNow = (): StubEl[] => {
  const box = byId('wb-archive-rows');
  return box ? box.children.slice() : [];
};

/* ══ A. 主表跟着开关 / 事件族变 ══════════════════════════════ */

console.log('\nA. 档案主表随「事件开关 / 事件族」变化');

const pAll = createArchive({
  visible: true,
  config: cfg(['normal', 'festival', 'custom']),
  events: base,
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
const allTotal = pAll.pager().total;
eq('全开 ⇒ 5 行（每条各占一行）', allTotal, 5);
eq('全开 ⇒ 已停用 0 条', (() => {
  pAll.setView('off');
  const n = pAll.pager().total;
  pAll.setView('all');
  return n;
})(), 0);
pAll.dispose();

const pOffBuiltin = createArchive({
  visible: true,
  config: cfg(['normal', 'festival', 'custom']),
  events: off(base, 'game:64005'),
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
eq('关掉内置一条 ⇒ 主表少 1 行', pOffBuiltin.pager().total, 4);
ok(
  '关掉的那条不在主表里',
  !rowsNow().some((r) => deepText(r).indexOf('game:64005') >= 0),
  rowsNow()
    .map((r) => deepText(r).slice(0, 30))
    .join(' | ')
);
pOffBuiltin.setView('off');
eq('已停用视图 ⇒ 1 条', pOffBuiltin.pager().total, 1);
ok(
  '已停用那条写明「已被「事件开关」关闭」',
  rowsNow().some((r) => deepText(r).indexOf('已被「事件开关」关闭') >= 0),
  rowsNow()
    .map((r) => deepText(r).slice(0, 40))
    .join(' | ')
);
pOffBuiltin.dispose();

const pOffCustom = createArchive({
  visible: true,
  config: cfg(['normal', 'festival', 'custom']),
  events: off(base, 'custom:mine'),
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
/**
 * ★ 这一条正是本次 bug 的**原样复现**：2026-10-21 那版关掉自定义事件后
 *   档案行数纹丝不动（仍在主表的「自定义事件」段带标注列出）。
 */
eq('关掉自定义一条 ⇒ 主表少 1 行（bug 复现点）', pOffCustom.pager().total, 4);
pOffCustom.dispose();

const pFam = createArchive({
  visible: true,
  config: cfg(['normal']),
  events: base,
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
eq('事件族只勾「普通」⇒ 节日族 + 自定义族那两条出局', pFam.pager().total, 3);
pFam.setView('off');
eq('已停用视图 ⇒ 2 条', pFam.pager().total, 2);
ok(
  '已停用写明「所属事件族未勾选」',
  rowsNow().every((r) => deepText(r).indexOf('所属事件族未勾选') >= 0),
  rowsNow()
    .map((r) => deepText(r).slice(0, 40))
    .join(' | ')
);
pFam.dispose();

/** 细则必须指路，否则"我关掉的那条去哪了"没有答案 */
const pNote = createArchive({
  visible: true,
  config: cfg(['normal', 'festival', 'custom']),
  events: off(base, 'game:64005'),
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
const noteText = deepText(byId('wb-archive-notes') as StubEl);
ok(
  '细则里有「已停用」的指路（报条数 + 点名视图）',
  noteText.indexOf('已停用') >= 0 && noteText.indexOf('不会播') >= 0,
  noteText.slice(0, 120)
);
pNote.dispose();

/* ══ B. 档案翻页（每页 6 行） ════════════════════════════════ */

console.log('\nB. 档案翻页（每页 6 行）');

const many: DialogueEntry[] = base.concat(
  ['64010', '64011', '64012', '64013', '64014', '64015', '64016'].map((n) =>
    entry('game:' + n, 'touch', 'touch')
  )
);
const pPage = createArchive({
  visible: true,
  config: cfg(['normal', 'festival', 'custom']),
  events: many,
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
eq('12 条 ⇒ 2 页', pPage.pager().count, 2);
eq('每页上限 6', pPage.pager().size, 6);
eq('第 1 页渲染 6 行', pPage.rowCount(), 6);
eq('DOM 行数 = rowCount', rowsNow().length, 6);
const page1Text = rowsNow().map((r) => deepText(r)).join('|');

click(byId('wb-archive-next'));
eq('翻到第 2 页', pPage.pager().index, 1);
eq('第 2 页也是 6 行', pPage.rowCount(), 6);
const page2Text = rowsNow().map((r) => deepText(r)).join('|');
ok('两页内容不同（翻页真的换了行）', page1Text !== page2Text);
ok(
  '两页没有重复条目',
  rowsNow().every(
    (r) => page1Text.indexOf(deepText(r).slice(-24)) < 0
  ),
  '第 2 页有行出现在第 1 页里'
);

click(byId('wb-archive-prev'));
eq('翻回第 1 页', pPage.pager().index, 0);
eq('翻回来行数不变', pPage.rowCount(), 6);

/** 只有一页时两个按钮都是置灰态（不是崩、也不是跳页） */
click(byId('wb-archive-prev'));
eq('已在第 1 页 ⇒ 再点上一页不动', pPage.pager().index, 0);

/** 切视图 ⇒ 回到第 1 页 */
click(byId('wb-archive-next'));
pPage.setView('group', 'touch');
eq('切视图 ⇒ 页码归零', pPage.pager().index, 0);
ok('按通道分组「点击触摸」有 9 行', pPage.pager().total === 9, String(pPage.pager().total));
eq('分页后本页 6 行', pPage.rowCount(), 6);
pPage.dispose();

/** 末页不足 6 行（7 行：第 1 页 6 行 + 第 2 页 1 行）但不报错 */
const pOdd = createArchive({
  visible: true,
  config: cfg(['normal', 'festival', 'custom']),
  events: base.concat([
    entry('game:64020', 'touch', 'touch'),
    entry('game:64021', 'touch', 'touch'),
  ]),
  eventsFile: { path: 'assets/events.jsonc', error: null },
});
eq('7 行（视图全集不受分页影响）', pOdd.pager().total, 7);
eq('7 行 ⇒ 2 页', pOdd.pager().count, 2);
pOdd.setPage(1);
eq('末页只剩 1 行', pOdd.rowCount(), 1);
/** 越界页码自动夹取（不会渲染出空页） */
pOdd.setPage(99);
eq('页码越界 ⇒ 夹到末页', pOdd.pager().index, 1);
pOdd.dispose();

/* ══ C. 设置面板「事件开关」页翻页 ════════════════════════════ */

console.log('\nC. 事件开关页翻页（每页 6 条）');

const evTable: DialogueEntry[] = ['64001', '64002', '64003', '64004', '64005', '64006', '64007', '64008'].map(
  (n, i) => entry('game:' + n, i < 4 ? 'chat' : 'touch', i < 4 ? 'standby' : 'touch')
);

const saved: unknown[] = [];
const panel = createSettingsPanel({
  animations: [],
  view: readView({} as Configs),
  eventTable: evTable,
  eventState: { schema: 1, enabled: {} },
  eventDefaults: {},
  onSave: (patch) => {
    saved.push(patch);
  },
  onReset: () => undefined,
  onSaveEventState: () => undefined,
});

const evRowsNow = (): StubEl[] => {
  const box = byId('wb-ev-list');
  return box ? box.children.slice() : [];
};

/** 切到「事件开关」页（默认停在第一个 tab） */
click(byId('wb-tab-btn-events'));
eq('事件开关页 ⇒ 只渲染 6 条', evRowsNow().length, 6);
eq('翻页条已显示（8 条 > 1 页）', byId('wb-ev-pager')?.style.display, 'flex');
eq(
  '页码文案含总条数',
  (byId('wb-ev-page-label') as StubEl).textContent.indexOf('共 8 条') >= 0,
  true
);
const evPage1 = evRowsNow().map((r) => deepText(r)).join('|');

click(byId('wb-ev-next'));
eq('翻到第 2 页 ⇒ 2 条', evRowsNow().length, 2);
const evPage2 = evRowsNow().map((r) => deepText(r)).join('|');
ok('两页内容不同', evPage1 !== evPage2);

click(byId('wb-ev-prev'));
eq('翻回第 1 页', evRowsNow().length, 6);

/** 切到别的 tab ⇒ 翻页条隐藏（它只属于本页） */
click(byId('wb-tab-btn-bgm'));
eq('切到别的页 ⇒ 翻页条隐藏', byId('wb-ev-pager')?.style.display, 'none');
click(byId('wb-tab-btn-events'));
eq('切回来 ⇒ 翻页条又出现', byId('wb-ev-pager')?.style.display, 'flex');

/** 只有一页 ⇒ 整根不显示（不摆一个点不动的控件） */
const smallPanel = createSettingsPanel({
  animations: [],
  view: readView({} as Configs),
  eventTable: evTable.slice(0, 4),
  eventState: { schema: 1, enabled: {} },
  eventDefaults: {},
  onSave: () => undefined,
  onReset: () => undefined,
  onSaveEventState: () => undefined,
});
click(byId('wb-tab-btn-events'));
eq('4 条只有一页 ⇒ 翻页条不显示', byId('wb-ev-pager')?.style.display, 'none');
eq('4 条全部渲染', evRowsNow().length, 4);
smallPanel.dispose();
panel.dispose();

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
