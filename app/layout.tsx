import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "매화수련록";
const description = "하루의 약속을 기록하고, 한 주의 수련을 이어가는 계획표";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    requestHeaders.get("host") ||
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (host.startsWith("localhost") ? "http" : "https");
  let imageUrl = "http://localhost:3000/og-maewha-suryunrok.png";

  try {
    imageUrl = new URL(
      "/og-maewha-suryunrok.png",
      `${protocol}://${host}`,
    ).toString();
  } catch {
    // Keep the local fallback when an upstream sends a malformed host header.
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ko_KR",
      images: [{ url: imageUrl, width: 1730, height: 909, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
