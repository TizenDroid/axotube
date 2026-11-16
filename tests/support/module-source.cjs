// Turns an ES module into script text the tests can run, without moving a single offset.
// Import and export syntax is replaced with spaces (newlines kept), so line and column numbers
// in the result are the file's own. That matters for coverage: V8 reports positions in the text
// it ran, and the coverage tool reads them against the file on disk. Deleting the syntax instead
// would shift every position after it.
const blank = function (match) {
  return match.replace(/[^\n]/g, " ");
};

// An import ends at its module specifier (with or without a semicolon), never at a later one.
const BLANK_IMPORT = /^import\s+[\s\S]*?\bfrom\s*["'][^"'\n]+["'][ \t]*;?|^import\s*["'][^"'\n]+["'][ \t]*;?/gm;
const BLANK_EXPORT_LIST = /^export\s*\{[^}]*\};?/gm;
const BLANK_EXPORT = /^export\s+(?:default\s+)?/gm;

function blankSyntax(text) {
  return text
    .replace(new RegExp(BLANK_IMPORT.source, "gm"), blank)
    .replace(new RegExp(BLANK_EXPORT_LIST.source, "gm"), blank)
    .replace(new RegExp(BLANK_EXPORT.source, "gm"), blank);
}

module.exports = { blank, blankSyntax, BLANK_IMPORT, BLANK_EXPORT, BLANK_EXPORT_LIST };
