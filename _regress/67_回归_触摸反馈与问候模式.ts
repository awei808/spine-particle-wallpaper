/**
 * 回归：**① 播放动作事件时的触摸反馈**（immediate / queue / none）
 *      + **② 问候事件的触发方式**（按系统时间 / 随机）
 *      + **③ 三条事件列表统一成数组**（greet / chat / touch）
 *
 * ## 需求（用户 2026-10-08）
 *
 *   1. 「壁纸内置设置中需要加几个配置：播放动作事件时触摸反馈 =
 *      立即播放新动作事件 / 将新动作事件加入播放队列 / 无任何反馈」；
 *   2. 「问候事件触发条件 = 根据系统时间触发对应时间问候 / 随机触发问候事件」；
 *   3. 「在 config.json 里用**数组**表示问候 / 聊天（长时间无互动时触发）/
 *      触摸可触发的事件列表，并允许用户直接修改事件列表」。
 *
 * ## ★★ 三条最容易踩的坑（都钉成测例）
 *
 *   - **旧 config 不能被改坏**：旧的 `greeting`（时段→id 映射）与 `standby`（单条 id）
 *     必须与新的 `greet` / `chat` **行为等价** ⇒ A5 / B5 / C2 / D2 专门回归这两种形状。
 *   - **`sameView` 漏比** ⇒ "只改了这一项"不重载 ⇒ 面板上看着改了、实际没生效。
 *     ⇒ F5/F6 逐字段断言"必须判为不同"。
 *   - **`touchFeedbackMode` 的缺省是 `'immediate'`，而它比改动前多一格：**
 *     改动前"触摸 ⊥ 触摸"是 `skip`（第二下点了没反应），现在改成 `play`（打断重播）。
 *     这是**刻意的行为变更**（理由见 `TouchFeedbackMode` 注释），E2 把它钉住，
 *     免得日后有人"顺手改回来"却不知道自己在改用户的选项。
 *
 * ## 与 64 / 65 号脚本的分工
 *
 * 64 验"问候并入触摸池"、65 验"待机触发哪一类"。本脚本验的是**事件列表本身怎么读**
 * 与**有东西在播时点击怎么处置** —— 两者都是新能力，不与前面撞车。
 *
 * ## 测的是真模块，不是复刻
 *
 * 直接 import `src/dialogue.ts` / `src/touch.ts` / `src/settingsStore.ts` 的出货实现。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/67_回归_触摸反馈与问候模式.ts [bundle路径]
 * （路径解析规则见 `_regress/README.md`）
 */

import * as fs from 'fs';

import { Configs, DialogueEntry, DialogueSlotKey } from '../src/config.type';
import {
  hasGreetIds,
  idForSlot,
  normalizeGreetIds,
  pickGreetingEntry,
  resolveChatIds,
  resolveStandbyTouchIds,
  resolveTouchIds,
} from '../src/dialogue';
import { decideAction } from '../src/touch';
import { applyOverrides, readView, sameView } from '../src/settingsStore';

/**
 * 外部路径**不写死本机绝对路径**：命令行参数 > 环境变量 > 仓库内相对缺省。
 * 用法见 `_regress/README.md`。
 */
const BUNDLE = process.argv[2] || process.env.WK_BUNDLE || 'dist/bundle.js';

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

/* ── 测例数据（S9 那张表的前 6 条，故意跨 greet/chat/touch 三类） ── */
const dialogues: DialogueEntry[] = [
  { actionId: 64001, animation: 'greet', text: '早安' },
  { actionId: 64002, animation: 'greet', text: '午安' },
  { actionId: 64003, animation: 'chat', text: '晚安' },
  { actionId: 64004, animation: 'chat', text: '闲聊' },
  { actionId: 64005, animation: 'touch1', text: '触碰1' },
  { actionId: 64006, animation: 'touch2', text: '触碰2' },
];

/** 时段键名的简写 */
type Slots = Partial<Record<DialogueSlotKey, number>>;

/** 造一个指定小时的本地时刻（年份任意，只用小时） */
const at = (hour: number): Date => new Date(2026, 0, 1, hour, 0, 0);

/** 缺省时段分界：morning 5~12 / noon 12~18 / evening 18~次日5 */
const RANGES = {};

/* ── A. 问候列表的归一化（greet 数组 ⇄ 旧 greeting 时段表） ── */
console.log('\nA. normalizeGreetIds：两种形状摊平成同一个数组');
const greetArr = [64001, 64002, 64003];
const greetMap: Slots = { evening: 64003, noon: 64002, morning: 64001 };

