package org.axotube.tv;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Android port of the 8085 control server in service/service.js: pairing,
 * settings sync, phone commands, now-playing, and the phone web page.
 *
 * Not ported: DIAL casting (SSDP discovery and /dial). The Android app cannot
 * advertise itself to phones yet, so cast restart reports "unsupported" and does
 * not pretend to work.
 */
final class ControlServer {
    static final int DEFAULT_PORT = 8085;
    private static final int MAX_BODY = 64 * 1024;
    private static final int MAX_HEADERS = 32 * 1024;
    private static final int MAX_COMMAND_QUEUE = 50;
    private static final int PAIR_ATTEMPTS = 10;
    private static final long PAIR_WINDOW_MS = 60 * 1000L;
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private final ConfigStore store;
    private final String webPage;
    private final ServerSocket listener;
    private final ExecutorService workers = Executors.newFixedThreadPool(4);
    private final Map<String, long[]> pairAttempts = new HashMap<String, long[]>();
    private final List<Map<String, Object>> commandQueue = new ArrayList<Map<String, Object>>();
    private long nextCommandId = 1;
    private Object nowPlaying = Json.NULL;

    /** A parsed request. */
    private static final class Request {
        String method;
        String path;
        String remote;
        Map<String, String> headers = new HashMap<String, String>();
        String body = "";
    }

    /** A response to write. */
    private static final class Reply {
        final int status;
        final String body;
        final boolean html;
        Reply(int status, String body, boolean html) {
            this.status = status;
            this.body = body;
            this.html = html;
        }
    }

    /**
     * @param bindAddress "0.0.0.0" so phones on the LAN can reach the pairing page,
     *                    or "127.0.0.1" for tests.
     * @param port        8085 in the app; 0 lets tests pick a free port.
     */
    ControlServer(String bindAddress, int port, ConfigStore store, String webPage) throws IOException {
        this.store = store;
        this.webPage = webPage;
        this.listener = new ServerSocket(port, 32, InetAddress.getByName(bindAddress));
    }

    int port() {
        return listener.getLocalPort();
    }

    void start() {
        Thread acceptor = new Thread(new Runnable() {
            @Override public void run() {
                while (!listener.isClosed()) {
                    try {
                        final Socket client = listener.accept();
                        client.setSoTimeout(15000);
                        workers.execute(new Runnable() {
                            @Override public void run() {
                                serve(client);
                            }
                        });
                    } catch (IOException e) {
                        if (!listener.isClosed()) System.err.println("AxoTube control accept: " + e);
                    }
                }
            }
        }, "axotube-control-accept");
        acceptor.setDaemon(true);
        acceptor.start();
    }

    void stop() {
        try {
            listener.close();
        } catch (IOException ignored) {
        }
        workers.shutdownNow();
    }

    /** Loopback check, the same rule as isLoopback() in service/service.js. */
    static boolean isLoopbackAddress(String address) {
        String a = address == null ? "" : address.toLowerCase(Locale.ROOT);
        return a.equals("127.0.0.1") || a.equals("::1") || a.equals("::ffff:127.0.0.1")
                || a.equals("/127.0.0.1") || a.equals("0:0:0:0:0:0:0:1");
    }

    private void serve(Socket socket) {
        try {
            Request request = read(socket);
            Reply reply;
            if (request == null) {
                reply = json(400, "{\"ok\":false,\"error\":\"Bad request\"}");
            } else {
                request.remote = socket.getInetAddress() == null ? "" : socket.getInetAddress().getHostAddress();
                reply = route(request);
            }
            write(socket.getOutputStream(), reply);
        } catch (Exception e) {
            try {
                write(socket.getOutputStream(), json(400, "{\"ok\":false,\"error\":\"Bad request\"}"));
            } catch (IOException ignored) {
            }
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {
            }
        }
    }

