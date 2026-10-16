/**
 * 71 · 回归：**形状族补充**（P1）
 *
 * ## 钉的是什么
 *
 * `docx/TODO.md` §2.5 的 **P1「补形状族：Sphere / Hemisphere / ConeVolume(8) 的轴向、Edge、
 * position/rotation 偏移」** 落在 `ParticleAnimator.spawn()`：
 *
 *   ① `Sphere(0)` / `SphereShell(1)` / `Hemisphere(2)` / `HemisphereShell(3)` 与 `Circle(10)`
 *      合流成"**圆盘族**"（Unity 手册：*"Sphere, Hemisphere, and Circle have the same
 *      properties."*；正交投影下半球与整球的 `(x,y)` 分布相同 ⇒ 2D 下三者的**位置**口径完全一致）；
 *   ② 圆盘族的方向 = **径向**（手册 *"a Sphere emits particles outward in all directions"*、
 *      Circle *"move only in the plane of the circle"*；Cocos `Vec3.normalize(dir,pos)` /
 *      feng3d `dir = (cos a, sin a, 0)` 同口径）—— 不是旧的"锥轴 ± angle/2"；
 *   ③ `SingleSidedEdge(12)` / `CircleEdge(11)`：线段沿**本地 X**（半长 = `radius`）、
 *      方向沿**本地 +Y**（手册 *"The particles move in the emitter object's upward (Y)
 *      direction."*）；
 *   ④ `m_Scale` / `m_Position` / `m_Rotation` 从"仅 Box"提升为**全形状通用**，且顺序严格按
 *      Unity 的 `TRS`（`ShapeModuleUI.OnShapeToolGUI`）⇒ **先各轴缩放、再旋转、最后平移**；
 *   ⑤ obsolete 变体折叠到基类型（`1→0 / 3→2 / 7→4 / 9→8 / 11→10`）；
 *   ⑥ `ConeVolume(8)` 的轴向几何改为"**近盘半径 `radius` 在原点、沿轴张开**"
 *      （`ConeFrustrumHandle.cs`：`farRadius = |range·tan(angle)| + nearRadius`）——
 *      本脚本只做"既有 4/5/8/10 位置口径零回归"的旁证，锥形细节在 `70_` 里。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/71_回归_形状族补充.ts [config路径]
 *
 * 路径解析规则见 `_regress/README.md`（命令行参数 > 环境变量 `WK_CONFIG` > 仓库内缺省）。
 * 本脚本**不要求 config 里真有 Sphere/Hemisphere/Edge** —— 它拿一条真实粒子记录当基底，
 * 只覆盖 `shape` 字段来合成各形状（与 `70_` 同一手法）。
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

/* ── 采样 ───────────────────────────────────────────────────────────────── */

type Sample = { x: number; y: number; vx: number; vy: number };

/**
 * 用一条真实记录作基底，覆盖 `shape` 后连续 `spawn()` `n` 次。
 * ⚠️ 每次都把 `particles` 清空：`spawn()` 只往数组里 push，不清会白涨内存。
 * ⚠️ `ParticleAnimator` 的 rng 种子 = `f(meshConfig.name)`（见该文件 `this.rng = new Rng(1013 +
 *    name.length * 7919)`）⇒ **同一条基底记录**的两次采样序列**逐位相同**，
 *    所以下面可以放心做"两种形状逐位一致"的比较。
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
const wrap2pi = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};
/** 逐位相同（浮点严格相等） */
function sameSeq(A: Sample[], B: Sample[]) {
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    if (A[i].x !== B[i].x || A[i].y !== B[i].y || A[i].vx !== B[i].vx || A[i].vy !== B[i].vy) {
      return false;
    }
  }
  return true;
}
/** 只比位置（用于"几何同式、方向不同"的对照） */
function samePos(A: Sample[], B: Sample[]) {
  if (A.length !== B.length) return false;
  for (let i = 0; i < A.length; i++) {
    if (A[i].x !== B[i].x || A[i].y !== B[i].y) return false;
  }
  return true;
}

