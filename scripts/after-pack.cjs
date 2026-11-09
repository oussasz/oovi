// electron-builder afterPack hook: copy the trimmed Next.js server (.next/standalone, made by
// `npm run build`) into the app's resources/server folder.
// Done here, not with build.extraResources, because electron-builder always leaves out
// node_modules folders when copying extra resources, and the server needs its node_modules.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const from = path.join(packager.projectDir, ".next", "standalone");
  if (!fs.existsSync(path.join(from, "server.js")) || !fs.existsSync(path.join(from, ".next", "static"))) {
    throw new Error("No prepared server in .next/standalone: run `npm run build` first.");
  }
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const to = path.join(resources, "server");
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  console.log(`  • copied server  to=${path.relative(packager.projectDir, to)}`);
};
