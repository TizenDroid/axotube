package org.axotube.tv;

import android.content.Context;
import android.util.Log;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** Same update protocol as WGT, with a published jsDelivr GitHub CDN fallback. */
final class BundleStore {
    private static final String TAG = "AxoTubeBundles";
    private static final String NPM_CDN = "https://cdn.jsdelivr.net/npm/axotube";
    private static final String GH_CDN = "https://cdn.jsdelivr.net/gh/TizenDroid/axotube@";
    private static final String GH_COMMIT_API = "https://api.github.com/repos/TizenDroid/axotube/commits/main";
    private static final String[] FILES = { "early.js", "userScript.js" };
    private static final int MIN_SIZE = 1000;
    private static final int MAX_SIZE = 5 * 1024 * 1024;
    private final Context context;
    private final File cacheRoot;
    private final String packagedVersion;
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private final CountDownLatch initialCheck = new CountDownLatch(1);
    private final Object lock = new Object();
    private final Object updateLock = new Object();
    private String latest;
    private String error;

    BundleStore(Context context) throws Exception {
        this.context = context.getApplicationContext();
        this.cacheRoot = new File(context.getFilesDir(), "bundle-cache");
        if (!cacheRoot.exists() && !cacheRoot.mkdirs()) throw new Exception("Cannot create bundle cache");
        JSONObject packaged = new JSONObject(new String(readAsset("version.json"), StandardCharsets.UTF_8));
        packagedVersion = packaged.getString("version");
        if (!validVersion(packagedVersion)) throw new Exception("Bad packaged bundle version");
    }

    void start() {
        executor.execute(() -> {
            try {
                check(false);
            } finally {
                initialCheck.countDown();
            }
        });
        executor.scheduleWithFixedDelay(() -> check(false), 6, 6, TimeUnit.HOURS);
    }

    void waitForFirstCheck() {
        try {
            initialCheck.await(4, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    void apply() {
        // Called on an HTTP worker, never on the UI thread.
        check(true);
    }

    static int compareVersions(String a, String b) {
        String[] aa = a.split("[.-]");
        String[] bb = b.split("[.-]");
        for (int i = 0; i < 3; i++) {
            int x = i < aa.length ? Integer.parseInt(aa[i]) : 0;
            int y = i < bb.length ? Integer.parseInt(bb[i]) : 0;
            if (x != y) return x < y ? -1 : 1;
        }
        return 0;
    }

    private static boolean validVersion(String value) {
        return value != null && value.matches("[0-9]+\\.[0-9]+\\.[0-9]+");
    }

    private byte[] readAsset(String name) throws Exception {
        try (InputStream stream = context.getAssets().open("bundles/" + name)) {
            return readUpTo(stream, MAX_SIZE + 1);
        }
    }

    private static byte[] readUpTo(InputStream input, int max) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = input.read(buf)) >= 0) {
            if (bytes.size() + n > max) throw new Exception("Bundle download exceeds size limit");
            bytes.write(buf, 0, n);
        }
        return bytes.toByteArray();
    }

    private static boolean validBundle(byte[] value) {
        if (value == null || value.length < MIN_SIZE || value.length > MAX_SIZE) return false;
        return new String(value, StandardCharsets.UTF_8).contains("AxoTube");
    }

    private static void writeSafely(File path, byte[] bytes) throws Exception {
        try (FileOutputStream output = new FileOutputStream(path)) {
            output.write(bytes);
            output.getFD().sync();
        }
    }

