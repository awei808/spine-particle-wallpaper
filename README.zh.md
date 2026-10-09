# spine-particle-wallpaper

**用 Spine 骨骼动画 + Unity 式粒子特效，给 Wallpaper Engine 做可交互的桌面壁纸。**

Unity 手游里的 Spine 角色 + 粒子特效 + 触摸动作，搬上桌面并保持手感：多套触摸动作系统、念白语音与字幕气泡、BGM、指针拖尾、画面自适应，外加一套内置设置面板。

[English](./README.md)

> 本仓库衍生自 [spicy-wolf/spine-wallpaper-engine](https://github.com/spicy-wolf/spine-wallpaper-engine)（GPL-3.0），
> 在其「Spine 动画播放器」基础上重构成可交互角色壁纸框架。归属与许可见 [NOTICE.md](./NOTICE.md)。

## 和上游有什么区别？

上游是一个**播放器**：把 Spine 文件丢进 `assets/`，它就在壁纸里循环播放。

本仓库在它的渲染内核之上长成了一套**框架**：

| 能力                                      | 上游 | 本仓库                                                     |
| ----------------------------------------- | ---- | ---------------------------------------------------------- |
| 多层场景编排（背景 / 角色 / 粒子 / 前景） | 支持 | 支持，并新增 `particle` 层与分层 z 序                      |
| 触摸交互与动作调度                        | —    | ✅ 热区、动作互斥与打断闸门                                |
| 念白语音 + 字幕气泡                       | —    | ✅ 跟随角色锚点、自动换行、淡入淡出                        |
| BGM                                       | —    | ✅ 循环播放与音量控制                                      |
| 暂停 / 恢复                               | —    | ✅ **统一音频总闸**（WE `setPaused` + 页面可见性两路信号） |
| 指针拖尾                                  | —    | ✅ 跟随鼠标移动发射                                        |
| 内置设置面板                              | —    | ✅ 5 个分页，运行时改配置并持久化                          |
| 档案面板 / 免责声明                       | —    | ✅                                                         |
| 调试探针                                  | —    | ✅ HUD 与 CDP 快照接口                                     |

## 功能一览

- **多层场景**：`texture` / `spine` / `particle` / `video` 四种层，按 `position.z` 排布，宽高比自适应（`minAspect` / `maxAspect`），DPI 自适应（`dpr: "auto"`）。
- **触摸交互**：矩形热区 + 动作序列；`touch` / `greet` / `standby` 三类来源有明确的互斥与打断规则。
- **语音与字幕**：字幕气泡跟随角色锚点，语音走独立播放器；两者都接入音频总闸。
- **音频总闸**（`src/audioMaster.ts`）：BGM 与语音不再各自订阅暂停信号，而是登记到同一个总闸统一处理暂停/恢复。语音从暂停处续播。
- **粒子与拖尾**：`ParticleAnimator` 负责场景粒子，`PointerTrail` 负责鼠标拖尾，两者刻意分家。
- **设置面板**：运行时修改并持久化到 WE 属性。
- **调试探针**：`__WB_DIALOGUE__` / `__WB_FX__` 快照接口，配合 headless Chrome + CDP 做自动化回归。

## 事件列表与触发规则

「什么情况下角色会说哪句话」全部由 `config.json` 的 `subtitle` 段决定，**改完不用重新构建**：

```json
"subtitle": {
  "greet": [64001, 64002, 64003],
  "chat":  [64004],
  "touch": [64005, 64006, 64007, 64008, 64009, 64010],
  "greetMode": "time",
  "touchFeedbackMode": "immediate"
}
```

| 列表         | 触发时机                                                     | 取哪一条                                                                             |
| ------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `greet` 问候 | 开机 / 回到桌面 / 回到前台 / WE 暂停后恢复 /（可选）待机到点 | `greetMode`：`"time"` 按系统时刻取第 1/2/3 条（清晨/中午/傍晚）；`"random"` 整表随机 |
| `chat` 聊天  | 长时间无互动（静置超过 `standbyIdleMs`）                     | 与 `touch` 合并成池后随机                                                            |
| `touch` 触摸 | 点中任一热区                                                 | 池内随机                                                                             |

三条列表的元素都是 `subtitle.dialogues` 里的 `actionId`，**想加一条候选就往数组里加一个数字**
（例如把 `greet` 改成 `[64001, 64002, 64003, 64004]`）。

另有两个可在内置设置面板「动作」页改的行为开关：

- `touchFeedbackMode` —— 已经有动作在演的时候再点一下：
  **`legacy`**（默认，仅问候/聊天时立即播新的；演触摸动作时点击不响应，= 旧版行为）/
  **`immediate`**（任何情况下都立刻播新的）/ **`queue`**（等当前这条演完自动接上）/
  **`none`**（不做任何反馈）。
- `greetMode` —— 问候取条方式：**`time`**（默认，按系统时间）/ **`random`**（随机）。

> 旧字段 `greeting`（时段 → actionId 的映射）与 `standby`（单条 actionId）仍然被兼容读取，
> 老配置的行为不会被改坏；新配置请直接用上面的三条数组。

## 快速开始

```bash
git clone --recurse-submodules https://github.com/awei808/spine-particle-wallpaper.git
cd spine-particle-wallpaper
npm ci
```

> ⚠️ 必须带 `--recurse-submodules`：`packages/threejs-spine-3.8-runtime-es6` 是子模块，漏了会构建失败。

放素材与配置：

1. 把 Spine 三件套（`*.skel` / `*.atlas` / `*.png`）拷进 `public/assets/`
2. 复制示例配置：`cp public/assets/config.example.json public/assets/config.json`
3. 按你的素材改 `config.json` —— 字段说明见 [public/assets/README.zh.md](./public/assets/README.zh.md)

本地预览与构建：

```bash
npm start          # 起 dev server
npm run build      # 产出 dist/bundle.js
```

导入 Wallpaper Engine：把 `dist/` 的内容连同 `assets/` 一起放进一个 WE 工程目录，
再按[官方教程](https://docs.wallpaperengine.io/en/web/first/gettingstarted.html)导入。

## 目录结构

```
src/
  index.ts                装配与主循环
  initScene.ts            场景、相机、画幅自适应
  audioMaster.ts          ★ 音频总闸（BGM + 语音的唯一暂停控制点）
  bgmPlayer.ts            BGM 播放器
  voicePlayer.ts          念白语音播放器
  voiceBubble.ts          字幕气泡
  dialogue.ts             念白调度
  touch.ts                触摸热区与动作闸门
  pointerTrail.ts         指针拖尾
  settingsPanel.ts        内置设置面板
  settingsStore.ts        设置读写与覆盖
  archive.ts              档案面板
  disclaimer.ts           免责声明
  wePauseSignal.ts        WE setPaused 信号的唯一安装点
  idleSequence.ts         常驻动作序列
  probe.ts / probeHud.ts  调试探针
  animator/               texture / spine / video / particle 四种层
_regress/                 回归脚本（ts-node）
public/assets/            素材与 config.json（素材已 gitignore）
```

## 已知缺陷

- 指针拖尾的发射间距按速度而非距离计算，快速划动时分布不均。计数逻辑正确，分布逻辑待修。

## 许可证

- 本仓库：**GPL-3.0**，见 [LICENSE.txt](./LICENSE.txt)。
- Spine 运行时：**Spine Runtimes License Agreement**，见 [LICENSE.spine.txt](./LICENSE.spine.txt)。
- 衍生自 spicy-wolf/spine-wallpaper-engine（GPL-3.0），详见 [NOTICE.md](./NOTICE.md)。

## 免责声明

本程序只是把**你自己的** Spine 动画搬上桌面。请确保你对所用素材、音频、文本拥有合法权利 ——
仓库本身不含任何游戏素材（`public/assets/*` 已被 gitignore，仅保留说明文档与示例配置）。

使用本程序的风险由你自行承担，作者不对任何损害负责。
