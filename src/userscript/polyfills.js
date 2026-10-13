/**
 * Small polyfills for JavaScript built-ins that today's sites use and older
 * TV browser engines lack (webOS 6 has Chromium 79, webOS 5 has 68).
 *
 * Each one is only installed when missing, so newer TVs are untouched. They
 * cover the common cases, not every edge of the spec: enough for sites that
 * call them in passing. Syntax the engine can't parse (?. and ??) is a
 * different problem, handled by compat.js.
 */

function define(obj, name, value) {
  if (!obj || obj[name]) return;
  Object.defineProperty(obj, name, { value, writable: true, configurable: true, enumerable: false });
}

/** Relative index like Array.prototype.at: negative counts from the end. */
function at(n) {
  const len = this.length;
  let i = Math.trunc(Number(n)) || 0;
  if (i < 0) i += len;
  return i < 0 || i >= len ? undefined : this[i];
}

export function installPolyfills() {
  // ES2021-2023
  define(String.prototype, 'replaceAll', function (search, replacement) {
    if (search instanceof RegExp) {
      if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
      return this.replace(search, replacement);
    }
    return String(this).split(String(search)).join(
      typeof replacement === 'function' ? replacement(String(search)) : String(replacement),
    );
  });
  define(Array.prototype, 'at', at);
  define(String.prototype, 'at', at);
  ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array']
    .forEach((t) => window[t] && define(window[t].prototype, 'at', at));
  define(Object, 'hasOwn', (o, k) => Object.prototype.hasOwnProperty.call(o, k));
  define(Array.prototype, 'findLast', function (fn, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  });
  define(Array.prototype, 'findLastIndex', function (fn, thisArg) {
    for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
    return -1;
  });
  define(Array.prototype, 'toReversed', function () { return Array.prototype.slice.call(this).reverse(); });
  define(Array.prototype, 'toSorted', function (cmp) { return Array.prototype.slice.call(this).sort(cmp); });
  define(Array.prototype, 'with', function (i, v) {
    const copy = Array.prototype.slice.call(this);
    copy[i < 0 ? copy.length + i : i] = v;
    return copy;
  });

  if (!window.AggregateError) {
    window.AggregateError = function AggregateError(errors, message) {
      const e = new Error(message);
      e.name = 'AggregateError';
      e.errors = Array.from(errors || []);
      return e;
    };
  }
  define(Promise, 'any', (items) => new Promise((resolve, reject) => {
    const list = Array.from(items);
    const errors = [];
    let pending = list.length;
    if (!pending) reject(new window.AggregateError([], 'All promises were rejected'));
    list.forEach((p, i) => Promise.resolve(p).then(resolve, (err) => {
      errors[i] = err;
      if (--pending === 0) reject(new window.AggregateError(errors, 'All promises were rejected'));
    }));
  }));

  // Web APIs
  define(window, 'structuredClone', (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value))));
  if (window.crypto && window.crypto.getRandomValues) {
    define(window.crypto, 'randomUUID', () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (
      (Number(c) ^ (window.crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
    )));
  }
  define(Element.prototype, 'replaceChildren', function () {
    while (this.firstChild) this.removeChild(this.firstChild);
    for (let i = 0; i < arguments.length; i++) {
      const n = arguments[i];
      this.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
    }
  });
  if (window.AbortSignal && window.AbortController) {
    define(AbortSignal, 'timeout', (ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(), ms);
      return c.signal;
    });
  }
}
