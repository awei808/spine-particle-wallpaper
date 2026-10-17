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

/* ═══════════════════════════════════════════════════════════════════════════
 * P5「Sub Emitters」· **config 校验器**（2026-10-17，P5-a）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## 它现在是什么 / 不是什么
 *
 * · **是**：`subEmitters` / `subOnly` 两个字段的**唯一校验真源** —— 纯函数、不依赖 three.js、
 *   不改任何运行时行为。
 * · **不是**：引擎还没消费这两个字段（**P5-b 才接线**：事件出口 + 继承注入 + 实例池）。
 *   在此之前，本模块只被 `_regress/75_回归_子发射器结构.ts` 直接调用 ——
 *   于是"结构"是**被机器钉住的**，而不是只写在文档里的一句愿望。
 *   ★ 因为 `index.ts` 还没 import 它，webpack 不会把它打进 `dist/bundle.js`
 *     ⇒ **本轮产物对壁纸行为零影响**（bundle md5 不变，这是可机检的）。
 *
 * ## 校验规则（全部来自 Unity 官方语义，逐字见 `config.type.ts` 的 P5 段）
 *
 * | 规则 | 依据 |
 * |---|---|
 * | `target` 必须存在、且是 `type: 'particle'` | Unity 的 `emitter` 是 `PPtr<ParticleSystem>`；空/失效引用在 UI 里会被弹窗清掉 |
 * | `target !== 本 mesh` | 自引用 ⇒ 无限递归。实测全包有 **9 条**这种脏数据 |
 * | **不能成环** | `SubModuleUI` 有 `CheckCircularReferences`（弹窗并**移除该引用**） |
 * | `trigger` ∈ 5 档 | 官方枚举 `ParticleSystemSubEmitterType` |
 * | `'collision'` / `'trigger'` ⇒ **警告**（本项目明确不复刻这两个模块） | `docx/TODO.md` §2.4 |
 * | `inherit` 里每一项 ∈ 5 位 | 官方枚举 `ParticleSystemSubEmitterProperties`（5 位） |
 * | `'death'` / `'manual'` / `'collision'` / `'trigger'` ⇒ 子系统**必须只有 burst**（`rateOverTime == 0`），否则警告 | 手册逐字：*"Collision, Trigger, Death and Manual events can only use burst emission"* |
 * | `probability` ∈ [0,1] | 官方 UI tooltip（比例） |
 * | `instances` ≥ 1 且 ≤ 64 | **工程侧旋钮**（Unity 无此字段）；上限防"159 个父共用一个目标"时爆掉 |
 * | `instanceMaxNum` ≥ 1 | 同上 |
 * | `subOnly: true` 的 mesh **必须**被至少一条绑定引用，否则警告 | 否则它永远不会出现在画面上（"建了但从不播"），是典型的配置失误 |
 * | target 的 `position.z` 与父不同 ⇒ 警告 | Unity 里子发射器是父的**子物体**（`localPosition = 0`）⇒ z 应相同；不同多半是"同根兄弟"被误当子发射器（实测 29 条） |
 *
 * ## 风格
 *
 * 与既有的"缺 mesh / 索引越界 ⇒ 静默回退"不同，这里**返回警告列表**而不是抛异常：
 * 调用方（P5-b 的 `index.ts`）负责 `console.warn` 并**忽略该条绑定**，
 * 剩下能跑的部分照跑 —— 一条脏绑定不该让整张壁纸白屏。
 */

import {
  Configs,
  ParticleMeshConfig,
  SubEmitterInherit,
} from '@src/config.type';

/** 官方枚举的 5 档（`config.type.ts` 的 `SubEmitterTrigger` 是它的字符串形态） */
const TRIGGERS = ['birth', 'death', 'collision', 'trigger', 'manual'];
/** 官方 5 个继承位（`SubEmitterInherit`） */
const INHERITS = ['color', 'size', 'rotation', 'lifetime', 'duration'];
/** 依赖**本工程明确不复刻**的模块的触发档（Collision / Trigger 模块，见 TODO §2.4） */
const UNIMPLEMENTED_TRIGGERS = ['collision', 'trigger'];
/** 手册规定"只能用 burst 发射"的四档 */
const BURST_ONLY_TRIGGERS = ['collision', 'trigger', 'death', 'manual'];
/** `instances` 的工程侧上限（Unity 无此字段；防"多父共用一个目标"时爆内存） */
export const MAX_INSTANCES = 64;

/**
 * 一条校验结果。
 *
 * ★ `severity` 的差别是**能不能继续用这条绑定**（不是"要不要打印"）：
 *   · `'error'` ⇒ 该条绑定**作废**（引用缺失 / 自引用 / 枚举非法 / 数值越界）；
 *   · `'warn'`  ⇒ 该条绑定**仍然生效**，只是有需要知道的事
 *     （z 不一致、持续发射在 burst-only 档下不生效、`subOnly` 没被引用、引用成环）。
 *   调用方按 `severity` 决定"忽略这一条"还是"照做但提示"。
 */
