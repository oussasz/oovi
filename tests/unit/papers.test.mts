import { test } from "node:test";
import assert from "node:assert/strict";
import { fromArxiv, fromCrossref, fromEuropePmc, keepPaper, mergePapers, paperRow, sortPapers } from "../../lib/papers-core.ts";

// Shaped like the catalogues' real answers (fields trimmed).
const CROSSREF = {
  message: {
    items: [
      { DOI: "10.1038/S41586-019-1711-4", title: ["Search-and-replace genome editing without double-strand breaks or donor DNA"], author: [{ given: "Andrew V.", family: "Anzalone" }, { given: "David R.", family: "Liu" }], issued: { "date-parts": [[2019, 10, 21]] }, "container-title": ["Nature"], type: "journal-article", "is-referenced-by-count": 3500, abstract: "<jats:title>Abstract</jats:title><jats:p>Most genetic variants that contribute to disease are &amp; hard to correct.</jats:p>" },
      { DOI: "10.1000/no-title", title: [] },
    ],
  },
};
const EPMC = {
  resultList: {
    result: [
      { id: "31634902", source: "MED", pmcid: "PMC6907074", doi: "10.1038/s41586-019-1711-4", title: "Search-and-replace genome editing without double-strand breaks or donor DNA.", authorString: "Anzalone AV, Randolph PB, Liu DR.", journalInfo: { journal: { title: "Nature" } }, pubYear: "2019", abstractText: "Most genetic variants that contribute to disease are challenging to correct efficiently and without excess byproducts. Here we describe prime editing.", isOpenAccess: "N", citedByCount: 2900, pubTypeList: { pubType: ["Journal Article"] }, fullTextUrlList: { fullTextUrl: [{ availabilityCode: "S", documentStyle: "doi", url: "https://doi.org/10.1038/s41586-019-1711-4" }, { availabilityCode: "F", documentStyle: "pdf", url: "https://europepmc.org/articles/PMC6907074?pdf=render" }] } },
      { id: "PPR1", source: "PPR", title: "A preprint with no DOI yet", authorString: "Doe J.", pubYear: "2024", isOpenAccess: "N", citedByCount: 0 },
    ],
  },
};
const ARXIV = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2005.11401v4</id><published>2020-05-22T21:34:34Z</published><title>Retrieval-Augmented Generation for
  Knowledge-Intensive NLP Tasks</title><summary>  Large pre-trained language models store factual knowledge. </summary><author><name>Patrick Lewis</name></author><author><name>Ethan Perez</name></author><arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/></entry></feed>`;

test("each catalogue's answer becomes the same kind of record", () => {
  const [c] = fromCrossref(CROSSREF);
  assert.equal(fromCrossref(CROSSREF).length, 1); // the record without a title is dropped
  assert.deepEqual([c!.title, c!.authors, c!.year, c!.venue, c!.type, c!.doi, c!.link, c!.citations], ["Search-and-replace genome editing without double-strand breaks or donor DNA", "Andrew V. Anzalone, David R. Liu", 2019, "Nature", "journal article", "10.1038/s41586-019-1711-4", "https://doi.org/10.1038/s41586-019-1711-4", 3500]);
  assert.equal(c!.abstract, "Most genetic variants that contribute to disease are & hard to correct.");
  const [e, p] = fromEuropePmc(EPMC);
  assert.equal(e!.open, "https://europepmc.org/articles/PMC6907074?pdf=render"); // free to read there, though not "open access"
  assert.equal(e!.authors, "Anzalone AV, Randolph PB, Liu DR");
  assert.deepEqual([p!.link, p!.open, p!.doi], ["https://europepmc.org/article/PPR/PPR1", "", ""]);
  const [a] = fromArxiv(ARXIV);
  assert.deepEqual([a!.title, a!.year, a!.venue, a!.link, a!.open, a!.type, a!.citations], ["Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", 2020, "arXiv cs.CL", "https://arxiv.org/abs/2005.11401", "https://arxiv.org/pdf/2005.11401", "preprint", null]);
  assert.equal(fromArxiv("Rate exceeded.").length, 0);
});

test("the same paper from two catalogues is one row with the best of both", () => {
  const lists = [fromCrossref(CROSSREF), fromEuropePmc(EPMC), fromArxiv(ARXIV)];
  const merged = mergePapers(lists);
  assert.equal(merged.length, 3);
  const prime = merged[0]!;
  assert.deepEqual(prime.sources, ["Crossref", "Europe PMC"]);
  assert.equal(prime.citations, 3500); // the higher count
  assert.equal(prime.open, "https://europepmc.org/articles/PMC6907074?pdf=render"); // only Europe PMC had it
  assert.match(prime.abstract, /prime editing/); // the fuller abstract
  // The same title without a DOI on one side still merges; a short title never does by title alone.
  assert.equal(mergePapers([[{ ...prime, doi: "", sources: ["A"] }], [{ ...prime, doi: "10.1/x", sources: ["B"] }]]).length, 1);
  const short = { ...prime, title: "Editorial", doi: "" };
  assert.equal(mergePapers([[{ ...short }], [{ ...short }]]).length, 2);
});

test("filters and sorting", () => {
  const lists = [fromCrossref(CROSSREF), fromEuropePmc(EPMC), fromArxiv(ARXIV)];
  const merged = mergePapers(lists);
  assert.deepEqual(merged.filter((p) => keepPaper(p, { yearFrom: 2020 })).map((p) => p.year), [2024, 2020]);
  assert.deepEqual(merged.filter((p) => keepPaper(p, { openOnly: true })).length, 2);
  assert.deepEqual(sortPapers(lists, merged, "most_cited").map((p) => p.citations), [3500, 0, null]);
  assert.deepEqual(sortPapers(lists, merged, "newest").map((p) => p.year), [2024, 2020, 2019]);
  // Relevance: the first result of each catalogue before the second of any.
  assert.equal(sortPapers(lists, merged, "relevance").at(-1)!.title, "A preprint with no DOI yet");
});

test("a table row: the abstract is last and can be left out", () => {
  const row = paperRow(mergePapers([fromCrossref(CROSSREF), fromEuropePmc(EPMC)])[0]!, true);
  assert.deepEqual(Object.keys(row), ["Title", "Authors", "Year", "Journal", "Type", "Citations", "DOI", "Link", "Free full text", "Source", "Abstract"]);
  assert.equal(row.Source, "Crossref + Europe PMC");
  assert.ok(!("Abstract" in paperRow(fromArxiv(ARXIV)[0]!, false)));
});
