/**
 * polyfills.js – browser-API polyfills for Tizen 4 (N5470).
 *
 * Covers APIs that core-js does NOT polyfill (DOM/browser-runtime APIs):
 *   • globalThis
 *   • NodeList.forEach / HTMLCollection.forEach
 *   • EventTarget (constructable)   ← used by config.js: new EventTarget()
 *   • AbortController / AbortSignal ← used by adblock.js fetch timeout
 *   • CustomEvent (constructable)   ← used by config.js: new CustomEvent(…)
 *   • Promise.prototype.finally     ← used by adblock.js: fetch(…).finally(…)
 *   • Promise.allSettled
 *   • Array.prototype.flat / flatMap
 *   • String.prototype.replaceAll
 *   • Object.fromEntries
 *   • queueMicrotask
 *   • ES2015–ES2017 built-ins called directly by the app bundle (see the last section)
 *
 * Every polyfill is installed only when the engine lacks the feature, so modern engines
 * keep their own implementation. Methods are defined non-enumerable: a plain assignment
 * to a prototype would show up in for...in loops over arrays and strings in app code.
 *
 * This file must be imported BEFORE any application module.
 * It is intentionally written in plain ES5 so Babel/Terser cannot break it.
 */

/* eslint-disable no-var, prefer-arrow-callback, no-prototype-builtins */
'use strict';

// Defines a method or value without making it enumerable, like the built-ins themselves.
function defineHidden(target, name, value) {
  Object.defineProperty(target, name, { value: value, writable: true, configurable: true, enumerable: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// globalThis
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof globalThis !== 'undefined') return;
  try {
    // W3C trick – works in strict mode
    Object.defineProperty(Object.prototype, '__globalThis__', {
      get: function () { return this; },
      configurable: true
    });
    /* global __globalThis__ */
    __globalThis__.globalThis = __globalThis__; // eslint-disable-line no-undef
    delete Object.prototype.__globalThis__;
  } catch (_e) {
    // Fallback where Object.prototype cannot take the getter. Every block below uses
    // window, so the page always has it.
    window.globalThis = window;
  }
}());

// ─────────────────────────────────────────────────────────────────────────────
// NodeList.forEach / HTMLCollection.forEach
// Chrome 47 (Tizen 4) does not have these; they were added in Chrome 51.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (window.NodeList && !NodeList.prototype.forEach) {
    defineHidden(NodeList.prototype, 'forEach', Array.prototype.forEach);
  }
  if (window.HTMLCollection && !HTMLCollection.prototype.forEach) {
    defineHidden(HTMLCollection.prototype, 'forEach', Array.prototype.forEach);
  }
}());

// ─────────────────────────────────────────────────────────────────────────────
// EventTarget – Safe Constructable Polyfill
// Older Tizen browsers ship EventTarget as a non-constructable interface.
// config.js does:  export const configChangeEmitter = new EventTarget();
//
// IMPORTANT: If EventTarget exists natively we must NOT replace it entirely,
// because it is the foundation of the DOM prototype chain (Node, Element, etc.
// inherit from it).  Replacing it destroys instanceof checks and causes
// "Illegal Invocation" crashes in YouTube's core routing logic.
// Instead, we return a plain-object facade that implements the same API.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var NativeEventTarget = window.EventTarget;
  if (typeof NativeEventTarget !== 'undefined') {
    try {
      new NativeEventTarget();
      return; // Already constructable – nothing to do
    } catch (_e) {
      /* Exists but throws on new.  Apply non-destructive facade. */
    }
  }

  window.EventTarget = function EventTargetFacade() {
    var listeners = {};
    return {
      addEventListener: function (type, cb) {
        if (typeof cb !== 'function') return;
        if (!listeners[type]) listeners[type] = [];
        if (listeners[type].indexOf(cb) === -1) listeners[type].push(cb);
      },
      removeEventListener: function (type, cb) {
        var list = listeners[type];
        if (!list) return;
        var idx = list.indexOf(cb);
        if (idx !== -1) list.splice(idx, 1);
      },
      dispatchEvent: function (event) {
        var list = listeners[event && event.type];
        if (list) {
          var snap = list.slice();
          for (var i = 0; i < snap.length; i++) {
            try { snap[i].call(this, event); } catch (err) { console.error(err); }
          }
        }
        return !(event && event.defaultPrevented);
      }
    };
  };

  if (NativeEventTarget) {
    window.EventTarget.prototype = NativeEventTarget.prototype;
  }
}());

