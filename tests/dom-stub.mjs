/**
 * A very small DOM stub so src/ui.js can be tested in Node without a dependency.
 * It only implements what the render functions actually use: element creation,
 * class names, text, children, event handlers and a no-op canvas context.
 */

class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toLowerCase();
    this.className = '';
    this._text = '';
    this.children = [];
    this.handlers = {};
    this.dataset = {};
    this.attrs = {};
    this.checked = false;
    this.value = '';
  }

  // Like the DOM: text on the node itself, otherwise the text of its children.
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._text = String(value);
  }

  set innerHTML(value) {
    this.children = [];
    this._text = value;
  }

  get innerHTML() {
    return '';
  }

  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  addEventListener(type, handler) {
    (this.handlers[type] ||= []).push(handler);
  }

  classList = {
    add: (cls) => {
      this.className = `${this.className} ${cls}`.trim();
    },
    toggle: (cls, on) => {
      if (on) this.className = `${this.className} ${cls}`.trim();
    },
  };

  querySelector(selector) {
    return this.find(selector.replace('.', ''));
  }

  find(cls) {
    return this.children.find((child) => child.className.split(' ').includes(cls)) || null;
  }

  findAll(cls) {
    return this.children.filter((child) => child.className.split(' ').includes(cls));
  }

  findDeep(cls) {
    for (const child of this.children) {
      if (child.className.split(' ').includes(cls)) return child;
      const hit = child.findDeep?.(cls);
      if (hit) return hit;
    }
    return null;
  }

  findAllDeep(cls) {
    const found = [];
    for (const child of this.children) {
      if (child.className.split(' ').includes(cls)) found.push(child);
      found.push(...(child.findAllDeep?.(cls) || []));
    }
    return found;
  }

  click() {
    for (const handler of this.handlers.click || []) handler({ target: this });
  }

  getContext() {
    return {
      fillStyle: '',
      lineWidth: 1,
      imageSmoothingEnabled: false,
      fillRect: () => {},
      putImageData: () => {},
      strokeRect: () => {},
    };
  }
}

export function installDom() {
  const document = {
    createElement: (tag) => new StubNode(tag),
    documentElement: { dataset: {} },
  };

  globalThis.document = document;
  return document;
}
