/**
 * 73 · 回归：**P3「补渲染侧」**（ParticleSystemRenderer）
 *
 * ## 钉的是什么（`docx/TODO.md` §2.9 / `docx/RESEARCH_粒子系统复刻参考.md` §4.12~§4.13）
 *
 *   ① **renderMode 五档**（官方 Renderer module 逐字）：
 *      · `0 Billboard`   *"The particle always faces the Camera."*      ⇒ 轴对齐（现状）
 *      · `1 Stretched`   *"faces the Camera but with various scaling applied"*；
 *        手册 2021.2+ 硬补充 *"particles are aligned to face the Camera **and also aligned
 *        to their velocity**. This alignment occurs **regardless of the Velocity Scale
 *        value**"* ⇒ **长轴沿速度**；
 *      · `2 Horizontal`  *"The particle plane is parallel to the XZ 'floor' plane."*
 *        ⇒ 正视相机下**投影面积为 0**；
 *      · `3 Vertical`    *"upright on the world Y-axis, but turns to face the Camera"*
 *        ⇒ 正视相机下**等价 Billboard**；
 *      · `4 Mesh`        *"rendered from a 3D Mesh instead of a Texture."*
 *      · `5 None`        *"…if you want to only render the trails and hide the default rendering"*；
 *   ② **alignment** —— View/World/Local/Facing 在**本引擎相机（无 roll / 无俯角 / 无偏航）**
 *      下投影等价；`Velocity` 改为朝向速度方向（唯一有实感的一档）；
 *   ③ **pivot** —— ScriptReference 逐字 *"multiplier of the particle sizes, **relative to
 *      their diameters**"* ⇒ 枢轴偏移 = `pivot × 直径`。★ **2026-10-25 实录更正**
 *      （TODO §1.7 D2）：锚点 = quad 上距中心 −pivot×尺寸 的点，**钉在粒子位置上**
 *      —— ang=0 时 quad 静态偏移 +pivot×直径（S6 hua01/hua02 的 [0,+0.5,0] ⇒ 花
 *      上移半直径），自转绕锚点刚体旋转；`pivot = 0` ⇒ 中心钉在位置上（绕中心）；
 *   ④ **sortingFudge × fudgeToZ** —— 官方 *"only affects where an **entire system** appears
 *      in the scene"* ⇒ 只动 `mesh.position.z`（缺省 `fudgeToZ = 0` ⇒ 不动）；
 *   ⑤ `allowRoll` / `flip` / `min·maxParticleSize`；
 *   ⑥ **零回归**：整段 `renderer` **缺省不声明** ⇒ 与 P3 之前逐位相同。
 *
 * ## 相机口径
 *
 * 脚本在 node 下裸跑，`initScene` 未初始化 ⇒ `Scene.camera === null` ⇒ 引擎回落到
 * `CAM_IDENTITY`（right = (1,0,0)、up = (0,1,0)），也就是**正视相机**。
 * 本工程实机同样如此（`camera.position = (cameraX, camY, 0)`、未做 `lookAt`）。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/73_回归_渲染侧.ts [config路径]
 *
 * 路径解析规则见 `_regress/README.md`。
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

/** 常量 MinMaxCurve */
const K = (a: number) => ({ mode: 0, a, b: a });
const DT = 0.05;

/**
 * 造一条"干净"的基底：尺寸统一 100（⇒ 半轴 50，便于手算）、
 * 出生点固定在 **(100, 0)**（圆形发射器 radius=100、thickness=0、arc=0 ⇒ 方位角恒 0）。
 */
