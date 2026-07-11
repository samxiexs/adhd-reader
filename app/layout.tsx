import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title: "Focus Reader · ADHD 便利阅读器",
    description: "保持原文不变，重组阅读节奏与重点。",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Focus Reader · ADHD 便利阅读器",
      description: "让一段文字，变得更容易开始。",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Focus Reader ADHD 便利阅读器" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Focus Reader · ADHD 便利阅读器",
      description: "让一段文字，变得更容易开始。",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
