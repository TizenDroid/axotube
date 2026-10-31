package org.axotube.tv;

import android.util.Log;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A loopback-only HTTP origin equivalent to standalone/service/index.js. */
final class LocalProxy {
    static final int PORT = 8099;
    private static final String TAG = "AxoTubeProxy";
    private static final String ORIGIN = "http://localhost:" + PORT;
    private static final int HEADER_LIMIT = 32768;
    private static final int BODY_LIMIT = 8 * 1024 * 1024;
    private static final Set<String> CORS_HOSTS = new HashSet<>(Arrays.asList(
            "www.gstatic.com", "yt3.ggpht.com", "clients1.google.com", "s.youtube.com",
            "jnn-pa.googleapis.com", "yt3.googleusercontent.com", "redirector.googlevideo.com"));
    private static final Set<String> DROP_RESPONSE = new HashSet<>(Arrays.asList(
            "content-encoding", "content-length", "transfer-encoding",
            "content-security-policy", "alt-svc", "connection",
            "access-control-allow-origin", "access-control-allow-credentials", "keep-alive"));
    private static final Set<String> DROP_REQUEST = new HashSet<>(Arrays.asList(
            "host", "connection", "proxy-connection", "content-length", "transfer-encoding",
            "accept-encoding", "upgrade"));

    private final BundleStore bundles;
    private final ExecutorService workers = Executors.newFixedThreadPool(12);
    private ServerSocket listener;

    LocalProxy(BundleStore bundles) {
        this.bundles = bundles;
    }

