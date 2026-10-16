# 回归脚本

这里放的是**离线回归与诊断脚本**，用 `ts-node` 直接跑，不需要 Wallpaper Engine，也不需要浏览器。

## 通用跑法

所有脚本都在**仓库根目录**下执行：

```bash
npx ts-node --transpile-only _regress/<脚本名>.ts [参数...]
```

> `--transpile-only` 是必须的：跳过类型检查，避免 `packages/` 下第三方类型问题拖慢/中断回归。
> `polyfill.ts` 若被 import，**必须是第一个 import**。

## 路径参数（重要）

脚本**不写死任何本机绝对路径** —— 需要外部文件的，一律按下面的优先级解析：

```
命令行参数  >  环境变量  >  仓库内相对缺省
```

| 脚本 | 需要的参数 | 环境变量 | 缺省值 |
| --- | --- | --- | --- |
| `60_回归_排队模式.ts` | `argv[2]` = `.skel` 路径 | `WK_SKEL` | `assets/character.skel` |
| `61_诊断_动画通道与残留.ts` | 同上 | `WK_SKEL` | 同上 |
| `62_诊断_chat残留通道.ts` | 同上 | `WK_SKEL` | 同上 |
| `63_回归_收尾跳变与残留.ts` | 同上 | `WK_SKEL` | 同上 |
| `64_回归_触摸通道并池.ts` | `argv[2]` = bundle、`argv[3]` = config | `WK_BUNDLE` / `WK_CONFIG` | `dist/bundle.js` / `public/assets/config.json` |
| `65_回归_通道事件选择.ts` | 同上 | `WK_BUNDLE` / `WK_CONFIG` | 同上 |
| `66_回归_音频总闸边界.ts` | **无**（用 DOM 桩，不需要外部文件） | — | — |
| `67_回归_触摸反馈与问候模式.ts` | `argv[2]` = bundle（其余用例自带数据，不需要 config） | `WK_BUNDLE` | `dist/bundle.js` |
| `68_回归_触摸反馈三模式.ts` | `argv[2]` = `.skel` 路径 | `WK_SKEL` | `assets/character.skel` |
| `69_回归_事件族注册表.ts` | `argv[2]` = bundle（用例自带数据，不需要 config） | `WK_BUNDLE` | `dist/bundle.js` |
| `70_回归_锥形形状采样.ts` | `argv[2]` = `config.json`（须含锥形 type 4/8） | `WK_CONFIG` | `public/assets/config.json` |
| `71_回归_形状族补充.ts` | `argv[2]` = `config.json`（任一含启用粒子组的工程即可，形状靠覆盖 `shape` 合成） | `WK_CONFIG` | `public/assets/config.json` |
| `72_回归_按速度与力.ts` | 同上（P2 六个模块靠覆盖字段合成，不要求 config 真有） | `WK_CONFIG` | `public/assets/config.json` |

例：

```bash
# 先构建出 bundle
npm run build

# 拿你自己的骨架跑动作回归
npx ts-node --transpile-only _regress/60_回归_排队模式.ts \
  public/assets/character.skel

# 或者用环境变量，免得每次都敲
export WK_BUNDLE=dist/bundle.js
export WK_CONFIG=public/assets/config.json
npx ts-node --transpile-only _regress/64_回归_触摸通道并池.ts
```

## 各脚本验什么