eq('A1 数组 ⇒ 原样保序', normalizeGreetIds(greetArr), [64001, 64002, 64003]);
eq(
  'A2 数组里有重复 ⇒ 去重（不会被随机到的概率翻倍）',
  normalizeGreetIds([64001, 64002, 64001]),
  [64001, 64002]
);
eq(
  'A3 ★旧时段表 ⇒ 按 **SLOT_ORDER**（早→中→晚）摊平，与键的书写顺序无关',
  normalizeGreetIds(greetMap),
  [64001, 64002, 64003]
);
eq(
  'A4 旧时段表缺 noon ⇒ 只有两条（缺的就是缺，不补位）',
  normalizeGreetIds({ morning: 64001, evening: 64003 } as Slots),
  [64001, 64003]
);
eq('A5 undefined / 空对象 ⇒ 空数组（不抛）', [normalizeGreetIds(undefined), normalizeGreetIds({})], [[], []]);
eq(
  'A6 hasGreetIds：两种形状都算"有候选"，空 ⇒ false',
  [hasGreetIds(greetArr), hasGreetIds(greetMap), hasGreetIds(undefined)],
  [true, true, false]
);
eq(
  'A7 ★新字段优先：同时给了 greet 与 greeting ⇒ 用数组（index.ts 的读法）',
  normalizeGreetIds(({ greet: greetArr, greeting: greetMap } as unknown as Slots)
    .greet as number[]),
  [64001, 64002, 64003]
);

/* ── B. 问候取条：按系统时间 / 随机 ─────────────────────── */
console.log('\nB. pickGreetingEntry：time 模式按时段、random 模式不看时间');
eq(
  'B1 ★time 模式 08:00 ⇒ 清晨那条（64001）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(8), 'time')?.actionId,
  64001
);
eq(
  'B2 time 模式 13:00 ⇒ 中午那条（64002）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(13), 'time')?.actionId,
  64002
);
eq(
  'B3 time 模式 20:00 ⇒ 傍晚那条（64003，它的动画其实是 chat）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(20), 'time')?.actionId,
  64003
);
eq(
  'B4 ★time 模式 02:00 ⇒ 仍属 evening（跨零点 18→5）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(2), 'time')?.actionId,
  64003
);
eq(
  'B5 ★旧 greeting 时段表 + time 模式 ⇒ 与改动前逐字一致（直接按 key 取，不是按下标）',
  [
    pickGreetingEntry(dialogues, greetMap, RANGES, at(8), 'time')?.actionId,
    pickGreetingEntry(dialogues, greetMap, RANGES, at(20), 'time')?.actionId,
  ],
  [64001, 64003]
);
eq(
  'B6 ★降级：池只有 1 条却在 noon ⇒ 随机到那条（宁可对不上时段，也不静默不播）',
  pickGreetingEntry(dialogues, [64001], RANGES, at(13), 'time')?.actionId,
  64001
);
eq(
  'B7 id 全都不在 dialogues ⇒ null',
  pickGreetingEntry(dialogues, [99999], RANGES, at(8), 'time'),
  null
);
eq(
  'B7b greet 为空 ⇒ null（没配问候就是没有）',
  pickGreetingEntry(dialogues, undefined, RANGES, at(8), 'time'),
  null
);
eq(
  'B8 ★random 模式：注入 random()=0 ⇒ 取**第一条**（与时刻无关：凌晨也是第一条）',
  [
    pickGreetingEntry(dialogues, greetArr, RANGES, at(2), 'random', () => 0)
      ?.actionId,
    pickGreetingEntry(dialogues, greetArr, RANGES, at(13), 'random', () => 0)
      ?.actionId,
  ],
  [64001, 64001]
);
eq(
  'B9 random 模式：注入 random()=0.999 ⇒ 取**最后一条**（夹取，不越界）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(8), 'random', () => 0.999)
    ?.actionId,
  64003
);
eq(
  'B10 ★缺省参数 = time（旧调用方不传 mode 时行为不变）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(20))?.actionId,
  64003
);
eq(
  'B11 idForSlot：数组按下标、旧表按 key（两种形状互不借用）',
  [
    idForSlot(greetArr, 'evening'),
    idForSlot(greetMap, 'evening'),
    idForSlot(greetArr, 'nope' as DialogueSlotKey),
  ],
  [64003, 64003, undefined]
);

