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
 * PointerTrail —— 指针（鼠标）拖尾粒子
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 复刻游戏 prefab `FX_UI_CommonUI_Click` 的 `/5` 与 `/5/6` 两个发射器
 * （`Assets/03_Prefabs/ART_Prefabs/Effect/FX_UI/`，包 `03_prefabs/art_prefabs.ab`）。
 * 解包依据：`09_壁纸适配_素材与技术/18_触摸粒子拖尾_解包.md`；
 * 转储脚本 `_work_触摸拖尾/13_查淡入淡出.py`（曲线）与 `11_导出拖尾资源.py`（贴图）。
 *
 * ── 原版机制（typetree 直读，非推测）─────────────────────────────────────
 *
 *   EmissionModule.rateOverTime     = 0      （不按时间发射）
 *   EmissionModule.rateOverDistance = 2.0    （★按【移动距离】发射：每 1 单位 2 颗）
 *   looping = true, moveWithTransform = 1    （系统跟随宿主变换移动）
 *   startSpeed = 0                           （粒子出生后静止，不做速度积分）
 *   ColorModule.enabled = false              （★无 alpha 动画，alpha 全程恒定）
 *   SizeModule.curve = [[0,1],[1,0]]         （★靠尺寸线性缩到 0 消失）
 *
 * ⇒ 指针移动时宿主跟着走、沿轨迹**等距**撒粒子（间距恒 `1/rateOverDistance`，
 *   与移动速度无关）；每颗粒子停在出生点，0.3~0.5 s 内缩到 0 后消失。
 *   颜色是**每颗二选一随机**（`minMaxState 2` / TwoColors），不是沿轨迹渐变。
 *
 * ── 与 ParticleAnimator 的分工（不要合并）────────────────────────────────
 *
 *   ParticleAnimator  自发射：`rateOverTime`/burst + ShapeModule 决定出生点，
 *                     粒子靠速度积分移动 —— 用于背景那 8 个系统。
 *   PointerTrail      外部驱动：出生点 = 指针位置，出生后不动 —— 本文件。
 *   发射模型不同，强行合并会把两边的时序语义搅在一起。
 *
 * ── 实现要点 ─────────────────────────────────────────────────────────────
 *
 *   1. **不新增事件监听**：直接读 `initScene` 的 `cursorX/cursorY`（NDC，
 *      已由 `mousemove`/`mousedown` 维护）。"按移动距离发射"的本质就是
 *      "读两帧光标的位移"，因此这里天然对得上，无需再造一套 pointermove 绑定。
 *   2. 首帧与瞬移（NDC 位移 > `MAX_STEP_NDC`）只更新参照点、不发射 ——
 *      否则页面刚打开、鼠标从 (0,0) 跳进窗口时会拉出一条横贯屏幕的长尾。
 *   3. 尺寸以**屏幕 CSS px** 配置、逐帧乘 `worldPerPx` 换成世界单位：
 *      窗口尺寸变化时粒子的**视觉大小不变**（原版是 UI 层，本就与视角无关）。
 */

import * as THREE from 'three';
import { PointerTrailConfig, PointerTrailEmitterConfig } from './config.type';
import * as Scene from './initScene';
import { Rng } from './animator/ParticleAnimator';

const DEG2RAD = Math.PI / 180;

/** 相邻粒子间距缺省值（屏幕 CSS px）；推导见 `config.type.ts` 的 `spacingPx` */
const DEFAULT_SPACING_PX = 19;
/** 同屏粒子上限缺省值 */
const DEFAULT_MAX_PARTICLES = 120;
/**
 * 粒子所在 z 平面缺省值。
 *
 * ⚠️ **必须是负值**：本工程相机在 `z = 0` 且朝 **−z** 方向看（所有层都是负 z，
 * 背景 −1520 ~ −1390、角色 spine −1000）。"角色之前"= 比 −1000 更靠近相机
 * ⇒ 取 `−100`（紧贴相机，等价于 UI 覆盖层）。
 *
 * ★ 曾经误取 `+120`（正值 = 相机**背后**）⇒ `ndcToWorld` 的射线与平面交点
 *   `t < 0` 恒被拒 ⇒ 粒子一个都不发（静默失效）。改动此处务必跑
 *   `_work_触摸拖尾/20_验证_鼠标拖尾.py`。
 */
