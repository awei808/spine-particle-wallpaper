/**
 * 回归：**三个通道的「可触发的事件」多选** + **角色语音音量**。
 *
 * ## 需求（2026-10-09 定稿）
 *
 * 面板「动作」页有三项**同构**的多选，每项决定**那一个入口**能播哪几类事件
 * （选项都是 chat类 / greet类 / touch类），缺省**刻意各自不同**：
 *
 *   | 通道 | config 字段 | 触发时机 | 缺省 |
 *   |---|---|---|---|
 *   | `'standby'` | `standbyKinds` | 静置超过 `standbyIdleMs` | `['chat']` |
 *   | `'touch'` | `touchKinds` | 点中任一热区 | `['touch']` |
 *   | `'resume'` | `resumeKinds` | 载入 / 回到桌面 / 回到前台 / WE 恢复 | `['greet']` |
 *
 * ★★ **三个缺省合起来 = "升级后行为与改动前逐字相同"**（B1 / B2 / B3 钉住）。
 * 待机那个还额外修掉 2026-09-30「出厂什么都不播」的回归（A4 / A5 / C1）。
 *
 * ## 六个最容易踩的坑（都钉成测例）
 *
 *   - ★★ **数组口径完全以它为准**：`[]` = 该通道显式全关；但**全是非法值**的数组要
 *     **退回该通道缺省** —— 拼错一个词不该把整个入口的自动播关掉（A9 / A10 / A11）。
 *   - ★★ **旧两个布尔只作用于待机通道**：别的通道没这段历史，不能被它们污染（A12）。
 *   - ★★ 旧口径下**待机**的 `chat` 恒在：`standbyGreetEnabled:false` 只表示"别加问候"，
 *     不能把闲聊一起关掉（A4 / C5）。
 *   - ★★ 池空的类别要被剔除，别把空池也塞进候选（B4 / B5）。
 *   - ★★ `sameView` 必须按内容比，且**三个通道逐个都要比** ——
 *     漏比任何一个 ⇒ "只改了那一个通道的勾选"不重载（静默失效）（C10 ~ C13）。
 *   - 并池本身的条数与顺序在 `64_回归_触摸通道并池.ts` 里单独钉。
 *
 * ## 测的是真模块，不是复刻
 *
 * 直接 import `src/dialogue.ts` 与 `src/settingsStore.ts` 的出货实现。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/65_回归_通道事件选择.ts [bundle路径] [config路径]
 * （路径解析规则见 `_regress/README.md`）
 */

import * as fs from 'fs';

import { Configs, TriggerEventKind } from '../src/config.type';
import {
  CHANNEL_DEFAULT_KINDS,
  isTriggerChannel,
  isTriggerEventKind,
  normalizeTriggerKinds,
  resolveTriggerIntent,
  resolveTriggerKinds,
} from '../src/dialogue';
import { applyOverrides, readView, sameView } from '../src/settingsStore';

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
if (
  !sub ||
  !sub.dialogues ||
  !sub.greeting ||
  typeof sub.standby !== 'number'
) {
  console.error(
    'config 缺少 subtitle.{dialogues,greeting,standby}，无法回归: ' + CFG
  );
  process.exit(2);
}

const kinds = (a: TriggerEventKind[]): string => a.join(',');

/** `resolveTriggerKinds` 的调用别名：可用性默认"三类都可用"（多数测例只关心口径） */
const kindsOf = (
  channel: 'standby' | 'touch' | 'resume',
  k: unknown,
  greet?: boolean,
  touch?: boolean,
  hasChat = true,
  hasGreet = true,
  hasTouch = true
): TriggerEventKind[] =>
  resolveTriggerKinds(channel, k, greet, touch, hasChat, hasGreet, hasTouch);

/* ── A. 口径摊平：resolveTriggerIntent / normalizeTriggerKinds ── */
console.log('\nA. resolveTriggerIntent（三通道：新多选 / 缺省 / 旧布尔）');

