package org.axotube.tv;

import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;

/** Runs the Android control server on loopback and checks it against the Node behaviour. */
public final class ControlServerTest {
    private static int failures;
    private static int checks;

    public static void main(String[] args) throws Exception {
        String schemaPath = args[0];
        File storeFile = new File(args[1]);
        if (storeFile.exists()) storeFile.delete();

        Map<String, Object> schema = castMap(Json.parse(readText(schemaPath)));
        ConfigStore store = new ConfigStore(storeFile, schema);
        ControlServer server = new ControlServer("127.0.0.1", 0, store, "<html><body>page</body></html>");
        server.start();
        int port = server.port();

        // Pairing
        Resp code = call(port, "GET", "/api/pairing-code", null, null);
        check("pairing code is 200", code.status == 200);
        String pin = Json.parse(code.body) instanceof Map ? (String) ((Map<?, ?>) Json.parse(code.body)).get("code") : "";
        check("pairing code is 6 digits", pin.matches("[0-9]{6}"));

        check("wrong pairing code is 403", call(port, "POST", "/api/pair", "{\"code\":\"999999\"}", null).status == 403
                || pin.equals("999999"));
        Resp pair = call(port, "POST", "/api/pair", "{\"code\":\"" + pin + "\"}", null);
        check("right pairing code is 200 with a token", pair.status == 200 && token(pair.body).length() == 64);

        // Config
        Resp get = call(port, "GET", "/api/config", null, null);
        check("GET /api/config starts at revision 0", get.status == 200 && get.body.contains("\"revision\":0"));

        Resp save = call(port, "POST", "/api/config",
                "{\"config\":{\"hideWatchedVideosThreshold\":50},\"revision\":0}", null);
        check("valid envelope saves and bumps revision", save.status == 200
                && save.body.contains("\"changed\":true") && save.body.contains("\"revision\":1"));
        check("same revision again is 409 (stale)", call(port, "POST", "/api/config",
                "{\"config\":{\"hideWatchedVideosThreshold\":60},\"revision\":0}", null).status == 409);
        check("unknown key is 400", call(port, "POST", "/api/config",
                "{\"config\":{\"notARealKey\":1},\"revision\":1}", null).status == 400);
        check("enum violation is 400", call(port, "POST", "/api/config",
                "{\"config\":{\"preferredVideoQuality\":\"bogus\"},\"revision\":1}", null).status == 400);
        check("range violation is 400", call(port, "POST", "/api/config",
                "{\"config\":{\"hideWatchedVideosThreshold\":500},\"revision\":1}", null).status == 400);
        check("wrong type is 400", call(port, "POST", "/api/config",
                "{\"config\":{\"enableShorts\":\"yes\"},\"revision\":1}", null).status == 400);
        check("bad revision is 400", call(port, "POST", "/api/config",
                "{\"config\":{},\"revision\":-1}", null).status == 400);

        // Commands
        Resp queued = call(port, "POST", "/api/command", "{\"action\":\"play\",\"videoId\":\" abc \"}", null);
        check("play command is queued", queued.status == 200 && queued.body.contains("\"id\":1"));
        check("queued command is returned", call(port, "GET", "/api/command", null, null).body.contains("\"videoId\":\"abc\""));
        check("unsupported command is 400", call(port, "POST", "/api/command", "{\"action\":\"explode\"}", null).status == 400);
        check("ack of pending command is 200", call(port, "POST", "/api/command/ack", "{\"id\":1}", null).status == 200);
        check("second ack is 409", call(port, "POST", "/api/command/ack", "{\"id\":1}", null).status == 409);
        check("empty queue reports null", call(port, "GET", "/api/command", null, null).body.contains("\"command\":null"));

        // Now playing
        call(port, "POST", "/api/nowplaying", "{\"title\":\"Song\"}", null);
        check("now playing round-trips", call(port, "GET", "/api/nowplaying", null, null).body.contains("\"title\":\"Song\""));

        // Cast restart is not supported on Android
        Resp cast = call(port, "POST", "/api/cast/restart", "{\"reason\":\"manual\"}", null);
        check("cast restart reports unsupported", cast.status == 200 && cast.body.contains("\"restarted\":false")
                && cast.body.contains("\"reason\":\"unsupported\""));

        // Page and unknown routes
        Resp page = call(port, "GET", "/", null, null);
        check("GET / serves the phone page", page.status == 200 && page.body.contains("<body>page</body>"));
        check("unknown route is 404", call(port, "GET", "/nope", null, null).status == 404);

        // Helpers
        check("127.0.0.1 is loopback", ControlServer.isLoopbackAddress("127.0.0.1"));
        check("LAN address is not loopback", !ControlServer.isLoopbackAddress("192.168.1.5"));
        check("JSON keeps null distinct from missing",
                Json.write(Json.parse("{\"a\":null,\"b\":[1,2.5,\"x\"]}")).equals("{\"a\":null,\"b\":[1,2.5,\"x\"]}"));

        server.stop();

        // Persistence across a restart
        ConfigStore reopened = new ConfigStore(storeFile, schema);
        check("store keeps revision across restarts", reopened.revision() == 1);
        check("store keeps config across restarts", Json.write(reopened.config()).contains("hideWatchedVideosThreshold"));

        System.out.println(checks + " checks, " + failures + " failed");
        if (failures > 0) System.exit(1);
    }

    private static void check(String name, boolean ok) {
        checks++;
        if (!ok) {
            failures++;
            System.out.println("FAIL: " + name);
        }
    }

    private static String token(String body) throws Exception {
        Object v = Json.parse(body);
        return v instanceof Map ? String.valueOf(((Map<?, ?>) v).get("token")) : "";
    }

    private static final class Resp {
        final int status;
        final String body;
        Resp(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private static Resp call(int port, String method, String path, String body, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(5000);
        c.setReadTimeout(5000);
        if (body != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            OutputStream out = c.getOutputStream();
            out.write(body.getBytes(StandardCharsets.UTF_8));
            out.close();
        }
        int status = c.getResponseCode();
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        String text = "";
        if (in != null) {
            java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) >= 0) bytes.write(buf, 0, n);
            in.close();
            text = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
        c.disconnect();
        return new Resp(status, text);
    }

    private static String readText(String path) throws Exception {
        return new String(Files.readAllBytes(new File(path).toPath()), StandardCharsets.UTF_8);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object v) {
        return (Map<String, Object>) v;
    }
}
