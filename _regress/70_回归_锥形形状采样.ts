/**
 * 70 · 回归：**锥形（Cone / ConeVolume）的形状采样**
 *
 * ## 钉的是什么
 *
 * 2026-10-16 的 P0「修锥形」（`docx/TODO.md` §2.5 / `docx/RESEARCH_粒子系统复刻参考.md` §8）
 * 把 `ParticleAnimator.spawn()` 的锥形分支从"沿垂直于锥轴的一条线放点"改成
 * **XY 平面内按 `arc` 取方位角、按 `radiusThickness` 取半径、按 `m_Scale`（`boxX/boxY`）
 * 各轴缩放**。旧实现的三条硬伤与三方实现证据见该分支的长注释（此处不复述）。
 *
 * 本脚本**直接 import 出货用的 `ParticleAnimator`**（`--transpile-only` 只跳过类型检查、
 * 不改变逻辑），用**真实 config 记录**做基底、只覆盖 `shape` 那几个字段，逐条钉住：
 *
 *   ① 方位角覆盖 `arc` 扇形（`arc = 360` ⇒ 全圆）；
 *   ② 半径落在 `[R(1−th), R]`，且 `th = 0` ⇒ 恰好贴在圆周；
 *   ③ **不再是一条线**：两个方向都有离散度、方向角覆盖多个扇区（旧实现必挂）；
 *   ④ `m_Scale` 各轴缩放生效（非等比 ⇒ 椭圆）；字段缺省 / 非正 ⇒ 半径不放大；
 *   ⑤ `arcMode = 3`（BurstSpread）沿弧均布；
 *   ⑥ ConeVolume 的**轴向位移** `t ∈ [0, H]`（Cone/Base 恒为 0）；
 *   ⑦ 方向发散仍是"锥轴 ± (ρ/R)·(angle/2)"（z 分量丢弃的 2D 口径）。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/70_回归_锥形形状采样.ts [config路径]
 *
 * 路径解析规则见 `_regress/README.md`（命令行参数 > 环境变量 `WK_CONFIG` > 仓库内缺省）。
 * 缺省 `public/assets/config.json` 里 `qiqiu`(Cone) / `niao`(ConeVolume) 两支即可覆盖全部用例。
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * `@src/*` 是出货代码用的 webpack alias（见 `tsconfig.json` 的 `paths`），
 * ts-node 裸跑不认识 ⇒ 这里补一条解析规则。
 *
 * ⚠️ 补丁必须在 `require('../src/animator/ParticleAnimator')` **之前**生效，
 * 所以下面刻意用 `require` 而不是 `import`（ES import 会被提升到补丁之前）。
 * ⚠️ `module` 必须用 `require` 取**原对象**：`import * as Module from 'module'`
 * 经 `__importStar` 后拿到的是只读包装（属性都是 getter，赋值会抛
 * "which has only a getter"）。
 */
const ROOT = path.join(__dirname, '..');
const NodeModule: any = require('module');
const origResolve: any = NodeModule._resolveFilename;
/** ⚠️ 必须把改写后的 `request` **重新传参**（`arguments[0]` 仍是原值，改局部变量没用）。 */
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
  console.log(
    `   [${cond ? 'OK  ' : '★!  '}] ${label}${detail ? '   ' + detail : ''}`
  );
}

/* ── 采样 ───────────────────────────────────────────────────────────────── */

type Sample = { x: number; y: number; vx: number; vy: number };

/**
 * 用一条真实记录作基底，覆盖 `shape` 后连续 `spawn()` `n` 次。
 * ⚠️ 每次采完把 `particles` 清空：`spawn()` 只往数组里 push，不清会白涨内存。
 */
function sample(base: any, shapeOverride: any, n: number, batch?: [number, number]) {
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.shape = Object.assign({}, cfg.shape, shapeOverride);
  cfg.maxNumParticles = 1000000;
  const a: any = new ParticleAnimator(cfg, new THREE.Texture());
  if (batch) {
    a.batchCount = batch[0];
    a.emittedInBatch = batch[1];
  }
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    a.particles.length = 0;
    a.spawn();
    const p = a.particles[0];
    out.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy });
  }
  return out;
}

