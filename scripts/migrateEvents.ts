/**
 * 事件表**迁移 CLI**（PLAN §5 / S8）—— 把旧池键（`greeting` / `standby` / `touch` /
 * `greet` / `chat`）**一次性烧进条目**，然后删掉这些键。
 *
 * ```bash
 * npx ts-node --transpile-only scripts/migrateEvents.ts public/assets              # 只打印计划（dry-run）
 * npx ts-node --transpile-only scripts/migrateEvents.ts public/assets --write      # 真写
 * npx ts-node --transpile-only scripts/migrateEvents.ts public/assets --json       # 机器可读
 * ```
 *
 * ## 为什么必须有这一步（而不是继续"运行期反推"）
 *
 * `normalizeEventTable` 能从旧池键反推出 `on` / `kind` / `when`，行为已经等价；
 * 但每张 config 因此都带着两套真相：**改一个数组的顺序，条件会静默漂移**
 * （问候的时段靠下标对位）。迁移后条件写在条目上，顺序怎么排都不影响语义。
 *
 * ## 判定口径：**复用 `normalizeEventTable`，不在这里重写一遍**
 *
 * 迁移的每一步判断（旧键优先级、`greetMode:'random'` 不写时段、`chat` 非空时不看
 * `standby`、孤儿条目的 `on: []` …）都在 `src/eventModel.ts` 里已经写过一次。
 * 本脚本只做两件事：
 *   ① 调它拿到"归一后的事件表"；
 *   ② 把归一结果**写回 JSON**（保留原有字段顺序、只增不改）。
 * ⇒ 迁移结果与运行期口径**不可能**不一致（`_regress/90` 钉住这一点）。
 *
 * ## 幂等
 *
 * 第二次运行时旧池键已经不存在 ⇒ `normalizeEventTable` 直接采信显式 `on` / `when`，
 * 产出的对象与第一次逐字相同 ⇒ 文件字节不变（脚本会自检并打印 `幂等 ✅`）。
 *
 * ## 为什么只重写 `subtitle` 块
 *
 * 整份文件 `JSON.parse → JSON.stringify` 会把 `0.0` 写成 `0`，在 S6 那种 100 KB
 * 的 config 上产生几千行伪 diff。这里只把 `subtitle` 那一块整体重排，
 * **块外的字节原样保留**（含缩进宽度与 CRLF）。
 */

import * as fs from 'fs';
import * as path from 'path';
import { Configs, DialogueEntry } from '../src/config.type';
import { normalizeEventTable } from '../src/eventModel';
import { describeCondition } from '../src/conditions';

const argv = process.argv.slice(2);
const asJson = argv.indexOf('--json') >= 0;
const write = argv.indexOf('--write') >= 0;
const positional = argv.filter((a) => a.charAt(0) !== '-');

const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.resolve(
  repoRoot,
  positional[0] || process.env.WK_ASSETS || 'public/assets'
);
const configPath = path.join(assetsDir, 'config.json');

/** 迁移后要删掉的旧池键（PLAN §1 / §5.4） */
const LEGACY_KEYS = [
  'touch',
  'greet',
  'chat',
  'standby',
  'greeting',
  'greetMode',
];

/**
 * 条目字段的**输出顺序**。
 *
 * 只影响可读性（diff 里的排列），不影响语义；不在表里的未知字段会被追加到末尾，
 * 保证"作者手写的额外字段不会被吃掉"。
 */
const FIELD_ORDER = [
  'id',
  'actionId',
  'label',
  'displayName',
  'note',
  'enabled',
  'on',
  'kind',
  'when',
  'pick',
  'phase',
  'phaseAnimations',
  'animation',
  'particles',
  'variants',
  'text',
  'textTime',
  'voice',
];

const die = (msg: string): never => {
  console.error('[migrateEvents] ' + msg);
  process.exit(2);
};

if (!fs.existsSync(configPath)) {
  die('找不到 config.json: ' + configPath);
}

const source = fs.readFileSync(configPath, 'utf8');
const cfg = JSON.parse(source) as Configs;
const sub = cfg.subtitle;
if (!sub) {
  die('config 里没有 subtitle 块: ' + configPath);
}

