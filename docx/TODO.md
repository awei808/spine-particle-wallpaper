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

> ⚠️ 上表是在 **`nodeRotZ` 修正之前**测的（当时数据层把节点旋角当成了 0）：
> 它证明"方位角采样"本身已修好，但**朝向基准错了 170°** —— 见下面的 §2.0b。

**仍明确不做**：

- ❌ 数据层权宜路（把 `angle≈90` 的锥形直接下发成 Circle `shape.type=10`）。
- ❌ 其它任何"单模块打补丁"式改动。

> ⚠️ **连带影响（待实测复核）**：S6 唯一一支锥形 `fx_touch2_huaban_2`（`radius=1.3`、
> `m_Scale=(3,3)`）此前被引擎整条忽略 `m_Scale` ⇒ 本轮起半径 `1.3 → 3.9`。
> 按官方语义这是**修正**，但该特效已验收过的观感会变，须实测确认。

### 2.0b ★★ 2026-10-16 夜间复核：挂点 / 半径 / 朝向 三问

用户实测反馈"粒子盖到人物头顶（游戏里只在垂下那条腿的左右）"并怀疑 `arc` 不是 230°。
据此做了三项独立复核（解包数据链 + 客户端 Lua + Unity 官方源码 / 三方实现），结论：

#### ① `arc = 230°` —— **正确**，用户猜的 130° 不成立

- prefab 里 `ShapeModule.arc.value = 230.0`，**raw 字节 `00 00 66 43`**（IEEE754 = 230.0），
  与前邻 `radius` 结构严格相距 56 B（偏移对齐，非读错位置）；同 raw 内**搜不到** `2.30` 或 `130.0` 的字节。
- **单位是"度"**：本游戏 = Unity **2021.3.34f1**，其 `ParticleSystemModules.bindings.cs` 原文
  *"Note that you should specify the value in degrees."*（旧 Unity 5.6 文档写成弧度，是历史错误）；
  全包普查 `art_prefabs.ab` 的 4929 条 arc：**4905 条 > 2π**、全部 ∈ [0, 360]、
  常见值 360 / 180 / 120 / **230** ⇒ 只可能是度。
- `360 − 230 = 130`：**130° 是"未发射的缺口"**，不是弧本身。用户观察到的"只有 130°"很可能是把补角当成了弧。

#### ② 挂点位置 —— **正确**

- 挂点 = **角色 prefab** `souldress_asuna` 的 `Point_Root`（另一个同名节点在**背景** prefab 里，
  带 `Canvas + GraphicRaycaster`，是"角色 UI 单元"的父节点，不是特效挂点）；
- 画布位置 `(197.5635, −754.3698)`，scale 链 `0.86 × 0.1267 × 3.67 = 0.39989055`；
  再叠特效 prefab 内 `glow` 的 `(94, 1829)` ⇒ 粒子落点 `(235.153, −22.970)` 画布 / `(238.68, −23.31)` 世界。
- 交叉校验：同一链条算 S9 得 `0.5700`，与既有实机标定 `0.560~0.570` 吻合（说明模型本身被实测背书过）。
- ⚠️ **如实留档的残留不确定性**：客户端 Lua 把 `self.goSpine` 交给
  `GameEntry.Effect:PlayUIMountPointEffect(...)`（直读），**C# 内部是否再 `Find("Point_Root")`
  无法证实**（项目只有 `global-metadata.dat`、缺 `libil2cpp.so`）；
  `CfgEffectTable[9008130].IsScale = true` 的语义同样只在 C# 里，**查不到**。

#### ③ ★ 朝向 —— **发现真 bug：`nodeRotZ` 应为 170°，旧版硬编码 0**

- `glow` / `glow (1)` 的 `m_LocalRotation = (0, 0, 0.9961947202682495, 0.08715587854385376)`
  ⇒ 绕本地 **+Z 旋转 170.0°**（`2·atan2(z, w)`）。挂点链上的两个 `Point_Root` 都是单位四元数，
  **唯独这两个粒子节点不是** —— 旧注释想当然写成"单位四元数 ⇒ nodeRotZ = 0"。
- 后果：230° 扇形整体**转错 170°**，覆盖区从「左—下—右」翻成「右—上—左」⇒ **粒子盖到头顶**
  （与用户观察逐字吻合）；`velocity.y = −25…−2`（本地向下）在屏幕上也从"向下飘"变成"向上飘"。
- 已修：`190_生成S8动作特效.py` 改为从 `rec["localRotation"]` 用 `quat_z_deg()` 读出
  （**与 S6 产线 `21_生成配置.py` 同口径**），自检加断言 `≈170°`。
- 实证（`_work_星语心恋/out/191_锥形修复/191_挂点与朝向_0度vs170度.png`，离线采样打点）：

  | | 粒子像素 y 范围 | 含义 |
  |---|---|---|
  | 旧 `nodeRotZ = 0` | **[−9, 833]** | 触到画面顶 ⇒ 头顶有粒子（bug 现场） |
  | 新 `nodeRotZ = 170` | **[181, 972]** | 最高点落到头下方 ⇒ 只在身下/腿部区域 |

#### ④ 连带查明的两条引擎口径差异 —— ★ 用户拍板：**维持现状、不调整**（详见 §2.6）

- Unity 的 `angle` 是**半角**（官方 gizmo：`farRadius = nearRadius + range·tan(angle)`；90° = 平盘）
  ⇒ 现行 `spread = (ρ/R)·(angle/2)` 约为真值的一半；
- 挂点为**单位四元数**时，锥轴（本地 +Z）投影**退化成一个点** ⇒ Unity 语义下屏幕出射方向是**纯径向**，
  现行做法是"绕 `emitDir` 张开"。

两条都只影响 `startSpeed ≠ 0` 的系统（**S8 本特效 `startSpeed = 0` ⇒ 观感不受影响**），
且都是 **S9 阶段人工调出来的口径** ⇒ 改动会让 S9 / S6 已验收的表现整体变化，**故本轮不动**；
技术留档见 §2.6（含"将来若要统一"的正确做法）。

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
- ✅ **P1 补形状族**：2026-10-16 完成（Sphere / Hemisphere / Edge / `m_Position`·`m_Rotation` 全形状化
  + ConeVolume 轴向几何修正），**当晚三站观感验收通过**，见 §2.7。
