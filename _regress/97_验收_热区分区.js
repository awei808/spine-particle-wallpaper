/**
 * 验收：**热区分区（`zones[].design`）在真实运行时跨分辨率都点得中**
 *
 * ## 为什么需要这个脚本（不能只靠 `77` 的纯函数回归）
 *
 * `77` 只验 `touchZones.ts` 的数学。而"分区到底有没有活着"要靠**行为**回答：
 * 在 16:9 / 21:9 下点「手」这个位置，**是不是真的播出了绑在 hand 区上的那条台词**。
 * 这正是最容易假通过的一格 —— 热区坐标写对、条件写对、但投影没接上时，
 * 页面一切正常、点击也有反应（走的是整屏兜底），只有"专属台词永远不出现"。
 *
 * ## 判据（与实现**不同源**才叫验证）
 *
 * 脚本按"设计画幅的物理含义"自己算屏幕坐标（不 import 引擎代码），
 * 引擎按自己的 `designRectToViewport` 算热区 —— 两边算出来的落点必须一致：
 *
 *   - 点 **hand** 矩形中心 ⇒ 必须播 `custom:hold-hand`（台词含「虽然会妨碍战斗」）
 *   - 点 **head** 矩形中心 ⇒ 必须有触摸台词，且**不是**那条牵手
 *   - 点**背景**（左下角）⇒ 必须有触摸台词，且**不是**那条牵手
 *
 * ## 用法
 *
 *   # 先起静态服务（dist 目录）
 *   python -m http.server 8931 --bind 127.0.0.1 --directory dist
 *   npx ts-node --transpile-only _regress/97_验收_热区分区.js
 *   # 或指定 URL：node _regress/97_验收_热区分区.js http://127.0.0.1:8931/index.html
 *
 * ⚠️ 依赖本机 Chrome（`CHROME` 环境变量可覆盖路径）。跑一轮约 90 秒（三个分辨率 × 三次点击）。
 * ⚠️ 坐标是**实测**的（2026-10-21 按 1700×750 截图量取，见 `docx/PLAN_触摸热区*` 补记）；
 *   改了场景摆位/骨架/设计画幅 ⇒ 要重新量 `HAND` / `HEAD`。
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8931/index.html';
const HAND_KEY = '虽然会妨碍战斗';

/** 设计画幅（= `config.width × config.height`） */
const DW = 1700;
const DH = 750;
/** 手 / 头 的设计画幅像素矩形（实测，见文件头） */
const HAND = { x: 1012, y: 96, w: 88, h: 126 };
const HEAD = { x: 1120, y: 0, w: 340, h: 230 };

/** 要跑的分辨率：设计比例 / 16:9 / 21:9 */
const SIZES = [
  { w: 1700, h: 750 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1080 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 设计画幅矩形 → 该视口下的归一化中心点。
 *
 * 与 `src/touchZones.ts` 的 `designRectToViewport` **同公式但独立书写**：
 * `fitAspect: 'width'` ⇒ 可见宽恒定（u 不变）；可见高 = 宽/aspect ⇒ 以底边为锚缩放。
 */
const centerOf = (rect, vw, vh) => {
  const aspectD = DW / DH;
  const aspect = vw / vh;
  /** 半高比：设计态半高 / 当前半高；`width` 基准下 = aspect / aspectD */
  const ky = aspect / aspectD;
  const kx = 1;
  const uD = (rect.x + rect.w / 2) / DW;
  const vD = (rect.y + rect.h / 2) / DH;
  return {
    u: 0.5 + (uD - 0.5) * kx,
    v: 1 - (1 - vD) * ky,
  };
};

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
async function waitCdp(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await httpGet(`http://127.0.0.1:${port}/json/list`);
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) {
      /* 等 Chrome 起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}
function cdp(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    ws.on('open', () =>
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((res, rej) => pending.set(mid, { res, rej }));
        },
        close: () => ws.close(),
      })
    );
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  });
}

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) {
    pass++;
    console.log('  [ OK ] ' + label + (detail ? '  ' + detail : ''));
  } else {
    fail++;
    console.log('  [FAIL] ' + label + (detail ? '  ' + detail : ''));
  }
};

/** 跑一个分辨率：起 Chrome → 点三处 → 收工 */
async function runSize(size) {
  const { w: W, h: H } = size;
  const PORT = 9600 + (process.pid % 300) + (W % 97);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbzone-'));
  const chrome = spawn(
    process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profileDir,
      '--window-size=' + W + ',' + H,
      '--hide-scrollbars',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    const target = await waitCdp(PORT);
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: W,
      height: H,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await c.send('Page.navigate', { url: URL_ });
    await sleep(13000); // 等骨架就绪 + 首轮问候结束

    const evalJs = async (expr) => {
      const r = await c.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 240));
      }
      return r.result && r.result.value;
    };
    const waitIdle = async (maxMs = 25000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        if (!(await evalJs('window.__WB_DIALOGUE__ ? __WB_DIALOGUE__.isBusy() : true'))) {
          return;
        }
        await sleep(400);
      }
    };
    const bubble = () =>
      evalJs(
        `(() => { const n = document.querySelector('#spine-voice-bubble'); return n ? n.innerText.trim() : ''; })()`
      );

    const boot = await evalJs(
      `(() => { const cv = document.querySelector('canvas'); return { api: !!window.__WB_DIALOGUE__, canvas: cv ? cv.width + 'x' + cv.height : 'none' }; })()`
    );
    if (!boot || !boot.api) {
      check(false, `${W}×${H} 运行时 API 可用`, JSON.stringify(boot));
      return;
    }
    check(
      boot.canvas === W + 'x' + H,
      `${W}×${H} 画布尺寸 == 视口（否则热区换算的分母就不对）`,
      boot.canvas
    );

    /** 点一次并读回台词 */
    const poke = async (pt) => {
      await waitIdle();
      await evalJs(`__WB_DIALOGUE__.click(${pt.u}, ${pt.v}); 1`);
      await sleep(1800);
      return (await bubble()) || '';
    };

    const handPt = centerOf(HAND, W, H);
    const headPt = centerOf(HEAD, W, H);
    const handText = await poke(handPt);
    check(
      handText.indexOf(HAND_KEY) >= 0,
      `${W}×${H} 点「手」⇒ 播 hand 区专属台词`,
      `(${handPt.u.toFixed(3)},${handPt.v.toFixed(3)}) "${handText.slice(0, 20)}"`
    );

    const headText = await poke(headPt);
    check(
      headText.length > 0 && headText.indexOf(HAND_KEY) < 0,
      `${W}×${H} 点「头」⇒ 有台词且不是 hand 的那条`,
      `(${headPt.u.toFixed(3)},${headPt.v.toFixed(3)}) "${headText.slice(0, 20)}"`
    );

    const bgText = await poke({ u: 0.1, v: 0.9 });
    check(
      bgText.length > 0 && bgText.indexOf(HAND_KEY) < 0,
      `${W}×${H} 点背景 ⇒ 走整屏兜底，不会误触 hand 台词`,
      `"${bgText.slice(0, 20)}"`
    );
  } catch (e) {
    check(false, `${W}×${H} 执行异常`, e.message);
  } finally {
    chrome.kill();
  }
}

(async () => {
  console.log('热区分区验收： design 坐标跨分辨率\n  目标 ' + URL_);
  for (const s of SIZES) {
    console.log(`\n── ${s.w}×${s.h} ──`);
    // eslint-disable-next-line no-await-in-loop
    await runSize(s);
  }
  console.log('\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})();
