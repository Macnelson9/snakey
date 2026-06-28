import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Buga",
    short_name: "Buga",
    description: "The Nokia snake, now on Celo. Play instantly, earn G$.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/buga-logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/buga-logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
