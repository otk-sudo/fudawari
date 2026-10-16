"use client";

import type { ReactNode } from "react";
import { DataSettings } from "./DataSettings";
import { DisplaySettings } from "./DisplaySettings";
import styles from "./SettingsContent.module.css";

/**
 * 設定のウィンドウの中身（要件 3.6、roadmap T2-12、U13・U21、モック SettingsDialog.dc.html）。
 * レイアウトで `<SettingsDialog><SettingsContent /></SettingsDialog>` と差し込む。ウィンドウが開いている間だけ描かれる。
 *
 * - 表示（DisplaySettings）：画面モード・文字の大きさ・控えの表示・控えの並び順
 * - データ（DataSettings）：札割りの書き出し・読み込み、取り込んだ艦娘データを削除
 * - アカウント（協力者・管理者だけ）は、データの後に置く（PR-10b の AccountSection を取り込んでから足す）
 */
export function SettingsContent(): ReactNode {
  return (
    <div className={styles.content}>
      <DisplaySettings />
      <DataSettings />
      {/* アカウントの欄（PR-10b の AccountSection）はここに置く */}
    </div>
  );
}
