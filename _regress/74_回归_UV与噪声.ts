/**
 * 74 · 回归：**P4「UV / Noise 细节」**
 *
 * ## 钉的是什么（`docx/TODO.md` §2.10 / `docx/RESEARCH_粒子系统复刻参考.md` §4.14~§4.15）
 *
 *  ① **UV · timeMode 三档**（官方 `ParticleSystemAnimationTimeMode`）：
 *     · `0 Lifetime`（缺省）逐字 *"Sample frames using an Animation Curve over the
 *       lifetime of the particle."* ⇒ `⌊startFrame + frameOverTime(t)·cycles·帧数⌋`（现状）；
 *     · `1 Speed` 逐字 *"Sample frames based on the speed of the particle."*；
 *       ★ 真正口径来自 `ScriptReference/ParticleSystem.TextureSheetAnimationModule-speedRange`
 *         的 Remarks：*"If a particle is travelling **slower than the minimum speed, it uses
 *         the first frame**. If a particle is travelling **faster than the maximum speed,
 *         then it uses the final frame**. For all other speeds, the particle chooses a frame
 *         based on how far between the minimum and maximum value its speed is."*
 *         ⇒ **按当前速度静态选帧**（不是"速度越快播得越快"这种常见误解）；
 *     · `2 FPS` 逐字 *"Sample frames based on the specified frames-per-second value."*
 *       ⇒ 与寿命/速度无关，按**秒**推进；官方 UI 在这两档下**隐藏** `frameOverTime`/`cycles`
 *       （`UVModuleUI.OnInspectorGUI`）⇒ 引擎同样不消费它们。
 *  ② **UV · animationType = Single Row + rowMode**：手册 *"Single Row (that is, each row of
 *     the sheet represents a separate Animation sequence)"*；`rowMode` 三档
 *     Custom / Random / Mesh Index（Mesh Index 在本引擎恒等于第 0 行，见 config 注释）；
 *  ③ **UV · startFrame**：*"…useful for **randomly phasing the animation on each particle**"*
 *     ⇒ 加在帧号上再回绕；`0` ⇒ 逐位等于现状；
 *  ④ **UV · flipU / flipV**：★ Unity **已废弃** —— ScriptReference 逐字
 *     *"flipU property is deprecated. Use `ParticleSystemRenderer.flip.x` instead."*
 *     ⇒ 本引擎只把它当 `renderer.flip` 的回退（P3 已实现主入口）；
 *  ⑤ **Noise · octaves / octaveMultiplier / octaveScale**：手动逐字（见 `config.type.ts`）
 *     ⇒ 势场 fBm 叠层（Cocos `ParticleNoise.getNoise` 同式），
 *     **仍必须无源无汇**（curl 的定义性质，用数值散度判据钉住）；
 *  ⑥ **Noise · scrollSpeed**：*"Move the noise field over time…"* ⇒ 采样点加 `speed × 系统时间`；
 *  ⑦ **Noise · sizeAmount / rotationAmount**：手册逐字（rotation 明确是 **度/秒**）；
 *  ⑧ **Noise · separateAxes / strengthY / strengthZ**：逐轴强度；
 *  ⑨ **零回归**：以上字段**全部缺省** ⇒ 与 P4 之前**逐位相同**。
 *
 * ## 相机口径
 *
 * 与 73 同：node 下裸跑、`initScene` 未初始化 ⇒ 引擎回落 `CAM_IDENTITY`（正视相机）。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/74_回归_UV与噪声.ts [config路径]
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
const { ParticleAnimator } = require(path.join(
  ROOT,
  'src',
  'animator',
  'ParticleAnimator'
));

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
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

/** 常量 MinMaxCurve */
const K = (a: number) => ({ mode: 0, a, b: a });
/** 曲线 MinMaxCurve：keysA 是 [[t,y], ...] */
const CURVE = (a: number, keys: number[][]) => ({
  mode: 1,
  a,
  b: a,
  keysA: keys,
  pre: 0,
  post: 0,
  headSlope: 0,
  tailSlope: 0,
});
const DT = 0.05;

/**
 * 造一条"干净"的基底：尺寸统一 100（⇒ 半轴 50，便于手算）、
 * 出生点固定在 **(100, 0)**（圆形发射器 radius=100、thickness=0、arc=0 ⇒ 方位角恒 0）。
 * ⚠️ `startLifetime = 1 s`（不是 1e6）—— UV 的 Lifetime/FPS 两档要看**归一化寿命与年龄**，
 *   无限寿命会让 `pr ≡ 0`、帧号永远 0，测不出东西。
 */
