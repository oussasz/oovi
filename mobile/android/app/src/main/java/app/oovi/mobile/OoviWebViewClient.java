package app.oovi.mobile;

import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Keeps oovi's own pages in the app and sends every other link to the browser (NavPolicy). When the website
 * can't be reached, shows the offline page built into the app; the website's own error pages (404...) show as
 * they are.
 */
class OoviWebViewClient extends BridgeWebViewClient {

    private final Bridge bridge;
    private final MainActivity activity;

    OoviWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.bridge = bridge;
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        switch (NavPolicy.decide(url.toString())) {
            case IN_APP:
                return false;
            case BROWSER:
                Links.openInBrowser(activity, url);
                return true;
            case OTHER_APP:
                Links.openOtherApp(activity, url);
                return true;
            default:
                return true;
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame() || !isNetworkError(error.getErrorCode())) return;
        String errorUrl = bridge.getErrorUrl();
        String failed = request.getUrl().toString();
        // Never loop on the offline page itself.
        if (errorUrl == null || failed.startsWith(errorUrl)) return;
        view.loadUrl(errorUrl + "#" + Uri.encode(NavPolicy.retryPath(failed), "/?=&"));
    }

    /** No connection, no name lookup, a timeout or a broken TLS connection: the website can't be reached. */
    static boolean isNetworkError(int code) {
        switch (code) {
            case ERROR_HOST_LOOKUP:
            case ERROR_CONNECT:
            case ERROR_TIMEOUT:
            case ERROR_IO:
            case ERROR_FAILED_SSL_HANDSHAKE:
            case ERROR_PROXY_AUTHENTICATION:
            case ERROR_UNKNOWN:
                return true;
            default:
                return false;
        }
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        // The website answered: let its own page show (Capacitor's default would show the offline page).
    }
}