    void start() throws Exception {
        // Never expose the proxy on the TV's LAN or an emulator's public interface.
        listener = new ServerSocket(PORT, 32, InetAddress.getByName("127.0.0.1"));
        Thread acceptor = new Thread(() -> {
            while (!listener.isClosed()) {
                try {
                    Socket client = listener.accept();
                    client.setSoTimeout(30000);
                    workers.execute(() -> serve(client));
                } catch (Exception e) {
                    if (!listener.isClosed()) Log.w(TAG, "Accept error", e);
                }
            }
        }, "axotube-proxy-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    void stop() {
        try { if (listener != null) listener.close(); } catch (IOException ignored) { }
        workers.shutdownNow();
    }

    private static final class Request {
        String method;
        String target;
        Map<String, String> headers = new HashMap<>();
        byte[] body;
    }

    private static String readLine(InputStream in, int max) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (out.size() >= max) throw new IOException("HTTP header too long");
            if (b != '\r') out.write(b);
        }
        if (b == -1 && out.size() == 0) return null;
        return out.toString("ISO-8859-1");
    }

    private static void readFully(InputStream stream, byte[] into, int offset, int count) throws IOException {
        while (count > 0) {
            int n = stream.read(into, offset, count);
            if (n < 0) throw new IOException("Unexpected EOF in request body");
            offset += n;
            count -= n;
        }
    }

    private static Request readRequest(InputStream stream) throws Exception {
        String first = readLine(stream, 8192);
        if (first == null) return null;
        String[] parts = first.split(" ", 3);
        if (parts.length != 3 || !parts[2].startsWith("HTTP/") || !parts[1].startsWith("/")) {
            throw new IOException("Malformed HTTP request");
        }
        Request result = new Request();
        result.method = parts[0].toUpperCase(Locale.ROOT);
        result.target = parts[1];
        int total = first.length();
        while (true) {
            String line = readLine(stream, 8192);
            if (line == null || line.isEmpty()) break;
            total += line.length();
            if (total > HEADER_LIMIT) throw new IOException("Too many HTTP headers");
            int colon = line.indexOf(':');
            if (colon > 0) {
                String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = line.substring(colon + 1).trim();
                result.headers.put(key, value);
            }
        }
        if ("chunked".equalsIgnoreCase(result.headers.get("transfer-encoding"))) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            while (true) {
                String sizeText = readLine(stream, 128);
                if (sizeText == null) throw new IOException("EOF in chunks");
                int semi = sizeText.indexOf(';');
                long size = Long.parseLong(semi == -1 ? sizeText.trim() : sizeText.substring(0, semi).trim(), 16);
                if (size < 0 || size > BODY_LIMIT - bytes.size()) throw new IOException("Body exceeds limit");
                if (size == 0) {
                    while (true) {
                        String trailer = readLine(stream, 8192);
                        if (trailer == null || trailer.isEmpty()) break;
                    }
                    break;
                }
                byte[] block = new byte[(int) size];
                readFully(stream, block, 0, block.length);
                bytes.write(block);
                if (readLine(stream, 2) == null) throw new IOException("Missing chunk terminator");
            }
            result.body = bytes.toByteArray();
        } else {
            String lengthText = result.headers.get("content-length");
            long size = lengthText == null ? 0 : Long.parseLong(lengthText);
            if (size < 0 || size > BODY_LIMIT) throw new IOException("Request body exceeds limit");
            result.body = new byte[(int) size];
            readFully(stream, result.body, 0, result.body.length);
        }
        return result;
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 206: return "Partial Content";
            case 301: return "Moved Permanently";
            case 302: return "Found";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            default: return "Response";
        }
    }

    private static void startResponse(OutputStream out, int status, Map<String, List<String>> headers,
                                      boolean cors, boolean bodyPresent, long length) throws Exception {
        StringBuilder text = new StringBuilder("HTTP/1.1 " + status + " " + reason(status) + "\r\n");
        text.append("Connection: close\r\n");
        if (cors) {
            text.append("Access-Control-Allow-Origin: *\r\n");
            text.append("Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, PATCH, DELETE\r\n");
            text.append("Access-Control-Allow-Headers: Content-Type, Range, Accept, Origin, Referer\r\n");
        }
        if (length >= 0) text.append("Content-Length: ").append(bodyPresent ? length : 0).append("\r\n");
        if (headers != null) {
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                String name = entry.getKey();
                if (name == null || DROP_RESPONSE.contains(name.toLowerCase(Locale.ROOT))) continue;
                if (!name.matches("[A-Za-z0-9-]+")) continue;
                for (String value : entry.getValue()) {
                    if (value == null || value.contains("\r") || value.contains("\n")) continue;
                    text.append(name).append(": ").append(value).append("\r\n");
                }
            }
        }
        text.append("\r\n");
        out.write(text.toString().getBytes(StandardCharsets.ISO_8859_1));
    }

    private static void send(OutputStream out, int status, String type, byte[] body, String extra) throws Exception {
        String head = "HTTP/1.1 " + status + " " + reason(status) + "\r\n"
                + "Connection: close\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, PATCH, DELETE\r\n"
                + "Access-Control-Allow-Headers: Content-Type, Range, Accept, Origin, Referer\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Content-Type: " + type + "\r\n"
                + (extra == null ? "" : extra)
                + "Content-Length: " + body.length + "\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }

    private static void sendText(OutputStream out, int status, String value) throws Exception {
        send(out, status, "text/plain; charset=utf-8", value.getBytes(StandardCharsets.UTF_8), null);
    }

    private static String param(String rawQuery, String key) {
        if (rawQuery == null) return null;
        for (String part : rawQuery.split("&")) {
            int at = part.indexOf('=');
            if (at > 0 && part.substring(0, at).equals(key)) {
                try { return URLDecoder.decode(part.substring(at + 1), "UTF-8"); }
                catch (Exception ignored) { return null; }
            }
        }
        return null;
    }

    private void serve(Socket socket) {
        try (Socket client = socket;
             InputStream input = new BufferedInputStream(client.getInputStream());
             OutputStream output = new BufferedOutputStream(client.getOutputStream())) {
            Request req = readRequest(input);
            if (req == null) return;
            if ("OPTIONS".equals(req.method)) {
                send(output, 200, "text/plain", new byte[0], null);
                return;
            }
            URI target = URI.create(req.target);
            String path = target.getRawPath();
            if ("/axotube/health".equals(path) && "GET".equals(req.method)) {
                send(output, 200, "text/plain", new byte[0], null);
                return;
            }
            if ("/axotube/update".equals(path) && "GET".equals(req.method)) {
                send(output, 200, "application/json; charset=utf-8",
                        bundles.status().toString().getBytes(StandardCharsets.UTF_8), null);
                return;
            }
            if ("/axotube/update/apply".equals(path) && "POST".equals(req.method)) {
                bundles.apply();
                send(output, 200, "application/json; charset=utf-8",
                        bundles.status().toString().getBytes(StandardCharsets.UTF_8), null);
                return;
            }
            if (("/axotube/early.js".equals(path) || "/axotube/userScript.js".equals(path))
                    && "GET".equals(req.method)) {
                String name = path.substring("/axotube/".length());
                String requested = param(target.getRawQuery(), "v");
                byte[] bytes = bundles.script(name, requested);
                String etag = "\"" + (requested == null ? bundles.activeVersion() : requested)
                        + "-" + name + "-" + bytes.length + "\"";
                if (etag.equals(req.headers.get("if-none-match"))) {
                    send(output, 304, "application/javascript", new byte[0], "ETag: " + etag + "\r\n");
                } else {
                    send(output, 200, "application/javascript; charset=utf-8", bytes, "ETag: " + etag + "\r\n");
                }
                return;
            }
            if (path.startsWith("/axotube/")) {
                sendText(output, 404, "Unknown local endpoint");
                return;
            }
            if ("/".equals(path)) {
                send(output, 302, "text/plain", new byte[0], "Location: /tv\r\n");
                return;
            }
            // Android's HttpURLConnection rejects PATCH. Return a clear 405
            // instead of quietly changing the upstream request's semantics.
            if (!"GET".equals(req.method) && !"POST".equals(req.method)
                    && !"HEAD".equals(req.method) && !"PUT".equals(req.method)
                    && !"DELETE".equals(req.method)) {
                sendText(output, 405, "Unsupported method");
                return;
            }
            boolean cors = path.startsWith("/cors-bypass/");
            URL upstream;
            if (cors) {
                String encoded = req.target.substring("/cors-bypass/".length());
                // Signed googlevideo queries can contain literal '+'. A form
                // URLDecoder would silently convert it to a space, breaking
                // signatures and returning 403 for otherwise playable video.
                if (!encoded.startsWith("https://") && !encoded.startsWith("http://")) {
                    encoded = URLDecoder.decode(encoded.replace("+", "%2B"), "UTF-8");
                }
                if (!encoded.contains("://")) encoded = "https://" + encoded;
                URI destination = new URI(encoded);
                if (!allowedCors(destination)) {
                    sendText(output, 403, "Blocked CORS proxy target");
                    return;
                }
                upstream = destination.toURL();
            } else {
                upstream = new URL("https://www.youtube.com" + req.target);
            }
            if (!cors && path.startsWith("/tv") && !path.startsWith("/tv_config")) {
                // First install is automatic like WGT, bounded to four seconds.
                bundles.waitForFirstCheck();
            }
            proxy(req, upstream, output, cors, path);
        } catch (Exception e) {
            Log.e(TAG, "Proxy request error", e);
            try {
                if (!socket.isClosed()) sendText(socket.getOutputStream(), 502, "AxoTube proxy error");
            } catch (Exception ignored) { }
        }
    }

    private static boolean allowedCors(URI uri) {
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getRawUserInfo() != null
                || host == null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (CORS_HOSTS.contains(host)) return true;
        return host.endsWith(".googlevideo.com") || host.equals("googlevideo.com");
    }

    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] buf = new byte[32768];
        int n;
        while ((n = input.read(buf)) != -1) output.write(buf, 0, n);
    }

    private static String replace(String original, String regex, String replacement) {
        return Pattern.compile(regex).matcher(original).replaceAll(replacement);
    }

    // Maintain the WGT's YouTube TV URL patches for video, images, and telemetry.
    private static String rewriteTrustedText(String text) {
        String proxy = ORIGIN + "/cors-bypass/";
        // YouTube also embeds video URLs as JSON-escaped strings. Match both
        // escaped variants before plain URLs, preserving the original slashes.
        for (String slash : Arrays.asList("\\/", "\\\\/")) {
            String escaped = "https:" + slash + slash;
            String prefix = "http:" + slash + slash + "localhost:" + PORT
                    + slash + "cors-bypass" + slash + escaped;
            String pattern = Pattern.quote(escaped) + "([a-zA-Z0-9.-]+)"
                    + Pattern.quote(".googlevideo.com");
            text = replace(text, pattern, Matcher.quoteReplacement(prefix) + "$1.googlevideo.com");
        }
        text = replace(text, "https://([a-zA-Z0-9.-]+)\\.googlevideo\\.com",
                Matcher.quoteReplacement(proxy + "https://") + "$1.googlevideo.com");
        // Bare redirector hostnames are occasionally used in player config.
        // Exclude an existing URL to avoid double-prefixed proxy addresses.
        text = replace(text, "(?<![/.A-Za-z0-9])redirector\\.googlevideo\\.com",
                Matcher.quoteReplacement(proxy + "https://redirector.googlevideo.com"));
        text = text.replace("\"//www.gstatic.com", "\"" + proxy + "https://www.gstatic.com");
        text = text.replace("(//www.gstatic.com", "(" + proxy + "https://www.gstatic.com");
        for (String host : Arrays.asList("www.gstatic.com", "yt3.ggpht.com",
                "clients1.google.com", "s.youtube.com", "jnn-pa.googleapis.com",
                "yt3.googleusercontent.com")) {
            text = text.replace("https://" + host, proxy + "https://" + host);
        }
        text = text.replace("http://www.gstatic.com", proxy + "https://www.gstatic.com")
                .replace("http://clients1.google.com", proxy + "https://clients1.google.com")
                .replace("\"//clients1.google.com", "\"" + proxy + "https://clients1.google.com")
                .replace("\"//yt3.googleusercontent.com", "\"" + proxy + "https://yt3.googleusercontent.com");
        text = text.replace("Set([\"www.youtube.com\",\"accounts.google.com\"]);",
                "Set([\"www.youtube.com\", \"accounts.google.com\", \"localhost\"]);");
        text = text.replace(":document.location.toString()",
                ":document.location.toString().replace(\"" + ORIGIN + "\", \"https://www.youtube.com\")");
        text = replace(text, "euri:[^,]+,",
                Matcher.quoteReplacement("euri:document.location.toString().replace(\"" + ORIGIN
                        + "\", \"https://www.youtube.com\"),"));
        text = text.replace("this.scheme=\"https\"", "this.scheme=\"http\"")
                .replace("=window.location.href;", "=window.location.href.replace(\"" + ORIGIN
                        + "\", \"https://www.youtube.com\");")
                .replace("=document.location.href", "=document.location.href.replace(\"" + ORIGIN
                        + "\", \"https://www.youtube.com\")");
        return text;
    }

    private void proxy(Request req, URL upstream, OutputStream output, boolean cors, String path) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) upstream.openConnection();
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(20000);
        conn.setInstanceFollowRedirects(false);
        conn.setRequestMethod(req.method);
        conn.setRequestProperty("Accept-Encoding", "identity");
        conn.setRequestProperty("Host", upstream.getHost());
        conn.setRequestProperty("Origin", "https://www.youtube.com");
        for (Map.Entry<String, String> entry : req.headers.entrySet()) {
            String key = entry.getKey();
            if (DROP_REQUEST.contains(key) || (cors && Arrays.asList("cookie", "authorization",
                    "proxy-authorization", "x-axotube-token").contains(key))) continue;
            String value = entry.getValue();
            if ("cookie".equals(key)) {
                value = value.replace("__LocalSecure-", "__Secure-").replace("__LocalHost-", "__Host-");
            } else if ("referer".equals(key)) {
                value = "https://www.youtube.com/tv";
            } else if ("origin".equals(key)) {
                continue;
            }
            conn.setRequestProperty(key, value);
        }
        if (req.body.length > 0 && !"GET".equals(req.method) && !"HEAD".equals(req.method)) {
            conn.setDoOutput(true);
            conn.setFixedLengthStreamingMode(req.body.length);
            try (OutputStream request = conn.getOutputStream()) { request.write(req.body); }
        }
        try {
            int code = conn.getResponseCode();
            String contentType = conn.getContentType() == null ? "" : conn.getContentType().toLowerCase(Locale.ROOT);
            boolean textLike = contentType.contains("text/html") || contentType.contains("application/json")
                    || contentType.contains("javascript") || contentType.contains("text/css");
            Map<String, List<String>> headers = new HashMap<>(conn.getHeaderFields());
            Map<String, List<String>> rewritten = new HashMap<>();
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                if (entry.getKey() == null) continue;
                if ("set-cookie".equalsIgnoreCase(entry.getKey())) {
                    if (cors) continue;
                    java.util.ArrayList<String> cookies = new java.util.ArrayList<>();
                    for (String value : entry.getValue()) {
                        cookies.add(value.replaceAll("(?i)^__Secure-", "__LocalSecure-")
                                .replaceAll("(?i)^__Host-", "__LocalHost-")
                                .replaceAll("(?i)Domain=[^;]+", "Domain=localhost")
                                .replaceAll("(?i);\\s*Secure", "")
                                .replaceAll("(?i);\\s*SameSite=None", ""));
                    }
                    rewritten.put("Set-Cookie", cookies);
                } else if ("location".equalsIgnoreCase(entry.getKey()) && !cors) {
                    java.util.ArrayList<String> locations = new java.util.ArrayList<>();
                    for (String location : entry.getValue()) {
                        locations.add(location.replace("https://www.youtube.com/", ORIGIN + "/"));
                    }
                    rewritten.put("Location", locations);
                } else {
                    rewritten.put(entry.getKey(), entry.getValue());
                }
            }
            if (contentType.contains("text/") && !rewritten.containsKey("Content-Type")) {
                rewritten.put("Content-Type", Arrays.asList(contentType));
            }
            boolean hasBody = !"HEAD".equals(req.method) && code != 204 && code != 304;
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (textLike && hasBody && stream != null) {
                // A bounded text response avoids buffering video/media segments.
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[16384];
                int n;
                while ((n = stream.read(chunk)) != -1) {
                    if (buffer.size() + n > BODY_LIMIT) throw new IOException("Upstream text response too large");
                    buffer.write(chunk, 0, n);
                }
                String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
                if (!cors && path.startsWith("/tv") && !path.startsWith("/tv_config")) {
                    String version = bundles.activeVersion();
                    String early = "<script src=\"" + ORIGIN + "/axotube/early.js?v=" + version + "\"></script>";
                    Matcher head = Pattern.compile("<head(\\s[^>]*)?>", Pattern.CASE_INSENSITIVE).matcher(text);
                    text = head.find() ? head.replaceFirst(Matcher.quoteReplacement(head.group() + early)) : early + text;
                    text += "<script src=\"" + ORIGIN + "/axotube/userScript.js?v=" + version + "\"></script>";
                }
                byte[] encoded = rewriteTrustedText(text).getBytes(StandardCharsets.UTF_8);
                startResponse(output, code, rewritten, true, true, encoded.length);
                output.write(encoded);
            } else {
                startResponse(output, code, rewritten, true, hasBody, -1);
                if (hasBody && stream != null) copy(stream, output);
            }
            output.flush();
        } finally {
            conn.disconnect();
        }
    }
}