- ✅ **P2 按速度与力**：2026-10-16 完成（Velocity z/orbital/radial/offset/space、Force、
  ColorBySpeed、SizeBySpeed、RotationBySpeed、InheritVelocity），见 §2.8。
- ✅ **P3 渲染侧**：2026-10-17 完成（renderMode 5 种 + None、alignment 五档、pivot、
  sortingFudge、flip、allowRoll、min·maxParticleSize、Mesh 顶点集），见 §2.9。
- ⬜ **P4** UV / Noise 细节（rowMode、noise sizeAmount/scrollSpeed/octaves） → ✅ 2026-10-17 完成，见 §2.10
- ⬜ **P5** SubEmitters（需先定 config 结构）

### 2.6 已查明但**维持现状**的引擎口径（2026-10-16 夜 · 用户拍板）

> ★★ **结论（2026-10-16 用户拍板）：以下两条保持现有实现，不调整。**
> 理由：它们都是 **S9 阶段人工调出来的口径**，改动会让 S9（以及 S6）已验收的表现整体变化；
> 而 S8 动作特效 `startSpeed = 0`，这两条对它**毫无影响**。
> ⇒ 本节只作**技术留档**：现状与 Unity 原始语义的差异是**已知且刻意**的，不是漏实现。
> 将来若要重做口径，必须连同 S9 / S6 一起重新标定，不能单独改引擎。

1. **`angle` 是半角**：Unity 原始语义 `θ = atan((ρ/R)·tan(angle))`；
   本项目现行实现 `(ρ/R)·(angle/2)`（小角下**约为真值的一半**）。
   - 若改会动到：`qiqiu`（angle 10°）、`niao`（11.86°）、S6 `fx_touch2_huaban_2`（5°）。
   - **S8 动作特效 `startSpeed = 0` ⇒ 不受影响。**
   - 出处：`ConeFrustrumHandle.cs@2021.3.34f1`（`farRadius = nearRadius + range·tan(angle)`、角度上界夹 90°）
     + 手册 "a value of 90 produces a flat disc" + feng3d / cocos 闭式 `dir = normalize(r̂·(ρ/R)·tan(angle) + ẑ)`。
2. **挂点为"单位四元数"时的出射方向**：Unity 原始语义下锥轴 = 本地 +Z，投影到屏幕**退化成一个点**
   ⇒ 屏幕速度方向应为**纯径向**（从挂点指向粒子）。
   本项目现行实现是"绕 `emitDir` 张开"（`emitDir` 对纯 Z 旋转是退化缺省 `[0,1]`）——
   **维度上不忠实，但这是 S9 阶段调出来的观感**。
   - 若改会动到：所有 `startSpeed ≠ 0` 的锥形系统（`qiqiu` / `niao`）。
   - **S8 动作特效 `startSpeed = 0` ⇒ 不受影响。**
   - 将来若统一，正解 = 形状本地按 Unity 语义采样 `(pos3, dir3)` → 过一次局部→世界变换 → 最后丢掉 z
     （这样"单位四元数"与"`(-90,0,0)`"两类挂点可共用一套代码）。
3. **`radiusThickness` 的**密度**口径官方未定义**（只定义支撑区间 `[R(1−t), R]`）：
   cocos = 线性、LayaAir = √u、本项目 = √u ⇒ **维持 √u**（见 §2.1）。

### 2.7 ✅ P1「补形状族」已落地（2026-10-16）

> 报告：`_work_形状族普查/REPORT_P1形状族_2026-10-16.md`（含全包普查、逐颗改前/改后对照）。
> 回归：`_regress/71_回归_形状族补充.ts`（21 断言）+ `_regress/70_` 更新（24 断言）。
> ✅ **观感验收已通过**（2026-10-16 23:27，三站实测，见本节末尾）。
> ⬜ **仍未部署 WE、未发布**（与 P0 同：先落源码 + 回归 + 验收，部署另起）。

**全包普查（41996 个 `ParticleSystem`，`art_prefabs.ab` + `14_effect`）给出的形状族用量**：
`Box` 3603 / `Cone` 2957 / **`Sphere` 1163** / `ConeVolume` 581 / **`Hemisphere` 535** /
`Circle` 526 / `BoxEdge` 73 / **`SingleSidedEdge` 59** / `Donut` 56 / `BoxShell` 32 /
`Rectangle` 19 / `Mesh` 18 / `SpriteRenderer` 2（**启用**支数）。
⇒ 本轮的四个缺口正好是"第 3、第 5、第 7 大形状族 + 轴几何"，`radiusMode` 全为 Random、
`radiusSpread` 全为 0（Edge 只需实现 Random 即覆盖 59/59）。

#### 做了什么（`src/animator/ParticleAnimator.ts`）

1. **圆盘族归一**：`Sphere(0)` / `Hemisphere(2)`（+ obsolete 的 `SphereShell(1)` / `HemisphereShell(3)`）
   与 `Circle(10)` **共用一支**。依据：Unity 手册 *"Sphere, Hemisphere, and Circle have the same
   properties."*；且半球 `{ρ ≤ R, z ≥ 0}` 的正交投影**就是整个圆盘**（`(x,y)` 分布与整球同）
   ⇒ 2D 下三者位置口径相同。
   ⚠️ 之前它们落到**锥形兜底**：位置碰巧同式，但会多吃一份"锥形 `angle/2` 方向发散"
   （`angle` 对球/半球根本不在 UI 里，是序列化残留）。
2. **方向 = 径向**（圆盘族 + `Circle`）：手册逐字 *"a Sphere emits particles **outward in all
   directions**"*、*"Circle … move **only in the plane of the circle**"*；Cocos
   `Vec3.normalize(dir, pos)` / feng3d `dir = (cos a, sin a, 0)` 同口径（单位方向 ⇒ **速度量级不变**）。
   ⚠️ 顺带补上了旧 `Circle` 分支**从未消费 `startSpeed`** 的漏（它以前只靠 `VelocityModule` 给速度）。