    private static String readFile(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file)) {
            return new String(readUpTo(input, 256 * 1024), StandardCharsets.UTF_8);
        }
    }

    private static byte[] readFileBytes(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file)) {
            return readUpTo(input, MAX_SIZE + 1);
        }
    }

    // Read-only immutable cache directories: both scripts stay pinned to one version.
    private File cacheVersionDir(String version) {
        if (!validVersion(version)) return null;
        File[] candidates = cacheRoot.listFiles(file -> file.isDirectory()
                && file.getName().startsWith("bundle-" + version + "-"));
        if (candidates == null) return null;
        for (File candidate : candidates) {
            if (validateDirectory(candidate)) return candidate;
        }
        return null;
    }

    private boolean validateDirectory(File dir) {
        try {
            for (String name : FILES) {
                if (!validBundle(readFileBytes(new File(dir, name)))) return false;
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private String cachedVersion() {
        try {
            JSONObject pointer = new JSONObject(readFile(new File(cacheRoot, "active.json")));
            String version = pointer.getString("version");
            String directory = pointer.getString("directory");
            if (!validVersion(version) || !directory.matches("bundle-[0-9.]+-[a-zA-Z0-9-]+")
                    || !directory.startsWith("bundle-" + version + "-")) return null;
            File dir = new File(cacheRoot, directory);
            return validateDirectory(dir) ? version : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    String activeVersion() {
        synchronized (lock) {
            String cached = cachedVersion();
            return cached != null && compareVersions(cached, packagedVersion) > 0
                    ? cached : packagedVersion;
        }
    }

    byte[] script(String name, String requestedVersion) throws Exception {
        if (!"early.js".equals(name) && !"userScript.js".equals(name)) throw new Exception("Bad script");
        synchronized (lock) {
            String version = requestedVersion != null && validVersion(requestedVersion)
                    ? requestedVersion : activeVersion();
            if (compareVersions(version, packagedVersion) > 0) {
                File dir = cacheVersionDir(version);
                if (dir != null) return readFileBytes(new File(dir, name));
            }
            // A stale page may request a no-longer-present cache version.
            // In that case use the shipped fallback, never unvalidated files.
            return readAsset(name);
        }
    }

    JSONObject status() {
        synchronized (lock) {
            String current = activeVersion();
            JSONObject response = new JSONObject();
            try {
                response.put("current", current);
                response.put("latest", latest == null ? JSONObject.NULL : latest);
                response.put("available", latest != null && compareVersions(latest, current) > 0);
                response.put("error", error == null ? JSONObject.NULL : error);
            } catch (Exception ignored) { }
            return response;
        }
    }

    private static byte[] download(String url, int sizeLimit) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("User-Agent", "AxoTube-Android/1.0");
        try {
            if (connection.getResponseCode() != 200) throw new Exception("HTTP " + connection.getResponseCode() + " for " + url);
            try (InputStream input = connection.getInputStream()) {
                return readUpTo(input, sizeLimit);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static final class Channel {
        final String version;
        final String distBase;
        Channel(String version, String distBase) {
            this.version = version;
            this.distBase = distBase;
        }
    }

    private static Channel resolveLatest() throws Exception {
        Exception githubFailure = null;
        try {
            // Pin package.json + both scripts to one immutable commit. GitHub's
            // branch may advance during the three separate HTTP requests.
            String ref = "main";
            try {
                byte[] response = download(GH_COMMIT_API, 128 * 1024);
                String sha = new JSONObject(new String(response, StandardCharsets.UTF_8)).getString("sha");
                if (sha.matches("[0-9a-fA-F]{40}")) ref = sha;
            } catch (Exception ignored) {
                Log.w(TAG, "Commit lookup failed; using jsDelivr @main");
            }
            String root = GH_CDN + ref;
            byte[] manifest = download(root + "/package.json", 128 * 1024);
            String version = new JSONObject(new String(manifest, StandardCharsets.UTF_8)).getString("version");
            if (!validVersion(version)) throw new Exception("GitHub CDN package version invalid");
            return new Channel(version, root + "/dist/");
        } catch (Exception exception) {
            githubFailure = exception;
        }
        // Preserve the WGT npm channel in case the axotube npm package is published.
        try {
            byte[] manifest = download(NPM_CDN + "@latest/package.json", 128 * 1024);
            String version = new JSONObject(new String(manifest, StandardCharsets.UTF_8)).getString("version");
            if (!validVersion(version)) throw new Exception("npm CDN package version invalid");
            return new Channel(version, NPM_CDN + "@" + version + "/dist/");
        } catch (Exception exception) {
            throw new Exception("jsDelivr GitHub: " + githubFailure.getMessage()
                    + "; npm: " + exception.getMessage());
        }
    }

    void check(boolean applyNow) {
        synchronized (updateLock) {
            try {
                Channel channel = resolveLatest();
                String remote = channel.version;
                synchronized (lock) { latest = remote; }
                String current = activeVersion();
                if (compareVersions(remote, current) <= 0) {
                    synchronized (lock) { error = null; }
                    return;
                }
                if (!applyNow && cachedVersion() != null) {
                    synchronized (lock) { error = null; }
                    return;
                }
                byte[][] scripts = new byte[FILES.length][];
                for (int i = 0; i < FILES.length; i++) {
                    scripts[i] = download(channel.distBase + FILES[i], MAX_SIZE + 1);
                    if (!validBundle(scripts[i])) throw new Exception(FILES[i] + " failed validation");
                }
                String directory = "bundle-" + remote + "-" + UUID.randomUUID();
                File dir = new File(cacheRoot, directory);
                if (!dir.mkdir()) throw new Exception("Failed to create new bundle directory");
                for (int i = 0; i < FILES.length; i++) writeSafely(new File(dir, FILES[i]), scripts[i]);
                if (!validateDirectory(dir)) throw new Exception("Bundle failed disk validation");
                JSONObject pointer = new JSONObject().put("version", remote).put("directory", directory);
                File temp = new File(cacheRoot, "active-" + UUID.randomUUID() + ".tmp");
                writeSafely(temp, pointer.toString().getBytes(StandardCharsets.UTF_8));
                synchronized (lock) {
                    if (!temp.renameTo(new File(cacheRoot, "active.json"))) {
                        throw new Exception("Failed to atomically activate bundle");
                    }
                    error = null;
                }
                Log.i(TAG, "Bundle updated to " + remote);
            } catch (Exception e) {
                synchronized (lock) {
                    error = e.getMessage() == null ? e.toString() : e.getMessage();
                }
                Log.w(TAG, "Bundle update check failed: " + error);
            }
        }
    }
}