eq(
  'A1 ★★缺省各自不同：standby=[chat] / touch=[touch] / resume=[greet]',
  [
    kinds(resolveTriggerIntent('standby', undefined)),
    kinds(resolveTriggerIntent('touch', undefined)),
    kinds(resolveTriggerIntent('resume', undefined)),
  ],
  ['chat', 'touch', 'greet']
);
eq(
  'A2 CHANNEL_DEFAULT_KINDS 与上面一致（缺省表是唯一来源）',
  [
    CHANNEL_DEFAULT_KINDS.standby.join(','),
    CHANNEL_DEFAULT_KINDS.touch.join(','),
    CHANNEL_DEFAULT_KINDS.resume.join(','),
  ],
  ['chat', 'touch', 'greet']
);
eq(
  'A3 新口径数组：去重 + 按固定顺序 chat→greet→touch 归一',
  resolveTriggerIntent('touch', ['touch', 'chat', 'touch']),
  ['chat', 'touch']
);
eq(
  'A4 ★★standby 缺省且旧布尔未开 ⇒ 仍是 chat（2026-09-30 回归的修复点）',
  resolveTriggerIntent('standby', undefined, false, false),
  ['chat']
);
eq(
  'A5 ★★standby 旧口径：chat **恒在** —— 只勾问候也是 chat+greet',
  resolveTriggerIntent('standby', undefined, true, false),
  ['chat', 'greet']
);
eq(
  'A6 standby 旧口径：缺字段（更老的 config）⇒ 同样只有 chat',
  resolveTriggerIntent('standby', undefined, undefined, undefined),
  ['chat']
);
eq(
  'A7 standby 旧口径：两个旧开关都开 ⇒ chat+greet+touch',
  resolveTriggerIntent('standby', undefined, true, true),
  ['chat', 'greet', 'touch']
);
eq(
  'A8 ★空数组 = 该通道显式全关（三通道一致，不是"没配"）',
  [
    kinds(resolveTriggerIntent('standby', [])),
    kinds(resolveTriggerIntent('touch', [])),
    kinds(resolveTriggerIntent('resume', [])),
  ],
  ['', '', '']
);
eq(
  'A9 ★数组里夹非法值 ⇒ 静默丢弃，合法的照收',
  resolveTriggerIntent('resume', ['Greet', 'greet', null, 3, 'touch']),
  ['greet', 'touch']
);
eq(
  'A10 ★★数组里**一个合法值都没有** ⇒ 当作没配，退回该通道缺省',
  [
    kinds(resolveTriggerIntent('standby', ['Chat', 3, null])),
    kinds(resolveTriggerIntent('touch', ['Chat', 3, null])),
    kinds(resolveTriggerIntent('resume', ['Chat', 3, null])),
  ],
  ['chat', 'touch', 'greet']
);
eq(
  'A11 写坏成非数组（字符串）⇒ 退回该通道缺省',
  [
    kinds(resolveTriggerIntent('touch', 'chat' as unknown)),
    kinds(resolveTriggerIntent('resume', 7 as unknown)),
  ],
  ['touch', 'greet']
);
eq(
  'A12 ★★旧两个布尔**只作用于 standby** —— touch / resume 通道不被污染',
  [
    kinds(resolveTriggerIntent('touch', undefined, true, true)),
    kinds(resolveTriggerIntent('resume', undefined, true, true)),
  ],
  ['touch', 'greet']
);
eq(
  'A13 ★给了数组 ⇒ 旧布尔完全不参与（standby 传了也不加回来）',
  resolveTriggerIntent('standby', ['greet'], false, true),
  ['greet']
);
ok(
  'A14 纯函数：不改动入参数组',
  (() => {
    const arr = ['touch', 'chat'];
    resolveTriggerIntent('standby', arr);
    return JSON.stringify(arr) === JSON.stringify(['touch', 'chat']);
  })()
);
ok(
  'A15 纯函数：缺省分支返回新数组（改它不污染缺省表）',
  (() => {
    const a = resolveTriggerIntent('touch', undefined);
    a.length = 0;
    return (
      resolveTriggerIntent('touch', undefined).length === 1 &&
      CHANNEL_DEFAULT_KINDS.touch.length === 1
    );
  })()
);
eq('A16 normalizeTriggerKinds：非数组 ⇒ 空', normalizeTriggerKinds('chat'), []);
eq(
  'A17 normalizeTriggerKinds：固定顺序与去重（顺序与入参无关）',
  normalizeTriggerKinds(['touch', 'greet', 'chat', 'chat']),
  ['chat', 'greet', 'touch']
);
eq(
  'A18 isTriggerEventKind：只认三个合法值（大小写敏感，数字/null 都不算）',
  [
    isTriggerEventKind('chat'),
    isTriggerEventKind('Chat'),
    isTriggerEventKind(1),
    isTriggerEventKind('touch'),
  ],
  [true, false, false, true]
);
eq(
  'A19 isTriggerChannel：只认三个通道名',
  [
    isTriggerChannel('standby'),
    isTriggerChannel('touch'),
    isTriggerChannel('resume'),
    isTriggerChannel('Resume'),
    isTriggerChannel(undefined),
  ],
  [true, true, true, false, false]
);

