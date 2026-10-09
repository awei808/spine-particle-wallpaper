/**
 * 回归：**待机到点可触发的事件（多选）** + **角色语音音量**。
 *
 * ## 需求（2026-10-09 定稿）
 *
 *   「长时间待机可触发的事件」= `chat` / `greet` / `touch` **三选多选**
 *   （`config.subtitle.standbyKinds`），**缺省只开 `chat`**；
 *   `greet` 的取条方式仍由「问候取条方式」（`greetMode`）决定。
 *
 * ## ★★ 为什么缺省是 `['chat']` —— 这一条就是本次修的回归
 *
 * 改动前只要配了 `subtitle.standby`（休闲待机 64004），待机到点**一定**会播它。
 * 2026-09-30 把"待机自动播放"整体挂到两个新布尔开关上（都缺省关）⇒
 * **连这条老行为也没了**：两个开关都不勾，静置再久也不播"原有 chat 事件"。
 * 现在 `chat` 是**缺省就勾着**的一类 ⇒ 行为还原（B1 / C1 / C16 钉住）。
 *
 * ## 四个最容易踩的坑（都钉成测例）
 *
 *   - ★★ **数组口径完全以它为准**：`[]` = 显式全关；但**全是非法值**的数组要
 *     **退回旧口径** —— 拼错一个词不该把"待机自动播"整个关掉（A9 / A10）。
 *   - ★★ **旧口径下 `chat` 恒在**：`standbyGreetEnabled:false` 只表示"别加问候"，
 *     不能把闲聊一起关掉（A4 / C5）。
 *   - ★★ 三类**各有各的池**：池空的类别要被剔除，别把空池也塞进候选（B3 / B4）。
 *   - **`sameView` 必须按内容比**：`readView` 每次都产**新数组**，比引用 ⇒
 *     每次启动都被判成"有变化" ⇒ **白重载一次**（C7）。
 *
 * ## 测的是真模块，不是复刻
 *
 * 直接 import `src/dialogue.ts` 与 `src/settingsStore.ts` 的出货实现。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/65_回归_待机事件选择.ts [bundle路径] [config路径]
 * （路径解析规则见 `_regress/README.md`）
 */

import * as fs from 'fs';

import { Configs, DialogueSlotKey, StandbyEventKind } from '../src/config.type';
import {
  hasGreetingSlots,
  isStandbyEventKind,
  normalizeStandbyKinds,
  resolveStandbyIntent,
  resolveStandbyKinds,
} from '../src/dialogue';
import {
  SettingsOverrides,
  applyOverrides,
  readView,
  sameView,
} from '../src/settingsStore';

/** 时段表是 `Partial` ⇒ 造测例用的短别名 */
type Slots = Partial<Record<DialogueSlotKey, number>>;

/**
 * 外部路径**不写死本机绝对路径**：命令行参数 > 环境变量 > 仓库内相对缺省。
 * 用法见 `_regress/README.md`。
 */
const BUNDLE = process.argv[2] || process.env.WK_BUNDLE || 'dist/bundle.js';
const CFG =
  process.argv[3] || process.env.WK_CONFIG || 'public/assets/config.json';

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

/* ── 读真实 config ────────────────────────────────────────── */
const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')) as Configs;
const sub = cfg.subtitle;
if (
  !sub ||
  !sub.dialogues ||
  !sub.greeting ||
  typeof sub.standby !== 'number'
) {
  console.error(
    'config 缺少 subtitle.{dialogues,greeting,standby}，无法回归: ' + CFG
  );
  process.exit(2);
}

const kinds = (a: StandbyEventKind[]): string => a.join(',');

/** `resolveStandbyKinds` 的调用别名：可用性默认"三类都可用"（多数测例只关心口径） */
const kindsOf = (
  k: unknown,
  greet?: boolean,
  touch?: boolean,
  hasChat = true,
  hasGreet = true,
  hasTouch = true
): StandbyEventKind[] =>
  resolveStandbyKinds(k, greet, touch, hasChat, hasGreet, hasTouch);

/* ── A. 口径摊平：resolveStandbyIntent / normalizeStandbyKinds ────── */
console.log('\nA. resolveStandbyIntent（新多选 / 旧两个布尔 → 意向列表）');