export type SubEmitterWarning = {
  /** 出问题的 mesh（父）名；成环/未被引用这类没有明确的父时是环上的起点 */
  mesh: string;
  /** 出问题的绑定下标（与具体绑定无关的检查省略） */
  index?: number;
  /** `'error'` = 该条作废；`'warn'` = 仍生效但有话要说 */
  severity: 'error' | 'warn';
  /** 机器可判的类别（验收脚本按它断言） */
  code: string;
  /** 人读说明 */
  message: string;
};

/**
 * 校验一份 config 里的全部子发射器声明。
 *
 * @returns 警告列表（**空数组 = 全通过**）。永远不抛异常。
 */
export function validateSubEmitters(configs: Configs): SubEmitterWarning[] {
  const out: SubEmitterWarning[] = [];
  const meshes = (configs && configs.meshes) || [];
  const byName: { [name: string]: ParticleMeshConfig } = {};
  for (const m of meshes) {
    if (m && m.type === 'particle' && m.name) {
      byName[m.name] = m;
    }
  }

  /** 邻接表（只含"通过了基本功校验"的边），用于环检测 */
  const adj: { [name: string]: string[] } = {};
  /** 被引用过的 `subOnly` mesh 名 */
  const referenced = new Set<string>();

  const warn = (
    mesh: string,
    severity: 'error' | 'warn',
    code: string,
    message: string,
    index?: number
  ) =>
    out.push(
      index === undefined
        ? { mesh, severity, code, message }
        : { mesh, index, severity, code, message }
    );

  meshes.forEach((m) => {
    if (
      !m ||
      m.type !== 'particle' ||
      !m.subEmitters ||
      !m.subEmitters.length
    ) {
      return;
    }
    const self = m.name || '<unnamed>';
    m.subEmitters.forEach((b, i) => {
      const at = (
        code: string,
        message: string,
        severity: 'error' | 'warn' = 'error'
      ) => warn(self, severity, code, message, i);
      if (!b || !b.target) {
        at('target.missing', '缺少 target（必须是 meshes[].name）');
        return;
      }
      const tgt = byName[b.target];
      if (!tgt) {
        at(
          'target.notFound',
          `target "${b.target}" 在 meshes[] 里找不到（或不是 particle）`
        );
        return;
      }
      if (b.target === self) {
        at('target.selfRef', `target 指向自己（"${self}"）⇒ 无限递归，已忽略`);
        return;
      }
      referenced.add(b.target);

      const trig = b.trigger === undefined ? 'birth' : b.trigger;
      if (TRIGGERS.indexOf(trig) < 0) {
        at(
          'trigger.invalid',
          `trigger "${String(b.trigger)}" 不是 ${TRIGGERS.join('/')} 之一`
        );
        return;
      }
      if (UNIMPLEMENTED_TRIGGERS.indexOf(trig) >= 0) {
        at(
          'trigger.unimplemented',
          `trigger "${trig}" 依赖的 ${
            trig === 'collision' ? 'Collision' : 'Trigger'
          } 模块` + '本工程明确不复刻 ⇒ 该条被忽略（声明合法，但不静默吞掉）'
        );
        return;
      }

      // inherit：数组 / 'all' / 'nothing'
      const inh = b.inherit;
      let inhList: string[] = [];
      if (inh === undefined || inh === 'nothing') {
        inhList = [];
      } else if (inh === 'all') {
        inhList = INHERITS.slice();
      } else if (Array.isArray(inh)) {
        for (const k of inh as SubEmitterInherit[]) {
          if (INHERITS.indexOf(k) < 0) {
            at(
              'inherit.invalid',
              `inherit "${String(k)}" 不是 ${INHERITS.join('/')} 之一`
            );
            return;
          }
        }
        inhList = inh.slice();
      } else {
        at(
          'inherit.invalid',
          `inherit 只能是数组 / 'all' / 'nothing'，实为 ${String(inh)}`
        );
        return;
      }

      const prob = b.probability === undefined ? 1 : b.probability;
      if (!isFinite(prob) || prob < 0 || prob > 1) {
        at(
          'probability.range',
          `probability = ${String(b.probability)} 必须在 [0,1]`
        );
        return;
      }

      const inst = b.instances === undefined ? 4 : b.instances;
      if (!isFinite(inst) || inst < 1 || inst > MAX_INSTANCES) {
        at(
          'instances.range',
          `instances = ${String(
            b.instances
          )} 必须在 [1, ${MAX_INSTANCES}]（工程侧旋钮）`
        );
        return;
      }
      if (
        b.instanceMaxNum !== undefined &&
        !(isFinite(b.instanceMaxNum) && b.instanceMaxNum >= 1)
      ) {
        at(
          'instanceMaxNum.range',
          `instanceMaxNum = ${String(b.instanceMaxNum)} 必须 ≥ 1`
        );
        return;
      }

      /**
       * 手册硬规则：Collision / Trigger / Death / Manual 只能用 burst 发射。
       * 判据 = 子系统的 `emission.rateOverTime` 的**两个端点都必须是 0**
       * （`a`/`b` 都取，避免把"随机两常量"里一侧为 0 误判成安全）。
       */
      if (BURST_ONLY_TRIGGERS.indexOf(trig) >= 0) {
        const rt = tgt.emission && tgt.emission.rateOverTime;
        const a = rt ? Math.abs(rt.a || 0) : 0;
        const bb = rt ? Math.abs(rt.b || 0) : 0;
        if (a > 1e-9 || bb > 1e-9) {
          at(
            'emission.notBurstOnly',
            `trigger "${trig}" 下子系统只能靠 burst 发射（手册逐字），但 "${b.target}" 的 ` +
              `rateOverTime = [${a}, ${bb}] ≠ 0；该部分发射在 Unity 里不会发生`,
            'warn'
          );
        }
      }

      // z 一致性（Unity 里子发射器是父的子物体 ⇒ localPosition = 0 ⇒ z 应相同）
      const zP = m.position ? m.position.z || 0 : 0;
      const zC = tgt.position ? tgt.position.z || 0 : 0;
      if (Math.abs(zP - zC) > 1e-6) {
        at(
          'z.mismatch',
          `target "${b.target}" 的 z = ${zC} 与父的 z = ${zP} 不同；` +
            'Unity 里子发射器是父的子物体（localPosition = 0）⇒ 多半是"同根兄弟"被误当子发射器',
          'warn'
        );
      }

      (adj[self] = adj[self] || []).push(b.target);
    });
  });

  // ── 成环检测（DFS 三色法）。Unity 有 CheckCircularReferences，环会让实例化无限递归 ──
  const color: { [name: string]: number } = {}; // 0 未访问 / 1 栈上 / 2 完成
  const stack: string[] = [];
  const dfs = (n: string): string[] | null => {
    color[n] = 1;
    stack.push(n);
    for (const nx of adj[n] || []) {
      if (color[nx] === 1) {
        return stack.slice(stack.indexOf(nx)).concat(nx); // 环上的节点（含首尾重复）
      }
      if (!color[nx]) {
        const hit = dfs(nx);
        if (hit) {
          return hit;
        }
      }
    }
    color[n] = 2;
    stack.pop();
    return null;
  };
  for (const n of Object.keys(adj)) {
    if (!color[n]) {
      const cycle = dfs(n);
      if (cycle) {
        warn(
          n,
          'warn',
          'cycle',
          `子发射器引用成环：${cycle.join(
            ' → '
          )}（Unity 会弹"circular referencing"并移除该引用）`
        );
        break; // 报一条即可（同一条环会被多个起点发现）
      }
    }
  }

  // ── subOnly 但没有被引用 ⇒ 永远不会出现在画面上 ──
  meshes.forEach((m) => {
    if (
      m &&
      m.type === 'particle' &&
      m.subOnly === true &&
      m.name &&
      !referenced.has(m.name)
    ) {
      warn(
        m.name,
        'warn',
        'subOnly.unreferenced',
        'subOnly: true 但没有任何 subEmitters 引用它 ⇒ 它永远不会发射（也不是独立系统）'
      );
    }
  });

  return out;
}

