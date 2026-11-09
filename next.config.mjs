/** @type {import('next').NextConfig} */
const nextConfig = {
  // The desktop app ships .next/standalone: the server plus only the files it really uses
  // (no build tools such as the SWC compiler). scripts/prepare-server.mjs adds the static files.
  output: "standalone",
  // Playwright must run as a normal Node module, not be bundled.
  serverExternalPackages: ["playwright-core", "@modelcontextprotocol/sdk", "docx", "exceljs", "pptxgenjs", "jszip", "linkedom", "@mozilla/readability", "e2b", "unpdf", "sharp"],
  // These load some of their own files by computed paths, which file tracing can't see: ship them whole.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/playwright-core/**/*", "./node_modules/unpdf/**/*"],
  },
  experimental: {
    // Load each page's code the first time it's used, not all of it at start: faster start, less memory.
    preloadEntriesOnStart: false,
  },
};

export default nextConfig;
