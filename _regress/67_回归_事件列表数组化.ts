/**
 * 回归：**三条事件列表统一成数组**（greet / chat / touch，2026-10-08）。
 *
 * ## 需求（用户 2026-10-08）
 *
 *   「在 config.json 文件里用**数组**表示问候 / 聊天（长时间无互动时触发）/
 *     触摸可触发的事件列表，并允许用户直接修改事件列表」。
 *
 * ## ★★ 三条最容易踩的坑（都钉成测例）
 *
 *   - **旧 config 不能被改坏**：旧的 `greeting`（时段→id 映射）与 `standby`（单条 id）
 *     必须与新的 `greet` / `chat` **行为等价** ⇒ A3 / B4 / C2 / D2 专门回归这两种形状。
 *   - **数组顺序就是时段顺序**：`greet` 的第 1/2/3 条分别对应清晨/中午/傍晚，
 *     与那时段表摊平过来的结果必须一致（A3 + B1/B2/B3 一起钉住）。
 *   - **池不足 3 条 / 顺序对不上时不能静默不播**：按时取不到 ⇒ 降级为池内随机（B6）。
 *
 * ## 与 64 / 65 号脚本的分工
 *
 * 64 验"问候并入触摸池"、65 验"待机触发哪一类"。本脚本验的是**事件列表本身怎么读**
 * —— 它是 67/68 那批里唯一不碰播放行为的一支（纯选取 + 配置链路）。
 *
 * ## 测的是真模块，不是复刻
 *
 * 直接 import `src/dialogue.ts` 的出货实现。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/67_回归_事件列表数组化.ts [bundle路径]
 * （路径解析规则见 `_regress/README.md`）
 */

import * as fs from 'fs';

import { DialogueEntry, DialogueSlotKey } from '../src/config.type';
import {
  hasGreetIds,
  idForSlot,
  normalizeGreetIds,
  pickGreetingEntry,
  resolveChatIds,
  resolveStandbyTouchIds,
  resolveTouchIds,
} from '../src/dialogue';

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
eq(
  'A5 undefined / 空对象 ⇒ 空数组（不抛）',
  [normalizeGreetIds(undefined), normalizeGreetIds({})],
  [[], []]
);
eq(
  'A6 hasGreetIds：两种形状都算"有候选"，空 ⇒ false',
  [hasGreetIds(greetArr), hasGreetIds(greetMap), hasGreetIds(undefined)],
  [true, true, false]
);

/* ── B. 问候取条：按时段（数组按下标、旧表按 key） ─────── */
console.log('\nB. pickGreetingEntry：两种形状都按时段取，且能降级');
eq(
  'B1 ★数组 08:00 ⇒ 清晨那条（64001 = greet）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(8))?.actionId,
  64001
);
eq(
  'B2 数组 13:00 ⇒ 中午那条（64002）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(13))?.actionId,
  64002
);
eq(
  'B3 数组 20:00 ⇒ 傍晚那条（64003，它的动画其实是 chat）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(20))?.actionId,
  64003
);
eq(
  'B4 ★数组 02:00 ⇒ 仍属 evening（跨零点 18→5）',
  pickGreetingEntry(dialogues, greetArr, RANGES, at(2))?.actionId,
  64003
);
eq(
  'B5 ★旧 greeting 时段表 ⇒ 与改动前逐字一致（直接按 key 取，不是按下标）',
  [
    pickGreetingEntry(dialogues, greetMap, RANGES, at(8))?.actionId,
    pickGreetingEntry(dialogues, greetMap, RANGES, at(20))?.actionId,
  ],
  [64001, 64003]
);
eq(
  'B6 ★降级：池只有 1 条却在 noon ⇒ 仍然播得到（宁可对不上时段，也不静默不播）',
  pickGreetingEntry(dialogues, [64001], RANGES, at(13))?.actionId,
  64001
);
eq(
  'B7 id 全都不在 dialogues ⇒ null',
  pickGreetingEntry(dialogues, [99999], RANGES, at(8)),
  null
);
eq(
  'B7b greet 为空 ⇒ null（没配问候就是没有）',
  pickGreetingEntry(dialogues, undefined, RANGES, at(8)),
  null
);
eq(
  'B8 idForSlot：数组按下标、旧表按 key（两种形状互不借用）',
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
eq(
  'C2 ★chat 没配 ⇒ 退回旧 standby（老 config 行为逐字不变）',
  resolveChatIds(undefined, 64004),
  [64004]
);
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
eq(
  'D3 开关关（缺省）⇒ 原样返回 touch',
  resolveTouchIds([64005], greetArr, undefined),
  [64005]
);
eq(
  'D4 greet 里有已在 touch 中的 id ⇒ 不重复追加',
  resolveTouchIds([64005, 64001], greetArr, true),
  [64005, 64001, 64002, 64003]
);

/* ── E. 出货产物：改动必须真的进了 bundle ────────────────── */
console.log('\nE. 出货产物断言（先 npm run build）');
if (!fs.existsSync(BUNDLE)) {
  fail++;
  console.log('  FAIL  bundle 不存在: ' + BUNDLE);
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  // ★ 属性名 / DOM id / 导出名 terser 一定保留；局部函数名会被压掉 ⇒ 只断言这些
  for (const name of ['normalizeGreetIds', 'resolveChatIds', 'idForSlot']) {
    ok('E  bundle 含导出名 ' + name, src.indexOf(name) >= 0);
  }
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
