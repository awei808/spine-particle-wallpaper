/**
 * 回归：空闲降帧 + WE 帧率接入（`applyGeneralProperties`）。
 *
 * ## 为什么单开一个脚本
 *
 * `40_` 钉的是 `maxFps` 的三条不变量（限帧生效 / 动画不变慢 / opt-in）。
 * 本轮新增的两层上限是**不同的判据**，塞进 40_ 会把"已经通过的基线"搅浑：
 *
 * 1. **空闲降帧**：连续 N 秒无鼠标/事件活动 ⇒ 压到 `idleFps`；
 * 2. **恢复**：鼠标一动 ⇒ 立刻回到基准上限；
 * 3. **WE 优先**：`applyGeneralProperties({fps})` 给过值时以 WE 为准（含 0=不限）。
 *
 * ## 两套口径，缺一不可
 *
 * - **逻辑读数**（主判据）：`__WB_FX__.idleState()` → `{cap, baseCap, idle, cursorAgeMs}`。
 *   直接看"决策对不对"，不受软渲染抖动影响。
 *   ⚠️ 踩过的坑：只看 fps 时，同一份配置在同一台机器上测出过 16 / 90 / 38 三种值
 *   （加载期噪声 + 软渲染），根本没法判对错。
 * - **渲染帧数**（辅判据）：拦 WebGL 的 `clear`（three 每帧开头必调一次），
 *   与 40_ 同一口径 —— 数 rAF 回调会永远读到 ~165fps。
 *
 * ## 模拟 WE
 *
 * `Page.addScriptToEvaluateOnNewDocument` 预置 `___wpxUnpause` + 一个
 * `wallpaperPropertyListener` 空对象，再在 bundle 装好之后调
 * `applyGeneralProperties({fps})`（与 `_work_入口列验证/10_` 同一手法）。
 *
 * 用法：node 42_回归_空闲降帧与WE帧率.js [baseUrl]
 */
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BASE = process.argv[2] || 'http://127.0.0.1:8931/index.html';
const CFG = path.resolve(__dirname, '..', 'dist', 'assets', 'config.json');
const ORIG = fs.readFileSync(CFG, 'utf8');
const WS = path.resolve(__dirname, '..', 'node_modules', 'ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (u) =>
  new Promise((res, rej) => {
    http
      .get(u, (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => res(JSON.parse(d)));
      })
      .on('error', rej);
  });

async function waitCdp(port, t = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    try {
      const l = await httpGet(`http://127.0.0.1:${port}/json/list`);
      const p = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (p) return p;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

function cdp(u) {
  const WebSocket = require(WS);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u, { perMessageDeflate: false, maxPayload: 2e8 });
    let id = 0;
    const pend = new Map();
    ws.on('open', () =>
      resolve({
        send(m, p = {}) {
          const i = ++id;
          ws.send(JSON.stringify({ id: i, method: m, params: p }));
          return new Promise((res, rej) => pend.set(i, { res, rej }));
        },
        close: () => ws.close(),
      })
    );
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) {
        const p = pend.get(m.id);
        pend.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      }
    });
  });
}

/**
 * 打开一页、改 config、量「决策 + 渲染帧率」。
 *
 * @param {string} label
 * @param {(cfg:any)=>any} mutate
 * @param {number} seconds 测量时长
 * @param {{mouse?:boolean, weFps?:number}} [opts]
 */
async function measure(label, mutate, seconds = 4, opts = {}) {
  const cfg = JSON.parse(ORIG.replace(/^\uFEFF/, ''));
  // 读 `__WB_FX__.idleState()` 需要探针开启；HUD 关掉，免得文字重排污染测量
  cfg.probe = { enabled: true, hud: false };
  mutate(cfg);
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');

  const port = 9900 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbidle-'));
  const ch = spawn(
    process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + port,
      '--user-data-dir=' + dir,
      '--window-size=1700,750',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    const t = await waitCdp(port);
    const c = await cdp(t.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1700,
      height: 750,
      deviceScaleFactor: 1,
      mobile: false,
    });

    if (opts.weFps !== undefined) {
      // ★ 必须在 navigate 之前注入：`installWeFpsSignal()` 在 bundle 模块顶层执行，
      //   晚注入就只能等用户在 WE 设置里改一次才会再来回调。
      await c.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `window.___wpxUnpause = function(){};
window.wallpaperPropertyListener = window.wallpaperPropertyListener || {};
setTimeout(function(){
  try {
    var w = window.wallpaperPropertyListener;
    w.applyGeneralProperties && w.applyGeneralProperties({ fps: ${opts.weFps} });
  } catch (e) {}
}, 600);`,
      });
    }

    await c.send('Page.navigate', { url: BASE });
    await sleep(9500);

    const rdy = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        return JSON.stringify({ok:!!(cv&&cv.width), fx:!!(window.__WB_FX__&&window.__WB_FX__.idleState)});})()`,
      returnByValue: true,
    });
    const ready = JSON.parse(rdy.result.value || '{}');
    if (!ready.ok) {
      console.log('     [eval raw] ' + String(r.result && r.result.value).slice(0, 300));
      c.close();
      return { label, err: 'canvas not ready' };
    }
    const st = await c.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__WB_FX__.idleState())',
      returnByValue: true,
    });
    console.log('     [state@load] ' + String(st.result && st.result.value));
    if (!ready.fx) {
      c.close();
      return { label, err: '__WB_FX__.idleState 不可用（探针没开？）' };
    }

    const r = await c.send('Runtime.evaluate', {
      expression: `(()=>new Promise((resolve)=>{
        let renders = 0, beats = 0;
        const cv = document.querySelector('canvas');
        const gl = cv.getContext('webgl2') || cv.getContext('webgl');
        const origClear = gl.clear.bind(gl);
        gl.clear = function(...a){ renders++; return origClear(...a); };
        const fx = window.__WB_FX__;
        const snap = () => { try { return fx.idleState(); } catch (e) { return null; } };
        const s0 = snap();

        const t0 = performance.now();
        let lastBeat = -1e9, mid = null;
        (function tick(){
          const el = performance.now() - t0;
          ${
            opts.mouse
              ? `if (el - lastBeat >= 90) {
                   lastBeat = el; beats++;
                   document.dispatchEvent(new MouseEvent('mousemove', {
                     clientX: 800 + (beats % 200), clientY: 400, bubbles: true
                   }));
                 }`
              : ''
          }
          if (mid === null && el >= ${seconds * 500}) mid = snap();
          if (el < ${seconds * 1000}) { requestAnimationFrame(tick); return; }
          const elapsed = el / 1000;
          gl.clear = origClear;
          resolve(JSON.stringify({
            renders, beats, elapsed: +elapsed.toFixed(3),
            fps: +(renders / elapsed).toFixed(1),
            s0, mid, s1: snap()
          }));
        })();
      }))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      console.log('     [eval 异常] ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    }
    if (!r.result || r.result.value === undefined) {
      console.log('     [eval 空结果] ' + JSON.stringify(r).slice(0, 500));
    }
    console.log('     [eval 原文] ' + String(r.result && r.result.value).slice(0, 300));
    c.close();
    return { label, ...JSON.parse(r.result.value || '{}') };
  } finally {
    ch.kill();
    await sleep(2500);
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {}
  }
}

