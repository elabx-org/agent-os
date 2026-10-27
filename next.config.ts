import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Its binary is found on disk at run time, not bundled
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
