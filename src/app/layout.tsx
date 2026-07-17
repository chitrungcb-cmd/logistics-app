import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Logistics App",
  description: "Hệ thống quản lý logistics",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      {/* Một số tiện ích ký số nghiệp vụ chèn class vào body trước khi React hydrate. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
