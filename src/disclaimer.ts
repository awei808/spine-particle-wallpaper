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
 * 屏幕居中的「免责声明与许可证要求」弹窗。
 *
 * ## 为什么要有它
 *
 * 本壁纸**整包使用官方素材**（角色骨架 / 贴图 / 语音 / BGM）且用 Spine Runtimes 播放动画，
 * 上传到创意工坊属于"再分发"行为，而 Spine 的许可证**明文要求**再分发时必须随附
 * 许可证与版权声明（见下方 `buildSections` 引述的原文）。
 * ⇒ 与其把声明藏在项目目录里没人看，不如做成一个**能在壁纸里直接展示**的开关项。
 *
 * ## ★ 显示与否只由 WE 属性 `showDisclaimer` 决定（用户拍板 2026-09-27）
 *
 * 开关打开 ⇒ 弹窗**常驻**居中显示；关掉 ⇒ 消失。**热切换，不重载页面**
 * （它改的只是一个 DOM 的 `display`，跟 `showSettings` 同一套口径，
 * 详见 `index.ts` 里 `applyWePatch` 的注释）。
 *
 * ## ★★ 必须 `stopPropagation`
 *
 * 与设置面板同理：`touch.ts` 把 mousedown 挂在 **`document`** 上、热区是整屏一个区
 * ⇒ 不拦的话点弹窗会被判成"点了角色"，在弹窗背后播触摸动画、弹气泡。
 *
 * ## ★★ 不用 `backdrop-filter`（WE CEF 渲染进程 SIGILL，2026-09-25 实锤）
 *
 * 大面积毛玻璃在 WE 的 CEF 上会让渲染进程崩（本机 Chrome 不崩 ⇒ 本地 PASS 不代表 WE 能跑）。
 * ⇒ 遮罩与卡片一律**实色半透明**。
 *
 * ## ★★ 内容必须一屏装得下（WE 不转发鼠标滚轮）
 *
 * `wheel` 事件在 WE 里永不触发、原生滚动条也拖不动（详见 `settingsPanel.ts` 文件头）。
 * ⇒ 正文超高时**等比缩小卡片内层**（`fitContent`，与面板的 `fitPanelScale` 同一思路），
 *   而不是指望用户去滚。`overflow-y:auto` 只作为浏览器预览时的兜底。
 *
 * ## z-index 口径
 *
 * 气泡 `2147483640` < **本弹窗 `2147483646`** < 设置面板 `2147483647`。
 * 弹窗不能盖住设置面板 —— 面板是用户唯一能实时改设置的入口。
 */

import { DisclaimerConfig } from './config.type';
import { UI_SCALE_VAR, fpx, getUiScale, initUiScale, uiPx } from './uiScale';

export type DisclaimerOptions = DisclaimerConfig & {
  /** 初始是否显示（WE 属性值 → localStorage 覆盖层，由调用方决定） */
  visible: boolean;
};

export type DisclaimerModal = {
  /** 热切换显示/隐藏 */
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
  dispose: () => void;
};

const FONT =
  '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';

/** 与面板同款：所有可能被庄在弹窗上的指针/鼠标/触摸事件。漏一个就会顺带触发一次角色触摸 */
const SWALLOW_EVENTS = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'wheel',
  'contextmenu',
];

/**
 * 弹窗正文。
 *
 * ## ★ 文案口径：可查证的照抄，**查不到官方条款的绝不假托官方**
 *
 * - 第二段是 Esoteric Software 的《Spine Runtimes License Agreement》
 *   （最后更新 2025-04-05）原文要点的直译，来源：
 *   https://esotericsoftware.com/spine-runtimes-license
 * - 第一段是**本作品自己的立场声明**：只声明"非官方、非商业、权利归原权利人、
 *   要求下架即删除"，并注明以官方最新条款为准。**不编造**官方条款 —— 使用者所用
 *   素材对应的官方若发布了成文规范，应把这里扩充为官方条款的原文链接。
 *
 * ## ★ 文案里的**作品名由 config 提供，不写在代码里**
 *
 * 首段必然要提"原作名与权利人"，而这随使用者手上的素材而变。写死就等于把某一个
 * 具体作品的名字塞进通用工具 ⇒ 只把 `sourceName` / `rightsHolder` 交给
 * `DisclaimerConfig`（见 `config.type.ts`），**缺省不点名任何 IP**。
 */
type Section = { title: string; paras: readonly string[] };

/**
 * 首段第 1 句 —— 唯一用到 `sourceName` / `rightsHolder` 的一句。
 *
 * ★ 两者缺位时降级为**不点名**表述，绝不臆造 IP 名称。
 */
