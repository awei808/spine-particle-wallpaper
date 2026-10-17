/**
 * 75 · 回归：**P5-a「Sub Emitters · config 结构」**
 *
 * ## 本轮钉的是什么（`docx/TODO.md` §2.11 / `docx/RESEARCH_…` §4.16）
 *
 * P5 拆了三段，**本轮只做 P5-a**：把 config 结构定死、写成类型与校验器、留档；
 * **引擎还没消费这两个字段**（P5-b 才接线：出生/死亡事件出口 + 继承注入 + 实例池）。
 *
 * 于是本脚本钉的是"**结构的契约**"，不是渲染行为：
 *
 *   ① **零回归**：现有四份 config 都不含 `subEmitters` / `subOnly` ⇒ 校验器必须一条警告都不给；
 *   ② **合法的最小配置**通过，且 `effectiveSubEmitterTargets()` 给出正确的 父→子 映射；
 *   ③ **`severity: 'error'` 的 9 条**（该条绑定作废）逐条钉住：
 *      target 缺失 / 找不到 / 自引用 / trigger 非法 / `collision`·`trigger` 未实现 /
 *      inherit 非法 / probability 越界 / instances 越界 / instanceMaxNum 越界；
 *   ④ **`severity: 'warn'` 的 4 条**（仍然生效，只是提示）逐条钉住：
 *      `z.mismatch` / `emission.notBurstOnly` / `subOnly.unreferenced` / `cycle`；
 *   ⑤ **缺省值**：`trigger` 缺省 `birth`、`inherit` 缺省 `[]`、`probability` 缺省 `1`、
 *      `instances` 缺省 `4`（= Unity 模板/本项目口径）；
 *   ⑥ ★ **P5-a 的边界**：`dist/bundle.js` 里**不含**校验器的字符串 ⇒ 证明"未接线、对壁纸零影响"。
 *      （P5-b 接线后这条应改成反向断言 —— 那时它就该出现了。）
 *
 * ⚠️ 校验器是**纯函数、不依赖 three.js**（`src/subEmitterConfig.ts`）；本脚本直接 import 它，
 *   与 69 号"直接 import `src/dialogue` 的纯函数"同一路数。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/75_回归_子发射器结构.ts [config路径]
 *
 * 路径解析规则见 `_regress/README.md`。
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * `@src/*` 是出货代码用的 webpack alias，ts-node 裸跑不认识 ⇒ 补一条解析规则。
 */
const ROOT = path.join(__dirname, '..');
const NodeModule: any = require('module');
const origResolve: any = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (
  request: any,
  parent: any,
  isMain: any,
  options: any
) {
  if (typeof request === 'string' && request.startsWith('@src/')) {
    request = path.join(ROOT, 'src', request.slice('@src/'.length));
  }
  return origResolve.call(this, request, parent, isMain, options);
};

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  validateSubEmitters,
  effectiveSubEmitterTargets,
  MAX_INSTANCES,
}: any = require(path.join(ROOT, 'src', 'subEmitterConfig'));

const CFG_DEFAULT = path.join(ROOT, 'public', 'assets', 'config.json');
const cfgPath = process.argv[2] || process.env.WK_CONFIG || CFG_DEFAULT;

/* ── 断言框架 ───────────────────────────────────────────────────────────── */
let pass = 0;
let fail = 0;
function chk(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
  }
  console.log(
    `   [${cond ? 'OK  ' : '★!  '}] ${label}${detail ? '   ' + detail : ''}`
  );
}

/** 造一个最小可用的 particle mesh（只放校验器会看的字段） */
function P(name: string, extra: any = {}): any {
  return Object.assign(
    {
      type: 'particle',
      name,
      textureFileName: name + '.png',
      position: { x: 0, y: 0, z: -1400 },
      emission: { rateOverTime: { mode: 0, a: 0, b: 0 }, bursts: [] },
    },
    extra
  );
}
const CFG = (meshes: any[]) => ({ meshes });

/** 取某 code 的那条（找不到返回 undefined） */
const pick = (ws: any[], code: string) => ws.filter((w) => w.code === code);
const only = (ws: any[], code: string) =>
  pick(ws, code).length === 1 ? pick(ws, code)[0] : undefined;

