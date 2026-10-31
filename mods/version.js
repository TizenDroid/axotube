// Build-time version. rollup.config.js replaces "__AXOTUBE_VERSION__" with the
// version from the root package.json (see the replace plugin). Keep the token
// unique so it can never be confused with real source strings.
const AXOTUBE_VERSION = "__AXOTUBE_VERSION__";

export default AXOTUBE_VERSION;
