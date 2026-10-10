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
import { Configs, TextureMeshConfig, VideoMeshConfig } from './config.type';

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
 * ★ 改这里的验收方式（2026-10-10 更新；原 `_work_全屏适配/07_单测_fit逻辑.js` 与
 *   `14_验证_新下限与回归.py` 已随该目录归档、不在工作区）：必须**用真实渲染量**，不能只看代码。
 *   起静态服务 + 无头 Chrome，用 `Emulation.setDeviceMetricsOverride` 造出各种视口比例，然后读三样：
 *   ① canvas 的 `getBoundingClientRect()` —— 现在**恒等于视口**（不再 letterbox）；
 *   ② `#__fitErr` 红条是否存在（内容里带"露黑边：左 Npx / 右 Npx…"）；
 *   ③ 截图像素：内容带**内部**是否出现 renderer clear-color 的黑（这一条才是"真露黑"的铁证，
 *      因为黑边与"被裁"在截图外形上很难分辨）。
 *   ①恒等 + ②存在 + ③内部有暗列 ⇒ 判据正确；①恒等 + ②不存在 + ③内部有暗列 ⇒ 检测漏了。
 */
type FitResult = {
  /** 本次生效的渲染倍率（`configs.dpr` 解析后的实际值） */
  dpr: number;
  /** 画布宽（CSS px，未取整）—— 2026-10-10 起**恒等于视口宽**（不再钳制/letterbox） */
  w: number;
  /** 画布高（CSS px，未取整）—— 同上，恒等于视口高 */
  h: number;
  /** 本帧视口比例（不再夹到任何区间） */
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
  /**
   * 四边**真实露黑**的 CSS px（0 = 该边铺满；`noCover` = 素材里一个覆盖层都没有）。
   *
   * ★ 这是逐层投影到屏幕归一化坐标后算出来的**实际缺口**，不是拿去比某个配置数字。
   */
  leak: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    noCover: boolean;
  };
  /** 是否真的露黑（任一边超过 `LEAK_EPS`，或压根没有覆盖层） */
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
 * 判定"这一边真露黑了"的阈值（CSS px）。
 *
 * ★ 为什么不取 0：authored 得刚刚好的工程（fov 由铺满层宽度反推）算下来缺口常在
 *   **亚像素级**（S9 那套是 0.015 px，等价于 0.05 世界单位）—— 取 0 会把"其实铺满了"
 *   判成故障，等于换了个理由误报。0.5 px 既不会漏掉肉眼可见的黑边，也不会被浮点噪声触发。
 */
