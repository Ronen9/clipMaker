/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    REDIS_URL: process.env.REDIS_URL,
    WEBHOOK_URL: process.env.WEBHOOK_URL,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('ffmpeg-static');
    }
    // Add this rule to ignore warnings from fluent-ffmpeg
    config.module.rules.push({
      test: /node_modules\/fluent-ffmpeg/,
      use: 'null-loader',
    });

    // Ignore specific warnings
    config.ignoreWarnings = [
      { module: /node_modules\/fluent-ffmpeg/ },
    ];

    return config;
  },
};

export default nextConfig;
