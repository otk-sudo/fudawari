import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DISPLAY_BOOT_SCRIPT, SettingsContent, SettingsSync } from "@/features/settings";
import {
  DEFAULT_THEME_MODE,
  ThemeSync,
  themeAttributeFor,
} from "@/features/theme";
import { APP_NAME } from "@/lib/app-name";
import "@/styles/theme.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  // 各画面は metadata.title に画面名だけを書く（例「札割り一覧 | 札割りプランナー」になる）
  title: { default: APP_NAME, template: `%s | ${APP_NAME}` },
  description: "艦これのイベントで、特効を踏まえてどの艦をどの札に回すかを計画するツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  // data-theme は画面モードの初期値で書き出す（読み込み直後に端末の設定の色が一瞬出ないように）。
  // 保存した画面モード・文字の大きさは、<head> のスクリプトが描画の前に控え（localStorage）から <html> に付ける
  // （そのため <html> の属性は書き出した値と違うことがあり、ハイドレーションの食い違いの警告を出さない）。
  // 切り替えたあとは ThemeSync・SettingsSync が書き換える
  return (
    <html lang="ja" data-theme={themeAttributeFor(DEFAULT_THEME_MODE)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_BOOT_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <SettingsSync />
        <AppShell>{children}</AppShell>
        {/* 設定のウィンドウは全画面で 1 つ。中身（表示・データの設定）を差し込む */}
        <SettingsDialog>
          <SettingsContent />
        </SettingsDialog>
      </body>
    </html>
  );
}
