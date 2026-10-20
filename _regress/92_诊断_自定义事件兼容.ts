// 回归 92：**自定义事件 × 事件相关子系统**的兼容性（2026-10-20 修复后）
//
// 跑法（仓库根目录，不需要浏览器；需要 `public/assets/events.jsonc`）：
//   npx ts-node --transpile-only _regress/92_诊断_自定义事件兼容.ts
//
// ## 这个脚本的两副面孔
//
// 修复**前**它是"诊断"：13 项 PASS = 13 个缺陷复现成功（见
// `docx/RESEARCH_自定义事件兼容性_2026-10-20.md`）。
// 修复**后**它是"回归"：断言全部翻到正确一侧 —— 现在 PASS 才代表"行为对"。
//
// 验的是"消费方是否还假设 `actionId` 一定存在"：
//   A. 事件表里自定义条目确实没有 `actionId`（根因前提，不是缺陷）；
//   B. 调试面板的候选映射（index.ts 的 `events:` + 面板 chip 文案 / DOM id）；
//   C. 调试面板的回调（按 `EventKey` 查表）；
//   D. 常驻序列的 `isActionAllowed`（`index.ts` 归一再比）；
//   E. 常驻序列项的**往返**（`readView` → 保存 → `applyOverrides` 不丢 `{key}` 项）。
//
// ★ 全部走真实函数（`normalizeEventTable` / `findByEventKey` / `resolveSequence` /
//   `readView` / `applyOverrides`）；只对"面板内部表达式"做复刻，且注明来源。
import * as fs from 'fs';
import * as path from 'path';
import { Configs } from '../src/config.type';
import { findByEventKey } from '../src/dialogue';
import { parseEventsFile } from '../src/eventsFile';
import {
  eventKeyOf,
  normalizeEventKey,
  normalizeEventTable,
} from '../src/eventModel';
import { resolveSequence } from '../src/idleSequence';
import { applyOverrides, readView } from '../src/settingsStore';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, detail = ''): void => {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '  ← ' + detail : ''));
  }
};
const info = (label: string, v: unknown): void =>
  console.log('  ·  ' + label + ' = ' + JSON.stringify(v));

/* ── 真素材：public/assets/events.jsonc ─────────────────────── */

const file = path.resolve(__dirname, '../public/assets/events.jsonc');
const parsed = parseEventsFile(fs.readFileSync(file, 'utf8'));
const { events: table } = normalizeEventTable(parsed.events ?? []);

const custom = table.filter((e) => eventKeyOf(e).indexOf('custom:') === 0);
const builtin = table.filter((e) => eventKeyOf(e).indexOf('game:') === 0);

console.log(
  '\nA. 事件表（' + table.length + ' 条，自定义 ' + custom.length + ' 条）'
);
ok('A1 表里有自定义事件', custom.length > 0);
ok(
  'A2 自定义条目没有 actionId（所以按 actionId 定位的消费方必然失手）',
  custom.every((e) => typeof e.actionId !== 'number')
);
ok(
  'A3 内置条目有 actionId',
  builtin.every((e) => typeof e.actionId === 'number')
);

/* ── B. 调试面板「触发事件」的候选映射 ─────────────────────── */

console.log(
  '\nB. 调试面板「触发事件」候选（index.ts `events:` + settingsPanel chip）'
);

/**
 * index.ts —— `activeDialogues.map(d => ({ key: eventKeyOf(d),
 *   name: d.displayName || d.label || eventKeyOf(d), actionId: d.actionId, animation: d.animation }))`
 */
const candidates = table.map((d) => ({
  key: eventKeyOf(d),
  name: d.displayName || d.label || eventKeyOf(d),
  actionId: d.actionId,
  animation: d.animation,
}));
/** settingsPanel —— `id = 'wb-debug-ev-' + domKey(key)`、`text = name || key` */
const domKey = (k: string): string => k.replace(/[^a-zA-Z0-9_-]/g, '_');
const chips = candidates.map((e) => ({
  id: 'wb-debug-ev-' + domKey(e.key),
  text: e.name || e.key,
  key: e.key,
}));

const ids = chips.map((c) => c.id);
info('chip 总数', chips.length);
info('唯一 DOM id 数', new Set(ids).size);
ok(
  'B1 没有任何 chip 显示 undefined',
  chips.every((c) => c.text !== 'undefined' && !!c.text)
);
ok(
  'B2 DOM id 全局唯一（此前多条自定义事件共用 wb-debug-ev-undefined）',
  new Set(ids).size === ids.length
);
ok(
  'B3 自定义事件的 chip 文案是 displayName',
  custom.every((e) =>
    chips.some(
      (c) =>
        c.key === eventKeyOf(e) && c.text === (e.displayName || eventKeyOf(e))
    )
  )
);
ok(
  'B4 内置事件的 chip 文案仍是官方动作名（老观感不变）',
  builtin.every((e) =>
    chips.some((c) => c.key === eventKeyOf(e) && c.text === (e.label || eventKeyOf(e)))
  )
);

