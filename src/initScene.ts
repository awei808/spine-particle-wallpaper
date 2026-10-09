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

import THREE from 'three';
import { Configs, TextureMeshConfig } from './config.type';

export let scene: THREE.Scene = null;
export let renderer: THREE.WebGLRenderer = null;
export let cursorX: number = 0;
export let cursorY: number = 0;
export let camera: THREE.PerspectiveCamera = null;

/**
 * 把客户端像素坐标换算成 NDC（与 onMouseMove 里那份保持同一口径）。
 * 抽出来是因为后续"点击/按下"也要用同一套换算：
 * 原实现只在 mousemove 里更新，若用户直接在某点按下而未曾移动鼠标，
 * cursorX/cursorY 会停留在 0，热区命中就会出错。
 */
export const updateCursorFromClient = (clientX: number, clientY: number) => {
  cursorX = (clientX / window.innerWidth) * 2 - 1;
  cursorY = -(clientY / window.innerHeight) * 2 + 1;
};

/**
 * 全屏适配：**水平锁定 + 垂直自由**。
 *
 * 完整推导、阈值依据与验证见 `09_壁纸适配_素材与技术/07_全屏适配_探针1700x750.md`。
 *
 * ⚠️ 本段最初是**直接 patch 进 bundle.js** 的（`_work_全屏适配/03/13/16_patch_*.py`），
 * 2026-09-20 做热区改造时按 bundle 里**实际生效的代码**逐字还原回 TS。
 * 还原口径：与补丁后 bundle 的 `initScene` 模块**逐语句等价**（含 `camY` 三元表达式的
 * 运算优先级、`Math.round` 已去除这两处易错点）。
 *
 * ★ 改这里的验收方式（2026-10-09 更新；原 `_work_全屏适配/07_单测_fit逻辑.js` 与
 *   `14_验证_新下限与回归.py` 已随该目录归档、不在工作区）：必须**用真实渲染量**，不能只看代码。
 *   起静态服务 + 无头 Chrome，用 `Emulation.setDeviceMetricsOverride` 造出各种视口比例，然后读两样：
 *   ① canvas 的 `getBoundingClientRect()` —— 比例在范围内 = 等于视口；越界 = 按边界 letterbox、
 *      且**居中**（如 500×500 视口下 canvas = `500x458 @(0,21)`）；
 *   ② `#__fitErr` 红条是否存在。
 *   两者合起来才能区分「正确 letterbox」与「**静默露黑**」—— 后者的 canvas 等于视口，
 *   且画面左右/上下出现 renderer clear-color 的黑（`#__fitErr` 不存在，控制台也不报错）。
 */
type FitResult = {
  /** 本次生效的渲染倍率（`configs.dpr` 解析后的实际值） */
  dpr: number;
  /** 内容宽（CSS px，未取整） */
  w: number;
  /** 内容高（CSS px，未取整） */
  h: number;
  /** 夹到 [minAspect, maxAspect] 后的比例 */
  aspect: number;
  /** 该视口下应保持的垂直 FOV（度） */
  fov: number;
  /** 相机 y（垂直锚点补偿） */
  camY: number;
  /** 视口真实比例（未夹） */
  a: number;
  /** 视口真实尺寸 */
  rw: number;
  rh: number;
  /** 是否越界 */
  bad: boolean;
};

/**
 * `dpr: "auto"` 的夹取区间。
 *
 * - 下限 1：低于 1 会让缓冲**小于** CSS 视口，比不补偿还糊；
 * - 上限 2：再高就是缓冲像素 ×4 起步，桌面壁纸常驻不值得。
 */
const DPR_MIN = 1;
const DPR_MAX = 2;

/**
 * 把 config 的 `dpr` 解析成实际渲染倍率。
 *
 * - 数字 ⇒ 原样（缺省 1，保持既有行为）
 * - `'auto'` ⇒ 跟随屏幕 DPI：`window.devicePixelRatio` 夹到 `[DPR_MIN, DPR_MAX]`
 *
 * ★ 补的是哪一层：WE 的网页壁纸走 CEF，**遵循 Windows 显示缩放** —— 缩放 S 时页面拿到的
 *   CSS 视口 = 物理宽 / S，而 `devicePixelRatio` = S。写死 1.0 ⇒ 缓冲只有物理像素的 1/S，
 *   CEF 合成时整幅画面（含 DOM 文字、角色边缘、粒子轮廓）会被再插值放大一次。
 * ⚠️ 救不了背景位图的信息量（与 dpr 无关的硬放大）—— 见 09 文档 `14_清晰度诊断_2K屏糊.md` §3 / §5。
 */
