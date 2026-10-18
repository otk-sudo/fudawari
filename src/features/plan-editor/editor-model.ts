// イベント定義の画面（PR-11）の「作業中の内容」（ワークスペース）と、画面に出す文を作る純粋な関数
//
// - ワークスペースは「既存を更新」（最新のイベント）と「新規作成」でそれぞれ 1 つずつ持つ。
//   doc が画面で編集中の文書、savedDoc が最後に読んだ・保存した文書（保存していない変更と保存の記録の比べる元）。
// - イベント名・日時の正は events の値（meta）。文書の event は写しなので、確定のたびに両方を書き換える。
// - 画面（React）に依存しない。保管庫（DefinitionRepository）も呼ばない。
import type { DefinitionError } from "@/domain/definition";
import { createDefinition, type DefinitionDoc, type DocumentIssue } from "@/domain/definition-edit";
import { type DefinitionChange, describeChanges } from "@/domain/merge";
import type { EditableEvent, PublishedVersion, SaveLogInput } from "./types";

/** イベント名・日時（events の値。新規作成でイベントを作る前は、入力を確定した値） */
export interface EventMeta {
  readonly name: string;
  /** 開始日時（ISO 8601 の時差つき。新規作成で未入力なら空文字） */
  readonly startAt: string;
  /** 終了日時（未定は null） */
  readonly endAt: string | null;
}

/** 共有の下書きを最後に保存した人と日時 */
export interface DraftNote {
  readonly updatedByName: string;
  readonly updatedAt: string;
}

/** 作業中の内容（「既存を更新」「新規作成」でそれぞれ 1 つ） */
export interface Workspace {
  /** 保存先のイベント ID（新規作成でまだイベントを作っていなければ null） */
  readonly eventId: string | null;
  /** 開いたときの版（最後に読んだ・保存した下書きの版。イベントを作る前は null） */
  readonly baseVersion: number | null;
  /** 最後に読んだ・保存した文書（イベントを作る前は null） */
  readonly savedDoc: DefinitionDoc | null;
  /** 画面で編集中の文書 */
  readonly doc: DefinitionDoc;
  /** イベント名・日時（保存済みの値） */
  readonly meta: EventMeta;
  /** 公開中の版（まだ公開していなければ null） */
  readonly published: PublishedVersion | null;
  /** 共有の下書きを最後に保存した人と日時（まだ保存していなければ null） */
  readonly draftNote: DraftNote | null;
  /** 選んでいる段階（なければ null。文書にない ID なら最初の段階を選んでいるものとして扱う） */
  readonly selectedStageId: string | null;
  /** 新規作成の「元にするイベント」の ID（今の文書の元にしたイベント。使わないなら空文字） */
  readonly baseEventId: string;
  /**
   * 新規作成で、選んで文書を読み込んでいる途中の「元にするイベント」の ID（なければ null）。
   * 読み込めたら baseEventId にし、失敗したら null に戻す（選択欄は baseEventId の値に戻る）。
   * 選び直した後に届いた古い要求の結果は使わない（DefinitionEditor が要求ごとの番号で見分ける）
   */
  readonly loadingBaseEventId: string | null;
  /**
   * 保存の衝突で、相手の変更を自動で合わせた段階（段階の ID → 変えた人の表示名）。
   * 攻略の流れで橙の枠と「（名前）が変更」の印を付ける（保存した後も残す。要件 3.7「同時編集」）
   */
  readonly mergedStages: ReadonlyMap<string, string>;
}

/** 保存の記録に入れる海域の表示名（文書にない海域は ID のまま） */
function areaLabel(docs: readonly DefinitionDoc[], areaId: string | undefined): string | null {
  if (areaId === undefined) return null;
  for (const doc of docs) {
    const area = doc.areas.find((a) => a.id === areaId);
    if (area !== undefined) return area.name;
  }
  return areaId;
}

/** 海域の段階（並び順） */
export function stagesInArea(doc: DefinitionDoc, areaId: string): DefinitionDoc["stages"] {
  return doc.stages.filter((stage) => stage.areaId === areaId);
}

/** 最初の段階（海域の並び順で最初の海域の、最初の段階）。段階がなければ null */
export function firstStageId(doc: DefinitionDoc): string | null {
  for (const area of doc.areas) {
    const stage = doc.stages.find((s) => s.areaId === area.id);
    if (stage !== undefined) return stage.id;
  }
  return doc.stages[0]?.id ?? null;
}

