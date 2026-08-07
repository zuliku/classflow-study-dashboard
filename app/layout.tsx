import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClassFlow - 大学生课表与作业 DDL 学习管理系统",
  description: "大学生课表与作业 DDL 学习管理工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#F7F5F5] text-[#313032] antialiased">
        {children}
      </body>
    </html>
  );
}