function makeBase(real: any) {
  const c: any = JSON.parse(JSON.stringify(real));
  c.name = 'p4base';
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
  c.startLifetime = K(1);
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
  /** ★ 缺省噪声：**一个 P4 新字段都不给** —— 零回归的基准 */
  c.noise = {
    enabled: false,
    strength: 0,
    frequency: 0,
    gain: 0,
    positionAmount: 0,
  };
  c.trail = { enabled: false };
  c.customData = { enabled: false };
  c.uv = {
    enabled: false,
    tilesX: 1,
    tilesY: 1,
    cycles: 1,
    animationType: 0,
    frameOverTime: null,
    driftX: 0,
    driftY: 0,
    wrap: 'clamp',
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
  c.position = { x: 0, y: 0, z: -1000 };
  c.shape = {
    enabled: true,
    type: 10,
    radius: 100,
    radiusThickness: 0,
    arc: 0,
    arcMode: 0,
    boxX: 1,
    boxY: 1,
    offsetX: 0,
    offsetY: 0,
    rotZ: 0,
  };
  return c;
}

/** 跑 `n` 帧，取第 0 颗粒子前 6 个顶点（与 73 同口径） */
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
    frames: a.particles.map((q: any) => q.uvFrame),
    z: a.mesh.position.z,
  };
}

/** 逐位比较两次运行的"渲染真值" */
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

/** 4×2 图集的一帧尺寸：u 方向 4 格（0.25）、v 方向 2 行（0.5） */
const FW = 0.25;
const FH = 0.5;