eq(
  'A1 新口径数组：去重 + 按固定顺序 chat→greet→touch 归一',
  resolveStandbyIntent(['touch', 'chat', 'touch'], undefined, undefined),
  ['chat', 'touch']
);
eq(
  'A2 ★新口径给了数组 ⇒ 旧布尔完全不参与（false 也不会被加回来）',
  resolveStandbyIntent(['greet'], false, true),
  ['greet']
);
eq(
  'A3 ★空数组 = 显式全关（不是"没配"）',
  resolveStandbyIntent([], false, false),
  []
);
eq(
  'A4 ★★旧口径（没给数组）：chat **恒在** —— 只勾问候也是 chat+greet',
  resolveStandbyIntent(undefined, true, false),
  ['chat', 'greet']
);
eq(
  'A5 ★★旧口径：两个布尔都 false ⇒ 仍是 chat（这条就是本次回归的修复点）',
  resolveStandbyIntent(undefined, false, false),
  ['chat']
);
eq(
  'A6 旧口径：缺字段（更老的 config）⇒ 同样只有 chat',
  resolveStandbyIntent(undefined, undefined, undefined),
  ['chat']
);
eq(
  'A7 旧口径：两个旧开关都开 ⇒ chat+greet+touch（三类都进来）',
  resolveStandbyIntent(undefined, true, true),
  ['chat', 'greet', 'touch']
);
eq(
  'A8 旧口径：只开 touch ⇒ chat+touch（沿用旧行为：开了 touch 池也含闲聊）',
  resolveStandbyIntent(undefined, false, true),
  ['chat', 'touch']
);
eq(
  'A9 ★数组里夹非法值 ⇒ 静默丢弃，合法的照收',
  resolveStandbyIntent(
    ['Chat', 'chat', null, 3, 'touch'],
    undefined,
    undefined
  ),
  ['chat', 'touch']
);
eq(
  'A10 ★★数组里**一个合法值都没有** ⇒ 当作没配，退回旧口径（不是全关）',
  resolveStandbyIntent(['Chat', 3, null], false, false),
  ['chat']
);
eq(
  'A11 写坏成非数组（字符串）⇒ 退回旧口径',
  resolveStandbyIntent('chat' as unknown, undefined, undefined),
  ['chat']
);
ok(
  'A12 纯函数：不改动入参数组',
  (() => {
    const arr = ['touch', 'chat'];
    resolveStandbyIntent(arr, undefined, undefined);
    return JSON.stringify(arr) === JSON.stringify(['touch', 'chat']);
  })()
);
ok(
  'A13 纯函数：返回新数组，改它不影响下次调用',
  (() => {
    const a = resolveStandbyIntent(['chat'], undefined, undefined);
    a.length = 0;
    return resolveStandbyIntent(['chat'], undefined, undefined).length === 1;
  })()
);
eq('A14 normalizeStandbyKinds：非数组 ⇒ 空', normalizeStandbyKinds('chat'), []);
eq(
  'A15 normalizeStandbyKinds：固定顺序与去重（顺序与入参无关）',
  normalizeStandbyKinds(['touch', 'greet', 'chat', 'chat']),
  ['chat', 'greet', 'touch']
);
eq(
  'A16 isStandbyEventKind：只认三个合法值（大小写敏感，数字/null 都不算）',
  [
    isStandbyEventKind('chat'),
    isStandbyEventKind('Chat'),
    isStandbyEventKind(1),
    isStandbyEventKind('touch'),
  ],
  [true, false, false, true]
);

/* ── A2. 问候时段表的"有没有配"判据 ──────────────────────── */
console.log('\nA2. hasGreetingSlots（决定 greet 这一路可不可用）');
ok('A2.1 undefined ⇒ false', hasGreetingSlots(undefined) === false);
ok('A2.2 空对象 ⇒ false', hasGreetingSlots({}) === false);
ok(
  'A2.3 非数字值（null/字符串）⇒ false',
  hasGreetingSlots({ morning: null, noon: '64002' } as unknown as Slots) ===
    false
);
ok('A2.4 一个时段即可 ⇒ true', hasGreetingSlots({ morning: 64001 }) === true);
ok(
  'A2.5 真实 config 的 greeting ⇒ true（S9 三个时段都配了）',
  hasGreetingSlots(sub.greeting) === true,
  JSON.stringify(sub.greeting)
);

