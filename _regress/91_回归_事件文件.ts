// 回归 91：**事件文件（assets/events.jsonc）的解析**（PLAN_事件配置文件 §3.4 / §8.1）
//
// 跑法（仓库根目录，**不需要素材、不需要浏览器**）：
//   npx ts-node --transpile-only _regress/91_回归_事件文件.ts
//
// 验的是四件事：
//   A. `stripJsonComments`：字符串里的 `//` 绝不能被吃掉（note 里写 URL、voice 里写路径）；
//      剥完**长度与换行位置不变**（这是"报错行:列精确"的前提）。
//   B. `stripTrailingCommas`：只吃 `,]` / `,}`，字符串里的标点不动。
//   C. `parseEventsFile`：形状错误的每一条分支；`schema` 更新只 warn；条目不是对象只丢那一条。
//   D. `loadEventsFile`：404 / 网络异常 / 正常三条路（注入假 fetcher，不碰真网络）。
//   E. 等价：同一条事件"写在文件里"与"直接喂给归一"结果逐字相同（文件不是第二个口径）。
import { DialogueEntry } from '../src/config.type';
import {
  loadEventsFile,
  parseEventsFile,
  stripJsonComments,
  stripTrailingCommas,
} from '../src/eventsFile';
import { normalizeEventTable } from '../src/eventModel';

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

/* ══ A. stripJsonComments ═════════════════════════════════════ */

console.log('\nA. stripJsonComments（注释剥离，偏移保持）');

const a1 = '{\n  // 行注释\n  "a": 1\n}';
const a1out = stripJsonComments(a1);
eq('A1 行注释被换成空格', JSON.parse(a1out), { a: 1 });
eq('A1b 长度不变', a1out.length, a1.length);
eq('A1c 行数不变', a1out.split('\n').length, a1.split('\n').length);

const a2 = '{ /* 块注释 */ "a": 1 }';
eq('A2 单行块注释', JSON.parse(stripJsonComments(a2)), { a: 1 });

const a3 = '{\n/* 第一行\n   第二行 */\n"a": 1\n}';
eq('A3 跨行块注释', JSON.parse(stripJsonComments(a3)), { a: 1 });
eq('A3b 跨行块注释不影响行数', stripJsonComments(a3).split('\n').length, 5);

const a4 = '{ "note": "见 https://example.com/a//b 这个地址" }';
eq(
  'A4 字符串里的 // 不被当注释（最容易写坏的一处）',
  JSON.parse(stripJsonComments(a4)),
  { note: '见 https://example.com/a//b 这个地址' }
);

const a5 = '{ "note": "引号 \\" // 仍在字符串里" }';
eq(
  'A5 转义引号之后的 // 仍在字符串里',
  (JSON.parse(stripJsonComments(a5)) as { note: string }).note,
  '引号 " // 仍在字符串里'
);

const a6 = '\uFEFF{ "a": 1 }';
const a6out = stripJsonComments(a6);
eq('A6 BOM 被换成空格后仍可解析', JSON.parse(a6out), { a: 1 });
eq('A6b BOM 不吃掉偏移', a6out.length, a6.length);

const a7 = '{\r\n// x\r\n"a": 1\r\n}';
eq('A7 CRLF 保留', stripJsonComments(a7).split('\r\n').length, 4);

const a8 = '{ "a": 1 } // 末尾注释无换行';
eq('A8 文件末尾的注释', JSON.parse(stripJsonComments(a8)), { a: 1 });

/* ══ B. stripTrailingCommas ═══════════════════════════════════ */

console.log('\nB. stripTrailingCommas（尾逗号）');

eq('B1 数组尾逗号', JSON.parse(stripTrailingCommas('[1, 2, ]')), [1, 2]);
eq('B2 对象尾逗号', JSON.parse(stripTrailingCommas('{"a": 1, }')), { a: 1 });
eq(
  'B3 字符串里的 ,] 不动',
  JSON.parse(stripTrailingCommas('{"a": "x,]y"}')),
  { a: 'x,]y' }
);
eq(
  'B4 中间逗号不动',
  JSON.parse(stripTrailingCommas('{"a": 1, "b": 2}')),
  { a: 1, b: 2 }
);
eq(
  'B5 嵌套数组的尾逗号',
  JSON.parse(stripTrailingCommas('[{"a": 1,},]')),
  [{ a: 1 }]
);

/* ══ C. parseEventsFile ════════════════════════════════════════ */

console.log('\nC. parseEventsFile（形状与报错）');

const fileText = `{
  // 文件头注释：这一段就是给作者看的
  "schema": 1,
  "events": [
    {
      /* 一条内置型事件 */
      "id": "game:64001",
      "on": ["resume"],
      "kind": "greet",
      "animation": "greet",
      "text": "早上好",
      "voice": "a/b.ogg",
    },
  ],
}
`;
const c1 = parseEventsFile(fileText);
ok('C1 合法文件 ok', c1.ok === true, c1.error ?? '');
eq('C1b 条目数', c1.events.length, 1);
eq('C1c 字段原样（不补默认值）', c1.events[0].id, 'game:64001');
eq('C1d 无 issue', c1.issues.length, 0);

