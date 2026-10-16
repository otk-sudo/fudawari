// 最新イベントの公開定義の読み込み（roadmap T2-3、要件 5 章）
//
// - 一般の画面は、静的ファイル（public/data/latest-definition.json）だけを読む。Supabase には通信しない。
// - 取得した文字列は parsePublicDefinition（@/domain/definition）で検証してから使う。
// - 例外は投げず、結果（DefinitionLoadResult）で返す。取得の失敗と検証の失敗は kind で区別する。
import {
  type DefinitionError,
  parsePublicDefinition,
  type PublicDefinition,
} from "@/domain/definition";

/** 最新イベントの公開定義の置き場所（ファイルは public/data/latest-definition.json）。ビルド時の生成（PR-13）も同じ場所に出す */
export const LATEST_DEFINITION_PATH = "/data/latest-definition.json";

/** 読み込みの失敗の理由 */
export type DefinitionLoadError =
  /**
   * 取得の失敗。status は HTTP の状態コード（404 など）。
   * 通信そのものに失敗した（fetch が失敗した）ときは null。
   * message は画面に出す理由の文（日本語。状態コードがあれば含める）
   */
  | { kind: "fetch"; status: number | null; message: string }
  /**
   * 検証の失敗（JSON として読めないときを含む）。errors は parsePublicDefinition が返した誤り（1 件以上）。
   * message は画面に出す理由の文（日本語。誤りの文〔errors の message〕を含める）
   */
  | { kind: "invalid"; errors: DefinitionError[]; message: string };

/** 読み込みの結果 */
export type DefinitionLoadResult =
  | { ok: true; definition: PublicDefinition }
  | { ok: false; error: DefinitionLoadError };

/** 検証の失敗の理由の文に並べる誤りの数の上限（残りは「ほか n 件」とまとめる） */
const MAX_ERRORS_IN_MESSAGE = 3;

/** 取得の失敗の結果を作る */
function fetchFailure(status: number | null, message: string): DefinitionLoadResult {
  return { ok: false, error: { kind: "fetch", status, message } };
}

/** 検証の失敗の理由の文。誤りの文を先頭から上限まで並べ、残りは件数だけを書く */
function invalidMessage(errors: readonly DefinitionError[]): string {
  const shown = errors.slice(0, MAX_ERRORS_IN_MESSAGE).map((error) => error.message);
  const rest = errors.length - shown.length;
  const list = rest > 0 ? `${shown.join("／")} ほか ${rest} 件` : shown.join("／");
  return `定義の内容に誤りがあります（${list}）`;
}

/**
 * 最新イベントの公開定義を静的ファイル（LATEST_DEFINITION_PATH）から取得し、検証して返す。
 * 呼ぶたびに取得する（取得を 1 回にまとめるのは useLatestDefinition の役目）。例外は投げない。
 */
export async function loadLatestDefinition(): Promise<DefinitionLoadResult> {
  let response: Response;
  try {
    response = await fetch(LATEST_DEFINITION_PATH);
  } catch {
    // ブラウザの fetch は、通信そのものの失敗（オフラインなど）で TypeError を投げる
    return fetchFailure(null, "定義のファイルを取得できませんでした（通信に失敗しました）");
  }

  if (!response.ok) {
    return fetchFailure(
      response.status,
      `定義のファイルを取得できませんでした（状態コード ${response.status}）`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    // 本文の受信の途中で通信が切れたときなど。状態コードは成功でも、通信の失敗として扱う
    return fetchFailure(null, "定義のファイルを最後まで受け取れませんでした（通信に失敗しました）");
  }

  const result = parsePublicDefinition(text);
  if (!result.ok) {
    return {
      ok: false,
      error: { kind: "invalid", errors: result.errors, message: invalidMessage(result.errors) },
    };
  }
  return { ok: true, definition: result.value };
}
