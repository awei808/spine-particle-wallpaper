/**
 * 方案对比 · 权威口径：**主线程 TaskDuration 增量**。
 *
 * ## 为什么不看帧间隔（两轮踩坑的记录）
 * · `34_` 出现「限 30fps 比基线慢 37%」「dpr=1.0 比 auto 慢 56%」这种**物理上不可能**的结果。
 * · 根因：本机 16 核，同时跑着 WorkBuddy 自身（累计 3190s CPU）与反复起停的 Chrome；
 *   调度抖动直接污染 rAF 节奏。**帧间隔是"墙钟"，不是"工作量"**，不能当 CPU 占用。
 *
 * ## 本脚本的口径
 * CDP `Performance.getMetrics` 的 **`TaskDuration`** =渲染进程**主线程实际执行时间**。
 * 取测量窗内的增量 Δtask，除以墙钟窗长 ⇒ **主线程忙碌率**（0~1）。
 * 这个量：
 *   · 不受调度抖动影响（统计的是执行时间，不是时间点分布）
 *   · 与"用户看到的卡顿"直接对应（主线程忙 ⇒ 掉帧）
 *   · 不需要查外部进程（WMIC/PowerShell 都被沙箱策略拦）
 *
 * 辅助读数：
 *   · `ScriptDuration`  — JS 自身耗时（区分"JS 慢" vs "渲染/合成慢"）
 *   · `LayoutDuration` / `RecalcStyleDuration` — DOM 布局/样式（查面板、探针 HUD 的影响）
 *
 * 用法：node 36_方案对比_TaskDuration.js [seconds] [repeat]
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
function cdp(u, wsPath) {
  const WebSocket = require(wsPath);
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

/** 取 Performance 指标表的快照 */
const pick = (res, k) => {
  const m = res.metrics.find((x) => x.name === k);
  return m ? m.value : null;
};

const NO_AA = `(function(){
  var og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(t, a){
    if (String(t).indexOf('webgl') === 0 && a && typeof a === 'object') {
      a = Object.assign({}, a, { antialias: false });
    }
    return og.call(this, t, a);
  };
})();`;

/**
 * 帧率节流：被节流掉的帧**完全不执行回调**（这才是真节流）。
 * 若仍执行回调再 return，等于没节流 —— 那样测出来只会是噪声。
 */
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

