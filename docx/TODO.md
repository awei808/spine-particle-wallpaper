# TODO

> 最后更新：2026-10-16

## 1. 自定义事件系统

- 支持自定义事件和修改项目自带的事件
    - 简述：提供事件编号、触发条件、触发的spine动作、触发的粒子效果、念白、语音文件，就可以让壁纸项目触发自定义事件
    - 允许对当前事件增和删，修改当前事件的所有字段
    - 触发条件支持事多件编排，以及默认的几种触发条件（特定时间段的问候、待机无互动一定时间、触摸）
    - 触发的spine动作、触发的粒子效果字段支持随机触发
    - 前置条件：
        - 将当前散在各个代码文件中的事件五要素（条件、spine动作、粒子、念白、语音）整合至单个文件
        - 支持自定义触发条件
        - 增加事件五要素的合法性校验
        - 语音文件支持多种类型的音频文件
        - 触摸热区自定义和热区重叠的触发逻辑完善
        - 档案功能完善，显示触发的粒子效果
        - 除五要素外的事件字段设计，事件族，优先级等
    - 自定义事件示例（以盛夏游乐场为例）：
        - |事件编号|触发条件|触发的spine动作|触发的粒子效果|念白|语音文件|备注
          |Custom-01|点击触摸热区“手”|touch1|null|“虽然会妨碍战斗，但在这之外的时间，牵着手也不错。”|Asuna_Touch_Hand_05.ogg|需先自定义热区“手”|
          |custom-情人节问候|2月14日且符合问候触发条件|greet|null|“情人节快乐。锁定你的心。”|Asuna_Valentine_Greet.ogg|需处理好事件的触发优先级|
          |custom-晚安问候|每天23点以后至次日4点且回到桌面|random|null|“晚安，早点睡吧，我等你”|null|没有语音文件；random代表随机触发|

---

## 2. 粒子系统大更新（2026-10-16 定案）

> 背景、覆盖矩阵、权威实现仓库与可直读文件路径 → `docx/RESEARCH_粒子系统复刻参考.md`。

### 2.0 总原则：不打补丁、并入大更新 —— ★ 但 P0「修锥形」已于 2026-10-16 先行落地

**总原则不变**：粒子缺陷随本轮"粒子系统大更新"的模块重写自然消失，不在旧口径上做局部修补。

**唯一例外（2026-10-16 调整执行顺序）**：P0「修锥形」的根因是**纯几何 bug**
（引擎锥形分支缺方位角 ⇒ 粒子排成一条线），与将来的模块体系无耦合，且它把 S8 动作特效的
观感完全挡住（实测"一条水平的线"，见 RESEARCH §4.1）⇒ 先修掉，避免后续所有特效验收
都被同一个假象干扰。

**已落地**：

- ✅ 引擎 `src/animator/ParticleAnimator.ts` 锥形分支（4/8）：
  **XY 平面方位角 + `arc`/`arcMode` 共用 + `m_Scale` 各轴缩放**；方向发散口径不变。
- ✅ 数据层撤掉预乘：`_work_星语心恋/190_生成S8动作特效.py` 改为下发 `radius = 7` +
  `boxX/boxY = 150`（原实现在数据层预乘 150，引擎接入乘子后会乘两次）。
- ✅ 数值回归 `_regress/70_回归_锥形形状采样.ts`：S9 工程 **18/18**、S8 产物 **13/13**。
- ✅ 实证（`_work_星语心恋/out/191_锥形修复/`，同参数 A/B 截图 + 粒子真值）：

  | | x 跨距 | y 跨距 | stdY/stdX | 方位角扇区 |
  |---|---|---|---|---|
  | 修复前 `glow` | 837 | **52.7** | 0.037 | 4/12 |
  | 修复后 `glow` | 739 | **709** | 0.73 | 9/12 |
  | 修复前 `glow_1` | 799 | **26.4** | 0.024 | 4/12 |
  | 修复后 `glow_1` | 784 | **529** | 0.53 | 10/12 |

  ⇒ 半径量级守恒（x 跨距基本不变）、由"一条线"变为平面扇形。

**仍明确不做**：

- ❌ 数据层权宜路（把 `angle≈90` 的锥形直接下发成 Circle `shape.type=10`）。
- ❌ 其它任何"单模块打补丁"式改动。

