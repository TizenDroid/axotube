"use strict";

// axotube Standalone service
var express = require('express');
var app = express();
var PORT = 8099;
var UPSTREAM_TIMEOUT_MS = 10000;
var fetch = require('node-fetch');
var https = require('https');
// Reuse TLS connections to YouTube across requests. Page, script and segment
// fetches otherwise each pay a new TCP+TLS handshake on the TV.
var upstreamAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15000, maxSockets: 16 });
var URL = require('url');
var path = require('path');
var fs = require('fs');
var net = require('net');

var bundleUpdates = require('./bundleUpdates.js');
// Shipped bundles, read-only inside the WGT. Newer bundles from the CDN are cached
// in a writable folder and preferred once they are newer than the shipped ones.
var BUNDLED_DIR = path.join(__dirname, '..', '..', 'userscript');
var BUNDLE_CACHE_DIR = (function () {
    var preferred = path.join(__dirname, 'bundle-cache');
    try {
        fs.mkdirSync(preferred, { recursive: true });
        fs.accessSync(preferred, fs.constants.W_OK);
        return preferred;
    } catch (e) {
        return path.join(require('os').tmpdir(), 'axotube-bundle-cache');
    }
})();
var BUNDLE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// The first /tv page waits at most this long for the first update check.
var FIRST_CHECK_WAIT_MS = 4000;
var bundleUpdater = bundleUpdates.createBundleUpdater({
    bundledDir: BUNDLED_DIR,
    cacheDir: BUNDLE_CACHE_DIR,
    packageName: bundleUpdates.DEFAULT_PACKAGE,
    fetchText: function (url) {
        return fetch(url, { timeout: 8000, agent: upstreamAgent }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
            return res.text();
        });
    },
    log: function (msg) { console.log('[AxoTube:bundles] ' + msg); }
});
// Early bundle: injected at the start of <head>, before YouTube's own scripts.

var EXACT_CORS_HOSTS = {
    'www.gstatic.com': true,
    'yt3.ggpht.com': true,
    'clients1.google.com': true,
    's.youtube.com': true,
    'jnn-pa.googleapis.com': true,
    'yt3.googleusercontent.com': true,
    'redirector.googlevideo.com': true
};

function isPrivateHostname(hostname) {
    var host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host === 'localhost.localdomain') return true;
    if (net.isIP(host)) {
        if (host === '::1' || host === '0.0.0.0' || host === '::') return true;
        if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
        var m = /^172\.(\d+)\./.exec(host);
        if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
        if (/^fc/i.test(host) || /^fd/i.test(host) || /^fe[89ab]/i.test(host)) return true;
    }
    return false;
}

function isAllowedCorsTarget(parsed) {
    if (!parsed || parsed.protocol !== 'https:') return false;
    if (parsed.auth || parsed.username || parsed.password) return false;
    var hostname = String(parsed.hostname || '').toLowerCase();
    if (!hostname || isPrivateHostname(hostname)) return false;
    if (EXACT_CORS_HOSTS[hostname]) return true;
    return hostname === 'googlevideo.com' || hostname.slice(-16) === '.googlevideo.com';
}

function parseCorsTarget(rawTarget) {
    var decoded = String(rawTarget || '');
    try { decoded = decodeURIComponent(decoded); } catch (e) {}
    if (decoded.indexOf('://') === -1) decoded = 'https://' + decoded;
    var parsed = URL.parse(decoded);
    return isAllowedCorsTarget(parsed) ? parsed : null;
}

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, Origin, Referer');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.get('/axotube/health', function (req, res) {
    res.status(200).end();
});

// Scripts are revalidated on every load, but a 304 avoids the transfer when the
// file has not changed. The tag is built from size and mtime, which change on
// every build, so no content hashing is needed.
function serveScript(file, req, res) {
    fs.stat(file, function (statErr, stat) {
        if (statErr) return res.status(404).end();
        var etag = '"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'no-cache');
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        res.setHeader('Content-Type', 'application/javascript');
        fs.createReadStream(file).on('error', function () {
            if (!res.headersSent) res.status(404).end();
        }).pipe(res);
    });
}

app.get('/axotube/userScript.js', function (req, res) {
    serveScript(bundleUpdater.filePath('userScript.js'), req, res);
});

app.get('/axotube/early.js', function (req, res) {
    serveScript(bundleUpdater.filePath('early.js'), req, res);
});

// Update status for the page's popup, and an apply that re-checks and reports
// back. The page reloads itself after apply, which picks up the new bundles.
app.get('/axotube/update', function (req, res) {
    res.json(bundleUpdater.status());
});

app.post('/axotube/update/apply', function (req, res) {
    bundleUpdater.apply().then(function () {
        res.json(bundleUpdater.status());
    });
});

