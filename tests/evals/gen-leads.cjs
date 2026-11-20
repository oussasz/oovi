// A 1,001-line leads workbook (1 header + 1,000 rows) like the one in the conversation that failed on 2026-11-20.
// The names and addresses are made up, and the evals only "send" to the local Zapier stand-in: nothing leaves
// this computer. (Addresses on .example made the model stop and say they were fake, so they look real.)
// Usage: node gen-leads.cjs <out.xlsx>   (also writes <out>.rows.json: what the evals check against)
const path = require("node:path");
const ExcelJS = require(path.join(__dirname, "../../node_modules/exceljs"));
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const first = ["Amine","Yacine","Sofiane","Karim","Nadia","Lina","Rania","Mehdi","Walid","Samir","Imane","Sara","Farid","Hichem","Nassim","Leila","Djamel","Rachid","Meriem","Khaled","Bilal","Asma","Tarek","Zineb","Omar"];
const last = ["Benali","Haddad","Mansouri","Bouzid","Cherif","Khelifi","Belkacem","Saidi","Amrani","Ziani","Hamidi","Touati","Meziane","Ferhat","Boudiaf","Larbi","Kaci","Slimani","Rahmani","Guerfi"];
const kinds = ["Restaurant","Clinique dentaire","Agence immobilière","Salon de coiffure","Garage auto","Boulangerie","Cabinet d'avocat","École privée","Salle de sport","Hôtel","Pharmacie","Agence de voyage","Menuiserie","Imprimerie","Boutique de vêtements","Cabinet comptable","Pâtisserie","Opticien","Auto-école","Fleuriste"];
const cities = ["Alger","Oran","Constantine","Annaba","Blida","Sétif","Béjaïa","Tlemcen","Batna","Tizi Ouzou","Mostaganem","Biskra","Skikda","Jijel","Ghardaïa"];
const status = ["Nouveau","Contacté","Intéressé","Pas de réponse","À rappeler","Refusé"];
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Leads");
  ws.addRow(["N°","Entreprise","Secteur","Contact","Ville","Téléphone","Email","Site web","Statut","Notes"]);
  const emails = [];
  const rowsOut = [];
  for (let i = 1; i <= 1000; i++) {
    const kind = pick(kinds), city = pick(cities), f = pick(first), l = pick(last);
    const name = `${kind} ${l} ${city} ${i}`;
    const dom = `${slug(kind).replace(/-/g, "")}${slug(l)}${i}.${pick(["dz","com","dz","net"])}`;
    const r = rnd();
    // 8% have no email; the rest: generic (contact@/info@) or personal (firstname.lastname@)
    const email = r < 0.08 ? "" : r < 0.55 ? `${pick(["contact","info","accueil"])}@${dom}` : `${slug(f)}.${slug(l)}@${dom}`;
    const hasSite = rnd() < 0.3;
    if (email) emails.push(email);
    const st = pick(status);
    rowsOut.push({ row: i + 1, email, status: st, company: name, city, sector: kind });
    ws.addRow([i, name, kind, `${f} ${l}`, city, `0${pick([5,6,7])}${String(Math.floor(rnd() * 1e8)).padStart(8, "0")}`, email, hasSite ? `https://www.${dom}` : "", st, hasSite ? "Site ancien, pas adapté au mobile" : "Pas de site web, seulement une page Facebook"]);
  }
  await wb.xlsx.writeFile(process.argv[2]);
  require("node:fs").writeFileSync(process.argv[2].replace(/\.xlsx$/, ".rows.json"), JSON.stringify(rowsOut));
  console.log(`rows: 1000, with email: ${emails.length}, unique: ${new Set(emails).size}`);
})();
