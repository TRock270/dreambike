import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// IBM Plex, SIL Open Font License; credited in README/CREDITS.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"], weight: ["400", "500", "600"], variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "DreamBike",
  description: "Custom motorcycle visualization, build sheet, fit pre-check, and estimate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
