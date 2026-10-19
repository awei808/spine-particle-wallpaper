/**
 * **事件开关状态**（用户侧，`localStorage`）—— 2026-10-19 起面板只做一件事：
 * 决定某条事件在**这台机器上**播不播。
 *
 * ## 事件内容不在这里
 *
 * 事件表（内置 + 自定义）只存在 `assets/events.jsonc`（见 `eventsFile.ts`）。
 * 本模块只管"开 / 关"，**从不创建、不修改、不删除事件** —— 这正是把
 * 增删改交给文件之后，面板里不可能再出现"引擎看不见的状态"的原因。
 *
 * ## 为什么是显式布尔 map，而不是只存 `disabled[]`
 *
 * 文件里可以写 `"enabled": false`（作者默认关闭，比如一条只在节日播的彩蛋）。
 * 若只存"关掉的键"，用户就永远**打不开**那条 —— 开关必须是双向的。
 *
 * ```
 * EventState = { schema: 1, enabled: { "game:64005": false, "custom:x": true } }
 * ```
 *
 * - **只记用户点过的键**（点一下写一个显式值）⇒ 映射大小 = 点过的条数；
 * - 空 map = 全部按文件缺省，「恢复默认」就是清空它；
 * - 悬空键（文件里后来删掉的事件）**静默忽略**，写回时才顺手清（`pruneEventState`）。
 *
 * ## 生效方式
 *
 * 与 `settingsStore` 同口径：**保存 → 重载**。不做热切换（池 / 漏斗 / 校验都是
 * 开机一次性构造的，热拆只会留下半初始化状态）。
 */

import { DialogueEntry, EventKey } from './config.type';
import { eventKeyOf, normalizeEventKey } from './eventModel';

/**
 * localStorage 键。
 *
 * ★ 与 2026-10-18 那版（`wb.swe.events.v1`，含 `added[]`）**不兼容也不迁移**：
 *   那版从未随壁纸发布过，而"本机新建事件"这条路已经整体取消（内容归文件）。
 */
export const EVENT_STATE_KEY = 'wb.events.state.v1';

export type EventState = {
  schema: 1;
  /** 事件键 → 是否开启。**只放用户点过的** */
  enabled: { [key: string]: boolean };
};

export const EMPTY_EVENT_STATE: EventState = { schema: 1, enabled: {} };

/** localStorage 不可用时的退路（与 `settingsStore` 同一手法：只活一个会话） */
let memoryFallback: EventState = { schema: 1, enabled: {} };

/** 把任意输入洗成合法形状：脏键只丢那一条，不整份作废 */
export const normalizeEventState = (raw: unknown): EventState => {
  const out: EventState = { schema: 1, enabled: {} };
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  const src = (raw as { enabled?: unknown }).enabled;
  if (!src || typeof src !== 'object' || Array.isArray(src)) {
    return out;
  }
  Object.keys(src as { [k: string]: unknown }).forEach((rawKey) => {
    const key = normalizeEventKey(rawKey);
    const val = (src as { [k: string]: unknown })[rawKey];
    if (!key || typeof val !== 'boolean' || key in out.enabled) {
      return;
    }
    out.enabled[key] = val;
  });
  return out;
};

/** 读开关；任何异常都退化为空（= 全部按文件缺省） */
export const readEventState = (): EventState => {
  try {
    const raw = window.localStorage.getItem(EVENT_STATE_KEY);
    if (!raw) {
      return normalizeEventState(memoryFallback);
    }
    return normalizeEventState(JSON.parse(raw));
  } catch (err) {
    console.warn(
      '[events] 事件开关读取失败，本次会话只在内存里生效: %s',
      (err as Error)?.message ?? err
    );
    return normalizeEventState(memoryFallback);
  }
};

/** 写开关（**整份替换**；调用方负责先把草稿整理好） */
export const writeEventState = (o: EventState): void => {
  const next = normalizeEventState(o);
  memoryFallback = next;
  try {
    window.localStorage.setItem(EVENT_STATE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn(
      '[events] 事件开关写入失败（localStorage 满/被禁用）: %s',
      (err as Error)?.message ?? err
    );
  }
};

/** 清空开关 = 全部回落到文件缺省（面板「恢复默认」） */
export const clearEventState = (): void => {
  memoryFallback = { schema: 1, enabled: {} };
  try {
    window.localStorage.removeItem(EVENT_STATE_KEY);
  } catch (err) {
    /* 与 `settingsStore` 同口径：删不掉也不影响本次会话 */
  }
};

/**
 * 把开关压进事件表（**归一之前**调用）。
 *
 * ★ 为什么在 `normalizeEventTable` 之前：`enabled` 也在那一层被归成布尔
 *   （`eventModel.ts` 里 `enabled: rawEntry.enabled !== false`），先压再归一只需要
 *   遵守一个顺序；反过来就要在归一之后二次改写，等于两个口径。
 *
 * @param events 文件读出来的原始条目
 * @param state 缺省读 localStorage；回归可显式传
 */
export const applyEventState = (
  events: readonly DialogueEntry[],
  state: EventState = readEventState()
): DialogueEntry[] =>
  events.map((e) => {
    const key = eventKeyOf(e);
    if (!key || !(key in state.enabled)) {
      return e;
    }
    return { ...e, enabled: state.enabled[key] };
  });

/**
 * 丢掉文件里已不存在的键（写回前调用，防止 localStorage 越攒越脏）。
 *
 * @param keys 事件表里现存的全部键
 */
export const pruneEventState = (
  state: EventState,
  keys: readonly EventKey[]
): EventState => {
  const out: EventState = { schema: 1, enabled: {} };
  keys.forEach((k) => {
    if (k in state.enabled) {
      out.enabled[k] = state.enabled[k];
    }
  });
  return out;
};
