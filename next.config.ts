import type { NextConfig } from "next";

const isVercelBuild =
  process.env.VERCEL === "1" || process.env.BUILD_TARGET === "vercel";

const nextConfig: NextConfig = {
  ...(isVercelBuild
    ? {
        env: {
          NEXT_PUBLIC_PLAN_STORAGE_MODE: "local",
        },
        turbopack: {
          resolveAlias: {
            "cloudflare:workers": "./db/vercel-cloudflare-workers.ts",
          },
        },
      }
    : {
        /* Sites keeps the real Cloudflare Workers runtime module. */
      }),
};

export default nextConfig;
