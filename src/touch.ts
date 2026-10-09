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
 * 触摸 / 待机 / 问候的**动作播放控制器**。
 *
 * 需求（由用户明确）：
 *   - 角色处于 **idle** 状态时，点击 → 随机播一条触摸动作
 *   - 动作播完 → 自动回到 idle
 *   - **队列容量 1**：同一时间只能有一个动作在播
 *   - 空闲 25 秒 → 播一条休闲待机；首次打开 / 回到桌面 → 播一条按时段的问候
 *   - 每条动作都带**字幕**（见 `dialogue.ts` / `voiceBubble.ts`）——
 *     动作、字幕取自**同一条念白**，所以永远不会出现"动作配错台词"
 *   - 热区 = `config.json` 的 `touch.zones`；**暂不做"哪个区播哪个动作"的绑定**，
 *     S9 的 prefab 里只有 1 个无后缀 `SoulSpineHitArea`，解包侧没有绑定信息
 *     （用户 2026-09-17 定：任意区命中 → 随机选一条；2026-09-20 沿用）
 *
 * 为什么不用模板自带的 `cursorPress`（读了源码后否掉）：
 *   1. `SpineAnimator.ts` 里是 `setAnimation(TRACK_NUM, name, [loop]=true)`
 *      —— loop **写死为 true**，动作会一直循环，回不了 idle。
 *   2. 它没有状态判断（不管当前是否 idle 都切），也没有队列概念（直接打断）。
 *   3. 它会每帧改写 `boneName` 骨骼的 x/y（实测位移会存活），会平白多出一个被拽偏的骨骼。
 *
 * ## ★ `touchFeedbackMode`：**正在播动作时**用户点击该怎么处理（2026-10-08 新增）
 *
 * | 模式 | 正在播 touch | 正在播 greet / standby |
 * |---|---|---|
 * | `'legacy'`（**缺省**） | 忽略（计一次 skipped） | 打断并立刻播新的 |
 * | `'immediate'` | 打断并立刻播新的 | 打断并立刻播新的 |
 * | `'queue'` | 排到当前这条之后播 | 排到当前这条之后播 |
 * | `'none'` | 无反馈 | 无反馈 |
 *
 * ⚠️ 缺省档是 `'legacy'` = **改动前的原规则表** ⇒ 本字段是纯新增能力，
 *   升级不改变任何既有观感。`'immediate'` 才与改动前有差别（"触摸播动期间再点"那一格
 *   由忽略变成打断重播，依据是本文件顶部那句用户原话：**"用户点一下没反应会以为壁纸卡了"**）。
 *
 * ## ★ 两种播放模式（`options.queueTrack` 决定，2026-09-27）
 *
 * | 模式 | 何时 | 怎么播 | 播完 |
 * |---|---|---|---|
 * | **叠加**（默认，`queueTrack == null`） | 未启用常驻序列（track 0 是 idle 循环） | `addAnimation(2, name, false, 0)`，占 **track 2** | `clearTrack(2)`，露出 track 0 的 idle |
 * | **排队**（`queueTrack === 0`） | index.ts 检测到序列接管了 track 0 | `addAnimation(0, name, false, 0)`，排到 **track 0 队尾**，等当前常驻动作播完自动接上 | 不能 `clearTrack(0)`（会把序列一起清掉）⇒ 回调 `onActionFinished` 让序列 `resume()` |
 *
 * ⇒ **`touchFeedbackMode:'queue'` 在两种模式下走的是两套实现**：排队模式直接复用
 *   spine 自己的 track 队列（`addAnimation` 天然排在后面）；叠加模式没有那套队列，
 *   由本模块用一个容量 1 的待播槽实现（`pendingQueue`，见 `TOUCH_QUEUE_MAX`）。
 *
 * ⇒ **`touchFeedbackMode:'immediate'` 同理没有新代码**：叠加模式走
 *   `clearActive()` + `addAnimation`（= 立刻接手），排队模式仍是 `addAnimation`
 *   （= 接在当前这条之后）—— **与改动前一字不差的同一条路径**，
 *   唯一的差别是"这次点击不再被提前 return 掉"（详见 `playAction` 的注释）。
 *
 * ### 为什么启用序列时必须排队（而不是继续叠加）
 *
 * 两条轨道同时播时，track 2 的 `ColorTimeline` 会**覆盖** track 0 设好的 slot 透明度：
 * 序列动作正把 `BUMIAN`、`YS` 这些特效层设成可见（alpha=1），触摸动作里它们的关键帧是 0
 * ⇒ 一叠加就被压成透明，"部件消失"（用户 2026-09-27 报的现象）。
 * 顺序播放时同一时刻只有一条轨道驱动骨架，从根上没有这个冲突。
 *
 * ### 排队模式的代价（用户已确认接受）
 *
 * **响应延迟 = 当前常驻动作的剩余时长**（实测最长 `greet` 11s）。
 * 用户点下去之后要等正在演的动作收尾，触摸动作才登场。
 *
 * ### 共通规则
 *
 *   - `addAnimation(..., [loop]=false, 0)` —— 播一次，不循环
 *   - 在 TrackEntry 上挂 `listener.complete` → 按上表收尾
 *     （叠加模式收尾 = `setEmptyAnimation(2, TOUCH_MIX_OUT)`。
 *      2026-09-28 由 `clearTrack(2)` 改来，原因见 `TOUCH_MIX_OUT` 注释；
 *      旧注释担心的"`<empty>` 长期残留在 track 上"**实测不成立** ——
 *      混出走完后 `update()` 的正常清空条件（`next==null && mixingFrom==null`）会满足）
 *   - "是否 idle" = track 0 当前动画名是否为 `idle`（或序列里的动画名）
 *   - "队列容量 1" = 已有动作在排队 / 在播时不再响应新的点击；
 *     **但待机 / 问候可以被点击打断**（用户点一下没反应会以为壁纸卡了）
 *     —— 排队模式下"打断"自然退化为"排在它后面"（见 `trigger` 里的说明）
 *
 * 与前缀状态机的区别：不持久化任何"角色状态"变量，**直接读 track 0 的真实动画名**，
 * 避免探针/状态机的记忆与实际渲染不同步（这是模板 `cursorPress` 现有实现的隐患之一）。
 */

