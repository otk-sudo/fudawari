import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * ビルドの前に生成する艦船マスタ（プロジェクトのルートからの相対パス）。
 * src/lib/ship-master/generateShipMaster.ts の SHIP_MASTER_OUTPUT_PATH と同じ値（設定ファイルからは @/ の別名で読めないため書き写す）
 */
const SHIP_MASTER_PATH = "public/data/ship-master.json";

/**
 * `next build` として動いているか。
 * `next typegen`（npm run typecheck。CI ではマスタの生成より前に動く）も同じ PHASE_PRODUCTION_BUILD で設定を読むため、
 * phase だけでは見分けられない。コマンドの最初の引数（オプションを除く）で見分ける
 */
function isNextBuildCommand(): boolean {
  return process.argv.slice(2).find((arg) => !arg.startsWith("-")) === "build";
}

/**
 * 設定（phase を受け取る関数の形）。
 * 本番のビルド（`next build`）のときに艦船マスタがなければ、マスタのない静的書き出しを作らないよう止める
 * （`npx next build` を直接実行すると、prebuild のマスタの生成が動かないため）。開発サーバーでは止めない
 */
export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD && isNextBuildCommand() && !existsSync(join(process.cwd(), SHIP_MASTER_PATH))) {
    throw new Error(
      `艦船マスタ（${SHIP_MASTER_PATH}）がありません。` +
        "`npm run build`（prebuild でマスタを生成する）でビルドしてください",
    );
  }

  return {
    // 静的書き出し（U19）。`next build` で out/ に HTML・CSS・JS を出力し、Cloudflare Pages で配信する
    output: "export",
    // 静的書き出しでは画像の最適化サーバーが動かないため、最適化を無効にする
    images: { unoptimized: true },
    // `next dev` が AI エージェント向けの AGENTS.md を自動で作らないようにする（指示は CLAUDE.md にまとめている）
    agentRules: false,
  };
}
