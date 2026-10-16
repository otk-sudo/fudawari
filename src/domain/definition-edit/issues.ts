// 文書の問題の検出（3 方向マージの結果の確認、保存ボタンを止める判定。roadmap T3-6・T3-8）
//
// 項目ごとに合わせた結果（マージ）や編集の途中で、文書全体の前提が崩れることがある。次の 3 つを問題として返す。
// - 段階が 1 つもない → no_stages（場所は空）
// - 終了日時が開始日時以前（同じ時刻を含む。どちらも読める日時のときだけ比べ、時刻で比べる）
//   → end_before_start（場所は開始日時・終了日時。文は「終了日時は開始日時より後にしてください」）
// - 別々の札に同じ札番号（null は除く）→ duplicate_game_number（番号ごとに 1 件。場所はその番号の札の札番号を札の並び順で。
//   文には札の名前を入れる）。2 つ以上の番号が重なっていれば、札の並び順で先に出てくる番号から
// 問題の並びは イベント → 札 → 段階。問題がなければ空の配列。日時の形式違いなどは見ない（validateDraftDefinition の役目）。
//
// 純粋な判定なので、新規作成の直後（段階がまだない）でも no_stages を返す。
// 新規作成の直後の下書きの保存で no_stages を除くかどうかは、画面（PR-11）で決める。
import type { Fuda } from "@/domain/definition/types";
import { parseDateTime } from "./datetime";
import type { DefinitionDoc, DocumentIssue } from "./types";

const MSG_NO_STAGES = "段階が 1 つもありません。段階を 1 つ以上置いてください";
const MSG_END_BEFORE_START = "終了日時は開始日時より後にしてください";

/** 文書の問題の一覧を返す（問題がなければ空の配列）。文書は書き換えない */
export function findDocumentIssues(doc: DefinitionDoc): DocumentIssue[] {
  return [...endBeforeStartIssues(doc), ...duplicateGameNumberIssues(doc), ...noStagesIssues(doc)];
}

/** 終了日時が開始日時以前（未定・空・読めない値のときは比べない） */
function endBeforeStartIssues(doc: DefinitionDoc): DocumentIssue[] {
  const { startAt, endAt } = doc.event;
  if (endAt === null) return [];
  const startMs = parseDateTime(startAt);
  const endMs = parseDateTime(endAt);
  if (startMs === undefined || endMs === undefined || endMs > startMs) return [];
  return [
    {
      code: "end_before_start",
      message: MSG_END_BEFORE_START,
      locations: [
        { kind: "event", field: "startAt" },
        { kind: "event", field: "endAt" },
      ],
    },
  ];
}

/** 札番号の重複（番号ごとに 1 件） */
function duplicateGameNumberIssues(doc: DefinitionDoc): DocumentIssue[] {
  // 札番号 → その番号の札（札の並び順）。Map は入れた順を保つので、番号は札の並び順で先に出てくる順になる
  const fudasByNumber = new Map<number, Fuda[]>();
  for (const fuda of doc.fudas) {
    if (fuda.gameNumber === null) continue;
    const same = fudasByNumber.get(fuda.gameNumber);
    if (same === undefined) {
      fudasByNumber.set(fuda.gameNumber, [fuda]);
    } else {
      same.push(fuda);
    }
  }
  return [...fudasByNumber]
    .filter(([, fudas]) => fudas.length >= 2)
    .map(([gameNumber, fudas]): DocumentIssue => ({
      code: "duplicate_game_number",
      message: `札番号 ${gameNumber} が ${fudas.map((f) => `「${f.name}」`).join("と")} で重複しています`,
      locations: fudas.map((f) => ({ kind: "fuda", fudaId: f.id, field: "gameNumber" })),
    }));
}

/** 段階が 1 つもない */
function noStagesIssues(doc: DefinitionDoc): DocumentIssue[] {
  if (doc.stages.length > 0) return [];
  return [{ code: "no_stages", message: MSG_NO_STAGES, locations: [] }];
}