const affiliationSentence = (cfg: DisclaimerConfig): string => {
  const name = (cfg.sourceName ?? '').trim();
  if (!name) {
    return '本壁纸是使用者个人的二次创作作品，非官方出品，与所用素材的原作官方不存在任何关联，未获得官方授权、认可或背书。';
  }
  const holder = (cfg.rightsHolder ?? '').trim();
  return (
    '本壁纸是玩家个人的二次创作作品，非官方出品，与《' +
    name +
    '》官方' +
    holder +
    '不存在任何关联，未获得官方授权、认可或背书。'
  );
};

const buildSections = (cfg: DisclaimerConfig): readonly Section[] => [
  {
    title: '一、玩家二次创作与素材使用声明',
    paras: [
      affiliationSentence(cfg),
      '壁纸中出现的一切角色立绘、Spine 骨架数据与贴图、语音与背景音乐等素材，其著作权及其他相关权利均归原权利人所有。本作品仅在上述范围内作个人学习与技术研究使用。',
      '仅限个人非商业用途：不得以任何形式用于商业用途或营利活动；不得单独提取、再分发本壁纸内含的原始素材；不得宣称或暗示本作品为官方内容。',
      '如权利人或平台提出停止使用的要求，本壁纸将立即停止分发并删除。若官方后续公布二次创作相关规范，以官方最新条款为准。',
    ],
  },
  {
    title: '二、Spine Runtimes 许可证要求',
    paras: [
      '本壁纸使用 Spine Runtimes 播放骨架动画。依据 Esoteric Software LLC 的《Spine Runtimes License Agreement》（最后更新 2025 年 4 月 5 日），特此声明如下：',
      'Copyright (c) 2013-2025, Esoteric Software LLC。将 Spine Runtimes 集成至软件、或创作其衍生作品，须遵守《Spine Editor License Agreement》第 2 条的条款与条件。',
      '在其他情形下，集成 Spine Runtimes 须同时满足两点：本作品的每一位使用者均须自行取得 Spine Editor 许可证；且以任何形式再分发本作品时，必须随附本许可证与上述版权声明。',
      'Spine Runtimes 由 Esoteric Software LLC 按「原样」（AS IS）提供，不提供任何明示或默示的担保，包括但不限于对适销性、特定用途适用性的默示担保；Esoteric Software LLC 亦不对任何直接或间接的损害承担责任。',
      '许可证原文：https://esotericsoftware.com/spine-runtimes-license',
    ],
  },
];

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

