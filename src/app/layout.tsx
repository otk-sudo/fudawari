import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@/styles/theme.css";
import "@/styles/globals.css";

// アプリ名は「札割りプランナー」（U4 で決定）。文字列を 1 か所にまとめるのは PR-03（T1-4）で行う
export const metadata: Metadata = {
  title: "札割りプランナー",
  description: "艦これのイベントで、特効を踏まえてどの艦をどの札に回すかを計画するツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  // data-theme はまだ付けない（付けていない間は端末の設定に従う）。切り替えは設定の機能で行う
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
