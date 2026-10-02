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
 * 念白**字幕气泡**（DOM 覆盖层）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 复刻对象：`soulspinecell.prefab` **内嵌**的 `CvUIFrame`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 别用错 prefab。游戏里角色实体挂的是 `soulspinecell.prefab` 里**内嵌**的那份，
 * 不是 `ui/common/cvuiframe.prefab`（独立模板）。两者结构完全不同：
 * 独立模板的 Text 固定 285 宽且带 Outline，内嵌那份是横向 stretch、**无 Outline**。
 *
 * 结构（实测，见 `09_亚砂S9_触摸与语音_解包复核.md` §5-B）：
 *
 * ```
 * CvUIFrame     size=(420,150)
 * └ Talk        UISizeAdapter Min(260,60) ~ Max(1700,750)   ← 气泡本体尺寸区间
 *   ├ Image_02  stretch sizeDelta=(-10,-16)  ← 第二层，内缩后叠加
 *   ├ Image_01  stretch sizeDelta=(0,0)      ← 第一层，满铺
 *   └ Text      sizeDelta=(-50,0) 横向 stretch
 *               白字 FontSize=20 / MiddleLeft / RichText / LineSpacing=1.05
 *               + ContentSizeFitter(纵向 PreferredSize)
 * ```
 *
 * ## 底图为什么是"两层浅色框"
 *
 * sprite = `MainUI_MainUI_Frame_01`，542×66，`m_Border=(L,B,R,T)=(65,25,65,25)`，
 * **RGB 纯黑 + alpha 102/255≈0.400 恒定**。它不是模糊，是"整块均匀的 40% 黑"，
 * 观感上的"毛玻璃"来自把背后画面均匀压暗、降对比。
 *
 * 两层叠加 ⇒ 内区 `1-(1-0.4)² = **0.640**`，而最外圈只有一层 = `0.400`
 * ⇒ 形成"内深外浅"的一圈细边 —— **那圈边就是成品看到的"框"**，不是描边效果。
 * 所以两层都必须画，少一层就没有那圈边。
 *
 * ## 尺寸口径：一切按"视口高 / referenceHeight"等比缩放
 *
 * prefab 里的 20px 字号、260×60、65/25 九宫格都是**游戏 750 高画布**下的值。
 * 壁纸的渲染尺寸随窗口变（全屏适配是"水平锁定 + 垂直自由"），所以统一乘
 * `s = 视口高 / 750`，保证任何窗口尺寸下观感一致。
 *
 * 注：Unity 里 sprite 的 border 是不随 CanvasScaler 缩放的（恒为屏幕像素），
 * 这里**刻意选择等比缩放** —— 目标是复刻"750 高下的观感"，而不是复刻某个分辨率下的像素数。
 *
 * ## 为什么用 DOM 而不是画进 canvas
 *
 * 与 `probeHud.ts` / `touchZoneOverlay.ts` 同一套理由：桌面上看不到 DevTools，
 * 覆盖层用 DOM 写起来最短、改样式最快，且完全不碰 three.js 的渲染循环。
 *
 * 三个必须遵守的既有约定（照抄那两个覆盖层）：
 *   1. `boot()` 等 `document.body` 就绪 —— bundle 可能在 `<head>` 里执行；
 *   2. **`pointer-events:none`** —— 否则会把点击吃掉，你把已验收的触摸热区就废了；
 *   3. z-index 排在热区框之下（2147483645），调试框要能盖住气泡看边界。
 */

import { DialogueEntry, SubtitleConfig } from './config.type';

const CONTAINER_ID = 'spine-voice-bubble';

/**
 * 底图缺省值 = `MainUI_MainUI_Frame_01` 的实测值。
 * 权威仍在 `config.json`，这里只是"少填一个字段也不至于错乱"的兜底。
 */
const DEFAULT_BORDER = { left: 65, bottom: 25, right: 65, top: 25 };
const DEFAULT_REFERENCE_HEIGHT = 750;

/**
 * 中文字体栈。
 *
 * ⚠️ 工程里**没有任何字体文件、也没有 `@font-face`**（全仓库 grep 零命中）。
 * 现有覆盖层的 `Consolas,Menlo,monospace` 是纯英文栈，中文靠系统回退 —— 在
 * WE 的 CEF 里回退结果不可控。所以这里**显式**把中文族排在前面，
 * 免得正文落到某个没有汉字的等宽字体上。
 */
const FONT_STACK = [
  '"Microsoft YaHei"',
  '"微软雅黑"',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Heiti SC"',
  '"SimHei"',
  '"Noto Sans CJK SC"',
  '"Source Han Sans SC"',
  'sans-serif',
].join(',');

export type VoiceBubble = {
  /**
   * 显示一条念白。
   * @param entry 念白条目（文案 + 时长）
   * @param durationSec 停留秒数（= `min(TextTime, 该动画 duration)`，由调用方算）
   */
  show: (entry: DialogueEntry, durationSec: number) => void;
  /** 立即淡出收起（不等自动计时） */
  hide: () => void;
  /** 视口变化后重算比例尺寸（监听 window resize 已在内部挂，外部一般不用调） */
  resize: () => void;
  dispose: () => void;
};

/** 单层黑底的不透明度缺省值 = sprite 实测的 `102/255` */
const DEFAULT_ALPHA = 102 / 255;
/** 圆角半径缺省值（设计单位）= 源图可见面板实测的 `r≈9px` */
const DEFAULT_RADIUS = 9;
/**
 * 框内模糊半径缺省值（**视口 px，恒定**）= σ×2 = `2.1166 × _Size(1.9) × 2`。
 * 依据：`_work_模糊shader/_out/UI_DefaultBlur_模糊算法_定案.md`。
 */