/* ── C. 聊天（长时间无互动）池：chat 数组 ⇄ 旧 standby 单条 ── */
console.log('\nC. resolveChatIds / resolveStandbyTouchIds：chat 升级为数组');
eq('C1 ★chat 优先于旧 standby', resolveChatIds([64004], 777), [64004]);
eq('C2 ★chat 没配 ⇒ 退回旧 standby（老 config 行为逐字不变）', resolveChatIds(undefined, 64004), [64004]);
eq('C2b chat 给了空数组 ⇒ 同样退回旧 standby', resolveChatIds([], 64004), [64004]);
eq(
  'C3 ★chat 多条 + touch ⇒ 保序去重，touch 排在后面',
  resolveStandbyTouchIds(undefined, [64005, 64006], [64001, 64004]),
  [64001, 64004, 64005, 64006]
);
eq(
  'C4 ★旧口径回归：standby + touch（65 号脚本 A1 的同款）',
  resolveStandbyTouchIds(64004, [64005, 64006]),
  [64004, 64005, 64006]
);
eq(
  'C5 touch 里再写一次 standby ⇒ 不重复',
  resolveStandbyTouchIds(64004, [64004, 64005]),
  [64004, 64005]
);
eq('C6 什么都没配 ⇒ 空池', resolveStandbyTouchIds(undefined, undefined), []);

/* ── D. 触摸池合并：greetInTouchPool ───────────────────── */
console.log('\nD. resolveTouchIds：问候并入触摸池（数组与旧表两种形状）');
eq(
  'D1 数组形状 + 开关开 ⇒ touch + 整个 greet，保序去重',
  resolveTouchIds([64005], greetArr, true),
  [64005, 64001, 64002, 64003]
);
eq(
  'D2 ★旧时段表形状 ⇒ 同样的结果（64 号脚本的口径继续成立）',
  resolveTouchIds([64005], greetMap, true),
  [64005, 64001, 64002, 64003]
);
eq('D3 开关关（缺省）⇒ 原样返回 touch', resolveTouchIds([64005], greetArr, undefined), [64005]);
eq(
  'D4 greet 里有已在 touch 中的 id ⇒ 不重复追加',
  resolveTouchIds([64005, 64001], greetArr, true),
  [64005, 64001, 64002, 64003]
);

/* ── E. 触摸反馈三模式（touch.decideAction） ────────────── */
console.log('\nE. decideAction：正在播动作时的点击该怎么处理');
eq('E1 空闲（没有在播的）⇒ 三档都是 play', [decideAction(null, 'touch', 'immediate'), decideAction(null, 'touch', 'queue'), decideAction(null, 'touch', 'none')], ['play', 'play', 'play']);
eq(
  'E2 ★immediate（缺省）：触摸 ⊥ 触摸 ⇒ **play**（改动前这里是 skip —— 刻意的变更）',
  decideAction('touch', 'touch', 'immediate'),
  'play'
);
eq('E2b 只传两个参数 ⇒ 同 immediate（旧调用方行为不被悄悄改坏）', decideAction('touch', 'touch'), 'play');
eq('E3 immediate：触摸 打断 greet / standby', [decideAction('greet', 'touch', 'immediate'), decideAction('standby', 'touch', 'immediate')], ['play', 'play']);
eq('E4 ★queue：触摸 ⊥ 任何在播的 ⇒ queue（排到当前这条之后）', [decideAction('touch', 'touch', 'queue'), decideAction('greet', 'touch', 'queue'), decideAction('standby', 'touch', 'queue')], ['queue', 'queue', 'queue']);
eq('E5 ★none：触摸 ⊥ 任何在播的 ⇒ skip（计 skipped，用户点了没反应）', [decideAction('touch', 'touch', 'none'), decideAction('greet', 'touch', 'none')], ['skip', 'skip']);
eq(
  'E6 ★自动触发（greet / standby）**永不打断**也未入队，三档同 ⇒ reject',
  [
    decideAction('touch', 'greet', 'immediate'),
    decideAction('touch', 'greet', 'queue'),
    decideAction('touch', 'greet', 'none'),
    decideAction('greet', 'standby'),
  ],
  ['reject', 'reject', 'reject', 'reject']
);

/* ── F. 面板 → 覆盖层 → 生效配置的链路 ──────────────────── */
console.log('\nF. settingsStore：两个新设置的读写与重载判据');
/** 一份"新口径"的 config：三条列表都是数组 */
const cfgNew = {
  width: 1700,
  height: 750,
  meshes: [],
  subtitle: {
    enabled: true,
    dialogues,
    greet: [64001, 64002, 64003],
    chat: [64004],
    touch: [64005, 64006],
  },
} as unknown as Configs;

const vNew = readView(cfgNew);
eq(
  'F1 ★出厂值：touchFeedbackMode = immediate（新 config 没写该字段）',
  vNew.touchFeedbackMode,
  'immediate'
);
eq('F2 ★出厂值：greetMode = time（没写该字段）', vNew.greetMode, 'time');