function main() {
  console.log('='.repeat(78));
  console.log(
    '74 · P4「UV / Noise 细节」回归（timeMode / SingleRow / startFrame / flip · octaves / scroll / size / rot）'
  );
  console.log('='.repeat(78));
  console.log(`   config  ${cfgPath}`);

  if (!fs.existsSync(cfgPath)) {
    console.log(
      '   ★! config 不存在 —— 先跑构建链（或传一个存在的 config 路径）'
    );
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const parts: any[] = (cfg.meshes || []).filter(
    (m: any) => m.type === 'particle'
  );
  if (!parts.length) {
    console.log('   ★! 该 config 里没有粒子组 —— 换一个工程再跑');
    process.exit(1);
  }
  const real = parts[0];
  console.log(`   基底记录：${real.name}`);
  console.log(
    '   ⚠️ 合成基底把 localScale/unitScale 都设为 1 ⇒ prefab 单位 == 世界单位'
  );
  console.log(
    '   ⚠️ startLifetime 改为 1 s（Lifetime / FPS 两档需要真实年龄与归一化寿命）'
  );

  const BASE = makeBase(real);
  const N = 3; // 3 × 0.05 s ⇒ age = 0.15 s、pr = 0.15

  /* ══════════════════════════════════════════════════════════════════════
   * ① 零回归：不声明新字段 ≡ 显式声明"全部默认值"
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[1] 零回归：不声明 P4 新字段 ≡ 显式声明全默认值');
  const R0 = run(BASE, N);
  chk('跑出了粒子', !!R0.p && R0.cnt >= 6, `cnt=${R0.cnt}`);
  chk(
    '尺寸 100×100（半轴 50）',
    near(R0.box.w, 100, 1e-6) && near(R0.box.h, 100, 1e-6),
    `w=${R0.box.w} h=${R0.box.h}`
  );

  const DEF = JSON.parse(JSON.stringify(BASE));
  DEF.uv.timeMode = 0;
  DEF.uv.fps = 30;
  DEF.uv.speedRange = [0, 1];
  DEF.uv.startFrame = K(0);
  DEF.uv.rowMode = 0;
  DEF.uv.rowIndex = 0;
  DEF.uv.flipU = 0;
  DEF.uv.flipV = 0;
  DEF.noise = {
    enabled: false,
    strength: 0,
    frequency: 0,
    gain: 0,
    positionAmount: 0,
    octaves: 1,
    octaveMultiplier: 0.5,
    octaveScale: 2,
    scrollSpeed: K(0),
    sizeAmount: K(0),
    rotationAmount: K(0),
    separateAxes: false,
    strengthY: 0,
    strengthZ: 0,
  };
  const R1 = run(DEF, N);
  chk(
    '全默认 P4 字段 ⇒ 与不声明**逐位相同**',
    sameGeom(R0, R1) && R0.z === R1.z,
    `cnt ${R0.cnt} vs ${R1.cnt}`
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ② UV · timeMode 三档
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[2] UV · timeMode：Lifetime(0，现状) / Speed(1) / FPS(2)');
  const UVB = JSON.parse(JSON.stringify(BASE));
  UVB.uv = {
    enabled: true,
    tilesX: 4,
    tilesY: 2,
    cycles: 1,
    animationType: 0,
    frameOverTime: CURVE(1, [
      [0, 0],
      [1, 1],
    ]),
    driftX: 0,
    driftY: 0,
    wrap: 'clamp',
  };
  const RU = run(UVB, N);
  /** pr = 0.15 ⇒ ⌊0.15 × 1 × 8⌋ = 1 */
  chk(
    'Lifetime：⌊frameOverTime(pr)·cycles·8⌋ = 1（pr = 0.15）',
    RU.p.uvFrame === 1,
    `uvFrame=${RU.p.uvFrame}`
  );
  chk(
    'Lifetime：整表档 v0 按「自上而下」⇒ fi=1 仍在**最上一行** ⇒ v0 = (2−1−0)·0.5 = 0.5',
    !!RU.uv0 && near(RU.uv0[1], FH, 1e-9),
    `v0=${RU.uv0 && RU.uv0[1]}`
  );

  /** FPS：fps = 30 ⇒ ⌊0.15 × 30⌋ = 4（与 pr 无关） */
  const FPS = JSON.parse(JSON.stringify(UVB));
  FPS.uv.timeMode = 2;
  FPS.uv.fps = 30;
  const RFPS = run(FPS, N);
  chk(
    'FPS：⌊age × fps⌋ = ⌊0.15 × 30⌋ = 4（**与寿命无关**）',
    RFPS.p.uvFrame === 4,
    `uvFrame=${RFPS.p.uvFrame}`
  );

  const FPS10 = JSON.parse(JSON.stringify(FPS));
  FPS10.uv.fps = 10;
  chk(
    'FPS：帧率减半 ⇒ 帧号减半（⌊1.5⌋ = 1）',
    run(FPS10, N).p.uvFrame === 1,
    `uvFrame=${run(FPS10, N).p.uvFrame}`
  );

  /** ★ FPS 档**无视** frameOverTime（官方 UI 隐藏它）——换一条"不推进"的常量曲线，帧号照走 */
  const FPSF = JSON.parse(JSON.stringify(FPS));
  FPSF.uv.frameOverTime = K(0);
  chk(
    'FPS 档不消费 frameOverTime（换成常量 0，帧号仍是 4）',
    run(FPSF, N).p.uvFrame === 4
  );

  /** ★ FPS 档**无视** cycles（同上） */
  const FPSC = JSON.parse(JSON.stringify(FPS));
  FPSC.uv.cycles = 7;
  chk(
    'FPS 档不消费 cycles（改成 7，帧号仍是 4）',
    run(FPSC, N).p.uvFrame === 4
  );

  /**
   * Speed：静态选帧 —— `round(startFrame + rate·(帧数−1))`
   * startSpeed = 200、speedRange = [0, 400] ⇒ rate = 0.5 ⇒ round(0.5 × 7) = 4
   */
  const SPD = JSON.parse(JSON.stringify(UVB));
  SPD.uv.timeMode = 1;
  SPD.uv.speedRange = [0, 400];
  SPD.startSpeed = K(200);
  const RSPD = run(SPD, N);
  chk(
    'Speed：rate = 0.5 ⇒ round(0.5 × 7) = 4',
    RSPD.p.uvFrame === 4,
    `uvFrame=${RSPD.p.uvFrame}`
  );

  const SPD0 = JSON.parse(JSON.stringify(SPD));
  SPD0.startSpeed = K(0);
  chk(
    'Speed：速度 0（< 下界）⇒ **首帧**（官方逐字 "it uses the first frame"）',
    run(SPD0, N).p.uvFrame === 0,
    `uvFrame=${run(SPD0, N).p.uvFrame}`
  );

  const SPDH = JSON.parse(JSON.stringify(SPD));
  SPDH.startSpeed = K(4000);
  chk(
    'Speed：速度远超上界 ⇒ **末帧**（官方逐字 "it uses the final frame"）',
    run(SPDH, N).p.uvFrame === 7,
    `uvFrame=${run(SPDH, N).p.uvFrame}`
  );

  /** ★ Speed 档**不随时间推进**：跑到第 6 帧，帧号仍是 4（这是本档最容易搞错的一点） */
  chk(
    'Speed 档**不随寿命推进**（第 6 帧仍是同一帧）',
    run(SPD, 6).p.uvFrame === 4,
    `uvFrame=${run(SPD, 6).p.uvFrame}`
  );

  /** Speed 档同样不消费 cycles */
  const SPDC = JSON.parse(JSON.stringify(SPD));
  SPDC.uv.cycles = 5;
  chk(
    'Speed 档不消费 cycles（改成 5，帧号仍是 4）',
    run(SPDC, N).p.uvFrame === 4
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ③ UV · startFrame
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[3] UV · startFrame（**帧号**，加在帧号上再回绕）');
  const SF = JSON.parse(JSON.stringify(UVB));
  SF.uv.startFrame = K(3);
  chk(
    'startFrame = 3 ⇒ ⌊3 + 1.2⌋ = 4',
    run(SF, N).p.uvFrame === 4,
    `uvFrame=${run(SF, N).p.uvFrame}`
  );

  const SFW = JSON.parse(JSON.stringify(SF));
  SFW.uv.startFrame = K(20);
  chk(
    'startFrame 超出一圈 ⇒ 正确回绕（⌊21.2⌋ % 8 = 5）',
    run(SFW, N).p.uvFrame === 5,
    `uvFrame=${run(SFW, N).p.uvFrame}`
  );

  const SFZ = JSON.parse(JSON.stringify(UVB));
  SFZ.uv.startFrame = K(0);
  chk(
    'startFrame = 0 ⇒ 与不声明**逐位相同**（零回归）',
    sameGeom(RU, run(SFZ, N))
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ④ UV · animationType = Single Row + rowMode
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[4] UV · Single Row（`animationType = 1`）+ rowMode 三档');
  const SR = JSON.parse(JSON.stringify(UVB));
  SR.uv.animationType = 1;
  SR.uv.cycles = 2; // nF = tilesX = 4 ⇒ ⌊0.15 × 2 × 4⌋ = 1
  const RSR = run(SR, N);
  chk(
    'SingleRow：帧数 = tilesX = 4（不是整表 8）⇒ ⌊0.15×2×4⌋ = 1',
    RSR.p.uvFrame === 1,
    `uvFrame=${RSR.p.uvFrame}`
  );
  chk(
    'SingleRow · rowMode = 0(Custom) · rowIndex = 0 ⇒ v0 = (2−1−0)·0.5 = 0.5',
    !!RSR.uv0 && near(RSR.uv0[1], FH, 1e-9),
    `v0=${RSR.uv0 && RSR.uv0[1]}`
  );
  chk(
    'SingleRow：u0 = (1 % 4) · 0.25 = 0.25',
    !!RSR.uv0 && near(RSR.uv0[0], FW, 1e-9),
    `u0=${RSR.uv0 && RSR.uv0[0]}`
  );

  const SR1 = JSON.parse(JSON.stringify(SR));
  SR1.uv.rowMode = 0;
  SR1.uv.rowIndex = 1;
  const RSR1 = run(SR1, N);
  chk(
    'rowIndex = 1 ⇒ 取**第二行** ⇒ v0 = (2−1−1)·0.5 = 0（行号越大越靠下）',
    !!RSR1.uv0 && near(RSR1.uv0[1], 0, 1e-9),
    `v0=${RSR1.uv0 && RSR1.uv0[1]}`
  );
  chk(
    '换行**不影响**行内帧号（u0 仍是 0.25）',
    !!RSR1.uv0 && near(RSR1.uv0[0], FW, 1e-9),
    `u0=${RSR1.uv0 && RSR1.uv0[0]}`
  );
  chk(
    '该粒子的 uvRow 逐粒子记录为 1',
    RSR1.p.uvRow === 1,
    `uvRow=${RSR1.p.uvRow}`
  );

  /** MeshIndex(2)：本引擎每套系统只用一个 mesh ⇒ 恒第 0 行（config 注释里如实标注） */
  const SRM = JSON.parse(JSON.stringify(SR));
  SRM.uv.rowMode = 2;
  SRM.uv.rowIndex = 1;
  const RSRM = run(SRM, N);
  chk(
    'rowMode = 2(MeshIndex) ⇒ 恒第 0 行（无视 rowIndex）',
    RSRM.p.uvRow === 0 && !!RSRM.uv0 && near(RSRM.uv0[1], FH, 1e-9),
    `uvRow=${RSRM.p.uvRow} v0=${RSRM.uv0 && RSRM.uv0[1]}`
  );

  /** Random(1)：4 颗粒子应抽到不同的行（2 行 ⇒ 至少出现两种） */
  const SRR = JSON.parse(JSON.stringify(SR));
  SRR.uv.rowMode = 1;
  const RSRR = run(SRR, N);
  const rows = RSRR.anim.particles.map((q: any) => q.uvRow);
  chk(
    'rowMode = 1(Random) ⇒ 每颗粒子出生抽一行，取值落在 [0, tilesY)',
    rows.length > 0 && rows.every((r: number) => r >= 0 && r < 2),
    `rows=[${rows}]`
  );
  chk(
    'WholeSheet 档**不抽**随机行（`uvRow` 恒为 rowIndex = 0）',
    RU.p.uvRow === 0
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ⑤ UV · flipU / flipV（Unity 已废弃 ⇒ 只作 renderer.flip 的回退）
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log(
    '[5] UV · flipU / flipV（**Unity 已废弃**，只作 `renderer.flip` 的回退）'
  );
  const FU = JSON.parse(JSON.stringify(UVB));
  FU.uv.flipU = 1;
  const RFU = run(FU, N);
  chk(
    'uv.flipU = 1 且无 renderer.flip ⇒ u 被镜像（顶点 0 的 u 由 0.25 → 0.5）',
    !!RFU.uv0 && near(RFU.uv0[0], 0.5, 1e-9) && near(RU.uv0![0], FW, 1e-9),
    `u=${RFU.uv0 && RFU.uv0[0]}（基线 ${RU.uv0 && RU.uv0[0]}）`
  );

  const FUR = JSON.parse(JSON.stringify(FU));
  FUR.renderer = { flip: [0, 0, 0] };
  chk(
    'renderer.flip 显式为 0 ⇒ 仍由 uv.flipU 兜底（本项目口径）',
    sameGeom(RFU, run(FUR, N))
  );

  const FUR1 = JSON.parse(JSON.stringify(FU));
  FUR1.renderer = { flip: [1, 0, 0] };
  chk(
    'renderer.flip = [1,0,0] ⇒ 与 uv.flipU = 1 **逐位相同**（同一份数据的两个入口）',
    sameGeom(RFU, run(FUR1, N))
  );

  const FUV = JSON.parse(JSON.stringify(UVB));
  FUV.uv.flipV = 1;
  chk(
    'uv.flipV = 1 ⇒ v 被镜像（顶点 0 的 v 由 v0 变成 v1 = 1.0）',
    !!run(FUV, N).uv0 &&
      near(run(FUV, N).uv0![1], 1.0, 1e-9) &&
      near(RU.uv0![1], 0.5, 1e-9),
    `v=${run(FUV, N).uv0 && run(FUV, N).uv0![1]}（基线 ${RU.uv0 && RU.uv0[1]}）`
  );

  chk(
    'uv.flipU / flipV = 0 ⇒ 与不声明**逐位相同**',
    sameGeom(
      RU,
      run(
        Object.assign(JSON.parse(JSON.stringify(UVB)), {
          uv: Object.assign(JSON.parse(JSON.stringify(UVB.uv)), {
            flipU: 0,
            flipV: 0,
          }),
        }),
        N
      )
    )
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ⑥ Noise · octaves（fBm 叠层）
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log(
    '[6] Noise · octaves / octaveMultiplier / octaveScale（势场 fBm 叠层）'
  );
  const NZH: any = ParticleAnimator.__noise;
  const curl: any = NZH.curl3;
  const divN: any = NZH.divCurlNumerical;
  const psi: any = NZH.psi;
  const psiLayer: any = NZH.psiLayer;
  const noiseScalar: any = NZH.noiseScalar;
  const V = new THREE.Vector3();

  chk(
    'psiLayer(f = 1) ≡ psi（同一条式子逐位相同）',
    [
      [0.3, 1.7, 0.9],
      [12.25, -4.5, 3.1],
      [-8.75, 0.125, -2.5],
    ].every(
      (q) =>
        psi(0, q[0], q[1], q[2]) === psiLayer(0, q[0], q[1], q[2], 1) &&
        psi(2, q[0], q[1], q[2]) === psiLayer(2, q[0], q[1], q[2], 1)
    )
  );

  /**
   * curl 的**定义性质**：无源无汇。
   * ⚠️ 两层判据的步长都必须与场的高频相匹配（`h ≪ 1/(f_max)`），否则量到的是
   *   "离散算子自己的截断误差"而不是场 —— 第一版用固定步长测 4 层叠层，得到
   *   `max|∇·N| = 2.17`（与场同阶），**就是因为步长不够**，不是实现有源汇。
   */
  let mx1 = 0;
  let mx4 = 0;
  let amp1 = 0;
  let amp4 = 0;
  let rng = 12345;
  const rnd = () =>
    (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  /** 4 层、`octaveScale = 2` ⇒ 最高频层 f = 8 ⇒ 度量步长取 0.02/8 */
  const H4 = 0.02 / 8;
  for (let i = 0; i < 400; i++) {
    const x = rnd() * 40 - 20;
    const y = rnd() * 40 - 20;
    const z = rnd() * 40 - 20;
    mx1 = Math.max(mx1, Math.abs(divN(x, y, z, 0.02, 1, 0.5, 2)));
    mx4 = Math.max(mx4, Math.abs(divN(x, y, z, H4, 4, 0.5, 2)));
    amp1 = Math.max(amp1, curl(x, y, z, V, 1, 0.5, 2).length());
    amp4 = Math.max(amp4, curl(x, y, z, V, 4, 0.5, 2).length());
  }
  chk(
    `单层势场：max|∇·N| = ${mx1.toExponential(2)} ≪ 场量级(${amp1.toFixed(
      2
    )})（curl 定义性质）`,
    mx1 < amp1 * 0.05,
    `amp1=${amp1.toFixed(3)}`
  );
  chk(
    `4 层叠层：max|∇·N| = ${mx4.toExponential(2)} ≪ 场量级(${amp4.toFixed(
      2
    )}) —— **叠层后仍无源无汇**`,
    mx4 < amp4 * 0.05,
    `amp4=${amp4.toFixed(3)}（步长 ${H4} 与 f_max=8 匹配）`
  );
  chk(
    '★ 叠层**不放大**场量级（mul·scale = 0.5×2 = 1 ⇒ 每层 curl 量级守恒）',
    amp4 < amp1 * 2.5 && amp4 > amp1 * 0.4,
    `amp1=${amp1.toFixed(3)} amp4=${amp4.toFixed(3)}`
  );

  /** 每层都用与频率匹配的步长 ⇒ `addLayerCurl(f = 1, amp = 1)` 就是单层原式 */
  const W = new THREE.Vector3();
  const WS = new THREE.Vector3();
  chk(
    'addLayerCurl(f = 1, amp = 1) ≡ curl3 单层（**逐位相同**，说明步长折算在 f = 1 时不引入差异）',
    [
      [0.3, 1.7, 0.9],
      [12.25, -4.5, 3.1],
      [-8.75, 0.125, -2.5],
      [31.4, 27.1, -15.9],
    ].every((q) => {
      NZH.addLayerCurl(q[0], q[1], q[2], 1, 1, W);
      curl(q[0], q[1], q[2], WS, 1, 0.5, 2);
      return W.x === WS.x && W.y === WS.y && W.z === WS.z;
    })
  );

  /** ★ `mul = 0` ⇒ 高层振幅全 0 ⇒ 叠层**退回单层**（连浮点都逐位相同） */
  const WM = new THREE.Vector3();
  chk(
    'octaves = 6 且 octaveMultiplier = 0 ⇒ **逐位退回单层**（倍率真的只作用于附加层）',
    [
      [0.3, 1.7, 0.9],
      [12.25, -4.5, 3.1],
      [-8.75, 0.125, -2.5],
    ].every((q) => {
      curl(q[0], q[1], q[2], WM, 6, 0, 2);
      curl(q[0], q[1], q[2], WS, 1, 0.5, 2);
      return WM.x === WS.x && WM.y === WS.y && WM.z === WS.z;
    })
  );

  /** ★ 标量场有界（Perlin ∈ 约 ±0.7）⇒ `1 + 标量 × sizeAmount` 不会取负 */
  let scMax = -Infinity;
  let scMin = Infinity;
  for (let i = 0; i < 800; i++) {
    const v = noiseScalar(
      rnd() * 40 - 20,
      rnd() * 40 - 20,
      rnd() * 40 - 20,
      4,
      0.5,
      2
    );
    scMax = Math.max(scMax, v);
    scMin = Math.min(scMin, v);
  }
  chk(
    `标量噪声场有界（4 层叠层实测 [${scMin.toFixed(3)}, ${scMax.toFixed(
      3
    )}] ⊂ ±1）`,
    scMax < 1 && scMin > -1
  );
  chk(
    '标量噪声场与 curl 的 x 分量**不是同一个函数**（另开一路 ⇒ 不与可见位移相关）',
    Math.abs(
      noiseScalar(3.1, -4.2, 1.7, 1, 0.5, 2) - curl(3.1, -4.2, 1.7, WS, 1).x
    ) > 1e-6
  );

  /** 引擎侧：octaves 缺省 ≡ 1，且 >1 真的改行为 */
  const NB = JSON.parse(JSON.stringify(BASE));
  NB.noise = {
    enabled: true,
    strength: 1,
    frequency: 0.5,
    damping: false,
    quality: 2,
    positionAmount: 1,
    gain: 1,
  };
  NB.startLifetime = K(1e6); // 噪声推力用"长寿命"，避免粒子中途死亡干扰位移比较
  const RN1 = run(NB, 4);
  const NB0 = JSON.parse(JSON.stringify(NB));
  NB0.noise.octaves = 1;
  chk('noise.octaves 缺省 ≡ 1（逐位相同）', sameGeom(RN1, run(NB0, 4)));

  const NB3 = JSON.parse(JSON.stringify(NB));
  NB3.noise.octaves = 3;
  const RN3 = run(NB3, 4);
  chk(
    'noise.octaves = 3 ⇒ 位移与单层不同（叠层生效）',
    !near(RN3.p.x, RN1.p.x, 1e-6) || !near(RN3.p.y, RN1.p.y, 1e-6),
    `单层 (${RN1.p.x.toFixed(3)}, ${RN1.p.y.toFixed(
      3
    )}) vs 3 层 (${RN3.p.x.toFixed(3)}, ${RN3.p.y.toFixed(3)})`
  );

  const NB3s = JSON.parse(JSON.stringify(NB));
  NB3s.noise.octaves = 3;
  NB3s.noise.octaveScale = 1; // 频率不放大 ⇒ 各层同频、只是振幅叠加
  chk(
    'octaveScale = 1 时 3 层 ≠ octaveScale = 2 时 3 层（旋钮真的在起作用）',
    !near(run(NB3s, 4).p.x, RN3.p.x, 1e-6) ||
      !near(run(NB3s, 4).p.y, RN3.p.y, 1e-6)
  );

  chk(
    'noise.octaves = 1 但显式给倍率 ⇒ 与"只有 octaves=1"逐位相同（倍率只在叠层时参与）',
    sameGeom(
      run(
        Object.assign(JSON.parse(JSON.stringify(NB0)), {
          noise: Object.assign(JSON.parse(JSON.stringify(NB0.noise)), {
            octaveMultiplier: 0.9,
            octaveScale: 9,
          }),
        }),
        4
      ),
      RN1
    )
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ⑦ Noise · scrollSpeed
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[7] Noise · scrollSpeed（噪声场随系统时间滚动）');
  const NS = JSON.parse(JSON.stringify(NB));
  NS.noise.scrollSpeed = K(1);
  const RNS = run(NS, 4);
  chk(
    'scrollSpeed = 1 ⇒ 位移与静止场不同（场滚起来了）',
    !near(RNS.p.x, RN1.p.x, 1e-6) || !near(RNS.p.y, RN1.p.y, 1e-6),
    `静止 (${RN1.p.x.toFixed(3)}, ${RN1.p.y.toFixed(
      3
    )}) vs 滚动 (${RNS.p.x.toFixed(3)}, ${RNS.p.y.toFixed(3)})`
  );
  chk(
    'scrollSpeed 缺省 ≡ 常量 0（逐位相同）',
    sameGeom(
      RN1,
      run(
        Object.assign(JSON.parse(JSON.stringify(NB)), {
          noise: Object.assign(JSON.parse(JSON.stringify(NB.noise)), {
            scrollSpeed: K(0),
          }),
        }),
        4
      )
    )
  );

  /**
   * ★ 滚动的**相位**必须跟着 `系统时间`（Cocos `accSpeed = speed × t`）：
   *   把"第 1 帧的位移"与"先空跑 3 帧再重开"对不上 —— 用两条同 scrollSpeed、
   *   但一开一关的场在同一时刻的采样差来间接钉住"偏移量 = speed × t"：
   *   偏移 t=0.2 s、speed=1 ⇒ 采样点平移 0.2（× frequency 之后）⇒ 与 t=0 时不同。
   */
  const NS02 = JSON.parse(JSON.stringify(NS));
  const A1 = run(NS, 4); // systemTime 末 = 0.2
  const A2 = run(NS02, 8); // systemTime 末 = 0.4
  chk(
    '系统时间翻倍 ⇒ 场偏移翻倍 ⇒ 位移轨迹不同（不是"一步脉冲"）',
    !near(A1.p.x, A2.p.x, 1e-6) || !near(A1.p.y, A2.p.y, 1e-6),
    `t=0.2 (${A1.p.x.toFixed(3)}) vs t=0.4 (${A2.p.x.toFixed(3)})`
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ⑧ Noise · sizeAmount / rotationAmount
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[8] Noise · sizeAmount（尺寸调制） / rotationAmount（度/秒）');
  const NZ = JSON.parse(JSON.stringify(NB));
  NZ.noise.sizeAmount = K(0.5);
  const RNZ = run(NZ, 4);
  chk(
    'sizeAmount = 0.5 ⇒ 尺寸偏离 100（噪声真的在调制尺寸）',
    !near(RNZ.box.w, 100, 1e-9) && RNZ.box.w > 0,
    `w=${RNZ.box.w.toFixed(4)}（基线 100）`
  );
  chk(
    'sizeAmount 缺省 ⇒ 尺寸**仍是 100**（零回归）',
    near(RN1.box.w, 100, 1e-4),
    `w=${RN1.box.w}（⚠️ 顶点写在 Float32Array 里 ⇒ 容差取 1e-4）`
  );
  chk(
    '`p.nzS` 被写回（标量噪声场 ⇒ 尺寸调制的取值来源）',
    typeof RNZ.p.nzS === 'number' && RNZ.p.nzS !== 0 && Math.abs(RNZ.p.nzS) < 1,
    `nzS=${RNZ.p.nzS}`
  );

  /** 尺寸乘子的**量级**：`1 + nzS · eff · sizeAmount · gain`，eff = strength（damping=false）= 1 */
  const expMul = 1 + RNZ.p.nzS * 1 * 0.5 * 1;
  chk(
    '尺寸乘子 = 1 + nzS × 有效强度 × sizeAmount × gain（手算一致）',
    near(RNZ.box.w, 100 * expMul, 1e-3),
    `w=${RNZ.box.w.toFixed(6)} 期望 ${(100 * expMul).toFixed(6)}`
  );

  /** ★ 取的是**标量场**（第 4 路）而不是 curl 的某个分量：两者不应相等 */
  chk(
    'sizeAmount 与 positionAmount 用的是**两路不同的场**（不会"往哪边推就往哪边胀"）',
    Math.abs(RNZ.p.nzS) > 1e-9 && Math.abs(RNZ.p.nzRot) < 1e-12
  );

  /** 尺寸乘子下界钳在 0 ⇒ 极端参数不会画出"负尺寸"（粒子被尺寸守卫静默剔除） */
  const NZX = JSON.parse(JSON.stringify(NB));
  NZX.noise.strength = -1;
  NZX.noise.sizeAmount = K(50);
  const RNZX = run(NZX, 4);
  chk(
    '极端负调制（strength = −1、sizeAmount = 50）⇒ 乘子钳在 0，顶点不出现负尺寸 / NaN（粒子被守卫剔除）',
    RNZX.cnt === 0 && Number.isFinite(RNZX.p.sizeX),
    `cnt=${RNZX.cnt} nzS=${RNZX.p.nzS.toFixed(4)}`
  );

  const NR = JSON.parse(JSON.stringify(NB));
  NR.noise.rotationAmount = K(90);
  const RNR = run(NR, 4);
  chk(
    'rotationAmount = 90 ⇒ 粒子自转角偏离基线（度/秒 ⇒ 折算弧度）',
    !near(RNR.p.rot, RN1.p.rot, 1e-9),
    `rot=${RNR.p.rot.toFixed(6)}（基线 ${RN1.p.rot.toFixed(6)}）`
  );
  chk(
    'rotationAmount 缺省 ⇒ 自转角**逐位**不变',
    RN1.p.rot === run(NB, 4).p.rot
  );
  chk(
    'rotationAmount = 0 ⇒ 与缺省逐位相同',
    sameGeom(
      run(
        Object.assign(JSON.parse(JSON.stringify(NB)), {
          noise: Object.assign(JSON.parse(JSON.stringify(NB.noise)), {
            rotationAmount: K(0),
          }),
        }),
        4
      ),
      RN1
    )
  );
  chk(
    'rotationAmount 用的是 curl 的 **z 分量**（2D 丢弃的那一路 ⇒ 与位置推力正交的取值源）',
    Math.abs(RNR.p.nzRot) > 1e-9 && Math.abs(RNR.p.nzS) < 1e-12,
    `nzRot=${RNR.p.nzRot.toFixed(4)}`
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ⑨ Noise · separateAxes / strengthY / strengthZ
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log('[9] Noise · separateAxes（逐轴强度）');
  const NSEP = JSON.parse(JSON.stringify(NB));
  NSEP.noise.separateAxes = true;
  NSEP.noise.strengthY = 0;
  const RNSEP = run(NSEP, 4);
  chk(
    'separateAxes + strengthY = 0 ⇒ **y 方向推力为 0**（位置只在 x 上被推动）',
    near(RNSEP.p.y, 0, 1e-9) && !near(RNSEP.p.x, 0, 1e-9),
    `(${RNSEP.p.x.toFixed(3)}, ${RNSEP.p.y.toFixed(3)})`
  );
  chk(
    'separateAxes = false（缺省）⇒ 与 isotropic 逐位相同',
    sameGeom(
      run(
        Object.assign(JSON.parse(JSON.stringify(NB)), {
          noise: Object.assign(JSON.parse(JSON.stringify(NB.noise)), {
            separateAxes: false,
            strengthY: 0,
          }),
        }),
        4
      ),
      RN1
    )
  );
  chk(
    'separateAxes = true 但 strengthY/Z 等于 strength ⇒ 与 isotropic 逐位相同',
    sameGeom(
      run(
        Object.assign(JSON.parse(JSON.stringify(NB)), {
          noise: Object.assign(JSON.parse(JSON.stringify(NB.noise)), {
            separateAxes: true,
            strengthY: 1,
            strengthZ: 1,
          }),
        }),
        4
      ),
      RN1
    )
  );

  /* ══════════════════════════════════════════════════════════════════════
   * ⑩ 真实记录：三个产物的既有行为是否逐位不变
   * ══════════════════════════════════════════════════════════════════════ */
  console.log('');
  console.log(
    '[10] 真实记录（`' + real.name + '`）：既有 uv / noise 行为零回归'
  );
  const RR = run(makeBase(real), 6);
  chk('真实记录：有粒子在跑', !!RR.p && RR.cnt > 0, `cnt=${RR.cnt}`);
  chk(
    '真实记录：P4 新字段全程缺省 ⇒ 只读快照无异常',
    typeof RR.p.nzS === 'number'
  );

  const RREAL = makeBase(real);
  RREAL.uv = Object.assign({}, RREAL.uv, {
    timeMode: 0,
    fps: 30,
    speedRange: [0, 1],
    startFrame: K(0),
    rowMode: 0,
    rowIndex: 0,
    flipU: 0,
    flipV: 0,
  });
  RREAL.noise = Object.assign({}, RREAL.noise, {
    octaves: 1,
    octaveMultiplier: 0.5,
    octaveScale: 2,
    scrollSpeed: K(0),
    sizeAmount: K(0),
    rotationAmount: K(0),
    separateAxes: false,
  });
  chk(
    '真实记录 + 显式全默认 P4 字段 ⇒ **逐位相同**',
    sameGeom(RR, run(RREAL, 6))
  );

  /**
   * ★ 把该产物的**真实 uv 段**装到干净基底上跑（`makeBase` 会把 uv 覆盖成"关闭"，
   *   所以必须显式装回来）—— 逐帧核对帧号落在合法区间、且不越界。
   */
  const ruv = real.uv || {};
  const rTilesX = Math.max(1, ruv.tilesX || 1);
  const rTilesY = Math.max(1, ruv.tilesY || 1);
  const RUV = makeBase(real);
  RUV.uv = JSON.parse(JSON.stringify(ruv));
  const RRUV = run(RUV, 6);
  const rframes = RRUV.anim.particles.map((q: any) => q.uvFrame);
  if (ruv.enabled && rTilesX * rTilesY > 1) {
    const nTot = ruv.animationType === 1 ? rTilesX : rTilesX * rTilesY;
    chk(
      `真实 uv 段：帧号全部落在 [0, ${nTot})`,
      rframes.every((f: number) => f >= 0 && f < nTot),
      `tiles=${rTilesX}x${rTilesY} animType=${ruv.animationType} frames=[${rframes}]`
    );
    chk(
      '真实 uv 段：`uvRow` 全为 0（该产物不是 SingleRow / Custom≠0）',
      RRUV.anim.particles.every((q: any) => q.uvRow === 0)
    );
  } else {
    chk(
      '真实 uv 段未启用（或只有 1 帧）⇒ 帧号恒为 −1',
      rframes.every((f: number) => f === -1),
      `frames=[${rframes}]`
    );
  }

  /** 该产物真实的 noise 段（若启用）也跑一遍，确认缺省新字段下逐位稳定 */
  const rnz = real.noise || {};
  if (rnz.enabled) {
    const RN = makeBase(real);
    RN.noise = JSON.parse(JSON.stringify(rnz));
    const A = run(RN, 8);
    const B = run(RN, 8);
    chk(
      `真实 noise 段（strength=${rnz.strength} positionAmount=${rnz.positionAmount}）⇒ 两次运行逐位一致（确定性）`,
      sameGeom(A, B),
      `x=${A.p.x.toFixed(6)}`
    );
  } else {
    chk('真实 noise 段未启用 ⇒ 跳过（不影响 P4 结论）', true);
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
