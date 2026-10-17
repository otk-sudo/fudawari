// ビルド時に最新イベントの公開定義を取得して静的 JSON に書き出す処理（roadmap T3-11、docs/design/database.md 6 章、U7）
//
// - Supabase の REST（PostgREST）を anon の publishable key で読む（ヘッダー apikey と Authorization: Bearer）。
//   1. GET {url}/rest/v1/app_state?select=latest_event_id&id=eq.true で最新イベントの ID を読む
//   2. ID があれば GET {url}/rest/v1/published_definitions?select=content,…&event_id=eq.{ID}&order=published_at.desc&limit=1
//      で最新の公開版を 1 件読む
// - 公開版の content を validatePublicDefinition（@/domain/definition）で確かめ、通れば検証済みの値を
//   public/data/latest-definition.json に書き出す（一般の画面は loadLatestDefinition でこのファイルだけを読む）。
// - 公開版の event.id が最新イベントの ID と違えば失敗にする（publish_definition が event.id をイベント ID に書き直すので、ふつうは一致する）。
// - 取得・書き出し・削除は引数で受け取る（テストでは差し替える。scripts/ の入口は Node の fetch とファイルの操作を渡して呼ぶだけ）。
// - 手本：src/lib/ship-master/generateShipMaster.ts（失敗したら書き出さない、一時的な失敗は再試行する）
import { type DefinitionError, validatePublicDefinition } from "@/domain/definition";

/** 書き出し先（プロジェクトのルートからの相対パス）。一般の画面が読む LATEST_DEFINITION_PATH（/data/latest-definition.json）と同じファイル */
export const LATEST_DEFINITION_OUTPUT_PATH = "public/data/latest-definition.json";

/** 取得の再試行の回数の既定値（最初の 1 回とは別に、取得ごとに数える） */
const DEFAULT_RETRIES = 3;

/** 再試行の前に待つ時間の既定値（ミリ秒） */
const DEFAULT_RETRY_DELAY_MS = 2000;

/** 取得の失敗の Error の文に入れる案内（無料プランは約 7 日アクセスがないと停止する。再開はユーザーが行う） */
const PAUSED_HINT =
  "Supabase のプロジェクトが停止していないか確かめてください（無料プランは約 7 日アクセスがないと停止します）";

/** まだ公開されたイベントがないときの結果の文の書き出し */
const NONE_MESSAGE = "まだ公開されたイベントがありません";

/** 検証の失敗の Error の文に並べる誤りの数の上限（残りは「ほか n 件」とまとめる） */
const MAX_ERRORS_IN_MESSAGE = 10;

/** 読む表 */
type Table = "app_state" | "published_definitions";

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
  /**
   * Supabase のプロジェクトの URL（例 "https://xxxx.supabase.co"。末尾の / はあってもなくてもよい）。
   * 前後の空白は除く。空・URL として読めなければ失敗する
   */
  supabaseUrl: string;
  /** anon の publishable key。前後の空白は除く。空なら失敗する */
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
 *   URL・キーが空（前後の空白を除いて）・URL として読めない、
 *   通信の失敗・ok でない応答（再試行してもすべて失敗。理由は最後の失敗のもの）、
 *   JSON として読めない応答、応答の形が想定と違う（app_state の行が読めないなど）、公開版が検証に通らない、
 *   公開版の event.id が最新イベントの ID と違う
 * - 通信の失敗・ok でない応答・JSON として読めない応答の Error の文には、どの表の取得か（app_state／published_definitions）、
 *   元の理由（通信の失敗の文、HTTP の状態の番号、PostgREST の誤りの message）、
 *   「Supabase のプロジェクトが停止していないか確かめてください」を入れる（無料プランは約 7 日アクセスがないと停止する）
 */
