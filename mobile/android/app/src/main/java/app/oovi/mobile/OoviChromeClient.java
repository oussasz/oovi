package app.oovi.mobile;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;

/**
 * Before Android asks for the microphone the first time, says in plain words why (voice notes), in the phone's
 * language. Camera and other requests from the page are left to Capacitor (the app doesn't declare the camera).
 */
class OoviChromeClient extends BridgeWebChromeClient {

    private static final String PREFS = "oovi";
    private static final String EXPLAINED = "micExplained";
    private final Bridge bridge;

    OoviChromeClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        // Only oovi's own pages may use the microphone.
        String origin = request.getOrigin() == null ? "" : request.getOrigin().toString();
        if (!origin.startsWith("https://" + NavPolicy.HOST)) {
            request.deny();
            return;
        }
        boolean audio = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        Context ctx = bridge.getActivity();
        boolean granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!audio || granted || prefs.getBoolean(EXPLAINED, false) || bridge.getActivity().isFinishing()) {
            super.onPermissionRequest(request);
            return;
        }
        new AlertDialog.Builder(ctx)
            .setTitle(R.string.mic_title)
            .setMessage(R.string.mic_body)
            .setPositiveButton(R.string.mic_continue, (d, w) -> {
                prefs.edit().putBoolean(EXPLAINED, true).apply();
                super.onPermissionRequest(request);
            })
            .setNegativeButton(R.string.mic_not_now, (d, w) -> request.deny())
            .setOnCancelListener((d) -> request.deny())
            .show();
    }
}
