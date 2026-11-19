// Where Paddle sends the buyer after paying from the app's link: go back to oovi.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { PAY_TEXT, payLang } from "@/lib/pay-core";
import { PayMessage } from "../PayMessage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "oovi", robots: { index: false, follow: false } };

export default async function PayDone() {
  const lang = payLang((await headers()).get("accept-language"));
  return <PayMessage lang={lang} title={PAY_TEXT[lang].doneTitle} text={PAY_TEXT[lang].done} />;
}
