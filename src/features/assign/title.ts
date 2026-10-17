// 割り振り画面の画面名（h1 とページの title）。
// ページ（src/app/assign/page.tsx。サーバーの部品）の metadata からも読むため、"use client" の部品のファイルとは分けて置く
// （"use client" のファイルから読んだ値は、サーバーの部品では文字列として使えない）

/** 割り振り画面の画面名 */
export const ASSIGN_SCREEN_TITLE = "割り振り";