import * as threejsSpine from 'threejs-spine-3.8-runtime-es6';
import {
  DialogueEntry,
  TouchFeedbackMode,
  TouchZoneConfig,
} from './config.type';
import { pickRandomFromPool } from './dialogue';

/** 触摸动画占用的轨道号。模板的 cursorFollow/cursorPress 占 track 1。 */
export const TOUCH_TRACK = 2;

/**
 * 动作收尾的**混合（淡出）时长**（秒）。**两种模式都用**（2026-09-28 起叠加模式也用）。
 *
 * ## 排队模式
 * 触摸播完时 track 0 上挂着触摸动画的末帧，紧接着序列的 `setAnimation(0, 下一条)`
 * 接管 —— 两边姿态不一定接得上（触摸动作的收尾姿态与序列动作的起手姿态是两套），
 * 所以给一点淡入。
 *
 * ## 叠加模式（★ 2026-09-28 修正，推翻旧结论）
 *
 * 早先这里写着"用户已确认触摸动画与 idle 的首尾帧相同，硬切不跳帧"，
 * **该结论已被实测推翻**：那次比较的是"触摸动画**自己的**首帧 vs 末帧"，
 * 而屏幕上真正看到的是「触摸末帧」vs「idle **当前相位**」——前者固定，后者随
 * loop 动画的相位任意漂移，所以硬切必然跳。
 *
 * 实测（`_regress/61_诊断_动画通道与残留.ts`，骨骼世界位移口径，30fps）：
 *   - `clearTrack(2)` 硬切 ⇒ 收尾那一帧最大骨位移 **154.2** 单位；
 *   - idle 稳态帧间位移仅 **3.7** 单位 ⇒ 跳变是稳态的 **42 倍** ——
 *     正是用户报的"动完回待机，人物图层一帧突兀变化"；
 *   - 改用 `setEmptyAnimation(2, 0.25)` ⇒ 降到 **19.2** 单位。
 *
 * ★ 另有一个必须用 `setEmptyAnimation` 的理由：`clearTrack` 是**瞬间移除**，
 * 而 threejs-spine 的 `SkeletonMesh.update()` **从不 `setToSetupPose()`**
 * （`packages/threejs-spine-3.8-runtime-es6/threejs/src/SkeletonMesh.ts:114-121`
 * 只有 `state.update → state.apply → updateWorldTransform`）。
 * 于是「chat 有、idle 与触摸动作都没有」的通道会**永久停在 chat 末帧的值**
 * （实测 5 条：`Rotate@bone93/94`、`Scale@bone93`、`Color@slot:YS43/48`）
 * ⇒ 用户看到的"嘴型/部件卡住"。`setEmptyAnimation` 走 mix-out 路径，
 * 实测收尾后这 5 条**全部回到 setup pose**（未复位数 0/4）。
 */
export const TOUCH_MIX_OUT = 0.25;

/**
 * 进入触摸动画时的淡入时长（秒）。**仅在排队模式生效。**
 *
 * ★ 必须**显式**设到 `TrackEntry.mixDuration` 上：排队时 track 0 上已有 current
 * ⇒ `AnimationState.ts:731` 不会把它归 0，但取的是 `data.getMix()`，而本工程
 * `defaultMix` 恒为 0 ⇒ 不显式给就还是硬切。
 *
 * 实测（`59_验证_排队方案可行性.ts`，序列 `touch1→touch3→chat`、2s 点击）：
 * 不设 → 触摸起始帧骨骼跳变 17.0 单位；设 0.25 → **2.3 单位**。
 */
export const TOUCH_MIX_IN = 0.25;

/**
 * `'queue'` 模式下**待播槽的容量**（叠加模式专用，2026-10-08）。
 *
 * ★★ 取 **1** 是沿用本项目既定的「队列容量 1」口径（文件头需求表第 3 条）：
 * 同一时间只允许多一条等候。连点两下以上时只保留**最后一次**的选择
 * —— 壁纸是装饰性交互，攒一串动作让用户等几十秒没有价值。
 * 想要更长队列 ⇒ 改这一个常量即可（消费逻辑已经在按数组写）。
 *
 * ⚠️ 排队模式（`queueTrack !== null`）**不受此限制**：那条路径直接排在 spine 的
 * track 队列尾上，容量由 spine 自己管。
 */
export const TOUCH_QUEUE_MAX = 1;

/**
 * 一个触摸热区。几何用**归一化视口坐标**（0~1，原点左上，与 `clientX/clientY` 同向），
 * 这样既与分辨率、窗口比例无关，也能直接喂给 DOM 覆盖层的百分比定位。
 *
 * 定义放在 `config.type.ts`（`TouchZoneConfig`）—— 因为它的**权威来源是 config.json**，
 * 这里只是同一个类型的运行时别名，避免两处定义漂移。
 */
export type TouchZone = TouchZoneConfig;

