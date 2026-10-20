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
 * 居中的「档案」面板 —— 以表格列出本壁纸**可能触发的事件（语音 / 动作）与触发条件**。
 *
 * ## 为什么要有它
 *
 * 壁纸的动作与语音不是"点哪里出什么"能一眼看全的：同一个点击热区会从池里**随机**取一条，
 * 问候按时段分三条、还要经过"去重 5 秒 / 恢复需离开 15 秒"这类闸门。
 * 与其让用户靠试，不如把**实际生效的那份配置**摊成一张表。
 *
 * ## ★★ 表格由**运行时 config 现算**，不是写死文案
 *
 * 传进来的 `config` 是**已合并 localStorage 覆盖层**的生效值 ⇒ 用户改了
 * 「待机时长」「三个通道各能触发哪几类」之后，表里立刻是改后的数字/池子大小。
 * 池子的构造与类别解析直接复用运行时同一批纯函数（`dialogue.ts` 的
 * `resolveTriggerKinds` / `mergeKindPools` / `normalizeEventTable` / `findByEventKey`），
 * **不另写一套判据** —— 否则文档与行为会慢慢漂移（这正是"新增冗余"最容易出事的地方）。
 *
 * ## ★★ 新增「特效」列 —— 逐行标出这条动画会拉起哪些粒子组（2026-10-17）
 *
 * 动作可能额外拉一簇粒子（游戏侧 `CfgSoulSpineActionTable` 的 `EffectId` / `MarryEffectId`，
 * 即 `config.actionEffects`，见 `ActionEffectConfig` 的说明）。原先只有调试面板能间接看到，
 * 档案里查不到 ⇒ 补一列，用户对照"点下去到底有没有出特效"时不必再翻 config。
 *
 * ★ 映射**由调用方传入**（`ArchiveOptions.actionEffects`，来自 `index.ts` 的
 *   `actionEffectNames`）—— 引擎侧那份索引才是唯一权威，本文件**不另建一份**
 *   （两处各写一遍迟早漂移，正是本文件要避免的事，同上面「池子」那条口径）。
 *
 * ## ★ 「触发条件」列**不写事件族**、细则从简（2026-10-17 用户拍板）
 *
 * 事件族（`config.subtitle.eventFamilies`）是**配置实现细节**：写进条件列只会让每行变长，
 * 还容易与设置面板「事件池」页里那个勾选混淆 ⇒ 条件列不再出现「事件族 xxx」。
 * 条目属于哪一族改由**念白列的角标** `· <族名>` 表达（缺省族不缀，见 `makeRow`）。
 * 表下的「触发细则」同时由 6 段长句压成 5 句短句 —— WE 不转发滚轮，
 * 细则越短越不容易把卡片撑到必须滚动。
 *
 * ## ★ 显示与否只由 WE 属性 `showArchive` 决定（用户 2026-09-30 拍板）
 *
 * 打开 ⇒ 常驻显示；关掉 ⇒ 消失。**热切换，不重载页面**（同 `disclaimer.ts` /
 * `showCornerButtons` 的口径，见 `index.ts` 的 `applyWePatch`）。
 *
 * ## ★★ 遮罩**不吃事件**（与免责弹窗刻意的差异）
 *
 * `disclaimer.ts` 的遮罩要拦"透过弹窗点到角色"那一下（它是法务性质的告示，
 * 出现时应当接管交互）。档案是**查阅性质的**：用户很可能一边看档案、一边戳角色
 * 对照"这条是不是真会触发"。所以这里：
 *   - `root` / `scrim` 一律 `pointer-events:none`（只压暗，不拦）；
 *   - 只有 `card` 自己 `pointer-events:auto`（卡片区域内不穿透，避免误触）。
 *
 * ## ★★ 不用 `backdrop-filter`（WE CEF 渲染进程 SIGILL，2026-09-25 实锤）
 *
 * 遮罩与卡片一律**实色半透明**。
 *
 * ## ★★ 内容必须一屏装得下（WE 不转发鼠标滚轮）
 *
 * `wheel` 在 WE 里永不触发、原生滚动条也拖不动（详见 `settingsPanel.ts` 文件头）。
 * ⇒ 正文超高时**等比缩小卡片内层**（`fitContent`，与 `fitPanelScale` 同一思路）；
 *   另外补一个"按住拖动滚动"的兜底 + 溢出时才出现的提示。
 *
 * ## z-index 口径
 *
 * 气泡 `2147483640` < **档案 `2147483645`** < 免责弹窗 `2147483646` < 设置面板 `2147483647`。
 * 档案不能盖住设置面板 —— 面板是用户唯一能实时改设置的入口；
 * 也不能盖住免责弹窗（法务声明优先级更高）。
 */

import {
  Configs,
  DialogueEntry,
  EventKeyInput,
  DialogueSlotKey,
  TriggerChannel,
  TriggerEventKind,
  TriggerPhase,
} from './config.type';
import {
  DEFAULT_TIME_RANGES,
  FamilyRegistry,
  SLOT_ORDER,
  TRIGGER_KIND_ORDER,
  buildFamilyRegistry,
  findByEventKey,
  isEntryVisibleInPhase,
  mergeKindPools,
  normalizeGreetIds,
  projectDialoguesToActionPhase,
  resolveActionPhase,
  resolvePhases,
  resolveChatIds,
  resolveDialoguePhase,
  resolveGreetSource,
  resolveTouchIds,
  resolveTriggerKinds,
} from './dialogue';
import { UI_SCALE_VAR, fpx, getUiScale, initUiScale, uiPx } from './uiScale';
import {
  channelsOf,
  eventKeyOf,
  kindOf as eventKindOf,
  normalizeEventKey,
} from './eventModel';
import { describeCondition } from './conditions';
import { summarizeReport, ValidationReport } from './eventValidate';

/**
 * 「动画名 → 绑定的粒子组名」映射（= `config.actionEffects` 的**扁平形式**）。
 *
 * ★ 由调用方（`index.ts` 的 `actionEffectNames`）传入，本文件不自行解析
 *   `config.actionEffects` —— 引擎那份索引与"到底会不会播"是同一处判据，
 *   在这里再写一遍必然慢慢漂移（同文件头「不另写一套判据」的口径）。
 *   （`actionEffectIndex` 的值是完整的 `ActionEffectConfig[]`；档案只要名字，
 *     所以直接用扁平表，省掉一层 `.map(b => b.particles).flat()`。）
 */
export type ActionEffectNames = { [animation: string]: string[] };

export type ArchiveOptions = {
  /** 初始是否显示（WE 属性值 → localStorage 覆盖层，由调用方决定） */
  visible: boolean;
  /**
   * **已合并覆盖层**的运行时配置。
   *
   * ★ 必须是 `applyOverrides(rawConfigs, readOverrides())` 的结果，
   *   不是 `rawConfigs` —— 否则表里显示的是"出厂值"而不是用户当前生效值。
   */
  config: Configs;
  /**
   * **已经归一 + 已压过事件开关**的事件表（= `index.ts` 的 `eventTable`）。
   *
   * ★★ 2026-10-19：档案**不再自己从 config 归一**。事件表只有一个来源
   *   （`assets/events.jsonc`），档案若自己再算一遍，就会出现"引擎按 A 表抽、
   *   档案按 B 表显示"——这正是本次改动要消灭的那类偏差。
   *   投影（动作族换名）与族闸门仍在这里做，因为它们是**本状态的**派生，
   *   而"哪张表"不是。
   */
  events: readonly DialogueEntry[];
  /**
   * 「动作特效」映射（动画名 → 粒子组名）。缺省 `{}` ⇒ 特效列全为「—」。
   *
   * ★ 传的是 `index.ts` 里那份**已按 `config.actionEffects` 建好的**索引，
   *   见 `ActionEffectNames` 的说明。
   */
  actionEffects?: ActionEffectNames;
  /**
   * **事件表校验报告**（`index.ts` 的 `validationReport`）。
   *
   * ★ 传 getter 而不是快照：档案可能在骨架就绪前就建好（`createArchive` 在
   *   `waitLoad` 里），getter 保证读到的是"最后一次校验结果"。
   */
  validation?: () => ValidationReport | null;
};

