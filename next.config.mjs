/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained .next/standalone build (server.js + only the
  // node_modules actually used) - keeps the Docker image small instead of
  // shipping the full node_modules tree. Required by Dockerfile.
  output: 'standalone',
};

export default nextConfig;
