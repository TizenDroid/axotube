/**
 * One JSON.parse interception for response features. Filters mutate parsed
 * YouTube response objects in order; a broken filter cannot break JSON.parse
 * or prevent the remaining filters from running.
 */
let installedParse = null;
// Total rescans of YouTube's module registry: 20 quick ones plus about a minute
// of slower ones.
const PARSER_RESCAN_LIMIT = 32;

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
          console.error("[AxoTube:responsePipeline] AxoTube JSON response filter failed:", err);
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
  // Catch the initial creation of _yttv promptly, then back off. The rescan is
  // bounded: a native parser that appears later than about a minute is not
  // worth a timer that runs for the whole session.
  if (typeof window !== "undefined" && typeof setTimeout === "function") {
    let checks = 0;
    function pollNativeParsers() {
      nativeParserFound = bindNativeParsers() || nativeParserFound;
      checks++;
      if (checks >= PARSER_RESCAN_LIMIT) return;
      setTimeout(pollNativeParsers, !nativeParserFound && checks < 20 ? 250 : 5000);
    }
    setTimeout(pollNativeParsers, nativeParserFound ? 5000 : 250);
  }
  return parse;
}