3. **`SingleSidedEdge(12)` / `CircleEdge(11)`**：线段沿**本地 X**（半长 = `radius`，在 `[−R, +R]` 均匀）、
   方向沿**本地 +Y**（手册 *"The particles move in the emitter object's **upward (Y) direction**."*；
   几何同 feng3d `ParticleSystemShapeEdge.ts`）。`CircleEdge` 折叠为 `Circle`（官方标注 obsolete）。
4. **`m_Scale` / `m_Position` / `m_Rotation` 从"仅 Box"提升为全形状通用**，顺序严格按 Unity
   `ShapeModuleUI.OnShapeToolGUI` 的 `TRS`（`emitterMatrix = TRS(position, Euler(rotation), scale)`）
   ⇒ **先各轴缩放 → 再旋转 → 最后平移**（旧写法把 `nodeRotZ` 折进方位角 = "缩放最外层"，
   仅在等比时等价）。`rot` = `m_Rotation.z + nodeRotZ`，同时写进 `Particle.localRot`（供 `VelocityModule`
   的本地 x/y 折算，与 Box 同口径）。
5. **`ConeVolume(8)` 的轴向几何修正**：锥是**近盘（半径 = `radius`）在原点、沿轴张开到
   `radius + length·tan(angle)`** 的截锥，体积内按截面面积取点（`pdf ∝ rad(t)²`，闭式反解）。
   依据：Unity 官方 gizmo 源码 `ConeFrustrumHandle.cs` 的头注释（*"'radius' is **near-radius at
   start of cone frustrum**"*）+ `farRadius = |range·tan(angle)| + nearRadius`；feng3d 同向。
   ❌ 旧实现当成"顶点在发射器、底面在 `length` 处"的**反向锥**（`ρ ∝ t/H`），是把
   *"锥面半径 ∝ 沿轴距离"* 套在了一个顶点位置弄错的锥上。

#### 对三个产物的**实际影响**（`git stash` 停靠旧源码 + 同种子各采样 3000 颗逐颗对照）

| 产物 | 记录 | 结果 |
|---|---|---|
| S9 | `qiqiu`/`yun`/`niao` 之外的 7 支 | **逐位零变化** |
| S9 | **`niao`**(ConeVolume) | ★ **几何改变**：`mean|Δp| = 455 px`（max 1239）；半径分位 `p50 984→850`、`p90 1211→1275`；速度方向直方图 L1 = 0.56（速度量级不变） |
| S6 | **`fx_chat_lizi_san`**(Hemisphere) | ★ **仅方向改变**（锥形 ±45° 扇 → 径向散射）；位置、速度量级逐位不变；方向直方图 L1 = 1.31 |
| S6 | `yuan_glow`(Circle) | 位置**重新随机**（分布不变：半径分位 208.7/426.6/707.5 → 210.5/421.0/714.8）。原因：`Circle` 这次才首次消费 `startSpeed` ⇒ 每颗粒子多耗 1 个随机数。该组 `startSpeed ≡ 0` ⇒ **观感不变** |
| S8 | 全部 3 支 | **逐位零变化** |
| S6 | 其余 Box/Sphere/Cone 记录 | **逐位零变化** |

⇒ 需要**人工复核观感**的只有 2 支：S9 `niao`、S6 `fx_chat_lizi_san`。

#### 仍未实现（已知缺口，落到锥形兜底 = 被当成圆盘）

`17 Donut`(56) / `16 BoxEdge`(73) / `15 BoxShell`(32) / `18 Rectangle`(19) / `6 Mesh`(18) /
`20 SpriteRenderer`(2)。它们各有自己的几何（Donut 要 `donutRadius`、BoxEdge/BoxShell 要按盒体 +
`boxThickness`、Mesh/Sprite 要网格数据），**不顺手塞进 Box/圆盘** —— 那只会把"明确的未实现"
变成"看起来像实现了"。`_regress/71_` 的 [7] 已**钉住现状**（位置仍与锥形兜底逐位相同）。

#### 数据层未下发的字段（非引擎缺口，留档）

`radius` 的 MinMaxCurve 模式（全包普查里 `radiusMode` 恒 0 = Random、`radiusSpread` 恒 0）、
`m_Scale.z` / `m_Position.z`（2D 下 z 无意义）、`arcSpread`、
`randomDirectionAmount` / `sphericalDirectionAmount` / `randomPositionAmount` / `alignToDirection`
（这几个在 Sphere/Box 上确有非零值，属 Shape 模块的"方向修饰"族，归 P2 或单独一批）。
Edge 的方向取"本地 +X 转 90°"，用的是本引擎既有的"屏幕内平面朝向"口径（`nodeRotZ`）；
若要更严格需数据层额外下发**本地 +Y 的投影**（`emitUp`），与 §2.6 第 2 条同源。

#### ✅ 观感验收通过（2026-10-16 23:27，用户在上面的三站里逐项看过）

三个本地预览站都装了 P1 的 bundle（`dist/bundle.js`，md5 `629093f6…`），服务脚本 = 通用件
`_work_芙丽希娅_蝶语吟花/25_本地服务器.py`（`25_ … 8897 --dir <proj>`）/ S8 的 `20_本地预览服务器.py`：

| 站 | 工程目录 | 端口 | 验收结论 |
|---|---|---|---|
| S9 | `12_探针_去灰线`（**不是** `10_wallpaper_engine` —— 后者是旧快照） | 8897 | `niao` 新截锥几何的出生分布**可接受** |
| S8 | `_work_星语心恋/step2_web` | 8898 | 零变化确认（touch1 特效正常） |
| S6 | `_work_芙丽希娅_蝶语吟花/step2_web` | 8899 | `fx_chat_lizi_san` 径向散射 OK、`yuan_glow` 无异样 |