// ─────────────────────────────────────────────────────────────────────────────
// AbortController / AbortSignal
// adblock.js calls new AbortController() inside createFetchWithTimeout().
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof AbortController !== 'undefined') return;

  function AbortSignalPolyfill() {
    this.aborted = false;
    this._cbs = [];
  }
  AbortSignalPolyfill.prototype.addEventListener = function (type, cb) {
    if (type === 'abort' && typeof cb === 'function') this._cbs.push(cb);
  };
  AbortSignalPolyfill.prototype.removeEventListener = function (type, cb) {
    if (type !== 'abort') return;
    var idx = this._cbs.indexOf(cb);
    if (idx !== -1) this._cbs.splice(idx, 1);
  };
  AbortSignalPolyfill.prototype.dispatchEvent = function (evt) {
    if (evt && evt.type === 'abort') {
      var snap = this._cbs.slice();
      for (var i = 0; i < snap.length; i++) snap[i](evt);
    }
  };

  function AbortControllerPolyfill() {
    this.signal = new AbortSignalPolyfill();
  }
  AbortControllerPolyfill.prototype.abort = function () {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.dispatchEvent({ type: 'abort', bubbles: false, cancelable: false });
  };

  window.AbortSignal     = AbortSignalPolyfill;
  window.AbortController = AbortControllerPolyfill;
}());

// ─────────────────────────────────────────────────────────────────────────────
// CustomEvent – constructable polyfill
// config.js:  new CustomEvent('configChange', { detail: { key, value } })
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof CustomEvent === 'function') return;

  function CustomEventPolyfill(type, params) {
    params = params || {};
    var bubbles    = !!params.bubbles;
    var cancelable = !!params.cancelable;
    var detail     = params.detail !== undefined ? params.detail : null;
    var evt;
    try {
      evt = document.createEvent('CustomEvent');
      evt.initCustomEvent(type, bubbles, cancelable, detail);
    } catch (_e) {
      evt = document.createEvent('Event');
      evt.initEvent(type, bubbles, cancelable);
      evt.detail = detail;
    }
    return evt;
  }

  if (window.Event && window.Event.prototype) {
    CustomEventPolyfill.prototype = window.Event.prototype;
  }
  window.CustomEvent = CustomEventPolyfill;
}());

