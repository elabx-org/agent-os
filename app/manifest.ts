import type { MetadataRoute } from "next";

// Installing to the home screen drops Safari's address bar, which on short
// screens (iPhone Duo outer display with the keyboard up) is terminal rows
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentOS",
    short_name: "AgentOS",
    description: "AI Agent Command Center",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