/** 選んでいる段階の ID（選んでいる段階が文書になければ最初の段階。段階がなければ null） */
export function effectiveStageId(ws: Workspace): string | null {
  const { selectedStageId, doc } = ws;
  if (selectedStageId !== null && doc.stages.some((s) => s.id === selectedStageId)) return selectedStageId;
  return firstStageId(doc);
}

/**
 * 段階を削除した後に選ぶ段階（削除する前の文書で求める）。
 * 同じ海域の次の段階、なければ同じ海域の前の段階、それもなければ削除した後の最初の段階
 */
export function stageToSelectAfterDelete(doc: DefinitionDoc, stageId: string): string | null {
  const stage = doc.stages.find((s) => s.id === stageId);
  if (stage === undefined) return firstStageId(doc);
  const sameArea = stagesInArea(doc, stage.areaId);
  const index = sameArea.findIndex((s) => s.id === stageId);
  const neighbor = sameArea[index + 1] ?? sameArea[index - 1];
  if (neighbor !== undefined) return neighbor.id;
  return firstStageId({ ...doc, stages: doc.stages.filter((s) => s.id !== stageId) });
}

/** 文書の event を events の値（meta）にそろえる。値が同じなら同じ文書を返す */
export function withEventMeta(doc: DefinitionDoc, meta: EventMeta): DefinitionDoc {
  const { event } = doc;
  if (event.name === meta.name && event.startAt === meta.startAt && event.endAt === meta.endAt) return doc;
  return { ...doc, event: { ...event, name: meta.name, startAt: meta.startAt, endAt: meta.endAt } };
}

/**
 * 読み込んだイベントからワークスペースを作る。
 * 文書の event が events の値と違えば（下書きの写しが古い）、編集中の文書だけを events の値にそろえる
 * （次の下書きの保存で写しも新しくなる）
 */
export function workspaceFromEvent(event: EditableEvent): Workspace {
  const meta: EventMeta = { name: event.name, startAt: event.startAt, endAt: event.endAt };
  const savedDoc = event.draft.content;
  const doc = withEventMeta(savedDoc, meta);
  return {
    eventId: event.id,
    baseVersion: event.draft.version,
    savedDoc,
    doc,
    meta,
    published: event.published,
    draftNote: { updatedByName: event.draft.updatedByName, updatedAt: event.draft.updatedAt },
    selectedStageId: firstStageId(doc),
    baseEventId: "",
    loadingBaseEventId: null,
    mergedStages: new Map(),
  };
}

/** 新規作成の初めのワークスペース（元にするイベントを使わない：E1 だけの空の状態） */
export function emptyCreateWorkspace(): Workspace {
  return {
    eventId: null,
    baseVersion: null,
    savedDoc: null,
    doc: createDefinition({ eventId: newId("event") }),
    meta: { name: "", startAt: "", endAt: null },
    published: null,
    draftNote: null,
    selectedStageId: null,
    baseEventId: "",
    loadingBaseEventId: null,
    mergedStages: new Map(),
  };
}

/** 保存していない変更があるか（イベントを作る前は常にある） */
export function hasUnsavedChanges(ws: Workspace): boolean {
  if (ws.savedDoc === null) return true;
  if (ws.doc === ws.savedDoc) return false;
  return describeChanges(ws.savedDoc, ws.doc).length > 0;
}

/** 保存の記録の文（変更ごとに 1 件。海域によらない変更は mapLabel が null） */
export function saveLogs(before: DefinitionDoc, after: DefinitionDoc): SaveLogInput[] {
  const docs = [after, before];
  return describeChanges(before, after).map((change) => ({
    mapLabel: areaLabel(docs, change.areaIds[0]),
    summary: change.text,
  }));
}

/**
 * 公開中の版から、編集中の文書（保存していない変更を含む）までの変更の一覧。
 * 版の日付は公開のときに決まるので比べない
 */
export function unpublishedChanges(published: PublishedVersion, doc: DefinitionDoc): DefinitionChange[] {
  const before = published.content;
  const after = { ...doc, event: { ...doc.event, versionDate: before.event.versionDate } };
  return describeChanges(before, after);
}

const VERSION_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 版の日付の表示（"2026-08-04" → 「2026/08/04 版」） */
export function versionLabel(versionDate: string): string {
  const match = VERSION_DATE_PATTERN.exec(versionDate);
  if (match === null) return `${versionDate} 版`;
  return `${match[1]}/${match[2]}/${match[3]} 版`;
}

/** 今の日時（ISO 8601 の時差つき。秒の小数は付けない。formatDateTimeJst で読める形） */
export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** 呼び出しごとに変わる番号（crypto.randomUUID がない環境の代わり） */
let idSequence = 0;