⇒ **P1 判定完成**（含 §2.7 表格里那两处"观感会变"的记录）。
⬜ **仍未部署 WE、未发布**：下次走部署（S9 用 `_work_工坊更新/10_部署bundle到WE工程.py`、
S8 用 `_work_星语心恋/19_部署step2到WE.py`）时会把 P1 一并带上；届时需按惯例在 WE 里重载并复核。


---

### 2.8 ✅ P2「补按速度与力」已落地（2026-10-16）

> 报告：`_work_按速度与力/REPORT_P2按速度与力_2026-10-16.md`（含全包普查 41996 个 ParticleSystem
> 的模块分布 + 三个产物 prefab 的逐条取值）。
> 依据：`docx/RESEARCH_粒子系统复刻参考.md` §4.7~§4.11（官方手册逐字 + feng3d + galacean PR #3049）。
> 回归：`_regress/72_回归_按速度与力.ts`（**33 断言**，四个工程 config 全绿）。

#### 落地了什么

| 模块 | 实现要点 | 依据 |
|---|---|---|
| `VelocityModule.z` | 记进 `p.vz` / `p.z`，**不产生屏幕位移**（2D 渲染丢 z），只进入 `\|v\|` | 官方属性表 §4.7 |
| `VelocityModule.orbitalX/Y/Z` | **弧度/秒**，绕 `orbitalOffset` 中心**旋转位置**（`rotEuler3` 四元数合成照搬 galacean） | §4.8 |
| `VelocityModule.radial` | `rel += normalize(rel)·radial·dt`（远离为正、朝向为负） | §4.8 |
| `VelocityModule.space` | 0 = Local（按节点旋角折算，缺省 = 现状）、1 = World | §4.7 |
| `ForceModule` | **加速度**，`Δv = a·dt`，半隐式欧拉；`space` 两档 | §4.9 |
| `ColorBySpeed` / `SizeBySpeed` / `RotationBySpeed` | 共用 `rate = clamp((\|v\|−r0)/(r1−r0),0,1)`；颜色**逐通道相乘**、尺寸是**倍率**、旋转是**弧度/秒且取负号** | §4.10 |
| `InheritVelocity` | `Initial` 出生加一次 /`Current` 每帧跟随；★ **`simulationSpace ≠ World` 时整个忽略**（官方逐字守卫） | §4.11 |

★ 全部新字段**可选且缺省关闭** ⇒ 旧 config 逐位无影响（`72_` 第 [1] 组钉住，含"关闭模块的残留值不生效"）。

#### ★★ 对三个产物：**零观感变化**（已逐条取证，不是估计）

`_work_按速度与力/02_三产物P2模块取值.py` 把 S9 / S8 / S6 三个背景 prefab + 三支动作特效 prefab
下的**全部 39 个粒子节点**的 P2 字段全量打出来了，结论：

| 产物 | 真正"启用且非零"的 P2 项 | 影响 |
|---|---|---|
| S9 背景（11 节点） | 无（`niao` 的 `VOL.z` 是 0 值曲线） | 0 |
| S8 背景（2 节点） | `trail01` 的 `VOL.z = rand[0,1]` | **0** —— z 在 2D 下不入画，且该系统无 by-speed 模块 |
| S8 动作特效（3 节点） | 无 | 0 |
| S6 背景（14 节点） | 无 | 0 |
| S6 动作特效 chat / touch2（9 节点） | 无（chat 的 `VOL.radial = rand[1,5]` 是**模块关闭时的残留值**） | 0 |

⚠️ 全包普查里那些"非零"的 `SizeBySpeed.curve`(0→1) / `RotationBySpeed.curve`(π/4) /
`ColorBySpeed.gradient` 是 **Unity 模板默认值**，出现在**每一个**粒子节点上，
模块 `enabled` 一律为 `false` ⇒ 按本项目一贯判据"**enabled 才算数**"全部不算。

另：三个产物的 `moveWithTransform` 全为 **0（Local）** ⇒ `InheritVelocity` 即便下发也不会生效。

#### 全包普查（41996 个 ParticleSystem，`01_全包P2模块普查.py`）

| 模块 | enabled | enabled 且非零 |
|---|---|---|
| Velocity.z | 4725 | 711 |
| Velocity.orbital | 4725 | 1441 |
| Velocity.orbitalOffset | 4725 | 169 |
| Velocity.radial | 4725 | 1026 |
| Velocity.space=World | 4725 | 101 |
| Force | 189 | 171 |
| InheritVelocity | 87 | 80 |
| ColorBySpeed | 1 | 1 |
| SizeBySpeed | 6 | 6 |
| RotationBySpeed | 52 | 52 |

模拟空间分布：**Local 41560 / World 436**。
⇒ P2 对本工程**当前三个产物是纯能力建设**，但对"将来复刻别的皮肤/特效"是实打实的（尤其 Force 171 条）。

#### ⬜ 未做 / 存疑（如实标注）

1. **`ForceModule.randomized`（每帧重抽）未实现** —— 只在 Two Constants / Two Curves 档下有区别，
   当前无系统启用（已在 `config.type.ts` 标注）。
2. **`orbital` 是否该排除 gravity / FOL / drag / noise 的位移** —— galacean review 主张排除，
   本引擎未采纳（整段位置一起转）。当前无差异（见 RESEARCH §4.8）。