    private Reply route(Request req) throws IOException {
        if ("OPTIONS".equals(req.method)) return new Reply(204, "", false);
        String path = req.path;
        boolean loopback = isLoopbackAddress(req.remote);

        if ("/".equals(path) && "GET".equals(req.method)) {
            return new Reply(200, webPage, true);
        }
        if ("/api/pairing-code".equals(path) && "GET".equals(req.method)) {
            if (!loopback) return json(403, "{\"ok\":false,\"error\":\"Loopback only\"}");
            return json(200, Json.write(obj("ok", Boolean.TRUE, "code", store.pairingCode(),
                    "urls", new ArrayList<Object>())));
        }
        if ("/api/pair".equals(path) && "POST".equals(req.method)) {
            if (!allowPairAttempt(req.remote)) {
                return json(429, "{\"ok\":false,\"error\":\"Too many pairing attempts\"}");
            }
            Object body = parseBody(req);
            String code = bodyString(body, "code");
            if (code == null || code.trim().isEmpty() || !code.trim().equals(store.pairingCode())) {
                return json(403, "{\"ok\":false,\"error\":\"Invalid pairing code\"}");
            }
            pairAttempts.remove(req.remote);
            return json(200, Json.write(obj("ok", Boolean.TRUE, "token", store.authToken())));
        }

        if (path.startsWith("/api/") && !loopback && !tokenMatches(req)) {
            return json(401, "{\"ok\":false,\"error\":\"Pairing required\"}");
        }

        if ("/api/config".equals(path) && "GET".equals(req.method)) {
            return json(200, Json.write(obj("revision", Long.valueOf(store.revision()),
                    "config", store.config())));
        }
        if ("/api/config".equals(path) && "POST".equals(req.method)) {
            return saveConfig(parseBody(req), false);
        }
        if ("/api/config/push".equals(path) && "POST".equals(req.method)) {
            return saveConfig(parseBody(req), true);
        }
        if ("/api/command".equals(path) && "POST".equals(req.method)) {
            return enqueue(parseBody(req));
        }
        if ("/api/command".equals(path) && "GET".equals(req.method)) {
            synchronized (commandQueue) {
                if (commandQueue.isEmpty()) return json(200, "{\"id\":null,\"command\":null}");
                return json(200, Json.write(commandQueue.get(0)));
            }
        }
        if ("/api/command/ack".equals(path) && "POST".equals(req.method)) {
            return ack(parseBody(req));
        }
        if ("/api/nowplaying".equals(path) && "POST".equals(req.method)) {
            Object body = parseBody(req);
            synchronized (this) {
                nowPlaying = body instanceof Map ? body : Json.NULL;
            }
            return json(200, "{\"ok\":true}");
        }
        if ("/api/nowplaying".equals(path) && "GET".equals(req.method)) {
            synchronized (this) {
                return json(200, Json.write(obj("nowPlaying", nowPlaying)));
            }
        }
        if ("/api/cast/restart".equals(path) && "POST".equals(req.method)) {
            if (!loopback) return json(403, "{\"ok\":false,\"error\":\"Loopback only\"}");
            return json(200, "{\"ok\":true,\"restarted\":false,\"reason\":\"unsupported\"}");
        }
        return json(404, "{\"ok\":false,\"error\":\"Not found\"}");
    }

    private Reply saveConfig(Object body, boolean push) {
        Map<String, Object> clean;
        if (push) {
            Object rev = body instanceof Map ? ((Map<?, ?>) body).get("revision") : null;
            clean = store.sanitize(body instanceof Map ? ((Map<?, ?>) body).get("config") : null);
            if (clean == null) return json(400, "{\"ok\":false,\"error\":\"Invalid config push\"}");
            if (!(rev instanceof Number) || ((Number) rev).longValue() != store.revision()) {
                return json(409, Json.write(obj("ok", Boolean.FALSE, "applied", Boolean.FALSE,
                        "error", "Stale config revision", "revision", Long.valueOf(store.revision()))));
            }
        } else {
            boolean envelope = body instanceof Map && ((Map<?, ?>) body).containsKey("config");
            clean = store.sanitize(envelope ? ((Map<?, ?>) body).get("config") : body);
            if (clean == null) return json(400, "{\"ok\":false,\"error\":\"Invalid config payload\"}");
            if (envelope) {
                Object rev = ((Map<?, ?>) body).get("revision");
                if (!(rev instanceof Number) || !isNonNegativeInteger(((Number) rev).doubleValue())) {
                    return json(400, "{\"ok\":false,\"error\":\"Invalid config revision\"}");
                }
                if (((Number) rev).longValue() != store.revision()) {
                    return json(409, Json.write(obj("ok", Boolean.FALSE,
                            "error", "Settings changed on TV; reload before saving",
                            "revision", Long.valueOf(store.revision()))));
                }
            }
        }
        ConfigStore.Commit result = store.commit(clean);
        if (!result.ok) {
            return json(503, "{\"ok\":false,\"applied\":false,\"error\":\"Unable to save settings\"}");
        }
        return json(200, Json.write(obj("ok", Boolean.TRUE, "applied", Boolean.TRUE,
                "changed", Boolean.valueOf(result.changed),
                "revision", Long.valueOf(store.revision()))));
    }

