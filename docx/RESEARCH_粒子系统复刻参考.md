# Unity 内置粒子系统（Shuriken）复刻参考：仓库 / 教程 / 规格清单

> 调研日期 2026-10-16 · 目的：为「**整个粒子系统更新**」找可对照的权威实现与规格。
> 触发原因：S8 动作特效（`FX_Asuna_S8_Background_touch1`）复刻后观感是"**一条水平的线**"，
> 与游戏原版不符 —— 已定位为引擎锥形分支缺少方位角采样（详见 §4）。
> 本文只做调研与结论，**不含代码改动**。

---

## 1. 结论（先看这个）

**没有任何单一仓库完整复刻 Unity 的 26 个粒子模块**（Collision / Trigger / Lights /
ExternalForces / LifetimeByEmitterSpeed 在开源界**全都缺**，Unity 的 C++ 内核闭源）。
按用途分三层，各取所需：

| 用途 | 首选 | 理由 |
|---|---|---|
| **规格说明书**（字段语义 / 模块清单 / tooltip） | **`Unity-Technologies/UnityCsReference`** 的 `Modules/ParticleSystemEditor/ParticleSystemModules/*.cs` | Unity **官方编辑器源码**，26 个模块各一个 UI 文件，字段名/顺序/tooltip 全在；`ShapeModuleUI.cs` 还给出 gizmo 与字段的对应关系 |
| **算法/公式源**（CPU 采样逻辑，可直接移植） | **`feng3d-labs/feng3d`** 的 `packages/particlesystem` | 模块名与 Unity **1:1**（17 个模块 + 6 形状 + SubEmitters），函数注释直接写「原 `ParticleSystemShapeCone.calcParticlePosDir`」，有 `shapeBranchMatrix.spec.ts` 等行为测试；MIT；2026-10 仍在推 |
| **工程/渲染侧参考**（Billboard 5 模式 / CPU+GPU 渲染器 / Trail / culling / 文档） | **`cocos/cocos-engine`** 的 `cocos/particle` | TypeScript、活跃（9.8k★）、枚举与 Unity 同名（`ParticleRenderMode`/`ParticleEmitLocation`/`ParticleArcMode`…），渲染管线完整；缺 SubEmitters 与 BurstSpread |
| **形状采样最简读本 + 完整 GLSL** | **`layabox/LayaAir`** 的 `src/layaAir/laya/particle/d3` | 老 Unity 口径但代码极干净（`shapes/ShapeUtils.ts`），且带 `shader/particleShuriKen.vs/fs`、`MathGradient.glsl`（我们的粒子 shader 可对照） |
| 概念/流程教程 | Unity 官方手册逐模块 + 若干介绍文（见 §7） | 讲"粒子的一生"与模块职责，不涉及内部公式 |

★ **对本次"水平线"问题，`feng3d` + `Cocos` 两份实现已经交叉证实了原版语义**（§4），
做修复不需要再猜。

---

## 2. 候选总表

| 仓库 | 语言 | 许可 | 星/活跃 | 一句话 |
|---|---|---|---|---|
| `Unity-Technologies/UnityCsReference` | C# | Unity 参考许可（只读用途） | — / 跟随 Unity 版本 | **官方字段与 UI 规格**（26 模块 UI） |
| `feng3d-labs/feng3d` | TypeScript | MIT | 53★ / 2026-10-12 | **模块最全的内核级复刻**（含 SubEmitters） |
| `cocos/cocos-engine` | TS+C++ | 仓库根 LICENSE（GitHub 判 NOASSERTION，用前自核） | 9860★ / 2026-10-08 | **引擎级完整实现**（CPU/GPU 渲染器、Trail） |
| `layabox/LayaAir` | TypeScript | MIT | 2214★ / 2026-10-15 | 老 Shuriken 移植 + 完整粒子 GLSL |
| `Alchemist0823/three.quarks` | TypeScript | MIT | 1053★ / 2026-05-21 | three.js 粒子引擎，README 称可导入 Unity Shuriken，**但导入器不在开源仓库里**（只有 README 一句）⇒ 不能当规格 |
| `gleblebedev/Unity2Urho` | C# | — | — | Unity→Urho3D 导出器，`ParticleExporter.cs` 只做**粗映射**（Cone→"EmitterSize"），公式不足 |
| `meta4d-me/m4m-engine`、`hikipuro/tea.js` | TypeScript | — | — | 另有 Shuriken 风格形状模块（`particles/enums/ParticleSystemShapeType`、`particles/modules/ShapeModule`），可作旁证 |

---

## 3. 模块覆盖矩阵（对照 Unity 官方 26 个模块）

Unity 官方模块清单取自 `UnityCsReference/Modules/ParticleSystemEditor/ParticleSystemModules/`：
Initial(Main) / Emission / Shape / Velocity / ClampVelocity(LimitVelocity) / Force / ExternalForces /
InheritVelocity / LifetimeByEmitterSpeed / Color / ColorByVelocity / Size / SizeByVelocity /
Rotation / RotationByVelocity / Noise / Collision / Trigger / Sub / Lights / Trail / UV /
CustomData / Renderer（+ Burst、顶层 ParticleSystem）。