/* ── 统计小工具 ─────────────────────────────────────────────────────────── */
const min = (a: number[]) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const max = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
function std(a: number[]) {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) * (v - m))));
}
/** 归一化到 [0, 2π) */
const wrap2pi = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
/** 有符号角差，落在 (−π, π] */
const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};
/** 绕 Z 轴旋转二维向量（弧度）—— 与引擎 `rotVec` 同式，本脚本独立实现以免自证 */
const rotVec2 = (x: number, y: number, rot: number) => ({
  x: x * Math.cos(rot) - y * Math.sin(rot),
  y: x * Math.sin(rot) + y * Math.cos(rot),
});

/* ── 载入 config ────────────────────────────────────────────────────────── */
function main() {
  console.log('='.repeat(78));
  console.log('70 · 锥形（Cone / ConeVolume）形状采样回归');
  console.log('='.repeat(78));
  console.log(`   config  ${cfgPath}`);

  if (!fs.existsSync(cfgPath)) {
    console.log('   ★! config 不存在 —— 先跑构建链（或传一个存在的 config 路径）');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const particles: any[] = (cfg.meshes || []).filter(
    (m: any) => m.type === 'particle' && m.shape && m.shape.enabled
  );
  const cones = particles.filter((m: any) => m.shape.type === 4 || m.shape.type === 8);
  console.log(`   粒子组 ${particles.length} 支，其中锥形 ${cones.length} 支`);
  if (!cones.length) {
    console.log('   ★! 该 config 里没有锥形（type 4/8）—— 换一个含锥形的工程再跑');
    process.exit(1);
  }

  const coneBase = cones.find((m: any) => m.shape.type === 4) || cones[0];
  const volBase = cones.find((m: any) => m.shape.type === 8);
  const base = coneBase;
  const s = base.localScale;
  const u = base.unitScale;
  const nodeRot = (base.nodeRotZ || 0) * DEG;
  const dirAngle = Math.atan2(base.emitDir[1], base.emitDir[0]);

  console.log(
    `   基准记录 ${base.name}：radius=${base.shape.radius} te=${base.shape.radiusThickness} ` +
      `arc=${base.shape.arc} box=(${base.shape.boxX},${base.shape.boxY}) ` +
      `s=${s} u=${u} nodeRotZ=${base.nodeRotZ}`
  );

  /* ── ① 方位角覆盖 arc + 半径区间（arc = 360 的基准记录）──────────────── */
  console.log('');
  console.log('[1] 方位角覆盖 `arc`、半径落在 [R(1−te), R]（te = 0.8，arc = 360）');
  const N = 4000;
  const SH0 = { arc: 360, arcMode: 0, radiusThickness: 0.8 };
  const R = base.shape.radius * s * u;
  const scX0 = base.shape.boxX > 0 ? base.shape.boxX : 1;
  const scY0 = base.shape.boxY > 0 ? base.shape.boxY : 1;
  const S = sample(base, SH0, N);
  // ρ = 把各轴缩放剥掉后的半径
  const rho = S.map((p) => Math.hypot(p.x / scX0, p.y / scY0));
  console.log(
    `   半径/R：min=${(min(rho) / R).toFixed(4)}  max=${(max(rho) / R).toFixed(4)}` +
      `  期望 ∈ [${(1 - 0.8).toFixed(2)}, 1]`
  );
  chk('ρ 上界 = R', Math.abs(max(rho) - R) / R < 1e-3, `max/R=${(max(rho) / R).toFixed(6)}`);
  // ρ = R(1−te+te·√u)，u 取自 N 次采样 ⇒ 最小值只能**统计上**逼近 R(1−te)：
  // 期望的下探深度 ≈ R·te·√(6/N)（6/N 是 min(u) 的量级估计），断言给这个上界。
  const rhoLo = R * (1 - 0.8 + 0.8 * Math.sqrt(6 / N));
  chk(
    'ρ 下界 ≥ R(1−te)（且 4000 次采样的最小值落在统计预期内）',
    min(rho) >= R * (1 - 0.8) - 1e-9 && min(rho) <= rhoLo,
    `min/R=${(min(rho) / R).toFixed(6)}  期望 ∈ [0.2, ${(rhoLo / R).toFixed(4)}]`
  );

  // 方位角：arc=360 ⇒ 全圆；起点 = nodeRotZ
  const phis = S.map((p) => wrap2pi(Math.atan2(p.y, p.x)));
  // 用"相对 nodeRotZ 的差"做 12 个 30° 扇区的覆盖统计
  const buckets = new Array(12).fill(0);
  phis.forEach((ph) => {
    buckets[Math.floor(wrap2pi(ph - nodeRot) / (30 * DEG)) % 12]++;
  });
  chk(
    '方位角铺满 12 个 30° 扇区（旧实现只落 2 个点 ⇒ 必挂）',
    buckets.every((c) => c > N * 0.02),
    `每扇区 ${min(buckets)}~${max(buckets)} 颗`
  );

  /* ── ①b 每条锥形记录**按原生 shape** 采样 ───────────────────────────── */
  console.log('');
  console.log('[1b] 各锥形记录按**原生** shape 采样（不改 arc / 不改 m_Scale）');
  let nativeOK = true;
  for (const m of cones) {
    const ss = m.localScale;
    const uu = m.unitScale;
    const scx = m.shape.boxX > 0 ? m.shape.boxX : 1;
    const scy = m.shape.boxY > 0 ? m.shape.boxY : 1;
    const nr = (m.nodeRotZ || 0) * DEG;
    const arcD = m.shape.arc > 0 ? m.shape.arc : 360;
    const Smp = sample(m, {}, 2000);
    const prho = Smp.map((p) => Math.hypot(p.x, p.y));
    const rels = Smp.map((p) => wrap2pi(Math.atan2(p.y, p.x) - nr) / DEG);
    const inArc = max(rels) <= arcD + 1e-6 && min(rels) >= -1e-9;
    // type = 4（Base，无轴向位移）且 m_Scale 等比时，|p| 的上确界 = radius·m_Scale·s·u
    const REff = m.shape.radius * ss * uu * Math.max(scx, scy);
    const eqOK =
      m.shape.type !== 4 ||
      Math.abs(scx - scy) > 1e-9 ||
      Math.abs(max(prho) - REff) <= 1e-3 * REff;
    console.log(
      `   ${m.name}: type=${m.shape.type} radius=${m.shape.radius} te=${m.shape.radiusThickness}` +
        ` box=(${scx},${scy}) arc=${arcD}°` +
        `\n       有效半径 max=${max(prho).toFixed(4)}（` +
        (m.shape.type === 4
          ? `radius×m_Scale×s×u = ${REff.toFixed(4)}，应相等`
          : `type=8 还含轴向位移 H=${(m.shape.length * ss * uu).toFixed(3)} ⇒ 与此值不同轴、不可比`) +
        `）  方位角 ${min(rels).toFixed(2)}°~${max(rels).toFixed(2)}°`
    );
    if (!inArc) {
      nativeOK = false;
      console.log('       ★! 方位角越出 arc 范围');
    }
    if (!eqOK) {
      nativeOK = false;
      console.log('       ★! 有效半径与 radius×m_Scale 不符（m_Scale 被忽略或乘错）');
    }
  }
  chk(
    '每条锥形记录：方位角 ∈ [0, arc]（原生 arc 生效）且有效半径 = radius × m_Scale',
    nativeOK
  );

  /* ── ② "不再是一条线"：两轴都有离散度 ────────────────────────────────── */
  console.log('');
  console.log('[2] 位置不是一条线（回归核心）');
  const sdX = std(S.map((p) => p.x));
  const sdY = std(S.map((p) => p.y));
  chk(
    'x / y 两轴标准差都 > 0.1R（旧实现在其中一轴恒为 0）',
    sdX > 0.1 * R && sdY > 0.1 * R,
    `sdX=${sdX.toFixed(3)} sdY=${sdY.toFixed(3)} R=${R.toFixed(3)}`
  );

  /* ── ③ te = 0 ⇒ 恰好贴圆周；te = 1 ⇒ 填满圆盘 ────────────────────────── */
  console.log('');
  console.log('[3] `radiusThickness` 的两个端点');
  const S0 = sample(base, { arc: 360, arcMode: 0, radiusThickness: 0 }, 500);
  const rho0 = S0.map((p) => Math.hypot(p.x / scX0, p.y / scY0));
  chk(
    'te = 0 ⇒ ρ ≡ R（只从外表面发射）',
    Math.abs(max(rho0) - R) / R < 1e-3 && Math.abs(min(rho0) - R) / R < 1e-3,
    `ρ/R ∈ [${(min(rho0) / R).toFixed(6)}, ${(max(rho0) / R).toFixed(6)}]`
  );
  const S1 = sample(base, { arc: 360, arcMode: 0, radiusThickness: 1 }, 4000);
  const rho1 = S1.map((p) => Math.hypot(p.x / scX0, p.y / scY0));
  // 面积均匀（ρ = R√u）⇒ 中位数 ≈ R/√2 ≈ 0.707R；线性口径会是 0.5R
  const med1 = rho1.slice().sort((a, b) => a - b)[Math.floor(rho1.length / 2)] / R;
  console.log(`   te = 1 的 ρ 中位数/R = ${med1.toFixed(4)}（面积均匀口径应 ≈ 0.707）`);
  chk(
    'te = 1 ⇒ √u（面积均匀）而非线性',
    Math.abs(med1 - 0.7071) < 0.02,
    `|中位数 − 0.7071| = ${Math.abs(med1 - 0.7071).toFixed(4)}`
  );

  /* ── ④ arc 收窄 = 扇形 ───────────────────────────────────────────────── */
  console.log('');
  console.log('[4] `arc = 90°` ⇒ 点只落在 [nodeRotZ, nodeRotZ + 90°]');
  const SQ = sample(base, { arc: 90, arcMode: 0, radiusThickness: 0.8 }, 2000);
  const rel = SQ.map((p) => wrap2pi(Math.atan2(p.y, p.x) - nodeRot));
  chk(
    '方位角相对 nodeRotZ ∈ [0°, 90°]',
    max(rel) <= 90 * DEG + 1e-6 && min(rel) >= -1e-9,
    `范围 ${(min(rel) / DEG).toFixed(3)}° ~ ${(max(rel) / DEG).toFixed(3)}°`
  );

  /* ── ⑤ arcMode = 3（BurstSpread）沿弧均布 ───────────────────────────── */
  console.log('');
  console.log('[5] `arcMode = 3` ⇒ 沿弧均布（相位 = 批次序号）');
  const NB = 8;
  let spreadOK = true;
  for (let i = 0; i < NB; i++) {
    const one = sample(coneBase, { arc: 360, arcMode: 3, radiusThickness: 0 }, 1, [NB, i])[0];
    const want = wrap2pi(nodeRot + (i / NB) * 2 * Math.PI);
    const got = wrap2pi(Math.atan2(one.y, one.x));
    if (Math.abs(angDiff(got, want)) > 1e-6) {
      spreadOK = false;
      console.log(`      序号 ${i}：期望 ${(want / DEG).toFixed(2)}°，实得 ${(got / DEG).toFixed(2)}°`);
    }
  }
  chk('8 个批次的方位角 = nodeRotZ + i/8·360°', spreadOK);

  /* ── ⑥ m_Scale 各轴缩放 ─────────────────────────────────────────────── */
  console.log('');
  console.log('[6] `m_Scale`（boxX/boxY）各轴缩放');
  const SX = 200;
  const SY = 50;
  /**
   * ★ 2026-10-16 修正（P1「position/rotation 偏移」）：`m_Scale` 与 `m_Rotation` 的施加顺序。
   *
   * Unity `ShapeModuleUI.OnShapeToolGUI` 的发射矩阵是
   * `Matrix4x4.TRS(position, Quaternion.Euler(rotation), scale)` ⇒ **T·R·S**，
   * 即"**先各轴缩放、再旋转**"（Cocos `constructMat()` + `transformMat4` 同）。
   * 旧实现的等价形式是"把节点旋角折进方位角再逐轴缩放" = `S·R`（缩放最外层），
   * 仅在等比 `m_Scale` 时才与 `R·S` 等价 —— 所以旧断言"归一化半径 ≤ 1"其实**钉的是错的顺序**
   * （它隐含假设椭圆与坐标轴对齐）。本支改为：
   *   · 合角 `rot = rotZ + nodeRotZ` 抵消到 0 ⇒ 椭圆与轴对齐（归一化半径 ≤ 1）；
   *   · 合角 ≠ 0 ⇒ 椭圆被整体旋转 `rot`：**把采样点先转回 −rot 再做归一化**必须 ≤ 1，
   *     而"不转回"的归一化必须出现 > 1（这条能分辨 R·S 与 S·R）。
   * 三个产物里只有 S6 `yuan_glow`（1.5, 0.5）是非等比，其 `rotZ = 0`、`nodeRotZ = −0.0`
   * ⇒ 两种顺序同值，零影响。
   */
  const rotDeg0 = base.nodeRotZ || 0;
  const SE0 = sample(
    base,
    { arc: 360, arcMode: 0, radiusThickness: 1, boxX: SX, boxY: SY, rotZ: -rotDeg0 },
    4000
  );
  const normAligned = SE0.map((p) => Math.hypot(p.x / (R * SX), p.y / (R * SY)));
  console.log(
    `   合角 0：归一化半径 min=${min(normAligned).toFixed(4)} max=${max(normAligned).toFixed(4)}  期望 ∈ [0, 1]`
  );
  chk('合角 0 ⇒ 采样点全在椭圆内（归一化半径 ≤ 1）', max(normAligned) <= 1 + 1e-6);
  chk(
    '两轴都用到缩放（x 端展到 R·boxX、y 端展到 R·boxY）',
    max(normAligned) > 0.99 && min(normAligned) < 0.05
  );

  const ROT_EXTRA = 40; // 额外旋角（度）
  const rotTot = (rotDeg0 + ROT_EXTRA) * DEG;
  const SE = sample(
    base,
    { arc: 360, arcMode: 0, radiusThickness: 1, boxX: SX, boxY: SY, rotZ: ROT_EXTRA },
    4000
  );
  // TRS 顺序（R·S）：把采样点转回 −rot 后，椭圆应与轴对齐 ⇒ 归一化半径 ≤ 1
  const normBack = SE.map((p) => {
    const b = rotVec2(p.x, p.y, -rotTot);
    return Math.hypot(b.x / (R * SX), b.y / (R * SY));
  });
  // S·R 顺序会得到的量：直接归一化（不平移旋转）——用于"能分辨两种顺序"的反证
  const normRaw = SE.map((p) => Math.hypot(p.x / (R * SX), p.y / (R * SY)));
  console.log(
    `   合角 ${(rotDeg0 + ROT_EXTRA).toFixed(2)}°：转回后 max=${max(normBack).toFixed(4)}（应 ≤ 1）` +
      `；不转回 max=${max(normRaw).toFixed(4)}（> 1 ⇒ 椭圆确实被旋转 = R·S 顺序）`
  );
  chk(
    '`m_Scale` 与 `m_Rotation` 的顺序 = Unity `TRS`（先缩放后旋转，R·S）',
    max(normBack) <= 1 + 1e-6 && max(normRaw) > 1.05
  );
  const SD2 = sample(base, { arc: 360, arcMode: 0, radiusThickness: 1, boxX: 0, boxY: 0 }, 2000);
  const rho2 = SD2.map((p) => Math.hypot(p.x, p.y));
  chk(
    'boxX / boxY 缺省或 0 ⇒ 视为 1（半径不放大，旧 config 零回归）',
    Math.abs(max(rho2) - R) / R < 1e-3,
    `max ρ/R = ${(max(rho2) / R).toFixed(6)}`
  );

  /* ── ⑦ ConeVolume 的轴向几何 ────────────────────────────────────────── */
  console.log('');
  if (volBase) {
    const vh = (volBase.shape.length || 0) * volBase.localScale * volBase.unitScale;
    const vR = volBase.shape.radius * volBase.localScale * volBase.unitScale;
    const vDir = Math.atan2(volBase.emitDir[1], volBase.emitDir[0]);
    const vAng = (volBase.shape.angle || 0) * DEG;
    const vK = Math.tan(vAng); // 每单位轴向长度，截面半径的增量
    const vRf = vR + vK * vh;
    console.log(
      `   ConeVolume(${volBase.name})：R=${vR.toFixed(3)}  H=${vh.toFixed(3)}  angle=${(vAng / DEG).toFixed(3)}°` +
        `  ⇒ 远盘半径 = R + H·tan(angle) = ${vRf.toFixed(3)}（**张开**，不是收成一点）`
    );

    /**
     * ★★ 2026-10-16 重写本段断言：锥的**轴向几何**被修正了（P1「ConeVolume(8) 的轴向」）。
     * 旧断言（"t = H·u^(1/3)、ρ ∝ t/H、平面偏移 ≤ R"）钉的是**错口径** ——
     * 它把锥当成"顶点在发射器"的反向锥。权威依据是 Unity 官方 gizmo 源码
     * `ConeFrustrumHandle.cs` 的注释：*"radius is **near-radius at start of cone frustrum**"*、
     * `farRadius = |range·tan(angle)| + nearRadius` ⇒ **近盘 = `radius` 在原点、沿轴张开**。
     * （feng3d `ParticleSystemShapeCone.ts` 同向。）详见 `ParticleAnimator.spawn()` 该分支注释。
     *
     * 新的可判据（与施加顺序无关、用"到轴线的距离"这个旋转不变量）：
     *   · 取 `radiusThickness = 0`（只从锥面发射）⇒ 到轴线的距离 = `rad(t) = R + k·t`
     *     ⇒ 该距离的下确界 ≈ `R`（t→0 处的近盘）、上确界 ≈ `R + k·H`；
     *     **旧口径下下确界会是 0**（顶点）⇒ 这条能分辨新旧。
     *   · `radius = 0` 且 `angle = 0`（半径 0 的"圆柱" = 纯轴线）⇒ 平面偏移恒 0，
     *     此时 `p·轴` 就是纯轴向位移 `t`，可断言 `t = H·u`（均匀）与 `t ∈ [0, H]`。
     *   · 体积内取点的 t 分布：`pdf ∝ rad(t)²` ⇒ 均值 = ∫t·rad²/∫rad²（闭式解析，非照抄实现）。
     */
    const SZ = sample(
      volBase,
      { arc: 360, arcMode: 0, radiusThickness: 0, radius: 0, angle: 0, boxX: 0, boxY: 0 },
      4000
    );
    const tz = SZ.map((p) => p.x * Math.cos(vDir) + p.y * Math.sin(vDir));
    const tzN = SZ.map((p) => Math.abs(-p.x * Math.sin(vDir) + p.y * Math.cos(vDir)));
    console.log(
      `   radius=0, angle=0（纯轴线）⇒ t∈[${min(tz).toFixed(4)}, ${max(tz).toFixed(4)}]` +
        `  均值=${(mean(tz) / vh).toFixed(4)}H`
    );
    chk('ConeVolume：轴向位移 t ∈ [0, H]', min(tz) > -1e-6 && max(tz) <= vh + 1e-6);
    chk(
      'ConeVolume：angle = 0 ⇒ t = H·u（圆柱，沿轴均匀）',
      Math.abs(max(tz) - vh) / vh < 0.02 && Math.abs(mean(tz) / vh - 0.5) < 0.02
    );
    chk('ConeVolume：radius = 0 且 angle = 0 ⇒ 平面偏移为 0（只剩轴向位移）', max(tzN) < 1e-9);

    // 锥面采样：**把轴向位移与侧向偏移彻底分开**再逐条比对
    //
    // ★ 为什么要这么绕：本引擎的 2D 化把"锥的底面圆盘"直接当成**屏幕平面内的圆盘**
    //   （见 `ParticleAnimator.spawn()` 锥形分支的注释）⇒ 侧向偏移向量 `ρ·(cosφ, sinφ)`
    //   与锥轴**同在屏幕平面内**，于是 `p·轴` 会被侧向分量污染、"到轴线的距离"更是无意义
    //   （它只等于 `ρ·|sin(φ−轴角)|`）。
    //   ⇒ 干净的读法：把 `arc` 压到 ~0（⇒ φ ≡ 0，侧向方向固定 = `rot`）并令
    //     `rot = 轴角 + 90°`（侧向与轴**正交**）⇒ 此时
    //       `t = p·轴`、`ρ = |p − (p·轴)·轴|`，两者都可逐颗精确读出。
    const perp = vDir + Math.PI / 2;
    const rotZPerp = perp / DEG - (volBase.nodeRotZ || 0);
    const SA = sample(
      volBase,
      { arc: 1e-6, arcMode: 0, radiusThickness: 0, boxX: 1, boxY: 1, rotZ: rotZPerp },
      6000
    );
    const tA = SA.map((p) => p.x * Math.cos(vDir) + p.y * Math.sin(vDir));
    const rhoA = SA.map((p) => Math.abs(-p.x * Math.sin(vDir) + p.y * Math.cos(vDir)));
    const devA = SA.map((p, i) => Math.abs(rhoA[i] - (vR + vK * tA[i])));
    console.log(
      `   正交化后（arc≈0、thickness=0）⇒ t∈[${min(tA).toFixed(3)}, ${max(tA).toFixed(3)}]` +
        `  ρ∈[${min(rhoA).toFixed(3)}, ${max(rhoA).toFixed(3)}]`
    );
    chk('ConeVolume：t ∈ [0, H]（正交化后逐颗可读）', min(tA) > -1e-6 && max(tA) <= vh + 1e-6);
    chk(
      'ConeVolume：逐颗满足 ρ = R + t·tan(angle)（近盘半径 R、沿轴张开）',
      max(devA) < 1e-6 * Math.max(1, vRf),
      `max |ρ − (R + k·t)| = ${max(devA).toExponential(3)}`
    );
    chk(
      'ConeVolume：近盘下确界 ≈ R（旧口径会掉到 0）',
      min(rhoA) >= vR * 0.999 && min(rhoA) <= vR * 1.02,
      `min ρ = ${min(rhoA).toFixed(3)} / R = ${vR.toFixed(3)}`
    );
    chk(
      'ConeVolume：远盘上确界 ≈ R + H·tan(angle)',
      max(rhoA) <= vRf * 1.001 && max(rhoA) >= vRf * 0.98,
      `max ρ = ${max(rhoA).toFixed(3)} / Rf = ${vRf.toFixed(3)}`
    );
    // thickness = 1 ⇒ ρ = rad(t)·√u（面积均匀），上界仍是 rad(t)
    const SB = sample(
      volBase,
      { arc: 1e-6, arcMode: 0, radiusThickness: 1, boxX: 1, boxY: 1, rotZ: rotZPerp },
      6000
    );
    const tB = SB.map((p) => p.x * Math.cos(vDir) + p.y * Math.sin(vDir));
    const rhoB = SB.map((p) => Math.abs(-p.x * Math.sin(vDir) + p.y * Math.cos(vDir)));
    const overB = SB.map((_p, i) => rhoB[i] - (vR + vK * tB[i]));
    console.log(`   thickness = 1 ⇒ max(ρ − rad(t)) = ${max(overB).toFixed(6)}（应 ≤ 0）`);
    chk('ConeVolume：thickness = 1 ⇒ ρ ≤ rad(t)（截面内铺开）', max(overB) <= 1e-6 * Math.max(1, vRf));

    // 体积内取点：pdf(t) ∝ rad(t)² 的解析均值
    const SV = sample(volBase, { arc: 360, arcMode: 0, radiusThickness: 1, boxX: 1, boxY: 1 }, 20000);
    const tv = SV.map((p) => p.x * Math.cos(vDir) + p.y * Math.sin(vDir));
    /** 解析：`∫₀ᴴ t·(R+kt)²dt / ∫₀ᴴ (R+kt)²dt`（梯形中点积分；**不照抄实现**） */
    const integ = (fn: (t: number) => number) => {
      const N = 20000;
      let s = 0;
      for (let i = 0; i < N; i++) s += fn(((i + 0.5) * vh) / N);
      return (s * vh) / N;
    };
    const tMeanTheory =
      integ((t) => t * Math.pow(vR + vK * t, 2)) / integ((t) => Math.pow(vR + vK * t, 2));
    console.log(
      `   体积内均匀 ⇒ t 均值 实测=${(mean(tv) / vh).toFixed(4)}H / 解析=${(tMeanTheory / vh).toFixed(4)}H`
    );
    chk(
      'ConeVolume：体积内取点 t 的均值 = 解析值（pdf ∝ 截面半径²）',
      Math.abs(mean(tv) - tMeanTheory) / vh < 0.02,
      `|Δ| = ${(Math.abs(mean(tv) - tMeanTheory) / vh).toFixed(4)}H`
    );

    // Cone（Base）不该有轴向位移
    const tsCone = S.map((p) => p.x * Math.cos(dirAngle) + p.y * Math.sin(dirAngle));
    console.log(
      `   Cone(Base, ${base.name})：轴向投影 ∈ [${min(tsCone).toFixed(4)}, ${max(tsCone).toFixed(4)}]` +
        `（应为 ±R 量级、无 H 项）`
    );
    chk(
      'Cone(Base)：无轴向位移（|t| ≤ R·max(box)）',
      max(tsCone.map(Math.abs)) <= R * Math.max(scX0, scY0) + 1e-6
    );
  } else {
    console.log('[7] 跳过：该 config 没有 ConeVolume（type 8）');
  }

  /* ── ⑧ 方向发散口径 ─────────────────────────────────────────────────── */
  console.log('');
  console.log('[8] 方向发散 = 锥轴 ± (ρ/R)·(angle/2)，幅度不随 arc 变');
  const sv = S.filter((p) => Math.hypot(p.vx, p.vy) > 1e-9);
  if (sv.length) {
    const devs = sv.map((p) => Math.abs(angDiff(Math.atan2(p.vy, p.vx), dirAngle)));
    const lim = ((base.shape.angle || 0) / 2) * DEG;
    console.log(
      `   偏轴角 max=${(max(devs) / DEG).toFixed(4)}° 上限 (angle/2)=${(lim / DEG).toFixed(3)}°` +
        `（粒子里有 ${sv.length}/${S.length} 颗 startSpeed ≠ 0）`
    );
    chk('全部偏轴角 ≤ angle/2', max(devs) <= lim + 1e-6);
  } else {
    console.log('   基准记录 startSpeed ≡ 0（如 S8 特效）⇒ 方向发散不影响观感，跳过幅值断言');
    chk('startSpeed ≡ 0 时速度恒为 0', S.every((p) => p.vx === 0 && p.vy === 0));
  }

  /* ── 汇总 ───────────────────────────────────────────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(78));
  process.exit(fail ? 1 : 0);
}

main();
