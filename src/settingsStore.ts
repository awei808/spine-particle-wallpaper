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

/**
 * 运行时设置：**覆盖层（override）**的存储与合并。
 *
 * ## 为什么是"覆盖层"而不是改写 config.json
 *
 * `assets/config.json` 是**只读默认值**（打包进壁纸的资源），而用户在 WE 里改的
 * 是**个人偏好**。两者必须分开，否则：
 *   - 更新壁纸会覆盖掉用户的设置；
 *   - 同一个包没法给不同用户留不同偏好。
 *
 * ⇒ `config.json` 提供缺省，localStorage 提供覆盖，**读的时候合并**。
 *
 * ## 为什么持久化用 localStorage（而不是只靠 WE 的 userProperties）
 *
 * 1. WE 的 `applyUserProperties` 只在 **WE 环境**里才有；同一份包在普通浏览器里
 *    预览时也要能用（否则调试/验证脚本无从下手）。
 * 2. localStorage 在 WE 里同样是持久的（按壁纸隔离），等于两个入口共用一份真值。
 *
 * ⚠️ WE 某些隐私设置下 localStorage 可能抛异常 ⇒ 全部读写包 try/catch，
 * 抛了就**降级为进程内内存态**（功能不残废，只是关掉后丢）。
 *
 * ## 生效方式：**保存 → 重载页面**
 *
 * 用户拍板（`-- settings UID: 2026-09-22`）：不做运行时热切换。
 * 理由很实在 —— 气泡 DOM、常驻序列、语音播放器都是**开机一次性构造**的，
 * 热切换要为每个模块写"半初始化"的拆解逻辑，状态残留很难排；
 * 而 `location.reload()` 天然干净，代价只是切换时黑屏约 1 秒。
 */

import {
  Configs,
  FerrisWheelConfig,
  GreetMode,
  IdleSequenceItem,
  TriggerEventKind,
  TriggerPhase,
  TouchFeedbackMode,
} from './config.type';
// 只为读"探针当前生效值"的缺省（见 readView）——probe 不反向依赖本模块，无循环
import { PROBE_OPTS } from './probe';
// 摊平"新多选 / 待机通道的旧两个布尔"的口径（纯函数，可单测）；dialogue 不反向依赖本模块，无循环
import {
  buildFamilyRegistry,
  FamilyRegistry,
  resolveActionPhase,
  resolvePhases,
  resolveTriggerIntent,
} from './dialogue';

/** localStorage 键。带版本号，将来改结构时便于一次性弃用旧值 */
export const SETTINGS_STORAGE_KEY = 'wb.swe.settings.v1';

/**
 * 可被用户覆盖的设置。
 *
 * ⚠️ **刻意保持"扁平 + 显式列举"**：不用 `{ bgm: { enabled } }` 那种嵌套结构。
 * 嵌套会让"某个子字段有没有被覆盖"变成三态判断（undefined / false / true），
 * 扁平 + `undefined` = 未覆盖，语义唯一。
 *
 * `panelOpen` 是 UI 状态不是设置，但它的诉求一样（重载后要还原），放在一起省一套存储。
 */
