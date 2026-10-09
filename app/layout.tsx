import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
});

const SITE_URL = "https://dependencyzero.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Dependency Zero — Zero Trust. Before Execution.",
  description:
    "Real-time dependency security network for AI agents and developers on Solana. Intercept every dependency before execution, verify it across independent scanner nodes, and attest the verdict on-chain.",
  keywords: [
    "dependency security",
    "supply chain security",
    "AI agent security",
    "Solana",
    "zero trust",
    "scanner nodes",
    "package scanning",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Dependency Zero",
    title: "Dependency Zero — Zero Trust. Before Execution.",
    description:
      "Real-time dependency security network for AI agents and developers on Solana.",
    images: [
      {
        url: "/hero-poster.jpg",
        width: 1280,
        height: 720,
        alt: "Dependency Zero dependency interception and scanner network",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dependency Zero — Zero Trust. Before Execution.",
    description:
      "Real-time dependency security network for AI agents and developers on Solana.",
    images: ["/hero-poster.jpg"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#F1EFE8",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${ibmPlexMono.variable}`}
    >
      <body className="bg-bone text-ink antialiased">{children}</body>
    </html>
  );
}