/**
 * 把一份 config 里**实际生效**的绑定摊平成 `父名 → [目标名, ...]`（目录用）。
 *
 * 与校验器共用同一套判定 ⇒ 调用方不必自己再筛一遍（否则两处口径迟早就漂移 ——
 * `archive.ts` 的教训：那里曾经因为"池子引用错了一份"而列出错的条目数）。
 */
export function effectiveSubEmitterTargets(configs: Configs): {
  [parent: string]: string[];
} {
  /** ★ 只排除 `severity === 'error'` 的绑定：`warn` 档（z 不一致 / 非 burst-only / 成环）仍然生效 */
  const bad = new Set(
    validateSubEmitters(configs)
      .filter((w) => w.severity === 'error' && w.index !== undefined)
      .map((w) => `${w.mesh}#${w.index}`)
  );
  const out: { [parent: string]: string[] } = {};
  const meshes = (configs && configs.meshes) || [];
  meshes.forEach((m) => {
    if (!m || m.type !== 'particle' || !m.name || !m.subEmitters) {
      return;
    }
    m.subEmitters.forEach((b, i) => {
      if (!b || !b.target || bad.has(`${m.name}#${i}`)) {
        return;
      }
      (out[m.name] = out[m.name] || []).push(b.target);
    });
  });
  return out;
}
