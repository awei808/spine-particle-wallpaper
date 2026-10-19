/**
 * **事件表文件**（`assets/events.jsonc`）的读取与解析。
 *
 * ## 为什么事件不在 `config.json` 里
 *
 * `config.json` 是**构建产物**（`21_生成配置.py` / `17_` / `49_` 会整块重写），
 * 注释必然被冲掉；而事件表是**内容**，需要一段能写清楚"字段是什么、优先级怎么排"的
 * 说明。⇒ 事件单独一个文件，配置只留环境参数（见 `docx/PLAN_事件配置文件_2026-10-19.md`）。
 *
 * ## 唯一来源，没有 fallback
 *
 * | 文件 | 结果 |
 * |---|---|
 * | 可解析 | 唯一来源（`config.subtitle.dialogues` 一律忽略） |
 * | 缺失 / 解析失败 | **0 条** + 报错（含行:列） |
 *
 * ⚠️ 刻意**不**回退到 config：回退会把语法错误伪装成"事件变少了但还能播"，
 *   正是以前"两个真相"最坏的形态。少了文件就立刻看得见（面板红字 + 控制台）。
 *
 * ## 注释怎么剥（本文件最容易被写坏的一处）
 *
 * 支持 `//`、`/* *\/`、尾逗号、BOM、CRLF —— 但**字符串里的 `//` 不能被当成注释**
 * （`note` 里写 URL、`voice` 里写路径都会中招）。
 * ⇒ 必须是**扫描器**，不能用正则先剁。
 *
 * ★ 剥注释采用**等长替换**：注释字符换成空格、`\n` 原样保留 ⇒ 字符偏移与原文 1:1，
 *   `JSON.parse` 报的 `position` 能直接换算成**原始文件的行:列**。
 *   用户改错一个逗号，看到的是「第 87 行 第 14 列」，而不是"意外的 token"。
 *
 * 纯函数部分（`stripJsonComments` / `parseEventsFile`）零 DOM、零 fetch
 * ⇒ `ts-node` 可直跑（回归 `_regress/91`）。
 */

import { DialogueEntry } from './config.type';
import { Issue, makeIssue } from './eventModel';

/** 相对 `index.html` 的路径（与 `config.json` 同目录） */
export const EVENTS_FILE_PATH = './assets/events.jsonc';

/** 本引擎认识的格式版本（文件里 `schema` 更大 ⇒ 说明引擎比文件旧） */
export const EVENTS_FILE_SCHEMA = 1;

export type EventsFileResult = {
  /** 真的拿到了可用于建表的事件（文件存在且结构合法） */
  ok: boolean;
  /** 原样的条目（**未归一** —— 归一只在 `normalizeEventTable` 里做一次） */
  events: DialogueEntry[];
  issues: Issue[];
  /** 面板直接显示的一句话（`null` = 没问题） */
  error: string | null;
};

const empty = (error: string, issues: Issue[] = []): EventsFileResult => ({
  ok: false,
  events: [],
  issues,
  error,
});

/**
 * 剥掉注释（`//` 与 `/* *\/`），**保持长度与换行位置不变**。
 *
 * 状态机四态：普通 / 字符串 / 行注释 / 块注释。
 * 字符串里只认 `\"` 转义（JSON 只有这一种合法转义会吃掉引号）。
 */
export const stripJsonComments = (text: string): string => {
  let out = '';
  const n = text.length;
  let i = 0;
  let inString = false;
  let inLine = false;
  let inBlock = false;
  while (i < n) {
    const c = text.charAt(i);
    const next = i + 1 < n ? text.charAt(i + 1) : '';
    if (inLine) {
      // 行注释：换行本身保留（行号不能变）
      out += c === '\n' || c === '\r' ? c : ' ';
      if (c === '\n') {
        inLine = false;
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        out += '  ';
        i += 2;
        inBlock = false;
        continue;
      }
      out += c === '\n' || c === '\r' ? c : ' ';
      i += 1;
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') {
        // 转义：下一个字符**原样**带过去（`\"` 不能让字符串提前结束）
        if (next) {
          out += next;
          i += 2;
          continue;
        }
      } else if (c === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      inLine = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlock = true;
      out += '  ';
      i += 2;
      continue;
    }
    // BOM：换成空格（保长度），否则 JSON.parse 会报"意外的 token"
    out += c === '\uFEFF' ? ' ' : c;
    i += 1;
  }
  return out;
};

/** 去掉 `,]` / `,}` 里的尾逗号（同样等长替换；字符串里的标点不动） */
export const stripTrailingCommas = (text: string): string => {
  const chars = text.split('');
  let inString = false;
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    if (inString) {
      if (c === '\\') {
        i += 1;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < chars.length && /\s/.test(chars[j])) {
        j += 1;
      }
      if (chars[j] === ']' || chars[j] === '}') {
        chars[i] = ' ';
      }
    }
  }
  return chars.join('');
};