3. **z 不参与透视缩放** —— Unity 里 z 位移会让粒子远离/靠近相机 ⇒ 尺寸变化；本引擎画布 z 平面是常量。
4. **数据层尚未下发 P2 字段**（`20_取粒子数据.py` / `21_生成配置.py` / `190_生成S8动作特效.py`）：
   三个产物实测全零 ⇒ 本次**特意不改**三条生成链（避免无收益的回归风险）。
   将来接入新皮肤时按下面这张表机械补即可（typetree → config）：

   | typetree（顶层 `tt`） | config |
   |---|---|
   | `VelocityModule.z` / `.orbitalX` / `.orbitalY` / `.orbitalZ` / `.radial` | `velocity.z` / `.orbitalX` / `.orbitalY` / `.orbitalZ` / `.radial`（`mm()`） |
   | `VelocityModule.orbitalOffsetX/Y/Z` | `velocity.orbitalOffsetX/Y/Z`（标量） |
   | `VelocityModule.inWorldSpace` | `velocity.space`（0/1） |
   | `ForceModule.x/y/z` + `.inWorldSpace` | `force.x/y/z` + `.space` |
   | `InheritVelocityModule.m_Mode` / `.m_Curve` | `inheritVelocity.mode` / `.curve` |
   | `tt.moveWithTransform` | `inheritVelocity.simulationSpace` |
   | `ColourBySpeedModule.gradient` / `.range` | `colorBySpeed.*` + `.range` |
   | `SizeBySpeedModule.curve` / `.y` / `.z` / `.separateAxes` / `.range` | `sizeBySpeed.*` |
   | `RotationBySpeedModule.curve` / `.x` / `.y` / `.separateAxes` / `.range` | `rotationBySpeed.*` |

   ⚠️ 下发前必须先看 `enabled` —— 模块关闭时这些字段是序列化残留（本项目第 1 条铁律）。

#### ⬜ 仍未部署 WE、未发布

与 P0 / P1 同：本次只落源码 + 回归 + 文档。下次部署会把 P0 / P1 / P2 **一并带上**，
届时按惯例在 WE 里重载并复核（三个产物理论上零变化）。

---

### 2.9 ✅ P3「补渲染侧」已落地（2026-10-17）

> 报告：`_work_渲染侧/REPORT_P3渲染侧_2026-10-17.md`（含三个产物 39 个节点的 renderer 全量取值、
> 全盘 mesh 定位、落地前后的实测对照）。
> 依据：`docx/RESEARCH_粒子系统复刻参考.md` **§4.12 / §4.13**（Unity 手册逐字 + Cocos 着色器逐行）。
> 回归：`_regress/73_回归_渲染侧.ts`（**34 断言** × 4 份 config 全绿）。

#### 落地了什么

| 项 | 实现要点 | 依据 |
|---|---|---|
| `renderMode = 0` | Billboard ⇒ 轴对齐（**现状**） | §4.12 |
| `renderMode = 1` | Stretched ⇒ **长轴沿速度**（*"aligned to their velocity regardless of Velocity Scale"*）；长度 = `\|v\|·velocityScale + lengthScale·size` | §4.13（Cocos 逐行） |
| `renderMode = 2` | Horizontal ⇒ 平面 ⊥ 视线 ⇒ 本工程**投影面积为 0**（不可见） | §4.12a |
| `renderMode = 3` | Vertical ⇒ 竖直绕 Y 转向相机 ⇒ 本工程 **≡ Billboard** | §4.12a |
| `renderMode = 4` | Mesh ⇒ 顶点 **× 粒子直径**（**不归一化**，与 Cocos `compScale = scale × size` 同式）；缺 mesh / 索引越界 ⇒ **静默回退 quad** | §4.12 |
| `renderMode = 5` | None ⇒ 不生成默认四边形（只留 trails），粒子仍在模拟 | §4.12 |
| `alignment` 0/1/2/3 | View / World / Local / Facing ⇒ 本引擎相机下**投影等价**（都落屏幕对齐） | §4.12 |
| `alignment = 4` | Velocity ⇒ 粒子基准朝向 = **速度方向**的屏幕角（唯一有实感的一档） | §4.12 |
| `pivot` | **直径的倍数**、旋转中心；`pivot = 0` ⇒ 绕中心（= 现状） | §4.12（ScriptReference 逐字） |
| `sortingFudge` | 只动 `mesh.position.z += −fudge × fudgeToZ`；**必须显式给 `fudgeToZ`**（Unity 内部换算未公开） | §4.12 |
| `flip` | 逐粒子按 `p.vmix` 判定（**不额外消耗 rng**），UV 在**条目自己的包围盒**内镜像 | 手册 *"Mirror a proportion of the particles…"* |
| `allowRoll` | `false` ⇒ 屏幕自转整体作废（含 `startRotation`） | 手册 *"…rotate around the Z-axis of the camera"* |
| `min/maxParticleSize` | 视口高比例、**仅 Billboard 档**（手册逐字）；缺省不声明 ⇒ 关闭 | §4.12 |

★ **实现口径**：顶点统一写成 `中心 + 枢轴偏移 + R(ang)·(sgnA·uAx·sizeX + sgnB·uAy·sizeY − 枢轴偏移)`，
其中 `uAx/uAy` 是「单位尺寸下的半轴」= 该档**世界基向量**在屏幕平面上的投影（`renderModeAxes()`）。
`pivot = 0` 且基 = 屏幕轴 ⇒ **逐位退化成 P3 之前**（第 [1] 组钉住）。

#### ★★ 对本工程的三个产物：**先做了全量实测**（`_work_渲染侧/01_三产物渲染模块取值.py`，39 个节点）

| 产物 | renderMode | alignment | pivot | flip |
|---|---|---|---|---|
| S9 背景（11） | **1 个 Mesh（`yun`）** + 10 个 Billboard | 4 个 Local + 7 个 View | 全 `[0,0,0]` | `niao` / `yun` = `[1,0,0]` |
| S9 动作特效 / S8（5） | 全 Billboard | 全 Local | 全 `[0,0,0]` | 全 0 |
| S6 背景（14） | 全 Billboard | 全 View | `hua01` / `hua02` = `[0,0.5,0]`；`bao` = `[0.02,0.01,0]` | 全 0 |
| S6 动作特效（9） | 全 Billboard | 全 Local | 全 `[0,0,0]` | 全 0 |

`sortingFudge` 39 个**全部非零**（−1 ~ −10）；`allowRoll` 全 true；`velocityScale` 全 0；
`maxParticleSize` ∈ {0.5, 10, 999, 9999}；`lengthScale` ∈ {−2, 1.2, 2}。

#### 数据层：**只对 S9 下发**（用户选定范围 = "导出 yun 的 mesh 并下发"）

