import type { Metadata } from "next";
import { APP_NAME } from "@/lib/branding";
// Next emits stylesheets in import order, so the vendor sheets are pulled in
// here, above globals.css, and our overrides sit later in the cascade.
// Keeping every import in one entry file is what makes that order
// predictable — see docs/DECISIONS.md D10.
//
// Draw's sheet is mostly the button bar we do not use, but it also carries
// the cursor rules (crosshair while placing corners, a grab hand over a
// vertex) that are most of what makes drawing feel like drawing.
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
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
