/**
 * 回归：**触摸通道的事件并池**（2026-10-09 由「问候并入触摸池」改写而来）。
 *
 * ## 需求（2026-10-09）
 *
 * 面板「动作」页新增「触摸可触发的事件」（`config.subtitle.touchKinds`），
 * 缺省 `["touch"]`、可勾 chat类 / greet类 / touch类；**勾了多类就把各池并成一个大池**。
 * 旧的布尔 `subtitle.greetInTouchPool`（面板「touch触发greet事件」）**已删除** ——
 * 它的语义由 `touchKinds: ["touch","greet"]` 表达。
 *
 * ## ★★ 本脚本钉的就是"旧开关 = 新勾选"这条等价关系
 *
 *   | 旧写法 | 新写法 |
 *   |---|---|
 *   | `greetInTouchPool: false`（缺省） | `touchKinds: ["touch"]`（缺省） |
 *   | `greetInTouchPool: true` | `touchKinds: ["touch", "greet"]` |
 *
 * 等价性靠**同一套事实**保证：旧实现是把问候池的 id 追加进触摸池、再在整个大池里随机，
 * 而且**同一条 id 不重复追加**（否则某条被随机到的概率会翻倍）。新实现
 * `dialogue.mergeKindPools` 同样是"逐类拼接 + 按 actionId 去重" ⇒ **池子内容逐条相同**。
 *
 * ⚠️ 只有**池内顺序**不同：旧实现是"touch 在前、greet 追加在后"，新实现一律按
 * `chat`→`greet`→`touch` 归一出池（B2 钉住这件事）。均匀随机下概率分布完全相同
 * —— 顺序只影响归档面板的列举次序；按固定顺序归一的好处是"同一组勾选永远同一个池"。
 *
 * ## 测的是真模块，不是复刻
 *
 * 直接 import `src/dialogue.ts` 的 `mergeKindPools` / `resolveTouchIds` / `buildPool`——
 * 与出货代码同一份实现（`--transpile-only` 只跳过类型检查，不改变逻辑）。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/64_回归_触摸通道并池.ts [bundle路径] [config路径]
 * （路径解析规则见 `_regress/README.md`）
 */

import * as fs from 'fs';

import { Configs, DialogueEntry, TriggerEventKind } from '../src/config.type';
import { buildPool, mergeKindPools, resolveTouchIds } from '../src/dialogue';

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
if (!sub || !sub.dialogues || !sub.touch || !sub.greeting) {
  console.error(
    'config 缺少 subtitle.{dialogues,touch,greeting}，无法回归: ' + CFG
  );
  process.exit(2);
}
const dialogues = sub.dialogues;

/** 造测例用的假条目（只需要 actionId，`mergeKindPools` 不碰别的字段） */
const mk = (id: number): DialogueEntry => ({ actionId: id } as DialogueEntry);
const ids = (pool: DialogueEntry[]): number[] => pool.map((e) => e.actionId);

/* ── A. resolveTouchIds：只去重，不再知道问候池 ───────────── */
console.log('\nA. resolveTouchIds（归一 touch 数组：去重保序）');
eq('A1 原样返回（保序）', resolveTouchIds(sub.touch), sub.touch.slice());
eq(
  'A2 配重复了 ⇒ 去重（否则某条概率翻倍）',
  resolveTouchIds([64005, 64005, 64006]),
  [64005, 64006]
);
eq(
  'A3 非数字值 ⇒ 丢弃',
  resolveTouchIds([64005, null, '64006'] as unknown as number[]),
  [64005]
);
eq('A4 没配 ⇒ 空', resolveTouchIds(undefined), []);
eq('A5 空数组 ⇒ 空', resolveTouchIds([]), []);
ok(
  'A6 纯函数：不改动入参数组',
  (() => {
    const arr = [64005, 64006];
    resolveTouchIds(arr);
    return JSON.stringify(arr) === JSON.stringify([64005, 64006]);
  })()
);
/**
 * ★ 旧实现的第三参（问候并入）已删除 —— 用**类型层面**钉住这件事：
 * 函数只声明了一个形参，多传的参数被忽略 ⇒ 不会再有"悄悄并入问候"的老行为。
 */
eq(
  'A7 ★旧第三参已失效：多传两个参数不再并入问候',
  (resolveTouchIds as unknown as (...a: unknown[]) => number[])(
    [64005],
    { morning: 64001 },
    true
  ),
  [64005]
);

/* ── B. mergeKindPools：并池的口径 ────────────────────────── */
console.log('\nB. mergeKindPools（勾中的类 → 一个大池）');
const POOLS: Record<TriggerEventKind, DialogueEntry[]> = {
  chat: [mk(64004)],
  greet: [mk(64001), mk(64002), mk(64003)],
  touch: [mk(64005), mk(64006), mk(64007)],
};