function buildUpstreamHeaders(req, parsedTarget, isCorsBypass) {
    var headers = {};
    var blocked = {
        host: true,
        connection: true,
        'proxy-connection': true,
        'content-length': true,
        'transfer-encoding': true,
        'accept-encoding': true
    };
    if (isCorsBypass) {
        blocked.cookie = true;
        blocked.authorization = true;
        blocked['proxy-authorization'] = true;
        blocked['x-axotube-token'] = true;
    }

    Object.keys(req.headers || {}).forEach(function (key) {
        var lower = key.toLowerCase();
        if (blocked[lower]) return;
        headers[lower] = req.headers[key];
    });

    if (!isCorsBypass && req.headers.cookie) {
        headers.cookie = req.headers.cookie
            .replace(/__LocalSecure-/g, '__Secure-')
            .replace(/__LocalHost-/g, '__Host-');
    }

    headers.host = parsedTarget.host;
    headers.origin = 'https://www.youtube.com';
    if (headers.referer) headers.referer = 'https://www.youtube.com/tv';
    headers['accept-encoding'] = 'gzip, deflate';
    return headers;
}

function rewriteTrustedText(text) {
    var proxyPrefix = 'http://localhost:' + PORT + '/cors-bypass/';

    text = text.replace(/https:\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, proxyPrefix + 'https://$1.googlevideo.com');
    text = text.replace(/https:\\\/\\\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, 'http:\\\/\\\/localhost:' + PORT + '\\\/cors-bypass\\\/https:\\\/\\\/$1.googlevideo.com');
    text = text.replace(/"\/\/([a-zA-Z0-9-.]+)\.googlevideo\.com/g, '"' + proxyPrefix + 'https://$1.googlevideo.com');

    text = text.replace(/https:\/\/www\.gstatic\.com/g, proxyPrefix + 'https://www.gstatic.com');
    text = text.replace(/http:\/\/www\.gstatic\.com/g, proxyPrefix + 'https://www.gstatic.com');
    text = text.replace(/"\/\/www\.gstatic\.com/g, '"' + proxyPrefix + 'https://www.gstatic.com');
    text = text.replace(/\(\/\/www\.gstatic\.com/g, '(' + proxyPrefix + 'https://www.gstatic.com');
    text = text.replace(/https:\/\/yt3\.ggpht\.com/g, proxyPrefix + 'https://yt3.ggpht.com');
    text = text.replace(/https:\/\/clients1\.google\.com/g, proxyPrefix + 'https://clients1.google.com');
    text = text.replace(/http:\/\/clients1\.google\.com/g, proxyPrefix + 'https://clients1.google.com');
    text = text.replace(/"\/\/clients1\.google\.com/g, '"' + proxyPrefix + 'https://clients1.google.com');
    text = text.replace('Set(["www.youtube.com","accounts.google.com"]);', 'Set(["www.youtube.com", "accounts.google.com", "localhost"]);');
    text = text.replace(/:document\.location\.toString\(\)/g, ':document.location.toString().replace("http://localhost:' + PORT + '", "https://www.youtube.com")');
    text = text.replace(/euri:[^,]+,/g, 'euri:document.location.toString().replace("http://localhost:' + PORT + '", "https://www.youtube.com"),');
    text = text.replace(/https:\/\/s\.youtube\.com/g, proxyPrefix + 'https://s.youtube.com');
    text = text.replace(/redirector\.googlevideo\.com/g, proxyPrefix + 'https://redirector.googlevideo.com');
    text = text.replace(/this\.scheme="https"/, 'this.scheme="http"');
    text = text.replace(/https\:\/\/jnn-pa\.googleapis\.com/g, proxyPrefix + 'https://jnn-pa.googleapis.com');
    text = text.replace(/https:\/\/yt3\.googleusercontent\.com/g, proxyPrefix + 'https://yt3.googleusercontent.com');
    text = text.replace(/"\/\/yt3\.googleusercontent\.com/g, '"' + proxyPrefix + 'https://yt3.googleusercontent.com');
    text = text.replace(/=window\.location\.href;/, '=window.location.href.replace("http://localhost:' + PORT + '", "https://www.youtube.com");');
    text = text.replace(/=document\.location\.href/, '=document.location.href.replace("http://localhost:' + PORT + '", "https://www.youtube.com")');
    return text;
}

// Start the first check now. The /tv page waits briefly for it, so the first load
// after an update already gets the new bundle, and the wait never exceeds the cap.
var firstBundleCheck = bundleUpdater.check();
var firstBundleCheckDone = false;
firstBundleCheck.then(function () { firstBundleCheckDone = true; });
setInterval(function () { bundleUpdater.check(); }, BUNDLE_CHECK_INTERVAL_MS);
app.use(function (req, res, next) {
    if (firstBundleCheckDone || req.url.indexOf('/tv') !== 0 || req.url.indexOf('/tv_config') !== -1) {
        return next();
    }
    var cap = new Promise(function (resolve) { setTimeout(resolve, FIRST_CHECK_WAIT_MS); });
    Promise.race([firstBundleCheck, cap]).then(function () { next(); });
});

app.all('*', function (req, res) {
    var isCorsBypass = req.path.indexOf('/cors-bypass/') === 0;
    var parsedTarget;

    if (isCorsBypass) {
        parsedTarget = parseCorsTarget(req.url.substring('/cors-bypass/'.length));
        if (!parsedTarget) return res.status(403).send('Blocked CORS proxy target');
    } else {
        parsedTarget = URL.parse('https://www.youtube.com' + req.url);
    }

    var targetUrl = URL.format(parsedTarget);
    var hasBody = ['POST', 'PUT', 'PATCH'].indexOf(req.method) !== -1;
    var fetchOptions = {
        method: req.method,
        headers: buildUpstreamHeaders(req, parsedTarget, isCorsBypass),
        body: hasBody ? req : undefined,
        redirect: 'manual',
        timeout: UPSTREAM_TIMEOUT_MS,
        agent: upstreamAgent
    };

    fetch(targetUrl, fetchOptions)
        .then(function (response) {
            res.status(req.method === 'OPTIONS' ? 200 : response.status);
            var rawHeaders = response.headers.raw();
            Object.keys(rawHeaders).forEach(function (key) {
                var lower = key.toLowerCase();
                var skip = {
                    'content-encoding': true,
                    'content-length': true,
                    'transfer-encoding': true,
                    'content-security-policy': true,
                    'alt-svc': true,
                    'access-control-allow-origin': true,
                    connection: true
                };
                if (skip[lower]) return;
                if (lower === 'set-cookie') {
                    if (isCorsBypass) return;
                    var cookies = rawHeaders[key];
                    if (Array.isArray(cookies)) {
                        res.setHeader('Set-Cookie', cookies.map(function (cookieStr) {
                            return cookieStr
                                .replace(/^__Secure-/i, '__LocalSecure-')
                                .replace(/^__Host-/i, '__LocalHost-')
                                .replace(/Domain=[^;]+/i, 'Domain=localhost')
                                .replace(/;\s*Secure/i, '')
                                .replace(/;\s*SameSite=None/i, '')
                                .replace(/;\s*;/g, ';')
                                .replace(/;\s*$/, '');
                        }));
                    }
                    return;
                }
                var value = response.headers.get(key);
                if (value !== null) res.setHeader(key, value);
            });
            res.setHeader('Access-Control-Allow-Origin', '*');

            var contentType = response.headers.get('content-type') || '';
            var textLike = contentType.indexOf('text/html') !== -1 ||
                contentType.indexOf('application/json') !== -1 ||
                contentType.indexOf('javascript') !== -1 ||
                contentType.indexOf('text/css') !== -1;

            if (!textLike) {
                if (response.body) response.body.pipe(res);
                else res.end();
                return;
            }

            return response.text().then(function (text) {
                if (!isCorsBypass && req.url.indexOf('/tv') === 0 && req.url.indexOf('/tv_config') === -1) {
                    // Early bundle first, right after <head>, so its overrides exist
                    // before YouTube reads them. The main bundle stays at the end.
                    var earlyTag = '<script src="http://localhost:' + PORT + '/axotube/early.js"></script>';
                    text = /<head(\s[^>]*)?>/i.test(text)
                        ? text.replace(/<head(\s[^>]*)?>/i, function (m) { return m + earlyTag; })
                        : earlyTag + text;
                    text += '<script src="http://localhost:' + PORT + '/axotube/userScript.js"></script>';
                }
                text = rewriteTrustedText(text);
                res.send(text);
            });
        })
        .catch(function (error) {
            console.error('Proxy Error for [' + targetUrl + ']: ' + error);
            if (!res.headersSent) res.status(502).send('Proxy Connection Broken');
        });
});

// The content proxy is intentionally loopback-only; DIAL/phone control stays on 8085.
var server = app.listen(PORT, '127.0.0.1', function () {
    console.log('[AxoTube:service] listening on 127.0.0.1:' + PORT);
});
// Without this, a busy port (e.g. an earlier instance still running) fails
// silently and the splash only ever times out.
server.on('error', function (err) {
    console.error('[AxoTube:service] could not listen on port ' + PORT + ': ' + err.code);
});

global.isAxoTubeStandalone = true;
require('../../dist/service.js');
