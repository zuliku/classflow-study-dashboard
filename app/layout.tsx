import type { Metadata } from "next";
import "./globals.css";
import { MOTION_BOOTSTRAP_SCRIPT } from "@/lib/motionPreference";

export const metadata: Metadata = {
  title: "ClassFlow",
  description: "大学生课表与作业 DDL 学习管理工具",
  icons: {
    icon: "/branding/classflow-mark.png",
    shortcut: "/branding/classflow-mark.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-[#F7F5F5] text-charcoal antialiased">
        {children}
      </body>
    </html>
  );
}
