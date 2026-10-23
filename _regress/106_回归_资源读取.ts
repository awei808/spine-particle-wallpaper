/**
 * 回归：**配置/事件读取走 XHR + 失败可见**（2026-10-23，P0-6）。
 *
 * ## 为什么单开一条
 *
 * 改前 `main()` 第一条语句是裸 `await fetch('./assets/config.json')`：
 *   - WE 是 `file://`，`fetch` 在此受 CORS 限制且各版本行为不一
 *     （工程自己在 `voicePlayer.ts:102-108` / `eventValidate.ts:12` 都记录过）；
 *   - 失败即 unhandled rejection ⇒ **黑屏**，桌面壁纸看不到 DevTools。
 *
 * 事件表更隐蔽：`loadEventsFile` 返回 `ok:false, events:[]`，壁纸照常渲染、
 * BGM 照常响，只是**字幕与语音永远不出现** —— 用户只会报"没字幕"。
 *
 * ## 这条脚本钉什么
 *
 *   A. **`file://` 的 status=0 必须算成功**（最容易踩的坑：只判 200 会让本地
 *      部署的壁纸**全部**读不到 config）
 *   B. HTTP 错误 / 网络错误 / 超时 / 中断 各自给出**人话原因**，且不抛异常
 *   C. JSON 解析：去 BOM、语法错误带原因
 *   D. `eventsFile` 的缺省读取器**不再是 fetch**（改为 XHR）
 *   E. 超时必须有（路径写错时某些 CEF 既不 onerror 也不 onload ⇒ 永久 pending）
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/106_回归_资源读取.ts
 */
import './polyfill';

import * as fs from 'fs';
import * as path from 'path';

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = ''): void => {
  if (ok) {
    pass++;
  } else {
    fail++;
  }
  console.log(
    '  [%s] %s%s',
    ok ? ' OK ' : 'FAIL',
    label,
    detail ? '  ' + detail : ''
  );
};

/**
 * 装一个假 `XMLHttpRequest`。
 *
 * `assetText.readTextFile` 是在**调用时**才 `new XMLHttpRequest()`，
 * 所以这里可以晚于 import 替换全局 —— 不必在 import 之前 stub。
 */
type Plan = {
  status?: number;
  body?: string;
  /** 触发哪个回调：`load` / `error` / `timeout` / `abort` */
  fire?: 'load' | 'error' | 'timeout' | 'abort';
  /** `send()` 里同步抛错（模拟构造后立刻失败） */
  throwOnSend?: boolean;
};

let plan: Plan = {};
let lastUrl = '';
let lastTimeout = -1;
let lastMime = '';

class FakeXhr {
  status = 0;
  responseText = '';
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = '';
  constructor() {
    /* 由 open() 填 */
  }
  overrideMimeType(m: string): void {
    lastMime = m;
  }
  open(_method: string, url: string): void {
    this.url = url;
    lastUrl = url;
  }
  send(): void {
    lastTimeout = this.timeout;
    if (plan.throwOnSend) {
      throw new Error('模拟 send 抛错');
    }
    this.status = plan.status ?? 200;
    this.responseText = plan.body ?? '';
    const fire = plan.fire ?? 'load';
    /**
     * 异步触发：`readTextFile` 在 `send()` 返回后才挂 `settled` 判定，
     * 同步回调会绕过"已 settle"保护。用 setTimeout(0) 更贴近真实 XHR。
     */
    setTimeout(() => {
      if (fire === 'load') {
        this.onload?.();
      } else if (fire === 'error') {
        this.onerror?.();
      } else if (fire === 'timeout') {
        this.ontimeout?.();
      } else {
        this.onabort?.();
      }
    }, 0);
  }
}