const c2 = parseEventsFile('// 只有注释\n\n');
ok('C2 空文件 ⇒ 不 ok', c2.ok === false);
ok('C2b 报错提到空', /空/.test(c2.error ?? ''), String(c2.error));
eq('C2c 带一条 E_EVENTS_FILE', c2.issues[0].code, 'E_EVENTS_FILE');

const c3 = parseEventsFile('{ "schema": 1, "events": 3 }');
ok('C3 events 不是数组 ⇒ 不 ok', c3.ok === false);
ok('C3b 报错点名 events', /events/.test(c3.error ?? ''), String(c3.error));

const c4 = parseEventsFile('[1, 2]');
ok('C4 顶层是数组 ⇒ 不 ok', c4.ok === false);

const c5 = parseEventsFile('{\n  "schema": 1\n  "events": []\n}');
ok('C5 解析失败 ⇒ 不 ok', c5.ok === false);
ok(
  'C5b 报错带**原始文件**的行号（第 3 行）',
  /第\s*3\s*行/.test(c5.error ?? ''),
  String(c5.error)
);
ok(
  'C5c 不是剥离后的坐标（不会报第 2 行）',
  !/第\s*2\s*行/.test(c5.error ?? ''),
  String(c5.error)
);

const c6 = parseEventsFile(
  '{ "events": [ { "id": "custom:a" }, 42, null ] }'
);
ok('C6 非对象条目只丢那一条', c6.ok === true && c6.events.length === 1);
eq('C6b 两条 E_EVENTS_FILE', c6.issues.length, 2);

const c7 = parseEventsFile('{ "schema": 2, "events": [] }');
ok('C7 schema:2 仍可用', c7.ok === true);
eq('C7b 一条 W_EVENTS_FILE_SCHEMA', c7.issues[0].code, 'W_EVENTS_FILE_SCHEMA');
eq('C7c 级别是 info（不拦）', c7.issues[0].level, 'info');

const c8 = parseEventsFile('{ "events": [] }');
ok('C8 缺 schema 也认（按 1 处理）', c8.ok === true && c8.issues.length === 0);

/* ══ D. loadEventsFile ════════════════════════════════════════ */

console.log('\nD. loadEventsFile（404 / 异常 / 正常）');

const run = async (): Promise<void> => {
  const d1 = await loadEventsFile('./assets/events.jsonc', async () => ({
    ok: false,
    status: 404,
    text: async () => '',
  }));
  ok('D1 404 ⇒ 不 ok', d1.ok === false);
  ok(
    'D1b 报错点名文件与 HTTP 码',
    /events\.jsonc/.test(d1.error ?? '') && /404/.test(d1.error ?? ''),
    String(d1.error)
  );

  const d2 = await loadEventsFile('./assets/events.jsonc', async () => {
    throw new Error('file access denied');
  });
  ok('D2 fetch 抛异常 ⇒ 不 ok 且带原因', d2.ok === false && /denied/.test(d2.error ?? ''));

  const d3 = await loadEventsFile('./assets/events.jsonc', async () => ({
    ok: true,
    status: 200,
    text: async () => '{ "events": [ { "id": "custom:x" } ] }',
  }));
  ok('D3 正常 ⇒ ok', d3.ok === true);
  eq('D3b 条目传出来', d3.events[0].id, 'custom:x');

  /* ══ E. 等价：文件不是第二个口径 ═════════════════════════════ */
  console.log('\nE. 等价（文件条目 = 直接喂给归一的条目）');

  const entries: DialogueEntry[] = [
    {
      id: 'custom:good-night',
      displayName: '晚安',
      on: ['resume'],
      kind: 'greet',
      when: { time: { start: 23, end: 4 } },
      animation: 'greet',
      text: '晚安',
    },
    {
      id: 'game:64005',
      actionId: 64005,
      on: ['touch'],
      animation: 'touch1',
      pick: { weight: 0, priority: 80 },
    },
  ];
  const viaFile = parseEventsFile(
    JSON.stringify({ schema: 1, events: entries }, null, 2)
  );
  eq(
    'E1 文件读出来的条目过归一后，与直接喂原数组逐字相同',
    normalizeEventTable(viaFile.events).events,
    normalizeEventTable(entries).events
  );
  eq(
    'E2 weight:0 经文件路径仍是 0（不被缺省 1 吃掉）',
    normalizeEventTable(viaFile.events).events[1].pick?.weight,
    0
  );

  console.log(
    '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
  );
  process.exit(fail === 0 ? 0 : 1);
};

void run();
