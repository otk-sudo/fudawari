// ビルド時に最新イベントの公開定義を取得して静的 JSON に書き出す処理（roadmap T3-11、docs/design/database.md 6 章、U7）
//
// - Supabase の REST（PostgREST）を anon の publishable key で読む（ヘッダー apikey と Authorization: Bearer）。
//   1. GET {url}/rest/v1/app_state?select=latest_event_id&id=eq.true で最新イベントの ID を読む
//   2. ID があれば GET {url}/rest/v1/published_definitions?select=content,…&event_id=eq.{ID}&order=published_at.desc&limit=1
//      で最新の公開版を 1 件読む
// - 公開版の content を validatePublicDefinition（@/domain/definition）で確かめ、通れば
//   public/data/latest-definition.json に書き出す（一般の画面は loadLatestDefinition でこのファイルだけを読む）。
// - 取得・書き出し・削除は引数で受け取る（テストでは差し替える。scripts/ の入口は Node の fetch とファイルの操作を渡して呼ぶだけ）。
// - 手本：src/lib/ship-master/generateShipMaster.ts（失敗したら書き出さない、一時的な失敗は再試行する）
//
// TODO（PR-13a）：いまは型チェックを通すための空の入れ物。中身は実装担当が書く（テストは generateLatestDefinition.test.ts）

/** 書き出し先（プロジェクトのルートからの相対パス）。一般の画面が読む LATEST_DEFINITION_PATH（/data/latest-definition.json）と同じファイル */
export const LATEST_DEFINITION_OUTPUT_PATH = "public/data/latest-definition.json";

/** 取得の応答のうち、使う部分（Node・ブラウザの fetch の Response と同じ形） */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** 取得に付けるもの（Node の fetch の RequestInit に渡せる形） */
export interface SupabaseFetchInit {
  /** apikey と Authorization: Bearer（どちらも publishable key） */
  headers: Record<string, string>;
}

/** 生成に必要な外部とのやり取りと接続先 */
export interface GenerateLatestDefinitionDeps {
  /** URL を取得する（Node の fetch をそのまま渡せる） */
  fetch: (url: string, init: SupabaseFetchInit) => Promise<FetchResponseLike>;
  /** ファイルに書き出す（書き出し先のフォルダがなければ作るのは、渡す側の役目） */
  writeFile: (path: string, content: string) => Promise<void>;
  /** ファイルを消す（ファイルがなくても失敗しないのは、渡す側の役目） */
  removeFile: (path: string) => Promise<void>;
  /** Supabase のプロジェクトの URL（例 "https://xxxx.supabase.co"。末尾の / はあってもなくてもよい）。空なら失敗する */
  supabaseUrl: string;
  /** anon の publishable key。空なら失敗する */
  publishableKey: string;
  /** 書き出し先（消すときも同じ）。省略すると LATEST_DEFINITION_OUTPUT_PATH */
  outputPath?: string;
  /**
   * 取得に失敗（例外、または ok でない応答）したときに再試行する回数（省略すると 3。最初の 1 回とは別に、取得ごとに数える）。
   * すべて失敗したら、最後の失敗の理由で失敗する。
   * 再試行しても直らない HTTP の状態（408・429 を除く 4xx）と、JSON として読めない本文は再試行しない
   */
  retries?: number;
  /** 再試行の前に待つ時間（ミリ秒。省略すると 2000。テストでは 0） */
  retryDelayMs?: number;
}

/** 生成の結果（スクリプトが表示に使う） */
export type GenerateLatestDefinitionResult =
  /** 最新イベントの公開版を書き出した */
  | {
      kind: "written";
      /** 書き出したパス */
      outputPath: string;
      /** 書き出した定義のイベント ID（event.id） */
      eventId: string;
      /** 書き出した定義のイベント名（event.name） */
      eventName: string;
      /** 書き出した定義の版の日付（event.versionDate） */
      versionDate: string;
    }
  /**
   * 最新のイベントがない（latest_event_id が null）か、最新のイベントに公開版がない。
   * 書き出し先のファイルを消した（一般の画面は 404 になり、読み込みの失敗の表示になる。テスト用の定義を本番に出さないため）
   */
  | {
      kind: "none";
      /** 消したパス */
      outputPath: string;
      /** 表示する文（「まだ公開されたイベントがありません」を含む） */
      message: string;
    };

/**
 * 最新イベントの公開版を Supabase から取得し、検証して書き出す。
 * - 最新のイベントがない・公開版がない：ファイルを消して kind: "none" で成功する（書き出さない）
 * - 次のときは理由を入れた Error で失敗し、書き出さない（消しもしない）：
 *   URL・キーが空、通信の失敗・ok でない応答（再試行してもすべて失敗。理由は最後の失敗のもの）、
 *   JSON として読めない応答、応答の形が想定と違う（app_state の行が読めないなど）、公開版が検証に通らない
 * - 通信の失敗・ok でない応答・JSON として読めない応答の Error の文には、どの表の取得か（app_state／published_definitions）、
 *   元の理由（通信の失敗の文、HTTP の状態の番号、PostgREST の誤りの message）、
 *   「Supabase のプロジェクトが停止していないか確かめてください」を入れる（無料プランは約 7 日アクセスがないと停止する）
 */
export async function generateLatestDefinition(
  deps: GenerateLatestDefinitionDeps,
): Promise<GenerateLatestDefinitionResult> {
  // 未実装（PR-13a の Red）。何もせずに「なし」を返す
  return { kind: "none", outputPath: deps.outputPath ?? LATEST_DEFINITION_OUTPUT_PATH, message: "" };
}