export type ArchivePanel = {
  /** 热切换显示/隐藏 */
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  /** 表格**数据行**数（不含表头）—— 给验证脚本断言"内容真的渲染出来了" */
  rowCount: () => number;
  dispose: () => void;
};

const FONT =
  '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';

/**
 * 卡片内需要**拦下**的事件。
 *
 * 与 `disclaimer.ts` 的不同：那边挂在全屏 `root` 上（连点空白也拦），
 * 这边只挂在 `card` 上 —— 卡外的点击照常落到角色身上（见文件头）。
 */
const SWALLOW_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'contextmenu',
];

/**
 * 表格列宽（百分比）。顺序 = 事件 / 触发条件 / 动作 / **特效** / 念白 / 语音。
 *
 * ★ 2026-10-17 新增「特效」列：念白列从 39% 让到 32%、触发条件列从 23% 让到 20%
 *   （条件列去掉了事件族那段长文案，本来就变短了）。总宽仍为 100%。
 */
const COLS: readonly string[] = ['12%', '20%', '8%', '15%', '32%', '13%'];

const SLOT_LABEL: Record<DialogueSlotKey, string> = {
  morning: '上午',
  noon: '下午',
  evening: '晚间',
};

/** 一条表格数据 */
type Row = {
  /** 事件名（如「问候 · 上午」） */
  event: string;
  /** 触发条件 */
  cond: string;
  /** spine 动画名 */
  action: string;
  /**
   * 这条动画绑定的粒子组名（`config.actionEffects`），每行一个。
   * 没绑 / 该行没有动画 ⇒ `—`。见 `fxText`。
   */
  fx: string;
  /** 念白标识（`#64005` + 官方动作名） */
  tag: string;
  /** 念白正文 */
  text: string;
  /** 语音文件名（只取 basename） */
  voice: string;
};

const createEl = (
  tag: string,
  css: string,
  parent?: HTMLElement
): HTMLElement => {
  const el = document.createElement(tag);
  el.style.cssText = css;
  if (parent) {
    parent.appendChild(el);
  }
  return el;
};

/** `5` → `05`。不用 `padStart`（`tsconfig.target = es6`，lib 里没有 ES2017） */
const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n));

const fmtSec = (sec: number): string =>
  sec >= 60 ? Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒';

const hourRangeText = (start: number, end: number): string =>
  start === end
    ? '全天 24 小时'
    : pad2(start) +
      ':00–' +
      pad2(end) +
      ':00' +
      (start > end ? '（跨零点）' : '');

/**
 * 官方动作名取末段：`时装-盛夏游乐场-问候-晴天上午` → `晴天上午`。
 *
 * 面板只讲人话（不显示英文配置名），但动作表里那串前缀对用户没有信息量。
 */
const shortLabel = (label?: string): string => {
  if (!label) {
    return '';
  }
  const parts = label.split('-');
  return (parts[parts.length - 1] || label).trim();
};

/** 语音路径只留文件名（`CV/Asuna/xxx.ogg` → `xxx.ogg`），整条太长会把列撑开 */
const voiceBase = (voice?: string): string => {
  if (!voice) {
    return '—';
  }
  const parts = voice.split('/');
  return parts[parts.length - 1] || voice;
};

/**
 * 某条动画绑定的粒子组名 → 「特效」单元格文本。
 *
 * ★ 一个组一行（单元格用 `white-space:pre-line`）：组名可能很长（`fx_chat_lizi_san`），
 *   挤成一行会把 8% 宽的动作列顶开。没绑 / 无动画 ⇒ `—`（与"动作"列的缺省写法一致）。
 */
const fxText = (ae: ActionEffectNames, animation?: string): string => {
  const names = animation ? ae[animation] : undefined;
  return names && names.length ? names.join('\n') : '—';
};

/**
 * 造一行。★ 事件族名由**注册表**给（`reg.label`）—— 2026-10-15 起不再是写死的三族表。
 */
const makeRow = (
  event: string,
  cond: string,
  e: DialogueEntry,
  st: ArchiveState,
  ae: ActionEffectNames
): Row => {
  const reg = st.families;
  /**
   * 念白列的人话名：**`displayName` 优先**（自定义事件只有这个；`label` 是游戏侧动作名）。
   *
   * ★ 2026-10-20：自定义事件不再单独占一行（见 `buildRows` 的 ⑥ 段），若这里还只读
   *   `label`，它们在表里就只剩 `#custom:xxx` —— 用户写的 `displayName` 反而看不见了。
   */
  const short = e.displayName ? e.displayName : shortLabel(e.label);
  /**
   * ★ 非**缺省族**的条目在角标后**缀上事件族名**（2026-10-10）——
   *   缺省池里既有缺省族、又有别的族时，光看 `#63004` 分不出属于哪一族；
   *   缀上后"表里显示什么"与"实际会播什么"一眼对得上。
   *   ★ 缺省族的条目**不缀** ⇒ 老 config（条目全落缺省族）的角标逐字不变。
   *   ★ 注册表为空（无事件族机制）⇒ 也不缀。
   */
  const ph = resolveDialoguePhase(e, reg);
  const phTail =
    reg.families.length && ph !== reg.fallbackId ? ' · ' + reg.label(ph) : '';
  const key = eventKeyOf(e);
  /**
   * ★ 2026-10-20：记进"已逐条列出"账本（`ArchiveState.enumerated`）。
   *   所有逐条行都经过 `makeRow` ⇒ 账本天然完整，末尾的「自定义事件」段据此
   *   只补"上面没列过的"，同一张表里不会再出现两行同一条。
   */
  if (key) {
    st.enumerated.push(key);
  }
  /**
   * 念白标识：内置保持 `#64005`（老观感）；自定义事件没有 `actionId` ⇒ `#custom:xxx`。
   * 被校验判 `reject` 的条目加 `⚠`（档案是用户唯一能看出"这条不会播"的地方）。
   */
  const badge = key.indexOf('custom:') === 0 ? key : String(e.actionId ?? key);
  const warn = st.rejected[key] ? '⚠ ' : '';
  /**
   * ★★ `pick.weight: 0` 的条目**永不参与自动抽取**（`eventScheduler` 第 ② 步直接剔掉），
   *   只能在调试面板 / `__WB_DIALOGUE__.trigger` 里手动播。
   *
   * 为什么必须在档案里标出来：它是**池里**的一员（池不按 weight 筛），
   * 所以"池内随机 1 条（共 7 条）"会让用户以为它有 1/7 的机会 —— 实际是 0。
   * 这正是档案"不能替引擎撒谎"的那条红线（见文件头）。2026-10-18 起
   * config 里真的出现了 `weight:0` 的示例事件（`custom:hold-hand`），这句成了必需的。
   */
  const manualOnly = e.pick?.weight === 0 ? ' · 仅手动' : '';
  return {
    event,
    cond,
    action: e.animation ?? '—',
    fx: fxText(ae, e.animation),
    tag: warn + '#' + badge + (short ? ' ' + short : '') + phTail + manualOnly,
    text: e.text ?? '',
    voice: voiceBase(e.voice),
  };
};

