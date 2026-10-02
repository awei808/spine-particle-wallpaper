/**
 * 回归：**待机自动触发哪一类事件** + **角色语音音量**（2026-09-30 新增 / 当日修正）。
 *
 * ## 需求
 *
 *   1. 「音乐」tab（原「背景音乐」）+ 新增「角色语音音量」滑块；
 *   2. 「动作」tab 新增 2 个开关：待机过久自动触发 `greet` / `touch` 事件 ——
 *      **共用 `standbyIdleMs` 一个阈值，到点后从已启用类别里随机二选一**（用户拍板）。
 *
 * ## ★★ 当日修正：`chat` → `touch`，且 touch 是**一个池**
 *
 * 用户原话「不是待机过长时间自动触发 greet 事件 / chat 事件，而是触发 greet 事件 /
 * touch 事件」，并明确「**开启待机自动触发 touch 事件后，64004 到 64010 都可触发**」
 * ⇒ `touch` 这一类 = `standby`（休闲待机 64004）**并上** `touch`（点击触摸 64005~64010）
 * 的池，随机取一条。**64004 因此不再固定播放。**
 *
 * 三个最容易踩的坑（都钉成测例）：
 *
 *   - ★★ **两个开关都缺省关**（用户 2026-09-30 最后拍板：touch 从 true 改回 false）。
 *     ⇒ 两个判据**都必须写 `=== true`**；写成 `!== false` 会让缺字段的旧 config
 *       被判成"开"，行为当场变。⇒ C3 / C14 / C15 / C16 都钉住"出厂两类都关"。
 *     ⚠️ 这是**刻意的既有行为变更**：改动前只要配了 `subtitle.standby`，待机到点
 *       一定会自动播 64004；现在出厂不播，要由用户在「动作」页打开。
 *   - **`sameView` 漏比**：漏一个字段 ⇒ "只改了这项"被判成"没变化" ⇒ 不重载 ⇒
 *     面板上看着改了、实际没生效（静默失效）。⇒ C10~C12 逐字段断言"必须判为不同"。
 *   - **`subtitle.audio` 的 spread 基准**：同一个 patch 里既有 `voiceEnabled`
 *     又有 `voiceVolume` 时，必须基于 `out.subtitle.audio` 继续改。⇒ C6/C7。
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

import { Configs, DialogueSlotKey } from '../src/config.type';
import {
  StandbyEventKind,
  hasGreetingSlots,
  resolveStandbyKinds,
  resolveStandbyTouchIds,
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
if (!sub || !sub.dialogues || !sub.greeting || typeof sub.standby !== 'number') {
  console.error(
    'config 缺少 subtitle.{dialogues,greeting,standby}，无法回归: ' + CFG
  );
  process.exit(2);
}

const kinds = (a: StandbyEventKind[]): string => a.join(',');

/* ── A. 「待机触摸」池的 id 列表 ─────────────────────────── */
console.log('\nA. resolveStandbyTouchIds（standby 并上 touch，保序去重）');
eq(
  'A1 真实 config：64004 + 6 条点击触摸 ⇒ 7 条、64004 在**首位**',
  resolveStandbyTouchIds(sub.standby, sub.touch),
  [64004, 64005, 64006, 64007, 64008, 64009, 64010]
);
eq(
  'A2 touch 里再写一次 standby ⇒ 不重复（概率不会翻倍）',
  resolveStandbyTouchIds(64004, [64004, 64005]),
  [64004, 64005]
);
eq(
  'A3 只给 standby ⇒ 单条（想恢复"每次都播 64004"就只配它、清空 touch）',
  resolveStandbyTouchIds(64004, undefined),
  [64004]
);
eq('A4 只给 touch ⇒ 只有池', resolveStandbyTouchIds(undefined, [1, 2]), [1, 2]);
eq('A5 都没有 ⇒ 空', resolveStandbyTouchIds(undefined, undefined), []);
eq(
  'A6 非数字项被跳过（config 无 schema 校验）',
  resolveStandbyTouchIds(64004, [64005, '64006', null] as unknown as number[]),
  [64004, 64005]
);
ok(
  'A7 纯函数：不改动入参数组',
  (() => {
    const arr = [64005, 64006];
    resolveStandbyTouchIds(64004, arr);
    return JSON.stringify(arr) === JSON.stringify([64005, 64006]);
  })()
);
ok(
  'A8 纯函数：返回新数组，改它不影响下次调用',
  (() => {
    const a = resolveStandbyTouchIds(64004, [64005]);
    a.length = 0;
    return resolveStandbyTouchIds(64004, [64005]).length === 2;
  })()
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

/* ── B. 候选类别解析 ─────────────────────────────────────── */
console.log('\nB. resolveStandbyKinds（开关 + 可用性 → 候选类别）');
eq(
  'B1 ★touch 缺省(undefined) + 池非空 ⇒ **空**（出厂不自动播，判据必须是 === true）',
  kinds(resolveStandbyKinds(undefined, undefined, true, true)),
  ''
);
eq(
  'B2 touch 显式 true ⇒ 只有 touch',
  kinds(resolveStandbyKinds(true, undefined, true, true)),
  'touch'
);
eq(
  'B3 touch 关掉 + greet 没开 ⇒ 空（待机不自动播）',
  kinds(resolveStandbyKinds(false, undefined, true, true)),
  ''
);
eq(
  'B4 两个都开 + 都可用 ⇒ greet,touch',
  kinds(resolveStandbyKinds(true, true, true, true)),
  'greet,touch'
);
eq(
  'B5 greet 开了但 config 没配 greeting 时段 ⇒ 只剩 touch',
  kinds(resolveStandbyKinds(true, true, true, false)),
  'touch'
);
eq(
  'B6 touch 开了但池是空的 ⇒ 只剩 greet',
  kinds(resolveStandbyKinds(true, true, false, true)),
  'greet'
);
eq('B7 两个都关 ⇒ 空', kinds(resolveStandbyKinds(false, false, true, true)), '');
eq(
  'B8 可用性都缺 ⇒ 空（哪怕开关都开）',
  kinds(resolveStandbyKinds(true, true, false, false)),
  ''
);
eq(
  'B9 顺序恒为 greet,touch（与传参顺序无关）',
  kinds(resolveStandbyKinds(true, true, true, true)),
  'greet,touch'
);
ok(
  'B10 纯函数：返回值是新数组',
  (() => {
    const a = resolveStandbyKinds(true, true, true, true);
    a.length = 0;
    return resolveStandbyKinds(true, true, true, true).length === 2;
  })()
);

/* ── C. settingsStore 三个新字段的链路 ───────────────────── */
console.log(
  '\nC. 覆盖层链路（voiceVolume / standbyGreetEnabled / standbyTouchEnabled）'
);
const baseView = readView(cfg);
eq('C1 出厂值：voiceVolume = 1（config audio.volume）', baseView.voiceVolume, 1);
eq(
  'C2 出厂值：standbyGreetEnabled = false',
  baseView.standbyGreetEnabled,
  false
);
eq(
  'C3 ★出厂值：standbyTouchEnabled = false（用户 2026-09-30 拍板：touch 出厂关）',
  baseView.standbyTouchEnabled,
  false
);

const withGreet = applyOverrides(cfg, { standbyGreetEnabled: true });
ok(
  'C4 applyOverrides：只开 greet ⇒ 生效值变、且 **不就地改原 config**',
  withGreet.subtitle.standbyGreetEnabled === true &&
    sub.standbyGreetEnabled !== true,
  'cfg.subtitle.standbyGreetEnabled=' + String(sub.standbyGreetEnabled)
);
eq(
  'C5 applyOverrides：只给 voiceVolume ⇒ audio.volume 变、enabled 不动',
  (() => {
    const o = applyOverrides(cfg, { voiceVolume: 0.3 });
    return [o.subtitle.audio.volume, o.subtitle.audio.enabled];
  })(),
  [0.3, sub.audio?.enabled]
);
eq(
  'C6 ★同一 patch 里 voiceEnabled=false + voiceVolume=0.3 ⇒ 两个都要生效',
  (() => {
    const o = applyOverrides(cfg, { voiceEnabled: false, voiceVolume: 0.3 });
    return [o.subtitle.audio.enabled, o.subtitle.audio.volume];
  })(),
  [false, 0.3]
);
eq(
  'C7 ★同一 patch 里 voiceVolume + voiceEnabled=true ⇒ 音量不被 enabled 分支吃掉',
  (() => {
    const o = applyOverrides(cfg, {
      voiceVolume: 0.75,
      voiceEnabled: true,
    } as SettingsOverrides);
    return [o.subtitle.audio.enabled, o.subtitle.audio.volume];
  })(),
  [true, 0.75]
);
eq(
  'C8 ★standby* 与 standbyIdleSec 同 patch：三个都生效（互不覆盖）',
  (() => {
    const o = applyOverrides(cfg, {
      standbyIdleSec: 60,
      standbyGreetEnabled: true,
      standbyTouchEnabled: false,
    });
    return [
      o.subtitle.standbyIdleMs,
      o.subtitle.standbyGreetEnabled,
      o.subtitle.standbyTouchEnabled,
    ];
  })(),
  [60000, true, false]
);

/* sameView：★漏比任何一个 ⇒"只改这项"不重载（静默失效） */
console.log('\nC* sameView：每个新字段都必须能被判出"有变化"');
const v0 = readView(cfg);
ok('C9 同值 ⇒ sameView = true', sameView(v0, readView(cfg)) === true);
ok(
  'C10 ★只改 standbyGreetEnabled ⇒ 判为"有变化"',
  sameView(v0, readView(applyOverrides(cfg, { standbyGreetEnabled: true }))) ===
    false
);
// ★ 出厂是 false ⇒ 必须改成 **true** 才是"有变化"（写成 false 就是没变，会假 FAIL）
ok(
  'C11 ★只改 standbyTouchEnabled（false → true）⇒ 判为"有变化"',
  sameView(v0, readView(applyOverrides(cfg, { standbyTouchEnabled: true }))) ===
    false
);
ok(
  'C12 ★只改 voiceVolume（1% 粒度）⇒ 判为"有变化"',
  sameView(v0, readView(applyOverrides(cfg, { voiceVolume: 0.42 }))) === false
);
ok(
  'C13 音量抖动 0.4% ⇒ 仍判"没变化"（1% 粒度对齐 WE 滑块）',
  sameView(v0, readView(applyOverrides(cfg, { voiceVolume: 1.004 }))) === true
);

/* 向后兼容：旧 config 没有这两个字段 */
const legacy = JSON.parse(JSON.stringify(cfg)) as Configs;
delete legacy.subtitle.standbyGreetEnabled;
delete legacy.subtitle.standbyTouchEnabled;
const lv = readView(legacy);
eq(
  'C14 ★旧 config 缺字段 ⇒ greet 关、touch 也关（缺字段绝不能被判成"开"）',
  [lv.standbyGreetEnabled, lv.standbyTouchEnabled],
  [false, false]
);
eq(
  'C15 ★旧 config（缺两个键）⇒ 候选为空 ⇒ 待机不自动播（出厂静默）',
  kinds(
    resolveStandbyKinds(
      legacy.subtitle.standbyTouchEnabled,
      legacy.subtitle.standbyGreetEnabled,
      true,
      hasGreetingSlots(legacy.subtitle.greeting)
    )
  ),
  ''
);
eq(
  'C16 ★真实 config 出厂 ⇒ 候选为空（两个开关都关）⇒ 待机不自动播',
  kinds(
    resolveStandbyKinds(
      v0.standbyTouchEnabled,
      v0.standbyGreetEnabled,
      true,
      hasGreetingSlots(sub.greeting)
    )
  ),
  ''
);
ok(
  'C17 ★反过来：显式打开 touch 就只播 touch（证明"关"是缺省而不是写死）',
  kinds(
    resolveStandbyKinds(true, false, true, hasGreetingSlots(sub.greeting))
  ) === 'touch'
);
ok(
  'C18 ★反过来：显式打开 greet 就只播 greet',
  kinds(
    resolveStandbyKinds(false, true, true, hasGreetingSlots(sub.greeting))
  ) === 'greet'
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
    'standbyGreetEnabled',
    'standbyTouchEnabled',
    'voiceVolume',
    'resolveStandbyTouchIds',
    'wb-set-voice-volume',
    'wb-set-standby-greet',
    'wb-set-standby-touch',
  ]) {
    ok('D  bundle 含属性名 ' + name, src.indexOf(name) >= 0);
  }
  // ★ 负向：改名必须改干净 —— 旧的 chat 字段名不该再出现在产物里（残留 = 改名没到包）
  ok(
    'D  负向：bundle 里**没有**残留 standbyChatEnabled（改名已到包）',
    src.indexOf('standbyChatEnabled') < 0
  );
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