(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
  FakeXhr;

/** 让假 XHR 的 setTimeout(0) 跑完 */
const tick = () => new Promise((r) => setTimeout(r, 5));

/* ⚠️ 必须在装好假 XHR **之后** 才 import 被测模块吗？
   `readTextFile` 在调用时 new，不在模块加载时 new ⇒ 先 import 也安全。
   但为了明确意图，这里用动态 import 之后再断言。 */
const load = async () => {
  const mod = await import('../src/assetText');
  return mod;
};

(async () => {
  const { readTextFile, readJsonFile } = await load();

  console.log('\n── A. file:// 的 status=0 必须算成功 ──');
  {
    plan = { status: 0, body: '{"a":1}' };
    const r = await readTextFile('./assets/config.json');
    await tick();
    const r2 = await readTextFile('./assets/config.json');
    check(r.ok === true, 'A1 status=0 + 有内容 ⇒ ok', JSON.stringify(r.ok));
    check(
      r.ok === true && r.status === 0,
      'A2 保留原始 status=0（不改写成 200，便于排查）',
      ''
    );
    void r2;
  }

  console.log('\n── B. 各类失败都给人话原因，且不抛 ──');
  {
    plan = { status: 0, body: '' };
    const r = await readTextFile('./assets/nope.json');
    check(r.ok === false, 'B1 status=0 且空内容 ⇒ 失败', '');
    check(
      r.ok === false && /路径不对|file:\/\//.test(r.reason),
      'B2 原因里点明"路径不对 / file://"（而不是干巴巴的 status 0）',
      r.ok === false ? r.reason : ''
    );
  }
  {
    plan = { status: 404, body: 'nope' };
    const r = await readTextFile('./assets/x.json');
    check(
      r.ok === false && /404/.test(r.reason),
      'B3 HTTP 404 原因带状态码',
      r.ok === false ? r.reason : ''
    );
  }
  {
    plan = { fire: 'error' };
    const r = await readTextFile('./assets/x.json');
    check(r.ok === false && /网络错误/.test(r.reason), 'B4 onerror ⇒ 网络错误', r.ok === false ? r.reason : '');
  }
  {
    plan = { fire: 'timeout' };
    const r = await readTextFile('./assets/x.json', 8000);
    check(
      r.ok === false && /超时/.test(r.reason),
      'B5 ontimeout ⇒ 超时（含毫秒数）',
      r.ok === false ? r.reason : ''
    );
  }
  {
    plan = { fire: 'abort' };
    const r = await readTextFile('./assets/x.json');
    check(r.ok === false && /中断/.test(r.reason), 'B6 onabort ⇒ 被中断', r.ok === false ? r.reason : '');
  }
  {
    plan = { throwOnSend: true };
    const r = await readTextFile('./assets/x.json');
    check(r.ok === false && /请求失败/.test(r.reason), 'B7 send 抛错被接住（不冒泡）', r.ok === false ? r.reason : '');
  }

  console.log('\n── C. 超时与 MIME 真的设了 ──');
  {
    plan = { status: 200, body: '{}' };
    await readTextFile('./assets/c.json', 12345);
    check(lastTimeout === 12345, 'C1 timeout 被写入 XHR（路径写错时不至于永久 pending）', 'timeout=' + lastTimeout);
    check(
      /charset=utf-8/.test(lastMime),
      'C2 overrideMimeType 指定 utf-8（否则中文按 latin-1 解出乱码）',
      lastMime
    );
  }

  console.log('\n── D. JSON：去 BOM / 语法错误给原因 ──');
  {
    plan = { status: 200, body: '\uFEFF{"width":1700,"height":750}' };
    const r = await readJsonFile<{ width: number }>('./assets/config.json');
    check(
      r.ok === true && r.value.width === 1700,
      'D1 带 BOM 的 JSON 能解析（Windows 编辑器常见）',
      ''
    );
  }
  {
    plan = { status: 200, body: '{"width":1700,,}' };
    const r = await readJsonFile('./assets/config.json');
    check(r.ok === false, 'D2 语法错误 ⇒ 失败而不是抛异常', '');
    check(
      r.ok === false && /JSON 解析失败/.test(r.reason),
      'D3 原因前缀明确是"JSON 解析失败"（与"读不到"区分开）',
      r.ok === false ? r.reason : ''
    );
  }

  console.log('\n── E. eventsFile 的缺省读取器不再是 fetch ──');
  {
    const p = path.resolve(__dirname, '..', 'src', 'eventsFile.ts');
    const src = fs.readFileSync(p, 'utf8');
    /** 只看 `defaultFetcher` 的实现体，别把注释里的 fetch 也算进去 */
    const m = src.match(/const defaultFetcher[\s\S]*?\n};/);
    const body = m ? m[0] : '';
    check(!!body, 'E1 找到 defaultFetcher 定义', '');
    check(
      !!body && !/\bfetch\s*\(/.test(body),
      'E2 defaultFetcher 里不再调用 fetch()',
      ''
    );
    check(
      !!body && /readTextFile/.test(body),
      'E3 defaultFetcher 走 readTextFile（= XHR）',
      ''
    );
  }
  {
    /** `index.ts` 里读 config 也不该再用 fetch */
    const p = path.resolve(__dirname, '..', 'src', 'index.ts');
    const src = fs.readFileSync(p, 'utf8');
    /**
     * ⚠️ 必须先剥注释再判：文件头那段解释**故意**写着「改前是裸 `await fetch(...)`」，
     *    直接正则会命中这句注释，给出假 FAIL。
     *    只剥行注释与块注释（够用：这里不需要处理字符串里的 `//`）。
     */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    check(
      !/await\s+fetch\s*\(/.test(code),
      'E4 index.ts 的**代码**里没有裸 `await fetch(`（注释除外）',
      ''
    );
    /**
     * E5：`showFatal` 的**调用点**必须覆盖三条致命路径
     * （config 读不到 / events 读不到 / 启动链异常）。
     * ⚠️ 只数 `showFatal(` 会把**定义**那一行也算进去，必须排除。
     */
    const calls = (code.match(/(?<!const )showFatal\s*\(/g) ?? []).length;
    check(
      calls >= 3,
      'E5 showFatal 有 ≥3 个调用点（config / events / 顶层 catch）',
      'calls=' + calls
    );
    /** E6：顶层必须是 `main().catch(...)` 而不是裸 `main();` */
    check(
      /main\(\)\s*\.catch\s*\(/.test(code),
      'E6 顶层是 `main().catch(...)`，不是裸 `main()`（否则 unhandled rejection ⇒ 一片黑）',
      ''
    );
  }

  console.log(
    '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
  );
  process.exit(fail === 0 ? 0 : 1);
})();
