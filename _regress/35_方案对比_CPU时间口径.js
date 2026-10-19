/**
 * 方案对比 · 稳健版：**测 CPU 时间，不测帧间隔**。
 *
 * ## 为什么换指标（踩坑记录）
 * 前一版 `34_` 用「rAF 帧间隔」当代理指标，结果自相矛盾：
 *   · 「限 30fps」比基线**慢** 37% ——限帧只会让间隔变宽，不可能变慢
 *   · 「dpr=1.0」比auto **慢** 56% —— 而 auto 在 deviceScaleFactor=1 下本就等于 1.0
 * ⇒ 说明**帧间隔在这个环境里不是可靠代理**：本机 16 核、同时跑着 WorkBuddy 自身
 *   （累计 3190s CPU）与反复起停的 Chrome，调度抖动直接污染了 rAF 节奏。
 *
 * ## 新口径
 * 直接读**进程 CPU 时间增量**（`GetProcessTimes` 语义）：
 *   每组测「墙钟时长T」内的 CPU 时间增量 Δcpu
 *   ⇒ CPU 占用率 = Δcpu / (T × 核数)  百分比
 * 这个量**不受调度抖动影响**（CPU 时间是实际执行时间），
 * 且与用户在任务管理器看到的百分比同口径。
 *
 * 实现：Node侧用 `process.cpuUsage()` 只能测自己 ⇒ 改测 **Chrome 主进程的 CPU 时间**
 *   ——通过 CDP 拿不到 ⇒ 用 `wmic`/`Get-Process` 轮询目标 Chrome 进程树。
 *   简化：每组只起**一个** Chrome（不并行），按进程名聚合其全部进程 CPU 时间。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn, execSync } = require('child_process');

const CFG = path.resolve(__dirname, '..', 'dist', 'assets', 'config.json');
const ORIG = fs.readFileSync(CFG, 'utf8');
const SEC = Number(process.argv[2] || 6);
const REP = Number(process.argv[3] || 3);
const CORES = Number(process.argv[4] || 16);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const httpGet = (u) =>
  new Promise((res, rej) => {
    http.get(u, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
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
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u, { perMessageDeflate: false, maxPayload: 2e8 });
    let id = 0; const pend = new Map();
    ws.on('open', () => resolve({
      send(m, p = {}) { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise((res, rej) => pend.set(i, { res, rej })); },
      close: () => ws.close(),
    }));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    });
  });
}

/**
 * 聚合 Chrome 全部进程的 CPU 时间（秒）。
 * ⚠️ 只统计**本次起的**那一组：靠 user-data-dir 唯一标记筛进程命令行。
 */
function chromeCpuSeconds(marker) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$ps = Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*${marker}*' }; ($ps | ForEach-Object { (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).CPU } | Measure-Object -Sum).Sum"`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const v = parseFloat(String(out).trim());
    return isNaN(v) ? null : v;
  } catch (e) {
    return null;
  }
}

const NO_AA = `(function(){
  var og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, a){
    if (String(t).indexOf('webgl') === 0 && a && typeof a === 'object') {
      a = Object.assign({}, a, { antialias: false });
    }
    return og.call(this, t, a);
  };
})();`;

function throttlePatch(hz) {
  const minGap = 1000 / hz;
  return `(function(){
    var origRAF = window.requestAnimationFrame.bind(window);
    var lastRun = 0;
    window.requestAnimationFrame = function(cb){
      return origRAF(function(t){
        if (t - lastRun >= ${minGap}) { lastRun = t; cb(t); }
        else { origRAF(function(t2){ cb(t2); }); }
      });
    };
  })();`;
}