/* ── B. 候选类别解析（口径 + 可用性） ─────────────────────── */
console.log('\nB. resolveTriggerKinds（口径 + 可用性 → 真正会播的类别）');
eq(
  'B1 ★★standby 缺省 ⇒ 只有 chat（回归修复的正面断言）',
  kinds(kindsOf('standby', undefined)),
  'chat'
);
eq(
  'B2 ★★touch 缺省 ⇒ 只有 touch（= 被删掉的 greetInTouchPool:false）',
  kinds(kindsOf('touch', undefined)),
  'touch'
);
eq(
  'B3 ★★resume 缺省 ⇒ 只有 greet（= 旧 tryGreeting 的口径）',
  kinds(kindsOf('resume', undefined)),
  'greet'
);
eq(
  'B4 ★勾了但池空 ⇒ 该类别被剔除（chat 池空 ⇒ 只剩 touch）',
  kinds(
    kindsOf(
      'resume',
      ['chat', 'touch'],
      undefined,
      undefined,
      false,
      true,
      true
    )
  ),
  'touch'
);
eq(
  'B5 ★greet 勾了但问候池空 ⇒ 剔除，只剩 chat',
  kinds(
    kindsOf(
      'standby',
      ['chat', 'greet'],
      undefined,
      undefined,
      true,
      false,
      true
    )
  ),
  'chat'
);
eq(
  'B6 ★★显式空数组 ⇒ 空（哪怕三类都可用；= 关掉该通道的自动播）',
  [
    kinds(kindsOf('standby', [])),
    kinds(kindsOf('touch', [])),
    kinds(kindsOf('resume', [])),
  ],
  ['', '', '']
);
eq(
  'B7 ★standby 旧口径 + chat 池空（没配过 chat/standby）⇒ 空（配了才播）',
  kinds(kindsOf('standby', undefined, false, false, false, true, true)),
  ''
);
eq(
  'B8 ★standby 旧口径开 greet 但问候池空 ⇒ 只剩 chat（降级而不是整块失效）',
  kinds(kindsOf('standby', undefined, true, false, true, false, true)),
  'chat'
);
eq(
  'B9 顺序恒为 chat,greet,touch（与入参顺序无关）',
  kinds(kindsOf('touch', ['touch', 'greet', 'chat'])),
  'chat,greet,touch'
);
eq(
  'B10 ★数组全是非法值 ⇒ 退回该通道缺省（touch ⇒ touch，不是 chat）',
  [
    kinds(kindsOf('touch', ['Chat'])),
    kinds(kindsOf('resume', ['Chat'], false, false)),
  ],
  ['touch', 'greet']
);
ok(
  'B11 纯函数：返回新数组',
  (() => {
    const a = kindsOf('standby', undefined);
    a.length = 0;
    return kindsOf('standby', undefined).length === 1;
  })()
);

/* ── C. 覆盖层链路（三个通道 / voiceVolume） ───────────────── */
console.log(
  '\nC. 覆盖层链路（standbyKinds / touchKinds / resumeKinds / voiceVolume）'
);
const baseView = readView(cfg);
eq(
  'C1 ★★出厂值：三个通道的缺省各自不同',
  [baseView.standbyKinds, baseView.touchKinds, baseView.resumeKinds],
  [['chat'], ['touch'], ['greet']]
);
eq(
  'C2 出厂值：voiceVolume = 1（config audio.volume）',
  baseView.voiceVolume,
  1
);