const queuedCfg = applyOverrides(cfgNew, {
  touchFeedbackMode: 'queue',
  greetMode: 'random',
});
eq(
  'F3 applyOverrides ⇒ 两个字段都落到 subtitle，且**不就地改原 config**',
  [
    queuedCfg.subtitle.touchFeedbackMode,
    queuedCfg.subtitle.greetMode,
    cfgNew.subtitle.touchFeedbackMode,
  ],
  ['queue', 'random', undefined]
);
eq(
  'F4 readView 读到的是覆盖后的值',
  [readView(queuedCfg).touchFeedbackMode, readView(queuedCfg).greetMode],
  ['queue', 'random']
);
eq(
  'F5 ★同一 patch 里再带 standbyGreetEnabled ⇒ 三个都生效（subtitle 分支没互相吃掉）',
  (() => {
    const o = applyOverrides(cfgNew, {
      touchFeedbackMode: 'none',
      greetMode: 'random',
      standbyGreetEnabled: true,
      standbyIdleSec: 60,
    });
    return [
      o.subtitle.touchFeedbackMode,
      o.subtitle.greetMode,
      o.subtitle.standbyGreetEnabled,
      o.subtitle.standbyIdleMs,
    ];
  })(),
  ['none', 'random', true, 60000]
);

/* sameView：★漏比任何一个 ⇒"只改这项"不重载（静默失效） */
const baseView = readView(cfgNew);
ok('F6 同值 ⇒ sameView = true', sameView(baseView, readView(cfgNew)) === true);
ok(
  'F7 ★只改 touchFeedbackMode（immediate → queue）⇒ 判为"有变化"',
  sameView(baseView, readView(applyOverrides(cfgNew, { touchFeedbackMode: 'queue' }))) === false
);
ok(
  'F8 ★只改 touchFeedbackMode（immediate → none）⇒ 判为"有变化"',
  sameView(baseView, readView(applyOverrides(cfgNew, { touchFeedbackMode: 'none' }))) === false
);
ok(
  'F9 ★只改 greetMode（time → random）⇒ 判为"有变化"',
  sameView(baseView, readView(applyOverrides(cfgNew, { greetMode: 'random' }))) === false
);

/* 向后兼容：旧 config（既没数组也没这两个新字段） */
const cfgOld = {
  width: 1700,
  height: 750,
  meshes: [],
  subtitle: {
    enabled: true,
    dialogues,
    greeting: greetMap,
    standby: 64004,
    touch: [64005, 64006],
  },
} as unknown as Configs;
const vOld = readView(cfgOld);
eq(
  'F10 ★旧 config 缺新字段 ⇒ 回落到 immediate / time（不准 throws、也不准变行为）',
  [vOld.touchFeedbackMode, vOld.greetMode],
  ['immediate', 'time']
);
eq(
  'F11 ★旧 config 的问候/聊天/触摸三张表照旧工作',
  [
    pickGreetingEntry(dialogues, vOld && cfgOld.subtitle.greeting, {}, at(8), vOld.greetMode)
      ?.actionId,
    resolveStandbyTouchIds(cfgOld.subtitle.standby, cfgOld.subtitle.touch),
  ],
  [64001, [64004, 64005, 64006]]
);
eq(
  'F12 非法值 ⇒ 回落到缺省（"面板显示的和实际行为"不会劈叉）',
  (() => {
    const bad = JSON.parse(JSON.stringify(cfgNew)) as Configs;
    bad.subtitle.touchFeedbackMode = 'bogus' as 'none';
    bad.subtitle.greetMode = 'bogus' as 'random';
    const v = readView(bad);
    return [v.touchFeedbackMode, v.greetMode];
  })(),
  ['immediate', 'time']
);

/* ── G. 出货产物：改动必须真的进了 bundle ────────────────── */
console.log('\nG. 出货产物断言（先 npm run build）');
if (!fs.existsSync(BUNDLE)) {
  fail++;
  console.log('  FAIL  bundle 不存在: ' + BUNDLE);
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  // ★ 属性名 / DOM id / 导出名 terser 一定保留；局部函数名会被压掉 ⇒ 只断言这些
  for (const name of [
    'touchFeedbackMode',
    'greetMode',
    'normalizeGreetIds',
    'resolveChatIds',
    'idForSlot',
    'wb-set-touch-feedback',
    'wb-set-greet-mode',
  ]) {
    ok('G  bundle 含属性名 ' + name, src.indexOf(name) >= 0);
  }
  // 面板文案（用户可见）也必须到包 —— 这是"加了这个选项"最直接的证据
  for (const word of ['立即播放新动作', '排进播放队列', '不做任何反馈', '按系统时间', '随机触发']) {
    ok('G  bundle 含面板文案「' + word + '」', src.indexOf(word) >= 0);
  }
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
