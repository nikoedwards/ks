import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'unzipper', 'csv-parse', 'node-cron'],
};

export default nextConfig;