/* ── 归一（与运行时同一入口） ───────────────────────────── */
const normalized = normalizeEventTable(sub.dialogues ?? [], {
  legacy: {
    touch: sub.touch,
    chat: sub.chat,
    standby: sub.standby,
    greet: sub.greet,
    greeting: sub.greeting,
    greetingRanges: sub.greetingRanges,
    greetMode: sub.greetMode,
  },
});
const events = normalized.events;

/* ── 旧池键 → 条目：算一份"位次 → 事件"的对照，供人工核 ──── */
type Trace = {
  from: string;
  to: string;
  on: string;
  kind: string;
  when: string;
};
const traces: Trace[] = [];
const pushTrace = (e: DialogueEntry, from: string): void => {
  traces.push({
    from,
    to: String(e.id),
    on: ([] as string[]).concat(e.on ?? []).join('+') || '(不可达)',
    kind: String(e.kind ?? ''),
    when: describeCondition(e.when),
  });
};

/**
 * 逐条按"归一后的事件"回头看它来自哪个旧槽位（仅用于打印）。
 * ⚠️ 这里**不参与写盘** —— 写盘用的是 `normalized.events` 本身。
 */
const slotLabel: { [key: string]: string } = {};
const SLOT_ORDER = ['morning', 'noon', 'evening'] as const;
const keyOf = (v: unknown): string =>
  typeof v === 'number'
    ? 'game:' + Math.floor(v)
    : typeof v === 'string'
    ? v
    : '';
if (Array.isArray(sub.greet) && sub.greet.length) {
  sub.greet.forEach((raw, i) => {
    const k = keyOf(raw) || 'game:' + raw;
    if (SLOT_ORDER[i]) {
      slotLabel[k] = 'greet[' + i + ']=' + SLOT_ORDER[i];
    }
  });
} else if (sub.greeting) {
  SLOT_ORDER.forEach((slot) => {
    const k = keyOf((sub.greeting as Record<string, unknown>)?.[slot]);
    if (k) {
      slotLabel[k] = 'greeting.' + slot;
    }
  });
}
const chatKeys = (Array.isArray(sub.chat) ? sub.chat : []).map(keyOf);
(Array.isArray(sub.touch) ? sub.touch : []).forEach((raw) => {
  const k = keyOf(raw);
  if (k) {
    slotLabel[k] = slotLabel[k] ?? 'touch[]';
  }
});
events.forEach((e) => {
  const k = String(e.id);
  const from =
    slotLabel[k] ??
    (chatKeys.indexOf(k) >= 0
      ? 'chat[]'
      : keyOf(sub.standby) === k
      ? 'standby'
      : '(无旧池键 ⇒ 自定义/孤儿)');
  pushTrace(e, from);
});

/* ── 写回条目：保留原字段顺序，只增不改 ─────────────────── */
const shapeEntry = (e: DialogueEntry): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  FIELD_ORDER.forEach((k) => {
    const v = (e as Record<string, unknown>)[k];
    /**
     * `enabled: true` 是归一后的**补默认值**，不是作者写的 ⇒ 不落盘。
     * 只把 `false`（孤儿）写出来 —— 否则每张 config 都会多出 N 行噪声。
     */
    if (k === 'enabled' && v !== false) {
      return;
    }
    if (v !== undefined) {
      out[k] = v;
    }
  });
  Object.keys(e as Record<string, unknown>).forEach((k) => {
    if (FIELD_ORDER.indexOf(k) < 0) {
      const v = (e as Record<string, unknown>)[k];
      if (v !== undefined) {
        out[k] = v;
      }
    }
  });
  return out;
};

/**
 * ★ PLAN §5.3 的第二个缺口：**表内孤儿**（没有任何旧池引用、也没写 `on`）迁移后
 * 仍然是 `on: []` ⇒ 永不播放；但"没写 on"在**未来**可能被某次改动解释成默认通道。
 * ⇒ 显式写 `enabled: false`，把"这条不播"从"靠 `on` 为空推断"变成**写死在数据里**。
 */
const nextDialogue = events.map((e) =>
  shapeEntry(
    (e.on as unknown[] | undefined)?.length ? e : { ...e, enabled: false }
  )
);