/** 字符偏移 ⇒ 1 基的 `{line, col}`（列按字符算，足够定位到逗号） */
export const lineColAt = (text: string, pos: number): { line: number; col: number } => {
  const at = Math.max(0, Math.min(text.length, pos));
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < at; i += 1) {
    if (text.charAt(i) === '\n') {
      line += 1;
      lastBreak = i;
    }
  }
  return { line, col: at - lastBreak };
};

/** 从 `JSON.parse` 的报错里挖出字符偏移（不同 V8 版本的措辞不同，只认 position） */
const positionOf = (message: string): number | null => {
  const m = /position\s+(\d+)/.exec(message);
  return m ? Number(m[1]) : null;
};

/**
 * 解析文件正文。
 *
 * 返回的 `events` **不补默认值、不改字段** —— 归一仍然只在
 * `eventModel.normalizeEventTable` 里做一次（PLAN 的头号纪律）。
 */
export const parseEventsFile = (text: string): EventsFileResult => {
  const cleaned = stripTrailingCommas(stripJsonComments(text));
  if (!cleaned.trim()) {
    return empty(
      '事件文件是空的（只有注释或空白）',
      [makeIssue('E_EVENTS_FILE', 'coerce', 'events.jsonc 为空')]
    );
  }

  let root: unknown;
  try {
    root = JSON.parse(cleaned);
  } catch (err) {
    const raw = (err as Error)?.message ?? String(err);
    const pos = positionOf(raw);
    const where = pos === null ? '' : (() => {
      const lc = lineColAt(cleaned, pos);
      return '第 ' + lc.line + ' 行 第 ' + lc.col + ' 列';
    })();
    const detail = where ? where + '：' + raw : raw;
    return empty('事件文件格式错误 —— ' + detail, [
      makeIssue('E_EVENTS_FILE', 'coerce', 'events.jsonc 解析失败（' + detail + '）'),
    ]);
  }

  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return empty('事件文件的最外层必须是一个对象 `{ "events": [...] }`', [
      makeIssue('E_EVENTS_FILE', 'coerce', 'events.jsonc 顶层不是对象'),
    ]);
  }

  const issues: Issue[] = [];
  const obj = root as { schema?: unknown; events?: unknown };
  if (typeof obj.schema === 'number' && obj.schema > EVENTS_FILE_SCHEMA) {
    issues.push(
      makeIssue(
        'W_EVENTS_FILE_SCHEMA',
        'report',
        'events.jsonc 的 schema=' +
          obj.schema +
          ' 比本引擎认识的 ' +
          EVENTS_FILE_SCHEMA +
          ' 新，缺少的字段按缺省处理'
      )
    );
  }

  if (!Array.isArray(obj.events)) {
    return {
      ok: false,
      events: [],
      issues: issues.concat(
        makeIssue('E_EVENTS_FILE', 'coerce', 'events.jsonc 缺少 `events` 数组')
      ),
      error: '事件文件缺少 `events` 数组',
    };
  }

  const events: DialogueEntry[] = [];
  obj.events.forEach((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push(
        makeIssue('E_EVENTS_FILE', 'coerce', 'events[' + idx + '] 不是对象（已丢弃）')
      );
      return;
    }
    events.push(item as DialogueEntry);
  });

  return { ok: true, events, issues, error: null };
};

/** 只描述用到的 fetch 能力（便于回归里注入假实现，不依赖 `Response`） */
type Fetcher = (
  url: string
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetcher: Fetcher = (url) =>
  fetch(url, { cache: 'no-store' }).then((r) => ({
    ok: r.ok,
    status: r.status,
    text: () => r.text(),
  }));

/**
 * 取回并解析事件文件。
 *
 * @param url 缺省 `./assets/events.jsonc`
 * @param fetcher 缺省全局 `fetch`（回归/离线 CLI 可注入）
 */
export const loadEventsFile = async (
  url: string = EVENTS_FILE_PATH,
  fetcher: Fetcher = defaultFetcher
): Promise<EventsFileResult> => {
  const shown = url.replace(/^\.\//, '');
  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await fetcher(url);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    return empty('读不到事件文件 ' + shown + '（' + msg + '）', [
      makeIssue('E_EVENTS_FILE', 'coerce', '读不到 ' + shown + '：' + msg),
    ]);
  }
  if (!res.ok) {
    return empty(
      '未找到事件文件 ' + shown + '（HTTP ' + res.status + '）',
      [makeIssue('E_EVENTS_FILE', 'coerce', '未找到 ' + shown + '（HTTP ' + res.status + '）')]
    );
  }
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    return empty('事件文件读取中断（' + msg + '）', [
      makeIssue('E_EVENTS_FILE', 'coerce', shown + ' 读取中断：' + msg),
    ]);
  }
  return parseEventsFile(text);
};
