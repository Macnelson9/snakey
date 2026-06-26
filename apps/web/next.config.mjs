/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine ships as raw TypeScript (single source of truth for client and
  // server), so Next must transpile it rather than expecting prebuilt JS.
  transpilePackages: ["@nokiadot/engine"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
