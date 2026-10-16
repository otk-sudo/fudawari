// 最新イベントの公開定義の読み込み（roadmap T2-3、要件 5 章）
//
// - 一般の画面は、静的ファイル（public/data/latest-definition.json）だけを読む。Supabase には通信しない。
// - 取得した文字列は parsePublicDefinition（@/domain/definition）で検証してから使う。
// - 例外は投げず、結果（DefinitionLoadResult）で返す。取得の失敗と検証の失敗は kind で区別する。
//
// TODO(T2-3 実装担当)：中身はまだない（テストを先に書いた段階。load.test.ts を参照）
import type { DefinitionError, PublicDefinition } from "@/domain/definition";

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

/**
 * 最新イベントの公開定義を静的ファイル（LATEST_DEFINITION_PATH）から取得し、検証して返す。
 * 呼ぶたびに取得する（取得を 1 回にまとめるのは useLatestDefinition の役目）。例外は投げない。
 */
export async function loadLatestDefinition(): Promise<DefinitionLoadResult> {
  throw new Error("未実装");
}
