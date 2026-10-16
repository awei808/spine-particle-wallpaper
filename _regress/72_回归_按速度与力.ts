/**
 * 72 · 回归：**P2「按速度与力」**（Velocity z/orbital/radial、Force、
 * ColorBySpeed、SizeBySpeed、RotationBySpeed、InheritVelocity）
 *
 * ## 钉的是什么
 *
 * `docx/TODO.md` §2.5 / `docx/RESEARCH_粒子系统复刻参考.md` §8 的 **P2**：
 *
 *   ① `VelocityModule.z` —— 2D 下**不产生屏幕位移**，只进入速度大小 `|v|`；
 *   ② `VelocityModule.orbitalX/Y/Z` —— **弧度/秒**，绕 `orbitalOffset` 中心**旋转位置**
 *      （依据：官方 *"Orbital velocity of particles around the X, Y and Z axes"* +
 *      galacean `ParticleFeedback.shader` PR #3049 的 `rotationByEuler(rel, orbital·dt)`）；
 *   ③ `VelocityModule.radial` —— 沿"中心→粒子"方向推/拉（官方 *"Radial velocity of
 *      particles away from/towards the center position"*）；
 *   ④ `ForceModule` —— **加速度**（官方 *"Particles can be accelerated by forces"*），
 *      `Δv = a·dt`，`space` 决定要不要按节点旋角折算；
 *   ⑤ `ColorBySpeed` / `SizeBySpeed` / `RotationBySpeed` —— 同一条归一化式
 *      `rate = clamp((|v| − range[0]) / (range[1] − range[0]), 0, 1)`
 *      （feng3d 三处逐字同一个式子）；`RotationBySpeed` 的单位是**弧度/秒**且**取负号**
 *      （与 `rotationCurve` 同口径：Unity 屏幕自转角反号）；
 *   ⑥ `InheritVelocity` —— **只有 `simulationSpace = World(1)` 才生效**
 *      （ScriptReference 逐字：*"only has an effect if the Particle System is set to
 *      simulate in world space. If the system is simulating in local space, this module
 *      is ignored."*）；`Initial` 出生加一次、`Current` 每帧跟随；
 *   ⑦ **零回归**：以上全部**缺省关闭**，旧 config 必须逐位不变。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/72_回归_按速度与力.ts [config路径]
 *
 * 路径解析规则见 `_regress/README.md`。脚本拿 config 里**第一条**真实粒子记录当基底，
 * 再把要测的字段覆盖掉（与 `70_`/`71_` 同一手法）。
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * `@src/*` 是出货代码用的 webpack alias，ts-node 裸跑不认识 ⇒ 补一条解析规则。
 * ⚠️ 必须在 `require` ParticleAnimator **之前**生效，所以下面刻意用 `require`。
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
const THREE = require('three');
const { ParticleAnimator } = require(path.join(ROOT, 'src', 'animator', 'ParticleAnimator'));

const DEG = Math.PI / 180;

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
  console.log(`   [${cond ? 'OK  ' : '★!  '}] ${label}${detail ? '   ' + detail : ''}`);
}
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

/** 常量 MinMaxCurve（本脚本合成用） */
const K = (a: number) => ({ mode: 0, a, b: a });
/** 速度区间（prefab 单位/秒；本脚本把 localScale/unitScale 都设成 1 ⇒ 与世界单位同值） */
const DT = 0.05;

/**
 * 造一条"干净"的基底：把会掺进来的其它模块全部关掉，
 * 只留被测的那一个，否则量不出"是不是它干的"。
 */