/**
 * 池里**真正会被自动抽到**的条数（`weight: 0` 不算）。
 *
 * ★ 与 `eventScheduler.pickInTier` 同一判据：池不按 weight 筛，抽取时才剔。
 *   档案要显示"共 N 条"就必须用这个数，否则读数会虚高。
 */
const autoCount = (pool: DialogueEntry[]): number =>
  pool.filter((e) => e.pick?.weight !== 0).length;

/**
 * 表格与细则**共用**的一份"当前生效口径"：三个池 + 三条事件列表 + 每个通道的勾选结果。
 *
 * ★ 只算一次、两处共用（`buildRows` / `buildNotes`）—— 早先两处各算一遍，
 *   改动通道口径时极易只改一处 ⇒ 表格与细则互相打架。
 */
type ArchiveState = {
  dialogues: DialogueEntry[];
  /** 三张 id 列表（摊平旧口径之后）。2026-10-18 起元素可以是 `EventKey` */
  chatIds: EventKeyInput[];
  greetIds: EventKeyInput[];
  /**
   * 三个类别各自的条目池（由事件表的 `kind` 派生，与 `index.ts` 同一判据）。
   *
   * ★★ 三层判据都已含在里面：当前**动作族**投影 + 本状态存在性 + **全局事件族闸门**
   *   （`subtitle.phases`）。三个通道**共用这一套**（= `index.ts` 的 `KIND_POOLS`）。
   *   ⚠️ 2026-10-17 起不再有"触摸专用池"：事件族对所有入口生效，若这里分两套，
   *      表格就会替某个入口撒谎。
   */
  pools: Record<TriggerEventKind, DialogueEntry[]>;
  /** 旧 `touch` 列表（用于"哪些条目是旧池键引用的"差集） */
  touchIds: EventKeyInput[];
  /** 事件族注册表（`config.subtitle.eventFamilies` 归一而来；族名/缺省族/判据都从它取） */
  families: FamilyRegistry;
  /** 生效的**事件族闸门**（`subtitle.phases`；注册表为空 ⇒ `undefined` = 不筛） */
  phases: readonly TriggerPhase[] | undefined;
  /** 当前**动作族**（`subtitle.actionPhase` 的生效值；`''` = 不换名 = 誓约前） */
  actionPhase: TriggerPhase;
  /** 三个通道**真正会播**哪些类别（口径 + 可用性，= 运行时同一判据） */
  channels: Record<TriggerChannel, TriggerEventKind[]>;
  greetMode: 'time' | 'random';
  /** 旧池键的 id（`greet` / `chat` / `touch`）；自定义事件不在这里 ⇒ 单独列一段 */
  legacyKeys: string[];
  /** 被校验判 `reject` 的事件（事件名列加 `⚠`） */
  rejected: { [key: string]: boolean };
  /** 校验报告（表下汇总用） */
  validation: ValidationReport | null;
  /**
   * **本机事件开关关掉的条数**（`EventState` → `enabled:false`）。
   *
   * ★ 2026-10-20：运行时第一层就剔（`eventScheduler.collectCandidates`），
   *   档案此前完全无视它 ⇒ "关掉的条目仍占着池里的名额"，与引擎口径相反。
   *   现在池按 `enabled` 过滤，这里只留一个计数给「细则」说明"少掉的那几条去哪了"。
   */
  disabledCount: number;
  /**
   * 被**事件族闸门**挡在外面的条目（`subtitle.phases` 没勾它所属的族）。
   *
   * ★ 池里不会有它们（与引擎一致），但「自定义事件」段仍要列出来并标注，
   *   否则用户会以为"文件里写了、档案里没有 = 引擎吞了"。
   */
  gatedOut: { [key: string]: boolean };
  /**
   * `buildRows` 内部账本：**已被逐条列出过**的事件键。
   *
   * ★ 为什么需要（2026-10-20）：通道枚举 2026-10-18 起改成"按池 + `on`"，自定义事件
   *   自动入选 ⇒ 10-18 加的「自定义事件」段会把同一条**再列一遍**（一张表里两行同一条）。
   *   现在该段只补"上面没列过的"，账本由 `makeRow` 记（所有逐条行都经过它）。
   */
  enumerated: string[];
};

