// Runs once when the app's server starts.
// The NEXT_RUNTIME check must wrap the import (Next's documented pattern), so the
// Node-only code is left out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Telegram: answer messages from the user's paired Telegram while oovi is open.
    const { startTelegram } = await import("./lib/telegram");
    startTelegram();
  }
}
