# 调研：TTS 合成通道接入本项目

> 调研日期：2026-10-20
> 调研对象：当前工作副本 `D:/手游文件夹/spine-wallpaper-engine`（S9 / Asuna 22 层场景）
> 方法：读源码 + 读既有 PLAN/TODO + 查 CEF 能力的外部实证（不是凭记忆）

---

## 0. 结论

**能不能接：能。但"接在哪里"决定了它是 1 天的活还是 8 天的活，而且当前版本几乎无处发力。**

| 形态 | 原理 | 可行性 | 代价 | 对本项目的收益 |
|---|---|---|---|---|
| **A. 构建期预合成** | 离线脚本读 `events.jsonc` 的 `text`，批量合成后落盘成 `assets/voice/` 里的音频 | **可行** | **1~2 人日** | **高**（对 A 方案而言：一次跑完全表都有声） |
| **B1. 运行时调本地 TTS 服务** | 壁纸 `fetch('http://127.0.0.1:port/tts')` → Blob → `<audio>` | **可行** | **5~8 人日** | 低（见 §4） |
| **B2. 运行时调云端 TTS API** | 同上，走公网 | 技术可行，**工程上不推荐** | 6~10 人日 + 持续成本 | 低，且引入密钥泄露面 |
| **C. Web Speech API** | `window.speechSynthesis.speak()` | **不可行**（CEF 无 TTS 引擎） | 1 小时验证即可钉死 | 0 |
| **D. 浏览器内跑神经 TTS 模型** | onnxruntime-web + VITS/piper | 技术可行，**产品上不可行** | 10+ 人日 | 负（抢 CPU/GPU，壁纸常驻） |

**一句话**：TTS 在本项目的正确位置是**离线工具链**（`scripts/` 下第七个 CLI），不是运行时模块。原因不是技术难度，而是**产品形态不匹配**（§4.2）。

---

## 1. 现有语音链路：代码事实

### 1.1 链路全貌

```
assets/events.jsonc              ← 唯一事件源（text / textTime / voice）
        │  eventsFile.loadEventsFile()  fetch('./assets/events.jsonc')
        ▼
eventModel.normalizeEventTable() ← 归一（on/kind/when 派生）
        ▼
index.ts showDialogue(entry, animationName)          ← 三条通道的唯一汇合处
        ├─▶ voicePlayer.play(voiceBasename(entry.voice))    index.ts:854-857
        └─▶ voiceBubble.show(entry, min(textTime, animDur)) index.ts:863-873
                    │
                    ▼
        voicePlayer.ts  (单个 <audio> 元素池)
            audio.src = basePath + candidate.url            voicePlayer.ts:470
```

**关键：全项目只有 `index.ts:856` 一处调用 `voicePlayer.play()`**（另加 842 行的 `stop()`）。语音入口收敛得非常好——这是接入成本低的根本原因。

### 1.2 七条必须知道的事实（带行号）

| # | 事实 | 位置 | 对 TTS 的含义 |
|---|---|---|---|
| 1 | 语音**只认文件名**：`voice` 字段取 basename，拼 `subtitle.audio.path` | `index.ts:855`、`config.type.ts:883` | TTS 若产出 URL，现有拼接逻辑会拼坏 |
| 2 | `audio.src = basePath + cand.url` **不做绝对 URL 判断** | `voicePlayer.ts:470` | 传 `http://...` ⇒ 变成 `./assets/voice/http://...` |
| 3 | `splitVoiceName` 把**任何白名单后缀**当扩展名 | `voicePlayer.ts:190-196` | URL 里的 `.ogg` 会被当扩展名，进而拼 4 个候选 ⇒ **一次播放发 4 次请求** |
| 4 | 字幕时长 = `min(textTime, 动画时长)`，**与音频实际长度无关**；两者都缺省时 6s | `index.ts:863-873` | TTS 音频比原 CV 长时，字幕先消失、声音继续 |
| 5 | 播新的先 `stop()` 旧的（**硬互斥**） | `voicePlayer.ts:594` | 超长 TTS 会被下一个动作**硬切** |
| 6 | 总闸暂停期间不起播，请求转 `deferredFile` | `voicePlayer.ts:330`、`599-603` | 异步 TTS 返回时必须复用这条不变式 |
| 7 | `ended ≠ paused`，播完要清 `wasPlaying` | `voicePlayer.ts:348-352`、`683-698` | Blob 元素同样适用，不能绕过 |

