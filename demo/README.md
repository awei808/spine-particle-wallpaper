# 示例工程：星见亚砂 · 盛夏游乐场（S9）

这是一个**能直接跑起来的完整壁纸工程**，本仓库用它做两件事：

1. **展示**——这个框架实际能做出什么效果；
2. **教程**——想把自己的 Spine 角色做成壁纸时，照着它改。

它包含：22 个分层（12 贴图 / 8 粒子 / 2 骨架）、3 个触摸热区、15 条事件与 15 条语音、
分层背景、字幕气泡、粒子特效、节日与自定义事件。

---

## 一、先让它跑起来

1. 把整个 `demo/S9_盛夏游乐场/` 目录复制到 Wallpaper Engine 的工程目录
   （`<WE安装目录>/projects/myprojects/`）；
2. 回到 Wallpaper Engine，刷新列表，选中它应用即可。

不需要 `npm install`，也不需要构建——`bundle.js` 已经打好了。

> `bundle.js` 是一次构建的产物。如果你改了 `src/` 下的源码，
> 需要按根目录 README 重新构建并覆盖它。

---

## 二、目录里都是什么

```
demo/S9_盛夏游乐场/
  project.json     WE 工程定义：标题、预览图、属性面板里的开关项
  index.html       入口页面
  bundle.js        构建产物
  preview.jpg      列表里的预览图
  assets/
    config.json    场景参数：画布、图层、热区、字幕、音频、粒子
    events.jsonc   事件表：什么条件下说哪句话、播哪条语音
    *.skel          Spine 骨架
    *.atlas         图集描述
    *.png           角色与分层贴图
    voice/          语音（.ogg）
    bgm/            背景音乐
    README.md       素材放置说明（上游原文，讲 Spine 三件套怎么放）
```

---

## 三、想换成自己的素材，改这三个地方

### 1. 放素材

把你的 Spine 三件套（`.skel` + `.atlas` + `.png`）和背景贴图丢进 `assets/`，
与 `config.json` 同级，不用建子目录。语音放 `voice/`，音乐放 `bgm/`。

### 2. 改 `config.json`

顶层几个关键字段：

| 字段 | 作用 |
| --- | --- |
| `width` / `height` | **设计画布尺寸**。本工程是 `1700 × 750`，所有坐标都以它为准 |
| `fitAspect` | 取景基准：`"width"` 按画幅宽对齐，`"height"` 按画幅高对齐 |
| `meshes[]` | 图层数组，按顺序叠。每层一个 `type`：`texture` / `spine` / `particle` / `video`，用 `position.z` 排前后 |
| `touch.zones[]` | 触摸热区。本工程有 `hit1`（兜底）、`hand`、`head` 三个 |
| `subtitle` / `bgm` / `pointerTrail` | 字幕气泡、背景音乐、鼠标拖尾 |

**热区坐标请写 `design`（设计画布像素），别写屏幕像素**：

```json
{ "id": "hand", "design": { "x": 1012, "y": 96, "w": 88, "h": 126 } }
```

原点左上角，分母就是 `width × height`。这样换显示器、换分辨率，热区都不会漂。

### 3. 改 `events.jsonc`

"什么时候、说什么、配哪条语音"全在这一个文件里。一条事件长这样：

```jsonc
{
  "id": "custom:morning",
  "on": "resume",                          // 触发通道：touch / standby / resume
  "kind": "greet",                         // 类别：touch / chat / greet
  "when": { "time": { "start": 5, "end": 11 } },   // 条件：早上 5–11 点
  "animation": "greet",                    // 播放的 Spine 动画名
  "text": "早上好。",                       // 念白
  "voice": "voice/Morning_01.ogg",         // 语音
  "pick": { "priority": 20, "quota": { "max": 1, "per": "day" } }
}
```

文件头部的注释就是完整语法说明（字段表、优先级五档、三条示例），
**照抄改参数即可**，比看文档快。

改完**不用重新构建**——在 Wallpaper Engine 里重新加载壁纸就生效
（事件表是启动时一次性构建的，不做热重载）。

改完可以先自检，不用启动 WE：

```bash
npx ts-node --transpile-only scripts/validateEvents.ts demo/S9_盛夏游乐场/assets
```

---

## 四、几个容易踩的坑

| 现象 | 原因 |
| --- | --- |
| 换了显示器，点击位置整体偏移 | 热区用了 `u/v` 屏幕分数。改用 `design` 像素 |
| 改了 `events.jsonc` 没反应 | 事件表不热重载，要在 WE 里**重新加载壁纸** |
| 点了没反应 | `touch.fullscreen` 开着时只剩整屏一个区；或事件的 `weight` 是 0（只能手动触发） |
| 某条事件永远不出现 | 检查 `when` 条件、`quota` 配额，以及系统时间是否被改过 |

---

## 五、许可与免责

本工程仅用于**个人学习与技术交流**。关于 Spine Runtimes 的许可要求、
素材权利归属与免责声明，请看仓库根目录的 [README](../README.zh.md)。
