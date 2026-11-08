// Runs once when the app's server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Telegram: answer messages from the user's paired Telegram while oovi is open.
  const { startTelegram } = await import("./lib/telegram");
  startTelegram();
}