| Unity 模块 | 本引擎（现状） | feng3d | Cocos | LayaAir |
|---|---|---|---|---|
| Main（life/speed/size/rotation/color/gravity…） | ✅ 大部分（缺 rotation3D / flipRotation / randomizeRotationDirection / cullingMode / ringBufferMode / emitterVelocityMode） | ✅ | ✅ | ✅ |
| Emission + Burst | ✅ | ✅ | ✅ | ✅ |
| **Shape** | ✅ Box / Circle / Sphere / Hemisphere / Edge / Cone / ConeVolume（2026-10-16 P1 补齐，含 `m_Position`/`m_Rotation`/`m_Scale` 的 `TRS` 施加）；⚠️ 仍缺 Donut / Rectangle / BoxShell / BoxEdge / Mesh / Sprite*（落到锥形兜底，见 `TODO.md` §2.7） | ✅ 6 形状 | ✅ Box/Circle/Cone/Sphere/Hemisphere（+ Edge/Volume 语义） | ✅ 5 形状 |
| Velocity over Lifetime | ✅ **P2 已补齐**（z / orbital XYZ / orbitalOffset / radial / space）；⚠️ z 在 2D 下不产生屏幕位移（只进 `\|v\|`） | ⚠️ 无 orbital/radial（只有 MinMaxCurveVector3） | ✅ | ✅ |
| Limit Velocity over Lifetime | ⚠️ 仅 magnitude（缺 separateAxis/inWorldSpace 与 per-axis、drag） | ✅ | ✅ | ❌ |
| Force over Lifetime | ✅ **P2**（加速度、`space` 两档；`randomized` 逐帧重抽未实现） | ✅ | ✅ | ❌ |
| External Forces | ❌ | ❌ | ❌ | ❌ |
| Inherit Velocity | ✅ **P2**（含官方硬守卫：Local 下整个忽略） | ✅ | ❌ | ❌ |
| Lifetime By Emitter Speed | ❌ | ❌ | ❌ | ❌ |
| Color over Lifetime | ⚠️ **只有 alpha**（无 rgb 梯度） | ✅ | ✅ | ✅ |
| Color by Speed | ✅ **P2**（`rate` 归一化 + 逐通道相乘，含 alpha） | ✅ | ❌ | ❌ |
| Size over Lifetime | ✅（缺 separateAxes y/z） | ✅ | ✅ | ✅ |
| Size by Speed | ✅ **P2**（倍率；`separateAxes` 分轴） | ✅ | ❌ | ❌ |
| Rotation over Lifetime | ✅ | ✅ | ✅ | ✅ |
| Rotation by Speed | ✅ **P2**（弧度/秒；序列化 `curve` = z 轴） | ✅ | ❌ | ❌ |
| **Noise** | ✅ **P4 已补齐**（`octaves`/`octaveMultiplier`/`octaveScale` 势场 fBm 叠层、`scrollSpeed`、`sizeAmount`、`rotationAmount`、`separateAxes`+`strengthY/Z`）；⚠️ 仍缺 `quality`(Low/Medium 的跨轴复用手法未公开) / `remap*`（全包无一启用） | ✅ | ✅ | ❌ |
| Collision | ❌ | ❌ | ❌ | ❌ |
| Trigger | ❌ | ❌ | ❌ | ❌ |
| **Sub Emitters** | ❌ | ✅（模块文件齐备，实现程度待核） | ❌ | ❌ |
| Lights | ❌ | ❌ | ❌ | ❌ |
| **Trail** | ⚠️ 仅丝带（textureMode=Stretch），无宽/色 over trail 之外的模式 | ✅ 字段齐 | ✅ `ParticleTrailMode` | ❌ |
| **UV / Texture Sheet Animation** | ✅ **P4 已补齐**（`timeMode` 三档 Lifetime/Speed/FPS + `fps` + `speedRange`、`startFrame`、`animationType=SingleRow` + `rowMode` 三档 + `rowIndex`、`flipU/flipV` 作为已废弃别名并入 `renderer.flip`）；⚠️ 仍缺 `uvChannelMask`（全包全是 −1 ⇒ 无信息可表达）/ `mode=Sprites`（本作无一使用） | ✅ | ✅ `texture-animation.ts` | ✅ |
| CustomData | ⚠️ 仅 1 条曲线 + `_offon`（S9 扫光用） | ❌ | ❌ | ❌ |
| **Renderer** | ✅ **P3 已补齐**（renderMode 5 种 + None / alignment 五档 / pivot / sortingFudge / flip / allowRoll / min·maxParticleSize / Mesh 顶点集）；⚠️ **本引擎是 2D 分层渲染 + 正视相机** ⇒ Horizontal / Vertical 会几何退化、View·World·Local·Facing 投影等价（见 §4.12）；⚠️ 仍缺 normalDirection（无光照）/ sortMode（系统内排序）/ soft particle / freeformStretching | ⚠️ 只有数据接口壳（字段齐、**无实现**，见 §4.12 末注） | ✅ 5 模式 + alignSpace + CPU/GPU | ⚠️ |
| MinMaxCurve / MinMaxGradient 取值口径 | ✅（mode 0/1/2/3 + 端点外推 + 逐粒子抽签，见 `MEMORY_粒子口径.md`） | ✅ | ✅ | ⚠️ |

---

## 4. ★★ 已由第三方实现交叉证实的 3 条语义（直接影响本次修复）

### 4.1 Cone 的底面是 **XY 平面内的圆盘**，锥轴是 ±Z —— 我们引擎算成"一维偏移"⇒ 一条线
- **Cocos** `cocos/particle/emitter/shape-module.ts` → `coneEmit()`：
  ```ts
  randomPointBetweenCircleAtFixedAngle(pos, radius*(1-radiusThickness), radius, theta); // 二维圆盘/环带
  Vec2.multiplyScalar(dir, pos, Math.sin(angle)); dir.z = -Math.cos(angle)*radius;
  pos.z = 0;                                    // ← 底面在 XY 平面，锥轴 = -Z
  ```
  且 `ShapeModule.emit()` 最后 `Vec3.transformMat4(p.position, p.position, this.mat)`。
- **feng3d** `packages/particlesystem/src/shapes/ParticleSystemShapeCone.ts`（注释：原 `ParticleSystemShapeCone.calcParticlePosDir`）：
  ```ts
  radiusAngle = random()*arc            // ← 方位角按 arc 采样
  basePos = (cos, sin, 0)
  bottomPos = basePos * radius * radiusRate      // ← 圆盘内取点
  topPos    = basePos * (radius + length*tan(clamp(angle,0,87))) * radiusRate; topPos.z = length
  position  = bottomPos                  // Base：就在底面圆盘上
  ```
- **LayaAir** `.../module/shape/ConeShape.ts`：`position.x/y = _randomPointInsideUnitCircle() * radius`（`ShapeUtils` 里方位角 `random()*2π`、半径 `√u`）。

⇒ 我们引擎的 `type===4/8` 分支只有 `rho = ±rhoMag` 作用在**垂直于 emitDir 的一条线上**
（`p.x = rxX*rho, p.y = rxY*rho`），**没有方位角** ⇒ 全部粒子落在 y≡0 的一条水平线上。
**这就是"接近一条水平的线"的成因**（也解释了此前 `radius=7` 时"一根光面条"的观感）。

修法（待你确认后实施）：把锥形分支改成"在 XY 平面按 `arc` 取方位角 φ、按 `radiusThickness`
取半径 ρ"，即
```ts
az = arcMode===3 ? (emittedInBatch/batchCount)*2π : rand()*arc
ρ  = R*(1-th+th*√u)   // 或按 Cocos/风3d 的线性 ρ∈[R(1-th), R]，见 §6 待定项
p  = (cos az, sin az) * ρ
```
⚠️ 对 `angle=90`（扁平盘）+ `startSpeed=0` 的情形，**几何上等价于 Circle** ⇒
**有一条"零引擎改动"的临时路**：数据层把这类锥形直接下发成 `shape.type=10`（Circle），
即可立刻拿到正确的圆盘/扇形。但真正的修复仍应做在引擎锥形分支（它还要负责 `angle` 的方向发散）。

#### ★★ 2026-10-16 已实施（P0）

按上面的修法落在引擎（**未走数据层权宜路** —— 权宜路会让"方向发散"永久缺失）：
`ParticleAnimator.ts` 锥形分支现为

```ts
phi = nodeRotZ + (arcMode === 3 ? (emittedInBatch/batchCount)*2π : rand()*arc)   // 方位角
ρ   = R * (1 − te + te·√u)                                                        // radiusThickness
p   = emitDir·t + (cos phi, sin phi) · ρ · (boxX, boxY)                           // t 仅 ConeVolume
```

并**移交了两处旧权宜**：① S8 的 `radius` 预乘 150 已撤（改由引擎乘 `m_Scale`）；
② `arc = 230°` 不再是"整圆近似"。验证：`_regress/70_回归_锥形形状采样.ts`
（S9 18/18、S8 13/13）+ 同参数截图/粒子真值对比（见 `docx/TODO.md` §2.0 的表）。