const resolveState = (
  cfg: Configs,
  events: readonly DialogueEntry[],
  validation: ValidationReport | null = null
): ArchiveState => {
  const sub = cfg.subtitle;
  /**
   * ★★ 2026-10-19：事件表**由调用方传入**（`index.ts` 归一后的 `eventTable`）。
   *   档案不再自己 `normalizeEventTable(config.subtitle.dialogues)` ——
   *   事件已搬到 `assets/events.jsonc`，config 里那份是空的；
   *   更重要的是**不许有第二份表**（"引擎按 A 表抽、档案按 B 表显示"）。
   */
  const dialogues: DialogueEntry[] = events.slice();
  // ★ 「新数组优先、空数组退回旧时段表」的口径集中在 `dialogue.resolveGreetSource` ——
  //   这里不另写 `??`（`??` 对空数组不回退 ⇒ 会把整类问候静默关掉）
  const greetSource = resolveGreetSource(sub?.greet, sub?.greeting);
  const chatIds = resolveChatIds(sub?.chat, sub?.standby);
  const greetIds = normalizeGreetIds(greetSource);
  const touchIds = resolveTouchIds(sub?.touch);
  /**
   * ★★ 事件族注册表 + **当前动作族**（2026-10-17）—— 与 `index.ts` 完全同一套摊平口径。
   *
   * 两件事必须分清（都是**全局**）：
   *   · `actionPhase`（动作族）：决定播哪套动画名，并把属别的动作族的条目挡在池外；
   *   · `phases`（事件族闸门）：用户允不允许这一族 —— **对所有入口生效**，
   *     一项都不勾 ⇒ 所有池为空 ⇒ 表里没有任何事件行。
   * ⚠️ 早先待机 / 回到壁纸的池被 `autoFilter`（缺省族）预筛过 —— 那是把"动作族"
   *   错当"池筛子"，誓约后会把问候/闲聊整类筛掉。现在两层分别由
   *   `phaseFilter` / `isEntryVisibleInPhase` 表达，互不兼任。
   */
  const families = buildFamilyRegistry(sub?.eventFamilies);
  const actionPhase = resolveActionPhase(sub?.actionPhase, families);
  /**
   * ★ 全局**事件族闸门**（`subtitle.phases`；旧字段 `touchPhases` 仅在新字段缺席时读）。
   * 注册表为空 ⇒ `undefined`（不筛）；否则是勾选的族（`[]` = 全关 ⇒ 所有池为空）。
   */
  const phases = resolvePhases(sub?.phases, sub?.touchPhases, families);
  const phaseFilter: readonly TriggerPhase[] | undefined = families.families
    .length
    ? phases
    : undefined;
  /**
   * ★ 投影 + 存在性过滤：`dialogues` 之后**就是**本状态真正能播的那份
   *   （动画名已换成当前动作族的），`buildRows` 里的 `findByEventKey` 因此拿到的
   *   是**换名后**的条目 —— 表里写的动画名与实际播放的必然一致。
   */
  const projected = projectDialoguesToActionPhase(
    dialogues,
    families,
    actionPhase
  );
  const active: DialogueEntry[] = projected.filter((e) =>
    isEntryVisibleInPhase(e, families, actionPhase)
  );
  /**
   * ★ 池**由事件表派生**（与 `index.ts` 的 `poolOfKind` 同一条判据）：
   *   旧 config 的 `kind` 是旧池键反推来的 ⇒ 内容逐条不变；自定义事件自动进池。
   *   ⚠️ 不再调 `buildPool(旧 id 列表)` —— 那会把没写进旧数组的自定义事件漏掉。
   *
   * ★★ 2026-10-20 补一层"运行时本来就有、档案却漏了"的过滤：
   *   `enabled: false`（本机事件开关 / 文件里写死）—— `collectCandidates` 第一层就剔。
   *   池只装"真的会被抽到"的条目，`autoCount` / 池 #k/N 才不会虚高。
   */
  const playable: DialogueEntry[] = active.filter((e) => e.enabled !== false);
  const phased: DialogueEntry[] =
    phaseFilter === undefined
      ? playable
      : playable.filter(
          (e) => phaseFilter.indexOf(resolveDialoguePhase(e, families)) >= 0
        );
  /**
   * 被事件族闸门挡住的条目（**只用于标注**，不进池）。由差集得出，
   * 不另写一遍 `resolveDialoguePhase` 比较（两套判据必然漂移）。
   */
  const gatedOut: { [key: string]: boolean } = {};
  if (phaseFilter !== undefined) {
    playable.forEach((e) => {
      if (phased.indexOf(e) < 0) {
        const k = eventKeyOf(e);
        if (k) {
          gatedOut[k] = true;
        }
      }
    });
  }
  const reachable = phased.filter((e) => channelsOf(e).length > 0);
  const pools: Record<TriggerEventKind, DialogueEntry[]> = {
    chat: reachable.filter((e) => eventKindOf(e) === 'chat'),
    greet: reachable.filter((e) => eventKindOf(e) === 'greet'),
    touch: reachable.filter((e) => eventKindOf(e) === 'touch'),
  };
  /** 旧池键的键集合（自定义事件不在这里 ⇒ 档案单独列一段） */
  const legacyKeys: string[] = [];
  [...chatIds, ...greetIds, ...touchIds].forEach((raw) => {
    const k = normalizeEventKey(raw);
    if (k && legacyKeys.indexOf(k) < 0) {
      legacyKeys.push(k);
    }
  });
  const rejected: { [key: string]: boolean } = {};
  (validation?.unplayable ?? []).forEach((k) => {
    rejected[k] = true;
  });
  const has = (k: TriggerEventKind): boolean => pools[k].length > 0;
  return {
    /** ★ 投影 + 存在性过滤后的那批（动画名 = 当前动作族），**不是** config 里的原始表 */
    dialogues: active,
    chatIds,
    greetIds,
    touchIds,
    pools,
    families,
    actionPhase,
    /**
     * ⚠️ 存**生效的闸门**（`phaseFilter`），不是 `phases` 原值 —— 注册表为空时
     * `phaseFilter` 是 `undefined`（不筛），此时绝不能写成 `[]`，否则细则会谎报"全关"。
     */
    phases: phaseFilter,
    legacyKeys,
    rejected,
    validation,
    channels: {
      // ★ 与 `index.ts` 完全同一组入参 —— 表里显示的"会播哪几类"不可能与实际行为不同
      standby: resolveTriggerKinds(
        'standby',
        sub?.standbyKinds,
        sub?.standbyGreetEnabled,
        sub?.standbyTouchEnabled,
        has('chat'),
        has('greet'),
        has('touch')
      ),
      // ★ 触摸通道的可用性同样按**筛过族之后**的池算（否则会说"会播"却永远抽不出）
      touch: resolveTriggerKinds(
        'touch',
        sub?.touchKinds,
        undefined,
        undefined,
        has('chat'),
        has('greet'),
        has('touch')
      ),
      resume: resolveTriggerKinds(
        'resume',
        sub?.resumeKinds,
        undefined,
        undefined,
        has('chat'),
        has('greet'),
        has('touch')
      ),
    },
    greetMode: sub?.greetMode === 'random' ? 'random' : 'time',
    disabledCount: active.length - playable.length,
    gatedOut,
    /** 由 `buildRows` 填（每次重新渲染前清空），见字段注释 */
    enumerated: [],
  };
};

/** 类别名（人话）—— 表格与细则共用 */
const KIND_TEXT: Record<TriggerEventKind, string> = {
  chat: 'chat类',
  greet: 'greet类',
  touch: 'touch类',
};

/** 一个条目属于哪一类（`mergeKindPools` 的收录顺序 = `TRIGGER_KIND_ORDER`，与这里一致） */
const kindOfEntry = (
  e: DialogueEntry,
  kinds: readonly TriggerEventKind[],
  pools: Record<TriggerEventKind, DialogueEntry[]>
): TriggerEventKind => {
  for (let i = 0; i < TRIGGER_KIND_ORDER.length; i++) {
    const k = TRIGGER_KIND_ORDER[i];
    if (kinds.indexOf(k) >= 0 && pools[k].indexOf(e) >= 0) {
      return k;
    }
  }
  return 'touch';
};

/** 按**生效配置**算出事件表。
 *
 * 顺序 = 「触发入口」分组，与运行时可能发生的先后无关：
 * 回到壁纸（自动）→ 待机（自动）→ 点击触摸（交互）→ 常驻序列（若启用）→ BGM（环境）。
 */
