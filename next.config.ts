import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // HTML pages — always revalidate so old devices pick up new deploys
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      headers: [
        {
          key: "Cache-Control",
          value: "no-cache, no-store, must-revalidate",
        },
        { key: "Pragma",  value: "no-cache" },
        { key: "Expires", value: "0" },
      ],
    },
    {
      // Hashed JS/CSS/font chunks — safe to cache long-term (filenames change on rebuild)
      source: "/_next/static/(.*)",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    },
  ],
};

export default nextConfig;