### 1.3 运行时 `fetch` 是**可用**的（重要前提）

代码里已经有两处在 `file://` 下成功的 `fetch`：

- `index.ts:321-323` —— `fetch('./assets/config.json')`
- `eventsFile.ts:270-275` —— `fetch('./assets/events.jsonc', { cache: 'no-store' })`

⇒ **WE 的 CEF 给了 file:// 页面读本地文件的权限**。这是 B 方案"能发 HTTP 请求"的前提之一。
但注意：*读同目录文件* 与 *跨源请求* 是两件事，后者仍受 CORS 约束（见 §6.6）。

### 1.4 存量数据：TTS 的"可补充空间"其实很小

```
events.jsonc:  "text" 出现 18 次，"voice" 出现 17 次
assets/voice/: 12 个 ogg，合计 684 KB（原 CV 录音）
```

⇒ **18 条台词里 17 条已经有原 CV 语音**。TTS 对存量内容能做的是补那 1 条，外加替换 12 条（但那是降级，见 §4.3）。

### 1.5 ⚠️ 面板其实**不能新建事件**（与 TODO 记载不符）

`docx/TODO.md` §1 写「S9 面板 v1（ok 2026-10-18）：新建 / 停用 / 删除」，但当前副本：

- `src/eventBuilder.ts` —— **文件不存在**
- `settingsPanel.ts` 里搜不到 `wb.swe.events.v1` 的读写
- `TABS`（`settingsPanel.ts:931-948`）里只有 `{ id: 'events', label: '事件开关' }`，**只有开关，没有新建页**

⇒ 当前**唯一**加事件的方式是**手改 `events.jsonc`**（作者模式）。
这条事实直接决定了 §4.2 的收益判断：终端用户不写台词，运行时 TTS 对他们零价值。

---

## 2. 五种形态的判定依据

### 2.1 C. Web Speech API —— 否决（有外部实证）

`window.speechSynthesis` 在 **CEF 里是"存在但空转"**：

- `getVoices()` 恒返回 `[]`，`voiceschanged` 从不触发；
- `speak()` 不报错、不出声，`onstart`/`onend` 都不触发；
- 传 `--enable-speech-dispatcher` / `--enable-speech-synthesis` **也没用**（OBS 的浏览器源就是 CEF，已实测）。

根因：Chromium 的 TTS 实现在 `chrome/browser/speech/tts/`（**Chrome 浏览器层**），CEF 不含这一层。

第二个否决理由更硬：**即使能响，`speechSynthesis` 也拿不到音频字节**——只有扬声器输出，没有 buffer。
⇒ 无法进 `voicePlayer` 的元素池、无法走 `audioMaster` 的音量/暂停、无法缓存、无法与字幕对齐。

> 真机确认成本很低（1 小时，照 §7 做一个 `cef-tts-check.html`），建议做，把结论钉死。但预期就是"不可用"。

### 2.2 A. 构建期预合成 —— 推荐

```
scripts/ttsGenerate.ts
  ① parseEventsFile() + normalizeEventTable()   ← 直接 import，不重写解析
  ② 筛出 text && !voice 的条目（或 --force 全量）
  ③ 调 TTS（Azure / edge-tts / GPT-SoVITS）
  ④ 落盘 public/assets/voice/tts/<eventKey 转义>.ogg
  ⑤ --write 回写 events.jsonc 的 voice 字段（或走命名约定）
```

**为什么它代价最低**：运行时**零改动**。`voicePlayer` 的多格式兜底、`canPlayType` 缓存、`generation` 防串台、`suspended` 总闸、`ended` 续播语义——**全部免费复用**，一行都不用碰。

**已有可复用的骨架**：

- `scripts/voiceManifest.ts` 已经在做「解析事件表 → 校验语音文件存在」，且明确写了「规则直接复用 `src/voicePlayer`，不另写一份」。新增生成脚本可以照这个范式，甚至让 `voiceManifest` 顺手校验 TTS 产物。
- `scripts/deployWe.ts` 已经是成熟的"离线 CLI + 幂等 + 不覆盖用户改动"范式。
- `scripts/validateEvents.ts` 已能离线校验事件表。