/** 新 `subtitle` 块：删旧键、换 dialogues，**其余键与顺序原样** */
const nextSubtitle: Record<string, unknown> = {};
Object.keys(sub).forEach((k) => {
  if (LEGACY_KEYS.indexOf(k) >= 0) {
    return;
  }
  if (k === 'dialogues') {
    nextSubtitle[k] = nextDialogue;
    return;
  }
  nextSubtitle[k] = (sub as Record<string, unknown>)[k];
});
if (!('dialogues' in nextSubtitle)) {
  nextSubtitle.dialogues = nextDialogue;
}

/* ── 只替换 `subtitle` 块的文本（块外字节不动） ─────────── */
const detectIndent = (text: string): number => {
  const m = text.match(/\n( +)"/);
  return m ? m[1].length : 2;
};
const indentUnit = detectIndent(source);
const crlf = /\r\n/.test(source);
const nl = crlf ? '\r\n' : '\n';

/** 从 `"subtitle": {` 的左花括号开始找配对的右花括号（跳过字符串里的括号） */
const findBlock = (text: string, key: string): [number, number] | null => {
  const at = text.indexOf('"' + key + '"');
  if (at < 0) {
    return null;
  }
  const open = text.indexOf('{', at);
  if (open < 0) {
    return null;
  }
  let depth = 0;
  let inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text.charAt(i);
    if (inStr) {
      if (c === '\\') {
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return [open, i];
      }
    }
  }
  return null;
};

const blockRange = findBlock(source, 'subtitle');
if (!blockRange) {
  die('定位不到 subtitle 块（config 可能格式异常）');
}

/** 序列化时缩进到 subtitle 所在的层级：`"subtitle"` 前的空白 + 一级 */
const lineStart = source.lastIndexOf('\n', source.indexOf('"subtitle"')) + 1;
const keyIndent = source.slice(lineStart, source.indexOf('"subtitle"'));

/**
 * 自带的**紧凑**序列化器（只为把 diff 噪声压到最小）。
 *
 * 为什么不用 `JSON.stringify(v, null, indent)`：
 * 它会把 `["resume"]` 拆成 3 行、把 `{...}` 全部展开 —— 迁移一次能让
 * 一张 40 KB 的 config 涨到 60 KB，review 时全是格式 diff、看不出语义变化。
 * 这里只做一条压缩：**元素全是标量的数组写成一行**（`["resume"]`），其余照旧展开。
 */
const printValue = (v: unknown, level: number): string => {
  const pad = (n: number): string => ' '.repeat(indentUnit * n);
  /**
   * 单行紧凑形式（只用于**很短**的对象/数组，如 `{ "start": 5, "end": 12 }`）。
   * 超过 `INLINE_MAX` 就退回展开 —— 否则一行会横向溢出，比多行更难读。
   */
  const INLINE_MAX = 60;
  const compact = (x: unknown): string => {
    if (Array.isArray(x)) {
      return '[' + x.map((it) => compact(it)).join(', ') + ']';
    }
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const ks = Object.keys(o);
      return ks.length
        ? '{ ' +
            ks.map((k) => JSON.stringify(k) + ': ' + compact(o[k])).join(', ') +
            ' }'
        : '{}';
    }
    return JSON.stringify(x);
  };
  if (Array.isArray(v)) {
    if (v.every((it) => it === null || typeof it !== 'object')) {
      return '[' + v.map((it) => JSON.stringify(it)).join(', ') + ']';
    }
    if (!v.length) {
      return '[]';
    }
    return (
      '[\n' +
      v.map((it) => pad(level + 1) + printValue(it, level + 1)).join(',\n') +
      '\n' +
      pad(level) +
      ']'
    );
  }
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (!keys.length) {
      return '{}';
    }
    const oneLine = compact(v);
    if (oneLine.length <= INLINE_MAX) {
      return oneLine;
    }
    return (
      '{\n' +
      keys
        .map(
          (k) =>
            pad(level + 1) +
            JSON.stringify(k) +
            ': ' +
            printValue(obj[k], level + 1)
        )
        .join(',\n') +
      '\n' +
      pad(level) +
      '}'
    );
  }
  return JSON.stringify(v);
};