const resolveDpr = (raw: Configs['dpr']): number => {
  if (raw === 'auto') {
    const v = window.devicePixelRatio || 1;
    return v < DPR_MIN ? DPR_MIN : v > DPR_MAX ? DPR_MAX : v;
  }
  return typeof raw === 'number' && raw > 0 ? raw : 1;
};

export const initScene = (configs: Configs) => {
  const width = configs.width ?? 2048;
  const height = configs.height ?? 2048;

  //#region 全屏适配（水平锁定 + 垂直自由）
  const fit = (() => {
    /** 设计基准（不再等于渲染尺寸，只用于算 aspect_d 与作为 fov 的分母） */
    const w0 = width;
    const h0 = height;
    const fovDesign = configs.fov ?? 75;

    /**
     * 扫一遍 texture 层，取两样素材事实（**闸门的两侧就由它们给出**，见下面的 `artMin/artMax`）：
     *
     * - **z 最小的那层**（「最底层的铺满素材」）：它的**下边界 y** 是垂直锚点要钉住的位置，
     *   它的**宽高比** `bw/bh` = 素材下界（垂直方向把背景用满的极限）。
     * - **最宽的 texture 层**：`wmax` = 素材上界（横向能把画面铺满的极限）。
     *   ⚠️ 只统计 texture 层 —— **只有它带显式宽高**（spine 给的是 scale、particle 给的是贴图）。
     */
    const base = (() => {
      const meshes = configs.meshes || [];
      let zMin = Infinity;
      let bottom = 0;
      let bw = 0;
      let bh = 0;
      let wmax = 0;
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i] as TextureMeshConfig;
        if (!m || m.type !== 'texture' || !m.position) {
          continue;
        }
        const w = (m.width || 1) * (m.scale || 1);
        if (w > wmax) {
          wmax = w;
        }
        if (m.position.z < zMin) {
          zMin = m.position.z;
          bw = w;
          bh = (m.height || 1) * (m.scale || 1);
          bottom = m.position.y - bh / 2;
        }
      }
      return { bottom, bw, bh, wmax, z: zMin };
    })();

    /**
     * 对齐基准（见 `config.type.ts` 的 `fitAspect`）。
     *
     * ★ 缺省 **`'height'`**（2026-10-08 用户拍板；与游戏内取景一致）。
     *   老工程（S9/盛夏游乐场）在 `config.json` 里显式写了 `"fitAspect": "width"`，
     *   所以缺省值翻转不会让它们悄悄变样。
     *
     *   · `'height'` ⇒ 可见高恒 = 设计态可见高；**fov 恒定 = `fovDesign`**
     *                  （等价于把「设计比例下的取景」原样搬到任何比例上，横向多露/少露）
     *   · `'width'`  ⇒ 可见宽恒 = 底层铺满层 world 宽；fov 随视口比例反比变
     *                  （`tan(fov_r/2) = tan(fov_d/2)·aspect_d/aspect_w`）
     *
     * ★ 为什么 `'height'` 时 fov 就是 `fovDesign`：
     *   设计态下 `aspect_w = aspect_d`，`tan(fov_r/2) = tan(fov_d/2)`，
     *   而“可见高”只由 `tan(fov/2)` 与该平面的 |z| 决定 ⇒ 想让它恒定，
     *   只需让 `tan(fov/2)` 恒定；把分母那个 `aspect_d/aspect_w` 去掉即是。
     */
    const fitAspect: 'width' | 'height' =
      configs.fitAspect === 'width' ? 'width' : 'height';
    /** 设计态的半高正切（= tan(fovDesign/2)），`'height'` 基准下就是实际值 */
    const tanHalfDesign = Math.tan((fovDesign * Math.PI) / 360);

    /**
     * ★★ 闸门 `[minAspect, maxAspect]` **按基准各自绑定到素材能给的那一侧**
     *   （2026-10-09 定；此前是一个基准无关的共用区间）。
     *
     * 为什么必须分家：两种基准锁的是**不同的一个自由量**，于是"开始露黑"的边界各在一边 ——
     *
     * | 基准 | 锁住 | 可见世界量 | 会露黑的一侧 | 素材给出的边界 |
     * |---|---|---|---|---|
     * | `'width'`  | 可见宽 ≡ `base.bw` | 可见高 = `base.bw / 视口比例` | 窗口**太高**（上下露黑） | 下界 `base.bw/base.bh` |
     * | `'height'` | 可见高 ≡ `visibleH`  | 可见宽 = `visibleH × 视口比例` | 窗口**太宽**（左右露黑） | 上界 `wmax / visibleH` |
     *
     * ⇒ 「按宽」的横向永不露黑（可见宽恒等于素材宽），所以它**没有素材上界**；
     *   「按高」的纵向是常量，所以它**没有素材下界**。
     *
     * ## 取值规则（显式写的值也**不能突破素材**）
     *
     * - `'width'`：`min = max(写的 ?? 素材下界, 素材下界)` —— 写松了会被收回，否则会**静默**在上下露黑；
     *   `max = 写的 ?? 2.4`（素材无上界，沿用人为闸门兜住"极端宽"）。
     * - `'height'`：`min = 写的 ?? 素材下界`（素材无下界，缺省沿用旧值，保持既有工程不变）；
     *   `max = min(写的 ?? 2.4, 素材上界)` —— 写宽了会被收回，否则会**静默**在左右露黑。
     *
     * ★ 效果：越界一律走"红条 + letterbox 居中"的显式路径，**不再有静默露黑**；
     *   而所有显式写了 `minAspect`/`maxAspect` 的老工程（S9 系全部是
     *   `1.0911 / 2.4` + `'width'`）**行为逐字不变**。
     */
    /** 「按高」基准下恒定的可见世界高（= 2·|base.z|·tan(fov_d/2)） */
    const visibleH = 2 * Math.abs(base.z) * tanHalfDesign;
    /** 素材下界：底层背景**垂直**铺满的极限（`'width'` 基准下才会被用满） */
    const artMinAspect = base.bh > 0 ? base.bw / base.bh : 1.54;
    /** 素材上界：最宽贴图层**横向**铺满的极限（`'height'` 基准下才会被用满） */
    const artMaxAspect =
      visibleH > 0 && base.wmax > 0 ? base.wmax / visibleH : Infinity;
    /** 没有素材边界的另一侧，沿用这道人为闸门（老缺省） */
    const GATE_MAX_ASPECT = 2.4;

    const minAspect =
      fitAspect === 'width'
        ? Math.max(configs.minAspect ?? artMinAspect, artMinAspect)
        : configs.minAspect ?? artMinAspect;
    const maxAspect =
      fitAspect === 'height'
        ? Math.min(configs.maxAspect ?? GATE_MAX_ASPECT, artMaxAspect)
        : configs.maxAspect ?? GATE_MAX_ASPECT;

    const calc = (): FitResult => {
      let vw = window.innerWidth || w0;
      let vh = window.innerHeight || h0;
      // 视口可能读到 0/1（DevTools 拖动中间态、未布局完成），退回设计基准
      vw = vw > 1 ? vw : w0;
      vh = vh > 1 ? vh : h0;

      const a = vw / vh;
      const clamped = a < minAspect ? minAspect : a > maxAspect ? maxAspect : a;

      let cw: number;
      let ch: number;
      if (a > maxAspect) {
        ch = vh;
        cw = vh * maxAspect;
      } else if (a < minAspect) {
        cw = vw;
        ch = vw / minAspect;
      } else {
        cw = vw;
        ch = vh;
      }

      // 水平锁定（`'width'`）：tan(fov/2) = tan(fov_d/2) · aspect_d / aspect_w
      // 画幅高锁定（`'height'`）：tan(fov/2) 恒定 = tan(fov_d/2)
      const fov =
        fitAspect === 'height'
          ? fovDesign
          : (2 * Math.atan((tanHalfDesign * (w0 / h0)) / (cw / ch)) * 180) /
            Math.PI;

      // 垂直锚点：把可见窗口的下边界钉在底层素材的下边界上（camY 恒 >= 0）
      // ★ 两种基准下"可见半高"的算法不同：
      //   `'width'`  —— 可见宽 ≡ base.bw ⇒ 半高 = base.bw/2/aspect
      //   `'height'` —— 半高由 fov 与 base 平面直接给出 = |base.z|·tan(fovDesign/2)
      const halfH =
        fitAspect === 'height'
          ? Math.abs(base.z) * tanHalfDesign
          : base.bw / 2 / (cw / ch);
      const camY = halfH + base.bottom > 0 ? halfH + base.bottom : 0;

      return {
        dpr: resolveDpr(configs.dpr),
        w: cw,
        h: ch,
        aspect: clamped,
        fov,
        camY,
        a,
        rw: vw,
        rh: vh,
        bad: a < minAspect - 1e-9 || a > maxAspect + 1e-9,
      };
    };

    /** 越界时：控制台报错 + 页面左上红条；仍按边界渲染（letterbox 居中），便于排查 */
    const warn = (v: FitResult) => {
      let el = document.getElementById('__fitErr');
      if (!v.bad) {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = '__fitErr';
        el.style.cssText = [
          'position:fixed',
          'left:0',
          'top:0',
          'z-index:99999',
          'background:#c62828',
          'color:#fff',
          'font:13px/1.7 Consolas,monospace',
          'padding:10px 14px',
          'white-space:pre',
          'max-width:100vw',
        ].join(';');
        document.body.appendChild(el);
      }
      /**
       * ★ 两侧的来源不同 ⇒ 给的出口也必须不同（否则等于教用户去改一个改不动的值）：
       *   `'height'` 的上界来自素材（写宽了会被收回）；`'width'` 的下界来自素材（写松了会被收回）。
       */
      const hint =
        fitAspect === 'height'
          ? ' 渲染（letterbox 居中留边）。\n' +
            '上界 ' +
            maxAspect.toFixed(4) +
            ' 由素材给出（最宽贴图层 ' +
            Math.round(base.wmax) +
            ' ÷ 可见世界高 ' +
            Math.round(visibleH) +
            '）：把窗口调窄即可；\n' +
            '或调小 config.json 的 fov（可见世界高随之变小、上界变大），' +
            '亦可改用「按画幅宽对齐」（fitAspect: "width"）。'
          : ' 渲染（letterbox 居中留边）。\n' +
            '下界 ' +
            minAspect.toFixed(4) +
            ' 由素材给出（底层背景的宽高比）：把窗口调矮即可，写更小的 minAspect 也压不下去；\n' +
            '要更宽的比例可改 config.json 的 maxAspect（上界那一侧才是人为闸门）。';
      el.textContent =
        '[画幅不支持] 视口 ' +
        v.rw +
        'x' +
        v.rh +
        '  aspect=' +
        v.a.toFixed(4) +
        '  超出允许范围 ' +
        minAspect.toFixed(4) +
        ' ~ ' +
        maxAspect.toFixed(4) +
        '\n已按边界 ' +
        v.aspect.toFixed(4) +
        hint;
      console.error(
        '[fit] aspect ' +
          v.a.toFixed(4) +
          ' out of [' +
          minAspect.toFixed(4) +
          ', ' +
          maxAspect.toFixed(4) +
          '] (viewport ' +
          v.rw +
          'x' +
          v.rh +
          ')'
      );
    };

    return { calc, warn };
  })();

  const fit0 = fit.calc();
  //#endregion

  //#region BASIC SETUP
  // Create an empty scene
  scene = new THREE.Scene();

  // Create a basic perspective camera
  // ★ FOV / aspect / 相机偏移全部由上面的适配模块给出，缺省值保持模板原行为。
  camera = new THREE.PerspectiveCamera(fit0.fov, fit0.w / fit0.h, 1, 5000);
  camera.position.x = configs.cameraX ?? 0;
  camera.position.y = fit0.camY;
  camera.position.z = 0;
  // Create a renderer with Antialiasing
  renderer = new THREE.WebGLRenderer({ antialias: true });
  // Configure renderer clear color
  renderer.setClearColor('#000000');
  // 渲染缓冲 = 内容视口 × dpr（`"auto"` 时跟随屏幕 DPI，
  // 见 09 文档 `14_清晰度诊断_2K屏糊.md` §3）
  renderer.setPixelRatio(fit0.dpr);
  // Configure renderer size
  renderer.setSize(fit0.w, fit0.h);
  // 首次越界检查（放在 setSize 之后：warn 可能往 body 里插红条）
  fit.warn(fit0);
  // Append Renderer to DOM
  const canvasElement = renderer.domElement;
  document.body.appendChild(canvasElement);
  //#endregion

  //#region event register
  window.addEventListener('resize', onWindowResize, false);
  function onWindowResize() {
    const v = fit.calc();
    camera.aspect = v.w / v.h;
    camera.fov = v.fov;
    camera.position.y = v.camY;
    camera.updateProjectionMatrix();
    // dpr 一并刷新：`"auto"` 下屏幕 DPI 变化（如跨屏）时，setSize 会沿用旧倍率
    renderer.setPixelRatio(v.dpr);
    renderer.setSize(v.w, v.h);
    fit.warn(v);
  }

  document.addEventListener('mousemove', onMouseMove, false);
  function onMouseMove(event: MouseEvent) {
    // Update the mouse variable
    event.preventDefault();
    updateCursorFromClient(event.clientX, event.clientY);
  }

  // 按下/点击也刷新一次：否则"鼠标没动过就直接点"时 cursorX/cursorY 会停留在 0，
  // 后续按坐标做热区命中就会错。统一走 updateCursorFromClient 保证口径一致。
  document.addEventListener('mousedown', onMouseDown, false);
  function onMouseDown(event: MouseEvent) {
    updateCursorFromClient(event.clientX, event.clientY);
  }
  //#endregion
};
