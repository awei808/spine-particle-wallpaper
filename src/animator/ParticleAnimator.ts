/**
 * @license
 * Spine Wallpaper Engine. This is a Spine animation player for wallpaper engine.
 * Copyright (C) 2023 Spicy Wolf
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * ParticleAnimator —— Unity ParticleSystem 的参数化移植（第 4 种 mesh 类型）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 参数全部取自游戏包内（`03_prefabs/art_prefabs.ab` → prefab `Asuna_S9_Background`
 * 的 8 个粒子节点，材质/剪辑在 `14_effect/battle/_batch12.ab`）。
 * 转储脚本与逐项依据：`10_wallpaper_engine/_查_粒子权威数据.py`
 *                 → `_证据/粒子_权威数据.txt`、`_证据/粒子_权威参数.json`
 *
 * ── 几个容易搞错、这里按官方语义实现的点 ───────────────────────────────────
 *  1. **`enabled` 才算数**：模块关闭时它的字段值是残留。本套 8 个节点里只有
 *     `qiqiu`/`niao` 开了 NoiseModule（strength 0.2），只有 `star` 开了
 *     RotationModule（45°/s）；其余节点那两处的 1.0 / 45° 都是残留值。
 *  2. **`ClampVelocityModule.dampen` 是"每帧"向上限收敛的比例**（2026-09-19 由实录更正）
 *     不是 dampen×dt 的每秒口径。游戏实录里飞鸟全程贴着限速飞（见 4.4 处注释的实测），
 *     每秒口径会让它 11 秒只降 36% → 比游戏快 6.9 倍。实现取帧率无关形式
 *     `alpha = 1 - exp(-60·dampen·dt)`，等价 Unity 在 60fps 下的每帧收敛。
 *  3. **噪声是速度增量**（先改速度、再积分位置）。采样坐标在粒子系统的
 *     **本地未缩放空间**，故要把 prefab 单位的坐标除回 `localScale`；
 *     差分步长还必须远小于噪声特征尺度，否则 ∇·(∇×Ψ)≡0 不成立（见 NOISE_EPS）。
 *  4. **`minMaxState` 1/3 在本套数据里曲线关键帧为空**（常量存在 scalar 里），
 *     空曲线要按常量处理，不能当 0。
 *  5. **发射与消亡必须分开建模**：star/saoguang 每 `lengthInSec`(=6s) 只在周期起点
 *     发 1 颗、寿命 2.0/1.5s —— "亮一下、等一会儿"。若在粒子死亡时原地复活，
 *     星点就永远不灭了。
 *
 * ── 存疑项（已在 config 里如实标注，不敢当已知）────────────────────────────
 *  a. 噪声的**绝对量级**推不出来：官方只说 damping 时"强度与频率成正比"，
 *     Unity 内部噪声场的归一化常数未公开 → 用 `noise.gain` 这个旋钮在桌面上校准。
 *  b. **Perlin 实现与 hash 未公开** → 只能做到「参数一致 + 算法族一致 + 量级校准」，
 *     不能宣称"与游戏逐值一致"。
 *  c. `in_TEXCOORD1 ≡ Custom1.xy` 是**逻辑锁定、非直读**（见 config.type.ts 的
 *     `customData` 注释）。唯一可判定实验 = 扫过行程 0.6 UV / 1.5 s、方向从左到右。
 *  d. `speedModifier` 按官方措辞"倍率乘在粒子速度上"实现为**初始速度的乘子**。
 *
 * ── 着色（对齐 `UVliudong` / `UVliudong_Blended` 的编译后 GLSL）──────────────
 * 游戏有两支 shader，8 个系统按**材质实际绑定**分两组（按 pathID 反查，非按名字）：
 *
 *   加色组 = {star, saoguang} → `UVliudong`（片元 `out.a = 1.0`，Pass0 `One/One`）
 *     片元（逐字来自 `_shader_extract/src_FX_qqc__UVliudong_plat5_0.txt`）：
 *       mask_rgb = texture2D(_mask,    maskUV).rgb      // ★ 取 rgb，不是 a
 *       tex      = texture2D(_Texture, texUV)
 *       c.rgb = mask_rgb * tex.rgb
 *       c.a   = tex.a * _Color.a                        // _Color.a = 1
 *       c     = c * vs_COLOR0                           // vs_COLOR0 = startColor
 *       c.rgb = c.rgb * _Color.rgb                      // _Color.rgb = (1,1,1)
 *       c.rgb = c.a * c.rgb                             // ★ 预乘 alpha
 *       c.rgb = c.rgb * _Alphe
 *       out.rgb = soft * c.rgb                          // soft = _mask02 = 空槽 ⇒ 1.0
 *       out.a   = 1.0                                   // ★ alpha 恒 1
 *
 *   常规组 = 其余 6 个 → `UVliudong_Blended`（Pass0 `SrcAlpha/OneMinusSrcAlpha`）
 *     片元：`out.rgb = tex.rgb * m * vs_COLOR0.rgb * _Color.rgb * _Alphe`
 *           `out.a   = m * tex.a * _Color.a * vs_COLOR0.a * _Alphe`   （m = _mask.x = 1）
 *
 * ★ 为什么不能用 `THREE.AdditiveBlending`：它是 `(SrcAlpha, One)`，而真 shader 是
 *   `(One, One)` + 片元里先 `c.rgb = c.a * c.rgb` 预乘、再把 alpha 置 1 输出。
 *   沿用 `AdditiveBlending` 而不预乘 ⇒ 少乘一次 alpha ⇒ 实测偏亮 2~2.5 倍
 *   （按材质值精算：star (2.18,1.68,1.31)、saoguang (4.89,2.92,1.96)）。
 *   故这里用 `CustomBlending` 显式设 `One/One`，并在片元里完成预乘。
 */

import * as THREE from 'three';
import { ParticleMeshConfig, ParticleMinMax } from '@src/config.type';
import * as Scene from '@src/initScene';

const DEG2RAD = Math.PI / 180;

/**
 * curl 数值中心差分的步长。
 *
 * ★ 取值有硬约束：把坐标换算到采样空间后，噪声特征尺度 ≈ 1/frequency = 2.0，
 * 差分步长必须**远小于**它。取与特征同量级（例如 1.0）时差分退化成
 * "跨整个噪声特征求差"，实测 max|∇·N| ≈ 4.65 —— 场里出现明显源/汇，
 * 已经不是 curl 场了（curl 的定义性质就是无源无汇）。取 0.01 后散度回到 1e-3 以下。
 */
const NOISE_EPS = 0.01;

/** 预热步长 / 时间上限（见 prewarm()） */
const PREWARM_DT = 1 / 60;
const PREWARM_MAX_SEC = 30;

/**
 * `_mask` **空槽**的替身：1×1 白图。
 *
 * Unity 对未赋值的贴图槽采样返回 `(1,1,1,1)`，这张图表达同一语义（8 个系统里只有
 * `saoguang` 有 `_mask`，其余 7 个都走这里）。
 *
 * ★ 为什么不用"片元里判空跳过采样"：给 `sampler2D` 绑 `null` 在 WebGL 下是**未定义行为**
 *   （部分驱动会警告并返回黑 ⇒ 遮罩变成全黑，比不采样更糟）。
 * 模块级单例：8 个系统共用一张，不必各建一个 GPU 纹理对象。
 */
const WHITE_1X1 = new THREE.DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
  THREE.RGBAFormat
);
WHITE_1X1.needsUpdate = true;

/* ─────────────────────────── 确定性伪随机 ─────────────────────────── */

/**
 * mulberry32。替代 Unity 的 autoRandomSeed。
 * 用固定种子是为了**可复现**：同一份 config 每次跑出的粒子分布必须一致，
 * 否则像素级验收没法比对（A/B 两版会因随机而不同）。
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  public next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  public range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

/* ─────────────────────────── Perlin / Curl 噪声 ─────────────────────────── */

const PERM = new Uint8Array(512);

(function initPerm() {
  // 固定置换表（不依赖随机种子）→ 噪声场可复现
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    p[i] = i;
  }
  let seed = 20260917;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255];
  }
})();

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Ken Perlin improved noise（3D），返回值大致落在 [-1, 1] */
function perlin3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u),
      v
    ),
    lerp(
      lerp(
        grad(PERM[AA + 1], x, y, z - 1),
        grad(PERM[BA + 1], x - 1, y, z - 1),
        u
      ),
      lerp(
        grad(PERM[AB + 1], x, y - 1, z - 1),
        grad(PERM[BB + 1], x - 1, y - 1, z - 1),
        u
      ),
      v
    ),
    w
  );
}

/**
 * 三轴互不相关的偏移，用来构造向量势场 Ψ = (perlin(q+O₁), perlin(q+O₂), perlin(q+O₃))。
 * 官方 NoiseModule 文档明说算法基于 **Curl Noise**，内部由多个 Perlin 样本合成。
 */
/**
 * 三轴互不相关的偏移，用来构造向量势场 Ψ = (perlin(q+O₁), perlin(q+O₂), perlin(q+O₃))。
 * 官方 NoiseModule 文档明说算法基于 **Curl Noise**，内部由多个 Perlin 样本合成。
 *
 * ★ P4 加了**第 4 组**偏移（`i = 3`）：它是 `sizeAmount` / `rotationAmount` 的
 *   **标量调制源**（见 `noiseScalar`）。加在数组尾部 ⇒ `i = 0/1/2` 的取值一字未动。
 */
const NOISE_OFFSET_X = [0, 31.416, -53.21, 8.771];
const NOISE_OFFSET_Y = [0, 47.853, 19.66, -66.394];
const NOISE_OFFSET_Z = [0, 12.793, 71.3, 41.05];

/**
 * **单层**势场：第 `i` 路、频率缩放 `f`。
 * `f = 1` 时与 P4 之前的原式 `perlin3(x + O_i, …)` **逐位相同**（`x × 1 ≡ x`，IEEE754 精确）。
 */
function psiLayer(
  i: number,
  x: number,
  y: number,
  z: number,
  f: number
): number {
  return perlin3(
    x * f + NOISE_OFFSET_X[i],
    y * f + NOISE_OFFSET_Y[i],
    z * f + NOISE_OFFSET_Z[i]
  );
}

/**
 * 势场 Ψ 的第 `i` 路（`i = 0/1/2`），**单层**（`octaveCount = 1`，= P4 之前的原式）。
 * 三路各用一组互不相同的偏移 ⇒ 三路互不相关。
 */
function psi(i: number, x: number, y: number, z: number): number {
  return psiLayer(i, x, y, z, 1);
}

/**
 * ★ P4：**标量噪声场**（第 4 路势场）—— `sizeAmount` / `rotationAmount` 的取值来源。
 *
 * ★ 为什么另开一路、而不用 curl 的某个分量：
 *   ① **量级有界**：Perlin 本身大致落在 ±0.7，`sizeAmount` 可以直接当"幅度"用
 *      （`尺寸乘子 = 1 + 标量 × sizeAmount`），不会像 curl 分量（实测 |N| 可达 ~3.7）
 *      那样把尺寸乘成负数；
 *   ② **与可见位移不相关**：位置推力只消费 curl 的 x/y，另开一路就不会出现
 *      "往哪边推就往哪边胀"的假相关。
 *   ⚠️ Unity 内部取的是哪一路**未公开** ⇒ 这是**本项目口径**，如实标注为存疑项。
 *
 * `oct > 1` ⇒ 与 curl 一样在**势场**上做 fBm 叠层（振幅 `mul^k`、频率 `scale^k`、
 * 除以 `Σ振幅` 归一化）。
 */
function noiseScalar(
  x: number,
  y: number,
  z: number,
  oct: number,
  mul: number,
  scale: number
): number {
  if (oct <= 1) {
    return psiLayer(3, x, y, z, 1);
  }
  let amp = 1;
  let f = 1;
  let range = 1;
  let sum = psiLayer(3, x, y, z, 1);
  for (let k = 1; k < oct; k++) {
    amp *= mul;
    f *= scale;
    range += amp;
    sum += psiLayer(3, x, y, z, f) * amp;
  }
  return sum / range;
}

/** `curl3` 叠层支路的暂存（避免每次调用 new） */
const CURL_ACC = new THREE.Vector3();

/**
 * 把**一层**势场的 curl 累加进 `out`。
 *
 * ★ 差分步长 `h = NOISE_EPS / f` **必须与频率匹配**：高频层若仍用基频步长，
 *   截断误差 `O(h²·f³)` 会与该层本身的量级同阶 ⇒ 叠层里的高频层其实是一堆噪声垃圾
 *   （第一版实现就是这样，`_regress/74_` 的散度判据直接把这个问题抓了出来）。
 *   `f = 1` 时 `h = NOISE_EPS`、`amp/(2h)` 与单层支路**逐位相同**。
 */
function addLayerCurl(
  x: number,
  y: number,
  z: number,
  f: number,
  amp: number,
  out: THREE.Vector3
): void {
  const h = NOISE_EPS / f;
  const inv = amp / (2 * h);
  const nx =
    psiLayer(2, x, y + h, z, f) -
    psiLayer(2, x, y - h, z, f) -
    (psiLayer(1, x, y, z + h, f) - psiLayer(1, x, y, z - h, f));
  const ny =
    psiLayer(0, x, y, z + h, f) -
    psiLayer(0, x, y, z - h, f) -
    (psiLayer(2, x + h, y, z, f) - psiLayer(2, x - h, y, z, f));
  const nz =
    psiLayer(1, x + h, y, z, f) -
    psiLayer(1, x - h, y, z, f) -
    (psiLayer(0, x, y + h, z, f) - psiLayer(0, x, y - h, z, f));
  out.set(nx * inv, ny * inv, nz * inv);
}

/**
 * Curl Noise：N = ∇ × Ψ，用中心差分。
 * 步长必须远小于噪声特征尺度（见 NOISE_EPS）。
 *
 * 暴露为 static 是为了让验收脚本能**直接调用真身**跑散度判据
 * （`_验证_粒子.py`：随机采样 2000 点算 max|∇·N|，应远小于场量级）。
 * 这条判据是 curl 的**定义性质**，比"看着像湍流"可靠得多。
 *
 * ★ P4：`oct > 1` ⇒ 逐层累加（每层用自己的步长，见 `addLayerCurl`），
 *   最后除以 `Σ振幅` 归一化（Cocos `ParticleNoise.getNoise` 同式）。
 *   `oct <= 1` ⇒ 走下面的**原式**，逐位不变。
 *   ⚠️ `mul = 0` 时高层的振幅全 0、`Σ振幅 = 1` ⇒ 结果退回单层（用 `k === 0` 直接
 *   `copy` + `range !== 1` 才除 ⇒ 连浮点结合顺序都不引入差异）。
 */
function curl3(
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3,
  oct = 1,
  omul = 0.5,
  oscale = 2
): THREE.Vector3 {
  if (oct > 1) {
    let amp = 1;
    let f = 1;
    let range = 1;
    for (let k = 0; k < oct; k++) {
      if (k > 0) {
        amp *= omul;
        f *= oscale;
        range += amp;
      }
      addLayerCurl(x, y, z, f, amp, CURL_ACC);
      if (k === 0) {
        out.copy(CURL_ACC);
      } else {
        out.add(CURL_ACC);
      }
    }
    if (range !== 1) {
      out.multiplyScalar(1 / range);
    }
    return out;
  }
  const h = NOISE_EPS;
  const inv = 1 / (2 * h);
  const nx =
    psi(2, x, y + h, z) -
    psi(2, x, y - h, z) -
    (psi(1, x, y, z + h) - psi(1, x, y, z - h));
  const ny =
    psi(0, x, y, z + h) -
    psi(0, x, y, z - h) -
    (psi(2, x + h, y, z) - psi(2, x - h, y, z));
  const nz =
    psi(1, x + h, y, z) -
    psi(1, x - h, y, z) -
    (psi(0, x, y + h, z) - psi(0, x, y - h, z));
  return out.set(nx * inv, ny * inv, nz * inv);
}

/** 数值散度 ∇·N（验收判据用；`oct > 1` 时同样取叠层势场） */
function divCurlNumerical(
  x: number,
  y: number,
  z: number,
  h: number,
  oct = 1,
  omul = 0.5,
  oscale = 2
): number {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d0 =
    curl3(x + h, y, z, a, oct, omul, oscale).x -
    curl3(x - h, y, z, b, oct, omul, oscale).x;
  const d1 =
    curl3(x, y + h, z, a, oct, omul, oscale).y -
    curl3(x, y - h, z, b, oct, omul, oscale).y;
  const d2 =
    curl3(x, y, z + h, a, oct, omul, oscale).z -
    curl3(x, y, z - h, b, oct, omul, oscale).z;
  return (d0 + d1 + d2) / (2 * h);
}

/* ─────────────────────────── MinMaxCurve 求值 ─────────────────────────── */

