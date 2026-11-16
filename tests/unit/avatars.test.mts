import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { normalizeFace, slimeOf } from "../../lib/faces.ts";
import { isAvatarPng, MAX_AVATAR_BYTES } from "../../lib/avatar-png.ts";
import { validateCatalogData } from "../../web/lib/catalog.ts";

const root = new URL("../../", import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");

/** A real PNG of w×h. */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const ID = "0123456789abcdef0123456789abcdef";
const slime = { color: 1, shape: 2, hair: 3, eyes: 1, nose: 0, mouth: 1, cheeks: 1, top: 0, wear: 0 };

test("a face keeps a valid picture id and drops anything else in that field", () => {
  assert.equal(normalizeFace({ ...slime, image: ID }).image, ID);
  for (const bad of ["../../etc/passwd", "https://evil.example/x.png", "ABCDEF0123456789abcdef0123456789", 5, ""]) assert.equal("image" in normalizeFace({ ...slime, image: bad }), false, String(bad));
  assert.deepEqual(slimeOf(normalizeFace({ ...slime, image: ID })), normalizeFace(slime));
});

test("only a real, small PNG is accepted as a picture", () => {
  assert.equal(isAvatarPng(png(256, 256)), true);
  assert.equal(isAvatarPng(png(2000, 100)), false, "too wide");
  assert.equal(isAvatarPng(Buffer.from("<svg onload=alert(1)>")), false);
  assert.equal(isAvatarPng(Buffer.concat([png(10, 10), Buffer.alloc(MAX_AVATAR_BYTES)])), false, "too big");
  const fake = png(10, 10);
  fake.write("JUNK", 12, "latin1");
  assert.equal(isAvatarPng(fake), false, "no IHDR");
});

test("marketplace items: a bot's face may carry an uploaded picture id, nothing else", () => {
  const item = (face: Record<string, unknown>) => ({ name: "Team", description: "A team.", group: "Team", bots: [{ name: "Ava", role: "Writer", instructions: "Write well.", tools: { web: true, browser: false }, face }] });
  assert.deepEqual(validateCatalogData("plugin", item({ ...slime, image: ID })).filter((e) => /face/.test(e)), []);
  assert.ok(validateCatalogData("plugin", item({ ...slime, image: "https://x.y/a.png" })).some((e) => /face\.image/.test(e)));
  assert.ok(validateCatalogData("plugin", item({ ...slime, photo: ID })).some((e) => /photo/.test(e)));
});

test("the website draws faces exactly like the app (copies kept identical)", () => {
  for (const f of ["lib/faces.ts", "components/Face.tsx", "components/Face.module.css", "lib/avatar-png.ts"]) assert.equal(read(`web/${f}`), read(f), `web/${f} differs from ${f}: copy it again`);
  assert.notEqual(read("web/lib/avatar-src.ts"), read("lib/avatar-src.ts"), "each side loads pictures from its own route");
});