export type SettingsOverrides = {
  /**
   * **全部静音**（BGM + 念白一起不出声）。
   *
   * 与 `bgmEnabled` / `voiceEnabled` 是**两回事**：那两个是各自的独立开关，
   * 这个是压在它们之上的总闸（总闸关 ⇒ 两个都不响，但各自的开关值原样保留）。
   */
  muteAll?: boolean;
  bgmEnabled?: boolean;
  /** BGM 音量 0~1 */
  bgmVolume?: number;
  /** 字幕气泡是否显示 */
  subtitleEnabled?: boolean;
  /** 字幕位置预设：`game`（解包固定位置）/ `bottom`（底部字幕条）/ `custom`（自由定位） */
  subtitlePosition?: 'game' | 'bottom' | 'custom';
  /** 字幕水平锚点（0~1，仅 `position:'custom'` 生效；对应 config.subtitle.anchorU） */
  subtitleAnchorU?: number;
  /** 字幕垂直锚点（0~1，仅 `position:'custom'` 生效；对应 config.subtitle.anchorV） */
  subtitleAnchorV?: number;
  /** 念白语音是否播放 */
  voiceEnabled?: boolean;
  /**
   * 角色语音（念白 CV）音量 0~1。
   *
   * 对应 `config.subtitle.audio.volume`（config 缺省 **1.0**）。
   * ★ 与 `bgmVolume` 是**两条独立链路**（一个给 `voicePlayer`、一个给 `bgmPlayer`），
   *   互不影响；只有 `muteAll` 这个总闸能把两者一起压住。
   *
   * 改完需重载生效（`<audio>.volume` 在元素创建时写一次，见 `voicePlayer.ts`）。
   */
  voiceVolume?: number;
  /**
   * 全屏适配的**对齐基准**（对应 `config.fitAspect`，「画面调整」页）。
   *
   * - `'width'` = **按画幅宽对齐**（**缺省**，2026-10-21 用户拍板）：可见宽恒 = 设计画幅宽
   *   ⇒ 左右内容永不被裁，代价是相对游戏画面偏小（16:9 下约为按高对齐的 78%）。
   * - `'height'` = **按画幅高对齐**：可见高恒 = 设计态可见高 ⇒ 与游戏内取景一致；
   *   屏幕比设计画幅窄时裁两侧、宽时多露背景。
   *
   * 取证与两种基准的定量关系见 `config.type.ts` 的 `fitAspect` 注释。
   * 切换**需重载**：fov 与垂直锚点 `camY` 在 `initScene` 构造期算一次。
   */
  fitAspect?: 'width' | 'height';
  /**
   * 摩天轮轿厢姿态角（对应 `config.ferrisWheel.cabinMode`；面板「壁纸独立设置」页）。
   *
   * `gravity` = 沿用解包 `startRotation`（−15°，随画面重力）；
   * `game` = 强制 0°（画布对齐，与游戏实录一致）。取证见 `config.type.ts` 的
   * `FerrisWheelConfig` 注释。切换**需重载**（spawn 时读值）。
   *
   * ★ 2026-10-11 起它在面板上的位置从「画面调整」页挪到「壁纸独立设置」页
   *   （只对声明了该项的壁纸出现）—— **覆盖层字段名、落盘格式、读写链路全都没变**，
   *   用户在旧版设过的值照样生效（面板那一页是否出现由 `config.wallpaperSettings` 决定）。
   */
  cabinMode?: FerrisWheelConfig['cabinMode'];
  /**
   * 指针（鼠标）拖尾粒子总开关（对应 `config.pointerTrail.enabled`）。
   *
   * 打开 ⇒ 指针移动时沿轨迹留下**等距**粒子（复刻游戏 `FX_UI_CommonUI_Click` 的
   * `/5`、`/5/6`，见 `pointerTrail.ts` 与 09 文档 `19_指针拖尾_壁纸实现.md`）。
   *
   * 改了**需重载**：发射器是开机一次性构造的（纹理、几何缓冲），
   * 与 `cabinMode` 一样同属"构造期配置"。
   */
  pointerTrailEnabled?: boolean;
  idleSequenceEnabled?: boolean;
  /** 序列内容（**只存动画名**；`{actionId}` 形式请在 config.json 里配） */
  idleSequenceItems?: string[];
  idleSequenceGapMs?: number;
  /**
   * 待机阈值：空闲多久触发一次「待机自动播放」（秒）。
   *
   * 对应 `config.subtitle.standbyIdleMs`（面板里暴露成秒更直观）。
   * ★ 待机通道勾中的那几类事件**共用**这一个阈值；
   *   到底播哪几类由下面的 `standbyKinds` 决定。
   * 改完需重载生效（气泡/轮询是开机一次性构造的，见文件头"生效方式"）。
   */
  standbyIdleSec?: number;
  /**
   * **长时间待机可触发的事件（多选）** —— 对应 `config.subtitle.standbyKinds`。
   *
   * `TriggerEventKind` 的子集；**缺省（不写本字段）= `['chat']`**
   * （还原"配了 `standby` 就一定会播"的老行为，修 2026-09-30「出厂什么也不播」的回归）。
   * 语义、并池口径与可用性判据见 `config.type.ts` 的 `TriggerEventKind`。
   */
  standbyKinds?: TriggerEventKind[];
  /**
   * **触摸可触发的事件（多选）** —— 对应 `config.subtitle.touchKinds`。
   *
   * `TriggerEventKind` 的子集；**缺省（不写本字段）= `['touch']`**
   * （= 点击只从 `touch` 数组里随机，与改动前一致）。
   *
   * ★ 本字段**取代了被删掉的旧布尔 `greetInTouchPool`**（面板「touch触发greet事件」）——
   *   它的语义现在由"勾上 greet 类"表达，而且顺带支持 chat 类。
   *   改了要重载（触摸池是 `createTouchController` 开机一次性构造的）。
   */
  touchKinds?: TriggerEventKind[];
  /**
   * **允许触发的事件族（多选）** —— 对应 `config.subtitle.phases`。
   *
   * 取值是 `config.subtitle.eventFamilies` 注册表的 id 子集（见 `config.type.ts` 的
   * `EventFamily`）。★★ 2026-10-17 起**对所有入口生效**（此前只作用于点击触摸，
   * 字段也因此叫 `touchPhases`）：
   *
   * | 勾选 | 结果 |
   * |---|---|
   * | 勾了若干族 | 待机 / 点击 / 回到壁纸 / 常驻序列都只从这些族取条 |
   * | **空数组** | **所有事件都不触发**（档案里没有任何事件行） |
   * | 不写 | 注册表的缺省勾选（没声明注册表 ⇒ 内置单族 `normal`） |
   *
   * ⚠️ 改了要重载（池是开机一次性构造的）。
   */
  phases?: TriggerPhase[];
  /**
   * ⚠️ **旧键（改名前的 `touchPhases`）** —— 只为"老存档照常生效"而保留读取。
   *
   * ⚠️ 新代码**不要再往这里写**：`applyOverrides` 里 `phases` 优先，两者同在时旧键被忽略。
   * 判据集中在 `dialogue.resolvePhases`。
   */
  touchPhases?: TriggerPhase[];
  /**
   * **"已经向用户介绍过"的事件族**（2026-10-21）—— 只为**新事件的族能自动补勾**而记。
   *
   * ## 它解决什么
   *
   * `phases` 一旦被面板写进覆盖层，就变成"用户勾选的**全集**"。此后作者再在
   * `config.subtitle.eventFamilies` 里新增一族（如 2026-10-20 新增的 `festival`），
   * 老存档里那份 `["normal"]` **不会**把它带进来 ⇒ 新族的事件一条都不播，
   * 而用户完全不知道要去哪里勾（档案里只会显示"所属事件族未勾选"）。
   *
   * ## 为什么不直接"每次启动都把所有 default 族补上"
   *
   * 那样用户**永远关不掉**某一族：他取消勾选 ⇒ 存成 `["normal"]` ⇒ 下次启动又补回来。
   * ⇒ 必须区分"没见过的新族"与"用户主动取消的旧族"，靠的就是这份**见过清单**。
   *
   * ## 口径
   *
   * | 情况 | 处理 |
   * |---|---|
   * | 族 id 不在本清单且在注册表里标了 `default` | **补勾一次**，并记进本清单 |
   * | 族 id 已在本清单 | 不动（用户取消勾选后不会被回补） |
   * | 族没标 `default` | 不补（作者没把它当默认，不该强加） |
   *
   * ★ 迁移逻辑集中在 `mergeNewFamilyDefaults`，**由 `index.ts` 在合并覆盖层之前调用一次**
   *   （不是面板的职责；面板只在保存时把当前所有族记成"已见过"）。
   */
  phasesSeen?: TriggerPhase[];
  /**
   * **当前显示的动作族（单选）** —— 对应 `config.subtitle.actionPhase`（2026-10-17 新增）。
   *
   * 取值 = `config.subtitle.eventFamilies` 里某个**带 `matchSuffix` 的族**的 id，
   * 或 **`''`**（= 不换名那一档，誓约工程写「誓约前」）。
   *
   * ★ 它管的是"**播哪一套 spine 动画**"（全局：常驻 idle / 问候 / 待机 / 点击 / 序列），
   *   与 `phases`（哪些念白能被抽到）**正交** —— 两件事，别合并。
   * ★ **缺省（不写本字段）= 注册表里第一个动作族**（誓约工程 ⇒ 婚后）；
   *   显式 `''` = 誓约前。见 `dialogue.resolveActionPhase`。
   * ⚠️ 改了要重载（池与常驻动画都是开机一次性构造的）。
   */
  actionPhase?: TriggerPhase;
  /**
   * **回到壁纸可触发的事件（多选）** —— 对应 `config.subtitle.resumeKinds`。
   *
   * `TriggerEventKind` 的子集；**缺省（不写本字段）= `['greet']`**
   * （= 载入后延迟 / 回到桌面 / 回到前台 / WE 暂停恢复这四个自动时机仍只播问候）。
   * 改了要重载（自动信号是 `startAutoPlay` 时一次性挂上的）。
   */
  resumeKinds?: TriggerEventKind[];
  /**
   * ⚠️ **旧口径**（兼容输入）：待机到点是否也自动触发「问候」（greet）事件。
   * 对应 `config.subtitle.standbyGreetEnabled`。
   *
   * 已被 `standbyKinds` 取代 —— **只在 `standbyKinds` 缺席时**被 `readView` /
   * `dialogue.resolveTriggerIntent` 读取（`true` ⇒ 意向里追加 `'greet'`）。
   * ⚠️ 旧口径下 `'chat'` 恒在，所以本字段为 `false` **不会**把待机闲聊一起关掉。
   */
  standbyGreetEnabled?: boolean;
  /**
   * ⚠️ **旧口径**（兼容输入）：待机到点是否也自动触发「触摸（touch）」事件。
   * 对应 `config.subtitle.standbyTouchEnabled`。
   *
   * 已被 `standbyKinds` 取代 —— **只在其缺席时**读取（`true` ⇒ 追加 `'touch'`）。
   */
  standbyTouchEnabled?: boolean;
  /**
   * 正在播动作时**点击**该怎么处理（对应 `config.subtitle.touchFeedbackMode`）。
   *
   * ★ 语义表见 `TouchFeedbackMode` 的注释；**缺省 `'legacy'`**（面板第一档，= 改动前的规则表）。
   * ⚠️ 落盘即进覆盖层 ⇒ 与 `config.json` 里写的值**同名同语义**，只是优先级更高。
   */
  touchFeedbackMode?: TouchFeedbackMode;
  /**
   * 问候事件的取条方式（对应 `config.subtitle.greetMode`）。
   *
   * `'time'` = 按当前系统时刻取 `greet` 池里同一序号那条；`'random'` = 池内随机。
   * 缺省 `'time'`。
   */
  greetMode?: GreetMode;
  /**
   * 探针（调试）相关开关。对应 config 的 `probe.*` / `touch.showZones`。
   *
   * `probeEnabled` 的**缺省**取自编译期（`--env probe=off` 的包默认关），
   * 但**双向可覆盖** ⇒ 正式版里也能打开/关掉，见 `probe.ts` 的 `applyProbeConfig`。
   */
  probeEnabled?: boolean;
  /** 左上角 HUD 文字块（config.probe.hud） */
  probeHud?: boolean;
  /** 鼠标位置红圈（config.probe.crosshair） */
  probeCrosshair?: boolean;
  /** 触摸热区调试框（config.touch.showZones） */
  probeZones?: boolean;
  /**
   * **触摸热区范围改为全屏**（对应 `config.touch.fullscreen`）。
   *
   * `true` ⇒ 忽略 `zones`，整屏一块热区。缺省 false（用 `zones`）。
   */
  touchFullscreen?: boolean;
  /**
   * 是否显示居中的「免责声明与许可证要求」弹窗（对应 WE 属性面板里的开关）。
   *
   * ★ **UI 门面开关，不是配置项** ——
   * 不在 `config.json` 里、`applyOverrides` 不消费它、`readView` 也产不出它
   * （硬塞进 `SettingsView` 会让每次启动都被 `sameView` 判成"有变化"⇒ 白重载）。
   * 打开 ⇒ 弹窗**常驻**显示；关闭 ⇒ 消失。热切换，见 `index.ts` 的 `applyWePatch`。
   */
  showDisclaimer?: boolean;
  /**
   * 是否显示居中的「档案」面板（对应 WE 属性面板里的开关）。
   *
   * ★ 与 `showDisclaimer` 同类：**UI 门面开关，不是配置项** ——
   * 不在 `config.json` 里、`applyOverrides` 不消费它、`readView` 也产不出它
   * （硬塞进 `SettingsView` 会让每次启动都被 `sameView` 判成"有变化"⇒ 白重载）。
   * 打开 ⇒ 面板**常驻**显示（以表格列出壁纸可能触发的事件与触发条件）；关闭 ⇒ 消失。
   * 热切换，见 `index.ts` 的 `applyWePatch`；内容由 `archive.ts` 从运行时 config 现算。
   */
  showArchive?: boolean;
  /**
   * 右上角**整列入口**（折叠按钮 + 5 个入口）是否显示 —— WE 属性 `showCornerButtons`，
   * 即属性面板**第一项**「显示右上角按钮」。
   *
   * ★ 与 `showDisclaimer` / `showArchive` 同类：**UI 门面开关，不是配置项** ——
   * 不在 `config.json` 里、`applyOverrides` 不消费它、`readView` 也产不出它
   * （硬塞进 `SettingsView` 会让每次启动都被 `sameView` 判成"有变化"⇒ 白重载）。
   * 热切换，见 `index.ts` 的 `applyWePatch`。
   * ★★ 这是入口列**唯一**的显隐开关（2026-10-17 晚口径变更）：原先并存的
   *   `showSettings`（设置按钮显示，只管齿轮那一个按钮）已随用户拍板撤回而删除。
   *   ⚠️ 老存档/老 `project.json` 里残留的 `showSettings` 键**不再被读取**（静默忽略）。
   */
  showCornerButtons?: boolean;
  /** 设置面板当前是否展开。仅用于重载后还原 UI 状态 */
  panelOpen?: boolean;
  /**
   * 调试面板（入口列里那个按钮）当前是否展开。仅用于重载后还原 UI 状态。
   *
   * ★ 与 `panelOpen` **互斥**：两个都存了 `true` 时只还原设置面板
   * （见 `settingsPanel.ts` 里 `debugOpen` 的初值）。
   */
  debugPanelOpen?: boolean;
  /**
   * 入口列是否**收起**（只留折叠按钮）。仅用于重载后还原 UI 状态。
   *
   * ★ 与 `panelOpen` / `debugPanelOpen` 同类：UI 状态不是设置项，只是"重载后要还原"，
   *   所以不落进 `config.json`、也不进 `SettingsView`。
   * 缺省（`undefined` / `false`）= **展开**（用户 2026-10-17 拍板：默认展开 + 记忆）。
   */
  cornerCollapsed?: boolean;
};

