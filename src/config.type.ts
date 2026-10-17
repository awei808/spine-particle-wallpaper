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

export type Configs = {
  width: number;
  height: number;
  /**
   * 垂直 FOV（度）。缺省 75（模板原值）。
   *
   * ★ 它同时决定「世界单位 → 屏幕像素」的换算（`k(z) = SCREEN_H / (2|z|·tan(FOV/2))`），
   *   因此**必须与 config 里各 mesh 的 width/height/position 配套** —— 单独改画幅
   *   （width/height）而不改 FOV，等于只把视野横向撑大，背景层不够宽就会露黑边。
   *
   * 1700×750 探针口径取 **59.255924**：由三个「铺满层」的世界宽度反推 ——
   * `_12` 的 width(=3918.89) 恰等于 z=-1520 平面的可见宽度，解 `tan(FOV/2)=0.568729`。
   */
  fov?: number;
  /**
   * 相机沿 x 的平移（世界单位）。缺省 0。
   *
   * 探针口径取 **-33.96**：与 config 里的 `org_x = -31.2834`（= cameraX / k(z_12)）配对，
   * 效果是让大层 `_12` 落到画面正中（消掉右侧残余黑边）。两者是同一取景动作的两半，
   * **不能只改一边**（只改这边 = 整层横移 |cameraX|·k(z) 个像素）。
   */
  cameraX?: number;
  /**
   * 渲染缓冲倍率。缺省 1.0。
   *
   * - **数字**：直接用。`canvas backing = 视口 CSS px × 本值`。
   * - **`"auto"`**：跟随屏幕 DPI —— 取 `window.devicePixelRatio` 并夹到 `[1, 2]`。
   *
   * ★ 为什么需要 `"auto"`：WE 的网页壁纸走 CEF，**遵循 Windows 显示缩放** —— 缩放 S 时
   *   页面拿到的 CSS 视口 = 物理宽 / S，而 `devicePixelRatio` = S。若写死 1.0，缓冲就只有
   *   物理像素的 1/S，CEF 合成时会**整幅画面**（含 DOM 文字、角色边缘、粒子轮廓）被再插值放大一次。
   *   ⚠️ 它**救不了位图**：背景素材 1700px → 视口的硬放大与 dpr 无关
   *   （见 09 文档 `14_清晰度诊断_2K屏糊.md` §5）。
   */
  dpr?: number | 'auto';
  /**
   * ⚠️ **已废弃、不再生效**（2026-10-10 起）。字段保留只为让旧 config 保持类型合法。
   *
   * 原义：允许的窗口宽高比区间 `[minAspect, maxAspect]`，越界则 letterbox + 左上红条。
   *
   * 为什么弃用：那对数字与"会不会露黑"没有必然关系 —— 决定露黑的是**本帧可见范围**
   * 与**图层覆盖**的屏幕关系，它随 `fov`、`|base.z|`、`cameraX/camY`、以及**每层各自的 `z`**
   * 一起变。同一个 `maxAspect: 2.4` 在 S9 那套上偏紧、在单层 dev config 上偏松 0.035；
   * 更糟的是数字与实际不符时是**静默露黑**（不报错、不留痕）。
   *
   * 替代方案：`initScene.ts` 现在**逐层投影到屏幕归一化坐标、逐边相减**，哪一边真露黑就报哪一边
   * （红条里带 `露黑边：左 Npx / …`），**完全不看长宽比**；同时**不再钳制/letterbox**
   * （画布恒等于视口）。带了这两个字段的 config 会在控制台得到一条"已忽略"的 warn。
   */
  minAspect?: number;
  /** ⚠️ **已废弃、不再生效**（2026-10-10 起）—— 说明见 `minAspect`。 */
  maxAspect?: number;
  /**
   * 全屏适配的**对齐基准**。缺省 `'height'`（2026-10-08 用户拍板）。
   *
   * ★ 用户可在**右上角设置面板 →「画面调整」**页随时改（覆盖层字段 `fitAspect`），
   *   改完**重载生效**（fov 与垂直锚点在 `initScene` 构造期算一次，见 `settingsStore`）。
   *
   * ## 两种基准的区别（只有一个自由量，另一个由视口比例定）
   *
   * 取景的可见区域（以设计画幅 1700×750 / aspect_d = 2.2667 为例）：
   *
   * | 基准 | 恒定量 | 随视口比例 A 变 |
   * |---|---|---|
   * | `'height'` | **可见高 ≡ 设计态可见高**（= 750 设计单位） | 可见宽 = 750·A |
   * | `'width'` | **可见宽 ≡ 底层铺满层 world 宽**（= 1700 设计单位） | 可见高 = 1700/A |
   *
   * 两者在 **A = aspect_d 处完全重合**（都是 1700×750）；偏离时
   * `'height'` 相对 `'width'` 的放大倍数恒为 **`aspect_d / A`**
   * （16:9 下 = 1.275×、16:10 下 = 1.417×、21:9 下 = 0.949×）。
   *
   * ## 什么时候该用哪个（两者各有可取之处，故做成设置项）
   *
   * - **`'height'`（默认）**：与**游戏内取景一致** —— Unity 的 `CanvasScaler`
   *   参考分辨率决定游戏的实际取景，游戏是按**参考分辨率的高**对齐的
   *   （本作实测 z=1.01、NCC 0.866，几乎与游戏实录重合）。
   *   代价：屏幕比设计画幅**窄**时会裁掉左右两侧、比设计画幅**宽**时会多露出背景。
   * - **`'width'`**：**任何视口比例下都恰好看到设计宽**，左右内容**永不被裁**；
   *   适合设计画幅是超宽构图、两侧有内容顶边的情况。
   *   代价：相对游戏画面偏小（16:9 下约为按高对齐的 78%）。
   *
   * ⚠️ 它**只影响 fov 与垂直锚点 `camY` 的算法**，不改任何 mesh 的 position/scale
   *   ⇒ 换基准不改各层的相对摆位，只是整体放大/缩小。
   *
   * ⚠️ **2026-09-21 之前建的工程**（S9/盛夏游乐场）是按 `'width'` 调的观感，
   *   它们的 `config.json` 里已**显式写死** `"fitAspect": "width"` ——
   *   改本字段的缺省值**不会**让那些老壁纸悄悄变样。
   */
  fitAspect?: 'width' | 'height';
  /** 触摸热区配置。缺省 = 启用 + 不显示 + 用 `touch.ts` 的内置兜底区。 */
  touch?: TouchConfig;
  /**
   * 指针（鼠标）拖尾粒子配置。缺省 = **不启用**（需显式 `enabled: true`）。
   *
   * 复刻游戏 `FX_UI_CommonUI_Click` 的 `/5` 与 `/5/6` 两个发射器
   * （自发射的 8 个背景粒子走 `meshes[]`，两者模型不同，见 `pointerTrail.ts`）。
   */
  pointerTrail?: PointerTrailConfig;
  /**
   * 念白字幕气泡配置（样式 + 数据）。
   * 缺省 = 不显示气泡；数据缺失时只播动作、不出字幕（不报错）。
   */
  subtitle?: SubtitleConfig;
  /**
   * 背景音乐配置。缺省 = **不播放**（必须显式配 `file`）。
   *
   * 与字幕**平级**而非塞进 `subtitle` —— BGM 与念白是两件独立的事
   * （念白关掉时 BGM 仍应能响）。
   */
  bgm?: BgmConfig;
  /**
   * 常驻动作序列（**顶掉 idle**）。缺省 = 不启用（保持"一直播 idle"的既有行为）。
   *
   * 与 `subtitle` / `bgm` 平级：它管的是**骨架播什么动作**，与"要不要出字幕"
   * 是两件事（可以"只循环动作、不出一句台词"，也可以"连台词带语音一起循环"）。
   */
  idleSequence?: IdleSequenceConfig;
  /**
   * 探针（诊断 HUD）配置。缺省 = 启用 + 显示。
   *
   * 发布正式壁纸时设 `{ "enabled": false }` 即可隐藏诊断层，**无需重新构建**；
   * `--env probe=off` 编的包只是**默认关**（省性能），用户在设置面板「调试」页
   * 照样能打开 —— 见 `probe.ts` 的 `applyProbeConfig`。
   */
  probe?: ProbeConfig;
  /**
   * **全部静音**（BGM + 念白语音一起关）。缺省 false。
   *
   * ## 为什么单独一个顶层字段，而不是去改 `bgm.enabled` / `subtitle.audio.enabled`
   *
   * 那两个是**各自的独立开关**（用户可分别设"BGM 开、念白关"）。静音总闸若直接改写它们，
   * 解除静音后就**还原不出**用户原本的组合了。
   * ⇒ 这里只存"总闸自己"的开关；真正生效是在 `applyOverrides` 里把两个 `enabled`
   *   压成 false（**单向**，不回写那两个字段）。
   *
   * 面板与 WE 属性面板的「全部静音」都读它 ⇒ 两边同源。
   */
  muteAll?: boolean;
  /**
   * **摩天轮轿厢姿态角**（面板「壁纸独立设置」页）。缺省 = `{ cabinMode: 'gravity' }`（沿用解包值）。
   *
   * 详见 `FerrisWheelConfig`。放在顶层是因为它管的是**粒子系统的渲染姿态**，
   * 与"播什么动作 / 出不出字幕"无关，和 `bgm` / `idleSequence` 平级。
   *
   * ★★ 它是**壁纸专属**项（2026-10-11 用户拍板，从「画面调整」页挪进「壁纸独立设置」页）：
   *   只有**配了摩天轮粒子组**的壁纸（如盛夏游乐场）才有意义，换成别的场景就是纯噪声。
   *   ⚠️ 面板上**必须在 `wallpaperSettings` 里声明** `"cabinMode"` 才会出现这一项
   *   （取值本身仍只由本字段承载，`wallpaperSettings` 不重复存值）。
   */
  ferrisWheel?: FerrisWheelConfig;
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 「壁纸独立设置」—— **只对本壁纸生效**的设置项（面板标签条最后一页）
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ## 为什么要单独一类（用户 2026-10-11）
   *
   * 本工程是**通用引擎**：同一份 bundle 服务多张壁纸，而像「摩天轮轿厢角度」这样的项
   * 只对**某一类构图**有意义。混在通用页（画面调整 / 事件池…）里，换一张壁纸就会看到
   * 一个**永远无效的控件** ⇒ 单开一页，把"只对本壁纸生效"的项收进去。
   *
   * ## 怎么用
   *
   * 由**壁纸自己的 `config.json`** 声明这一页有哪些东西（面板认得的项 id 见
   * `WallpaperSettingItem`）：
   *
   * ```json
   * "wallpaperSettings": {
   *   "label": "盛夏游乐场",
   *   "items": ["cabinMode"]
   * }
   * ```
   *
   * ★★ **不声明 / `items` 为空 / 全是写错的 id ⇒ 面板连这一页（含标签按钮）都不建**
   *   （判据在 `settingsPanel.resolveWallpaperPanelSpec`）——
   *   这样没有独立设置的壁纸（如星语心恋）不会多出一个永远空着的页。
   * ★ 写成数组是为了**同一页能容纳多项**；数组顺序 = 面板里的行序。
   *
   * ⚠️ 本块**只负责"展示什么"**（分组标题 + 有哪些项），**各项的值仍在各自的正式字段里**
   *   （`cabinMode` → `ferrisWheel.cabinMode`）—— 同一个设置两份真值必然打架，不重复存。
   */
  wallpaperSettings?: WallpaperSettingsConfig;
  /**
   * 「免责声明与许可证要求」弹窗的**文案参数**。缺省 = 不点名任何 IP 的通用文案。
   *
   * ## 为什么文案不在代码里写死
   *
   * 弹窗第一段是"本壁纸与原作无关"的立场声明，必然要提**原作名与权利人** ——
   * 而这始终随使用者手上的素材而变。写死在 `disclaimer.ts` 里，等于把某一个具体作品的
   * 名字硬塞进通用工具。故只把可变部分（`sourceName`）交给 config，
   * 整段文案的措辞与句式仍由代码统一负责（包括 Spine 许可段，那是固定的法律文本）。
   */
  disclaimer?: DisclaimerConfig;
  /**
   * 「动作 → 额外特效」绑定。缺省 = **不启用**（老 config 零影响）。
   *
   * 见 `ActionEffectsConfig` 的完整说明（数据来源、为什么按动画名绑、触发语义）。
   *
   * ★ 它放在顶层、与 `bgm` / `idleSequence` / `pointerTrail` 平级：管的是
   *   **"动作播的时候还要多播什么"**，与"播什么动作 / 出不出字幕"是两件事。
   */
  actionEffects?: ActionEffectsConfig;
  meshes: Array<
    SpineMeshConfig | TextureMeshConfig | VideoMeshConfig | ParticleMeshConfig
  >;
};

/**
 * 免责声明弹窗的文案参数（全部可选）。
 *
 * ⚠️ **只影响措辞，不影响任何法律关系的实质**：权利人、授权状态这些仍需使用者自行核实。
 */
export type DisclaimerConfig = {
  /**
   * 素材**原作名称**，如填 `"XXX"` 则首段写「与《XXX》官方不存在任何关联」。
   *
   * - **不填**：首段降级为不点名表述（「与原作官方不存在任何关联」）——仓库默认行为。
   * - 填了空字符串 / 纯空白：同上，视为未填。
   */
  sourceName?: string;
  /**
   * 权利人说明，追加到首段末尾，如 `"（开发：某某工作室；发行：某某公司）"`。
   * 仅在 `sourceName` 有值时出现（否则"本品 xxx 原作"没有指代对象）。
   */
  rightsHolder?: string;
};

/**
 * 摩天轮轿厢的**姿态角**二选一（用户拍板 2026-09-27）。
 *
 * ## ★ 为什么会有"两种角度"（取证见 `09_壁纸适配_素材与技术/04_渲染差异记录.md` §D1）
 *
 * - **解包数据**：`chexiang` / `chexiang (1)` 两组粒子的 `startRotation.a` 都是
 *   `-0.2617994 rad` = **−15°** —— 美术按**画面重力**画的（画面"竖直"方向相对画布
 *   偏离 15.27°/17.98°，实测见 D1 §1.2a），视觉上"合乎透视"。
 * - **游戏实测**：实录里轿厢长轴 **−0.03°**，相对画布**完全水平**。
 *   成因是游戏侧把轿厢旋转固定成了画布对齐（billboard / UI Canvas 层行为，D1 §1.3 反推）。
 *
 * ⇒ 两者相差约 15°，是**游戏渲染侧行为**造成的差异，不是素材错误。
 *   复刻时无法"两边都对"，只能交给用户选：
 *
 * | `cabinMode` | 轿厢姿态 | 诉求 |
 * |---|---|---|
 * | `gravity`（默认） | 保持解包 `startRotation`（**−15°**） | 与美术/画面重力一致，看着不别扭 |
 * | `game` | 强制 **0°**（画布对齐） | 与游戏画面**逐像素一致** |
 *
 * ## ★ 为什么 `game` 是硬编码 0°，而 `gravity` 不写死角度
 *
 * `game` 的语义就是"对齐画布坐标系"，**0° 即定义本身**，不是经验值；
 * `gravity` 则**沿用 config 里各组的 `startRotation`**（不另给一个 −15 常量）——
 * 换皮肤 / 换构图后画面重力会变，那时只需改 config 的数字，代码不用动。
 *
 * ⚠ 切换**需要重载**：`startRotation` 在粒子出生（spawn）时读取，
 *   与气泡 DOM / 语音播放器一样属于"开机一次性构造"（见 `settingsStore` 文件头）。
 *
 * ## ★★ 2026-10-11 修正：图元**自带**一份倾角，必须补掉（远古 bug）
 *
 * 用户实测：选「解包数据（−15°）」实际渲染 ≈**−30°**，选「游戏实测（0°）」实际渲染
 * ≈**−15°** —— **两个档位都多歪了 15°**。
 *
 * 根因不在代码（代码确实只转了 `startRotation` 那一个角），而在**素材**：
 * 图集里的 `FX_cf_chexiang01/02.png` 是美术**按画面重力系画的**，图元自身相对画布
 * 就已经歪了（同款黄舱：图元窗格相对竖直 **+20.5°**，而**游戏实录**里同一只吊舱的
 * 窗格**基本竖直** —— 两条都是放大后直接量的）。⇒ 于是：
 *
 * | 档位 | 代码施加的角 | 图元自带 | **实际渲染** |
 * |---|---|---|---|
 * | `gravity` | −15° | −15° | **−30°**（应 −15°） |
 * | `game` | 0° | −15° | **−15°**（应 0°） |
 *
 * ⇒ 轿厢组必须再补 +`spriteTiltDeg`（= 图元自带的那一份），补偿后 **`startRotation`
 *   的面值 = 画布坐标下的真实渲染角**，两个档位才名副其实。
 *
 * ⚠️ 这是**素材侧**的属性，所以放在 config 而不是写死在代码里：
 *   换皮肤 / 重导素材后图元自带的倾角会变（D1 §1.4 建议 2 早就提过"不要硬编码单一值"）。
 * ⚠️ **只对轿厢组生效**（`cabinGroups` 名单内）：其余 6 组粒子的图元没有"实录可对齐"
 *   的绝对参照，一律不加补偿（保持解包原样，`spriteTiltDeg` 不传到它们身上）。
 */
export type FerrisWheelConfig = {
  /** 轿厢姿态角模式。缺省 `gravity` */
  cabinMode?: 'gravity' | 'game';
  /**
   * 哪些粒子组算"轿厢"。缺省用 `DEFAULT_CABIN_GROUPS`。
   *
   * ★ 显式名单而不是代码里 `/^chexiang/` 硬匹配：换皮肤后组名会变，
   *   名单放在 config 里改一行即可（`nodeRotZ` 那 16° 的相位差也在这个命名体系里）。
   */
  cabinGroups?: string[];
  /**
   * **轿厢图元自带的重力倾角（度）**，用于抵消素材里那一份（见本类型顶部 2026-10-11 修正）。
   *
   * 缺省 **15**（= 本项目实测：图元按画面重力画，相对画布歪约 15°）。
   * 语义：轿厢出生朝向 = `cabinMode` 给的角度 **+ 本值** ⇒ 补偿后 `startRotation`
   * 的面值就是画布坐标下的真实渲染角。
   *
   * ⚠️ **只对 `cabinGroups` 名单内的组生效**（其余粒子不加）。
   * ⚠️ 换皮肤 / 重新导出素材后要重新量一次这个角（量法见 09 文档 04 §D1 的极点法）。
   */
  spriteTiltDeg?: number;
};

/** `FerrisWheelConfig.cabinGroups` 的缺省值（解包命名：`chexiang` / `chexiang (1)`） */
export const DEFAULT_CABIN_GROUPS: readonly string[] = [
  'chexiang',
  'chexiang (1)',
];

/**
 * 「壁纸独立设置」页里**面板认得并能渲染**的设置项。
 *
 * | 取值 | 面板里的项（标签逐字一致） | 值的唯一来源 | 为什么算"壁纸独立" |
 * |---|---|---|---|
 * | `'cabinMode'` | 「摩天轮轿厢角度」 | `ferrisWheel.cabinMode` | 只有配了摩天轮粒子组的壁纸才有意义 |
 *
 * ⚠️ 这里的 id 是**面板的渲染开关**，不是新的数据字段 —— 加一项必须**同时**在
 *   `settingsPanel.ts` 里补对应的渲染分支，否则 `resolveWallpaperPanelSpec` 会把它
 *   静默丢掉（宁可"少一项"，也不要渲染出一个没有实现的控件）。
 */
export type WallpaperSettingItem = 'cabinMode';

/**
 * 「壁纸独立设置」的声明（`config.wallpaperSettings`）—— 见 `Configs.wallpaperSettings` 的注释。
 *
 * ★ 只声明**展示**（分组标题 + 有哪些项），不存值。
 */
export type WallpaperSettingsConfig = {
  /**
   * 分组标题 = **本壁纸的名字**（如 `盛夏游乐场`），显示在页内分组标题行。
   *
   * 缺省 `'本壁纸'` 只在"忘了写"时兜底（页面还有个分组标题总比空白强）；
   * 正常都该写全 —— 这一页里可能同时列出好几组独立设置，得让用户分得清是哪张壁纸的。
   */
  label?: string;
  /**
   * 本壁纸声明的独立设置项（取值见 `WallpaperSettingItem`）。
   *
   * ⚠️ 缺省 / 空数组 / 全是面板不认识的 id ⇒ **面板连这一页都不出现**（不是出现一个空页）。
   */
  items?: WallpaperSettingItem[];
};