const DEFAULT_PLANE_Z = -100;
/** 尺寸随寿命的缺省曲线：线性 `1 → 0`（用户 2026-09-30 指定口径） */
const DEFAULT_SIZE_OVER_LIFE: number[][] = [
  [0, 1],
  [1, 0],
];

/**
 * 单帧允许的最大光标位移（NDC 单位）。
 *
 * 超过它视为"首次进入窗口 / 光标重新出现"而非一次真实拖动，只更新参照点、不发射。
 * `0.25` NDC = 视口 1/8 宽，正常鼠标与触控板单帧远达不到。
 */
const MAX_STEP_NDC = 0.25;

/**
 * 单帧最多发射数（安全阀）。
 *
 * `MAX_STEP_NDC` 已经把单帧位移限制在视口 1/8，按 19 px 间距算约 13 颗；
 * 这里再兜一层，避免极端 DPI/超大屏下 `while` 循环失控。
 */
const MAX_SPAWN_PER_FRAME = 48;

/** 一颗拖尾粒子的状态（出生即冻结位置，只有 `age` 在走） */
type TrailParticle = {
  /** 世界坐标 x（z 由所属 Mesh 的 `position.z` 统一给） */
  x: number;
  /** 世界坐标 y */
  y: number;
  /** 已存活秒数 */
  age: number;
  /** 总寿命（秒） */
  life: number;
  /** 出生直径（屏幕 CSS px；逐帧乘 `worldPerPx` 换成世界单位） */
  sizePx: number;
  /** 已选定的颜色（线性 RGB） */
  r: number;
  g: number;
  b: number;
  /** 已乘过 `alphaMul` 的 alpha（恒定，不随寿命变化） */
  a: number;
};

/**
 * 对 `[[t, k], ...]` 形式的曲线做线性插值采样。
 *
 * `t` 已归一化到 [0, 1]；关键帧按 t 升序（解包数据如此），顺序扫描即可。
 * 空数组视为常量 1（与 `config.type.ts` 对空曲线"按常量处理"的口径一致）。
 */
const sampleCurve = (keys: number[][], t: number): number => {
  if (!keys || keys.length === 0) {
    return 1;
  }
  const first = keys[0];
  if (t <= first[0]) {
    return first[1];
  }
  const last = keys[keys.length - 1];
  if (t >= last[0]) {
    return last[1];
  }
  for (let i = 1; i < keys.length; i++) {
    const cur = keys[i];
    if (t <= cur[0]) {
      const prev = keys[i - 1];
      const span = cur[0] - prev[0];
      return span > 0
        ? prev[1] + ((cur[1] - prev[1]) * (t - prev[0])) / span
        : cur[1];
    }
  }
  return last[1];
};

/**
 * 一个发射器 = 一个 `THREE.Mesh` + 一个粒子池。
 *
 * 为什么"每系统一个 Mesh"：与 `ParticleAnimator` 同一理由 —— z 排序只需给这一个
 * mesh 一个 `position.z`，与背景层/角色共用同一套"透明物体按 z 排序"机制，
 * 既不用另开渲染通道，也不用手工维护 `renderOrder`。
 */
class TrailEmitter {
  private readonly cfg: PointerTrailEmitterConfig;
  private readonly spacingPx: number;
  private readonly max: number;
  private readonly sizeCurve: number[][];
  private readonly planeZ: number;
  private readonly rng: Rng;

  /** 存活粒子（按出生顺序，故下标 0 恒为最旧） */
  private particles: TrailParticle[] = [];
  /** 自上次发射以来累计的世界距离（= 原版 rateOverDistance 的积分量） */
  private travel = 0;
  /** 上一帧光标 NDC；`null` = 尚未建立参照点（首帧不发射） */
  private prevNdc: { x: number; y: number } | null = null;
  /** 诊断：`update` 被调用的次数 —— 用来区分"没跑"与"跑了但没发" */
  private frames = 0;
  /** 诊断：上一帧的 NDC 位移与世界位移 */
  private lastStep = 0;
  private lastWorldDist = 0;
  /** `planeZ` 符号给反时只提醒一次，避免每帧刷控制台 */
  private warnedPlaneZ = false;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly alphaAttr: THREE.BufferAttribute;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;