* `10_wallpaper_engine/_构建_配置生成.py` 新增两张表 `PARTICLE_RENDERER` / `PARTICLE_MESH`（单一真源）
  ＋ 在 `out.append(rec)` 前下发 `rec['renderer']`。
* `10_wallpaper_engine/_补P3渲染侧.py`：把 `renderer` 段补进**现有** config（可重放）。
  ⚠️ **缺省目标只有 `12_探针_去灰线/assets/config.json`**（S9 的**部署工程**）；
  `10_wallpaper_engine/` 只是生成脚本所在的**工作目录**，不作为部署目标、其 config 已恢复原状。
  ★ **为什么不整跑生成链**：那份脚本早就领先于现有 config —— P0/P1/P2 的数据层改动
  （`shape.radiusThickness`、`uv.frameOverTime`、`fitAspect`）**从未下发过**，整跑会顺带改动它们。
  已实测确认：本脚本对 config 的 diff **只有 `renderer` 一个字段**（8 条）。
* ★★ **`yun` 的 mesh = `FX_Model_ZC_Plane13`**（16 顶点 / 18 三角形，`14_effect/battle/_batch10.ab`）。
  extent ≈ **3.96 × 1.76**（**未归一化**）⇒ 换成 Mesh 档后云的宽度从 **487 → 3857 世界单位**
  （屏幕可见宽 ≈ 3759）⇒ 正好"铺满屏幕宽"，与实拍观感吻合。
  落地前后的对照截图见报告（旧 = 头顶一条细白线，新 = 有形状铺开的云层）。
* ⚠️ **S8 / S6 的 renderer 字段未下发**（留档在 `01_渲染模块取值.json`）。理由：S8 全部字段都是
  "零变化"档（alignment = Local、pivot = 0、flip = 0）；S6 只有 `hua01`/`hua02` 的 `pivot = [0,0.5]`
  会真的改观感 —— 那属于**单独的修正**，应由用户实测后单独下发（映射表见报告附录）。

#### ⬜ 未做 / 存疑（如实标注）

1. `cameraVelocityScale`（按相机移动拉伸）**未实现**：本引擎没有"相机速度"这个量（§4.13）。
2. `normalDirection` **未实现**：只影响光照法线，本引擎粒子无光照。
3. `sortMode`（系统**内**逐粒子排序）**未实现**：手册明确它与 `sortingFudge` 是两件事，前者影响
   系统内部的绘制顺序 —— 本引擎按发射顺序画、未做距离排序。
4. `freeformStretching` / `rotateWithStretchDirection` **未实现**：实测 39 个全是 `false`/`true`（默认）。
5. `Stretched` 下是否该叠 `rotationOverLifetime`：照 Cocos 取"不叠"，Unity 内部未公开（§4.13 存疑 1）。
6. `Length Scale` 的基准是 `width` 还是 `sizeY`：取 `sizeY`（与 Cocos 同源），§4.13 存疑 2。
7. **仍未部署 WE、未发布**：本次落源码 + 回归 + 文档 + **S9 的 config 下发**；
   下次部署会把 P0 / P1 / P2 / P3 **一并带上**。

---

### 2.10 ✅ P4「UV / Noise 细节」已落地（2026-10-17）

> 报告：`_work_UV与噪声/REPORT_P4_UV与噪声_2026-10-17.md`（含全包普查 41996 个 ParticleSystem
> 的字段分布 + 三个产物 39 个节点的全量取值 + 落地前后的实测对照）。
> 依据：`docx/RESEARCH_粒子系统复刻参考.md` **§4.14 / §4.15**（官方逐字 + Cocos 逐行 + 官方枚举）。
> 回归：`_regress/74_回归_UV与噪声.ts`（**65 断言**，四份 config 全绿）。

#### 落地了什么

| 模块 | 字段 | 实现要点 | 依据 |
|---|---|---|---|
| UV | `timeMode = 0 Lifetime` | 现状（`⌊startFrame + frameOverTime×cycles×nF⌋ mod nF`） | §4.14① |
| UV | `timeMode = 1 Speed` | ★ **按当前速度静态选帧** `round(sf + rate×(nF−1))`，`rate = clamp((\|v\|−r0)/(r1−r0))`；**不随寿命推进** | `ScriptReference-speedRange` 的 **Remarks 逐字** |
| UV | `timeMode = 2 FPS` | `⌊sf + 年龄 × fps⌋ mod nF`（与寿命/速度无关） | 手册属性表 + 旁证实测 |
| UV | `startFrame` | **帧号**，逐粒子取（复用 `lifeMulMix(…, p.vmix)`，**不额外消耗 rng**），加在帧号上再回绕 | §4.14③ |
| UV | `animationType = 1 SingleRow` | 帧数从整表变 `tilesX`；行 = `p.uvRow`（出生时定） | §4.14② |
| UV | `rowMode` 0/1/2 | Custom ⇒ `rowIndex`；Random ⇒ 出生抽（**只在真会出现随机行时才抽 rng** ⇒ 既有产物零回归）；MeshIndex ⇒ 恒第 0 行（**实现边界**） | §4.14② |
| UV | `flipU` / `flipV` | ★ 官方**已废弃**字段（*"Use `ParticleSystemRenderer.flip.x` instead"*）⇒ **只在 `renderer.flip` 缺省时当回退**，镜像逻辑复用 P3 那条，不另立通路 | §4.14④ |
| Noise | `octaves`/`octaveMultiplier`/`octaveScale` | 势场 fBm 叠层（振幅 `mul^k`、频率 `scale^k`、`/Σ振幅`）；★ **逐层差分步长 `h = NOISE_EPS/f_k`** ⇒ 叠层场仍**无源无汇** | §4.15② |
| Noise | `scrollSpeed` | 采样点 = `(粒子本地坐标 + scrollSpeed × 系统时间) × frequency`（Cocos 同式） | §4.15② |
| Noise | `sizeAmount` | 尺寸乘子 `1 + 标量噪声 × 有效强度 × sizeAmount × gain`，下界钳 0 | §4.15③（**本项目口径，存疑**） |
| Noise | `rotationAmount` | `Δrot = −噪声_z × 有效强度 × rotationAmount × π/180 × dt`（**度/秒**逐字） | §4.15① |
| Noise | `separateAxes` + `strengthY/Z` | 位置推力逐轴改用三条强度 | §4.15① |