> ⚠️ **连带影响（待实测复核）**：S6 唯一一支锥形 `fx_touch2_huaban_2`（`radius=1.3`、
> `m_Scale=(3,3)`）此前被引擎整条忽略 `m_Scale` ⇒ 本轮起半径 `1.3 → 3.9`。
> 按官方语义这是**修正**，但该特效已验收过的观感会变，须实测确认。

### 2.1 `radiusThickness` 的半径分布 → 用 **√u（面积均匀）**

> ★ 2026-10-16 核查（本轮 P0 的"顺带评估"项）：**不需要"统一"** —— 引擎里
> `Circle` 随机分支与 `Cone / ConeVolume` 分支用的**已经是同一个式子**
> `rad * (1 - th + th * Math.sqrt(r.next()))`（`ParticleAnimator.ts` 两处，
> 见 `_regress/70_回归_锥形形状采样.ts` 的 [3] 用例：`te = 1` 的 ρ 中位数 ≈ 0.71R
> = R/√2，线性口径会是 0.5R）。本轮只把这个事实写进代码注释与 `config.type.ts`
> 的字段说明，免得下次又被当成"两处口径不一致"。

- 口径：`ρ = R · (1 − th + th·√u)`，其中 `u = rand()`、`th = radiusThickness`、`R` = 形状半径。
  `th = 0` ⇒ 只取外缘；`th = 1` ⇒ 填满（圆盘内面积均匀）。
- 与引擎现状**一致**（`src/animator/ParticleAnimator.ts`：Circle 分支 `rad * (1 - th10 + th10 * Math.sqrt(r.next()))`、
  Cone 分支 `rhoMag` 同式）⇒ **保持不改**。
- **不采用** Cocos / feng3d 的线性口径（`ρ ∈ [R(1−th), R]`）。
- 理由：Unity 手册对该字段的表述是 "proportion of the **volume**"，对圆盘而言"体积"= 面积 ⇒ √u 最贴合字面。

### 2.2 2D 下 `angle` 的方向发散 → 固定 **z = 0**

- Unity 的锥形发射方向 = "底面点 → 锥面点"，含 z 分量（锥轴 = ±Z）；本引擎是 2D 平面渲染，z 无意义。
- 定案：方向**只取 XY 平面内的分量，z 恒为 0**。
  ⇒ `angle` 表现为"方向相对锥轴的**平面**张角"；`length` 不参与方向发散（其 z 分量被丢弃）。

### 2.3 Sub Emitters → **要做**

- 纳入本轮大更新实现。
- 实施前需先设计 config 结构：Unity 的 sub-emitter 语义是**实例化另一个 particle system**，
  而当前 config 是扁平 `meshes` 列表 ⇒ 需新增"子发射器引用 + 触发时机（Birth / Death / Collision / Trigger 等）"的表达方式。
- 参考：`feng3d-labs/feng3d` 的 `packages/particlesystem/src/modules/`（含 SubEmitters 模块，**实现程度待核**）
  + Unity 官方手册对应页。

### 2.4 明确**不复刻**（留档，不再默默略过）

以下模块**明确不做**。理由：开源界无实现可参照（Unity 内核闭源）+ 现实壁纸场景无此需求。
**将来若真要用到，再回头去找参考代码仓库**（候选已列在 `RESEARCH_粒子系统复刻参考.md` §2：
`Unity2Urho`、`hikipuro/tea.js`、`meta4d-me/m4m-engine`、`three.quarks` 等）。

- Collision
- Trigger
- Lights
- External Forces
- Lifetime By Emitter Speed

### 2.5 实施顺序

沿用 `RESEARCH_粒子系统复刻参考.md` §8 的 P0~P5 排期（P5 即 SubEmitters），此处不重复。

- ✅ **P0 修锥形**：2026-10-16 完成（方位角 + `arc` + `m_Scale`），见 §2.0。
- ⬜ **P1** 补形状族（Sphere / Hemisphere / Edge / `position`/`rotation` 偏移）
- ⬜ **P2** 按速度与力（Velocity z/orbital/radial、Force、ColorBySpeed、SizeBySpeed…）
- ⬜ **P3** 渲染侧（renderMode 5 种、alignment/pivot/sortingFudge）
- ⬜ **P4** UV / Noise 细节（rowMode、noise sizeAmount/scrollSpeed/octaves）
- ⬜ **P5** SubEmitters（需先定 config 结构）
