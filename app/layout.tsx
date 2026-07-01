import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rudewear.lafayettelamarket.com"),
  title: "Rudewear — Strong style. No apologies.",
  description: "Menswear for men who own the room. Drops coming soon.",
  openGraph: {
    title: "Rudewear — Strong style. No apologies.",
    description: "Menswear for men who own the room. Drops coming soon.",
    type: "website",
    url: "https://rudewear.lafayettelamarket.com",
    siteName: "Rudewear",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rudewear — Strong style. No apologies.",
    description: "Menswear for men who own the room. Drops coming soon.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">{children}</body>
    </html>
  );
}
