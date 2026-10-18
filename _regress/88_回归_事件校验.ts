// 回归 88：**校验码表**（PLAN S7 / §6.2）
//
// 跑法：npx ts-node --transpile-only _regress/88_回归_事件校验.ts
//
// 目标：16 个码**各来一条**，并钉住三条容易搞反的规则：
//   1. 处置决定级别（reject⇒error / coerce⇒warn / report⇒info），不是各码自己声明；
//   2. `validate:'warn'`（缺省）把 reject **降级成 report**（照播）；
//   3. `animations` 没给 ⇒ **跳过**动画检查（离线不误报）。
import { DialogueEntry } from '../src/config.type';
import { normalizeEventTable, Issue } from '../src/eventModel';
import { summarizeReport, validateEvents } from '../src/eventValidate';

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

const has = (issues: Issue[], code: string): boolean =>
  issues.some((i) => i.code === code);

const E = (patch: Partial<DialogueEntry> & { id: string }): DialogueEntry => ({
  animation: 'greet',
  text: 't',
  ...patch,
});

/** 一张"处处有问题"的表（id 非法的两条用 actionId 缺省也造不出来，所以直接给坏 id） */
const events: DialogueEntry[] = [
  E({ id: 'Bad Id', animation: 'greet' }), //             E_ID_INVALID
  E({ id: 'custom:dup', animation: 'greet' }), //         E_ID_DUP（与下一条）
  E({ id: 'custom:dup', animation: 'greet' }), //         E_ID_DUP
  E({ id: 'custom:anim', animation: 'nope' }), //         E_ANIM_MISSING
  E({ id: 'custom:empty', animation: '', text: '' }), //  E_EVENT_EMPTY
  E({ id: 'custom:zone', when: { ctx: { zone: 'hand' } } }), // E_ZONE_UNKNOWN
  E({ id: 'custom:cond', when: { calendar: { month: 13 } } }), // E_COND_INVALID
  E({ id: 'custom:particles', particles: ['p0', 'ghost'] }), // E_PARTICLES_UNKNOWN
  E({ id: 'custom:family', phase: 'ghost' }), //          E_FAMILY_UNKNOWN
  E({ id: 'custom:unknown', when: { chance: 0.5 } }), //  E_COND_UNKNOWN
  E({ id: 'custom:suffix', animation: 'chat' }), //       E_SUFFIX_MISSING（chat 存在、chat_marry 不存在）
  E({ id: 'custom:voice', voice: 'missing.ogg' }), //     E_VOICE_MISSING
  E({ id: 'custom:notenabled', phase: 'postMarry' }), //  W_FAMILY_NOT_ENABLED
  E({ id: 'custom:actiononly', text: '' }), //            W_TEXT_EMPTY
  E({ id: 'custom:fx1', animation: 'greet', particles: ['p0'] }), // W_FX_DIVERGED
  E({ id: 'custom:fx2', animation: 'greet', particles: ['p1'] }), // W_FX_DIVERGED
];

const report = validateEvents(events, {
  animations: ['greet', 'chat'],
  particleNames: ['p0', 'p1'],
  zoneIds: ['body'],
  familyIds: ['normal', 'postMarry'],
  fallbackFamilyId: 'normal',
  enabledFamilyIds: ['normal'],
  actionPhase: 'postMarry',
  /** 只有 `greet` 能换名成功；`custom:suffix` 那条我们故意让它失败 */
  projectAnimation: (n) => (n === 'greet' ? 'greet' : n + '_marry'),
  voiceExists: (v) => v !== 'missing.ogg',
  checkFxDiverged: true,
  mode: 'strict',
});

const codes = report.issues.map((i) => i.code);
console.log('\nA. 每个码各来一条');
[
  'E_ID_INVALID',
  'E_ID_DUP',
  'E_ANIM_MISSING',
  'E_EVENT_EMPTY',
  'E_ZONE_UNKNOWN',
  'E_COND_INVALID',
  'E_PARTICLES_UNKNOWN',
  'E_FAMILY_UNKNOWN',
  'E_COND_UNKNOWN',
  'E_SUFFIX_MISSING',
  'E_VOICE_MISSING',
  'W_FAMILY_NOT_ENABLED',
  'W_TEXT_EMPTY',
  'W_FX_DIVERGED',
].forEach((code) => ok('A ' + code, has(report.issues, code)));