const DEFAULT_BLUR_PX = 8.04;
/**
 * 模糊区域内缩缺省值（设计单位）= **满铺**（2026-09-21 改）。
 *
 * 游戏 `Image_02` 的 `sizeDelta(-10,-16)`（每边内缩 5/8）**不再照抄**：
 * 那圈内缩在游戏里是为了让 `Image_01` 外露的**边框图**不被模糊，而我们的
 * `css` / `png` 两种模式**都没有那圈边框图** ⇒ 内缩只剩"一圈不模糊的黑边"。
 * 详见 `config.type.ts` 的 `SubtitleBlurConfig.inset`。
 */
const DEFAULT_BLUR_INSET = { x: 0, y: 0 };

/* ── `position: "game"` 的换算常量（2026-09-23 新增） ────────────────── */
/**
 * 解包画幅（= 本壁纸的设计画幅 `config.width/height`，也是 1700 宽美术图的原生尺寸）。
 *
 * ⚠️ **不是 UI 的 `CanvasScaler.ref = 1334×750`**：那是 MainUI 画布的参考分辨率，
 * 而 `CvUIFrame` 挂在角色 cell 上、角色活在 1700×750 美术画幅里（08 文档亦提到
 * "1700 宽美术图在 1334 宽画布里"），故偏移量必须按 **1700×750** 归一化。
 *
 * ★ 归一化后即为**固定的视口百分比**：壁纸是"水平锁定 + 垂直自由"自适应画幅，
 * 气泡是屏幕元素，位置应相对画幅**恒定**（不随窗口比例重算世界坐标）。
 */
const GAME_CANVAS = { w: 1700, h: 750 };
/** 可见气泡（Talk 框）底边相对角色锚点的偏移（设计 px，y 向上）。
 *
 *  ★★ 2026-09-23 晚改定：**以用户游戏实录截图实测反推**（1920×864 两次台词框
 *  位置一致：中心 u=0.5461、底边 v=0.1875），不再是解包静态推导值。
 *  - 为何静态推导对不上（2026-09-24 查证，见 10 文档 §7.2）：
 *    ① 垂直差 145px —— `Talk.anchor(0.5,1.0)` 按 prefab 数字推导（"父顶边"）不可靠，
 *       按"父底边"代入才与实测差 5px；
 *    ② 水平差 78px —— **cell 在页面里的摆放**（`SoulSpineCell.anchoredPosition`）
 *       从未解出（09 文档 §9.2："跨页面会变，由页面摆放决定"）。
 *  - ⚠️ 旧推测"`RefreshPos` 运行时再偏移"已排除（反汇编显示 nil 守卫 + 无参调用链）。
 *  换算见 `resolveAnchor`；微调直接改 config 的 `gameOffset`（免重建）。 */
const DEFAULT_GAME_OFFSET = { x: -389.6, y: 8.6 };
/** 角色锚点（Point_Root，画布 434,−243 / 1700×750、cameraX=−33.96）的视口归一化坐标 */
const DEFAULT_CHAR_ANCHOR = { u: 0.7753, v: 0.176 };

/**
 * 由位置预设算出气泡的视口归一化锚点（u = 水平中心、v = **距顶**比例）。
 *
 * ⚠️ **坐标系约定（踩过坑）**：`charAnchor` / `gameOffset` 用**距底为正**的几何直觉
 * （与画布 `Point_Root(434,−243)` 的 y 同向），而 `frame` 消费的 `anchorV` 是
 * **距顶比例**（历史口径：`frame.style.bottom = (1 − anchorV)·100%`）。
 * ⇒ `game` 分支必须做**一次翻转**，否则气泡会跑到画面上半部（实测过）。
 *
 * - `game`：角色锚点 + 实测偏移（都按各自画布归一化），再翻成距顶比例；
 * - `bottom`：底部居中（底边距底 10% ⇒ anchorV=0.9）；
 * - `custom` / 未知值：`anchorU` / `anchorV`（改动前的行为）。
 *
 * 独立导出：验证脚本直接调它对账，不必从 DOM 反推。
 */
export const resolveAnchor = (style: {
  position: 'game' | 'bottom' | 'custom';
  anchorU: number;
  anchorV: number;
  bottomMargin: number;
  gameOffset: { x: number; y: number };
  charAnchor: { u: number; v: number };
}): { u: number; v: number } => {
  if (style.position === 'game') {
    const vFromBottom = style.charAnchor.v + style.gameOffset.y / GAME_CANVAS.h;
    return {
      u: style.charAnchor.u + style.gameOffset.x / GAME_CANVAS.w,
      v: 1 - vFromBottom,
    };
  }
  if (style.position === 'bottom') {
    // 底部居中：水平居中(u=0.5)，底边距底 = bottomMargin ⇒ anchorV = 1 - bottomMargin
    return { u: 0.5, v: 1 - style.bottomMargin };
  }
  return { u: style.anchorU, v: style.anchorV };
};

