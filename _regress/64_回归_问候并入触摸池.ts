/**
 * 回归：**「问候」并入触摸池**（`subtitle.greetInTouchPool`，2026-09-29 新增）。
 *
 * ## 为什么要有这个
 *
 * 需求 = "允许用户选择是否把 greet 打招呼语音及对应动作加入随机触摸事件池"。
 * 口径（2026-09-29 用户确认）= **只要某条目本来就是被当作打招呼触发的，就一并并入**
 * —— 所以并入范围**不是写死 64001/64002**，而是 `subtitle.greeting` 时段表里的
 * 全部 actionId；S9 的 `evening`(64003) 动作是 `chat` 而非 `greet`，**照样收**。
 *
 * 这条"晚间动作是 chat"是**资源事实**，容易被后人误以为"入池的必然都是 greet 动作"
 * ⇒ 这里把它钉成测例（C3），改了资源/口径会立刻红。
 *
 * ## 测的是真模块，不是复刻
 *
 * 直接 import `src/dialogue.ts` 的 `resolveTouchIds` / `buildPool`——
 * 与出货代码同一份实现（`--transpile-only` 只跳过类型检查，不改变逻辑）。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/64_回归_问候并入触摸池.ts [bundle路径] [config路径]
 * （路径解析规则见 `_regress/README.md`）
 */

import * as fs from 'fs';

import { Configs, DialogueEntry, DialogueSlotKey } from '../src/config.type';
import { buildPool, resolveTouchIds } from '../src/dialogue';

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
    console.log('  FAIL  ' + name + '\n          got = ' + a + '\n          want= ' + b);
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
if (!sub || !sub.dialogues || !sub.touch || !sub.greeting) {
  console.error('config 缺少 subtitle.{dialogues,touch,greeting}，无法回归: ' + CFG);
  process.exit(2);
}
const dialogues = sub.dialogues;

/* ── A. 关（缺省）⇒ 不新增 ───────────────────────────────── */
console.log('\nA. 开关关闭 / 缺省：行为必须与改动前完全一致');
eq('A1 开关 undefined ⇒ 原样', resolveTouchIds(sub.touch, sub.greeting, undefined), sub.touch);
eq('A2 开关 false ⇒ 原样', resolveTouchIds(sub.touch, sub.greeting, false), sub.touch);
eq('A3 touch 为空且开关关 ⇒ 空', resolveTouchIds(undefined, sub.greeting, false), []);
eq('A4 两边都缺且开关开 ⇒ 空', resolveTouchIds(undefined, undefined, true), []);
ok(
  'A5 原数组未被就地改写（纯函数）',
  JSON.stringify(sub.touch) === JSON.stringify([64005, 64006, 64007, 64008, 64009, 64010]),
  'touch = ' + JSON.stringify(sub.touch)
);

/* ── B. 开 ⇒ 按 SLOT_ORDER 追加、去重、容错 ───────────────── */
console.log('\nB. 开关打开：追加问候时段表里的全部 id');
eq(
  'B1 真实 config ⇒ touch 尾部追加 64001/64002/64003',
  resolveTouchIds(sub.touch, sub.greeting, true),
  [64005, 64006, 64007, 64008, 64009, 64010, 64001, 64002, 64003]
);
eq(
  'B2 已存在的 id 不重复追加（保序）',
  resolveTouchIds([64002, 64005], { morning: 64001, noon: 64002, evening: 64003 }, true),
  [64002, 64005, 64001, 64003]
);
eq(
  'B3 时段值非数字 ⇒ 跳过（greeting 是 Partial）',
  resolveTouchIds([], { morning: 64001 } as Slots, true),
  [64001]
);
eq(
  'B4 追加顺序恒为 SLOT_ORDER（morning→noon→evening），与对象键序无关',
  resolveTouchIds([], { evening: 3, morning: 1, noon: 2 } as Slots, true),
  [1, 2, 3]
);

/* ── C. 池构造（buildPool 端到端） ────────────────────────── */
console.log('\nC. 池构造：id 列表 → 条目池');
const poolOff = buildPool(dialogues, resolveTouchIds(sub.touch, sub.greeting, false));
const poolOn = buildPool(dialogues, resolveTouchIds(sub.touch, sub.greeting, true));
eq('C1 关：池长 = touch 宽度', poolOff.length, sub.touch.length);
eq('C2 开：池长 = touch + 3 个时段', poolOn.length, sub.touch.length + 3);
const last3 = poolOn.slice(-3).map((e: DialogueEntry) => [e.actionId, e.animation]);
eq(
  'C3 尾部三条 = 64001/greet、64002/greet、64003/chat（晚间动作是 chat，资源事实）',
  last3,
  [
    [64001, 'greet'],
    [64002, 'greet'],
    [64003, 'chat'],
  ]
);
ok(
  'C4 池里每条都是 dialogues 里的同一对象（动作与字幕同源）',
  poolOn.every((e) => dialogues.indexOf(e) >= 0),
  '有非源表条目'
);
const onIds = poolOn.map((e) => e.actionId);
ok(
  'C5 池里无重复 actionId（否则某条被随机到的概率翻倍）',
  new Set(onIds).size === onIds.length,
  JSON.stringify(onIds)
);
eq(
  'C6 id 指向不存在的条目 ⇒ 静默跳过（沿用 buildPool 兜底）',
  buildPool(dialogues, resolveTouchIds([64005], { morning: 999999 } as Slots, true)).map(
    (e) => e.actionId
  ),
  [64005]
);

/* ── D. 出货产物：改动必须真的进了 bundle ────────────────── */
console.log('\nD. 出货产物断言（先 npm run build）');
if (!fs.existsSync(BUNDLE)) {
  fail++;
  console.log('  FAIL  bundle 不存在: ' + BUNDLE);
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  ok('D1 bundle 含导出 resolveTouchIds', src.indexOf('resolveTouchIds') >= 0);
  ok('D2 bundle 含属性名 greetInTouchPool', src.indexOf('greetInTouchPool') >= 0);
  // ★ 属性名（DOM/对象字段）terser 一定保留；局部函数名可能被压缩 ⇒ 上面两个才是可靠判据
  ok(
    'D3 不改动既有导出（buildPool 仍在）',
    src.indexOf('buildPool') >= 0,
    '若失败说明构建被回退/换错了产物'
  );
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
