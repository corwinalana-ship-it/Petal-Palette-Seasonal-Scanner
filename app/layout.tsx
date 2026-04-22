import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Apricity — Petal Palettes Seasonal Color Analysis",
  description:
    "AI-powered 12-season color analysis. Upload a selfie and discover your seasonal palette.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