/* ── C. 调试面板「触发事件」的回调 ─────────────────────────── */

console.log('\nC. 点击 chip ⇒ onTriggerEvent(key) ⇒ findByEventKey');

/** index.ts —— `const entry = findByEventKey(phasedDialogues, key)`（此处 phased ≡ table） */
const trigger = (key: string) => findByEventKey(table, key);

const customChip = chips.filter((c) => c.key.indexOf('custom:') === 0)[0];
const hit = trigger(customChip.key);
ok('C1 自定义事件能查到条目', hit !== null);
ok('C2 查到的就是那一条（键一致）', !!hit && eventKeyOf(hit) === customChip.key);
ok(
  'C3 内置事件的字符串/纯数字两种写法都能查到',
  trigger('game:64005') !== null && trigger('64005') !== null
);

/* ── D. 常驻序列的闸门判定 ─────────────────────────────────── */

console.log('\nD. 常驻序列 isActionAllowed（index.ts 归一再比）');

/** index.ts —— `const key = normalizeEventKey(id); phased.some(d => eventKeyOf(d) === key)` */
const isActionAllowed = (id: unknown): boolean => {
  const key = normalizeEventKey(id);
  return !!key && table.some((d) => eventKeyOf(d) === key);
};

const seq = resolveSequence(
  {
    enabled: true,
    items: [
      { key: 'game:64005' } as never,
      { key: 'custom:hold-hand' } as never,
      { actionId: 64005 } as never,
      { animation: 'chat' } as never,
    ],
    gapMs: 1000,
  },
  {
    availableAnimations: ['chat', 'greet', 'touch1', 'touch2', 'touch3'],
    entries: table,
    isActionAllowed,
  }
);

info(
  'resolveSequence 结果（期望 4 条）',
  seq.map((s) => s.animation + (s.entry ? '(' + eventKeyOf(s.entry) + ')' : ''))
);
ok('D1 4 项全部通过（没有"所属事件族未勾选"误杀）', seq.length === 4);
ok(
  'D2 `{key:"custom:..."}` 也进了序列',
  seq.some((s) => !!s.entry && eventKeyOf(s.entry) === 'custom:hold-hand')
);
ok(
  'D3 裸动画名不受影响',
  seq.some((s) => !s.entry && s.animation === 'chat')
);

/* ── E. 常驻序列项往返（面板保存不得丢数据） ───────────────── */

console.log('\nE. 序列项往返（readView → 保存 → applyOverrides）');

const baseItems = [
  'chat',
  { key: 'custom:hold-hand' },
  { actionId: 64005 },
  { animation: 'touch2' },
];
const baseCfg = {
  idleSequence: { enabled: false, gapMs: 0, items: baseItems },
} as unknown as Configs;

const view = readView(baseCfg);
info('readView().idleSequenceItems', view.idleSequenceItems);

/** 模拟"用户什么都没改、直接点保存"：把 view 原样下发 */
const saved = applyOverrides(baseCfg, {
  idleSequenceItems: view.idleSequenceItems,
  idleSequenceEnabled: false,
  idleSequenceGapMs: 0,
});
const items = (saved.idleSequence?.items ?? []) as unknown[];
info('保存后的 items', items);

ok(
  'E1 `{key}` 项原样保留（此前被折成空串后整条消失）',
  items.some(
    (it) =>
      !!it &&
      typeof it === 'object' &&
      (it as { key?: string }).key === 'custom:hold-hand'
  )
);
ok(
  'E2 `{actionId}` 项原样保留',
  items.some(
    (it) =>
      !!it &&
      typeof it === 'object' &&
      (it as { actionId?: number }).actionId === 64005
  )
);
ok(
  'E3 裸动画名仍然是字符串',
  items.filter((it) => typeof it === 'string').length === 2
);
ok(
  'E4 项数与顺序不变（`{animation}` 会归一成裸字符串，语义等价）',
  items.length === baseItems.length &&
    JSON.stringify(items.slice(0, 3)) === JSON.stringify(baseItems.slice(0, 3)) &&
    items[3] === 'touch2'
);

/* ── 汇总 ──────────────────────────────────────────────────── */

console.log('\n合计：' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
