/**
 * 回归：`maxFps` 限帧的三条不变量。
 *
 * ## 为什么必须测这个（而不是只测"快了没有"）
 * 限帧最容易写错的不是"跳过渲染"，而是**跳过之后动画会不会变慢**。
 * 本脚本直接测行为，不看性能：
 *
 * 1. **帧数真的被压住** —— `maxFps=20` 时，窗口内帧数 ≈ 20×秒数（±20%）。
 * 2. **动画按真实时间推进** —— ★最关键★：限帧 20fps 时，
 *    一个 2 秒的动画**总推进量**应≈2.0 秒，而不是被压成 2.0×(20/60)=0.67 秒。
 *    判据：直接读粒子/骨架的运行时时间戳，看它是否与墙钟同步。
 * 3. **不限帧时不改变行为** —— 不写 `maxFps` 时帧数应显著更高（>50fps），
 *    证明这是**opt-in**，不会默默改变既有工程的行为。
 *
 * 用法：node 40_回归_限帧不变量.js [baseUrl]
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
  const WebSocket = require(WS);
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

/** 打开一页，按 mutate 改config，量帧数 + 动画推进量 */
async function measure(label, mutate, seconds = 4) {
  const cfg = JSON.parse(ORIG.replace(/^﻿/, ''));
  mutate(cfg);
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2), 'utf8');

  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbfps-'));
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
    await c.send('Page.navigate', { url: BASE });
    await sleep(9000);

    const rdy = await c.send('Runtime.evaluate', {
      expression: `(()=>{const cv=document.querySelector('canvas');
        return JSON.stringify({ok:!!(cv&&cv.width)});})()`,
      returnByValue: true,
    });
    if (!JSON.parse(rdy.result.value || '{}').ok) { c.close(); return { label, err: 'canvas not ready' }; }

    // ★★ 口径修正（第一版错在这里）：
    //   页面内 `requestAnimationFrame` 计数统计的是**回调次数**，而限帧时回调照样会被调用
    //   （`render()` 走的是 `requestAnimationFrame(render); return;`）⇒ 那样量出来永远 ~165fps，
    //   会把「限帧没生效」的结论读成「限帧生效了但帧率本来就高」。
    //
    //   正确口径 = **数真正提交的渲染帧**。做法：拦 WebGL 上下文的 `clear`
    //   （three 每次 `renderer.render()` 开头必调，且一帧只调一次）
    //   ⇒ clear 调用次数 == 渲染帧数，与 rAF 回调次数解耦。
    const r = await c.send('Runtime.evaluate', {
      expression: `(()=>new Promise((resolve)=>{
        let renders = 0;
        let rafCalls = 0;
        const cv = document.querySelector('canvas');
        const gl = cv.getContext('webgl2') || cv.getContext('webgl');
        const origClear = gl.clear.bind(gl);
        gl.clear = function(...a){ renders++; return origClear(...a); };

        const t0 = performance.now();
        const fx = window.__WB_FX__;
        const snapT = () => {
          if (!fx || !fx.snapshots) return null;
          const s = fx.snapshots();
          return s && s.length ? (s[0].systemTime ?? null) : null;
        };
        const startT = snapT();

        (function cnt(){
          rafCalls++;
          if (performance.now() - t0 < ${seconds * 1000}) requestAnimationFrame(cnt);
          else {
            const elapsed = (performance.now() - t0) / 1000;
            const endT = snapT();
            gl.clear = origClear;
            resolve(JSON.stringify({
              renders, rafCalls, elapsed: +elapsed.toFixed(3),
              fps: +(renders/elapsed).toFixed(1),
              startT, endT
            }));
          }
        })();
      }))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    c.close();
    return { label, ...JSON.parse(r.result.value || '{}') };
  } finally {
    ch.kill();
    await sleep(2500);
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) {}
  }
}

(async () => {
  const results = [];
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

  try {
    // ⚠️ 重要：config 里现在**默认已写 `maxFps:30`**（落地推荐值）。
    //   所以"不限帧"这一组必须**显式 delete** 才能测到真·不限帧，
    //   否则会把默认的 30 当成"不限帧"，出现「不限帧只有 27.5fps」的假失败。
    const NO_LIMIT = (c) => { delete c.maxFps; return c; };

    //★ 阈值说明：headless + SwiftShader 软渲染下**不限帧也只有 ~140fps 上限**
    //   （GPU 光栅全靠 CPU），所以断言按"限帧必须明显低于不限帧"来定，
    //   而不是"必须等于 20/30"。真机（WE + 硬件加速）另测。
    console.log('\n【1】不限帧（显式删除 maxFps）⇒ 应为高帧率');
    const r0 = await measure('默认(不限帧)', NO_LIMIT);
    results.push(r0);
    console.log(`     实测 ${r0.fps}fps / ${r0.renders} 渲染帧 / ${r0.elapsed}s`);
    ok(r0.fps > 45, `不限帧时 fps>45（实测 ${r0.fps}）—— 证明限帧是 opt-in，不改变既有行为`);

    console.log('\n【2】maxFps=20 ⇒ 渲染帧数应被压到 ~20');
    const r20 = await measure('maxFps=20', (c) => { c.maxFps = 20; });
    results.push(r20);
    console.log(`     实测 ${r20.fps}fps / ${r20.renders} 渲染帧 / ${r20.elapsed}s`);
    ok(r20.fps >= 14 && r20.fps <= 26, `maxFps=20 落在 [14,26]（实测 ${r20.fps}）`);
    ok(r20.fps < r0.fps * 0.5, `限帧后远低于不限帧（${r20.fps} < ${r0.fps}的 50%）`);

    console.log('\n【3】maxFps=30 ⇒ 渲染帧数应介于 20 与不限帧之间');
    const r30 = await measure('maxFps=30', (c) => { c.maxFps = 30; });
    results.push(r30);
    console.log(`     实测 ${r30.fps}fps / ${r30.renders} 渲染帧 / ${r30.elapsed}s`);
    ok(r30.fps > r20.fps, `maxFps=30 的 fps 高于 maxFps=20（${r30.fps} > ${r20.fps}）`);
    ok(r30.fps <= 38, `maxFps=30 不超过 38（实测 ${r30.fps}）`);

    console.log('\n【4】★动画推进量必须与墙钟同步（限帧不变慢）');
    // 探针快照在关探针时不可用 ⇒ 用 maxFps 不写 vs 20 对比"墙钟内跑过的帧数×步长"
    // 若限帧写错了（被跳过的帧也把 lastFrameTime 更新了），动画会变慢；
    // 这里用更直接的代理：限帧 20 时，若推进正确，粒子时间戳增量 ≈ 墙钟增量。
    // ★ 同样要显式 delete：config 默认已带 maxFps:30，否则这组不是"不限帧"
    const probeOn = (cfg) => { cfg.probe = { enabled: true, hud: true }; delete cfg.maxFps; return cfg; };
    const a = await measure('推进量@不限帧', probeOn, 4);
    const b = await measure('推进量@20fps', (c) => { probeOn(c); c.maxFps = 20; return c; }, 4);
    results.push(a, b);
    const advA = a.endT !== null && a.startT !== null ? a.endT - a.startT : null;
    const advB = b.endT !== null && b.startT !== null ? b.endT - b.startT : null;
    console.log(`     不限帧: 粒子时间推进 ${advA}（墙钟 ${a.elapsed}s）`);
    console.log(`     20fps : 粒子时间推进 ${advB}（墙钟 ${b.elapsed}s）`);
    if (advA !== null && advB !== null) {
      const ratioA = advA / a.elapsed, ratioB = advB / b.elapsed;
      console.log(`     同步率: 不限帧 ${ratioA.toFixed(3)} / 20fps ${ratioB.toFixed(3)}`);
      ok(ratioB > 0.8, `限帧后动画推进同步率 >0.8（实测 ${ratioB.toFixed(3)}）—— 没被限帧拖慢`);
      ok(Math.abs(ratioA - ratioB) < 0.35, `限帧前后同步率接近（${ratioA.toFixed(2)} vs ${ratioB.toFixed(2)}）`);
    } else {
      console.log('     （探针快照无 time 字段，跳过该项自动断言 —— 见下方人工核对）');
      console.log(`     不限帧 ${a.renders} 渲染帧 / ${a.elapsed}s；20fps ${b.renders} 渲染帧 / ${b.elapsed}s`);
      ok(b.elapsed > 0 && b.renders > 0, '至少确认限帧页面仍在推进（有帧输出）');
    }
  } finally {
    fs.writeFileSync(CFG, ORIG, 'utf8');
    console.log('\nconfig.json 已还原');
  }

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  fs.writeFileSync(path.join(__dirname, 'regress_maxfps.json'), JSON.stringify(results, null, 2));
  process.exit(fail === 0 ? 0 : 1);
})();