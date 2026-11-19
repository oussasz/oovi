package app.oovi.mobile;

import java.net.URI;
import java.util.Locale;

/**
 * Where a link opens. Pure Java (no Android classes) so it is checked by plain unit tests (NavPolicyTest).
 *
 * The app shows only oovi's phone app and the website pages it needs to sign in. Everything else (other
 * sites, a connector's sign-in page, oovi's own download or legal pages) opens in the phone's browser as a
 * Custom Tab, which also keeps Google and other services happy: they refuse sign-ins inside an app's WebView.
 */
public final class NavPolicy {

    public static final String HOST = "oovi.conuron.com";
    public static final String HOME = "https://" + HOST + "/m";

    public enum Action {
        /** Load it in the app. */
        IN_APP,
        /** Open it in the phone's browser (Custom Tab). */
        BROWSER,
        /** Hand it to another app (mail, phone, maps, Play Store...). */
        OTHER_APP,
        /** Never open it (javascript:, file:, content: and anything unknown). */
        BLOCK,
    }

    private NavPolicy() {}

    /** The website pages that stay inside the app: the phone app and the account pages it links to. */
    static boolean isAppPath(String path) {
        if (path == null || path.isEmpty()) return false;
        String p = path.toLowerCase(Locale.ROOT);
        return (
            under(p, "/m") ||
            under(p, "/app") ||
            under(p, "/login") ||
            under(p, "/signup") ||
            under(p, "/forgot-password") ||
            under(p, "/reset-password") ||
            under(p, "/verified") ||
            under(p, "/api")
        );
    }

    private static boolean under(String path, String prefix) {
        return path.equals(prefix) || path.startsWith(prefix + "/");
    }

    static boolean isOoviHost(URI uri) {
        String host = uri.getHost();
        return host != null && host.equalsIgnoreCase(HOST) && uri.getPort() == -1;
    }

    /** What to do with a link the page tries to open. */
    public static Action decide(String url) {
        if (url == null) return Action.BLOCK;
        URI uri;
        try {
            uri = new URI(url.trim());
        } catch (Exception e) {
            return Action.BLOCK;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        switch (scheme) {
            case "https":
                if (isOoviHost(uri) && isAppPath(uri.getRawPath())) return Action.IN_APP;
                return Action.BROWSER;
            case "http":
                return Action.BROWSER;
            case "data":
            case "blob":
            case "about":
                return Action.IN_APP;
            case "mailto":
            case "tel":
            case "sms":
            case "geo":
            case "market":
            case "whatsapp":
                return Action.OTHER_APP;
            default:
                return Action.BLOCK;
        }
    }

    /** A link that opened the app (App Link or a notification): the page to show, or null to ignore it. */
    public static String deepLink(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !isOoviHost(uri)) return null;
            String path = uri.getRawPath();
            if (path == null || !under(path.toLowerCase(Locale.ROOT), "/m")) return null;
            return "https://" + HOST + path + (uri.getRawQuery() != null ? "?" + uri.getRawQuery() : "") + (uri.getRawFragment() != null ? "#" + uri.getRawFragment() : "");
        } catch (Exception e) {
            return null;
        }
    }

    /** The back button leaves the app from these pages (the chat list, or the sign-in screen). */
    public static boolean exitsOnBack(String url) {
        if (url == null) return true;
        try {
            URI uri = new URI(url.trim());
            if (!isOoviHost(uri)) return false;
            String p = uri.getRawPath() == null ? "" : uri.getRawPath().toLowerCase(Locale.ROOT);
            if (p.endsWith("/") && p.length() > 1) p = p.substring(0, p.length() - 1);
            return p.equals("/m") || p.equals("/m/login") || p.equals("/offline.html");
        } catch (Exception e) {
            return false;
        }
    }

    /** The page to try again from the offline screen: path and query of an app page, or "/m". */
    public static String retryPath(String failedUrl) {
        if (failedUrl == null) return "/m";
        try {
            URI uri = new URI(failedUrl.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || !isOoviHost(uri) || !isAppPath(uri.getRawPath())) return "/m";
            if (uri.getRawPath().toLowerCase(Locale.ROOT).startsWith("/api")) return "/m";
            return uri.getRawPath() + (uri.getRawQuery() != null ? "?" + uri.getRawQuery() : "");
        } catch (Exception e) {
            return "/m";
        }
    }
}
