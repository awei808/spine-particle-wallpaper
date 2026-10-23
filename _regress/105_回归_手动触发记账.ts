/**
 * 回归：**手动触发不消耗配额**（2026-10-23，P0-4）。
 *
 * ## 为什么单开一条
 *
 * 手动触发有两处入口：调试面板的 `onTriggerEvent` 与探针的
 * `__WB_DIALOGUE__.trigger`。改前两者都是直接
 * `touchController.trigger(findByEventKey(...), src)` —— **完全绕过漏斗**。
 *
 * 但记账在 `onAction` 回调里，而 `onAction` 是 `trigger` 触发的 ⇒ 手动点几下
 * 也会 `eventLog.commit` ⇒ `quota.ever` 被吃光 ⇒ **自动通道从此再也不播这条**，
 * 而用户以为自己只是在调试。
 *
 * ## 这条脚本钉什么
 *
 *   A. `commit(e, now, manual=true)` **不涨** total / session / dayCount
 *   B. 但**写 `lastAt`**（冷却照旧起算 —— "刚播过"是事实）
 *   C. 跨天时 `manual` 仍会刷新 `rec.day`，但 `dayCount` 归零后不会再被加上去
 *   D. `manual=false`（自动路径）行为**逐字不变** —— 三个计数各 +1
 *   E. 端到端：反复手动 commit 后，`allows()` 对 `quota.ever` **仍然放行**
 *   F. `beginTick` + manual commit 写下的互斥组 tick 号是**当前** tick
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/105_回归_手动触发记账.ts
 */
import { createEventLog } from '../src/eventScheduler';
import { DialogueEntry } from '../src/config.type';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = ''): void => {
  if (ok) {
    pass++;
  } else {
    fail++;
  }
  console.log(
    '  [%s] %s%s',
    ok ? ' OK ' : 'FAIL',
    label,
    detail ? '  ' + detail : ''
  );
};

/** 内存态日志（不落 localStorage，测试互不污染） */
const newLog = () => createEventLog(null);

const E = (id: string, pick?: DialogueEntry['pick']): DialogueEntry =>
  ({ id, animation: 'touch1', pick } as DialogueEntry);

const T0 = new Date(2026, 9, 23, 12, 0, 0).getTime();
const DAY2 = new Date(2026, 9, 24, 12, 0, 0).getTime();

console.log('\n── A. manual=true 不涨配额计数 ──');
{
  const log = newLog();
  const e = E('custom:m', { quota: { per: 'ever', max: 1 } });
  log.beginTick();
  log.commit(e, T0, true);
  const rec = log.peek('custom:m');
  check(rec?.total === 0, 'A1 total 不涨', 'total=' + rec?.total);
  check(rec?.session === 0, 'A2 session 不涨', 'session=' + rec?.session);
  check(rec?.dayCount === 0, 'A3 dayCount 不涨', 'dayCount=' + rec?.dayCount);
  check(rec?.lastAt === T0, 'A4 lastAt 仍被写入（冷却起算）', 'lastAt=' + rec?.lastAt);
}

console.log('\n── B. manual=false 行为逐字不变 ──');
{
  const log = newLog();
  const e = E('custom:a', { quota: { per: 'ever', max: 5 } });
  log.beginTick();
  log.commit(e, T0);
  const rec = log.peek('custom:a');
  check(
    rec?.total === 1 && rec?.session === 1 && rec?.dayCount === 1,
    'B1 total / session / dayCount 各 +1',
    `total=${rec?.total} session=${rec?.session} day=${rec?.dayCount}`
  );
}

console.log('\n── C. 跨天：manual 刷新 day 但不加 dayCount ──');
{
  const log = newLog();
  const e = E('custom:d', { quota: { per: 'day', max: 2 } });
  /** 第一天自动播 2 次（用满） */
  log.beginTick();
  log.commit(e, T0);
  log.beginTick();
  log.commit(e, T0 + 1000);
  check(!log.allows(e, T0 + 2000), 'C1 当天用满后被拦住', '');
  /** 第二天手动播一次：应放行，且 dayCount 不应变成 1 */
  log.beginTick();
  log.commit(e, DAY2, true);
  const rec = log.peek('custom:d');
  check(rec?.dayCount === 0, 'C2 跨天 + manual ⇒ dayCount 归零且不累加', 'dayCount=' + rec?.dayCount);
  check(log.allows(e, DAY2 + 1000), 'C3 手动之后当天配额仍可用（没被吃掉）', '');
}

console.log('\n── D. 端到端：手动反复点，quota.ever 不枯竭 ──');
{
  const log = newLog();
  /** `quota.ever: 1` —— 自动只允许播 1 次 */
  const e = E('custom:ever', { quota: { per: 'ever', max: 1 } });
  /** 模拟手动点 20 次 */
  for (let i = 0; i < 20; i++) {
    log.beginTick();
    log.commit(e, T0 + i * 1000, true);
  }
  check(log.allows(e, T0 + 30000), 'D1 手动 20 次后，自动通道**仍能**抽到它（改前会被吃光）', '');
  /** 再自动播一次就该用满了 */
  log.beginTick();
  log.commit(e, T0 + 31000);
  check(!log.allows(e, T0 + 32000), 'D2 自动播过一次后才真正用满（配额仍然有效）', '');
}

console.log('\n── E. 互斥组：manual commit 写当前 tick ──');
{
  const log = newLog();
  const g1 = E('custom:g1', { group: 'G' });
  const g2 = E('custom:g2', { group: 'G' });
  log.beginTick();
  log.commit(g1, T0, true);
  /** 同一 tick 内同组另一条应出局 */
  check(!log.allows(g2, T0), 'E1 同 tick 同组出局（manual 也占组）', '');
  log.beginTick();
  check(log.allows(g2, T0), 'E2 下一 tick 恢复', '');
}

console.log('\n── F. 手动不影响 total 的累加路径（回归防护）──');
{
  const log = newLog();
  const e = E('custom:mix');
  log.beginTick();
  log.commit(e, T0, true); // 手动
  log.beginTick();
  log.commit(e, T0 + 1000); // 自动
  log.beginTick();
  log.commit(e, T0 + 2000, true); // 再手动
  const rec = log.peek('custom:mix');
  check(rec?.total === 1, 'F1 两次手动 + 一次自动 ⇒ total 只有 1', 'total=' + rec?.total);
  check(rec?.lastAt === T0 + 2000, 'F2 lastAt 取最后一次（含手动）', 'lastAt=' + (rec?.lastAt === T0 + 2000 ? 'T0+2000' : rec?.lastAt));
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
