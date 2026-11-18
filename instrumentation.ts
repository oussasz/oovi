// Runs once when the app's server starts.
// The NEXT_RUNTIME check must wrap the import (Next's documented pattern), so the
// Node-only code is left out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // The cloud runner (runner/) starts this server for one job: none of the desktop's background work runs.
    if (process.env.OOVI_CLOUD_RUNNER === "1") {
      const { startCloudRunner } = await import("./lib/cloud-runner");
      startCloudRunner();
      return;
    }
    // Telegram: answer messages from the user's paired Telegram while oovi is open.
    const { startTelegram } = await import("./lib/telegram");
    startTelegram();
    // Anonymous daily usage counts (Settings > About & privacy turns this off).
    const { startUsageReporter } = await import("./lib/usage");
    startUsageReporter();
    // Routines: scheduled tasks run while oovi is open (or in the background, when the user allows it).
    const { startRoutines } = await import("./lib/routines-scheduler");
    startRoutines();
    // Tasks the main bot gave groups: their results reach the user even after a restart.
    // Also repairs chats a closed app left showing "working…".
    const { startDelegations } = await import("./lib/delegations");
    startDelegations();
    // The user's setup (bots, groups, skills…, never chats) follows their account to their other computers.
    const { startSetupSync } = await import("./lib/setup-sync");
    startSetupSync();
    // Optional cloud sync (Settings > Sync, off by default): chats and connectors follow the account, and the
    // phone's messages are run here while oovi is open.
    const { startCloudSync } = await import("./lib/cloud-sync");
    startCloudSync();
  }
}
