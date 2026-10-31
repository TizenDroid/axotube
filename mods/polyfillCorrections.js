// Runtime corrections for legacy Tizen polyfills.
// Only replaces an implementation when a small behavior probe shows it is wrong.
'use strict';

(function () {
  var replaceAllBroken = false;
  try {
    var calls = 0;
    var offsets = [];
    var result = 'aba'.replaceAll('a', function (_match, offset) {
      calls += 1;
      offsets.push(offset);
      return 'x';
    });
    replaceAllBroken = result !== 'xbx' || calls !== 2 || offsets[0] !== 0 || offsets[1] !== 2;
  } catch (_e) {
    replaceAllBroken = true;
  }

  if (replaceAllBroken) {
    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    String.prototype.replaceAll = function replaceAllCorrected(search, replace) {
      var subject = String(this);
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll requires a global RegExp');
        return subject.replace(search, replace);
      }
      var pattern = new RegExp(escapeRegExp(String(search)), 'g');
      return subject.replace(pattern, replace);
    };
  }
}());

(function () {
  var fromEntriesBroken = false;
  try {
    var probe = Object.fromEntries([['a', 1]]);
    fromEntriesBroken = Object.getPrototypeOf(probe) !== Object.prototype;
  } catch (_e) {
    fromEntriesBroken = true;
  }

  if (fromEntriesBroken) {
    Object.fromEntries = function fromEntriesCorrected(iterable) {
      var obj = {};
      function assign(pair) {
        if (!pair) return;
        try {
          Object.defineProperty(obj, pair[0], {
            value: pair[1],
            enumerable: true,
            configurable: true,
            writable: true
          });
        } catch (_e) {
          obj[pair[0]] = pair[1];
        }
      }

      if (iterable && typeof iterable.forEach === 'function') {
        iterable.forEach(assign);
      } else {
        var arr = Array.isArray(iterable) ? iterable : Array.prototype.slice.call(iterable || []);
        for (var i = 0; i < arr.length; i++) assign(arr[i]);
      }
      return obj;
    };
  }
}());