console.log('\nB. 处置 / 级别 / 修复补丁');
eq(
  'B1 级别由处置派生',
  [
    report.issues.find((i) => i.code === 'E_ANIM_MISSING')?.level,
    report.issues.find((i) => i.code === 'E_PARTICLES_UNKNOWN')?.level,
    report.issues.find((i) => i.code === 'W_TEXT_EMPTY')?.level,
  ],
  ['error', 'warn', 'info']
);
eq(
  'B2 E_PARTICLES_UNKNOWN 的补丁剔掉坏名、保留好名',
  report.fixed['custom:particles']?.particles,
  ['p0']
);
eq(
  'B3 E_FAMILY_UNKNOWN 的补丁归缺省族',
  report.fixed['custom:family']?.phase,
  'normal'
);
eq(
  'B4 E_SUFFIX_MISSING 的补丁退回原名（不 reject）',
  [
    report.fixed['custom:suffix']?.animation,
    report.unplayable.indexOf('custom:suffix') >= 0,
  ],
  ['chat', false]
);
ok(
  'B5 E_ANIM_MISSING / E_EVENT_EMPTY / E_ZONE_UNKNOWN / E_COND_INVALID 进 unplayable',
  ['custom:anim', 'custom:empty', 'custom:zone', 'custom:cond'].every(
    (k) => report.unplayable.indexOf(k) >= 0
  )
);
ok(
  'B6 重复 id 的后者进 unplayable',
  report.unplayable.indexOf('custom:dup') >= 0
);
eq(
  'B7 三档计数与 issues 对得上',
  [
    report.counts.reject,
    report.counts.coerce,
    report.counts.report,
    report.issues.length,
  ],
  [
    report.counts.reject,
    report.counts.coerce,
    report.counts.report,
    report.counts.reject + report.counts.coerce + report.counts.report,
  ]
);

console.log('\nC. validate 模式');
const warnReport = validateEvents(events, {
  animations: ['greet'],
  mode: 'warn',
});
eq(
  'C1 warn ⇒ 只剩物理不可播的（动画缺失 / 空事件 / id 非法与重复）',
  ['custom:anim', 'custom:empty', 'custom:dup'].every(
    (k) => warnReport.unplayable.indexOf(k) >= 0
  ),
  true
);
eq(
  'C1b warn ⇒ 语义类 reject 放回候选（热区未知 / 条件非法）',
  ['custom:zone', 'custom:cond'].filter(
    (k) => warnReport.unplayable.indexOf(k) >= 0
  ),
  []
);
eq('C2 warn ⇒ 没有 reject 计数', warnReport.counts.reject, 0);
ok(
  'C3 warn ⇒ 原 reject 的码仍在（只是级别变 info，便于档案红标/排查）',
  has(warnReport.issues, 'E_ANIM_MISSING')
);
const offReport = validateEvents(events, {
  animations: ['greet'],
  mode: 'off',
});
eq('C4 off ⇒ 什么都不报', offReport.issues.length, 0);

console.log('\nD. 离线跳过的检查');
const noAnimTable = validateEvents(
  [E({ id: 'custom:any', animation: 'whatever' })],
  { animations: null, mode: 'strict' }
);
eq(
  'D1 animations 未给 ⇒ 不报 E_ANIM_MISSING（离线不误报）',
  noAnimTable.issues.length,
  0
);
const noZones = validateEvents(
  [E({ id: 'custom:z', when: { ctx: { zone: 'hand' } } })],
  { zoneIds: null, mode: 'strict' }
);
eq(
  'D2 zoneIds 未给 ⇒ 不报 E_ZONE_UNKNOWN',
  has(noZones.issues, 'E_ZONE_UNKNOWN'),
  false
);

console.log('\nE. 与归一层的分工（E_PRIORITY_RANGE / W_LEGACY / W_ORPHAN）');
const n = normalizeEventTable(
  [
    {
      id: 'custom:p',
      animation: 'greet',
      on: ['resume'],
      pick: { priority: 999 },
    },
    { actionId: 64099, animation: 'greet' },
  ],
  { legacy: { touch: [64005] } }
);
ok(
  'E1 E_PRIORITY_RANGE 由 normalize 产出（不是 validate）',
  has(n.issues, 'E_PRIORITY_RANGE')
);
ok('E2 W_ORPHAN 由 normalize 产出', has(n.issues, 'W_ORPHAN'));
eq('E3 汇总文案稳定', summarizeReport(report).indexOf('校验：'), 0);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
