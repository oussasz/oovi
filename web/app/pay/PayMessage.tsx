// A short page of the payment flow (expired link, thank you, no subscription, payments off), in the person's language.
import type { PayLang } from "@/lib/pay-core";

export function PayMessage({ lang, title, text }: { lang: PayLang; title: string; text: string }) {
  return (
    <main className="container page pay-page" lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <section className="card pay-card">
        <h1 className="h3">{title}</h1>
        <p className="lead">{text}</p>
      </section>
    </main>
  );
}