  constructor(
    config: PointerTrailEmitterConfig,
    texture: THREE.Texture,
    planeZ: number,
    seed: number
  ) {
    if (!texture) {
      throw 'pointer trail texture does not fully loaded';
    }
    this.cfg = config;
    this.planeZ = planeZ;
    this.rng = new Rng(seed);
    this.spacingPx =
      config.spacingPx && config.spacingPx > 0
        ? config.spacingPx
        : DEFAULT_SPACING_PX;
    this.sizeCurve =
      config.sizeOverLife && config.sizeOverLife.length > 0
        ? config.sizeOverLife
        : DEFAULT_SIZE_OVER_LIFE;
    this.max = Math.max(
      1,
      Math.floor(config.maxParticles || DEFAULT_MAX_PARTICLES)
    );

    texture.premultiplyAlpha = false;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    /**
     * 顶点属性：`position`(3) + `uv`(2) + `aColor`(3) + `aAlpha`(1)。
     *
     * 颜色走**逐顶点属性**而不是 uniform —— 原版的四色是"每颗二选一随机"，
     * 同一帧里不同粒子颜色不同，uniform 表达不了。
     */
    this.posAttr = new THREE.BufferAttribute(
      new Float32Array(this.max * 6 * 3),
      3
    );
    this.uvAttr = new THREE.BufferAttribute(
      new Float32Array(this.max * 6 * 2),
      2
    );
    this.colorAttr = new THREE.BufferAttribute(
      new Float32Array(this.max * 6 * 3),
      3
    );
    this.alphaAttr = new THREE.BufferAttribute(
      new Float32Array(this.max * 6),
      1
    );
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('uv', this.uvAttr);
    this.geometry.setAttribute('aColor', this.colorAttr);
    this.geometry.setAttribute('aAlpha', this.alphaAttr);
    this.geometry.setDrawRange(0, 0);

    const add = config.blend === 'add';
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        /** 1 = 加色（片元里预乘、alpha 置 1、`One/One`）；0 = 常规 alpha 混合 */
        uAdditive: { value: add ? 1 : 0 },
      },
      vertexShader: [
        'attribute vec3 aColor;',
        'attribute float aAlpha;',
        'varying vec2 vUv;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '  vUv = uv;',
        '  vColor = aColor;',
        '  vAlpha = aAlpha;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      /**
       * 两支语义照抄 `ParticleAnimator` 对 `UVliudong` / `UVliudong_Blended` 的实现，
       * 只是这里的"遮罩"恒为白（拖尾材质没有 `_mask` 槽），故 `m` 项直接折掉。
       */
      fragmentShader: [
        'uniform sampler2D uMap;',
        'uniform float uAdditive;',
        'varying vec2 vUv;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '  vec4 tex = texture2D(uMap, vUv);',
        '  if (uAdditive > 0.5) {',
        // ── 加色：预乘 alpha + `out.a = 1` + One/One（见 ParticleAnimator 顶部说明）──
        '    float a = tex.a * vAlpha;',
        '    vec3 c = tex.rgb * vColor * a;',
        '    gl_FragColor = vec4(c, 1.0);',
        '  } else {',
        // ── 常规：真实 alpha，`SrcAlpha/OneMinusSrcAlpha` ──
        '    gl_FragColor = vec4(tex.rgb * vColor, tex.a * vAlpha);',
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
       * 与 `ParticleAnimator` 同理：`THREE.AdditiveBlending` 是 `(SrcAlpha, One)`，
       * 而片元里已经预乘过 ⇒ 必须显式 `(One, One)`，否则会少乘一次 alpha、偏暗。
       */
      this.material.blending = THREE.CustomBlending;
      this.material.blendSrc = THREE.OneFactor;
      this.material.blendDst = THREE.OneFactor;
      this.material.blendEquation = THREE.AddEquation;
    }

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.position.set(0, 0, planeZ);
    this.mesh.frustumCulled = false;
    Scene.scene?.add(this.mesh);
  }

