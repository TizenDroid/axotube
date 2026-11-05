package org.axotube.tv;

import android.app.Activity;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.util.Log;

/** Android TV WebView shell; local service lives only while this app is running. */
public final class MainActivity extends Activity {
    private static final String TAG = "AxoTube";
    // The 8090 control server (pairing, settings sync, phone commands) runs here
    // too. DIAL casting is still WGT-only: see ControlServer's header.
    private static final String URL = "http://localhost:8081/tv";
    private static final String TV_USER_AGENT =
            "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 "
                    + "(KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3";
    private LocalProxy server;
    private ControlServer control;
    private ConfigStore store;
    private WebView webview;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        startControlServer();
        try {
            BundleStore bundles = new BundleStore(this);
            server = new LocalProxy(bundles);
            server.start();
            // Same messages the WGT shows: a toast on the next page poll.
            bundles.setNotifier(text -> {
                if (control != null) control.queueToast(text);
            });
            bundles.start();
            if (control != null) control.queueToast("AxoTube service is running");
            startBrowser();
        } catch (Exception e) {
            Log.e(TAG, "Unable to start local AxoTube service", e);
            TextView message = new TextView(this);
            message.setText("AxoTube service failed to start.\n" + e.getMessage() + "\nRestart the app.");
            message.setTextSize(20);
            message.setTextColor(Color.WHITE);
            message.setBackgroundColor(Color.rgb(15, 15, 15));
            message.setPadding(36, 36, 36, 36);
            setContentView(message);
        }
    }

    /**
     * Starts the 8090 control server. A failure here is logged and does not stop
     * the proxy or the browser: the video page still works, only phone pairing and
     * settings sync are unavailable.
     */
    private void startControlServer() {
        try {
            Map<String, Object> schema = castMap(Json.parse(readAsset("bundles/config-schema.json")));
            store = new ConfigStore(new File(getFilesDir(), "axotube-config-store.json"), schema);
            String page = readAsset("bundles/webConfigPage.html");
            control = new ControlServer("0.0.0.0", ControlServer.DEFAULT_PORT, store, page);
            control.setOnConfigSaved(() -> applyUserAgentFromSave());
            control.start();
        } catch (Exception e) {
            Log.w(TAG, "Control server not started; phone settings sync is unavailable", e);
            control = null;
            store = null;
        }
    }

    /** The saved user agent profile, or "auto" when the config store is unavailable. */
    private String currentUserAgentProfile() {
        if (store == null) return "auto";
        Object value = store.config().get("userAgentProfile");
        return value instanceof String ? (String) value : "auto";
    }

    /**
     * Maps a profile to the agent string the WebView sends. "samsung" keeps the
     * Tizen TV string. "auto" and "android" use the WebView's own Android agent
     * with its "; wv" embedded-WebView marker removed. null resets to the default.
     */
    static String resolveUserAgent(String profile, String webViewDefault) {
        if ("samsung".equals(profile)) return TV_USER_AGENT;
        if (webViewDefault == null) return null;
        return webViewDefault.replace("; wv", "");
    }

    /** Applies the saved profile. Must run on the UI thread; takes effect on the next navigation. */
    private void applyUserAgent() {
        if (webview == null) return;
        webview.getSettings().setUserAgentString(
                resolveUserAgent(currentUserAgentProfile(), WebSettings.getDefaultUserAgent(this)));
    }

    /**
     * Called on the control server's worker thread after a config save that changed
     * something. Waits up to a second for the UI thread, so the new agent is in
     * place before the phone's follow-up reload command arrives.
     */
    private void applyUserAgentFromSave() {
        final CountDownLatch done = new CountDownLatch(1);
        runOnUiThread(() -> {
            try {
                applyUserAgent();
            } finally {
                done.countDown();
            }
        });
        try {
            done.await(1, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private String readAsset(String name) throws IOException {
        InputStream in = getAssets().open(name);
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) bytes.write(buf, 0, n);
            return new String(bytes.toByteArray(), "UTF-8");
        } finally {
            in.close();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) throws IOException {
        if (!(value instanceof Map)) throw new IOException("config-schema.json is not an object");
        return (Map<String, Object>) value;
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void startBrowser() {
        webview = new WebView(this);
        webview.setBackgroundColor(Color.rgb(15, 15, 15));
        webview.setFocusable(true);
        webview.setFocusableInTouchMode(true);
        webview.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView view, int errorCode,
                    String description, String failingUrl) {
                Log.w(TAG, "WebView error " + errorCode + ": " + description + " at " + failingUrl);
            }

            // Sub-resources (icons, fonts, scripts) do not reach the main-frame callback
            // above. These report them, with the URL and status, to logcat.
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request,
                    WebResourceResponse response) {
                Log.w(TAG, "HTTP " + response.getStatusCode() + " for " + request.getUrl());
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                    WebResourceError error) {
                if (request.isForMainFrame()) return; // already logged above
                Log.w(TAG, "Resource error " + error.getErrorCode() + ": " + error.getDescription()
                        + " at " + request.getUrl());
            }
        });
        webview.setWebChromeClient(new WebChromeClient());
        WebSettings settings = webview.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        applyUserAgent();
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        FrameLayout screen = new FrameLayout(this);
        screen.setBackgroundColor(Color.rgb(15, 15, 15));
        screen.addView(webview, new FrameLayout.LayoutParams(-1, -1));
        setContentView(screen);
        webview.requestFocus();
        webview.loadUrl(URL);
    }

    private static int tvMediaCode(int androidCode) {
        switch (androidCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return 10252;
            case KeyEvent.KEYCODE_MEDIA_PLAY: return 415;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return 19;
            case KeyEvent.KEYCODE_MEDIA_STOP: return 413;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return 417;
            case KeyEvent.KEYCODE_MEDIA_REWIND: return 412;
            case KeyEvent.KEYCODE_MEDIA_NEXT: return 10233;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return 10232;
            default: return 0;
        }
    }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int media = tvMediaCode(event.getKeyCode());
        if (media != 0 && webview != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                // YouTube TV registers media keys as the Tizen Web key codes.
                String js = "(function(){var e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true});"
                        + "Object.defineProperty(e,'keyCode',{get:function(){return " + media + ";}});"
                        + "Object.defineProperty(e,'which',{get:function(){return " + media + ";}});"
                        // A document event bubbles to window. Dispatch once to
                        // avoid toggling playback twice for one remote keypress.
                        + "document.dispatchEvent(e);})();";
                webview.evaluateJavascript(js, null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override public void onBackPressed() {
        if (webview != null && webview.canGoBack()) webview.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (webview != null) {
            webview.loadUrl("about:blank");
            webview.destroy();
            webview = null;
        }
        if (server != null) server.stop();
        if (control != null) control.stop();
        super.onDestroy();
    }
}
