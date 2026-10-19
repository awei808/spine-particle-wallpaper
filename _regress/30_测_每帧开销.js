/**
 * 量化 WE 壁纸的每帧 CPU 开销构成。
 *
 * 目的：区分 CPU 被谁吃掉 —— JS（粒子解算 / 骨架 / 事件）还是
 * 光栅化 + 合成（12 层透明全屏叠加 × dpr² 像素 × antialias）。
 *
 * 口径：
 *  - `__rAF帧间隔`  = 浏览器实际出帧节奏（含 vsync 等待）
 *  - `JS 主线程忙时` = rAF 回调体 + 三次 PerformanceObserver 长任务累计
 *  - `GPU/光栅`≈ 帧间隔 − JS 忙时（差值 ⇒ 不是我们 JS 的锅）
 *  - `renderer.info` = drawcall / 三角形数 / 几何体 / 贴图 / program
 *
 * 用法：node 30_测_每帧开销.js [url] [seconds]
 */
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL_ = process.argv[2] || 'http://127.0.0.1:8931/index.html';
const SECONDS = Number(process.argv[3] || 12);
const PORT = 9411 + (process.pid % 500);
const OUT = path.join(__dirname, 'perf_profile.json');

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitCdp(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await httpGet(`http://127.0.0.1:${port}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

/** 极简 CDP 客户端 */
function cdp(wsUrl) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.on('open', () =>
      resolve({
        send(method, params = {}, sessionId) {
          const mid = ++id;
          const msg = { id: mid, method, params };
          if (sessionId) msg.sessionId = sessionId;
          ws.send(JSON.stringify(msg));
          return new Promise((res, rej) => pending.set(mid, { res, rej }));
        },
        on(fn) {
          listeners.push(fn);
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
      } else {
        listeners.forEach((fn) => fn(m));
      }
    });
  });
}

(async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbperf-'));
  const chrome = spawn(
    process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    [
      '--headless=new',
      '--no-sandbox',
      '--enable-unsafe-swiftshader',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + profileDir,
      '--window-size=1700,750',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let code = 0;
  try {
    const target = await waitCdp(PORT);
    const c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1700,
      height: 750,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const logs = [];
    c.on((m) => {
      if (m.method === 'Log.entryAdded') logs.push(m.params.entry.text);
    });

    await c.send('Page.navigate', { url: URL_ });
    await sleep(9000); // 等资源加载 + 首批粒子预热

    // ── 装帧采样器（在页面里跑，避开 CDP 往返）──────────────────────
    const probeSrc = `(() => {
      window.__PERF__ = { raf: [], js: [], longTasks: 0, longTaskMs: 0 };
      let last = performance.now();
      const t0 = performance.now();
      function loop() {
        const now = performance.now();
        window.__PERF__.raf.push(now - last);
        last = now;
        if (now - t0 < ${SECONDS * 1000}) requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) {
            window.__PERF__.longTasks++;
            window.__PERF__.longTaskMs += e.duration;
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch (e) {}
      return true;
    })()`;
    await c.send('Runtime.evaluate', { expression: probeSrc });

    // ── 同时抓 CPU Profiler ───────────────────────────────────────
    await c.send('Profiler.enable');
    await c.send('Profiler.setSamplingInterval', { interval: 200 });
    await c.send('Profiler.start');

    await sleep(SECONDS * 1000);

    const { profile } = await c.send('Profiler.stop');
    const perfRes = await c.send('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__PERF__)',
      returnByValue: true,
    });
    const infoRes = await c.send('Runtime.evaluate', {
      expression: `(() => {
        try {
          const cv = document.querySelector('canvas');
          return JSON.stringify({
            canvasW: cv ? cv.width : 0,
            canvasH: cv ? cv.height : 0,
            cssW: cv ? cv.clientWidth : 0,
            cssH: cv ? cv.clientHeight : 0,
            dpr: window.devicePixelRatio,
            domCount: document.getElementsByTagName('*').length,
            probeEl: !!document.getElementById('wb-probe-hud') || !!document.querySelector('[id*=probe]'),
          });
        } catch (e) { return JSON.stringify({err: String(e)}); }
      })()`,
      returnByValue: true,
    });

    const perf = JSON.parse(perfRes.result.value);
    const dom = JSON.parse(infoRes.result.value);

    // ── 聚合 CPU profile：按 self time排函数 ──────────────────────
    const byId = new Map();
    profile.nodes.forEach((n) => byId.set(n.id, n));
    const self = new Map();
    const total = profile.samples.length;
    profile.samples.forEach((id) => {
      const n = byId.get(id);
      if (!n) return;
      const f = n.callFrame;
      const key = `${f.functionName || '(anon)'} @ ${(f.url || '').split('/').pop()}:${f.lineNumber}`;
      self.set(key, (self.get(key) || 0) + 1);
    });
    const dtMs = (profile.endTime - profile.startTime) / 1000;
    const top = [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 22)
      .map(([k, v]) => ({ fn: k, pct: +((v / total) * 100).toFixed(1) }));

    const raf = perf.raf.slice().sort((a, b) => a - b);
    const pick = (p) => +raf[Math.floor(raf.length * p)].toFixed(2);
    const mean = +(raf.reduce((a, b) => a + b, 0) / raf.length).toFixed(2);

    // JS 主线程忙时（长任务口径，rAF 回调本身太短抓不到）
    const jsBusyPct = +((perf.longTaskMs / (raf.length * mean)) * 100).toFixed(1);

    const report = {
      url: URL_,
      seconds: SECONDS,
      dom,
      frames: {
        count: raf.length,
        meanMs: mean,
        p50: pick(0.5),
        p90: pick(0.9),
        p99: pick(0.99),
        fpsFromMean: +(1000 / mean).toFixed(1),
        longTasks: perf.longTasks,
        longTaskMs: +perf.longTaskMs.toFixed(1),
        jsBusyPctOfWall: jsBusyPct,
      },
      cpuProfile: { totalSamples: total, durationMs: +dtMs.toFixed(0), top },
      consoleErrors: logs.slice(0, 12),
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    console.error('FAIL:', e.message);
    code = 1;
  } finally {
    chrome.kill();
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (e) {}
  }
  process.exit(code);
})();