/** 把 config 里的可选项回填成完整样式 */
const resolveStyle = (cfg?: SubtitleConfig) => ({
  /**
   * 背景皮肤模式。缺省 `css-layered`（大视口/多行观感更好，性能与 PNG 版实测一致）。
   */
  /**
   * 归一化模式名。旧的 `-layered` 后缀**已名不副实**（气泡是单层，见 `alpha` 注释），
   * 但配置里可能还写着旧值，所以映射过来。
   */
  skinMode: ((cfg?.skin?.mode ?? 'css').replace('-layered', '') || 'css') as
    | 'css'
    | 'png',
  image: (cfg?.skin?.image ?? cfg?.image) as string,
  border: {
    left: cfg?.skin?.border?.left ?? cfg?.border?.left ?? DEFAULT_BORDER.left,
    bottom: cfg?.skin?.border?.bottom ?? cfg?.border?.bottom ?? DEFAULT_BORDER.bottom,
    right: cfg?.skin?.border?.right ?? cfg?.border?.right ?? DEFAULT_BORDER.right,
    top: cfg?.skin?.border?.top ?? cfg?.border?.top ?? DEFAULT_BORDER.top,
  },
  /** 暗化层的单层不透明度（**不是**"每层 0.4、叠起来 0.64"） */
  alpha:
    cfg?.skin?.alpha ??
    (cfg?.skin as { layerAlpha?: number })?.layerAlpha ??
    DEFAULT_ALPHA,
  radius: cfg?.skin?.radius ?? DEFAULT_RADIUS,
  /** 框内模糊（对应游戏 `Image_02` 的 `UI-Default-Blur`） */
  blur: {
    enabled: cfg?.skin?.blur?.enabled !== false,
    radiusPx: cfg?.skin?.blur?.radiusPx ?? DEFAULT_BLUR_PX,
    inset: {
      x:
        cfg?.skin?.blur?.inset?.x ??
        (cfg?.skin as { innerInset?: { x: number } })?.innerInset?.x ??
        (cfg?.innerInset as { x: number })?.x ??
        DEFAULT_BLUR_INSET.x,
      y:
        cfg?.skin?.blur?.inset?.y ??
        (cfg?.skin as { innerInset?: { y: number } })?.innerInset?.y ??
        (cfg?.innerInset as { y: number })?.y ??
        DEFAULT_BLUR_INSET.y,
    },
  },
  /** 气泡水平中心（视口归一化）。⚠️ 仅 `position:"custom"`（缺省）时生效 */
  anchorU: cfg?.anchorU ?? 0.5,
  /** 气泡**底边**的垂直位置（视口归一化）。⚠️ 仅 `position:"custom"`（缺省）时生效 */
  anchorV: cfg?.anchorV ?? 0.9,
  /** 位置预设：`game`（解包固定位置）/ `bottom`（底部居中）/ `custom`（anchorU/V）。
   *  缺省 `custom` = 旧行为；本包 config.json 显式配 `game`。 */
  position: (cfg?.position ?? 'custom') as 'game' | 'bottom' | 'custom',
  gameOffset: {
    x: cfg?.gameOffset?.x ?? DEFAULT_GAME_OFFSET.x,
    y: cfg?.gameOffset?.y ?? DEFAULT_GAME_OFFSET.y,
  },
  charAnchor: {
    u: cfg?.charAnchor?.u ?? DEFAULT_CHAR_ANCHOR.u,
    v: cfg?.charAnchor?.v ?? DEFAULT_CHAR_ANCHOR.v,
  },
  /**
   * 换行阈值算法。`mode` 缺省 `viewport`（= 旧行为）。
   * `viewportRatio` 兼容旧的顶层 `maxWidthRatio`（已被 `wrap` 取代）。
   */
  wrap: {
    mode: cfg?.wrap?.mode ?? 'viewport',
    viewportRatio: cfg?.wrap?.viewportRatio ?? cfg?.maxWidthRatio ?? 0.72,
    designWidth: cfg?.wrap?.designWidth ?? 210,
    maxViewportRatio: cfg?.wrap?.maxViewportRatio ?? 1.0,
  },
  minWidth: cfg?.minWidth ?? 260,
  minHeight: cfg?.minHeight ?? 60,
  fontSize: cfg?.fontSize ?? 20,
  lineSpacing: cfg?.lineSpacing ?? 1.05,
  paddingX: cfg?.paddingX ?? 25,
  /** 文字上下内边距（设计单位）。补上多行文本上下留白，缺省 20 */
  paddingY: cfg?.paddingY ?? 20,
  /** 文字水平对齐；bottom 模式在 resize 里强制 center，其余按本值（缺省 left） */
  textAlign: (cfg?.textAlign ?? 'left') as 'left' | 'center',
  /**
   * 底部字幕条的**最大**宽度占视口比例（仅 position:'bottom' 生效，缺省 0.9）。
   * 宽度本身跟随文本（fit-content）；仅当文本超过该比例才折行。
   */
  bottomWidthRatio: cfg?.bottomWidthRatio ?? 0.9,
  /** 底部字幕条底边距屏幕底部比例（仅 position:'bottom' 生效，缺省 0.1） */
  bottomMargin: cfg?.bottomMargin ?? 0.1,
  fadeMs: cfg?.fadeMs ?? 260,
  referenceHeight: cfg?.referenceHeight ?? DEFAULT_REFERENCE_HEIGHT,
});

/**
 * 创建字幕气泡。
 *
 * @returns 未启用（`enabled:false`）或没配底图时返回 `null` —— 调用方判空即可，
 *          这样"只播动作不出字幕"是一个**配置状态**，不需要在业务代码里分支。
 */
