import type { Metadata, Viewport } from "next";
import "highlight.js/styles/github-dark.css";
import "./globals.css";
import { INIT_SCRIPT } from "@/lib/appearance";
import { PREFS_INIT_SCRIPT } from "@/lib/prefs";

export const metadata: Metadata = {
  title: "JARVIS Mark 6",
  description: "A self-hosted AI workspace running on free, fast inference.",
  applicationName: "JARVIS",
  appleWebApp: { capable: true, title: "JARVIS", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Updated to the chosen theme's colour once the app is running; this is the
  // right answer for the dark theme, which is what the first paint assumes.
  themeColor: "#0a0d13",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the script below sets attributes on <html>
    // before React sees it, which is the point, and not a mismatch to report.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Before first paint, so the chosen theme never flashes the other one. */}
        <script dangerouslySetInnerHTML={{ __html: INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: PREFS_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