/**
 * 热区几何的权威来源 = **`assets/config.json` 的 `touch.zones`**（归一化 0~1，原点左上）。
 *
 * 2026-09-20 起**不再在代码里写死矩形**：
 *   - 旧实现是 3 个手测矩形（头/手/腿），基准还是 legacy 画幅 `2560×1600`，
 *     与当前 1700×750「水平锁定」口径早已不对应（见 `07_全屏适配` 文档 §7.1）；
 *   - 现改为解包素材自带的 `SoulSpineHitArea` 换算而来。
 *
 * ⚠️ 代码里保留 `CANVAS_W/CANVAS_H` 仅作**文档用途**（记录旧基准），不再参与运算。
 */
export const CANVAS_W = 2560;
export const CANVAS_H = 1600;

/** 动作来源。决定"能否打断对端"与统计口径 */
export type ActionSource = 'touch' | 'greet' | 'standby';

/** 动作闸门的判定结果 */
export type GateDecision =
  /** 放行，真的播 */
  | 'play'
  /** 被"队列容量 1"拦下（计一次 skipped） */
  | 'skip'
  /** 排到当前动作之后播（`'queue'` 模式专用；本次不立刻播） */
  | 'queue'
  /** 被"不打断正在播的动作"拦下（不计 skipped —— 那是自动触发的正常让位，不是用户操作被吞） */
  | 'reject';

/**
 * 动作闸门：决定一个新的动作请求该怎么处理。**纯函数，导出以便单测**。
 *
 * ## 规则表（`touchFeedbackMode === 'legacy'`，**缺省**）
 *
 * | 新动作 \ 正在播 | 无 | touch | greet / standby |
 * |---|---|---|---|
 * | **touch**（用户点击） | `play` | **`skip`** | **`play`**（打断并播） |
 * | **greet / standby**（自动） | `play` | `reject` | `reject` |
 *
 * ⇒ **这一档就是 2026-10-08 改动前的原规则表**（见 `TouchFeedbackMode` 注释）。
 *
 * ## 规则表（`'immediate'`）
 *
 * | 新动作 \ 正在播 | 无 | touch | greet / standby |
 * |---|---|---|---|
 * | **touch**（用户点击） | `play` | **`play`**（打断并播新的） | **`play`**（打断并播） |
 *
 * ## 规则表（`'queue'`）
 *
 * | 新动作 \ 正在播 | 无 | touch | greet / standby |
 * |---|---|---|---|
 * | **touch**（用户点击） | `play` | **`queue`** | **`queue`** |
 *
 * ## 规则表（`'none'`）
 *
 * | 新动作 \ 正在播 | 无 | touch | greet / standby |
 * |---|---|---|---|
 * | **touch**（用户点击） | `play` | **`skip`** | **`skip`** |
 *
 * ## 为什么这样定
 *
 * - **触摸是"用户的输入"**，四种模式只决定"有东西在播时如何应对"，空闲时一律放行。
 *   `'legacy'`（缺省）= 旧口径：正在播触摸动作时忽略点击、正在播问候/聊天时打断；
 *   `'immediate'` = 一律打断（依据 `touch.ts` 顶部那句用户原话"点一下没反应会以为壁纸卡了"）。
 * - **greet / standby 不打断任何东西**（四档一致）：它们是自动行为，抢用户的戏或互相抢戏都不合理。
 *   计 `reject` 而非 `skip`，因为它不是"用户操作被吞"。
 *   ⚠️ 它们也**不排队** —— 自动事件的时机本身就是有价值的信号，排队到几十秒后播没意义，
 *     丢弃即可（这正是 `reject` 与 `queue` 的分工：同一来源、不同处置）。
 *
 * ⚠️ 与"是否处于 idle"的判定（`isIdle()`）是**两件事**，不要合并：
 * 闸门看的是"有没有动作占着轨道"，`isIdle()` 看的是"track 0 上是不是常驻动画"。
 * 后者用于防"角色已经切到别的常驻状态了、还往里塞触摸动画"。
 *
 * @param mode 配置里的 `subtitle.touchFeedbackMode`；缺省 `'legacy'`
 *   ⇒ 只传前两个参数的既有调用方**与改动前完全同行为**（`_regress/60` 的 A6 就是靠这一档守住）。
 */
export const decideAction = (
  activeSource: ActionSource | null,
  source: ActionSource,
  mode: TouchFeedbackMode = 'legacy'
): GateDecision => {
  if (!activeSource) {
    return 'play';
  }
  if (source === 'touch') {
    if (mode === 'none') {
      // 正在播 ⇒ 完全无反馈
      return 'skip';
    }
    if (mode === 'queue') {
      return 'queue';
    }
    if (mode === 'legacy') {
      // ★ 旧口径：只有"正在播的是自动事件（问候/聊天）"才打断；触摸动作在演时点击被忽略
      return activeSource === 'touch' ? 'skip' : 'play';
    }
    // 'immediate'：一律打断并播新的一条
    return 'play';
  }
  // 自动播放（greet / standby）：不打断任何正在播的动作
  return 'reject';
};

/** 一次动作播放的载荷。`entry` 为 `null` ⇒ 该动作没有配字幕（只播动作） */
export type ActionPlayPayload = {
  source: ActionSource;
  animation: string;
  entry: DialogueEntry | null;
};