★ 全部新字段**可选且缺省** ⇒ 旧 config **逐位无影响**（`74_` 第 [1] 组与第 [10] 组钉住，
含真实产物逐位相同）。

#### ★ 构建期修掉一个**真实缺陷**（回归的散度判据直接抓出来的）

第一版把 octave 叠层做在势场上但**所有层共用固定步长** ⇒ 高频层的截断误差 `O(h²f³)`
与层本身同阶，叠出来的高频层是"垃圾"、场里出现明显源/汇：

| | `max|∇·N|` | 场量级 |
|---|---|---|
| 单层 | 1.41e−2 | 3.66 |
| 4 层（固定步长，**错**） | **2.17** | 4.15 |
| 4 层（逐层步长，**修后**） | **5.34e−2** | 4.18 |

★ 同时查明：**度量散度的那一步也要用匹配步长**，否则量到的是离散算子自己的误差
（这条已写进 `74_` 的注释，免得下次误判）。连带有益性质：`mul·scale = 1` 时每层对
curl 量级的贡献相等 ⇒ 叠层**不放大**场量级（3.66 → 4.18，有断言）。

#### 数据层：**默认只演练，`--apply` 才写盘**

`10_wallpaper_engine/_补P4噪声细节.py`（新）。**为什么不自动下发**：实测三个产物里
**只有两个节点**有非默认的 P4 字段，而**下发会真的改变已验收过的观感**：

| 产物 | 节点 | 字段 | 期望观感 |
|---|---|---|---|
| S8 动作特效 | `fx_touch1_glow_1` | `noise.sizeAmount = 0.5`、`scrollSpeed = 0.3` | 光圈 ±10% 尺寸呼吸 + 场缓慢滚动 |
| S6 动作特效 chat | `fx_chat_lizi_san` | `noise.sizeAmount = 0.5`、`scrollSpeed = 1.0` | ★ 该节点 `positionAmount = 0` ⇒ **目前噪声一点没生效**，下发后**新出现** ±25% 呼吸 |

⇒ 与 P3 对 S6 `pivot` 的处理方式一致：**交用户实测后自己跑 `--apply`**。
**S9 无字段可下发**（三组粒子的 P4 字段全是默认值）。
★ 脚本用**既有字段做自校验**（重算的 `noise.strength`/`positionAmount` 必须与 config 里
已有的值逐位一致，否则拒绝写盘）⇒ MinMaxCurve 的转换口径不是第二意见。

#### ⬜ 未做 / 存疑（如实标注）

1. **`NoiseModule.quality`(Low/Medium) 未实现** —— 手册只说"少采样、跨轴复用并**设法掩盖**复用"，
   **具体手法未公开**（全包 Medium 100 条、三个产物全 High）⇒ 不凭猜实现。
2. **`NoiseModule.remapEnabled` / `remap` 未实现** —— 全包 1663 条**无一启用**。
3. **`sizeAmount` / `rotationAmount` 的"取哪一路噪声值"与绝对量级** —— Unity 未公开、
   Cocos 也未实现 ⇒ §4.15③ 那张表是**本项目口径**（尺寸用**第 4 路有界标量场**、
   自转用 curl 的 z 分量），`gain` 是留给数据层的校准旋钮。
4. **`scrollSpeed` 的滚动方向** —— 单标量 curve 按"三轴等量平移"（沿 (1,1,1) 对角）处理；
   `separateAxes` 会把它拆成 XYZ 三条，但全包只有 4 条开 separateAxes、三个产物全 false。
5. **`uvChannelMask` 未实现** —— 全包 13716 条**全部**是 −1（= 全部通道），本引擎也只有一套 UV。
6. **`mode = Sprites` 未实现** —— 本作**无一使用**（全 Grid）。
7. **仍未部署 WE、未发布**：与 P0~P3 同，本轮只落源码 + 回归 + 文档 + 数据层脚本（演练）。
   下次部署会把 P0 / P1 / P2 / P3 / P4 **一并带上**。

---

### 2.11 ✅ P5-a「Sub Emitters · 定 config 结构」已交付（2026-10-17）

> 设计全文（含三个候选方案与"为什么否掉另外两个"）：`_work_SubEmitters/DESIGN_P5子发射器config结构_2026-10-17.md`
> 证据：`_work_SubEmitters/01_全包P5普查.py`（756 条边 / 261 个父 / 117 个目标）+
> `02_目标形态普查.py`（目标形态与实例化成本）。
> 官方依据：`docx/RESEARCH_粒子系统复刻参考.md` **§4.16**（逐字 + 枚举 + 全包用量）。
> 回归：`_regress/75_回归_子发射器结构.ts`（**37 断言**）。

#### 用户拍板（2026-10-17）

| # | 决策点 | 定案 |
|---|---|---|
| 1 | 结构位置 | ✅ **方案 A** —— 定义仍在扁平的 `meshes[]`、父 mesh 用 `name` 引用、被引用方加 `subOnly: true` |
| 2 | 落地范围 | ✅ **只做 P5-a**（结构 + 类型 + 校验器 + 回归 + 留档）；**P5-b/c 等真要用到某个皮肤时再做** |
| 3 | 实例池形态 | ✅ **每实例一个独立 `ParticleAnimator`**（各自 mesh、共享贴图）—— P5-b 时按此实现 |

#### 结构（已落进 `src/config.type.ts`）