/** 合并后的"当前生效值"，给面板渲染用（永远有值，无 undefined） */
export type SettingsView = {
  /** 全部静音（总闸） */
  muteAll: boolean;
  bgmEnabled: boolean;
  bgmVolume: number;
  subtitleEnabled: boolean;
  subtitlePosition: 'game' | 'bottom' | 'custom';
  /** 字幕自由定位的水平锚点（0~1，仅 custom 生效） */
  subtitleAnchorU: number;
  /** 字幕自由定位的垂直锚点（0~1，仅 custom 生效） */
  subtitleAnchorV: number;
  voiceEnabled: boolean;
  /** 角色语音（念白 CV）音量 0~1。对应 `config.subtitle.audio.volume` */
  voiceVolume: number;
  /** 全屏适配的对齐基准：`height` = 按画幅高（缺省，同游戏取景）/ `width` = 按画幅宽 */
  fitAspect: 'width' | 'height';
  /** 摩天轮轿厢姿态角：`gravity` = 解包 −15°（随画面重力）/ `game` = 画布对齐 0° */
  cabinMode: 'gravity' | 'game';
  /** 指针（鼠标）拖尾粒子是否开启（对应 `config.pointerTrail.enabled`） */
  pointerTrailEnabled: boolean;
  idleSequenceEnabled: boolean;
  idleSequenceItems: string[];
  idleSequenceGapMs: number;
  /** 待机多久后触发一次「待机自动播放」（秒）。对应 config.subtitle.standbyIdleMs */
  standbyIdleSec: number;
  /**
   * 长时间待机可触发的事件（**多选**，固定顺序 `chat` → `greet` → `touch`）。
   *
   * ⚠️ 这是**意向列表**（`dialogue.resolveTriggerIntent` 的产物），**不判可用性** ——
   * 面板只管"该勾哪几个"，池空不空由 `resolveTriggerKinds` 在运行时判。
   */
  standbyKinds: TriggerEventKind[];
  /**
   * 触摸可触发的事件（**多选**）—— 点中任一热区时可能播的类别。
   *
   * ⚠️ 同样是**意向列表**，不判可用性；缺省 `['touch']`（= 只从 `touch` 池随机）。
   */
  touchKinds: TriggerEventKind[];
  /**
   * **允许触发的事件族**（多选，**意向列表**，顺序 = 注册表声明顺序）。
   *
   * ★★ **对所有入口生效**（2026-10-17 起；此前仅点击触摸）。空数组 = 所有事件都不触发。
   * ⚠️ 同样是意向列表，不判可用性。缺省 = 注册表的缺省勾选（没声明注册表 ⇒ `['normal']`）。
   */
  phases: TriggerPhase[];
  /**
   * **当前显示的动作族**（单选）—— 取值 = 某个带 `matchSuffix` 的族 id，或 `''`（不换名）。
   *
   * ★ 与 `phases` 正交：本项决定"播哪套动画名"，那一项决定"哪些念白能被抽到"。
   * 缺省 = 注册表的第一个动作族（誓约工程 ⇒ 婚后）；没有动作族 ⇒ `''`。
   */
  actionPhase: TriggerPhase;
  /**
   * 回到壁纸可触发的事件（**多选**）—— 载入 / 回到桌面 / 回到前台 / WE 恢复时可能播的类别。
   *
   * ⚠️ 同样是**意向列表**，不判可用性；缺省 `['greet']`（= 只播问候）。
   */
  resumeKinds: TriggerEventKind[];
  /** 正在播动作时点击的处理方式（对应 `config.subtitle.touchFeedbackMode`；缺省 `legacy`） */
  touchFeedbackMode: TouchFeedbackMode;
  /** 问候事件的取条方式（对应 `config.subtitle.greetMode`） */
  greetMode: GreetMode;
  /** 探针总开关（= 编译期闸门 ⊗ config.probe.enabled） */
  probeEnabled: boolean;
  probeHud: boolean;
  probeCrosshair: boolean;
  probeZones: boolean;
  /** 触摸热区是否改为**全屏**（对应 `config.touch.fullscreen`；缺省 false） */
  touchFullscreen: boolean;
};

/** localStorage 不可用时的退路 */
let memoryFallback: SettingsOverrides = {};
let storageWarned = false;

const isPlainOverrides = (v: unknown): v is SettingsOverrides =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 读当前覆盖层。任何异常都退化为空对象（= 全用 config 默认值） */
export const readOverrides = (): SettingsOverrides => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...memoryFallback };
    }
    const parsed = JSON.parse(raw) as unknown;
    return isPlainOverrides(parsed) ? parsed : { ...memoryFallback };
  } catch (e) {
    if (!storageWarned) {
      storageWarned = true;
      console.warn(
        '[settings] localStorage 不可用，设置将只在本次会话内有效: %s',
        (e as Error)?.message ?? e
      );
    }
    return { ...memoryFallback };
  }
};

/** 合并写入并返回合并后的全量覆盖层 */
export const writeOverrides = (patch: SettingsOverrides): SettingsOverrides => {
  const next: SettingsOverrides = { ...readOverrides(), ...patch };
  memoryFallback = { ...next };
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    // 已在 readOverrides 里 warn 过，这里不再刷屏
  }
  return next;
};