### 4.2 `ShapeModule.scale` 会乘到形状采样点上（⇒ **半径 = radius × scale**）
- **Cocos** `shape-module.ts`：`constructMat()` = `Mat4.fromRTS(quat, position, scale)`，
  `emit()` 里 `transformMat4(p.position, p.position, this.mat)` ⇒ 采样点（含半径）被 scale 缩放。
  字段 tooltip：`scale` = "**Emitter size scale**"。
- **Unity 官方** `ShapeModuleUI.cs`：`s_Texts.scale = "Scale", "Scale the emission shape."`；
  scene gizmo 直接 `Handles.TransformHandle(ref position, ref rotation, ref scale)`。
- **语料实证**（本项目普查 `effect/fx_ui/*.prefab` 的 type=4/8）：
  `aurora_s4_background_touch1/beike` **R=0.8 + Scale=(450,450,450)**、
  `alisa_s3_background_chat/lizi_suizhi01` R=50 + Scale=(1.5,1,1)、
  `aurora_s5_background_touch1/yinpu_q` **R=242 + Scale=(0.5,1,1)**（若"Scale 就是尺寸"则此条荒谬）。

⇒ S8 本特效真值 `7 × 150 = 1050`。
**★ 2026-10-16 起引擎已支持该乘子**（`boxX/boxY` 各轴缩放，Cone / ConeVolume 与 Circle 同口径）；
`190_生成S8动作特效.py` 里那层**数据层预乘已撤销**（现下发 `radius=7` + `boxX/boxY=150`），
否则会乘两次（`7×150×150`）。S6 唯一一支锥形 `fx_touch2_huaban_2`（`m_Scale=(3,3)`）
此前被整条忽略 ⇒ 本轮起半径 `1.3 → 3.9`，观感变化待实测复核。

### 4.3 Cone 的 `arc / arcMode / arcSpread` 与 Circle 共用同一套
- **Cocos**：`arc` 的可见性判据是 `shape ∈ {Cone, Circle}`，`generateArcAngle()` 对两者通用
  （Random / Loop / Ping-Pong + arcSpread + arcSpeed）。