**唯一的新依赖**：转码。TTS 常见输出 mp3/wav，项目偏好 ogg。
- 若用 **Azure**：可直接请求 `ogg-24khz-16bit-mono-opus`，**不需要 ffmpeg**（`VOICE_MIME.opus` 已支持）。
- 若用 **edge-tts**：只出 mp3/webm，但 **mp3 也在 `VOICE_MIME` 白名单里**，同样不需要 ffmpeg。
- 只有想统一成 vorbis 才需要 ffmpeg（当前 `PATH` 里**没有** ffmpeg，实测 `command not found`）。

### 2.3 B1. 运行时调本地 TTS 服务 —— 可行，但代价陡增

典型形态：本地跑 GPT-SoVITS / CosyVoice / edge-tts 的 HTTP server，壁纸请求 `http://127.0.0.1:port`。

**优势**：无密钥泄露、无外网依赖、可音色克隆（本项目 `assets/voice/` 里**正好有 12 条原 CV 录音**，是 few-shot 参考音频的理想素材）。

**代价**（见 §3.2）：要动 `voicePlayer` 的核心三件事——URL 通道、异步就绪、缓存。每一件都踩在既有不变式上。

### 2.4 B2. 运行时调云端 API —— 工程上不推荐

三个硬阻碍：

1. **密钥无法保护**。壁纸是要分发/上传创意工坊的，前端写 key = 公开发布 key。想安全就必须自建代理服务器 ⇒ 从"壁纸"变成"壁纸 + 后端服务"，运维成本与合规责任都上来了。
2. **离线即失效**。WE 用户断网/被防火墙拦截是常态；本项目的定位是"本地资源包"，不该有网络强依赖。
3. **CORS**。`file://` 页面的 origin 是 `null`，服务端必须回 `Access-Control-Allow-Origin: *` 或显式允许 `null`，且预检不能拦自定义头。各家云 TTS 策略不一，需要逐家实测。

### 2.5 D. 浏览器内跑模型 —— 否决

onnxruntime-web + VITS/piper：模型 60~200 MB，单次推理数百 ms~数秒，**常驻 CPU**。
WE 对壁纸有帧率限制与"全屏时暂停"机制，壁纸抢 CPU/GPU 会直接影响游戏帧数——这跟本项目"Spine 渲染已经很吃 GPU"（见 `docx/REPORT_GPU渲染归属_2026-10-20.md`）的现状正面冲突。
分发体积从 ~十几 MB 涨到 200 MB+，也不现实。

---

## 3. 代价拆解

### 3.1 A 方案（构建期预合成）：1~2 人日

| 项 | 内容 | 规模 |
|---|---|---|
| 新增 | `scripts/ttsGenerate.ts`（读表 → 筛选 → 请求 → 落盘 → 可选回写） | ~250 行 |
| 新增 | `package.json` 一条 `"tts": "ts-node --transpile-only scripts/ttsGenerate.ts"` | 1 行 |
| 改造 | `scripts/voiceManifest.ts`：把 TTS 产物纳入清单（可选） | ~30 行 |
| 配置 | `config.type.ts` 加 `subtitle.tts` 块（provider / voice / 语速 / 是否覆盖已有录音） | ~60 行 |
| 文档 | `events.jsonc` 头部说明「跑 `npm run tts` 可自动补语音」 | ~15 行 |
| 回归 | `_regress/91`：命名约定 ↔ 事件表一致；`--force` 不误删手写条目 | ~80 行 |
| 风险 | TTS 音色与 CV 不像 ⇒ 需试听调参（**不计入工时，但是最大不确定性**） | — |

**注意体积**：`webpack.common.js` 的 `CopyPlugin` 把**整个 `public/` 复制进 `dist/`**。全量 18 条 TTS（按 opus 24kbps 估）≈ +600 KB ~ 1.2 MB，直接进分发包。

### 3.2 B1 方案（运行时本地服务）：5~8 人日