/* ── 载入 config ────────────────────────────────────────────────────────── */
function main() {
  console.log('='.repeat(78));
  console.log('71 · 形状族补充回归（Sphere / Hemisphere / Edge / 通用 position-rotation）');
  console.log('='.repeat(78));
  console.log(`   config  ${cfgPath}`);

  if (!fs.existsSync(cfgPath)) {
    console.log('   ★! config 不存在 —— 先跑构建链（或传一个存在的 config 路径）');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const parts: any[] = (cfg.meshes || []).filter(
    (m: any) => m.type === 'particle' && m.shape && m.shape.enabled
  );
  if (!parts.length) {
    console.log('   ★! 该 config 里没有启用形状的粒子组 —— 换一个工程再跑');
    process.exit(1);
  }
  const base = parts[0];
  const s = base.localScale;
  const u = base.unitScale;
  const nodeRot = base.nodeRotZ || 0;
  console.log(
    `   基底记录 ${base.name}：shape.type=${base.shape.type} radius=${base.shape.radius} ` +
      `s=${s} u=${u} nodeRotZ=${nodeRot}`
  );

  // 本组用例统一用的"干净"形态参数：等比 m_Scale、无 offset、无 rotZ
  const ISO = { boxX: 1, boxY: 1, offsetX: 0, offsetY: 0, rotZ: 0 };
  const R = (r: number) => r * s * u;

  /* ── ① obsolete 变体折叠 ─────────────────────────────────────────────── */
  console.log('');
  console.log('[1] obsolete 变体折叠到基类型（1→0 / 3→2 / 7→4 / 9→8 / 11→10）');
  const N0 = 600;
  const FAM = [
    [1, 0, 'SphereShell→Sphere'],
    [3, 2, 'HemisphereShell→Hemisphere'],
    [7, 4, 'ConeShell→Cone'],
    [9, 8, 'ConeVolumeShell→ConeVolume'],
    [11, 10, 'CircleEdge→Circle'],
  ] as Array<[number, number, string]>;
  let foldOK = true;
  for (const [shell, baseT, label] of FAM) {
    const ov = Object.assign(
      { arc: 200, arcMode: 0, radiusThickness: 0.5, radius: 7, length: 9, angle: 20 },
      ISO
    );
    const A = sample(base, Object.assign({ type: shell }, ov), N0);
    const B = sample(base, Object.assign({ type: baseT }, ov), N0);
    if (!sameSeq(A, B)) {
      foldOK = false;
      console.log(`       ★ ${label} 与基类型不一致`);
    }
  }
  chk('5 个 obsolete 变体与基类型**逐位相同**', foldOK);

  /* ── ② 圆盘族：Sphere / Hemisphere ≡ Circle（位置） ──────────────────── */
  console.log('');
  console.log('[2] 圆盘族：Sphere(0) / Hemisphere(2) 的位置与 Circle(10) **逐位相同**');
  const OV_DISC = Object.assign(
    { arc: 360, arcMode: 0, radiusThickness: 0.8, radius: 11 },
    ISO
  );
  const SC = sample(base, Object.assign({ type: 10 }, OV_DISC), N0);
  const SS = sample(base, Object.assign({ type: 0 }, OV_DISC), N0);
  const SH = sample(base, Object.assign({ type: 2 }, OV_DISC), N0);
  chk('Sphere 位置 == Circle 位置', sameSeq(SC, SS));
  chk('Hemisphere 位置 == Circle 位置（正交投影下同分布）', sameSeq(SC, SH));

  const rho = SC.map((p) => Math.hypot(p.x, p.y) / R(11));
  console.log(
    `   圆盘族半径/R：min=${min(rho).toFixed(4)} max=${max(rho).toFixed(4)}  期望 ∈ [0.2, 1]`
  );
  chk('ρ 上界 = R', Math.abs(max(rho) - 1) < 1e-3);
  chk('ρ 下界 ≥ R(1−th)', min(rho) >= 0.2 - 1e-9 && min(rho) < 0.35);
  const phis = SC.map((p) => wrap2pi(Math.atan2(p.y, p.x)));
  const buck = new Array(12).fill(0);
  phis.forEach((ph) => buck[Math.floor(wrap2pi(ph - nodeRot * DEG) / (30 * DEG)) % 12]++);
  chk(
    '方位角铺满 12 个扇区（arc = 360）',
    buck.every((c) => c > N0 * 0.02),
    `每扇区 ${min(buck)}~${max(buck)} 颗`
  );

  /* ── ③ 圆盘族的**方向 = 径向**，且速度量级不变 ──────────────────────── */
  console.log('');
  console.log('[3] 方向 = 径向（方向角 ≡ 该颗粒子的方位角 + rot）');
  // 用一条 startSpeed ≠ 0 的基底（若无则覆盖一个非 0 常量）
  const spdBase = { mode: 0, a: 40, b: 40, keysA: [], keysB: [] };
  const c3 = JSON.parse(JSON.stringify(base));
  c3.startSpeed = spdBase;
  const dirOv = Object.assign(
    { type: 0, arc: 360, arcMode: 0, radiusThickness: 0.6, radius: 9 },
    ISO,
    { rotZ: 0 }
  );
  const S3 = (() => {
    const cc = JSON.parse(JSON.stringify(c3));
    cc.shape = Object.assign({}, cc.shape, dirOv);
    cc.maxNumParticles = 1000000;
    const a: any = new ParticleAnimator(cc, new THREE.Texture());
    const out: Sample[] = [];
    for (let i = 0; i < 2000; i++) {
      a.particles.length = 0;
      a.spawn();
      const p = a.particles[0];
      out.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    }
    return out;
  })();
  const devDir = S3.map((p) => Math.abs(angDiff(Math.atan2(p.vy, p.vx), Math.atan2(p.y, p.x))));
  const mags = S3.map((p) => Math.hypot(p.vx, p.vy));
  console.log(
    `   方向偏差 max=${(max(devDir) / DEG).toExponential(3)}°   速度 ∈ [${min(mags).toFixed(4)}, ${max(mags).toFixed(4)}]` +
      `  期望 = 40·s·u = ${(40 * s * u).toFixed(4)}`
  );
  chk('每颗粒子：速度方向 = 其方位角（Radial，含 rot）', max(devDir) < 1e-9);
  chk(
    '速度量级 = startSpeed·s·u（形状不缩放速度）',
    Math.abs(min(mags) - 40 * s * u) < 1e-6 && Math.abs(max(mags) - 40 * s * u) < 1e-6
  );
  // Sphere / Hemisphere 的方向同径向
  const S3s = (() => {
    const cc = JSON.parse(JSON.stringify(c3));
    cc.shape = Object.assign({}, cc.shape, dirOv, { type: 0 });
    cc.maxNumParticles = 1000000;
    const a: any = new ParticleAnimator(cc, new THREE.Texture());
    const out: Sample[] = [];
    for (let i = 0; i < 2000; i++) {
      a.particles.length = 0;
      a.spawn();
      const p = a.particles[0];
      out.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy });
    }
    return out;
  })();
  chk('Sphere 的方向同样逐位 = 径向', sameSeq(S3, S3s));

  /* ── ④ 圆盘族：arc 扇形 + BurstSpread ───────────────────────────────── */
  console.log('');
  console.log('[4] 圆盘族：`arc = 120°` 扇形 / `arcMode = 3` 沿弧均布');
  const SQ = sample(
    base,
    Object.assign({ type: 2, arc: 120, arcMode: 0, radiusThickness: 0.5, radius: 9 }, ISO),
    2000
  );
  const rel = SQ.map((p) => wrap2pi(Math.atan2(p.y, p.x) - nodeRot * DEG));
  chk(
    '方位角相对 nodeRotZ ∈ [0°, 120°]',
    max(rel) <= 120 * DEG + 1e-6 && min(rel) >= -1e-9,
    `范围 ${(min(rel) / DEG).toFixed(3)}° ~ ${(max(rel) / DEG).toFixed(3)}°`
  );
  const NB = 8;
  let spreadOK = true;
  for (let i = 0; i < NB; i++) {
    const one = sample(
      base,
      Object.assign({ type: 0, arc: 360, arcMode: 3, radiusThickness: 0, radius: 9 }, ISO),
      1,
      [NB, i]
    )[0];
    const want = wrap2pi(nodeRot * DEG + (i / NB) * 2 * Math.PI);
    const got = wrap2pi(Math.atan2(one.y, one.x));
    if (Math.abs(angDiff(got, want)) > 1e-6) spreadOK = false;
  }
  chk('BurstSpread：8 个批次的方位角 = nodeRotZ + i/8·360°', spreadOK);

  /* ── ⑤ SingleSidedEdge：线段 + 本地 +Y 方向 ─────────────────────────── */
  console.log('');
  console.log('[5] Edge(12)：线段沿本地 X（半长 = radius）、方向 = 本地 +Y（= rot + 90°）');
  const RE = 6;
  const S5 = sample(
    base,
    Object.assign({ type: 12, radius: RE, radiusThickness: 1, arc: 360, arcMode: 0 }, ISO),
    3000
  );
  // 位置必须**共线**：把点转回本地（−nodeRotZ）后 y ≡ 0，x ∈ [−R, R]
  const loc = S5.map((p) => {
    const c = Math.cos(-nodeRot * DEG);
    const sn = Math.sin(-nodeRot * DEG);
    return { x: p.x * c - p.y * sn, y: p.x * sn + p.y * c };
  });
  const REw = R(RE);
  console.log(
    `   本地坐标：y ∈ [${min(loc.map((q) => q.y)).toExponential(2)}, ${max(loc.map((q) => q.y)).toExponential(2)}]` +
      `  x ∈ [${min(loc.map((q) => q.x)).toFixed(3)}, ${max(loc.map((q) => q.x)).toFixed(3)}]  期望 ±${REw.toFixed(3)}`
  );
  chk('位置共线（本地 y ≡ 0）', max(loc.map((q) => Math.abs(q.y))) < 1e-9);
  chk('线段半长 = radius·s·u（x 端展到 ±R）', Math.abs(max(loc.map((q) => q.x)) - REw) <= 1e-3 * REw && Math.abs(min(loc.map((q) => q.x)) + REw) <= 1e-3 * REw);
  const dirE = S5.map((p) => (Math.hypot(p.vx, p.vy) > 1e-9 ? Math.atan2(p.vy, p.vx) : NaN));
  const hasSpd = dirE.filter((d) => !Number.isNaN(d));
  if (hasSpd.length) {
    const devE = hasSpd.map((d) => Math.abs(angDiff(d, nodeRot * DEG + Math.PI / 2)));
    chk(
      '方向恒为 rot + 90°（本地 +Y）',
      max(devE) < 1e-9,
      `有速度的粒子 ${hasSpd.length}/${S5.length}，偏差 max=${(max(devE) / DEG).toExponential(2)}°`
    );
  } else {
    console.log('   基底 startSpeed ≡ 0 ⇒ 方向断言跳过（位置已锚住线段几何）');
    chk('startSpeed ≡ 0 时速度恒为 0', S5.every((p) => p.vx === 0 && p.vy === 0));
  }
  // CircleEdge(11) 折叠 ⇒ 圆盘（不是线段）
  const S11 = sample(
    base,
    Object.assign({ type: 11, radius: RE, radiusThickness: 0.5, arc: 360, arcMode: 0 }, ISO),
    500
  );
  chk(
    'CircleEdge(11) 折叠为圆盘（半径 ≤ R、非共线）',
    max(S11.map((p) => Math.hypot(p.x, p.y) / REw)) <= 1 + 1e-6 &&
      max(S11.map((p) => Math.abs(p.y))) > 0.1 * REw
  );

  /* ── ⑥ position / rotation 偏移（全形状通用） ────────────────────────── */
  console.log('');
  console.log('[6] `m_Position` / `m_Rotation`：全形状通用、按 Unity `TRS` 顺序');
  // ① offset 是**平移**：与 offset=0 的样本差恒定，且不受 rot 旋转
  const A6 = sample(base, Object.assign({ type: 0, arc: 360, arcMode: 0, radiusThickness: 0.5, radius: 5 }, ISO), 500);
  const B6 = sample(
    base,
    Object.assign({ type: 0, arc: 360, arcMode: 0, radiusThickness: 0.5, radius: 5 }, ISO, {
      offsetX: 3,
      offsetY: -2,
    }),
    500
  );
  const dx = B6.map((p, i) => p.x - A6[i].x);
  const dy = B6.map((p, i) => p.y - A6[i].y);
  chk(
    '`m_Position` 只做平移（与 rot 无关）',
    Math.abs(min(dx) - 3 * s * u) < 1e-9 &&
      Math.abs(max(dx) - 3 * s * u) < 1e-9 &&
      Math.abs(min(dy) + 2 * s * u) < 1e-9 &&
      Math.abs(max(dy) + 2 * s * u) < 1e-9,
    `Δ = (${dx[0].toFixed(4)}, ${dy[0].toFixed(4)})  期望 (${(3 * s * u).toFixed(4)}, ${(-2 * s * u).toFixed(4)})`
  );
  // ② rotZ 与 nodeRotZ 同轴相加：用 rotZ = −nodeRotZ 把合角抵消到 0
  const C6 = sample(
    base,
    Object.assign({ type: 0, arc: 360, arcMode: 0, radiusThickness: 0.5, radius: 5 }, ISO, {
      rotZ: -nodeRot,
    }),
    500
  );
  const angC = C6.map((p) => wrap2pi(Math.atan2(p.y, p.x)));
  chk(
    '`m_Rotation.z` 与 `nodeRotZ` 同轴相加（合角 0 ⇒ 方位角从 0° 起）',
    max(angC) <= 2 * Math.PI + 1e-9 && min(angC) < 0.05 && max(angC) > 2 * Math.PI - 0.05,
    `方位角 ∈ [${(min(angC) / DEG).toFixed(3)}°, ${(max(angC) / DEG).toFixed(3)}°]`
  );
  // ③ 该偏移对 Box / Edge 同样生效
  const boxOv = { boxX: 20, boxY: 10, offsetX: 3, offsetY: -2, rotZ: 0, type: 5 };
  const E6 = sample(base, Object.assign({ arc: 0, arcMode: 0, radiusThickness: 1 }, boxOv), 400);
  const cx = Math.cos(nodeRot * DEG);
  const sx = Math.sin(nodeRot * DEG);
  /** 盒体（全长 boxX/boxY，rot 旋转后）在外接 AABB 上的半宽 */
  const halfX = 0.5 * (20 * Math.abs(cx) + 10 * Math.abs(sx)) * s * u;
  const mx = max(E6.map((p) => Math.abs(p.x - 3 * s * u)));
  const my = max(E6.map((p) => Math.abs(p.y + 2 * s * u)));
  console.log(
    `   Box：|x − offX| max=${mx.toFixed(2)}（AABB 半宽 ${halfX.toFixed(2)}）/ ` +
      `|y − offY| max=${my.toFixed(2)}`
  );
  chk(
    'Box 的 `m_Position` 同样生效（偏移后仍在盒体 AABB 内）',
    mx <= halfX + 1e-6 && my <= 0.5 * (20 * Math.abs(sx) + 10 * Math.abs(cx)) * s * u + 1e-6
  );

  /* ── ⑦ 既有形状零回归 + 未实现类型的兜底 ───────────────────────────── */
  console.log('');
  console.log('[7] 既有口径零回归 / 未实现类型的兜底');
  // 等比 m_Scale、rotZ = 0 时，Cone(Base) 的位置 = 圆盘位置（同为底面圆盘）
  const OV78 = Object.assign({ arc: 360, arcMode: 0, radiusThickness: 0.7, radius: 13, angle: 25 }, ISO);
  const SCone = sample(base, Object.assign({ type: 4 }, OV78), N0);
  const SDisc = sample(base, Object.assign({ type: 10 }, OV78), N0);
  const posDev = SCone.map((p, i) => Math.hypot(p.x - SDisc[i].x, p.y - SDisc[i].y));
  chk('等比 scale 下 Cone(Base) 的位置 == 圆盘位置（零回归旁证）', max(posDev) < 1e-9);
  // 未实现类型（Donut 17）仍走"圆盘兜底"：**位置**与 Cone(Base) 逐位相同
  // （方向不同：兜底不吃 `angle` 发散 —— 正因为这样它只是"看起来像实现了"，见该分支注释）
  const SD17 = sample(base, Object.assign({ type: 17 }, OV78), N0);
  chk(
    '未实现类型（Donut 17）位置 == 锥形兜底（已知缺口，钉住现状）',
    samePos(SD17, SCone)
  );
  chk(
    '未实现类型不静默变点发射（radius 仍起作用）',
    max(SD17.map((p) => Math.hypot(p.x, p.y))) > 0.9 * R(13)
  );

  /* ── 汇总 ───────────────────────────────────────────────────────────── */
  console.log('');
  console.log('='.repeat(78));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('='.repeat(78));
  process.exit(fail ? 1 : 0);
}

main();
