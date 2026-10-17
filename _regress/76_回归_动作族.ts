// 回归：**动作族（spine 动作族显示）**（2026-10-17 新增）
//
// 跑法（在仓库根目录，**不需要任何外部素材**）：
//   npx ts-node --transpile-only _regress/76_回归_动作族.ts
//
// 覆盖的全是 `dialogue.ts` 里的**纯函数**：
//   `buildFamilyRegistry`（新增 `actionIds` / `defaultActionId` / `suffixOf` / `actionLabel`）
//   `resolveActionPhase` / `resolveAnimationName` / `resolveEntryAnimation` /
//   `resolveIdleAnimation` / `projectDialoguesToActionPhase` / `isEntryVisibleInPhase`
//
// 口径（用户 2026-10-17 拍板）：
//   · 事件族只剩两族：`postMarry`（带 `matchSuffix: "_marry"`）与 `normal`（缺省族）；
//     原先的 `preMarry` 已并入 `normal`；
//   · 「spine 动作族显示」单选：缺省 = **誓约后**（= 注册表里第一个动作族），
//     `''` = 誓约前（不换名）；
//   · 换名是**全局**的（常驻 idle / 问候 / 待机 / 点击 / 序列），只改动画名，
//     `actionId` / `text` / `voice` / `phase` 一律不动；
//   · 池成员资格：属**别的动作族**的条目在当前状态下不进池 ⇒ 婚前 6 / 婚后 9；
//   · 事件族（`subtitle.phases`）是**全局闸门**（2026-10-17 起）：一项都不勾 ⇒ 所有池为空。
import * as fs from 'fs';
import { DialogueEntry } from '../src/config.type';
import {
  buildFamilyRegistry,
  buildPool,
  isEntryVisibleInPhase,
  mergeKindPools,
  normalizeGreetIds,
  projectDialoguesToActionPhase,
  resolveActionPhase,
  resolveAnimationName,
  resolveEntryAnimation,
  resolveIdleAnimation,
  resolvePhases,
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

const E = (
  actionId: number,
  animation: string,
  phase?: string,
  extra?: Partial<DialogueEntry>
): DialogueEntry => ({
  actionId,
  animation,
  text: 't' + actionId,
  voice: 'v' + actionId + '.ogg',
  ...(phase !== undefined ? { phase } : {}),
  ...(extra ?? {}),
});

/** 誓约工程（S8/S6）的注册表 —— 2026-10-17 两族制 */
const VOW = [
  {
    id: 'postMarry',
    label: '誓约后事件',
    actionLabel: '誓约后',
    default: true,
    matchSuffix: '_marry',
  },
  { id: 'normal', label: '普通事件', default: true, fallback: true },
];

/** 非誓约皮肤（S9 等）：没有动作族 */
const PLAIN = [{ id: 'normal', label: '普通事件', fallback: true }];

/** 未来自定义动作族的形状（证明"加一族只改 config"） */
const CUSTOM = [
  { id: 'base', label: '原装', fallback: true },
  {
    id: 'kimono',
    label: '和服事件',
    actionLabel: '和服',
    matchSuffix: '_kimono',
  },
  {
    id: 'swim',
    label: '泳装事件',
    actionLabel: '泳装',
    matchSuffix: '_swim',
  },
];

/* ── A. 注册表的动作族字段 ──────────────────────────────── */

console.log('\nA. 注册表的动作族字段（actionIds / suffixOf / actionLabel）');

const vow = buildFamilyRegistry(VOW);
const plain = buildFamilyRegistry(PLAIN);
const custom = buildFamilyRegistry(CUSTOM);
const def = buildFamilyRegistry(undefined);
const empty = buildFamilyRegistry([]);

eq('A1 誓约注册表 ⇒ actionIds = 带 matchSuffix 的那些', vow.actionIds, [
  'postMarry',
]);
eq(
  'A2 誓约注册表 ⇒ defaultActionId = 第一个动作族',
  vow.defaultActionId,
  'postMarry'
);
eq('A3 suffixOf 取到后缀', vow.suffixOf('postMarry'), '_marry');
eq('A4 非动作族 ⇒ suffixOf 为空串', vow.suffixOf('normal'), '');
eq('A5 非法 id ⇒ suffixOf 为空串', vow.suffixOf('nope'), '');
eq('A6 actionLabel 优先于 label', vow.actionLabel('postMarry'), '誓约后');
eq('A7 没写 actionLabel ⇒ 回落 label', vow.actionLabel('normal'), '普通事件');
eq('A8 非誓约注册表 ⇒ 无动作族', plain.actionIds, []);
eq('A9 非誓约注册表 ⇒ defaultActionId = ""', plain.defaultActionId, '');
eq('A10 没声明 eventFamilies ⇒ 内置单族无动作族', def.actionIds, []);
eq('A11 空注册表 ⇒ 无动作族', empty.actionIds, []);
eq('A12 ★ 自定义多动作族 ⇒ 声明顺序原样（未来扩展的接口）', custom.actionIds, [
  'kimono',
  'swim',
]);
eq('A13 自定义 ⇒ 缺省取第一个动作族', custom.defaultActionId, 'kimono');
eq('A14 自定义 ⇒ actionLabel 生效', custom.actionLabel('swim'), '泳装');
eq(
  'A15 空串 matchSuffix 不算动作族（避免"后缀为空 ⇒ 人人都加空串"）',
  buildFamilyRegistry([{ id: 'a', matchSuffix: '' }]).actionIds,
  []
);

/* ── B. 摊平动作族 `resolveActionPhase` ─────────────────── */

console.log('\nB. 摊平动作族（resolveActionPhase）');

eq(
  'B1 没配 ⇒ 第一个动作族（= 誓约后）',
  resolveActionPhase(undefined, vow),
  'postMarry'
);
eq(
  'B2 ★ 显式空串 ⇒ 空串（誓约前，**不**退回缺省）',
  resolveActionPhase('', vow),
  ''
);
eq('B3 合法动作族 ⇒ 原样', resolveActionPhase('postMarry', vow), 'postMarry');
eq('B4 非数组/数字 ⇒ 退回缺省', resolveActionPhase(3, vow), 'postMarry');
eq(
  'B5 ★ 指向没有后缀的族（normal）⇒ 降级成空串（绝不换错后缀）',
  resolveActionPhase('normal', vow),
  ''
);
eq('B6 非法族 id ⇒ 空串', resolveActionPhase('typo', vow), '');
eq('B7 非誓约注册表 ⇒ 恒空串', resolveActionPhase(undefined, plain), '');
eq('B8 空注册表 ⇒ 恒空串', resolveActionPhase('postMarry', empty), '');
eq(
  'B9 自定义族 ⇒ 能选第二个动作族',
  resolveActionPhase('swim', custom),
  'swim'
);

/* ── C. 换名 `resolveEntryAnimation` / `resolveAnimationName` ── */

console.log('\nC. 换名（resolveEntryAnimation / resolveAnimationName）');

eq(
  'C1 三分支③：原名 + 后缀',
  resolveEntryAnimation(E(63001, 'greet'), vow, 'postMarry'),
  'greet_marry'
);
eq(
  'C2 三分支②：已经带后缀 ⇒ 不重复追加',
  resolveEntryAnimation(E(63004, 'greet_marry'), vow, 'postMarry'),
  'greet_marry'
);
eq(
  'C3 三分支①：phaseAnimations 显式覆盖优先（chat → chat2_marry）',
  resolveEntryAnimation(
    E(63011, 'chat', 'normal', {
      phaseAnimations: { postMarry: 'chat2_marry' },
    }),
    vow,
    'postMarry'
  ),
  'chat2_marry'
);
eq(
  'C4 ★ 显式覆盖优先于"已带后缀"（覆盖值说了算）',
  resolveEntryAnimation(
    E(1, 'chat_marry', 'normal', {
      phaseAnimations: { postMarry: 'chat2_marry' },
    }),
    vow,
    'postMarry'
  ),
  'chat2_marry'
);
eq(
  'C5 誓约前（空串）⇒ 原名',
  resolveEntryAnimation(E(63001, 'greet'), vow, ''),
  'greet'
);
eq(
  'C6 非动作族状态 ⇒ 原名',
  resolveEntryAnimation(E(63001, 'greet'), vow, 'normal'),
  'greet'
);
eq(
  'C7 空动画名 ⇒ 空串（不抛）',
  resolveEntryAnimation(E(1, ''), vow, 'postMarry'),
  ''
);
eq(
  'C8 phaseAnimations 里**别的**动作族的键不影响本族',
  resolveEntryAnimation(
    E(1, 'chat', 'normal', { phaseAnimations: { swim: 'chat_swim' } }),
    vow,
    'postMarry'
  ),
  'chat_marry'
);
eq(
  'C9 裸名换名（idle）',
  resolveAnimationName('idle', vow, 'postMarry'),
  'idle_marry'
);
eq(
  'C10 裸名已带后缀 ⇒ 不重复',
  resolveAnimationName('idle_marry', vow, 'postMarry'),
  'idle_marry'
);
eq('C11 裸名 + 空串 ⇒ 原名', resolveAnimationName('idle', vow, ''), 'idle');
eq(
  'C12 自定义动作族 ⇒ 用它的后缀',
  resolveAnimationName('greet', custom, 'swim'),
  'greet_swim'
);
eq('C13 空裸名 ⇒ 空串', resolveAnimationName('', vow, 'postMarry'), '');

/* ── D. 常驻动画存在性 `resolveIdleAnimation` ────────────── */

console.log('\nD. 常驻动画（resolveIdleAnimation，骨架存在性）');

const S8_ANIMS = [
  'chat',
  'chat2_marry',
  'greet',
  'greet_marry',
  'idle',
  'idle_marry',
  'touch1',
  'touch1_marry',
  'touch2',
  'touch2_marry',
];
const BJ_ANIMS = ['animation']; // 挂件骨架：没有 idle / 没有 *_marry

eq(
  'D1 骨架有 idle_marry ⇒ 换',
  resolveIdleAnimation('idle', S8_ANIMS, vow, 'postMarry'),
  { name: 'idle_marry', want: 'idle_marry', fallback: false }
);
eq(
  'D2 ★ 挂件骨架没有该动画 ⇒ 退回原名并标 fallback（不是错）',
  resolveIdleAnimation('animation', BJ_ANIMS, vow, 'postMarry'),
  { name: 'animation', want: 'animation_marry', fallback: true }
);
eq(
  'D3 誓约前 ⇒ 原名（fallback = false，因为压根没想换）',
  resolveIdleAnimation('idle', S8_ANIMS, vow, ''),
  { name: 'idle', want: 'idle', fallback: false }
);
eq(
  'D4 没有动画表 ⇒ 不敢换（宁可保持原样，也不要 addAnimation throw）',
  resolveIdleAnimation('idle', [], vow, 'postMarry'),
  { name: 'idle', want: 'idle_marry', fallback: true }
);

/* ── E. 整表投影 `projectDialoguesToActionPhase` ────────── */

console.log('\nE. 整表投影（projectDialoguesToActionPhase）');

const S8_DLG: DialogueEntry[] = [
  E(63001, 'greet', 'normal'),
  E(63002, 'greet', 'normal'),
  E(63003, 'touch2', 'normal'),
  E(63011, 'chat', 'normal', { phaseAnimations: { postMarry: 'chat2_marry' } }),
  E(63012, 'greet', 'normal'),
  E(63006, 'chat', 'normal', { phaseAnimations: { postMarry: 'chat2_marry' } }),
  E(63007, 'touch1', 'normal'),
  E(63008, 'touch1', 'normal'),
  E(63009, 'touch2', 'normal'),
  E(63013, 'touch1', 'normal'),
  E(63004, 'greet', 'postMarry'),
  E(63005, 'chat', 'postMarry', {
    phaseAnimations: { postMarry: 'chat2_marry' },
  }),
  E(63010, 'chat', 'postMarry', {
    phaseAnimations: { postMarry: 'chat2_marry' },
  }),
];

const projPost = projectDialoguesToActionPhase(S8_DLG, vow, 'postMarry');
const projPre = projectDialoguesToActionPhase(S8_DLG, vow, '');

eq('E1 投影后条数不变', projPost.length, S8_DLG.length);
eq(
  'E2 ★ 誓约后：63011 用显式覆盖 chat2_marry',
  projPost.find((d) => d.actionId === 63011)?.animation,
  'chat2_marry'
);
eq(
  'E3 誓约后：63001 用后缀 greet_marry',
  projPost.find((d) => d.actionId === 63001)?.animation,
  'greet_marry'
);
eq(
  'E4 ★ 誓约前：全部保持原名',
  projPre.map((d) => d.animation),
  S8_DLG.map((d) => d.animation)
);
ok(
  'E5 ★ 不就地改原表（原条目 animation 仍是原名）',
  S8_DLG.find((d) => d.actionId === 63001)?.animation === 'greet'
);
ok('E6 ★ 条目是**新对象**（浅拷贝），不是同一引用', projPost[0] !== S8_DLG[0]);
eq(
  'E7 ★ 只改 animation：actionId / text / voice 逐条不变',
  projPost.map((d) => [d.actionId, d.text, d.voice]),
  S8_DLG.map((d) => [d.actionId, d.text, d.voice])
);
eq(
  'E8 ★ phase 被钉住（投影后不会因动画名带 _marry 而被重判族）',
  projPost.map((d) => d.phase),
  S8_DLG.map((d) => resolvePhase(d))
);
ok(
  'E9 誓约前投影 ⇒ 数组浅拷贝（不克隆条目，什么都没变）',
  projPre[0] === S8_DLG[0]
);
eq(
  'E10 空表 ⇒ 空数组',
  projectDialoguesToActionPhase([], vow, 'postMarry'),
  []
);

function resolvePhase(d: DialogueEntry): string {
  // 夹具里都写了显式 phase ⇒ 钉住后应当逐条相同
  return d.phase ?? '';
}

/* ── F. 池成员资格 `isEntryVisibleInPhase` ──────────────── */

console.log('\nF. 池成员资格（isEntryVisibleInPhase）');

const postEntry = E(63004, 'greet', 'postMarry');
const normEntry = E(63001, 'greet', 'normal');

ok(
  'F1 缺省族条目 ⇒ 誓约后可用',
  isEntryVisibleInPhase(normEntry, vow, 'postMarry')
);
ok('F2 缺省族条目 ⇒ 誓约前也可用', isEntryVisibleInPhase(normEntry, vow, ''));
ok(
  'F3 动作族条目 ⇒ 在该状态下可用',
  isEntryVisibleInPhase(postEntry, vow, 'postMarry')
);
ok(
  'F4 ★ 动作族条目 ⇒ 在**誓约前**不可用（游戏婚前池没有 MarryAction）',
  !isEntryVisibleInPhase(postEntry, vow, '')
);
ok(
  'F5 ★ 属**另一个**动作族 ⇒ 不可用（自定义族的隔离）',
  !isEntryVisibleInPhase(E(1, 'greet', 'swim'), custom, 'kimono')
);
ok(
  'F6 无后缀的纯分类族 ⇒ 恒可用（老 config 的 preMarry 兜底，不因状态消失）',
  isEntryVisibleInPhase(
    E(1, 'greet', 'preMarry'),
    buildFamilyRegistry([
      { id: 'preMarry', label: '誓约前事件' },
      { id: 'postMarry', label: '誓约后事件', matchSuffix: '_marry' },
      { id: 'normal', label: '普通事件', fallback: true },
    ]),
    'postMarry'
  )
);
ok(
  'F7 空注册表 ⇒ 一律可用（本项目无事件族机制）',
  isEntryVisibleInPhase(postEntry, empty, '')
);

/* ── G. 端到端：池大小与"问候不再被族筛掉" ─────────────── */

console.log('\nG. 端到端（婚前 6 / 婚后 9，问候恒 3 条）');

const TOUCH_IDS = [
  63012, 63006, 63007, 63008, 63009, 63013, 63004, 63005, 63010,
];
const GREET_IDS = [63001, 63002, 63003];
const CHAT_IDS = [63011];

const activePost = projPost.filter((d) =>
  isEntryVisibleInPhase(d, vow, 'postMarry')
);
const activePre = projPre.filter((d) => isEntryVisibleInPhase(d, vow, ''));

const touchPost = buildPool(activePost, TOUCH_IDS);
const touchPre = buildPool(activePre, TOUCH_IDS);
eq(
  'G1 ★ 誓约后触摸池 = 9 条（TouchFeedback 6 + MarryAction 3）',
  touchPost.length,
  9
);
eq('G2 ★ 誓约前触摸池 = 6 条（只剩 TouchFeedback 6 位）', touchPre.length, 6);
eq(
  'G3 誓约前池里没有 postMarry 那 3 条',
  touchPre
    .map((d) => d.actionId)
    .filter((id) => [63004, 63005, 63010].indexOf(id) >= 0),
  []
);
eq(
  'G4 ★★ 问候池在誓约后仍然是 3 条（旧 autoFilter 会把它筛成 0 → 这是本回归的重点）',
  buildPool(activePost, normalizeGreetIds(GREET_IDS)).length,
  3
);
eq('G5 待机闲聊池仍然是 1 条', buildPool(activePost, CHAT_IDS).length, 1);
eq(
  'G6 ★ 誓约后点击池的动画名 100% 带 _marry（除 63003 的 touch2 → touch2_marry 也算）',
  touchPost.filter((d) => !/_marry$/.test(d.animation)).map((d) => d.actionId),
  []
);
eq(
  'G7 誓约前点击池的动画名 100% 不带 _marry',
  touchPre.filter((d) => /_marry$/.test(d.animation)).map((d) => d.actionId),
  []
);
eq(
  'G8 触摸事件族筛（touchPhases）与动作族是两层：誓约前勾上 postMarry 也抽不到',
  buildPool(
    activePre,
    TOUCH_IDS,
    resolveTriggerPhases(['postMarry', 'normal'], vow),
    vow
  ).length,
  6
);
eq(
  'G9 誓约后勾 [normal] ⇒ 只剩 6 条（族筛仍然有效）',
  buildPool(activePost, TOUCH_IDS, resolveTriggerPhases(['normal'], vow), vow)
    .length,
  6
);
ok(
  'G10 并池去重键仍是 actionId|phase（同 id 不同族两条都留）',
  mergeKindPools(
    ['chat', 'touch'],
    {
      chat: [E(1, 'chat', 'postMarry')],
      greet: [],
      touch: [E(1, 'chat', 'normal')],
    },
    vow
  ).length === 2
);

/* ── H. 事件族 = **全局闸门**（2026-10-17 语义变更）────────── */

console.log('\nH. 事件族闸门（对所有入口生效）');

eq(
  'H1 新字段优先：phases 有值 ⇒ 不看旧键',
  resolvePhases(['normal'], ['postMarry'], vow),
  ['normal']
);
eq(
  'H2 ★ 新字段是空数组 ⇒ 全关（**不**退回旧键）',
  resolvePhases([], ['postMarry', 'normal'], vow),
  []
);
eq(
  'H3 新字段缺席 ⇒ 读旧键 touchPhases（老存档照常生效）',
  resolvePhases(undefined, ['postMarry'], vow),
  ['postMarry']
);
eq('H4 都没给 ⇒ 注册表缺省勾选', resolvePhases(undefined, undefined, vow), [
  'postMarry',
  'normal',
]);
eq(
  'H5 新字段拼错（全非法）⇒ 当作没配、退回缺省（与 *Kinds 同口径）',
  resolvePhases(['typo'], undefined, vow),
  ['postMarry', 'normal']
);
eq(
  'H6 注册表为空 ⇒ 恒空数组（但调用方此时**不筛**，见 H7）',
  resolvePhases([], undefined, empty),
  []
);
eq(
  'H7 注册表为空 ⇒ 调用方判据退化为 undefined（不筛，所有条目一视同仁）',
  (() => {
    const mk = (f: ReturnType<typeof buildFamilyRegistry>, raw: string[]) =>
      f.families.length ? raw : undefined;
    return [mk(empty, resolvePhases([], undefined, empty)), mk(vow, [])];
  })(),
  [null, []]
);

/**
 * ★★ 三条通道**共用同一套池**：只勾 `postMarry` 时，问候与待机也必须被挡掉。
 *   这正是用户 2026-10-17 要的行为（"仅勾誓约后 ⇒ 只有那 3 条 touch 会触发"）。
 */
eq(
  'H8 ★ 只勾 postMarry ⇒ 点击池只有那 3 条',
  buildPool(activePost, TOUCH_IDS, ['postMarry'], vow).length,
  3
);
eq(
  'H9 ★ 只勾 postMarry ⇒ 问候池为空（问候属 normal）',
  buildPool(activePost, normalizeGreetIds(GREET_IDS), ['postMarry'], vow)
    .length,
  0
);
eq(
  'H10 ★ 只勾 postMarry ⇒ 待机闲聊池为空（chat 属 normal）',
  buildPool(activePost, CHAT_IDS, ['postMarry'], vow).length,
  0
);
eq(
  'H11 ★ 一项都不勾 ⇒ 三个池全空（档案里没有任何事件行）',
  (() => {
    const f: readonly string[] = [];
    return [
      buildPool(activePost, TOUCH_IDS, f, vow).length,
      buildPool(activePost, normalizeGreetIds(GREET_IDS), f, vow).length,
      buildPool(activePost, CHAT_IDS, f, vow).length,
    ];
  })(),
  [0, 0, 0]
);
eq(
  'H12 两族全勾 ⇒ 回到 9 / 3 / 1（与改动前一致）',
  (() => {
    const f = ['postMarry', 'normal'];
    return [
      buildPool(activePost, TOUCH_IDS, f, vow).length,
      buildPool(activePost, normalizeGreetIds(GREET_IDS), f, vow).length,
      buildPool(activePost, CHAT_IDS, f, vow).length,
    ];
  })(),
  [9, 3, 1]
);
eq(
  'H13 ★ 誓约前 + 只勾 postMarry ⇒ 池空（动作族说"这条不存在"，事件族说"只允许它"）',
  buildPool(activePre, TOUCH_IDS, ['postMarry'], vow).length,
  0
);

/* ── I. 产物检查 ────────────────────────────────────────── */

console.log('\nI. 产物检查（dist/bundle.js；不存在则跳过）');

const BUNDLE = process.argv[2] || process.env.WK_BUNDLE || 'dist/bundle.js';
if (fs.existsSync(BUNDLE)) {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  for (const word of [
    'actionPhase',
    'actionPhaseBaseLabel',
    'wb-set-action-phase',
  ]) {
    ok('I  正面：bundle 含 ' + word, src.indexOf(word) >= 0);
  }
  for (const word of ['preMarry', 'postMarry', '誓约前', '誓约后']) {
    ok(
      'I  负向：bundle 里**没有**写死的业务词「' + word + '」',
      src.indexOf(word) < 0
    );
  }
} else {
  console.log('  SKIP  ' + BUNDLE + ' 不存在（先 npm run build）');
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
