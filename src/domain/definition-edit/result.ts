// 編集の結果（EditResult）を作る内部の補助。定義の編集の関数からだけ使う
import type { DefinitionDoc, EditErrorCode, EditResult } from "./types";

/** 成功（新しい文書） */
export function ok(doc: DefinitionDoc): EditResult {
  return { ok: true, doc };
}

/** 失敗（理由の種類と、画面に出す文） */
export function fail(code: EditErrorCode, message: string): EditResult {
  return { ok: false, error: { code, message } };
}
