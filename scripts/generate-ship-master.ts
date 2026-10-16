// ビルドの前に艦船マスタ（public/data/ship-master.json）を生成する入口（U1・roadmap T1-5）
//
// - 中身の処理は src/lib/ship-master/generateShipMaster.ts。ここは Node の fetch とファイルの書き込みを渡すだけ。
// - 取得や解析に失敗したら理由を表示して終了コード 1 で止める（古いマスタのまま公開しない）。
// - 手元で通信できないときなどに、既にあるマスタを使い回したい場合は SKIP_SHIP_MASTER=1 を付けて実行する
//   （ファイルがなければ止める）。CI と Cloudflare Pages では付けない。
// - `--if-missing` を付けると、ファイルがあるときは生成しない（npm run dev の前の predev で使う。開発サーバーを
//   起動するたびに取得しないため。最新にしたいときは npm run generate:ship-master を実行する）
// 実行：npx tsx scripts/generate-ship-master.ts（npm run build の前に自動で実行される）
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateShipMaster, SHIP_MASTER_OUTPUT_PATH } from "@/lib/ship-master/generateShipMaster";

async function main(): Promise<void> {
  const outputPath = resolve(process.cwd(), SHIP_MASTER_OUTPUT_PATH);

  if (process.argv.includes("--if-missing") && (await exists(outputPath))) {
    console.log(`艦船マスタはすでにあります（--if-missing のため生成しません）：${SHIP_MASTER_OUTPUT_PATH}`);
    return;
  }

  if (process.env.SKIP_SHIP_MASTER === "1") {
    try {
      await access(outputPath);
      console.log(`艦船マスタの生成を飛ばしました（SKIP_SHIP_MASTER=1）。既存のファイルを使います：${SHIP_MASTER_OUTPUT_PATH}`);
      return;
    } catch {
      throw new Error(`SKIP_SHIP_MASTER=1 が指定されていますが、${SHIP_MASTER_OUTPUT_PATH} がありません`);
    }
  }

  const result = await generateShipMaster({
    // 応答が返らないまま止まらないよう、1 回の取得は 30 秒で打ち切る（打ち切りは通信の失敗として再試行される）
    fetch: (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
    writeFile: async (path, content) => {
      const absolute = resolve(process.cwd(), path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
    },
  });
  console.log(`艦船マスタを生成しました：${result.outputPath}（${result.shipCount} 隻）`);
}

// ファイルがあるか
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`艦船マスタの生成に失敗しました：${message}`);
  process.exit(1);
});
