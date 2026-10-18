// 回归 87：**variants 整包随机 + 逐 variant 换名**（PLAN S6 / §2.3）
//
// 跑法：npx ts-node --transpile-only _regress/87_回归_变体整包.ts
//
// 两条最容易出事的规则：
//  1. `projectDialoguesToActionPhase` 必须覆盖 `variants[].animation`
//     —— 否则混族时抽到变体会播**婚前**动画名，`addAnimation` 直接 throw；
//  2. 变体是**整包**（动作/粒子/台词/语音一起定），不能"动作来自 v1、台词来自 v2"。
import { DialogueEntry } from '../src/config.type';
import {
  buildFamilyRegistry,
  projectDialoguesToActionPhase,
} from '../src/dialogue';
import { resolveEventVariant } from '../src/eventModel';

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

/** 誓约工程注册表：`postMarry` 是动作族（`_marry`），`custom` 是纯分类族（无后缀） */
const reg = buildFamilyRegistry([
  { id: 'preMarry', label: '誓约前' },
  { id: 'postMarry', label: '誓约后', matchSuffix: '_marry' },
  { id: 'custom', label: '自定义事件' },
  { id: 'normal', label: '普通事件', default: true, fallback: true },
]);

const base: DialogueEntry = {
  id: 'custom:night',
  animation: 'greet',
  text: '晚安',
  voice: 'night_base.ogg',
  particles: ['p0'],
  phase: 'custom',
  variants: [
    {
      weight: 1,
      animation: 'greet',
      text: '早点睡',
      voice: 'night_1.ogg',
      particles: ['p1'],
    },
    { weight: 1, animation: 'chat2', text: '还不睡吗', voice: 'night_2.ogg' },
    { weight: 1, animation: 'touch1_marry', text: '已经晚上了' },
  ],
};

console.log('\nA. 换名：每个 variant 都过一遍，且不 double-suffix');
const projected = projectDialoguesToActionPhase([base], reg, 'postMarry');
eq(
  'A1 基准 + 3 个变体全部换名（已带后缀的保持不变）',
  [projected[0].animation, projected[0].variants?.map((v) => v.animation)],
  ['greet_marry', ['greet_marry', 'chat2_marry', 'touch1_marry']]
);
eq(
  'A2 换名不动台词/语音/粒子（游戏 CV 不分誓约前后）',
  projected[0].variants?.map((v) => [v.text, v.voice, v.particles ?? null]),
  [
    ['早点睡', 'night_1.ogg', ['p1']],
    ['还不睡吗', 'night_2.ogg', null],
    ['已经晚上了', null, null],
  ]
);
eq('A3 phase 被钉住（投影不改判族结果）', projected[0].phase, 'custom');

console.log('\nB. 无 matchSuffix 的族 ⇒ 不换名');
const customProjected = projectDialoguesToActionPhase(
  [{ ...base, phase: 'custom' }],
  reg,
  ''
);
eq(
  'B1 actionPhase 为空 ⇒ 原样（数组浅拷贝）',
  [
    customProjected[0].animation,
    customProjected[0].variants?.map((v) => v.animation),
  ],
  ['greet', ['greet', 'chat2', 'touch1_marry']]
);
const normalProjected = projectDialoguesToActionPhase(
  [{ ...base, phase: 'normal', variants: [{ animation: 'chat' }] }],
  reg,
  'postMarry'
);
eq(
  'B2 缺省族条目在动作族下仍会换名（誓约前/后通用的那批）',
  normalProjected[0].variants?.[0].animation,
  'chat_marry'
);

console.log('\nC. 整包抽取 + 逐字段继承');
const v = resolveEventVariant(base, () => 0);
eq(
  'C1 rnd=0 ⇒ 基准（隐式 variant#0）',
  [v.animation, v.text, v.voice, v.particles],
  ['greet', '晚安', 'night_base.ogg', ['p0']]
);
/** 4 个候选（基准 + 3），权重各 1 ⇒ [0,0.25) 基准，[0.25,0.5) v1，[0.5,0.75) v2，[0.75,1) v3 */
const v1 = resolveEventVariant(base, () => 0.3);
eq(
  'C2 命中 v1 ⇒ 动作/台词/语音/粒子整套来自 v1',
  [v1.animation, v1.text, v1.voice, v1.particles],
  ['greet', '早点睡', 'night_1.ogg', ['p1']]
);
const v2 = resolveEventVariant(base, () => 0.6);
eq(
  'C3 变体没写 particles ⇒ 继承基准（不是"空数组"）',
  [v2.animation, v2.text, v2.particles],
  ['chat2', '还不睡吗', ['p0']]
);
const v3 = resolveEventVariant(base, () => 0.9);
eq(
  'C4 变体没写 voice ⇒ 继承基准（配音不丢）',
  [v3.animation, v3.text, v3.voice],
  ['touch1_marry', '已经晚上了', 'night_base.ogg']
);
eq(
  'C5 配额/冷却只看事件（抽取不改 id / pick）',
  [v1.id, v1.pick],
  ['custom:night', undefined]
);
ok(
  'C6 无 variants ⇒ 同一对象（零拷贝，热路径不产生垃圾）',
  (() => {
    const plain: DialogueEntry = { id: 'custom:p', animation: 'greet' };
    return resolveEventVariant(plain, () => 0.5) === plain;
  })()
);

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
