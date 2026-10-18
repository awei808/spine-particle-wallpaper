// 回归 86：**竞争层 + 限流层**（PLAN S5 / §4.2）
//
// 跑法：npx ts-node --transpile-only _regress/86_回归_调度与限流.ts
//
// 覆盖：priority 分档、weight 加权（含 `weight:0`）、cooldown、quota(session/day/ever)、
// 互斥组 group、`decidePlay` 的抢占矩阵。
import { DialogueEntry } from '../src/config.type';
import {
  createEventLog,
  dayKey,
  eventPriority,
  eventWeight,
  selectEvent,
  EVENT_LOG_STORAGE_KEY,
} from '../src/eventScheduler';
import { decideAction, decidePlay } from '../src/touch';

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

const E = (key: string, pick?: DialogueEntry['pick']): DialogueEntry => ({
  id: key,
  animation: 'greet',
  text: key,
  pick,
});

/** 可注入的内存 storage（模拟 localStorage） */
const makeStorage = () => {
  const map: { [k: string]: string } = {};
  return {
    map,
    getItem: (k: string) => (k in map ? map[k] : null),
    setItem: (k: string, v: string) => {
      map[k] = v;
    },
  };
};

console.log('\nA. selectEvent：priority / weight');
eq(
  'A1 空候选 ⇒ null',
  selectEvent([], () => 0),
  null
);
eq(
  'A2 缺省 priority/weight 的取值',
  [eventPriority(E('a')), eventWeight(E('a'))],
  [0, 1]
);
eq(
  'A3 恒选最高档（p=50 压过 p=0，哪怕权重更小）',
  ['a', 'b', 'c'].length && [
    selectEvent(
      [E('custom:low', { weight: 100 }), E('custom:high', { priority: 50 })],
      () => 0.99
    )?.id,
  ],
  ['custom:high']
);
eq(
  'A4 同档按 weight 加权（[1,3] 的 25% 分界）',
  [
    selectEvent([E('custom:a'), E('custom:b', { weight: 3 })], () => 0.2)?.id,
    selectEvent([E('custom:a'), E('custom:b', { weight: 3 })], () => 0.3)?.id,
  ],
  ['custom:a', 'custom:b']
);
eq(
  'A5 weight:0 不进自动抽取',
  selectEvent([E('custom:zero', { weight: 0 }), E('custom:one')], () => 0)?.id,
  'custom:one'
);
eq(
  'A6 全 weight:0 ⇒ null（只能手动 trigger）',
  selectEvent([E('custom:a', { weight: 0 })], () => 0.5),
  null
);
/**
 * ★★ A6b 是 2026-10-18 线上 bug 的钉扎：**最高档全是 `weight:0`** 时不能返回 null。
 *
 * 旧实现"先取最高档、再在档内剔 weight:0" ⇒ 档内空 ⇒ null ⇒ 整条通道哑掉，
 * 而池里其它条目明明完全正常（实测：点击 7 条候选的触摸池，怎么点都没反应，
 * `firedCount / skippedCount` 都是 0）。`weight:0` 应理解为"我不参加抽取"，
 * 而不是"我占住最高档、谁也别想抽"。
 */
eq(
  'A6b ★最高档全是 weight:0 ⇒ 落到次档（不能返回 null）',
  selectEvent(
    [
      E('custom:manual', { priority: 80, weight: 0 }),
      E('custom:normal', { priority: 0 }),
    ],
    () => 0
  )?.id,
  'custom:normal'
);
eq(
  'A6c 多档时同样按"剔掉 weight:0 后的最高档"选',
  selectEvent(
    [
      E('custom:manual', { priority: 80, weight: 0 }),
      E('custom:mid', { priority: 50 }),
      E('custom:low', { priority: 10, weight: 9 }),
    ],
    () => 0.99
  )?.id,
  'custom:mid'
);
eq(
  'A7 rnd=1.0（越界注入）不返回 undefined',
  selectEvent([E('custom:a'), E('custom:b')], () => 1)?.id,
  'custom:b'
);

console.log('\nB. cooldown / quota / group');
const storage = makeStorage();
const log = createEventLog(storage);
const T0 = new Date(2026, 0, 15, 10, 0, 0).getTime();
const HOUR = 3600 * 1000;

const cd = E('custom:cd', { cooldownMs: 60000 });
log.beginTick();
ok('B1 首次可用', log.allows(cd, T0));
log.commit(cd, T0);
log.beginTick();
ok('B2 冷却内不可用', !log.allows(cd, T0 + 30000));
log.beginTick();
ok('B3 冷却外恢复可用', log.allows(cd, T0 + 60001));

