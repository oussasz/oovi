package app.oovi.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * oovi's phone app: the phone app of the website (https://oovi.conuron.com/m) in a native shell, so the two
 * never drift apart. Here: links (NavPolicy), the offline page, the back button, App Links, cookies.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return; // no WebView on this phone: Capacitor shows its own message
        WebView web = bridge.getWebView();
        bridge.setWebViewClient(new OoviWebViewClient(bridge, this));
        web.setWebChromeClient(new OoviChromeClient(bridge));
        // A file link the app can't show: the browser downloads it (signed-in files are not offered in the app yet).
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            if (url != null && url.startsWith("https://")) Links.openInBrowser(this, Uri.parse(url));
        });
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                back();
            }
        });
    }

    /**
     * Back: the page first gets the chance to close what is open (a menu, a sheet: event "ooviback", cancelable);
     * then back in the app; from the chat list or the sign-in screen, the app goes to the background.
     */
    private void back() {
        final WebView web = bridge.getWebView();
        web.evaluateJavascript(
            "(function(){try{var e=new CustomEvent('ooviback',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented}catch(x){return false}})()",
            (handled) -> {
                if ("true".equals(handled)) return;
                String url = web.getUrl();
                if (NavPolicy.exitsOnBack(url)) {
                    moveTaskToBack(true);
                } else if (web.canGoBack()) {
                    web.goBack();
                } else {
                    web.loadUrl(NavPolicy.HOME);
                }
            }
        );
    }

    /** App Links (https://oovi.conuron.com/m/...) open that page in the app. Also runs for the first launch. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (bridge == null || intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        String page = NavPolicy.deepLink(intent.getDataString());
        if (page != null) bridge.getWebView().loadUrl(page);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Back from the browser (a connector's sign-in): the phone app checks for a finished sign-in on "focus".
        if (bridge != null) bridge.getWebView().evaluateJavascript("try{window.dispatchEvent(new Event('focus'))}catch(e){}", null);
    }

    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush(); // keep the sign-in if Android closes the app
    }
}
