import { test } from "node:test";
import assert from "node:assert/strict";
import { contactDetails } from "../../lib/contacts.ts";

const page = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test("a directory listing: the number in a button, a side panel and a tel: link is found", () => {
  const c = contactDetails(page(`<main><h1>Café Chergui</h1><p>Un café à Hydra.</p></main>
    <aside><button>Appeler</button><a href="tel:+213555199669">Afficher le numéro</a></aside>
    <footer>Tél : 021 44 92 17 · <a href="mailto:contact@chergui.dz?subject=x">Email</a></footer>`));
  assert.deepEqual(c, ["Phone: +213555199669", "Email: contact@chergui.dz", "Phone: 021 44 92 17"]);
});

test("the same number written two ways is listed once", () => {
  const c = contactDetails(page(`<a href="tel:0555199669">x</a><p>Téléphone: +213 555 19 96 69</p><a href="https://wa.me/213555199669">WhatsApp</a>`));
  assert.deepEqual(c, ["Phone: 0555199669"]);
});

test("structured data (JSON-LD) gives phone and address", () => {
  const ld = `<script type="application/ld+json">${JSON.stringify({ "@type": "LocalBusiness", name: "Salon", telephone: "+213 540 88 77 61", address: { streetAddress: "11 rue Mohamed Rabia", addressLocality: "Kouba", addressCountry: "DZ" } })}</script>`;
  const c = contactDetails(page("<p>Salon de beauté</p>", ld));
  assert.deepEqual(c, ["Phone: +213 540 88 77 61", "Address: 11 rue Mohamed Rabia, Kouba, DZ"]);
});

test("Arabic labels and WhatsApp links", () => {
  const c = contactDetails(page(`<p>الهاتف: 0661 23 45 67</p><a href="https://api.whatsapp.com/send?phone=213770112233&text=hi">واتساب</a>`));
  assert.deepEqual(c, ["WhatsApp: +213770112233", "Phone: 0661 23 45 67"]);
});

test("dates, prices, ids and years are not phone numbers", () => {
  const c = contactDetails(page(`<p>Publié le 2026-11-11 à 09:52. Prix: 12 500 DA. Référence 100089733170415. Ouvert 08:00-18:00. Depuis 1998-2024.</p><p>Contact us today!</p>`));
  assert.deepEqual(c, []);
});

test("a page with no contact details gives nothing, and broken data doesn't crash", () => {
  assert.deepEqual(contactDetails(page(`<p>Bonjour</p><script type="application/ld+json">{oops</script><a href="tel:%E0%A4%A">x</a>`)), []);
  assert.deepEqual(contactDetails(""), []);
});
