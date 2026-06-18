/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@agent-usage/shared',
    '@agent-usage/pricing',
    '@agent-usage/parsers',
    '@agent-usage/core',
    '@agent-usage/ui',
  ],
  serverExternalPackages: ['better-sqlite3', 'bindings', '@agent-usage/db'],
  webpack: (config, { isServer, webpack }) => {
    if (isServer) {
      // Don't bundle these - use Node's require at runtime
      const externals = Array.isArray(config.externals) ? config.externals : [config.externals];
      externals.push({
        'better-sqlite3': 'commonjs better-sqlite3',
        bindings: 'commonjs bindings',
        '@agent-usage/db': 'commonjs @agent-usage/db',
      });
      config.externals = externals;
    }
    return config;
  },
};

export default nextConfig;
