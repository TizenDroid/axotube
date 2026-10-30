package org.axotube.tv;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.util.Log;

/** Android TV WebView shell; local service lives only while this app is running. */
public final class MainActivity extends Activity {
    private static final String TAG = "AxoTube";
    // Android currently does not implement the WGT's separate 8085 DIAL service.
    // Loading an unreachable additionalDataUrl would advertise broken pairing.
    private static final String URL = "http://localhost:8099/tv";
    private static final String TV_USER_AGENT =
            "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 "
                    + "(KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3";
    private LocalProxy server;
    private WebView webview;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        try {
            BundleStore bundles = new BundleStore(this);
            server = new LocalProxy(bundles);
            server.start();
            bundles.start();
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
        settings.setUserAgentString(TV_USER_AGENT);
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
        super.onDestroy();
    }
}
