import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The repository root has its own package-lock.json for the database tooling,
  // so Next.js infers the parent as the workspace root and warns on every build.
  // This app is self-contained, so pin tracing to the app directory.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