export async function generateLatestDefinition(
  deps: GenerateLatestDefinitionDeps,
): Promise<GenerateLatestDefinitionResult> {
  const outputPath = deps.outputPath ?? LATEST_DEFINITION_OUTPUT_PATH;
  const baseUrl = readBaseUrl(deps.supabaseUrl);
  const publishableKey = deps.publishableKey.trim();
  if (publishableKey === "") {
    throw new Error("Supabase の publishable key が空です（ビルドでは環境変数 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY）");
  }

  const reader: TableReader = {
    fetch: deps.fetch,
    baseUrl,
    headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
    retries: deps.retries ?? DEFAULT_RETRIES,
    retryDelayMs: deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  };

  // 1. 最新イベントの ID
  const latestEventId = readLatestEventId(
    await readTable(reader, "app_state", { select: "latest_event_id", id: "eq.true" }),
  );
  if (latestEventId === null) {
    await deps.removeFile(outputPath);
    return { kind: "none", outputPath, message: `${NONE_MESSAGE}（最新のイベントが決まっていません）` };
  }

  // 2. 最新イベントの最新の公開版（公開日時の新しい順に 1 件）
  const publishedRow = readPublishedRow(
    await readTable(reader, "published_definitions", {
      select: "content,version_label,published_at",
      event_id: `eq.${latestEventId}`,
      order: "published_at.desc",
      limit: "1",
    }),
  );
  if (publishedRow === null) {
    await deps.removeFile(outputPath);
    return {
      kind: "none",
      outputPath,
      message: `${NONE_MESSAGE}（最新のイベント ${latestEventId} に公開版がありません）`,
    };
  }

  // 3. 検証（一般の画面の読み込みと同じ検証。壊れた定義を配らない）
  const validation = validatePublicDefinition(publishedRow.content);
  if (!validation.ok) {
    throw new Error(
      `published_definitions の公開版（イベント ${latestEventId}）が検証に通りません` +
        `（${errorList(validation.errors)}）。壊れた定義を配らないよう止めました`,
    );
  }
  const definition = validation.value;
  if (definition.event.id !== latestEventId) {
    throw new Error(
      `published_definitions の公開版のイベント ID（${definition.event.id}）が、` +
        `app_state の最新のイベント ID（${latestEventId}）と違います。別のイベントの定義を配らないよう止めました`,
    );
  }

  // 4. 書き出し（検証済みの値。DB の列〔版の表示など〕は入れない）
  await deps.writeFile(outputPath, JSON.stringify(definition));
  return {
    kind: "written",
    outputPath,
    eventId: definition.event.id,
    eventName: definition.event.name,
    versionDate: definition.event.versionDate,
  };
}

/** Supabase のプロジェクトの URL を整える（前後の空白と末尾の / を除く）。空・URL として読めなければ失敗する */
function readBaseUrl(supabaseUrl: string): string {
  const baseUrl = supabaseUrl.trim().replace(/\/+$/, "");
  if (baseUrl === "") {
    throw new Error("Supabase のプロジェクトの URL が空です（ビルドでは環境変数 NEXT_PUBLIC_SUPABASE_URL）");
  }
  if (!URL.canParse(`${baseUrl}/rest/v1/`)) {
    // 取得のたびに URL の誤りで失敗して再試行しないよう、先に止める
    throw new Error(`Supabase のプロジェクトの URL として読めません：${baseUrl}`);
  }
  return baseUrl;
}

/** 表を読むのに使うもの */
interface TableReader {
  fetch: GenerateLatestDefinitionDeps["fetch"];
  /** 末尾の / を除いたプロジェクトの URL */
  baseUrl: string;
  headers: Record<string, string>;
  retries: number;
  retryDelayMs: number;
}

/** 1 回の取得の結果 */
type FetchAttempt =
  | { ok: true; body: string }
  | {
      ok: false;
      /** 失敗の理由を入れた Error（すべて失敗したときに投げる） */
      error: Error;
      /** 再試行すれば直るかもしれない失敗か */
      retryable: boolean;
    };

/**
 * 表を読んで、JSON として読んだ応答を返す。
 * 取得に失敗したら retryDelayMs 待って retries 回まで再試行し、すべて失敗なら最後の理由で失敗する。
 * JSON として読めない応答は、再試行せずに失敗する（停止中のプロジェクトの案内の HTML など）
 */
async function readTable(reader: TableReader, table: Table, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${reader.baseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  const endpoint = `${url.origin}${url.pathname}`;

  const body = await fetchWithRetry(reader, table, endpoint, url.toString());
  try {
    const data: unknown = JSON.parse(body);
    return data;
  } catch (error) {
    throw new Error(`${table} の応答を JSON として読めませんでした（${endpoint}）：${messageOf(error)}。${PAUSED_HINT}`, {
      cause: error,
    });
  }
}

/** 本文を取得する。失敗したら retryDelayMs 待って retries 回まで再試行し、すべて失敗なら最後の理由で失敗する */
async function fetchWithRetry(reader: TableReader, table: Table, endpoint: string, url: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await fetchOnce(reader, table, endpoint, url);
    if (result.ok) return result.body;
    if (!result.retryable || attempt >= reader.retries) throw result.error;
    await wait(reader.retryDelayMs);
  }
}

