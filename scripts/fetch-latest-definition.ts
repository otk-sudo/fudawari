// ビルドの前に最新イベントの公開定義（public/data/latest-definition.json）を Supabase から取得する入口（U7・roadmap T3-11、docs/design/database.md 6 章）
//
// - 中身の処理は src/lib/definition/generateLatestDefinition.ts。ここは Node の fetch とファイルの書き込み・削除を渡すだけ。
// - 取得するのは環境変数 FETCH_LATEST_DEFINITION が "1" のときだけ（本番の Cloudflare Pages で付ける）。
//   それ以外（手元・CI）は取得を飛ばし、追跡しているテスト用の定義（public/data/latest-definition.json）をそのまま使う。
// - 接続先は環境変数 NEXT_PUBLIC_SUPABASE_URL・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY（画面のログインと同じ公開用のキー。
//   サーバー専用のキーは使わない）。
// - 取得や検証に失敗したら理由を表示して終了コード 1 で止める（古い JSON・テスト用の定義のまま公開しない）。
// - まだ公開されたイベントがなければ、ファイルを消して成功する（一般の画面は定義の読み込みの失敗を表示する）。
// - 手元で FETCH_LATEST_DEFINITION=1 を付けて実行すると、追跡しているテスト用の定義を書き換える（消す）ので、
//   確かめた後は git restore public/data/latest-definition.json で戻す。
// 実行：npx tsx scripts/fetch-latest-definition.ts（npm run build の前に自動で実行される）
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateLatestDefinition } from "@/lib/definition/generateLatestDefinition";

async function main(): Promise<void> {
  if (process.env.FETCH_LATEST_DEFINITION !== "1") {
    console.log("公開定義の取得を飛ばしました（FETCH_LATEST_DEFINITION が 1 ではない。追跡しているテスト用の定義を使います）");
    return;
  }

  const result = await generateLatestDefinition({
    // 応答が返らないまま止まらないよう、1 回の取得は 30 秒で打ち切る（打ち切りは通信の失敗として再試行される）
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    writeFile: async (path, content) => {
      const absolute = resolve(process.cwd(), path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
    },
    removeFile: async (path) => {
      await rm(resolve(process.cwd(), path), { force: true });
    },
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  });

  if (result.kind === "written") {
    console.log(
      `公開定義を取得しました：${result.outputPath}（${result.eventName}・${result.versionDate} 版・イベント ID ${result.eventId}）`,
    );
  } else {
    console.log(
      `${result.message}。公開定義のファイルを消しました（一般の画面は定義の読み込みの失敗を表示します）：${result.outputPath}`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`公開定義の取得に失敗しました：${message}`);
  process.exit(1);
});