  /* ── 每帧 ─────────────────────────────────────────────────────────────── */

  public update(delta: number): void {
    this.frames++;
    this.spawnAlongCursor();
    this.advance(delta);
    this.buildGeometry();
  }

  /**
   * 按光标位移发射粒子 —— 本文件的核心，对应原版 `EmissionModule.rateOverDistance`。
   *
   * 为什么"读两帧光标位移"就等价于 `rateOverDistance`：原版是宿主跟随手指移动、
   * 发射器按"宿主走过的距离"计数；壁纸里宿主的运动就等于 `cursorX/cursorY` 的变化。
   */
  private spawnAlongCursor(): void {
    const nx = Scene.cursorX;
    const ny = Scene.cursorY;
    const prev = this.prevNdc;
    this.prevNdc = { x: nx, y: ny };
    if (!prev) {
      // 首帧只建立参照点：此时 cursorX/cursorY 可能还是初始 (0,0)
      return;
    }
    const step = Math.hypot(nx - prev.x, ny - prev.y);
    if (!(step > 0) || step > MAX_STEP_NDC) {
      return;
    }
    this.lastStep = step;
    const from = this.ndcToWorld(prev.x, prev.y);
    const to = this.ndcToWorld(nx, ny);
    if (!from || !to) {
      return;
    }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (!(dist > 0)) {
      return;
    }
    this.lastWorldDist = dist;
    this.travel += dist;

    const spacing = this.spacingPx * this.worldPerPx();
    if (!(spacing > 0)) {
      return;
    }
    let budget = MAX_SPAWN_PER_FRAME;
    while (this.travel >= spacing && budget > 0) {
      this.travel -= spacing;
      this.spawn(to.x, to.y);
      budget--;
    }
    if (budget === 0) {
      // 极端位移下丢弃余量，避免把 travel 越攒越多
      this.travel = 0;
    }
  }

  /** 出生一颗粒子；颜色二选一随机、寿命与尺寸在配置区间内随机 */
  private spawn(x: number, y: number): void {
    const c = this.rng.next() < 0.5 ? this.cfg.colors[0] : this.cfg.colors[1];
    const alphaMul = Number.isFinite(this.cfg.alphaMul as number)
      ? (this.cfg.alphaMul as number)
      : 1;
    if (this.particles.length >= this.max) {
      // 满了就淘汰最旧的一颗（数组按出生顺序 ⇒ 下标 0 最旧）
      this.particles.shift();
    }
    this.particles.push({
      x,
      y,
      age: 0,
      life: this.rng.range(this.cfg.lifetime[0], this.cfg.lifetime[1]),
      sizePx: this.rng.range(this.cfg.sizePx[0], this.cfg.sizePx[1]),
      r: c[0],
      g: c[1],
      b: c[2],
      a: c[3] * alphaMul,
    });
  }

  /** 推进寿命并淘汰死亡粒子 */
  private advance(delta: number): void {
    if (!(delta > 0) || this.particles.length === 0) {
      return;
    }
    const alive: TrailParticle[] = [];
    for (const p of this.particles) {
      p.age += delta;
      if (p.age < p.life) {
        alive.push(p);
      }
    }
    this.particles = alive;
  }