async function once(cfg, inject) {
  fs.writeFileSync(CFG, cfg, 'utf8');
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtask-'));
  const ch = spawn(process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--remote-debugging-port=' + port, '--user-data-dir=' + dir,
    '--window-size=1700,750', '--disable-background-timer-throttling',
    '--autoplay-policy=no-user-gesture-required', 'about:blank',
  ], { stdio: 'ignore' });
  const WS = path.resolve(__dirname, '..', 'node_modules', 'ws');
  try {
    const t = await waitCdp(port);
    const c = await cdp(t.webSocketDebuggerUrl, WS);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Performance.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 750, deviceScaleFactor: 1, mobile: false });
    if (inject) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
    await c.send('Page.navigate', { url: 'http://127.0.0.1:8931/index.html' });
    await sleep(9000);

    //★ 门禁：必须确认画布真的在出画面，否则整轮作废（`34_` 的教训）
    const ready = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        if(!cv||!cv.width||!cv.height) return JSON.stringify({ok:false,why:'canvas'});
        return JSON.stringify({ok:true,w:cv.width,h:cv.height});})()`,
      returnByValue: true,
    });
    const rdy = JSON.parse(ready.result.value || '{"ok":false}');
    if (!rdy.ok) { c.close(); return { why: rdy.why }; }

    // ★ 核心测量：TaskDuration 增量 / 墙钟
    await sleep(1500); // 丢弃启动抖动
    const a = await c.send('Performance.getMetrics');
    const w0 = Date.now();
    await sleep(SEC * 1000);
    const b = await c.send('Performance.getMetrics');
    const wall = (Date.now() - w0) / 1000;

    // 辅助：帧间隔分布（判断画面流畅度，不作 CPU 口径）
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

    const dTask = pick(b, 'TaskDuration') - pick(a, 'TaskDuration');
    const dScript = pick(b, 'ScriptDuration') - pick(a, 'ScriptDuration');
    const dLayout = pick(b, 'LayoutDuration') - pick(a, 'LayoutDuration');
    const dStyle = pick(b, 'RecalcStyleDuration') - pick(a, 'RecalcStyleDuration');
    return {
      wall: +wall.toFixed(2),
      busyPct: +((dTask / wall) * 100).toFixed(1),
      scriptPct: +((dScript / wall) * 100).toFixed(1),
      layoutPct: +((dLayout / wall) * 100).toFixed(1),
      stylePct: +((dStyle / wall) * 100).toFixed(1),
      fps: f.median ? +(1000 / f.median).toFixed(1) : null,
    };
  } finally {
    ch.kill();
    await sleep(2500);
    //★ 残留清理：Windows 上 `fs.rmSync` 对刚退出的 Chrome 目录常失败（文件锁），
    //   积累下来会让后续每轮都在跟上一轮的孤儿进程抢 CPU ⇒ 数据自相矛盾。
    //   两轮实测踩过：11 个孤儿目录 + msedgewebview2/steamwebhelper 抢核，
    //   导致「限 30fps 反而慢 37%」这种物理上不可能的结果。
    try {
      os.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      try {
        const walkRm = (d) => {
          for (const f of fs.readdirSync(d)) {
            const fp = path.join(d, f);
            try {
              if (fs.statSync(fp).isDirectory()) walkRm(fp);
              else fs.unlinkSync(fp);
            } catch (e2) {}
          }
          try { fs.rmdirSync(d); } catch (e2) {}
        };
        walkRm(dir);
      } catch (e2) {}
    }
  }
}

const C = JSON.parse(ORIG.replace(/^﻿/, ''));
const clone = () => JSON.parse(JSON.stringify(C));
const dpr1 = () => { const c = clone(); c.dpr = 1.0; return c; };
/** 关探针（含 HUD 与 crosshair）—— 必须与 `applyProbeConfig` 消费的三键同名 */
const noProbe = () => { const c = clone(); c.probe = { enabled: false, hud: false, crosshair: false }; return c; };
const dpr1NoProbe = () => { const c = noProbe(); c.dpr = 1.0; return c; };

/**
 * `ONLY=1,4,5` 可只跑指定组（按标签首字符匹配）——
 * 全量 7 组 × N轮会超时，分批跑更稳。
 */
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

const cases = [
  ['基线', () => clone(), null],
  ['① 关MSAA', () => clone(), NO_AA],
  ['② dpr=1.0', () => dpr1(), null],
  ['③ ①+②', () => dpr1(), NO_AA],
  ['④ ①+②+限30fps', () => dpr1(), NO_AA + '\n' + throttlePatch(30)],
  ['⑤ ①+②+限20fps', () => dpr1(), NO_AA + '\n' + throttlePatch(20)],
  ['⑥ ①+②+关探针', dpr1NoProbe, NO_AA],
].filter((c) => !ONLY || ONLY.includes(c[0][0]));

(async () => {
  const out = [];
  try {
    for (const [label, mk, inject] of cases) {
      const runs = [];
      for (let i = 0; i < REP; i++) {
        const r = await once(JSON.stringify(mk(), null, 2), inject);
        runs.push(r);
        process.stdout.write(
          `    ${label.padEnd(16)} #${i + 1}: busy=${r.busyPct ?? 'n/a'}%  script=${r.scriptPct ?? '-'}%  layout=${r.layoutPct ?? '-'}%  fps=${r.fps ?? '-'}\n`
        );
      }
      const bs = runs.map((r) => r.busyPct).filter((x) => !isNaN(x)).sort((a, b) => a - b);
      out.push({
        label,
        runs: runs.map((r) => r.busyPct),
        median: bs.length ? bs[Math.floor(bs.length / 2)] : NaN,
        min: bs[0], max: bs[bs.length - 1],
        script: runs.map((r) => r.scriptPct).filter((x) => !isNaN(x)).slice(-1)[0],
        layout: runs.map((r) => r.layoutPct).filter((x) => !isNaN(x)).slice(-1)[0],
        fps: runs.map((r) => r.fps).filter(Boolean).slice(-1)[0] ?? null,
      });
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
  }
  console.log('\n=== 汇总（主线程忙碌率 TaskDuration 口径）===');
  const base = out[0].median;
  for (const r of out) {
    const d = isNaN(r.median) || isNaN(base) || !base ? '' : `相对基线=${(((r.median - base) / base) * 100).toFixed(0)}%`;
    console.log(`  ${r.label.padEnd(16)} busy=${String(r.median).padStart(5)}%  区间[${r.min}~${r.max}]  script=${r.script}%  layout=${r.layout}%  fps=${r.fps ?? '-'}${d ? '  ' + d : ''}`);
  }
  fs.writeFileSync(path.join(__dirname, 'perf_taskduration.json'), JSON.stringify(out, null, 2));
  console.log('\nconfig 已还原；已写 perf_taskduration.json');
  process.exit(0);
})();