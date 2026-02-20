import type { NextConfig } from "next";

const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL?.replace(/\/+$/, "") ?? "";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  async rewrites() {
    if (!serverUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${serverUrl}/api/:path*`,
      },
      {
        source: "/openapi/:path*",
        destination: `${serverUrl}/openapi/:path*`,
      },
    ];
  },
};

export default nextConfig;
