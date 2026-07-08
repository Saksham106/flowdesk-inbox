/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enables instrumentation.ts's register() hook, which boots the
  // in-process background job scheduler (lib/scheduler) on server start.
  // Next.js 14 requires this flag explicitly; it's unflagged/default in 15+.
  experimental: {
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
