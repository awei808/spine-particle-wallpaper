/**
 * 回归：**热区数组必须与调用方共享引用**（2026-10-23 新增）。
 *
 * ## 为什么单开一条
 *
 * 用户报的现象：「切「按宽 / 按高」对齐、或换分辨率后，角色缩放了，触摸热区**不跟着走**」
 * ⇒ 点手点到空白处（该问题在 `_regress/102` 里从**数学**侧修好了：`u/v` 现在会先
 * 还原成设计画布像素、再按本帧取景投影）。
 *
 * 但数学修对了、接线却是断的：`index.ts` 的重投影逻辑靠**原地改写**同一个数组
 * （`touchZones.length = 0; touchZones.push(...next.zones)`），而 `createTouchController`
 * 里写的是 `options.zones.slice()` ⇒ 控制器拿的是启动那一刻的**快照**，
 * 之后调用方怎么改都与它无关 ⇒ `onMouseDown` 永远用旧矩形判定。
 *
 * ★ 这个 bug 的可怕之处是**全静默**：
 *   - 不报错、不 warn；
 *   - `snapshot().zones` 会把那份旧副本念一遍 ⇒ 探针读起来"看起来是对的"；
 *   - `_regress/102` 只测 `normalizeZones` 的**输出**，测不到"输出有没有被消费"。
 *
 * ## 这条脚本钉什么
 *
 *   A. **引用同一性**：控制器持有的就是调用方那个数组（不是副本）
 *   B. **原地改写可见**：push / 改字段后，`snapshot()` 立刻反映（旧实现在此必 FAIL）
 *   C. **复刻 index.ts 的 resize 序列**：拿真实 `config.json` 的 zones，
 *      在两个比例下归一 → 原地替换 → 断言控制器读数**真的变了**
 *
 * ⚠️ 旧实现（`options.zones.slice()`）会让 B1/B2/C1/C2 全部 FAIL —— 这就是判别力所在。
 *
 * ## 用法
 *
 *   cd <仓库根目录>
 *   npx ts-node --transpile-only _regress/103_回归_热区引用共享.ts [config.json 路径]
 */
import './polyfill'; // ★ 必须第一个：src/touch.ts 的 import 链会碰 window / document

import * as fs from 'fs';

import { createTouchController } from '../src/touch';
import { DesignFit, normalizeZones, TouchZone } from '../src/touchZones';

/** config 路径：命令行 > 环境变量 > 仓库缺省（同 77 / 102，不写死本机绝对路径） */
const CONFIG =
  process.argv[2] || process.env.WK_CONFIG || 'public/assets/config.json';

/** 本工程设计画幅（`config.width × config.height`） */
const DW = 1700;
const DH = 750;
const AD = DW / DH;

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
 * 造一个 `DesignFit`（口径同 `initScene.calc()`，与 `_regress/102` 的 `frame()` 一致）：
 * `halfHD` 固定 1；`'width'` 基准下可见宽恒定 ⇒ `halfH = halfHD·Ad/A`。
 */
const frame = (A: number, fit: 'width' | 'height'): DesignFit => ({
  halfH: fit === 'height' ? 1 : (1 * AD) / A,
  halfHD: 1,
  aspect: A,
  aspectD: AD,
  designW: DW,
  designH: DH,
});

const zone = (
  id: string,
  u0: number,
  v0: number,
  u1: number,
  v1: number
): TouchZone => ({ id, label: id, u0, v0, u1, v1 } as TouchZone);

/**
 * 造控制器。
 *
 * `skeletonMesh.state` 只在 `isIdle()` / `playAction()` 这类**回调**里读，
 * 构造期只用到 `document.addEventListener`（polyfill 已提供）⇒ 传个空壳即可。
 * `touchAnimations` 非空是为了走**真实控制器**分支（而不是 `createNoopController`）。
 */
const makeController = (zones: TouchZone[]) =>
  createTouchController(
    { state: {} } as never,
    {
      skeletonFile: 'regress103.skel',
      idleAnimationName: 'idle',
      touchAnimations: ['touch1'],
      zones,
    }
  );

/** 指纹：id + 四个端点，保留 6 位小数（够区分投影差异，又不被浮点噪声干扰） */
const fingerprint = (zs: readonly TouchZone[]): string =>
  zs
    .map(
      (z) =>
        z.id +
        ':' +
        [z.u0, z.v0, z.u1, z.v1].map((n) => n.toFixed(6)).join(',')
    )
    .join('|');