async function once(label, cfg, inject) {
  fs.writeFileSync(CFG, cfg, 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const marker = 'wbperf' + port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), marker + '-'));
  const ch = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--window-size=1700,750', '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const t = await waitCdp(port);
    const c = await cdp(t.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: 1, mobile: false });
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(9000);

    //就绪门禁
    const ready = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        if(!cv||!cv.width||!cv.height) return JSON.stringify({ok:false,why:'canvas not ready'});
        return JSON.stringify({ok:true,w:cv.width,h:cv.height});})()`,
      returnByValue: true,
    });
    const rdy = JSON.parse(ready.result.value || '{"ok":false}');
    if (!rdy.ok) { c.close(); return { mean: NaN, why: rdy.why }; }

    //★ 核心：以 CPU 时间增量为准
    await sleep(1200); // 让启动抖动过去
    const cpu0 = chromeCpuSeconds(marker);
    const w0 = Date.now();
    await sleep(SEC * 1000);
    const cpu1 = chromeCpuSeconds(marker);
    const wall = (Date.now() - w0) / 1000;

    // 帧间隔只作辅助（判断画面是否真在动）
    await c.send('Runtime.evaluate', {
      expression: `(()=>{window.__P__=[];let l=performance.now();const t0=l;
        function f(){const n=performance.now();window.__P__.push(n-l);l=n;
          if(n-t0<2000)requestAnimationFrame(f);}
        requestAnimationFrame(f);return 1;})()`,
    });
    await sleep(2600);
    const fr = await c.send('Runtime.evaluate', {
      expression: `(()=>{const s=window.__P__.slice(1);if(!s.length)return '';
        s.sort((a,b)=>a-b);
        return JSON.stringify({frames:s.length,median:+s[Math.floor(s.length/2)].toFixed(2)});})()`,
      returnByValue: true,
    });
    c.close();
    const f = fr.result.value ? JSON.parse(fr.result.value) : {};

    if (cpu0 === null || cpu1 === null) return { mean: NaN, why: 'cpu read failed' };
    const dCpu = cpu1 - cpu0;
    return {
      wall: +wall.toFixed(2),
      cpuSec: +dCpu.toFixed(2),
      cpuPct: +((dCpu / (wall * CORES)) * 100).toFixed(1),
      frameMedian: f.median,
      fps: f.median ? +(1000 / f.median).toFixed(1) : null,
    };
  } finally {
    ch.kill();
    await sleep(1500);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

const C = JSON.parse(ORIG.replace(/^﻿/, ''));
const clone = () => JSON.parse(JSON.stringify(C));
const dpr1 = () => { const c = clone(); c.dpr = 1.0; return c; };

const cases = [
  ['基线', () => clone(), null],
  ['① 关MSAA', () => clone(), NO_AA],
  ['② dpr=1.0', () => dpr1(), null],
  ['③ ①+②', () => dpr1(), NO_AA],
  ['④ ①+②+限30fps', () => dpr1(), NO_AA + '\n' + throttlePatch(30)],
  ['⑤ ①+②+限20fps', () => dpr1(), NO_AA + '\n' + throttlePatch(20)],
];

(async () => {
  const out = [];
  try {
    for (const [label, mk, inject] of cases) {
      const runs = [];
      for (let i = 0; i < REP; i++) {
        const r = await once(label, JSON.stringify(mk(), null, 2), inject);
        runs.push(r);
        process.stdout.write(
          `    ${label.padEnd(16)} #${i + 1}: cpu=${r.cpuPct ?? 'n/a'}% (${r.cpuSec ?? '-'}s/${r.wall ?? '-'}s)  fps=${r.fps ?? '-'}\n`
        );
      }
      const pcts = runs.map((r) => r.cpuPct).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out.push({
        label, runs: runs.map((r) => r.cpuPct),
        median: pcts.length ? pcts[Math.floor(pcts.length / 2)] : NaN,
        min: pcts[0], max: pcts[pcts.length - 1],
        fps: runs.map((r) => r.fps).filter(Boolean).slice(-1)[0] ?? null,
      });
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
  }
  console.log('\n=== 汇总（CPU 时间口径，' + CORES + ' 核）===');
  const base = out[0].median;
  for (const r of out) {
    const delta = isNaN(r.median) || isNaN(base) ? '' : `  相对基线=${(((r.median - base) / base) * 100).toFixed(0)}%`;
    console.log(`  ${r.label.padEnd(16)} cpu=${String(r.median).padStart(5)}%  区间[${r.min}~${r.max}]  fps=${r.fps ?? '-'}${delta}`);
  }
  fs.writeFileSync(path.join(__dirname, 'perf_cpu_time.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig 已还原；已写 perf_cpu_time.json');
  process.exit(0);
})();