/* ── B. 候选类别解析（口径 + 可用性） ─────────────────────── */
console.log('\nB. resolveStandbyKinds（口径 + 可用性 → 真正会播的类别）');
eq(
  'B1 ★★缺省（没给数组、旧布尔也没开）⇒ 只有 chat（回归修复的正面断言）',
  kinds(kindsOf(undefined, undefined, undefined)),
  'chat'
);
eq(
  'B2 新口径三类全勾 + 都可用 ⇒ 三类、顺序 chat,greet,touch',
  kinds(kindsOf(['chat', 'greet', 'touch'], undefined, undefined)),
  'chat,greet,touch'
);
eq(
  'B3 ★勾了但池空 ⇒ 该类别被剔除（chat 池空 + touch 池有 ⇒ 只剩 touch）',
  kinds(kindsOf(['chat', 'touch'], undefined, undefined, false, true, true)),
  'touch'
);
eq(
  'B4 ★greet 勾了但问候池空 ⇒ 剔除，只剩 chat',
  kinds(kindsOf(['chat', 'greet'], undefined, undefined, true, false, true)),
  'chat'
);
eq(
  'B5 ★★显式空数组 ⇒ 空（哪怕三类都可用；= 关掉待机自动播放）',
  kinds(kindsOf([], true, true)),
  ''
);
eq(
  'B6 ★旧口径 + chat 池空（没配 standby/chat）⇒ 空（配了才播，没配就彻底不播）',
  kinds(kindsOf(undefined, false, false, false, true, true)),
  ''
);
eq(
  'B7 ★旧口径开 greet 但问候池空 ⇒ 只剩 chat（降级而不是整块失效）',
  kinds(kindsOf(undefined, true, false, true, false, true)),
  'chat'
);
eq(
  'B8 ★旧口径开 touch ⇒ chat+touch（旧行为：64004 进池）',
  kinds(kindsOf(undefined, false, true)),
  'chat,touch'
);
eq(
  'B9 顺序恒为 chat,greet,touch（与入参顺序无关）',
  kinds(kindsOf(['touch', 'greet', 'chat'], undefined, undefined)),
  'chat,greet,touch'
);
eq(
  'B10 ★数组全是非法值 ⇒ 退回旧口径（此处旧布尔也都关 ⇒ chat）',
  kinds(kindsOf(['Chat'], false, false)),
  'chat'
);
ok(
  'B11 纯函数：返回新数组',
  (() => {
    const a = kindsOf(undefined, undefined, undefined);
    a.length = 0;
    return kindsOf(undefined, undefined, undefined).length === 1;
  })()
);

/* ── C. 覆盖层链路（standbyKinds / voiceVolume） ───────────── */
console.log('\nC. 覆盖层链路（standbyKinds / voiceVolume）');
const baseView = readView(cfg);
eq(
  'C1 ★★出厂值：standbyKinds = [chat]（真实 config 两个旧布尔都是 false）',
  baseView.standbyKinds,
  ['chat']
);
eq(
  'C2 出厂值：voiceVolume = 1（config audio.volume）',
  baseView.voiceVolume,
  1
);

const withKinds = applyOverrides(cfg, { standbyKinds: ['touch', 'greet'] });
eq(
  'C3 新键优先：覆盖层写 [touch,greet] ⇒ 视图按固定顺序归一为 [greet,touch]',
  readView(withKinds).standbyKinds,
  ['greet', 'touch']
);
ok(
  'C4 ★applyOverrides：不就地改原 config（subtitle.standbyKinds 仍缺席）',
  (cfg.subtitle as { standbyKinds?: unknown }).standbyKinds === undefined
);
ok(
  'C5 ★★旧布尔仍生效（兼容输入）：只写 standbyTouchEnabled=true ⇒ 视图是 chat+touch',
  (() => {
    const v = readView(applyOverrides(cfg, { standbyTouchEnabled: true }));
    return JSON.stringify(v.standbyKinds) === JSON.stringify(['chat', 'touch']);
  })()
);
ok(
  'C6 ★applyOverrides 必须 slice：写完之后改入参数组，不影响 out',
  (() => {
    const arr: StandbyEventKind[] = ['chat'];
    const o = applyOverrides(cfg, { standbyKinds: arr });
    arr.push('touch');
    return JSON.stringify(o.subtitle.standbyKinds) === JSON.stringify(['chat']);
  })()
);
eq(
  'C7 applyOverrides：只给 voiceVolume ⇒ audio.volume 变、enabled 不动',
  (() => {
    const o = applyOverrides(cfg, { voiceVolume: 0.3 });
    return [o.subtitle.audio.volume, o.subtitle.audio.enabled];
  })(),
  [0.3, sub.audio?.enabled]
);
eq(
  'C8 ★standbyKinds 与 standbyIdleSec 同 patch：两个都生效（互不覆盖）',
  (() => {
    const o = applyOverrides(cfg, {
      standbyIdleSec: 60,
      standbyKinds: ['chat', 'touch'],
    });
    return [o.subtitle.standbyIdleMs, readView(o).standbyKinds];
  })(),
  [60000, ['chat', 'touch']]
);

