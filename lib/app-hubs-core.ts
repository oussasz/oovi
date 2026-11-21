// Services that reach many apps through one connection: Zapier, Pipedream, Make. Connecting the service is only
// the first step: the user then adds each app they use (Gmail, Sheets, Outlook…) inside it, and a non-technical
// user didn't know where. The Marketplace shows it under the service. Pure: tests/unit/app-hubs.test.mts.

export type Hub = {
  name: string;
  /** The page where the user adds their apps to this service. */
  appsUrl: string;
  /** Apps are added from inside oovi, one button per app (Zapier: components/ZapierApps.tsx). */
  inApp: boolean;
};

export const HUBS: Record<"zapier" | "pipedream" | "make", Hub> = {
  zapier: { name: "Zapier", appsUrl: "https://zapier.com/app/assets/connections", inApp: true },
  pipedream: { name: "Pipedream", appsUrl: "https://pipedream.com/accounts", inApp: false },
  make: { name: "Make", appsUrl: "https://help.make.com/connect-an-application", inApp: false },
};

export const hubOf = (connectorId: string): Hub | null => (connectorId in HUBS ? HUBS[connectorId as keyof typeof HUBS] : null);

/** Zapier's name for an app the Marketplace sends there ("Microsoft 365" is "Microsoft Outlook" in Zapier). */
const ZAPIER_NAMES: Record<string, string> = {
  gmail: "Gmail",
  gdrive: "Google Drive",
  gcalendar: "Google Calendar",
  m365: "Microsoft Outlook",
  slack: "Slack",
  hubspot: "HubSpot",
};
export const zapierAppFor = (connectorId: string, name: string): string => ZAPIER_NAMES[connectorId] ?? name.split(",")[0]!.trim();