export const createDisclaimer = (
  options: DisclaimerOptions
): DisclaimerModal => {
  let visible = options.visible === true;

  // ★ 文案按调用方给的素材归属信息现拼（缺省不点名任何 IP）
  const sections = buildSections(options);

  // ★ 先初始化 UI 缩放变量（幂等）：下面所有 px 都依赖它
  initUiScale();

  /* ── 全屏层（遮罩 + 卡片都挂在这里） ───────────── */
  const root = createEl(
    'div',
    [
      'position:fixed',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      'z-index:2147483646',
      'display:' + (visible ? 'block' : 'none'),
      'font-family:' + FONT,
      'color:#eef1f6',
      'user-select:none',
      '-webkit-user-select:none',
    ].join(';')
  );
  root.id = 'wb-disclaimer-root';
  // ★ 根也要拦：它是 body 的子节点，事件从这里往上冒泡到 document
  SWALLOW_EVENTS.forEach((evt) => {
    root.addEventListener(
      evt,
      (e: Event) => {
        e.stopPropagation();
      },
      false
    );
  });

  /**
   * 半透明遮罩。
   *
   * ★ 只压暗、不糊、不全黑：壁纸仍应看得见（弹窗是"告示"不是"接管"）。
   * ★ 不吃 `pointer-events:none` —— 它要负责拦住"透过弹窗点到角色"的那一下。
   */
  createEl(
    'div',
    [
      'position:absolute',
      'left:0',
      'top:0',
      'width:100%',
      'height:100%',
      // ★ 不用 backdrop-filter（WE CEF 大面积毛玻璃会崩渲染进程，见文件头）
      'background:rgba(0,0,0,0.42)',
    ].join(';'),
    root
  ).id = 'wb-disclaimer-scrim';

  /* ── 卡片（居中 + 固定视口比例） ──────────────────
   *
   * ★ 外框几何用 **vw/vh**（不随 UI 缩放漂）：卡片永远是"视口的 66%×80%"，
   *   缩放只作用于卡片**内层**的字号与间距 ⇒ 可用高度稳定，`fitContent` 才有意义。
   */
  const card = createEl(
    'div',
    [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:66vw',
      'height:80vh',
      'display:flex',
      'flex-direction:column',
      'box-sizing:border-box',
      'padding:' + uiPx(18) + ' ' + uiPx(22) + ' ' + uiPx(14),
      'border:' + uiPx(1) + ' solid rgba(255,255,255,0.16)',
      'border-radius:' + uiPx(14),
      'background:rgba(16,18,26,0.94)',
      'box-shadow:0 ' + uiPx(10) + ' ' + uiPx(34) + ' rgba(0,0,0,0.45)',
    ].join(';'),
    root
  );
  card.id = 'wb-disclaimer-card';

  /* ── 头部 ─────────────────────────────────── */
  const header = createEl('div', 'flex:0 0 auto', card);
  const title = createEl(
    'div',
    'font-size:' + fpx(15) + ';font-weight:600;letter-spacing:' + uiPx(0.5),
    header
  );
  title.textContent = '免责声明与许可证要求';
  const sub = createEl(
    'div',
    'font-size:' +
      fpx(11) +
      ';opacity:.55;line-height:1.45;margin-top:' +
      uiPx(3),
    header
  );
  sub.textContent =
    '本壁纸为非商业的玩家二次创作作品，使用第三方素材与 Spine Runtimes。';

  /* ── 正文（唯一滚动容器） ───────────────────── */
  const body = createEl(
    'div',
    [
      'flex:1 1 auto',
      // ★ flex 子项默认 min-height:auto ⇒ 内容会把容器撑破，必须显式 0
      'min-height:0',
      'overflow-y:auto',
      'margin-top:' + uiPx(10),
      'padding-top:' + uiPx(8),
      'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      // 隐藏原生滚动条（WE 里拖不动）；正常情况下 fitContent 已保证不需要滚
      'scrollbar-width:none',
      '-ms-overflow-style:none',
    ].join(';'),
    card
  );
  body.id = 'wb-disclaimer-body';

  sections.forEach((sec, i) => {
    const block = createEl(
      'div',
      'margin-bottom:' + uiPx(i === sections.length - 1 ? 2 : 12),
      body
    );
    const h = createEl(
      'div',
      'font-size:' +
        fpx(13) +
        ';font-weight:600;color:#9fc5f0;margin-bottom:' +
        uiPx(5),
      block
    );
    h.textContent = sec.title;
    sec.paras.forEach((p) => {
      const el = createEl(
        'p',
        'margin:0 0 ' +
          uiPx(6) +
          ';font-size:' +
          fpx(12) +
          ';line-height:1.72;opacity:.88',
        block
      );
      el.textContent = p;
    });
  });

  /* ── 底部提示（怎么关掉它） ──────────────────── */
  const foot = createEl(
    'div',
    [
      'flex:0 0 auto',
      'margin-top:' + uiPx(10),
      'padding-top:' + uiPx(9),
      'border-top:' + uiPx(1) + ' solid rgba(255,255,255,0.10)',
      'font-size:' + fpx(11),
      'opacity:.55',
      'line-height:1.45',
    ].join(';'),
    card
  );
  foot.id = 'wb-disclaimer-foot';
  foot.textContent =
    '关闭方式：在 Wallpaper Engine 的壁纸属性面板中取消勾选「显示免责声明与许可证要求」即可隐藏本窗口（无需重启）。';

  /* ── 自适应：让正文在当前卡片里完整装下 ────────────
   *
   * 与 `settingsPanel.fitPanelScale` 同一思路：卡片高度固定 80vh、body 是 flex:1
   * ⇒ `body.clientHeight` 就是可用高度；超高时按比例覆盖卡片上的 `--wb-ui-s`
   * （内层所有字号/间距都走 uiPx ⇒ 整块等比缩），而不是指望滚动。
   *
   * 幂等：`bodyK` 不变时不写样式 ⇒ 不会和 ResizeObserver 互相触发形成抖动。
   */
  const K_MIN = 0.62;
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
        // 留 0.5% 余量，避免刚好贴边导致下一个循环又判定"超高"
        next = Math.max(K_MIN, (bodyK * avail * 0.995) / content);
      } else if (bodyK < 1 && content < avail - 8) {
        // 变矮了（比如窗口变大）⇒ 把缩放还原回去
        next = Math.min(1, (bodyK * (avail - 4)) / content);
      }
      if (Math.abs(next - bodyK) < 0.002) {
        break;
      }
      bodyK = next;
      card.style.setProperty(UI_SCALE_VAR, String(s * bodyK));
    }
  };

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
    dispose: () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize, false);
      if (root.parentElement) {
        root.parentElement.removeChild(root);
      }
    },
  };
};