export const createVoiceBubble = (
  cfg?: SubtitleConfig
): VoiceBubble | null => {
  const style = resolveStyle(cfg);

  if (cfg?.enabled === false) {
    return null;
  }
  if (!style.image) {
    console.warn(
      '[subtitle] config.json 缺少 subtitle.image ⇒ 字幕气泡未启用（动作仍会正常播放）'
    );
    return null;
  }

  /** 底图 URL（相对 index.html，因为 bundle 与 assets 同级部署） */
  const imageUrl = './assets/' + style.image;

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:100%',
    'height:100%',
    'margin:0',
    // 比热区调试框(2147483645)低一层：调试时要能看清气泡在热区里的位置
    'z-index:2147483640',
    'pointer-events:none',
    'user-select:none',
  ].join(';');

  /** 外层：负责定位与尺寸（尺寸由文本撑开） */
  const frame = document.createElement('div');
  // ★ 锚点：blur/content/skin/text 都有 `data-wb-layer`，唯独 frame 缺——
  //   验证脚本统一用该属性取层（禁用下标取数），补上保持一致。
  frame.setAttribute('data-wb-layer', 'frame');
  frame.style.cssText = [
    'position:absolute',
    'display:flex',
    'align-items:center',
    'box-sizing:border-box',
    'width:fit-content',
    /**
     * ⚠️ **`frame` 上不设任何 `opacity`**（连初始 `0` 都不要）—— 踩过两次：
     *
     * 1. 上一版给它做了 `opacity 0→1` 的淡入 ⇒ `opacity<1` 期间被提升为合成层
     *    ⇒ 后代 `backdrop-filter` 采样不到层外画面 ⇒ **前 ~0.2s 无模糊**；
     * 2. 改成"初始 `opacity:0`、淡入交给 `contentGroup`"后，**忘了在 `show()` 里
     *    把它置回 `1`** ⇒ 整棵子树（含模糊层和文字）**永远透明** ⇒ 用户报"文本框不见了"。
     *
     * ⇒ 结论：**`frame` 的可见性一律交给 `visibility`**（初始 `hidden` 已经够用，
     * 首帧不会闪空框），`opacity` 完全不碰。淡入淡出统一由 `contentGroup` 承担。
     *
     * 这样也彻底消除了"忘记置回"这一类 bug —— 因为根本没有可忘记的状态。
     *
     * ⚠️ 另外**不要加 `will-change:opacity`** —— 实测它会让后代 `backdrop-filter` **完全失效**。
     *
     * 单变量对照（同一位置切换"模糊开/关"的底色高频比，越小越模糊）：
     *
     * | 用例 | 比值 | 结果 |
     * |---|---|---|
     * | `transform` + `will-change:opacity`（原实现） | 1.000 | **完全无模糊** |
     * | **只去掉 `will-change`**（保留 `transform`） | **0.557** | 模糊生效 |
     * | 再去掉 `transform` | 0.618 | 模糊生效 |
     *
     * 机制：`will-change: opacity` 会把元素提升为**独立合成层**，
     * 后代的 `backdrop-filter` 于是**采样不到层外的画面**（没有可模糊的 backdrop）。
     *
     * 顺带排除的两个嫌疑（都**不是**原因，各做过单变量验证）：
     * - `transform: translateX(-50%)`：单独去掉它，比值仍是 1.000；
     * - 环境不支持：把 `backdrop-filter` 挂到 `body` 直属元素上，比值 **0.122**（效果很强）。
     *
     * ★ 上面第 1 条与这条是**同一族问题**：前者是**静态**提升（`will-change` 常驻），
     * 后者是**动态**提升（过渡期间 `opacity<1`）。两者都让 `backdrop-filter` 失效，
     * 解法都是"别让祖先进入被提升的状态"。
     */
    'visibility:hidden',
    'pointer-events:none',
  ].join(';');

  const isPngSkin = style.skinMode === 'png';

  /**
   * 皮肤图层工厂（两种实现共用同一个 DOM 结构，只换"怎么画"）。
   *
   * ## PNG 模式：九宫格 `border-image`
   *
   * 用**真实 border**（而不是 `border-width:0` + 独立 `border-image-width`）承载底图：
   * 后者虽然能让边框图像溢出到内容区，但各家浏览器行为不完全一致；
   * 用真实 border 后，边框区就是 `65/25 × s`，行为确定。
   *
   * 代价是文本层会被挤到边框内侧 —— 但 Unity 里文字本来就在边框区内
   * （Text 距气泡左边缘 25px < 边框 65px），所以这里让文本层改用绝对定位 +
   * 自己控制 `paddingX`，反而更贴近原实现。
   *
   * ## CSS 模式：纯色 + `border-radius`（2026-09-20 新增，缺省）
   *
   * ★ **必须去掉 `border-image` 才能拿到圆角** —— 实测给九宫格层加
   * `border-radius:40px`，`getComputedStyle` 报 40px，但左上角逐像素 alpha 全 255、
   * **没有任何圆角切口**（规范：border-image 在 border box 绘制，会盖掉圆角）。
   *
   * ⚠️ 这个工厂**只画"暗化层"**（一层均匀 `alpha` 黑）。"框内模糊"由 `blurLayer` 负责。
   * 早期版本这里画的是**两层**暗化（内区 0.64），**依据已被推翻** —— 见 `alpha` 的注释。
   */
  const createSkinLayer = (): HTMLDivElement => {
    const layer = document.createElement('div');
    /**
     * ★ 稳定锚点：验证脚本靠它取层，**不要**改成"按 children 下标取" ——
     * 2026-09-21 引入 `contentGroup` 时，`_work_语音动作/` 下多个脚本因
     * "固定下标 / lastElementChild"假设过期而集体报错（`lineHeight=normal`、
     * `nLayers` 算错）。给每层一个 `data-wb-layer` 后，重构 DOM 不再影响脚本。
     */
    layer.setAttribute('data-wb-layer', 'skin');
    if (isPngSkin) {
      layer.style.cssText = [
        'position:absolute',
        'box-sizing:border-box',
        'border-style:solid',
        'border-color:transparent',
        'border-image-source:url("' + imageUrl + '")',
        // 顺序 = CSS 的 top right bottom left；源头 Unity m_Border 是 (L,B,R,T)
        'border-image-slice:' +
          [
            style.border.top,
            style.border.right,
            style.border.bottom,
            style.border.left,
          ].join(' ') +
          ' fill',
        'border-image-repeat:stretch',
        'pointer-events:none',
      ].join(';');
    } else {
      /**
       * CSS 模式：**一个 `alpha` 的实心圆角矩形**，不设任何 border。
       *
       * 刻意**不设** `border-image-*`：实测 `border-image` 会让 `border-radius` 被静默忽略。
       * 也刻意**不设** `border` 承载"外圈" —— `background-clip` 默认是 `border-box`，
       * background 会铺到 border 区域**下面**，两者叠加会让那圈变成 `1-(1-a)²`。
       * （早期版本就踩过：读数 `外圈 0.635 / 内区 0.376`。）
       */
      layer.style.cssText = [
        'position:absolute',
        'box-sizing:border-box',
        'background-color:rgba(0,0,0,' + style.alpha + ')',
        'pointer-events:none',
      ].join(';');
    }
    return layer;
  };

  /**
   * 暗化层：**满铺一层**（`alpha` 均匀）。
   *
   * ⚠️ 只有这一层暗化。游戏实测内外 alpha 都是 ≈0.40（**无台阶**）——
   * "内外分界"是"清晰/模糊"的边界，由下面的 `blurLayer` 提供，**不是**深浅边界。
   */
  const skinOuter = createSkinLayer();
  skinOuter.style.left = '0';
  skinOuter.style.top = '0';
  skinOuter.style.right = '0';
  skinOuter.style.bottom = '0';

  /**
   * 模糊层：对应游戏 `Image_02`（材质 `UI-Default-Blur`）。
   *
   * 用 `backdrop-filter: blur(...)` —— 它模糊的是**这个元素背后的画面**
   * （= 角色/背景），正是游戏里 GrabPass 取屏幕再模糊的等价物。
   *
   * 两个要点：
   * 1. **只模糊、不暗化** —— `backdrop-filter` 不带任何染色，
   *    所以它**不会**制造"第二个更暗的矩形"（这正是早期把它误判成"第二层黑"的原因）。
   * 2. **半径恒定（视口 px）** —— 见 `SubtitleBlurConfig` 的注释。
   *
   * 放在暗化层**之下**（DOM 顺序在前）以复刻游戏绘制顺序
   * `[0] Image_02(blur) → [1] Image_01(黑0.4) → [2] Text`：
   * 这样文字在两层之上（**不被压暗**，与游戏实测 `a=0.004` 吻合）。
   */
  const blurLayer = document.createElement('div');
  blurLayer.setAttribute('data-wb-layer', 'blur');
  blurLayer.style.cssText = [
    'position:absolute',
    'box-sizing:border-box',
    'pointer-events:none',
  ].join(';');

  const text = document.createElement('div');
  text.setAttribute('data-wb-layer', 'text');
  text.style.cssText = [
    'position:relative', // 保证绘制在 blur / skin 之上（同 z-index 时按 DOM 顺序，这里双保险）
    'z-index:1',
    'box-sizing:border-box',
    'color:#ffffff',
    'text-align:left',
    'white-space:pre-wrap',
    'word-break:break-word',
    'font-family:' + FONT_STACK,
    'pointer-events:none',
  ].join(';');

  /**
   * 内容组：**暗化层 + 文字**，也是**淡入淡出的载体**。
   *
   * ⚠️ 为什么需要这一层：淡入**不能**加在 `frame` 上（会让 `opacity<1` 的祖先
   * 把模糊层的 `backdrop-filter` 干掉，见 `show()` 的注释），所以下沉到这一层。
   *
   * 结构（`frame` 的子节点顺序，也是绘制顺序）：
   * ```
   * frame              opacity 恒为 1（★ 不设、不过渡）
   * ├ blurLayer        模糊层，全程 opacity:1 ⇒ 模糊零延迟
   * └ contentGroup     ← 淡入淡出在这一层
   *   ├ skinOuter      暗化层（0.40 黑）
   *   └ text           文字
   * ```
   *
   * ★ `contentGroup` 自身会被 `opacity<1` 提升为合成层，但**它内部没有 `backdrop-filter`**
   * （模糊层是它的**兄弟**，且 DOM 顺序在前）⇒ 无害。
   * 判据：`backdrop-filter` 只关心**自己到根之间**有没有被提升的祖先。
   */
  const contentGroup = document.createElement('div');
  contentGroup.setAttribute('data-wb-layer', 'content');
  contentGroup.style.cssText = [
    /**
     * ★ **必须 `position:relative`，不能用 `absolute`**（踩过，2026-09-21）。
     *
     * `frame` 是 `width:fit-content`，尺寸**靠内容撑开**。若把内容放进一个
     * `position:absolute; inset:0` 的组里，那个组**不参与** `frame` 的尺寸计算
     * ⇒ `frame` 宽度塌成 0 ⇒ 组也是 0 ⇒ **文字被裁没**（用户报的"文本框不见了"）。
     * 这是循环依赖：`frame` 要内容撑开，内容却被放进了不撑开的外层。
     *
     * 用 `relative` 后：组**在流内**（撑开 `frame`），同时**建立了定位上下文**
     * ⇒ 内部的 `skinOuter`（`inset:0`）能正确满铺到组尺寸。
     */
    'position:relative',
    /**
     * ★ `width:fit-content` **必须加**（踩过，2026-09-21）。
     *
     * `contentGroup` 是 flex item，缺省 `flex-basis:auto` + `width:auto`
     * ⇒ 在 flex 容器里会**伸展到可用宽度**（实测塌成 `frame.maxWidth` = 1472，
     * 而正确值是按文字撑开的 ~501）⇒ 灰底比文字宽一大截。
     *
     * 加了 `fit-content` 才复刻"`text` 直接当 flex item 时收缩到内容宽"的行为。
     */
    'width:fit-content',
    /**
     * ★ `align-self:stretch` **必须加**（踩过，2026-09-21）。
     *
     * `frame` 是 `display:flex; align-items:center`，而 `frame` 的高度**可能大于内容**
     * —— 来自 `min-height: 60×s`（短文案时就是这种情况）。
     * 缺省 `align-items:center` 会让 `contentGroup` **只按内容高居中**，
     * 于是组内的 `skinOuter`（`inset:0`）也跟着只有内容那么高
     * ⇒ **灰底比模糊层矮一截**（实测：`frame`/`blur` 高 46，`skin` 只有 16）。
     *
     * `stretch` 让组**纵向拉满 `frame`**，与 `blurLayer` 的 `inset:0` 对齐。
     * 宽度仍由 `fit-content` 决定 —— 两者互不冲突。
     */
    'align-self:stretch',
    /**
     * 与 `frame` 同款布局：`frame` 是 `display:flex; align-items:center`，
     * 这里必须**跟 `frame` 一样**把文字垂直居中。
     * （`skinOuter` 是 `absolute`，不参与 flex 排版，不影响这里。）
     */
    'display:flex',
    'align-items:center',
    'box-sizing:border-box',
    // 初始全透明：与 frame 的 opacity:0 配合，保证首帧不可见（见下方 frame 注释）
    'opacity:0',
  ].join(';');

  // 顺序 = 游戏绘制顺序：[0] 模糊层 →（组内）[1] 暗化层 → [2] 文字
  if (style.blur.enabled) {
    frame.appendChild(blurLayer);
  }
  contentGroup.appendChild(skinOuter);
  contentGroup.appendChild(text);
  frame.appendChild(contentGroup);
  container.appendChild(frame);

  /** 自动收起计时器（重复 show 要清掉旧的，否则会提前收起新内容） */
  let hideTimer: number | null = null;
  /** 复用的淡出收尾计时器 */
  let fadeTimer: number | null = null;

  const clearTimers = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (fadeTimer !== null) {
      window.clearTimeout(fadeTimer);
      fadeTimer = null;
    }
  };

  /**
   * 按当前视口重算所有比例尺寸。
   *
   * ## ★ 两套基准：字号跟高度、换行阈值跟宽度（这是有意的，但要知其代价）
   *
   * | 量 | 基准 | 为什么 |
   * |---|---|---|
   * | 字号 / 内边距 / 九宫格 border / 最小尺寸 | `视口高 / 750` | 复刻"设计画幅下的观感"——观感大小应由**画面缩放**决定 |
   * | `max-width`（决定**何时换行**） | `视口宽 × maxWidthRatio` | 气泡是屏幕元素，不该超出屏幕 |
   *
   * 而本工程的全屏适配是**「水平锁定」**：画面的 `像素/世界` **只与窗口宽度成正比**。
   * ⇒ 字号跟着高度走、换行阈值跟着宽度走，两者**不同步**。
   *
   * **实测代价**（`_work_语音动作/08_测量_字幕换行阈值.py`）：
   * 单行可容字数在 **24 ~ 61 字**之间波动（2.5 倍）。设计画幅 58 字、WE 实机 35 字、
   * 窄屏只有 24 字 ⇒ 窄屏下 10 条念白有 **5 条**会变成 2 行。
   *
   * 这是"文字大小跟画面走"的必然结果（等同于画面放大时字也放大、能放的字自然变少）。
   * 换行本身是**正确工作**的（气泡撑高、九宫格不变形），只是观感随图幅变化较大。
   */
  const resize = () => {
    const s = window.innerHeight / style.referenceHeight;

    // ── 位置（百分比 → 任何窗口比例下都稳定） ──
    // 预设换算放 resize 里（而不是构造时算死）：坐标是百分比，窗口比例变化不影响
    // 归一化值，但集中在这里与其它几何量同源、好排查。
    const anchor = resolveAnchor(style);
    frame.style.left = anchor.u * 100 + '%';
    frame.style.bottom = (1 - anchor.v) * 100 + '%';
    frame.style.transform = 'translateX(-50%)';

    // ── 尺寸（设计单位 × s） ──
    frame.style.minWidth = style.minWidth * s + 'px';
    frame.style.minHeight = style.minHeight * s + 'px';
    /**
     * 换行阈值（`max-width`）—— 两种模式，由 `subtitle.wrap.mode` 选。
     *
     * ★ **不要再拿"视口高"去夹这个上限**（我加过一次，是错的，已回退）。
     *
     * 当时的（错误）推理：极端宽高比下字号极小、一行能塞几百字，气泡会拉满整屏。
     * 错在哪：`frame` 是 **`width: fit-content`** —— 气泡宽度**由内容决定**，
     * `max-width` 只是"超过就换行"的阈值，**不会**把短内容撑到上限。
     * 所以 1920×200 那种条带视口里，42 字在 5.33px 下只有约 224px 宽，
     * 气泡就是 224px，根本不会拉满。**这个"极端情况"不存在。**
     *
     * 而用 `min(0.72×宽, 0.9×高)` 反而**制造了真实回归**：
     * 正常图幅下 `0.9×高` 恒小于 `0.72×宽`（如 16:9：833 < 1366）
     * ⇒ 阈值被腰斩、换行暴增。实测单行字数从 58/42/52/35/55
     * **一律塌成 31**，10 条念白里 2 条变成换行。
     *
     * 教训：改一个"上限"之前，先确认它作用的对象是不是会被内容撑开。
     *
     * ── 两种模式 ──
     * `viewport`：阈值 ∝ 视口宽 ⇒ 换行位置随图幅变（单行字数 ∝ aspect，实测 24~61）。
     * `game`    ：阈值 = `(designWidth + 2×paddingX) × s`
     *             ⇒ **单行字数恒定**，且与字号**同源缩放**（等价于游戏 CanvasScaler：
     *             屏幕变大时框和字一起放大，每行字数不变）。
     *             ★ `designWidth` 是**文字区宽**（游戏 `Talk 260 − Text 左右各 25 = 210`），
     *             而 frame 的 `max-width` 约束的是**框宽** ⇒ 必须补回左右 padding。
     *             ⚠️ 2026-09-23 修：原来直接写 `designWidth × s`（=242px）会被
     *             `min-width:260×s`（=300px）压制，**game 模式下永不换行**（实测单行 21 字）。
     */
    const fontPx = style.fontSize * s;
    const maxByWrap =
      style.wrap.mode === 'game'
        ? (style.wrap.designWidth + 2 * style.paddingX) * s
        : window.innerWidth * style.wrap.viewportRatio;
    // 兜底：不允许超出视口宽的 maxViewportRatio（缺省 1.0 = 不裁）
    const hardCap = window.innerWidth * style.wrap.maxViewportRatio;
    frame.style.maxWidth = Math.min(maxByWrap, hardCap) + 'px';

    // ── 暗化层几何 ──
    if (isPngSkin) {
      // PNG 模式：border 宽 = 九宫格切片（源图像素 × s），sprite 自带"黑 + alpha 102"
      skinOuter.style.borderWidth = [
        style.border.top * s,
        style.border.right * s,
        style.border.bottom * s,
        style.border.left * s,
      ]
        .map((v) => v + 'px')
        .join(' ');
    } else {
      skinOuter.style.borderWidth = '0';
      skinOuter.style.borderRadius = style.radius * s + 'px';
    }

    // ── 模糊层几何 ──
    /**
     * `inset` 为 0（缺省）⇒ **满铺**，与暗化层完全重合。
     * 此时**不能**靠 `left/right/top/bottom = 0` 来铺——因为 `blurLayer` 在 DOM 里是
     * `position:absolute` 且**没有**显式的宽高，只设 4 个 0 在部分引擎下依赖
     * "static position 兜底"，不如直接明确写满。非 0 时才走内缩分支。
     */
    if (style.blur.enabled) {
      const ix = style.blur.inset.x * s;
      const iy = style.blur.inset.y * s;
      const insetAll = style.blur.inset.x === 0 && style.blur.inset.y === 0;
      if (insetAll) {
        blurLayer.style.left = '0';
        blurLayer.style.right = '0';
        blurLayer.style.top = '0';
        blurLayer.style.bottom = '0';
      } else {
        blurLayer.style.left = ix + 'px';
        blurLayer.style.right = ix + 'px';
        blurLayer.style.top = iy + 'px';
        blurLayer.style.bottom = iy + 'px';
      }
      /**
       * ★ 半径**不乘 s** —— 它是**恒定的视口像素数**。
       *
       * 依据：游戏的 GrabPass RT = 屏幕（视口）分辨率，采样偏移 = `k × _Size × TexelSize`
       * ⇒ 与 Image 尺寸、与画布缩放都无关。早期文档写的 `blur(8.04 × 视口高/750)`
       * 是**方向反了**（1600 高会算出 17px，偏大 2.1 倍）。
       */
      blurLayer.style.backdropFilter = 'blur(' + style.blur.radiusPx + 'px)';
      // Safari / 旧 WebKit 前缀（CEF 用不上，但加上无害）
      (blurLayer.style as unknown as { webkitBackdropFilter?: string })
        .webkitBackdropFilter = 'blur(' + style.blur.radiusPx + 'px)';
      // 圆角与暗化层同源；若配了内缩，则要小一圈，否则四角会与外层错开露缝
      blurLayer.style.borderRadius =
        Math.max(0, (style.radius - style.blur.inset.y) * s) + 'px';
    }

    // ── 文本（字号用上面已算好的 fontPx，保证与换行阈值同源） ──
    text.style.fontSize = fontPx + 'px';
    text.style.lineHeight = String(style.lineSpacing);
    // ★ 上下 + 左右都给 padding：早期只给左右、上下写死 0 ⇒ 多行文本贴边。
    text.style.padding =
      style.paddingY * s + 'px ' + style.paddingX * s + 'px';
    // 水平对齐：bottom（字幕条）强制居中，其余按 textAlign
    text.style.textAlign =
      style.position === 'bottom' ? 'center' : style.textAlign;

    // ── 气泡宽度模式 ──
    /**
     * 宽度一律**跟随文本**：`frame` / `contentGroup` 在 cssText 里已是 `fit-content`、
     * `text` 不设宽度 ⇒ 气泡随文本量伸缩。两种位置模式的差别只在
     * **max-width（折行上限）**：
     * - `bottom`（字幕条）：上限 = `bottomWidthRatio × 视口宽`。⚠️ 该值是**最大宽**，
     *   不是固定宽 —— 2026-09-25 早版曾把宽度**锁成** 90% 视口宽（`width:90%` +
     *   `contentGroup/text: 100%`），短文本两侧大片空白，用户要求改回自适应。
     *   也因此**不能**沿用上方的 game 换行阈值 maxByWrap（那对本模式太窄，
     *   会把长文折成窄高列 —— 字幕条要的正是"长文先尽量排长、再折行"）。
     * - `game` / `custom`：上限 = 换行阈值 maxByWrap（上方已设，无需再动）。
     */
    if (style.position === 'bottom') {
      frame.style.maxWidth =
        Math.min(style.bottomWidthRatio * window.innerWidth, hardCap) + 'px';
    }
  };

  // 先按当前视口算一次；窗口变化时重算（WE 里窗口尺寸变化会走到这里）
  resize();
  window.addEventListener('resize', resize, false);

  const hide = () => {
    clearTimers();
    /**
     * ⚠️ **只淡出 `contentGroup`，绝不碰 `frame` 的 `opacity`** ——
     * 见 `show()` 顶部的长注释（`opacity < 1` 的祖先会让 `backdrop-filter` 失效）。
     *
     * `frame` 的 `visibility` 仍要等到淡出走完再置 `hidden`（避免占位 / 避免
     * "淡出途中还能被读到"）；模糊层全程 `opacity:1`，所以模糊是**瞬间**消失的。
     */
    contentGroup.style.opacity = '0';
    // 过渡结束后再隐藏，避免"淡出途中还能被读到"以及占位
    fadeTimer = window.setTimeout(() => {
      frame.style.visibility = 'hidden';
      fadeTimer = null;
    }, style.fadeMs);
  };

  const show = (entry: DialogueEntry, durationSec: number) => {
    if (!entry?.text) {
      return;
    }
    clearTimers();
    /**
     * ═══════════════════════════════════════════════════════════════════════
     * ★★ 这里**绝对不能**给 `frame` 设 `opacity` 过渡（踩过，2026-09-21）
     * ═══════════════════════════════════════════════════════════════════════
     *
     * ## 症状
     *
     * 用户验收报：气泡出现后**约 0.2s 内没有模糊**，之后模糊才生效。
     *
     * ## 根因
     *
     * Chromium 对 `opacity < 1` 的元素会做**合成层提升**（提升才能整体叠加透明度）。
     * 一旦 `frame` 处于"被提升"的状态，后代的 `backdrop-filter` 就**采样不到层外的画面**
     * —— 也就是**没有可模糊的 backdrop**，模糊被静默跳过。
     *
     * 而 `opacity` 从 0 → 1 的 260ms 淡入**全程**都在 `opacity < 1` 状态！
     * ⇒ 淡入期间无模糊，等过渡结束、`opacity` 稳定为 1、提升被撤销，模糊才出现。
     * 时间尺度正好是 `fadeMs`（260ms ≈ 用户说的"约 0.2s"）。
     *
     * ## 定位过程（单变量对照，`fadeMs` 改 0 即复现/消失）
     *
     * | `fadeMs` | 现象 |
     * |---|---|
     * | 260（原值） | 前 ~0.2s 无模糊，之后有 ⇒ **淡入触发** |
     * | **0** | 空白**消失**，第一帧就有模糊 |
     *
     * ⇒ 与"合成层建立开销 / 首次采样代价"无关，**是一种状态相关**的失效。
     *
     * ★ 与 `frame` 上曾经的 `will-change:opacity` 是**同一族问题**
     * （静态提升 vs 动态提升），那次的正解是删掉 `will-change`，这次是"别让祖先进入 `opacity<1`"。
     *
     * ## 解法：把淡入下沉到 `contentGroup`
     *
     * `frame` 的 `opacity` **恒为 1**（不设、不过渡）⇒ 不触发提升 ⇒ 模糊全程有效。
     * 淡入交给 `contentGroup`（暗化层 + 文字）：
     *
     * - 模糊层**全程 `opacity:1`** ⇒ 气泡轮廓**瞬间**出现（毛玻璃是"背景采样器"，
     *   第一帧就在是自然的）；
     * - 灰底 + 文字走 260ms 淡入。
     *
     * 观感 = "毛玻璃先出现 → 灰底和字浮现"。这是**有意选定的视觉取舍**：
     * 换来"模糊零延迟"，代价是失去"整体渐显"。
     *
     * ⚠️ 别忘了 `contentGroup` 也是个有 `opacity` 过渡的元素 —— 它会不会也触发提升？
     * 会，但**它里面没有 `backdrop-filter`**（模糊层是它的**兄弟**），所以无害。
     * 判据：`backdrop-filter` 只关心**自己到根之间**有没有被提升的祖先。
     */
    // 直接替换文案：Unity 也是同一个 Text 换字符串，没有排队
    text.textContent = entry.text;
    frame.style.visibility = 'visible';
    // 强制一次重排后再设 opacity，保证"已在显示中再 show"也能有过渡
    void frame.offsetHeight;
    contentGroup.style.transition = 'opacity ' + style.fadeMs + 'ms ease';
    contentGroup.style.opacity = '1';

    const ms = Math.max(0, durationSec) * 1000;
    if (ms > 0) {
      hideTimer = window.setTimeout(() => {
        hideTimer = null;
        hide();
      }, ms);
    }
  };

  const boot = () => {
    if (!document.body) {
      // 脚本在 <head> 里执行时 body 还不存在，等下一帧（同 touchZoneOverlay.ts）
      requestAnimationFrame(boot);
      return;
    }
    document.body.appendChild(container);
  };
  boot();

  return {
    show,
    hide,
    resize,
    dispose: () => {
      clearTimers();
      window.removeEventListener('resize', resize, false);
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
};