/**
 * **新事件族的"补勾"迁移**（2026-10-21）。
 *
 * ## 为什么需要
 *
 * `phases`（允许触发的事件族）一旦被写进覆盖层，就固化成"用户勾选的全集"。此后作者
 * 在 `config.subtitle.eventFamilies` 里新增一族并标 `default: true`（如 `festival`），
 * 老存档那份 `["normal"]` 不会带上它 ⇒ **新族的事件一条都不触发**，而用户在档案里
 * 只能看到"所属事件族未勾选"—— 不知道要去哪里开。
 *
 * ## 为什么是"补一次"而不是"每次都补"
 *
 * 每次都补 ⇒ 用户**永远关不掉**某一族（取消勾选 → 存成 `["normal"]` → 下次又补回来）。
 * ⇒ 用 `phasesSeen`（见过清单）区分两种情况：**没见过的新族**才补。
 *
 * @param o  当前覆盖层（通常是 `readOverrides()` 的结果）
 * @param reg 本壁纸的事件族注册表（`dialogue.buildFamilyRegistry`）
 * @returns 补过之后的覆盖层（没变化就**原样返回**，不写盘）
 */
export const mergeNewFamilyDefaults = (
  o: SettingsOverrides,
  reg: FamilyRegistry
): SettingsOverrides => {
  /**
   * ① 注册表为空（本壁纸没有事件族机制）⇒ 无从谈起。
   * ② 用户**从没写过** `phases` ⇒ 生效值本来就是 `reg.defaultIds`（含新族），
   *    不必写盘（写了反而把"没配"固化成"显式写死"）。
   */
  if (!reg.families.length || !Array.isArray(o.phases)) {
    return o;
  }
  /** 存档里那份显式勾选（已确认是数组） */
  const cur: readonly TriggerPhase[] = o.phases;
  const seen = Array.isArray(o.phasesSeen) ? o.phasesSeen : [];
  /** 只补"标了 default 且没见过"的族 —— 作者没标 default 的族不该强加给用户 */
  const missing = reg.defaultIds.filter(
    (id) => seen.indexOf(id) < 0 && cur.indexOf(id) < 0
  );
  if (!missing.length) {
    return o;
  }
  /**
   * 顺序按**注册表声明顺序**（与 `dialogue.normalizeTriggerPhases` 同一口径：
   * 同一种勾选永远只有一种形状，否则 `sameView` 会因为顺序不同而误判"有变化"）。
   */
  const phases = reg.ids.filter(
    (id) => cur.indexOf(id) >= 0 || missing.indexOf(id) >= 0
  );
  /** 见过的族 = 旧清单 ∪ 本次补的 ∪ 注册表里所有 default 族（它们已向用户展示过） */
  const phasesSeen: TriggerPhase[] = [];
  seen.concat(reg.defaultIds, missing).forEach((id) => {
    if (phasesSeen.indexOf(id) < 0) {
      phasesSeen.push(id);
    }
  });
  console.info(
    '[settings] 事件族新增：已自动补勾 %s（在「事件池 → 事件族」里可取消）',
    missing.join('、')
  );
  return writeOverrides({ phases, phasesSeen });
};

export const clearOverrides = (): void => {
  memoryFallback = {};
  try {
    window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
  } catch (e) {
    // ignore
  }
};

/**
 * 「恢复默认」在清空覆盖层之后**额外强制写入**的少数几项。
 *
 * ## 为什么不能只调 `clearOverrides()`
 *
 * `clearOverrides()` 只是删掉 localStorage ⇒ 所有值回落到 `assets/config.json`。
 * 而本工程是**开发态探针工程**，`config.json` 里 `probe.enabled` / `probe.hud` 都是
 * `true` ⇒ 点「恢复默认」后调试总开关与 HUD 反而是**打开**的，与用户预期相反
 * （用户 2026-09-30 拍板：恢复默认应当**不勾选调试**）。
 *
 * ## 为什么是"额外强制"而不是改 `config.json` 里 `probe` 的默认值
 *
 * 那几个默认值是**开发期刻意留的**（本机调壁纸要开 HUD 看坐标／帧率／命中数）。
 * 改它会连带影响每次冷启动的初始状态 ⇒ 属于"顺手改了不相干的东西"。
 * 这里只把这几个键写进覆盖层，作用范围严格限定在「恢复默认」这一个动作上。
 */
export const RESET_OVERRIDES: Readonly<SettingsOverrides> = {
  probeEnabled: false,
  probeHud: false,
  probeCrosshair: false,
  probeZones: false,
};

/**
 * 把覆盖层合并进 config，得到真正生效的配置。
 *
 * ★ **不改原对象**（浅拷贝后改），因为传进来的通常就是 `await res.json()` 的结果，
 * 直接改会让"当前默认值"读不回来，面板也就无从显示"哪些是被覆盖过的"。
 */
