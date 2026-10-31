// Keeps the page scripts (userScript.js and early.js) current without reinstalling
// the WGT. The bundles are published to npm (see scripts/make-bundle-package.js)
// and read through jsDelivr at @latest.
//
// Flow: read the remote package.json, compare its version with the one in use,
// and when it is newer download both bundles at that exact version, validate
// them, and swap them in. The swap is atomic: the files are written and renamed
// first, and meta.json is written last, so a failure part way through leaves the
// previous bundle in use. Nothing is replaced until both files validate.

var fs = require('fs');
var path = require('path');

var CDN = 'https://cdn.jsdelivr.net/npm/';
// Name of the published npm package. Change this to match the package you publish.
var DEFAULT_PACKAGE = 'axotube';
var FILES = ['userScript.js', 'early.js'];
var MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
var MIN_BUNDLE_BYTES = 1000;

// Semver-style compare on major.minor.patch. Returns 1, 0 or -1. Pre-release tags
// are ignored: this project does not publish them to the bundle channel.
function compareSemver(a, b) {
    var pa = String(a || '0').split('-')[0].split('.');
    var pb = String(b || '0').split('-')[0].split('.');
    for (var i = 0; i < 3; i++) {
        var x = parseInt(pa[i] || '0', 10) || 0;
        var y = parseInt(pb[i] || '0', 10) || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return null;
    }
}

function exists(file) {
    try {
        return fs.statSync(file).isFile();
    } catch (e) {
        return false;
    }
}

// Light validation of a downloaded bundle. A bad or truncated response must
// never replace a working bundle.
function looksValid(text) {
    if (typeof text !== 'string') return false;
    if (text.length < MIN_BUNDLE_BYTES || text.length > MAX_BUNDLE_BYTES) return false;
    return text.indexOf('AxoTube') !== -1;
}

// options:
//   bundledDir   directory shipped inside the WGT (holds version.json and the bundles)
//   cacheDir     writable directory for downloaded bundles
//   packageName  npm package to read from jsDelivr
//   fetchText    function(url) -> Promise<string>, rejects on HTTP or network error
//   log          optional logger
function createBundleUpdater(options) {
    var bundledDir = options.bundledDir;
    var cacheDir = options.cacheDir;
    var packageName = options.packageName || DEFAULT_PACKAGE;
    var fetchText = options.fetchText;
    var log = options.log || function () {};

    var latest = null; // { version, available } from the last successful check
    var lastError = null;
    var inFlight = null;

    function bundledVersion() {
        var meta = readJson(path.join(bundledDir, 'version.json'));
        return meta && meta.version ? String(meta.version) : '0.0.0';
    }

    function cachedMeta() {
        var meta = readJson(path.join(cacheDir, 'meta.json'));
        if (!meta || !meta.version) return null;
        var complete = FILES.every(function (name) {
            return exists(path.join(cacheDir, name));
        });
        return complete ? meta : null;
    }

    // The version in use: the cached bundle when it is newer than the one shipped
    // with the WGT, otherwise the shipped one.
    function activeVersion() {
        var cached = cachedMeta();
        var shipped = bundledVersion();
        return cached && compareSemver(cached.version, shipped) > 0 ? cached.version : shipped;
    }

    // Path of the bundle file the proxy should serve right now.
    function filePath(name) {
        var cached = cachedMeta();
        var shipped = bundledVersion();
        if (cached && compareSemver(cached.version, shipped) > 0) {
            return path.join(cacheDir, name);
        }
        return path.join(bundledDir, name);
    }

    function writeAtomic(file, text) {
        var tmp = file + '.tmp';
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, file);
    }

    function download(remoteVersion) {
        var base = CDN + packageName + '@' + remoteVersion + '/dist/';
        return Promise.all(
            FILES.map(function (name) {
                return fetchText(base + name).then(function (text) {
                    if (!looksValid(text)) {
                        throw new Error('downloaded ' + name + ' failed validation');
                    }
                    return { name: name, text: text };
                });
            }),
        );
    }

    function swapIn(remoteVersion, parts) {
        fs.mkdirSync(cacheDir, { recursive: true });
        parts.forEach(function (part) {
            writeAtomic(path.join(cacheDir, part.name), part.text);
        });
        // Written last: until meta.json names this version, the cache is ignored.
        writeAtomic(path.join(cacheDir, 'meta.json'), JSON.stringify({ version: remoteVersion }));
    }

    // applyNow: install a newer bundle. Without it, a newer bundle is only reported,
    // unless nothing is cached yet: the very first check installs the latest, so a
    // first-time user gets the current version without a popup.
    function runCheck(applyNow) {
        var current = activeVersion();
        var install = applyNow || !cachedMeta();
        return fetchText(CDN + packageName + '@latest/package.json')
            .then(function (text) {
                var remote = JSON.parse(text).version;
                if (!remote || !/^\d+\.\d+\.\d+/.test(String(remote))) {
                    throw new Error('remote package.json has no usable version');
                }
                remote = String(remote);
                if (compareSemver(remote, current) <= 0) {
                    latest = { version: remote };
                    lastError = null;
                    return latest;
                }
                if (!install) {
                    latest = { version: remote };
                    lastError = null;
                    log('bundle ' + remote + ' is available');
                    return latest;
                }
                return download(remote).then(function (parts) {
                    swapIn(remote, parts);
                    log('bundle updated to ' + remote);
                    latest = { version: remote };
                    lastError = null;
                    return latest;
                });
            })
            .catch(function (err) {
                lastError = String((err && err.message) || err);
                log('bundle check failed: ' + lastError);
                return latest;
            });
    }

    // Single-flight: concurrent callers share one check.
    function check() {
        if (!inFlight) {
            inFlight = runCheck(false).then(
                function (result) {
                    inFlight = null;
                    return result;
                },
                function () {
                    inFlight = null;
                    return latest;
                },
            );
        }
        return inFlight;
    }

    // Installs the newest bundle now. Used when the user chooses Update.
    function apply() {
        return runCheck(true);
    }

    // The status the page uses to decide whether to show the update popup. A newer
    // version is reported as available until it has been applied.
    function status() {
        var current = activeVersion();
        var remote = latest && latest.version;
        return {
            current: current,
            latest: remote || null,
            available: !!remote && compareSemver(remote, current) > 0,
            error: lastError,
        };
    }

    return {
        check: check,
        apply: apply,
        status: status,
        filePath: filePath,
        activeVersion: activeVersion,
        bundledVersion: bundledVersion,
    };
}

module.exports = {
    compareSemver: compareSemver,
    createBundleUpdater: createBundleUpdater,
    CDN: CDN,
    DEFAULT_PACKAGE: DEFAULT_PACKAGE,
    FILES: FILES,
};
