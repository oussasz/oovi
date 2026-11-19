"use client";

import Link from "next/link";
import { Empty, SlimeTrio } from "./kit";
import { useM } from "./MobileApp";
import { to } from "../_lib/route";

/** Shown by the offline worker when a page of the app was never opened on this phone and there is no connection. */
export function OfflineScreen() {
  const { t } = useM();
  return (
    <div className="m-screen">
      <main className="m-main m-main--center">
        <Empty art={<SlimeTrio mood="sleeping" />} title={t("offline.title")} body={t("offline.body")}>
          <Link href={to()} className="m-btn m-btn--tinted">
            {t("tab.chats")}
          </Link>
        </Empty>
      </main>
    </div>
  );
}