export const applyOverrides = (cfg: Configs, o: SettingsOverrides): Configs => {
  if (!isPlainOverrides(o) || Object.keys(o).length === 0) {
    return cfg;
  }
  const out: Configs = { ...cfg };

  // 静音总闸的**值**先记下来（供面板回读）；真正的"压制"在末尾做，见下
  if (o.muteAll !== undefined) {
    out.muteAll = o.muteAll;
  }

  const needBgm = o.bgmEnabled !== undefined || o.bgmVolume !== undefined;
  if (needBgm) {
    out.bgm = { ...(cfg.bgm ?? {}) };
    if (o.bgmEnabled !== undefined) {
      out.bgm.enabled = o.bgmEnabled;
    }
    if (o.bgmVolume !== undefined) {
      out.bgm.volume = o.bgmVolume;
    }
  }

  const needSubtitle =
    o.subtitleEnabled !== undefined ||
    o.voiceEnabled !== undefined ||
    o.voiceVolume !== undefined ||
    o.subtitlePosition !== undefined ||
    o.standbyKinds !== undefined ||
    o.touchKinds !== undefined ||
    o.phases !== undefined ||
    o.touchPhases !== undefined ||
    o.actionPhase !== undefined ||
    o.resumeKinds !== undefined ||
    o.standbyGreetEnabled !== undefined ||
    o.standbyTouchEnabled !== undefined ||
    o.touchFeedbackMode !== undefined ||
    o.greetMode !== undefined;
  if (needSubtitle) {
    out.subtitle = { ...(cfg.subtitle ?? {}) };
    if (o.subtitleEnabled !== undefined) {
      out.subtitle.enabled = o.subtitleEnabled;
    }
    if (o.subtitlePosition !== undefined) {
      out.subtitle.position = o.subtitlePosition;
    }
    if (o.subtitleAnchorU !== undefined) {
      out.subtitle.anchorU = o.subtitleAnchorU;
    }
    if (o.subtitleAnchorV !== undefined) {
      out.subtitle.anchorV = o.subtitleAnchorV;
    }
    /**
     * ★ 两处 `subtitle.audio` 的 base 一律取 **`out.subtitle.audio`**（不是 `cfg.subtitle.audio`）——
     * 同一个 patch 里同时带 `voiceEnabled` 与 `voiceVolume` 时，后一个必须在**前者刚建好的
     * 那个对象**上继续改，否则会把 `enabled` 覆盖回去（同一个坑 `standbyIdleMs` 注释里写过）。
     */
    if (o.voiceEnabled !== undefined) {
      out.subtitle.audio = {
        ...(out.subtitle.audio ?? cfg.subtitle?.audio ?? {}),
      };
      out.subtitle.audio.enabled = o.voiceEnabled;
    }
    if (o.voiceVolume !== undefined) {
      out.subtitle.audio = {
        ...(out.subtitle.audio ?? cfg.subtitle?.audio ?? {}),
      };
      out.subtitle.audio.volume = o.voiceVolume;
    }
    /**
     * ★★ 三个通道的「可触发的事件」（多选）。**必须 slice** —— 与面板里 `draft.*` 的数组
     *    同源时，不拷一份的话用户在面板里点 chips 会**就地改到"生效值"**上（同一个坑
     *    `idleSequenceItems` 注释里写过）。
     */
    if (o.standbyKinds !== undefined) {
      out.subtitle.standbyKinds = o.standbyKinds.slice();
    }
    if (o.touchKinds !== undefined) {
      out.subtitle.touchKinds = o.touchKinds.slice();
    }
    /**
     * ★★ 事件族闸门。**`phases` 优先**（2026-10-17 改名）；只有它缺席时才落到旧键
     *    `touchPhases`（老存档）。两者同在时**旧键被忽略**，避免出现两个生效的开关。
     * ⚠️ 必须 `slice`（同 `*Kinds`）—— 与面板 `draft.phases` 同源时不拷一份，
     *   用户在面板里点 chips 会**就地改到"生效值"**上。
     */
    if (o.phases !== undefined) {
      out.subtitle.phases = o.phases.slice();
    } else if (o.touchPhases !== undefined) {
      out.subtitle.touchPhases = o.touchPhases.slice();
    }
    /**
     * ★ 动作族是**标量**（单选），没有 slice 的坑；`''` 是合法值（= 誓约前/不换名），
     *   所以判据必须是 `!== undefined`，不能写成真值判断。
     */
    if (o.actionPhase !== undefined) {
      out.subtitle.actionPhase = o.actionPhase;
    }
    if (o.resumeKinds !== undefined) {
      out.subtitle.resumeKinds = o.resumeKinds.slice();
    }
    if (o.standbyGreetEnabled !== undefined) {
      out.subtitle.standbyGreetEnabled = o.standbyGreetEnabled;
    }
    if (o.standbyTouchEnabled !== undefined) {
      out.subtitle.standbyTouchEnabled = o.standbyTouchEnabled;
    }
    /**
     * ★★ 两个新事件的覆盖写在 `needSubtitle` 分支**之内** —— 它们都是 `subtitle` 下的字段，
     *    若像 `standbyIdleSec` 那样单独再 spread 一次 `out.subtitle`，同一 patch 里
     *    其它 subtitle 字段的修改会被它后面的分支写回旧值（该坑注释已写过两次）。
     */
    if (o.touchFeedbackMode !== undefined) {
      out.subtitle.touchFeedbackMode = o.touchFeedbackMode;
    }
    if (o.greetMode !== undefined) {
      out.subtitle.greetMode = o.greetMode;
    }
  }

  /**
   * 全屏适配的对齐基准（「画面调整」页）。
   *
   * ★ 顶层字段，直接覆写 `cfg.fitAspect`（`initScene` 构造期读一次 ⇒ 需重载生效）。
   */
  if (o.fitAspect !== undefined) {
    out.fitAspect = o.fitAspect;
  }

  /** 摩天轮轿厢姿态角（「壁纸独立设置」页；2026-10-11 从「画面调整」页挪来） */
  if (o.cabinMode !== undefined) {
    out.ferrisWheel = { ...(cfg.ferrisWheel ?? {}) };
    out.ferrisWheel.cabinMode = o.cabinMode;
  }

  /**
   * 指针拖尾总开关（「画面调整」页）。
   *
   * ★ 只覆写 `enabled`，其余字段（`planeZ` / `emitters`）原样沿用 config ——
   *   面板只暴露"开不开"，参数仍以 config.json 为唯一数据源。
   */
  if (o.pointerTrailEnabled !== undefined) {
    out.pointerTrail = { ...(cfg.pointerTrail ?? { emitters: [] }) };
    out.pointerTrail.enabled = o.pointerTrailEnabled;
  }

  const needSeq =
    o.idleSequenceEnabled !== undefined ||
    o.idleSequenceItems !== undefined ||
    o.idleSequenceGapMs !== undefined;
  if (needSeq) {
    out.idleSequence = { ...(cfg.idleSequence ?? {}) };
    if (o.idleSequenceEnabled !== undefined) {
      out.idleSequence.enabled = o.idleSequenceEnabled;
    }
    if (o.idleSequenceItems !== undefined) {
      /**
       * ★ 2026-10-20：**解码**回 config 的三类形状（见 `parseSequenceItem`）。
       *   只写裸字符串会把 `{key}` / `{actionId}` 项永久抹掉 —— 那是数据丢失，
       *   不是"设置生效"。
       */
      out.idleSequence.items = o.idleSequenceItems.map(
        (s) => parseSequenceItem(s) as IdleSequenceItem
      );
    }
    if (o.idleSequenceGapMs !== undefined) {
      out.idleSequence.gapMs = o.idleSequenceGapMs;
    }
  }

  /**
   * 待机触发聊天的延迟（秒 → 毫秒落到 `subtitle.standbyIdleMs`）。
   *
   * ★ 必须先 spread `out.subtitle`（而不是 `cfg.subtitle`）：
   * 上面的 `needSubtitle` 分支可能已改过 `out.subtitle.enabled` 等字段，
   * 直接 `{ ...cfg.subtitle }` 会把它们覆盖回去。
   */
  if (o.standbyIdleSec !== undefined) {
    out.subtitle = { ...(out.subtitle ?? cfg.subtitle ?? {}) };
    out.subtitle.standbyIdleMs =
      Math.max(0, Math.round(o.standbyIdleSec)) * 1000;
  }

  const needProbe =
    o.probeEnabled !== undefined ||
    o.probeHud !== undefined ||
    o.probeCrosshair !== undefined;
  if (needProbe) {
    out.probe = { ...(cfg.probe ?? {}) };
    if (o.probeEnabled !== undefined) {
      out.probe.enabled = o.probeEnabled;
    }
    if (o.probeHud !== undefined) {
      out.probe.hud = o.probeHud;
    }
    if (o.probeCrosshair !== undefined) {
      out.probe.crosshair = o.probeCrosshair;
    }
  }

  // 热区调试框挂在 touch 块下（数据源是同一条热区表，见 index.ts）
  if (o.probeZones !== undefined) {
    out.touch = { ...(cfg.touch ?? {}) };
    out.touch.showZones = o.probeZones;
  }

  /**
   * 触摸热区改为全屏（面板「事件触发」页）。
   *
   * ★ base 取 **`out.touch`**（不是 `cfg.touch`）：同一个 patch 里若同时带 `probeZones`
   *   与 `touchFullscreen`，后一个必须在**前者刚建好的那个对象**上继续改，否则会把
   *   `showZones` 覆盖回去（同一个坑 `standbyIdleMs` / `subtitle.audio` 的注释里写过）。
   */
  if (o.touchFullscreen !== undefined) {
    out.touch = { ...(out.touch ?? cfg.touch ?? {}) };
    out.touch.fullscreen = o.touchFullscreen;
  }

  /**
   * ★★ 静音总闸的**压制**必须放在最后：它是比 `bgmEnabled` / `voiceEnabled`
   * 更高一级的约束，放前面会被上面那两个分支覆盖回去。
   * 单向压制 —— **不回写**那两个字段，解除静音后各自的组合原样还原。
   */
  if (o.muteAll === true) {
    out.bgm = { ...(out.bgm ?? cfg.bgm ?? {}) };
    out.bgm.enabled = false;
    out.subtitle = { ...(out.subtitle ?? cfg.subtitle ?? {}) };
    out.subtitle.audio = {
      ...(out.subtitle.audio ?? cfg.subtitle?.audio ?? {}),
    };
    out.subtitle.audio.enabled = false;
  }

  return out;
};

/**
 * 把 `idleSequence.items` 的任意写法折成一个**可还原**的字符串。
 *
 * ★★ 2026-10-20 从"只用于比较"升级为**编解码的一半**（另一半是 `parseSequenceItem`）。
 * 为什么必须可还原：面板「常驻动作序列」只能排裸动画名，保存时会把整表
 * `idleSequence.items` 换成这个字符串数组（`applyOverrides`）。此前 `{key}` 项
 * 被折成 `''` 再 `filter` 掉 ⇒ **点一次保存就把这些项永久删掉**；
 * `{animation,key}` 这种混写还会把身份换成动画名（`key` 才是取条凭据）。
 *
 * 编码（前缀避开合法动画名：spine 动画名里不会出现 `@` / `#` 打头）：
 *
 * | 输入 | 输出 | 还原 |
 * |---|---|---|
 * | `'chat'` | `'chat'` | `'chat'` |
 * | `{ key: 'custom:x' }` | `'@custom:x'` | `{ key: 'custom:x' }` |
 * | `{ actionId: 64005 }` | `'#64005'` | `{ actionId: 64005 }` |
 * | `{ animation: 'chat' }` | `'chat'` | `'chat'` |
 *
 * ⚠️ 同时给了 `key` 与 `actionId` 时**按 `key` 编码** —— 与
 *   `idleSequence.resolveSequence` 的"key 优先"同一条口径。
 */
