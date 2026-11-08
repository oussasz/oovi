/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright must run as a normal Node module, not be bundled.
  serverExternalPackages: ["playwright-core", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
