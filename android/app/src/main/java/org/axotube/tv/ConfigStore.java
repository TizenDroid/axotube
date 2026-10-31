package org.axotube.tv;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Android port of the config part of service/service.js.
 * Validation mirrors shared/configPolicy.js and uses the same config-schema.json,
 * so a value the TV browser accepts is accepted here too.
 */
final class ConfigStore {
    private static final int MAX_STORE_BYTES = 256 * 1024;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final File file;
    private final Map<String, Object> defaults;
    private final Map<String, Object> enums;
    private final Map<String, Object> ranges;

    private Map<String, Object> config = new LinkedHashMap<String, Object>();
    private long revision;
    private String authToken;
    private String pairingCode;
    private boolean persisted;

    /** Result of a config write. */
    static final class Commit {
        final boolean ok;
        final boolean changed;
        Commit(boolean ok, boolean changed) {
            this.ok = ok;
            this.changed = changed;
        }
    }

    ConfigStore(File file, Map<String, Object> schema) {
        this.file = file;
        this.defaults = asMap(schema.get("defaults"));
        this.enums = asMap(schema.get("enums"));
        this.ranges = asMap(schema.get("ranges"));
        load();
        this.pairingCode = newPairingCode();
        this.persisted = save(config, revision);
    }

    synchronized Map<String, Object> config() {
        return config;
    }

    synchronized long revision() {
        return revision;
    }

    synchronized String authToken() {
        return authToken;
    }

    synchronized String pairingCode() {
        return pairingCode;
    }

    /** Returns the cleaned config, or null when any key or value is not allowed. */
    Map<String, Object> sanitize(Object value) {
        if (!(value instanceof Map)) return null;
        Map<?, ?> source = (Map<?, ?>) value;
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        for (Object key : source.keySet()) {
            String name = String.valueOf(key);
            Object candidate = source.get(key);
            if (!validate(name, candidate)) return null;
            out.put(name, candidate);
        }
        return out;
    }

    /** Persists the next complete state before publishing its new revision. */
    synchronized Commit commit(Map<String, Object> clean) {
        boolean changed = !Json.canonical(config).equals(Json.canonical(clean));
        if (!changed && persisted) return new Commit(true, false);
        long next = changed ? revision + 1 : revision;
        if (!save(clean, next)) return new Commit(false, false);
        config = clean;
        revision = next;
        persisted = true;
        return new Commit(true, changed);
    }

    /** Validation rules copied from shared/configPolicy.js. */
    boolean validate(String key, Object value) {
        if (!defaults.containsKey(key)) return false;
        Object expected = defaults.get(key);
        if (expected == Json.NULL || expected == null) {
            return value == Json.NULL || value == null || value instanceof String;
        }
        if (expected instanceof List) {
            if (!(value instanceof List)) return false;
            for (Object item : (List<?>) value) {
                if (!(item instanceof String)) return false;
            }
            return true;
        }
        if (expected instanceof Number) {
            if (!(value instanceof Number)) return false;
            double d = ((Number) value).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) return false;
            Object range = ranges.get(key);
            if (range instanceof List && ((List<?>) range).size() == 2) {
                double low = ((Number) ((List<?>) range).get(0)).doubleValue();
                double high = ((Number) ((List<?>) range).get(1)).doubleValue();
                return d >= low && d <= high;
            }
            return true;
        }
        if (expected instanceof Boolean) {
            if (!(value instanceof Boolean)) return false;
        } else if (expected instanceof String) {
            if (!(value instanceof String)) return false;
        } else {
            return false;
        }
        Object allowed = enums.get(key);
        if (allowed instanceof List && !((List<?>) allowed).contains(value)) return false;
        if ("routeColor".equals(key) && !((String) value).matches("#[0-9a-fA-F]{6}")) return false;
        if ("routeBackgroundUrl".equals(key) && !((String) value).isEmpty()) {
            try {
                String scheme = new URI((String) value).getScheme();
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return false;
            } catch (Exception e) {
                return false;
            }
        }
        return true;
    }

    private void load() {
        try {
            if (file.isFile() && file.length() <= MAX_STORE_BYTES) {
                Object parsed = Json.parse(readAll(file));
                if (parsed instanceof Map) {
                    Map<?, ?> root = (Map<?, ?>) parsed;
                    config = migrate(root.get("config"));
                    Object rev = root.get("revision");
                    if (rev instanceof Number && isSafeInteger(((Number) rev).doubleValue())) {
                        revision = ((Number) rev).longValue();
                    }
                    Object token = root.get("authToken");
                    if (token instanceof String && ((String) token).length() >= 32) {
                        authToken = (String) token;
                    }
                }
            }
        } catch (IOException ignored) {
            // A damaged store is replaced below, as the Node service does.
        }
        if (authToken == null) authToken = newToken();
    }

    private Map<String, Object> migrate(Object value) {
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        if (!(value instanceof Map)) return out;
        Map<?, ?> source = (Map<?, ?>) value;
        for (Object key : source.keySet()) {
            String name = String.valueOf(key);
            Object candidate = source.get(key);
            if ("launchToOnStartup".equals(name) && candidate instanceof Map) {
                candidate = Json.write(candidate);
            }
            if (validate(name, candidate)) out.put(name, candidate);
        }
        return out;
    }

    private boolean save(Map<String, Object> state, long rev) {
        Map<String, Object> root = new LinkedHashMap<String, Object>();
        root.put("config", state);
        root.put("revision", Long.valueOf(rev));
        root.put("authToken", authToken);
        File tmp = new File(file.getPath() + ".tmp");
        try {
            FileOutputStream out = new FileOutputStream(tmp);
            try {
                out.write(Json.write(root).getBytes("UTF-8"));
                out.getFD().sync();
            } finally {
                out.close();
            }
            // rename replaces the old file atomically on Linux and Android.
            return tmp.renameTo(file);
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
    }

    private static String readAll(File file) throws IOException {
        FileInputStream in = new FileInputStream(file);
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) >= 0) bytes.write(buf, 0, n);
            return new String(bytes.toByteArray(), "UTF-8");
        } finally {
            in.close();
        }
    }

    private static boolean isSafeInteger(double d) {
        return d == Math.rint(d) && d >= 0 && d <= 9007199254740991.0;
    }

    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? castMap(value) : new LinkedHashMap<String, Object>();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        return (Map<String, Object>) value;
    }

    static String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }

    static String newPairingCode() {
        return String.format("%06d", RANDOM.nextInt(1000000));
    }
}
