package app.oovi.mobile;

import android.net.Uri;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.regex.Matcher;
import org.json.JSONObject;
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

    private final MainActivity activity;

    OoviWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
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
        String failed = request.getUrl().toString();
        if (failed.startsWith(NavPolicy.OFFLINE_URL)) return; // never loop on the offline page
        String html = offlineHtml(NavPolicy.retryPath(failed));
        if (html != null) view.loadDataWithBaseURL(NavPolicy.OFFLINE_URL, html, "text/html", "utf-8", NavPolicy.OFFLINE_URL);
    }

    /** The offline page built into the app (www/offline.html), told which page to try again. */
    private String offlineHtml(String retry) {
        try (InputStream in = activity.getAssets().open("public/offline.html")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            String page = out.toString("UTF-8");
            // JSONObject.quote escapes quotes and "/" so the value can't end the script.
            return page.replaceFirst("<script>", Matcher.quoteReplacement("<script>window.OOVI_RETRY=" + JSONObject.quote(retry) + ";"));
        } catch (IOException e) {
            return null;
        }
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