/** 新しい段階・札・特効グループ・イベントの仮の ID（2 人が同時に追加しても重ならないよう、乱数で作る） */
export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(idSequence += 1).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

/** 失敗の理由の文（Error なら message。保管庫は理由の文を message に持つ Error で reject する） */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  return String(error);
}

/**
 * 文書の問題（findDocumentIssues）の、画面に出す文。
 * 札番号の重複は、札の名前の前後に空白を入れない形（「札番号 3 が「連合艦隊」と「第六艦隊」で重複しています」）で組み立てる
 * （src/domain/definition-edit の文は「が 「…」 で」と空白が入るため）。ほかは問題の文のまま
 */
export function issueMessage(doc: DefinitionDoc, issue: DocumentIssue): string {
  if (issue.code !== "duplicate_game_number") return issue.message;
  const fudas = issue.locations.flatMap((location) => {
    if (location.kind !== "fuda") return [];
    const fuda = doc.fudas.find((f) => f.id === location.fudaId);
    return fuda === undefined ? [] : [fuda];
  });
  const gameNumber = fudas[0]?.gameNumber;
  if (gameNumber === undefined || gameNumber === null) return issue.message;
  return `札番号 ${gameNumber} が${fudas.map((fuda) => `「${fuda.name}」`).join("と")}で重複しています`;
}

const STAGE_PATH = /^stages\[(\d+)\](?:\.boosts\[(\d+)\])?(?:\.(\w+))?/;
const FUDA_PATH = /^fudas\[(\d+)\](?:\.(\w+))?/;
const AREA_PATH = /^areas\[(\d+)\]/;

const STAGE_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "段階の名前",
  fudaId: "札",
  importance: "大事さ",
  areaId: "海域",
};
const GROUP_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "名前",
  multiplier: "倍率",
  shipNames: "艦名",
  nationalities: "国籍",
  shipTypes: "艦種",
};
const FUDA_FIELD_LABELS: Readonly<Record<string, string>> = { name: "名前", color: "色", gameNumber: "札番号" };
const EVENT_FIELD_LABELS: Readonly<Record<string, string>> = {
  "event.name": "イベント名",
  "event.startAt": "開始日時",
  "event.endAt": "終了日時",
  "event.versionDate": "版の日付",
};

/** 名前の表示（空なら「（名前なし）」） */
function nameText(name: string | undefined): string {
  return name === undefined || name === "" ? "（名前なし）" : name;
}

/** 誤りの場所（"stages[4].name" など）を、画面の言葉にする */
function placeLabel(doc: DefinitionDoc, path: string): string {
  const stageMatch = STAGE_PATH.exec(path);
  if (stageMatch !== null) {
    const stage = doc.stages[Number(stageMatch[1])];
    const area = doc.areas.find((a) => a.id === stage?.areaId)?.name ?? "";
    const stageText = `「${`${area} ${nameText(stage?.name)}`.trim()}」`;
    const field = stageMatch[3];
    if (stageMatch[2] !== undefined) {
      const group = stage?.boosts[Number(stageMatch[2])];
      const groupText = `${stageText}の特効「${nameText(group?.name)}」`;
      return field === undefined ? groupText : `${groupText}の${GROUP_FIELD_LABELS[field] ?? field}`;
    }
    return field === undefined ? `${stageText}の段階` : `${stageText}の${STAGE_FIELD_LABELS[field] ?? field}`;
  }
  const fudaMatch = FUDA_PATH.exec(path);
  if (fudaMatch !== null) {
    const fuda = doc.fudas[Number(fudaMatch[1])];
    const field = fudaMatch[2];
    const fudaText = `札「${nameText(fuda?.name)}」`;
    return field === undefined ? fudaText : `${fudaText}の${FUDA_FIELD_LABELS[field] ?? field}`;
  }
  const areaMatch = AREA_PATH.exec(path);
  if (areaMatch !== null) return `海域「${nameText(doc.areas[Number(areaMatch[1])]?.name)}」`;
  return EVENT_FIELD_LABELS[path] ?? (path === "" ? "定義全体" : path);
}

/**
 * 下書きの検証の誤り（validateDraftDefinition）を、画面に出す文にする。
 * 例：「「E2 （名前なし）」の段階の名前：空にはできません」
 */
export function describeDraftError(doc: DefinitionDoc, error: DefinitionError): string {
  const separator = error.message.indexOf("：");
  const reason = separator < 0 ? error.message : error.message.slice(separator + 1);
  return `${placeLabel(doc, error.path)}：${reason}`;
}
