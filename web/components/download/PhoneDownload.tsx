"use client";

import { useEffect, useState } from "react";
import { isAndroidBrowser } from "@/lib/app-detect";
import { ArrowRight, PhoneIcon } from "../icons";

/**
 * The phone apps on the download page: the Android app (APK from the website, .github/workflows/android.yml) and
 * the iPhone app, coming soon. On an Android phone this card comes first (DownloadCards).
 */
export function PhoneDownload() {
  const [started, setStarted] = useState(false);
  return (
    <div className="chooser phone-dl" id="phone">
      <div className="phone-dl__head">
        <span className="phone-dl__icon" aria-hidden>
          <PhoneIcon size={22} />
        </span>
        <div>
          <h2 className="phone-dl__title">On your phone</h2>
          <p className="alt">Your chats, your bots’ live work and approvals, wherever you are.</p>
        </div>
      </div>
      <div className="notice plain">
        <ol className="steps">
          <li>
            Tap <b>Download for Android</b>, then open the downloaded <b>oovi</b> file (.apk) from your notifications or Downloads.
          </li>
          <li>
            If Android asks, allow your browser to <b>install unknown apps</b>, go back and tap <b>Install</b>. If Play
            Protect shows a warning, tap <b>More details</b>, then <b>Install anyway</b> (oovi isn’t on Google Play yet).
          </li>
          <li>Open oovi and sign in with your oovi account.</li>
        </ol>
        <p className="alt">Android 7 or newer. Updates: download the new version here and install it over the old one; your chats stay.</p>
      </div>
      <a className="btn btn-dark btn-lg chooser-cta" href="/download/android" onClick={() => setStarted(true)}>
        <PhoneIcon /> Download for Android <ArrowRight />
      </a>
      <p className="fine" aria-live="polite">
        {started ? "Your download should start in a moment. Then follow the steps above." : "iPhone: coming soon"}
      </p>
    </div>
  );
}

/** Desktop and phone cards, the phone first on an Android phone. */
export function DownloadCards({ desktop }: { desktop: React.ReactNode }) {
  const [androidFirst, setAndroidFirst] = useState(false);
  useEffect(() => setAndroidFirst(isAndroidBrowser(navigator.userAgent)), []);
  const phone = (
    <div className="card" key="phone">
      <PhoneDownload />
    </div>
  );
  const computer = (
    <div className="card" key="desktop">
      {desktop}
    </div>
  );
  return <div className="dl-cards">{androidFirst ? [phone, computer] : [computer, phone]}</div>;
}