const withKinds = applyOverrides(cfg, {
  standbyKinds: ['touch', 'greet'],
  touchKinds: ['greet'],
  resumeKinds: ['chat', 'greet'],
});
eq(
  'C3 三个键各自生效：视图按固定顺序归一',
  [
    readView(withKinds).standbyKinds,
    readView(withKinds).touchKinds,
    readView(withKinds).resumeKinds,
  ],
  [['greet', 'touch'], ['greet'], ['chat', 'greet']]
);
ok(
  'C4 ★applyOverrides：不就地改原 config（subtitle 三个键仍缺席）',
  (cfg.subtitle as { standbyKinds?: unknown }).standbyKinds === undefined &&
    (cfg.subtitle as { touchKinds?: unknown }).touchKinds === undefined &&
    (cfg.subtitle as { resumeKinds?: unknown }).resumeKinds === undefined
);
ok(
  'C5 ★★旧布尔仍生效（兼容输入）：只写 standbyTouchEnabled=true ⇒ 视图是 chat+touch',
  (() => {
    const v = readView(applyOverrides(cfg, { standbyTouchEnabled: true }));
    return JSON.stringify(v.standbyKinds) === JSON.stringify(['chat', 'touch']);
  })()
);
ok(
  'C6 ★applyOverrides 必须 slice：写完之后改入参数组，不影响 out',
  (() => {
    const arr: TriggerEventKind[] = ['chat'];
    const o = applyOverrides(cfg, { touchKinds: arr });
    arr.push('touch');
    return JSON.stringify(o.subtitle.touchKinds) === JSON.stringify(['chat']);
  })()
);
eq(
  'C7 applyOverrides：只给 voiceVolume ⇒ audio.volume 变、enabled 不动',
  (() => {
    const o = applyOverrides(cfg, { voiceVolume: 0.3 });
    return [o.subtitle.audio.volume, o.subtitle.audio.enabled];
  })(),
  [0.3, sub.audio?.enabled]
);
eq(
  'C8 ★三个通道与 standbyIdleSec 同 patch：四个都生效（subtitle 分支没互相吃掉）',
  (() => {
    const o = applyOverrides(cfg, {
      standbyIdleSec: 60,
      standbyKinds: ['chat', 'touch'],
      touchKinds: ['chat'],
      resumeKinds: ['touch'],
    });
    const v = readView(o);
    return [
      o.subtitle.standbyIdleMs,
      v.standbyKinds,
      v.touchKinds,
      v.resumeKinds,
    ];
  })(),
  [60000, ['chat', 'touch'], ['chat'], ['touch']]
);

/* sameView：★漏比任何一项 ⇒"只改这项"不重载（静默失效） */
console.log('\nC* sameView：每个字段都必须能被判出"有变化"');
const v0 = readView(cfg);
ok('C9 同值 ⇒ sameView = true', sameView(v0, readView(cfg)) === true);
ok(
  'C10 ★只改 standbyKinds（chat → chat+touch）⇒ 判为"有变化"',
  sameView(
    v0,
    readView(applyOverrides(cfg, { standbyKinds: ['chat', 'touch'] }))
  ) === false
);
ok(
  'C11 ★只改 touchKinds（touch → touch+greet）⇒ 判为"有变化"',
  sameView(
    v0,
    readView(applyOverrides(cfg, { touchKinds: ['touch', 'greet'] }))
  ) === false
);
ok(
  'C12 ★只改 resumeKinds（greet → greet+chat）⇒ 判为"有变化"',
  sameView(
    v0,
    readView(applyOverrides(cfg, { resumeKinds: ['greet', 'chat'] }))
  ) === false
);
ok(
  'C13 ★★三个通道内容相同但**数组是不同实例** ⇒ 仍判"没变化"（防每次启动白重载）',
  sameView(
    v0,
    readView(
      applyOverrides(cfg, {
        standbyKinds: ['chat'].slice(),
        touchKinds: ['touch'].slice(),
        resumeKinds: ['greet'].slice(),
      })
    )
  ) === true
);
ok(
  'C14 ★只改 voiceVolume（1% 粒度）⇒ 判为"有变化"',
  sameView(v0, readView(applyOverrides(cfg, { voiceVolume: 0.42 }))) === false
);
ok(
  'C15 音量抖动 0.4% ⇒ 仍判"没变化"（1% 粒度对齐 WE 滑块）',
  sameView(v0, readView(applyOverrides(cfg, { voiceVolume: 1.004 }))) === true
);

