// Vercel BotID: an invisible check that the website's sign-up form is used by a person, not a script.
// The server side is in app/api/auth/[...all]/route.ts.
import { initBotId } from "botid/client/core";

initBotId({ protect: [{ path: "/api/auth/sign-up/email", method: "POST" }] });