export type TouchControllerOptions = {
  /** 骨架名，仅用于日志 */
  skeletonFile: string;
  /** 常驻动画名（在 track 0），且是"可触发触摸"的判定基准 */
  idleAnimationName: string;
  /**
   * **额外的**常驻动画名（常驻动作序列用）。
   *
   * ## 为什么需要它（2026-09-22）
   *
   * `isIdle()` 的判据是"track 0 当前动画名 === `idleAnimationName`"。
   * 启用常驻序列后 track 0 会轮播序列里的多个动画 ⇒ 名字不再恒等于 idle
   * ⇒ **判据会永远为假 ⇒ 触摸彻底播不出来**（不报错，只是点了没反应）。
   *
   * 把序列的全部动画名传进来，判据就变成"track 0 是不是**某一个**常驻动画"——
   * 语义不变（仍是"角色没有处在别的常驻状态"），只是允许多个候选。
   *
   * 未启用序列时传空 ⇒ 行为与改造前完全一致。
   */
  extraIdleAnimations?: string[];
  /**
   * **排队模式**：把动作排到这条轨道的队尾顺序播放，而不是叠加在 `TOUCH_TRACK` 上。
   *
   * 传 `0`（即 `idleSequence.IDLE_TRACK`）启用；不传 = 保持原有的叠加行为。
   * 由 `index.ts` 按"常驻序列是否启用"决定 —— 序列接管 track 0 时才需要排队
   * （见本文件顶部"两种播放模式"）。
   *
   * ## 为什么是传轨道号而不是 import `IDLE_TRACK`
   *
   * 本模块刻意**不依赖** `idleSequence.ts`（要能脱离序列单独使用），
   * 轨道号属于装配期配置，由装配方给最清楚。
   */
  queueTrack?: number;
  /**
   * **正在播动作时**点击该怎么处理（对应 `config.subtitle.touchFeedbackMode`）。
   *
   * - `'legacy'`（缺省）⇒ 正在播触摸动作时忽略点击、正在播问候/聊天时打断（= 旧口径）；
   * - `'immediate'` ⇒ 无论如何都打断并立刻播新的；
   * - `'queue'` ⇒ 排到当前这条之后（叠加模式走本模块的待播槽，排队模式走 spine 的队列）；
   * - `'none'` ⇒ 正在播时点击什么都不做。
   *
   * 详见文件头的规则表；不传 = `'legacy'` ⇒ 旧的调用方行为与改动前完全一致。
   */
  touchFeedbackMode?: TouchFeedbackMode;
  /**
   * 排队模式下动作**播完**的回调。参数 = 交还轨道时的淡入时长（秒），
   * 装配方应转交给 `idleSequence.resume(mixSeconds)`。
   *
   * 叠加模式下不会调用（那条路径直接 `clearTrack`）。
   */
  onActionFinished?: (mixSeconds: number) => void;
  /** 骨架里除常驻动画外的全部动画名。仅用于"有没有可播动作"的判据与无字幕时的兜底 */
  touchAnimations: string[];
  /**
   * 热区；**必须显式传入**（来自 `config.json` 的 `touch.zones`）。
   * 命中判定按数组顺序**先命中先返回** —— 所以重叠处由靠前的区吃掉点击。
   */
  zones: TouchZone[];
  /**
   * 每次按下后回调命中的区域 id；**没命中任何区域**时回调 `null`。
   * 只给调试覆盖层用（显示"这次点到了哪块"），不影响播放逻辑。
   */
  onZoneHit?: (zoneId: string | null) => void;
  /** 随机源，测试时可注入固定值 */
  random?: () => number;
  /**
   * 触摸池：动作与字幕**同源**的念白条目。
   *
   * - 给了 ⇒ 命中热区时从池里随机取一条，播它的 `animation` 并把整条回调出去
   *   （`onAction`），字幕由 `voiceBubble` 显示；
   * - 不给 ⇒ 退回老行为：从 `touchAnimations` 里纯随机挑动画名，只播动作、无字幕。
   *
   * 池的构造（actionId → 条目）在 `index.ts`，用 `dialogue.ts` 的 `buildPool`。
   */
  touchPool?: DialogueEntry[];
  /** 每**真正开始**播一个动作都会回调（触摸 / 待机 / 问候），用于同步字幕 */
  onAction?: (payload: ActionPlayPayload) => void;
};

export type TouchController = {
  /** 注册到 mesh 更新循环之外——只负责挂/卸监听，无每帧开销 */
  dispose: () => void;
  /**
   * 主动播一个动作（待机 / 问候用）。
   *
   * 只在**完全空闲**时生效：不打断正在播的触摸动作（那是用户的点击结果，
   * 打断等于"点了却没反应"）。反过来，触摸**可以**打断待机/问候。
   *
   * @returns 是否真的播了
   */
  trigger: (entry: DialogueEntry | null, source: ActionSource) => boolean;
  /** 当前是否有动作在播（供待机计时判断） */
  isBusy: () => boolean;
  /** 当前在播的动画名；空串 = 没在播 */
  playingAnimation: () => string;
  /** 供探针读取只读诊断 */
  snapshot: () => {
    idleName: string;
    touchNames: string[];
    poolSize: number;
    busy: boolean;
    playing: string;
    /** 当前动作来源 */
    source: string;
    firedCount: number;
    greetCount: number;
    standbyCount: number;
    /** `'queue'` 模式下还在等着的条数（叠加模式才有；排队模式恒 0） */
    queuedCount: number;
    /** 命中区域内、但因"忙"或"非 idle"被忽略的次数 */
    skippedCount: number;
    /** 按下位置落在**所有区域之外**的次数 */
    missCount: number;
    lastPick: string;
    /** 最近一次按下的命中区域 id；没命中则为空串 */
    lastHitZone: string;
    /** 当前生效的热区（供覆盖层/测试读取） */
    zones: TouchZone[];
  };
};

/**
 * 区域命中判定（纯函数，导出以便单测）。
 *
 * 坐标口径：`clientX/clientY` 与 `viewW/viewH` 必须是**同一坐标系**。
 * WE 桌面下 `window.innerWidth/innerHeight` = 工程分辨率，与事件坐标一致
 * （实测见 `_探针_实验结论.md`），所以直接相除即是归一化坐标。
 *
 * 按数组顺序**先命中先返回**——所以区域内不要重叠，或把优先级高的放前面。
 */