function makeBase(real: any) {
  const c: any = JSON.parse(JSON.stringify(real));
  c.name = 'p2base'; // 固定：rng 种子 = f(name.length)，各变体必须同名才好逐位比较
  c.localScale = 1;
  c.unitScale = 1;
  c.sizeScale = 1;
  c.nodeRotZ = 0;
  c.emitDir = [1, 0];
  c.startDelay = 0;
  c.cycleSec = 1;
  c.looping = false;
  c.autoplay = true;
  c.prewarm = false;
  c.maxNumParticles = 8;
  c.gravityModifier = 0;
  c.startLifetime = K(1e6);
  c.startSpeed = K(0);
  c.startSize = K(100);
  c.startSizeY = K(100);
  c.startSizeZ = K(100);
  c.size3D = false;
  c.startRotation = K(0);
  c.rotationEnabled = false;
  c.rotationCurve = K(0);
  c.sizeModule = { enabled: false, curve: K(1) };
  c.colorModule = { enabled: false, alphaKeys: [], alphaSource: 'test' };
  c.clamp = { enabled: false, magnitude: K(1), dampen: 0 };
  c.noise = { enabled: false, strength: 0, frequency: 0, gain: 0, positionAmount: 0 };
  c.trail = { enabled: false };
  c.customData = { enabled: false };
  c.uv = { enabled: false, tilesX: 1, tilesY: 1, cycles: 1, animationType: 0,
           frameOverTime: null, driftX: 0, driftY: 0, wrap: 'clamp' };
  c.emission = { rateOverTime: K(0), bursts: [{ time: 0, count: K(1) }] };
  /**
   * ★ 把 P2 六个模块**全部显式清零**（而不是"留着真实记录里可能存在的值"）：
   *   基底必须是干净的，否则"是不是被测模块干的"就分不清 —— 例如 S8 的 `trail01`
   *   自带 `VOL.x = 150~300`，不关掉它，`spd` 里就混进了 179 的速度，
   *   第 [1] 组的"z 为 0 ⇒ spd 等于 2D 速度"这条恒等式会假红。
   */
  c.velocity = { enabled: false, x: K(0), y: K(0), speedModifier: 1 };
  delete c.force;
  delete c.inheritVelocity;
  delete c.colorBySpeed;
  delete c.sizeBySpeed;
  delete c.rotationBySpeed;
  /** `startColor` 也要归 1：S6 的首条记录带 `startColorGradient`（逐粒子抽色），
   *  不归 1 的话第 [5] 组"颜色乘 0.5"读到的就不是 0.5 而是 0.5×抽到的颜色。 */
  delete c.startColorGradient;
  c.startColor = [1, 1, 1, 1];
  // ★ 半径 100、`radiusThickness = 0` ⇒ **每颗粒子都恰好在半径 100 上**；
  //   `arc = 0` ⇒ 方位角恒 0 ⇒ 出生点恒为 (100, 0)。轨道/径向用例靠它取确定初值。
  c.shape = { enabled: true, type: 10, radius: 100, radiusThickness: 0,
              arc: 0, arcMode: 0, boxX: 1, boxY: 1, offsetX: 0, offsetY: 0, rotZ: 0 };
  return c;
}

/** 跑 `n` 帧，返回第 0 颗粒子的状态 + 渲染真值（几何缓冲里读出来的） */
function run(cfg: any, n: number) {
  const a: any = new ParticleAnimator(cfg, new THREE.Texture());
  for (let i = 0; i < n; i++) {
    a.update(DT);
  }
  const p = a.particles[0];
  const pos = a.geometry.getAttribute('position').array;
  const col = a.geometry.getAttribute('aStartCol').array;
  const alpha = a.geometry.getAttribute('aAlpha').array;
  return {
    anim: a,
    p,
    verts: a.geometry.drawRange.count,
    /** quad 半宽 / 半高（顶点 0 与顶点 2 是对角；rot = 0 时可直接相减） */
    hw: (pos[2 * 3 + 0] - pos[0]) / 2,
    hh: (pos[2 * 3 + 1] - pos[1]) / 2,
    col: [col[0], col[1], col[2], col[3]],
    alpha: alpha[0],
  };
}