| 文件 | 改动 | 规模 | 风险 |
|---|---|---|---|
| `src/ttsClient.ts`（新） | 请求 / 超时 / 重试 / 并发去重 / IDB 缓存 / 失败静默 | ~200 行 | 中 |
| `src/voicePlayer.ts` | ① 支持绝对 URL 与 Blob（改 `470` 行拼接）<br>② 新增"异步就绪"通道（先占位、后出声）<br>③ 复用 `generation`/`suspended` 防串台<br>④ 暴露 `duration` / `onEnded` 给字幕 | ~150 行 | **高**（踩 4 条不变式） |
| `src/index.ts` | `showDialogue` 时序：字幕要么等音频、要么跟随音频长度 | ~40 行 | 中 |
| `src/voiceBubble.ts` | 支持"跟随音频 duration"而非 `setTimeout`（`868-874`） | ~30 行 | 低 |
| `src/config.type.ts` | `subtitle.tts`（enabled / endpoint / voice / timeout / fallback） | ~80 行 | 低 |
| `src/settingsPanel.ts` | 加一页或塞进「字幕气泡」页（开关 + 服务地址 + 试听按钮） | ~200-300 行 | 低（但这里 3355 行，改起来琐碎） |
| `_regress/` | 3~4 条（超时降级 / 暂停期间不发请求 / 缓存命中 / 字幕跟随） | ~200 行 | 中 |
| 真机 | WE 里验证 CORS、暂停、切场景、长时间运行 | — | **不可预估** |

### 3.3 两者对比

| 维度 | A（预合成） | B1（运行时） |
|---|---|---|
| 运行时风险 | **0**（不动引擎） | 高（动最核心的播放器） |
| 新增文本要重跑 | 是（一条命令） | 否（自动） |
| 分包体积 | +0.6~1.2 MB | +0 |
| 用户机器依赖 | 无 | 必须跑本地服务 + 装模型 |
| 断网/离屏 | 无影响 | 本地服务挂了就没声 |
| 音色一致性 | 可批量调、可试听后定稿 | 每条实时生成，难统一 |

---

## 4. 收益评估（这部分要诚实）

### 4.1 存量内容：≈ 0

18 条台词 17 条有原 CV（12 个 ogg）。TTS 只能补 1 条，**没有收益**。

### 4.2 新增内容：**当前版本没有出口**

这是最关键的一条，且有代码证据（§1.5）：

- 面板只有「事件开关」，**不能新建事件、不能输入台词**；
- `eventBuilder.ts` 不在当前副本；
- 想加台词只能手改 `events.jsonc`（作者模式）。

⇒ **运行时 TTS 的"动态"优势在本项目里没有消费者**。终端用户永远不会输入文本，只会开关已有事件。
⇒ 而"作者手写 18 条台词"这个场景，**构建期跑一次脚本**就是最自然的解法。

### 4.3 音色：TTS 是**降级**而非增强

本项目的语音是**游戏原 CV 录音**，这是壁纸的核心卖点。用合成音替换，即使 GPT-SoVITS 克隆得再像：

- 情感、气声、笑音、语速与动作的对齐都会退化；
- 原录音是"与动画时长精确对齐"的（`textTime` 就是从 CV.csv 来的），TTS 不会自动对齐；
- 一旦用户听出"这句是假的"，沉浸感是负收益。

⇒ 正确用法是**只在没有录音时兜底**（`text && !voice`），绝不是覆盖。

### 4.4 音色克隆的法律面

`assets/voice/` 里的 12 条原 CV 是**商业游戏的配音**。用它做 few-shot 克隆音色、再合成新台词：

- 著作权/邻接权（表演者权）风险；
- 若壁纸要上创意工坊分发，风险从"自用"升级为"公开传播"。

技术上可行 ≠ 可以分发。这条必须在动手前定口径。

### 4.5 真正可能有收益的三个方向（都不是"接线"能解决的）

1. **动态播报**（时间/天气/日程）—— 需要先有数据源，TTS 只是最后一环；且这类内容与"角色扮演"调性冲突，要么做成角色口吻（需要 LLM 改写），要么就别做。
2. **多语言**（日 → 中）—— 你正在做的 role-player3 UI 汉化是**文本层**；配音层换 TTS 会与角色音色割裂，不是同一件事。
3. **无 CV 的皮肤/角色包**—— 换一个没有原声资源的角色时，TTS 是"从 0 到 1"的补全。这是 A 方案最有价值的场景。

---

## 5. 推荐路线（三步，每步有验证标准）

### 第 0 步：钉死 C 的结论（0.5 人日）

照 `public/audio-check.html` 的范式做一个 `public/cef-tts-check.html`，用现成的部署通道在 **WE 自己的 CEF** 里跑：

```bash
npx ts-node --transpile-only scripts/deployWe.ts "<WE>\projects\myprojects\TTS自检" --tts-check
```

页面只需回答 4 个问题（详见 §7）。

**验证标准**：`getVoices().length` 与 `speak()` 是否真的出声。若为 0 / 无声 ⇒ C 永久出局，不必再想。