const buildRows = (
  cfg: Configs,
  st: ArchiveState,
  ae: ActionEffectNames
): Row[] => {
  const sub = cfg.subtitle;
  const dialogues = st.dialogues;
  const rows: Row[] = [];
  const greetModeText = st.greetMode === 'random' ? '随机' : '按时段';
  /** 重新渲染前清空"已逐条列出"账本（`makeRow` 往里写，见其注释） */
  st.enumerated.length = 0;

  /**
   * ★ 待机与「回到壁纸」共用同一套排版：勾中的类别**逐类列举**，
   *   每条都把"闸门 + 取条方式"写清楚 —— 表格本身就是用户对照行为的唯一入口。
   */
  const standbySec = Math.max(
    0,
    Math.round((sub?.standbyIdleMs ?? 25000) / 1000)
  );
  /**
   * 条件列开头的"闸门"。★ 2026-10-17 从简：只留**辨识闸门所需的最短词**，
   * 具体秒数/前提（如"恢复需离开 ≥ 15 秒"）统一由表下「触发细则」承接
   * —— 逐行重复长句会把条件列挤到看不清真正有差异的部分。
   */
  const GATE: Record<TriggerChannel, string> = {
    resume: '载入 / 页面重新可见 / 窗口重获焦点 / WE 恢复',
    standby: '静置 ' + fmtSec(standbySec),
    touch: '点击角色热区',
  };

  const pushChannel = (
    kind: TriggerChannel,
    /** 事件名列的前缀，如「回到壁纸」 */
    prefix: string
  ) => {
    const kinds = st.channels[kind];
    if (!kinds.length) {
      return;
    }
    const mergedPool = mergeKindPools(kinds, st.pools, st.families);
    /**
     * 勾了多类 ⇒ 合成一个池一起抽（池内每条等概率，所以条目多的类别更容易抽到）。
     *
     * ★ 计数用 `autoCount`（`weight:0` 不算）：那是 runtime 真正会抽的条数。
     *   池里若有"仅手动"的条目，再补一句把它们摘出来 —— 见 `makeRow` 的 `manualOnly`。
     */
    const manual = mergedPool.length - autoCount(mergedPool);
    const tail =
      (kinds.length > 1
        ? ' · 并池随机 1 条（共 ' + autoCount(mergedPool) + ' 条）'
        : ' · 池内随机 1 条') +
      (manual ? '（另有 ' + manual + ' 条仅手动）' : '');
    /**
     * ★★ 逐条枚举的**唯一来源** = 「事件表派生的池」再按 `on` 过滤本通道。
     *
     * 2026-10-18 迁移动了这里：原先逐条枚举走的是旧 id 数组（`subtitle.greet` /
     * `chat`），迁移后那三个键**已经不存在**，照旧写法会让「回到壁纸 / 待机」
     * 两段**整段消失**（表格看起来像"这两条通道不播任何东西"）。
     * 改用池 + `on` 之后，档案的枚举口径与运行时漏斗完全同源（PLAN 头号纪律：
     * 不另写一套判据）。
     */
    const entriesOf = (k: TriggerEventKind): DialogueEntry[] =>
      st.pools[k].filter((e) => channelsOf(e).indexOf(kind) >= 0);

    kinds.forEach((k) => {
      if (k === 'chat') {
        const list = entriesOf('chat');
        list.forEach((e, i) => {
          rows.push(
            makeRow(
              prefix + ' · chat类 #' + (i + 1),
              GATE[kind] + tail + '（chat 池 ' + st.pools.chat.length + ' 条）',
              e,
              st,
              ae
            )
          );
        });
        return;
      }
      if (k === 'greet') {
        /**
         * ★ 只勾 `greet` 一类时走 `pickGreetingEntry` ⇒ 取条方式由「问候触发方式」决定；
         *   与别的类并池时它只是池里的一条候选（不再看时间）——两种情况都在条件列里写明。
         */
        const only = kinds.length === 1;
        const list = entriesOf('greet');
        list.forEach((e, i) => {
          const seat = '#' + (i + 1) + '/' + list.length;
          const name = !only
            ? 'greet类 · 池内候选 ' + seat
            : greetModeText === '随机'
            ? 'greet类 · 随机 ' + seat
            : i < SLOT_ORDER.length
            ? 'greet类 · ' + SLOT_LABEL[SLOT_ORDER[i]]
            : 'greet类 · 追加 ' + seat;
          const slot = SLOT_ORDER[i];
          /** 旧时段表只作"条目没写条件"时的文案兜底（迁移后的配置不会有这种条目） */
          const range = slot
            ? sub?.greetingRanges?.[slot] ?? DEFAULT_TIME_RANGES[slot]
            : null;
          /**
           * ★ 2026-10-18：取条已改为**条件驱动**（`when.time`），不再是"第 i 条 = 第 i 个时段"。
           *   有条目级条件就**照实写**（唯一文案起点 `describeCondition`）；
           *   没有（旧 config 的 random 模式 / 新配置没写条件）才退回旧文案。
           */
          const timeText = e.when
            ? describeCondition(e.when)
            : greetModeText === '按时段' && range
            ? '时段 ' + hourRangeText(range.start, range.end)
            : '不限时段';
          const cond = GATE[kind] + (only ? ' · ' + timeText : tail);
          rows.push(makeRow(prefix + ' · ' + name, cond, e, st, ae));
        });
        return;
      }
      // touch：整个池只占 1 行（用池的首条当代表）—— 逐条列会让表里出现两遍同样的念白
      if (st.pools.touch.length) {
        rows.push(
          makeRow(
            prefix + ' · touch类（池内随机）',
            GATE[kind] +
              tail +
              '（touch 池 ' +
              st.pools.touch.length +
              ' 条，同「点击触摸」）',
            /** 代表行优先取"本通道可达"的那条，否则退回首条（旧文案不变） */
            entriesOf('touch')[0] ?? st.pools.touch[0],
            st,
            ae
          )
        );
      }
    });
  };

  /* ① 回到壁纸（自动）—— 载入 / 回到桌面 / 回到前台 / WE 暂停恢复 */
  pushChannel('resume', '回到壁纸');

  /* ② 待机（自动）—— 静置到点 */
  pushChannel('standby', '待机');

  /* ③ 点击触摸 —— 池 = 「触摸可触发的事件」勾中的类别并池，且**先按「可触发的事件族」筛过** */
  const touchKinds = st.channels.touch;
  const touchPool = mergeKindPools(touchKinds, st.pools, st.families);
  /**
   * ★ 序号分母用 `autoCount`：`weight:0` 的条目**不会被自动抽到**（它的行尾角标带
   *   「仅手动」），分母若用池长就会让人以为"7 条里 1 条 = 1/7 概率"。
   */
  const touchAuto = autoCount(touchPool);
  let touchSeat = 0;
  touchPool.forEach((e) => {
    const kind = kindOfEntry(e, touchKinds, st.pools);
    const manual = e.pick?.weight === 0;
    if (!manual) {
      touchSeat += 1;
    }
    rows.push(
      makeRow(
        /**
         * `weight:0` 的条目**不占序号**（它不在自动抽取里）。
         * ⚠️ 别再显示"#6（仅手动）"—— 与真的 #6 撞号，看起来像重复条目。
         */
        manual ? '点击触摸 · 仅手动' : '点击触摸 #' + touchSeat,
        // ★ 不写事件族（2026-10-17）：属族由念白列角标表达，条件列只留"命中热区 + 池内序号"
        '点击角色热区 · 池 #' +
          (manual ? '—' : touchSeat) +
          '/' +
          touchAuto +
          '（' +
          KIND_TEXT[kind] +
          '）',
        e,
        st,
        ae
      )
    );
  });

  /* ④ 常驻动作序列（仅启用时列出；否则不占行） */
  const seq = cfg.idleSequence;
  if (seq?.enabled === true && (seq.items ?? []).length) {
    const gapMs = typeof seq.gapMs === 'number' ? seq.gapMs : 0;
    (seq.items ?? []).forEach((it, i) => {
      const key =
        it && typeof it === 'object' ? it.key ?? it.actionId : undefined;
      const anim = it && typeof it === 'object' ? it.animation : (it as string);
      const e = key !== undefined ? findByEventKey(dialogues, key) : null;
      const cond =
        '常驻循环 ' +
        (i + 1) +
        '/' +
        (seq.items ?? []).length +
        ' · 间隔 ' +
        gapMs +
        ' ms';
      if (e) {
        rows.push(makeRow('常驻序列 #' + (i + 1), cond, e, st, ae));
      } else {
        rows.push({
          event: '常驻序列 #' + (i + 1),
          cond,
          action: anim || '—',
          // 只给动画名、没有念白条目：特效仍按动画名查（与真实播放同口径）
          fx: fxText(ae, anim),
          tag: '—',
          text: '（只播动作，不出台词、不出语音）',
          voice: '—',
        });
      }
    });
  }

  /**
   * ⑥ **自定义事件**（2026-10-18）—— 不在任何旧池键里的条目单独列一段。
   *
   * 为什么需要：`greet` / `chat` / `touch` 的逐条枚举依赖旧数组，自定义事件不在里面；
   * 若不列，用户新建的事件在档案里**完全不可见**（正是"档案念 A 表"的那类问题）。
   * 条件列直接调 `describeCondition`（唯一文案起点，禁止另写一份）。
   */
  const CH_LABEL: Record<TriggerChannel, string> = {
    standby: '待机',
    touch: '点击',
    resume: '回到壁纸',
  };
  /**
   * 只列**上面没逐条列过**的自定义事件（`st.enumerated` 由 `makeRow` 记账）。
   *
   * ★ 2026-10-20 修重复：通道枚举改成"按池 + `on`"之后，自定义事件本来就会出现在
   *   通道行里（`点击触摸 · 仅手动` / `回到壁纸 · greet类 …`），本段再列一次
   *   就成了"一张表两行同一条"。留着本段的意义只剩：**通道行看不到的那几种**
   *   ——不可达（`on: []`）、被事件开关关掉、被事件族闸门挡住、所在通道没勾该类。
   */
  const restCustom = st.dialogues.filter((e) => {
    const k = eventKeyOf(e);
    return (
      k.indexOf('custom:') === 0 &&
      st.legacyKeys.indexOf(k) < 0 &&
      st.enumerated.indexOf(k) < 0
    );
  });
  restCustom.forEach((e, i) => {
    const chans = channelsOf(e)
      .map((c) => CH_LABEL[c] ?? c)
      .join(' / ');
    const name = e.displayName || e.label || eventKeyOf(e);
    const key = eventKeyOf(e);
    /** 为什么没进通道行 —— 逐条写清楚，别让人只往一个方向查 */
    const why: string[] = [];
    if (!chans) {
      why.push('不可达（没写 on）');
    }
    if (e.enabled === false) {
      why.push('已被「事件开关」关闭');
    }
    if (st.gatedOut[key]) {
      why.push('所属事件族未勾选');
    }
    rows.push(
      makeRow(
        '自定义 #' + (i + 1) + ' · ' + name,
        (why.length ? why.join(' · ') + ' · ' : '') +
          (chans || '不可达') +
          ' · ' +
          describeCondition(e.when),
        e,
        st,
        ae
      )
    );
  });

  /* ⑤ 背景音乐（环境音，不是"触发"但也应当能查到） */
  if (cfg.bgm?.enabled !== false && cfg.bgm?.file) {
    rows.push({
      event: '背景音乐',
      cond: '加载后自动播放 · 暂停壁纸即暂停',
      action: '—',
      fx: '—',
      tag: '循环',
      text:
        '音量 ' +
        Math.round((cfg.bgm.volume ?? 0.5) * 100) +
        '%' +
        (cfg.bgm.loop === false ? '，不循环' : ''),
      voice: cfg.bgm.file,
    });
  }

  return rows;
};

