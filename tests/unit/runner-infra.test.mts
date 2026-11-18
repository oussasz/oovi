// The cloud runner's server files stay consistent: setup.sh installs exactly infra/docker-compose.yml, nothing secret
// is written in them, and the image runs as a normal user with a health check.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

test("setup.sh installs exactly infra/docker-compose.yml", () => {
  const setup = read("infra/setup.sh");
  const m = /<<'COMPOSE'\n([\s\S]*?)\nCOMPOSE\n/.exec(setup);
  assert.ok(m, "setup.sh embeds the compose file");
  assert.equal(`${m[1]}\n`, read("infra/docker-compose.yml"));
});

test("the compose file opens no port and keeps nothing on disk", () => {
  const c = read("infra/docker-compose.yml");
  assert.doesNotMatch(c, /^\s*ports:/m);
  assert.doesNotMatch(c, /docker\.sock/);
  assert.match(c, /read_only: true/);
  assert.match(c, /restart: unless-stopped/);
  assert.match(c, /env_file: runner\.env/);
});

test("no secret is written in the server files", () => {
  for (const f of ["infra/setup.sh", "infra/docker-compose.yml", "infra/azure/create.sh", "infra/azure/delete.sh", "runner/Dockerfile", ".github/workflows/runner-image.yml"]) {
    const t = read(f);
    assert.doesNotMatch(t, /RUNNER_SECRET=[A-Za-z0-9_-]{16,}/, f);
    assert.doesNotMatch(t, /gh[po]_[A-Za-z0-9]{20,}/, f);
  }
});

test("the image runs as a normal user, with a health check, and is built without the website", () => {
  const d = read("runner/Dockerfile");
  assert.match(d, /^USER node$/m);
  assert.match(d, /^HEALTHCHECK /m);
  const ignore = read(".dockerignore").split("\n");
  for (const x of ["node_modules", ".next", "web", "data", "**/.env*"]) assert.ok(ignore.includes(x), x);
});
