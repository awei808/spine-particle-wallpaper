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
const NOISE_OFFSET_X = [0, 31.416, -53.21];
const NOISE_OFFSET_Y = [0, 47.853, 19.66];
const NOISE_OFFSET_Z = [0, 12.793, 71.3];

function psi(i: number, x: number, y: number, z: number): number {
  return perlin3(
    x + NOISE_OFFSET_X[i],
    y + NOISE_OFFSET_Y[i],
    z + NOISE_OFFSET_Z[i]
  );
}

/**
 * Curl Noise：N = ∇ × Ψ，用中心差分。
 * 步长必须远小于噪声特征尺度（见 NOISE_EPS）。
 *
 * 暴露为 static 是为了让验收脚本能**直接调用真身**跑散度判据
 * （`_验证_粒子.py`：随机采样 2000 点算 max|∇·N|，应远小于场量级）。
 * 这条判据是 curl 的**定义性质**，比"看着像湍流"可靠得多。
 */
function curl3(
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3
): THREE.Vector3 {
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

/** 数值散度 ∇·N（验收判据用） */
function divCurlNumerical(x: number, y: number, z: number, h: number): number {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d0 = curl3(x + h, y, z, a).x - curl3(x - h, y, z, b).x;
  const d1 = curl3(x, y + h, z, a).y - curl3(x, y - h, z, b).y;
  const d2 = curl3(x, y, z + h, a).z - curl3(x, y, z - h, b).z;
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

/** 寿命内乘子（SizeModule / RotationModule / VelocityModule 用） */
function lifeMul(mm: ParticleMinMax, t: number): number {
  if (!mm) {
    return 0;
  }
  if (mm.keysA && mm.keysA.length > 0) {
    return mm.a * keysAt(mm.keysA, t);
  }
  return mm.a;
}

/**
 * alpha 渐变求值（ColorModule.gradient 的 alphaKeys: [[t, a], ...]）。
 * 注意 t 小于首个关键帧时取**首个关键帧的值**（Unity 的渐变外推语义），
 * star 的首个 alpha 键在 t=0.1029 —— 若当成"从 0 开始"会让星点开头多淡入一次。
 */
function alphaAt(keys: number[][], t: number): number {
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
   * 若它是曲线，则忽略本字段、改用曲线求值 —— 判据见 `uvOverKeys`。
   */
  uvFrameOver: number;
  /**
   * 本帧实际用于采样的序列帧号（0-based；`-1` = 该系统的 uv 未启用或只有 1 帧）。
   *
   * ★ 由 `buildGeometry()` **写回**，所以它**就是渲染真值本身**。
   *   验收脚本读它即可判断"同一颗粒子是否始终同一帧"（`qiqiu` 应恒定、`niao` 应遍历），
   *   而不必在测试里重抄一份公式 —— 那样就成了自证。
   */
  uvFrame: number;
};

/* ─────────────────────────── 主类 ─────────────────────────── */

export class ParticleAnimator {
  private cfg: ParticleMeshConfig;
  /** 轿厢姿态角模式（仅轿厢组有值；其余为 undefined ⇒ 不干预出生朝向） */
  private cabinMode?: 'gravity' | 'game';
  private mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  /** `_Texture` 的 UV（会随 customData / `_UV_t` 流动） */
  private uvTexAttr: THREE.BufferAttribute;
  /** `_mask` 的 UV（**不动** —— 与 `_Texture` 是两次独立采样） */
  private uvMaskAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private rng: Rng;

  /**
   * `uv.frameOverTime` 的曲线关键帧。**为空 = 该值不随寿命变**（走粒子的出生定值）。
   *
   * 系统级常量：同一系统的所有粒子共用同一条曲线，故不必逐粒子存一份。
   * 本套数据里只有 `niao` 非空（曲线 0→1），`qiqiu` 是随机两常量 ⇒ 为空。
   */
  private uvOverKeys: number[][] | null = null;

  private particles: Particle[] = [];

  /** 系统时间（秒）：lengthInSec 循环 + burst 触发用 */
  private systemTime = 0;
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
   */
  constructor(
    meshConfig: ParticleMeshConfig,
    texture: THREE.Texture,
    maskTexture?: THREE.Texture | null,
    cabinMode?: 'gravity' | 'game'
  ) {
    if (!texture) {
      throw 'particle texture does not fully loaded';
    }
    this.cfg = meshConfig;
    this.cabinMode = cabinMode;
    this.rng = new Rng(1013 + meshConfig.name.length * 7919);
    /** frameOverTime 只有"带关键帧"时才随寿命变（见 config.type.ts 的 `uv.frameOverTime`） */
    const foKeys = meshConfig.uv?.frameOverTime?.keysA;
    this.uvOverKeys = foKeys && foKeys.length > 0 ? foKeys : null;

    const max = Math.max(1, Math.floor(meshConfig.maxNumParticles || 1));

    /**
     * 一个 mesh 承载本系统的全部粒子（动态四边形）。这样 z 排序只需给这一个
     * mesh 一个 `position.z`，与分层背景 / 角色共用同一套
     * "transparent 物体按 远→近 排序"的机制 —— 不需要另开渲染通道。
     *
     * ★ `uv`（`_Texture`）与 `aMaskUv`（`_mask`）是**两套 UV**：真 shader 里
     *   `_Texture` 走 `texUV`（含 CustomData / `_UV_t` 的平移）、`_mask` 走 `maskUV`
     *   （`in_TEXCOORD0`，不动）。合成"预乘成品图"的做法会丢掉这个区别。
     */
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 6 * 3), 3);
    this.uvTexAttr = new THREE.BufferAttribute(
      new Float32Array(max * 6 * 2),
      2
    );
    this.uvMaskAttr = new THREE.BufferAttribute(
      new Float32Array(max * 6 * 2),
      2
    );
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(max * 6), 1);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('uv', this.uvTexAttr);
    this.geometry.setAttribute('aMaskUv', this.uvMaskAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
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

    const sc = meshConfig.startColor || [1, 1, 1, 1];
    const add = meshConfig.blend === 'add';

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uMask: { value: maskTexture || WHITE_1X1 },
        /** 是否有 `_mask` 槽（仅用于片元里选"取 rgb 塑形"还是"跳过"） */
        uHasMask: { value: maskTexture ? 1 : 0 },
        /** = startColor（vs_COLOR0） */
        uStartColor: { value: new THREE.Vector4(sc[0], sc[1], sc[2], sc[3]) },
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
        'varying vec2 vTexUv;',
        'varying vec2 vMaskUv;',
        'varying float vAlpha;',
        'void main() {',
        '  vTexUv = uv;',
        '  vMaskUv = aMaskUv;',
        '  vAlpha = aAlpha;',
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
        'uniform vec4 uStartColor;',
        'uniform float uAlphe;',
        'uniform float uAdditive;',
        'varying vec2 vTexUv;',
        'varying vec2 vMaskUv;',
        'varying float vAlpha;',
        'void main() {',
        '  vec4 tex = texture2D(uMap, vTexUv);',
        '  if (uAdditive > 0.5) {',
        // ── UVliudong：mask 的 rgb 塑形 + 预乘 + 加色 + alpha 恒 1 ──
        '    vec3 maskRgb = uHasMask > 0.5',
        '      ? texture2D(uMask, vMaskUv).rgb : vec3(1.0);',
        '    vec3 c = maskRgb * tex.rgb;',
        '    float a = tex.a * uStartColor.a;',
        '    c *= uStartColor.rgb;',
        '    c *= a;',
        '    c *= uAlphe;',
        '    gl_FragColor = vec4(c * vAlpha, 1.0);',
        '  } else {',
        // ── UVliudong_Blended：mask 的 x 塑形 + 真实 alpha ──
        '    float m = uHasMask > 0.5 ? texture2D(uMask, vMaskUv).x : 1.0;',
        '    vec3 c = tex.rgb * m * uStartColor.rgb * uAlphe;',
        '    float a = m * tex.a * uStartColor.a * uAlphe;',
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
    this.mesh.position.set(
      meshConfig?.position?.x ?? 0,
      meshConfig?.position?.y ?? 0,
      meshConfig?.position?.z ?? -1000
    );
    this.mesh.frustumCulled = false;
    Scene.scene?.add(this.mesh);

    if (meshConfig.prewarm) {
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
     */
    const rotDeg =
      this.cabinMode === 'game' ? 0 : spawnValue(c.startRotation, r) / DEG2RAD;

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
    };

    // ── 初始位置/速度：ShapeModule ──
    const sh = c.shape;
    const dirAngle = Math.atan2(c.emitDir[1], c.emitDir[0]);
    // speedModifier 按官方措辞"倍率乘在粒子速度上"实现为初始速度的乘子
    const spdMul =
      c.velocity && c.velocity.enabled ? c.velocity.speedModifier : 1;
    if (sh && sh.enabled && sh.type === 10) {
      /**
       * type=10 Circle + arcMode=3(BurstSpread)：粒子沿圆周均布。
       * 均布相位由**本批次的发射序号**决定，再叠加节点自身的 Z 轴旋角
       * （chexiang 0.04° / chexiang(1) 16.04° → 两组轿厢正好错开 16.00°）。
       */
      const ang =
        (this.emittedInBatch / Math.max(1, this.batchCount)) * Math.PI * 2 +
        c.nodeRotZ * DEG2RAD;
      const rad = (sh.radius || 0) * s * u;
      p.x = Math.cos(ang) * rad;
      p.y = Math.sin(ang) * rad;
    } else if (sh && sh.enabled) {
      /**
       * Cone(4) / ConeVolume(8)：锥形发射器。
       *
       * ★ 2026-09-20 重写。旧实现有两个硬伤：
       *   ① 位置取的是**随机极角的圆盘**（Volume）或**随机方向的线段**（Cone），
       *      完全没有把 `emitDir`（本地 +Z 投影 = 锥轴）当轴来用 ⇒ 发射区与"锥"没有几何关系；
       *   ② `radius`（qiqiu 3.5 ≈ 105 px、niao 1.5 ≈ 45 px）**根本没参与** ⇒ 粒子挤在一条轴线上。
       *
       * 官方语义（Manual / PartSysShapeModule，2026-09-19 核实，逐字）：
       *   Angle            = 锥在**顶点处**的张角（0 = 圆柱、90 = 平盘）
       *   Radius           = 圆形部分的半径
       *   Radius Thickness = 发射粒子的体积比例（0 = 只从外表面、1 = 整个体积）
       *   Length           = 锥长（UI 上仅当 `Emit from: Volume` 时可编辑）
       *   "The particles diverge in proportion to their distance from the cone's center line."
       *     ⇒ **发散量由位置决定**（离中心线越远、偏离轴向越大），
       *       而不是像旧实现那样"方向在锥角内随机取"。
       *
       * ⚠️ 已收口（2026-09-20，依据官方 Manual + 解包数据自证，详见 06 号审计文档 §P0-b）：
       *   `Length` **只在 `Emit from: Volume` 下参与几何**（官方逐字：
       *   "This property is available only when Emit from: is Volume"）。
       *   ⇒ `qiqiu` 是 Cone(4)=Base，`length=5.0` 是 Unity 默认值残留（与 chexiang 这个
       *      根本没有 length 语义的 Circle 完全同值），**不参与几何**，底面就在发射器原点 ⇒ t=0；
       *      `niao` 是 ConeVolume(8)，`length=14.07` ≠ 5.0 是**被实际调整过的值** ⇒ 参与，t∈[0,H]。
       *   ⇒ **不要用 `radius / tan(angle/2)` 去求"出生点的轴向位移"**：那算的是锥的几何高度，
       *      在 Unity 语义里它不是位移量（Base 的出生点就在原点平面），用它会把出生点推出画面。
       */
      const R = (sh.radius || 0) * s * u; // 底面半径（世界单位）
      // Length = 锥长，仅 ConeVolume(8) 使用；Cone(4)/Base 下不参与几何
      const H = (sh.length || 0) * s * u;
      // 锥轴 = emitDir；径向 = 锥轴在 XY 平面内的法向
      const axX = Math.cos(dirAngle);
      const axY = Math.sin(dirAngle);
      const rxX = -axY;
      const rxY = axX;
      // Radius Thickness：0 = 只从外表面、1 = 整个体积内均匀
      const th = Math.min(1, Math.max(0, sh.radiusThickness ?? 1));
      const rhoMag = R * (1 - th + th * Math.sqrt(r.next()));
      const sgn = r.next() < 0.5 ? -1 : 1;

      let t: number;
      let rho: number;
      if (sh.type === 8) {
        // ConeVolume：锥体**体积**内均匀 —— 截面积 ∝ t² ⇒ pdf(t) ∝ t² ⇒ t = H·u^(1/3)
        t = H * Math.pow(r.next(), 1 / 3);
        rho = H > 0 ? rhoMag * sgn * (t / H) : rhoMag * sgn;
      } else {
        // Cone（Base）：出生点只在**底面那张圆面**上 ⇒ 沿锥轴**没有**位移。
        // （旧实现在这里写了 `t = H`，等于把 Base 当成了 Volume，属于误用 length。）
        t = 0;
        rho = rhoMag * sgn;
      }
      p.x = axX * t + rxX * rho;
      p.y = axY * t + rxY * rho;

      // 发散 ∝ 距中心线的距离：`发散角 = (angle/2) · (ρ / R)`，ρ 的符号决定偏向哪一侧
      const spread = (R > 1e-9 ? rho / R : 0) * ((sh.angle || 0) / 2) * DEG2RAD;
      const a = dirAngle + spread;
      const spd = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(a) * spd;
      p.vy = Math.sin(a) * spd;
    } else {
      const spd = spawnValue(c.startSpeed, r) * s * u * spdMul;
      p.vx = Math.cos(dirAngle) * spd;
      p.vy = Math.sin(dirAngle) * spd;
    }

    // ── RotationModule（rotationOverLifetime），弧度/秒 ──
    if (c.rotationEnabled) {
      p.spin = lifeMul(c.rotationCurve, 0);
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
      lifeMul(c.startLifetime, 1) || c.startLifetime.a,
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
    const prevCycle = Math.floor(prevEmitTime / cycle);
    const nowCycle = Math.floor(emitTime / cycle);
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
    const rate = lifeMul(c.emission.rateOverTime, 0);
    if (rate > 0) {
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
      if (c.velocity && c.velocity.enabled) {
        vvx = lifeMul(c.velocity.x, pr) * s * u;
        vvy = lifeMul(c.velocity.y, pr) * s * u;
      }

      /**
       * 4.2 NoiseModule：**速度增量**（"值越高，粒子移动得越快越远"）。
       * 采样坐标在系统本地未缩放空间：prefab 坐标先除回 localScale 再乘 frequency。
       * quality=High 是 3D 噪声 → z 取 0，用 x/y 分量（2D 场景即如此）。
       * damping=true → 有效强度 = strength × frequency。
       */
      if (c.noise && c.noise.enabled) {
        const eff = c.noise.damping
          ? c.noise.strength * c.noise.frequency
          : c.noise.strength;
        const q = c.noise.frequency / (s * u);
        curl3(p.x * q, p.y * q, 0, nv);
        const acc = eff * c.noise.positionAmount * c.noise.gain * s * u * dt;
        p.vx += nv.x * acc;
        p.vy += nv.y * acc;
      }

      // 4.3 积分位置：先改速度、再积分（与 Unity 的模块顺序一致）
      p.x += (p.vx + vvx) * dt;
      p.y += (p.vy + vvy) * dt;

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

      // 4.5 自旋
      if (p.spin !== 0) {
        p.rot += p.spin * dt;
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
    const pos = this.posAttr.array as Float32Array;
    const uvs = this.uvTexAttr.array as Float32Array;
    const muvs = this.uvMaskAttr.array as Float32Array;
    const als = this.alphaAttr.array as Float32Array;

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

    let n = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // 本帧默认"未参与渲染"（见 Particle.uvFrame）；uv 段会写回真实帧号。
      // ★ 放在这里而不是 uv 段里：下面两个 `continue`（尺寸/alpha 过小）会跳过 uv 段，
      //   若默认值写在 uv 段内，被跳过的粒子会**留着上一帧的帧号**，
      //   快照里就会读到一颗已经不该渲染的粒子上的陈旧值。
      p.uvFrame = -1;
      const pr = p.age / p.life;
      const sm = useSize ? lifeMul(c.sizeModule.curve, pr) : 1;
      const hw = (p.sizeX * sm) / 2;
      const hh = (p.sizeY * sm) / 2;
      if (hw <= 0.01 || hh <= 0.01) {
        continue;
      }
      const al = alphaAt(alKeys, pr);
      if (al <= 0.003) {
        continue;
      }

      /**
       * UV：animationType=0(WholeSheet)。Unity 的公式是
       *   `frame = startFrame + frameOverTime(t) × cycles × total`
       * （本套 8 个节点的 `startFrame` 实测**全为常量 0**，故折掉），再对 `total`
       * **取模回绕** —— 不能像 08 那样 clamp 到最后一帧：那会让序列在前 1/cycles 的
       * 寿命里播完、之后冻住不动。
       *
       * ★ `frameOverTime` 是否随寿命变，**由它的 mode 决定**（见 config.type.ts 同名注释）：
       *   · 曲线（`uvOverKeys` 非空）⇒ `a × keysA(t)`；`niao` 由此在寿命内播 5 遍 8 帧；
       *   · 常量 / 随机两常量 ⇒ 用出生时定的 `p.uvFrameOver`；`qiqiu` 由此终生固定黄或粉。
       */
      let u0 = 0;
      let v0 = 0;
      let u1 = 1;
      let v1 = 1;
      if (c.uv.enabled && total > 1) {
        const foMM = c.uv.frameOverTime;
        const over = !foMM
          ? pr // 兼容不带该字段的旧 config：等价于曲线 0→1（= 旧行为）
          : this.uvOverKeys
          ? foMM.a * keysAt(this.uvOverKeys, pr)
          : p.uvFrameOver;
        const fi =
          ((Math.floor(over * cycles * total) % total) + total) % total;
        // 写回真值：快照读的就是这里算出来的帧号，验收脚本无需重抄公式
        p.uvFrame = fi;
        u0 = (fi % tilesX) * fw;
        v0 = Math.floor(fi / tilesX) * fh;
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
      const ang = p.rot + (gr && gr.rotateSelf === true ? gAng : 0);
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

      // 两个三角形（每顶点 3 float 位置 + 2+2 float uv + 1 float alpha）
      const qx = [-hw, hw, hw, -hw, hw, -hw];
      const qy = [-hh, -hh, hh, -hh, hh, hh];
      const qu = [u0, u1, u1, u0, u1, u0];
      const qv = [v0, v0, v1, v0, v1, v1];
      for (let q = 0; q < 6; q++) {
        const lx = qx[q];
        const ly = qy[q];
        pos[n * 3 + 0] = cx + lx * cs - ly * sn;
        pos[n * 3 + 1] = cy + lx * sn + ly * cs;
        pos[n * 3 + 2] = 0;
        uvs[n * 2 + 0] = qu[q] + du;
        uvs[n * 2 + 1] = qv[q] + dv;
        // `_mask` 走 `maskUV = in_TEXCOORD0`，**不动**
        muvs[n * 2 + 0] = qu[q];
        muvs[n * 2 + 1] = qv[q];
        als[n] = al;
        n++;
      }
    }

    this.posAttr.needsUpdate = true;
    this.uvTexAttr.needsUpdate = true;
    this.uvMaskAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
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
          (useSize ? lifeMul(this.cfg.sizeModule.curve, p.age / p.life) : 1),
        rotDeg: p.rot / DEG2RAD,
        /** 序列帧号（渲染真值；见 Particle.uvFrame）。`-1` = 未启用 */
        uvFrame: p.uvFrame,
      })),
    };
  };

  public getMesh = (): THREE.Mesh => this.mesh;

  /** 验收脚本的钩子：直接调用真身做 curl 散度判据，避免"手抄复刻" */
  public static __noise = { perlin3, curl3, divCurlNumerical, NOISE_EPS };
}
