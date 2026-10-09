/**
 * One JSON.parse interception for response features. Filters mutate parsed
 * YouTube response objects in order; a broken filter cannot break JSON.parse
 * or prevent the remaining filters from running.
 */
let installedParse = null;

export function installResponsePipeline(filters) {
  if (installedParse) return installedParse;

  const nativeParse = JSON.parse;
  const reportedErrors = [];

  function parse(text, reviver) {
    // Leave native errors, reviver behavior, receiver and argument forwarding
    // alone. In particular, do not catch syntax errors from nativeParse.
    const result = nativeParse.apply(this, arguments);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return result;
    }

    for (let i = 0; i < filters.length; i++) {
      try {
        filters[i](result);
      } catch (err) {
        if (!reportedErrors[i]) {
          reportedErrors[i] = true;
          console.error("AxoTube JSON response filter failed:", err);
        }
      }
    }
    return result;
  }

  // YouTube may snapshot JSON.parse into its _yttv module namespace after
  // our userscript starts. Rebind those late snapshots as modules appear.
  function bindNativeParsers() {
    let foundParser = false;
    try {
      if (typeof window === "undefined" || !window._yttv) return false;
      const modules = window._yttv;
      for (const key in modules) {
        try {
          const nativeJSON = modules[key] && modules[key].JSON;
          if (nativeJSON && typeof nativeJSON.parse === "function") {
            foundParser = true;
            if (nativeJSON.parse !== parse) nativeJSON.parse = parse;
          }
        } catch (err) {
          // A frozen/host-owned module must not prevent other bindings.
        }
      }
    } catch (err) {
      // _yttv may not be initialized or accessible yet.
    }
    return foundParser;
  }

  JSON.parse = parse;
  installedParse = parse;
  let nativeParserFound = bindNativeParsers();
  // Catch the initial creation of _yttv promptly, then switch to a cheap
  // background rescan for lazy modules and native app replacements.
  if (typeof window !== "undefined" && typeof setTimeout === "function") {
    let checks = 0;
    function pollNativeParsers() {
      nativeParserFound = bindNativeParsers() || nativeParserFound;
      checks++;
      setTimeout(pollNativeParsers, !nativeParserFound && checks < 20 ? 250 : 2000);
    }
    setTimeout(pollNativeParsers, nativeParserFound ? 2000 : 250);
  }
  return parse;
}
