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
 * 运算优先级、`Math.round` 已去除这两处易错点）。改这里必须重跑
 * `_work_全屏适配/07_单测_fit逻辑.js` 与 `14_验证_新下限与回归.py`。
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
     * 扫出「最底层的铺满素材」——z 最小的 texture 层。
     * 它的**宽高比**就是 minAspect 的默认值（垂直方向能把背景用满的极限），
     * 它的**下边界 y** 是垂直锚点要钉住的位置。
     */
    const base = (() => {
      const meshes = configs.meshes || [];
      let zMin = Infinity;
      let bottom = 0;
      let bw = 0;
      let bh = 0;
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i] as TextureMeshConfig;
        if (!m || m.type !== 'texture' || !m.position) {
          continue;
        }
        if (m.position.z < zMin) {
          zMin = m.position.z;
          bw = (m.width || 1) * (m.scale || 1);
          bh = (m.height || 1) * (m.scale || 1);
          bottom = m.position.y - bh / 2;
        }
      }
      return { bottom, bw, bh, z: zMin };
    })();

    const minAspect =
      configs.minAspect ?? (base.bh > 0 ? base.bw / base.bh : 1.54);
    const maxAspect = configs.maxAspect ?? 2.4;

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
        ' 渲染（letterbox 居中留边）。请调整窗口比例，或改 config.json 的 minAspect / maxAspect。';
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
