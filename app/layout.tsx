import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, JetBrains_Mono } from "next/font/google";
import { AppToaster } from "@/components/AppToaster";
import { Providers } from "@/components/Providers";
import { DENSITY_BOOT_SCRIPT } from "@/lib/display-density";
import { BACKGROUND_BOOT_SCRIPT } from "@/lib/background";
import { LOOK_BOOT_SCRIPT } from "@/lib/look";
import "./globals.css";

// Inter and JetBrains Mono: the modern look's type (variable names kept for
// globals.css). The terminal asks for "JetBrains Mono" by name and waits for
// it before measuring its cells (components/Terminal/font-ready.ts).
const geistSans = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// The terminal's other font (Settings → Display), fetched only when chosen
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
  preload: false,
});

export const metadata: Metadata = {
  title: "AgentOS",
  description: "AI Agent Command Center",
  icons: {
    icon: "/icon.svg",
    apple: "/icon-180.png",
  },
  appleWebApp: {
    capable: true,
    title: "AgentOS",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Per-display text size, set before paint */}
        <script dangerouslySetInnerHTML={{ __html: DENSITY_BOOT_SCRIPT }} />
        {/* Mode class and accent before paint; maps pre-redesign themes */}
        <script dangerouslySetInnerHTML={{ __html: LOOK_BOOT_SCRIPT }} />
        {/* This device's own background, if any, over the theme's */}
        <script dangerouslySetInnerHTML={{ __html: BACKGROUND_BOOT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${plexMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
        <AppToaster />
      </body>
    </html>
  );
}
