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
   * 允许的最小窗口宽高比。缺省 = **底层铺满素材的宽高比**（自动扫描 z 最小的 texture 层）。
   * 该值配垂直锚点后就是"垂直方向把背景用满、仍不露黑边"的极限（1700/1558 = 1.091142）。
   */
  minAspect?: number;
  /** 允许的最大窗口宽高比。缺省 2.4（再宽需裁掉的垂直内容过多）。 */
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
   * 画面调整：**摩天轮轿厢姿态角**。缺省 = `{ cabinMode: 'gravity' }`（沿用解包值）。
   *
   * 详见 `FerrisWheelConfig`。放在顶层是因为它管的是**粒子系统的渲染姿态**，
   * 与"播什么动作 / 出不出字幕"无关，和 `bgm` / `idleSequence` 平级。
   */
  ferrisWheel?: FerrisWheelConfig;
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
};

/** `FerrisWheelConfig.cabinGroups` 的缺省值（解包命名：`chexiang` / `chexiang (1)`） */
export const DEFAULT_CABIN_GROUPS: readonly string[] = [
  'chexiang',
  'chexiang (1)',
];

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
 * 想要"点了永远有反应"的用户自己去「设置 → 动作」页切到 `'immediate'`。
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
 * ★ 用户在**右上角设置面板 →「动作」页**可随时改（覆盖层字段 `touchFeedbackMode`），
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
 * 待机到点后可**自动触发**的事件类别（2026-10-09 新增，取代原来的两个布尔开关）。
 *
 * ★★ 唯一判据在 `dialogue.ts` 的 `resolveStandbyKinds`（纯函数、可单测）；
 *   本类型只是它的取值域。支持多选，写进 `subtitle.standbyKinds` 数组。
 *
 * | 取值 | 面板 chips | 触发时播什么 | 池来自 |
 * |---|---|---|---|
 * | `'chat'`（**缺省开**） | 闲聊 | 池内**随机** 1 条（动作 + 字幕 + 语音同源） | `chat` 数组（没配时退回旧字段 `standby`） |
 * | `'greet'` | 问候 | 走 `pickGreetingEntry`，取条方式由 `greetMode` 决定 | `greet` 池（或旧时段表 `greeting`） |
 * | `'touch'` | 触摸 | 池内**随机** 1 条 | `touch` 数组（与**点击**同一口径，含 `greetInTouchPool` 的并入） |
 *
 * ## ★★ 缺省只开 `chat` —— 这是刻意还原的**老行为**
 *
 * 改动前（2026-09-30 之前）只要配了 `subtitle.standby`（休闲待机 64004），
 * 待机到点就**一定会播它**。2026-09-30 把"待机自动播放"整体挂到两个新开关上
 * （且都缺省关）⇒ 连这条老行为也一起消失了 —— 本字段就是那次回归的修复：
 * **不勾任何东西也照样播 `chat`**，`greet` / `touch` 才是要显式勾选的新能力。
 *
 * ⇒ **空数组** = 显式关掉"待机自动播放"（等价于 2026-09-30~10-09 之间的出厂行为）。
 * ⇒ 三类**都勾** ⇒ 到点后**随机挑一类**，再在该类自己的池里取一条（各 1/3，不是并成一个大池）。
 *
 * ★ 用户在**右上角设置面板 →「动作」页**改（`设置 → 动作 → 长时间待机可触发的事件`），
 *   落盘即进覆盖层 ⇒ 与 `config.json` 里写的值**同名同语义**，只是优先级更高；**重载生效**。
 *
 * ⚠️ 触发时给的 `ActionSource` 一律是 **`'standby'`**（不是 `'touch'`）—— 它是**自动播放**，
 *   不该像用户点击那样去打断正在演的问候（见 `touch.ts` 的闸门表）。
 */
