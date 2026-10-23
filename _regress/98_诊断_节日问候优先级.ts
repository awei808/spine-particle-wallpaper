// 诊断 98：**节日问候在「回到壁纸」通道的第一次触发**是否稳定命中
//
// 跑法（仓库根目录）：
//   npx ts-node --transpile-only _regress/98_诊断_节日问候优先级.ts
//
// 用**真实工程的事件表 + 真实漏斗**（不加任何测试用简化），注入 now =
// 2-14 / 12-25 / 1-1，检查「第一个 tick」选出的是不是节日条目；
// 再分别叠加几种运行时状态（当日配额已用 / lastAt 在未来），定位是哪一层在拦。
import * as fs from 'fs';
import * as path from 'path';
import { DialogueEntry } from '../src/config.type';
import { parseEventsFile } from '../src/eventsFile';
import { normalizeEventTable } from '../src/eventModel';
import { collectCandidates, createEventLog, selectEvent } from '../src/eventScheduler';

const PROJ =
  'D:/SteamLibrary/steamapps/common/wallpaper_engine/projects/myprojects/星见亚砂-盛夏游乐场9.21';
const EVENTS = path.join(PROJ, 'assets', 'events.jsonc');

const text = fs.readFileSync(EVENTS, 'utf8');
const parsed = parseEventsFile(text);
if (!parsed.ok) {
  console.error('events.jsonc 解析失败：' + parsed.error);
  process.exit(1);
}
const table: DialogueEntry[] = normalizeEventTable(parsed.events, { legacy: {} }).events;

/** 本地时间构造（与运行时 `new Date()` 同时区口径） */
const at = (y: number, m: number, d: number, h = 10): Date =>
  new Date(y, m - 1, d, h, 0, 0, 0);

const fmt = (e: DialogueEntry | null): string =>
  e ? (e.displayName || e.label || e.id || '(无 id)') + ' [' + e.id + ']' : '(无)';

/** 一次完整的「第一次问候」：干净日志 + 一个 tick */
const first = (now: Date, log = createEventLog(null)): DialogueEntry | null => {
  log.beginTick();
  const ready = collectCandidates(table, {
    channel: 'resume',
    kinds: ['greet'],
    ctx: { signal: 'boot' },
    now,
    log,
  });
  return selectEvent(ready, () => 0.5); // 固定随机源，便于对照
};

const dates: Array<[string, Date]> = [
  ['02-14', at(2026, 2, 14)],
  ['12-25', at(2026, 12, 25)],
  ['01-01', at(2026, 1, 1)],
];

console.log('事件表：%d 条（来自 %s）\n', table.length, EVENTS);

let bad = 0;
dates.forEach(([label, now]) => {
  const picked = first(now);
  const ready = collectCandidates(table, {
    channel: 'resume',
    kinds: ['greet'],
    ctx: { signal: 'boot' },
    now,
    log: createEventLog(null),
  });
  const festival = table.filter(
    (e) =>
      (e.pick?.priority ?? 0) >= 30 &&
      ready.some((r) => r === e) &&
      /节日|情人节|新年|春节/.test((e.displayName || '') + (e.note || ''))
  );
  console.log('─'.repeat(70));
  console.log('%s  候选 %d 条 → 第一 tick 选中：%s', label, ready.length, fmt(picked));
  console.log(
    '   当日候选里的节日条目：%s',
    festival.length ? festival.map((e) => fmt(e)).join(' / ') : '(无)'
  );
  console.log(
    '   候选明细：%s',
    ready
      .slice()
      .sort((a, b) => (b.pick?.priority ?? 0) - (a.pick?.priority ?? 0))
      .map((e) => (e.pick?.priority ?? 0) + ':' + (e.id || '?'))
      .join(' | ')
  );
  const expect =
    label === '02-14' ? 'custom:valentine-greet' : label === '01-01' ? 'custom:newyear-greet' : '';
  if (expect && picked?.id !== expect) {
    bad++;
    console.log('   ★ 期望 %s，实际 %s', expect, fmt(picked));
  }
});

// ── 运行时状态的影响：当日配额已用 / lastAt 在未来 ───────────────────────
console.log('\n' + '='.repeat(70));
console.log('C. 时钟回拨（改系统日期验收时的真实场景）');
/**
 * `tryResumeEvent` 的 5 秒去重与 `onPauseChange` 的 15 秒门槛都在 `index.ts` 里，
 * 这里只验纯函数侧同一类算术：`allows` 的 cooldown。
 */
const headpat = table.find((e) => e.id === 'custom:headpat-soft')!;
const jan1 = at(2026, 1, 1);
const logBack = createEventLog(null);
logBack.commit(headpat, at(2026, 2, 14).getTime()); // 上次播放落在"未来"
logBack.beginTick();
console.log(
  '  headpat 的 lastAt=2-14，now=1-1 → allows = %s（应 true：负差不能当"刚播过"）',
  logBack.allows(headpat, jan1.getTime())
);

console.log('\n' + '='.repeat(70));
console.log('D. 运行时状态对"第一次问候"的影响（1-1 当天）');
const cases: Array<[string, (log: ReturnType<typeof createEventLog>) => void]> = [
  ['干净日志', () => undefined],
  [
    '元旦当日已播过 1 次（quota day 已用）',
    (log) => log.commit(table.find((e) => e.id === 'custom:newyear-greet')!, jan1.getTime()),
  ],
  [
    'lastAt 停在 2-14（系统日期回退到 1-1）',
    (log) => log.commit(table.find((e) => e.id === 'custom:newyear-greet')!, at(2026, 2, 14).getTime()),
  ],
];
cases.forEach(([name, seed]) => {
  const log = createEventLog(null);
  seed(log);
  const picked = first(jan1, log);
  console.log('  %s → %s', name.padEnd(38), fmt(picked));
});

console.log('\n结论：%s', bad === 0 ? '纯函数层第一次均命中节日' : '★纯函数层已复现 ' + bad + ' 个日期不命中');
process.exit(bad === 0 ? 0 : 1);
