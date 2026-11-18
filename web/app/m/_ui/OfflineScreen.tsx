"use client";

import Link from "next/link";
import { Icon } from "./Icon";
import { Empty, TabBar } from "./kit";
import { useM } from "./MobileApp";

/** Shown by the offline worker when a page of the app was never opened on this phone and there is no connection. */
export function OfflineScreen() {
  const { t } = useM();
  return (
    <div className="m-screen m-screen--tabs">
      <main className="m-main m-main--center">
        <Empty icon={<Icon name="wifiOff" size={44} stroke={1.6} />} title={t("offline.title")} body={t("offline.body")}>
          <Link href="/m" className="m-btn m-btn--tinted">
            {t("tab.chats")}
          </Link>
        </Empty>
      </main>
      <TabBar />
    </div>
  );
}