/* sameView：★漏比任何一项 ⇒"只改这项"不重载（静默失效） */
console.log('\nC* sameView：每个字段都必须能被判出"有变化"');
const v0 = readView(cfg);
ok('C9 同值 ⇒ sameView = true', sameView(v0, readView(cfg)) === true);
ok(
  'C10 ★只改 standbyKinds（chat → chat+touch）⇒ 判为"有变化"',
  sameView(
    v0,
    readView(applyOverrides(cfg, { standbyKinds: ['chat', 'touch'] }))
  ) === false
);
ok(
  'C11 ★★内容相同但**数组是不同实例** ⇒ 仍判"没变化"（防每次启动白重载）',
  sameView(
    v0,
    readView(applyOverrides(cfg, { standbyKinds: ['chat'].slice() }))
  ) === true
);
ok(
  'C12 ★只改 voiceVolume（1% 粒度）⇒ 判为"有变化"',
  sameView(v0, readView(applyOverrides(cfg, { voiceVolume: 0.42 }))) === false
);
ok(
  'C13 音量抖动 0.4% ⇒ 仍判"没变化"（1% 粒度对齐 WE 滑块）',
  sameView(v0, readView(applyOverrides(cfg, { voiceVolume: 1.004 }))) === true
);

/* 向后兼容：旧 config 没有这三个字段 */
const legacy = JSON.parse(JSON.stringify(cfg)) as Configs;
delete legacy.subtitle.standbyKinds;
delete legacy.subtitle.standbyGreetEnabled;
delete legacy.subtitle.standbyTouchEnabled;
const lv = readView(legacy);
eq(
  'C14 ★旧 config（三个键都缺）⇒ 视图仍是 [chat]（缺字段绝不能被判成"全关"）',
  lv.standbyKinds,
  ['chat']
);
eq(
  'C15 ★真实 config 出厂 ⇒ 候选就是 chat（不是空！这是与 2026-09-30 行为的唯一差别）',
  kinds(
    resolveStandbyKinds(
      v0.standbyKinds,
      undefined,
      undefined,
      true,
      hasGreetingSlots(sub.greeting),
      true
    )
  ),
  'chat'
);
eq(
  'C16 ★反过来：显式写 [] 才是不播（证明"缺省 chat"不是写死）',
  kinds(
    resolveStandbyKinds(
      [],
      undefined,
      undefined,
      true,
      hasGreetingSlots(sub.greeting),
      true
    )
  ),
  ''
);
ok(
  'C17 ★反过来：显式写 [touch] 就只播 touch（旧布尔不参与）',
  kinds(
    resolveStandbyKinds(
      ['touch'],
      true,
      true,
      true,
      hasGreetingSlots(sub.greeting),
      true
    )
  ) === 'touch'
);

/* ── D. 出货产物：改动必须真的进了 bundle ────────────────── */
console.log('\nD. 出货产物断言（先 npm run build）');
if (!fs.existsSync(BUNDLE)) {
  fail++;
  console.log('  FAIL  bundle 不存在: ' + BUNDLE);
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  // ★ 属性名（DOM id / 对象字段 / 导出名）terser 一定保留；局部函数名会被压掉 ⇒ 只断言这些
  for (const name of [
    'standbyKinds',
    'standbyGreetEnabled',
    'standbyTouchEnabled',
    'voiceVolume',
    'resolveStandbyIntent',
    'normalizeStandbyKinds',
    'wb-set-standby-chat',
    'wb-set-standby-greet',
    'wb-set-standby-touch',
  ]) {
    ok('D  bundle 含属性名 ' + name, src.indexOf(name) >= 0);
  }
  ok(
    'D  负向：bundle 里**没有**已删除的 resolveStandbyTouchIds（拆分干净了）',
    src.indexOf('resolveStandbyTouchIds') < 0
  );
  ok(
    'D  负向：bundle 里**没有**残留 standbyChatEnabled（更早的一次改名已到包）',
    src.indexOf('standbyChatEnabled') < 0
  );
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
