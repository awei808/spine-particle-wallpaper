// 回归 93：**「事件池」跨类选择必须真的能取到条**（B 案验收）
//
// 跑法：npx ts-node --transpile-only _regress/93_回归_事件池跨类.ts
//
// 背景（2026-10-21）：2026-10-18 单表化把 `on` 变成了漏斗的**硬通道闸门**，
// 而 `on` 是迁移时从旧三池（`touch` / `chat` / `greeting`）1:1 反推出来的
// ⇒ 面板「长时间待机/触摸/回到壁纸可触发的事件」一旦跨类勾选（例如待机勾 touch类），
// 漏斗里一条都过不了闸门：待机/问候**什么都不播**，触摸通道退化成"只播动画、没声音"。
//
// B 案口径：`kind` 是唯一筛子，`on` 只作分组 / 来源标记；漏斗只保留
// "`on` 非空 = 可达"这一条。本脚本钉死这个契约，防止闸门被重新装回去。
import * as fs from 'fs';
import * as path from 'path';
import {
  DialogueEntry,
  TriggerChannel,
  TriggerEventKind,
} from '../src/config.type';
import {
  channelsOf,
  eventKeyOf,
  kindOf,
  normalizeEventTable,
} from '../src/eventModel';
import { collectCandidates, resolveEventFrom } from '../src/eventScheduler';

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

const eq = (name: string, got: unknown, want: unknown): void => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(name + ' = ' + a, a === b, 'want ' + b);
};

/** 真实事件表（与 `eventsFile.ts` 同样的去注释手法，只用于回归） */
const strip = (t: string): string =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/,(\s*[\]}])/g, '$1');

const raw = JSON.parse(
  strip(
    fs.readFileSync(
      path.resolve(__dirname, '../public/assets/events.jsonc'),
      'utf8'
    )
  )
) as { events: DialogueEntry[] };
const table = normalizeEventTable(raw.events).events;

const now = new Date(2026, 9, 21, 0, 30, 0);
const keysOf = (list: DialogueEntry[]) => list.map((e) => eventKeyOf(e)).sort();
const kindsOf = (list: DialogueEntry[]) =>
  list
    .map((e) => String(kindOf(e)))
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();

const cands = (channel: TriggerChannel, kinds: TriggerEventKind[]) =>
  collectCandidates(table, { channel, kinds, now });

console.log('\nA. `on` 不再限制通道（三入口 × 三类 都能取到条）');
(['standby', 'touch', 'resume'] as TriggerChannel[]).forEach((ch) => {
  (['chat', 'greet', 'touch'] as TriggerEventKind[]).forEach((k) => {
    ok(ch + ' + ' + k + ' 有候选', cands(ch, [k]).length > 0);
  });
});

console.log('\nB. 跨类 = 真的跨（候选的 kind 就是勾的那一类）');
eq('B1 standby + touch类 的 kind 集合', kindsOf(cands('standby', ['touch'])), [
  'touch',
]);
eq('B2 standby + greet类 的 kind 集合', kindsOf(cands('standby', ['greet'])), [
  'greet',
]);
eq('B3 touch + chat类 的 kind 集合', kindsOf(cands('touch', ['chat'])), [
  'chat',
]);
eq('B4 resume + touch类 的 kind 集合', kindsOf(cands('resume', ['touch'])), [
  'touch',
]);

console.log('\nC. 多类并池：不再"只剩默认那类"');
eq(
  'C1 standby + [chat,touch] 的 kind 集合',
  kindsOf(cands('standby', ['chat', 'touch'])),
  ['chat', 'touch']
);
eq(
  'C2 standby + [chat,greet,touch] 的候选数 = 三类之和',
  cands('standby', ['chat', 'greet', 'touch']).length,
  cands('standby', ['chat']).length +
    cands('standby', ['greet']).length +
    cands('standby', ['touch']).length
);

console.log('\nD. 默认三组行为不变（升级前后逐条一致）');
eq('D1 standby + chat类', keysOf(cands('standby', ['chat'])), ['game:64004']);
eq(
  'D2 resume + greet类 @00:30（18–5 那条）',
  resolveEventFrom(table, { channel: 'resume', kinds: ['greet'], now }, () => 0)
    ?.id,
  'game:64003'
);
eq(
  'D2b resume + greet类 @06:00（5–12 那条 + dawn-greet）',
  keysOf(
    collectCandidates(table, {
      channel: 'resume',
      kinds: ['greet'],
      now: new Date(2026, 9, 21, 6, 0, 0),
    })
  ),
  ['custom:dawn-greet', 'game:64001']
);
ok(
  'D3 touch + touch类 条数 = 事件表 touch 类条数',
  cands('touch', ['touch']).length ===
    table.filter((e) => kindOf(e) === 'touch').length
);
eq('D4 一类都不勾 ⇒ 空', cands('standby', []), []);

console.log('\nE. 仍被挡住的三种情况（撤闸门 ≠ 全放开）');
ok(
  'E1 `on: []` 三条通道都不可达',
  (['standby', 'touch', 'resume'] as TriggerChannel[]).every((ch) =>
    cands(ch, ['chat', 'greet', 'touch']).every((e) => channelsOf(e).length > 0)
  )
);
const orphan: DialogueEntry = {
  ...table[0],
  id: 'custom:orphan',
  on: [],
  kind: 'chat',
};
ok(
  'E2 手工造一条 on:[] ⇒ 三通道全挡',
  (['standby', 'touch', 'resume'] as TriggerChannel[]).every(
    (ch) =>
      collectCandidates([...table, orphan], {
        channel: ch,
        kinds: ['chat', 'greet', 'touch'],
        now,
      }).filter((e) => eventKeyOf(e) === 'custom:orphan').length === 0
  )
);
const disabled: DialogueEntry = {
  ...table[0],
  id: 'custom:off',
  enabled: false,
};
ok(
  'E3 enabled:false 仍不参与抽取',
  collectCandidates([disabled], {
    channel: 'resume',
    kinds: ['chat', 'greet', 'touch'],
    now,
  }).length === 0
);

console.log('\nF. 锁时机的唯一手段仍是 `when`（闸门撤了，条件还在）');
const signalLocked: DialogueEntry = {
  ...table[0],
  id: 'custom:boot-only',
  on: ['resume'],
  kind: 'greet',
  pick: undefined,
  when: { ctx: { signal: 'boot' } },
};
eq(
  'F1 when.ctx.signal=boot 在待机通道取不到',
  resolveEventFrom([signalLocked], {
    channel: 'standby',
    kinds: ['greet'],
    now,
  }),
  null
);
ok(
  'F2 同一套动画名清单里，待机跨类取的确实是触摸类',
  resolveEventFrom(
    table,
    { channel: 'standby', kinds: ['touch'], now },
    () => 0
  ) !== null
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