function makeBase(real: any) {
  const c: any = JSON.parse(JSON.stringify(real));
  c.name = 'p3base';
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
  c.maxNumParticles = 4;
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
  c.startColor = [1, 1, 1, 1];
  delete c.startColorGradient;
  c.clamp = { enabled: false, magnitude: K(1), dampen: 0 };
  c.noise = { enabled: false, strength: 0, frequency: 0, gain: 0, positionAmount: 0 };
  c.trail = { enabled: false };
  c.customData = { enabled: false };
  c.uv = {
    enabled: false, tilesX: 1, tilesY: 1, cycles: 1, animationType: 0,
    frameOverTime: null, driftX: 0, driftY: 0, wrap: 'clamp',
  };
  c.emission = { rateOverTime: K(0), bursts: [{ time: 0, count: K(1) }] };
  c.velocity = { enabled: false, x: K(0), y: K(0), speedModifier: 1 };
  delete c.force;
  delete c.inheritVelocity;
  delete c.colorBySpeed;
  delete c.sizeBySpeed;
  delete c.rotationBySpeed;
  delete c.renderer;
  c.groupRotation = undefined;
  /** 固定 z，便于断言 sortingFudge 的偏移量 */
  c.position = { x: 0, y: 0, z: -1000 };
  c.shape = {
    enabled: true, type: 10, radius: 100, radiusThickness: 0,
    arc: 0, arcMode: 0, boxX: 1, boxY: 1, offsetX: 0, offsetY: 0, rotZ: 0,
  };
  return c;
}

/**
 * 跑 `n` 帧。
 * ⚠️ 取的是**第 0 颗粒子的前 6 个顶点**（不是全局包围盒）—— birst 可能每帧发一粒，
 *   各粒子出生时刻不同 ⇒ 位移不同 ⇒ 全局包围盒会把它们混在一起。
 */
