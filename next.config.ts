import type { NextConfig } from "next";

const useStandalone = process.env.NEXT_DISABLE_STANDALONE !== "1";

const nextConfig: NextConfig = useStandalone
  ? { output: "standalone", serverExternalPackages: ["better-sqlite3"] }
  : { serverExternalPackages: ["better-sqlite3"] };

export default nextConfig;
