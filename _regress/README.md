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
| `64_回归_问候并入触摸池.ts` | `argv[2]` = bundle、`argv[3]` = config | `WK_BUNDLE` / `WK_CONFIG` | `dist/bundle.js` / `public/assets/config.json` |
| `65_回归_待机事件选择.ts` | 同上 | `WK_BUNDLE` / `WK_CONFIG` | 同上 |
| `66_回归_音频总闸边界.ts` | **无**（用 DOM 桩，不需要外部文件） | — | — |

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
npx ts-node --transpile-only _regress/64_回归_问候并入触摸池.ts
```

## 各脚本验什么

| 脚本 | 验证内容 |
| --- | --- |
| `60` | 触摸动作的排队与顺序播放 |
| `61` / `62` | 动画通道占用与残留（诊断用，会打印通道清单） |
| `63` | 动作收尾的跳变幅度与通道残留 |
| `64` | 问候念白并入触摸池后的事件选择 |
| `65` | 待机触发时的事件选择 |
| `66` | 音频总闸的各条边界（暂停/恢复/幂等/stop 后不复活等），**纯 DOM 桩，无外部依赖** |

退出码 `0` = 全通过，非 `0` = 有失败项。
