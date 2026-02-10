import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@google-cloud/bigquery"],
  env: {
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? "true"
        : "",
  },
};

export default nextConfig;