const stringifyItem = (it: unknown): string => {
  if (typeof it === 'string') {
    return it;
  }
  if (it && typeof it === 'object') {
    const obj = it as { animation?: string; actionId?: number; key?: unknown };
    if (typeof obj.key === 'string' && obj.key) {
      return '@' + obj.key;
    }
    if (typeof obj.actionId === 'number') {
      return '#' + obj.actionId;
    }
    if (typeof obj.animation === 'string') {
      return obj.animation;
    }
  }
  return '';
};

/**
 * `stringifyItem` 的逆运算（写覆盖层时用）。
 *
 * 只认三个形状：`@<EventKey>` / `#<actionId>` / 其余当裸动画名 ——
 * 与 `idleSequence.resolveSequence` 接受的三类输入一一对应。
 */
const parseSequenceItem = (s: string): unknown => {
  if (typeof s === 'string' && s.charAt(0) === '@' && s.length > 1) {
    return { key: s.slice(1) };
  }
  if (/^#\d+$/.test(s)) {
    return { actionId: Number(s.slice(1)) };
  }
  return s;
};

/** 从（合并后的）配置读出"当前生效值"给面板渲染 */
export const readView = (cfg: Configs): SettingsView => ({
  muteAll: cfg.muteAll === true,
  bgmEnabled: cfg.bgm?.enabled !== false,
  bgmVolume: typeof cfg.bgm?.volume === 'number' ? cfg.bgm.volume : 0.5,
  subtitleEnabled: cfg.subtitle?.enabled !== false,
  subtitlePosition: cfg.subtitle?.position ?? 'custom',
  subtitleAnchorU:
    typeof cfg.subtitle?.anchorU === 'number' ? cfg.subtitle.anchorU : 0.5,
  subtitleAnchorV:
    typeof cfg.subtitle?.anchorV === 'number' ? cfg.subtitle.anchorV : 0.9,
  voiceEnabled: cfg.subtitle?.audio?.enabled !== false,
  /**
   * ★ 缺省 **1.0**，与 `voicePlayer.ts` 的 `cfg.volume ?? 1` 同一口径
   *   （语音若在这里少给默认值，会出现"面板显示 50%、实际按 100% 响"的假象）。
   */
  voiceVolume:
    typeof cfg.subtitle?.audio?.volume === 'number'
      ? cfg.subtitle.audio.volume
      : 1,
  /**
   * ★ 缺省 **`'width'`**（2026-10-21 用户拍板：任何屏幕上都完整看到设计画幅，
   *   左右内容永不被裁）。此前是 `'height'`，翻转理由见 `config.type.ts` 的
   *   `fitAspect` 注释（桌面比例普遍比设计画幅窄 ⇒ 按高对齐会裁两侧）。
   *
   * 判据写成"只认 `'height'`"而不是"只认 `'width'`" ⇒ 缺字段/写了别的无效值时
   * 都回落到缺省的宽对齐，与 `initScene` 的解析口径**完全一致**（两处必须同向，
   * 否则会出现"面板显示按宽、实际按高渲染"的假象）。
   */
  fitAspect: cfg.fitAspect === 'height' ? 'height' : 'width',
  /**
   * ★ 缺省 `gravity`（= 沿用解包 `startRotation` 的 −15°），**不是** `game`。
   *   理由：本壁纸此前的观感就是解包值，改默认等于"升级后画面悄悄变了"；
   *   想要游戏那份水平姿态的用户自己去「壁纸独立设置」页切即可。
   *
   * ⚠️ 读法与所在页无关：无论面板上这一项有没有出现（取决于本壁纸的
   *   `config.wallpaperSettings` 声明），值都从这里读 ⇒ 覆盖层与行为不受页序影响。
   */
  cabinMode: cfg.ferrisWheel?.cabinMode ?? 'gravity',
  /**
   * ★ 缺省 `false`：与 `pointerTrail.ts` 的口径一致（`enabled` 必须显式为 true 才建发射器），
   *   这样没有 `pointerTrail` 块的旧 config 跑起来不会多出视觉元素。
   */
  pointerTrailEnabled: cfg.pointerTrail?.enabled === true,
  idleSequenceEnabled: cfg.idleSequence?.enabled === true,
  idleSequenceItems: (cfg.idleSequence?.items ?? [])
    .map(stringifyItem)
    .filter((s) => !!s),
  idleSequenceGapMs:
    typeof cfg.idleSequence?.gapMs === 'number' ? cfg.idleSequence.gapMs : 0,
  // 缺省 25 秒，与 config.subtitle.standbyIdleMs 的 25000ms 对齐
  standbyIdleSec:
    typeof cfg.subtitle?.standbyIdleMs === 'number'
      ? Math.round(cfg.subtitle.standbyIdleMs / 1000)
      : 25,
  /**
   * ★★ 三个通道的「可触发的事件」（多选）。**摊平口径复用 `dialogue.resolveTriggerIntent`** ——
   *   面板显示的勾选态与运行时真正会播的类别不可能各写一套判据。
   *
   * 判据顺序（三个通道一致）：**新字段优先**（给了数组就完全以它为准，空数组 = 该通道全关）；
   * 缺席时用该通道缺省（见 `CHANNEL_DEFAULT_KINDS`）。⚠️ 仅 `standby` 通道还会读两个旧布尔
   * ⇒ `['chat']` 再追加各自的 `greet` / `touch`（旧 config 行为逐字不变）。
   *
   * ⚠️ 这里**不判可用性**（池空不空）—— 那是 `resolveTriggerKinds` 在 `index.ts` 里的事，
   *   本函数产出的只是"面板该勾哪几个"（见 `SettingsView.*Kinds` 的注释）。
   */
  standbyKinds: resolveTriggerIntent(
    'standby',
    cfg.subtitle?.standbyKinds,
    cfg.subtitle?.standbyGreetEnabled,
    cfg.subtitle?.standbyTouchEnabled
  ),
  /** ★ 缺省 `['touch']`（= 点击只从 `touch` 池随机，与改动前一致） */
  touchKinds: resolveTriggerIntent('touch', cfg.subtitle?.touchKinds),
  /**
   * ★ 缺省 = **注册表的缺省勾选**（`config.subtitle.eventFamilies` 里标 `default` 的那些；
   *   没声明注册表 ⇒ 内置单族 `normal`）。摊平口径复用 `dialogue.resolvePhases`
   *   —— 面板勾选态与运行时真正筛的族不可能各写一套判据。
   */
  /**
   * ★★ **事件族闸门**（全局）。摊平口径复用 `dialogue.resolvePhases`：
   *   新字段 `phases` 优先、旧字段 `touchPhases` 兜底 ⇒ 老存档照样生效。
   *   面板勾选态与运行时真正会筛的族不可能各写一套判据。
   */
  phases: resolvePhases(
    cfg.subtitle?.phases,
    cfg.subtitle?.touchPhases,
    buildFamilyRegistry(cfg.subtitle?.eventFamilies)
  ),
  /**
   * ★ **当前动作族**（单选）—— 摊平口径复用 `dialogue.resolveActionPhase`：
   *   缺省 = 注册表第一个动作族、显式 `''` = 不换名、非法值退化成 `''`。
   *   面板勾选态与运行时实际播的动画不可能各写一套判据。
   */
  actionPhase: resolveActionPhase(
    cfg.subtitle?.actionPhase,
    buildFamilyRegistry(cfg.subtitle?.eventFamilies)
  ),
  /** ★ 缺省 `['greet']`（= 四个自动时机仍只播问候） */
  resumeKinds: resolveTriggerIntent('resume', cfg.subtitle?.resumeKinds),
  /**
   * ★ 缺省 `'legacy'`（= 改动前的规则表，见 `TouchFeedbackMode` 注释）。
   *
   * 判据写成"只认另外三个合法值"而不是"认缺省值" ⇒ 写了无效字符串时也回落到缺省档，
   * 与 `touch.ts` 的解析口径同向（不可能拆成两种解析，否则"面板显示的和实际行为不同"）。
   */
  touchFeedbackMode:
    cfg.subtitle?.touchFeedbackMode === 'immediate' ||
    cfg.subtitle?.touchFeedbackMode === 'queue' ||
    cfg.subtitle?.touchFeedbackMode === 'none'
      ? cfg.subtitle.touchFeedbackMode
      : 'legacy',
  /** ★ 缺省 `'time'`（= 改动前"按时段问候"的行为）；判据同上：只认 `'random'` 这一个例外值 */
  greetMode: cfg.subtitle?.greetMode === 'random' ? 'random' : 'time',
  // ★ `enabled` 的**缺省**取决于编译期（`--env probe=off` 的发布包默认关），
  //   所以不能写死 true，否则正式版里面板会显示"开"而实际没挂（理论≠实际）。
  //   `PROBE_OPTS.enabled` 初值 = `__PROBE__`，且已被 `applyProbeConfig` 按
  //   config/覆盖层改过 ⇒ 用它兜底读到的就是"当前生效值"。
  probeEnabled: cfg.probe?.enabled ?? PROBE_OPTS.enabled,
  probeHud: cfg.probe?.hud !== false,
  probeCrosshair: cfg.probe?.crosshair !== false,
  probeZones: cfg.touch?.showZones === true,
  /** ★ 缺省 `false`（= 用 `zones`，与改动前一致） */
  touchFullscreen: cfg.touch?.fullscreen === true,
});

