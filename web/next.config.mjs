import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');

// Force-load .env.local and root .env so process.env is populated
// even when the server restarts or CWD changes.
loadEnvConfig(process.cwd());
loadEnvConfig(new URL('..', import.meta.url).pathname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
