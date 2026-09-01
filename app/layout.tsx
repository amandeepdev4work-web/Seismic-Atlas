import type { Metadata } from "next";
import { APP_NAME } from "@/lib/branding";
// Next emits stylesheets in import order, so mapbox-gl.css is pulled in
// here, above globals.css, and our popup overrides sit later in the
// cascade. Keeping both imports in one entry file is what makes that
// order predictable — see docs/DECISIONS.md D10.
import "mapbox-gl/dist/mapbox-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "An interactive map of recent earthquakes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
