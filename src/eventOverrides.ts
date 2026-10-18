/**
 * **自定义事件的覆盖层**（PLAN §7.1 / S9）—— 用户新建 / 停用的事件存在
 * `localStorage` 的**增量**里，不拷贝整张表。
 *
 * ## 为什么是增量，不是整表
 *
 * 壁纸更新后内置事件会变（新增语音、修动画名）。整表存 = 用户那张表被**冻结**，
 * 新内容永远进不来；而且"用户表"与"config 表"立刻变成两个真相。
 * ⇒ 只存两类东西：
 *
 * | 字段 | 含义 | 谁写 |
 * |---|---|---|
 * | `added` | 用户新建的事件（`custom:*`） | 面板「自定义事件」页 |
 * | `disabled` | 被用户关掉的键（**含内置**） | 同上（每行一个开关） |
 *
 * ## 合并顺序（`mergeEventOverrides`）
 *
 * ```
 * config.dialogues  →  + added（追加尾部，同 id 不重复）  →  disabled 统一压 enabled:false
 * ```
 *
 * ⚠️ 与 PLAN §7.1 的字面顺序（`config → disabled → added`）有一处**有意的差异**：
 * 这里把 `disabled` **放在最后**统一盖一遍。否则"用户新建了一条、之后又把它关掉"
 * 会因为 `added` 在 `disabled` 之后合并而**复活** —— 开关对自定义事件静默失效，
 * 正是最容易被当成"面板坏了"的那类 bug。
 *
 * ## 生效方式
 *
 * 与 `settingsStore` 同口径：**保存 → 重载**。不做热切换（池/漏斗/校验都是开机
 * 一次性构造的，热拆只会留下半初始化状态）。
 */

import { DialogueEntry, EventKey } from './config.type';
import { eventKeyOf, normalizeEventKey } from './eventModel';

/** localStorage 键（与 `settingsStore` 的设置键**分开**：两者的生命周期不同） */
export const EVENT_OVERRIDES_KEY = 'wb.swe.events.v1';

export type EventOverrides = {
  schema: 1;
  /** 用户新建的事件（**追加到 config 表尾部**） */
  added: DialogueEntry[];
  /** 被关掉的键（内置与自定义都可以关） */
  disabled: EventKey[];
};

export const EMPTY_EVENT_OVERRIDES: EventOverrides = {
  schema: 1,
  added: [],
  disabled: [],
};

/** localStorage 不可用时的退路（与 `settingsStore` 同一手法：只活一个会话） */
let memoryFallback: EventOverrides = { schema: 1, added: [], disabled: [] };

/** 把任意输入洗成合法形状（脏数据只丢那一条，不整份作废） */
export const normalizeOverrides = (raw: unknown): EventOverrides => {
  const out: EventOverrides = { schema: 1, added: [], disabled: [] };
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  const src = raw as { added?: unknown; disabled?: unknown };
  const seen: EventKey[] = [];
  (Array.isArray(src.added) ? src.added : []).forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const key = normalizeEventKey(
      (item as DialogueEntry).id ?? (item as DialogueEntry).actionId
    );
    if (!key || seen.indexOf(key) >= 0) {
      return;
    }
    seen.push(key);
    out.added.push({ ...(item as DialogueEntry), id: key });
  });
  (Array.isArray(src.disabled) ? src.disabled : []).forEach((raw2) => {
    const key = normalizeEventKey(raw2);
    if (key && out.disabled.indexOf(key) < 0) {
      out.disabled.push(key);
    }
  });
  return out;
};

/** 读覆盖层；任何异常都退化为空（= 只用 config，与没建过事件等价） */
export const readEventOverrides = (): EventOverrides => {
  try {
    const raw = window.localStorage.getItem(EVENT_OVERRIDES_KEY);
    if (!raw) {
      return normalizeOverrides(memoryFallback);
    }
    return normalizeOverrides(JSON.parse(raw));
  } catch (err) {
    console.warn(
      '[events] 自定义事件覆盖层不可用，本次会话只在内存里生效: %s',
      (err as Error)?.message ?? err
    );
    return normalizeOverrides(memoryFallback);
  }
};

/** 写覆盖层（**整份替换**；调用方负责先把 draft 合并好） */
export const writeEventOverrides = (o: EventOverrides): void => {
  const next = normalizeOverrides(o);
  memoryFallback = next;
  try {
    window.localStorage.setItem(EVENT_OVERRIDES_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn(
      '[events] 自定义事件写入失败（localStorage 满/被禁用）: %s',
      (err as Error)?.message ?? err
    );
  }
};

/** 清空覆盖层（面板「恢复默认」用） */
export const clearEventOverrides = (): void => {
  memoryFallback = { schema: 1, added: [], disabled: [] };
  try {
    window.localStorage.removeItem(EVENT_OVERRIDES_KEY);
  } catch (err) {
    /* 与 settingsStore 同口径：删不掉也不影响本次会话 */
  }
};

/**
 * 把覆盖层合并进 config 的事件表（**归一之前**调用）。
 *
 * ★ 为什么必须在 `normalizeEventTable` **之前**：新建事件同样要过归一
 *   （补 `on` / `kind` / `pick` 缺省、夹取优先级、丢非法 id）。放在之后就得
 *   补第二遍默认值 —— 那正是 PLAN 反复警告的"两个口径"。
 *
 * @param dialogues `config.subtitle.dialogues` 原样
 * @param overrides 缺省读 localStorage；回归/档案可显式传
 */
export const mergeEventOverrides = (
  dialogues: readonly DialogueEntry[] | undefined,
  overrides: EventOverrides = readEventOverrides()
): DialogueEntry[] => {
  const disabled: EventKey[] = overrides.disabled.slice();
  const kill = (e: DialogueEntry): DialogueEntry =>
    disabled.indexOf(eventKeyOf(e)) >= 0 ? { ...e, enabled: false } : e;

  const out: DialogueEntry[] = (dialogues ?? []).map((e) => ({ ...e }));
  const seen: EventKey[] = out.map((e) => eventKeyOf(e)).filter((k) => !!k);
  overrides.added.forEach((e) => {
    const key = eventKeyOf(e);
    /** 同 id 已在 config 里 ⇒ 以 config 为准（用户表不该能覆盖内置条目） */
    if (!key || seen.indexOf(key) >= 0) {
      return;
    }
    seen.push(key);
    out.push({ ...e });
  });
  return out.map(kill);
};
