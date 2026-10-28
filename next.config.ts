import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The budget Lua scripts and prompt files are read from disk by server routes,
  // so they must be traced into every API function bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./budget/*.lua", "./budget/prices.json", "./prompts/**/*"],
  },
  serverExternalPackages: ["sharp"],
  poweredByHeader: false,
};

export default nextConfig;
