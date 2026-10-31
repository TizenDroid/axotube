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
 *
 * This file must be imported BEFORE any application module.
 * It is intentionally written in plain ES5 so Babel/Terser cannot break it.
 */

/* eslint-disable no-var, prefer-arrow-callback, no-prototype-builtins */
'use strict';

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
    // Fallback for environments where the trick above does not work
    if (typeof window !== 'undefined')      window.globalThis  = window;
    else if (typeof self !== 'undefined')   self.globalThis    = self;
  }
}());

// ─────────────────────────────────────────────────────────────────────────────
// NodeList.forEach / HTMLCollection.forEach
// Chrome 47 (Tizen 4) does not have these; they were added in Chrome 51.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (window.NodeList && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
  if (window.HTMLCollection && !HTMLCollection.prototype.forEach) {
    HTMLCollection.prototype.forEach = Array.prototype.forEach;
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
  if (typeof Promise === 'undefined') return;
  if (typeof Promise.prototype['finally'] === 'function') return;

  Promise.prototype['finally'] = function finallyPolyfill(onFinally) {
    var C = this.constructor || Promise;
    return this.then(
      function (value) {
        return C.resolve(onFinally()).then(function () { return value; });
      },
      function (reason) {
        return C.resolve(onFinally()).then(function () { throw reason; });
      }
    );
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// Promise.allSettled
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Promise === 'undefined') return;
  if (typeof Promise.allSettled === 'function') return;

  Promise.allSettled = function allSettledPolyfill(promises) {
    return Promise.all(
      Array.prototype.map.call(promises, function (p) {
        return Promise.resolve(p).then(
          function (v) { return { status: 'fulfilled', value: v }; },
          function (r) { return { status: 'rejected',  reason: r }; }
        );
      })
    );
  };
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

  Array.prototype.flat = function flatPolyfill(depth) {
    depth = (depth === undefined) ? 1 : Math.floor(depth);
    return flatDeep(this, depth < 0 ? 0 : depth, []);
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// Array.prototype.flatMap
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Array.prototype.flatMap === 'function') return;

  Array.prototype.flatMap = function flatMapPolyfill(cb, thisArg) {
    return Array.prototype.map.call(this, cb, thisArg).flat(1);
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// String.prototype.replaceAll
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof String.prototype.replaceAll === 'function') return;

  String.prototype.replaceAll = function replaceAllPolyfill(search, replace) {
    if (typeof search !== 'string') return this.replace(search, replace);
    return this.split(search).join(
      typeof replace === 'function'
        ? replace(search, 0, String(this))
        : String(replace)
    );
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// Object.entries / Object.values
// Chrome 47 (Tizen 4) lacks these; shipped natively in Chrome 54.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Object.values === 'function' && typeof Object.entries === 'function') return;

  Object.values = Object.values || function valuesPolyfill(obj) {
    var keys = Object.keys(obj);
    var out = [];
    for (var i = 0; i < keys.length; i++) out.push(obj[keys[i]]);
    return out;
  };

  Object.entries = Object.entries || function entriesPolyfill(obj) {
    var keys = Object.keys(obj);
    var out = [];
    for (var i = 0; i < keys.length; i++) out.push([keys[i], obj[keys[i]]]);
    return out;
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// Object.fromEntries
// settings.js uses Object.fromEntries(…)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (typeof Object.fromEntries === 'function') return;

  Object.fromEntries = function fromEntriesPolyfill(iterable) {
    var obj = Object.create(null);
    // Handle plain arrays and anything with forEach (Map, etc.)
    if (typeof iterable.forEach === 'function') {
      iterable.forEach(function (pair) {
        obj[pair[0]] = pair[1];
      });
    } else {
      var arr = Array.isArray(iterable) ? iterable : Array.prototype.slice.call(iterable);
      for (var i = 0; i < arr.length; i++) {
        obj[arr[i][0]] = arr[i][1];
      }
    }
    return obj;
  };
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

  Element.prototype.closest = function closestPolyfill(selector) {
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
  };
}());

// ─────────────────────────────────────────────────────────────────────────────
// Element.prototype.matches  (dependency of closest above)
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  if (!window.Element) return;
  var proto = Element.prototype;
  if (typeof proto.matches === 'function') return;
  proto.matches = proto.msMatchesSelector ||
                  proto.webkitMatchesSelector ||
                  function matchesPolyfill(selector) {
                    var matches = (this.document || this.ownerDocument).querySelectorAll(selector);
                    var i = matches.length;
                    while (--i >= 0 && matches.item(i) !== this) { /* empty */ }
                    return i > -1;
                  };
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