### 第 1 步：A 方案落地（1~2 人日）

1. 写 `scripts/ttsGenerate.ts`，先只处理 `text && !voice` 的条目（**不碰已有录音**）。
2. provider 选一个能直出 `mp3` 或 `ogg-opus` 的（避开 ffmpeg 依赖）。
3. `--dry-run` 打印「将生成 N 条 / 跳过 M 条（已有录音）」，先看清单再真跑。
4. 落盘 + `--write` 回写 `events.jsonc` 的 `voice`。
5. `npm run voice-manifest` 校验全表能定位到文件。

**验证标准**：
- `voiceManifest` 报 0 缺失；
- WE 里逐条触发，**字幕与声音都出**；
- 原 12 条 ogg 一条没被覆盖（`--force` 默认关）。

### 第 2 步：B1 只在"确实需要动态"时做（5~8 人日）

前置条件（缺一不做）：

- 面板开放了**自由文本输入**（即 `eventBuilder.ts` 落地）；
- 或者有明确的"用户自带本地 TTS 服务"的产品定位。

否则投 8 天做一个没有消费者的通道。

---

## 6. 如果真要做 B，这 8 个坑必须先认领

| # | 坑 | 位置 | 后果 |
|---|---|---|---|
| 1 | `splitVoiceName` 把 URL 里的 `.ogg` 当扩展名 | `voicePlayer.ts:190-196` | 一次播放**发 4 次 TTS 请求**（4 个候选各试一次） |
| 2 | `basePath + cand.url` 不认绝对 URL | `voicePlayer.ts:470` | `./assets/voice/http://...` ⇒ 必然失败 |
| 3 | 异步 TTS 与 `suspended` 总闸 | `voicePlayer.ts:330,599-603` | 请求回来时 WE 已暂停 ⇒ **暂停中的壁纸突然出声** |
| 4 | 异步返回与 `generation` 防串台 | `voicePlayer.ts:308`、`455` | 连点两下 ⇒ 后到的旧请求**盖掉**新语音 |
| 5 | 字幕时长与音频脱钩 | `index.ts:863-873` | 长句 TTS 念到一半字幕没了；或字幕挂着人已回 idle |
| 6 | `stop()` 硬互斥 | `voicePlayer.ts:594` | 超长 TTS 被下一动作**硬切** |
| 7 | 自动播放限制 | `voicePlayer.ts:38-51` 文件头 | TTS 合成成功但 `NotAllowedError` ⇒ 误判为"TTS 坏了"（与格式失败混淆，正是文件头警告过的坑） |
| 8 | `text` 里有换行/省略号/书名号 | `events.jsonc:105-151` | TTS 读法跑偏（"……"读成省略号），**必须先做文本清洗** |

---

## 7. 附录：`cef-tts-check.html` 要回答的 4 个问题

照 `audio-check.html` 的 5 段式结构写，只保留必要的 4 段：

| 段 | 测什么 | 判据 |
|---|---|---|
| ① 环境 | `typeof speechSynthesis`、UA、`location.protocol` | 确认在 **WE 的 CEF** 里而不是普通浏览器 |
| ② 语音列表 | `getVoices().length`、`onvoiceschanged` 是否触发 | **0 且不触发 ⇒ C 出局**（预期结果） |
| ③ 实播 | `speak()` 后监听 `onstart`/`onend`/`onerror`，附"我听到了吗"手动确认按钮 | 三项全静默 ⇒ C 出局 |
| ④ 取字节 | 试 `MediaRecorder` + `AudioContext.createMediaStreamDestination` 能否截到音频 | 截不到 ⇒ 即使能响也**无法接入 voicePlayer**（这条是决定性的） |

第 ④ 段是真正的判据：**能出声 ≠ 能接入**。`voicePlayer` 需要的是"可播放的媒体源 + 可控进度 + 可暂停续播"，`speechSynthesis` 三者都不给。

---

## 8. 一句话总结

**技术上 A 方案一天能跑通，收益是"给没有 CV 的台词补齐声音"；B 方案八天能跑通，收益在当前版本接近零——因为终端用户根本没有输入台词的入口（`settingsPanel.ts:931-948` 只有开关页）。**

**先做第 0 步把 C 钉死，再做第 1 步把 A 落地；B 等"自由文本输入"这个前置条件真的落地了再说。**