const fmt = (s) =>
  s ? `cap=${s.cap} base=${s.baseCap} idle=${s.idle} age=${Math.round(s.cursorAgeMs)}ms` : 'null';

(async () => {
  const results = [];
  let pass = 0;
  let fail = 0;
  const ok = (cond, msg) => {
    if (cond) {
      pass++;
      console.log('  ✓ ' + msg);
    } else {
      fail++;
      console.log('  ✗ ' + msg);
    }
  };

  try {
    console.log('\n【1】空闲降帧：maxFps=30 / idleFps=20 / idleAfterSec=2，无鼠标');
    const idle = await measure('空闲', (c) => {
      c.maxFps = 30;
      c.idleFps = 20;
      c.idleAfterSec = 2;
      return c;
    });
    results.push(idle);
    console.log(`     决策 ${fmt(idle.s1)}  实测 ${idle.fps}fps / ${idle.renders} 帧`);
    ok(idle.s1 && idle.s1.idle === true, `判成空闲（idle=${idle.s1 && idle.s1.idle}）`);
    ok(idle.s1 && idle.s1.cap === 20, `上限压到 idleFps=20（cap=${idle.s1 && idle.s1.cap}）`);
    ok(idle.fps >= 10 && idle.fps <= 26, `渲染帧率落在 [10,26]（实测 ${idle.fps}）`);

    console.log('\n【2】恢复：同配置 + 每 90ms 一次 mousemove');
    const active = await measure(
      '交互',
      (c) => {
        c.maxFps = 30;
        c.idleFps = 20;
        c.idleAfterSec = 2;
        return c;
      },
      4,
      { mouse: true }
    );
    results.push(active);
    console.log(
      `     决策 ${fmt(active.s1)}  实测 ${active.fps}fps / ${active.renders} 帧 / dispatch ${active.beats} 次`
    );
    ok(active.beats > 20, `鼠标事件确实派发了（${active.beats} 次）`);
    ok(active.s1 && active.s1.idle === false, `被判成"非空闲"（idle=${active.s1 && active.s1.idle}）`);
    ok(active.s1 && active.s1.cap === 30, `上限回到基准 30（cap=${active.s1 && active.s1.cap}）`);
    ok(active.fps >= 22 && active.fps <= 40, `渲染帧率回到 [22,40]（实测 ${active.fps}）`);

    console.log('\n【3】WE 优先：config.maxFps=30，WE 下发 fps=15');
    const we15 = await measure(
      'WE15',
      (c) => {
        c.maxFps = 30;
        delete c.idleFps;
        return c;
      },
      4,
      { weFps: 15 }
    );
    results.push(we15);
    console.log(`     决策 ${fmt(we15.s1)}  实测 ${we15.fps}fps / ${we15.renders} 帧`);
    ok(we15.s1 && we15.s1.baseCap === 15, `基准上限取 WE 的 15（baseCap=${we15.s1 && we15.s1.baseCap}）`);
    ok(we15.s1 && we15.s1.cap === 15, `生效上限 15（cap=${we15.s1 && we15.s1.cap}）`);
    ok(we15.fps >= 10 && we15.fps <= 21, `渲染帧率落在 [10,21]（实测 ${we15.fps}）`);

    console.log('\n【4】WE 选「无限制」：config.maxFps=30，WE 下发 fps=0');
    const we0 = await measure(
      'WE0',
      (c) => {
        c.maxFps = 30;
        delete c.idleFps;
        return c;
      },
      4,
      { weFps: 0 }
    );
    results.push(we0);
    console.log(`     决策 ${fmt(we0.s1)}  实测 ${we0.fps}fps / ${we0.renders} 帧`);
    ok(we0.s1 && we0.s1.cap === 0, `上限为 0=不限（cap=${we0.s1 && we0.s1.cap}）`);
    ok(we0.fps > 45, `不再受 config 的 30 约束（实测 ${we0.fps} > 45）`);
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
    console.log('\nconfig.json 已还原');
  }

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  fs.writeFileSync(
    path.join(__dirname, 'regress_idle_wefps.json'),
    JSON.stringify(results, null, 2)
  );
  process.exit(fail === 0 ? 0 : 1);
})();