function main() {
  console.log('='.repeat(78));
  console.log('72 · P2「按速度与力」回归（z / orbital / radial / Force / 三个 by-speed / Inherit）');
  console.log('='.repeat(78));
  console.log(`   config  ${cfgPath}`);

  if (!fs.existsSync(cfgPath)) {
    console.log('   ★! config 不存在 —— 先跑构建链（或传一个存在的 config 路径）');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const parts: any[] = (cfg.meshes || []).filter((m: any) => m.type === 'particle');
  if (!parts.length) {
    console.log('   ★! 该 config 里没有粒子组 —— 换一个工程再跑');
    process.exit(1);
  }
  const real = parts[0];
  console.log(`   基底记录：${real.name}（localScale=${real.localScale} unitScale=${real.unitScale}）`);
  console.log('   ⚠️ 合成用的基底把 localScale/unitScale 都设为 1 ⇒ prefab 单位 == 世界单位');

  const BASE = makeBase(real);
  const N = 20; // 20 × 0.05 s = 1 s

  /* ── ① 零回归：旧 config（无 P2 字段）与"字段齐但全关"必须逐位相同 ── */
  console.log('');
  console.log('[1] 零回归：无 P2 字段  ≡  有字段但全部关闭');
  const R0 = run(BASE, N);
  chk('跑出了粒子', !!R0.p && R0.verts >= 6, `verts=${R0.verts}`);
  chk('z 恒 0（未开 z 类模块）', R0.p.z === 0, `z=${R0.p.z}`);
  chk('vz 恒 0', R0.p.vz === 0, `vz=${R0.p.vz}`);
  chk(
    'spd 与 2D 速度逐位相同（z 为 0 ⇒ 不引入误差）',
    R0.p.spd === Math.sqrt(R0.p.vx * R0.p.vx + R0.p.vy * R0.p.vy),
    `spd=${R0.p.spd} vx=${R0.p.vx} vy=${R0.p.vy}`
  );

  const OFF = JSON.parse(JSON.stringify(BASE));
  OFF.velocity = Object.assign({}, BASE.velocity, { z: K(0), space: 0,
    orbitalX: K(0), orbitalY: K(0), orbitalZ: K(0),
    orbitalOffsetX: 0, orbitalOffsetY: 0, orbitalOffsetZ: 0, radial: K(0) });
  OFF.force = { enabled: false, x: K(0), y: K(0), z: K(0), space: 0 };
  OFF.inheritVelocity = { enabled: false, mode: 0, curve: K(1),
    emitterVelocity: [0, 0], simulationSpace: 0 };
  OFF.colorBySpeed = { enabled: false, colorKeys: [], alphaKeys: [], range: [0, 1] };
  OFF.sizeBySpeed = { enabled: false, curve: K(1), y: K(1), range: [0, 1] };
  OFF.rotationBySpeed = { enabled: false, curve: K(0), range: [0, 1] };
  const R1 = run(OFF, N);
  chk(
    '全关配置与裸配置逐位相同（x/y/z/vx/vy/vz/rot/spd）',
    R0.p.x === R1.p.x && R0.p.y === R1.p.y && R0.p.z === R1.p.z &&
      R0.p.vx === R1.p.vx && R0.p.vy === R1.p.vy && R0.p.vz === R1.p.vz &&
      R0.p.rot === R1.p.rot && R0.p.spd === R1.p.spd,
    `x ${R0.p.x} vs ${R1.p.x}；spd ${R0.p.spd} vs ${R1.p.spd}`
  );
  /** "有值但 enabled=false" 也必须短路（模块关闭时字段值是序列化残留） */
  const OFF2 = JSON.parse(JSON.stringify(OFF));
  OFF2.force = { enabled: false, x: K(999), y: K(999), space: 0 };
  OFF2.rotationBySpeed = { enabled: false, curve: K(Math.PI), range: [0, 1] };
  OFF2.sizeBySpeed = { enabled: false, curve: K(50), range: [0, 1] };
  const R2 = run(OFF2, N);
  chk(
    '关闭模块的残留值不生效（force=999 / rbs=π / sbs=50）',
    R2.p.x === R0.p.x && R2.p.y === R0.p.y && R2.p.rot === R0.p.rot &&
      R2.hw === R0.hw,
    `x ${R2.p.x} vs ${R0.p.x}；hw ${R2.hw} vs ${R0.hw}`
  );

  /* ── ② Velocity.z ── */
  console.log('');
  console.log('[2] VelocityModule.z：不产生屏幕位移、只进 |v|');
  const VZ = JSON.parse(JSON.stringify(BASE));
  VZ.velocity = Object.assign({}, BASE.velocity, { enabled: true, z: K(10), x: K(0), y: K(0) });
  const RZ = run(VZ, N);
  chk('z 位移 = 10 × 1s', near(RZ.p.z, 10, 1e-6), `z=${RZ.p.z}`);
  chk('x/y **不受 z 影响**（2D 渲染：z 只演算不入画）',
    RZ.p.x === R0.p.x && RZ.p.y === R0.p.y, `x=${RZ.p.x} y=${RZ.p.y}`);
  chk('spd = 10（z 进了速度大小）', near(RZ.p.spd, 10, 1e-6), `spd=${RZ.p.spd}`);

  /* ── ③ Force over Lifetime ── */
  console.log('');
  console.log('[3] ForceModule：加速度 ⇒ Δv = a·dt，位置按半隐式欧拉');
  const FO = JSON.parse(JSON.stringify(BASE));
  FO.velocity = Object.assign({}, BASE.velocity, { enabled: false });
  FO.force = { enabled: true, x: K(10), y: K(0), space: 0 };
  const RF = run(FO, N);
  // v = a·t；x = Σ (a·k·dt)·dt = a·dt²·n(n+1)/2
  // ⚠️ 出生点在 (100, 0)（circle radius=100 / radiusThickness=0 / arc=0）⇒ 比的是**位移**
  const xExp = 10 * DT * DT * (N * (N + 1)) / 2;
  chk('vx = a·t = 10', near(RF.p.vx, 10, 1e-9), `vx=${RF.p.vx}`);
  chk('vy 恒 0', RF.p.vy === 0, `vy=${RF.p.vy}`);
  chk(
    `位移 = a·dt²·n(n+1)/2 = ${xExp.toFixed(4)}`,
    near(RF.p.x - 100, xExp, 1e-6),
    `Δx=${(RF.p.x - 100).toFixed(6)}`
  );

  /** `space = 1`(World) 与 Local 的差别：盒形分支会给出 `localRot = nodeRotZ`
   *  ⇒ Local 下 (10,0) 要转成 (0,10)，World 下保持 (10,0)。 */
  const FOL = JSON.parse(JSON.stringify(FO));
  FOL.shape = Object.assign({}, BASE.shape, { type: 5, radius: 100 }); // Box ⇒ localRot = nodeRotZ
  FOL.nodeRotZ = 90;
  FOL.force = { enabled: true, x: K(10), y: K(0), space: 0 };
  const RFL = run(FOL, N);
  const FOW = JSON.parse(JSON.stringify(FOL));
  FOW.force = { enabled: true, x: K(10), y: K(0), space: 1 };
  const RFW = run(FOW, N);
  chk('Local 空间：力按节点旋角折算（x 轴力 → 世界 +y）',
    near(RFL.p.vy, 10, 1e-9) && near(RFL.p.vx, 0, 1e-9),
    `vx=${RFL.p.vx} vy=${RFL.p.vy}`);
  chk('World 空间：力**不**折算（x 轴力仍是世界 +x）',
    near(RFW.p.vx, 10, 1e-9) && near(RFW.p.vy, 0, 1e-9),
    `vx=${RFW.p.vx} vy=${RFW.p.vy}`);

  /* ── ④ orbital / radial ── */
  console.log('');
  console.log('[4] orbital / radial：绕 orbitalOffset 中心转 + 沿径向推');
  const OR = JSON.parse(JSON.stringify(BASE));
  OR.velocity = Object.assign({}, BASE.velocity, {
    enabled: true, x: K(0), y: K(0), z: K(0),
    orbitalZ: K(Math.PI / 2), // 90°/s
  });
  const ROR = run(OR, N);
  // 出生恒在 (100,0)，绕原点转 90°/s × 1s ⇒ (0,100)
  chk('orbitalZ = π/2 rad/s ⇒ 1s 后 (100,0) → (0,100)',
    near(ROR.p.x, 0, 1e-3) && near(ROR.p.y, 100, 1e-3),
    `x=${ROR.p.x.toFixed(4)} y=${ROR.p.y.toFixed(4)}`);
  chk('半径守恒（纯旋转不改 |r|）', near(Math.hypot(ROR.p.x, ROR.p.y), 100, 1e-3),
    `|r|=${Math.hypot(ROR.p.x, ROR.p.y).toFixed(4)}`);

  const RA = JSON.parse(JSON.stringify(BASE));
  RA.velocity = Object.assign({}, BASE.velocity, {
    enabled: true, x: K(0), y: K(0), z: K(0), radial: K(50),
  });
  const RRA = run(RA, N);
  chk('radial = 50 ⇒ 1s 后半径 100 → 150，方向不变',
    near(RRA.p.x, 150, 1e-3) && near(RRA.p.y, 0, 1e-3),
    `x=${RRA.p.x.toFixed(4)} y=${RRA.p.y.toFixed(4)}`);

  const RA2 = JSON.parse(JSON.stringify(RA));
  RA2.velocity.radial = K(-50);
  const RRA2 = run(RA2, N);
  chk('radial 取负 ⇒ 朝中心收（100 → 50）', near(RRA2.p.x, 50, 1e-3),
    `x=${RRA2.p.x.toFixed(4)}`);

  /**
   * 轨道中心偏移：中心 = (0,100)，粒子 (100,0) ⇒ rel = (100,−100)；
   * 绕中心逆时针转 90° ⇒ rel' = (100,100) ⇒ 新位置 = (0,100) + (100,100) = **(100,200)**。
   * （这一条同时钉住"绕的是 offset 而不是原点"——若误绕原点会得到 (0,100)。）
   */
  const OF = JSON.parse(JSON.stringify(OR));
  OF.velocity = Object.assign({}, OR.velocity, { orbitalOffsetY: 100 });
  const ROF = run(OF, N);
  chk('orbitalOffset：绕 (0,100) 转 90° ⇒ (100,0) → (100,200)（不是绕原点）',
    near(ROF.p.x, 100, 1e-3) && near(ROF.p.y, 200, 1e-3),
    `x=${ROF.p.x.toFixed(4)} y=${ROF.p.y.toFixed(4)}`);

  /* ── ⑤ 三个 by-speed 的 rate 归一化 ── */
  console.log('');
  console.log('[5] ColorBySpeed / SizeBySpeed / RotationBySpeed：同一条 rate 归一化');
  // 速度 5（区间 [0,10] ⇒ rate = 0.5）
  const SPD5 = JSON.parse(JSON.stringify(BASE));
  SPD5.velocity = Object.assign({}, BASE.velocity, { enabled: true, x: K(5), y: K(0) });
  const CBS = JSON.parse(JSON.stringify(SPD5));
  CBS.colorBySpeed = {
    enabled: true,
    colorKeys: [[0, [0, 0, 0]], [1, [1, 1, 1]]],
    alphaKeys: [[0, 0], [1, 1]],
    range: [0, 10],
  };
  const RC = run(CBS, 1);
  chk('rate = 0.5 ⇒ rgb 乘 0.5', near(RC.col[0], 0.5, 1e-6) && near(RC.col[1], 0.5, 1e-6),
    `rgb=${RC.col.slice(0, 3).map((v: number) => v.toFixed(4)).join(',')}`);
  chk('rate = 0.5 ⇒ alpha 乘 0.5', near(RC.col[3], 0.5, 1e-6), `a=${RC.col[3]}`);

  /** 速度低于下界 ⇒ rate 0；高于上界 ⇒ rate 1（钳位） */
  const CBS_LO = JSON.parse(JSON.stringify(SPD5));
  CBS_LO.velocity.x = K(0);
  CBS_LO.colorBySpeed = CBS.colorBySpeed;
  const RCL = run(CBS_LO, 1);
  const CBS_HI = JSON.parse(JSON.stringify(SPD5));
  CBS_HI.velocity.x = K(20);
  CBS_HI.colorBySpeed = CBS.colorBySpeed;
  const RCH = run(CBS_HI, 1);
  chk('|v| < range[0] ⇒ rate = 0（颜色乘 0）', near(RCL.col[0], 0, 1e-6), `r=${RCL.col[0]}`);
  chk('|v| > range[1] ⇒ rate = 1（颜色乘 1）', near(RCH.col[0], 1, 1e-6), `r=${RCH.col[0]}`);

  /** SizeBySpeed 是**倍率**：恒定 2 ⇒ quad 半宽翻倍 */
  const SBS = JSON.parse(JSON.stringify(SPD5));
  SBS.sizeBySpeed = { enabled: true, curve: K(2), range: [0, 10] };
  const RS = run(SBS, 1);
  const RS0 = run(SPD5, 1);
  chk('SizeBySpeed = 2 ⇒ 半宽 ×2（且与不开时逐位对得上）',
    near(RS.hw, RS0.hw * 2, 1e-6), `hw ${RS.hw} vs 基线 ${RS0.hw}`);
  chk('不分轴 ⇒ y 同倍率（feng3d：y = z = x）', near(RS.hh, RS0.hh * 2, 1e-6),
    `hh ${RS.hh} vs 基线 ${RS0.hh}`);

  /** RotationBySpeed：π/4 rad/s，1s ⇒ 转 45°，且**取负号**（屏幕自转角反号） */
  const RBS = JSON.parse(JSON.stringify(SPD5));
  RBS.rotationBySpeed = { enabled: true, curve: K(Math.PI / 4), range: [0, 10] };
  const RR = run(RBS, N);
  chk('RotationBySpeed = π/4 rad/s ⇒ 1s 转 −45°（取负号）',
    near(RR.p.rot / DEG, -45, 1e-6), `rot=${(RR.p.rot / DEG).toFixed(4)}°`);

  /* ── ⑥ InheritVelocity ── */
  console.log('');
  console.log('[6] InheritVelocity：Local 下**整个被忽略**，World 下 Initial / Current 两态');
  const IVL = JSON.parse(JSON.stringify(BASE));
  IVL.inheritVelocity = { enabled: true, mode: 0, curve: K(1),
    emitterVelocity: [10, 20], simulationSpace: 0 }; // Local
  const RIVL = run(IVL, 1);
  chk('simulationSpace = Local ⇒ 完全不生效（官方逐字）',
    RIVL.p.vx === R0.p.vx && RIVL.p.vy === R0.p.vy,
    `vx=${RIVL.p.vx}（裸 ${R0.p.vx}）vy=${RIVL.p.vy}（裸 ${R0.p.vy}）`);

  const IVI = JSON.parse(JSON.stringify(IVL));
  IVI.inheritVelocity.simulationSpace = 1; // World
  const RIVI = run(IVI, 1);
  chk('World + Initial ⇒ 出生时速度 +emitterVelocity',
    near(RIVI.p.vx, 10, 1e-9) && near(RIVI.p.vy, 20, 1e-9),
    `vx=${RIVI.p.vx} vy=${RIVI.p.vy}`);

  const IVC = JSON.parse(JSON.stringify(IVI));
  IVC.inheritVelocity.mode = 1; // Current
  const RIVC = run(IVC, N);
  chk('World + Current ⇒ 每帧位移 +emitterVel·dt（1s ⇒ Δx+10 / Δy+20），速度不变',
    near(RIVC.p.x - 100, 10, 1e-6) && near(RIVC.p.y, 20, 1e-6) && RIVC.p.vx === 0,
    `Δx=${(RIVC.p.x - 100).toFixed(4)} y=${RIVC.p.y.toFixed(4)} vx=${RIVC.p.vx}`);

  /** `curve` 倍率：0.5 ⇒ 只继承一半 */
  const IVH = JSON.parse(JSON.stringify(IVI));
  IVH.inheritVelocity.curve = K(0.5);
  const RIVH = run(IVH, 1);
  chk('curve = 0.5 ⇒ 只继承一半速度',
    near(RIVH.p.vx, 5, 1e-9) && near(RIVH.p.vy, 10, 1e-9),
    `vx=${RIVH.p.vx} vy=${RIVH.p.vy}`);

  /* ── ⑦ 真实记录（原样跑，不改写）── */
  console.log('');
  console.log('[7] 真实记录原样跑：z / vz 必为 0，且"渲染真值"没被打坏');
  const REAL = JSON.parse(JSON.stringify(real));
  REAL.prewarm = false;
  const RREAL = run(REAL, 30);
  let allZero = true;
  for (const q of RREAL.anim.particles) {
    if (q.z !== 0 || q.vz !== 0) allZero = false;
  }
  chk('真实记录：所有粒子 z / vz 恒 0（P2 未掺入既有行为）', allZero);
  chk('真实记录：仍有粒子在跑', RREAL.anim.particles.length > 0,
    `count=${RREAL.anim.particles.length}`);
  /**
   * 关掉 VOL 后，`spd` **必须逐位等于** 2D 速度长度 —— 这直接钉住
   * "新加的 z 项没有往既有系统里掺东西"（vz 与 volZ 都恒 0）。
   * ⚠️ 不能拿开着 VOL 的真实记录直接比 2D 长度：VOL 是瞬时增量、本来就该算进 |v|。
   */
  const REAL_NV = JSON.parse(JSON.stringify(REAL));
  if (REAL_NV.velocity) REAL_NV.velocity.enabled = false;
  /**
   * ⚠️ 还得关掉 `clamp`：`ClampVelocityModule` 在 `spd` **算完之后**才去缩放 `p.vx/vy`
   *   （`step()` 里的 4.27 → 4.4 顺序）⇒ 开着它，`p.vx` 已经不是取 `spd` 时的那个值了，
   *   这条恒等式就观察不到。`qiqiu` / `niao` 都开了 clamp，所以必须关。
   */
  if (REAL_NV.clamp) REAL_NV.clamp.enabled = false;
  const RN = run(REAL_NV, 30);
  chk('真实记录关掉 VOL+clamp 后：spd 逐位 = hypot(vx, vy+gvy)',
    RN.anim.particles.length > 0 &&
      RN.anim.particles.every(
        (q: any) => Math.abs(q.spd - Math.hypot(q.vx, q.vy + q.gvy)) <= 1e-9
      ),
    `样本 spd=${RN.anim.particles.map((q: any) => q.spd.toFixed(3)).join(',')}`);

  console.log('');
  console.log('─'.repeat(78));
  console.log(`   结果：${pass} 通过 / ${fail} 失败`);
  console.log('─'.repeat(78));
  if (fail > 0) process.exit(1);
}

main();