// ─────────────────────────────────────────────────────────────────────────────
// Promise.prototype.finally
// adblock.js:  fetch(url, …).finally(() => clearTimeout(id))
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Promise.prototype['finally'] === 'function') return;

  defineHidden(Promise.prototype, 'finally', function finallyPolyfill(onFinally) {
    var C = this.constructor;
    return this.then(
      function (value) {
        return C.resolve(onFinally()).then(function () { return value; });
      },
      function (reason) {
        return C.resolve(onFinally()).then(function () { throw reason; });
      }
    );
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// Promise.allSettled
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Promise.allSettled === 'function') return;

  defineHidden(Promise, 'allSettled', function allSettledPolyfill(promises) {
    return Promise.all(
      Array.prototype.map.call(promises, function (p) {
        return Promise.resolve(p).then(
          function (v) { return { status: 'fulfilled', value: v }; },
          function (r) { return { status: 'rejected',  reason: r }; }
        );
      })
    );
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// Array.prototype.flat
// moreSubtitles.js uses .flat() indirectly via spread / missingLanguages
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Array.prototype.flat === 'function') return;

  function flatDeep(arr, depth, result) {
    for (var i = 0; i < arr.length; i++) {
      if (depth > 0 && Array.isArray(arr[i])) {
        flatDeep(arr[i], depth - 1, result);
      } else {
        result.push(arr[i]);
      }
    }
    return result;
  }

  defineHidden(Array.prototype, 'flat', function flatPolyfill(depth) {
    depth = (depth === undefined) ? 1 : Math.floor(depth);
    return flatDeep(this, depth < 0 ? 0 : depth, []);
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// Array.prototype.flatMap
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Array.prototype.flatMap === 'function') return;

  defineHidden(Array.prototype, 'flatMap', function flatMapPolyfill(cb, thisArg) {
    return Array.prototype.map.call(this, cb, thisArg).flat(1);
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// String.prototype.replaceAll
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof String.prototype.replaceAll === 'function') return;

  // A global RegExp goes straight to replace. A string is escaped into a global pattern, so the
  // engine applies the spec's replacer arguments (match, position, string) and $-substitutions.
  defineHidden(String.prototype, 'replaceAll', function replaceAllPolyfill(search, replace) {
    if (Object.prototype.toString.call(search) === '[object RegExp]') {
      if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
      return this.replace(search, replace);
    }
    var escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(this).replace(new RegExp(escaped, 'g'), replace);
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// Object.entries / Object.values
// Chrome 47 (Tizen 4) lacks these; shipped natively in Chrome 54.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Object.values !== 'function') {
    defineHidden(Object, 'values', function valuesPolyfill(obj) {
      var keys = Object.keys(obj);
      var out = [];
      for (var i = 0; i < keys.length; i++) out.push(obj[keys[i]]);
      return out;
    });
  }

  if (typeof Object.entries !== 'function') {
    defineHidden(Object, 'entries', function entriesPolyfill(obj) {
      var keys = Object.keys(obj);
      var out = [];
      for (var i = 0; i < keys.length; i++) out.push([keys[i], obj[keys[i]]]);
      return out;
    });
  }
}());

// ─────────────────────────────────────────────────────────────────────────────
// Object.fromEntries
// settings.js uses Object.fromEntries(…)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Object.fromEntries === 'function') return;

  // Consumes any iterable of [key, value] pairs (arrays, Maps, generators), as the spec does.
  defineHidden(Object, 'fromEntries', function fromEntriesPolyfill(iterable) {
    if (iterable === null || iterable === undefined) throw new TypeError('Object.fromEntries requires an iterable');
    var obj = {};
    var iterator = iterable[Symbol.iterator]();
    var step = iterator.next();
    while (!step.done) {
      var pair = step.value;
      if (pair === null || (typeof pair !== 'object' && typeof pair !== 'function')) {
        throw new TypeError('Iterator value is not an entry object');
      }
      obj[pair[0]] = pair[1];
      step = iterator.next();
    }
    return obj;
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// queueMicrotask
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof queueMicrotask === 'function') return;
  window.queueMicrotask = function queueMicrotaskPolyfill(cb) {
    Promise.resolve()
      .then(cb)
      .catch(function (err) { setTimeout(function () { throw err; }, 0); });
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// Element.prototype.closest  (used by hqThumbnailsFocusObserver.js)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (!window.Element) return;
  if (typeof Element.prototype.closest === 'function') return;

  defineHidden(Element.prototype, 'closest', function closestPolyfill(selector) {
    var el = this;
    while (el && el.nodeType === 1) {
      if (el.matches ? el.matches(selector) :
          el.msMatchesSelector ? el.msMatchesSelector(selector) :
          el.webkitMatchesSelector ? el.webkitMatchesSelector(selector) : false) {
        return el;
      }
      el = el.parentElement || el.parentNode;
    }
    return null;
  });
}());

// ─────────────────────────────────────────────────────────────────────────────
// Element.prototype.matches  (dependency of closest above)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (!window.Element) return;
  var proto = Element.prototype;
  if (typeof proto.matches === 'function') return;
  defineHidden(proto, 'matches', proto.msMatchesSelector ||
                proto.webkitMatchesSelector ||
                function matchesPolyfill(selector) {
                  var matches = (this.document || this.ownerDocument).querySelectorAll(selector);
                  var i = matches.length;
                  while (--i >= 0 && matches.item(i) !== this) { /* empty */ }
                  return i > -1;
                });
}());

// ─────────────────────────────────────────────────────────────────────────────
// Intl.Locale – minimal polyfill (Chrome 57 lacks it; ships natively Chrome 74+)
// moreSubtitles.js only ever does: new Intl.Locale('und', { region }).maximize().language
// This is NOT a spec-compliant Intl.Locale — it only supports that one call shape.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Intl === 'undefined') return;
  if (typeof Intl.Locale === 'function') return; // native support present

  var REGION_TO_LANG = {
    US: 'en', GB: 'en', AU: 'en', CA: 'en', IN: 'hi', IE: 'en', NZ: 'en',
    FR: 'fr', DE: 'de', ES: 'es', IT: 'it', PT: 'pt', BR: 'pt', MX: 'es',
    AR: 'es', CO: 'es', CL: 'es', RU: 'ru', UA: 'uk', PL: 'pl', NL: 'nl',
    BE: 'nl', SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', TR: 'tr', GR: 'el',
    CZ: 'cs', SK: 'sk', HU: 'hu', RO: 'ro', BG: 'bg', HR: 'hr', RS: 'sr',
    JP: 'ja', KR: 'ko', VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', PH: 'tl',
    SA: 'ar', AE: 'ar', EG: 'ar', IL: 'he', IR: 'fa', PK: 'ur', BD: 'bn', LK: 'si'
  };

  function IntlLocalePolyfill(tag, opts) {
    opts = opts || {};
    this.language = REGION_TO_LANG[opts.region] || 'en';
  }
  IntlLocalePolyfill.prototype.maximize = function () { return this; };

  Intl.Locale = IntlLocalePolyfill;
}());

