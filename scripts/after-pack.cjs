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
  const dropped = dropOutsideLinks(to);
  console.log(`  • copied server  to=${path.relative(packager.projectDir, to)}${dropped.length ? ` (removed ${dropped.length} link(s) pointing outside it)` : ""}`);
};

/**
 * Symbolic links that point outside the server folder (npm writes absolute `.bin` links to the build
 * machine's paths) are broken on users' computers, and macOS refuses to sign an app that contains them
 * ("invalid destination for symbolic link in bundle"). They're command shortcuts the app never uses.
 */
function dropOutsideLinks(root) {
  const dropped = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) {
        const target = path.resolve(dir, fs.readlinkSync(p));
        const rel = path.relative(root, target);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          fs.unlinkSync(p);
          dropped.push(path.relative(root, p));
        }
      } else if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return dropped;
}
exports.dropOutsideLinks = dropOutsideLinks;