- **feng3d**：`ParticleSystemShapeCone.ts` 与 `...Circle.ts` 的 arc 处理逐字相同。
- ⇒ 本特效 `arc = 230°`（`mode=0` Random）必须实现；之前"按整圆近似"只是权宜。
  ⚠️ 注意 `arcMode` 的**取值范围**：Unity = Random/**Loop/PingPong/BurstSpread**（4 档），
  而 **Cocos 只实现了前 3 档（缺 BurstSpread）** —— S9 的 `chexiang` 恰好用的就是
  BurstSpread（`arcMode=3`，轿厢 16° 相位错开）⇒ 这一档要靠 feng3d / Unity 手册，别抄 Cocos。

### 4.4 ★★ Sphere / Hemisphere / Circle 的**位置口径相同、方向 = 径向**（P1 依据）

- **位置**：Unity 手册 Shape 模块页逐字 *"**Sphere, Hemisphere, and Circle have the same
  properties.**"*（Radius / Radius Thickness / Arc），`ShapeModuleUI.cs` 里 Sphere|Hemisphere 与
  Circle 的字段列表也逐字一致。并且正交投影下半球 `{ρ ≤ R, z ≥ 0}` 的 `(x,y)` 区域**就是整个
  圆盘**（每根与 z 平行的直线上，半球与整球的截面长度只差一个常数因子）⇒ **2D 下三者的位置
  分布不可分辨**。
- **方向**：手册 *"The choice of shape affects the region from which particles can be launched,
  **but also the initial direction of the particles. For example, a Sphere emits particles outward
  in all directions**"*；形状表里另有 *"Hemisphere — Uniform emission in all directions on one side
  of a plane"*、*"Circle — Emits particles uniformly from the center or edge of a circle.
  **The particles move only in the plane of the circle.**"*
  三方实现一致按**径向**写：Cocos `sphereEmit/hemisphereEmit/circleEmit` 都是
  `Vec3.normalize(dir, pos)`；feng3d `ParticleSystemShapeCircle.ts` 写 `dir = (cos a, sin a, 0)`。
  ⚠️ 注意「Spherize Direction」是**另一个**滑块（把方向往"从中心朝外"混合）；手册说它在
  Hemisphere/Circle 上取 1 时"与 Sphere 相同" —— 本游戏全包普查里该字段 **Sphere 1163 / 
  Hemisphere 535 条全为 0**，故本轮按"基础方向即径向"实现，不引入该混合项。

### 4.5 ★ SingleSidedEdge = 线段沿本地 X、方向沿本地 +Y（P1 依据）

- 手册形状表逐字：*"**Edge** — Emits particles from a line segment. The particles move in the
  emitter object's **upward (Y) direction**."*
- `ShapeModuleUI.cs`：`case ParticleSystemShapeType.SingleSidedEdge: m_Radius.OnInspectorGUI(...)`
  —— 该形状**唯一**可编辑属性是 `radius`（以 `MinMaxCurve` 形式，Mode 决定取角方式）。
- **feng3d** `ParticleSystemShapeEdge.ts`（注释标注原 `ParticleSystemShapeSingleSidedEdge.calcParticlePosDir`）：
  ```ts
  const arc = 360 * module.radius;
  radiusAngle = Math.random() * arc;      // Random 档
  radiusAngle = radiusAngle / arc;        // ⇒ t ∈ [0,1)
  vec3From(0, 1, 0, dir);                 // 方向 = 本地 +Y
  vec3From(module.radius * (radiusAngle * 2 - 1), 0, 0, position);   // x ∈ [−R, +R]
  ```
  ⇒ **半长 = `radius`**（全长 `2·radius`），在 `[−R, +R]` 上均匀取点。

### 4.6 ★★ Cone / ConeVolume 的轴向：**近盘在原点、沿轴张开**（P1 依据）

Unity 官方 gizmo 源码 `Editor/Mono/Handles/ConeFrustrumHandle.cs` 头注释逐字：

> `// 'radius' is near-radius at start of cone frustrum (far-radius is derived from 'angle' and near-radius)`
> `// 'angle' is cone angle from near disc of conefrustrum (if near-radius is 0 then angle is the half angle of view frustrum)`
> `// 'range' is height of conefrustrum`

代码里 `farRadius = Mathf.Min(1000f, Mathf.Abs(range * Mathf.Tan(angle)) + nearRadius)`，
且绘制时把**近盘画在 `position`**、远盘画在 `position + forward * range` ⇒
**近盘（半径 = `radius`）在发射器原点、远盘（半径 = `radius + Length·tan(angle)`）在轴向
`Length` 处**，锥体沿 +Z（本引擎的 `emitDir`）**张开**。
**feng3d** `ParticleSystemShapeCone.ts` 同向：
`bottomPos = basePos·radius·rate`（`z = 0`）、`topPos = basePos·(radius + length·tan(angle))·rate; topPos.z = length`。
⚠️ **Cocos 的 `coneEmit` 是另一套**（底面在 `z=0`，但方向 `dir.z = −cos(angle)·radius` 朝 −Z、"Volume" 沿
`dir` 推 `length·rand()/(−dir.z)`）—— 它的**张开方向与 Unity 相反**，别拿它当锥的规格。

### 4.7 ★ P2 依据：`Velocity over Lifetime` 官方属性表（逐字）

`docs.unity3d.com/2020.3/Documentation/Manual/PartSysVelOverLifeModule.html`：

| 属性 | 官方原文 |
|---|---|
| Linear X, Y, Z | *Linear velocity of particles in the X, Y and Z axes.* |
| Space | *Specifies whether the **Linear X, Y, Z** axes refer to local or world space.* |
| Orbital X, Y, Z | *Orbital velocity of particles around the X, Y and Z axes.* |
| Offset X, Y, Z | *The position of the center of orbit, for orbiting particles.* |
| Radial | *Radial velocity of particles away from/towards the center position.* |
| Speed Modifier | *Applies a multiplier to the speed of particles, along/around their current direction of travel.* |

Details 段逐字：*"To create effects with particles that spin around a center position, use the
Orbital velocity values. Additionally, you can propel particles towards or away from a center
position using the Radial velocity values. You can define a custom center of rotation for each
particle by using the Offset value."*

### 4.8 ★ P2 依据：orbital **是"绕 offset 中心旋转位置"**，单位是**弧度/秒**

Unity 内部不公开，最硬的第三方依据 = **galacean/engine PR #3049**
（`feat(particle): add orbital radial velocity over lifetime`，已合并，含 code review）。
其 `VelocityOverLifetime.glsl` 里逐字：

```glsl
vec3 renderer_VOLOrbitalMaxConst; // radians/second around x,y,z
```

`ParticleFeedback.shader` 里的应用（节选）：

```glsl
vec3 rel;
rel = position - renderer_VOLOffset;
#if RADIAL
    float relLen = length(rel);
    if (relLen > 1e-5) { rel += (rel / relLen) * evaluateVOLRadial(attr, normalizedAge) * dt; }
#endif
#if ORBITAL
    rel = rotationByEuler(rel, evaluateVOLOrbital(attr, normalizedAge) * dt);
#endif
position = renderer_VOLOffset + rel;
```

⇒ **旋转 / 推拉的对象是"位置相对轨道中心的矢量" `rel`**，且按 `ω·dt` 逐步旋转。
`rotationByEuler` 的欧拉→四元数合成式（同仓 `ParticleCommon.glsl`）已逐行照搬进
`ParticleAnimator.ts` 的 `rotEuler3()`。

⚠️ **已知分歧（如实标注，本引擎未采纳）**：galacean 的 review 结论是
gravity / FOL / drag / noise 的**当前帧位移不该被这一帧的公转扫着转**，应排除在旋转之外；
本引擎采用更简单的"整段位置一起绕中心转"。两者只在"轨道与外力同时非零"时才有差别，
本工程三个产物 orbital/radial 全为 0 ⇒ 当前无差异（`_regress/72_` 已钉住本引擎口径）。

### 4.9 ★ P2 依据：`Force over Lifetime` 是**加速度**

`docs.unity3d.com/560/…/PartSysForceOverLifeModule.html` 首句逐字：
*"Particles can be **accelerated** by forces (such as wind or attraction) that are specified in
this module."*；属性表 *"X, Y, Z — Force applied to each particle in the X, Y and Z axes."*
⇒ 质量按 1 处理，`Δv = a·dt`。`Randomize` = Two Constants / Two Curves 档下**每帧**重抽
（⚠️ 本引擎**未实现**逐帧重抽，见 `config.type.ts` 注释）。

**feng3d** `ParticleForceOverLifetimeModule.ts` 亦走 `addParticleAcceleration`（加速度，非速度）。

### 4.10 ★ P2 依据：三个 by-speed 共用**同一条** `rate` 归一化

feng3d 的 `ParticleColorBySpeedModule` / `ParticleSizeBySpeedModule` /
`ParticleRotationBySpeedModule` 三处**逐字同一个式子**：

```ts
const velocity = vec3Length(particle.velocity);
const rate = mathUtilClamp((velocity - module.range.x) / (module.range.y - module.range.x), 0, 1);
```

- `ColorBySpeed`：`color4Multiply(particle.color, gradient(rate), particle.color)` ⇒ **逐通道相乘**（含 alpha）；
- `SizeBySpeed`：`vec3Multiply(particle.size, size(rate), particle.size)` ⇒ **倍率**；
  `!separateAxes` 时 `size.y = size.z = size.x`；
- `RotationBySpeed`：`particle.angularVelocity += angularVelocity(rate)`，单位**弧度/秒**，
  默认值 `Math.PI / 4` —— 与解包实测 `RotationBySpeedModule.curve` 的默认常量 **0.7853981** 逐位吻合，互为佐证。
  `!separateAxes` 时 `v.x = v.y = 0`（只留 z）⇒ **序列化里主曲线 `curve` 就是 z 轴**
  （`x` / `y` 是另外两轴）。而 `SizeBySpeedModule` 的 `curve` 是 **x 轴**（`y` / `z` 另列）——
  由 `54_审计_MinMax与模块口径.txt` 的实测键名确认。

### 4.11 ★★ P2 依据：`InheritVelocity` 在 **Local 下整个被忽略**

`docs.unity3d.com/ScriptReference/ParticleSystem.InheritVelocityModule.html` 逐字：

> *NOTE: The inherit velocity module only has an effect if the Particle System is set to
> simulate in world space. **If the system is simulating in local space, this module is ignored.***

feng3d `ParticleInheritVelocityModule.ts` 有同一个守卫
（`if (main.simulationSpace === Local) return;`）。
`Current` 与 `Initial` 的差别（官方）：*Initial — 出生时加一次；Current — 每帧都加，发射器减速则粒子也减速*。
⇒ 本引擎把守卫折进 `ivOn`（`simulationSpace !== 1` 直接不生效）。

---


### 4.12 ★★ P3 依据：`Renderer` 模块（官方逐字 + Cocos 逐行）

**Render Mode**（Unity 手册 Renderer module，英文 2019.1 / 中文 2018.4 两版一致）：

| 档 | 官方逐字 | 本引擎 2D 管线下 |
|---|---|---|
| `0 Billboard` | *"The particle always faces the Camera."* | 现状（轴对齐 quad） |
| `1 Stretched Billboard` | *"faces the Camera but with various scaling applied"*；★ 2021.2+ 手册硬补充：*"particles are aligned to face the Camera **and also aligned to their velocity**. This alignment occurs **regardless of the Velocity Scale value** — even if Velocity Scale is set to 0, particles in this mode still align to the velocity."* | **长轴沿速度**（见 §4.13） |
| `2 Horizontal Billboard` | *"The particle plane is parallel to the XZ 'floor' plane."* | **投影面积为 0**（§4.12a） |
| `3 Vertical Billboard` | *"The particle is upright on the world Y-axis, but turns to face the Camera."* | **≡ Billboard**（§4.12a） |
| `4 Mesh` | *"rendered from a 3D Mesh instead of a Texture."* | 顶点 × 粒子直径（**不归一化**） |
| `5 None` | *"can be useful when using the Trails module, if you want to only render the trails and hide the default rendering."* | 不生成四边形，仍是模拟 |

**Render Alignment**：View *"Particles face the Camera plane."* / World *"aligned with the world axes."* /
Local *"aligned to the Transform component of their GameObject."* / Facing *"face the direct position of
the Camera GameObject."* / Velocity（新版本）*"Particles face in the direction of their velocity."*

**Pivot**（ScriptReference 逐字）：*"Modify the pivot point used for rotating particles. The units are
expressed as a **multiplier of the particle sizes, relative to their diameters**. For example, a value of
0.5 adjusts the pivot by the particle radius, allowing particles to rotate around their edges."*
⇒ **偏移 = `pivot × 粒子直径`**，且它是**旋转中心**（`pivot = 0` ⇒ 绕中心）。
⚠️ 解包实测 `m_Pivot` 36/39 是 `[0,0,0]`、S6 `hua01`/`hua02` 是 `[0, 0.5, 0]`、`bao` 是
`[0.02, 0.01, 0]` —— 正好对上"0 = 默认绕中心"（若 Unity 存的是绝对 pivot，默认就该是 0.5）。

**Sorting Fudge**：*"Bias of particle system sort ordering. Lower values increase the relative chance
that particle systems are drawn over other transparent GameObjects, including other particle systems.
**This setting only affects where an entire system appears in the scene — it does not perform sorting on
individual particles within a system.**"* ⇒ 本引擎里一个系统 = 一个 `THREE.Mesh`、排序由它的 `z` 定，
所以映射为 `mesh.position.z += −sortingFudge × fudgeToZ`。
★ 为什么必须显式给 `fudgeToZ`：Unity 把无量纲 fudge 折进排序距离的**具体公式未公开** ⇒ 缺省 `0` = 不生效。

`Min/Max Particle Size`：*"expressed as a fraction of viewport size. Note that this setting is only
applied when the Rendering Mode is set to Billboard."* ⇒ 视口高比例、**仅 Billboard 档**。

#### 4.12a ★★ 三种 billboard 的**世界基向量**（Cocos 逐行可对照）

`cocos/cocos-engine` v3.8.0 `editor/assets/chunks/builtin/internal/particle-common.chunk`
的 `computeVertPos()`：

```glsl
// Billboard：基 = 相机 right / up
vec3 camX = normalize(vec3(viewInv[0][0], viewInv[1][0], viewInv[2][0]));
vec3 camY = normalize(vec3(viewInv[0][1], viewInv[1][1], viewInv[2][1]));
// Horizontal：基 = 世界 (1,0,0) 与 (0,0,-1)   ⇒ 平面 = XZ 面（水平）✓
vec3 camX = vec3(1, 0, 0);
vec3 camY = vec3(0, 0, -1);
// Vertical：基 = 相机 right（水平分量）与 世界 (0,1,0)  ⇒ 竖直、绕 Y 转向相机 ✓
vec3 camX = normalize(vec3(cc_matView[0][0], cc_matView[1][0], cc_matView[2][0]));
vec3 camY = vec3(0, 1, 0);
```

**由此可直接推出本工程（相机 `position = (cameraX, camY, 0)`、看向 −Z、无俯角无偏航）的结果**：

* **Horizontal**：quad 的两条边分别沿世界 `X` 与 `Z`。视线沿 `−Z` ⇒ `Z` 方向那条边的**屏幕投影长度为 0**
  ⇒ 屏幕上是"宽度 = `sizeX`、高度 = **0**"的退化线段 ⇒ **不可见**（与 Unity 里"视线与平面共面"完全一致）。
* **Vertical**：两条边沿"相机 right 的水平分量"与"世界 `Y`"。本工程相机 right 本就水平 ⇒
  两条边的屏幕投影就是 `(1,0)` 与 `(0,1)` ⇒ **与 Billboard 逐位相同**。
  （Cocos 也把这两档写在同一个 `#if` 分支里。）
* 引擎实现用的是**统一的"单位半轴 × 投影"框架**（`renderModeAxes()`）：顶点 =
  `sgnA·uAx·sizeX + sgnB·uAy·sizeY`，其中 `uAx/uAy` 是两条世界基向量在**屏幕平面**（相机 right / up）上的投影。
  `pivot = 0` 且基 = 屏幕轴时，逐位退化成 P3 之前的实现。
* ⚠️ 相机基向量对整个系统取一次（本引擎无逐粒子 3D 位置），透视发散误差量级 ≈ `粒子半径 / 相机距离`
  （本工程 < 0.1%），已接受并记录。

> 📌 顺带记录：**feng3d 的 `ParticleSystemRenderer.ts` 是一具"纯数据壳"** ——
> `renderMode` / `alignment` / `pivot` / `sortingFudge` / `mesh` 字段都在，但注释明写
> *"这些字段目前没有引擎侧消费方（是 Unity API 的镜像壳）"* ⇒ **不能当实现参考**，
> 真正的几何只能看 Unity 手册 + Cocos 的着色器。

### 4.13 ★ P3 依据：Stretched 的**拉伸长度**（Cocos 逐行；⚠️ Unity 内部未公开）

`particle-common.chunk` 的 STRETCHED 分支：

```glsl
vec3 camRight = normalize(cross(pos.xyz - eye, velocity.xyz)) * s.x;
vec3 camUp    = velocity.xyz * velocityScale + normalize(velocity.xyz) * lengthScale * s.y;
```

⇒ **宽度 = `sizeX`**（垂直于速度）、**沿速度方向的长度 = `|v|·velocityScale + lengthScale·sizeY`**。
与手册两条描述逐字吻合：*"Stretches particles proportionally to their speed"*（速度项）＋
*"…proportionally to their current size along the direction of their velocity"*（尺寸项）；
手册另有一句 *"Setting this to 0 makes the particles disappear, having effectively 0 length."*
⇒ `lengthScale = 0` 且速度为 0 时长度确实是 0（**不**兜底成 size）。

⚠️ **存疑项**（如实标注）：
1. Cocos 在 STRETCHED 下把自转角 `rotEuler` 钉成 `vec3(0)`（不叠 `rotationOverLifetime`），
   本引擎**照此**实现；Unity 是否也如此**未知**（内部不公开）。当前无系统用该档 ⇒ 无差异。
2. 手册的 `Length Scale` 措辞是"*compared to its width*"（2020.2 俄文版 ScriptReference 更明确：
   *"the length of the particle compared to its width"*）⇒ 长度可能是 `width × lengthScale` 而非
   `sizeY × lengthScale`。本引擎取 `s.y`（与 Cocos 逐字同源），差异仅在同轴尺寸不等时出现。
3. `cameraVelocityScale`（按相机移动拉伸）**未实现**：本引擎相机位移由适配模块驱动、逐帧几乎恒定，
   且没有"相机速度"这个量。

### 4.14 ★★ P4 依据：`TextureSheetAnimationModule`（旧名 UVModule）

**字段全表**（`ParticleSystemModules.bindings.cs` @2021.3 与 6000.0 两版比对；6000.0 只是把
`MinMaxCurve` 换成 `MinMaxCurveBlittable` 包装，字段名与含义未变）：

```csharp
enabled, mode(Grid|Sprites), timeMode(Lifetime|Speed|FPS), fps,
numTilesX, numTilesY, animation(WholeSheet|SingleRow), rowMode(Custom|Random|MeshIndex),
frameOverTime, frameOverTimeMultiplier, startFrame, startFrameMultiplier,
cycleCount, rowIndex, uvChannelMask, spriteCount, speedRange(Vector2)
```

#### ① 三档 `timeMode`（手册属性表逐字）

| 档 | 手册逐字 | 本引擎实现 |
|---|---|---|
| `Lifetime(0)` | *"Sample frames using an Animation Curve over the lifetime of the particle."* | `⌊startFrame + frameOverTime(t)·cycles·nF⌋ mod nF`（**现状**） |
| `Speed(1)` | *"Sample frames based on the speed of the particle. A speed range specifies the minimum and maximum speed range for the frame selection."* | 见下面的 Remarks 口径 |
| `FPS(2)` | *"Sample frames based on the specified frames-per-second value."* | `⌊startFrame + 年龄·fps⌋ mod nF`（与寿命、速度**无关**） |

★★ **`speedRange` 的精确语义**（`ScriptReference/ParticleSystem.TextureSheetAnimationModule-speedRange`
的 **Remarks 逐字** —— 本档唯一的权威口径）：

> *"Specify how particle speeds are mapped to the animation frames. If a particle is travelling
> **slower than the minimum speed, it uses the first frame**. If a particle is travelling
> **faster than the maximum speed, then it uses the final frame**. For all other speeds, the
> particle chooses a frame based on how far between the minimum and maximum value its speed is."*

⇒ 实现 `fi = clamp(round(startFrame + rate·(nF−1)), 0, nF−1)`、
`rate = clamp((|v| − r0)/(r1 − r0), 0, 1)`。
⚠️ **它是"按当前速度静态选帧"，不是"速度越快播得越快"** —— 后者是中文社区流传的误解
（`juejin.cn/post/7031073592213241869` 的实测描述与 Remarks 完全一致：*"速度 0 ⇒ 播第 1 帧…
speed 大于 7 ⇒ 一直播最后一帧"*，且**不随时间推进**）。

★ **UI 在 Speed / FPS 两档下隐藏 `frameOverTime` 与 `cycles`**
（`UVModuleUI.OnInspectorGUI`：FPS 档只 `GUIFloat(fps)`、Speed 档只 `GUIMinMaxRange(speedRange)`）
⇒ 本引擎在这两档下**不消费** `frameOverTime` / `cycles`。

#### ② `animationType = SingleRow` + `rowMode`

* 手册逐字：*"Single Row (that is, each row of the sheet represents a **separate Animation
  sequence**)."* ⇒ 帧数从 `tilesX × tilesY` 变成 **`tilesX`**（只播一行）。
* `rowMode`（官方枚举 `ParticleSystemAnimationRowMode`）：

| 档 | 手册逐字 | 本引擎 |
|---|---|---|
| `Custom(0)` | *"Use a specific row of the Texture sheet for the animation."* | 用 `rowIndex` |
| `Random(1)` | *"Randomly select a row for each particle **when producing the animation**."* | **出生时**抽一次、终生不变 |
| `MeshIndex(2)` | *"Select a row based on the Mesh index assigned to a particle."* | ★ **恒第 0 行**（本引擎每套系统只用一个 mesh、无子网格概念）—— **实现边界**，非等价实现 |

#### ③ `startFrame`（**帧号**，不是归一化值）

UV 模块 UI tooltip *"Phase the animation, so it starts on a frame other than 0."* ＋ 手册
*"Allows you to specify which frame the particle animation should start on (useful for
**randomly phasing the animation on each particle**)."*
⇒ 逐粒子从这条 MinMaxCurve 取值、**加在帧号上再回绕**
（feng3d `round(startFrame + frameOverTime × 段数)` 同向；本引擎取 `⌊sf + …⌋ mod nF`）。

#### ④ ★★ `flipU` / `flipV` —— **Unity 已废弃**

`ScriptReference/ParticleSystem.TextureSheetAnimationModule-flipU` 逐字：

> *"Obsolete — **flipU property is deprecated. Use `ParticleSystemRenderer.flip.x` instead.**"*

⇒ 它与 P3 已实现的 `ParticleSystemRenderer.flip` 是**同一件事的旧别名**
（语义 = 手册 *"Mirror a proportion of the particles…"*，取值 `[0,1]`）。
**不要**再在 UV 模块里另立一条镜像通路 —— 本引擎只在 `renderer.flip` 缺省时把它当回退。
旁证：全包 13716 条启用 UV 的系统里 `flipU/flipV` **全部是 0.0**，而本工程 `niao` / `yun`
的 `ParticleSystemRenderer.flip` 是 `[1,0,0]` —— 美术用的就是 renderer 那一路。
（Cocos `texture-animation.ts` 也序列化了 `flipU/flipV/uvChannelMask`，但 setter 直接
`console.error('… is not supported!')` ⇒ 无实现可抄。）

#### ⑤ 未实现项（留档）

* `uvChannelMask`：全包 13716 条**全部**是 `−1`（= 全部通道），本引擎也只有一套 UV
  ⇒ 无信息可表达。
* `mode = Sprites(1)`：官方 UI 的 Sprites 档（Sprite 列表）—— 本作**无一使用**（全 Grid）。

### 4.15 ★★ P4 依据：`NoiseModule`

**字段全表**（`bindings.cs` @2021.3）：`enabled, separateAxes, strength`（`[NativeName("StrengthX")]`
⇒ 它就是 X 轴强度）、`strengthY, strengthZ, frequency, damping, octaveCount, octaveMultiplier,
octaveScale, quality, scrollSpeed, remapEnabled, remap*, positionAmount, rotationAmount, sizeAmount`。

#### ① 手册属性表**逐字**（Noise module @2021.3）

| 属性 | 逐字 |
|---|---|
| Separate Axes | *"Control the strength and remapping **independently on each axis**."* |
| Strength | *"A curve that defines how strong the noise effect is on a particle over its lifetime. Higher values will make particles move faster and further."* |
| Frequency | *"Low values create soft, smooth noise, and high values create rapidly changing noise. This controls how often the particles change their direction of travel, and how abrupt those changes of direction are."* |
| Scroll Speed | *"Move the noise field over time to cause **more unpredictable and erratic** particle movement."* |
| Damping | *"When enabled, **strength is proportional to frequency**. Tying these values together means the noise field can be scaled while maintaining the same behaviour, but at a different size."* |
| Octaves | *"Specify how many layers of overlapping noise are combined to produce the final noise values. Using more layers gives richer, more interesting noise, but significantly adds to the performance cost."* |
| Octave Multiplier | *"For each additional noise layer, **reduce the strength by this proportion**."* |
| Octave Scale | *"For each additional noise layer, **adjust the frequency by this multiplier**."* |
| Quality | *"Lower quality settings reduce the performance cost significantly…"*；Details 段：*"The settings on the Quality window control how many unique noise samples are generated. When using Medium and Low, less samples of Perlin Noise are used, and those samples are **re-used across multiple axes but combined in a way to try and hide the re-use**."* |
| Position Amount | *"A multiplier to control how much the noise affects particle positions."* |
| **Rotation Amount** | *"A multiplier to control how much the noise affects particle rotations, **in degrees per second**."* |
| **Size Amount** | *"A multiplier to control how much the noise affects particle **sizes**."* |
| Remap / Remap Curve | *"Remap the final noise values into a different range."* |

#### ② 叠层与滚动的**具体算法**（Cocos `cocos/particle/noise.ts` 逐行，本引擎照此）

```ts
// getNoise()：fBm —— 振幅 mul^k、频率 scale^k，最后除以 Σ振幅
let frequency = noiseFrequency, sum = noise(…× frequency, -1, 1);
if (octaves.x === 1) return sum;
let amplitude = 1, range = 1;
for (let i = 1; i < octaves.x; ++i) {
  amplitude *= octaves.y; frequency *= octaves.z; range += amplitude;
  sum += noise(…× frequency, -1, 1) * amplitude;
}
return sum / range;

// getNoiseParticle()：滚动 —— accSpeed = noiseSpeed × 系统时间，加在**频率缩放之前**的坐标上
this.accSpeed.set(this.noiseSpeed.x * this.dt, …);   // dt = particleSystem.time
const sampX = this.getNoise(this.point.z + this.accSpeed.x, this.point.y, this.point.x, …);
```

⇒ 本引擎：
`采样点 = (粒子本地坐标 + scrollSpeed × 系统时间) × frequency`；
叠层做在**势场**上（curl 是线性算子 ⇒ 先叠势场再取旋度，结果仍无源无汇）。

★★ **一个必须注意的数值陷阱**（2026-10-17 由 `_regress/74_` 的散度判据抓出来的真实缺陷）：
**每一层必须用与自身频率匹配的差分步长** `h_k = NOISE_EPS / f_k`。
固定步长时高频层的截断误差 `O(h²·f³)` 与层本身同阶 ⇒ 叠出来的高频层是"垃圾"，
场里出现明显源/汇（实测 4 层 `max|∇·N| = 2.17`，与场量级 4.15 同阶；逐层步长后回到 `5.3e-2`）。
**同理**：度量散度的那一步也要用匹配的步长，否则量到的是离散算子自己的误差。

⚠️ 一个有益的连带性质：`mul · scale = 0.5 × 2 = 1` 时**每层对 curl 量级的贡献相等**
（`d/dx[perlin(x·f)] = f·perlin'`，乘上振幅后为 `(mul·scale)^k`）⇒ 叠层**不放大**场量级
（实测 3.66 → 4.18）。

#### ③ ★ `sizeAmount` / `rotationAmount` 取"场里的哪一路"—— **Unity 未公开、Cocos 未实现**

Cocos 的 `noise-module.ts` 的 `animate()` **只有位置**一项：
`Vec3.add(particle.position, particle.position, noisePosition × dt)` ⇒ 无实现可抄。
本引擎的口径（**标注为存疑项**，写进 `config.type.ts` 与回归脚本）：

| 用途 | 取值源 | 理由 |
|---|---|---|
| 位置（`positionAmount`） | curl 场 x / y | 现状 |
| 自转（`rotationAmount`） | curl 场 **z** | 2D 渲染本就丢弃 z ⇒ 与可见位移**正交** |
| 尺寸（`sizeAmount`） | **第 4 路 Perlin 标量场** | ① Perlin 天然**有界**（实测 4 层叠层 ∈ [−0.46, 0.48]）⇒ `1 + 标量 × sizeAmount` 不会把尺寸乘成负数（curl 分量实测可达 3.7）；② 与可见位移不相关，避免"往哪边推就往哪边胀" |

#### ④ 未实现项（留档，理由必须写清）

* `quality = Low/Medium` —— 手册只说"少采样、跨轴复用并**设法掩盖**复用"，
  **具体复用方式与掩盖手法未公开** ⇒ 不敢凭猜实现（全包 Medium 100 条、本工程三个产物全 High）。
* `remapEnabled` / `remap` —— 数学上清楚（把噪声值过一遍曲线），但**全包 1663 条无一启用**。

#### ⑤ 全包用量（41996 个 `ParticleSystem`，`_work_UV与噪声/01_全包P4普查.py`）

`NoiseModule.enabled = 1663`：`octaves` **恒为 1**、`octaveMultiplier` 恒 0.5、
`octaveScale` 恒 2.0（全是模板值）；`scrollSpeed` 非零 **726**、`sizeAmount` 非零 **478**、
`rotationAmount` 非零 58、`positionAmount` 非零 1442、`separateAxes = true` **仅 4**、
`remapEnabled` **0**。
⇒ **octaves 是纯能力建设**；`scrollSpeed` / `sizeAmount` 才是真有用的两个。

## 5. 可直接读的关键文件（取文件命令已备）

```bash
# 官方规格（26 模块 UI + tooltip + gizmo）
gh api repos/Unity-Technologies/UnityCsReference/contents/Modules/ParticleSystemEditor/ParticleSystemModules/ShapeModuleUI.cs --jq .content | base64 -d
gh api repos/Unity-Technologies/UnityCsReference/contents/Modules/ParticleSystem/ScriptBindings/ParticleSystemModules.bindings.cs --jq .content | base64 -d
```
| 内容 | 路径 |
|---|---|
| Shape 采样（Cone/Circle/Box/Sphere/Hemisphere + ShapeUtils） | `feng3d-labs/feng3d:packages/particlesystem/src/shapes/*` 、`layabox/LayaAir:src/layaAir/laya/particle/d3/module/shape/*` |
| 形状模块与统一派发（含 position/rotation/**scale** 矩阵） | `cocos/cocos-engine:cocos/particle/emitter/shape-module.ts` |
| 全部模块（含 SubEmitters / by-speed / InheritVelocity） | `feng3d-labs/feng3d:packages/particlesystem/src/modules/*` |
| 渲染模式 / 对齐 / pivot | `feng3d.../modules/ParticleSystemRenderer.ts`、`cocos.../cocos/particle/enum.ts`（`ParticleRenderMode`/`ParticleAlignmentSpace`）、`cocos.../renderer/*` |
| 贴图序列帧 | `cocos.../cocos/particle/animator/texture-animation.ts`（`randomRow`/`rowIndex`/`SingleRow`；⚠️ `flipU/flipV/uvChannelMask` 序列化了但 setter 直接 `console.error('not supported')`）、`feng3d.../modules/ParticleTextureSheetAnimationModule.ts`（`frameIndex = round(startFrame + frameOverTime × 段数 × cycleCount)`） |
| 噪声 | `cocos.../cocos/particle/noise.ts`（`getNoise` 的 fBm 叠层 + `getNoiseParticle` 的 `accSpeed = speed × 系统时间`）、`cocos.../cocos/particle/animator/noise-module.ts`（**只把噪声加在位置上** ⇒ `sizeAmount`/`rotationAmount` 无实现可抄）、`feng3d.../modules/ParticleNoiseModule.ts` |
| 丝带 | `cocos.../cocos/particle/renderer/trail.ts` |
| 粒子 GLSL（vs/fs + 梯度取色） | `layabox/LayaAir:src/layaAir/laya/particle/d3/shader/*` |

---

## 6. 明确待定 / 存疑（实施前需定案）

1. **`radiusThickness` 的半径分布** —— ✅ **已定案（2026-10-16）：保持 √u（面积均匀）**。
   三份实现不一致 —— Cocos / feng3d = **线性** `ρ ∈ [R(1−th), R]`；LayaAir 内圆 = **√u**；
   **本引擎两处分支（Circle 随机 / Cone）本来就都是 √u** ⇒ 本轮"统一口径"这项工作**无需做**
   （复查结论见 `docx/TODO.md` §2.1）。理由：Unity 手册对该字段的表述是
   "proportion of the **volume**"，对圆盘而言"体积"= 面积 ⇒ √u 更贴合字面。
   留档：若将来拿到 Unity 实录帧的分布统计与此不符，再改。
2. **`angle` 的方向发散** —— ✅ **已定案（2026-10-16）**：Unity 的方向含 z 分量（锥轴 = ±Z），
   2D 平面渲染下**丢弃 z、只留平面分量**。实现上**保留本引擎既有的 2D 口径**
   `方向角 = 锥轴角 ± (ρ/R)·(angle/2)`（`startSpeed` 保持原量级）。
   ⚠️ 特意**不采用**"方向 = 纯径向（`v_xy ∝ pos·tan(angle/2)`）"的写法：那会把速度缩掉
   `tan(angle/2)`，S6 已验收的 `fx_touch2_huaban_2`（`startSpeed = 8`、`angle = 5°`）
   会整支变样（速度掉到 1/23）。详见 `ParticleAnimator.ts` 锥形分支的注释。
3. **SubEmitters**：feng3d 有模块但实现程度未核；Unity 的 sub-emitter 会实例化**另一个**
   particle system（我们 config 是扁平 mesh 列表）⇒ 若要做，需先设计 config 结构。
4. **Collision / Trigger / Lights / ExternalForces / LifetimeByEmitterSpeed**：开源界无实现可抄，
   且与现实壁纸（无物理场景）关系不大 ⇒ 建议明确"不复刻"，写进留档而不是偷偷略过。
5. **`three.quarks` 的 Unity 导入器**：README 宣称支持，但仓库里搜不到相关代码
   （可能只在它的编辑器/私有侧）⇒ 若要用它当参考，需先联系作者或找其导出侧代码。

---

## 7. 教程/原理类（讲得清"粒子的一生"，但无内部公式）

- Unity 官方手册逐模块：`docs.unity3d.com/Manual/PartSysShapeModule.html`（含 Cone 的
  Angle/Radius/Radius Thickness/Arc/Mode/Spread/Speed 与 "Scale: 改变发射器形状大小" 的逐字说明）
- `docs.unity3d.com/Manual/ParticleSystemModules40.html`（**旧版**模块参考，Cone 的
  "Base/Base Shell/Volume/Volume Shell" 四档 emitFrom 讲得比新版清楚 —— 对应我们的
  `type = 4/7/8/9`）
- 面向使用的入门教程（"按粒子一生的四个阶段记模块"）：
  `uhiyama-lab.com/en/notes/unity/unity-particle-system-vfx-guide`、
  `generalistprogrammer.com/tutorials/game-particle-effects-complete-vfx-programming-guide-2025`
- 中文模块清单（含 SubEmitter/TextureSheet 的说明）：CSDN `Particle System Modules (Shuriken)`

---

## 8. 建议的实施顺序（供后续排期，不含本次改动）

1. **P0 修锥形** ✅ **2026-10-16 已完成**：方位角 + `arc` + `m_Scale` 乘子（本轮"水平线"问题的根因）。
   `radiusThickness` 分布口径的"顺带统一"复查结论：**无需改动**（两处本来就是同一式子，见 §6.1）。
   落地与验证见 `docx/TODO.md` §2.0。
2. **P1 补形状族** ✅ **2026-10-16 已完成**：Sphere / Hemisphere（+ obsolete 的 shell 变体）与 Circle
   合流成"圆盘族"、方向 = 径向；`SingleSidedEdge`（+ `CircleEdge`）线段 + 本地 +Y 方向；
   `m_Scale` / `m_Position` / `m_Rotation` 提升为**全形状通用**并按 Unity `TRS` 顺序施加；
   `ConeVolume` 的轴向几何修正为"近盘在原点、沿轴张开"的截锥。
   落地与验证见 `docx/TODO.md` §2.7；本节 §4.4/§4.5 收录新增的三条权威依据。
3. **P2 补"按速度"与力** ✅ **2026-10-16 已完成**：Velocity 的 z/orbital/radial（+ offset/space）、
   Force、ColorBySpeed、SizeBySpeed、RotationBySpeed、InheritVelocity。
   依据见本节 §4.7~§4.11；落地与验证见 `docx/TODO.md` §2.8 与 `_regress/72_回归_按速度与力.ts`（33 断言）。
4. **P3 补渲染侧** ✅ **2026-10-17 已完成**：renderMode 5 种（+ None）、alignment 五档、
   pivot、sortingFudge、flip、allowRoll、min·maxParticleSize、Mesh 顶点集。
   依据见本节 §4.12 / §4.13；落地与验证见 `docx/TODO.md` §2.9 与 `_regress/73_回归_渲染侧.ts`（34 断言）。
5. **P4 补 UV/Noise 细节** ✅ **2026-10-17 已完成**：UV 的 `timeMode` 三档 + `fps` + `speedRange` +
   `startFrame` + `animationType=SingleRow`/`rowMode`/`rowIndex` + `flipU·flipV`（并入 `renderer.flip`）；
   Noise 的 `octaves`/`octaveMultiplier`/`octaveScale`（势场 fBm 叠层，**逐层步长随频率自适应**）、
   `scrollSpeed`、`sizeAmount`、`rotationAmount`、`separateAxes`/`strengthY/Z`。
   依据见本节 §4.14 / §4.15；落地与验证见 `docx/TODO.md` §2.10 与 `_regress/74_回归_UV与噪声.ts`（65 断言）。
6. **P5（可选）SubEmitters**：需先定 config 结构。
7. **明确不复刻**：Collision / Trigger / Lights / ExternalForces / LifetimeByEmitterSpeed（留档说明）。
