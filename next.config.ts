import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Playwright + Chromium binary out of the Next.js bundler. Without
  // this, Vercel reports:
  //   The input directory "/var/task/node_modules/@sparticuz/chromium/bin" does not exist.
  // because Turbopack tries to inline the package and the binary path is
  // lost. These have to stay as plain node_modules imports.
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
};

export default nextConfig;