/** 分段线性曲线求值；keys 为空返回 1 */
function keysAt(keys: number[][], t: number): number {
  if (!keys || keys.length === 0) {
    return 1;
  }
  if (t <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      const span = b[0] - a[0];
      const k = span === 0 ? 0 : (t - a[0]) / span;
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Unity `AnimationCurve` 端点**在线性分段之外**的取值模式
 * （序列化字段 `m_PreInfinity` / `m_PostInfinity`）。
 *
 * 取值表（AssetStudio 对 Unity 序列化格式的整理，与 Unity 的 `WrapMode` 同源）：
 *   0 = Constant        保持端点值（**旧实现等价于此**）
 *   1 = Linear          按端点切线线性外推
 *   2 = Cycle           整条曲线循环（首尾相接）
 *   3 = CycleWithOffset 循环并累加落差
 *   4 = Oscillate       乒乓（正放/倒放交替）
 */
const INF_CONSTANT = 0;
const INF_LINEAR = 1;
const INF_CYCLE = 2;
const INF_CYCLE_OFFSET = 3;
const INF_OSCILLATE = 4;

/** `((a % n) + n) % n` —— JS 的 `%` 对负数取负，曲线回绕必须用这个 */
function modPos(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * **带端点外推**的曲线求值（Unity `AnimationCurve` 语义）。
 *
 * ★★ 为什么必须有它（2026-10-13，蝶语吟花"蝴蝶不扇翅膀"的根因）：
 *   旧实现只做 `keysAt()` —— 曲线之外**一律钳到端点值**，等于假设
 *   `m_PostInfinity = Constant`。而 `hudie01 ×3` 的 `frameOverTime`
 *   是全部 19 个已采样粒子系统里**唯一**把 post 设成 **Linear** 的
 *   （其余 18 个不是 post=2(Cycle) 就是没有关键帧；Cycle 的末键在 t=1，永不触发）。
 *   Linear 的含义 = "末键之后按端点切线继续线性增长"：
 *     `frameOverTime` 的末键在 t=0.0826 / 值 0.945 / outSlope 11.4415
 *     ⇒ t=1 时曲线值 = 0.945 + 11.4415×(1−0.0826) = **11.4415**
 *     ⇒ 帧号 = `floor(11.4415 × cycles(1) × 16) % 16` 在整个寿命里**连续推进 183 帧**（≈11.4 遍图集）。
 *   旧实现把它钳在 0.945 ⇒ 帧号恒为 15 ⇒ **扇一次就定住**（CDP 实测 age 0.82 起 uvFrame 永远 15）。
 *
 * `pre` / `post` 缺省 = 0（Constant），与旧行为逐位一致 ⇒ 对不带这两个字段的旧 config **零影响**。
 * `headSlope` / `tailSlope` = 首键 `inSlope` / 末键 `outSlope`（Linear 模式要用）。
 */
function curveAt(
  keys: number[][],
  t: number,
  pre = 0,
  post = 0,
  headSlope = 0,
  tailSlope = 0
): number {
  if (!keys || keys.length === 0) {
    return 1;
  }
  const first = keys[0];
  const last = keys[keys.length - 1];
  const t0 = first[0];
  const t1 = last[0];
  const span = t1 - t0;

  // ── 左端点之外 ──
  if (t < t0) {
    if (pre === INF_LINEAR) {
      return first[1] + headSlope * (t - t0);
    }
    if (pre === INF_CYCLE && span > 1e-9) {
      return keysAt(keys, t0 + modPos(t - t0, span));
    }
    if (pre === INF_OSCILLATE && span > 1e-9) {
      const p = modPos(t - t0, 2 * span);
      return keysAt(keys, t0 + (p <= span ? p : 2 * span - p));
    }
    if (pre === INF_CYCLE_OFFSET && span > 1e-9) {
      const n = Math.floor((t - t0) / span);
      return keysAt(keys, t0 + modPos(t - t0, span)) + n * (last[1] - first[1]);
    }
    return first[1];
  }

  // ── 右端点之外 ──
  if (t > t1) {
    if (post === INF_LINEAR) {
      return last[1] + tailSlope * (t - t1);
    }
    if (post === INF_CYCLE && span > 1e-9) {
      return keysAt(keys, t0 + modPos(t - t0, span));
    }
    if (post === INF_OSCILLATE && span > 1e-9) {
      const p = modPos(t - t0, 2 * span);
      return keysAt(keys, t0 + (p <= span ? p : 2 * span - p));
    }
    if (post === INF_CYCLE_OFFSET && span > 1e-9) {
      const n = Math.floor((t - t0) / span);
      return keysAt(keys, t0 + modPos(t - t0, span)) + n * (last[1] - first[1]);
    }
    return last[1];
  }

  return keysAt(keys, t);
}

/**
 * MinMaxCurve 的"曲线支"求值：`scalar × curve(t)`（Unity：`minMaxState=1` 时取
 * `scalar` 乘曲线）。无关键帧返回 `null`，由调用方走常量/随机两常量分支。
 */
function curveOf(mm: ParticleMinMax | undefined, t: number): number | null {
  if (!mm || !mm.keysA || mm.keysA.length === 0) {
    return null;
  }
  return (
    mm.a * curveAt(mm.keysA, t, mm.pre, mm.post, mm.headSlope, mm.tailSlope)
  );
}

/**
 * 出生时取一次的值（Unity 的 Initial module 在粒子出生时采样）。
 * mode: 0 常量 / 1 曲线（形状由 lifeMul 提供） / 2 随机两常量 /
 *       3 随机两曲线（本套数据曲线为空 → 退化成随机两常量）
 */
function spawnValue(mm: ParticleMinMax, rng: Rng): number {
  if (!mm) {
    return 0;
  }
  if (mm.mode === 0 || mm.mode === 1) {
    return mm.a;
  }
  if (mm.mode === 2 || !(mm.keysA && mm.keysA.length > 0)) {
    return rng.range(mm.a, mm.b);
  }
  return mm.b + (mm.a - mm.b) * rng.next();
}

/**
 * 寿命内乘子（SizeModule / RotationModule / VelocityModule 用）。
 *
 * ★★ `mix` = **逐粒子随机系数**（一般传 `Particle.vmix`，出生时抽一次、终生不变）。
 *
 * 为什么必须带它（2026-10-12，芙丽希娅蝶语吟花"花瓣全一个方向"的根因）：
 *   Unity 的 MinMaxCurve 有四种模式，其中 `mode = 2`（随机两常量）与 `mode = 3`
 *   （随机两曲线，**曲线为空时退化成随机两常量**）的语义是
 *   **"每颗粒子在出生时从 [min, max] 里抽一个常量，之后终生不变"**。
 *   旧实现落进 `return mm.a` 这一支 ⇒ 同一系统的**全部粒子拿到同一个常量**。
 *   `huaban (1)` 的 VelocityModule 是 x∈[-6,-3]、y∈[-8,-3] ⇒ 所有花瓣被钉死成
 *   同一条 (-6,-3) 方向的速度（游戏里是各自随机的）——表现就是"花瓣只有一个方向"。
 *
 * 为什么默认 `mix = 0` 而不是必填：`emission.rateOverTime` 这类**系统级**曲线
 * 不属于逐粒子量，传 0 等价于旧行为（取 `a`），避免误改。
 */
function lifeMul(mm: ParticleMinMax, t: number, mix = 0): number {
  if (!mm) {
    return 0;
  }
  const cv = curveOf(mm, t);
  if (cv !== null) {
    return cv;
  }
  if ((mm.mode === 2 || mm.mode === 3) && mm.b !== mm.a) {
    return mm.a + (mm.b - mm.a) * mix;
  }
  return mm.a;
}

/**
 * **双曲线**（`minMaxState = 2/3`）的求值：每颗粒子在 min / max 两条曲线之间取一个
 * 固定比例（Unity 语义 = 出生时抽一次、终生不变）。
 *
 * ★ 只在 `keysB` 非空时启用这一支 —— **现存全部工程的 velocity 都是 `keysA=keysB=[]`**
 *   （实测：S9 系 9 个工程 + 探针工程，2026-10-10）⇒ 对它们是**零影响**，
 *   直接落回原来的 `a × keysA`。S8 的 `trail01` 是全仓库第一个带双曲线的粒子系统，
 *   没有它 10 颗粒子的轨迹会**完全重合**（看起来只有一条丝带）。
 */
function lifeMulMix(mm: ParticleMinMax, t: number, mix: number): number {
  if (!mm) {
    return 0;
  }
  if (!(mm.keysB && mm.keysB.length > 0)) {
    return lifeMul(mm, t, mix);
  }
  const hi =
    mm.keysA && mm.keysA.length > 0 ? mm.a * keysAt(mm.keysA, t) : mm.a;
  const lo = mm.b * keysAt(mm.keysB, t);
  return lo + (hi - lo) * mix;
}

/**
 * 绕 Z 轴旋转二维向量（弧度）。用于把**本地速度**折算到世界（见 `Particle.localRot`）。
 * 只做一次性旋转，不需要缓存 sin/cos —— 调用点每帧每粒子最多 1 次，开销可忽略。
 */
function rotVec(x: number, y: number, rot: number): { x: number; y: number } {
  if (!rot) {
    return { x, y };
  }
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  return { x: x * cs - y * sn, y: x * sn + y * cs };
}

/**
 * 绕 **X / Y / Z 三轴同时**旋转一个 3D 向量（欧拉角 → 四元数 → 旋转）。
 *
 * ★ 用于 `VelocityModule.orbitalX/Y/Z`（P2）。合成顺序**逐字照搬** galacean 的
 *   `rotationByEuler()`（`packages/shader/.../ParticleCommon.glsl`，PR #3049）：
 *
 *     halfRoll = rz/2（Z）、halfPitch = rx/2（X）、halfYaw = ry/2（Y）
 *     quaX = cosYaw·sinPitch·cosRoll + sinYaw·cosPitch·sinRoll
 *     quaY = sinYaw·cosPitch·cosRoll − cosYaw·sinPitch·sinRoll
 *     quaZ = cosYawPitch·sinRoll − sinYawPitch·cosRoll
 *     quaW = cosYawPitch·cosRoll + sinYawPitch·sinRoll
 *     v'   = v + 2·cross(q.xyz, cross(q.xyz, v) + q.w·v)
 *
 *   ⚠️ 为什么敢照搬、又不敢自称"Unity 原版"：Unity 的 Shuriken 内部不公开，
 *   galacean 是**第三方实现且经过 code review 逐条核对过数学**，是本轮能拿到的最硬依据；
 *   但欧拉→四元数的**轴序**是各家自定义，故此处只保证"与 galacean 一致 + 单轴退化正确"
 *   （只给 `orbitalZ` 时严格等于绕 Z 转 `rz`，可逐位验证）。
 *
 * 结果写到 `out`（复用数组，避免每帧每粒子新建）。
 */
const EULER_OUT = [0, 0, 0];
function rotEuler3(
  vx: number,
  vy: number,
  vz: number,
  rx: number,
  ry: number,
  rz: number,
  out: number[] = EULER_OUT
): number[] {
  if (!rx && !ry && !rz) {
    out[0] = vx;
    out[1] = vy;
    out[2] = vz;
    return out;
  }
  const hr = rz * 0.5;
  const hp = rx * 0.5;
  const hy = ry * 0.5;
  const sr = Math.sin(hr);
  const cr = Math.cos(hr);
  const sp = Math.sin(hp);
  const cp = Math.cos(hp);
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const cycp = cy * cp;
  const sysp = sy * sp;
  const qx = cy * sp * cr + sy * cp * sr;
  const qy = sy * cp * cr - cy * sp * sr;
  const qz = cycp * sr - sysp * cr;
  const qw = cycp * cr + sysp * sr;
  // v' = v + 2·cross(q.xyz, cross(q.xyz, v) + q.w·v)
  const tx = qy * vz - qz * vy + qw * vx;
  const ty = qz * vx - qx * vz + qw * vy;
  const tz = qx * vy - qy * vx + qw * vz;
  out[0] = vx + 2 * (qy * tz - qz * ty);
  out[1] = vy + 2 * (qz * tx - qx * tz);
  out[2] = vz + 2 * (qx * ty - qy * tx);
  return out;
}

/**
 * `MinMaxCurve` 的**「按速度」归一化系数**（P2 三个 by-speed 模块共用）。
 *
 *   `rate = clamp((|v| − range[0]) / (range[1] − range[0]), 0, 1)`
 *
 * 逐字照 feng3d `ParticleSizeBySpeedModule` / `ParticleColorBySpeedModule` /
 * `ParticleRotationBySpeedModule` 三处**同一个式子**（`mathUtilClamp`）。
 * ⚠️ `range` 已由构造时折算到**世界单位/秒**，`speed` 亦为世界单位/秒。
 * ⚠️ `range[1] === range[0]` ⇒ 除以 0 ⇒ 退化为"速度低于下界取 0、否则取 1"
 *    （Unity 里这个区间退化时表现未定义，这里给一个不产生 NaN 的确定行为）。
 */
function speedRate(speed: number, r0: number, r1: number): number {
  const span = r1 - r0;
  if (span <= 1e-9) {
    return speed >= r1 ? 1 : 0;
  }
  const t = (speed - r0) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/* ── P3：渲染侧（`ParticleSystemRenderer`）的几何口径 ──────────────────────
 *
 * ★★ 三种 billboard 的**世界基向量**（Cocos `editor/assets/chunks/builtin/internal/
 *    particle-common.chunk` 逐行可对照，与 Unity 手册描述一致）：
 *      · Billboard ：基 = 相机 right / up（世界）
 *      · Horizontal：基 = `(1,0,0)` 与 `(0,0,−1)` ⇒ 平面 = **世界 XZ 面**（水平）✓
 *      · Vertical  ：基 = 相机 right 的**水平分量** 与 `(0,1,0)` ⇒ 竖直、绕 Y 转向相机 ✓
 *
 * 本引擎把"世界 XY"直接当作屏幕平面（粒子顶点本来就写在屏幕坐标系里），
 * 所以"世界方向 → 屏幕二维"就是点乘相机的 right / up 两个基向量。
 * ⚠️ 相机基向量对**整个系统**取一次（本引擎无逐粒子 3D 位置），
 *   透视发散带来的误差量级 ≈ `粒子半径 / 相机距离`（本工程 < 0.1%），已接受。
 */
export interface CamBasis {
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
}

/**
 * 相机缺省基 —— 与"正视相机"（看向 −Z、无俯角无偏航无 roll）逐位一致。
 * `Scene.camera` 尚未初始化时退到这里（等价于 P3 之前的行为）。
 */
const CAM_IDENTITY: CamBasis = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 };

/** 取相机世界基向量（right / up）。矩阵不可用 ⇒ 返回 `CAM_IDENTITY` */
function camBasis(): CamBasis {
  const cam = Scene.camera;
  if (!cam) {
    return CAM_IDENTITY;
  }
  cam.updateMatrixWorld();
  const m = cam.matrixWorld.elements;
  return { rx: m[0], ry: m[1], rz: m[2], ux: m[4], uy: m[5], uz: m[6] };
}

/** 世界方向 d 在屏幕 x 轴（相机 right）上的分量 */
function projX(dx: number, dy: number, dz: number, b: CamBasis): number {
  return dx * b.rx + dy * b.ry + dz * b.rz;
}

/** 世界方向 d 在屏幕 y 轴（相机 up）上的分量 */
function projY(dx: number, dy: number, dz: number, b: CamBasis): number {
  return dx * b.ux + dy * b.uy + dz * b.uz;
}

/**
 * 依 Render Mode 求 quad 的两条**单位半轴**（即 `sizeX = sizeY = 1` 时的半向量）。
 *
 * 返回 `[uAxX, uAxY, uAyX, uAyY]`，顶点 = `sgnA·uAx·sizeX + sgnB·uAy·sizeY`。
 *   · **Billboard(0)**：`uAx = 0.5·proj(right)`、`uAy = 0.5·proj(up)` ⇒ 屏幕轴对齐（现状）
 *   · **Horizontal(2)**：`uAx = 0.5·proj(X̂)`、`uAy = 0.5·proj(−Ẑ)`
 *     ⇒ 本工程正视相机下 `proj(X̂) = (1,0)`、`proj(−Ẑ) = (0,0)` ⇒ **高度为 0**
 *        （平面与视线共面 ⇒ 投影面积 0，与 Unity 里"看不见"一致）
 *   · **Vertical(3)**：`uAx = 0.5·proj(right 的水平分量)`、`uAy = 0.5·proj(Ŷ)`
 *     ⇒ 本工程下 `right` 本就水平 ⇒ `proj` 均为单位基 ⇒ **与 Billboard 逐位相同**
 *   · Stretched(1) / Mesh(4) / None(5)：不适用（前两者由调用方另算基，后者不生成四边形），
 *     这里返回 Billboard 的基只作为**兜底**（例如 Stretched 在速度为 0 时的退化姿态）。
 */
function renderModeAxes(mode: number, b: CamBasis): number[] {
  if (mode === 2) {
    return [
      0.5 * projX(1, 0, 0, b),
      0.5 * projY(1, 0, 0, b),
      -0.5 * projX(0, 0, 1, b),
      -0.5 * projY(0, 0, 1, b),
    ];
  }
  if (mode === 3) {
    // 相机 right 去掉沿世界 Y 的分量后归一化 —— 即 cocos 的 `camX`（水平、指向相机侧）
    const hl = Math.hypot(b.rx, b.rz);
    const nx = hl > 1e-9 ? b.rx / hl : 1;
    const nz = hl > 1e-9 ? b.rz / hl : 0;
    return [
      0.5 * projX(nx, 0, nz, b),
      0.5 * projY(nx, 0, nz, b),
      0.5 * projX(0, 1, 0, b),
      0.5 * projY(0, 1, 0, b),
    ];
  }
  return [
    0.5 * projX(b.rx, b.ry, b.rz, b),
    0.5 * projY(b.rx, b.ry, b.rz, b),
    0.5 * projX(b.ux, b.uy, b.uz, b),
    0.5 * projY(b.ux, b.uy, b.uz, b),
  ];
}

/**
 * 形状类型**归一化**：把 Unity 里已废弃的"外壳 / 边缘"变体折叠到基类型。
 *
 * 官方在枚举里逐个标注了 *"… is deprecated and does nothing. Please use
 * ShapeModule.radiusThickness instead, to control edge emission."*
 * （`UnityCsReference/Modules/ParticleSystem/Managed/ParticleSystemEnums.cs`）——
 * 即这些值在运行时**与基类型完全同义**，旧值只是序列化残留：
 *
 *   `1 SphereShell` → `0 Sphere`、`3 HemisphereShell` → `2 Hemisphere`、
 *   `7 ConeShell` → `4 Cone`、`9 ConeVolumeShell` → `8 ConeVolume`、
 *   `11 CircleEdge` → `10 Circle`（"edge" 语义由 `radiusThickness = 0` 表达）。
 *
 * ⚠️ 全包普查（`_work_形状族普查/`，41996 个 ParticleSystem）确认本游戏**一次都没用到**
 * 这 5 个值 ⇒ 折叠与否对现有产物零影响，纯粹是让类型分发闭合。
 */
function normShapeType(t: number): number {
  switch (t) {
    case 1:
      return 0;
    case 3:
      return 2;
    case 7:
      return 4;
    case 9:
      return 8;
    case 11:
      return 10;
    default:
      return t;
  }
}

/**
 * 形状采样点（**本地**、已按 `m_Scale` 各轴缩放前的量）→ 世界偏移。
 *
 * ★ 依 Unity `ShapeModuleUI.OnShapeToolGUI` 的发射矩阵
 *   `emitterMatrix = Matrix4x4.TRS(shape.position, Quaternion.Euler(shape.rotation), scale)`
 *   ⇒ **先各轴缩放 → 再绕 Z 旋转 → 最后加平移**（TRS 顺序）。
 *   与 Cocos `ShapeModule.constructMat()` + `Vec3.transformMat4(p.position, p.position, mat)`
 *   逐字同口径（`cocos/particle/emitter/shape-module.ts`），feng3d / LayaAir 同。
 *
 * @param px py  形状本地采样点（**未**乘 `m_Scale`、**未**乘 `localScale × unitScale` 的量已由调用方折算）
 * @param scX scY `m_Scale` 的 x/y 分量（调用方保证 > 0）
 * @param rot     `(m_Rotation.z + nodeRotZ)`，弧度
 * @param offX offY `m_Position` 的 x/y 分量（**已**折算成世界单位）
 */
function shapeXform(
  px: number,
  py: number,
  scX: number,
  scY: number,
  rot: number,
  offX: number,
  offY: number
): { x: number; y: number } {
  const r = rotVec(px * scX, py * scY, rot);
  return { x: r.x + offX, y: r.y + offY };
}

/**
 * alpha 渐变求值（ColorModule.gradient 的 alphaKeys: [[t, a], ...]）。
 * 注意 t 小于首个关键帧时取**首个关键帧的值**（Unity 的渐变外推语义），
 * star 的首个 alpha 键在 t=0.1029 —— 若当成"从 0 开始"会让星点开头多淡入一次。
 */
function alphaCurve(keys: number[][], t: number): number {
  if (!keys || keys.length === 0) {
    return 1;
  }
  if (t <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1];
      const b = keys[i];
      const span = b[0] - a[0];
      const k = span === 0 ? 0 : (t - a[0]) / span;
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * 两条梯度之间的**逐粒子**插值（Unity `MinMaxGradient` 的 `TwoGradients`）。
 *
 * `mix` = 出生时抽签存下的 `Particle.vmix`；`keysMin` 缺省/为空 ⇒ 直接返回 `keys` 的值，
 * 与旧 config（只有 `alphaKeys`）**逐位一致**。
 *
 * ★ 蝶语吟花 `yuan_glow` 的 ColorModule 正是 `minMaxState = 3`：
 *   max 侧 `0.632→0.784 / 0.715→0.078 / 0.868→0.588 / 1→0`（寿命后段**两次快闪**），
 *   min 侧 `0.166→0.972 / 1→0`（**单次平滑起伏**）。只取 max 会让全体粒子一起急闪，
 *   实录里则是"闪一下的"和"缓缓亮灭的"混在一起（2026-10-13 用户报"闪得太快"）。
 */
function alphaAt(
  keys: number[][],
  t: number,
  keysMin?: number[][],
  mix = 0
): number {
  const a = alphaCurve(keys, t);
  if (!keysMin || keysMin.length === 0) {
    return a;
  }
  const b = alphaCurve(keysMin, t);
  return a + (b - a) * mix;
}

/**
 * 在 Unity `Gradient` 上按 `u ∈ [0,1]` 采样 ⇒ `[r, g, b, a]`。
 *
 * ★ 颜色键与 alpha 键**各自按自己的时间轴**线性插值 —— Unity 的 `Gradient`
 *   本来就把 colorKeys / alphaKeys 分开存（`m_NumColorKeys` ≠ `m_NumAlphaKeys` 是常态），
 *   例如 `yuan_glow` 的 startColor 是 4 个颜色键 + 2 个 alpha 键。
 * ★ 两端之外取端点值（`GradientMode.Blend` 的钳位语义）。
 *
 * 用于 `startColor` 的 **Gradient / RandomColor** 档：**每颗粒子抽一次、终生不变**。
 */
function sampleGradient(
  colorKeys: Array<[number, number[]]> | undefined,
  alphaKeys: number[][] | undefined,
  u: number
): [number, number, number, number] {
  let r = 1;
  let g = 1;
  let b = 1;
  if (colorKeys && colorKeys.length) {
    const n = colorKeys.length;
    if (u <= colorKeys[0][0]) {
      r = colorKeys[0][1][0];
      g = colorKeys[0][1][1];
      b = colorKeys[0][1][2];
    } else if (u >= colorKeys[n - 1][0]) {
      r = colorKeys[n - 1][1][0];
      g = colorKeys[n - 1][1][1];
      b = colorKeys[n - 1][1][2];
    } else {
      for (let i = 1; i < n; i++) {
        if (u <= colorKeys[i][0]) {
          const p = colorKeys[i - 1];
          const q = colorKeys[i];
          const span = q[0] - p[0];
          const k = span === 0 ? 0 : (u - p[0]) / span;
          r = p[1][0] + (q[1][0] - p[1][0]) * k;
          g = p[1][1] + (q[1][1] - p[1][1]) * k;
          b = p[1][2] + (q[1][2] - p[1][2]) * k;
          break;
        }
      }
    }
  }
  const a = alphaKeys && alphaKeys.length ? alphaCurve(alphaKeys, u) : 1;
  return [r, g, b, a];
}

/**
 * 抽一颗粒子的 `startColor`（RGBA）。
 *
 * `u01` = 该粒子出生时抽到的 `[0,1)` 随机数（复用 `Particle.vmix`，
 * **不额外消耗 rng** ⇒ 形状/速度等模块的既有抽签序列零回归）。
 *
 * `mode`：
 *  · 1 / 4（Gradient / RandomColor）⇒ 在梯度上随机取一点；
 *  · 3（TwoGradients）⇒ 先在梯度上取一点，再与 min 梯度上同一点按 `u01` 做 lerp
 *    （Unity 用两个独立随机数，这里复用同一个 —— 分布仍是随机的，只是两轴相关，如实标注）；
 *  · 其余 / 无梯度 ⇒ 退回常量 `startColor`（旧 config 路径，逐位一致）。
 */
function pickStartColor(
  c: ParticleMeshConfig,
  u01: number
): [number, number, number, number] {
  const g = c.startColorGradient;
  if (
    g &&
    ((g.colorKeys && g.colorKeys.length) || (g.alphaKeys && g.alphaKeys.length))
  ) {
    const hi = sampleGradient(g.colorKeys, g.alphaKeys, u01);
    if (g.mode === 3 && g.minAlphaKeys && g.minAlphaKeys.length) {
      const lo = sampleGradient(g.minColorKeys, g.minAlphaKeys, u01);
      return [
        hi[0] + (lo[0] - hi[0]) * u01,
        hi[1] + (lo[1] - hi[1]) * u01,
        hi[2] + (lo[2] - hi[2]) * u01,
        hi[3] + (lo[3] - hi[3]) * u01,
      ];
    }
    return hi;
  }
  const s = c.startColor || [1, 1, 1, 1];
  return [s[0], s[1], s[2], s[3]];
}

/* ─────────────────────────── 粒子 ─────────────────────────── */

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** 世界单位；已是"初始大小 × localScale × unitScale" */
  sizeX: number;
  sizeY: number;
  /** 自旋（弧度/秒） */
  spin: number;
  /** 贴图当前朝向（弧度） */
  rot: number;
  /** 限速上限（世界单位/秒，出生时定死，避免每帧重抽随机区间） */
  clampLimit: number;
  /**
   * UV 序列帧 `frameOverTime` 的**出生采样值**。
   *
   * 只在它是「常量 / 随机两常量」时被 `buildGeometry` 使用（值不随寿命变，故出生定一次即可）；
   * 若它是曲线，则忽略本字段、改由 `curveOf(frameOverTime, age/life)` 求值。
   */
  uvFrameOver: number;
  /**
   * 本帧实际用于采样的序列帧号（0-based；`-1` = 该系统的 uv 未启用或只有 1 帧）。
   *
   * ★ 由 `buildGeometry()` **写回**，所以它**就是渲染真值本身**。
   *   验收脚本读它即可判断"同一颗粒子是否始终同一帧"（`qiqiu` 应恒定、`niao` 应遍历），
   *   而不必在测试里重抄一份公式 —— 那样就成了自证。
   *
   * ⚠️ P4：`uv.animationType = 1`（Single Row）时它是**行内**帧号（`0 … tilesX−1`）；
   *   整表档则是**整表**帧号（`0 … tilesX×tilesY−1`）。两种口径下都等于"该粒子的第 n 帧"。
   */
  uvFrame: number;
  /**
   * ★ P4：Single Row 档该粒子**播哪一行**（`0 … tilesY−1`）。
   *
   * 出生时定、终生不变（官方 `rowMode = Random` 逐字：*"Randomly select a row for each
   * particle **when producing the animation**"*）。
   * `rowMode = 1`（Random）⇒ 出生时用 `rng` 抽一次（**只在真正会出现随机行时才抽**，
   * 见 `spawn()` ⇒ 既有产物的抽签序列零回归）；其余（Custom / MeshIndex）⇒ `rowIndex`
   * （MeshIndex 在本引擎恒等于 0 —— 每套系统只用一个 mesh、只有一个子网格）。
   */
  uvRow: number;

  /**
   * ★ P4：本帧**标量噪声场**的取值（第 4 路势场，见 `noiseScalar`）。
   *
   * 用途 = `NoiseModule.sizeAmount` 的调制源（`buildGeometry` 读它算尺寸乘子）。
   * ★ 为什么是"另一路标量场"而不是 curl 的某个分量：
   *   ① Perlin 天然有界（约 ±0.7）⇒ `1 + 标量 × sizeAmount` 不会把尺寸乘成负数；
   *   ② 与可见位移（只消费 curl 的 x/y）**不相关** ⇒ 不会出现"往哪边推就往哪边胀"。
   *   ⚠️ Unity 未公开它的取值来源 ⇒ 本项目口径，存疑项。
   * `sizeAmount` / `rotationAmount` 都缺省时恒为 0（且**连采样都不做**）。
   */
  nzS: number;

  /**
   * ★ P4：本帧 curl 场的 **z 分量** —— 供 `rotationAmount` 用（2D 渲染丢弃的那一路）。
   * 缺省（`rotationAmount` 未声明）时恒为 0、无人读。
   */
  nzRot: number;

  /* ── 丝带轨迹（仅 `trail.enabled` 时使用，见 ParticleMeshConfig.trail）── */

  /**
   * 轨迹点，**新的在前**（index 0 = 最新）。
   *
   * ★ 头端**不**放在这里：渲染时把头端取成粒子**当前**位置（见 `buildGeometry`），
   *   否则丝带会比粒子本身滞后一个 `tstep`，看起来"脱节"。
   *   `t` = 记录时的 `systemTime`，用于按 `trail.lifetime` 淘汰。
   */
  trail: Array<{ x: number; y: number; t: number }>;
  /** 实际记点间距（世界单位）—— 由 `speed×lifetime/maxPoints` 与 `minVertexDistance` 取大 */
  tstep: number;
  /** 该条丝带的世界**半**宽 */
  thw: number;
  /** 最近一次记点的位置（判距用） */
  lx: number;
  ly: number;

  /**
   * 逐粒子随机系数（出生时抽一次、终生不变），`[0,1)`。
   *
   * 两处用途：
   *  1. `keysB` 非空时做**双曲线插值比例**（见 `lifeMulMix`，S8 `trail01` 靠它分开轨迹）；
   *  2. 否则作为 `mode = 2/3`（随机两常量）的**抽签系数**（见 `lifeMul`）。
   */
  vmix: number;

  /**
   * 出生时抽定的 `startColor`（RGBA，**终生不变**）。
   *
   * ★ 为什么是**逐粒子**而不是 uniform：Unity 的 `startColor` 是 `MinMaxGradient`，
   *   只要 mode 不是纯色（1=Gradient / 2=TwoColors / 3=TwoGradients / 4=RandomColor），
   *   **每颗粒子各抽各的**。蝶语吟花 `yuan_glow` 是 mode=4，逐粒子 alpha ∈[0.275,0.588]
   *   ——正是"有的光圈很亮、有的几乎看不见"的来源（2026-10-13）。
   *   没有 `startColorGradient` 的旧 config ⇒ 直接拷 `meshConfig.startColor`，行为不变。
   */
  sc: [number, number, number, number];

  /**
   * 重力累计速度（世界单位/秒，**只含 y**）。
   *
   * `gravityModifier ≠ 0` 时每帧 `gvy += gravAccY · dt`（半隐式欧拉，与 Unity 一致），
   * 位置积分时为 `(p.vy + vvy + p.gvy) · dt`。恒 0 ⇒ 对旧 config 逐位无影响。
   *
   * ⚠️ 已知近似：引擎既有的 `ClampVelocityModule` 只作用于**出生速度** `p.vx/vy`
   *   （该行为已按实录验收过），这里**不**把 `gvy` 并进限速 —— 否则会改变
   *   `lizi` / `huaban (1)` 两个启用 clamp 的系统的既有表现。
   */
  gvy: number;

  /**
   * 本地坐标系相对世界的 Z 旋角（弧度；只有**盒形发射器**会给非 0 值）。
   *
   * ★ 为什么要它：Unity 的 **Simulation Space = Local**（本项目全系 `moveWithTransform = 0`
   *   ⇒ Local，S9 已定案）时，`VelocityModule` 的 x/y 是**发射器本地坐标**下的速度
   *   ⇒ 渲染到世界要跟着节点自身的旋角一起转。
   *   `hudie01 ×3` 的节点带 30.69° 旋角，不转就会出现"蝴蝶朝正右飞、但游戏里是朝右上飞"。
   *
   * ⚠️ 只由**盒形分支**赋值（`type = 5`）。锥形(Cone/ConeVolume)与圆形(Circle)分支保持
   *   原样（`0`）—— 它们的 `emitDir` 已经把节点旋转折进去了（`_构建_配置生成.py`：
   *   `emit_dir = normalize(quat_rot(q, (0,0,1)).xy)`），S8/S9 已按该口径对实录验收过，
   *   此处不动以免回归。Freesia 的 `huaban/shizi/lizi/hualizi` 节点旋角本来就是 0，
   *   所以真正受影响的只有 `hudie01 ×3`。
   */
  localRot: number;

  /* ═══ P2「按速度与力」（2026-10-16）═════════════════════════════════════ */

  /**
   * z 坐标 / z 速度（世界单位）—— **只为「3D 演算、2D 渲染」服务**。
   *
   * ★ 为什么非有它不可：`VelocityModule.z`、`ForceModule.z`、以及 `orbitalX/Y`
   *   （绕 X / Y 轴的轨道旋转）都是 3D 量 —— 绕 X 轴转会搅动 (y,z)、绕 Y 轴会搅动 (z,x)，
   *   **不记 z 就算不对**。而渲染侧照旧**丢掉 z**（粒子恒在它所属 mesh 的 z 平面上），
   *   与本工程一贯的"2D 分层渲染"一致。
   *
   * ⚠️ 已知近似：Unity 里 z 位移还会让粒子远离/靠近相机 ⇒ 透视缩放，
   *   本引擎没有这层（画布 z 平面是常量），如实标注。
   * 恒 0 ⇒ 旧 config 逐位无影响。
   */
  z: number;
  vz: number;

  /**
   * 本帧**总速度大小**（世界单位/秒）= `|v| = hypot(vx + volX, vy + volY + gvy, vz + volZ)`。
   *
   * 供 `ColorBySpeed` / `SizeBySpeed` / `RotationBySpeed` 归一化取 `rate` 用。
   * 由 `step()` **每帧写回**，`buildGeometry()` 只读（保证两者看到同一帧的值）。
   */
  spd: number;
};

/* ─────────────────────────── 主类 ─────────────────────────── */

export class ParticleAnimator {
  private cfg: ParticleMeshConfig;
  /** 轿厢姿态角模式（仅轿厢组有值；其余为 undefined ⇒ 不干预出生朝向） */
  private cabinMode?: 'gravity' | 'game';
  /**
   * 轿厢**图元自带**的重力倾角（度）。只有轿厢组非 0（见 `FerrisWheelConfig.spriteTiltDeg`）。
   *
   * ★★ 为什么要有它（2026-10-11 修正的远古 bug）：图集里的 `FX_cf_chexiang01/02.png`
   *   是美术**按画面重力系画的**，图元自身相对画布就已经歪着 —— 放大对比很直观：
   *   **游戏实录**里同一只吊舱的窗格**竖直**，而**图元**的窗格是**歪的**。
   *   代码若只转 `startRotation`（另有 −15°），两份就**叠成 −30°** ⇒ 两个档位都多歪 15°
   *   （用户实测：`gravity` 渲染 ≈ −30°、`game` 也剩 ≈ −15°）。
   *   把它加进出生朝向 = 把素材那一份抵消掉，`startRotation` 的面值才等于真实渲染角。
   */
  private spriteTiltDeg: number;
  /**
   * 重力加速度（世界单位/秒²，世界 y 方向；本工程恒 ≤ 0 = 向下）。
   *
   * = `−(gravityModifier) × 9.81 × localScale × unitScale`。
   * 见 `ParticleMeshConfig.gravityModifier` 的说明（官方 "Scales the gravity value set in
   * the Physics window"，且 `scalingMode = Hierarchy` 下要乘 transform scale）。
   * `0` ⇒ 整套重力逻辑短路（其余 10 个系统逐位不变）。
   */
  private gravAccY = 0;

  /* ══════════════════════════════════════════════════════════════════════════
   * P2「按速度与力」—— 六个模块的**预计算开关**（2026-10-16）
   *
   * 全部**缺省为 false / 0** ⇒ 旧 config 走的是"整段短路"，逐位无影响。
   * 预计算的目的只是把 `enabled && 字段存在` 这类判断从"每帧每粒子"挪到构造时。
   * ══════════════════════════════════════════════════════════════════════════ */

  /** `VelocityModule.z` 有值且模块启用（z 只在"速度大小"里起作用，见 config 注释） */
  private volZOn = false;
  /** `VelocityModule` 的 x/y 是否按**世界**空间给（false = Local，缺省 = 现状） */
  private volWorld = false;
  /** 轨道旋转（绕 X/Y/Z 的角速度）是否启用 */
  private orbOn = false;
  /** 径向速度是否启用 */
  private radOn = false;
  /** 轨道中心（**世界单位**） */
  private orbOx = 0;
  private orbOy = 0;
  private orbOz = 0;
  /** `ForceModule` 启用 */
  private folOn = false;
  /** `ForceModule` 的 x/y 是否按**世界**空间给 */
  private folWorld = false;
  /**
   * `InheritVelocityModule` 启用。
   *
   * ★★ 官方硬口径：`simulationSpace !== World(1)` 时**该模块整个被忽略**
   *   （ScriptReference 逐字："only has an effect if the Particle System is set to
   *   simulate in world space"）⇒ 这里直接把守卫折进开关里。
   */
  private ivOn = false;
  /** 0 = Initial（出生加一次）、1 = Current（每帧跟随） */
  private ivMode = 0;
  /** 发射器速度（**世界单位/秒**） */
  private ivEvX = 0;
  private ivEvY = 0;
  /** `ColorBySpeedModule` 启用 */
  private cbsOn = false;
  /** 速度区间（**世界单位/秒**） */
  private cbsR0 = 0;
  private cbsR1 = 0;
  /** `SizeBySpeedModule` 启用 / 分轴 */
  private sbsOn = false;
  private sbsSep = false;
  private sbsR0 = 0;
  private sbsR1 = 0;
  /** `RotationBySpeedModule` 启用 */
  private rbsOn = false;
  private rbsR0 = 0;
  private rbsR1 = 0;

  /* ══════════════════════════════════════════════════════════════════════════
   * P4「UV / Noise 细节」—— 构造期预计算（2026-10-17）
   *
   * ★ 全部**缺省 = 与 P4 之前逐位一致**：
   *   `nzOct = 1`（单层势场）、`nzScrollOn = false`（不加滚动偏移）、
   *   `nzSizeOn = false`（尺寸乘子恒 1）、`nzRotOn = false`（不产生自转）、
   *   `uvTimeMode = 0`（按寿命曲线）、`uvSingleRow = false`（整表）、
   *   `uvStart = null`（起始帧 0）。
   * 依据（官方逐字 + Cocos 逐行 + 全包普查）见 `config.type.ts` 的 `uv` / `noise` 段
   * 与 `docx/RESEARCH_粒子系统复刻参考.md` §4.14 / §4.15。
   * ══════════════════════════════════════════════════════════════════════════ */

  /** `octaveCount`（≥1）与两层叠层的振幅/频率倍率（缺省 0.5 / 2.0，= Unity 模板值） */
  private nzOct = 1;
  private nzOctMul = 0.5;
  private nzOctScale = 2;
  /** `scrollSpeed` 非零 ⇒ 采样点加"系统时间 × 该速度"的偏移（见 `config.type.ts` 的 ①②） */
  private nzScrollOn = false;
  /** `sizeAmount` 非空 ⇒ `buildGeometry` 用 `p.nzS` 调制尺寸 */
  private nzSizeOn = false;
  /** `rotationAmount` 非空 ⇒ `step()` 用 `p.nzRot` 产生自转（度/秒） */
  private nzRotOn = false;
  /** `separateAxes` ⇒ 位置推力逐轴改用 `strength / strengthY / strengthZ` */
  private nzSep = false;
  /** 逐轴有效强度（`damping` 与 `strength*` 已折进来；三轴相等 ⇒ 与 P4 之前同式） */
  private nzEffX = 0;
  private nzEffY = 0;
  private nzEffZ = 0;
  /** `timeMode`：0 Lifetime / 1 Speed / 2 FPS */
  private uvTimeMode = 0;
  /** `timeMode = 2` 的帧率（帧/秒） */
  private uvFps = 30;
  /** `timeMode = 1` 的速度区间（**世界单位/秒**，已乘 `localScale × unitScale`） */
  private uvSpdR0 = 0;
  private uvSpdR1 = 1;
  /** `startFrame`（帧号；`null` ⇒ 恒 0 = 现状） */
  private uvStart: ParticleMinMax | null = null;
  /** `animationType === 1`（Single Row） */
  private uvSingleRow = false;
  /** SingleRow 档的行源：0 Custom（`rowIndex`）/ 1 Random（出生抽）/ 2 MeshIndex（≡ 0） */
  private uvRowMode = 0;
  private uvRowIndex = 0;
  /** SingleRow 档的**行数**（= `tilesY`，出生抽行用） */
  private uvRows = 1;

  /* ══════════════════════════════════════════════════════════════════════════
   * P3「渲染侧」—— `ParticleSystemRenderer` 的**预计算**（2026-10-17）
   *
   * 全部**缺省 = 与 P3 之前逐位一致**：`rMode = 0`(Billboard)、单位半轴 = 屏幕轴、
   * 枢轴 = 0、`rRoll = true`、无 mesh、`fudgeToZ = 0`。
   * 依据（官方逐字 + Cocos 逐行）见 `config.type.ts` 的 `renderer` 段与
   * `docx/RESEARCH_粒子系统复刻参考.md` §4.12/§4.13。
   * ══════════════════════════════════════════════════════════════════════════ */

  /** Render Mode：0 Billboard / 1 Stretched / 2 Horizontal / 3 Vertical / 4 Mesh / 5 None */
  private rMode = 0;
  /**
   * quad 的**两条单位半轴**在屏幕上的分量：顶点 = `sgn_A·uAx·sizeX + sgn_B·uAy·sizeY`。
   *
   * ★ 为什么用"基向量投影"而不是"宽度/高度压缩系数"：
   *   Unity 的三种 billboard 本质是**平面在世界空间里的朝向**不同（Horizontal 的平面
   *   平行 XZ、Vertical 的竖直并绕 Y 转向相机），投影到屏幕后一般是个**平行四边形**。
   *   用两条基向量的屏幕投影直接表达，既覆盖了轴对齐的 Billboard（退化成矩形），
   *   也精确表达了退化的 Horizontal（一条线段），无需为每档另立公式。
   *   ⚠️ 本引擎只存 2D 位置 ⇒ 投影用的相机方向对**整个系统**取一次（不是逐粒子），
   *      差异仅来自透视发散，量级在 `粒子半径/相机距离` 以下（本工程 ≈ 0.1%）。
   */
  private uAxX = 0.5;
  private uAxY = 0;
  private uAyX = 0;
  private uAyY = 0.5;
  /** 旋转枢轴偏移（**粒子直径的倍数**，逐轴）；缺省 0 = 绕中心（现状） */
  private pvX = 0;
  private pvY = 0;
  /** `allowRoll`：是否施加屏幕自转（=`rotationOverLifetime` / `rotationBySpeed` 的角） */
  private rRoll = true;
  /** `alignment === 4 (Velocity)`：粒子基准朝向取**速度方向**的屏幕角 */
  private rAlignVel = false;
  /** Stretched：沿速度方向的长度系数（见 `config.type.ts` 逐字依据） */
  private rVelScale = 0;
  private rLenScale = 0;
  /** 屏幕尺寸钳制（**视口高的比例**）；`rMaxSize <= 0` ⇒ 关闭 */
  private rMinSize = 0;
  private rMaxSize = 0;
  /** 视口高的世界尺寸（`2·|z|·tan(fov/2)`）；钳制用，缺省 0 = 不钳制 */
  private rViewportH = 0;
  /** 逐轴镜像概率（0..1）；用出生抽签的 `p.vmix` 判定，不额外消耗 rng */
  private rFlipX = 0;
  private rFlipY = 0;
  /** Mesh 档：顶点（每顶点 2 float）/ UV（2 float）/ 索引；`null` ⇒ 回退 quad */
  private rMeshPos: Float32Array | null = null;
  private rMeshUv: Float32Array | null = null;
  private rMeshIdx: Uint16Array | null = null;
  private rMeshScale = 1;
  /** mesh 的 UV 包围盒（`min + max − uv` 即在该轴上镜像 —— 用于 `flip`） */
  private rMeshUMin = 0;
  private rMeshUMax = 1;
  private rMeshVMin = 0;
  private rMeshVMax = 1;
  /**
   * `sortingFudge × fudgeToZ` 的 z 微调（世界单位，正 = 更靠近相机）。
   * 缺省 `0` ⇒ `mesh.position.z` 保持 config 给的值（现有产物逐位不变）。
   */
  private zShift = 0;

  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  /** `_Texture` 的 UV（会随 customData / `_UV_t` 流动） */
  private uvTexAttr: THREE.BufferAttribute;
  /** `_mask` 的 UV（**不动** —— 与 `_Texture` 是两次独立采样） */
  private uvMaskAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  /** 逐粒子 `startColor`（RGBA，4 float/顶点；见 geometry.setAttribute('aStartCol')） */
  private startColAttr: THREE.BufferAttribute;
  private rng: Rng;

  private particles: Particle[] = [];

  /** 系统时间（秒）：lengthInSec 循环 + burst 触发用 */
  private systemTime = 0;
  /**
   * 是否已经"开跑"（`ParticleMeshConfig.autoplay`，2026-10-14）。
   *
   * `autoplay: false` 的组（动作特效那批）构造后停在 `false`：`step()` 直接返回，
   * 既不发 burst、也不推进 `systemTime` ⇒ 画面里一个粒子都没有；
   * 等 `restart()` 被 `config.actionEffects` 调用时才置 `true` 并从头跑。
   * 缺省 `true` ⇒ 与改动前逐位一致。
   */
  private started = true;
  /**
   * Unity `looping`（`ParticleMeshConfig.looping`，2026-10-14）。
   * `false` ⇒ 只跑一个 `cycleSec` 就停发（见该字段的注释）。缺省 `true`。
   */
  private looping = true;
  /** 系统组自转角（弧度），摩天轮用 */
  private groupAngle = 0;
  /** rateOverTime 的发射累加器 */
  private emitAcc = 0;
  /** 已触发过的 burst，键为 `<周期序号>:<burst 序号>` */
  private burstFired: { [key: string]: boolean } = {};
  /** 当前 burst 批次内的序号 / 批次总量（Circle 的 BurstSpread 均布用） */
  private emittedInBatch = 0;
  private batchCount = 1;
  /** 复用的噪声缓冲，避免每帧 new */
  private noiseVec = new THREE.Vector3();

  /* ── 丝带轨迹（`trail.enabled` 时才用；字段语义见 ParticleMeshConfig.trail）── */
  private trailOn: boolean;
  /** `trail.lifetime`（秒）：单个轨迹点的存活时长，决定丝带长度 */
  private trailLife: number;
  /** `trail.minVertexDistance`（prefab 单位，步长下界） */
  private trailMinDist: number;
  /** 每条轨迹的点数上限（工程侧旋钮） */
  private trailMaxPts: number;
  /** `colorOverTrail` 的 alpha 键（沿丝带位置） */
  private trailTrailA: number[][];
  /** `colorOverLifetime` 的 alpha 键（轨迹点自身年龄） */
  private trailLifeA: number[][];
  /** `textureMode === 0`（Stretch）：整张贴图沿丝带拉满 */
  private trailStretch: boolean;

  /**
   * @param meshConfig 配置（长度量是 prefab 单位，靠 unitScale 一次换算到世界单位）
   * @param texture    已加载的 `_Texture`。粒子贴图是**直通 alpha**（不是 Spine 图集
   *                   那种预乘），所以既不开 premultiplyAlpha、也不做 RGB×255/alpha 反转
   * @param maskTexture 已加载的 `_mask`（仅 saoguang 有）。**空槽传 null 即可** ——
   *                   shader 里空槽等价于采样返回 (1,1,1,1)，代码里用"不采样"表达
   * @param cabinMode  **摩天轮轿厢组专用**：`game` ⇒ 出生朝向强制 **0°**（画布对齐，
   *                   与游戏实录一致）；`gravity` 或 `undefined` ⇒ 沿用 config 的
   *                   `startRotation`（解包值 −15°，随画面重力）。
   *                   非轿厢组**一律传 undefined**（由 `index.ts` 按 `cabinGroups` 判定）。
   *                   取证据与二选一的理由见 `config.type.ts` 的 `FerrisWheelConfig`。
   * @param spriteTiltDeg **轿厢图元自带的重力倾角**（度）：抵消素材里那一份，
   *                   叠加在上面 `cabinMode` 给出的角度之后。非轿厢组传 0（默认）。
   *                   为什么必须有它见字段注释（2026-10-11 修正）。
   */
  constructor(
    meshConfig: ParticleMeshConfig,
    texture: THREE.Texture,
    maskTexture?: THREE.Texture | null,
    cabinMode?: 'gravity' | 'game',
    spriteTiltDeg?: number
  ) {
    if (!texture) {
      throw 'particle texture does not fully loaded';
    }
    this.cfg = meshConfig;
    this.cabinMode = cabinMode;
    /**
     * `autoplay: false` ⇒ 开场不跑（见字段注释）。缺省 / 非 false ⇒ true。
     * 只认字面 `false`：写成 `0` / `"false"` 这类都按 `true` 处理（与旧行为一致、不猜）。
     */
    this.started = meshConfig.autoplay !== false;
    /**
     * `looping`：只认字面 `false`（缺省 true = 现状）。
     * 与 `autoplay` 同一口径 —— 不猜 `0` / `"false"` 这类写法。
     */
    this.looping = meshConfig.looping !== false;
    /** 只认有限数：写错成 `null` / `"15"` / `NaN` 时按 0 处理（= 不做补偿，与旧行为一致） */
    this.spriteTiltDeg =
      typeof spriteTiltDeg === 'number' && isFinite(spriteTiltDeg)
        ? spriteTiltDeg
        : 0;
    this.rng = new Rng(1013 + meshConfig.name.length * 7919);

    /**
     * 重力加速度（世界单位/秒²）。
     * = `−gravityModifier × 9.81 × localScale × unitScale`
     *   · 9.81 = Unity `Physics.gravity` 的 y 分量默认值（本工程未改物理设置）；
     *   · `× localScale × unitScale` = `scalingMode = Hierarchy` 下按 transform scale 折算，
     *     与 `velocity` 完全同口径（见 ParticleMeshConfig.gravityModifier）。
     * `gravityModifier` 缺省 / 0 ⇒ 保持 0 ⇒ 整套重力逻辑短路。
     */
    const gravMod = Number.isFinite(meshConfig.gravityModifier)
      ? (meshConfig.gravityModifier as number)
      : 0;
    this.gravAccY =
      gravMod === 0
        ? 0
        : -gravMod *
          9.81 *
          (Number.isFinite(meshConfig.localScale) ? meshConfig.localScale : 1) *
          (Number.isFinite(meshConfig.unitScale) ? meshConfig.unitScale : 1);

    /* ── P2「按速度与力」的开关预计算（缺省全关 ⇒ 旧 config 逐位无影响）──
     *
     * ⚠️ 速度类量（`radial` / `orbitalOffset` / `range`）都要乘
     *    `localScale × unitScale` 折到**世界单位**，与 `velocity.x/y` 同口径。
     */
    const s2w =
      (Number.isFinite(meshConfig.localScale) ? meshConfig.localScale : 1) *
      (Number.isFinite(meshConfig.unitScale) ? meshConfig.unitScale : 1);
    const vel = meshConfig.velocity;
    const velOn = !!(vel && vel.enabled);
    this.volZOn = velOn && !!vel!.z;
    this.volWorld = velOn && vel!.space === 1;
    const orbX = velOn ? vel!.orbitalX : undefined;
    const orbY = velOn ? vel!.orbitalY : undefined;
    const orbZ = velOn ? vel!.orbitalZ : undefined;
    this.orbOn = !!(orbX || orbY || orbZ);
    this.radOn = velOn && !!vel!.radial;
    this.orbOx = ((vel && vel.orbitalOffsetX) || 0) * s2w;
    this.orbOy = ((vel && vel.orbitalOffsetY) || 0) * s2w;
    this.orbOz = ((vel && vel.orbitalOffsetZ) || 0) * s2w;
    const fol = meshConfig.force;
    this.folOn = !!(fol && fol.enabled);
    this.folWorld = !!(fol && fol.space === 1);
    const iv = meshConfig.inheritVelocity;
    /**
     * ★ `simulationSpace === 1`(World) 才算数 —— 官方逐字：Local 下该模块被忽略。
     *   缺省（`undefined`）按 0 = Local ⇒ 不生效（与"旧 config 没这个模块"一致）。
     */
    this.ivOn = !!(iv && iv.enabled && iv.simulationSpace === 1);
    this.ivMode = iv && iv.mode === 1 ? 1 : 0;
    this.ivEvX = iv && iv.emitterVelocity ? iv.emitterVelocity[0] || 0 : 0;
    this.ivEvY = iv && iv.emitterVelocity ? iv.emitterVelocity[1] || 0 : 0;
    const cbs = meshConfig.colorBySpeed;
    this.cbsOn = !!(cbs && cbs.enabled);
    this.cbsR0 = (cbs && cbs.range ? cbs.range[0] : 0) * s2w;
    this.cbsR1 = (cbs && cbs.range ? cbs.range[1] : 1) * s2w;
    const sbs = meshConfig.sizeBySpeed;
    this.sbsOn = !!(sbs && sbs.enabled);
    this.sbsSep = !!(sbs && sbs.separateAxes);
    this.sbsR0 = (sbs && sbs.range ? sbs.range[0] : 0) * s2w;
    this.sbsR1 = (sbs && sbs.range ? sbs.range[1] : 1) * s2w;
    const rbs = meshConfig.rotationBySpeed;
    this.rbsOn = !!(rbs && rbs.enabled);
    this.rbsR0 = (rbs && rbs.range ? rbs.range[0] : 0) * s2w;
    this.rbsR1 = (rbs && rbs.range ? rbs.range[1] : 1) * s2w;

    /* ── P4「UV / Noise 细节」的预计算 ────────────────────────────────────
     * 缺省（旧 config 没有这些字段）⇒ 下面每一个量都停在"与 P4 之前等价"的值上
     *（`nzOct=1` / `nzScrollOn=false` / `nzSizeOn=false` / `nzRotOn=false` /
     *  `nzSep=false` / `uvTimeMode=0` / `uvStart=null` / `uvSingleRow=false`）。
     */
    const nz = meshConfig.noise;
    if (nz && nz.enabled) {
      const oct = Math.floor(
        Number.isFinite(nz.octaves as number) ? (nz.octaves as number) : 1
      );
      this.nzOct = oct >= 1 ? oct : 1;
      this.nzOctMul = Number.isFinite(nz.octaveMultiplier as number)
        ? (nz.octaveMultiplier as number)
        : 0.5;
      this.nzOctScale = Number.isFinite(nz.octaveScale as number)
        ? (nz.octaveScale as number)
        : 2;
      this.nzScrollOn = !!nz.scrollSpeed;
      this.nzSizeOn = !!nz.sizeAmount;
      this.nzRotOn = !!nz.rotationAmount;
      /**
       * `separateAxes` ⇒ 逐轴强度；缺省 `strengthY/Z` 回退到 `strength`。
       * `damping` 逐轴同样折算（官方 *"When enabled, strength is proportional to
       * frequency"* —— 对每条强度分量都成立），但**乘数只用一条 frequency**。
       */
      this.nzSep = nz.separateAxes === true;
      const k = nz.damping ? nz.frequency : 1;
      this.nzEffX = nz.strength * k;
      this.nzEffY =
        (this.nzSep
          ? Number.isFinite(nz.strengthY as number)
            ? (nz.strengthY as number)
            : nz.strength
          : nz.strength) * k;
      this.nzEffZ =
        (this.nzSep
          ? Number.isFinite(nz.strengthZ as number)
            ? (nz.strengthZ as number)
            : nz.strength
          : nz.strength) * k;
    }

    const uvc = meshConfig.uv;
    if (uvc) {
      const tm = uvc.timeMode;
      this.uvTimeMode = tm === 1 || tm === 2 ? tm : 0;
      this.uvFps = Number.isFinite(uvc.fps as number)
        ? (uvc.fps as number)
        : 30;
      /**
       * ★ `speedRange` 是**世界单位/秒**（与本引擎 `p.spd` 同口径）⇒ 与三个 by-speed
       *   模块一样乘 `localScale × unitScale`；缺省 `[0, 1]`（Unity 模板值）。
       */
      const sr = uvc.speedRange;
      this.uvSpdR0 = (sr ? sr[0] : 0) * s2w;
      this.uvSpdR1 = (sr ? sr[1] : 1) * s2w;
      this.uvStart = uvc.startFrame ? uvc.startFrame : null;
      this.uvSingleRow = uvc.animationType === 1;
      this.uvRowMode = uvc.rowMode === 1 ? 1 : uvc.rowMode === 2 ? 2 : 0;
      this.uvRowIndex = Number.isFinite(uvc.rowIndex as number)
        ? Math.max(0, Math.floor(uvc.rowIndex as number))
        : 0;
      this.uvRows = Math.max(1, Math.floor(uvc.tilesY) || 1);
      // ★ `uv.flipU / flipV`（Unity 已废弃的同义字段）的解析见 `rd` 段**之后** ——
      //   要先知道 `renderer.flip` 给没给值，才知道该不该回退。
    }

    /* ── P3 渲染侧（`ParticleSystemRenderer`）──────────────────────────────
     * 整段 `if (rd)` 包住 ⇒ 缺省（无 `renderer` 字段）时下面这些量一个都不改，
     * 与 P3 之前逐位一致（Billboard + 绕中心枢轴 + 不自转开关 + 无 mesh）。
     */
    const rd = meshConfig.renderer;
    if (rd) {
      const rm = typeof rd.renderMode === 'number' ? rd.renderMode : 0;
      this.rMode = rm;
      const b = camBasis();
      const ax = renderModeAxes(rm, b);
      this.uAxX = ax[0];
      this.uAxY = ax[1];
      this.uAyX = ax[2];
      this.uAyY = ax[3];
      /** 枢轴 = **直径的倍数**（ScriptReference 逐字："multiplier of the particle sizes,
       *  relative to their diameters"）⇒ 偏移量 = `pivot × 当前帧尺寸`，在 `buildGeometry` 里乘 */
      this.pvX = rd.pivot && isFinite(rd.pivot[0]) ? rd.pivot[0] : 0;
      this.pvY = rd.pivot && isFinite(rd.pivot[1]) ? rd.pivot[1] : 0;
      this.rRoll = rd.allowRoll !== false;
      this.rAlignVel = rd.alignment === 4;
      this.rVelScale = isFinite(rd.velocityScale as number)
        ? (rd.velocityScale as number)
        : 0;
      this.rLenScale = isFinite(rd.lengthScale as number)
        ? (rd.lengthScale as number)
        : 0;
      this.rMinSize = isFinite(rd.minParticleSize as number)
        ? Math.max(0, rd.minParticleSize as number)
        : 0;
      this.rMaxSize = isFinite(rd.maxParticleSize as number)
        ? Math.max(0, rd.maxParticleSize as number)
        : 0;
      this.rFlipX =
        rd.flip && isFinite(rd.flip[0])
          ? Math.min(1, Math.max(0, rd.flip[0]))
          : 0;
      this.rFlipY =
        rd.flip && isFinite(rd.flip[1])
          ? Math.min(1, Math.max(0, rd.flip[1]))
          : 0;
      /**
       * 排序偏差 → **整个系统**的 z 微调。
       * ★ 必须显式给 `fudgeToZ`：Unity 如何把无量纲 fudge 折进排序距离**未公开**，
       *   而本引擎的透明排序完全由 `mesh.position.z` 决定 ⇒ 换算只能由数据层给出。
       *   缺省 `fudgeToZ = 0` ⇒ `zShift = 0` ⇒ 现有产物的 z 序逐位不变。
       */
      if (
        isFinite(rd.sortingFudge as number) &&
        isFinite(rd.fudgeToZ as number)
      ) {
        this.zShift = -(rd.sortingFudge as number) * (rd.fudgeToZ as number);
      }
      /**
       * Mesh 档顶点集。⚠️ 只在 `renderMode === 4` 且数据自洽（索引非空、且
       * 每个索引都落在顶点范围内）时才启用；否则**静默回退 quad** ——
       * 宁可退化成现状，也不要越界读。
       */
      const msh = rd.mesh;
      if (rm === 4 && msh && msh.positions && msh.uv0 && msh.indices) {
        const nv = Math.floor(msh.positions.length / 2);
        const ok =
          nv > 0 &&
          msh.indices.length >= 3 &&
          msh.uv0.length >= nv * 2 &&
          msh.indices.length <= 65535 &&
          msh.indices.every((i) => i >= 0 && i < nv);
        if (ok) {
          this.rMeshPos = new Float32Array(msh.positions);
          this.rMeshUv = new Float32Array(msh.uv0);
          this.rMeshIdx = new Uint16Array(msh.indices);
          this.rMeshScale = isFinite(msh.scale as number)
            ? (msh.scale as number)
            : 1;
          // UV 包围盒（`flip` 要"在条目自己的范围内镜像"，不能一律按 [0,1] 算）
          let u0m = Infinity;
          let u1m = -Infinity;
          let v0m = Infinity;
          let v1m = -Infinity;
          for (let i = 0; i < nv; i++) {
            const uu = this.rMeshUv[i * 2];
            const vv = this.rMeshUv[i * 2 + 1];
            if (uu < u0m) u0m = uu;
            if (uu > u1m) u1m = uu;
            if (vv < v0m) v0m = vv;
            if (vv > v1m) v1m = vv;
          }
          this.rMeshUMin = u0m;
          this.rMeshUMax = u1m;
          this.rMeshVMin = v0m;
          this.rMeshVMax = v1m;
        }
      }
    }

    /**
     * ★★ P4：`uv.flipU / flipV` 作为 **`renderer.flip` 的回退**。
     *
     * 依据（ScriptReference 逐字）：*"flipU property is deprecated. Use
     * `ParticleSystemRenderer.flip.x` instead."* ⇒ 两者是**同一份数据的两个入口**。
     * 本引擎以 `renderer.flip` 为准（P3 已实现），只有在它**没给**（= 0）而 UV 段给了
     * 非零值时，才把 UV 的值拿来用 —— 这样对"只用旧字段打包的工程"也能保真，
     * 而本工程三个产物两者都是 0 / `[1,0,0]`（renderer 有值、UV 为 0）
     * ⇒ **逐位与 P3 一致**。
     */
    if (uvc) {
      if (this.rFlipX === 0 && isFinite(uvc.flipU as number)) {
        this.rFlipX = Math.min(1, Math.max(0, uvc.flipU as number));
      }
      if (this.rFlipY === 0 && isFinite(uvc.flipV as number)) {
        this.rFlipY = Math.min(1, Math.max(0, uvc.flipV as number));
      }
    }

    const max = Math.max(1, Math.floor(meshConfig.maxNumParticles || 1));

    /**
     * 丝带参数（`trail01` 这类 Trail/Ribbon 粒子）。
     *
     * ★ `verticesPerParticle`：默认 6（一个 quad = 两个三角形 = 6 个**独立**顶点，
     *   本引擎不建索引缓冲）。开了丝带则再预留 `maxPoints × 6`（每段 6 个顶点）。
     *   点数上限见 `ParticleMeshConfig.trail.maxPoints` 的注释（防顶点爆炸）。
     */
    this.trailOn = !!(meshConfig.trail && meshConfig.trail.enabled);
    this.trailLife = this.trailOn
      ? Math.max(0.01, meshConfig.trail!.lifetime)
      : 0;
    this.trailMinDist = this.trailOn
      ? Math.max(1e-4, meshConfig.trail!.minVertexDistance)
      : 0.2;
    this.trailMaxPts = this.trailOn
      ? Math.max(2, Math.floor(meshConfig.trail!.maxPoints ?? 64))
      : 0;
    this.trailTrailA = this.trailOn
      ? meshConfig.trail!.colorOverTrailAlpha ?? []
      : [];
    this.trailLifeA = this.trailOn
      ? meshConfig.trail!.colorOverLifetimeAlpha ?? []
      : [];
    this.trailStretch = !meshConfig.trail || meshConfig.trail.textureMode === 0;
    /**
     * ── 每粒子顶点数（P3 起可被 Mesh 档抬高）──
     *
     * 默认 6（一个 quad = 两个三角形 = 6 个**独立**顶点，本引擎不建索引缓冲）；
     * `renderMode = 4 (Mesh)` 且顶点数据自洽时按 mesh 的索引数走 —— 本引擎把 mesh 的
     * 三角形**逐个展开成独立顶点**（与 quad 同一套约定），所以上限取索引个数。
     * ⚠️ 缺省（无 `renderer.mesh`）⇒ 仍是 6，逐位不变。
     */
    const meshVpp = this.rMeshIdx ? this.rMeshIdx.length : 0;
    const vpp =
      Math.max(6, meshVpp) + (this.trailOn ? this.trailMaxPts * 6 : 0);
    /**
     * 一个 mesh 承载本系统的全部粒子（动态四边形）。这样 z 排序只需给这一个
     * mesh 一个 `position.z`，与分层背景 / 角色共用同一套
     * "transparent 物体按 远→近 排序"的机制 —— 不需要另开渲染通道。
     *
     * ★ `uv`（`_Texture`）与 `aMaskUv`（`_mask`）是**两套 UV**：真 shader 里
     *   `_Texture` 走 `texUV`（含 CustomData / `_UV_t` 的平移）、`_mask` 走 `maskUV`
     *   （`in_TEXCOORD0`，不动）。合成"预乘成品图"的做法会丢掉这个区别。
     */
    this.posAttr = new THREE.BufferAttribute(
      new Float32Array(max * vpp * 3),
      3
    );
    this.uvTexAttr = new THREE.BufferAttribute(
      new Float32Array(max * vpp * 2),
      2
    );
    this.uvMaskAttr = new THREE.BufferAttribute(
      new Float32Array(max * vpp * 2),
      2
    );
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max * vpp), 1);
    /**
     * 逐粒子的 `startColor`（RGBA，4 float/顶点）。
     *
     * ★ 为什么不能继续用 uniform（2026-10-13）：Unity 的 `startColor` 是 `MinMaxGradient`，
     *   Gradient / RandomColor / TwoGradients 档下**每颗粒子各抽各的**（`yuan_glow`
     *   逐粒子 alpha ∈[0.275,0.588]）。uniform 只能表达"全场同一个值"，那正是
     *   "所有光圈一样亮"的来源。旧 config 没有梯度时，每个顶点写的就是常量
     *   `startColor` ⇒ 与旧的 uniform 路径逐位等价。
     */
    this.startColAttr = new THREE.BufferAttribute(
      new Float32Array(max * vpp * 4),
      4
    );
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('uv', this.uvTexAttr);
    this.geometry.setAttribute('aMaskUv', this.uvMaskAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setAttribute('aStartCol', this.startColAttr);
    this.geometry.setDrawRange(0, 0);

    for (const t of [texture, maskTexture]) {
      if (!t) {
        continue;
      }
      t.premultiplyAlpha = false;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      // wrap 见 config.type.ts 的 `uv.wrap` 说明（工程侧适配决定，UnityPy 未暴露该字段）
      t.wrapS = t.wrapT =
        meshConfig.uv && meshConfig.uv.wrap === 'repeat'
          ? THREE.RepeatWrapping
          : THREE.ClampToEdgeWrapping;
    }

    const add = meshConfig.blend === 'add';

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uMask: { value: maskTexture || WHITE_1X1 },
        /** 是否有 `_mask` 槽（仅用于片元里选"取 rgb 塑形"还是"跳过"） */
        uHasMask: { value: maskTexture ? 1 : 0 },
        /** = 材质 `_Alphe` */
        uAlphe: {
          value: Number.isFinite(meshConfig.alphe) ? meshConfig.alphe : 1,
        },
        /** 1 = 走 `UVliudong`（加色、alpha 恒 1）；0 = 走 `UVliudong_Blended`（真实 alpha） */
        uAdditive: { value: add ? 1 : 0 },
      },
      vertexShader: [
        'attribute float aAlpha;',
        'attribute vec2 aMaskUv;',
        /** ★ 逐粒子 startColor（vs_COLOR0）—— 不再是 uniform，见 startColAttr 的说明 */
        'attribute vec4 aStartCol;',
        'varying vec2 vTexUv;',
        'varying vec2 vMaskUv;',
        'varying float vAlpha;',
        'varying vec4 vStartCol;',
        'void main() {',
        '  vTexUv = uv;',
        '  vMaskUv = aMaskUv;',
        '  vAlpha = aAlpha;',
        '  vStartCol = aStartCol;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      /**
       * 片元 = 两支 shader 的合并实现（用 `uAdditive` 这个 uniform 常量分支区分，
       * 分支是 uniform 的，GPU 侧无发散代价）。
       * 常量（`_Color = (1,1,1,1)`、`_mask02` 空槽 ⇒ 1.0）已按规格直接折掉。
       * 注意两支取 `_mask` 的**通道不同**：`UVliudong` 取 **rgb**（灰度塑形），
       * `UVliudong_Blended` 取 **x**（= r 通道）。
       */
      fragmentShader: [
        'uniform sampler2D uMap;',
        'uniform sampler2D uMask;',
        'uniform float uHasMask;',
        'uniform float uAlphe;',
        'uniform float uAdditive;',
        'varying vec2 vTexUv;',
        'varying vec2 vMaskUv;',
        'varying float vAlpha;',
        'varying vec4 vStartCol;',
        'void main() {',
        '  vec4 tex = texture2D(uMap, vTexUv);',
        '  if (uAdditive > 0.5) {',
        // ── UVliudong：mask 的 rgb 塑形 + 预乘 + 加色 + alpha 恒 1 ──
        '    vec3 maskRgb = uHasMask > 0.5',
        '      ? texture2D(uMask, vMaskUv).rgb : vec3(1.0);',
        '    vec3 c = maskRgb * tex.rgb;',
        '    float a = tex.a * vStartCol.a;',
        '    c *= vStartCol.rgb;',
        '    c *= a;',
        '    c *= uAlphe;',
        '    gl_FragColor = vec4(c * vAlpha, 1.0);',
        '  } else {',
        // ── UVliudong_Blended：mask 的 x 塑形 + 真实 alpha ──
        '    float m = uHasMask > 0.5 ? texture2D(uMask, vMaskUv).x : 1.0;',
        '    vec3 c = tex.rgb * m * vStartCol.rgb * uAlphe;',
        '    float a = m * tex.a * vStartCol.a * uAlphe;',
        '    gl_FragColor = vec4(c, a * vAlpha);',
        '  }',
        '}',
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    if (add) {
      /**
       * ★ 加色组必须用 `CustomBlending` 显式设 `One/One`。
       * `THREE.AdditiveBlending` 是 `(SrcAlpha, One)` —— 与真 shader 的
       * `SrcBlend=One, DstBlend=One`（见 `_证据/着色器_混合状态.txt`）不等价，
       * 会少乘一次 alpha（片元里已经预乘过）。这是"又粗又亮"的机制性来源之一。
       */
      material.blending = THREE.CustomBlending;
      material.blendSrc = THREE.OneFactor;
      material.blendDst = THREE.OneFactor;
      material.blendEquation = THREE.AddEquation;
    }

    this.mesh = new THREE.Mesh(this.geometry, material);
    /**
     * ★ `+ this.zShift`：`renderer.sortingFudge × fudgeToZ` 的 z 微调
     *   （官方逐字：*"This setting only affects where an **entire system** appears in the
     *   scene — it does not perform sorting on individual particles within a system."*
     *   ⇒ 正好对应本引擎"一个系统 = 一个 `THREE.Mesh`、排序由它的 z 决定"）。
     *   缺省 `zShift = 0` ⇒ 与 P3 之前逐位一致。
     */
    this.mesh.position.set(
      meshConfig?.position?.x ?? 0,
      meshConfig?.position?.y ?? 0,
      (meshConfig?.position?.z ?? -1000) + this.zShift
    );
    this.mesh.frustumCulled = false;
    Scene.scene?.add(this.mesh);

    if (meshConfig.prewarm && this.started) {
      this.prewarm();
    }
  }

  /* ── 发射 ────────────────────────────────────────────────────────────── */

  private spawn(): void {
    const c = this.cfg;
    const r = this.rng;
    const u = c.unitScale;
    const s = c.localScale;
    /** 尺寸人工系数（默认 1；见 ParticleMeshConfig.sizeScale 的说明）。**只乘尺寸**。
     *  用 Number.isFinite 而非 `??`：`??` 只挡 undefined/null，挡不住 NaN / Infinity
     *  —— 那两者会绕过 buildGeometry() 里 `hw <= 0.01` 的守卫（`NaN <= 0.01` 为 false），
     *  把 NaN 静默写进顶点缓冲，表现为"粒子整体消失却无任何报错"。 */
    const sizeK = Number.isFinite(c.sizeScale) ? (c.sizeScale as number) : 1;

    const life = Math.max(0.05, spawnValue(c.startLifetime, r));
    const sizeA = spawnValue(c.startSize, r);
    const sizeB = c.size3D ? spawnValue(c.startSizeY, r) : sizeA;
    /**
     * 出生朝向（度）。
     *
     * ★ 轿厢组 + `cabinMode === 'game'` ⇒ **强制 0°**：
     *   解包给的是 −15°（美术按画面重力画），但游戏实录里轿厢长轴是 −0.03°
     *   （画布对齐，见 09 文档 04 §D1）⇒ 想"与游戏逐像素一致"就得把这一项归零。
     *   `gravity` / 非轿厢组：原样用 config 的 `startRotation`。
     *
     * ★★ 再加 `this.spriteTiltDeg`（**只有轿厢组非 0**）：抵消**素材里自带**的那一份
     *   重力倾角。不补的话 −15° 那份会与图元自带的 −15° 叠成 −30°，
     *   连 `game` 档也会剩 −15°（2026-10-11 用户实测的远古 bug，详见字段注释）。
     *
     * ★★★ **2026-10-13 修正：`startRotation` 要取负号**（蝶语吟花"蝴蝶倒着飞"的根因）。
     *
     *   Unity 的粒子 billboard 自转角在**屏幕上与解包值反号**（左手系 / View 对齐下
     *   正值在屏幕上是**逆时针**）。旧实现直接用 `+startRotation` ⇒ 图元朝着飞行方向的
     *   **反方向**偏 ⇒ 蝴蝶看起来"倒着飞"。
     *
     *   判据（`37/38/40_判定*.py`，逐格+逐变换+逐角度枚举、回转半径归一化、NCC）：
     *     同一张图集 `Fx_xk_hudie_05.png`（4×4），
     *       · 网页渲染（旧实现）  14/14 命中「原样、**−60°**」，NCC 0.94~0.99
     *       · 游戏实录（无人物）  14/14 命中「原样、**+60°**」，NCC 0.94~0.97
     *     即 `startRotation = −59°` 在游戏里应转 **+59°**。修复后网页应读出 +60°。
     *
     *   ⚠️ `spriteTiltDeg` **不参与取负**：它是"抵消素材自带倾角"的人工补偿，
     *   与 Unity 语义无关。这样保持轿厢组 `game` 档（已验证 = 竖直）逐位不变：
     *     `game` ⇒ `−0° + 15° = +15°`，叠上素材自带的 −15° ⇒ **0°（竖直）✓ 与修复前一致**。
     *     （代价：`gravity` 档由 −15° 变 +15°，镜像了；S9 用到该档需重看一次。）
     */
    const rotDeg =
      -(this.cabinMode === 'game'
        ? 0
        : spawnValue(c.startRotation, r) / DEG2RAD) + this.spriteTiltDeg;

    const p: Particle = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life,
      // 最终显示尺寸 = 初始大小 × localScale × 世界换算 × 人工尺寸系数
      sizeX: sizeA * s * u * sizeK,
      sizeY: sizeB * s * u * sizeK,
      spin: 0,
      rot: rotDeg * DEG2RAD,
      clampLimit: c.clamp.enabled
        ? spawnValue(c.clamp.magnitude, r) * s * u
        : 0,
      /**
       * UV 序列帧的帧偏移：出生时取一次。
       * 若 `frameOverTime` 是随机两常量（qiqiu）⇒ 这颗粒子**终生**停在这一帧（黄或粉）；
       * 若是曲线（niao）⇒ 这里取到的只是 `a`，实际帧由 `buildGeometry` 用曲线算。
       */
      uvFrameOver: c.uv.frameOverTime ? spawnValue(c.uv.frameOverTime, r) : 0,
      /** 由 buildGeometry 每帧写回（见 Particle.uvFrame） */
      uvFrame: -1,
      /**
       * ★ P4：Single Row 档播哪一行。
       * `rowMode = 1`(Random) ⇒ 出生时抽（官方 *"Randomly select a row for each
       * particle when producing the animation"*）。
       *
       * ⚠️ **只有真正会出现随机行时才消耗 rng**（`animationType = 1` **且**
       *   `rowMode = 1`）：否则会整体挪动既有系统的抽签序列 ⇒ 现有产物分布全变。
       *   （同 P1 里 `Circle` 首次消费 `startSpeed` 那次的教训 —— 当时如实记录为
       *   "位置重新随机、分布不变"。）实测本工程三个产物全部是 WholeSheet ⇒ 不抽。
       */
      uvRow:
        this.uvSingleRow && this.uvRowMode === 1
          ? Math.min(this.uvRows - 1, Math.floor(r.next() * this.uvRows))
          : this.uvRowMode === 2
          ? 0
          : Math.min(Math.max(0, this.uvRowIndex), this.uvRows - 1),
      /** P4：噪声标量 / 噪声 z 分量（由 step() 每帧写回；见 Particle.nzS / nzRot） */
      nzS: 0,
      nzRot: 0,
      /* 丝带轨迹：下面按出生速度补齐（见 spawn 末尾） */
      trail: [],
      tstep: 0,
      thw: 0,
      lx: 0,
      ly: 0,
      /** 逐粒子随机系数（见 Particle.vmix）：双曲线插值 或 随机两常量抽签 */
      vmix: r.next(),
      /** 起始色：紧跟其后用 `vmix` 抽（见 pickStartColor），避免多消耗随机数 */
      sc: [1, 1, 1, 1],
      /** 重力累计速度（见 Particle.gvy）；只有 gravityModifier ≠ 0 的系统会变非 0 */
      gvy: 0,
      /** 本地→世界 Z 旋角；只有盒形分支会覆写成非 0（见 Particle.localRot） */
      localRot: 0,
      /** P2：z 坐标 / z 速度（只有开了 vol.z / force.z / orbitalX,Y 的系统才会非 0） */
      z: 0,
      vz: 0,
      /** 由 step() 每帧写回（见 Particle.spd）；这里给出生瞬间的初值 */
      spd: 0,
    };
    // ★ 复用 `vmix` 抽起始色（不额外 rng ⇒ 既有抽签序列零回归；见 pickStartColor）
    p.sc = pickStartColor(c, p.vmix);

    // ── 初始位置/速度：ShapeModule ──
    const sh = c.shape;
    const dirAngle = Math.atan2(c.emitDir[1], c.emitDir[0]);
    // speedModifier 按官方措辞"倍率乘在粒子速度上"实现为初始速度的乘子
    const spdMul =
      c.velocity && c.velocity.enabled ? c.velocity.speedModifier : 1;
    /**
     * 形状类型（已把 obsolete 的 shell/edge 变体折叠到基类型，见 `normShapeType`）。
     * 缺省 −1 ⇒ 走"无形状"分支（与 `!sh` 同一条路）。
     */
    const st = sh && sh.enabled ? normShapeType(sh.type) : -1;
    /**
     * ── `m_Scale` / `m_Position` / `m_Rotation` 的通用折算（2026-10-16，P1「position/rotation 偏移」）──
     *
     * `m_Scale` 的 x/y 分量（config 的 `boxX/boxY`）：**各轴缩放**，官方 tooltip
     * "Scale the emission shape" ⇒ 取样点被它逐轴放大（`docx/RESEARCH…` §4.2）。
     * ⚠️ 非正数**视为 1**：0 会把发射区压成一条线/一个点（既有 Circle / Cone 口径，
     * 见 `_regress/70…` [6]），故沿用；缺省（旧 config 无此字段）同样 ⇒ 1，零回归。
     * ⚠️ Box(`type = 5`) 是**例外**：它的 `boxX/boxY` 是盒体**全长**，在它自己的分支里消费。
     *
     * `m_Position`（`offsetX/offsetY`）：形状相对发射器的平移，**最后**叠加（TRS 顺序）。
     * `m_Rotation.z`（`rotZ`）：形状自身的额外旋角，与节点在屏幕内的旋角 `nodeRotZ` **同轴相加**
     *   （两者都是绕本地 Z）。合角 `rot` 同时决定：① 采样点绕原点的旋转；② 径向/朝向类
     *   方向的基准；③ 存进 `p.localRot` 供 `VelocityModule` 的 x/y 折算（与 Box 同口径）。
     */
    const scX = sh && sh.boxX && sh.boxX > 0 ? sh.boxX : 1;
    const scY = sh && sh.boxY && sh.boxY > 0 ? sh.boxY : 1;
    const offX = ((sh && sh.offsetX) || 0) * s * u;
    const offY = ((sh && sh.offsetY) || 0) * s * u;
    const rot = (((sh && sh.rotZ) || 0) + c.nodeRotZ) * DEG2RAD;
    if (st === 10 || st === 0 || st === 2) {
      /**
       * ── 圆盘族：`Circle(10)` / `Sphere(0)` / `Hemisphere(2)`（+ 已折叠的 shell 变体）──
       *
       * ★★ 为什么三者在 2D 里共用一支（2026-10-16，P1「补形状族」）：
       *
       *   ① **属性集本来就相同** —— Unity 手册原文 *"Sphere, Hemisphere, and Circle have the
       *      same properties."*（Radius / Radius Thickness / Arc…）。`ShapeModuleUI.cs` 里
       *      这两支 case 的字段列表也逐字一致。
       *   ② **正交投影下位置分布完全相同** —— 半球 `{ρ ≤ R, z ≥ 0}` 投影到 XY 面仍是
       *      半径 R 的**整圆盘**（`(x,y)` 的投影区域与整球一致）；均匀球面/半球面/圆盘的
       *      投影密度也都取 `radiusThickness` 的支撑区间 `[R(1−t), R]`。⇒ 位置口径**无差别**，
       *      差别只在"方向"（下条），而 2D 下 z 分量被丢弃 ⇒ 连方向也一致。
       *      （本引擎的 ρ 口径见 `docx/TODO.md` §2.1：`ρ = R(1 − t + t·√u)`。）
       *   ③ 因此当年"Sphere / Hemisphere 落到锥形兜底分支"是**纯粹的错路**：位置碰巧同式，
       *      但会额外吃到锥形的 `angle/2` 方向发散（`angle` 对球/半球根本不在 UI 里，
       *      是序列化残留）与锥形的轴向位移。全包普查：`Sphere` 启用 1163 支、`Hemisphere` 535 支
       *      （第 3 / 第 5 大形状族），误伤的规模不小。
       *
       * ★ 方向 = **径向**（本地方位角 φ 所在方向）：
       *   Unity 手册逐字 *"a Sphere emits particles **outward in all directions**"*、
       *   *"Hemisphere — Uniform emission in all directions on one side of a plane"*、
       *   *"Circle — The particles move **only in the plane of the circle**"*；
       *   三方实现一致：Cocos `sphereEmit/hemisphereEmit/circleEmit` 都写
       *   `Vec3.normalize(dir, pos)`、feng3d `ParticleSystemShapeCircle` 写
       *   `dir = (cos a, sin a, 0)`（**单位**方向，不带半径 ⇒ `startSpeed` 量级不变）。
       *   ⚠️ 与 `docx/TODO.md` §2.6 保留的"锥形 `emitDir ± (ρ/R)·(angle/2)`"口径**不冲突**：
       *     那条只针对 Cone/ConeVolume（`qiqiu` / `niao` / S6 `huaban_2` 已验收）；本支是
       *     新增形状的**首次**实现，且三个产物里圆盘族的 `startSpeed` **全为 0**
       *     （`chexiang` / `yuan_glow` / `fx_chat_*` 逐条核过）⇒ 对已发布产物零影响。
       *
       * ★ 位置取值仍**由 `arcMode` 分流**（不是一律均布）：
       *   Unity `ParticleSystemShapeMultiModeValue`：0 = Random / 1 = Loop /
       *   2 = Ping-Pong / **3 = BurstSpread**。
       *   · `arcMode = 3`（BurstSpread）⇒ 粒子沿弧**均布**，相位取**本批次发射序号**
       *     （chexiang 0.04° / chexiang(1) 16.04° → 两组轿厢正好错开 16.00°）。官方原文
       *     *"Burst Spread mode distributes particle generation evenly around the shape…
       *      best used with burst emissions."*
       *     ⚠️ 本支**沿用**既有实现"均布时不看 `radiusThickness`、直接落在圆周上"
       *     （`chexiang` 的 config 没带 `radiusThickness` ⇒ 引擎缺省 1，若改成按厚度铺开
       *      **摩天轮 10 节轿厢就会散进圆面**、已验收画面被破坏）⇒ 刻意保留，见 `docx/TODO.md`。
       *   · 其余（**0 = Random** 等）⇒ 在**弧内随机**取角；半径由 `radiusThickness` 决定
       *     （0 = 只从外缘、1 = 铺满）。官方原文 *"Radius Thickness: The proportion of the
       *     volume that emits particles. A value of 0 emits particles from the outer surface…
       *     1 … the entire volume."*
       *
       * ★★ 2026-10-13 修正（蝶语吟花 `yuan_glow`「超亮光圈」的根因）：
       *   旧实现**无视 `arcMode`**、type=10 一律走 BurstSpread 均布，而相位取自
       *   `emittedInBatch / batchCount` —— `rateOverTime` 连续发射路径会把
       *   `batchCount` 钉成 1、`emittedInBatch` 钉成 0（见本文件"连续发射"段）
       *   ⇒ 角度**恒为 0** ⇒ 10 颗粒子全部堆在节点右侧 `+radius` 处，加法混合叠成一个
       *   位置固定、常亮的巨大光斑。而 `yuan_glow` 的实际参数是 `arcMode = 0`（Random），
       *   游戏里应是「画面左右随机位置闪烁的几个淡光圈」。
       *
       * `m_Scale`（config 里的 `boxX/boxY`）对圆盘族是**发射器的各轴缩放** ⇒ 可把圆形
       * 发射区拉成椭圆（`yuan_glow` 是 (1.5, 0.5)：x 半径 839 / y 半径 280 世界单位，
       * 横向正好铺满整幅画面，与实录取景吻合）。缺省 1 ⇒ 正圆。
       */
      const rad = (sh.radius || 0) * s * u;
      let phi: number;
      let rho: number;
      if (sh.arcMode === 3) {
        phi =
          (this.emittedInBatch / Math.max(1, this.batchCount)) *
          (sh.arc ?? 360) *
          DEG2RAD;
        rho = rad;
      } else {
        // Radius Thickness：0 = 外表面、1 = 整个体积；其间按面积比例
        // （与锥形分支同一口径：th=1 ⇒ ρ = R·√u 面积均匀；th=0 ⇒ ρ ≡ R 只在圆周）
        const th10 = Math.min(1, Math.max(0, sh.radiusThickness ?? 1));
        rho = rad * (1 - th10 + th10 * Math.sqrt(r.next()));
        // 弧内随机（官方 "Random: Unity generates particles randomly around the arc"）
        phi = r.next() * (sh.arc ?? 360) * DEG2RAD;
      }
      const wp = shapeXform(
        Math.cos(phi) * rho,
        Math.sin(phi) * rho,
        scX,
        scY,
        rot,
        offX,
        offY
      );
      p.x = wp.x;
      p.y = wp.y;
      // 径向方向（本地 φ → 世界 = φ + rot）；速度量级不因形状变化
      p.localRot = rot;
      const a10 = phi + rot;
      const spd10 = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(a10) * spd10;
      p.vy = Math.sin(a10) * spd10;
    } else if (st === 12) {
      /**
       * ── SingleSidedEdge(12)：线段发射器（P1 新增）──
       *
       * 官方语义（Manual / ShapeModule）：*"Edge — Emits particles from a line segment.
       * The particles move in the emitter object's **upward (Y) direction**."*
       * ⇒ 线段沿**本地 X**、出射方向沿**本地 +Y**（与 Box 的"forward(Z)"不同轴）。
       *
       * 几何（feng3d `ParticleSystemShapeEdge.ts`，注释标注原
       * `ParticleSystemShapeSingleSidedEdge.calcParticlePosDir`）：
       *   `arc = 360·radius`；Random ⇒ `radiusAngle = rand()·arc`；
       *   `radiusAngle /= arc` ⇒ `position.x = radius·(2·t − 1)`、`position.y = 0`、`dir = (0,1,0)`。
       *   ⇒ 线段**半长 = `radius`**（全长 `2·radius`），在 `[−R, +R]` 上均匀取点。
       *   `ShapeModuleUI.cs` 里 SingleSidedEdge 唯一可编辑的属性就是 `radius`
       *   （以 `MinMaxCurve` 形式给出，"Radius Mode" 决定取角方式）。
       *
       * ⚠️ 留档（本轮不做，均为**数据层未下发**导致、非引擎缺口）：
       *   · `radius` 的 MinMaxCurve 模式（Random Between Two Constants / Curve…）——
       *     config 只带一个标量；全包普查里 `radiusMode`（MultiModeValue）**恒为 0 = Random**、
       *     `radiusSpread` 恒为 0 ⇒ 只实现 Random 即覆盖全部 59 支。
       *   · `m_Scale.z` / `m_Position.z` 同理不下发（2D 下 z 无意义）。
       * ⚠️ 方向取"本地 +X 转 90°"用的是本引擎既有的"屏幕内平面朝向"口径
       *   （`nodeRotZ` = 本地 +X 在屏幕上的朝向，见圆盘族与本文件 `emitDir` 的说明）——
       *   与 §2.6 一样，是对"发射器平面只在屏幕内旋转"的 2D 化近似；若要更严格，
       *   需数据层额外下发"本地 +Y 的投影"（`emitUp`，见报告"后续"一节）。
       */
      const R12 = (sh.radius || 0) * s * u;
      const x12 = R12 * (r.next() * 2 - 1);
      const wp = shapeXform(x12, 0, scX, scY, rot, offX, offY);
      p.x = wp.x;
      p.y = wp.y;
      p.localRot = rot;
      // 本地 +Y ⇒ 屏幕角 = rot + 90°
      const a12 = rot + Math.PI / 2;
      const spd12 = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(a12) * spd12;
      p.vy = Math.sin(a12) * spd12;
    } else if (st === 5) {
      /**
       * Box(5)：**盒体内均匀发射**。
       *
       * ★ 为什么必须单独一支（2026-10-12，芙丽希娅蝶语吟花）：
       *   `ParticleSystemShapeType` 的数值是 **Cone = 4 / Box = 5 / Mesh = 6 /
       *   ConeVolume = 8 / Circle = 10**（与 S9 已定案的 4/8/10 同表；本工程 11 个系统里
       *   有 8 个是 5）。旧实现只有"10 = 圆"与"其余一律当锥"两支 ⇒ Box 被当成锥：
       *     · 用**直径 ~2.6 的小圆盘**去近似 **840×786 的盒子** ⇒ `shizi`（闪烁星星）
       *       的发射区从铺满天空缩成角色身上一小块，被角色挡住 ⇒ 表现为"星星没有"；
       *     · `m_Scale`（盒体真实尺寸）在生成配置时被整条丢掉，无处可查。
       *
       * 官方语义（Manual / ShapeModule）：`Box — Emit from the volume of a box`，
       * 盒体尺寸 = `m_Scale`、盒心 = `m_Position`、朝向 = `m_Rotation`（均为发射器本地量）。
       *
       * ★ 本地量按 `localScale`(s) 与 `unitScale`(u) 折算，与锥形的 `radius` 同口径。
       * ★ 节点自身旋角不在这里直接算朝向，而是存进 `p.localRot`：位置偏移当场转，
       *   速度模块（`VelocityModule`）在 update 里用同一角度转（见 `Particle.localRot`）。
       * ★ 2026-10-16 起：`m_Rotation.z` / `m_Position` 的折算**上提到分支外**（`rot` / `offX` / `offY`），
       *   与新增的圆盘族 / 线段族共用一套口径 —— 本支的算式逐位不变（`rot = rotZ + nodeRotZ`、
       *   偏移最后叠加），只是不再就地重复声明。
       */
      const bx = (sh.boxX ?? 0) * s * u;
      const by = (sh.boxY ?? 0) * s * u;
      const ox = (r.next() - 0.5) * bx;
      const oy = (r.next() - 0.5) * by;
      const off = rotVec(ox, oy, rot);
      p.x = offX + off.x;
      p.y = offY + off.y;
      p.localRot = rot;
      const spd = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(dirAngle + rot) * spd;
      p.vy = Math.sin(dirAngle + rot) * spd;
    } else if (st === 4 || st === 8) {
      /**
       * Cone(4) / ConeVolume(8)：锥形发射器。
       *
       * ★ 历史：2026-09-20 重写过一次（把 `radius` 接进几何、收口"`Length` 只在 Volume 参与"）；
       *   **2026-10-16 再重写一次**修"一条线"（方位角 / `arc` / `m_Scale`）。
       *
       * ★★★ 2026-10-16 重写（本轮 P0「修锥形」；旧实现的三个硬伤）：
       *
       *   ① **没有方位角** ⇒ 粒子排成一条线。旧代码把 `ρ` 只作用在
       *      "垂直于锥轴的一条线"上（`p = 轴·t + 法向·(±ρ)`）⇒ 所有粒子落在那条线上。
       *      S8 动作特效（`FX_Asuna_S8_Background_touch1`，`emitDir = [0,1]`）的观感
       *      "一条水平的线"就是这个 bug 的可见形态（锥轴朝上 ⇒ 退化线是水平的）。
       *   ② **不吃 `arc`**：`arc` 过去只在 Circle 分支被消费 ⇒ 230° 的扇形被当成整圆。
       *   ③ **不吃 `ShapeModule.m_Scale`**：Box 拿它当盒体全长、Circle 拿它当各轴缩放，
       *      锥形则完全忽略。S8 本特效 `radius = 7` 而 `m_Scale = (150,150,150)`
       *      ⇒ 半径差 150 倍（过去只能在**数据层**折算，见 `190_生成S8动作特效.py`）。
       *
       * 官方语义（Manual / PartSysShapeModule）：
       *   Angle            = 锥在**顶点处**的张角（0 = 圆柱、90 = 平盘）
       *   Radius           = 底面圆的半径；`Radius Thickness` = 发射的体积比例
       *   Length           = 锥长（UI 上仅当 `Emit from: Volume` 时可编辑）
       *   Scale            = "Change the size of the emitter shape" ⇒ 形状尺寸的乘子
       *   "The particles diverge in proportion to their distance from the cone's center line."
       *
       * ★ 三方实现交叉证实的几何（`docx/RESEARCH_粒子系统复刻参考.md` §4.1/§4.3）：
       *   Cocos `shape-module.ts#coneEmit()` / feng3d `ParticleSystemShapeCone.ts` /
       *   LayaAir `ConeShape.ts` 三者一致 —— **底面是 XY 平面内的圆盘（或 `arc` 扇形）**，
       *   锥轴沿 ±Z（只在 `ConeVolume` 里沿轴再取一段位移）。
       *   本引擎是 2D 平面渲染 ⇒ 底面圆盘**就是屏幕平面上的圆盘/扇形**：
       *   取方位角 `φ`（由 `arc` 定范围）+ 半径 `ρ`（由 `radiusThickness` 定大小），
       *   再把 `m_Scale` 按**各轴**乘在采样点上（非等比 ⇒ 发射区是椭圆）。
       *
       * ★ 方位角与 `arc` 语义**与圆盘族（Circle/Sphere/Hemisphere）逐条同口径**
       *   （三者共用一套 arc/arcMode）：
       *   `arcMode = 3`（BurstSpread）⇒ 沿弧均布、相位取本批次发射序号；
       *   其余（0 = Random 等）⇒ 弧内随机。
       *   ★ 2026-10-16：`φ` 改为**本地**方位角，`nodeRotZ` 与 `m_Rotation.z` 的旋转统一由
       *   `shapeXform()` 施加（先缩放、再旋转 ⇒ 与 Unity 的 `TRS` 一致；仅在等比 `m_Scale`
       *   下与"折进方位角"的旧写法等价）。
       *
       * ★ 方向发散**沿用本引擎既有的 2D 口径**（`docx/TODO.md` §2.2 的定案）：
       *   `spread = (ρ/R)·(angle/2)`，即"相对锥轴的**平面**张角"，Unity 方向里的 z
       *   分量被丢弃（2D 下无意义）。锥轴仍取 `emitDir`；哪一侧由该粒子的方位角决定
       *   （`φ` 落在锥轴哪一侧就偏向哪一侧 —— 与"离中心线越远、偏离越大"呼应）。
       *   ⚠️ 不改成"方向 = 纯径向（`v_xy ∝ pos·tan(angle/2)`）"的另一套口径：那会把
       *     `startSpeed` 缩掉一个 `tan(angle/2)`，S6 已验收的 `fx_touch2_huaban_2`
       *     （`startSpeed = 8`、`angle = 5°`）会整支变样（速度掉到 1/23）。
       *
       * ⚠️ 已收口（2026-09-20，官方 Manual + 解包数据自证，见 06 号审计文档 §P0-b）：
       *   `Length` **只在 `Emit from: Volume` 下参与几何**（官方逐字：
       *   "This property is available only when Emit from: is Volume"）。
       *   ⇒ `qiqiu` 是 Cone(4)=Base，`length=5.0` 是 Unity 默认值残留（与 chexiang 这个
       *      根本没有 length 语义的 Circle 完全同值），**不参与几何**，底面就在发射器原点 ⇒ t=0；
       *      `niao` 是 ConeVolume(8)，`length=14.07` ≠ 5.0 是**被实际调整过的值** ⇒ 参与，t∈[0,H]。
       *   ⇒ **不要用 `radius / tan(angle/2)` 去求"出生点的轴向位移"**：那算的是锥的几何高度，
       *      在 Unity 语义里它不是位移量（Base 的出生点就在原点平面），用它会把出生点推出画面。
       */
      const R = (sh.radius || 0) * s * u; // **近盘**半径（世界单位）
      // Length = 锥长，仅 ConeVolume(8) 使用；Cone(4)/Base 下不参与几何
      const H = (sh.length || 0) * s * u;
      // 锥轴 = emitDir（本地 +Z 投影到 XY 并归一化）—— 只用于「轴向位移」与「方向发散」
      const axX = Math.cos(dirAngle);
      const axY = Math.sin(dirAngle);
      // Radius Thickness：0 = 只从外表面、1 = 整个体积内均匀
      // （与 Circle 随机分支同一口径：th=1 ⇒ ρ = R·√u 面积均匀；th=0 ⇒ ρ ≡ R 只在圆周）
      const th = Math.min(1, Math.max(0, sh.radiusThickness ?? 1));
      /**
       * ★★★ 2026-10-16（P1「ConeVolume(8) 的轴向」）：锥是**从近盘向远处张开**的截锥。
       *
       * 权威依据 —— Unity 官方 gizmo 源码 `Editor/Mono/Handles/ConeFrustrumHandle.cs` 的
       * 头注释逐字：
       *   *"'radius' is **near-radius at start of cone frustrum** (far-radius is derived from
       *     'angle' and near-radius)"*
       *   *"'angle' is cone angle from near disc of conefrustrum"*
       *   *"'range' is height of conefrustrum"*
       * 并且代码里 `farRadius = Mathf.Min(1000f, Mathf.Abs(range * Mathf.Tan(angle)) + nearRadius)`、
       * 绘制时把**小盘画在 `position`**、大盘画在 `position + forward * range` ⇒
       * **近盘（半径 = `radius`）在发射器原点、远盘（半径 = `radius + Length·tan(angle)`）
       *   在轴向 `Length` 处**，锥体沿 +Z（= 本引擎的 `emitDir`）**张开**。
       * feng3d `ParticleSystemShapeCone.ts` 同向：`bottomPos = basePos·radius·rate`（z = 0）、
       * `topPos = basePos·(radius + length·tan(angle))·rate; topPos.z = length`。
       *
       * ⚠️ 旧实现（2026-09-20 版）把"锥面半径 ∝ 沿轴距离"理解成 **`ρ ∝ t/H`**，
       *    等于把锥当成"顶点在发射器、底面在 `Length` 处"的**反向锥** ——
       *    实际是"近盘已有 `radius`、再往外张开"的截锥。两者在 `t = 0` 处差别最大
       *    （旧：半径 0 的一点；正：半径 `radius` 的整盘）。
       *    连带影响与实测见 `docx/TODO.md` §2.5 / 本轮报告（S9 `niao` 一支）。
       *
       * 体积内均匀取点：截面积 `A(t) = π·rad(t)²`、`rad(t) = R + k·t`（`k = tan(angle)`）
       * ⇒ 密度 ∝ `rad(t)²` ⇒ 反解闭式
       *     `t = ( (R³ + u·(Rf³ − R³))^(1/3) − R ) / k`
       * （`u = rand()`；`k → 0`（angle = 0，圆柱）时退化为 `t = H·u`）。
       * 该截面的半径上限 = `rad(t)`，再由 `radiusThickness` 在其支撑区间内取 ρ。
       *
       * ★ **rng 抽签顺序**（有意保持）：`t`（仅 Volume）→ `ρ` → `φ`。
       *   ⇒ **Cone(4)=Base 的抽签序列与旧实现逐位相同**（旧版也是"先 ρ 后 φ"、Base 不抽 t），
       *   且与圆盘族／兜底分支的 `ρ → φ` 顺序一致 ⇒ 三条分支在同一 `arc/thickness/radius`
       *   下产出**逐位相同**的位置（`_regress/71_` 的 [7] 钉住）。改顺序会让所有锥形系统
       *   的随机序列整体漂移（观感不变、但所有"逐位回归"断言失效）。
       */
      const angRad = Math.min(89.99, Math.max(0, sh.angle || 0)) * DEG2RAD;
      const kAx = Math.tan(angRad);
      let t = 0;
      let rhoMax = R; // 该轴向位置处截面的半径上限
      if (st === 8 && H > 0) {
        const rf = R + kAx * H;
        if (kAx > 1e-9 && rf > R) {
          const r3 = R * R * R;
          t = (Math.cbrt(r3 + r.next() * (rf * rf * rf - r3)) - R) / kAx;
        } else {
          t = H * r.next();
        }
        rhoMax = R + kAx * t;
      } else {
        // Cone（Base）：出生点只在**近盘那张圆面**上 ⇒ 沿锥轴**没有**位移。
        // （旧实现在这里写了 `t = H`，等于把 Base 当成了 Volume，属于误用 length。）
        t = 0;
        rhoMax = R;
      }
      const rho = rhoMax * (1 - th + th * Math.sqrt(r.next()));
      /**
       * 方位角 `φ`（锥的**底面内**的方位角，弧度）：`arcMode = 3` 沿弧均布、其余弧内随机。
       * 缺省 `arc` 按 360°（旧 config 不带该字段时的历史行为）。
       * ★ 2026-10-16：这里取的是**本地**方位角，`nodeRotZ` 与 `m_Rotation.z` 的旋转改由
       *   `shapeXform()` 统一施加（先缩放、再旋转，与 Unity 的 `TRS` 顺序一致）；
       *   旧写法把 `nodeRotZ` 直接折进方位角，仅在 `m_Scale` 等比时才等价。
       */
      const phi =
        sh.arcMode === 3
          ? (this.emittedInBatch / Math.max(1, this.batchCount)) *
            (sh.arc ?? 360) *
            DEG2RAD
          : r.next() * (sh.arc ?? 360) * DEG2RAD;
      const wp = shapeXform(
        Math.cos(phi) * rho,
        Math.sin(phi) * rho,
        scX,
        scY,
        rot,
        offX,
        offY
      );
      // 轴向位移沿 `emitDir`（绕 Z 的旋转不改变本地 +Z 的投影）⇒ 在变换之外单独叠加
      p.x = axX * t + wp.x;
      p.y = axY * t + wp.y;
      p.localRot = rot;

      // 发散 ∝ 距中心线的距离：`发散角 = (angle/2) · (ρ / R)`，侧向 = 该粒子方位角所在侧
      // ⚠️ 归一化仍用**近盘**半径 `R`（`docx/TODO.md` §2.6 的口径，未改）：对 ConeVolume 而言
      //    更自然的归一化是"该截面的半径"`rhoMax`，留待大更新一并定案（只影响 `startSpeed ≠ 0`
      //    的锥形系统，当前产物里仅 S9 `niao`）。
      // ★ 侧别必须在**世界角**里判：`φ` 是本地角 ⇒ 加回 `rot` 才是屏幕角
      //   （`docx/TODO.md` §2.6 的"绕 emitDir 张开"口径逐位不变；本工程三个产物的锥形
      //   `rotZ` 全为 0/缺省 ⇒ 与旧写法同值）。
      const side = Math.sin(phi + rot - dirAngle) >= 0 ? 1 : -1;
      const spread =
        (R > 1e-9 ? rho / R : 0) * ((sh.angle || 0) / 2) * DEG2RAD * side;
      const a = dirAngle + spread;
      const spd = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
    } else if (sh && sh.enabled) {
      /**
       * ⚠️ **锥形兜底**：除 0/2/5/10/12（上面各有专支）之外的**任何**启用形状都落到这里 ——
       * 按 `radius` 走"近盘圆盘 + `angle` 方向发散"，与 Cone(Base) 完全同式。
       *
       * 正确性只对 **4 Cone / 8 ConeVolume** 成立；下列形状（全包普查给出的启用支数）
       * **尚未实现**、会被当成圆盘，属**已知缺口**（`docx/TODO.md` §2.5 的后续批次）：
       *   `17 Donut`(56) / `16 BoxEdge`(73) / `15 BoxShell`(32) / `18 Rectangle`(19) /
       *   `6 Mesh`(18) / `20 SpriteRenderer`(2)。
       * 之所以不在这里顺手改路由：它们各有自己的几何（Donut 还要 `donutRadius`、
       * Rectangle/BoxEdge 要按盒体处理、Mesh/Sprite 要网格数据），须逐支取证后单独做，
       * 顺手塞进 Box/圆盘只会把一个明确的"未实现"变成"看起来像实现了"。
       */
      const R = (sh.radius || 0) * s * u;
      const th = Math.min(1, Math.max(0, sh.radiusThickness ?? 1));
      const rho = R * (1 - th + th * Math.sqrt(r.next()));
      const phi =
        sh.arcMode === 3
          ? (this.emittedInBatch / Math.max(1, this.batchCount)) *
            (sh.arc ?? 360) *
            DEG2RAD
          : r.next() * (sh.arc ?? 360) * DEG2RAD;
      const wp = shapeXform(
        Math.cos(phi) * rho,
        Math.sin(phi) * rho,
        scX,
        scY,
        rot,
        offX,
        offY
      );
      p.x = wp.x;
      p.y = wp.y;
      p.localRot = rot;
      const spd = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(dirAngle) * spd;
      p.vy = Math.sin(dirAngle) * spd;
    } else {
      const spd = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(dirAngle) * spd;
      p.vy = Math.sin(dirAngle) * spd;
    }

    /**
     * ── InheritVelocity·Initial（P2）──
     *
     * 官方：`Initial` = 发射器速度只在**粒子出生那一刻**加一次，之后发射器怎么动都与它无关。
     * 公式（feng3d）：`velocity += multiplier(t=0) × emitterVelocity`。
     *
     * ★ 只有 `simulationSpace = World` 才生效（守卫已折进 `this.ivOn`）。
     * ★ `emitterVelocity` 已是**世界单位/秒**（由 config 直接给，见 config.type.ts）。
     */
    if (this.ivOn && this.ivMode === 0) {
      const mul = lifeMul(
        c.inheritVelocity!.curve ?? { mode: 0, a: 1, b: 1 },
        0,
        p.vmix
      );
      p.vx += mul * this.ivEvX;
      p.vy += mul * this.ivEvY;
    }

    // ── RotationModule（rotationOverLifetime），弧度/秒 ──
    // ★ 传 p.vmix：rotationCurve 若为"随机两常量"，每颗粒子的自旋速度也应各自抽签
    //   （`hualizi ×2` 就是 mode=3 ⇒ 旧实现让所有花按同一角速度转）。
    // ★★ 取负号：与出生朝向同一个口径 —— Unity 的粒子自转角在屏幕上反号
    //   （见 `rotDeg` 处 2026-10-13 的说明）。`rotationEnabled=false` 的系统不受影响。
    if (c.rotationEnabled) {
      p.spin = -lifeMul(c.rotationCurve, 0, p.vmix);
    }

    /**
     * ── 丝带轨迹初始化 ──
     *
     * 步长按**点数上限反推**：`max(最小步长, 速度×trail寿命 / maxPoints)` ——
     * 保证一条轨迹记不满上限（`minVertexDistance=0.2` 配 300 prefab/s 本来要 750 个点，
     * 见 config.type.ts 的 `trail.maxPoints`）。
     *
     * 速度取**出生瞬间**的合成速度：本套 trail01 的 `startSpeed = 0`，
     * 速度**全部**来自 VelocityModule（所以在 `p.vx/vy` 之外还要加上 `vv*0` 那一项）。
     */
    if (this.trailOn) {
      const tv = c.trail!;
      let vvx0 = 0;
      let vvy0 = 0;
      if (c.velocity && c.velocity.enabled) {
        const rv0 = rotVec(
          lifeMulMix(c.velocity.x, 0, p.vmix) * s * u,
          lifeMulMix(c.velocity.y, 0, p.vmix) * s * u,
          p.localRot
        );
        vvx0 = rv0.x;
        vvy0 = rv0.y;
      }
      const spd = Math.hypot(p.vx + vvx0, p.vy + vvy0);
      p.tstep = Math.max(
        this.trailMinDist * s * u,
        (spd * this.trailLife) / this.trailMaxPts
      );
      /** 宽度与 `startSize` **同单位同缩放**（Unity：`sizeAffectsWidth=false` ⇒ 不被粒子尺寸乘） */
      p.thw = (spawnValue(tv.width, r) * s * u) / 2;
      p.lx = p.x;
      p.ly = p.y;
      p.trail = [{ x: p.x, y: p.y, t: this.systemTime }];
    }

    this.particles.push(p);
  }

  /**
   * 预热。
   *
   * Unity 的 prewarm 语义是"像已经播了一个 `lengthInSec` 那样开始"，但本套数据的
   * duration 只有 1.0 s，而 qiqiu 发射率 0.5/s、上限 7 颗 —— 1 秒连一颗都发不满，
   * 显然不是设计意图（游戏里一进来就有几颗气球在飘）。
   *
   * 所以这里改成**模拟到稳态**：固定步长跑到粒子数达到 maxNumParticles，
   * 或时间超过 min(30s, 2×最长寿命)。好处是确定性，且粒子的位置/速度都是
   * 真实演化出来的（不像"随机给个初始寿命"那样凭空造）。
   * ⚠️ 与 Unity 的确切 prewarm 实现有差异，如实标注。
   */
  private prewarm(): void {
    const c = this.cfg;
    const cap = c.maxNumParticles;
    const maxLife = Math.max(
      // prewarm 只用来估"预演多久"，取上界即可 ⇒ mix = 1（落在 max 侧）
      lifeMul(c.startLifetime, 1, 1) || c.startLifetime.a,
      c.startLifetime.b || 0
    );
    const limit = Math.min(
      PREWARM_MAX_SEC,
      Math.max(2 * Math.max(1, maxLife), 2)
    );
    let t = 0;
    while (this.particles.length < cap && t < limit) {
      this.step(PREWARM_DT);
      t += PREWARM_DT;
    }
    // 预热只为"开场就有料"，不该把摩天轮提前转过去
    this.groupAngle = 0;
  }

  /* ── 每帧推进 ────────────────────────────────────────────────────────── */

  private step(dt: number): void {
    const c = this.cfg;
    const r = this.rng;

    /**
     * `autoplay: false` 且尚未被触发 ⇒ **整段不发**（连 `systemTime` 都不推进）。
     * 这样"第一次触发"一定从 t=0 开始，不会因为页面已经开了几分钟而错过 burst。
     * 缺省 `started = true` ⇒ 老 config 完全不受影响。
     */
    if (!this.started) {
      return;
    }

    // ── 1) 系统时间 + burst ──
    const prevSystemTime = this.systemTime;
    this.systemTime += dt;
    const cycle = Math.max(0.01, c.cycleSec);
    /**
     * `startDelay`（直读自 typetree 顶层，与 `lengthInSec` 同级）：
     * 系统每周期延后 `delay` 秒才发射。本套只有 **star = 0.9 s** 非零 ——
     * 这正是"扫光消失时星星出现"的机制（saoguang 存活 [0,1.5]、star [0.9,2.9]，
     * 重叠 0.6 s 人眼读作"先后"）。
     *
     * 实现口径：把发射相关的系统时钟整体后移 `delay`（Unity 里 InitialModule 的
     * startDelay 就是"发射前先等这么久"）。只影响**发射**，不推进已有粒子。
     */
    const delay = Number.isFinite(c.startDelay) ? Math.max(0, c.startDelay) : 0;
    const emitTime = this.systemTime - delay;
    const prevEmitTime = prevSystemTime - delay;
    /**
     * ★★ `looping === false`（2026-10-14）：发射窗口收口到**第 0 个周期**
     *   `[delay, delay + cycle)` —— 与 Unity「Looping 关闭 ⇒ 播一个 duration 就停」一致。
     *   缺省 `true` ⇒ `lastCycle = Infinity`，走原逻辑、老 config 零影响。
     */
    const lastCycle = this.looping ? Infinity : 0;
    const prevCycle = Math.floor(prevEmitTime / cycle);
    const nowCycle = Math.min(Math.floor(emitTime / cycle), lastCycle);
    for (let cy = prevCycle; cy <= nowCycle; cy++) {
      if (emitTime < 0) {
        break; // 还在 startDelay 内，一次都不发
      }
      const base = cy * cycle;
      const lo = cy === prevCycle ? prevEmitTime - base : 0;
      const hi = emitTime - base;
      for (let bi = 0; bi < c.emission.bursts.length; bi++) {
        const b = c.emission.bursts[bi];
        if (b.time < lo || b.time > hi) {
          continue;
        }
        const key = cy + ':' + bi;
        if (this.burstFired[key]) {
          continue;
        }
        this.burstFired[key] = true;
        const n = Math.max(0, Math.round(spawnValue(b.count, r)));
        this.batchCount = n;
        for (let i = 0; i < n; i++) {
          if (this.particles.length >= c.maxNumParticles) {
            break;
          }
          this.emittedInBatch = i;
          this.spawn();
        }
      }
    }
    if (nowCycle > 64) {
      // 周期表不必无限增长
      const keep: { [key: string]: boolean } = {};
      Object.keys(this.burstFired).forEach((k) => {
        if (parseInt(k.split(':')[0], 10) > nowCycle - 4) {
          keep[k] = true;
        }
      });
      this.burstFired = keep;
    }

    // ── 2) 连续发射 rateOverTime ──
    // ★ 发射窗口与 burst 同一口径：`[startDelay, startDelay + cycle)`，
    //   `looping === false` 时还要 ≤ 第 0 个周期末尾（见上方 `lastCycle`）。
    //   ⚠️ 补上 `emitTime >= 0` 这一半是顺带修的一个不一致：本工程 11 个背景系统
    //      `startDelay` 全为 0 ⇒ 逐位无影响；旧实现里"rate 不看 delay、burst 看 delay"
    //      会让带 startDelay 的系统在延时期间照样连续发射。
    const emitOpen =
      emitTime >= 0 && emitTime < (this.looping ? Infinity : cycle);
    const rate = lifeMul(c.emission.rateOverTime, 0);
    if (rate > 0 && emitOpen) {
      this.emitAcc += rate * dt;
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        if (this.particles.length >= c.maxNumParticles) {
          this.emitAcc = 0;
          break;
        }
        this.batchCount = 1;
        this.emittedInBatch = 0;
        this.spawn();
      }
    }

    // ── 3) 整组自转（摩天轮轮毂）──
    if (c.groupRotation) {
      this.groupAngle += c.groupRotation.degPerSec * DEG2RAD * dt;
    }

    // ── 4) 逐粒子推进（模块顺序与 Unity 一致）──
    const u = c.unitScale;
    const s = c.localScale;
    const nv = this.noiseVec;
    const alive: Particle[] = [];
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        continue; // 消亡；Unity 里不会原地复活，等下一次发射
      }
      const pr = p.age / p.life;

      /**
       * 4.1 VelocityModule：给粒子**额外**叠加一个速度（不并进 p.vx，
       *     否则每帧累加会变成加速）。曲线给出单位时间的位移量，scalar 是倍率。
       */
      let vvx = 0;
      let vvy = 0;
      let vvz = 0;
      if (c.velocity && c.velocity.enabled) {
        /**
         * ★ `rotVec(..., p.localRot)`：`VelocityModule` 的 x/y 是**发射器本地坐标**
         *   下的速度（Simulation Space = Local），盒形系统若节点带旋角
         *   （`hudie01 ×3` = 30.69°）必须转回世界，否则蝴蝶会朝正右飞。
         *   `localRot === 0` 时 `rotVec` 直接原样返回 ⇒ 锥形/圆形系统零开销零变化。
         *
         * ★ P2：`space === 1`(World) ⇒ **不**做这个折算（官方 "Specifies whether the
         *   Linear X, Y, Z axes refer to local or world space"）。缺省 0 = Local = 现状。
         */
        const rv = rotVec(
          lifeMulMix(c.velocity.x, pr, p.vmix) * s * u,
          lifeMulMix(c.velocity.y, pr, p.vmix) * s * u,
          this.volWorld ? 0 : p.localRot
        );
        vvx = rv.x;
        vvy = rv.y;
        /**
         * ★ `z` 轴线性速度（P2）：2D 里**不产生屏幕位移**，只进入下面的 `p.spd`
         *   （进而影响 ColorBySpeed / SizeBySpeed / RotationBySpeed 的取样）。
         */
        if (this.volZOn) {
          vvz = lifeMulMix(c.velocity.z!, pr, p.vmix) * s * u;
        }
      }

      /**
       * 4.2 NoiseModule：**速度增量**（"值越高，粒子移动得越快越远"）。
       * 采样坐标在系统本地未缩放空间：prefab 坐标先除回 localScale 再乘 frequency。
       * quality=High 是 3D 噪声 → z 取 0，用 x/y 分量（2D 场景即如此）。
       * damping=true → 有效强度 = strength × frequency。
       *
       * ★ P4 新增三件事（**全部缺省与 P4 之前逐位一致**，见 `_regress/74_`）：
       *   · `octaves > 1` ⇒ 势场叠层（`curl3` 逐层累加，每层步长随频率自适应）；
       *   · `scrollSpeed` ⇒ 采样点加"系统时间 × 速度"的偏移（Cocos 同式）；
       *   · `rotationAmount` ⇒ 用场里的 z 分量产生自转（度/秒），并把 z 写回
       *     `p.nzS` 供 `buildGeometry` 做 `sizeAmount` 的尺寸调制。
       */
      if (c.noise && c.noise.enabled) {
        const freq = c.noise.frequency;
        const q = freq / (s * u);
        /**
         * 采样坐标（**频率缩放前**的粒子本地空间）。`nzScrollOn === false` ⇒ 走下面那支
         * **原式**（`p.x × q`），连浮点结合顺序都不动 ⇒ 逐位等于 P4 之前。
         */
        let sx = 0;
        let sy = 0;
        let sz = 0;
        if (this.nzScrollOn) {
          /**
           * ★ 偏移加在**频率缩放之前**的粒子空间里（Cocos `getNoiseParticle`：
           *   `getNoise(point.z + accSpeed.x, …)`、`accSpeed = speed × 系统时间`）
           *   ⇒ 等价写法 `(粒子本地坐标 + 偏移) × frequency`。
           */
          const off =
            lifeMulMix(c.noise.scrollSpeed!, pr, p.vmix) * this.systemTime;
          sx = (p.x / (s * u) + off) * freq;
          sy = (p.y / (s * u) + off) * freq;
          sz = off * freq;
          curl3(sx, sy, sz, nv, this.nzOct, this.nzOctMul, this.nzOctScale);
        } else {
          sx = p.x * q;
          sy = p.y * q;
          curl3(sx, sy, 0, nv, this.nzOct, this.nzOctMul, this.nzOctScale);
        }
        if (this.nzSep) {
          /** `separateAxes`：官方 *"Control the strength … independently on each axis."* */
          const k = c.noise.positionAmount * c.noise.gain * s * u * dt;
          p.vx += nv.x * this.nzEffX * k;
          p.vy += nv.y * this.nzEffY * k;
        } else {
          /** 缺省支：**与 P4 之前一字不差**（`nzEffX` 此时恰等于原来的 `eff`） */
          const acc =
            this.nzEffX * c.noise.positionAmount * c.noise.gain * s * u * dt;
          p.vx += nv.x * acc;
          p.vy += nv.y * acc;
        }
        /**
         * `rotationAmount`（官方手册逐字 *"A multiplier to control how much the noise
         * affects particle rotations, **in degrees per second**."*）。
         * 取值源 = curl 场的 **z 分量**（2D 渲染本就丢弃它，不与可见位移相关）；
         * 取负号：与 `rotationCurve` / `rotationBySpeed` 同一个"屏幕自转反号"口径。
         */
        if (this.nzRotOn) {
          p.nzRot = nv.z;
          const rAmt = lifeMulMix(c.noise.rotationAmount!, pr, p.vmix);
          p.rot -= nv.z * this.nzEffX * rAmt * DEG2RAD * dt;
        }
        /**
         * `sizeAmount` 的调制源 = **第 4 路标量场**（见 `noiseScalar`）。
         * ★ 只有真的要调制尺寸时才多花这 1 次 Perlin 采样。
         */
        if (this.nzSizeOn) {
          p.nzS = noiseScalar(
            sx,
            sy,
            sz,
            this.nzOct,
            this.nzOctMul,
            this.nzOctScale
          );
        }
      }

      /**
       * 4.25 GravityModifier（`InitialModule.gravityModifier`）。
       *
       * Unity 语义 = 缩放 `Physics.gravity`（默认 (0, −9.81, 0)）；本工程只有 `huaban (1)`
       * 是非 0（0.05），折算到世界坐标约 −15.2 单位/s² 向下。
       * 用半隐式欧拉（先累速度、再积分位置），与 Unity 内部的积分顺序一致。
       * ★ `gravAccY === 0` ⇒ 整段短路，其余系统逐位不变。
       */
      if (this.gravAccY !== 0) {
        p.gvy += this.gravAccY * dt;
      }

      /**
       * 4.26 ForceModule（Force over Lifetime，P2）—— **加速度**（官方："Particles can be
       * accelerated by forces"），质量按 1 处理 ⇒ `Δv = a·dt`，与重力同为半隐式欧拉。
       *
       * 折算：`× localScale × unitScale`（`scalingMode = Hierarchy`，与 `velocity` 同口径）；
       * `space = Local`（缺省）⇒ 再按节点旋角 `p.localRot` 转到世界。
       * ★ `enabled: false` / 字段缺省 ⇒ 整段短路。
       */
      if (this.folOn) {
        const fo = c.force!;
        const fax = lifeMulMix(fo.x, pr, p.vmix) * s * u;
        const fay = lifeMulMix(fo.y, pr, p.vmix) * s * u;
        const rf = this.folWorld ? null : rotVec(fax, fay, p.localRot);
        p.vx += (rf ? rf.x : fax) * dt;
        p.vy += (rf ? rf.y : fay) * dt;
        if (fo.z) {
          p.vz += lifeMulMix(fo.z, pr, p.vmix) * s * u * dt;
        }
      }

      /** 4.27 本帧总速度大小（P2，供三个 by-speed 模块取 `rate`） */
      p.spd = Math.sqrt(
        (p.vx + vvx) * (p.vx + vvx) +
          (p.vy + vvy + p.gvy) * (p.vy + vvy + p.gvy) +
          (p.vz + vvz) * (p.vz + vvz)
      );

      // 4.3 积分位置：先改速度、再积分（与 Unity 的模块顺序一致）
      p.x += (p.vx + vvx) * dt;
      p.y += (p.vy + vvy + p.gvy) * dt;
      p.z += (p.vz + vvz) * dt;

      /**
       * 4.28 轨道 / 径向（P2，`VelocityModule.orbitalX/Y/Z` + `radial` + `orbitalOffset*`）。
       *
       * 依据：Unity 手册 *"Orbital X, Y, Z — Orbital velocity of particles around the X, Y
       * and Z axes"* / *"Offset — The position of the center of orbit"* / *"Radial — Radial
       * velocity of particles away from/towards the center position"*；
       * 具体算法（**旋转的是位置、且绕 offset 中心**）照 galacean `ParticleFeedback.shader`
       * PR #3049 的 `rotationByEuler(rel, orbital·dt)` 与 `rel += normalize(rel)·radial·dt`。
       *
       * ⚠️ 已知分歧（如实标注，暂未采纳）：galacean 经 review 后把 gravity / FOL / drag /
       *    noise 的位移**排除**在轨道旋转之外（只转"startVelocity + VOL linear"那一份），
       *   理由是那些是独立的世界/外场力、不该被这一帧的公转扫着转。
       *   本实现**整段位置一起绕中心转**（更简单自洽）。两者只在"轨道与外力同时非零"时
       *   才有差别，本工程现有产物 orbital / radial 全为 0 ⇒ 当前无观感差异。
       */
      if (this.orbOn || this.radOn) {
        let rx = p.x - this.orbOx;
        let ry = p.y - this.orbOy;
        let rz = p.z - this.orbOz;
        if (this.radOn) {
          const L = Math.sqrt(rx * rx + ry * ry + rz * rz);
          if (L > 1e-5) {
            const k =
              (lifeMulMix(c.velocity!.radial!, pr, p.vmix) * s * u * dt) / L;
            rx += rx * k;
            ry += ry * k;
            rz += rz * k;
          }
        }
        if (this.orbOn) {
          const vo = c.velocity!;
          const w = rotEuler3(
            rx,
            ry,
            rz,
            vo.orbitalX ? lifeMulMix(vo.orbitalX, pr, p.vmix) * dt : 0,
            vo.orbitalY ? lifeMulMix(vo.orbitalY, pr, p.vmix) * dt : 0,
            vo.orbitalZ ? lifeMulMix(vo.orbitalZ, pr, p.vmix) * dt : 0
          );
          rx = w[0];
          ry = w[1];
          rz = w[2];
        }
        p.x = this.orbOx + rx;
        p.y = this.orbOy + ry;
        p.z = this.orbOz + rz;
      }

      /**
       * 4.29 InheritVelocity·Current（P2）：`Current` = 每帧把**发射器本帧的位移**
       * 按倍率加给粒子（官方："if the emitter slows down, all particles will also slow
       * down"）。`emitterVelocity` 是世界单位/秒 ⇒ 乘 `dt` 得本帧位移。
       */
      if (this.ivOn && this.ivMode === 1) {
        const mul = lifeMul(
          c.inheritVelocity!.curve ?? { mode: 0, a: 1, b: 1 },
          pr,
          p.vmix
        );
        p.x += mul * this.ivEvX * dt;
        p.y += mul * this.ivEvY * dt;
      }

      /**
       * 4.4 ClampVelocityModule（Limit Velocity Over Lifetime）。
       *
       * ★★ 2026-09-19 已按游戏实录更正（原来的"每秒收敛"是错的）★★
       * 证据：实录 4000×2160 里 niao 飞鸟 11 秒寿命全程贴着限速飞（实测
       * 34 仿制 px/s = 21.9 prefab/s，正好落在 magnitude 0.7~1.0×30 = 21~30 区间），
       * 而初速是 120~240 prefab/s —— 说明游戏在**约 1 秒内**就把速度拉到限速。
       *   按"每秒收敛"(dampen×dt)：11 秒只降 36% → 鸟全程 ~150 prefab/s ✗ 与实录差 6.9 倍
       *   按"每帧收敛"(1-dampen)^n：60fps 下 1 秒降到 8.6%、3 秒基本到位 ✓
       * 故取每帧口径，并折算成**帧率无关**的指数收敛（60fps 等价速率 = 60·dampen）：
       *   alpha = 1 - exp(-60·dampen·dt)
       * 这样在任意帧率下都与"游戏 60fps"表现一致。
       */
      if (c.clamp.enabled && p.clampLimit > 0) {
        const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (sp > p.clampLimit && sp > 1e-6) {
          const alpha = 1 - Math.exp(-60 * c.clamp.dampen * dt);
          const f = (sp + (p.clampLimit - sp) * alpha) / sp;
          p.vx *= f;
          p.vy *= f;
        }
      }

      /**
       * 4.5 自旋 = `rotationOverLifetime`（出生时定）**+** `rotationBySpeed`（P2，每帧按
       *     当前速度取）。两者都是**弧度/秒**，直接相加。
       *
       * ★★ `rotationBySpeed` 同样**取负号**：与 `rotationCurve` 同一个口径 ——
       *   Unity 的粒子自转角在屏幕上反号（见 `spawn()` 里 `rotDeg` 处 2026-10-13 的说明）。
       * ⚠️ 序列化里主曲线 `curve` 是 **z 轴**（`x`/`y` 是另外两轴，2D 下用不上）
       *   —— 默认常量 0.7854 = π/4 与 feng3d 的默认值逐位吻合，互为佐证。
       */
      let spin = p.spin;
      if (this.rbsOn) {
        spin -= lifeMulMix(
          c.rotationBySpeed!.curve,
          speedRate(p.spd, this.rbsR0, this.rbsR1),
          p.vmix
        );
      }
      if (spin !== 0) {
        p.rot += spin * dt;
      }

      /**
       * 4.6 丝带轨迹：在**位置积分之后**记点（记的是粒子真实走过的地方）。
       *
       * · 记点判据 = 位移 ≥ `tstep`（Unity 的 `minVertexDistance` 语义）；
       * · 淘汰判据 = 点龄 > `trail.lifetime` —— 这才是"丝带有多长"的决定因素
       *   （不是粒子的 `startLifetime`：粒子活 8~10s，丝带只有 0.5s）；
       * · 头端**不**记在这里：渲染时取粒子当前坐标（见 `buildGeometry`）。
       */
      if (this.trailOn) {
        const tp = p.trail;
        const dx = p.x - p.lx;
        const dy = p.y - p.ly;
        if (dx * dx + dy * dy >= p.tstep * p.tstep) {
          tp.unshift({ x: p.x, y: p.y, t: this.systemTime });
          p.lx = p.x;
          p.ly = p.y;
        }
        const cut = this.systemTime - this.trailLife;
        while (tp.length > 0 && tp[tp.length - 1].t < cut) {
          tp.pop();
        }
        while (tp.length > this.trailMaxPts) {
          tp.pop();
        }
      }

      alive.push(p);
    }
    this.particles = alive;
  }

  public update = (delta: number): void => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.step(dt);
    this.buildGeometry();
  };

  /* ── 几何体刷新 ─────────────────────────────────────────────────────── */

  private buildGeometry(): void {
    const c = this.cfg;
    /**
     * `min/maxParticleSize` 换算所需的**视口高的世界尺寸** = `2·|z|·tan(fov/2)`。
     * 每帧算一次（相机 `fov` 会随窗口比例变化，见 `initScene` 的 `onWindowResize`），
     * 且**只在真的要钳制时**才算 —— 缺省（不声明 `maxParticleSize`）零开销。
     */
    if (this.rMaxSize > 0) {
      const cam = Scene.camera;
      /** 相机缺席（无头验收 / 单测）时用 Unity 的缺省 fov = 60°，而不是让视口高塌成 0 */
      const fov = cam && isFinite(cam.fov) && cam.fov > 0 ? cam.fov : 60;
      const tanHalf = Math.tan((fov * Math.PI) / 360);
      const dz = Math.abs((cam ? cam.position.z : 0) - this.mesh.position.z);
      this.rViewportH = 2 * dz * tanHalf;
    }
    const pos = this.posAttr.array as Float32Array;
    const uvs = this.uvTexAttr.array as Float32Array;
    const muvs = this.uvMaskAttr.array as Float32Array;
    const als = this.alphaAttr.array as Float32Array;
    /** 逐粒子 startColor（4 float/顶点）——见 startColAttr 的说明 */
    const scs = this.startColAttr.array as Float32Array;

    const tilesX = c.uv.enabled ? Math.max(1, c.uv.tilesX) : 1;
    const tilesY = c.uv.enabled ? Math.max(1, c.uv.tilesY) : 1;
    const total = tilesX * tilesY;
    const cycles = c.uv.enabled ? Math.max(1, c.uv.cycles) : 1;
    const fw = 1 / tilesX;
    const fh = 1 / tilesY;

    /**
     * `_UV_t` 的连续平移（`texUV += _UV_t.xy × (_Time.y + _TimeEditor.y)`，
     * `_TimeEditor.y` 按 0 处理）。实测只有 yun 非零（x = −0.008）。
     * 用**系统时间**而非"粒子年龄"：材质属性是全局时钟驱动的，与粒子寿命无关。
     */
    const driftX = Number.isFinite(c.uv.driftX) ? c.uv.driftX : 0;
    const driftY = Number.isFinite(c.uv.driftY) ? c.uv.driftY : 0;
    const driftU = driftX * this.systemTime;
    const driftV = driftY * this.systemTime;

    /**
     * `CustomDataModule` → `in_TEXCOORD1` 的 UV 平移量（"扫光扫过去"的真身）。
     * 公式（规格 §4）：`Custom1.x(u) = scalar × lerp(+1, −1, u)`，`u` = **归一化寿命**。
     * 代入本套数据：起点 `0.3×(1 + (−2.009321)(0 − 0.004639)) = +0.302796`、
     * 终点 `0.3×(−1) = −0.300000` ⇒ 总行程 **0.602796 UV / 1.5 s = 0.4019 UV/s**。
     *
     * ⚠️ 它**只加在 `_Texture`** 上：`texUV = _offon·in_TEXCOORD1 + in_TEXCOORD0`，
     * 而 `maskUV = in_TEXCOORD0`（`_UV_t.zw = 0`、`_mask_offon = 0`）⇒ 遮罩静止。
     * 这正是"固定平行四边形遮罩内、斜渐变带滑进滑出"的机制。
     */
    const cd = c.customData;
    const cdOn = !!(cd && cd.enabled && cd.offon !== 0);

    // 整组自转（摩天轮轮毂）
    const gr = c.groupRotation;
    const gAng = gr ? this.groupAngle : 0;
    const gCos = Math.cos(gAng);
    const gSin = Math.sin(gAng);
    const px0 = gr ? gr.pivotX : 0;
    const py0 = gr ? gr.pivotY : 0;
    const useSize = !!(c.sizeModule && c.sizeModule.enabled);
    const alKeys = c.colorModule ? c.colorModule.alphaKeys : [];
    /**
     * ★ `TwoGradients` 的 min 侧（逐粒子在两条之间 lerp）。
     * 缺省（旧 config）⇒ `undefined` ⇒ `alphaAt` 直接返回 `alKeys` 的值，逐位一致。
     */
    const alKeysMin =
      c.colorModule && c.colorModule.alphaMix
        ? c.colorModule.alphaKeysMin
        : undefined;

    let n = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // 本帧默认"未参与渲染"（见 Particle.uvFrame）；uv 段会写回真实帧号。
      // ★ 放在这里而不是 uv 段里：下面两个 `continue`（尺寸/alpha 过小）会跳过 uv 段，
      //   若默认值写在 uv 段内，被跳过的粒子会**留着上一帧的帧号**，
      //   快照里就会读到一颗已经不该渲染的粒子上的陈旧值。
      p.uvFrame = -1;
      const pr = p.age / p.life;
      // ★ 传 p.vmix：sizeModule 若为"随机两常量"，各粒子抽自己的尺寸倍率
      let sm = useSize ? lifeMul(c.sizeModule.curve, pr, p.vmix) : 1;
      let smY = sm;
      /**
       * ── SizeBySpeedModule（P2）：**倍率**乘在 `sizeOverLifetime` 之外 ──
       *
       * `rate = clamp((|v| − range[0]) / (range[1] − range[0]), 0, 1)`（见 `speedRate`）；
       * `!separateAxes` ⇒ `y = z = x`（等比，feng3d 同口径）；
       * 分轴时才另取 `y`（序列化里 `curve` 是 **x 轴**，`y` / `z` 另列）。
       */
      if (this.sbsOn) {
        const rr = speedRate(p.spd, this.sbsR0, this.sbsR1);
        const kx = lifeMulMix(c.sizeBySpeed!.curve, rr, p.vmix);
        sm *= kx;
        smY *=
          this.sbsSep && c.sizeBySpeed!.y
            ? lifeMulMix(c.sizeBySpeed!.y, rr, p.vmix)
            : kx;
      }
      /**
       * ── P4 · `NoiseModule.sizeAmount`（官方手册逐字：*"A multiplier to control how much
       *    the noise affects particle **sizes**."*）──
       *
       * `尺寸乘子 = 1 + 标量噪声 × 有效强度 × sizeAmount(寿命曲线) × gain`
       *   · **标量噪声** = `p.nzS`（第 4 路势场，Perlin 天然有界 ⇒ 见 `noiseScalar`）；
       *   · `有效强度` = `strength`（`damping` 时再乘 `frequency`），与位置推力**同一个**
       *     强度口径；`gain` 沿用位置那一支的校准旋钮。
       * 缺省（`sizeAmount` 未声明）⇒ **整段短路** ⇒ 尺寸逐位等于 P4 之前。
       * ⚠️ 绝对量级是**本项目口径**（Unity 未公开），如实标注为存疑项；
       *   乘子下界钳在 0（不让尺寸取负），上界不钳。
       */
      if (this.nzSizeOn) {
        const sa = lifeMulMix(c.noise!.sizeAmount!, pr, p.vmix);
        const mul = 1 + p.nzS * this.nzEffX * sa * c.noise!.gain;
        const kk = mul > 0 ? mul : 0;
        sm *= kk;
        smY *= kk;
      }
      const hw = (p.sizeX * sm) / 2;
      const hh = (p.sizeY * smY) / 2;

      /**
       * ── ColorBySpeedModule（P2）：**逐通道乘进** `startColor`（含 alpha）──
       *
       * 与 SizeBySpeed 同一个 `rate`；`startColor` 之外的这一层是**每帧按速度重取**的，
       * 所以不能像 `p.sc` 那样出生定死 —— 在这里现算。
       * `mode = 3`(TwoGradients) 时按 `p.vmix` 在 max↔min 两条梯度间 lerp（与
       * `startColorGradient` 同口径）。
       */
      let cr = p.sc[0];
      let cg = p.sc[1];
      let cb = p.sc[2];
      let ca = p.sc[3];
      if (this.cbsOn) {
        const bs = c.colorBySpeed!;
        const u01 = speedRate(p.spd, this.cbsR0, this.cbsR1);
        const hi = sampleGradient(bs.colorKeys, bs.alphaKeys, u01);
        let mr = hi[0];
        let mg = hi[1];
        let mb = hi[2];
        let ma = hi[3];
        if (bs.mode === 3 && bs.minAlphaKeys && bs.minAlphaKeys.length) {
          const lo = sampleGradient(bs.minColorKeys, bs.minAlphaKeys, u01);
          mr += (lo[0] - mr) * p.vmix;
          mg += (lo[1] - mg) * p.vmix;
          mb += (lo[2] - mb) * p.vmix;
          ma += (lo[3] - ma) * p.vmix;
        }
        cr *= mr;
        cg *= mg;
        cb *= mb;
        ca *= ma;
      }
      /**
       * ★ 丝带粒子的 `startSize = 0` 是**正常值**（宽度来自 `widthOverTrail`，不是粒子尺寸），
       *   所以 quad 的尺寸守卫对它们必须**放行** —— 否则 `hw = 0` 会把整条效果静默跳过。
       */
      const useTrail = this.trailOn && p.trail.length >= 1;
      if (!useTrail && (hw <= 0.01 || hh <= 0.01)) {
        continue;
      }
      const al = alphaAt(alKeys, pr, alKeysMin, p.vmix);
      if (al <= 0.003) {
        continue;
      }

      /**
       * ── 丝带（Ribbon）分支 ────────────────────────────────────────────────
       *
       * 折线 = `[粒子当前位置, ...轨迹点]`。头端取**实时坐标**而不是最后一个记录点，
       * 否则丝带会比粒子滞后一个 `tstep`，看起来"脱节"。
       *
       * 每段两个三角形（6 个**独立**顶点 —— 本引擎不建索引缓冲，与 quad 同一套约定），
       * 带宽方向取线段方向的垂线，半宽 = `p.thw`。
       *
       * alpha 三因子相乘（对应 Unity 的 `inheritParticleColor=true`）：
       *   粒子自身 alpha × `colorOverTrail`(沿带位置) × `colorOverLifetime`(点龄)。
       * UV：`textureMode=0 (Stretch)` ⇒ u 沿带 0→1、v 跨带 0/1。
       */
      if (useTrail) {
        const tp = p.trail;
        const m = tp.length;
        let prevX = p.x;
        let prevY = p.y;
        let prevA =
          al * alphaAt(this.trailTrailA, 0) * alphaAt(this.trailLifeA, 0);
        for (let k = 0; k < m; k++) {
          const q = tp[k];
          let dx = q.x - prevX;
          let dy = q.y - prevY;
          const L = Math.hypot(dx, dy);
          if (L < 1e-6) {
            continue;
          }
          dx /= L;
          dy /= L;
          const nx = -dy * p.thw;
          const ny = dx * p.thw;
          const tPos = (k + 1) / m;
          const tAge = Math.min(
            1,
            Math.max(0, (this.systemTime - q.t) / this.trailLife)
          );
          const curA =
            al *
            alphaAt(this.trailTrailA, tPos) *
            alphaAt(this.trailLifeA, tAge);
          const uA = this.trailStretch ? k / m : 0;
          const uB = this.trailStretch ? (k + 1) / m : 1;
          const ax = prevX + nx;
          const ay = prevY + ny;
          const bx = prevX - nx;
          const by = prevY - ny;
          const cx2 = q.x + nx;
          const cy2 = q.y + ny;
          const dx2 = q.x - nx;
          const dy2 = q.y - ny;
          // 顶点：[x, y, u, v, alpha]；两组三角形 a-b-d / a-d-c
          const tri = [
            [ax, ay, uA, 0, prevA],
            [bx, by, uA, 1, prevA],
            [dx2, dy2, uB, 1, curA],
            [ax, ay, uA, 0, prevA],
            [dx2, dy2, uB, 1, curA],
            [cx2, cy2, uB, 0, curA],
          ];
          for (let t2 = 0; t2 < 6; t2++) {
            const v = tri[t2];
            pos[n * 3 + 0] = v[0];
            pos[n * 3 + 1] = v[1];
            pos[n * 3 + 2] = 0;
            uvs[n * 2 + 0] = v[2];
            uvs[n * 2 + 1] = v[3];
            muvs[n * 2 + 0] = v[2];
            muvs[n * 2 + 1] = v[3];
            als[n] = v[4];
            // ★ 丝带分支同样要写 startColor（否则 attribute 留在 0 ⇒ 整条丝带全黑）
            scs[n * 4 + 0] = cr;
            scs[n * 4 + 1] = cg;
            scs[n * 4 + 2] = cb;
            scs[n * 4 + 3] = ca;
            n++;
          }
          prevX = q.x;
          prevY = q.y;
          prevA = curA;
        }
        continue; // 丝带粒子不再画 quad
      }

      /**
       * UV：Unity 的公式是 `frame = startFrame + frameOverTime(t) × cycles × 帧数`，
       * 再对帧数**取模回绕** —— 不能像 08 那样 clamp 到最后一帧：那会让序列在前
       * 1/cycles 的寿命里播完、之后冻住不动。
       *
       * ★ `frameOverTime` 是否随寿命变，**由它的 mode 决定**（见 config.type.ts 同名注释）：
       *   · 曲线 ⇒ 由 `curveOf()` 求值（**含端点外推**，见 `curveAt`）；`niao` 由此在寿命内播 5 遍 8 帧；
       *   · 常量 / 随机两常量 ⇒ 用出生时定的 `p.uvFrameOver`；`qiqiu` 由此终生固定黄或粉。
       *
       * ★★ 2026-10-13：`curveOf()` 取代了原来的 `foMM.a * keysAt(uvOverKeys, pr)`。
       *   差别就在**端点外推**：`hudie01 ×3` 的 `frameOverTime` 末键在 t=0.0826 且
       *   `m_PostInfinity = 1(Linear)`，旧写法钳在末帧 ⇒ 蝴蝶扇一次就定住（用户的原始报障）。
       *
       * ══ P4：三档 `timeMode` + 两档 `animationType`（缺省 ⇒ 下面第一支，逐位不变）══
       *   · `timeMode = 0 Lifetime`（缺省）⇒ 上式（按归一化寿命取 `frameOverTime` 曲线）；
       *   · `timeMode = 1 Speed` ⇒ **按当前速度静态选帧**（官方 ScriptReference 逐字注释见
       *     `config.type.ts` 的 `speedRange`）；`frameOverTime` / `cycles` 官方 UI 会隐藏 ⇒ 不消费；
       *   · `timeMode = 2 FPS` ⇒ `startFrame + ⌊粒子年龄 × fps⌋`（与寿命/速度无关）。
       *   · `animationType = 1 Single Row` ⇒ 帧数 = `tilesX`（一行），行号取 `p.uvRow`。
       */
      let u0 = 0;
      let v0 = 0;
      let u1 = 1;
      let v1 = 1;
      if (c.uv.enabled && total > 1) {
        /**
         * 该档下"一帧序列"的总帧数：
         * WholeSheet ⇒ 整表 `tilesX × tilesY`；SingleRow ⇒ 只有一行 `tilesX` 帧。
         * `uvSingleRow = false` ⇒ `nF === total`（**同一个变量**，不是另算一遍）。
         */
        const nF = this.uvSingleRow ? tilesX : total;
        /**
         * `startFrame`（**帧号**，不是归一化值）：
         * 复用 `lifeMulMix` ⇒ 曲线随寿命、随机两常量按 `p.vmix` 逐粒子抽
         * （**不额外消耗 rng**）。缺省 `null` ⇒ 0 ⇒ `0 + x` 与旧式**逐位相同**。
         */
        const sf = this.uvStart ? lifeMulMix(this.uvStart, pr, p.vmix) : 0;
        let fi: number;
        if (this.uvTimeMode === 2) {
          /** FPS：`⌊年龄 × fps⌋` 帧，加起始帧后对帧数回绕（与寿命、速度都无关） */
          fi = modPos(Math.floor(sf + p.age * this.uvFps), nF);
        } else if (this.uvTimeMode === 1) {
          /** Speed：静态选帧 —— 慢于下界取首帧、快于上界取末帧、其间按比例取（逐字见 config） */
          const rate = speedRate(p.spd, this.uvSpdR0, this.uvSpdR1);
          const f = Math.round(sf + rate * (nF - 1));
          fi = f < 0 ? 0 : f > nF - 1 ? nF - 1 : f;
        } else {
          const foMM = c.uv.frameOverTime;
          const cv = foMM ? curveOf(foMM, pr) : null;
          const over = !foMM
            ? pr // 兼容不带该字段的旧 config：等价于曲线 0→1（= 旧行为）
            : cv !== null
            ? cv
            : p.uvFrameOver;
          fi = ((Math.floor(sf + over * cycles * nF) % nF) + nF) % nF;
        }
        // 写回真值：快照读的就是这里算出来的帧号，验收脚本无需重抄公式
        p.uvFrame = fi;
        /**
         * ★★ **行序必须自上而下**（2026-10-13，实测更正）：
         *   Unity 的 Whole Sheet 帧序是「左→右、**上→下**」（官方 Manual 逐字：
         *   "Will draw the animation over the whole sheet, left to right, top to bottom"），
         *   即 `fi = 0` 在**最上面一行**。
         *   而纹理经 `THREE.TextureLoader` 上传时走默认 `flipY = true`
         *   ⇒ 纹理坐标 `v = 0` 对应**图像最下面一行**。
         *   旧写法 `v0 = floor(fi/tilesX)*fh` 把 `fi = 0` 放到了**底行** ⇒ 行序整体倒过来：
         *   4 行图集会播成 12..15 → 8..11 → 4..7 → 0..3，每过一行跳一次（帧号虽在推进但顺序错）。
         *
         *   判据（决定性实验，`33_校验v方向.py`）：合成一张"每格唯一纯色"的 4×4 图集，
         *   让每颗粒子随机取一格，再从快照读它自己的 `uvFrame`、采样它所在像素的颜色反推格号 ——
         *   修前 **14/16 个样本命中"垂直镜像"**，修后应全部"一致"。
         *   `tilesY = 1` 的系统（qiqiu / 星点这类）此式退化成 0 ⇒ **零影响**。
         *
         * ★ P4：Single Row 档的行**不来自 `fi`**，而是来自 `p.uvRow`（出生时定）
         *   ⇒ 该档 `v0 = (tilesY − 1 − 行号) · fh`、`u0` 用**行内**帧号。
         */
        u0 = (fi % tilesX) * fw;
        v0 = this.uvSingleRow
          ? (tilesY - 1 - Math.min(tilesY - 1, Math.max(0, p.uvRow))) * fh
          : (tilesY - 1 - Math.floor(fi / tilesX)) * fh;
        u1 = u0 + fw;
        v1 = v0 + fh;
      }

      /**
       * `_Texture` 的 UV 平移 = CustomData（寿命驱动）+ `_UV_t`（全局时钟驱动）。
       * 两者互斥地存在（saoguang 只有前者、yun 只有后者），但按公式叠加是安全的：
       * `texUV = _offon·(in_TEXCOORD1 − _UV_t·t) + _UV_t·t + in_TEXCOORD0`。
       */
      let du = driftU;
      let dv = driftV;
      if (cdOn) {
        du += lifeMul(cd.curve, pr);
      }

      // 位置：整组绕枢轴公转；朝向默认保持粒子自身的初始旋转，**不**跟着轮盘倾转；
      // `groupRotation.rotateSelf = true` 时（轮盘本体）把 gAng 叠进自身角度。
      let cx = p.x;
      let cy = p.y;
      /**
       * P3 · `alignment` —— 官方 Render Alignment 表逐字：
       *   View *"Particles face the Camera plane."*、World *"aligned with the world axes."*、
       *   Local *"aligned to the Transform component of their GameObject."*、
       *   Facing *"face the direct position of the Camera GameObject."*、
       *   Velocity（新版本）*"aligned with their velocity"*。
       *
       * ★ 本引擎的粒子**本来就写在屏幕坐标系里**（相机无 roll / 无俯角 / 无偏航），
       *   所以前四档投影后**逐位等价**（详见 `config.type.ts` 的 `alignment` 注释）；
       *   **只有 Velocity 有可见差别** ⇒ 基准朝向改用该粒子速度方向的屏幕角。
       */
      let ang = p.rot + (gr && gr.rotateSelf === true ? gAng : 0);
      if (this.rAlignVel) {
        const vvy0 = p.vy + p.gvy;
        const vl0 = Math.hypot(p.vx, vvy0);
        if (vl0 > 1e-6) {
          ang = Math.atan2(vvy0, p.vx);
        }
      }
      /**
       * `allowRoll = false` ⇒ 官方 *"控制面向摄像机的粒子是否可以围绕摄像机的 Z 轴旋转"*
       * 的否定档 ⇒ 屏幕自转**整体作废**（`startRotation` 同样是绕相机 Z，一并忽略）。
       */
      if (!this.rRoll) {
        ang = 0;
      }
      /**
       * Stretched 档的朝向已由**速度**完全定义 —— 官方 2021.2+ 逐字：*"particles are
       * aligned to face the Camera **and also aligned to their velocity**. This alignment
       * occurs **regardless of the Velocity Scale value**"* ⇒ 不再叠屏幕自转。
       * 依据 = Cocos `particle-vs-legacy.chunk`：`RENDER_MODE_STRETCHED_BILLBOARD` 下
       * 把 `rotEuler` 钉成 `vec3(0)`。⚠️ Unity 内部未公开，此处采 Cocos 口径（见 RESEARCH §4.13）。
       */
      if (this.rMode === 1) {
        ang = 0;
      }
      if (gr) {
        const rx = p.x - px0;
        const ry = p.y - py0;
        cx = px0 + rx * gCos - ry * gSin;
        cy = py0 + rx * gSin + ry * gCos;
        // 缺省**不**叠 `gAng` 到 `ang` 上：prefab 里 chexiang 的
        //   `RotationModule.enabled = false`（粒子自身不旋转），也没有反向补偿曲线，
        //   故轿厢保持初始朝向 `startRotation` —— 即**始终竖直**，与真实摩天轮一致。
        //   （叠加 gAng 会让轿厢转到下方时头朝下。）
        //   motianl（轮盘本体）则在 config 里开 `rotateSelf: true`：它只有一个
        //   出生在枢轴原点的粒子（shape.enabled=false ⇒ 公转位移恒为零），
        //   不叠角度就永远静止 —— 见 config.type.ts 的 `rotateSelf` 注释。
      }
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);

      /**
       * `renderMode = 5 (None)`：官方 *"can be useful when using the Trails module,
       * if you want to only render the trails and hide the default rendering"*
       * ⇒ **不生成默认四边形**（丝带分支已在上方单独走完，不受影响）。
       */
      if (this.rMode === 5) {
        continue;
      }

      /**
       * ── P3：四边形 / Mesh 的顶点（枢轴 · 朝向基 · 拉伸 · 镜像 · 尺寸钳制）────
       *
       * 统一式：`顶点 = 中心 + 枢轴偏移 + R(ang)·(sgnA·半轴A + sgnB·半轴B − 枢轴偏移)`
       *   · `半轴A/B` = 「**单位尺寸**下的半轴」（`renderModeAxes`）× 当前帧直径；
       *   · `枢轴偏移 = pivot × 当前帧直径`（ScriptReference 逐字：*"multiplier of the
       *     particle sizes, relative to their diameters"*）；
       *   · `枢轴 = 0` 且基 = 屏幕轴 ⇒ **与 P3 之前逐位相同**。
       */
      let hwE = hw;
      let hhE = hh;
      /**
       * `min/maxParticleSize`：官方逐字 *"expressed as a fraction of **viewport size**"*
       * 且 *"only applied when the Rendering Mode is set to Billboard"*
       * ⇒ 仅 `rMode === 0` 生效、等比缩放。缺省（不声明）⇒ 关闭，现有产物不受影响。
       */
      if (this.rMode === 0 && this.rMaxSize > 0 && this.rViewportH > 0) {
        const ratio = (hhE * 2) / this.rViewportH;
        if (ratio > 1e-9) {
          const clamped = Math.min(
            this.rMaxSize,
            Math.max(this.rMinSize, ratio)
          );
          const k = clamped / ratio;
          if (k !== 1) {
            hwE *= k;
            hhE *= k;
          }
        }
      }
      const sX2 = hwE * 2;
      const sY2 = hhE * 2;
      /** 半轴向量（屏幕二维）：`aXX/aXY` = A 轴，`aYX/aYY` = B 轴 */
      let aXX = 0;
      let aXY = 0;
      let aYX = 0;
      let aYY = 0;
      if (this.rMode === 1) {
        /**
         * Stretched：长轴沿**速度**、短轴与速度垂直。
         * 长度 = `|v|·velocityScale + lengthScale·size` —— 依据 = Cocos `computeVertPos` 的
         * STRETCHED 分支逐行（`camUp = velocity·velocityScale + normalize(velocity)·lengthScale·s.y`），
         * 且与手册 *"Stretches particles proportionally to their speed"* +
         * *"…proportionally to their current size along the direction of their velocity"* 一致。
         * ⚠️ 手册另有一句 *"Setting this to 0 makes the particles disappear, having effectively
         * 0 length"* ⇒ `lengthScale = 0` 且速度为 0 时长度**确实是 0**（不兜底成 size）。
         */
        const vvy1 = p.vy + p.gvy;
        const vl1 = Math.hypot(p.vx, vvy1);
        const ux1 = vl1 > 1e-6 ? p.vx / vl1 : 1;
        const uy1 = vl1 > 1e-6 ? vvy1 / vl1 : 0;
        const len = vl1 * this.rVelScale + this.rLenScale * sY2;
        aXX = -uy1 * (sX2 / 2);
        aXY = ux1 * (sX2 / 2);
        aYX = ux1 * (len / 2);
        aYY = uy1 * (len / 2);
      } else {
        aXX = this.uAxX * sX2;
        aXY = this.uAxY * sX2;
        aYX = this.uAyX * sY2;
        aYY = this.uAyY * sY2;
      }
      /** 枢轴偏移（**直径的倍数** ⇒ 与上面用的"当前帧直径"同源） */
      const ox = this.pvX * sX2;
      const oy = this.pvY * sY2;
      /** 逐轴镜像：用出生抽签的 `p.vmix` 判定（**不**额外消耗 rng ⇒ 既有抽签序列零回归） */
      const flipU = this.rFlipX > 0 && p.vmix < this.rFlipX;
      const flipV = this.rFlipY > 0 && p.vmix < this.rFlipY;
      const meshUse =
        this.rMode === 4 && !!(this.rMeshPos && this.rMeshUv && this.rMeshIdx);
      if (meshUse) {
        /**
         * Mesh 档：顶点**直接用 mesh 的坐标 × 当前帧尺寸**（`mesh.scale` 是数据层旋钮）。
         * 依据 = Cocos `matFromRTS(rot, pos, compScale)`，其中 `compScale = scale × size`
         * ⇒ 与本引擎 quad 的"单位几何 × 尺寸"完全同构。⚠️ **不做归一化**：
         *   `FX_Model_ZC_Plane13` extent ≈ 3.96×1.76 远超"直径 1"，归一化会把它缩小近 4 倍。
         */
        const mp = this.rMeshPos!;
        const mu = this.rMeshUv!;
        const mi = this.rMeshIdx!;
        const mk = this.rMeshScale;
        for (let q = 0; q < mi.length; q++) {
          const vi = mi[q];
          /**
           * ★ **必须乘当前帧尺寸**（`sX2` / `sY2` = 直径）—— mesh 的坐标是"图元自己的
           *   尺度"，与 quad 的"单位几何"不同，所以 `sX2` / `sY2` 要在**这里**乘，
           *   而不能像 quad 分支那样折进 `aXX/aYX`（那两个在 mesh 分支里根本不参与）。
           */
          const lx = mp[vi * 2 + 0] * mk * sX2;
          const ly = mp[vi * 2 + 1] * mk * sY2;
          const ddx = lx - ox;
          const ddy = ly - oy;
          pos[n * 3 + 0] = cx + ox + ddx * cs - ddy * sn;
          pos[n * 3 + 1] = cy + oy + ddx * sn + ddy * cs;
          pos[n * 3 + 2] = 0;
          const uu = flipU
            ? this.rMeshUMin + this.rMeshUMax - mu[vi * 2 + 0]
            : mu[vi * 2 + 0];
          const vv2 = flipV
            ? this.rMeshVMin + this.rMeshVMax - mu[vi * 2 + 1]
            : mu[vi * 2 + 1];
          uvs[n * 2 + 0] = uu + du;
          uvs[n * 2 + 1] = vv2 + dv;
          muvs[n * 2 + 0] = uu;
          muvs[n * 2 + 1] = vv2;
          als[n] = al;
          scs[n * 4 + 0] = cr;
          scs[n * 4 + 1] = cg;
          scs[n * 4 + 2] = cb;
          scs[n * 4 + 3] = ca;
          n++;
        }
      } else {
        // 两个三角形（每顶点 3 float 位置 + 2+2 float uv + 1 float alpha）
        // 四个角的符号 × `qu`/`qv` 的顺序**必须严格对应**（旧写法就是这两行常量）
        const SGA = [-1, 1, 1, -1, 1, -1];
        const SGB = [-1, -1, 1, -1, 1, 1];
        const qu = [u0, u1, u1, u0, u1, u0];
        const qv = [v0, v0, v1, v0, v1, v1];
        for (let q = 0; q < 6; q++) {
          const lx = SGA[q] * aXX + SGB[q] * aYX;
          const ly = SGA[q] * aXY + SGB[q] * aYY;
          const ddx = lx - ox;
          const ddy = ly - oy;
          pos[n * 3 + 0] = cx + ox + ddx * cs - ddy * sn;
          pos[n * 3 + 1] = cy + oy + ddx * sn + ddy * cs;
          pos[n * 3 + 2] = 0;
          const uu = flipU ? u0 + u1 - qu[q] : qu[q];
          const vv2 = flipV ? v0 + v1 - qv[q] : qv[q];
          uvs[n * 2 + 0] = uu + du;
          uvs[n * 2 + 1] = vv2 + dv;
          // `_mask` 走 `maskUV = in_TEXCOORD0`，**不动**
          muvs[n * 2 + 0] = uu;
          muvs[n * 2 + 1] = vv2;
          als[n] = al;
          // ★ 写的是「startColor × colorBySpeed」的合成值（见上方 ColorBySpeed 段）
          scs[n * 4 + 0] = cr;
          scs[n * 4 + 1] = cg;
          scs[n * 4 + 2] = cb;
          scs[n * 4 + 3] = ca;
          n++;
        }
      }
    }

    this.posAttr.needsUpdate = true;
    this.uvTexAttr.needsUpdate = true;
    this.uvMaskAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.startColAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  /* ── 只读快照（验收脚本 / HUD 用，不改行为）────────────────────────── */

  /**
   * 当前帧 `_Texture` 的 UV 平移量（CustomData + `_UV_t`）。
   *
   * ★ 为什么要暴露它：`in_TEXCOORD1 ≡ Custom1.xy` 是扫光复现里**唯一未能直读**的
   * 关键假设（逻辑锁定）。判据只能是"实现后扫过行程 = 0.6028 UV / 1.5 s、方向从左到右"，
   * 而行程必须从**运行时真值**读，不能靠读代码自己算一遍（那就成了自证）。
   * 这里直接复用 `buildGeometry` 用的同一套求值，保证快照与真实渲染一致。
   */
  public getUvOffset = (): { u: number; v: number } => {
    const c = this.cfg;
    const driftX = Number.isFinite(c.uv.driftX) ? c.uv.driftX : 0;
    const driftY = Number.isFinite(c.uv.driftY) ? c.uv.driftY : 0;
    let u = driftX * this.systemTime;
    const v = driftY * this.systemTime;
    const cd = c.customData;
    if (cd && cd.enabled && cd.offon !== 0 && this.particles.length > 0) {
      const p = this.particles[0];
      u += lifeMul(cd.curve, p.age / p.life);
    }
    return { u, v };
  };

  public getSnapshot = () => {
    const useSize = !!(this.cfg.sizeModule && this.cfg.sizeModule.enabled);
    return {
      name: this.cfg.name,
      count: this.particles.length,
      max: this.cfg.maxNumParticles,
      z: this.mesh.position.z,
      blend: this.cfg.blend,
      texture: this.cfg.textureFileName,
      groupAngleDeg: this.groupAngle / DEG2RAD,
      systemTime: this.systemTime,
      vertices: this.geometry.drawRange.count,
      /** `_Texture` 的 UV 平移（见 getUvOffset） */
      uvOffset: this.getUvOffset(),
      particles: this.particles.map((p) => ({
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        age: p.age,
        life: p.life,
        size:
          p.sizeX *
          (useSize
            ? lifeMul(this.cfg.sizeModule.curve, p.age / p.life, p.vmix)
            : 1),
        rotDeg: p.rot / DEG2RAD,
        /** 出生抽定的 startColor（RGBA，终生不变；见 Particle.sc） */
        sc: [p.sc[0], p.sc[1], p.sc[2], p.sc[3]],
        /**
         * P2：本帧总速度大小（世界单位/秒；见 Particle.spd）。
         * 三个 by-speed 模块的 `rate` 就由它归一化而来 —— 验收脚本读它即可复算，
         * 不必在测试里重抄一遍公式（那样就成了自证）。
         */
        spd: p.spd,
        /** P2：z 坐标 / z 速度（世界单位；只有 z 类模块启用时才可能非 0） */
        z: p.z,
        vz: p.vz,
        /** 逐粒子抽签系数（验收脚本复算 alphaMix / 双曲线用） */
        vmix: p.vmix,
        /** 本地→世界 Z 旋角（度）；盒形发射器专用，锥形/圆形恒 0（见 Particle.localRot） */
        localRotDeg: p.localRot / DEG2RAD,
        /** 序列帧号（渲染真值；见 Particle.uvFrame）。`-1` = 未启用 */
        uvFrame: p.uvFrame,
        /**
         * 丝带轨迹点数（`trail01` 这类；未启用丝带时恒为 0）。
         * 验收脚本用它判断"丝带是否真的在积累"（应为 2~`trail.maxPoints`，
         * 且 `step()` 里受 `trail.lifetime` 截断）。
         */
        trailPts: p.trail.length,
        /** 丝带半宽（世界单位）；未启用时为 0 */
        trailHalfWidth: p.thw,
      })),
    };
  };

  public getMesh = (): THREE.Mesh => this.mesh;

  /* ── 「动作 → 额外特效」钩子用的能力（2026-10-14）───────────────────── */

  /**
   * **从头重播本系统**（清空已有粒子 + 复位系统时钟 + 重新预热）。
   *
   * 用途：`config.actionEffects` 把某条动作绑到本组粒子时，动作每次触发都要
   * "完整播一遍"，而不是接着上一轮的相位继续跑。
   *
   * ## 复位的字段（必须全部复位，漏一个就会"播出来但不是从头"）
   * - `particles`：清空 ⇒ 旧粒子不会与新一轮叠在一起；
   * - `systemTime` / `emitAcc` / `burstFired` / `emittedInBatch` / `batchCount`：
   *   发射相关的时钟与记账 ⇒ `startDelay`、burst 的 `time`、周期序号都从 0 重新算；
   * - `groupAngle`：整组自转（摩天轮轮毂）回到初始相位；
   * - `buildGeometry()`：清空后立刻把顶点数刷成 0，避免**这一帧**还残留上一轮的四边形。
   *
   * ## ★ 为什么**不**复位 `rng`
   *
   * 粒子随机数发生器保留当前状态 —— 每次重播的粒子分布**不重复**。
   * 这与 Unity 一致（Unity 的随机种子在系统实例化时就定了，重播不会重掷）。
   * ⚠️ 若把 `rng` 也复位，同一动作连点两次会得到**逐帧完全相同**的两簇粒子，
   * 观感上是"卡住重放"，反而更像 bug。
   *
   * ## ★ 为什么**不**碰 `mesh.visible`
   *
   * 本组的可见性由 `update()` 每帧按"有没有存活粒子 / 有没有在发射"自行维护
   * （见 `update` 的实现）⇒ 重播后它会在下一帧自动变可见，不需要外部干预；
   * 外部硬置 `visible=true` 反而会与那套逻辑打架。
   *
   * @param rePrewarm 是否重新跑 `prewarm()`（缺省 **true**，与开场行为一致）。
   *   ⚠️ `prewarm` 是"模拟到稳态"的重活（最长 30 s 的定步长），只建议对本系统
   *   本来就配了 `prewarm: true` 的组开；缺省 true 时构造里也会按 `cfg.prewarm` 判定。
   */
  public restart = (rePrewarm?: boolean): void => {
    // ★ 先"开跑"：`autoplay: false` 的组靠这一步开始工作（见 `started` 的注释）
    this.started = true;
    this.particles.length = 0;
    this.systemTime = 0;
    this.groupAngle = 0;
    this.emitAcc = 0;
    this.burstFired = {};
    this.emittedInBatch = 0;
    this.batchCount = 1;
    // 先按当前（空）状态刷一次顶点，保证"这一帧就是空的"
    this.buildGeometry();
    const want = typeof rePrewarm === 'boolean' ? rePrewarm : this.cfg.prewarm;
    if (want) {
      this.prewarm();
      this.buildGeometry();
    }
  };

  /**
   * **只把它"开跑"，不复位任何状态**（2026-10-14）。
   *
   * 用途 = `config.actionEffects[].restart === false`：语义是"这条动作第一次触发时把它
   * 拉起来，之后让它按自己的自然周期继续跑"，而不是"每触发一次就重播一遍"。
   * 与 `restart()` 的**唯一**区别：不清粒子、不归零时钟、不预热。
   *
   * ★ 为什么不能拿 `restart(false)` 顶替：`restart()` 无论第一参是什么都会
   *   `systemTime = 0` + 清空 `particles`（见其实现）⇒ 那是"重播"，不是"别重播"。
   *   要表达"别重播"就必须有一个**不碰状态**的入口，故单开这一个方法。
   */
  public ensureStarted = (): void => {
    this.started = true;
  };

  /** 验收脚本的钩子：直接调用真身做 curl 散度判据，避免"手抄复刻" */
  public static __noise = {
    perlin3,
    psi,
    psiLayer,
    noiseScalar,
    curl3,
    addLayerCurl,
    divCurlNumerical,
    NOISE_EPS,
  };
}
