// Logging allowlist proxy between the local oovi server and the oovi account service.
// Only model calls and the model status pass; everything else (setup sync, cloud sync, reports, usage) is refused
// so a test run can't change the account. Every model call is logged with sizes and the provider's usage numbers.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const UP = "https://oovi.conuron.com";
const OUT = process.env.LAB_OUT;
const PORT = Number(process.env.PROXY_PORT) || 4701;
fs.mkdirSync(path.join(OUT, "calls"), { recursive: true });
let n = 0;
const ALLOW = [/^\/api\/v1\/ai\/messages$/, /^\/api\/v1\/ai\/status$/];
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const url = req.url.split("?")[0];
    const raw = Buffer.concat(chunks);
    if (!ALLOW.some((r) => r.test(url))) {
      fs.appendFileSync(path.join(OUT, "blocked.log"), `${new Date().toISOString()} ${req.method} ${req.url}\n`);
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "blocked by the test proxy" }));
    }
    const headers = { ...req.headers };
    delete headers.host; delete headers["content-length"]; delete headers.connection;
    const t0 = Date.now();
    let up, text;
    try {
      up = await fetch(UP + req.url, { method: req.method, headers, body: req.method === "GET" ? undefined : raw });
      text = await up.text();
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: String(e.message) }));
    }
    if (url === "/api/v1/ai/messages") {
      const id = String(++n).padStart(3, "0");
      let b = {}, j = {};
      try { b = JSON.parse(raw.toString("utf8")); } catch {}
      try { j = JSON.parse(text); } catch {}
      fs.writeFileSync(path.join(OUT, "calls", `${id}-req.json`), JSON.stringify(b, null, 1));
      fs.writeFileSync(path.join(OUT, "calls", `${id}-res.json`), JSON.stringify(j, null, 1));
      const sys = (Array.isArray(b.system) ? b.system.map((x) => x.text || "").join("") : String(b.system || ""));
      const tools = b.tools || [];
      const msgChars = JSON.stringify(b.messages || []).length;
      const u = j.usage || {};
      const calls = (j.content || []).filter((c) => c.type === "tool_use").map((c) => c.name === "use_tool" ? `use_tool(${c.input?.name}${c.input?.input ? "+input" : ""})` : c.name);
      const line = { id, ms: Date.now() - t0, status: up.status, sysChars: sys.length, tools: tools.length, toolChars: JSON.stringify(tools).length, msgs: (b.messages || []).length, msgChars, effort: b.effort ?? "auto", thinking: b.thinking, in: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, out: u.output_tokens, credits: j.oovi?.credits, stop: j.stop_reason, calls, text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join(" ").slice(0, 160), err: j.error };
      fs.appendFileSync(path.join(OUT, "calls.jsonl"), JSON.stringify(line) + "\n");
    }
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/json" });
    res.end(text);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`[proxy] ${PORT} -> ${UP}, log in ${OUT}`));