export type StandbyEventKind = 'chat' | 'greet' | 'touch';

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
   * | `greet` | 开机 / 回到桌面 / 回到前台 / WE 暂停后恢复 /（可选）待机到点 | 由 `greetMode` 定：按时段下标 或 随机 |
   * | `chat` | **长时间无互动**（静置超过 `standbyIdleMs`）且 `standbyKinds` 里勾了 `'chat'`（**缺省就勾着**） | 池内随机 |
   * | `touch` | 点中任一触摸热区 | 池内随机 |
   *
   * ⚠️ 三条列表**互不排斥**：同一个 actionId 写进多个列表完全合法
   *    （例如把 64005 同时放进 `touch` 和 `chat`）；需要去重的合并在
   *    `dialogue.ts` 的合并函数里做，这里按用户写的原样保留。
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
   * 是否把「问候」条目**并入触摸池**（缺省 **false** = 点击只从 `touch` 里随机）。
   *
   * ★ 并入的是 **`greet` 池里的全部** actionId（不再写死 64001/64002）——
   * 加候选只改 config，**不需要重建 bundle**。
   *
   * ⚠️ 各条目的**动作并不相同**：S9 的 `morning`/`noon` 是 `greet`，`evening` 是 `chat`。
   * 口径（2026-09-29 用户确认）= **"只要它本来就是被当作打招呼触发的，就一并并入"**
   * ⇒ 晚间问候虽然动作是 `chat`，也照样收进池。
   *
   * ★ 用户可在壁纸右上角「设置 → 字幕气泡 → 打招呼加入触摸随机」里开关，
   * 落盘后经 `settingsStore.applyOverrides` 覆盖本字段并**重载生效**。
   */
  greetInTouchPool?: boolean;
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
   * 到点后播哪一类事件由 **`standbyKinds`** 决定（见该字段）；**三类共用一个阈值**
   * （面板上是同一个滑块「待机触发事件时长」）。
   *
   * ★ 用户可在壁纸右上角「设置 → 动作 → 待机触发事件时长」里改（以秒为单位，5~300 秒），
   * 落盘后经 `settingsStore.applyOverrides` 覆盖本字段并**重载生效**。
   */
  standbyIdleMs?: number;
  /**
   * **待机到点可触发的事件（多选）**——`'chat'` / `'greet'` / `'touch'` 的子集。
   *
   * ★★ **缺省（本字段没配时）= 只有 `'chat'`**：还原"配了 `standby` 就一定会播"的老行为，
   *   也修掉 2026-09-30「出厂两个开关都关 ⇒ 待机什么都不播」的回归。
   * 语义表、可用性判据、以及**空数组 = 显式全关**的口径，见 `StandbyEventKind` 的注释。
   *
   * ★ **旧口径（兼容输入）**：本字段缺席时，由下面两个布尔推导 —— 见
   *   `dialogue.resolveStandbyIntent`。旧 config 因此**行为逐字不变**（外加还原 `chat`）。
   */
  standbyKinds?: StandbyEventKind[];
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
   * 已被 `standbyKinds` 数组取代 —— **只在本字段缺席时**由 `resolveStandbyIntent` 读取：
   * `true` ⇒ 往意向里追加 `'greet'`（取条方式由 `greetMode` 决定，与"开机 / 回到桌面"
   * 那几路共用同一个 `pickGreetingEntry` 和 5 秒去重窗口）。
   * ⚠️ 旧口径下 `'chat'` **恒在**，所以本字段为 `false` **不会**把待机闲聊一起关掉。
   * **新配置请一律用 `standbyKinds`。**
   */
  standbyGreetEnabled?: boolean;
  /**
   * ⚠️ **旧口径**（兼容输入）：待机到点是否也自动触发「触摸」（touch）事件。
   *
   * 已被 `standbyKinds` 数组取代 —— **只在本字段缺席时**读取：`true` ⇒ 追加 `'touch'`
   * （池 = `touch` 数组，与**点击**同一口径）。
   *
   * ★ 2026-10-09 重修：改动前这一档是"`chat` + `touch` **合并成一个池**随机取一条"
   *   （开了它 64004 就不再固定播放）；现在 `chat` 与 `touch` **各自成一类、各有各的池**
   *   ⇒ "64004 到 64010 都可触发"改成**同时勾 `chat` 与 `touch`** 来表达。
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
  startLifetime: ParticleMinMax;
  startSpeed: ParticleMinMax;
  startSize: ParticleMinMax;
  startSizeY: ParticleMinMax;
  startSizeZ: ParticleMinMax;
  size3D: boolean;
  startRotation: ParticleMinMax;
  /** RotationModule（rotationOverLifetime），单位弧度/秒 */
  rotationEnabled: boolean;
  rotationCurve: ParticleMinMax;
  velocity: {
    enabled: boolean;
    x: ParticleMinMax;
    y: ParticleMinMax;
    speedModifier: number;
  };
  sizeModule: { enabled: boolean; curve: ParticleMinMax };
  /** 有效 alpha 随寿命的曲线（已按 Unity 语义折算过；见 alphaSource） */
  colorModule: {
    enabled: boolean;
    alphaKeys: number[][];
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
    /** Unity ParticleSystemShapeType：4=Cone 8=ConeVolume 10=Circle */
    type: number;
    angle: number;
    radius: number;
    length: number;
    /**
     * Unity `ShapeModule.radiusThickness`：发射粒子的体积比例。
     *   **0 = 只从外表面**发射、**1 = 从整个体积**发射。
     *
     * 实测：qiqiu / niao（Cone / ConeVolume）= **1.0**；chexiang ×2（Circle）= **0.0**
     *   ⇒ 这正是 10 颗轿厢落在**圆周**上、而不是圆盘内的原因
     *      （旧实现直接按圆周写死，正好只对上了 Circle 那一支）。
     * 缺省 1（兼容不带该字段的旧 config）。
     */
    radiusThickness?: number;
    arc: number;
    /** 3 = BurstSpread（沿弧均布） */
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
};
