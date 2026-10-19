/**
 * 为优化方案定优先级：把「报告里只有推断、没有实测」的项补上数据。
 *
 * 已知（上一轮 3 次重复、区间分离 ⇒ 硬信号）：
 *   · MSAA（`antialias:true`）  ≈ 2×
 *   · dpr:auto→固定值          ≈ 2.6×
 * 未知（本脚本要测）：
 *   · **帧率上限** —— `render()` 是裸 rAF。加 throttle 后 CPU 应近似线性下降，
 *     但对 "画面是否还流畅" 的代价需要量化（帧间隔分布会不会出现长尾）
 *   · **静态贴图层合并** —— 12 层不连续（被角色/粒子夹断）⇒ 不能简单合成一张，
 *     但可以测"合并成 3 段"（段内连续才合）
 *   · **background 层能否烘成单张底图**（z 最靠后的 6 层是连续的）
 *
 * 关键：节流的真实收益在 WE 里取决于 **rAF 被驱动到多少 Hz**。
 * headless 下 rAF≈vsync 60Hz，所以"限到 30fps"应当看到约 2× 的帧间隔改善。
 *
 * 用法：node 34_方案对比.js [seconds] [repeat]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const CFG = path.resolve(__dirname, '..', 'dist', 'assets', 'config.json');
const ORIG = fs.readFileSync(CFG, 'utf8');
const SEC = Number(process.argv[2] || 6);
const REP = Number(process.argv[3] || 3);

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
 * 帧率节流注入：包一层 rAF，按 `hz` 决定是否放行「渲染」。
 *
 * ★ 为什么不直接改 bundle：这里要测的是"节流这个思路值多少"，
 *   用注入可以不改源码、不重建、随测随撤。落地时再写进 `render()`。
 *
 * 做法：劫持 `requestAnimationFrame`，让被节流掉的那些帧**完全不执行回调**
 *   —— 这才是真节流（省下 CPU）；若仍执行回调再 return，等于没节流。
 */
/**
 * 关MSAA 的注入补丁。
 *
 * ⚠️ 上一版写成 `HTMLCanvasElement.prototype.getContext = function(){ ...prototype.__og... }`，
 * 而 `__og` 是在**同一条语句里、赋值之后**才赋值的 —— 但函数体只在被调用时才求值，
 * 表面没错；真正的坑是 `__og` 挂在 prototype 上会成为**可枚举属性**，
 * 且若页面里有别的脚本也包装过 getContext，链条会错乱。
 * 这里改成闭包私存原始引用，不污染 prototype。
 */
const NO_AA = `(function(){
  var og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, a){
    if (String(t).indexOf('webgl') === 0 && a && typeof a === 'object') {
      a = Object.assign({}, a, { antialias: false });
    }
    return og.call(this, t, a);
  };
})();`;

const combine = (...parts) => parts.join('\n');