/* ── WE 属性桥 ───────────────────────────────────────────── */

/**
 * WE 注入到 `window` 上的宿主监听器。**类型定义在 `wePauseSignal.ts`**（那里是本项目
 * 唯一的 `declare global` 位置），这里只是 import 过来用 —— 全局增补写两处会冲突。
 */
import {
  WallpaperPropertyListener,
  withWallpaperPropertyListener,
} from './wePauseSignal';

/**
 * 安装 `applyUserProperties`。必须在业务初始化**之前**调用 ——
 * WE 可能在页面很早期就下发属性，装晚了那一拨就丢了。
 *
 * ## ★★ 这个对象**必须我们自建**（2026-09-26 修正，旧注释"绝不自建"是错的）
 *
 * 旧规写的是"只补字段、绝不自建"，理由是怕 `hasWallpaperPause()` 判据失真。
 * 真机取证证明那条旧规**直接导致 WE 属性全线失效**：
 * `wallpaperPropertyListener` 按官方口径本就是**壁纸作者创建**的对象，
 * WE 只往上面**补** `applyUserProperties` / `setPaused`；我们从不建它 ⇒
 * WE 的注入脚本在 `window.wallpaperPropertyListener.xxx = …` 处整个中断 ⇒
 * 属性面板里**所有选项勾了都没反应**（实测 `wpl` 全程 `undefined`）。
 *
 * 判据失真的问题由 `ensureWallpaperPropertyListener` 里的 **WE 环境闸门**解决：
 * 它只在 `window.___wpxUnpause`（WE 专有全局）存在时才建对象，
 * ⇒ 普通浏览器里依然"没有 listener"，`hasWallpaperPause()` 仍为 `false`。
 *
 * ## 为什么要轮询重试
 *
 * `index.html` 里已尽量早地建过一次，但宿主对象**也可能比本模块晚一点**才可用。
 * 等一小会儿再补，覆盖面更全；一直拿不到就停（不无限轮询）。
 *
 * @param handler 收到 WE 属性时调用
 * @param retryMs 重试间隔（毫秒）；`0` = 不重试
 * @param maxRetries 最多重试次数
 */
export const installWallpaperPropertyListener = (
  handler: (properties: Record<string, unknown>) => void,
  retryMs = 200,
  maxRetries = 25
): void => {
  /**
   * ★ 补字段 + 重试的循环**收敛在 `withWallpaperPropertyListener`**：
   *   本函数（`applyUserProperties`）、`weFps.installWeFpsSignal`
   *   （`applyGeneralProperties`）、`wePauseSignal.install`（`setPaused`）
   *   三处都需要同一套"宿主晚到就重试"，各抄一遍会出现三份相同的定时器。
   * ★ 依旧**只补字段、绝不整体替换**（会丢 WE 早先挂上的其它回调）。
   */
  withWallpaperPropertyListener(
    (wpl: WallpaperPropertyListener) => {
      wpl.applyUserProperties = handler;
    },
    retryMs,
    maxRetries
  );
};

/* ── WE 属性值的类型宽容解析 ─────────────────────────────── */

/**
 * WE 下发的属性值形状并不统一：官方文档示例是 `.value`，但布尔/滑块在不同版本里
 * 也可能直接给标量。这里两种都吃，解析不出来返回 `undefined`（= **当作没配**，
 * 不用猜测值去覆盖用户的 localStorage）。
 */
export const pickValue = (raw: unknown): unknown =>
  raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
    ? (raw as Record<string, unknown>).value
    : raw;

export const toBool = (raw: unknown): boolean | undefined => {
  const v = pickValue(raw);
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'number') {
    return v !== 0;
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') {
      return true;
    }
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') {
      return false;
    }
  }
  return undefined;
};

export const toNumber = (raw: unknown): number | undefined => {
  const v = pickValue(raw);
  if (typeof v === 'number' && isFinite(v)) {
    return v;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (isFinite(n)) {
      return n;
    }
  }
  return undefined;
};

/** 宽容的枚举字符串解析：只接受 `allowed` 里的值（大小写不敏感），否则 undefined */
export const toEnum = <T extends string>(
  raw: unknown,
  allowed: readonly T[]
): T | undefined => {
  const v = pickValue(raw);
  if (typeof v !== 'string') {
    return undefined;
  }
  const s = v.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s);
};

/**
 * 把 WE 下发的一批属性翻译成覆盖层补丁。**只认已知的键**，其余忽略。
 *
 * ## ★★ WE 属性面板只暴露 **5 项**（2026-09-26 拍板 3 项，09-27 增补第 4 项，09-30 增补第 5 项，
 * 2026-10-17 晚删 1 项 + 首项改为 `showCornerButtons`）
 *
 * | WE 属性键 | 面板文案 | 落到的覆盖层字段 |
 * |---|---|---|
 * | `showCornerButtons` | **显示右上角按钮**（order 100 = 第一项） | `showCornerButtons`（**整列**入口：折叠按钮 + 5 个入口） |
 * | `muteAll` | 全部静音 | `muteAll` |
 * | `debugEnabled` | 调试总开关 | `probeEnabled`（与**调试面板**里的「调试总开关」同一个字段 ⇒ 两边同源） |
 * | `showDisclaimer` | 显示免责声明与许可证要求 | `showDisclaimer`（居中弹窗，常驻显示） |
 * | `showArchive` | 显示档案 | `showArchive`（居中「档案」面板，常驻显示） |
 *
 * ★★ **`showSettings`（设置按钮显示）已删除**（2026-10-17 晚用户拍板）：它原先只管
 *   入口列里的齿轮那**一个**按钮，与 `showCornerButtons` 构成"两个开关管同一列"的分治；
 *   用户认为该决策多余 ⇒ 撤回，**只留一个开关管整列**。齿轮现在与其余 4 个入口
 *   条件完全一致。<br>
 *   ⚠️ 因此下面**故意不认** `showSettings` —— 老 `project.json` / 老存档里残留的该键
 *   会被静默忽略（不会污染覆盖层），不会出现"删了属性但旧值还在起作用"的假象。
 *
 * 其余小项（BGM 开关/音量、字幕显示/位置、念白语音、常驻动作序列）
 * **一律不进 WE 属性面板** —— 它们都在右上角设置面板里，那儿能点选动画名、
 * 有滑块和预设，比 WE 的 combo/text 好用得多。
 *
 * ⚠️ 因此下面**故意不认** `bgmEnabled` / `bgmVolume` / `subtitleEnabled` /
 * `subtitlePosition` / `voiceEnabled` / `idleSequenceEnabled`：
 * 即使旧版 `project.json` 或用户存档里还留着这些键，也会被静默忽略，
 * 不会污染覆盖层。
 */