/**
 * 描述某个通道「当前会播什么」—— 细则里的一句话。
 *
 * 与表格同源（都用 `st.channels` 与 `st.pools`），不另写判据。
 */
const describeChannel = (st: ArchiveState, kind: TriggerChannel): string => {
  const kinds = st.channels[kind];
  if (!kinds.length) {
    return '不播任何东西（一类都没勾，或勾了的类别没有候选）';
  }
  if (kinds.length === 1 && kinds[0] === 'greet') {
    /**
     * ★ 2026-10-18：问候不再"按列表下标对位"，而是每条自带的 `when.time` 过滤后随机
     *   ⇒ 文案必须跟着改，否则档案会说谎（PLAN §0 #3 的同一条理由）。
     */
    return st.greetMode === 'random'
      ? 'greet 类全部条目里随机取 1 条'
      : '取条件命中当前时刻的 greet 条目（无条件者恒命中），再有多个则随机 1 条';
  }
  const pool = mergeKindPools(kinds, st.pools, st.families);
  /** ★ 计数用 `autoCount`（`weight:0` 不会被自动抽到，见 `autoCount` 的说明） */
  const manual = pool.length - autoCount(pool);
  return (
    '「' +
    kinds.map((k) => KIND_TEXT[k]).join('、') +
    '」并池随机 1 条（共 ' +
    autoCount(pool) +
    ' 条' +
    (manual ? '，另有 ' + manual + ' 条仅手动' : '') +
    '）'
  );
};

/**
 * 表格下方的「细则」——那些**跨行共享**的闸门，逐行重复写在表格里会淹掉信息。
 */
const buildNotes = (cfg: Configs, st: ArchiveState): string[] => {
  const sub = cfg.subtitle;
  const notes: string[] = [];
  /**
   * ★ 校验汇总（2026-10-18，PLAN §6.3）：`reject` 会让事件不播、`coerce` 是修好了继续播。
   *   写在第一条，用户排查"为什么这条不播"时第一眼就能看到。
   */
  if (st.validation) {
    notes.push(
      summarizeReport(st.validation) +
        (st.validation.unplayable.length
          ? ' · 其中 ' +
            st.validation.unplayable.length +
            ' 条不会播（念白列带 ⚠）'
          : '')
    );
  }
  const delaySec = Math.max(
    0,
    Math.round((sub?.greetingDelayMs ?? 3000) / 1000)
  );
  const standbySec = Math.max(
    0,
    Math.round((sub?.standbyIdleMs ?? 25000) / 1000)
  );

  /**
   * ★ 2026-10-20：本机「事件开关」关掉的条目**不进池**（与运行时同判据）。
   *   只剔不说明会被当成"事件丢了"，所以必须报一句总数、并指路。
   */
  if (st.disabledCount > 0) {
    notes.push(
      '「事件开关」：本机另有 ' +
        st.disabledCount +
        ' 条被关闭（不在上面的池里，也不会被抽到）—— 在设置面板第 5 页「事件开关」重新打开。'
    );
  }

  /**
   * ★★ **事件族闸门**（2026-10-17 起对所有入口生效）—— 必须写在第一条：
   *   它一项都不勾时上面三句全是"不播任何东西"，不先解释会让人以为是配置坏了。
   */
  if (
    st.phases !== undefined &&
    (st.families.families.length > 1 || st.phases.length === 0)
  ) {
    notes.push(
      st.phases.length
        ? '「事件族」：当前只触发 ' +
            st.phases.map((p) => st.families.label(p)).join('、') +
            '（**所有入口**都受它约束）。'
        : '「事件族」：**一项都没勾 ⇒ 所有事件都不触发**' +
            '（下方的入口细则全部为空是正常的；勾上至少一族即可恢复）。'
    );
  }

  /**
   * ★ 2026-10-17 从简（用户要求）：原先 6 段长句里塞了太多"为了严谨而重复表格"的内容。
   *   每条压到 1~2 行 —— 闸门讲到"能分辨"即可，秒数之类的数字留在条件列/表格里。
   */
  notes.push(
    '「回到壁纸」：载入后 ' +
      delaySec +
      ' 秒 / 页面重新可见 / 窗口重获焦点 / WE 恢复（恢复需离开 ≥ 15 秒）触发；' +
      '相邻两次至少隔 5 秒，演出中跳过。当前 → ' +
      describeChannel(st, 'resume') +
      '。'
  );
  notes.push(
    '「长时间待机」：从载入起算，任何动作播放都重新计时；静置 ' +
      fmtSec(standbySec) +
      '后触发。当前 → ' +
      describeChannel(st, 'standby') +
      '。'
  );
  notes.push(
    '「点击触摸」：点中任一热区后从池中随机取 1 条' +
      (st.channels.touch.length
        ? /**
           * ★ 2026-10-17 起只有**一套**池（`st.pools`，三层判据都已含在里面）——
           *   不再有"触摸专用 / 缺省族专用"两套，表格与细则不可能各读一套。
           * ★ 2026-10-18：计数走 `autoCount`（`weight:0` 的"仅手动"条目不算进去）。
           */
          (() => {
            const pool = mergeKindPools(
              st.channels.touch,
              st.pools,
              st.families
            );
            const manual = pool.length - autoCount(pool);
            return (
              '（池 ' +
              autoCount(pool) +
              ' 条' +
              (manual ? '，另有 ' + manual + ' 条仅手动' : '') +
              '）'
            );
          })()
        : '（池为空 ⇒ 不播）') +
      '；多条念白可共用同一动画，属骨架资源本身的情况。'
  );
  notes.push(
    '念白播放时同时出字幕与语音，停留时长取标注时长与动画时长的较短者；' +
      '触摸的动作与语音有「叠加 / 排队」两种模式，启用常驻动作序列时触摸排在序列之后。'
  );
  /**
   * ★ 播放动作期间点击怎么处理（2026-10-08 新增）—— 表格里每一行都受它影响，
   *   写成一行细则比逐行重复更清楚。
   */
  const feedbackText =
    sub?.touchFeedbackMode === 'queue'
      ? '排进播放队列（演完当前这条再接上）'
      : sub?.touchFeedbackMode === 'none'
      ? '不做任何反馈（演出期间点击无效）'
      : sub?.touchFeedbackMode === 'immediate'
      ? '立即播放新动作（打断当前这条）'
      : '仅问候/聊天时立即（演触摸动作时不响应，旧版行为）';
  notes.push(
    '「播放动作时点击」：' +
      feedbackText +
      '；在「设置 → 事件触发」页改，两路自动触发均不打断动作。'
  );

  return notes;
};