console.log('\n── A. 引用同一性（控制器不得持有副本） ──');
{
  const live: TouchZone[] = [zone('hand', 0.1, 0.2, 0.3, 0.4)];
  const tc = makeController(live);

  check(
    tc.snapshot().zones === live,
    'A1 snapshot().zones 与调用方是**同一个数组引用**',
    '旧实现（.slice()）在此必 FAIL'
  );

  live.push(zone('body', 0, 0, 1, 1));
  check(
    tc.snapshot().zones.length === 2,
    'A2 调用方 push 后控制器立即可见（长度 2）',
    'len=' + tc.snapshot().zones.length
  );

  live[0].u0 = 0.99;
  check(
    tc.snapshot().zones[0].u0 === 0.99,
    'A3 原地改端点字段后读数同步',
    'u0=' + tc.snapshot().zones[0].u0
  );
}

console.log('\n── B. 原地整体替换（index.ts 的 resize 写法） ──');
{
  const live: TouchZone[] = [
    zone('hand', 0.1, 0.2, 0.3, 0.4),
    zone('body', 0.2, 0.3, 0.8, 0.9),
  ];
  const tc = makeController(live);
  const before = fingerprint(tc.snapshot().zones);

  /**
   * 复刻 `index.ts` 的 re-projection：
   * `touchZones.length = 0; touchZones.push(...next.zones);`
   * —— 注意是**同一个数组对象**被清空再填。
   */
  const next = [zone('hand', 0.5, 0.5, 0.6, 0.6), zone('body', 0, 0, 1, 1)];
  live.length = 0;
  live.push(...next);
  const after = fingerprint(tc.snapshot().zones);

  check(
    fingerprint(next) === after,
    'B1 清空+重填后，控制器读数 == 新写入的那批',
    ''
  );
  check(
    before !== after,
    'B2 读数确实变了（不是原样返回旧值）',
    ''
  );
}

console.log('\n── C. 真实 config.json：换比例后控制器读数跟着变 ──');
{
  let raw: unknown[] | null = null;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''))
      .touch?.zones;
  } catch (e) {
    raw = null;
  }

  if (!Array.isArray(raw) || !raw.length) {
    console.log('  [SKIP] 未读到 ' + CONFIG + ' 的 touch.zones ⇒ 跳过真实工程比对');
  } else {
    const live: TouchZone[] = normalizeZones(raw as never, frame(16 / 9, 'width'))
      .zones;
    const tc = makeController(live);
    const before = fingerprint(tc.snapshot().zones);
    const idsBefore = tc.snapshot().zones.map((z) => z.id).join(',');

    /** 16:9 → 16:10，同为「按宽」基准 ⇒ 可见高不同，投影结果必然变 */
    const next = normalizeZones(raw as never, frame(16 / 10, 'width')).zones;
    live.length = 0;
    live.push(...next);
    const after = fingerprint(tc.snapshot().zones);

    check(
      before !== after,
      'C1 16:9 → 16:10（按宽）后，至少有热区的投影端点变了',
      '区域数=' + next.length
    );
    check(
      tc.snapshot().zones.length === next.length,
      'C2 数量同步（' + next.length + ' 块）',
      'len=' + tc.snapshot().zones.length
    );
    check(
      tc.snapshot().zones.map((z) => z.id).join(',') === idsBefore,
      'C3 热区身份与顺序不变（只换几何）',
      ''
    );
    /**
     * C4：**幂等性** —— 同一比例下连续归一再投影两次，结果必须一致。
     * 若重投影对"已投影过的 u/v"再投影一遍，端点会持续漂移（102 的注释点名的陷阱）。
     */
    const once = normalizeZones(raw as never, frame(16 / 10, 'width')).zones;
    const twice = normalizeZones(raw as never, frame(16 / 10, 'width')).zones;
    check(
      fingerprint(once) === fingerprint(twice),
      'C4 同一入参连归两次结果一致（不会二次投影）',
      ''
    );
  }
}

console.log(
  '\n' + (fail === 0 ? '✅' : '❌') + ' ' + pass + ' PASS / ' + fail + ' FAIL'
);
process.exit(fail === 0 ? 0 : 1);