```jsonc
"meshes": [
  {
    "type": "particle", "name": "fx_touch1_glow",
    "subEmitters": [
      { "target": "fx_spark",        // ★ 引用 meshes[].name
        "trigger": "death",          // birth | death | collision | trigger | manual（缺省 birth）
        "inherit": ["size", "color"],// 5 位；也可写 "all" / "nothing"（缺省 []）
        "probability": 0.5,          // [0,1]，每次触发事件掷一次（缺省 1）
        "instances": 6,              // ★ 同屏实例池大小（缺省 4）—— 工程侧旋钮
        "instanceMaxNum": 8 }        // ★ 每实例粒子上限（缺省由数据层按 burst/rate 反推）
    ]
  },
  { "type": "particle", "name": "fx_spark", "subOnly": true }   // 只作模板，不独立发射
]
```

* 位置与 z **不由 config 表达**：实例位置 = `父 mesh.position + 父粒子的 (x,y)`、`z` = 父系统的 z。
  依据 = UI 的 reparent 分支 `localPosition = Vector3.zero; localRotation = identity`。
* `subOnly` 与 `autoplay: false` **不重叠**：前者"永不独立跑，只当模板"，后者"建出来但等 `restart()`"。

#### 校验器（`src/subEmitterConfig.ts`，纯函数、不依赖 three.js）

`validateSubEmitters(configs)` → 警告列表，每条带 `severity`：`'error'` = **该条绑定作废**、
`'warn'` = **仍然生效但有话要说**。`effectiveSubEmitterTargets(configs)` 给出摊平后的 父→子 映射
（只排除 `error` 档 ⇒ 与校验器共用同一套判定，避免两处口径漂移 —— `archive.ts` 有过这个教训）。

| code | severity | 触发条件 |
|---|---|---|
| `target.missing` / `target.notFound` / `target.selfRef` | error | 引用缺失 / 找不到 / 指向自己（全包实测**有 9 条自引用**脏数据） |
| `trigger.invalid` | error | 不是 5 档之一 |
| `trigger.unimplemented` | error | `collision` / `trigger` —— 依赖本项目**明确不复刻**的模块（§2.4）；**声明合法但被忽略，不静默吞掉** |
| `inherit.invalid` | error | 不在 5 位内 / 既不是数组也不是 `all`·`nothing` |
| `probability.range` / `instances.range` / `instanceMaxNum.range` | error | 越界（`instances` 上限 **64**，防"159 个父共用一个目标"时爆内存） |
| `emission.notBurstOnly` | warn | 手册逐字：*"Collision, Trigger, Death and Manual events can only use burst emission"* ⇒ 那四档下子系统 `rateOverTime ≠ 0` 会报 |
| `z.mismatch` | warn | target 的 z 与父不同（Unity 里子发射器是父的子物体 ⇒ z 应相同；实测 29 条脏数据） |
| `cycle` | warn | 引用成环（Unity 有 `CheckCircularReferences` 并**移除**该引用） |
| `subOnly.unreferenced` | warn | `subOnly: true` 却没人引用 ⇒ 永远不会出现在画面上 |

#### ⛔ 本轮**不做**（P5-b/c）

* 引擎消费这两个字段：**出生/死亡事件出口**、**继承注入 API**、**实例池 `src/subEmitters.ts`**、`subOnly` 的装配期处理。
* 因此 `index.ts` **不 import** 校验器 ⇒ 它**不进产物**（`_regress/75_` 第 [7] 组钉住：
  `dist/bundle.js` 里搜不到 `subOnly.unreferenced` / `instanceMaxNum` 两个字符串 ⇒ 对壁纸零影响；
  **P5-b 接线后要改成反向断言**）。
  ⚠️ 不要写成「bundle 逐字节不变」—— 那**不可检**：并行的面板改动也会改 bundle
  （实测本轮 bundle md5 由 `266971f0…` 变成 `c1550e45…`，那是并行改动带来的，与本模块无关）。
  所以钉的是「**本轮产物没进 bundle**」。
* 三个产物 **0 个**子发射器（S9/S8/S6 六个 prefab、39 个节点实测）⇒ 现在是纯能力建设。

#### 👉 P5-b 开工时照这张表机械补（typetree → config）

| typetree（顶层 `tt`） | config |
|---|---|
| `tt.SubModule.enabled` | 先判它！`false` ⇒ **整个模块不看**（模板默认值会骗人） |
| `tt.SubModule.subEmitters[].emitter.m_PathID` | `subEmitters[].target`（反查该 pathID 的 GameObject 名 → `meshes[].name`） |
| `tt.SubModule.subEmitters[].type` | `subEmitters[].trigger`（`0→birth 1→collision 2→death 3→trigger 4→manual`） |
| `tt.SubModule.subEmitters[].properties` | `subEmitters[].inherit`（`1<<0 color / 1<<1 size / 1<<2 rotation / 1<<3 lifetime / 1<<4 duration`；`0→"nothing"`、`31→"all"`） |
| `tt.SubModule.subEmitters[].emitProbability` | `subEmitters[].probability` |
| 目标节点本身是 `SubEmitter*` 或**只**被别人引用 | 该 mesh 加 `subOnly: true` |
| `target.InitialModule.maxNumParticles` + `EmissionModule.m_Bursts[].countCurve` + `rateOverTime` | 反推 `instanceMaxNum`（**不能照搬 `maxNumParticles`**：实测 367 条是模板值 1000，照搬 ⇒ Σ 3.02M 粒子槽；按 `min(maxNum, ceil(1.5×max(Σburst, rate×存活秒数)))` 收敛后 ⇒ Σ 34.2k） |
| `tt.lengthInSec` / `tt.looping` / `tt.prewarm` | ⚠️ 在**顶层**（不在 `InitialModule`）—— 决定实例"跑多久" |
| `EmissionModule.m_Bursts`（**不是** `bursts`）、每次的 `countCurve` | 实例的 burst 表 |

⚠️ 三个生成链（`10_wallpaper_engine/_构建_配置生成.py`、`_work_芙丽希娅_蝶语吟花/21_生成配置.py`、
`_work_星语心恋/190_生成S8动作特效.py`）目前都会把子树里**所有** `ParticleSystem` 收进 `meshes[]`
⇒ 真接入子发射器时，必须同时给"子专用节点"打 `subOnly`，否则它们会被当成独立系统也播一遍。