| 脚本 | 验证内容 |
| --- | --- |
| `60` | 触摸动作的排队与顺序播放 |
| `61` / `62` | 动画通道占用与残留（诊断用，会打印通道清单） |
| `63` | 动作收尾的跳变幅度与通道残留 |
| `64` | 触摸通道的**事件并池**（`mergeKindPools` / `resolveTouchIds`）—— 钉住"旧布尔 `greetInTouchPool` = 新勾选 `touchKinds:["touch","greet"]`"这条等价关系，以及去重、保序、空池、id 不存在时的兜底 |
| `65` | 三个通道**可触发的事件（多选 `standbyKinds` / `touchKinds` / `resumeKinds`）** —— 口径摊平（新数组 / 缺省 / 待机的旧两个布尔）、可用性过滤、**三个缺省各自不同**（chat / touch / greet）、`[]` = 该通道全关、全非法值退回该通道缺省；三个通道的覆盖层链路与 `sameView` 的**数组按内容比较（逐个通道都要比）**；角色语音音量 |
| `66` | 音频总闸的各条边界（暂停/恢复/幂等/stop 后不复活等），**纯 DOM 桩，无外部依赖** |
| `67` | 事件列表（`greet` / `chat` / `touch` 三条数组）+ 问候取条方式（按时 / 随机）+ 触摸反馈四档（`legacy` 缺省 / `immediate` / `queue` / `none`）的**纯判定与配置链路**（含旧 `greeting` / `standby` 的向后兼容） |
| `68` | 触摸反馈四档在**叠加模式**下的真实播放行为（待播槽：排进去、自动接上、容量 1、dispose 不留定时器；`legacy` 的两半：触摸在演忽略、问候在演打断） |
| `69` | **事件族注册表**（2026-10-15 改注册表制）—— 直接 import `src/dialogue` 的纯函数，覆盖：注册表归一（缺省单族 `normal` / 空注册表 / 非法项丢弃 / 去重保序 / 自定义族）、条目判族三段判据（显式 `phase` → `matchSuffix` → 缺省族）、挂件勾选归一与缺省（`touchPhases`）、`buildPool` 的族筛与孪生"收全命中"、`mergeKindPools` 的 `actionId\|phase` 去重；末段读 bundle 断言**产物里不再有写死的族名/族标签** |
| `70` | **锥形（Cone / ConeVolume）形状采样** —— 方位角覆盖 `arc`、`ρ ∈ [R(1−t), R]`、`te` 两端点、单/多扇区、`m_Scale` 各轴缩放、方向发散幅度 ≤ `angle/2`；★ 2026-10-16 起含 **ConeVolume 的轴向几何**（近盘 = `radius` 在原点、沿轴张开 `+t·tan(angle)`，逐颗断言 `ρ = R + t·tan(angle)`）与 **`m_Scale`/`m_Rotation` 的 `TRS` 顺序** |
| `72` | **P2「按速度与力」（2026-10-16）** —— `VelocityModule.z`（不产生屏幕位移、只进 `\|v\|`）、`ForceModule`（加速度、`Δv = a·dt`、Local/World 两种空间）、`orbitalX/Y/Z`（弧度/秒、绕 **orbitalOffset** 旋转位置，含"绕的是 offset 不是原点"）、`radial`（沿径向推/拉、取负朝中心收）、三个 by-speed 的同一条 `rate` 归一化（含上下界钳位）、`SizeBySpeed` 是倍率且不分轴时 `y = x`、`RotationBySpeed` 单位弧度/秒且**取负号**、`InheritVelocity` 在 **Local 下整个被忽略** + World 下 `Initial`/`Current` 两态与 `curve` 倍率；以及**零回归**：无 P2 字段 ≡ 有字段但全关（含"关闭模块的残留值不生效"） |
| `71` | **形状族补充（P1，2026-10-16）** —— obsolete 变体折叠（`1→0/3→2/7→4/9→8/11→10`，逐位相同）、**圆盘族等价**（Sphere/Hemisphere 位置与 Circle 逐位相同）、**方向 = 径向**、`arc` 扇形与 BurstSpread、**Edge 的线段几何与本地 +Y 方向**、`m_Position`/`m_Rotation` 的形状通用性（平移不被旋转 + `rotZ` 与 `nodeRotZ` 同轴相加）、既有形状零回归与"未实现类型仍走锥形兜底"的现状钉扎 |

> ⚠️ `65` 的 D 段有一条**早已失配**的断言（找面板文案「旧版「touch触发greet事件」开关打开的效果」，
> 该短语在 `src/` 里根本不存在、且注释不会进 bundle）⇒ 它会稳定报 1 条 FAIL，与本次改动无关。

退出码 `0` = 全通过，非 `0` = 有失败项。
