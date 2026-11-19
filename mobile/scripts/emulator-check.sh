#!/usr/bin/env bash
# Runs on GitHub's Android emulator (android.yml, job "check"): installs the debug app, opens it, and takes
# screenshots of the sign-in screen (the live website), a deep link, dark mode and the offline screen. It also checks
# that Back on the first screen sends the app to the background. Screenshots land in shots/.
set -u
APK="$1"
PKG=app.oovi.mobile
mkdir -p shots
fail=0
shot() { adb exec-out screencap -p > "shots/$1.png"; echo "shot: $1"; }
top() { adb shell dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity" || true; }
waitfor() { sleep "$1"; }

adb wait-for-device
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb install -r "$APK"

echo "== 1. First launch, online: the sign-in screen"
adb shell am start -W -n $PKG/.MainActivity
waitfor 25
shot 1-signin-light
top

echo "== 2. Back on the sign-in screen sends the app to the background"
adb shell input keyevent KEYCODE_BACK
waitfor 3
if top | grep -q "$PKG"; then echo "::error::Back on the sign-in screen did not leave the app"; fail=1; else echo "ok: left the app"; fi

echo "== 3. Dark mode"
adb shell cmd uimode night yes
adb shell am start -W -n $PKG/.MainActivity
waitfor 12
shot 2-signin-dark
adb shell cmd uimode night no

echo "== 4. App Link to a page of the phone app (unverified link: opened by naming the app)"
adb logcat -c
adb shell am start -W -a android.intent.action.VIEW -d "https://oovi.conuron.com/m/settings" $PKG
waitfor 2
top
shot 3a-deeplink-2s
waitfor 10
top
shot 3-deeplink
if top | grep -q "$PKG"; then echo "ok: the app is in front after the link"; else echo "::warning::the app is not in front after the link"; fi
echo "-- log after the link --"
adb logcat -d | grep -E "ActivityTaskManager|ActivityManager: (Start|Kill|Force)|WindowManager|oovi|Capacitor|chromium" | grep -v AppsFilter | tail -60 || true

echo "== 5. Offline: no network, fresh data (no saved copy of the app)"
adb shell am force-stop $PKG
adb shell pm clear $PKG
adb shell svc wifi disable
adb shell svc data disable
adb shell cmd connectivity airplane-mode enable 2>/dev/null || true
waitfor 5
adb shell am start -W -n $PKG/.MainActivity
waitfor 12
shot 4-offline-light
adb shell cmd uimode night yes
waitfor 6
shot 5-offline-dark
adb shell cmd uimode night no

echo "== 6. Connection back: Try again opens the app"
adb shell cmd connectivity airplane-mode disable 2>/dev/null || true
adb shell svc wifi enable
adb shell svc data enable
waitfor 20
shot 6-back-online

adb logcat -d | grep -iE "AndroidRuntime|FATAL|app.oovi" | tail -40 || true
if adb logcat -d | grep -q "FATAL EXCEPTION"; then echo "::error::The app crashed (see the log above)"; fail=1; fi
exit $fail