export const createArchive = (options: ArchiveOptions): ArchivePanel => {
  let visible = options.visible === true;
  const cfg = options.config;
  /** 「动画名 → 粒子组名」映射（缺省空表 ⇒ 特效列全为「—」）。见 `ActionEffectNames`。 */
  const ae: ActionEffectNames = options.actionEffects ?? {};
  // ★ 口径只算一次，表格与细则共用（见 `ArchiveState` 的注释）
  const st = resolveState(
    cfg,
    options.events,
    options.validation ? options.validation() : null
  );
  const rows = buildRows(cfg, st, ae);
  const notes = buildNotes(cfg, st);

  // ★ 先初始化 UI 缩放变量（幂等）：下面所有 px 都依赖它
  initUiScale();

  /* ── 全屏层 ───────────────────────────────────
   * ★ `pointer-events:none`：本面板**不接管交互**，卡外的点击照常到角色（见文件头）。
   */
  const root = createEl(
    'div',
    [
      'position:fixed',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'z-index:2147483645',
      'pointer-events:none',
      'display:' + (visible ? 'block' : 'none'),
      'font-family:' + FONT,
      'color:#eef1f6',
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';')
  );
  root.id = 'wb-archive-root';

  /* 半透明遮罩：只压暗、不吃事件（不用 backdrop-filter，见文件头） */
  createEl(
    'div',
    [
      'position:absolute',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'background:rgba(0,0,0,0.30)',
    ].join(';'),
    root
  ).id = 'wb-archive-scrim';

  /* ── 卡片（居中 + 固定视口比例）─────────────────
   * ★ 尺寸与设置面板**完全一致**：`80vw × 80vh`（用户 2026-09-30 明确要求）。
   * ★ 外框几何用 vw/vh（不随 UI 缩放漂），缩放只作用于内层 ⇒ `fitContent` 才有意义。
   */
  const card = createEl(
    'div',
    [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:80vw',
      'height:80vh',
      'pointer-events:auto',
      'display:flex',
      'flex-direction:column',
      'box-sizing:border-box',
      'padding:' + uiPx(16) + ' ' + uiPx(20) + ' ' + uiPx(12),
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.16)',
      'border-radius:' + uiPx(14),
      'background:rgba(16,18,26,0.94)',
      'box-shadow:0 ' + uiPx(10) + ' ' + uiPx(34) + ' rgba(0,0,0,0.45)',
    ].join(';'),
    root
  );
  card.id = 'wb-archive-card';
  SWALLOW_EVENTS.forEach((evt) => {
    card.addEventListener(
      evt,
      (e: Event) => {
        e.stopPropagation();
      },
      false
    );
  });

  /* ── 头部 ─────────────────────────────────── */
  const header = createEl('div', 'flex:0 0 auto', card);
  createEl(
    'div',
    'font-size:' + fpx(15) + ';font-weight:600;letter-spacing:' + uiPx(0.5),
    header
  ).textContent = '档案 · 可能触发的事件';
  createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.55;line-height:1.45;margin-top:' +
      uiPx(3),
    header
  ).textContent =
    '下表按当前生效的配置实时生成（改过设置后，这里的数字与池子会跟着变）。' +
    /**
     * ★ 当前**动作族**（2026-10-17）—— 档案里"动作"列显示的是换名后的动画名，
     *   不交代一句读者会以为 `*_marry` 是笔误。只在声明了动作族的工程里出现。
     */
    (st.families.actionIds.length
      ? ' 当前动作族：' +
        (st.actionPhase
          ? st.families.actionLabel(st.actionPhase) +
            '（动画名带 "' +
            st.families.suffixOf(st.actionPhase) +
            '"）'
          : cfg.subtitle?.actionPhaseBaseLabel ?? '默认') +
        '。'
      : '');

  /* ── 正文（唯一滚动容器）───────────────────── */
  const body = createEl(
    'div',
    [
      'flex:1 1 auto',
      // ★ flex 子项默认 min-height:auto ⇒ 内容会把容器撑破，必须显式 0
      'min-height:0',
      'overflow-y:auto',
      'margin-top:' + uiPx(8),
      'padding-top:' + uiPx(6),
      'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      // 隐藏原生滚动条（WE 里拖不动）；正常情况下 fitContent 已保证不需要滚
      'scrollbar-width:none',
      '-ms-overflow-style:none',
    ].join(';'),
    card
  );
  body.id = 'wb-archive-body';

  /* ── 表格 ─────────────────────────────────────
   * 用 flex 行 + 百分比列宽（不用 `<table>`）：列宽要与设置面板的阅读节奏一致，
   * 且 `<table>` 的默认样式（cellpadding/border-spacing）要清零一遍更麻烦。
   */
  const table = createEl('div', 'display:flex;flex-direction:column', body);
  table.id = 'wb-archive-table';

  const makeCells = (
    parent: HTMLElement,
    texts: readonly string[],
    css: string
  ): void => {
    COLS.forEach((w, i) => {
      const c = createEl(
        'div',
        'width:' +
          w +
          ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
          uiPx(7) +
          ';' +
          css,
        parent
      );
      c.textContent = texts[i] ?? '';
    });
  };

  /* 表头 + `|---|` 分隔线（md 表格的观感） */
  const head = createEl(
    'div',
    'display:flex;flex:0 0 auto;font-size:' +
      fpx(12) +
      ';font-weight:600;color:#9fc5f0;padding:' +
      uiPx(3) +
      ' 0',
    table
  );
  head.id = 'wb-archive-head';
  makeCells(head, ['事件', '触发条件', '动作', '特效', '念白', '语音'], '');
  createEl(
    'div',
    'flex:0 0 auto;height:' +
      uiPx(1) +
      ';background:rgba(159,197,240,0.42);margin:0 0 ' +
      uiPx(2),
    table
  ).id = 'wb-archive-hr';

  rows.forEach((r, i) => {
    const row = createEl(
      'div',
      'display:flex;flex:0 0 auto;align-items:flex-start;padding:' +
        uiPx(6) +
        ' 0' +
        (i === rows.length - 1
          ? ''
          : ';border-bottom:' + uiPx(1) + ' solid rgba(255,255,255,0.07)'),
      table
    );
    row.id = 'wb-archive-row-' + (i + 1);
    row.setAttribute('data-wb-archive-row', String(i + 1));

    /* 事件：名字 + 序号色块 */
    const cEvent = createEl(
      'div',
      'width:' +
        COLS[0] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(14) +
        ';font-weight:600',
      row
    );
    cEvent.textContent = r.event;

    /* 触发条件 */
    const cCond = createEl(
      'div',
      'width:' +
        COLS[1] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(12) +
        ';line-height:1.6;opacity:.86',
      row
    );
    cCond.textContent = r.cond;

    /* 动作：等宽字体，方便与骨架动画名对照 */
    const cAction = createEl(
      'div',
      'width:' +
        COLS[2] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(12) +
        ';font-family:Consolas,Menlo,monospace;color:#ffd98a',
      row
    );
    cAction.textContent = r.action;

    /* 特效：该动画绑定的粒子组名（每行一个，`pre-line` 才会换行），青色与琥珀色动作名区分 */
    const cFx = createEl(
      'div',
      'width:' +
        COLS[3] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(11) +
        ';font-family:Consolas,Menlo,monospace;color:#9fe8d6;white-space:pre-line;word-break:break-all;line-height:1.5',
      row
    );
    cFx.textContent = r.fx;

    /* 念白：上标 id/动作名（淡），下面正文 */
    const cLine = createEl(
      'div',
      'width:' +
        COLS[4] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7),
      row
    );
    createEl(
      'div',
      'font-size:' +
        fpx(11) +
        ';opacity:.5;font-family:Consolas,Menlo,monospace;line-height:1.4',
      cLine
    ).textContent = r.tag;
    createEl(
      'div',
      'font-size:' + fpx(12) + ';line-height:1.6;opacity:.92',
      cLine
    ).textContent = r.text;

    /* 语音 */
    const cVoice = createEl(
      'div',
      'width:' +
        COLS[5] +
        ';flex:0 0 auto;box-sizing:border-box;padding:0 ' +
        uiPx(7) +
        ';font-size:' +
        fpx(11) +
        ';font-family:Consolas,Menlo,monospace;opacity:.7;word-break:break-all;line-height:1.5',
      row
    );
    cVoice.textContent = r.voice;
  });

  /* ── 细则（跨行共享的闸门）──────────────────── */
  const noteBox = createEl(
    'div',
    'flex:0 0 auto;margin-top:' +
      uiPx(9) +
      ';padding-top:' +
      uiPx(7) +
      ';border-top:' +
      uiPx(1) +
      ' solid rgba(255,255,255,0.10)',
    table
  );
  noteBox.id = 'wb-archive-notes';
  createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';font-weight:600;color:#9fc5f0;margin-bottom:' +
      uiPx(3),
    noteBox
  ).textContent = '触发细则';
  notes.forEach((n) => {
    createEl(
      'div',
      'font-size:' +
        fpx(11) +
        ';line-height:1.62;opacity:.72;margin-bottom:' +
        uiPx(2),
      noteBox
    ).textContent = '· ' + n;
  });

  /* ── 底部（怎么关掉它 + 溢出提示）───────────── */
  const foot = createEl(
    'div',
    [
      'flex:0 0 auto',
      'margin-top:' + uiPx(8),
      'padding-top:' + uiPx(7),
      'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      'font-size:' + fpx(11),
      'opacity:.55',
      'line-height:1.45',
    ].join(';'),
    card
  );
  foot.id = 'wb-archive-foot';
  foot.textContent =
    '关闭方式：在 Wallpaper Engine 的壁纸属性面板中取消勾选「显示档案」即可隐藏本窗口（无需重启）。';

  /**
   * 溢出提示 —— 只在**真的需要滚**时出现。
   *
   * 之所以要明说"按住拖动"：WE 不转发滚轮、原生滚动条也点不动（见文件头），
   * 用户无从得知这里其实可以拖。
   */
  const overflowHint = createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.85;color:#ffd98a;margin-top:' +
      uiPx(2) +
      ';display:none',
    foot
  );
  overflowHint.id = 'wb-archive-overflow-hint';
  overflowHint.textContent = '内容超出卡片高度：按住表格区域上下拖动即可滚动。';

  /* ── 自适应：正文在当前卡片里完整装下（与 fitPanelScale 同一思路）──
   *
   * 卡片高度固定 80vh、body 是 flex:1 ⇒ `body.clientHeight` 就是可用高度；
   * 超高时按比例覆盖卡片上的 `--wb-ui-s`（内层字号/间距全走 uiPx ⇒ 整块等比缩）。
   * `K_MIN` 取 0.55（比免责弹窗的 0.62 更宽），因为本表行数会随配置变多。
   * 幂等：`bodyK` 不变时不写样式 ⇒ 不会与 ResizeObserver 互相触发形成抖动。
   */
  const K_MIN = 0.55;
  let bodyK = 1;
  const fitContent = () => {
    if (!visible) {
      return;
    }
    const s = getUiScale();
    for (let i = 0; i < 3; i++) {
      const avail = body.clientHeight;
      const content = body.scrollHeight;
      if (!(avail > 0) || !(content > 0)) {
        break;
      }
      let next = bodyK;
      if (content > avail) {
        // 留 0.5% 余量，避免刚好贴边导致下一轮又判定"超高"
        next = Math.max(K_MIN, (bodyK * avail * 0.995) / content);
      } else if (bodyK < 1 && content < avail - 8) {
        next = Math.min(1, (bodyK * (avail - 4)) / content);
      }
      if (Math.abs(next - bodyK) < 0.002) {
        break;
      }
      bodyK = next;
      card.style.setProperty(UI_SCALE_VAR, String(s * bodyK));
    }
    // 缩小到 K_MIN 仍装不下 ⇒ 提示可拖动
    overflowHint.style.display =
      body.scrollHeight > body.clientHeight + 1 ? 'block' : 'none';
  };

  /* ── 兜底：按住拖动滚动（WE 里滚轮/原生滚动条都不可用）── */
  let dragging = false;
  let dragFromY = 0;
  let dragFromTop = 0;
  body.addEventListener('mousedown', (e: MouseEvent) => {
    if (body.scrollHeight <= body.clientHeight) {
      return;
    }
    dragging = true;
    dragFromY = e.clientY;
    dragFromTop = body.scrollTop;
  });
  const onDragMove = (e: MouseEvent) => {
    if (!dragging) {
      return;
    }
    body.scrollTop = dragFromTop - (e.clientY - dragFromY);
  };
  const onDragUp = () => {
    dragging = false;
  };
  window.addEventListener('mousemove', onDragMove, false);
  window.addEventListener('mouseup', onDragUp, false);

  const applyVisibility = () => {
    root.style.display = visible ? 'block' : 'none';
    if (visible) {
      fitContent();
    }
  };

  const onWindowResize = () => {
    // 推迟到 rAF：uiScale 的 resize 监听会先写好 --wb-ui-s，样式重算后再量
    window.requestAnimationFrame(() => fitContent());
  };
  window.addEventListener('resize', onWindowResize, false);
  const ro = new ResizeObserver(() => fitContent());
  ro.observe(body);

  // ★ 必须先上屏再量：未 append 时 clientHeight 恒为 0，fitContent 量不出东西
  document.body.appendChild(root);
  applyVisibility();

  return {
    setVisible: (v: boolean) => {
      visible = v === true;
      applyVisibility();
    },
    isVisible: () => visible,
    rowCount: () => rows.length,
    dispose: () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize, false);
      window.removeEventListener('mousemove', onDragMove, false);
      window.removeEventListener('mouseup', onDragUp, false);
      if (root.parentElement) {
        root.parentElement.removeChild(root);
      }
    },
  };
};