    private Reply enqueue(Object body) {
        Map<String, Object> command = normalizeCommand(body);
        if (command == null) return json(400, "{\"ok\":false,\"error\":\"Unsupported command\"}");
        synchronized (commandQueue) {
            if (commandQueue.size() >= MAX_COMMAND_QUEUE) {
                return json(429, "{\"ok\":false,\"error\":\"Command queue full\"}");
            }
            Map<String, Object> queued = obj("id", Long.valueOf(nextCommandId++), "command", command);
            commandQueue.add(queued);
            return json(200, Json.write(obj("ok", Boolean.TRUE, "id", queued.get("id"),
                    "command", command)));
        }
    }

    private Reply ack(Object body) {
        Object raw = body instanceof Map ? ((Map<?, ?>) body).get("id") : null;
        if (!(raw instanceof Number)) return json(400, "{\"ok\":false,\"error\":\"Invalid command id\"}");
        long id = ((Number) raw).longValue();
        synchronized (commandQueue) {
            if (!commandQueue.isEmpty() && ((Number) commandQueue.get(0).get("id")).longValue() == id) {
                commandQueue.remove(0);
                return json(200, "{\"ok\":true}");
            }
        }
        return json(409, "{\"ok\":false,\"error\":\"Command is no longer pending\"}");
    }

    /** Same accepted shapes as normalizeCommand() in service/service.js. */
    static Map<String, Object> normalizeCommand(Object body) {
        if (!(body instanceof Map)) return null;
        Map<?, ?> m = (Map<?, ?>) body;
        Object action = m.get("action");
        if ("play".equals(action) && nonBlank(m.get("videoId"))) {
            Map<String, Object> out = obj("action", "play", "videoId", ((String) m.get("videoId")).trim());
            if (nonBlank(m.get("playlistId"))) out.put("playlistId", m.get("playlistId"));
            return out;
        }
        if ("search".equals(action) && nonBlank(m.get("query"))) {
            return obj("action", "search", "query", ((String) m.get("query")).trim());
        }
        if ("browse".equals(action) && nonBlank(m.get("browseId"))) {
            return obj("action", "browse", "browseId", ((String) m.get("browseId")).trim());
        }
        if ("reload".equals(action)) return obj("action", "reload");
        return null;
    }

    private boolean tokenMatches(Request req) {
        String auth = req.headers.get("authorization");
        String supplied = null;
        if (auth != null && auth.startsWith("Bearer ")) supplied = auth.substring(7).trim();
        if (supplied == null) {
            supplied = req.headers.get("x-axotube-token");
            supplied = supplied == null ? "" : supplied.trim();
        }
        String expected = store.authToken();
        return supplied.length() == expected.length() && constantTimeEquals(supplied, expected);
    }

    private static boolean constantTimeEquals(String a, String b) {
        int diff = 0;
        for (int i = 0; i < a.length(); i++) diff |= a.charAt(i) ^ b.charAt(i);
        return diff == 0;
    }

