// 差分の画面の画面名。ページ（サーバーで描く src/app/drift/page.tsx）の metadata と画面の h1 の両方から読むため、
// "use client" のファイルとは分けている（"use client" のファイルから読んだ値は、サーバーの部品では文字列として使えない）

/** 画面名（h1 とページのタイトル） */
export const DRIFT_SCREEN_TITLE = "計画と実際の札";