// ─────────────────────────────────────────────────────────────────────────────
// ES2015–ES2017 built-ins the app bundle calls directly (Array.prototype.includes,
// find, findIndex; Array.from; Object.assign; String includes and startsWith;
// Number.isFinite, isSafeInteger and the safe-integer constants). Chromium 47 has all
// of these natively, so each is a no-op there. The shims cover engines that lack them.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  var MAX_SAFE = 9007199254740991;

  // Installs a built-in only when the engine has none.
  function defineIfMissing(target, name, value) {
    if (target[name] !== undefined) return;
    defineHidden(target, name, value);
  }

  function sameValueZero(a, b) {
    return a === b || (a !== a && b !== b);
  }

  function rejectRegExp(value, method) {
    if (Object.prototype.toString.call(value) === '[object RegExp]') {
      throw new TypeError('First argument to String.prototype.' + method + ' must not be a regular expression');
    }
  }

  function requireThis(value, method) {
    if (value === null || value === undefined) {
      throw new TypeError('String.prototype.' + method + ' called on null or undefined');
    }
  }

  defineIfMissing(Array.prototype, 'includes', function includesPolyfill(search, fromIndex) {
    var o = Object(this);
    var len = o.length >>> 0;
    var n = Number(fromIndex) || 0;
    var k = n >= 0 ? Math.floor(n) : Math.max(len + Math.ceil(n), 0);
    for (; k < len; k++) {
      if (sameValueZero(o[k], search)) return true;
    }
    return false;
  });

  defineIfMissing(Array.prototype, 'findIndex', function findIndexPolyfill(predicate, thisArg) {
    if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
    var o = Object(this);
    var len = o.length >>> 0;
    for (var i = 0; i < len; i++) {
      if (predicate.call(thisArg, o[i], i, o)) return i;
    }
    return -1;
  });

  defineIfMissing(Array.prototype, 'find', function findPolyfill(predicate, thisArg) {
    if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
    var o = Object(this);
    var len = o.length >>> 0;
    for (var i = 0; i < len; i++) {
      if (predicate.call(thisArg, o[i], i, o)) return o[i];
    }
    return undefined;
  });

  // Accepts iterables (Map and Set iterators, strings) and array-like objects.
  defineIfMissing(Array, 'from', function fromPolyfill(items, mapFn, thisArg) {
    if (items === null || items === undefined) {
      throw new TypeError('Array.from requires an array-like or iterable object');
    }
    if (mapFn !== undefined && typeof mapFn !== 'function') {
      throw new TypeError('Array.from: mapFn must be a function');
    }
    var out = [];
    var iterFn = items[Symbol.iterator];
    if (typeof iterFn === 'function') {
      var it = iterFn.call(items);
      var step = it.next();
      while (!step.done) {
        out.push(step.value);
        step = it.next();
      }
    } else {
      var len = Object(items).length >>> 0;
      for (var i = 0; i < len; i++) out.push(items[i]);
    }
    if (mapFn) {
      for (var j = 0; j < out.length; j++) out[j] = mapFn.call(thisArg, out[j], j);
    }
    return out;
  });

  defineIfMissing(Object, 'assign', function assignPolyfill(target) {
    if (target === null || target === undefined) {
      throw new TypeError('Cannot convert undefined or null to object');
    }
    var to = Object(target);
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (source === null || source === undefined) continue;
      var from = Object(source);
      var keys = Object.keys(from);
      for (var k = 0; k < keys.length; k++) to[keys[k]] = from[keys[k]];
    }
    return to;
  });

  defineIfMissing(String.prototype, 'includes', function includesStringPolyfill(search, position) {
    requireThis(this, 'includes');
    rejectRegExp(search, 'includes');
    var text = String(this);
    var start = Number(position) || 0;
    if (start < 0) start = 0;
    return text.indexOf(String(search), start) !== -1;
  });

  defineIfMissing(String.prototype, 'startsWith', function startsWithPolyfill(search, position) {
    requireThis(this, 'startsWith');
    rejectRegExp(search, 'startsWith');
    var text = String(this);
    var needle = String(search);
    var start = Number(position) || 0;
    if (start < 0) start = 0;
    if (start > text.length) start = text.length;
    return text.substring(start, start + needle.length) === needle;
  });

  defineIfMissing(Number, 'isFinite', function isFinitePolyfill(value) {
    return typeof value === 'number' && isFinite(value);
  });

  defineIfMissing(Number, 'isSafeInteger', function isSafeIntegerPolyfill(value) {
    return typeof value === 'number' && isFinite(value) &&
      Math.floor(value) === value && Math.abs(value) <= MAX_SAFE;
  });

  defineIfMissing(Number, 'MAX_SAFE_INTEGER', MAX_SAFE);
  defineIfMissing(Number, 'MIN_SAFE_INTEGER', -MAX_SAFE);
}());
