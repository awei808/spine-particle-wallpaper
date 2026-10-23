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
 * ═══════════════════════════════════════════════════════════════════════════
 * **本地资源文本读取**（`config.json` / `events.jsonc`）—— 统一走 XHR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 为什么不用 `fetch()`（2026-10-23，P0-6）
 *
 * WE 里页面是 `file://`。本项目自己已经两处记录过 fetch 在此环境下不可靠：
 *
 *   - `voicePlayer.ts:102-108`：「WE 里页面是 `file://`，`fetch()` 受 CORS 限制
 *     且各版本行为不一 —— 探测本身就会失败」（所以那里选择**不探测**）
 *   - `eventValidate.ts:12`：「运行时不报 `E_VOICE_MISSING`：WE 是 `file://`，
 *     `fetch()` 受 CORS 限制」
 *
 * 而**同一工程里其它所有资源都不走 fetch**：`.skel` / `.atlas` / 贴图全靠
 * `XMLHttpRequest`（`packages/threejs-spine-3.8-runtime-es6/core/src/AssetManager.ts:48`）。
 * 也就是说"XHR 在 `file://` 下可用"已经是本工程的**既成事实**，而最关键的两个
 * 文件（config + 事件表）偏偏交给了 fetch —— 这是个口径分裂，不是风格问题。
 *
 * ## 失败后果（改前）
 *
 * - `config.json` 读不到 ⇒ `main()` 第一条语句抛错 ⇒ **黑屏**，控制台一条
 *   unhandled rejection；桌面壁纸看不到 DevTools。
 * - `events.jsonc` 读不到 ⇒ **更隐蔽**：`loadEventsFile` 返回 `ok:false, events:[]`，
 *   壁纸其余部分完全正常（BGM 响、点击有动作），但字幕/语音**永远不出现**。
 *   用户只会报"没字幕"，根因在网络层。
 *
 * ## 本模块的口径
 *
 * 1. **同步创建 XHR、异步回调**，统一包成 Promise；
 * 2. `file://` 下 `status` 恒为 **0**（不是 200）—— 这是最容易踩的坑：
 *    只判 `status === 200` 会把所有本地读取都判成失败。判据见 `isOk()`；
 * 3. **错误必须带人话原因**（HTTP 状态 / `onerror` / 超时），
 *    由调用方打到屏幕红条上，而不是只 `console.error`。
 */

/** 一次读取失败的原因（给屏幕红条 / 日志用，不抛异常） */
export type ReadFailure = {
  ok: false;
  /** 人话原因，如 `HTTP 404` / `网络错误（file:// 或路径不对）` / `超时` */
  reason: string;
  /** 原始状态码（`file://` 成功时也是 0） */
  status: number;
};

export type ReadSuccess = { ok: true; text: string; status: number };

export type ReadResult = ReadSuccess | ReadFailure;

/**
 * JSON 读取结果。
 *
 * ★ 用 `ok: boolean`（**不是**字面量 `true`）而不是复用 `ReadResult` 的形状：
 *   字面量 `true` 的两个联合分支字段不同，TS 的判别式收窄会失效
 *   （调用方写 `if (!r.ok)` 之后 `r.reason` 仍报 TS2339）。
 *   这里显式声明成三态，让 `if (!r.ok) → r.reason` 能正常收窄。
 */
export type JsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; status: number };

/**
 * 判断 XHR 是否成功。
 *
 * ★★ `file://` 协议下浏览器**不提供 HTTP 状态码**，`status` 恒为 `0`，
 * 而 `responseText` 里有内容 ⇒ 必须把 `status === 0 && 有内容` 也当成功。
 * 只判 `200` 会让本地部署的壁纸**全部**读不到 config（这正是很多
 * "本地能跑、WE 里黑屏"的经典成因）。
 */
const isOk = (status: number, text: string): boolean =>
  (status >= 200 && status < 300) || (status === 0 && text.length > 0);

/**
 * 用 XHR 读一个文本资源。
 *
 * @param url 相对路径（如 `./assets/config.json`）
 * @param timeoutMs 超时（缺省 15 秒）。★ 必须有：`file://` 路径写错时
 *   某些 CEF 版本既不触发 `onerror` 也不触发 `onload`，会**永久 pending**
 *   ⇒ `await` 永不 resolve ⇒ 壁纸连黑屏都没有，只是一个静止的空页面。
 */
export const readTextFile = (
  url: string,
  timeoutMs = 15000
): Promise<ReadResult> =>
  new Promise<ReadResult>((resolve) => {
    let settled = false;
    const done = (r: ReadResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(r);
    };

    let xhr: XMLHttpRequest;
    try {
      xhr = new XMLHttpRequest();
    } catch (err) {
      done({ ok: false, reason: '无法创建 XMLHttpRequest', status: 0 });
      return;
    }

    try {
      /**
       * ★ `overrideMimeType` 让 CEF 别拿 `text/html` 去猜编码：
       *   `events.jsonc` 的扩展名不认识，不指定的话中文会按 latin-1 解出乱码。
       *   （`AssetManager` 对 `.skel`/`.atlas` 也是这么处理的。）
       */
      xhr.overrideMimeType('text/plain; charset=utf-8');
      xhr.open('GET', url, true);
      xhr.timeout = timeoutMs;
      xhr.onload = () => {
        const text = xhr.responseText ?? '';
        if (isOk(xhr.status, text)) {
          done({ ok: true, text, status: xhr.status });
        } else {
          done({
            ok: false,
            reason:
              xhr.status === 0
                ? '读不到文件（路径不对，或是 file:// 下的跨目录限制）'
                : 'HTTP ' + xhr.status,
            status: xhr.status,
          });
        }
      };
      xhr.onerror = () =>
        done({
          ok: false,
          reason: '网络错误（file:// 下通常是路径不对）',
          status: xhr.status,
        });
      xhr.ontimeout = () =>
        done({ ok: false, reason: '超时 ' + timeoutMs + 'ms', status: xhr.status });
      xhr.onabort = () =>
        done({ ok: false, reason: '请求被中断', status: xhr.status });
      xhr.send();
    } catch (err) {
      done({
        ok: false,
        reason: '请求失败：' + ((err as Error)?.message ?? String(err)),
        status: 0,
      });
    }
  });

/**
 * 读 JSON 并解析（`config.json` 用）。
 *
 * @returns `{ ok:true, value }` 或 `{ ok:false, reason }` —— **不抛异常**，
 *   调用方负责把 `reason` 打到屏幕上。
 */
export const readJsonFile = async <T>(
  url: string,
  timeoutMs?: number
): Promise<JsonResult<T>> => {
  const res = await readTextFile(url, timeoutMs);
  /**
   * ⚠️ 显式构造失败对象，不写 `return res`：`ReadSuccess` 的 `ok` 是字面量 `true`，
   *   直接返回会让 TS 报 TS2322（两个 `ok: true` 分支字段不同，无法互赋）。
   */
  if (res.ok === false) {
    return { ok: false, reason: res.reason, status: res.status };
  }
  try {
    /** ★ 去 BOM：Windows 下用记事本/某些编辑器存出来的 JSON 会带 `\uFEFF`，
     *  `JSON.parse` 直接报 `Unexpected token`（哪个字符都看不出来）。 */
    return { ok: true, value: JSON.parse(res.text.replace(/^\uFEFF/, '')) as T };
  } catch (err) {
    return {
      ok: false,
      reason: 'JSON 解析失败：' + ((err as Error)?.message ?? String(err)),
      status: res.status,
    };
  }
};
