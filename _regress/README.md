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

退出码 `0` = 全通过，非 `0` = 有失败项。