  /**
   * 把存活粒子写进顶点缓冲。
   *
   * ★ 尺寸 = `sizePx × worldPerPx × sizeCurve(age/life)`：
   *   前两项把它变成世界单位，末项就是"线性缩到 0"那条曲线（原版 SizeModule）。
   *   `alpha` 全程用 `p.a` 常量，**不做淡出** —— 这是与"常见拖尾"最容易搞反的一点。
   */
  private buildGeometry(): void {
    const pos = this.posAttr.array as Float32Array;
    const uvs = this.uvAttr.array as Float32Array;
    const cols = this.colorAttr.array as Float32Array;
    const als = this.alphaAttr.array as Float32Array;
    const wpp = this.worldPerPx();

    let n = 0;
    for (const p of this.particles) {
      const t = p.life > 0 ? p.age / p.life : 1;
      const half = (p.sizePx * wpp * sampleCurve(this.sizeCurve, t)) / 2;
      if (!(half > 0)) {
        // 已缩到 0 ⇒ 不写顶点（`setDrawRange` 会自动把它排除）
        continue;
      }
      // 两个三角形（顶点顺序与 ParticleAnimator 一致）
      const qx = [-half, half, half, -half, half, -half];
      const qy = [-half, -half, half, -half, half, half];
      const qu = [0, 1, 1, 0, 1, 0];
      const qv = [0, 0, 1, 0, 1, 1];
      for (let q = 0; q < 6; q++) {
        pos[n * 3 + 0] = p.x + qx[q];
        pos[n * 3 + 1] = p.y + qy[q];
        pos[n * 3 + 2] = 0;
        uvs[n * 2 + 0] = qu[q];
        uvs[n * 2 + 1] = qv[q];
        cols[n * 3 + 0] = p.r;
        cols[n * 3 + 1] = p.g;
        cols[n * 3 + 2] = p.b;
        als[n] = p.a;
        n++;
      }
    }

    this.posAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  /* ── 坐标换算 ─────────────────────────────────────────────────────────── */

  /**
   * 当前视口下「1 屏幕 CSS px = 多少世界单位」（在 `planeZ` 平面处）。
   *
   * 相机是垂直 FOV 的透视相机：该平面上的可见世界高度 = `2·d·tan(fov/2)`，
   * 除以画布 CSS 高度即得每 px 的世界尺寸。用 CSS 高度而非 backing 高度，
   * 是因为 `fov` 描述的是"画布"这个比例量，两者比值相同。
   */
  private worldPerPx(): number {
    const cam = Scene.camera;
    const el = Scene.renderer ? Scene.renderer.domElement : null;
    const h = el ? el.clientHeight : 0;
    if (!cam || !(h > 0) || !Number.isFinite(cam.fov)) {
      return 1;
    }
    const d = Math.abs(this.planeZ - cam.position.z);
    return (2 * d * Math.tan((cam.fov * DEG2RAD) / 2)) / h;
  }

  /**
   * NDC → `planeZ` 平面上的世界坐标。
   *
   * 与 `SpineAnimator` 的 cursorFollow 同一套 unproject 口径（射线与目标平面求交）。
   * 返回 `null` 表示射线与平面平行、或交点落在相机背后 —— 此时本帧跳过发射。
   */
  private ndcToWorld(
    ndcX: number,
    ndcY: number
  ): { x: number; y: number } | null {
    const cam = Scene.camera;
    if (!cam) {
      return null;
    }
    const p = new THREE.Vector3(ndcX, ndcY, 0).unproject(cam);
    const dir = p.sub(cam.position);
    if (Math.abs(dir.z) < 1e-6) {
      return null;
    }
    const t = (this.planeZ - cam.position.z) / dir.z;
    if (!(t > 0)) {
      /**
       * 交点在相机背后 —— 最典型的成因是 `planeZ` 与相机同侧的符号给反了
       * （本工程相机在 z=0 朝 −z，`planeZ` 必须为负）。只提醒一次，免得每帧刷屏。
       */
      if (!this.warnedPlaneZ) {
        this.warnedPlaneZ = true;
        console.warn(
          'pointerTrail: planeZ=%s 与相机(z=%s，朝 −z)同侧，射线交点在相机背后 ' +
            '⇒ 不会发射任何粒子。请把 planeZ 设为负值（缺省 -100）。',
          this.planeZ,
          cam.position.z
        );
      }
      return null;
    }
    return { x: cam.position.x + dir.x * t, y: cam.position.y + dir.y * t };
  }

  /* ── 只读快照（验收脚本 / 单测用，不改行为）──────────────────────────── */

  public snapshot(): {
    alive: number;
    travel: number;
    spacingPx: number;
    sizeCurve: number[][];
    /** 各存活粒子的当前直径（世界单位），按出生顺序 ⇒ 下标 0 最旧 */
    sizes: number[];
    /** 各存活粒子的归一化寿命 `age/life` ∈ [0,1]，与 sizes 同序 */
    ages: number[];
    /**
     * 各存活粒子的**尺寸曲线值** `k = sizeOverLife(age/life)`，与 sizes 同序。
     *
     * 与 `sizes` 的区别：`sizes` 含"起始尺寸的随机性"（`/5/6` 的 sizePx 是 4~9 随机），
     * 所以**只有 `ks` 才适合断言"线性缩到 0"** —— 对固定 sizePx 的 `/5` 两者等价。
     */
    ks: number[];
    /** ── 以下为诊断字段（验证脚本用来区分"没跑"与"跑了但没发"）── */
    frames: number;
    lastStep: number;
    lastWorldDist: number;
    cursor: { x: number; y: number };
    cameraZ: number | null;
    fov: number | null;
    planeZ: number;
    worldPerPx: number;
  } {
    const wpp = this.worldPerPx();
    return {
      alive: this.particles.length,
      travel: this.travel,
      spacingPx: this.spacingPx,
      sizeCurve: this.sizeCurve,
      sizes: this.particles.map((p) => {
        const t = p.life > 0 ? p.age / p.life : 1;
        return p.sizePx * wpp * sampleCurve(this.sizeCurve, t);
      }),
      ages: this.particles.map((p) => (p.life > 0 ? p.age / p.life : 1)),
      ks: this.particles.map((p) => {
        const t = p.life > 0 ? p.age / p.life : 1;
        return sampleCurve(this.sizeCurve, t);
      }),
      frames: this.frames,
      lastStep: this.lastStep,
      lastWorldDist: this.lastWorldDist,
      cursor: { x: Scene.cursorX, y: Scene.cursorY },
      cameraZ: Scene.camera ? Scene.camera.position.z : null,
      fov: Scene.camera ? Scene.camera.fov : null,
      planeZ: this.planeZ,
      worldPerPx: wpp,
    };
  }

  public dispose(): void {
    if (this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    this.geometry.dispose();
    this.material.dispose();
    this.particles = [];
  }
}

/**
 * 指针拖尾总入口：持有全部发射器，逐帧驱动。
 *
 * 用法（`index.ts`）：资源就绪后 `new PointerTrail(config, threeAssetList)`，
 * 把 `update` 挂进 `meshUpdateCallbacks`。
 */
export class PointerTrail {
  private readonly emitters: TrailEmitter[] = [];

  constructor(
    config: PointerTrailConfig,
    textures: Record<string, THREE.Texture | null>
  ) {
    const planeZ =
      config.planeZ !== undefined && Number.isFinite(config.planeZ)
        ? (config.planeZ as number)
        : DEFAULT_PLANE_Z;
    const list = config.emitters || [];
    list.forEach((cfg, i) => {
      const tex = cfg.textureFileName ? textures[cfg.textureFileName] : null;
      if (!tex) {
        console.error(
          'pointerTrail: texture missing, emitter skipped',
          cfg.name,
          cfg.textureFileName
        );
        return;
      }
      // 固定种子 ⇒ 同一份 config 每次跑出的粒子分布一致（同 ParticleAnimator 的理由）
      this.emitters.push(
        new TrailEmitter(
          cfg,
          tex,
          planeZ,
          20260930 + i * 7919 + cfg.name.length
        )
      );
    });
  }

  public update(delta: number): void {
    for (const e of this.emitters) {
      e.update(delta);
    }
  }

  /** 只读快照，供验证脚本读取"每颗粒子的当前尺寸 / 归一化寿命" */
  public snapshot(): { emitters: ReturnType<TrailEmitter['snapshot']>[] } {
    return { emitters: this.emitters.map((e) => e.snapshot()) };
  }

  public dispose(): void {
    for (const e of this.emitters) {
      e.dispose();
    }
    this.emitters.length = 0;
  }
}
