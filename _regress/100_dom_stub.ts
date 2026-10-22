/**
 * 回归用的**最小 DOM 替身**（2026-10-21，供 `_regress/100_*` 用）。
 *
 * ★ 必须作为**第一个** import 被加载：ES import 按源码顺序求值，而
 *   `src/archive.ts` / `src/settingsStore.ts` 在模块初始化时就会读
 *   `window` / `document`（`uiScale.initUiScale` 等）。
 *
 * ## 与 `polyfill.ts` 的分工
 *
 * `polyfill.ts` 只给"定时器 + 空 document"（够跑纯逻辑），这里要**真的建元素树**
 * （档案分页要断言"切页签后渲染了几行"），所以另写一份：
 *   - `createElement` 返回一棵可遍历的树（`children` / `firstChild` / `parentElement`）；
 *   - `id` 写进全局表 ⇒ 脚本能按 id 找回元素（与浏览器 `getElementById` 同用途）；
 *   - `clientHeight` / `scrollHeight` **恒为 0** ⇒ `archive.fitContent` 的第一道
 *     闸门 `avail > 0` 不成立、直接返回 —— 缩放逻辑不参与断言（那是浏览器的事），
 *     但**不会**因此崩。
 */

type Listener = (e: unknown) => void;

export class StubEl {
  tag: string;
  /**
   * ★ `id` **不能**写成类字段（`id = ''`）—— 字段会在构造时生成**自身属性**，
   *   把下面定义在原型上的访问器（登记进 `els`）整个遮蔽掉，`byId` 就永远找不到。
   */
  declare id: string;
  cssText = '';
  textContent = '';
  children: StubEl[] = [];
  parentElement: StubEl | null = null;
  attrs: { [k: string]: string } = {};
  listeners: { [evt: string]: Listener[] } = {};
  /** 恒 0 ⇒ 依赖真实布局的分支（`fitContent`）在回归里不参与 */
  clientHeight = 0;
  scrollHeight = 0;
  scrollTop = 0;
  style: {
    [k: string]: string;
    setProperty: (k: string, v: string) => void;
  };

  constructor(tag: string) {
    this.tag = tag;
    const styleMap: { [k: string]: string } = {};
    /**
     * ★ 用 `Object.assign` 把 `setProperty` 混进**同一个**对象：
     *   档案里既写 `el.style.display = 'none'`（普通键）也写
     *   `el.style.setProperty('--wb-ui-s', …)`（自定义属性），两者得落在同一处。
     */
    this.style = Object.assign(styleMap, {
      setProperty: (k: string, v: string): void => {
        styleMap[k] = v;
      },
    });
  }

  appendChild(child: StubEl): StubEl {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child: StubEl, ref: StubEl | null): StubEl {
    const i = ref ? this.children.indexOf(ref) : -1;
    child.parentElement = this;
    if (i < 0) {
      this.children.push(child);
    } else {
      this.children.splice(i, 0, child);
    }
    return child;
  }
  removeChild(child: StubEl): StubEl {
    const i = this.children.indexOf(child);
    if (i >= 0) {
      this.children.splice(i, 1);
    }
    child.parentElement = null;
    return child;
  }
  get firstChild(): StubEl | null {
    return this.children.length ? this.children[0] : null;
  }
  /**
   * ★ `innerHTML` 的**清空语义**（2026-10-22 补）：设置面板的 chips 重绘写
   *   `box.innerHTML = ''`，浏览器里这会清空子节点；替身若只存个普通属性，
   *   重绘就会把新节点**追加**到旧的后面，行数断言全错。
   */
  set innerHTML(v: string) {
    if (v === '') {
      this.children.forEach((c) => {
        c.parentElement = null;
      });
      this.children = [];
    }
  }
  /**
   * 极简 `querySelector`（2026-10-22 补）：只支持**标签名**、只找**第一个**。
   * 设置面板的 `row.querySelector('label')` 要用它把标签点击转发到自绘开关上。
   */
  querySelector(sel: string): StubEl | null {
    const walk = (el: StubEl): StubEl | null => {
      for (let i = 0; i < el.children.length; i++) {
        const c = el.children[i];
        if (c.tag === sel) {
          return c;
        }
        const hit = walk(c);
        if (hit) {
          return hit;
        }
      }
      return null;
    };
    return walk(this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  /** 与 `setAttribute` 配对（2026-10-22 补）：设置面板的分段控件按 `data-wb-opt` 回读 */
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k] : null;
  }
  addEventListener(evt: string, fn: Listener): void {
    (this.listeners[evt] = this.listeners[evt] ?? []).push(fn);
  }
  removeEventListener(): void {
    /* 回归里不需要真的摘监听 */
  }
}

/** id → 元素（写 `el.id` 时登记，见下面 `installDom`） */
export const els: { [id: string]: StubEl } = {};

/** 按 id 找回元素（= `document.getElementById`，只查本替身建过的树） */
export const byId = (id: string): StubEl | undefined => els[id];

/** 触发某个元素上的 click 监听（模拟用户点按钮） */
export const click = (el: StubEl | undefined): void => {
  (el?.listeners['click'] ?? []).forEach((fn) => fn({}));
};

/** 递归取一个元素的**全部文字**（含子孙）—— 断言"这一行写了什么"用 */
export const deepText = (el: StubEl): string =>
  el.textContent + el.children.map(deepText).join('');

const store: { [k: string]: string } = {};

export const installDom = (): void => {
  const doc = {
    createElement: (tag: string): StubEl => new StubEl(tag),
    documentElement: new StubEl('html'),
    body: new StubEl('body'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const win = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 1;
    },
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { document: unknown }).document = doc;
  (
    globalThis as unknown as { ResizeObserver: unknown }
  ).ResizeObserver = class {
    observe(): void {
      /* 不需要真的观察 */
    }
    disconnect(): void {
      /* 同上 */
    }
  };
  /**
   * ★ `id` 用**访问器**登记：档案里 `el.id = 'wb-archive-rows'` 这种写法
   *   必须能被 `byId` 找到，否则断言无从下手。
   */
  Object.defineProperty(StubEl.prototype, 'id', {
    get(): string {
      return (this as unknown as { _id?: string })._id ?? '';
    },
    set(v: string) {
      (this as unknown as { _id?: string })._id = v;
      if (v) {
        els[v] = this as unknown as StubEl;
      }
    },
    configurable: true,
  });
};

installDom();