function run(cfg: any, n: number) {
  const a: any = new ParticleAnimator(cfg, new THREE.Texture());
  for (let i = 0; i < n; i++) {
    a.update(DT);
  }
  const pos = a.geometry.getAttribute('position').array;
  const uvv = a.geometry.getAttribute('uv').array;
  const cnt = a.geometry.drawRange.count;
  const nv = Math.min(6, cnt);
  const vs: number[][] = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    vs.push([x, y]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return {
    anim: a,
    p: a.particles[0],
    cnt,
    vs,
    box: { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, cy: (y0 + y1) / 2 },
    uv0: cnt > 0 ? [uvv[0], uvv[1]] : null,
    z: a.mesh.position.z,
  };
}

/** 逐位比较两次运行的"渲染真值"（前 18 个 pos + uv + alpha + 粒子状态） */
function sameGeom(A: any, B: any): boolean {
  if (A.cnt !== B.cnt) {
    return false;
  }
  const pa = A.anim.geometry.getAttribute('position').array;
  const pb = B.anim.geometry.getAttribute('position').array;
  const ua = A.anim.geometry.getAttribute('uv').array;
  const ub = B.anim.geometry.getAttribute('uv').array;
  for (let i = 0; i < A.cnt; i++) {
    if (pa[i * 3] !== pb[i * 3] || pa[i * 3 + 1] !== pb[i * 3 + 1]) {
      return false;
    }
    if (ua[i * 2] !== ub[i * 2] || ua[i * 2 + 1] !== ub[i * 2 + 1]) {
      return false;
    }
  }
  return true;
}

function main() {
  console.log('='.repeat(78));
  console.log('73 · P3「补渲染侧」回归（renderMode / alignment / pivot / sortingFudge / flip / Mesh）');
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
  console.log(`   基底记录：${real.name}`);
  console.log('   ⚠️ 合成基底把 localScale/unitScale 都设为 1 ⇒ prefab 单位 == 世界单位');
  console.log('   ⚠️ node 下无相机 ⇒ 引擎回落 CAM_IDENTITY = **正视相机**（与本工程实机同）');

  const BASE = makeBase(real);
  const N = 3;

  /* ── ① 零回归：无 renderer 段 ≡ 全默认 renderer 段 ── */
  console.log('');
  console.log('[1] 零回归：无 `renderer` ≡ 有但全默认');
  const R0 = run(BASE, N);
  chk('跑出了粒子', !!R0.p && R0.cnt >= 6, `cnt=${R0.cnt}`);
  chk('尺寸 100×100（半轴 50）', near(R0.box.w, 100, 1e-6) && near(R0.box.h, 100, 1e-6),
    `w=${R0.box.w} h=${R0.box.h}`);

  const DEF = JSON.parse(JSON.stringify(BASE));
  DEF.renderer = {
    renderMode: 0, alignment: 0, pivot: [0, 0, 0],
    velocityScale: 0, lengthScale: 0, allowRoll: true, flip: [0, 0, 0],
    sortingFudge: 0, fudgeToZ: 0,
  };
  const R1 = run(DEF, N);
  chk('全默认 renderer 段 ⇒ 与无该段**逐位相同**', sameGeom(R0, R1) && R0.z === R1.z,
    `z ${R0.z} vs ${R1.z}`);

  /* ── ② Billboard / Horizontal / Vertical 三档的朝向 ── */
  console.log('');
  console.log('[2] renderMode：Billboard(0) / Horizontal(2) / Vertical(3)');

  const BIL = JSON.parse(JSON.stringify(BASE));
  BIL.renderer = { renderMode: 0 };
  const RB = run(BIL, N);
  chk('Billboard ⇒ 仍与基线逐位相同', sameGeom(R0, RB));

  const HOR = JSON.parse(JSON.stringify(BASE));
  HOR.renderer = { renderMode: 2 };
  const RH = run(HOR, N);
  chk('Horizontal：平面 ⊥ 视线 ⇒ **高度为 0**（不可见）', RH.box.h === 0, `h=${RH.box.h}`);
  chk('Horizontal：宽度仍为 sizeX = 100', near(RH.box.w, 100, 1e-6), `w=${RH.box.w}`);

  const VER = JSON.parse(JSON.stringify(BASE));
  VER.renderer = { renderMode: 3 };
  const RV = run(VER, N);
  chk('Vertical：正视相机下 **≡ Billboard**（逐位）', sameGeom(R0, RV));

  /* ── ③ pivot：锚点钉在粒子位置上（2026-10-25 实录更正，TODO §1.7 D2）── */
  console.log('');
  console.log('[3] pivot（**直径的倍数** · 锚点 = 距中心 −pivot×尺寸 的点，钉在粒子位置上）');
  const ROT90 = Math.PI / 2;
  const PR = JSON.parse(JSON.stringify(BASE));
  PR.startRotation = K(ROT90);
  PR.renderer = { pivot: [0, 0, 0] };
  const RP0 = run(PR, N);
  /**
   * ⚠️ `startRotation` 进引擎后**取负号** —— Unity 的粒子自转角在屏幕上与解包值反号
   *   （左手系 / View 对齐，见 `ParticleAnimator.spawn()` 处说明）⇒ 期望 −π/2。
   */
  chk('startRotation = π/2 生效（引擎内取负号 ⇒ −π/2）',
    near(RP0.p.rot, -ROT90, 1e-6), `rot=${RP0.p.rot}`);
  chk('pivot = 0 ⇒ 中心钉在位置上（包围盒中心不偏）',
    near(RP0.box.cy, RP0.p.y, 1e-6), `Δ=${RP0.box.cy - RP0.p.y}`);

  /**
   * ★ 更正前的断言是「pivot=[0,0.5] ⇒ 枢轴抬到顶端（90° 时 Δcy=+50）」——那是旧式
   *   `中心 + o + R·(c − o)` 的行为：静态平移在 ang=0 时 +o/−o 抵消、只在旋转时显形。
   *   S6 实录证实 Unity 里 pivot=[0,+0.5,0] 让花**静态上移半直径**（生成器烘焙
   *   `y += pivot[1]×size` 已对齐实录），故改为下面两条：静态上移 + 绕锚点刚体旋转。
   */
  const PRS = JSON.parse(JSON.stringify(BASE));
  PRS.startRotation = K(0);
  PRS.renderer = { pivot: [0, 0.5, 0] };
  const RPS = run(PRS, N);
  chk('pivot = [0,0.5] · ang=0 ⇒ quad **静态上移**半直径（底边钉在位置上，实录口径）',
    near(RPS.box.cy - RPS.p.y, 50, 1e-3) && near(RPS.box.y0, RPS.p.y, 1e-3),
    `Δcy=${RPS.box.cy - RPS.p.y} y0=${RPS.box.y0}`);
  chk('pivot 不改变尺寸（仍是 100×100）',
    near(RPS.box.w, 100, 1e-6) && near(RPS.box.h, 100, 1e-6),
    `w=${RPS.box.w} h=${RPS.box.h}`);

  const PR5 = JSON.parse(JSON.stringify(BASE));
  PR5.startRotation = K(ROT90);
  PR5.renderer = { pivot: [0, 0.5, 0] };
  const RP5 = run(PR5, N);
  chk('pivot = [0,0.5] · ang=90° ⇒ 绕**锚点（底边）**刚体转（quad 转到锚点右侧、上下对称）',
    near(RP5.box.cy - RP5.p.y, 0, 1e-3) &&
      near((RP5.box.x0 + RP5.box.x1) / 2 - RP5.p.x, 50, 1e-3),
    `Δcy=${RP5.box.cy - RP5.p.y} Δcx=${(RP5.box.x0 + RP5.box.x1) / 2 - RP5.p.x}`);
  chk('pivot 不改变尺寸（旋转后仍是 100×100）',
    near(RP5.box.w, 100, 1e-6) && near(RP5.box.h, 100, 1e-6),
    `w=${RP5.box.w} h=${RP5.box.h}`);

  /* ── ④ Stretched：长轴沿速度 ── */
  console.log('');
  console.log('[4] Stretched(1)：官方「随速度对齐」⇒ **长轴沿速度**');
  const ST = JSON.parse(JSON.stringify(BASE));
  ST.startSpeed = K(200);
  ST.renderer = { renderMode: 1, velocityScale: 0.5, lengthScale: 1 };
  const RST = run(ST, N);
  /**
   * 速度 = 200 沿 +X（圆形发射器 arc=0 ⇒ 方位角恒 0 ⇒ 径向 +X）
   * 长度 = |v|·velocityScale + lengthScale·size = 200×0.5 + 1×100 = **200**
   * 宽度 = size = 100
   */
  chk('速度沿 +X ⇒ 长轴沿 X（200×100）',
    near(RST.box.w, 200, 1e-3) && near(RST.box.h, 100, 1e-3),
    `w=${RST.box.w} h=${RST.box.h}`);

  const STY = JSON.parse(JSON.stringify(ST));
  STY.shape.rotZ = 90; // 度：把发射方向整体转 90° ⇒ 速度沿 +Y
  const RSTY = run(STY, N);
  chk('速度转 90° ⇒ 长轴跟着转到 +Y（100×200）',
    near(RSTY.box.w, 100, 1e-3) && near(RSTY.box.h, 200, 1e-3),
    `w=${RSTY.box.w} h=${RSTY.box.h}`);

  const ST0 = JSON.parse(JSON.stringify(BASE));
  ST0.renderer = { renderMode: 1, velocityScale: 0, lengthScale: 1 };
  const RST0 = run(ST0, N);
  chk('速度为 0 且 velocityScale = 0 ⇒ 退化成 100×100（不炸）',
    near(RST0.box.w, 100, 1e-3) && near(RST0.box.h, 100, 1e-3),
    `w=${RST0.box.w} h=${RST0.box.h}`);

  const STZ = JSON.parse(JSON.stringify(ST));
  STZ.renderer = { renderMode: 1, velocityScale: 0, lengthScale: 0 };
  const RSTZ = run(STZ, N);
  /**
   * ⚠️ 长度是**沿速度**（+X）量出来的 ⇒ 看 `box.w`；`box.h` 是垂直速度的宽度，仍是 size。
   */
  chk('lengthScale = 0 且 velocityScale = 0 ⇒ 沿速度的长度 0（手册：粒子"消失"）',
    near(RSTZ.box.w, 0, 1e-6) && near(RSTZ.box.h, 100, 1e-6),
    `w=${RSTZ.box.w} h=${RSTZ.box.h}`);

  /* ── ⑤ None：不生成四边形 ── */
  console.log('');
  console.log('[5] renderMode = 5 (None)：只留 trails，不画默认四边形');
  const NON = JSON.parse(JSON.stringify(BASE));
  NON.renderer = { renderMode: 5 };
  const RN = run(NON, N);
  chk('None ⇒ 顶点数 0', RN.cnt === 0, `cnt=${RN.cnt}`);
  chk('None ⇒ 粒子仍在模拟（只是不画）', !!RN.p, `x=${RN.p && RN.p.x}`);

  /* ── ⑥ Mesh 档 ── */
  console.log('');
  console.log('[6] renderMode = 4 (Mesh)：顶点 = mesh 坐标 × 直径（**不归一化**）');
  const MS = JSON.parse(JSON.stringify(BASE));
  MS.renderer = {
    renderMode: 4,
    mesh: { positions: [0, 0, 1, 0, 0, 1], uv0: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] },
  };
  const RM = run(MS, N);
  chk('顶点数 = 索引数 = 3', RM.cnt === 3, `cnt=${RM.cnt}`);
  /** 顶点 (0,0) / (1,0) / (0,1) × 直径 100 ⇒ 边长恒 100 的直角三角形 */
  chk('Mesh 顶点按直径缩放（包围盒 100×100）',
    near(RM.box.w, 100, 1e-6) && near(RM.box.h, 100, 1e-6),
    `w=${RM.box.w} h=${RM.box.h}`);
  chk('Mesh 顶点 0 落在粒子位置（图元原点即粒子中心）',
    near(RM.vs[0][0], RM.p.x, 1e-6) && near(RM.vs[0][1], RM.p.y, 1e-6));

  const MSB = JSON.parse(JSON.stringify(BASE));
  MSB.renderer = { renderMode: 4 };
  const RMB = run(MSB, N);
  chk('Mesh 档缺 mesh ⇒ **回退 quad**（与基线逐位相同）', sameGeom(R0, RMB), `cnt=${RMB.cnt}`);

  const MSX = JSON.parse(JSON.stringify(BASE));
  MSX.renderer = {
    renderMode: 4,
    mesh: { positions: [0, 0, 1, 0, 0, 1], uv0: [0, 0, 1, 0, 0, 1], indices: [0, 1, 5] },
  };
  const RMX = run(MSX, N);
  chk('Mesh 索引越界 ⇒ 静默回退 quad（不越界读）', sameGeom(R0, RMX) && RMX.cnt === 6, `cnt=${RMX.cnt}`);

  /* ── ⑦ alignment / allowRoll ── */
  console.log('');
  console.log('[7] alignment（Velocity 是唯一有实感的一档） / allowRoll');
  const AV = JSON.parse(JSON.stringify(BASE));
  AV.startRotation = K(ROT90);
  AV.startSpeed = K(200);
  AV.renderer = { alignment: 4 };
  const RAV = run(AV, N);
  const REF0 = JSON.parse(JSON.stringify(AV));
  REF0.startRotation = K(0);
  const RR0 = run(REF0, N);
  chk('alignment = Velocity ⇒ 朝向改由**速度**定义（覆盖 startRotation = π/2）',
    sameGeom(RAV, RR0), `rot=${RAV.p.rot} (期望 0)`);

  const AR = JSON.parse(JSON.stringify(BASE));
  AR.startRotation = K(ROT90);
  AR.renderer = { allowRoll: false };
  const RAR = run(AR, N);
  chk('allowRoll = false ⇒ 屏幕自转**整体作废**（startRotation 也不转）',
    sameGeom(RAR, R0));

  /* ── ⑧ flip ── */
  console.log('');
  console.log('[8] flip：逐粒子按概率镜像 UV');
  const FP = JSON.parse(JSON.stringify(BASE));
  FP.renderer = { flip: [1, 0, 0] };
  const RF = run(FP, N);
  chk('flip = [1,0,0] ⇒ 顶点 0 的 u 被镜像（0 → 1）',
    !!RF.uv0 && near(RF.uv0[0], 1, 1e-6) && near(R0.uv0![0], 0, 1e-6),
    `u=${RF.uv0 && RF.uv0[0]}（基线 ${R0.uv0 && R0.uv0[0]}）`);
  chk('flip 不影响位置', near(RF.box.w, 100, 1e-6));

  const FP0 = JSON.parse(JSON.stringify(BASE));
  FP0.renderer = { flip: [0, 0, 0] };
  chk('flip = [0,0,0] ⇒ UV 不变', sameGeom(R0, run(FP0, N)));

  /* ── ⑨ sortingFudge ── */
  console.log('');
  console.log('[9] sortingFudge（**整个系统**的次序 ⇒ 只动 mesh.position.z）');
  const SF = JSON.parse(JSON.stringify(BASE));
  SF.renderer = { sortingFudge: -5, fudgeToZ: 0.1 };
  chk('fudgeToZ 未声明/为 0 ⇒ z 不动（零回归）',
    run(Object.assign(JSON.parse(JSON.stringify(BASE)), { renderer: { sortingFudge: -5 } }), N).z === -1000);
  const RSF = run(SF, N);
  chk('fudge = −5、fudgeToZ = 0.1 ⇒ z = −1000 + 0.5（越靠前，z 越大）',
    near(RSF.z, -999.5, 1e-9), `z=${RSF.z}`);
  const SF2 = JSON.parse(JSON.stringify(BASE));
  SF2.renderer = { sortingFudge: 10, fudgeToZ: 0.1 };
  chk('fudge 取正 ⇒ z 变小（更靠后）', near(run(SF2, N).z, -1001, 1e-9));

  /* ── ⑩ min/maxParticleSize ── */
  console.log('');
  console.log('[10] min/maxParticleSize（**视口高的比例**，仅 Billboard 档生效）');
  const MX = JSON.parse(JSON.stringify(BASE));
  MX.renderer = { maxParticleSize: 0.001 };
  const RMX2 = run(MX, N);
  chk('maxParticleSize 极小 ⇒ 粒子被等比缩小（且仍是正方形 ⇒ 等比）',
    // ⚠️ 容差 1e-4：顶点缓冲是 **Float32Array**，两次乘法的舍入不同（实测差 ~7e-6）
    RMX2.box.w < 100 && RMX2.box.w > 0 && near(RMX2.box.w, RMX2.box.h, 1e-4),
    `w=${RMX2.box.w} h=${RMX2.box.h}`);
  const MXS = JSON.parse(JSON.stringify(BASE));
  MXS.renderer = { renderMode: 2, maxParticleSize: 0.001 };
  const RMXS = run(MXS, N);
  chk('非 Billboard 档**不**做钳制（手册逐字：仅 Billboard）',
    near(RMXS.box.w, 100, 1e-6), `w=${RMXS.box.w}`);

  /* ── ⑪ 真实记录 ── */
  console.log('');
  console.log('[11] 真实记录原样跑：无异常，且"加全默认 renderer 段"不改变任何渲染真值');
  const RE = JSON.parse(JSON.stringify(real));
  RE.prewarm = false;
  const RA = run(RE, 30);
  chk('真实记录：有粒子在跑', RA.cnt > 0, `cnt=${RA.cnt}`);
  const RB2 = JSON.parse(JSON.stringify(RE));
  RB2.renderer = {
    renderMode: 0, alignment: 0, pivot: [0, 0, 0], velocityScale: 0,
    lengthScale: 0, allowRoll: true, flip: [0, 0, 0], sortingFudge: 0, fudgeToZ: 0,
  };
  const RC = run(RB2, 30);
  chk('真实记录 + 全默认 renderer ⇒ 逐位相同', sameGeom(RA, RC) && RA.z === RC.z,
    `z ${RA.z} vs ${RC.z}`);

  console.log('');
  console.log('─'.repeat(78));
  console.log(`结果：${pass} 通过 / ${fail} 失败  （共 ${pass + fail} 条断言）`);
  console.log('─'.repeat(78));
  process.exit(fail ? 1 : 0);
}

main();