const quotaEver = E('custom:ever', { quota: { max: 1, per: 'ever' } });
log.beginTick();
log.commit(quotaEver, T0);
log.beginTick();
ok('B4 quota.ever 用满后拦住', !log.allows(quotaEver, T0 + HOUR));

/** 持久化：换一个 log 实例读同一份 storage ⇒ ever 仍然生效（session 归零） */
const log2 = createEventLog(storage);
log2.beginTick();
ok(
  'B5 quota.ever 跨重载仍拦（session 则清零）',
  !log2.allows(quotaEver, T0 + HOUR)
);
ok(
  'B6 storage 里确实写入了 ' + EVENT_LOG_STORAGE_KEY,
  typeof storage.map[EVENT_LOG_STORAGE_KEY] === 'string'
);

const quotaSession = E('custom:session', { quota: { max: 2, per: 'session' } });
log.beginTick();
log.commit(quotaSession, T0);
log.beginTick();
log.commit(quotaSession, T0 + 1);
log.beginTick();
ok('B7 quota.session 用满后拦住', !log.allows(quotaSession, T0 + 2));
eq(
  'B8 session 不持久化 ⇒ 新实例从 0 计',
  [log2.allows(quotaSession, T0 + 3), log2.allows(quotaSession, T0 + 3)],
  [true, true]
);

const quotaDay = E('custom:day', { quota: { max: 1, per: 'day' } });
const day1 = new Date(2026, 0, 15, 23, 59, 0).getTime();
const day2 = new Date(2026, 0, 16, 0, 0, 1).getTime();
log.beginTick();
log.commit(quotaDay, day1);
log.beginTick();
ok('B9 quota.day 同一天拦住', !log.allows(quotaDay, day1 + 1000));
log.beginTick();
ok('B10 quota.day 跨本地 0 点重置', log.allows(quotaDay, day2));
eq('B11 dayKey 用本地日期', dayKey(day1) !== dayKey(day2), true);

const g1 = E('custom:g1', { group: 'g', priority: 50 });
const g2 = E('custom:g2', { group: 'g', priority: 50 });
log.beginTick();
log.commit(g1, T0 + HOUR);
ok('B12 同组同 tick 的其它条目出局', !log.allows(g2, T0 + HOUR));
log.beginTick();
ok('B13 下一个 tick 恢复', log.allows(g2, T0 + HOUR));

console.log('\nC. decidePlay：抢占矩阵');
/** 旧行为逐格对照：`decideAction` 本体未被改动 */
eq(
  'C1 空闲 ⇒ play（两种函数一致）',
  [
    decideAction(null, 'greet', 'legacy'),
    decidePlay(
      null,
      { source: 'greet', priority: 0, interrupt: false },
      'legacy'
    ),
  ],
  ['play', 'play']
);
eq(
  'C2 自动事件默认不打断（interrupt:false）',
  [
    decideAction('standby', 'greet', 'legacy'),
    decidePlay(
      { source: 'standby', priority: 10 },
      { source: 'greet', priority: 80, interrupt: false },
      'legacy'
    ),
  ],
  ['reject', 'reject']
);
eq(
  'C3 interrupt:true + 严格更高 ⇒ 抢占',
  decidePlay(
    { source: 'standby', priority: 10 },
    { source: 'greet', priority: 80, interrupt: true },
    'legacy'
  ),
  'play'
);
eq(
  'C4 优先级相同 ⇒ 不抢',
  decidePlay(
    { source: 'standby', priority: 50 },
    { source: 'greet', priority: 50, interrupt: true },
    'legacy'
  ),
  'reject'
);
eq(
  'C5 正在播触摸 ⇒ 定时器不得抢',
  decidePlay(
    { source: 'touch', priority: 0 },
    { source: 'greet', priority: 100, interrupt: true },
    'legacy'
  ),
  'reject'
);
eq(
  'C6 触摸候选的 interrupt 无效（走 touchFeedbackMode）',
  [
    decidePlay(
      { source: 'touch', priority: 0 },
      { source: 'touch', priority: 100, interrupt: true },
      'legacy'
    ),
    decideAction('touch', 'touch', 'legacy'),
  ],
  ['skip', 'skip']
);
eq(
  'C7 immediate 模式下触摸照旧立即打断',
  decidePlay(
    { source: 'touch', priority: 0 },
    { source: 'touch', priority: 0, interrupt: true },
    'immediate'
  ),
  'play'
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
