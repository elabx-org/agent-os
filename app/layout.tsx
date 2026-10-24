import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
import "./globals.css";

// IBM Plex: the Duo redesign's type (variable names kept for globals.css)
const geistSans = IBM_Plex_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = IBM_Plex_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
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
        {/* Theme initialization script - prevents flash of unstyled content */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Get theme from localStorage (where next-themes stores it)
                  const theme = localStorage.getItem('theme') || 'dark';
                  const root = document.documentElement;

                  // Handle system theme
                  let actualTheme = theme;
                  if (theme === 'system') {
                    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    actualTheme = isDark ? 'dark' : 'light';
                  }

                  // Parse compound themes like "dark-warm" or "light-default"
                  const parts = actualTheme.split('-');
                  const mode = parts[0];
                  const variant = parts[1];

                  // Apply theme class
                  root.classList.remove('light', 'dark');
                  root.classList.add(mode === 'dark' || mode === 'light' ? mode : 'dark');

                  // Apply variant as data attribute
                  // "deep" and "default" are base themes - no data attribute needed
                  root.removeAttribute('data-theme-variant');
                  if (variant && variant !== 'default' && variant !== 'deep') {
                    root.setAttribute('data-theme-variant', variant);
                  }
                } catch (e) {
                  // Fallback to dark mode if anything fails
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            className: "!bg-card !border-border !text-foreground !shadow-lg",
          }}
        />
      </body>
    </html>
  );
}