const blockText = printValue(nextSubtitle, 0);
/** 从列 0 起缩进 ⇒ 整体右移 keyIndent，保持与原文件同一层级 */
const shifted = blockText
  .split('\n')
  .map((line, i) => (i === 0 ? line : keyIndent + line))
  .join(nl);
const nextSource =
  source.slice(0, blockRange[0]) + shifted + source.slice(blockRange[1] + 1);

/* ── 幂等自检：把结果再跑一遍，看是否字节相同 ───────────── */
const idempotent = (() => {
  try {
    const again = JSON.parse(nextSource) as Configs;
    const s2 = again.subtitle;
    const n2 = normalizeEventTable(s2?.dialogues ?? [], {
      legacy: {
        touch: s2?.touch,
        chat: s2?.chat,
        standby: s2?.standby,
        greet: s2?.greet,
        greeting: s2?.greeting,
        greetingRanges: s2?.greetingRanges,
        greetMode: s2?.greetMode,
      },
    });
    const next2: Record<string, unknown> = {};
    Object.keys(s2 ?? {}).forEach((k) => {
      if (LEGACY_KEYS.indexOf(k) >= 0) {
        return;
      }
      if (k === 'dialogues') {
        next2[k] = n2.events.map((e) =>
          shapeEntry(
            (e.on as unknown[] | undefined)?.length
              ? e
              : { ...e, enabled: false }
          )
        );
        return;
      }
      next2[k] = (s2 as Record<string, unknown>)[k];
    });
    return printValue(next2, 0) === printValue(nextSubtitle, 0);
  } catch (err) {
    return false;
  }
})();

/* ── 输出 ───────────────────────────────────────────────── */
const summary = {
  config: path.relative(repoRoot, configPath),
  entries: events.length,
  /** 旧池键删掉之后 config 里还剩哪些（人核用） */
  removedKeys: LEGACY_KEYS.filter(
    (k) => (sub as Record<string, unknown>)[k] !== undefined
  ),
  /** 迁移后仍不可达的条目（`on: []` ⇒ 已写 `enabled:false`） */
  orphans: events
    .filter((e) => !(e.on as unknown[] | undefined)?.length)
    .map((e) => e.id),
  issues: normalized.issues,
  idempotent,
  changed: nextSource !== source,
  traces,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('事件表迁移：' + summary.config);
  console.log(
    '  条目 ' +
      summary.entries +
      ' 条 · 删除旧池键 ' +
      (summary.removedKeys.length ? summary.removedKeys.join(', ') : '(已无)') +
      ' · 孤儿 ' +
      summary.orphans.length +
      ' 条'
  );
  if (summary.traces.length) {
    console.log('\n  ── 位次 → 事件 ──');
    summary.traces.forEach((t) => {
      console.log(
        '  ' +
          t.from.padEnd(22) +
          ' → ' +
          t.to.padEnd(14) +
          ' on=' +
          t.on.padEnd(12) +
          ' kind=' +
          t.kind.padEnd(6) +
          ' when=' +
          t.when
      );
    });
  }
  const issues = normalized.issues.filter((it) => it.code !== 'W_LEGACY');
  if (issues.length) {
    console.log('\n  ── 归一告警（' + issues.length + '）──');
    issues.forEach((it) => {
      console.log(
        '  [' + it.code + '] ' + (it.id || '(工程)') + '  ' + it.detail
      );
    });
  }
  console.log(
    '\n  幂等：' +
      (idempotent ? '✅ 再跑一次字节不变' : '❌ 结果不稳定，先别写盘')
  );
  if (!write) {
    console.log(
      '  变更：' +
        (summary.changed
          ? '有（dry-run，未写盘；加 --write 落地）'
          : '无（已经是迁移后的形状）')
    );
  }
}

if (write) {
  if (!idempotent) {
    die('幂等自检失败 ⇒ 拒绝写盘（先修脚本）');
  }
  fs.writeFileSync(configPath, nextSource, 'utf8');
  console.log('  ✅ 已写入 ' + path.relative(repoRoot, configPath));
}
