// AI pictures (web/lib/imagegen-core.ts): what is never drawn, and the price per picture.
import test from "node:test";
import assert from "node:assert/strict";
import { pictureRefusal, pictureUsd } from "../../web/lib/imagegen-core.ts";

test("refused descriptions", () => {
  assert.equal(pictureRefusal("A cozy café in Oran at sunset, watercolor"), null);
  assert.equal(pictureRefusal("صورة لمقهى في وهران عند الغروب"), null);
  assert.ok(pictureRefusal("naked woman on a beach"));
  assert.ok(pictureRefusal("une femme nue"));
  assert.ok(pictureRefusal("صورة عارية"));
  assert.ok(pictureRefusal("a girl in a bikini, seductive"));
  assert.ok(pictureRefusal("beheading scene"));
  assert.equal(pictureRefusal("a girl reading a book in a library"), null);
  assert.ok(pictureRefusal(""));
});

test("price per picture (Cloudflare FLUX schnell, 4 steps)", () => {
  assert.ok(Math.abs(pictureUsd("square") - 0.000634) < 1e-6, String(pictureUsd("square")));
  assert.ok(pictureUsd("portrait") < pictureUsd("square") + 1e-9);
});
