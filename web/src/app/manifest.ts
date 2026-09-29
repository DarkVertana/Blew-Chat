import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1faa69",
    icons: [
      { src: "/notification-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/notification-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
