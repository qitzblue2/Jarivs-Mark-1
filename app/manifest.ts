import type { MetadataRoute } from "next";

/**
 * Makes JARVIS installable: "Install app" in Chrome and Edge, "Add to Home
 * Screen" on a phone. It opens in its own window with no browser chrome.
 *
 * There is deliberately no service worker. Caching the app shell offline would
 * mean an installed copy could keep running an old build after you update the
 * server, and the app is useless without the server anyway — it says so
 * (the banner at the top) when it can't reach it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "JARVIS Mark 6",
    short_name: "JARVIS",
    description: "A self-hosted AI workspace running on free, fast inference.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0d13",
    theme_color: "#0a0d13",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
