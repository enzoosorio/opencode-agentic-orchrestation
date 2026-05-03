/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright"],
  experimental: {},
};

export default nextConfig;