export const overridesFromWeProperties = (
  properties: Record<string, unknown>
): SettingsOverrides => {
  const patch: SettingsOverrides = {};
  if (!properties || typeof properties !== 'object') {
    return patch;
  }
  const b = (key: string): boolean | undefined =>
    key in properties ? toBool(properties[key]) : undefined;

  /**
   * 居中「免责声明与许可证要求」弹窗显不显示。
   *
   * ★ 只管一个 DOM 的 `display`，
   * 不进 `SettingsView` ⇒ `sameView` 判不出变化 ⇒ 由 `index.ts` 热切换。
   */
  const showDisclaimer = b('showDisclaimer');
  if (showDisclaimer !== undefined) {
    patch.showDisclaimer = showDisclaimer;
  }

  /**
   * 居中「档案」面板显不显示（列出壁纸可能触发的事件与触发条件）。
   *
   * ★ 与 `showDisclaimer` 同一类：只管一个 DOM 的 `display`，
   * 不进 `SettingsView` ⇒ `sameView` 判不出变化 ⇒ 由 `index.ts` 热切换。
   */
  const showArchive = b('showArchive');
  if (showArchive !== undefined) {
    patch.showArchive = showArchive;
  }

  /**
   * 右上角**整列入口**（折叠按钮 + 5 个入口）显不显示。
   *
   * ★ 与 `showDisclaimer` 同一类：只管 DOM 的 `display`，不进 `SettingsView`
   * ⇒ `sameView` 判不出变化 ⇒ 由 `index.ts` 热切换。
   * ★★ 这是入口列**唯一**的显隐开关（2026-10-17 晚）：原 `showSettings` 已删除。
   */
  const showCornerButtons = b('showCornerButtons');
  if (showCornerButtons !== undefined) {
    patch.showCornerButtons = showCornerButtons;
  }

  /** 全部静音（BGM + 念白一起关） */
  const muteAll = b('muteAll');
  if (muteAll !== undefined) {
    patch.muteAll = muteAll;
  }

  /**
   * 调试总开关 ⇒ 落到 **`probeEnabled`**（复用面板「调试」页已有的字段）。
   *
   * 为什么不新建一个 `debugEnabled` 字段：那会和面板里的「探针总开关」
   * 变成**两套真值**，谁最后写谁生效，用户会看到面板和 WE 面板打架。
   */
  const debugEnabled = b('debugEnabled');
  if (debugEnabled !== undefined) {
    patch.probeEnabled = debugEnabled;
  }
  return patch;
};

/**
 * 两个**生效值视图**是否完全一致。
 *
 * ## ★★ 为什么"值没变就不重载"必须比视图，而不是比覆盖层
 *
 * 早期写法是 `diffOverrides(改动前的覆盖层, 改动后的覆盖层)`，看着对，**实则会漏**：
 * 首次启动时 localStorage 是空的，WE 下发的属性值哪怕和 `config.json` 默认值
 * **完全相同**（比如都是"开"），也会被判成"从无到有 = 有变化" ⇒ 白重载一次。
 *
 * 正确的判据是**"新值有没有改变当前生效值"** —— 生效值 = `config` 默认值 ⊗ 覆盖层。
 * 只有它变了才值得重启一次。
 */
export const sameView = (a: SettingsView, b: SettingsView): boolean => {
  if (
    a.muteAll !== b.muteAll ||
    a.bgmEnabled !== b.bgmEnabled ||
    a.subtitleEnabled !== b.subtitleEnabled ||
    a.subtitlePosition !== b.subtitlePosition ||
    a.subtitleAnchorU !== b.subtitleAnchorU ||
    a.subtitleAnchorV !== b.subtitleAnchorV ||
    a.voiceEnabled !== b.voiceEnabled ||
    // ★ 对齐基准也要比：否则"只改了画面调整页的对齐方式"会被判成"没变化"而不重载
    a.fitAspect !== b.fitAspect ||
    // ★ 轿厢姿态也要比：否则"只改了壁纸独立设置页"会被判成"没变化"而不重载
    a.cabinMode !== b.cabinMode ||
    // ★ 指针拖尾开关同理：它只改 pointerTrail.enabled，漏比就会"只改这项不重载"
    a.pointerTrailEnabled !== b.pointerTrailEnabled ||
    a.idleSequenceEnabled !== b.idleSequenceEnabled ||
    a.idleSequenceGapMs !== b.idleSequenceGapMs ||
    // ★ 调试项也要比：否则"只改了 HUD/红圈"会被判成"没变化"而不重载
    a.probeEnabled !== b.probeEnabled ||
    a.probeHud !== b.probeHud ||
    a.probeCrosshair !== b.probeCrosshair ||
    a.probeZones !== b.probeZones ||
    // ★ 触摸热区全屏开关也要比（2026-10-10）：漏比 ⇒"只勾了这一项"不重载
    a.touchFullscreen !== b.touchFullscreen ||
    // ★ 待机延迟也要比：否则"只改了等待时长"会被判成"没变化"而不重载
    a.standbyIdleSec !== b.standbyIdleSec ||
    // ★ 触摸反馈策略也要比（2026-10-08）：漏比 ⇒"只改了这一档"不重载
    a.touchFeedbackMode !== b.touchFeedbackMode ||
    // ★ 问候触发方式同理（2026-10-08）：漏比 ⇒"只改了这一项"不重载
    a.greetMode !== b.greetMode ||
    // ★ 动作族（2026-10-17，单选标量）：漏比 ⇒"只切了誓约前/誓约后"不重载
    a.actionPhase !== b.actionPhase
  ) {
    return false;
  }
  // 音量按 1% 粒度比较：WE 滑块是整数百分比，浮点直接 === 会有无意义的抖动
  if (Math.round(a.bgmVolume * 100) !== Math.round(b.bgmVolume * 100)) {
    return false;
  }
  // ★ 角色语音音量同理（同 1% 粒度）：漏比 ⇒"只拖了语音音量"不重载
  if (Math.round(a.voiceVolume * 100) !== Math.round(b.voiceVolume * 100)) {
    return false;
  }
  if (a.idleSequenceItems.length !== b.idleSequenceItems.length) {
    return false;
  }
  for (let i = 0; i < a.idleSequenceItems.length; i++) {
    if (a.idleSequenceItems[i] !== b.idleSequenceItems[i]) {
      return false;
    }
  }
  /**
   * ★★ 三个通道的「可触发的事件」（多选）同理，**必须按内容比**：
   * `readView` 每次都产出一个**新数组**（`resolveTriggerIntent` 的返回值），
   * 拿引用比必然不等 ⇒ 每次启动都被判成"有变化" ⇒ **白重载一次**
   * （正是本函数上面那段注释警告的坑）。
   *
   * ⚠️ 三个通道**逐个都要比** —— 漏掉任何一个 ⇒"只改了那一个通道的勾选"不重载（静默失效）。
   *   共用一个 `sameKinds` 小工具，避免写三遍同样的循环时漏掉一个。
   *
   * ★ 参数类型放宽到 `readonly string[]`：**事件族闸门**（`phases`）也是同一种形状的数组，
   *   同样的坑（漏比 ⇒ 只改事件族不重载）。
   */
  const sameKinds = (x: readonly string[], y: readonly string[]): boolean => {
    if (x.length !== y.length) {
      return false;
    }
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) {
        return false;
      }
    }
    return true;
  };
  return (
    sameKinds(a.standbyKinds, b.standbyKinds) &&
    sameKinds(a.touchKinds, b.touchKinds) &&
    sameKinds(a.phases, b.phases) &&
    sameKinds(a.resumeKinds, b.resumeKinds)
  );
};
