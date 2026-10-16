import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的書き出し（U19）。`next build` で out/ に HTML・CSS・JS を出力し、Cloudflare Pages で配信する
  output: "export",
  // 静的書き出しでは画像の最適化サーバーが動かないため、最適化を無効にする
  images: { unoptimized: true },
  // `next dev` が AI エージェント向けの AGENTS.md を自動で作らないようにする（指示は CLAUDE.md にまとめている）
  agentRules: false,
};

export default nextConfig;