async function once(cfg, inject) {
  fs.writeFileSync(CFG, cfg, 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbsch-'));
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

    // ★★就绪门禁：上一轮整轮数据全错（各变体一律 6.07ms = 165fps，空跑），
    //   根因就是页面没真正跑起来而 rAF 采样器照跑。**先证明画布在出画面，再采样。**
    const ready = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        if(!cv) return JSON.stringify({ok:false,why:'no canvas'});
        if(!cv.width||!cv.height) return JSON.stringify({ok:false,why:'canvas zero size'});
        // 采样两帧真实绘制：renderer.render 之后 canvas 会被写入
        return JSON.stringify({ok:true, w:cv.width, h:cv.height,
          dom:document.getElementsByTagName('*').length,
          aa: (function(){try{const g=cv.getContext('webgl2')||cv.getContext('webgl');
            return g? String(g.getContextAttributes().antialias) : 'no-ctx';}catch(e){return 'err';}})()});})()`,
      returnByValue: true,
    });
    const rdy = JSON.parse(ready.result.value || '{"ok":false,"why":"eval failed"}');
    if (!rdy.ok) {
      c.close();
      return { mean: NaN, why: 'not ready: ' + rdy.why };
    }
    // 用 PerformanceObserver 抓主线程忙碌度（比帧间隔更贴近"CPU 占用"）
    await c.send('Runtime.evaluate', {
      expression: `(()=>{window.__P__=[];window.__LT__={n:0,ms:0};
        try{new PerformanceObserver(l=>{for(const e of l.getEntries()){window.__LT__.n++;window.__LT__.ms+=e.duration;}})
          .observe({entryTypes:['longtask']});}catch(e){}
        let l=performance.now();const t0=l;
        function f(){const n=performance.now();window.__P__.push(n-l);l=n;
          if(n-t0<${SEC * 1000})requestAnimationFrame(f);}
        requestAnimationFrame(f);return 1;})()`,
    });
    await sleep(SEC * 1000 + 400);
    const g = await c.send('Runtime.evaluate', {
      expression: `(()=>{const s=window.__P__.slice(2).sort((a,b)=>a-b);
        if(!s.length)return '';
        return JSON.stringify({frames:s.length,
          mean:+(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2),
          p50:+s[Math.floor(s.length*0.5)].toFixed(2),
          p95:+s[Math.floor(s.length*0.95)].toFixed(2),
          max:+s[s.length-1].toFixed(2),
          ltN:window.__LT__.n, ltMs:+window.__LT__.ms.toFixed(0)});})()`,
      returnByValue: true,
    });
    c.close();
    return g.result.value ? JSON.parse(g.result.value) : { mean: NaN };
  } finally {
    ch.kill();
    await sleep(700);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

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
const C = JSON.parse(ORIG.replace(/^﻿/, ''));
const clone = () => JSON.parse(JSON.stringify(C));
const dpr1 = () => { const c = clone(); c.dpr = 1.0; return c; };

const cases = [
  ['基线', () => clone(), null],
  ['① 关MSAA', () => clone(), NO_AA],
  ['② dpr=1.0', () => dpr1(), null],
  ['③ ①+②', () => dpr1(), NO_AA],
  ['④ ①+②+限30fps', () => dpr1(), combine(NO_AA, throttlePatch(30))],
  ['⑤ ①+②+限24fps', () => dpr1(), combine(NO_AA, throttlePatch(24))],
];

(async () => {
  const out = [];
  try {
    for (const [label, mk, inject] of cases) {
      const runs = [];
      for (let i = 0; i < REP; i++) {
        const r = await once(JSON.stringify(mk(), null, 2), inject);
        runs.push(r);
        process.stdout.write(`    ${label.padEnd(16)} #${i + 1}: mean=${r.mean}ms p95=${r.p95} longtask=${r.ltMs}ms\n`);
      }
      const means = runs.map((r) => r.mean).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      const lts = runs.map((r) => r.ltMs || 0).sort((a, b) => a - b);
      out.push({
        label,
        runs: runs.map((r) => r.mean),
        median: means.length ? means[Math.floor(means.length / 2)] : NaN,
        min: means[0], max: means[means.length - 1],
        p95: runs.map((r) => r.p95),
        longTaskMs: lts[Math.floor(lts.length / 2)] || 0,
        fps: means.length ? +(1000 / means[Math.floor(means.length / 2)]).toFixed(1) : NaN,
      });
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
  }
  console.log('\n=== 汇总 ===');
  const base = out[0].median;
  for (const r of out) {
    console.log(
      `  ${r.label.padEnd(16)} median=${String(r.median).padStart(6)}ms  fps=${String(r.fps).padStart(5)}  longtask=${String(r.longTaskMs).padStart(4)}ms  相对基线=${(((r.median - base) / base) * 100).toFixed(0)}%`
    );
  }
  fs.writeFileSync(path.join(__dirname, 'perf_schemes.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig 已还原；已写 perf_schemes.json');
  process.exit(0);
})();