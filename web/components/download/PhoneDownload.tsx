"use client";

import { useEffect, useState } from "react";
import { isAndroidBrowser, isNativeApp } from "@/lib/app-detect";
import { ArrowRight, PhoneIcon } from "../icons";

type Lang = "en" | "fr" | "ar";

/** Set on Vercel once oovi is on Google Play (lib/releases.ts playStoreUrl): the card then points there. */
const PLAY_URL = /^https:\/\/play\.google\.com\/store\/apps\/details\?id=app\.oovi\.mobile(&|$)/.test(process.env.NEXT_PUBLIC_PLAY_STORE_URL ?? "") ? process.env.NEXT_PUBLIC_PLAY_STORE_URL! : "";

// The phone card speaks the visitor's language (Android users write Arabic, French and English); the rest of the
// page is English like the website.
const WORDS: Record<Lang, { title: string; lead: string; direct: string; s1: [string, string, string]; s2: [string, string, string]; s3: string; fine: string; button: string; started: string; iphone: string; play: string; apk: string }> = {
  en: {
    title: "On your phone",
    lead: "Your chats, your bots’ live work and approvals, wherever you are.",
    direct: "Direct download for now: oovi will be on Google Play soon.",
    s1: ["Tap ", "Download for Android", ", then open the downloaded oovi file (.apk) from your notifications or Downloads."],
    s2: ["Android asks to allow your browser to ", "install unknown apps", ": allow it, go back and tap Install. If Play Protect shows a warning, tap More details, then Install anyway."],
    s3: "Open oovi and sign in with your oovi account.",
    fine: "Android 7 or newer. Updates: download the new version here and install it over the old one; your chats stay.",
    button: "Download for Android (APK)",
    started: "Your download should start in a moment. Then follow the steps above.",
    iphone: "iPhone: coming soon",
    play: "Get it on Google Play",
    apk: "No Google Play? Download the APK",
  },
  fr: {
    title: "Sur votre téléphone",
    lead: "Vos discussions, le travail de vos bots en direct et vos validations, où que vous soyez.",
    direct: "Téléchargement direct pour l’instant : oovi sera bientôt sur Google Play.",
    s1: ["Touchez ", "Télécharger pour Android", ", puis ouvrez le fichier oovi téléchargé (.apk) depuis vos notifications ou Téléchargements."],
    s2: ["Android demande d’autoriser votre navigateur à ", "installer des applis inconnues", " : autorisez-le, revenez et touchez Installer. Si Play Protect affiche un avertissement, touchez Plus de détails, puis Installer quand même."],
    s3: "Ouvrez oovi et connectez-vous avec votre compte oovi.",
    fine: "Android 7 ou plus récent. Mises à jour : téléchargez la nouvelle version ici et installez-la par-dessus ; vos discussions restent.",
    button: "Télécharger pour Android (APK)",
    started: "Le téléchargement va commencer. Suivez ensuite les étapes ci-dessus.",
    iphone: "iPhone : bientôt",
    play: "Disponible sur Google Play",
    apk: "Pas de Google Play ? Téléchargez l’APK",
  },
  ar: {
    title: "على هاتفك",
    lead: "محادثاتك، وعمل بوتاتك مباشرةً، وموافقاتك، أينما كنت.",
    direct: "تنزيل مباشر حاليًا: سيكون oovi على Google Play قريبًا.",
    s1: ["اضغط ", "نزّل لأندرويد", "، ثم افتح ملف oovi الذي نزّلته (‎.apk) من الإشعارات أو من التنزيلات."],
    s2: ["سيطلب منك Android السماح لمتصفحك بـ", "تثبيت التطبيقات غير المعروفة", ": اسمح بذلك، ثم ارجع واضغط تثبيت. إذا ظهر تحذير من Play Protect، اضغط مزيد من التفاصيل ثم التثبيت على أي حال."],
    s3: "افتح oovi وسجّل الدخول بحسابك في oovi.",
    fine: "أندرويد 7 أو أحدث. التحديثات: نزّل الإصدار الجديد من هنا وثبّته فوق القديم، وتبقى محادثاتك.",
    button: "نزّل لأندرويد (APK)",
    started: "سيبدأ التنزيل بعد لحظة. ثم اتبع الخطوات أعلاه.",
    iphone: "آيفون: قريبًا",
    play: "احصل عليه من Google Play",
    apk: "لا يوجد Google Play؟ نزّل ملف APK",
  },
};

export function pickPhoneLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    const k = l.slice(0, 2).toLowerCase();
    if (k === "ar" || k === "fr" || k === "en") return k;
  }
  return "en";
}

/**
 * The phone apps on the download page: the Android app, a direct download for now (APK from the website,
 * .github/workflows/android.yml; Google Play later), and the iPhone app, coming soon. On an Android phone this card
 * comes first; inside oovi's own app it is not shown (DownloadCards).
 */
export function PhoneDownload() {
  const [started, setStarted] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => setLang(pickPhoneLang(navigator.languages?.length ? navigator.languages : [navigator.language || "en"])), []);
  const w = WORDS[lang];
  return (
    <div className="chooser phone-dl" id="phone" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <div className="phone-dl__head">
        <span className="phone-dl__icon" aria-hidden>
          <PhoneIcon size={22} />
        </span>
        <div>
          <h2 className="phone-dl__title">{w.title}</h2>
          <p className="alt">{w.lead}</p>
        </div>
      </div>
      {PLAY_URL ? (
        <a className="btn btn-dark btn-lg chooser-cta" href="/download/android">
          <PhoneIcon /> {w.play} <ArrowRight className="phone-dl__arrow" />
        </a>
      ) : null}
      <div className="notice plain" style={PLAY_URL ? { display: "none" } : undefined}>
        <p className="phone-dl__direct">{w.direct}</p>
        <ol className="steps">
          <li>
            {w.s1[0]}
            <b>{w.s1[1]}</b>
            {w.s1[2]}
          </li>
          <li>
            {w.s2[0]}
            <b>{w.s2[1]}</b>
            {w.s2[2]}
          </li>
          <li>{w.s3}</li>
        </ol>
        <p className="alt">{w.fine}</p>
      </div>
      {PLAY_URL ? (
        <a className="fine" href="/download/android?apk=1">{w.apk}</a>
      ) : (
        <a className="btn btn-dark btn-lg chooser-cta" href="/download/android" onClick={() => setStarted(true)}>
          <PhoneIcon /> {w.button} <ArrowRight className="phone-dl__arrow" />
        </a>
      )}
      <p className="fine" aria-live="polite">
        {started ? w.started : w.iphone}
      </p>
    </div>
  );
}

/** Desktop and phone cards: the phone first on an Android phone; inside oovi's app, the computer only. */
export function DownloadCards({ desktop }: { desktop: React.ReactNode }) {
  const [where, setWhere] = useState<"computer" | "android" | "app">("computer");
  useEffect(() => {
    const ua = navigator.userAgent;
    setWhere(isNativeApp(ua) ? "app" : isAndroidBrowser(ua) ? "android" : "computer");
  }, []);
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
  return <div className="dl-cards">{where === "app" ? computer : where === "android" ? [phone, computer] : [computer, phone]}</div>;
}