const LEAK_EPS = 0.5;

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
     * 扫一遍「带显式宽高的层」（`texture` / `video`，两者字段同构），取两样素材事实：
     *
     * - **`cov` = 覆盖层清单**（每层的 x / y / 世界宽高 / z）：露黑检测要按**屏幕投影**逐边比，
     *   所以这里不能只留"并集边界"，得把每层原样留下（各层的 `|z|` 不同 ⇒ 换算系数不同）。
     * - **z 最小的那层**（「最底层的铺满素材」）：它的**下边界 y** 是垂直锚点要钉住的位置
     *   （`base.bottom` / `base.z`）。
     * ⚠️ `spine` / `particle` **不参与**：它们没有显式宽高（spine 给 scale、particle 给贴图）；
     *   base 仍只从 `texture` 里挑（保持既有行为，不含 video）。
     */
    const base = (() => {
      const meshes = configs.meshes || [];
      let zMin = Infinity;
      let bottom = 0;
      const cov: {
        x: number;
        y: number;
        w: number;
        h: number;
        z: number;
      }[] = [];
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i] as TextureMeshConfig | VideoMeshConfig;
        if (!m || !m.position) {
          continue;
        }
        if (m.type !== 'texture' && m.type !== 'video') {
          continue;
        }
        const w = (m.width || 1) * (m.scale || 1);
        const h = (m.height || 1) * (m.scale || 1);
        cov.push({
          x: m.position.x,
          y: m.position.y,
          w,
          h,
          z: m.position.z,
        });
        if (m.type === 'texture' && m.position.z < zMin) {
          zMin = m.position.z;
          bottom = m.position.y - h / 2;
        }
      }
      return { bottom, cov, z: zMin };
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
     * ★★ 判据 = **真实覆盖检测**（2026-10-10 起，取代原闸门 `[minAspect, maxAspect]`）
     *
     * 旧做法：拿视口比例去比一对**配置里的数字**，越界就 letterbox + 红条。两个毛病：
     *
     * 1. 那对数字与"会不会露黑"没有必然关系 —— 决定露黑的是**可见范围**与**图层覆盖**的
     *    屏幕关系，它随 `fov`、`|base.z|`、`cameraX/camY`、以及**每层各自的 `z`** 一起变
     *    （实测：同一个 `maxAspect: 2.4` 在 S9 上"偏紧"、在单层 dev config 上"偏松 0.035"）。
     * 2. 数字与实际不符时是**静默露黑**：不报错、不留痕，画面边缘黑掉，几乎没有线索。
     *
     * 现做法：把**本帧的可见范围**与**每层覆盖**都投影到屏幕归一化坐标，逐边相减 ——
     * 哪一边真露黑、露多少 CSS px，就报哪一边。**完全不看长宽比**；
     * `config.minAspect` / `config.maxAspect` 因此**不再生效**（字段保留只为兼容旧工程，
     * 见 `config.type.ts`；带了这两个字段会打一条 console.warn）。
     *
     * ★ 同时**不再钳制、不再 letterbox**：画布恒等于视口。露黑就是露黑，如实呈现 + 明说，
     *   而不是把画布缩到某个比例再留边（那只会把"为什么黑"藏起来）。
     *
     * ## 为什么必须"投影到屏幕"而不是直接比世界坐标
     *
     * 相机是透视的，不同 `z` 的层要用**自己那一层**的换算系数：同一个世界宽度 `w` 放在更深的
     * `|z|` 上，屏幕覆盖反而**更小** ⇒ x 除以 `|z|·tan(fov/2)·aspect`、y 除以 `|z|·tan(fov/2)`。
     */
    /** 相机水平位置 —— 可见范围以它为中心 */
    const camX = configs.cameraX ?? 0;
    /** 设计视口比例（`'width'` 基准的水平锁定要用它） */
    const aspectD = w0 / h0;

    /**
     * 逐边算露黑，返回 **CSS px**（0 = 该边铺满）。
     *
     * 屏幕归一化坐标（NDC）：右/上 = `+1`，左/下 = `−1`。某边露黑 ⇔ 覆盖并集没够到那条边：
     * 左缺口 `= covL − (−1)`、右缺口 `= 1 − covR`、下缺口 `= covB − (−1)`、上缺口 `= 1 − covT`。
     */
    const detectLeak = (
      vw: number,
      vh: number,
      tanHalfFov: number,
      camY: number
    ) => {
      let covL = Infinity;
      let covR = -Infinity;
      let covB = Infinity;
      let covT = -Infinity;
      if (tanHalfFov > 0) {
        for (let i = 0; i < base.cov.length; i++) {
          const L = base.cov[i];
          const d = Math.abs(L.z);
          if (d <= 0) {
            continue;
          }
          const kx = 1 / (d * tanHalfFov * (vw / vh));
          const ky = 1 / (d * tanHalfFov);
          const l = (L.x - L.w / 2 - camX) * kx;
          const r = (L.x + L.w / 2 - camX) * kx;
          const b = (L.y - L.h / 2 - camY) * ky;
          const t = (L.y + L.h / 2 - camY) * ky;
          if (l < covL) {
            covL = l;
          }
          if (r > covR) {
            covR = r;
          }
          if (b < covB) {
            covB = b;
          }
          if (t > covT) {
            covT = t;
          }
        }
      }
      /** 归一化缺口 → 像素：一个归一化单位 = 半屏 */
      const toPx = (gap: number, side: number) =>
        gap > 0 ? (gap * side) / 2 : 0;
      return {
        noCover: base.cov.length === 0,
        // ★ 左边/下边的缺口是 `cov − (−1) = cov + 1`（写反成 `−1 − cov` 会把"覆盖超出屏幕"
        //   误判成"没铺到" —— 2026-10-10 踩过，dev config @1.20 因此假报"左 129px"）
        left: isFinite(covL) ? toPx(covL + 1, vw) : 0,
        right: isFinite(covR) ? toPx(1 - covR, vw) : 0,
        bottom: isFinite(covB) ? toPx(covB + 1, vh) : 0,
        top: isFinite(covT) ? toPx(1 - covT, vh) : 0,
      };
    };

    /** 旧闸门字段已废弃 —— 留一条日志，免得有人改了 config 却怎么都不生效 */
    if (configs.minAspect !== undefined || configs.maxAspect !== undefined) {
      console.warn(
        '[fit] config 的 minAspect / maxAspect 自 2026-10-10 起不再生效（已改为按真实覆盖检测露黑），本次已忽略。'
      );
    }

    const calc = (): FitResult => {
      let vw = window.innerWidth || w0;
      let vh = window.innerHeight || h0;
      // 视口可能读到 0/1（DevTools 拖动中间态、未布局完成），退回设计基准
      vw = vw > 1 ? vw : w0;
      vh = vh > 1 ? vh : h0;

      const a = vw / vh;

      // 水平锁定（`'width'`）：tan(fov/2) = tan(fov_d/2) · aspect_d / aspect_w
      // 画幅高锁定（`'height'`）：tan(fov/2) 恒定 = tan(fov_d/2)
      const fov =
        fitAspect === 'height'
          ? fovDesign
          : (2 * Math.atan((tanHalfDesign * aspectD) / a) * 180) / Math.PI;
      const tanHalfFov = Math.tan((fov * Math.PI) / 360);

      // 垂直锚点：把可见窗口的下边界钉在底层素材的下边界上（camY 恒 >= 0）
      // ★ 半高必须用**本帧真实的 fov**。旧 `'width'` 分支写的是 `base.bw/2/aspect` ——
      //   只有"fov 由铺满层宽度反推"的工程才恰好相等；不等的工程会锚错（差 |base.z|·Δtan）。
      const halfH = Math.abs(base.z) * tanHalfFov;
      const camY = halfH + base.bottom > 0 ? halfH + base.bottom : 0;

      const leak = detectLeak(vw, vh, tanHalfFov, camY);

      return {
        dpr: resolveDpr(configs.dpr),
        // 画布恒等于视口：不钳制、不 letterbox（见上面「真实覆盖检测」的注释）
        w: vw,
        h: vh,
        aspect: a,
        fov,
        camY,
        a,
        rw: vw,
        rh: vh,
        leak,
        bad:
          leak.noCover ||
          leak.left > LEAK_EPS ||
          leak.right > LEAK_EPS ||
          leak.top > LEAK_EPS ||
          leak.bottom > LEAK_EPS,
      };
    };

    /**
     * 真露黑时：控制台报错 + 页面左上红条。
     *
     * ★ 与旧版的区别：不再有"已按边界 letterbox 居中"那一句 —— 画布就是视口，
     *   黑边留在原地，红条只负责讲清**哪几边、多少像素、为什么、怎么改**。
     */
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
      /** 只列真的露了的那几边（阈值同 `bad`） */
      const side = (n: number, name: string) =>
        n > LEAK_EPS ? [name + ' ' + Math.round(n) + 'px'] : [];
      const sides = ([] as string[]).concat(
        side(v.leak.left, '左'),
        side(v.leak.right, '右'),
        side(v.leak.top, '上'),
        side(v.leak.bottom, '下')
      );
      /**
       * 露在哪一边，是基准决定的：`'height'` 可见高恒定 ⇒ 窗口越宽越容易左右露；
       * `'width'` 可见宽恒定 ⇒ 窗口越高越容易上下露。出口按这个给，别让用户瞎试。
       */
      const reason = v.leak.noCover
        ? '素材里没有任何带尺寸的贴图层 / 视频层 —— 整屏都会是底色。'
        : '图层覆盖不到本帧的可见范围（' +
          (fitAspect === 'height'
            ? '按高：可见高恒定，可见宽随视口比例变宽'
            : '按宽：可见宽恒定，可见高随视口比例变高') +
          '）。';
      el.textContent =
        '[露黑] 视口 ' +
        v.rw +
        'x' +
        v.rh +
        '  aspect=' +
        v.a.toFixed(4) +
        '\n露黑边：' +
        (sides.length ? sides.join(' / ') : '（未落到某一边，见控制台）') +
        '\n原因：' +
        reason +
        '\n怎么改：① 调窗口比例（露在左右就把窗口调窄、露在上下就调矮）；' +
        '② 调小 config.json 的 fov（可见范围整体变小）；' +
        '③ 换对齐基准（按高 ⇄ 按宽，两者锁的方向相反）。' +
        '\n根治：给素材补一层更宽/更高的背景，或把它摆到能盖住的位置。' +
        '\n（判据是"真的露没露"，config 的 minAspect / maxAspect 已不再生效。）';
      console.error(
        '[fit] 露黑 viewport ' +
          v.rw +
          'x' +
          v.rh +
          ' aspect=' +
          v.a.toFixed(4) +
          ' leak(px) L' +
          Math.round(v.leak.left) +
          ' R' +
          Math.round(v.leak.right) +
          ' T' +
          Math.round(v.leak.top) +
          ' B' +
          Math.round(v.leak.bottom) +
          (v.leak.noCover ? ' [无覆盖层]' : '')
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