function main() {
  console.log('='.repeat(78));
  console.log(
    '75 · P5-a「Sub Emitters · config 结构」回归（结构契约，不是渲染行为）'
  );
  console.log('='.repeat(78));
  console.log(`   config  ${cfgPath}`);

  /* ── ① 零回归：现有 config 一个字段都不含 ── */
  console.log('');
  console.log('[1] 零回归：现有 config 不含 subEmitters / subOnly ⇒ 零警告');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const parts = (cfg.meshes || []).filter((m: any) => m.type === 'particle');
    console.log(`   该 config 有 ${parts.length} 个粒子组`);
    const raw = JSON.stringify(parts);
    chk(
      '现有 config 里没有 `subEmitters` / `subOnly` 字段',
      raw.indexOf('subEmitters') < 0 && raw.indexOf('subOnly') < 0
    );
    const ws = validateSubEmitters(cfg);
    chk(
      '校验器对现有 config 零警告',
      ws.length === 0,
      ws.map((w: any) => w.code).join(',') || '（无）'
    );
    chk(
      'effectiveSubEmitterTargets() 为空对象',
      Object.keys(effectiveSubEmitterTargets(cfg)).length === 0
    );
  } else {
    console.log('   ★! config 不存在 —— 跳过第 1 组');
    fail++;
  }

  /* ── ② 合法的最小配置 ── */
  console.log('');
  console.log('[2] 合法的最小配置：一条绑定 ⇒ 0 警告 + 映射正确');
  const OK = CFG([
    P('glow', {
      subEmitters: [
        {
          target: 'spark',
          trigger: 'birth',
          inherit: ['size', 'color'],
          probability: 1,
        },
      ],
    }),
    P('spark', { subOnly: true }),
  ]);
  const okW = validateSubEmitters(OK);
  chk(
    '一条合法绑定 ⇒ 零警告',
    okW.length === 0,
    okW.map((w: any) => w.message).join(' | ')
  );
  const okMap = effectiveSubEmitterTargets(OK);
  chk(
    '映射 = { glow: ["spark"] }',
    okMap.glow && okMap.glow.length === 1 && okMap.glow[0] === 'spark',
    JSON.stringify(okMap)
  );
  chk(
    '`subOnly` 被引用 ⇒ 不报 subOnly.unreferenced',
    pick(okW, 'subOnly.unreferenced').length === 0
  );

  /** 同一个 spark 被两个父引用 ⇒ 两条边都在（池按绑定，§2.2 实测 68 个目标被共用） */
  const SHARED = CFG([
    P('g1', { subEmitters: [{ target: 'spark' }] }),
    P('g2', { subEmitters: [{ target: 'spark' }] }),
    P('spark', { subOnly: true }),
  ]);
  const shW = validateSubEmitters(SHARED);
  const shMap = effectiveSubEmitterTargets(SHARED);
  chk(
    '同一目标被两个父共用 ⇒ 两条边都保留、零警告',
    shW.length === 0 && shMap.g1[0] === 'spark' && shMap.g2[0] === 'spark',
    JSON.stringify(shMap)
  );

  /** 一条父挂多条绑定（全包实测最多 19 条） */
  const MANY = CFG([
    P('g', {
      subEmitters: [{ target: 'a' }, { target: 'b' }, { target: 'c' }],
    }),
    P('a', { subOnly: true }),
    P('b', { subOnly: true }),
    P('c', { subOnly: true }),
  ]);
  chk(
    '一条父挂 3 条绑定 ⇒ 零警告 + 映射 3 条',
    validateSubEmitters(MANY).length === 0 &&
      effectiveSubEmitterTargets(MANY).g.length === 3
  );

  /* ── ③ error 档：9 条 ── */
  console.log('');
  console.log('[3] severity = error（该条绑定作废）');
  const E = (sub: any[], extra?: any[]) =>
    validateSubEmitters(
      CFG([P('glow', { subEmitters: sub })].concat(extra || [P('spark')]))
    );

  let w = E([{ target: '' }]);
  chk(
    'target 为空 ⇒ code=target.missing / error',
    only(w, 'target.missing') && only(w, 'target.missing').severity === 'error'
  );

  w = E([{ target: 'nope' }]);
  chk('target 不存在 ⇒ code=target.notFound', !!only(w, 'target.notFound'));

  w = E([{ target: 'glow' }]);
  chk('target 指向自己 ⇒ code=target.selfRef', !!only(w, 'target.selfRef'));

  w = E([{ target: 'spark', trigger: 'explode' as any }]);
  chk('trigger 非法 ⇒ code=trigger.invalid', !!only(w, 'trigger.invalid'));

  w = E([{ target: 'spark', trigger: 'collision' }]);
  chk(
    'trigger = collision ⇒ 未实现（error，该条被忽略）',
    only(w, 'trigger.unimplemented') &&
      only(w, 'trigger.unimplemented').severity === 'error'
  );
  w = E([{ target: 'spark', trigger: 'trigger' }]);
  chk(
    'trigger = trigger ⇒ 未实现（error）',
    !!only(w, 'trigger.unimplemented')
  );

  w = E([{ target: 'spark', inherit: ['size', 'bogus'] as any }]);
  chk('inherit 含非法项 ⇒ code=inherit.invalid', !!only(w, 'inherit.invalid'));
  w = E([{ target: 'spark', inherit: 3 as any }]);
  chk(
    'inherit 既不是数组也不是 all/nothing ⇒ code=inherit.invalid',
    !!only(w, 'inherit.invalid')
  );

  w = E([{ target: 'spark', probability: 1.5 }]);
  chk(
    'probability = 1.5 ⇒ code=probability.range',
    !!only(w, 'probability.range')
  );
  w = E([{ target: 'spark', probability: -0.1 }]);
  chk(
    'probability = −0.1 ⇒ code=probability.range',
    !!only(w, 'probability.range')
  );

  w = E([{ target: 'spark', instances: 0 }]);
  chk('instances = 0 ⇒ code=instances.range', !!only(w, 'instances.range'));
  w = E([{ target: 'spark', instances: MAX_INSTANCES + 1 }]);
  chk(
    `instances > ${MAX_INSTANCES} ⇒ code=instances.range（工程侧上限，防多父共用爆炸）`,
    !!only(w, 'instances.range')
  );
  w = E([{ target: 'spark', instanceMaxNum: 0 }]);
  chk(
    'instanceMaxNum = 0 ⇒ code=instanceMaxNum.range',
    !!only(w, 'instanceMaxNum.range')
  );

  /* ── ④ warn 档：4 条（仍然生效） ── */
  console.log('');
  console.log('[4] severity = warn（仍然生效，只是提示）');

  const ZM = CFG([
    P('glow', {
      position: { x: 0, y: 0, z: -1400 },
      subEmitters: [{ target: 'spark' }],
    }),
    P('spark', { position: { x: 0, y: 0, z: -1300 }, subOnly: true }),
  ]);
  const zmW = validateSubEmitters(ZM);
  chk(
    'z 与父不同 ⇒ code=z.mismatch / warn',
    only(zmW, 'z.mismatch') && only(zmW, 'z.mismatch').severity === 'warn',
    `z 父 ${-1400} vs 子 ${-1300}`
  );

  /** 手册硬规则：Death/Collision/Trigger/Manual 只能 burst ⇒ 子系统的 rateOverTime 必须为 0 */
  const NB = CFG([
    P('glow', {
      subEmitters: [{ target: 'spark', trigger: 'death', inherit: 'nothing' }],
    }),
    P('spark', {
      subOnly: true,
      emission: { rateOverTime: { mode: 0, a: 20, b: 20 }, bursts: [] },
    }),
  ]);
  const nbW = validateSubEmitters(NB);
  chk(
    'death 档 + 子系统 rateOverTime ≠ 0 ⇒ code=emission.notBurstOnly / warn',
    only(nbW, 'emission.notBurstOnly') &&
      only(nbW, 'emission.notBurstOnly').severity === 'warn'
  );

  const NB0 = CFG([
    P('glow', { subEmitters: [{ target: 'spark', trigger: 'death' }] }),
    P('spark', {
      subOnly: true,
      emission: { rateOverTime: { mode: 0, a: 0, b: 0 }, bursts: [] },
    }),
  ]);
  chk(
    'death 档 + rateOverTime = 0 ⇒ 不报（burst 型才合法，且这是常态）',
    pick(validateSubEmitters(NB0), 'emission.notBurstOnly').length === 0
  );

  const UR = CFG([P('orphan', { subOnly: true })]);
  const urW = validateSubEmitters(UR);
  chk(
    'subOnly 但没人引用 ⇒ code=subOnly.unreferenced / warn',
    only(urW, 'subOnly.unreferenced') &&
      only(urW, 'subOnly.unreferenced').severity === 'warn'
  );

  const CY = CFG([
    P('a', { subEmitters: [{ target: 'b' }] }),
    P('b', { subEmitters: [{ target: 'c' }] }),
    P('c', { subEmitters: [{ target: 'a' }] }),
  ]);
  const cyW = validateSubEmitters(CY);
  chk(
    'a→b→c→a 成环 ⇒ code=cycle / warn',
    only(cyW, 'cycle') && only(cyW, 'cycle').severity === 'warn',
    only(cyW, 'cycle') && only(cyW, 'cycle').message
  );

  /** 合法的链（不成环）不能被误报 */
  const CH = CFG([
    P('a', { subEmitters: [{ target: 'b' }] }),
    P('b', { subEmitters: [{ target: 'c' }] }),
    P('c', { subOnly: true }),
  ]);
  chk(
    'a→b→c（链，不成环）⇒ 不报 cycle',
    pick(validateSubEmitters(CH), 'cycle').length === 0
  );
  chk(
    '链式嵌套的映射 = {a:[b], b:[c]}',
    JSON.stringify(effectiveSubEmitterTargets(CH)) ===
      JSON.stringify({ a: ['b'], b: ['c'] }),
    JSON.stringify(effectiveSubEmitterTargets(CH))
  );

  /* ── ⑤ effective 只排除 error，warn 保留 ── */
  console.log('');
  console.log('[5] effectiveSubEmitterTargets：只排除 error 档');
  const MIX = CFG([
    P('g', {
      subEmitters: [
        { target: 'good' },
        { target: 'nope' }, // error
        { target: 'zOut', trigger: 'birth' }, // warn（z 不同）
      ],
    }),
    P('good', { subOnly: true }),
    P('zOut', { position: { x: 0, y: 0, z: -1 }, subOnly: true }),
  ]);
  const mixT = effectiveSubEmitterTargets(MIX);
  chk(
    'error 的绑定被剔除、warn 的绑定保留',
    mixT.g &&
      mixT.g.length === 2 &&
      mixT.g.indexOf('nope') < 0 &&
      mixT.g.indexOf('zOut') >= 0,
    JSON.stringify(mixT)
  );

  /* ── ⑥ 缺省值 ── */
  console.log('');
  console.log(
    '[6] 缺省值：trigger=birth / inherit=[] / probability=1 / instances=4'
  );
  const DEF = CFG([
    P('g', { subEmitters: [{ target: 's' }] }),
    P('s', { subOnly: true }),
  ]);
  chk(
    '只给 target ⇒ 零警告（其余全走缺省）',
    validateSubEmitters(DEF).length === 0
  );

  /** `inherit: 'all'` / `'nothing'` 两种简写都要合法 */
  const ALL = CFG([
    P('g', { subEmitters: [{ target: 's', inherit: 'all' }] }),
    P('s', { subOnly: true }),
  ]);
  const NON = CFG([
    P('g', { subEmitters: [{ target: 's', inherit: 'nothing' }] }),
    P('s', { subOnly: true }),
  ]);
  chk("inherit = 'all' 合法", validateSubEmitters(ALL).length === 0);
  chk("inherit = 'nothing' 合法", validateSubEmitters(NON).length === 0);

  /** 5 个继承位全部接受 */
  const FIVE = ['color', 'size', 'rotation', 'lifetime', 'duration'];
  let fiveOk = true;
  for (const k of FIVE) {
    const one = CFG([
      P('g', { subEmitters: [{ target: 's', inherit: [k] }] }),
      P('s', { subOnly: true }),
    ]);
    if (validateSubEmitters(one).length !== 0) {
      fiveOk = false;
      console.log(`       （inherit "${k}" 被拒了）`);
    }
  }
  chk('5 个继承位逐个都接受（color/size/rotation/lifetime/duration）', fiveOk);

  /** 5 档 trigger：3 档直接可用，2 档报"未实现" */
  const T_OK = ['birth', 'death', 'manual'];
  let tok = true;
  for (const t of T_OK) {
    const one = CFG([
      P('g', { subEmitters: [{ target: 's', trigger: t as any }] }),
      P('s', { subOnly: true }),
    ]);
    if (validateSubEmitters(one).length !== 0) {
      tok = false;
      console.log(`       （trigger "${t}" 有警告）`);
    }
  }
  chk('trigger 的 birth / death / manual 三档可用（零警告）', tok);

  /** 不抛异常：畸形输入也要安全 */
  let threw = false;
  try {
    validateSubEmitters({} as any);
    validateSubEmitters({ meshes: null } as any);
    validateSubEmitters({
      meshes: [null, { type: 'texture', name: 'bg' }],
    } as any);
    validateSubEmitters({
      meshes: [P('a', { subEmitters: [null, {}, { target: null }] })],
    } as any);
  } catch (e) {
    threw = true;
    console.log('       threw: ' + e);
  }
  chk('畸形输入不抛异常（空 config / null mesh / null 绑定项）', !threw);

  /* ── ⑦ P5-a 的边界：未接线 ⇒ bundle 里不该出现校验器 ── */
  console.log('');
  console.log('[7] P5-a 边界：引擎尚未接线（bundle 里不应出现校验器字符串）');
  const bundle = path.join(ROOT, 'dist', 'bundle.js');
  if (fs.existsSync(bundle)) {
    const src = fs.readFileSync(bundle, 'utf8');
    chk(
      'dist/bundle.js 不含 "subOnly.unreferenced"（⇒ 校验器未进产物、对壁纸零影响）',
      src.indexOf('subOnly.unreferenced') < 0,
      '★ P5-b 接线后本条应改为反向断言'
    );
    chk(
      'dist/bundle.js 不含 "instanceMaxNum"',
      src.indexOf('instanceMaxNum') < 0
    );
  } else {
    console.log('   （dist/bundle.js 不存在 ⇒ 跳过；先 npm run build）');
  }

  console.log('');
  console.log('─'.repeat(78));
  console.log(`   结果：${pass} 通过 / ${fail} 失败`);
  console.log('─'.repeat(78));
  if (fail > 0) {
    process.exit(1);
  }
}

main();