/**
 * 一个触摸热区。几何是**归一化视口坐标**（0~1，原点左上，与 `clientX/clientY` 同向），
 * 因此与分辨率、窗口比例都无关，也能直接喂给 DOM 覆盖层的百分比定位。
 */
export type TouchZoneConfig = {
  /** 稳定标识，如 `touch1`；覆盖层高亮与测试断言都用它 */
  id: string;
  /** 显示名（中文），只用于覆盖层标注 */
  label?: string;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

/**
 * 触摸交互总开关。
 *
 * 两个开关**互相独立**：
 *   - `enabled=false` → 完全不挂监听、不响应点击（但 `showZones` 仍可单独开来看框）
 *   - `showZones=true` → 把热区框画在页面上（`pointer-events:none`，绝不吃点击）
 */
export type TouchConfig = {
  /** 是否启用热区（缺省 **true**） */
  enabled?: boolean;
  /** 是否显示热区框（缺省 **false**，仅调试用） */
  showZones?: boolean;
  /**
   * **把热区范围改为全屏**（缺省 **false**）。
   *
   * true ⇒ **忽略 `zones`**，整个视口 `[0,1]×[0,1]` 就是一块热区（`id = 'fullscreen'`）
   * ⇒ 点画面**任何位置**都算命中。false / 未给 ⇒ 用 `zones`（原行为）。
   *
   * ★ 用途：有些用户就是想要"点哪都有反应"，或者角色被背景挡住、窄热区难中点。
   * ⚠️ 与 `showZones` 同时打开时，调试框会铺满整屏（正常，不是 bug）。
   * ★ 用户在**设置面板 →「事件触发」页 →「触摸热区范围改为全屏」**改；**保存后重载生效**
   *   （热区表是 `createTouchController` 开机一次性构造的）。
   */
  fullscreen?: boolean;
  /** 热区列表；命中判定按数组顺序**先命中先返回** */
  zones?: TouchZoneConfig[];
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 指针（鼠标）拖尾粒子 —— 复刻游戏 `FX_UI_CommonUI_Click` 的 /5 与 /5/6
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 来源（解包，可逐条复核）
 *
 * prefab `Assets/03_Prefabs/ART_Prefabs/Effect/FX_UI/FX_UI_CommonUI_Click.prefab`
 * （包 `03_prefabs/art_prefabs.ab`）。转储脚本 = 项目 `_work_触摸拖尾/13_查淡入淡出.py`
 * 与 `11_导出拖尾资源.py`；完整依据见 `09_壁纸适配_素材与技术/18_触摸粒子拖尾_解包.md`。
 *
 * ## 为什么它不并进 `meshes[].type='particle'`
 *
 * 那 8 个是**自发射**系统：按 `rateOverTime`/burst 在自身 ShapeModule 里发射，
 * 粒子靠速度积分移动。本效果是**外部驱动**：宿主跟随指针移动、按**移动距离**发射
 * （原版 `rateOverDistance = 2.0`），粒子出生后**静止不动**、只缩尺寸。
 * 发射模型不同，故不复用 `ParticleAnimator`（详见 `pointerTrail.ts` 顶部注释）。
 *
 * ## ★ 两条最容易做错的复刻口径
 *
 *  1. **消失靠"尺寸线性缩到 0"，不是 alpha 淡出** —— 原版 `/5`、`/5/6` 的
 *     `ColorModule.enabled = false`，alpha 全程恒定，只靠 `SizeModule` 缩到 0。
 *     改用 alpha 淡出会从"收缩消失"变成"雾化消失"，一眼能看出差别。
 *  2. **颜色是"每颗二选一随机"**（`minMaxState = 2` / TwoColors），不是沿轨迹渐变。
 */
export type PointerTrailEmitterConfig = {
  /** 系统名，仅用于调试/日志 */
  name: string;
  /** 贴图文件名（规则同 `meshes[].textureFileName`：平铺在 `assets/` 根下） */
  textureFileName: string;
  /**
   * 相邻粒子的中心间距，单位 = **屏幕 CSS px**（缺省 **19**）。
   *
   * 由实拍反推：用户手机截图 1920 宽下相邻粒子中心距 21.5 px，
   * 折算到本工程 1700 设计宽 ⇒ `21.5 × 1700 / 1920 ≈ 19.0`。
   * 对应原版 `rateOverDistance = 2.0` —— 间距恒为 `1/2 = 0.5` prefab 单位、
   * **与移动速度无关**，这正是截图里粒子呈"等距"排列的原因。
   */
  spacingPx?: number;
  /** 单颗寿命（秒）随机区间 `[min, max]`。原版 `/5` = 0.5 固定、`/5/6` = 0.3~0.5 */
  lifetime: [number, number];
  /**
   * 单颗**起始直径**（屏幕 CSS px）随机区间 `[min, max]`。
   *
   * 原版是 prefab 单位（`/5` = 1.0、`/5/6` = 0.2~0.5）；这里用屏幕 px 更直观 ——
   * 截图实测粒子核心直径 11 px、含柔边约 18~22 px（1920 宽）⇒ 折算 1700 设计宽约 16~19。
   */
  sizePx: [number, number];
  /**
   * 随机双色（**线性** RGB + alpha，直取解包 `startColor`）。
   * 每颗粒子在两者中等概率二选一（= `minMaxState 2` / TwoColors）。
   *
   * 原版：`/5` = 亮天蓝 `(0.069,0.576,0.934, a .553)` ↔ 蓝紫 `(0.293,0.381,0.971, a .566)`；
   *      `/5/6` = 蓝 `(0.225,0.491,0.926, a .566)` ↔ 淡蓝 `(0.504,0.682,0.926, a .497)`。
   */
  colors: [[number, number, number, number], [number, number, number, number]];
  /**
   * alpha 乘子 = 材质 `_TintColor.a`（原版 `/5` = 0.5、`/5/6` = 1.0）。
   * 最终 alpha = `colors[i][3] × alphaMul`。缺省 1。
   */
  alphaMul?: number;
  /** 混合模式，缺省 `normal`（原版材质名 `_blend` / `_3h` 提示属 Alpha 混合系） */
  blend?: 'normal' | 'add';
  /**
   * 尺寸随寿命的缩放曲线 `[[t, k], ...]`（t∈[0,1] 归一化寿命；k = 尺寸乘子）。
   * 缺省 = **线性 `1→0`**（用户 2026-09-30 指定）。
   * 原版 `/5` 即 `[[0,1],[1,0]]`；`/5/6` 为 14 段锯齿（尺寸脉动）。
   */
  sizeOverLife?: number[][];
  /** 同屏上限（缺省 **120**，够覆盖 0.5 s 拖尾在 144 Hz 下的长度） */
  maxParticles?: number;
};

/**
 * 指针拖尾总配置。
 *
 * 缺省 = **不启用**（必须显式给 `enabled: true`），
 * 这样旧 config.json 直接跑不会多出视觉元素。
 */
export type PointerTrailConfig = {
  /** 是否启用（缺省 **false**） */
  enabled?: boolean;
  /**
   * 粒子所在的 z 平面（缺省 **−100**）。
   *
   * ⚠️ **必须是负值**：相机在 `z = 0` 且朝 **−z** 看，所有层都是负 z
   * （背景 −1520 ~ −1390、角色 spine −1000）。"角色之前"= 比 −1000 更靠近相机
   * ⇒ 取 −100（等价于 UI 覆盖层）。取正值会让射线交点落在相机背后、
   * 粒子一颗都不发（静默失效）。
   * 与 `meshes[].position.z` 是同一套"透明物体按 z 排序"的口径。
   */
  planeZ?: number;
  /** 发射器列表（原版为 `/5` 与 `/5/6` 两个） */
  emitters: PointerTrailEmitterConfig[];
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 念白（语音 + 字幕气泡）—— 数据模型
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 数据来源（权威，可逐条复核）
 *
 * 链路（见 `09_壁纸适配_素材与技术/09_亚砂S9_触摸与语音_解包复核.md` §3）：
 *
 * ```
 * Dress.csv[33000690] → SoulRes.csv[20020690].SpineActionControl = 604
 *   → CfgSoulSpineActionControlTable[604]
 *       StandbyAction=64004 / TouchFeedback={1:64005 … 6:64010}
 *       MorningGreetings=64001 / NoonGreetings=64002 / EveningGreetings=64003
 *         → CfgSoulSpineActionTable[6400X]
 *             ActionName      = I18N ID → 官方动作命名
 *             SoulActionState = **spine 动画名**（idle/greet/chat/touch1..3）
 *             CV              = 3601025X
 *               → CV.csv[3601025X]  Text=文本ID  SoundID  TextTime
 *                   → CfgI18NTable[文本ID]（可经 RefId 再跳一级）= 念白正文
 *                   → Sound.csv[SoundID].FileName = 录音 ogg 路径
 * ```
 *
 * ⚠️ 三个已知的坑，写死在注释里免得下次重踩：
 *   1. `CfgCVTable.Text` / `ActionName` 在 lua 里**是一次 I18N 函数调用**，
 *      用"返回空串"的桩会读成空串、进而错判"字幕不在静态数据"。
 *   2. 10 条 S9 念白全是 RefId 形式（要跳一级才拿到正文）。
 *   3. `SoundName`（问候/触碰反馈/休闲/抚摸）只是**录音资源分组标签**，
 *      不是语义分类 —— 64004「休闲待机」的 SoundName 恰好写着"触碰反馈"、
 *      文件名 `Touch_Head_03.ogg`。**别按资源名反推语义。**
 *
 * ## 为什么放在 config.json 而不是 TS 里
 *
 * 与热区同一套架构口径：**几何/数据的唯一来源是 config，代码里不留兜底副本**
 * （热区那边已明确删掉 `DEFAULT_TOUCH_ZONES`）。好处是改文案、调时长**免重建 bundle**。
 */
export type DialogueEntry = {
  /** 动作表 ID（`CfgSoulSpineActionTable.Id`）。用于跟权威表格逐条对齐，也用于日志 */
  actionId: number;
  /** 官方动作名（`ActionName` 经 I18N 解出的中文名），仅用于日志/HUD */
  label?: string;
  /**
   * 该条要播放的 spine 动画名（= `SoulActionState`）。
   * ⚠️ 10 条念白只对应 **6 个** clip：64005/64006→`touch1`、64007/64010→`touch2`、
   * 64008/64009→`touch3`。这是骨架资源本身的事实，不是缺数据。
   */
  animation: string;
  /**
   * **事件族 id** —— 必须是 `config.subtitle.eventFamilies` 注册表里的某个 `id`
   * （见 `EventFamily`）。
   *
   * ⚠️ 没写 / 写了非法值时按 `dialogue.resolveDialoguePhase` 的三段判据兜底：
   *   先看注册表各族的 `matchSuffix`，再不中则归入**缺省族**。
   *
   * ★ 只有**触摸通道**会按它筛选（用户在面板「事件池」页选哪些族可触发）；
   *   待机 / 回到壁纸两个自动通道**只用缺省族**的条目。
   *
   * ⚠️ 同一动作的不同族孪生条目**共用 `actionId`**（游戏里本就是"同一条动作、两套动画"），
   *   靠本字段区分；`buildPool` / `mergeKindPools` 已做族感知，不会误去重。
   */
  phase?: TriggerPhase;
  /** 念白正文（字幕文本） */
  text: string;
  /**
   * 字幕停留秒数（= `CV.csv.TextTime`）。
   * 实际显示时长取 `min(本值, 该动画的 duration)` —— 动画播完就先收起气泡。
   */
  textTime?: number;
  /**
   * 录音文件（`Sound.csv.FileName`，如 `CV/Asuna/Asuna_Touch_Head_03.ogg`）。
   * ⚠️ **本轮不播音频**：ogg 本体在 `base.apk` 的 `06_sounds/cv/_asuna.ab` 里，尚未解出。
   * 这里先登记路径，将来解出音频后只要补一个播放器即可接上。
   */
  voice?: string;
};

/**
 * 语音播放配置。
 *
 * 音频本体是解包产物（`_asuna.ab` → `AudioClip.samples` 拿到的 wav，再转 ogg q6），
 * 文件名与游戏 `Sound.csv.FileName` 的最后一段一致（如 `Asuna_Touch_Head_03.ogg`），
 * 所以 `DialogueEntry.voice` 只要取 basename 就能定位到文件。
 *
 * ⚠️ **浏览器的自动播放限制**：`new Audio().play()` 在"用户尚未与页面交互"时
 * 会被拒绝（`NotAllowedError`）。所以：
 *   - **首次打开壁纸的问候语音很可能播不出来**（此时还没有任何点击）；
 *   - 点击触发的触摸语音一定能播（点击本身就是用户交互）；
 *   - 待机语音取决于此前是否点过。
 *
 * 这是浏览器/CEF 的硬限制，不是 bug。**字幕不受影响**（它是 DOM，不经过媒体权限），
 * 所以设计上刻意让"字幕显示"不依赖 `play()` 的 promise —— 否则会连带字幕也不出现。
 */
export type SubtitleAudioConfig = {
  /** 是否播放语音（缺省 **true**） */
  enabled?: boolean;
  /** 音量 0~1（缺省 1.0） */
  volume?: number;
  /** 语音目录（相对 `index.html`，缺省 `./assets/voice/`） */
  path?: string;
};

/**
 * 探针（诊断 HUD）配置。
 *
 * ## 两层开关（**不是 AND**）
 *
 * 1. **编译期**：`npm run build -- --env probe=off` ⇒ `__PROBE__=false`，
 *    它只决定**缺省值**（发布包默认不挂探针，省性能、也免得误报）。
 * 2. **运行时**（本配置 + 设置面板「调试」页的覆盖层）：`probe.enabled` /
 *    `hud` / `crosshair` ⇒ **改 config 免重建**，且**两个方向都能覆盖**
 *    —— 正式版里用户也能打开或关掉诊断。
 *
 * ## 缺省
 *
 * `enabled` 缺省 = 编译期值（普通构建 true / `probe=off` 构建 false）；
 * `hud` / `crosshair` 缺省 **true**。发布正式壁纸时把 `probe.enabled` 设 `false`。
 */
export type ProbeConfig = {
  /** 是否挂探针监听（缺省 **true**）。false = 完全不挂，HUD 也不建 */
  enabled?: boolean;
  /** 是否显示左上角 HUD（缺省 **true**）。false = 仍记数据但不画字（截图更干净） */
  hud?: boolean;
  /**
   * 是否显示"鼠标位置红圈"（缺省 **true**）。
   *
   * 红圈是**坐标口径的测量仪**（它若不在鼠标处 ⇒ 宿主给的 clientX/Y 口径不对），
   * 但录屏/截图时很碍眼 ⇒ 单独一个开关，可以"关红圈、留 HUD 文字"。
   * 注意：`hud:false` 只隐藏文字块，红圈由本字段控制。
   */
  crosshair?: boolean;
};

/**
 * 背景音乐（BGM）配置。缺省 = **不播放**（必须显式配 `file` 才有声音）。
 *
 * ## 与 `SubtitleAudioConfig` 的差异
 *
 * BGM 只有**一条**、要**循环**、一开场就响 ⇒ 语义与语音不同，故单列一个类型
 * （实现见 `bgmPlayer.ts`，刻意不复用 `voicePlayer.ts`）。
 *
 * ## ⚠️ 自动播放限制
 *
 * 首次打开壁纸时页面尚无用户交互（WE 里通常永远没有），`play()` 会被拒。
 * 实现侧做了**一次性交互解锁**：首次点击/按键后自动重试，
 * 所以"首次静音 ⇒ 点一下热区就响"是预期行为，不是 bug。
 *
 * ## 音量口径
 *
 * 缺省 **0.5**，比游戏内 `VolumeInSoundGroup=0.8` 低两档 ——
 * 壁纸场景下 BGM 是陪衬，要给点击触发的念白留出可听空间。
 * **本工程不做 ducking**（念白期间不压低 BGM），这是用户 2026-09-21 拍板的口径。
 */
export type BgmConfig = {
  /** 是否播放 BGM（缺省 **true**，但 `file` 为空时仍不播） */
  enabled?: boolean;
  /** 音量 0~1（缺省 **0.5**） */
  volume?: number;
  /** 目录（相对 `index.html`，缺省 `./assets/bgm/`） */
  path?: string;
  /** 文件名（如 `Anniversary_03.ogg`）。**必填**，不填则整个 BGM 不启动 */
  file?: string;
  /** 是否循环（缺省 **true**） */
  loop?: boolean;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 常驻动作序列 —— 用固定动作 / 固定动作序列顶替 idle
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 需求（用户 2026-09-22 拍板）
 *
 *   「允许固定显示固定动作和固定动作序列」，作用域 = **常驻循环（替代 idle 一直播）**，
 *   推进方式 = **自动连续播（播完一条立刻接下一条，间隔可配）**。
 *
 * ## 与既有三套机制的关系（不要混淆）
 *
 * | 机制 | 轨道 | 谁来触发 | 播完 |
 * |---|---|---|---|
 * | **idle**（`meshes[].animationName`） | track 0，loop=true | 一直播 | 不结束 |
 * | **常驻序列**（本配置） | track 0 | 一直播 | 自动接下一条 |
 * | 触摸 | track 2 | 点击热区 | `clearTrack(2)` 露回 track 0 |
 * | 问候 / 待机 | track 2 | 定时器 | 同上 |
 *
 * ⇒ 本序列**取代** idle 占住 track 0；触摸/问候/待机仍在 track 2 上叠加，
 * 播完清 track 2 就露出序列当前这一条 —— 两套机制互不干扰。
 *
 * ## 为什么"固定动作"和"固定动作序列"共用一个 `items`
 *
 * `items` 长度为 1 就是"固定动作"（该条 loop 住、反复播），
 * 长度 > 1 才是"序列"。**不额外加 `fixedAnimation` 字段** —— 那会引入
 * "两个字段同时配时谁优先"的歧义，而长度判据没有歧义。
 */
export type IdleSequenceItem =
  /** 直接给骨架动画名（如 `"touch1"`）。**只播动作，不出台词、不出语音** */
  | string
  | {
      /** 骨架动画名；与 `actionId` 同时给时以 `actionId` 查到的为准 */
      animation?: string;
      /**
       * 念白条目的 actionId。**给了就会连台词和语音一起播**（走 `showDialogue`）。
       *
       * ⚠️ 想要"只循环动作、别一直冒气泡" ⇒ 用 `animation`（或裸字符串），不要用 `actionId`。
       */
      actionId?: number;
    };

export type IdleSequenceConfig = {
  /** 是否启用（缺省 **false** = 沿用 idle）。true 才接管 track 0 */
  enabled?: boolean;
  /**
   * 序列内容。**必须显式配**；空数组 / 全部指向骨架里不存在的动画 ⇒ 整块不生效
   * （`console.warn` 后静默退回 idle，不会白屏或卡死）。
   */
  items?: IdleSequenceItem[];
  /** 两条之间的停顿（毫秒，缺省 **0** = 播完立刻接下一条） */
  gapMs?: number;
  /** 从第几条开始（缺省 0）。仅影响起始位置，不影响循环顺序 */
  startIndex?: number;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 气泡背景皮肤的三种实现
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 复刻对象
 *
 * `MainUI_MainUI_Frame_01`（542×66，`m_Border=(65,25,65,25)`）：
 * **RGB 纯黑 + alpha 102/255≈0.400**。两层叠加 ⇒ 内区 `1-(1-0.4)² = 0.640`、
 * 最外圈只有一层 = 0.400 ⇒ 形成"内深外浅"的细边。
 *
 * ## 三种模式的取舍（2026-09-20 实机 A/B 实测）
 *
 * | 模式 | 元素数 | 性能 | 观感 |
 * |---|---|---|---|
 * | `png-layered` | 2 | 稳态 p50 **11.000 ms** | 精确还原原 sprite 的抗锯齿质感；但角切片随 `s` 放大 ⇒ **大视口下发虚** |
 * | `png-single` | 1 | 同左 | 同上，省一个元素（等价性待像素回归确认） |
 * | `css-layered` | 2 | 稳态 p50 **11.000 ms** | 圆角是矢量、任何尺寸都锐利 ⇒ **大视口更干净** |
 *
 * **性能三者完全一致**（差异在 ±0.5 ms 轮间噪声内）。原因不是"CSS 更轻"，而是
 * **气泡本身可忽略**：171 kpx² ≈ 视口的 **4.7%**，5~25 秒才变一次，
 * 而 canvas 每帧重画整个视口。**真正的成本在 canvas，不在气泡。**
 * ⇒ 选型**只看观感**，不必为性能纠结。
 *
 * ## ★ 两个必须知道的实测事实
 *
 * 1. **`border-radius` 在 `border-image` 存在时被静默忽略**（规范：border-image 在
 *    border box 绘制）。实测：给九宫格层加 `border-radius:40px`，`getComputedStyle`
 *    报 40px，但左上角逐像素 alpha 全 255、**没有任何圆角切口**。
 *    ⇒ 想要 CSS 圆角**必须去掉 `border-image`**，不能"叠加"。
 * 2. **源 sprite 不是纯色**：角部 alpha `0~102`（圆角渐变）、边缘抗锯齿（max 104）、
 *    中心恒 102 ⇒ **九宫格不是在空转**，它保住了圆角形状。
 *
 * ## 多行时的额外收益（换 CSS 的真正理由）
 *
 * 九宫格模式下纵向 `border-width` = `25 × s`（2560×1600 下 = 48px）。
 * 一个 5 行 202px 高的气泡，**上下边框吃掉 96px（47%）**，中间可拉伸切片只剩 106px。
 * CSS 矩形没有"边框吃高度"的问题 ⇒ **多行观感提升明显**。
 */
export type SubtitleSkinConfig = {
  /**
   * 底图的来源：
   * - `'css'`（缺省）：一个 `background + border-radius` 的圆角矩形。**大视口下圆角更锐利。**
   * - `'png'`：九宫格 `border-image`（sprite 自带"黑 + alpha 102"）。
   *
   * ⚠️ 旧值 `'css-layered'` / `'png-layered'` **仍被接受**（映射到 `css` / `png`），
   * 但 `-layered` 这个后缀**已经名不副实** —— 见 `alpha` 的说明，气泡是**单层**。
   */
  mode?: 'css' | 'png' | 'css-layered' | 'png-layered';
  /** `png` 模式：九宫格底图文件名（相对 `assets/`） */
  image?: string;
  /**
   * `png` 模式：九宫格边距（**源图像素**），顺序 = Unity `m_Border` 的 `(left,bottom,right,top)`。
   * 缺省 `(65,25,65,25)`。
   */
  border?: { left: number; bottom: number; right: number; top: number };
  /**
   * 暗化层的**单层**不透明度（缺省 **0.4** = sprite 实测的 `102/255`）。
   *
   * ⚠️ 旧名 `layerAlpha` 仍被接受。
   *
   * ## ★★ 这里曾经错了很久（2026-09-21 定案修正）
   *
   * 早期结论是"**两层**叠加 ⇒ 内区 `1-(1-0.4)² = 0.64`、外圈 0.4，形成一圈细边"。
   * **该结论已被推翻**（`09_壁纸适配_素材与技术/证据_语音框气泡/气泡是单层还是双层_定案.md`）：
   *
   * | 判据 | 游戏实测 | 单层 0.400 | 双层内区 0.640 |
   * |---|---|---|---|
   * | 外圈 alpha（距边 2~4px） | **0.374** | ✅ | — |
   * | 内区 alpha（距边 14~24px） | **0.326** | ✅ | ❌ |
   * | 白字标尺（内区最亮/外圈最亮） | 254 / 248 ⇒ a=0.004 / 0.026 | **内外无台阶** ✅ | 应有台阶 ❌ |
   *
   * **错因**：把 `Image_02` 当成了"再叠一层半透明黑"。它其实挂的是**模糊材质**
   * （`UI-Default-Blur`）—— 模糊**不改变亮度**（GrabPass 均值守恒），
   * 所以**不会**在气泡内形成第二个更暗的矩形。
   *
   * ⇒ **正确模型：一层均匀 0.40 黑 + 框内一次模糊。**
   * "内外分界"是**"清晰 / 模糊"的边界，不是"深浅"的边界**。
   */
  alpha?: number;
  /**
   * `css` 模式：圆角半径（设计单位）。
   *
   * 实测依据：源图 542×66、`m_Border=(65,25,65,25)`，可见面板 ≈530×48、**圆角 r≈9px**。
   * 缺省 **9**。
   */
  radius?: number;
  /** 框内背景模糊（对应游戏 `Image_02` 的 `UI-Default-Blur`）。缺省 = 启用。 */
  blur?: SubtitleBlurConfig;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 框内背景模糊 —— 复刻 `Image_02` 的 `UI-Default-Blur`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 算法（权威：`_work_模糊shader/_out/UI_DefaultBlur_模糊算法_定案.md`）
 *
 * `UI/DefaultBlur` 是**空壳包装**（GrabPass + 两条 UsePass），真身是 `UI/DefaultBlurBase`：
 * 两趟可分离 9-tap 加权均值（近似高斯），核 =
 * `中心 0.18 / ±1:0.15 / ±2:0.12 / ±3:0.09 / ±4:0.05`（权和 = 1.000000）。
 *
 * σ = `2.1166 × _Size`；材质实测 `_Size = 1.9` ⇒ σ = **4.022 视口px**
 * ⇒ CSS 等效 `blur(2σ)` = **`blur(8.04px)`**（CSS `blur(R)` 的 σ = R/2）。
 *
 * ## ★ 两个必须记住的口径
 *
 * 1. **半径恒定，以视口像素为单位，不随视口高缩放。**
 *    理由：GrabPass 的 RT = **屏幕（视口）分辨率**，采样偏移 = `k × _Size × TexelSize`
 *    ⇒ 偏移只由 `_Size` 与视口分辨率决定，**与 Image 的 RectTransform 尺寸无关**。
 *    ⚠️ 早期文档写成 `blur(8.04 × 视口高/750)` 是**方向反了** ——
 *    那会让 1600 高的视口算出 17px（偏大 2.1 倍）。
 * 2. **模糊半径与气泡尺寸无关**：GLSL 的 9 次采样是硬编码展开、不含任何尺寸项。
 *    气泡变大变小，**模糊半径不变**，变的只是"被模糊的区域范围"。
 */
export type SubtitleBlurConfig = {
  /** 是否启用框内模糊（缺省 **true**）。关闭 ⇒ 只剩一层均匀 0.40 黑 */
  enabled?: boolean;
  /**
   * 模糊半径（**视口 px，恒定**，缺省 **8.04**）。
   * 直接映射到 `backdrop-filter: blur(Npx)`。**不要**乘任何视口比例。
   */
  radiusPx?: number;
  /**
   * 模糊区域相对气泡的内缩量（设计单位）。**缺省 `(0, 0)` = 满铺**。
   *
   * ## ★ 缺省值为什么从 `(5, 8)` 改成 `(0, 0)`（2026-09-21 修正）
   *
   * 游戏里 `Image_02` 的 `sizeDelta = (-10, -16)` ⇒ 每边内缩 `(5, 8)`，
   * 于是"最外那 5/8 设计px 只有暗化、没有模糊"，形成一圈**清晰的黑边**。
   * 早期就照抄了这个内缩 ⇒ 用户验收时报 **"padding 没有模糊"**。
   *
   * 内缩在游戏里**是有用的**：`Image_01`（满铺那层）在 `(5,8)` 外还露着一圈**边框图**，
   * 那圈本来就不该被模糊。**但我们的 CSS / PNG 模式都没有那圈边框图**
   * （`png` 模式是 `border-image` 九宫格，边框区在 border box 内、并不比 `Image_02` 外扩；
   * `css` 模式更没有）。⇒ 内缩只剩"留一圈不模糊的黑边"这一个副作用，**是纯损失**。
   *
   * 叠加第二个原因：内缩量按 `× s`（视口高/750）缩放，2560×1600 下 5/8 会放大到
   * **11/17 视口px**，那圈缝在高分辨率下更显眼。
   *
   * ⇒ 缺省改为**满铺**（整个矩形都模糊）。想把那圈清晰边留回来的，显式配 `(5, 8)`。
   *
   * ⚠️ 旧字段 `innerInset` 语义与此相同（数值也一样），已迁到这里 ——
   * 它**不再是**"叠第二层暗化"的内缩。
   */
  inset?: { x: number; y: number };
};

/**
 * ★ 自动换行阈值（`max-width`）的算法。
 *
 * ## 背景：两套基准本来不同步
 *
 * 气泡的**字号**按 `视口高 / referenceHeight` 缩放（复刻"设计画幅下的观感"），
 * 而**换行阈值**原本按 `视口宽 × 比例`。本工程的全屏适配是「水平锁定」
 * （画面 `像素/世界` 只与窗口宽度成正比）⇒ 两者不同步，
 * **单行可容字数 ∝ aspect**（实测 24~61 字，2.5 倍）。
 *
 * 这本身不算错（等同"画面放大→字也放大→能放的字变少"，与游戏 CanvasScaler 一致），
 * 但**想完全复刻游戏实录的用户会不满意** —— 实测游戏里换行阈值恒定在约 **10 个汉字**。
 *
 * ## 游戏口径（实测 + prefab 数据互相印证）
 *
 * ```
 * Talk  size=(260.0, 60.0)        ← 静态尺寸
 *   Text  size=(-50.0, 0.0)       ← 左右各内缩 25
 * ⇒ 文本可用宽 = 260 − 50 = 210
 * 字号 20  ⇒  210 / 20 = 10.5 汉字/行      ← 用户实测"大约 10 个汉字" ✅
 * padding 25 / 字号 20 = 1.25 汉字         ← 用户实测"约一个汉字 padding" ✅
 * ```
 *
 * ⚠️ 但 `Talk` 挂着 `UISizeAdapter`（**Min 260×60 / Max 1700×750**），
 * 所以游戏里阈值其实也在 `10.5 ~ 82.5` 汉字之间自适应 ——
 * **那套自适应规则没解出来**（`CvUIFrame.lua` 仅 1625 B、无任何数值常量）。
 * 用户实测到的 10 汉字对应 **Talk = 260 的下限态**，故 `fixed` 模式取该值。
 */
export type SubtitleWrapConfig = {
  /**
   * - `'viewport'`（缺省）：阈值 = `视口宽 × viewportRatio`。
   *   换行位置随图幅变化，气泡永不超出屏幕。
   * - `'game'`：阈值 = `designWidth × (视口高 / referenceHeight)` ——
   *   **复刻游戏的换行宽度**（见下）。单行字数与图幅无关，恒定。
   *
   * ## ★ 为什么是"设计单位宽度"而不是"汉字数"
   *
   * 游戏的折行宽度是一个**宽度量**，不是字数量：
   *
   * ```
   * Talk  sizeDelta.x = 260        （prefab 静态值；Init 里被 GetCVFrameWidth 按页面覆盖）
   *   Text  sizeDelta = (-50, 0)   （左右各内缩 25）
   * ⇒ 折行宽度 = 260 − 50 = 210 设计单位
   * Text  m_HorizontalOverflow = 0 (Wrap)  ← 就在这个宽度处折行
   * ```
   *
   * `210 / 字号20 = 10.5 汉字/行`，与用户实测"约 10 个汉字"吻合。
   * 但**写成"10.5 个汉字"是错的表达** —— 一旦改了字号，字数会变、宽度不该变。
   * 所以这里用 `designWidth`（设计单位），字号仍按 `视口高/参考高` 缩放
   * ⇒ 等价于游戏的 `CanvasScaler`：**屏幕变大时框和字一起放大，每行字数不变**。
   *
   * ⚠️ `Talk` 还挂着 `UISizeAdapter`（**Min 260×60 / Max 1700×750**），
   * 所以游戏里这个宽度理论上可在 `210 ~ 1650` 设计单位间变化
   * （对应 `10.5 ~ 82.5` 汉字）。**那套联动规则没解出来**
   * （`CvUIFrame.lua` 仅 1625 B、无任何数值常量；`GetCVFrameWidth` 只读了
   * `Constant.UIControllerName.MainUI`，说明它是**按页面离散取值**）。
   * 用户实测到的 10 汉字对应 **Talk = 260 的下限态**，故缺省 `designWidth = 210`。
   * 若将来解出其他页面的宽度，改这个数即可（**免重建**）。
   */
  mode?: 'viewport' | 'game';
  /** `viewport` 模式：占视口宽的比例（缺省 **0.72**） */
  viewportRatio?: number;
  /** `game` 模式：折行宽度（**设计单位**，缺省 **210** = prefab 的 `260 − 50`） */
  designWidth?: number;
  /**
   * 兜底上限：占视口宽的比例（缺省 **1.0** = 不裁）。
   * 只作保护，正常情况下不会触发 —— `game` 模式下窄屏气泡可能接近屏宽。
   */
  maxViewportRatio?: number;
};

/** 一天里的三个问候时段（与游戏 `SoulSpine_MorningTime/NoonTime/NightTime` 对应） */
export type DialogueSlotKey = 'morning' | 'noon' | 'evening';

/**
 * 一个时段的起止**小时**（0~24）。`start > end` 表示**跨零点**
 * （如 `{start:18,end:5}` = 18:00 到次日 05:00）。含起点、不含终点。
 */
export type DialogueTimeRange = { start: number; end: number };

/**
 * 「正在播某个动作事件」时，用户**点击**该怎么处理（2026-10-08 新增）。
 *
 * ★★ **唯一判据在 `touch.ts` 的 `decideAction`**（纯函数、可单测）；本类型只是它的入参。
 *
 * | 取值 | 正在播 touch（点击触摸） | 正在播 greet / standby（问候 / 聊天） |
 * |---|---|---|
 * | `'legacy'`（**缺省**） | **不响应**（计一次 skipped） | **打断并立刻播新的** |
 * | `'immediate'` | 打断并立刻播新的 | 打断并立刻播新的 |
 * | `'queue'` | 排到当前这条之后 | 排到当前这条之后 |
 * | `'none'` | 无反馈 | 无反馈 |
 *
 * ## ★ 为什么缺省是 `'legacy'`（2026-10-09 改）
 *
 * `'legacy'` **就是 2026-10-08 改动前的规则表**（触摸 ⊥ 触摸 ⇒ 忽略；触摸打断问候/聊天；
 * 自动事件永不打断别人）⇒ 四种取值里只有它**逐条等价于旧版**，所以拿它当缺省，
 * 升级到本版**不会改变任何既有观感**。
 *
 * ⚠️ 换句话说：`touchFeedbackMode` 这个字段是**纯新增能力**，缺省档刻意选了"最不打扰演出"那一档；
 * 想要"点了永远有反应"的用户自己去「设置 → 事件触发」页切到 `'immediate'`。
 *
 * ## 各档取舍
 *
 * - `'legacy'`：演出（尤其触摸动作）不被点击打断，只有问候/聊天这类**自动触发**的会被点掉
 *   —— 用户点了没动静的场景只出现在"刚点完、上一条还在演"这一小段时间里。
 * - `'immediate'`：最跟手；代价是上一条会被收掉（叠加模式即时接管、排队模式接在当前这条之后）。
 * - `'queue'`：动作完整不被掐断；代价是响应延迟 = 当前动作的剩余时长。
 * - `'none'`：最省事、画面最稳；代价是"点了没反应"容易被当成壁纸卡住。
 *
 * ⚠️ **叠加 / 排队两种播放模式下 `'immediate'` 的观感不同**（细节见 `touch.ts` 的
 * `playAction` 注释）：排队模式下 track 0 与常驻序列共用，硬抢会把序列演到一半的动作
 * 砍掉（实测起始跳变 158.8 单位、7 个部件瞬时消失）⇒ 那种情况下它退化为"排到最前面接手"。
 * `'legacy'` 无此问题：它对"正在播 touch"这一格本来就是不响应。
 *
 * ★ 用户在**右上角设置面板 →「事件触发」页**可随时改（覆盖层字段 `touchFeedbackMode`），
 *   保存后**重载生效**。
 */
export type TouchFeedbackMode = 'legacy' | 'immediate' | 'queue' | 'none';

/**
 * 问候（greet）事件的**取条方式**（2026-10-08 新增）。
 *
 * ★★ 唯一判据在 `dialogue.ts` 的 `pickGreetingEntry`（纯函数、可单测）。
 *
 * | 取值 | 行为 | 前提 |
 * |---|---|---|
 * | `'time'`（**缺省**） | 按**当前系统时刻**落在哪个时段，取 `greet` 池里**同一序号**的那条 | `greetingRanges` 时段分界（缺省 5/12/18 时） |
 * | `'random'` | 从 `greet` 池里**随机**取一条，与时刻无关 | 池非空 |
 *
 * ## ★ `'time'` 的"序号对位"口径（务必读）
 *
 * 事件池现在统一是**数组**，`'time'` 模式按 `SLOT_ORDER`（`morning`/`noon`/`evening`）
 * 的**序号**去数组里同名下标取值 —— 即：
 *
 * ```
 * greet: [第 0 条 → morning, 第 1 条 → noon, 第 2 条 → evening, 第 3 条及以后 → 不参与按时]
 * ```
 *
 * 游戏原版的三个问候位（`MorningGreetings`/`NoonGreetings`/`EveningGreetings`）
 * 本来就是这个顺序，所以照抄原表时无需额外映射。
 *
 * ⚠️ 池的长度**不足 3**、或某一位写错了 id ⇒ 该时段会退化为"池内随机"（不会什么都不播），
 *    并在控制台留一条 warn —— 宁可降级也不要静默失效。
 *
 * ★ 待机到点触发的问候（`standbyKinds` 里勾了 `'greet'`）走的是**同一个函数**，
 *   所以这两处永远不会出现"两套问候口径"。
 */
export type GreetMode = 'time' | 'random';

/**
 * 可被某个**触发通道**自动播放的事件类别（2026-10-09 由单通道的 `StandbyEventKind`
 * 泛化而来 —— 面板「事件池」页现在有**三项同构**的多选，共用这一套取值域）。
 *
 * ★★ 唯一判据在 `dialogue.ts` 的 `resolveTriggerIntent` / `resolveTriggerKinds`
 *   （纯函数、可单测）；本类型只是它们的取值域。
 *
 * ## 三个类别的池（每类各有各的池）
 *
 * | 取值 | 面板 chips | 池来源 |
 * |---|---|---|
 * | `'chat'` | chat类 | `chat` 数组（没配时退回旧字段 `standby`） |
 * | `'greet'` | greet类 | `greet` 池（或旧时段表 `greeting`） |
 * | `'touch'` | touch类 | `touch` 数组 |
 *
 * ## ★★ 多选时是"并成一个大池随机"，不是"先挑一类再类内随机"
 *
 * 勾中的类别各自算一个池，再**拼成一个大池**（`dialogue.mergeKindPools`，按 actionId
 * 去重、按 `chat`→`greet`→`touch` 归一出池）⇒ **池内每条等概率**，
 * 类别之间按各自的条目数加权。
 * ⚠️ 因此 `['chat','touch']` 时"条目多的那一类更容易被抽到"是**预期行为**，不是 bug。
 *
 * ★ **唯一例外**：某个通道**只勾 `greet` 一类**时改走 `dialogue.pickGreetingEntry`
 *   —— 否则「问候触发方式」（按系统时间 / 随机，`greetMode`）会静默失效。
 *   缺省值之所以选 `greet`（见 `TriggerChannel`）正是为了让"回到壁纸按时段问候"保持不变。
 *
 * ⚠️ 可触发 ≠ 一定会播：该类别的池为空时会被整类剔除（`resolveTriggerKinds`），
 *   真正要播时还要过 `touch.ts` 的动作闸门（自动事件不打断正在演的动作）。
 *
 * ★ 用户在**右上角设置面板 →「事件池」页**改，落盘即进覆盖层 ⇒ 与 `config.json` 里写的值
 *   **同名同语义**，只是优先级更高；**重载生效**。
 */
export type TriggerEventKind = 'chat' | 'greet' | 'touch';

/**
 * 触发通道 —— 三个「事件入口」，每个入口各有一项「可触发的事件」多选（2026-10-09 新增）。
 *
 * | 取值 | 面板设置项 | config 字段 | 触发时机 | 缺省 | 触发时给的 `ActionSource` |
 * |---|---|---|---|---|---|
 * | `'standby'` | 长时间待机可触发的事件 | `standbyKinds` | 静置超过 `standbyIdleMs` | `['chat']` | `'standby'` |
 * | `'touch'` | 触摸可触发的事件 | `touchKinds` | 点中任一热区（**用户操作**） | `['touch']` | `'touch'` |
 * | `'resume'` | 回到壁纸可触发的事件 | `resumeKinds` | 载入后延迟 / 回到桌面 / 回到前台 / WE 暂停恢复 | `['greet']` | `'greet'` |
 *
 * ## ★★ 三个缺省值刻意各自不同 —— 合起来 = "升级后行为与改动前逐字相同"
 *
 *   - 待机 `['chat']` ⇒ 还原"配了 `subtitle.standby`（休闲待机 64004）就一定会播"的老行为
 *     （2026-09-30 那次"出厂什么都不播"的回归就是在这里修的）；
 *   - 触摸 `['touch']` ⇒ 点击只取 `touch` 池（= 被删掉的旧布尔 `greetInTouchPool:false` 的行为）；
 *   - 回到壁纸 `['greet']` ⇒ 四个自动时机仍只播问候（旧 `tryGreeting` 的唯一口径）。
 *
 * ## 被删掉的旧设置
 *
 * ⚠️ 旧布尔 `subtitle.greetInTouchPool`（面板「touch触发greet事件」）**已删除** ——
 *   它的语义（"点击也能随机到问候"）现在由**「触摸可触发的事件」勾上 greet 类**表达，
 *   而且不再只是布尔开关：勾了它还会与 touch 类并池（见 `TriggerEventKind`）。
 *
 * ★ 命名与 `touch.ts` 的 `ActionSource`（`'touch' | 'greet' | 'standby'`）**刻意不同**：
 *   那是"谁触发的"，这里是"哪个入口" —— 二者只是名字像，不要互相套用
 *   （例如 `'resume'` 通道给出的 `ActionSource` 是 `'greet'`，因为它是自动问候那一路）。
 */
export type TriggerChannel = 'standby' | 'touch' | 'resume';

/**
 * **事件族（EventFamily）与它的注册表** —— 一条念白属于哪个「事件族」
 * （2026-10-10 引入；**2026-10-15 改为注册表制**）。
 *
 * ## 为什么是注册表
 *
 * 事件族最初是为**誓约（婚纱）皮肤**引入的（2026-10-10）：游戏原表
 * `CfgSoulSpineActionControlTable[603]` 里同一条动作在婚前后走两个动画
 * （`SoulActionState` / `MarryActionState`），于是把念白按「誓约前 / 誓约后 / 普通」
 * 三族分开，让用户决定点击时允许触发哪些族。原始判据 = **「婚后这一位会不会换人」**
 * （不是动画名）：`MarryAction{1,2,3}` 替换 `TouchFeedback{1,2,3}`，
 * 婚后位 1/2/3 换播别的动作、4/5/6 原样沿用。
 *
 * ⚠️ 但**不是每张皮肤都有这套机制**（如 S9 阿丝娜时装：10 条念白全无誓约态）——
 *   把三族写死在代码里 ⇒ 非誓约皮肤也会看到一个凭空冒出的「誓约前/誓约后事件」，
 *   而且**再加事件族就得改引擎**。故改为**注册表制**：有哪些族、叫什么名字、
 *   缺省勾谁、谁是缺省族，全部由 `config.subtitle.eventFamilies` 声明
 *   （与 `config.wallpaperSettings` 同一套"config 声明即建 UI"的口径）。
 *
 * ## 注册表项
 *
 * | 字段 | 必填 | 含义 |
 * |---|---|---|
 * | `id` | ✅ | 事件族 id —— 条目 `DialogueEntry.phase` 引用它。**自由字符串**，不再限定三种 |
 * | `label` | | 面板 / 档案里显示的**人话名**（如「誓约后事件」）。缺省回落成 `id` |
 * | `default` | | 面板**缺省勾选**（同时是 `touchPhases` 的缺省）。可标多个；都没标 ⇒ 只勾缺省族 |
 * | `fallback` | | **缺省族**（有且仅有一个）：条目未写 `phase` / 写了非法值时归入本族；**也决定「待机 / 回到壁纸」两个自动通道用哪一族**。都没标 ⇒ 取注册表第一项 |
 * | `matchSuffix` | | 可选的**动画名后缀**判据（取代原先写死的 `_marry` 启发式）：条目未写 `phase` 时，动画名以此结尾 ⇒ 归入本族（优先于缺省族）。誓约工程写 `"_marry"` 即可还原旧行为 |
 *
 * ## 条目 → 事件族的三段判据（`dialogue.resolveDialoguePhase`）
 *
 * ① 条目**显式 `phase`** 且是注册表里的 id ⇒ 就是它；
 * ② 否则按注册表各族的 `matchSuffix` 匹配动画名（先声明先赢）；
 * ③ 都不中 ⇒ 归入**缺省族**。
 *
 * ## 誓约工程（S8/603）怎么声明（示例口径，不是内置）
 *
 * ```jsonc
 * "eventFamilies": [
 *   { "id": "preMarry",  "label": "誓约前事件" },
 *   { "id": "postMarry", "label": "誓约后事件", "default": true, "matchSuffix": "_marry" },
 *   { "id": "normal",    "label": "普通事件",   "default": true, "fallback": true }
 * ]
 * ```
 * ⇒ 缺省勾「誓约后 + 普通」= 游戏誓约（婚后）状态那套可触发事件；缺省族是 `normal`。
 *
 * ⚠️ 分类在工程侧完成（`_work_星语心恋/17_注入S8语音字幕.py`），**不是游戏原样**。
 * ⚠️ `dialogue.buildPool` / `mergeKindPools` 仍是族感知的（去重键 `actionId|phase`）
 *   —— 这是防御：万一某份 config 把同一条 `actionId` 分别标了两个族，不会静默丢一条。
 *
 * ## 空的与没写的
 *
 * | `subtitle.eventFamilies` | 结果 |
 * |---|---|
 * | **没配 / 非数组 / 数组里一个合法项都没有（拼错）** | 内置缺省 = **只有一族 `normal`（普通事件，且为缺省族）** |
 * | **空数组 `[]`** | **本项目没有事件族机制**：面板不建「事件族」这一行、不按族筛（所有条目一视同仁） |
 * | 合法数组 | 原样归一（丢非法项、按 `id` 去重、保持声明顺序） |
 *
 * ⚠️ 空数组是**显式表达**（与 `standbyKinds` 的"空数组 = 全关"同一容错口径）；
 *   而"全是非法值"当作**没配**、退回内置缺省 —— 宁可降级也不要静默把机制关掉。
 */
export type EventFamily = {
  /** 事件族 id（条目 `phase` 引用的值）。**自由字符串** —— 想叫什么叫什么 */
  id: string;
  /** 面板 / 档案里显示的人话名。缺省回落成 `id` */
  label?: string;
  /** 面板缺省勾选（可标多个；都没标 ⇒ 只勾缺省族） */
  default?: boolean;
  /** 缺省族（唯一）：条目未标族时归入本族；也是自动通道用的那一族。都没标 ⇒ 取首项 */
  fallback?: boolean;
  /** 可选的动画名后缀判据（条目无 `phase` 时用它兜底）。誓约工程写 `"_marry"` */
  matchSuffix?: string;
};

/**
 * **事件族 id** —— 条目 `DialogueEntry.phase` 引用的值。
 *
 * ⚠️ 2026-10-15 由写死的联合类型 `'preMarry' | 'postMarry' | 'normal'` 放宽为
 * **自由字符串**：合法性只由 `config.subtitle.eventFamilies` 注册表判定（见 `EventFamily`）。
 * 引擎里**不再有任何内置族名**，也不再限定"誓约前/誓约后/普通"这几种。
 */
export type TriggerPhase = string;

/**
 * 念白字幕气泡配置。
 *
 * ## 样式出处
 *
 * 复刻对象是 `soulspinecell.prefab` **内嵌**的 `CvUIFrame`（不是独立模板
 * `ui/common/cvuiframe.prefab` —— 两份结构完全不同）。结构：
 *
 * ```
 * CvUIFrame     size=(420,150)
 * └ Talk        UISizeAdapter Min(260,60) Max(1700,750)  ← 气泡本体尺寸区间
 *   ├ Image_02  stretch sizeDelta=(-10,-16)  ← 第二层，内缩后再叠一层
 *   ├ Image_01  stretch sizeDelta=(0,0)      ← 第一层，满铺
 *   └ Text      sizeDelta=(-50,0) 横向 stretch
 *               白字 FontSize=20 / MiddleLeft / RichText / LineSpacing=1.05
 *               + ContentSizeFitter(纵向 PreferredSize)  ← 纵向随文字撑高
 * ```
 *
 * 底图 sprite = `MainUI_MainUI_Frame_01`（542×66，`m_Border=(65,25,65,25)`，
 * 纯黑 + alpha 102）。**两层叠加**后内区不透明度 = `1-(1-0.4)² = 0.64`、
 * 外圈仅 0.4 ⇒ "内深外浅"的那圈细边就是成品看到的框。
 *
 * ## 尺寸口径
 *
 * 所有"设计单位"（`minWidth` / `fontSize` / `paddingX` …）都是**游戏 750 高画布**下的值，
 * 渲染时统一乘 `视口高 / referenceHeight`。九宫格 `border` 同理按此比例缩放
 * （Unity 里 sprite border 是不随 CanvasScaler 缩放的，但壁纸要的是"复刻 750 高下的观感"，
 * 所以这里**刻意选择等比缩放**，保证任何窗口尺寸下观感一致）。
 */
export type SubtitleConfig = {
  /** 是否启用字幕气泡（缺省 **true**；false ⇒ 只播动作、不出字幕） */
  enabled?: boolean;
  /**
   * 气泡**背景皮肤**的完整配置（2026-09-20 新增）。
   *
   * ⚠️ 顶层 `image` / `border` / `innerInset` **仍被读取**（`skin` 缺失或字段缺省时回退到它们），
   * 但新配置请统一写在 `skin` 下 —— 三种模式共享同一组几何参数，分散在两个层级容易改漏。
   */
  skin?: SubtitleSkinConfig;
  /** 九宫格底图文件名（相对 `assets/`）。⚠️ 已并入 `skin.image`，保留兼容 */
  image?: string;
  /**
   * 九宫格边距，**源图像素**，顺序与 Unity `m_Border` 的 Vector4f 一致：
   * `(left, bottom, right, top)`。★ 顺序照抄 Unity，转换到 CSS 时由代码翻。
   * ⚠️ 已并入 `skin.border`，保留兼容
   */
  border?: { left: number; bottom: number; right: number; top: number };
  /**
   * 第二层底图相对第一层的内缩量（Unity `sizeDelta=(-10,-16)` 的一半：
   * 水平各内缩 5、垂直各内缩 8）。外圈那 5/8px 只有一层 ⇒ 形成"内深外浅"的框。
   * ⚠️ 已并入 `skin.innerInset`，保留兼容
   */
  innerInset?: { x: number; y: number };
  /** 气泡水平锚点（视口归一化 0~1）。0.42 = 画面偏左。
   *  ⚠️ 仅 `position: "custom"`（或缺省）时生效；`game` / `bottom` 用各自预设。 */
  anchorU?: number;
  /** 气泡**底边**的垂直位置（视口归一化 0~1）。0.90 = 距底部 10%。
   *  ⚠️ 仅 `position: "custom"`（或缺省）时生效；`game` / `bottom` 用各自预设。 */
  anchorV?: number;
  /**
   * 气泡位置预设（2026-09-23 新增，与 `anchorU/anchorV` 三选一）：
   *
   * - `"game"`（**推荐 / 本包缺省**）：复刻游戏实录位置 —— **以用户游戏截图实测反推**
   *   （1920×864 两次台词框位置一致：中心 u=0.5461、底边 v=0.1875，气泡在角色脚踝旁）。
   *   解包静态值只能给"相对 cell"的偏移（`CvUIFrame.ap=(-312,175)`），其绝对值对不上实测，
   *   两处原因（2026-09-24 查证）：①`Talk` 相对容器的锚定按 prefab 数字推导会差 145px
   *   （`anchor(0.5,1.0)` 按"父底边"代入才与实测差 5px）；②**cell 在页面里的摆放**
   *   （`SoulSpineCell.anchoredPosition`）从未解出，水平差 78px 出自这里。
   *   （旧推测"`RefreshPos` 运行时再偏移"已排除：反汇编显示它带 nil 守卫，而调用链
   *   `SoulSpineCell:Init` 无参 → `RefreshView` 透传 → 实参 nil ⇒ 不改位置。）
   *   故实测值分解为 `charAnchor(0.7753,0.176)` + `gameOffset(-389.6,+8.6)`
   *   （分母 = **解包画幅 1700×750**，不是 UI 的 CanvasScaler ref 1334×750）。
   *   换算公式见 `voiceBubble.ts` 的 `resolveAnchor`（结果=固定视口百分比）。
   * - `"bottom"`：底部居中（u=0.5、底边 v=0.90，= 代码缺省口径）。
   * - `"custom"`：沿用 `anchorU` / `anchorV`（改动前的行为，本包旧值 0.42/0.90 即"底部偏左"）。
   *
   * 缺省 `"custom"`（不写该字段 = 旧行为，老 config 不受影响）。
   */
  position?: 'game' | 'bottom' | 'custom';
  /**
   * `position: "bottom"`（**底部字幕条**）专属：气泡的**最大**宽度占视口宽比例。缺省 **0.9**。
   *
   * ⚠️ 语义（2026-09-25 定案）：气泡宽度**跟随文本**（`fit-content`），**不锁定**；
   * 本值只是折行上限 —— 短文本时气泡收窄，长文本到该比例才折行。
   * （早先版本曾把宽度锁成固定 90% 视口宽，短文本两侧大片空白，已废。）
   */
  bottomWidthRatio?: number;
  /**
   * `position: "bottom"` 专属：气泡底边距屏幕底部的距离（视口归一化，缺省 **0.1** = 10%）。
   * 换算：锚点 `anchorV = 1 - bottomMargin`。想让字幕更贴近屏幕底边就调小。
   */
  bottomMargin?: number;
  /**
   * `position: "game"` 的微调参数：可见气泡**底边**相对**角色锚点**的偏移，
   * 单位 = **解包画幅 1700×750 的设计 px**（y 向上为正）。
   *
   * ⚠️ 分母是 **1700×750**（美术/壁纸设计画幅），**不是** UI 的
   * `CanvasScaler.ref = 1334×750` —— `CvUIFrame` 挂在角色 cell 上，按美术画幅归一。
   * 缺省 = **实测反推值** `{ x: -389.6, y: 8.6 }`（来源与取舍见 `position` 注释；
   * x 吸收了"cell 页面摆放"这一未解出偏差，y≈0 实证 `RefreshPos` 运行时再偏移）。
   * 归一化结果即**固定视口百分比**（画幅自适应下不随窗口比例漂移）。
   * 觉得位置不对时**只改这里**（免重建），不必动代码。
   */
  gameOffset?: { x: number; y: number };
  /**
   * `position: "game"` 的基准点：**角色锚点**（游戏 `SoulSpineCell` 挂载点，即
   * Spine 骨架 `Point_Root`）在本壁纸视口中的归一化坐标。
   *
   * ★ **坐标系：u 从左、v 从底**（几何直觉，与画布 y 同向）—— 注意与 frame 消费的
   * `anchorV`（距顶比例）相反，`resolveAnchor` 会做一次翻转。
   * 缺省 `{ u: 0.7753, v: 0.176 }` —— 由骨架挂载 `Point_Root` 画布坐标 (434, −243)
   * （画布 1700×750、原点居中、相机横移 cameraX=−33.96）换算：
   * `u = 0.5 + (434 + 33.96)/1700`、`v = 0.5 − 243/750`。
   * 改了场景摆位才需要同步改这里。
   */
  charAnchor?: { u: number; v: number };
  /**
   * 气泡宽度上限（占视口宽比例）。
   *
   * ⚠️ **已由 `wrap` 取代**，保留仅为向后兼容（`wrap.viewportRatio` 缺失时读它）。
   * 新配置请用 `wrap`。
   */
  maxWidthRatio?: number;
  /**
   * 自动换行阈值的算法。缺省 = `{ mode: 'viewport', viewportRatio: 0.72 }`（= 旧行为）。
   */
  wrap?: SubtitleWrapConfig;
  /** 最小宽度（设计单位） */
  minWidth?: number;
  /** 最小高度（设计单位） */
  minHeight?: number;
  /** 字号（设计单位） */
  fontSize?: number;
  /** 行距倍率（= Unity `lineSpacing` 1.05） */
  lineSpacing?: number;
  /** 文字左右内边距（设计单位，= Text 的 sizeDelta.x/2 = 25） */
  paddingX?: number;
  /**
   * 文字**上下**内边距（设计单位）。缺省 **20**（≈ 游戏 1 行气泡的纵向内缩）。
   *
   * ★ 历史教训：`voiceBubble.ts` 早期只给 `paddingX`、上下写死 0 ⇒ 3~4 行文本时
   * 文字直接贴住黑底上下边、上下留白几乎为零。本字段补上纵向呼吸空间。
   */
  paddingY?: number;
  /**
   * 文字水平对齐。`game` / `custom` 缺省 `left`（贴合游戏 `MiddleLeft`）；
   * `bottom`（字幕条）缺省 `center`。可用本字段强制覆盖。
   */
  textAlign?: 'left' | 'center';
  /** 淡入/淡出时长（毫秒） */
  fadeMs?: number;
  /** 设计基准高度：一切"设计单位"× `视口高 / 本值` */
  referenceHeight?: number;

  /* ── 语音 ────────────────────────────────────────────── */

  /** 语音播放配置。缺省 = 启用、音量 1.0、目录 `./assets/voice/` */
  audio?: SubtitleAudioConfig;

  /* ── 数据 ────────────────────────────────────────────── */

  /** 念白条目总表（**唯一数据源**；下面三条事件列表只用 actionId 引用它，避免文案写两遍） */
  dialogues?: DialogueEntry[];

  /**
   * ═══════ 三条「可触发事件」列表（2026-10-08 起统一为**数组**）═══════
   *
   * **"哪些事件可能被触发"的唯一真相就在这三个数组里**（不再是"单条 id + 代码里的 if"），
   * 用户可以自由增删 —— 例如下面这份抄自游戏 `CfgSoulSpineActionControlTable`：
   *
   * ```json
   * "greet": [64001, 64002, 64003],
   * "chat":  [64004],
   * "touch": [64005, 64006, 64007, 64008, 64009, 64010]
   * ```
   *
   * 想多一条候选就在数组里加一个 actionId，**不需要重建 bundle**。
   * 三条列表的元素都必须是 `dialogues` 里存在的 actionId —— 找不到的 id 会被
   * **静默跳过**（见 `dialogue.buildPool` 的注释），所以写错一个数字只会"少一条候选"，
   * 不会让整类事件失效。
   *
   * | 列表 | 触发时机 | 取条方式 |
   * |---|---|---|
   * | `greet` | 「回到壁纸可触发的事件」勾了 greet类（缺省）时的四个自动时机 | 由 `greetMode` 定：按时段下标 或 随机 |
   * | `chat` | 待机 / 触摸 / 回到壁纸 三个入口里任意一个勾了 chat类 | 池内随机 |
   * | `touch` | 「触摸可触发的事件」勾了 touch类（缺省）；待机/回到壁纸也可勾 | 池内随机 |
   *
   * ⚠️ 三条列表**互不排斥**：同一个 actionId 写进多个列表完全合法（例如把 64005
   *    同时放进 `touch` 和 `chat`）；**并池时的去重**在 `dialogue.mergeKindPools` 里做，
   *    这里按用户写的原样保留。
   */
  /**
   * **问候（greet）事件池**。`greetMode==='time'` 时按下标对位时段，详见上面的表格。
   *
   * ⚠️ **空数组视同没配** ⇒ 退回旧时段表 `greeting`（判据 `dialogue.resolveGreetSource`，
   * 与 `chat: []` 退回 `standby` **同一口径**）—— 照抄 `config.example.json` 的空数组
   * 不该把整类问候静默关掉。
   */
  greet?: number[];
  /**
   * **聊天（chat）事件池** —— 「长时间无互动」到点后可触发的那些念白。
   *
   * ★ 2026-10-08 由旧的单值字段 `standby` 升级为数组：**"待机该说什么"从此由用户说了算**。
   */
  chat?: number[];
  /** **触摸（touch）事件池**：命中热区时从这里**随机**取一条（动作+字幕同源，天然配套） */
  touch?: number[];

  /** 播放动作事件时的触摸反馈策略（缺省 `'legacy'` = 旧版行为）。详见 `TouchFeedbackMode` 的表格 */
  touchFeedbackMode?: TouchFeedbackMode;
  /** 问候事件的取条方式（缺省 `'time'`）。详见 `GreetMode` 的表格 */
  greetMode?: GreetMode;

  /**
   * ⚠️ **旧口径**：按时段映射的问候 actionId（如 `{morning:64001,...}`）。
   *
   * 已被 `greet` 数组取代 —— 保留仅为向后兼容：**没配 `greet`、或 `greet` 是空数组**时
   * （判据见 `dialogue.resolveGreetSource`），由 `dialogue.normalizeGreetIds` 按
   * `SLOT_ORDER` 顺序把这里的值摊平成数组，旧 config 的行为逐字不变。
   * **新配置请一律用 `greet` 数组。**
   */
  greeting?: Partial<Record<DialogueSlotKey, number>>;
  /** 问候时段分界（小时）。缺省见 `dialogue.ts` 的 `DEFAULT_TIME_RANGES` */
  greetingRanges?: Partial<Record<DialogueSlotKey, DialogueTimeRange>>;
  /** 加载完成后延迟多久尝试播问候（毫秒；同时用于"回到桌面"信号的去重窗口基准） */
  greetingDelayMs?: number;
  /**
   * 待机阈值：空闲多久没交互就触发一次「待机自动播放」（毫秒）。缺省 **25000**。
   *
   * 到点后播哪几类事件由 **`standbyKinds`** 决定（见该字段）；**三类共用一个阈值**
   * （面板上是同一个滑块「待机触发事件时长」）。
   *
   * ★ 用户可在壁纸右上角「设置 → 事件触发 → 待机触发事件时长」里改（以秒为单位，5~300 秒），
   * 落盘后经 `settingsStore.applyOverrides` 覆盖本字段并**重载生效**。
   */
  standbyIdleMs?: number;
  /**
   * **事件族注册表** —— 本项目有哪些事件族（2026-10-15 起由写死的三族改为**注册表制**）。
   *
   * ★★ **没配** ⇒ 内置缺省**只有一族 `normal`（普通事件）** ⇒ 非誓约皮肤看不到
   *   「誓约前 / 誓约后事件」；誓约皮肤（如 S8/603）在这里显式声明三族即可逐字还原旧行为
   *   （示例见 `EventFamily` 的注释）。
   * ⚠️ 显式写**空数组 `[]`** = 本项目**没有**事件族机制 ⇒ 面板不建「事件族」行、不按族筛。
   *
   * ★ 各族的 `default` / `fallback` / `matchSuffix` 语义、以及"条目 → 族"的三段判据，
   *   全部见 `EventFamily`。
   * ★ 面板：「设置 → 事件池 → 事件族（仅点击触摸）」只在注册表非空时出现。
   */
  eventFamilies?: EventFamily[];
  /**
   * **长时间待机可触发的事件（多选）**——`TriggerEventKind` 的子集，通道 `'standby'`。
   *
   * ★★ **缺省（本字段没配时）= `['chat']`**：还原"配了 `standby` 就一定会播"的老行为，
   *   也修掉 2026-09-30「出厂两个开关都关 ⇒ 待机什么都不播」的回归。
   * 取值域、并池口径、可用性判据与**空数组 = 显式全关**，见 `TriggerEventKind` 注释。
   *
   * ★ **旧口径（兼容输入）**：本字段缺席时，由下面两个布尔推导 —— 见
   *   `dialogue.resolveTriggerIntent`。旧 config 因此**行为逐字不变**（外加还原 `chat`）。
   */
  standbyKinds?: TriggerEventKind[];
  /**
   * **触摸可触发的事件（多选）**——`TriggerEventKind` 的子集，通道 `'touch'`。
   *
   * 触发时机 = **点中任一触摸热区**（用户操作，`ActionSource = 'touch'`，
   * 所以它会按「播放动作时点击」那一档去打断/排队/忽略）。
   *
   * ★★ **缺省（本字段没配时）= `['touch']`** ⇒ 点击只从 `touch` 数组里随机取，
   *   与改动前完全一致（= 被删掉的旧布尔 `greetInTouchPool:false`）。
   *   想要"点角色也能触发问候"就勾上 **greet类** —— 此时 greet 池与 touch 池**并池随机**
   *   （按条目数加权），这正是旧 `greetInTouchPool:true` 的行为。
   *   勾 **chat类** 是新增能力：点击也能随机到闲聊那几条。
   *
   * ★ 面板：「设置 → 事件池 → 触摸可触发的事件」；**保存后重载生效**
   *   （触摸池是 `createTouchController` 开机一次性构造的）。
   */
  touchKinds?: TriggerEventKind[];
  /**
   * **触摸可触发的事件族（多选）**—— [`eventFamilies`] 注册表 id 的子集，
   * **只作用于 `'touch'` 通道**（2026-10-10 新增，面板「事件池」页）。
   *
   * 与 `touchKinds` 是**两层筛子**，先族后类：
   *   ① 先按本字段把候选条目**筛成勾中的族**（族的定义见 `eventFamilies`）；
   *   ② 再在勾中的 `chat类 / greet类 / touch类` 里按 `mergeKindPools` 并池随机。
   *
   * ★★ **缺省（本字段没配时）= 注册表的缺省勾选**（各族里标 `default: true` 的那些；
   *   一个都没标 ⇒ 只勾**缺省族**）。誓约工程声明三族时只需给 `postMarry`/`normal`
   *   标上 `default` 即可还原原来的 `['postMarry','normal']`。
   *   ⚠️ 显式写空数组 `[]` = 显式全关 ⇒ 一族都不出条 ⇒ 触摸池为空，
   *      此时 `touch.ts` 会**退回"只随机挑动画名、不出字幕"**的兜底行为（不是报错）。
   *   ⚠️ 与 `standbyKinds` 同一容错口径：写了数组但一个合法值都没有（拼错）⇒ 当作"没配"退回缺省。
   *
   * ★ 待机 / 回到壁纸两个通道**不受本字段影响** —— 它们只用**缺省族**的条目
   *   （`eventFamilies` 里标 `fallback` 的那一族）。
   * ★ 面板：「设置 → 事件池 → 事件族（仅点击触摸）」（2026-10-11 起是**该页最后一行**：
   *   上面三行是三个入口同构的"可抽到哪些类别"，本项是挂在其中一个入口上的第二层筛子）；
   *   ⚠️ **注册表为空时不建这一行**；**保存后重载生效**（触摸池是开机一次性构造的）。
   */
  touchPhases?: TriggerPhase[];
  /**
   * **回到壁纸可触发的事件（多选）**——`TriggerEventKind` 的子集，通道 `'resume'`。
   *
   * 触发时机 = **四个自动信号**（`ActionSource = 'greet'`，自动事件一律不打断正在演的动作）：
   *   ① 壁纸载入后延迟 `greetingDelayMs`；② 页面重新变为可见（"回到桌面"）；
   *   ③ 窗口重新获得焦点；④ Wallpaper Engine 暂停后恢复且离开 ≥ 15 秒。
   *   ⚠️ ②③ 在 WE 里默认收不到（桌面壁纸窗口常驻"可见"），属零成本的尽力而为；
   *      ④ 要求用户在 WE 里把「其他应用全屏/最大化时」选成**暂停**。
   *   相邻两次触发至少间隔 5 秒（`index.ts` 的 `GREETING_DEDUPE_SEC`）——
   *   几个信号常在同一时刻接连到来，没有这层会"一句话连播三遍"。
   *
   * ★★ **缺省（本字段没配时）= `['greet']`** ⇒ 与改动前逐字一致（只播问候，
   *   取条方式仍由 `greetMode` 决定）。勾 chat类 / touch类 是新增能力。
   */
  resumeKinds?: TriggerEventKind[];
  /**
   * ⚠️ **旧口径**：「休闲待机」那一条念白的 actionId（S9 = 64004）。已被 `chat` 数组取代。
   *
   * 保留仅为向后兼容：**没配 `chat` 时**，`dialogue.resolveChatIds` 会把它当成
   * `chat` 池的唯一一条（旧 config 行为逐字不变）。**新配置请一律用 `chat` 数组。**
   */
  standby?: number;
  /**
   * ⚠️ **旧口径**（兼容输入）：待机到点是否也自动触发「问候」（greet）事件。
   *
   * 已被 `standbyKinds` 数组取代 —— **只在本字段缺席时**由 `resolveTriggerIntent` 读取：
   * `true` ⇒ 往意向里追加 `'greet'`（取条方式由 `greetMode` 决定，与"回到壁纸"那一路
   * 共用同一个 `pickGreetingEntry` 和 5 秒去重窗口）。
   * ⚠️ 旧口径下 `'chat'` **恒在**，所以本字段为 `false` **不会**把待机闲聊一起关掉。
   * **新配置请一律用 `standbyKinds`。**
   */
  standbyGreetEnabled?: boolean;
  /**
   * ⚠️ **旧口径**（兼容输入）：待机到点是否也自动触发「触摸」（touch）事件。
   *
   * 已被 `standbyKinds` 数组取代 —— **只在本字段缺席时**读取：`true` ⇒ 追加 `'touch'`
   * （池 = `touch` 数组）。
   * **新配置请一律用 `standbyKinds`。**
   */
  standbyTouchEnabled?: boolean;
};

export type ActionAnimation = {
  animationName: string;
  boneName: string;
  maxFollowDistance: number;
};

type MeshConfig = {
  scale: number;
  position: {
    x: number;
    y: number;
    z: number;
  };
};

export type SpineMeshConfig = MeshConfig & {
  type: 'spine';
  skeletonFileName: string;
  jsonFileName: string;
  atlasFileName: string;
  animationName: string;
  cursorFollow?: ActionAnimation;
  cursorPress?: ActionAnimation;
  /**
   * **水平镜像**（缺省 false）—— 复刻 Unity UI 的 `localEulerAngles.y = 180°`。
   *
   * 为什么需要它：`Freesia_S6_Background` 的 `Layer_04` 挂了**两份同一个骨架**
   * （`Bg_02` @(-558,-250) 与 `Bg_03` @(603,-228)），第二份靠绕 Y 轴 180° 镜像。
   * 一个 SpineMeshConfig 只能加载一份骨架，所以必须由 config 声明"这一份要镜像"。
   *
   * 实现 = 给承载 mesh 的父节点设 `scale.x = -1`（绕该 mesh 自身原点镜像，
   * 与 Unity 绕节点 pivot 转 180° 等价）；骨架内部数据一个字不动 ⇒ 不影响任何既有行为。
   */
  flipX?: boolean;
  /**
   * **这一层是不是「角色骨架」**（缺省 = 由启发式判定）。
   *
   * ## 它决定什么
   * 只有"角色骨架"才会：挂**触摸控制器**（点击热区 → 播动作 + 字幕 + 语音）、
   * 往 `animationDurations`（动画名 → 时长）里写、并接管**常驻动作序列** `idleSequence`。
   *
   * ## 为什么需要显式声明（2026-10-13 蝶语吟花踩到）
   * 原判据是纯启发式 —— `touchNames = 骨架里除 animationName 外的动画；isCharacter = touchNames.length > 0`
   * （见 `index.ts`）。这对"挂件骨架只有一个动画"成立，但**挂件只要多带一个动画就会被误判成角色**：
   * `SoulDress_Freesia_06_BJ_04.skel` 有 `['idle','idle2']` ⇒ `touchNames=['idle2']` ⇒ 被当成角色，
   * 于是**后遍历到的挂件把 `animationDurations` 整张表覆盖成 `{idle, idle2}`、
   * 并抢走 `touchController`** ⇒ 触摸/问候/待机全部静默失效（点了没反应、也不报错）。
   *
   * ⇒ 显式字段把"谁是角色"从猜测变成声明。**缺省不写 ⇒ 仍走原启发式**，
   *   老工程（S8/S9）行为逐字不变。
   *
   * ⚠️ 一个工程里**应当只有一层写 `true`**（引擎侧只有一份 `touchController` /
   *   一份字幕气泡）。多层写 `true` 时后者会覆盖前者的读数（用户点击仍各自生效），
   *   属于未支持用法。
   */
  isCharacter?: boolean;
};

export type TextureMeshConfig = MeshConfig & {
  type: 'texture';
  width: number;
  height: number;
  textureFileName: string;
  tilesHorizontal: number;
  tilesVertical: number;
  numTiles: number;
  tileDisplayDuration: number;
  /**
   * 该层是「黑遮幅」，值为它贴在可视窗口的哪一边（游戏 `Layer_05_Limit` 的 4 条）。
   *
   * 遮幅的职责是**盖住超出「设计画幅」的部分**：
   * - 游戏按高取景 ⇒ 纵向恒 = 设计高、永不超出 ⇒ **上下两条永不显示**；
   * - 超宽屏（A > 1700/750 ≈ 2.267）横向超出 ⇒ **左右两条生效**（这才是它们存在的意义）。
   *
   * ## 为什么需要这个字段（2026-10-12 修）
   *
   * 壁纸侧的 `'width'` 基准把「可见宽」锁成设计宽，于是**纵向**随视口比例被放大：
   * `可见高 = 1700 / A`。视口比设计画幅窄时（16:10 的 A = 1.6 ⇒ 可见高 1062.5 > 设计高 750）
   * **纵向超出设计画幅** ⇒ 钉在世界坐标上的下遮幅**侵入可见区**，在画面底部变成
   * 一条 **104px 的大黑带**（1920×1200 实测；去掉该层后黑带 → 0，已交叉验证）。
   *
   * 用户诉求是「按宽 = 完整看设计画幅」，这与「上下遮幅盖住纵向超出部分」直接冲突
   * ⇒ 取 `'width'` 时把带本标记的层**整体剔除**：不建 mesh、不加载贴图、也不参与露黑检测。
   *
   * ⚠️ 对 `'height'`（缺省）**零影响** —— 上下两条本来就不显示，左右两条在超宽屏下照常生效。
   * ⚠️ 老工程不带本字段 ⇒ 行为完全不变。
   */
  limitEdge?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * ★ 自转角速度（度/秒，带符号；正 = 屏幕逆时针，与 Unity UI 的 +Z 同向）。
   *
   * 来源：Unity prefab 上的 `TweenRotation` 组件。S8 背景树里只有
   * `Asuna_S8_Background/Bottom/Image_00_Anim`（贴图 `_05` 星轨）带自转：
   *   `{method:0(Linear), style:1(Loop), duration:90.0, from.z:0, to.z:360}`
   * ⇒ **持续 360°/90s = +4.0 °/s**。其余贴图层没有该组件。
   *
   * 缺省 `0` / 未给 ⇒ 完全维持旧行为（静态），不影响任何现存工程。
   */
  spinDegPerSec?: number;
};

export type VideoMeshConfig = MeshConfig & {
  type: 'video';
  width: number;
  height: number;
  videoFileName: string;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * particle —— Unity ParticleSystem 的参数化移植（新增的第 4 种 mesh 类型）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 为什么要有这一种：游戏里"摩天轮/轿厢、云、心形气球、飞鸟、星点、扫光"这 8 样
 * 全是 **Unity ParticleSystem**，既不是 UI Image 图层、也不是 Spine 动画，
 * 所以"照 prefab 的 Image 节点复刻分层背景"那条路天然拿不到它们。
 *
 * 长度量（speed / size / radius / length / magnitude）**统一用 prefab 单位**给出，
 * 由 `unitScale` 一次换算到 three.js 世界单位。这样 config 里的数字可以逐项
 * 跟游戏包内的 typetree 数值对照（便于回归），换算只有一处乘法。
 */
export type ParticleMinMax = {
  /** 0=常量(取 a) 1=曲线(a × keysA) 2=随机两常量(random(a,b)) 3=随机两曲线
   *  ⚠️ 实测本套数据里 state 1/3 的曲线**关键帧为空**（Unity 把常量存在 a/b 里），
   *  故空曲线时按常量处理，不能当成 0。 */
  mode: number;
  a: number;
  b: number;
  /** maxCurve 的关键帧 [[t,v],...]，t∈[0,1]（按寿命归一化） */
  keysA?: number[][];
  /** minCurve 的关键帧 */
  keysB?: number[][];
  /**
   * ── 以下 4 项只在**带关键帧**时可能用到（2026-10-13 新增）──
   * 对应 Unity `AnimationCurve` 的端点外推：序列化字段 `m_PreInfinity` / `m_PostInfinity`。
   *
   * 取值：`0 = Constant`（保持端点值，**缺省 = 旧行为**）、`1 = Linear`（按端点切线线性外推）、
   * `2 = Cycle`（整条曲线循环）、`3 = CycleWithOffset`（循环并累加落差）、`4 = Oscillate`（乒乓）。
   *
   * ★★ 为什么必须带上：`hudie01 ×3` 的 `frameOverTime` 是全部 19 个已采样粒子系统里
   *   **唯一** post = **Linear**（1）的 —— 末键在 t=0.0826 / 值 0.945 / outSlope 11.4415，
   *   线性外推到 t=1 得 11.4415 ⇒ 帧号在寿命内连续推进 183 帧（≈11.4 遍图集）= **持续扇翅**。
   *   缺了它、只钳在末键 ⇒ 扇一次就定住（用户报的"蝴蝶不摆翅膀"）。
   *   其余系统不是 post = 2(Cycle)（且末键就在 t=1，永不触发）就是没有关键帧 ⇒ **零影响**。
   */
  pre?: number;
  post?: number;
  /** 首键 `inSlope`（`pre = Linear` 时用） */
  headSlope?: number;
  /** 末键 `outSlope`（`post = Linear` 时用） */
  tailSlope?: number;
};

export type ParticleMeshConfig = MeshConfig & {
  type: 'particle';
  /** 系统名（= prefab 里的节点名），仅用于调试/HUD */
  name: string;
  textureFileName: string;
  /**
   * `_mask` 槽的贴图名；**空槽 = 采样返回 (1,1,1,1)**（Unity 默认白图），
   * 此时省略该字段即可 —— 8 个系统里只有 `saoguang` 有值（`FX_cf_saoguang012`）。
   *
   * ★ 注意载体：`UVliudong` 的片元取的是 `_mask` 的 **rgb**（不是 alpha），
   * 所以这张必须是**灰度图**。08 阶段合成的"alpha 型"（rgb 全白、alpha 均值 36）
   * 会让遮罩完全失效 —— 那正是"扫光是一条粗白带"的直接原因之一。
   */
  maskFileName?: string;
  /** Unity 粒子材质：多数普通混合；star / saoguang 是加色 */
  blend: 'normal' | 'add';
  /**
   * 材质 `_Alphe`（片元亮度乘子，直读自 `m_SavedProperties.m_Floats`）。
   * 实测：star=1.5 / yun·niao·motianl·chexiang·chexiang(1)=1.05 / qiqiu·saoguang=1.0。
   * 两支 shader 的片元**都**乘它 ⇒ 漏抄会让 star 差 1.5 倍、其余差 0~5%。
   */
  alphe: number;
  /**
   * 粒子 startColor（InitialModule.startColor 的 maxColor；mode=Color ⇒ 出生时在
   * minColor~maxColor 间随机，本套数据 minColor 恒为白 ⇒ 取 maxColor 即上界）。
   * 实测只有 star / saoguang 不是白：**淡蓝 + alpha=0.5098(=130/255)**。
   * 漏乘它会让这两个系统既偏亮又丢色偏。
   */
  startColor: [number, number, number, number];
  /**
   * ★★ **逐粒子随机起始色**（`MinMaxGradient` 的梯度侧，2026-10-13 新增）。
   *
   * 为什么必须有它：Unity 的 `startColor` 有 5 档（`ParticleSystemGradientMode`）：
   *   0=Color / 1=Gradient / 2=TwoColors / 3=TwoGradients / **4=RandomColor**。
   *   除 0（和 2 的纯色随机）外，**每颗粒子在梯度上随机取一点、终生不变**。
   *   蝶语吟花 `yuan_glow` 是 **mode=4**：颜色键 淡青→蓝→紫，
   *   alpha 键 `(0)→0.588`、`(1)→0.275` ⇒ 逐粒子 alpha ∈ **[0.275, 0.588]**（均值 0.43）。
   *   旧实现只把梯度拍平成 `startColor=(1,1,1,1)` ⇒ 每颗都按 alpha=1 画：
   *   实测「同时可见 9 个全亮光圈」，而实录只有 4~6 个、明暗差异极大（2026-10-13 定位）。
   *
   * 缺省（`undefined`）⇒ 退回下面的 `startColor` 常量，与旧 config 逐位一致。
   * `mode=3` 时另带 `minColorKeys`/`minAlphaKeys`：逐粒子在 max↔min 两梯度间随机 lerp。
   */
  startColorGradient?: {
    mode: number;
    /** `[[t, [r,g,b]], ...]`，t∈[0,1]（颜色键的时间轴与 alpha 键**各自独立**） */
    colorKeys: Array<[number, number[]]>;
    /** `[[t, a], ...]`，t∈[0,1] */
    alphaKeys: number[][];
    minColorKeys?: Array<[number, number[]]>;
    minAlphaKeys?: number[][];
  };
  /** 世界单位 / prefab 单位（= wpp × k，随本系统的 z 平面而变） */
  unitScale: number;
  /** 节点 localScale（游戏原值 30 / 7.871…）。噪声在粒子系统**本地未缩放空间**采样，
   *  需要它才能把 prefab 单位的坐标折回去 */
  localScale: number;
  /**
   * 视觉尺寸总缩放系数，默认 1。
   *
   * ★ 这是一个**全局等比**旋钮（不再按系统分别给值）。原实现只对 star/saoguang
   * 给 0.1、其余给 1，**破坏了包内的相对尺度** —— 恒等式
   * `px = startSize × localScale × 1.581176`（与 z 无关）下，star 会比同伴小 33 倍、
   * saoguang 小 17 倍，而游戏里它们只是"小一点"而非"小两个数量级"。
   * 因此改回"8 个系统同一个系数"，只整体等比缩放，保持彼此比例。
   *
   * 只作用于尺寸，不影响速度 / 形状半径 / 发射位置。
   */
  sizeScale?: number;
  /**
   * `startDelay`（秒）：系统每周期延后多久才发射。直读自 typetree 顶层
   * （与 `lengthInSec` / `scalingMode` 同级）。本套只有 **star = 0.9 s** 非零，
   * 其余 7 个为 0 ⇒ 这是"扫光消失时星星出现"的机制本身。
   */
  startDelay: number;
  /** 节点的 Z 轴旋角（度）—— 决定 Circle 形状上粒子的初始相位 */
  nodeRotZ: number;
  /** 本地 +Z 经节点四元数旋转后投影到 XY 并归一化（发射方向）；无分量时给 [0,0] */
  emitDir: [number, number];
  /** Unity lengthInSec：系统循环周期。burst 在每周期内按 time 重新触发 */
  cycleSec: number;
  maxNumParticles: number;
  prewarm: boolean;
  /**
   * 是否**开场就自动跑**（缺省 **true** = 现状，老 config 零影响）。
   *
   * ★★ 为什么需要它（2026-10-14，`config.actionEffects` 配套）：
   *   游戏里的「动作特效 prefab」（`FX_Freesia_S6_Background_chat` 这类）是
   *   **动作播的那一刻才 Instantiate**、播完销毁 —— 它的 `playOnAwake = true`
   *   只对"被实例化出来的那个 prefab"成立。
   *   而壁纸侧这些系统是**常驻 mesh**：若照 `playOnAwake` 自动跑，页面一加载
   *   就会把 burst（`bao` / `shan` 这类一次性特效）当场放掉，之后点击反而不见了。
   *
   *   ⇒ 这类组一律写 `autoplay: false`：**开场不发射、不推进系统时钟**，
   *     等 `config.actionEffects` 触发 `ParticleAnimator.restart()` 时才从 0 开始跑。
   *
   * 语义边界（如实标注）：
   *   · 只挡"**发射**"。构造时若 `prewarm: true` 也不预热（预热本身就是发射的模拟），
   *     一次性特效本来也不该预热 —— 本工程两支特效 `prewarm` 均为 false。
   *   · `restart()` 会把它置为已启动，所以"触发 → 重播"这条路不受影响。
   *   · 与 `mesh.visible` 无关：本引擎的可见性一直由 `setDrawRange` 按存活粒子数决定，
   *     没有粒子可画 = 不可见。
   */
  autoplay?: boolean;
  /**
   * Unity `ParticleSystem.MainModule.looping`（缺省 **true** = 现状，老 config 零影响）。
   *
   * 语义（Unity 官方）：`looping` 打开 ⇒ 一个 `lengthInSec`（= 本 config 的 `cycleSec`）
   *   的发射周期结束后**重复**；关闭 ⇒ **只跑一个周期就停**（已发射的粒子照旧走完寿命）。
   *
   * ★★ 为什么需要它（2026-10-14，`config.actionEffects` 配套）：
   *   动作特效 prefab 里的系统**全是 `looping = false`**（`_chat` 的 bao/glow01/lizi_san/shan、
   *   `_touch2` 的两簇花瓣）。它们的意图是"动作触发 → 放一次 → 结束"，配合
   *   `startDelay`（`_chat` 是 **7 s**、`_touch2` 是 1.6/1.7 s）落在 10.667 s 的动作里。
   *   引擎原先**只有 `cycleSec`**、没有 `looping` 概念 ⇒ 同一段 burst 会每 `cycleSec`
   *   （1.0~1.3 s）重放一次、**永远不停**，与"一次性特效"完全不符。
   *
   * 语义边界：
   *   · 只挡**发射**：emit 窗口 = `[startDelay, startDelay + cycleSec)`，只走第 0 个周期；
   *     窗口内已发射的粒子仍按各自寿命正常演化、淡出。
   *   · `restart()` 会把周期计数与 `stopped` 一起复位 ⇒ 每次触发都完整重放一遍。
   *   · **缺省 true** ⇒ 既有 22 层逐位不变（本项目背景层里 `hua01`/`hua02` 数据上也是
   *     `looping=false`，但既有观感是按"每 20 s 一轮"验收的，故**本次不给它们下发该字段**，
   *     保持零回归；如需严格逐值复刻可后续单独开）。
   */
  looping?: boolean;
  startLifetime: ParticleMinMax;
  startSpeed: ParticleMinMax;
  startSize: ParticleMinMax;
  startSizeY: ParticleMinMax;
  startSizeZ: ParticleMinMax;
  size3D: boolean;
  startRotation: ParticleMinMax;
  /**
   * Unity `InitialModule.gravityModifier` —— **缩放 `Physics.gravity`**（官方：
   * "Gravity Modifier: Scales the gravity value set in the Physics window.
   * A value of zero switches gravity off."）。0 ⇒ 关闭。
   *
   * ★★ 2026-10-13 补上（审计发现的唯一"解包有值、引擎没实现"的字段）：
   *   蝶语吟花 11 个系统里只有 **`huaban (1)` = 0.05**，其余全 0。
   *   加速度 = `gravityModifier × Physics.gravity`（默认 (0, −9.81, 0)），
   *   且本工程 `scalingMode = 0`(Hierarchy) ⇒ 还要乘 transform 的 lossyScale，
   *   与 `velocity` 同口径（引擎里再乘 `localScale × unitScale`）。
   *   ⇒ 世界加速度 = `−0.05 × 9.81 × localScale × unitScale` ≈ −15.2 世界单位/s²（向下）。
   *
   * ⚠️ 假设：`Physics.gravity` 保持 Unity 默认 (0, −9.81, 0)（游戏未改物理设置；
   *    解包数据里也没有 per-system 的重力矢量可读，只有这个标量倍率）。
   * 缺省 0 ⇒ **旧 config 零影响**。
   */
  gravityModifier?: number;
  /** RotationModule（rotationOverLifetime），单位弧度/秒 */
  rotationEnabled: boolean;
  rotationCurve: ParticleMinMax;
  /**
   * `VelocityModule`（Velocity over Lifetime）。
   *
   * ★ P2（2026-10-16）补齐 `z` / `orbital` / `orbitalOffset` / `radial` / `space`；
   *   全部新字段**可选且缺省视为"关闭/零"** ⇒ 旧 config 逐位无影响。
   *   语义依据见 `docx/RESEARCH_粒子系统复刻参考.md` §5（`_p2_` 那几条）。
   */
  velocity: {
    enabled: boolean;
    x: ParticleMinMax;
    y: ParticleMinMax;
    speedModifier: number;
    /**
     * z 轴线性速度（prefab 单位/秒）。
     *
     * ⚠️ 本引擎是 **2D 渲染**：z **不参与渲染位置**（粒子恒在其 mesh 的 z 平面上），
     *   所以 z 速度**唯一可见的作用**是进入"速度大小" `|v| = hypot(vx, vy, vz)`，
     *   进而影响 `ColorBySpeed` / `SizeBySpeed` / `RotationBySpeed` 的取样位置。
     *   （Unity 里 z 还会让粒子远离/靠近相机 ⇒ 透视缩放，本引擎没有这层，如实标注。）
     */
    z?: ParticleMinMax;
    /**
     * `inWorldSpace`：0 = Local（缺省）、1 = World。
     *
     * Local ⇒ x/y 是**发射器本地坐标**下的速度，要按节点旋角转回世界
     * （既有行为，见 `Particle.localRot`）；World ⇒ 直接用、不转。
     * ⚠️ 既有 config **没有这个字段** ⇒ 缺省 0 = Local = 现状。
     */
    space?: number;
    /** 绕 X 轴的轨道角速度（**弧度/秒**） */
    orbitalX?: ParticleMinMax;
    /** 绕 Y 轴的轨道角速度（弧度/秒） */
    orbitalY?: ParticleMinMax;
    /** 绕 Z 轴的轨道角速度（弧度/秒）—— 2D 里**只有这一支**在屏幕内可见 */
    orbitalZ?: ParticleMinMax;
    /** 轨道中心的 x（prefab 单位，系统本地空间） */
    orbitalOffsetX?: number;
    orbitalOffsetY?: number;
    orbitalOffsetZ?: number;
    /** 远离（正）/ 朝向（负）轨道中心的**径向速度**（prefab 单位/秒） */
    radial?: ParticleMinMax;
  };
  /**
   * `ForceModule`（Force over Lifetime）—— **加速度**（prefab 单位/秒²，Unity 语义：
   * "Particles can be accelerated by forces"，质量按 1 处理）。
   *
   * 与 `gravityModifier` 同口径地每帧 `v += a·dt`（半隐式欧拉），
   * 且按 `scalingMode = Hierarchy` 乘 `localScale × unitScale`。
   * 缺省 `undefined` / `enabled: false` ⇒ 整段短路。
   */
  force?: {
    enabled: boolean;
    x: ParticleMinMax;
    y: ParticleMinMax;
    z?: ParticleMinMax;
    /** 0 = Local（缺省，按节点旋角折算到世界）、1 = World（不折算） */
    space?: number;
    /**
     * `randomized`（Unity：Two Constants / Two Curves 档下**每帧**重抽一次）。
     * ⚠️ 本引擎**未实现**逐帧重抽（仍按"出生抽一次"），如实标注：
     *    它只在"随机两常量/双曲线"档下才有区别，本工程当前无系统启用。
     */
    randomized?: boolean;
  };
  /**
   * `InheritVelocityModule`（Inherit Velocity）。
   *
   * ★★ 官方硬口径（ScriptReference 逐字）：*"The inherit velocity module only has an
   *    effect if the Particle System is set to simulate in world space. If the system is
   *    simulating in local space, this module is ignored."*
   *   ⇒ 本引擎照此守卫：`simulationSpace !== 1` 时**整段不生效**。
   *   本工程三个产物 `moveWithTransform` 全为 **0（Local）** ⇒ 该模块对现有产物零影响。
   *
   * `emitterVelocity`：发射器自身速度（**世界单位/秒**）。Unity 由 Rigidbody 速度
   *   或"本帧 Transform 位移"算出；本引擎的粒子系统都是**静止的背景节点**，
   *   没有这个量 ⇒ 由 config 显式给出（缺省 `[0,0]`）。
   */
  inheritVelocity?: {
    enabled: boolean;
    /** 0 = Initial（出生时加一次）、1 = Current（每帧跟随） */
    mode?: number;
    curve?: ParticleMinMax;
    emitterVelocity?: [number, number];
    /** `InitialModule.moveWithTransform`：0 = Local、1 = World。缺省 0 ⇒ 模块被忽略 */
    simulationSpace?: number;
  };
  /**
   * `ColorBySpeedModule`：颜色随**速度**变化。
   *
   * 公式（feng3d `ParticleColorBySpeedModule`，与官方"speed range 归一化"一致）：
   *   `rate = clamp((|v| − range[0]) / (range[1] − range[0]), 0, 1)`
   *   `color = gradient(rate)`，**逐通道乘进**粒子颜色（含 alpha）。
   * ⚠️ `range` 是 **prefab 单位/秒**（引擎里先乘 `localScale × unitScale` 再比）。
   */
  colorBySpeed?: {
    enabled: boolean;
    /** 与 `startColorGradient` 同构（`[[t,[r,g,b]]]` / `[[t,a]]`） */
    colorKeys?: Array<[number, number[]]>;
    alphaKeys?: number[][];
    minColorKeys?: Array<[number, number[]]>;
    minAlphaKeys?: number[][];
    mode?: number;
    range?: [number, number];
  };
  /**
   * `SizeBySpeedModule`：尺寸随速度变化（**倍率**，乘在 `sizeOverLifetime` 之外）。
   *
   * 公式同 ColorBySpeed 的 `rate`；`!separateAxes` ⇒ `y = z = x`（等比）。
   * ⚠️ 序列化里**主曲线叫 `curve`（= x 轴）**，另有 `y` / `z`（见 `54_审计` 实测键名）。
   */
  sizeBySpeed?: {
    enabled: boolean;
    curve: ParticleMinMax;
    y?: ParticleMinMax;
    z?: ParticleMinMax;
    separateAxes?: boolean;
    range?: [number, number];
  };
  /**
   * `RotationBySpeedModule`：自旋角速度随速度变化（**弧度/秒**）。
   *
   * 公式同上；⭐ 序列化里**主曲线 `curve` 是 z 轴**（`x` / `y` 是另外两轴，2D 下用不上）
   *   —— 默认常量 **0.7854 = π/4**，与 feng3d 的 `Math.PI / 4` 默认值逐位吻合，互为佐证。
   * 与 `rotationCurve` 同口径**取负号**（Unity 屏幕自转角反号，见 `spawn()` 处说明）。
   */
  rotationBySpeed?: {
    enabled: boolean;
    curve: ParticleMinMax;
    x?: ParticleMinMax;
    y?: ParticleMinMax;
    separateAxes?: boolean;
    range?: [number, number];
  };
  /**
   * ── P3「渲染侧」：`ParticleSystemRenderer`（2026-10-17）──────────────────
   *
   * 依据 = Unity 官方手册 Renderer module **逐字**（`docx/RESEARCH…` §4.12）：
   *   · Billboard *"The particle always faces the Camera."*
   *   · Stretched Billboard *"faces the Camera but with various scaling applied"* ＋
   *     手册 2021.2+ 的硬补充：*"particles are aligned to face the Camera **and also
   *     aligned to their velocity**. This alignment occurs **regardless of the Velocity
   *     Scale value** — even if Velocity Scale is set to 0, particles in this mode still
   *     align to the velocity."*
   *   · Horizontal Billboard *"The particle plane is parallel to the XZ 'floor' plane."*
   *   · Vertical Billboard *"The particle is upright on the world Y-axis, but turns to face
   *     the Camera."*
   *   · Mesh *"The particle is rendered from a 3D Mesh instead of a Texture."*
   *   · None *"useful when using the Trails module, if you want to only render the trails"*
   *   · Pivot（ScriptReference 逐字）*"The units are expressed as a multiplier of the
   *     particle sizes, relative to their diameters. For example, a value of 0.5 adjusts
   *     the pivot by the particle radius, allowing particles to rotate around their edges."*
   *   · Sorting Fudge *"Bias of particle system sort ordering. Lower values increase the
   *     relative chance that particle systems are drawn over other transparent GameObjects…
   *     **This setting only affects where an entire system appears in the scene** — it does
   *     not perform sorting on individual particles within a system."*
   *
   * ★★ 三种"平面朝向"的**世界基向量**不是猜的，而是 Cocos `particle-common.chunk`
   *    逐行可对照（与本项目 P2 查 galacean 同一套办法）：
   *      · Billboard ：基 = 相机 right / up
   *      · Horizontal：基 = 世界 (1,0,0) 与 (0,0,−1) ⇒ 法线沿 **世界 ±Y**，即水平面 ✓
   *      · Vertical  ：基 = 相机 right 的**水平分量** 与 世界 (0,1,0) ⇒ 竖直且绕 Y 转向相机 ✓
   *
   * ★★ 本引擎是 **2D 分层渲染 + 正视相机**（相机在 `(cameraX, camY, 0)` 看向 −Z、
   *    无俯角、无偏航）⇒ 后两档在该管线下会**几何退化**，逐条标注在下面的字段上
   *    （用户 2026-10-17 拍板"全量忠实实现"）—— 这是投影的必然结果，不是实现取巧。
   *
   * ⚠️ 整个字段**缺省不声明** ⇒ 与 P3 之前逐位一致（Billboard + 绕中心枢轴 + 不动 z）。
   */
  renderer?: {
    /** 0 Billboard / 1 Stretched / 2 Horizontal / 3 Vertical / 4 Mesh / 5 None。缺省 0 */
    renderMode?: number;
    /**
     * 0 View / 1 World / 2 Local / 3 Facing / 4 Velocity。缺省 0。
     *
     * ★ 前四档在本引擎相机（无 roll / 无俯角 / 无偏航）下**投影等价**：四者都落到
     *   "屏幕对齐"，而节点自身的旋角早已由 `nodeRotZ` 折进 `p.localRot`。
     * ★ `4` Velocity 是唯一有实感的档：粒子基准朝向 = 该粒子**速度方向**的屏幕角。
     */
    alignment?: number;
    /** 旋转枢轴：**粒子直径的倍数**；偏移 = `pivot × 当前帧尺寸`。缺省 `[0,0,0]` = 绕中心 */
    pivot?: [number, number, number];
    /** Stretched：沿速度方向的**长度** = `|v|·velocityScale + lengthScale·size`（见 §4.13） */
    velocityScale?: number;
    lengthScale?: number;
    /** 屏幕尺寸钳制，**视口高的比例**（手册原文：该两项仅 Billboard 档生效）。缺省不钳制 */
    minParticleSize?: number;
    maxParticleSize?: number;
    /** 逐粒子按概率镜像：`fx` ⇒ 该比例的粒子 UV-u 反转。缺省 `[0,0,0]` */
    flip?: [number, number, number];
    /** 是否允许粒子绕**相机 Z** 自转（= 本引擎的屏幕自转角）。缺省 `true` */
    allowRoll?: boolean;
    /**
     * 排序偏差（**整个系统**的次序，不参与系统内逐粒子排序）。
     * ★ 换算必须显式给出：Unity 如何把无量纲的 fudge 折进排序距离**未公开**，
     *   而本引擎的透明排序完全由 `mesh.position.z` 决定 ⇒ 缺省 `fudgeToZ: 0`
     *   （**不生效**，现有产物的 z 序逐位不变）。
     */
    sortingFudge?: number;
    /** `1` 单位 fudge 折成多少**世界单位 z**（正 = 更靠近相机）。缺省 `0` = 关闭 */
    fudgeToZ?: number;
    /**
     * Mesh 档的顶点集。缺省（或索引为空）⇒ **回退 quad**。
     * 坐标口径 = **原样、不归一化**：顶点直接乘**当前帧尺寸**，与 Cocos
     * `compScale = scale * size` 同式。本工程 `FX_Model_ZC_Plane13` extent ≈ 3.96×1.76
     * （远超"直径 1"）、`FX_Model_ZC_Ring03` ≈ 0.46（≈直径 1）⇒ 两者尺度本来就由美术
     * 按各自需要定，**不能擅自归一化**。`scale` 是留给数据层的调节旋钮（缺省 1）。
     */
    mesh?: {
      positions: number[];
      uv0: number[];
      indices: number[];
      name?: string;
      scale?: number;
    };
  };
  sizeModule: { enabled: boolean; curve: ParticleMinMax };
  /** 有效 alpha 随寿命的曲线（已按 Unity 语义折算过；见 alphaSource） */
  colorModule: {
    enabled: boolean;
    alphaKeys: number[][];
    /**
     * ★ `MinMaxGradient` 的 **min 侧**（`minMaxState = 3` TwoGradients 才有）。
     * 官方语义：**每颗粒子在两条梯度之间随机 lerp**。
     * 蝶语吟花 `yuan_glow`：max 侧在寿命 63%~100% 里走 `0.784→0.078→0.588→0`（**两次快闪**），
     * min 侧是 `0→0.972→0`（**单次平滑起伏**）。旧实现只取 max ⇒ 全体粒子一起急闪，
     * 实录里则明显更缓更疏（2026-10-13）。
     * 缺省 ⇒ 只用 `alphaKeys`，与旧 config 逐位一致。
     */
    alphaKeysMin?: number[][];
    /** `true` ⇒ 逐粒子按出生抽签的 `vmix` 在 `alphaKeys` ↔ `alphaKeysMin` 之间 lerp */
    alphaMix?: boolean;
    /** colorModule = 来自 ColorModule.gradient；shaderUnknown-approximated =
     *  ColorModule 关闭、真实淡出在未公开的 shader 里，这里用残留渐变近似（存疑项） */
    alphaSource: string;
  };
  uv: {
    enabled: boolean;
    tilesX: number;
    tilesY: number;
    cycles: number;
    /** 0 = WholeSheet（寿命内播完整个序列） */
    animationType: number;
    /**
     * Unity `UVModule.frameOverTime`。★ **它的 mode 决定"是否随寿命变化"**，
     * 这正是"气球在空中由黄变粉"那个 bug 的根因所在：
     *
     *   · **曲线**（mode 1，`keysA` 非空）⇒ 值随归一化寿命 t 从 a 走到 a·keysA(1)。
     *     配合 `cycles` 就是"寿命内把整个序列播 cycles 遍"。
     *     **只有 `niao` 是这一支**（4×2 = 8 帧、cycles 5 ⇒ 寿命内播 5 遍）。
     *   · **常量 / 随机两常量**（mode 0/2，或 mode 1/3 但 keysA 为空）⇒ **值与 t 无关**，
     *     粒子出生时取一次、终生不变。**`qiqiu` 是这一支**：
     *     mode 3 且 keysA 为空 ⇒ 退化成随机两常量 [0, 0.9999] × 2 帧
     *     ⇒ 一半气球黄、一半粉，且**不会在空中渐变**。
     *
     * ⚠️ 早先的实现对**所有**节点都套了曲线口径（`floor(pr·cycles·total) % total`），
     *    于是 `qiqiu` 被迫在寿命里从黄渐变到粉。别再把这两种语义混为一谈。
     *
     * 缺省 `null` ⇒ 按"寿命内匀速播完"处理（= 曲线 0→1），仅为兼容不带该字段的旧 config。
     */
    frameOverTime: ParticleMinMax | null;
    /**
     * 材质 `_UV_t.xy`（UV / 秒）：贴图 UV 的**连续**平移速度。
     * shader 顶点里的公式是 `texUV = _offon·(in_TEXCOORD1 − _UV_t·t) + _UV_t·t + in_TEXCOORD0`，
     * `_UV_t = 0` 时退化成 `texUV = _offon·in_TEXCOORD1 + in_TEXCOORD0`。
     * 实测 8 个材质里**只有 yun 非零（x = −0.008）**，其余 7 个是模板值 0。
     * 当前实现里"云靠噪声轻飘"是近似，应改成这个准确的 UV 漂移。
     */
    driftX: number;
    driftY: number;
    /**
     * 贴图 wrap 模式。**这是工程侧的适配决定，不是游戏常数** —— UnityPy 读这两张
     * 贴图时 `wrapMode` 返回 None（未暴露），故只能按"该贴图是否需要平铺"来定：
     *   · `clamp`（默认）：`saoguang` 的两张贴图边缘**全黑**（实测左右/上下边差 0.00），
     *     `texUV.x` 虽会落到 [−0.30, 1.30]，Clamp 与 Repeat 视觉差异极小 ⇒ 按规格取 Clamp。
     *   · `repeat`：**yun 必须用它** —— `_UV_t.x = −0.008` × 1000 s 寿命 ⇒ UV 走 8 个周期，
     *     而 `FX_cf_yun011` 左右边缘差 29.98（**不可平铺**），Clamp 会在边缘拉出长条。
     */
    wrap: 'clamp' | 'repeat';

    /* ═══════════════════════════════════════════════════════════════════════
     * ── P4（2026-10-17）：Texture Sheet Animation 的其余字段 ──
     *
     * 以下字段**全部可选**，且**缺省时与 P4 之前逐位一致**（判据见 `_regress/74_`）。
     * 依据（逐字）：
     *   · Unity 手册 Texture Sheet Animation module（2021.3 英文 / 7000.0 英文两版比对）
     *   · Unity `Modules/ParticleSystem/ScriptBindings/ParticleSystemModules.bindings.cs`
     *     的 `TextureSheetAnimationModule`（2021.3 与 6000.0 两版比对）
     *   · `ScriptReference/ParticleSystem.TextureSheetAnimationModule-speedRange`（Remarks 逐字）
     *   · 全包普查 `_work_UV与噪声/01_全包P4普查.py`（41996 个 ParticleSystem）
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * `TextureSheetAnimationModule.timeMode`（官方 `ParticleSystemAnimationTimeMode`）：
     *   · **0 = Lifetime（缺省）** —— 用 `frameOverTime` 曲线沿**归一化寿命**取样（现状）；
     *   · 1 = Speed —— 用**粒子速度**映射到帧（见 `speedRange`），**不随寿命推进**；
     *   · 2 = FPS —— 用固定帧率按**秒**推进，**与寿命/速度无关**。
     *
     * ⚠️ 官方 UI 在 Speed / FPS 两档下**隐藏 `frameOverTime` 与 `cycles`**
     *   （`UVModuleUI.OnInspectorGUI`：FPS 档只显示 `fps`、Speed 档只显示 `speedRange`）
     *   ⇒ 本引擎在这两档下同样**不消费** `frameOverTime` / `cycles`。
     */
    timeMode?: number;
    /**
     * `TextureSheetAnimationModule.fps`（帧/秒）：**只在 `timeMode = 2` 时生效**。
     * 官方 UI 措辞 *"Specify the Frames Per Second of the animation."* / 属性表
     * *"FPS — Sample frames based on the specified frames-per-second value."*
     * ⇒ 帧号 = `startFrame + ⌊粒子年龄 × fps⌋`，再对帧数取模回绕。
     * 缺省 `30`（Unity 模板默认值；全包普查 13716 条里 13570 条就是 30）。
     */
    fps?: number;
    /**
     * `TextureSheetAnimationModule.speedRange`：**只在 `timeMode = 1` 时生效**。
     *
     * ★★ 官方 `ScriptReference` Remarks **逐字**给出了它的语义（这是本档唯一的权威口径）：
     *   *"Specify how particle speeds are mapped to the animation frames. If a particle is
     *   travelling slower than the minimum speed, it uses the first frame. If a particle is
     *   travelling faster than the maximum speed, then it uses the final frame. For all other
     *   speeds, the particle chooses a frame based on how far between the minimum and maximum
     *   value its speed is."*
     * ⇒ `帧 = round(startFrame + rate × (帧数 − 1))`、`rate = clamp((|v| − min)/(max − min), 0, 1)`
     *   —— 注意这是**按当前速度静态选帧**，**不是**"速度越快播得越快"（后者是常见误解）。
     *
     * ⚠️ 单位是**世界单位/秒**（与本引擎 `p.spd` 同口径）⇒ 构造时乘 `localScale × unitScale`。
     * 缺省 `[0, 1]`（Unity 模板默认值）。
     */
    speedRange?: [number, number];
    /**
     * `TextureSheetAnimationModule.startFrame` —— **帧号**（不是归一化值）。
     * 官方 UI 措辞 *"Phase the animation, so it starts on a frame other than 0."* /
     * 手册 *"Allows you to specify which frame the particle animation should start on
     * (useful for **randomly phasing the animation on each particle**)."*
     * ⇒ 逐粒子从这条 MinMaxCurve 抽一个相位（复用既有的 `lifeMulMix(..., p.vmix)`，
     *   **不额外消耗 rng**）。
     * ⚠️ 官方把它**加在帧号上再做回绕**（feng3d `round(startFrame + frameOverTime × n)` 同向）；
     *   本项目直接 `⌊startFrame + over×cycles×帧数⌋ % 帧数`。缺省 / 常量 0 ⇒ **逐位等于现状**。
     */
    startFrame?: ParticleMinMax;
    /**
     * `TextureSheetAnimationModule.animation`（官方 `ParticleSystemAnimationType`）：
     *   · **0 = Whole Sheet** —— 整张表按「左→右、上→下」播完 `tilesX × tilesY` 帧（现状）；
     *   · 1 = Single Row —— 只播**一行**（`tilesX` 帧），行号由 `rowMode` 决定。
     * 官方手册 *"Single Row (that is, each row of the sheet represents a separate
     * Animation sequence)."*
     *
     * ⚠️ 与 `uv.animationType` 是**同一个字段**：`animationType` 已在旧 config 里存在
     *   （长期只被当作"0 = WholeSheet"用）⇒ 此处**沿用**它（1 = Single Row），
     *   不新增同义字段。
     */
    /**
     * `TextureSheetAnimationModule.rowMode`（官方 `ParticleSystemAnimationRowMode`）：
     *   · **0 = Custom（缺省）** —— 所有粒子都用固定行 `rowIndex`；
     *   · 1 = Random —— **每颗粒子出生时**随机选一行（官方 *"Randomly select a row for each
     *     particle when producing the animation"*；手册另有一句 *"Random Row … powerful as a
     *     way to break up conspicuous regularity"*）；
     *   · 2 = Mesh Index —— 按粒子所用网格的子网格序号选行。本引擎每套系统只用**一个**
     *     mesh（`renderer.mesh`），子网格恒为 0 ⇒ **等价于 Custom 且 `rowIndex = 0`**（如实标注）。
     *
     * ⚠️ 只在 `animationType = 1`（Single Row）时被官方 UI 显示 ⇒ 本引擎同样只在 SingleRow 档消费它。
     */
    rowMode?: number;
    /** `TextureSheetAnimationModule.rowIndex`：**只在 `animationType = 1` 且 `rowMode = 0` 时生效**。缺省 0。 */
    rowIndex?: number;
    /**
     * `TextureSheetAnimationModule.flipU` / `flipV` —— ★★ **Unity 已废弃字段**。
     *
     * `ScriptReference/ParticleSystem.TextureSheetAnimationModule-flipU` 逐字：
     *   *"Obsolete — flipU property is deprecated. Use `ParticleSystemRenderer.flip.x`
     *   instead."*（`flipV` 同）
     * ⇒ 它与 P3 已实现的 `renderer.flip`（`ParticleSystemRenderer.flip` 的 x/y 分量）
     *   是**同一件事的旧别名**，语义 = **"逐粒子按比例翻转"**（Unity 手册 *"Mirror a
     *   proportion of the particles…"*，取值 `[0, 1]`）。
     *
     * 本引擎的处理：**只在 `renderer.flip` 缺省时**把它当作回退值（取 `clamp01`），
     * 两者都缺省 ⇒ 0（**与 P3 逐位一致**）。
     * 依据：全包普查 13716 条启用 UV 的系统里 `flipU/flipV` **全部是 0.0**
     *   （美术实际用的是 `ParticleSystemRenderer.flip` —— 本工程 `niao` / `yun`
     *   的 renderer flip 就是 `[1,0,0]`，而它们的 UV flip 是 0，正好互相印证）。
     */
    flipU?: number;
    flipV?: number;
  };
  /**
   * `CustomDataModule` → 顶点流 `Custom1XYZW(34)` → shader `in_TEXCOORD1`。
   *
   * ★ 这是 saoguang"从左到右扫过去"的**真身**（不是 `_UV_t`：实测 `_UV_t` 真的是 0，
   *   运行时没有任何东西写它 —— C# 元数据 0 命中、Lua 3676 脚本 0 命中、
   *   11601 个 AnimationClip 0 命中）。
   *
   * 机制：`CustomDataModule.vector0_0` 是一条曲线（`scalar=0.3`，寿命内从 +1.0 线性降到
   * −1.0），经顶点流送进 shader 的 `in_TEXCOORD1`，配合材质 `_offon = 1` 使
   * `texUV = in_TEXCOORD1 + in_TEXCOORD0` ⇒ UV 平移 **0.6028 单位 / 1.5 s**，
   * 方向**从左到右**（推导见 `_解包结论_扫光与星星_准确复现规格.md` §4）。
   *
   * ⚠️ `in_TEXCOORD1 ≡ Custom1.xy` 是**逻辑锁定、非直读**（Unity 顶点流打包规则 +
   * 四条"只有 saoguang"的证据互相咬合）。唯一的可判定实验就是本字段实现后
   * 扫过行程应为 0.6 UV / 1.5 s、方向从左到右（`_验证_粒子.py` 已加该判据）。
   */
  customData: {
    /** = `CustomDataModule.enabled`；8 个节点里只有 saoguang 是 true */
    enabled: boolean;
    /** = 材质 `_offon`：是否把 `in_TEXCOORD1` 这一项加进来（只有 saoguang 是 1） */
    offon: number;
    /** = `vector0_0` 的 MinMaxCurve（mode=1 曲线，scalar=0.3，keys (0.004639,+1)→(1,−1)） */
    curve: ParticleMinMax;
    // 注：平移量**只加在 `_Texture` 上**，`_mask` 的 UV 恒为 `in_TEXCOORD0`（不动）——
    // 依据是 `_UV_t.zw = 0` 且 `_mask_offon = 0`（8 个材质实测），故不需要开关字段。
  };
  emission: {
    rateOverTime: ParticleMinMax;
    bursts: Array<{ time: number; count: ParticleMinMax }>;
  };
  shape: {
    enabled: boolean;
    /**
     * Unity `ParticleSystemShapeType`（2021.3 枚举，已核对官方
     * `Modules/ParticleSystem/Managed/ParticleSystemEnums.cs`）。
     *
     * **已实现**：
     *   `0 Sphere` / `2 Hemisphere`（+ obsolete 变体 `1 SphereShell` / `3 HemisphereShell`）
     *     —— 与 `10 Circle` 合流成"**圆盘族**"：三者属性集相同（Unity 手册
     *     *"Sphere, Hemisphere, and Circle have the same properties."*），且正交投影下
     *     半球与整球的 `(x,y)` 分布一致 ⇒ 2D 下位置口径完全相同；**方向 = 径向**
     *     （手册 *"a Sphere emits particles outward in all directions"*）。
     *   `4 Cone`（+ `7 ConeShell`）/ `8 ConeVolume`（+ `9 ConeVolumeShell`）：底面圆盘 + 轴向位移，
     *     方向为"锥轴 ± (ρ/R)·(angle/2)"（`docx/TODO.md` §2.2/§2.6 的定案）。
     *   `5 Box`：盒体体积内均匀，方向 = `emitDir`（本地 +Z）。
     *   `10 Circle`（+ `11 CircleEdge`）：圆盘，方向 = 径向（平面内）。
     *   `12 SingleSidedEdge`：线段（沿本地 X、半长 = `radius`），方向 = 本地 +Y。
     *
     * **未实现**（落到"锥形兜底"，即被当成圆盘；全包普查给出的启用支数）：
     *   `17 Donut`(56) / `16 BoxEdge`(73) / `15 BoxShell`(32) / `18 Rectangle`(19) /
     *   `6 Mesh`(18) / `13-14 MeshRenderer/SkinnedMeshRenderer`(0) / `19-20 Sprite*`(2)
     *   —— 见 `ParticleAnimator.spawn()` 末尾的兜底分支注释与 `docx/TODO.md` §2.5。
     *
     * ★ 全形状共用一套采样口径：位置取在**发射器本地平面内**（`φ` 由 `arc` 限定、
     *   `ρ` 由 `radiusThickness` 定），再按 `m_Scale` / `m_Rotation` / `m_Position`
     *   施加 Unity 的 `TRS` 变换（先缩放、再旋转、最后平移）。
     */
    type: number;
    /** 锥在顶点处的张角（度）：0 = 圆柱、90 = 平盘（只对 Cone / ConeVolume 有意义） */
    angle: number;
    /**
     * 形状半径（**`m_Scale` 未折算的原值**；实际半径 = radius × boxX/boxY）。
     * `SingleSidedEdge(12)` 下是线段的**半长**（全长 `2·radius`）。
     */
    radius: number;
    /**
     * 锥长：仅 `ConeVolume(8)` 参与几何（`Cone(4)`=Base 的出生点在**近盘**上，不用它）。
     *
     * ★★ 2026-10-16（P1）：锥是**从近盘向远处张开**的截锥 —— 近盘（半径 = `radius`）在
     *   发射器原点、远盘（半径 = `radius + length·tan(angle)`）在轴向 `length` 处。
     *   依据是 Unity 官方 gizmo 源码 `ConeFrustrumHandle.cs` 的注释与
     *   `farRadius = |range·tan(angle)| + nearRadius`；旧实现当成"顶点在发射器"的反向锥。
     */
    length: number;
    /**
     * ── 以下 5 项来自 `ShapeModule.m_Scale` / `m_Position` / `m_Rotation`（2026-10-12 新增）──
     * 单位与 `radius` 同为**发射器本地量**（引擎里再乘 `localScale × unitScale`）。
     *
     * **`m_Scale` 各轴缩放（2026-10-16 起对全部形状生效）**：官方 tooltip
     * "Scale the emission shape" ⇒ 采样点被逐轴放大（`docx/RESEARCH…` §4.2）。
     * 施加顺序严格按 Unity 的 `TRS`（`ShapeModuleUI.OnShapeToolGUI`）：
     * **先各轴缩放 → 再绕 Z 旋转 → 最后加平移**（旧写法把节点旋角折进方位角，
     * 等价于"缩放最外层"，仅在等比时与 `TRS` 同意）。
     * ⚠ 缺省 / 非正数 ⇒ 1（0 会把发射区压成一条线/一个点 ⇒ 沿用既有守卫）。
     *
     * **例外：Box（`type = 5`）**：`boxX/boxY` 是盒体的 x/y **全长**（粒子在这个范围里
     * 均匀取点）。缺省 0 ⇒ 退化成"点发射"，与旧行为一致。
     *
     * **Cone（`4`）/ ConeVolume（`8`）**：半径 = `radius × (boxX, boxY)`
     * （`190_生成S8动作特效.py` 现下发 `radius = 7` + `boxX/boxY = 150`，由引擎乘出 1050；
     * 旧写法是在数据层预先乘好 —— 那段"数据层折算"已撤销，否则会乘两次）。
     */
    boxX?: number;
    boxY?: number;
    /**
     * `m_Position`：形状相对发射器的平移（**最后**叠加，不随 `rotZ` 旋转）。
     * ★ 2026-10-16 起对**全部**形状生效（此前只有 Box 消费它）。
     */
    offsetX?: number;
    offsetY?: number;
    /**
     * `m_Rotation.z`（度）：形状自身的额外旋角，与节点在屏幕内的旋角 `nodeRotZ`
     * **同轴相加**成 `rot`。`rot` 同时决定：① 采样点绕原点的旋转；② 径向/朝向类方向的基准；
     * ③ 写进运行期的"本地→世界旋角"（供 `VelocityModule` 的 x/y 折算，与 Box 同口径）。
     * ★ 2026-10-16 起对**全部**形状生效（此前只有 Box 消费它）。
     */
    rotZ?: number;
    /**
     * Unity `ShapeModule.radiusThickness`：发射粒子的体积比例。
     *   **0 = 只从外表面**发射、**1 = 从整个体积**发射。
     *
     * ★ 分布口径（2026-10-16 定案，见 `docx/TODO.md` §2.1）：`ρ = R·(1 − th + th·√u)`，
     *   `u = rand()` ⇒ **面积均匀**（`th = 1` 时圆盘内单位面积粒子数相同）。
     *   Circle 的随机分支与 Cone / ConeVolume 分支**已经是同一个式子**
     *   （`ParticleAnimator.ts` 两处），故本轮"修锥形"**不需要**再统一口径。
     *   ⚠ 不采用 Cocos / feng3d 的线性口径（`ρ ∈ [R(1−th), R]`）：Unity 手册对该字段的
     *     表述是 "proportion of the **volume**"，对圆盘而言"体积"= 面积 ⇒ √u 更贴合字面。
     *
     * 实测：qiqiu / niao（Cone / ConeVolume）= **1.0**；
     *   chexiang ×2（Circle + `arcMode = 3` BurstSpread）= **0.0**
     *   ⇒ 10 颗轿厢落在**圆周**上（均布分支本来就按圆周写死，恰好一致）；
     *   yuan_glow（Circle + `arcMode = 0` Random）= **0.8**
     *   ⇒ 半径在 [0.2R, R] 内按面积比例随机（2026-10-13 起 Circle 随机分支才用它）；
     *   S8 特效 `fx_touch1_glow / _glow_1`（Cone + `arcMode = 0`）= **0.8 / 0.7**。
     * 缺省 1（兼容不带该字段的旧 config）。
     */
    radiusThickness?: number;
    /** 方位角张角（度）：**圆盘族（0/2/10）与锥形（4/8）共用**（2026-10-16 起锥形也消费它） */
    arc: number;
    /**
     * Unity `ParticleSystemShapeMultiModeValue`：
     *   **0 = Random** / 1 = Loop / 2 = Ping-Pong / **3 = BurstSpread（沿弧均布）**。
     * ★ 圆盘族（`0/2/10`）与锥形（`4/8`）**共用这一套**（2026-10-13 Circle、2026-10-16 Cone 起）：
     *   各分支都按它分流 —— `3` ⇒ 沿弧均布（相位取本批次发射序号；圆盘族的这条支路沿用
     *   既有实现"直接落在圆周上、不看 `radiusThickness`"，因为 `chexiang` 摩天轮靠它）、
     *   其余（含 1/2 = Loop/PingPong，引擎按 Random 处理）⇒ 弧内随机取角。
     */
    arcMode: number;
  };
  clamp: {
    enabled: boolean;
    /** ★ 语义：每秒向 magnitude 上限收敛的比例，**不是**每帧乘 (1-dampen) */
    dampen: number;
    magnitude: ParticleMinMax;
    multiplyDragByParticleSize: boolean;
  };
  noise: {
    enabled: boolean;
    /** 官方语义：strength 与 frequency 的**相对**关系来自数据；
     *  绝对量级无法从公开资料推导（Unity 内部归一化常数未公开）→ 用 gain 校准 */
    strength: number;
    frequency: number;
    damping: boolean;
    /** 2 = High = 3D 噪声 */
    quality: number;
    positionAmount: number;
    gain: number;

    /* ═══════════════════════════════════════════════════════════════════════
     * ── P4（2026-10-17）：Noise 模块的其余字段 ──
     *
     * 以下字段**全部可选**，且**缺省时与 P4 之前逐位一致**（判据见 `_regress/74_`）。
     * 依据：Unity 手册 Noise module 属性表**逐字** + Cocos
     *   `cocos/particle/noise.ts`（`getNoise` 的 fBm 叠层与 `getNoiseParticle` 的滚动）
     *   + 全包普查 `_work_UV与噪声/01_全包P4普查.py`（41996 个 ParticleSystem）。
     * ═══════════════════════════════════════════════════════════════════════ */

    /**
     * `NoiseModule.octaveCount`（官方手册 *"Octaves — Specify how many layers of
     * overlapping noise are combined to produce the final noise values."*）。
     *   · **缺省 / 1 ⇒ 单层（现状，逐位不变）**；
     *   · `n > 1` ⇒ 在**势场**上叠 n 层（curl 是线性算子 ⇒ 先叠势场再取旋度，
     *     结果仍是**无源无汇**的 curl 场，不会退化成"叠出来的乱向量"）。
     * 实现见 `ParticleAnimator.curl3()` 的叠层支路（逐层累加，每层差分步长随频率自适应；
     * 振幅/频率的叠法照 Cocos `ParticleNoise.getNoise`）。
     */
    octaves?: number;
    /**
     * `NoiseModule.octaveMultiplier`（手册逐字 *"For each additional noise layer,
     * **reduce the strength by this proportion**"*）⇒ 第 k 层振幅 = `mul^k`。
     * 缺省 `0.5`（Unity 模板默认；全包普查 1663 条启用 Noise 的**全部**是 0.5）。
     */
    octaveMultiplier?: number;
    /**
     * `NoiseModule.octaveScale`（手册逐字 *"For each additional noise layer,
     * **adjust the frequency by this multiplier**"*）⇒ 第 k 层频率 = `scale^k`。
     * 缺省 `2.0`（同上，全包 1663 条全是 2.0）。
     */
    octaveScale?: number;
    /**
     * `NoiseModule.scrollSpeed`（手册逐字 *"Move the noise field over time to cause
     * **more unpredictable and erratic** particle movement."*）。
     *
     * 口径（照 Cocos `ParticleNoise.getNoiseParticle`：`accSpeed = speed × t`，
     * 且偏移加在**频率缩放之前**的粒子空间里）⇒
     * `采样点 = (粒子坐标 + scrollSpeed × 系统时间) × frequency`。
     * 缺省 / 0 ⇒ **不加偏移**（且走原来的乘式，保证逐位不变）。
     *
     * ⚠️ 以下两点是**本项目口径**（Unity 内部未公开，如实标注）：
     *   ① 单标量 curve 在三个轴上**等量**平移（= 沿 (1,1,1) 对角滚动）。
     *      Unity 的 `separateAxes` 会把它拆成 XYZ 三条，但**本工程三个产物全为 false**，
     *      且全包 1663 条里 `separateAxes = true` 只有 4 条 ⇒ 不做分轴形式。
     *   ② 偏移量不做 `localScale / unitScale` 折算（保持"噪声场自己的尺度"）。
     */
    scrollSpeed?: ParticleMinMax;
    /**
     * `NoiseModule.sizeAmount`（手册逐字 *"A multiplier to control how much the noise
     * affects particle **sizes**."*）⇒ 尺寸乘子 `1 + 标量噪声 × sizeAmount`。
     *
     * ★ **取哪一路噪声值**：另开**第 4 路 Perlin 标量场**（`ParticleAnimator.noiseScalar`）。
     *   为什么不用 curl 的某个分量：① Perlin 本身**有界**（约 ±0.7）⇒
     *   `1 + 标量 × sizeAmount` 不会把尺寸乘成负数；② 与可见位移（只消费 curl 的 x/y）
     *   **不相关**，不会出现"往哪边推就往哪边胀"的假相关。
     *   ⚠️ Unity 未公开它的取值来源 ⇒ **本项目口径，存疑项**。
     *
     * 缺省 / 0 ⇒ 乘子恒为 1（**逐位等于现状**），且**连那 1 次 Perlin 采样都不做**。
     */
    sizeAmount?: ParticleMinMax;
    /**
     * `NoiseModule.rotationAmount`（手册逐字 *"A multiplier to control how much the noise
     * affects particle rotations, **in degrees per second**."*）。
     * ⇒ `Δ自转角 = 噪声_z × rotationAmount × (π/180) × dt`（取负号，与
     *   `rotationCurve` / `rotationBySpeed` 同一个"屏幕反号"口径）。
     *
     * ★ 取值源 = curl 场的 **z 分量**（2D 渲染本来就丢弃的那一路 ⇒ 不与可见位移相关）。
     * 缺省 / 0 ⇒ 不产生自转（**逐位等于现状**）。
     */
    rotationAmount?: ParticleMinMax;
    /**
     * `NoiseModule.separateAxes`（手册逐字 *"Control the strength and remapping
     * **independently on each axis**."*）⇒ 位置的推力**逐轴**改用
     * `strength / strengthY / strengthZ` 三条强度，而不是一条 `strength`。
     * 缺省 / false ⇒ 三轴共用 `strength`（现状）。
     * ⚠️ 全包 1663 条启用 Noise 的系统里只有 **4 条**开了它，本工程三个产物**全为 false**。
     */
    separateAxes?: boolean;
    /** `NoiseModule.strengthY`（仅 `separateAxes = true` 时生效）；缺省回退到 `strength` */
    strengthY?: number;
    /** `NoiseModule.strengthZ`（仅 `separateAxes = true` 时生效）；缺省回退到 `strength` */
    strengthZ?: number;
  };
  /** 整组绕枢轴匀速自转（摩天轮轮毂）。pivot 是**相对本 mesh 原点**的世界单位偏移。
   *  ★ 未挂自转的系统（star / saoguang）在 config 里是 `null` —— 类型必须含 null，
   *  否则与运行期数据不符，代码里的判空会变成"TS 看不见的防御"（改动它不会被编译拦住）。
   *
   *  `rotateSelf`：粒子**自身贴图朝向**是否跟随组旋转（叠加 gAng）。
   *  - `true`（轮盘本体）：粒子出生在枢轴原点（shape.enabled=false ⇒ p.x=p.y=0），
   *    公转位移为零，不叠 gAng 就纹丝不动 —— 轮盘必须叠；
   *  - 缺省/`false`（轿厢 chexiang）：保持初始朝向 `startRotation` 始终竖直，
   *    叠了会"转到下方时头朝下"。旧 config 不带此字段 ⇒ 行为与改动前完全一致。 */
  groupRotation: {
    pivotX: number;
    pivotY: number;
    degPerSec: number;
    rotateSelf?: boolean;
  } | null;
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * `TrailModule` —— 丝带轨迹（Unity 的 Trail / Ribbon 渲染模式）
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * 为什么需要它：**丝带粒子没有"四边形"可画**。`trail01` 的 `startSize = 0` 是
   * 正常值 —— 丝带的宽度不来自 `startSize`，而来自 `TrailModule.widthOverTrail`；
   * 所以只按 quad 渲染时会被 `hw <= 0.01` 静默跳过，**整条效果凭空消失**且不报错。
   *
   * 数据来源（`out/S8_particles.json` 的 `TrailModule`，逐字读，非推测）：
   *   `{enabled:true, mode:0, ratio:1.0, lifetime:{TwoConstants,0.5,0.5},
   *     minVertexDistance:0.2, textureMode:0(Stretch), ribbonCount:1,
   *     worldSpace:false, dieWithParticles:true, sizeAffectsWidth:false,
   *     sizeAffectsLifetime:false, inheritParticleColor:true,
   *     widthOverTrail:{TwoConstants,15,10},
   *     colorOverTrail:  4 个 alpha 键 [0, .038, .700, 1] → [0, 1, 1, 0]
   *     colorOverLifetime: 2 个 alpha 键 [.791, 1] → [1, 0]}`
   *
   * ⚠️ **本工程接受的近似**（如实标注，不装作逐值一致）：
   *   · 只折叠 alpha：本引擎的着色器把颜色统一走 `uStartColor`，逐顶点只带 `aAlpha`。
   *     `colorOverTrail` / `colorOverLifetime` 的 **RGB** 键实测均为纯白（见上），
   *     故只取 alpha 不丢信息；`inheritParticleColor=true` 也已由 `uStartColor` 覆盖。
   *   · `minCurve` 不参与（沿用本引擎既有口径：只取 `maxCurve`）。
   *   · `mode=0(Particles)` 是唯一的轨迹生成方式（值本身就是它的语义），不另设开关。
   */
  trail: {
    /** = `TrailModule.enabled`；为 false 时完全走原来的 quad 分支 */
    enabled: boolean;
    /**
     * `TrailModule.lifetime`（秒）：**单个轨迹点**能活多久。
     * ⚠️ 与粒子自身的 `startLifetime`（8~10s）不是一回事 —— 它决定丝带有多长：
     *   `丝带长度 ≈ 粒子速度 × trail.lifetime`。
     */
    lifetime: number;
    /**
     * `TrailModule.minVertexDistance`（prefab 单位）：粒子每走这么远才记一个轨迹点。
     *
     * ★ 它只负责**分辨率**，最终点数还会被 `maxPoints` 收敛（见该字段）。
     */
    minVertexDistance: number;
    /**
     * `TrailModule.widthOverTrail`（prefab 单位，`TwoConstants` ⇒ 每条轨迹随机取一个）。
     * 语义与 `startSize` **同单位同缩放**：世界宽度 = 取值 × `localScale` × `unitScale`。
     */
    width: ParticleMinMax;
    /** `TrailModule.textureMode`：实测 0 = Stretch（整张贴图沿丝带拉满） */
    textureMode: number;
    /**
     * `colorOverTrail` 的 alpha 键 `[[t, a], ...]`，`t` = **沿丝带的位置**（0 = 头部，
     * 即粒子当前所在处；1 = 尾部）。
     */
    colorOverTrailAlpha?: number[][];
    /** `colorOverLifetime` 的 alpha 键，`t` = **轨迹点自身年龄 / lifetime** */
    colorOverLifetimeAlpha?: number[][];
    /**
     * ★ **工程侧旋钮**（不是 Unity 字段）：每条轨迹的点数上限。
     *
     * 为什么必须有：`minVertexDistance = 0.2` 配 `300 prefab/s` 的速度 ⇒ 0.5s 寿命内
     * 需要 **750 个点**，30 颗粒子就是 13.5 万个三角形，纯属浪费（而且 Unity 自己
     * 也有内部上限）。这里改成**按上限反推步长**：`实际步长 = max(minVertexDistance,
     * 速度 × lifetime / maxPoints)` —— 保住**丝带长度**（看起来仍是完整的一条），
     * 只降低点的密度。缺省 64。
     */
    maxPoints?: number;
  } | null;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 「动作 → 额外特效」绑定：一条动作播的时候，额外拉起哪些粒子系统
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 复刻对象与数据来源（解包权威，2026-10-14 普查）
 *
 * 游戏里"点角色 → 播动作 + 同时来一簇粒子"是**通用的数据驱动功能**，不是某皮肤独有。
 * 绑定写在 `CfgSoulSpineActionTable[actionId]` 上（字段与取值见
 * `09_壁纸适配_素材与技术/` 与 `_work_芙丽希娅_蝶语吟花/out/51_动作特效全景.txt`）：
 *
 * ```
 * CfgSoulSpineActionTable[actionId] = {
 *   SoulActionState, MarryActionState,
 *   EffectId / EffectOrder,               -- ★ 普通态额外播的特效
 *   MarryEffectId / MarryEffectOrder,     -- ★ 誓约态额外播的特效
 * }
 * EffectId → CfgEffectTable[EffectId].EntityID
 *          → CfgEffectEntityTable[EntityID].PrefabName   （如 FX_UI/FX_Freesia_S6_Background_chat）
 * ```
 * 实测覆盖：**112 个动作控制表里 69 个（61.6%）**至少有一条动作带特效；
 * 用到 118 个不同 prefab，78% 路径含 `_Background_`（`*_Background_<state>` 命名族）。
 * ⚠️ 注意：**我们先前做的 S8 其实也有**（`63007/63008/63013` 三条 `touch1` → `FX_Asuna_S8_Background_touch1`），
 * 只有 S9 真没有。所以这**不是"给蝶语吟花开的特例"**，是补上引擎一直缺的一块能力。
 *
 * ## 为什么按「动画名」绑，而不是按「actionId」
 *
 * 游戏侧绑的是 `actionId`，但**同一条 `actionId` 在誓约前后走的是两个不同动画**
 * （`SoulActionState` / `MarryActionState`），而特效也分成 `EffectId` / `MarryEffectId`
 * 两套 —— 恰好一一对应。壁纸侧的动作播放在 `touch.ts` 里是**按动画名**驱动的
 * （`entry.animation`），且同一动画名可能被多条念白复用（S8 的 `63007/63008/63013` 都是 `touch1`）
 * ⇒ 用 `animation`（动画名）作键**天然覆盖了"多条动作共用同一动画"这一情况**，
 * 也比 `actionId` 更贴近引擎实际播放的那一层。
 *
 * ## 触发时机与语义
 *
 * - **触发点**：`index.ts` 的 `showDialogue(entry, animationName)` —— 那是**三条通道
 *   （触摸 / 问候 / 待机）的唯一汇合处**，放这里才不会漏掉自动事件那两路。
 *   （引擎的 `TouchController.onAction` 只在触摸路径回调，覆盖不到 boot 问候与待机。）
 * - **同名动画重复触发**：**重新从头播**（= 重新发射），不做"还在播就不管"。
 *   与游戏侧每次动作都 `PlayEffect` 一致。
 * - **旧动作播完要不要停**：**不停**。这些特效系统的 `lengthInSec` 就是它的自然寿命
 *   （蝶语吟花 `_chat` 主系统 5 s、`_touch2` 花瓣 6.5 s），自己会走完并清空。
 *   刻意**不做"按动作时长裁剪"** —— 那会引入"特效比动作长就该被砍"的臆断。
 *
 * ## ★ 缺省 = 不启用
 *
 * `actionEffects` 整个缺席 ⇒ 引擎行为与改动前**逐字一致**（老 config 零影响）。
 * 与 `pointerTrail` 同一口径：必须显式声明才会多出视觉元素。
 */
export type ActionEffectConfig = {
  /**
   * 用哪个**动画名**来触发。与 `DialogueEntry.animation` 逐字比对
   * （如 `"chat"` / `"touch2"` / `"touch1_marry"`）。
   */
  animation: string;
  /**
   * 要额外播放的粒子组名列表，对应 `config.meshes[].name`（`type:'particle'` 那批）。
   *
   * ⚠️ 名字必须**逐字**匹配 `meshes[].name`；匹配不到时控制台留一条 warn 并跳过该组
   * （宁可少一个特效，也不要静默什么都不发生）。
   */
  particles: string[];
  /**
   * 是否在**每次**触发时都让这些粒子组**从头重播**（缺省 **true**）。
   *
   * - `true`（缺省）：清空该组已有粒子并复位系统时钟 ⇒ 每次都完整播一遍。
   *   与游戏侧"每次动作都重新 `PlayEffect`"一致。
   * - `false`：只把它置为可见、让它在自己的自然周期里继续跑（适合"本来就在循环"的组）。
   *
   * ⚠️ **复位后不会强制预热** —— 要不要 `prewarm` 只看该组自己的 `prewarm` 字段
   * （`ParticleMeshConfig.prewarm`）。历史坑：曾经无条件强制预热，而 `prewarm()` 是
   * "模拟到稳态"、会把系统时钟往前推最多 30 s ⇒ `autoplay:false` 的一次性特效组一触发
   * 时钟就已经在 `startDelay` 附近甚至越过发射窗口，表现为"特效迟到"或"根本不出现"。
   *
   * ⚠️ 本字段只对**本条绑定里列出的粒子组**生效 —— 不会被同一条动作的其他绑定影响。
   */
  restart?: boolean;
};

/**
 * 动作特效总配置。缺省 = **不启用**（老 config 零影响）。
 *
 * ```json
 * "actionEffects": [
 *   { "animation": "chat",   "particles": ["fx_chat_glow", "fx_chat_spark"] },
 *   { "animation": "touch2", "particles": ["fx_touch2_petals"] }
 * ]
 * ```
 *
 * ★ 本工程（蝶语吟花）**暂不绑定任何动画** —— 先只把钩子做出来（见
 *   `_work_芙丽希娅_蝶语吟花/` 的构建链；绑定留到后续一步）。
 */
export type ActionEffectsConfig = ActionEffectConfig[];