    private synchronized boolean allowPairAttempt(String remote) {
        long now = System.currentTimeMillis();
        long[] state = pairAttempts.get(remote);
        if (state == null || now - state[0] > PAIR_WINDOW_MS) {
            state = new long[] { now, 0 };
        }
        state[1]++;
        pairAttempts.put(remote, state);
        return state[1] <= PAIR_ATTEMPTS;
    }

    private Object parseBody(Request req) {
        if (req.body.isEmpty()) return Json.NULL;
        try {
            return Json.parse(req.body);
        } catch (IOException e) {
            return Json.NULL;
        }
    }

    private static String bodyString(Object body, String key) {
        if (!(body instanceof Map)) return null;
        Object value = ((Map<?, ?>) body).get(key);
        return value instanceof String ? (String) value : null;
    }

    private static boolean nonBlank(Object value) {
        return value instanceof String && !((String) value).trim().isEmpty();
    }

    private static boolean isNonNegativeInteger(double d) {
        return d == Math.rint(d) && d >= 0;
    }

    static Map<String, Object> obj(Object... pairs) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        for (int i = 0; i + 1 < pairs.length; i += 2) out.put((String) pairs[i], pairs[i + 1]);
        return out;
    }

    private static Reply json(int status, String body) {
        return new Reply(status, body, false);
    }

    private static Request read(Socket socket) throws IOException {
        InputStream in = new BufferedInputStream(socket.getInputStream());
        String first = line(in, 8192);
        if (first == null) return null;
        String[] parts = first.split(" ");
        if (parts.length < 2) return null;
        Request req = new Request();
        req.method = parts[0].toUpperCase(Locale.ROOT);
        String target = parts[1];
        int q = target.indexOf('?');
        req.path = q >= 0 ? target.substring(0, q) : target;
        int total = first.length();
        while (true) {
            String header = line(in, 8192);
            if (header == null || header.isEmpty()) break;
            total += header.length();
            if (total > MAX_HEADERS) throw new IOException("Headers too large");
            int colon = header.indexOf(':');
            if (colon > 0) {
                req.headers.put(header.substring(0, colon).trim().toLowerCase(Locale.ROOT),
                        header.substring(colon + 1).trim());
            }
        }
        String lengthText = req.headers.get("content-length");
        int length = 0;
        if (lengthText != null) {
            try {
                length = Integer.parseInt(lengthText);
            } catch (NumberFormatException e) {
                throw new IOException("Bad Content-Length");
            }
        }
        if (length < 0 || length > MAX_BODY) throw new IOException("Body too large");
        if (length > 0) {
            byte[] body = new byte[length];
            int off = 0;
            while (off < length) {
                int n = in.read(body, off, length - off);
                if (n < 0) throw new IOException("Unexpected end of body");
                off += n;
            }
            req.body = new String(body, UTF8);
        }
        return req;
    }

    private static String line(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (out.size() >= max) throw new IOException("Line too long");
            if (b != '\r') out.write(b);
        }
        if (b == -1 && out.size() == 0) return null;
        return new String(out.toByteArray(), "ISO-8859-1");
    }

    private static void write(OutputStream out, Reply reply) throws IOException {
        byte[] bytes = reply.body.getBytes(UTF8);
        String type = reply.html ? "text/html; charset=utf-8" : "application/json; charset=utf-8";
        StringBuilder head = new StringBuilder();
        head.append("HTTP/1.1 ").append(reply.status).append(' ').append(reason(reply.status)).append("\r\n");
        head.append("Content-Type: ").append(type).append("\r\n");
        head.append("Content-Length: ").append(bytes.length).append("\r\n");
        head.append("Cache-Control: no-store\r\n");
        head.append("Access-Control-Allow-Origin: *\r\n");
        head.append("Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE\r\n");
        head.append("Access-Control-Allow-Headers: Content-Type, Authorization, X-Axotube-Token\r\n");
        head.append("Connection: close\r\n\r\n");
        out.write(head.toString().getBytes(UTF8));
        out.write(bytes);
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 409: return "Conflict";
            case 429: return "Too Many Requests";
            case 503: return "Service Unavailable";
            default: return "Error";
        }
    }
}