/* 向后兼容：旧 config 没有这些字段 */
const legacy = JSON.parse(JSON.stringify(cfg)) as Configs;
delete legacy.subtitle.standbyKinds;
delete legacy.subtitle.touchKinds;
delete legacy.subtitle.resumeKinds;
delete legacy.subtitle.standbyGreetEnabled;
delete legacy.subtitle.standbyTouchEnabled;
const lv = readView(legacy);
eq(
  'C16 ★旧 config（五个键都缺）⇒ 视图仍是三个缺省（缺字段绝不能被判成"全关"）',
  [lv.standbyKinds, lv.touchKinds, lv.resumeKinds],
  [['chat'], ['touch'], ['greet']]
);
eq(
  'C17 ★真实 config 出厂 ⇒ resume 通道候选就是 greet',
  kinds(
    resolveTriggerKinds(
      'resume',
      v0.resumeKinds,
      undefined,
      undefined,
      true,
      true,
      true
    )
  ),
  'greet'
);
eq(
  'C18 ★反过来：显式写 [] 才是真的不播（证明"缺省 greet"不是写死）',
  kinds(
    resolveTriggerKinds('resume', [], undefined, undefined, true, true, true)
  ),
  ''
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
    'standbyKinds',
    'touchKinds',
    'resumeKinds',
    'standbyGreetEnabled',
    'standbyTouchEnabled',
    'voiceVolume',
    'resolveTriggerIntent',
    'normalizeTriggerKinds',
    'mergeKindPools',
    'wb-set-standby-chat',
    'wb-set-standby-greet',
    'wb-set-standby-touch',
    'wb-set-touch-chat',
    'wb-set-touch-greet',
    'wb-set-touch-touch',
    'wb-set-resume-chat',
    'wb-set-resume-greet',
    'wb-set-resume-touch',
  ]) {
    ok('D  bundle 含属性名 ' + name, src.indexOf(name) >= 0);
  }
  /** 面板文案（用户可见）也必须到包 —— 这是"选项改名成了 chat类/greet类/touch类"最直接的证据 */
  for (const word of [
    '长时间待机可触发的事件',
    '触摸可触发的事件',
    '回到壁纸可触发的事件',
    'chat类',
    'greet类',
    'touch类',
  ]) {
    ok('D  bundle 含面板文案「' + word + '」', src.indexOf(word) >= 0);
  }
  ok(
    'D  负向：bundle 里**没有**已删除的旧字段 / 旧 DOM 锚点（greetInTouchPool / wb-set-greetpool）',
    src.indexOf('greetInTouchPool') < 0 && src.indexOf('wb-set-greetpool') < 0
  );
  ok(
    'D  负向：bundle 里**没有**"touch触发greet事件"这个**设置项标题**（说明文案里提到它是有意为之，见下条）',
    // 只允许它出现在「触摸可触发的事件」的说明句里（给升级用户指路），不允许再当标签用
    src.indexOf('"touch触发greet事件"') < 0 &&
      src.indexOf("'touch触发greet事件'") < 0
  );
  ok(
    'D  ★「触摸可触发的事件」的说明里**提醒**它取代了旧开关（升级用户能对上账）',
    src.indexOf('旧版「touch触发greet事件」开关打开的效果') >= 0
  );
  ok(
    'D  负向：bundle 里**没有**旧的单通道名字 resolveStandbyKinds',
    src.indexOf('resolveStandbyKinds') < 0
  );
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