eq(
  'B1 ★缺省（只勾 touch）⇒ 池 = touch，与旧 greetInTouchPool=false 一致',
  ids(mergeKindPools(['touch'], POOLS)),
  [64005, 64006, 64007]
);
eq(
  'B2 ★★勾 touch+greet ⇒ 内容 = touch + greet 的全部条目（= 旧 greetInTouchPool=true）',
  ids(mergeKindPools(['touch', 'greet'], POOLS))
    .slice()
    .sort((a, b) => a - b),
  [64001, 64002, 64003, 64005, 64006, 64007]
);
eq(
  'B2b ⚠池内顺序按 chat→greet→touch 归一（与旧实现的"追加到末尾"不同，概率分布相同）',
  ids(mergeKindPools(['touch', 'greet'], POOLS)),
  [64001, 64002, 64003, 64005, 64006, 64007]
);
eq(
  'B3 顺序恒为 chat→greet→touch（与入参顺序无关）',
  ids(mergeKindPools(['touch', 'chat', 'greet'], POOLS)),
  [64004, 64001, 64002, 64003, 64005, 64006, 64007]
);
eq(
  'B4 ★同一条 id 出现在两个池里 ⇒ 只收一次（旧实现同一口径）',
  ids(
    mergeKindPools(['touch', 'greet'], {
      chat: [],
      greet: [mk(64005), mk(64001)],
      touch: [mk(64005)],
    })
  ),
  [64005, 64001]
);
eq('B5 一类都不勾 ⇒ 空池', ids(mergeKindPools([], POOLS)), []);
eq(
  'B6 池空的那一类被勾了也不影响（贡献 0 条）',
  ids(
    mergeKindPools(['chat', 'touch'], {
      chat: [],
      greet: [],
      touch: POOLS.touch,
    })
  ),
  [64005, 64006, 64007]
);
ok(
  'B7 纯函数：不改动入参数组，也不改池',
  (() => {
    const kinds: TriggerEventKind[] = ['touch', 'greet'];
    const before = JSON.stringify(kinds);
    const out = mergeKindPools(kinds, POOLS);
    out.length = 0;
    return (
      JSON.stringify(kinds) === before &&
      POOLS.touch.length === 3 &&
      POOLS.greet.length === 3
    );
  })()
);

/* ── C. 池构造（buildPool 端到端，用真实 config） ─────────── */
console.log('\nC. 池构造：id 列表 → 条目池（真实 config）');
const touchPool = buildPool(dialogues, resolveTouchIds(sub.touch));
const greetIds = [
  sub.greeting?.morning,
  sub.greeting?.noon,
  sub.greeting?.evening,
].filter((n): n is number => typeof n === 'number');
const greetPool = buildPool(dialogues, greetIds);

const poolOnly = mergeKindPools(['touch'], {
  chat: [],
  greet: greetPool,
  touch: touchPool,
});
const poolMerged = mergeKindPools(['touch', 'greet'], {
  chat: [],
  greet: greetPool,
  touch: touchPool,
});

eq('C1 只勾 touch：池长 = touch 宽度', poolOnly.length, sub.touch.length);
eq(
  'C2 勾 touch+greet：池长 = touch + 问候池条数',
  poolMerged.length,
  sub.touch.length + greetIds.length
);
eq(
  'C3 头部 = 问候池那几条（按 SLOT_ORDER 顺序，归一出池排在 touch 之前）',
  ids(poolMerged.slice(0, greetIds.length)),
  greetIds
);
ok(
  'C4 池里每条都是 dialogues 里的同一对象（动作与字幕同源）',
  poolMerged.every((e) => dialogues.indexOf(e) >= 0),
  '有非源表条目'
);
const mergedIds = ids(poolMerged);
ok(
  'C5 池里无重复 actionId（否则某条被随机到的概率翻倍）',
  new Set(mergedIds).size === mergedIds.length,
  JSON.stringify(mergedIds)
);
eq(
  'C6 id 指向不存在的条目 ⇒ 静默跳过（沿用 buildPool 兜底）',
  ids(buildPool(dialogues, resolveTouchIds([64005, 999999]))),
  [64005]
);

/* ── D. 出货产物：旧开关必须真的从包里消失 ────────────────── */
console.log('\nD. 出货产物断言（先 npm run build）');
if (!fs.existsSync(BUNDLE)) {
  fail++;
  console.log('  FAIL  bundle 不存在: ' + BUNDLE);
} else {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  // ★ 属性名（DOM/对象字段）terser 一定保留；局部函数名可能被压缩 ⇒ 只断言这些
  ok('D1 bundle 含属性名 touchKinds', src.indexOf('touchKinds') >= 0);
  ok('D2 bundle 含并池函数 mergeKindPools', src.indexOf('mergeKindPools') >= 0);
  ok(
    'D3 ★★负向：bundle 里**没有**已删除的 greetInTouchPool',
    src.indexOf('greetInTouchPool') < 0
  );
  ok(
    'D4 ★★负向：bundle 里**没有**已删除的旧开关 DOM 锚点 wb-set-greetpool',
    src.indexOf('wb-set-greetpool') < 0
  );
  ok(
    'D5 不改动既有导出（buildPool 仍在）',
    src.indexOf('buildPool') >= 0,
    '若失败说明构建被回退/换错了产物'
  );
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
