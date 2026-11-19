package app.oovi.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;

/** Opens links outside the app: the phone's browser as a Custom Tab, or the app that handles mail, phone... */
final class Links {

    private Links() {}

    static void openInBrowser(Activity activity, Uri uri) {
        try {
            CustomTabColorSchemeParams light = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(0xFFFBFAF7)
                .setNavigationBarColor(0xFFFBFAF7)
                .build();
            CustomTabColorSchemeParams dark = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(0xFF151513)
                .setNavigationBarColor(0xFF151513)
                .build();
            CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_ON)
                .setDefaultColorSchemeParams(light)
                .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, dark)
                .build();
            tab.launchUrl(activity, uri);
        } catch (ActivityNotFoundException e) {
            openOtherApp(activity, uri);
        }
    }

    static void openOtherApp(Activity activity, Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            activity.startActivity(intent);
        } catch (ActivityNotFoundException e) {
            // Nothing on this phone opens it: stay where we are.
        }
    }
}