export const hitTestZones = (
  zones: TouchZone[],
  clientX: number,
  clientY: number,
  viewW: number,
  viewH: number
): TouchZone | null => {
  if (!(viewW > 0) || !(viewH > 0)) {
    return null;
  }
  const u = clientX / viewW;
  const v = clientY / viewH;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    if (u >= z.u0 && u <= z.u1 && v >= z.v0 && v <= z.v1) {
      return z;
    }
  }
  return null;
};

/** 无 state / 无动画可播时的空实现（保证调用方不必到处判空） */
const createNoopController = (
  idleName: string,
  touchNames: string[],
  zones: TouchZone[],
  poolSize: number
): TouchController => ({
  dispose: () => undefined,
  trigger: () => false,
  isBusy: () => false,
  playingAnimation: () => '',
  snapshot: () => ({
    idleName,
    touchNames,
    poolSize,
    busy: false,
    playing: '',
    source: '',
    firedCount: 0,
    greetCount: 0,
    standbyCount: 0,
    queuedCount: 0,
    skippedCount: 0,
    missCount: 0,
    lastPick: '',
    lastHitZone: '',
    zones,
  }),
});

/**
 * 创建触摸控制器。
 *
 * @param skeletonMesh 目标骨架
 * @param options 配置
 */
export const createTouchController = (
  skeletonMesh: threejsSpine.SkeletonMesh,
  options: TouchControllerOptions
): TouchController => {
  const state = skeletonMesh.state;
  const idleName = options.idleAnimationName;
  /** 可接受为"常驻态"的动画名集合 = idle + 常驻序列的全部动画（见 options 上的注释） */
  const idleNames: string[] = [idleName];
  (options.extraIdleAnimations ?? []).forEach((n) => {
    if (n && idleNames.indexOf(n) < 0) {
      idleNames.push(n);
    }
  });
  const touchNames = options.touchAnimations.slice();
  const touchPool = (options.touchPool ?? []).slice();
  const zones = options.zones.slice();
  const onZoneHit = options.onZoneHit;
  const onAction = options.onAction;
  const random = options.random ?? Math.random;
  /** 排队模式的目标轨道；`null` = 叠加模式（原行为） */
  const queueTrack =
    typeof options.queueTrack === 'number' ? options.queueTrack : null;
  const onActionFinished = options.onActionFinished;
  /** 触摸反馈模式（缺省 `'legacy'` = 改动前的规则表，逐条等价） */
  const feedbackMode: TouchFeedbackMode = options.touchFeedbackMode ?? 'legacy';

  if (!state || !touchNames.length) {
    return createNoopController(idleName, touchNames, zones, touchPool.length);
  }

  /**
   * 叠加模式（没有 spine 队列可用）下 `'queue'` 的**待播槽**。
   *
   * ★ 容量 = `TOUCH_QUEUE_MAX`（= 1，见其注释）。存的是 `{animation, entry}` 而不是
   *   只存 `entry` —— 没配念白池时会退化成"随机挑动画名"（`playTouch` 的老分支），
   *   那种情况下 `entry` 是 `null`，动画名必须另外留住。
   */
  type PendingAction = { animation: string; entry: DialogueEntry | null };
  const pendingQueue: PendingAction[] = [];
  /** 待播的实际播放被推迟到一个宏任务里执行（避开 `AnimationState.update` 的重入）； dispose 时要撤 */
  let pendingTimer = 0;

  let firedCount = 0;
  let greetCount = 0;
  let standbyCount = 0;
  let skippedCount = 0;
  let missCount = 0;
  let lastPick = '';
  let lastHitZone = '';

  /** 当前 track 2 上的 entry；非空且未被 end/dispose 即视为"忙" */
  let activeEntry: threejsSpine.TrackEntry = null;
  /** 当前动作的来源；`null` = 没在播 */
  let activeSource: ActionSource = null;

  /**
   * 是否处于常驻态：直接读 track 0 的真实动画名，不用自维护的状态变量。
   *
   * 判据是"**属于**常驻动画集合"而不是"**等于** idle"—— 常驻序列启用后
   * track 0 会轮播多条，写成 `=== idleName` 会让触摸永远播不出来。
   */
  const isIdle = () => {
    const cur = state.getCurrent(0);
    return !!cur && idleNames.indexOf(cur.animation?.name ?? '') >= 0;
  };

  /**
   * 把骨架**复位到 setup pose**。
   *
   * ## 为什么必须自己复位（2026-09-28）
   *
   * threejs-spine 的每帧更新是
   * `SkeletonMesh.update()` → `state.update() → state.apply(skeleton) → updateWorldTransform()`
   * （`packages/threejs-spine-3.8-runtime-es6/threejs/src/SkeletonMesh.ts:114-121`），
   * **全程没有 `skeleton.setToSetupPose()`**。
   * 而 `AnimationState.apply()`（core/src/AnimationState.ts:195-272）只应用
   * "当前在播动画**各自拥有**的时间轴"，其余通道**原样保留上一帧的值**。
   *
   * 本骨架实测（`_regress/62_诊断_chat残留通道.ts`）：
   * **chat 独占、而 idle 与 touch1~3 都没有**的通道有 5 条 ——
   *   `Rotate@bone:bone93`、`Rotate@bone:bone94`、`Scale@bone:bone93`、
   *   `Color@slot:YS43`、`Color@slot:YS48`。
   * 于是「待机/晚间问候的 chat 正在播 → 用户点击触摸」时，这 5 条被别人接手不了，
   * 会**一直停在 chat 末帧的取值** ⇒ 用户报的"嘴型固定不变 / 部件卡住"。
   *
   * ## 为什么在"开始播新动作前"复位是安全的
   *
   * 复位只改 skeleton 的 local 值，**不在任何一帧的渲染路径中间**：
   * 点击事件发生在两次 rAF 之间，下一帧 `state.apply()` 会用 track 0 的常驻动画 +
   * 新动作的轨道把各自通道重新写满，用户看不到 setup 那一瞬。
   * 复位后**没有任何在播动画覆盖**的通道，才是它真正的"归宿"（setup 值）。
   *
   * 排队模式下同样安全：track 0 上的序列会在下一帧 apply 里重新覆盖自己的通道。
   */
  const resetToSetupPose = () => {
    const skeleton = skeletonMesh?.skeleton;
    if (skeleton) {
      skeleton.setToSetupPose();
    }
  };

  /**
   * 清掉当前动作，准备换新的。
   *
   * ★ 顺序要紧：**先把引用摘掉、再清轨道**。
   * `clearTrack` 会**同步**触发旧 entry 的 `end`/`dispose` 监听，
   * 那里面的判据是 `activeEntry === entry`；若先清轨道再摘引用，
   * 旧监听会以为"自己的条目还活着"，把刚设好的新状态又抹掉。
   */
  const clearActive = () => {
    const prev = activeEntry;
    activeEntry = null;
    activeSource = null;
    if (!prev) {
      return;
    }
    /**
     * ★ 排队模式下**不能** `clearTrack(queueTrack)` —— 那条轨道上还有常驻序列，
     * 一并清掉会让角色露回 setup pose。排队模式也不需要清：闸门保证同一时刻
     * 只有一条在排队/在播，新动作只会**排在旧的后面**（"打断"自然退化为"接力"）。
     */
    if (queueTrack === null) {
      state.clearTrack(TOUCH_TRACK);
    }
  };

  /**
   * 真正开始播一个动作。调用前**必须**已经通过可打断性判定。
   *
   * ## ★★ 为什么**没有**"真正打断"那一套 API（2026-10-08 定案）
   *
   * 直觉上"立即播放"该是 `setAnimation`（它 dispose 掉当前的和排队的一切）。实测把它用在
   * **排队模式**上会当场退化：**起始跳变 158.8 单位、7 个部件瞬时消失**（`_regress/60` 的
   * A3/A4 直接 FAIL）—— 因为 `setAnimation` 会把常驻序列正演到一半的那条砍掉，
   * 从一个任意相位硬切进触摸动作的起手式。这正是本项目当初从"叠加"改"排队"要治的病。
   *
   * ⇒ `'immediate'` 的实现就是**"不再提前 return"**：照旧走 `clearActive()` + `addAnimation`，
   *   与改动前"触摸打断 greet/standby"走的是**同一条代码路径**，一行新的播放操作都没有。
   *   ⚠️ 在排队模式下它就表现为"接在序列之后"（挤掉正在播的触摸动作），
   *   这与该模式下改动前的行为完全一致，不是偷懒 —— 那条轨道与序列共用，硬抢必然出问题。
   */
  const playAction = (
    animationName: string,
    source: ActionSource,
    entry: DialogueEntry | null
  ): boolean => {
    if (!animationName) {
      return false;
    }
    clearActive();
    /**
     * ★ 换动作前先把骨架复位到 setup pose（2026-09-28）。
     *
     * 覆盖的是"**被清掉的那个动作改过、而接下来的在播动画没人覆盖**"的通道
     * —— 典型就是 `chat` 独占的 5 条（见 `resetToSetupPose` 的注释）。
     * 不复位 ⇒ 它们会停在被打断那一刻的取值（"嘴型/部件卡住"）。
     *
     * 顺序：`clearActive()`（清轨道）之后调，避免与 `clearTrack` 同步触发的
     * `end/dispose` 监听互相干扰；`resetToSetupPose` 只改 local 值，
     * 下一帧 `state.apply()` 会把常驻动画的通道重新写满。
     */
    resetToSetupPose();

    // loop = false：播一次就停；delay = 0：立即开始（排队模式下 delay 会被
    // `addAnimationWith` 改写成"上一条的剩余时长"，即等当前常驻动作播完再上）
    const trackEntry =
      queueTrack === null
        ? state.addAnimation(TOUCH_TRACK, animationName, false, 0)
        : state.addAnimation(queueTrack, animationName, false, 0);
    if (!trackEntry) {
      return false;
    }
    /**
     * ★ 排队模式必须**显式**设 mixDuration。
     *
     * `AnimationState.ts:731` 只在 `last == null` 时才把它归 0，这里 last 非空
     * （排在常驻动作后面）⇒ 取的是 `data.getMix()`；而本工程 `defaultMix` 恒为 0
     * ⇒ 不显式给就还是硬切（实测：触摸起始帧跳变 17.0 → 设 0.25 后 2.3）。
     *
     * 叠加模式保持不设（=0），那是已验证过的原行为，见 `TOUCH_MIX_OUT` 注释。
     */
    if (queueTrack !== null) {
      trackEntry.mixDuration = TOUCH_MIX_IN;
    }
    activeEntry = trackEntry;
    activeSource = source;
    if (source === 'touch') {
      firedCount++;
    } else if (source === 'greet') {
      greetCount++;
    } else {
      standbyCount++;
    }

    // 挂在**该 entry 自己**上，而不是全局 addListener：
    // 全局监听要额外过滤"是不是我这条 track"，且会被别的 mesh 的 state 触发。
    trackEntry.listener = {
      start: () => undefined,
      interrupt: () => undefined,
      end: () => {
        // 兜底：若 complete 之后又被 end（例如被高优先级轨道打断），也要清标记
        if (activeEntry === trackEntry) {
          activeEntry = null;
          activeSource = null;
        }
      },
      dispose: () => {
        if (activeEntry === trackEntry) {
          activeEntry = null;
          activeSource = null;
        }
      },
      complete: () => {
        if (activeEntry !== trackEntry) {
          return;
        }
        activeEntry = null;
        activeSource = null;
        /**
         * ★ `'queue'` 模式（叠加模式专用）：还有排队的 ⇒ **别混出**，直接接下一条。
         *
         * 为什么走宏任务：此刻正处在 `AnimationState.update()` 的 complete 回调里，
         * 再同步 `addAnimation` 会重入同一条 update。这与"序列 resume 要等一个宏任务"
         * 是同一个理由（见 `trigger` 里的交接保护）。这 0 毫秒的间隔里画面停在上一条的
         * 末帧，紧接着由新动作的 mix 淡入，看不见停顿。
         */
        if (queueTrack === null && pendingQueue.length) {
          const next = pendingQueue.shift() as PendingAction;
          pendingTimer = window.setTimeout(() => {
            pendingTimer = 0;
            playAction(next.animation, 'touch', next.entry);
          }, 0);
          return;
        }

        /**
         * ★ 排队模式：把轨道**交还**给常驻序列 —— 这里绝不能 `clearTrack`，
         * 那条轨道上还挂着序列，清掉会露出 setup pose。
         * 序列收到回调后会走一个宏任务再 `setAnimation(0, 下一条)` 继续。
         */
        if (queueTrack !== null) {
          if (onActionFinished) {
            onActionFinished(TOUCH_MIX_OUT);
          }
          return;
        }

        /**
         * （叠加模式）收尾 = `setEmptyAnimation(2, TOUCH_MIX_OUT)`（★ 2026-09-28 由
         * `clearTrack(2)` 改来，为了同时消灭"一帧突兀变化"与"嘴型/部件卡住"）。
         *
         * ★ 旧注释担心 `setEmptyAnimation` 会留下长期不清的 `<empty>` —— **实测不成立**：
         *   `setEmptyAnimation(2, mix)` 走 `setAnimationWith(2, emptyAnimation, false)`
         *   并把旧 entry 挂成 `mixingFrom`（`AnimationState.ts:658-663`）；混出走完后
         *   `update()` 的 mixingFrom 处理链（:148-157）把它摘掉，下一帧 :142 的清空条件
         *   （`next == null && mixingFrom == null`）随即满足 ⇒ `tracks[2] = null`。
         *   实测三组收尾（clear / empty(0) / empty(0.25)）在 1s 后 track2 **均已清空**
         *   （见 `_regress/61_诊断_动画通道与残留.ts` 的输出）。
         *
         * ★ 为什么必须要"混出"而不是"瞬间清"（两组实测数字见 `TOUCH_MIX_OUT` 注释）：
         *   ① 跳变：clearTrack 那一帧最大骨位移 **154.2** → empty(0.25) **19.2**
         *      （idle 稳态帧间仅 3.7）—— 修掉"回待机时一帧突兀变化"。
         *   ② 残留：clearTrack 后 chat 独占的 5 条通道停在 chat 末帧；`setEmptyAnimation`
         *      的 mix-out 会把它们混回 setup pose（未复位数 4 → 0）—— 修掉"嘴型卡住"。
         *
         * ★ 兜底：这 0.25s 内用户又点击 ⇒ `clearActive()` 的 `clearTrack(2)` 会把
         *   残留的 empty/mixingFrom 链清干净，且 `playAction` 会先 `resetToSetupPose()`。
         */
        state.setEmptyAnimation(TOUCH_TRACK, TOUCH_MIX_OUT);
      },
      event: () => undefined,
    };

    if (onAction) {
      onAction({ source, animation: animationName, entry });
    }
    return true;
  };

  /**
   * 塞进待播槽（叠加模式的 `'queue'` 专用）。超出容量 ⇒ **丢掉最老的**，留最新那条。
   *
   * ⚠️ **返回 false**（`trigger` 的契约是"这次有没有真的播起来"）—— 排进队里的这一下
   *   此刻并没有播；它会在当前这条 `complete` 时另起一次播放（那时才计 `firedCount`）。
   *   若这里返回 true，`playTouch` 会把 `lastPick` 记成"已经播过"，探针读数就骗人了。
   */
  const enqueuePending = (
    animationName: string,
    entry: DialogueEntry | null
  ): boolean => {
    if (pendingQueue.length >= TOUCH_QUEUE_MAX) {
      pendingQueue.shift();
    }
    pendingQueue.push({ animation: animationName, entry });
    return false;
  };

  /**
   * 播一个动作的**唯一闸门**：所有来源都从这里进，打断规则只判一次。
   * 规则本身在 `decideAction`（纯函数，可单测）；这里只负责副作用（计数、`isIdle` 校验）。
   */
  const trigger = (
    entry: DialogueEntry | null,
    source: ActionSource
  ): boolean => {
    const animationName = entry?.animation ?? '';
    if (!animationName) {
      return false;
    }

    const decision = decideAction(
      activeEntry ? activeSource : null,
      source,
      feedbackMode
    );
    if (decision === 'skip') {
      skippedCount++;
      return false;
    }
    if (decision === 'reject') {
      return false;
    }
    /**
     * ★ `'queue'` 的落点：判的是"播放模式"，不是"有没有 interrupting 权限"。
     *
     * · **排队模式**（`queueTrack !== null`）：spine 自己的 track 队列就够了
     *   —— `addAnimation` 天然排在正在播的那条之后，不用我们中介。
     * · **叠加模式**：track 2 上没有队列概念 ⇒ 塞进 `pendingQueue`，
     *   由当前这条的 `complete` 回调接着播（见那里的注释）。
     *
     * ⚠️ 两条路都是"这次不立刻播" ⇒ 返回 false（`playTouch` 据此不记 `lastPick`）。
     */
    if (decision === 'queue') {
      return queueTrack !== null
        ? playAction(animationName, source, entry)
        : enqueuePending(animationName, entry);
    }

    /**
     * 触摸还额外要求 track 0 处于 idle。
     *
     * 闸门只保证"轨道没被动作占着"，但 track 0 可能已经不在 idle 了
     * （例如被模板的 `cursorPress` 机制切到别的常驻动画）。
     * 那种情况下再塞触摸动画，等它播完 `clearTrack(2)` 露出来的是**另一个**常驻动画，
     * 画面会莫名其妙地不回 idle —— 所以这里挡住。
     */
    /**
     * ★ 排队模式下这条判据**不适用**（2026-09-27）。
     *
     * 那时 track 0 上无论是什么（idle / 序列条目 / 我们自己排的问候或触摸）
     * 都由本模块 + 序列共同掌管，"能不能再播一个"完全由上面的闸门决定。
     * 若还留着这条：序列里没配 `greet` 时，问候一播（`greet` 不在 `idleNames` 里）
     * ⇒ 判据恒假 ⇒ **问候期间怎么点都没反应**。
     */
    if (queueTrack === null && source === 'touch' && !isIdle()) {
      skippedCount++;
      return false;
    }

    /**
     * ★ 排队模式的「交接中」保护（2026-09-27）。
     *
     * 动作 `complete` 后 `activeEntry` 立刻置空，但序列要等一个宏任务才
     * `setAnimation` 接管常驻轨道 ⇒ **这一帧里轨道上还挂着上一条已播完的动作**。
     * 此时若放行新动作，它会 `addAnimation` 排在那条后面，随即被序列
     * `setAnimation` 的 `disposeNext` 丢掉 —— 表现为"点了没反应"。
     *
     * 判据直接复用 `idleNames`：轨道上既有内容、偏偏不是常驻动画，
     * 又没有在册的动作 ⇒ 正处在交接窗口，挡住。
     */
    if (queueTrack !== null && source === 'touch' && !activeEntry) {
      const head = state.getCurrent(queueTrack);
      const onTrack = head?.animation?.name ?? '';
      if (onTrack && idleNames.indexOf(onTrack) < 0) {
        skippedCount++;
        return false;
      }
    }

    /**
     * ★ `'immediate'`：没有 a touch-only API 要调 —— 直接落到下面那行即可。
     *
     * 叠加模式下 `clearActive()` 已经先把 track 2 清了 ⇒ `addAnimation` 就是"立刻接手"；
     * 排队模式下它是"排在序列之后"，与该模式改动前的行为一致（见 `playAction` 的注释）。
     */
    return playAction(animationName, source, entry);
  };

  /** 点击热区 → 播一条触摸念白。返回是否真的播了 */
  const playTouch = (): boolean => {
    let entry: DialogueEntry | null = null;
    let animationName = '';

    if (touchPool.length) {
      // 动作与字幕同源：取了哪条就播它的动画、显示它的台词
      entry = pickRandomFromPool(touchPool, random);
      animationName = entry?.animation ?? '';
    } else {
      // 没配字幕池 ⇒ 退回"只随机挑动画名"的老行为
      const i = Math.min(
        touchNames.length - 1,
        Math.max(0, Math.floor(random() * touchNames.length))
      );
      animationName = touchNames[i] ?? '';
    }

    if (!animationName) {
      return false;
    }
    const played = trigger(entry, 'touch');
    if (played) {
      lastPick = animationName;
    }
    return played;
  };

  const onMouseDown = (event: MouseEvent) => {
    // 先判区域：落在热区之外就什么都不做（也算一次"没命中"，便于统计）
    const zone = hitTestZones(
      zones,
      event.clientX,
      event.clientY,
      window.innerWidth,
      window.innerHeight
    );
    lastHitZone = zone ? zone.id : '';
    if (onZoneHit) {
      onZoneHit(zone ? zone.id : null);
    }
    if (!zone) {
      missCount++;
      return;
    }
    playTouch();
  };

  // 用 mousedown 而不是 click：
  //   - 探针已实测 WE 桌面下两者都能收到（`_探针_实验结论.md`）；
  //   - mousedown 响应更跟手（click 要等 mouseup 才算）。
  document.addEventListener('mousedown', onMouseDown, false);

  return {
    dispose: () => {
      document.removeEventListener('mousedown', onMouseDown, false);
      if (pendingTimer) {
        window.clearTimeout(pendingTimer);
        pendingTimer = 0;
      }
      pendingQueue.length = 0;
      clearActive();
    },
    trigger,
    /** 正在播 = 有 track entry；**待播也算忙**（否则 `queue` 模式下双击会被待机 tick 插队） */
    isBusy: () => !!activeEntry || pendingQueue.length > 0,
    playingAnimation: () => activeEntry?.animation?.name ?? '',
    snapshot: () => ({
      idleName,
      touchNames,
      poolSize: touchPool.length,
      /** 与 `isBusy()` 同一口径：待播那条也算"有事在做" */
      busy: !!activeEntry || pendingQueue.length > 0,
      playing: activeEntry?.animation?.name ?? '',
      source: activeSource ?? '',
      firedCount,
      greetCount,
      standbyCount,
      queuedCount: pendingQueue.length,
      skippedCount,
      missCount,
      lastPick,
      lastHitZone,
      zones,
    }),
  };
};
