/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright must run as a normal Node module, not be bundled.
  serverExternalPackages: ["playwright-core", "@modelcontextprotocol/sdk", "docx", "exceljs", "pptxgenjs", "jszip", "linkedom", "@mozilla/readability", "e2b", "unpdf", "sharp"],
};

export default nextConfig;