/** 1 回取得する（例外は投げず、結果として返す） */
async function fetchOnce(reader: TableReader, table: Table, endpoint: string, url: string): Promise<FetchAttempt> {
  let response: FetchResponseLike;
  try {
    response = await reader.fetch(url, { headers: reader.headers });
  } catch (error) {
    return { ok: false, error: fetchFailure(table, endpoint, messageOf(error), error), retryable: true };
  }
  if (!response.ok) {
    const detail = await postgrestMessage(response);
    return {
      ok: false,
      error: fetchFailure(table, endpoint, `HTTP の状態 ${response.status}${detail === null ? "" : `（${detail}）`}`),
      retryable: !isPermanentHttpFailure(response.status),
    };
  }
  try {
    return { ok: true, body: await response.text() };
  } catch (error) {
    // 本文を受け取る途中で切れたなど。通信の失敗と同じく再試行する
    return { ok: false, error: fetchFailure(table, endpoint, messageOf(error), error), retryable: true };
  }
}

/** ok でない応答の本文が PostgREST の誤り（JSON の message）なら、その文を返す。読めなければ null */
async function postgrestMessage(response: FetchResponseLike): Promise<string | null> {
  try {
    const body: unknown = JSON.parse(await response.text());
    return isRecord(body) && typeof body.message === "string" && body.message !== "" ? body.message : null;
  } catch {
    // 本文が受け取れない・JSON でないときは、状態の番号だけで伝える
    return null;
  }
}

/**
 * 再試行しても直らない HTTP の状態か（4xx。キーの誤り・権限の誤りなど）。
 * 408（Request Timeout）・429（Too Many Requests）は一時的な失敗なので再試行する
 */
function isPermanentHttpFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * app_state の応答から最新イベントの ID を読む（ない＝null）。
 * 行がない・latest_event_id が文字列でも null でもないときは、応答の形の誤りとして失敗する
 * （「公開されたイベントがない」とみなしてファイルを消さないため）
 */
function readLatestEventId(rows: unknown): string | null {
  if (!Array.isArray(rows)) {
    throw new Error("app_state の応答が配列ではありません（PostgREST の応答の形が想定と違います）");
  }
  const row: unknown = rows[0];
  if (row === undefined) {
    throw new Error("app_state の行がありません（RLS の設定の誤りか、接続先のプロジェクトが違う可能性があります）");
  }
  if (!isRecord(row) || !("latest_event_id" in row)) {
    throw new Error("app_state の行に latest_event_id がありません");
  }
  const id = row.latest_event_id;
  if (id !== null && typeof id !== "string") {
    throw new Error(`app_state の latest_event_id が文字列でも null でもありません：${JSON.stringify(id)}`);
  }
  return id;
}

/** published_definitions の応答の行（使う部分） */
interface PublishedRow {
  /** 公開版の定義の文書（検証の前なので形は分からない） */
  content: unknown;
}

/** published_definitions の応答から公開版の行を読む（ない＝null）。形が違えば失敗する */
function readPublishedRow(rows: unknown): PublishedRow | null {
  if (!Array.isArray(rows)) {
    throw new Error("published_definitions の応答が配列ではありません（PostgREST の応答の形が想定と違います）");
  }
  const row: unknown = rows[0];
  if (row === undefined) return null;
  if (!isRecord(row) || !("content" in row)) {
    throw new Error("published_definitions の行に content がありません");
  }
  return { content: row.content };
}

/** 検証の誤りの一覧の文。場所と理由を先頭から上限まで並べ、残りは件数だけを書く */
function errorList(errors: readonly DefinitionError[]): string {
  const shown = errors
    .slice(0, MAX_ERRORS_IN_MESSAGE)
    .map((error) => (error.path === "" ? error.message : `${error.path}：${error.message}`));
  const rest = errors.length - shown.length;
  return rest > 0 ? `${shown.join("／")} ほか ${rest} 件` : shown.join("／");
}

/** ms ミリ秒待つ（0 以下なら待たない） */
function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 取得の失敗の Error（表の名前・取得先・元の理由・停止の確認の案内を入れる） */
function fetchFailure(table: Table, endpoint: string, reason: string, cause?: unknown): Error {
  return new Error(`${table} の取得に失敗しました（${endpoint}）：${reason}。${PAUSED_HINT}`, { cause });
}

/** オブジェクト（配列・null 以外）か */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 失敗の理由の文（Error ならその文、ほかは文字列にしたもの）。
 * Node の fetch は通信の失敗を「fetch failed」とだけ言い、元の理由（ECONNREFUSED・ENOTFOUND など）を cause に入れるので、それも添える
 */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause: unknown = error.cause;
  return cause instanceof Error && cause.message !== "" && cause.message !== error.message
    ? `${error.message}（${cause.message}）`
    : error.message;
}
