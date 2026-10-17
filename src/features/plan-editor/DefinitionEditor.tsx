"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  addArea,
  addBoostGroup,
  addFuda,
  addShipNames,
  addStage,
  type AddFudaInput,
  createDefinition,
  type DefinitionDoc,
  deleteBoostGroup,
  deleteFuda,
  deleteStage,
  type EditError,
  type EditMode,
  editPermissions,
  type EditResult,
  type EventInfoError,
  findDocumentIssues,
  formatDateTimeJst,
  fromDateTimeLocalValue,
  isEventEnded,
  moveFuda,
  moveStage,
  removeArea,
  removeShipName,
  setGroupNationalities,
  type StagePatch,
  type StagePosition,
  toDateTimeLocalValue,
  updateBoostGroup,
  type BoostGroupPatch,
  updateFuda,
  type FudaPatch,
  updateStage,
  validateDraftDefinition,
  validateEventInfo,
} from "@/domain/definition-edit";
import {
  type ConflictChoice,
  type ConflictChoices,
  type MergeInput,
  type MergeResult,
  mergeDefinitions,
  resolveMerge,
} from "@/domain/merge";
import type { BoostNationality } from "@/domain/nationality";
import { ConflictDialog, type MergedItem, MergedItemLine } from "./ConflictDialog";
import { EditorDndProvider, type DragItem, type DropTarget } from "./editor-dnd";
import {
  describeDraftError,
  effectiveStageId,
  emptyCreateWorkspace,
  errorMessage,
  type EventMeta,
  hasUnsavedChanges,
  issueMessage,
  newId,
  nowIso,
  saveLogs,
  stageToSelectAfterDelete,
  unpublishedChanges,
  versionLabel,
  withEventMeta,
  type Workspace,
  workspaceFromEvent,
} from "./editor-model";
import { EventPanel, type EventField, type FieldTexts } from "./EventPanel";
import { FlowSection, type StageMark } from "./FlowSection";
import { FudaSection } from "./FudaSection";
import { EditingPresence } from "./presence/EditingPresence";
import type { PresenceConnector } from "./presence/types";
import { SaveLogDialog } from "./save-log/SaveLogDialog";
import type { SaveLogLoader } from "./save-log/types";
import { StageDetail } from "./StageDetail";
import type { DefinitionRepository, EditableEvent, PlanEditorData, SaveDraftResult } from "./types";
import controls from "./controls.module.css";
import styles from "./PlanEditor.module.css";

export type DefinitionEditorProps = {
  /** 画面を開いたときに読んだもの */
  data: PlanEditorData;
  /** 定義の保管庫 */
  repository: DefinitionRepository;
  /** 艦船マスタにある改装段階を問わない艦名（なければ知らない艦名を警告しない） */
  knownShipNames: ReadonlySet<string> | undefined;
  /** 保存の記録を読む（PR-12。なければ「保存の記録を見る」を出さない） */
  loadSaveLogs?: SaveLogLoader;
  /** 編集中の表示のチャンネルにつなぐ（PR-12。なければ「（名前）も編集中」を出さない） */
  connectPresence?: PresenceConnector;
};

/** 「既存を更新」「新規作成」のワークスペース */
interface Workspaces {
  readonly update: Workspace | null;
  readonly create: Workspace | null;
}

interface EditorState {
  readonly mode: EditMode;
  readonly workspaces: Workspaces;
  /** まだ開いていない未公開の新規イベント（新規作成に初めて切り替えたとき、その続きから始める） */
  readonly unpublished: EditableEvent | null;
}

/** 操作の結果の知らせ（失敗は role="alert"、成功は role="status"） */
interface Notice {
  readonly tone: "error" | "success";
  readonly text: string;
  /** 相手の変更を合わせて保存したときの、自動で合わせた所（「場所を見る」つきで並べる） */
  readonly mergedItems?: readonly MergedItem[];
}

/** 保存・公開の途中（kind：操作、target：保存するワークスペースのモード） */
interface Busy {
  readonly kind: "save" | "publish";
  readonly target: EditMode;
}

/** 相手の変更を合わせて保存したこと（合わせた相手の名前と、自動で合わせた所） */
interface MergedWith {
  readonly names: readonly string[];
  readonly items: readonly MergedItem[];
}

/** 下書きの保存の結果（保存した版と文書。相手の変更を合わせて保存したなら mergedWith） */
interface SaveOutcome {
  readonly eventId: string;
  readonly version: number;
  readonly content: DefinitionDoc;
  readonly mergedWith: MergedWith | null;
}

/** 先に保存していた相手の下書き（save_draft の conflict） */
interface TheirsDraft {
  readonly version: number;
  readonly content: DefinitionDoc;
  readonly name: string;
  readonly at: string;
}

/**
 * 衝突した保存を合わせて保存し直す流れの文脈。
 * 保存し直す前にまた別の人が保存していたら（3 人目）、新しい相手の内容に対して同じ流れをくり返し、合わせた所を足していく
 */
interface MergeContext {
  readonly target: EditMode;
  readonly eventId: string;
  /** 保存を押したときの編集中の文書（保存した後、その後に編集した分を、保存した文書に重ねる元） */
  readonly editedFrom: DefinitionDoc;
  /** 「変更を公開する」から始めたか（合わせて保存した後に、もう一度公開してもらう文を出す） */
  readonly fromPublish: boolean;
  /** これまでに自動で合わせた所 */
  readonly mergedItems: readonly MergedItem[];
  /** これまでに変更が実際に残った相手の名前（自動で合わせた所があるか、「相手の内容」を選んだ相手。重複なし） */
  readonly names: readonly string[];
}

/** 確認のウィンドウ（同じ所を 2 人が変えていたとき） */
interface ConflictState {
  /** この衝突より前の文脈（この衝突の自動で合わせた所は、選んで保存するときに足す） */
  readonly context: MergeContext;
  readonly input: MergeInput;
  readonly merge: MergeResult;
  readonly theirs: TheirsDraft;
  readonly choices: ConflictChoices;
}

/** save_draft の conflict から、相手の下書きを取り出す */
function theirsOf(result: Extract<SaveDraftResult, { status: "conflict" }>): TheirsDraft {
  return { version: result.version, content: result.content, name: result.updatedByName, at: result.updatedAt };
}

/** 文書の event（イベント名・日時の写し）を差し替える（正は events 表なので、合わせるときは自分の写しにそろえる） */
function alignEvent(doc: DefinitionDoc, event: DefinitionDoc["event"]): DefinitionDoc {
  return doc.event === event ? doc : { ...doc, event };
}

/** 自動で合わせた所のうち、doc にない段階（削除された段階）は「場所を見る」を出さない（stageId を null にする） */
function placesIn(items: readonly MergedItem[], doc: DefinitionDoc): MergedItem[] {
  return items.map((item) =>
    item.stageId !== null && !doc.stages.some((stage) => stage.id === item.stageId) ? { ...item, stageId: null } : item,
  );
}

/** 合わせた結果の、自動で合わせた所（相手だけが変えた所）。合わせた文書にない段階には「場所を見る」を出さない */
function mergedItemsOf(merge: MergeResult, name: string): MergedItem[] {
  return placesIn(
    merge.autoMerged.map((change) => ({ label: change.label, change: change.change, name, stageId: change.stageId })),
    merge.merged,
  );
}

/**
 * この衝突の自動で合わせた所と相手の名前を、文脈に足す。
 * 名前は、相手の変更が実際に残ったとき（自動で合わせた所がある、または「相手の内容」を選んだ）だけ足す
 */
function withMerged(context: MergeContext, merge: MergeResult, name: string, choseTheirs = false): MergeContext {
  const kept = merge.autoMerged.length > 0 || choseTheirs;
  return {
    ...context,
    mergedItems: [...context.mergedItems, ...mergedItemsOf(merge, name)],
    names: !kept || context.names.includes(name) ? context.names : [...context.names, name],
  };
}

/** 相手の変更を合わせて保存したときの文（要件 3.7）。変更が残った相手がいなければ、ふだんの保存の文 */
function savedWithTheirsText(names: readonly string[]): string {
  if (names.length === 0) return MSG_SAVED;
  return `下書きを保存しました。${names.join("・")}の変更も含めた内容が、管理者・協力者全員の定義画面に反映されます`;
}

/** 保存する前に組み立てた内容 */
interface Prepared {
  readonly content: DefinitionDoc;
  readonly meta: EventMeta;
  /** 組み立てに使った入力欄の値（イベントを作成した後、この値のままの欄だけを確定済みに戻す） */
  readonly texts: FieldTexts;
}

const EMPTY_TEXTS: FieldTexts = { name: null, startAt: null, endAt: null };

const MSG_NEED_NAME_AND_START = "イベント名と開始日時を入力してください";
const MSG_SAVED = "下書きを保存しました。管理者・協力者全員の定義画面に反映されます";
const MSG_REACH_GENERAL = "数分で一般の画面に反映されます";
const MSG_PUBLISH_AFTER_MERGE = "内容を確かめてから、もう一度公開してください";
const MSG_NO_EVENT_FOR_COLLAB = "更新できるイベントがありません。管理者が新規作成するまでお待ちください";
const MSG_END_IN_PAST_CREATE = "終了日時は今より後にしてください";

/** 今の時刻（30 秒ごとに進める。終了日時を過ぎたら、開いたままでも更新できない状態にするため） */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** 開いたときの状態（管理者で、最新のイベントがまだなければ新規作成から始める） */
function initialState(data: PlanEditorData): EditorState {
  const update = data.latestEvent === null ? null : workspaceFromEvent(data.latestEvent);
  if (update === null && data.user.role === "admin") {
    const create = data.unpublishedEvent === null ? emptyCreateWorkspace() : workspaceFromEvent(data.unpublishedEvent);
    return { mode: "create", workspaces: { update, create }, unpublished: null };
  }
  return { mode: "update", workspaces: { update, create: null }, unpublished: data.unpublishedEvent };
}

/** 入力欄の値を 1 つだけ変えた値 */
function withText(texts: FieldTexts, field: EventField, value: string | null): FieldTexts {
  switch (field) {
    case "name":
      return { ...texts, name: value };
    case "startAt":
      return { ...texts, startAt: value };
    case "endAt":
      return { ...texts, endAt: value };
  }
}

/** 日時の入力欄の値を文書の日時にする（空は空文字。読めない値はそのまま渡して、検証で形式の誤りにする） */
function dateTimeFromText(text: string): string {
  if (text === "") return "";
  return fromDateTimeLocalValue(text) ?? text;
}

/** 入力欄の値（確定していないものを含む）を合わせたイベント名・日時 */
function candidateMeta(meta: EventMeta, texts: FieldTexts): EventMeta {
  const endText = texts.endAt;
  return {
    name: texts.name === null ? meta.name : texts.name.trim(),
    startAt: texts.startAt === null ? meta.startAt : dateTimeFromText(texts.startAt),
    endAt: endText === null ? meta.endAt : endText === "" ? null : dateTimeFromText(endText),
  };
}

/** 入力欄の値が、保存済みの値の表示と同じか（日時は入力欄の表示で比べ、秒の付いた保存済みの値を書き換えない） */
function isUnchanged(meta: EventMeta, field: EventField, text: string): boolean {
  if (field === "name") return text.trim() === meta.name;
  return text === (toDateTimeLocalValue(meta[field]) ?? "");
}

/** 確定した 1 つの欄だけを入れたイベント名・日時 */
function metaWithField(meta: EventMeta, candidate: EventMeta, field: EventField): EventMeta {
  switch (field) {
    case "name":
      return { ...meta, name: candidate.name };
    case "startAt":
      return { ...meta, startAt: candidate.startAt };
    case "endAt":
      return { ...meta, endAt: candidate.endAt };
  }
}

/** 送った値（sent）のままの入力欄だけを確定済み（null）に戻す（送った後に書き換えた値は消さない） */
function clearSentTexts(texts: FieldTexts, sent: FieldTexts): FieldTexts {
  return {
    name: texts.name === sent.name ? null : texts.name,
    startAt: texts.startAt === sent.startAt ? null : texts.startAt,
    endAt: texts.endAt === sent.endAt ? null : texts.endAt,
  };
}

/**
 * イベント名・日時の誤り（validateEventInfo の結果）。新規作成でも、終了日時が今以前なら end_in_past を足す
 * （domain の検証は更新のときだけ見る。過去の終了日時で作ると公開した途端に終了して更新できなくなるため、画面で止める）
 */
function eventInfoErrors(mode: EditMode, meta: EventMeta, now: Date): EventInfoError[] {
  const errors = validateEventInfo({ mode, ...meta, now });
  if (mode !== "create" || meta.endAt === null || errors.some((e) => e.field === "endAt")) return errors;
  if (!isEventEnded(meta.endAt, now)) return errors;
  return [...errors, { field: "endAt", code: "end_in_past", message: MSG_END_IN_PAST_CREATE }];
}

/**
 * 定義画面の本文（読み込みが済んだ後）。上部の欄・攻略の流れ・札の一覧・段階の詳細と、
 * 編集・下書きの保存・公開・イベントの作成と更新を受け持つ。
 *
 * 決めたこと
 * - イベント名・日時は確定（フォーカスを外す）のたびに updateEventMeta で保存する（下書きの保存とは別）。
 *   画面はすぐ新しい値にし、失敗したら保管庫で確定している値に戻して理由を出す。
 *   更新は列にして 1 つずつ順に送り（後の更新はそれまでに確定した値をすべて持つ）、前の更新が失敗しても続ける
 * - 「下書きを保存」「変更を公開する」は、それまでに確定したイベント名・日時の更新が終わってから保存・公開する。
 *   保存・公開の途中は、イベント名・日時の欄を操作できなくする
 * - 「変更を公開する」は、保存していない変更があれば先に下書きを保存し、返った版を公開する
 * - 新規作成の「下書きを保存」は 1 回目にイベントを作成し、2 回目からはその下書きを保存する。
 *   「公開して最新にする」は、まだ作成していなければ作成してから、返った版を最新にして公開する。
 *   「元にするイベント」はイベントを作る前だけ選べ、読み込みの結果はいちばん新しい要求のものだけを使う
 * - 文書の問題（findDocumentIssues）は理由を出してボタンを押せなくする。段階が 1 つもないことは公開だけを止める
 * - 入力の誤り（イベント名・日時・倍率のその場の文）が残っている間も、保存・公開を押せなくする
 * - 下書きの保存が衝突したら（開いた後に他の人が保存していた）、開いたときの版・自分の内容・相手の内容を 3 方向に合わせる。
 *   衝突がなければ確認せずに保存し直し、衝突があれば確認のウィンドウで選ばせる。保存し直すときにまた衝突したら（3 人目）、
 *   新しい相手の内容に対して同じ流れをくり返す。「変更を公開する」の前の保存で相手の変更を合わせたときは、公開しない
 *   （合わせた内容を確かめてから公開し直してもらう）
 * - 新規作成の元にするイベントの読み込み中は、本文を操作できなくする（inert）
 */
export function DefinitionEditor({
  data,
  repository,
  knownShipNames,
  loadSaveLogs,
  connectPresence,
}: DefinitionEditorProps): ReactNode {
  const { user } = data;
  const now = useNow();
  const [state, setState] = useState<EditorState>(() => initialState(data));
  const [texts, setTexts] = useState<FieldTexts>(EMPTY_TEXTS);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  // 倍率の欄に入力の誤りが残っている特効グループの ID（誤りの間は保存・公開を押せなくする）
  const [invalidGroupIds, setInvalidGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  // イベント名・日時の更新の列（1 つずつ順に送る。列の各処理は失敗を自分で受け止め、列を止めない）
  const metaQueueRef = useRef<Promise<void>>(Promise.resolve());
  // イベントごとの、保管庫で確定しているイベント名・日時（更新に失敗したとき、表示をこの値に戻す）
  const confirmedMetaRef = useRef(new Map<string, EventMeta>());
  // 元にするイベントの読み込みの、いちばん新しい要求の番号（古い要求の結果を捨てるため）
  const baseRequestRef = useRef(0);
  // 保存の確認のウィンドウ（同じ所を 2 人が変えていたとき）
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  // 確認のウィンドウを閉じた後にフォーカスを戻す先（保存・公開を押したボタン）
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // 前の描画で確認のウィンドウが開いていたか（閉じたときだけフォーカスを戻すため）
  const dialogWasOpenRef = useRef(false);
  const dialogOpen = conflict !== null;

  useEffect(() => {
    // 確認のウィンドウを閉じたら（保存した・やめた）、保存・公開を押したボタンにフォーカスを戻す
    if (!dialogOpen && dialogWasOpenRef.current) returnFocusRef.current?.focus();
    dialogWasOpenRef.current = dialogOpen;
  }, [dialogOpen]);
  // 今のモード（保存の途中に切り替えた後で衝突が返ったとき、衝突したワークスペースのモードに戻すかを見る）
  const modeRef = useRef(state.mode);
  useEffect(() => {
    modeRef.current = state.mode;
  });

  const { mode } = state;
  const ws = state.workspaces[mode];

  /** ワークスペースを書き換える（モードを指定する。保存の途中でモードを切り替えても、元のワークスペースに書く） */
  const updateWorkspace = useCallback((target: EditMode, change: (current: Workspace) => Workspace): void => {
    setState((prev) => {
      const current = prev.workspaces[target];
      if (current === null) return prev;
      return { ...prev, workspaces: { ...prev.workspaces, [target]: change(current) } };
    });
  }, []);

  /** 特効グループの倍率の欄に誤りが残っているかを受け取る（BoostGroupEditor の効果から呼ばれるので、同じ関数を渡し続ける） */
  const reportGroupInvalid = useCallback((groupId: string, invalid: boolean): void => {
    setInvalidGroupIds((prev) => {
      if (prev.has(groupId) === invalid) return prev;
      const next = new Set(prev);
      if (invalid) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }, []);

  if (ws === null) {
    // 協力者で、最新のイベントがまだない
    return (
      <div className={styles.body}>
        <section className={styles.panel} aria-label="更新するイベント">
          <p className={styles.panelMessage}>{MSG_NO_EVENT_FOR_COLLAB}</p>
          <p className={styles.panelNote}>編集できる人：{data.members.map((m) => m.displayName).join("・")}</p>
        </section>
      </div>
    );
  }

  const perms = editPermissions({ role: user.role, mode, savedEndAt: ws.meta.endAt, now });
  const candidate = candidateMeta(ws.meta, texts);

  // ---- 入力の検証（その場で出す文） ----

  const fieldError = ((): string | null => {
    if (!perms.canEditContent) return null;
    const errors = eventInfoErrors(mode, candidate, now);
    if (mode === "update") return errors[0]?.message ?? null;
    // 新規作成：終了日時が開始日時以前・今以前なら、押す前から出す
    const timing = errors.find((e) => e.code === "end_before_start" || e.code === "end_in_past");
    if (timing !== undefined) return timing.message;
    // 新規作成：必須の欄は、保存・公開を押した後（作成済みのイベントなら常に）出す
    if (!triedSubmit && ws.eventId === null) return null;
    const missing = errors.filter((e) => e.code === "required").map((e) => e.field);
    if (missing.includes("name") && missing.includes("startAt")) return MSG_NEED_NAME_AND_START;
    return errors[0]?.message ?? null;
  })();

  // ---- 文書の問題 ----

  const issues = findDocumentIssues(ws.doc);
  const saveBlocked = issues.some((issue) => issue.code !== "no_stages");
  const publishBlocked = issues.length > 0;
  // 終了日時が開始日時以前のことは、日時の欄の検証の文で出しているので重ねて出さない
  const shownIssues = issues.filter(
    (issue) => !(issue.code === "end_before_start" && fieldError === issue.message),
  );

  const pending = ws.published === null ? [] : unpublishedChanges(ws.published, ws.doc);

  // ---- 保存・公開・作成の途中 ----

  // 今のワークスペースの保存・公開の途中（イベントの作成を含む）は、イベント名・日時の欄を操作できなくする
  // （その間に確定したイベント名・日時の更新が、保存・公開と競合しないように）
  const metaLocked = busy !== null && busy.target === mode;
  // 新規作成でイベントを作成している途中
  const creating = metaLocked && ws.eventId === null;
  // 「元にするイベント」を選べるのは、イベントを作る前で、作成の途中でもないときだけ
  const canChooseBase = ws.eventId === null && !creating;
  // 入力の誤り（その場で出す文）が残っている間・元にするイベントの読み込みの途中は、保存・公開を押せなくする
  const inputInvalid = fieldError !== null || invalidGroupIds.size > 0;
  const baseLoading = ws.loadingBaseEventId !== null;
  // 確認のウィンドウが開いている間も押せなくする（選んで「この内容で保存」するか、やめるまで）
  const saveDisabled = busy !== null || saveBlocked || inputInvalid || baseLoading || dialogOpen;
  const publishDisabled = busy !== null || publishBlocked || inputInvalid || baseLoading || dialogOpen;

  // ---- 編集 ----

  /** 編集の関数を今の文書にかける。失敗したら理由を返す（文書は変えない） */
  const applyEdit = (
    edit: (doc: DefinitionDoc) => EditResult,
    select?: string | null,
  ): EditError | null => {
    const baseDoc = ws.doc;
    const result = edit(baseDoc);
    if (!result.ok) return result.error;
    updateWorkspace(mode, (current) => {
      let doc = result.doc;
      if (current.doc !== baseDoc) {
        // 同じ描画の間にほかの編集が先に入った：今の文書にかけ直す
        const again = edit(current.doc);
        doc = again.ok ? again.doc : current.doc;
      }
      return { ...current, doc, selectedStageId: select === undefined ? current.selectedStageId : select };
    });
    return null;
  };

  /** 編集して、失敗したら理由を知らせる */
  const edit = (change: (doc: DefinitionDoc) => EditResult, select?: string | null): boolean => {
    const error = applyEdit(change, select);
    if (error !== null) setNotice({ tone: "error", text: error.message });
    return error === null;
  };

  const selectStage = (stageId: string): void => {
    updateWorkspace(mode, (current) => ({ ...current, selectedStageId: stageId }));
  };

  const addStageAt = (fudaId: string, position: StagePosition): void => {
    const newStageId = newId("stage");
    edit((doc) => addStage(doc, { newStageId, fudaId, position }), newStageId);
  };

  const handleAddArea = (): string | null => {
    const result = addArea(ws.doc);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.error.message });
      return null;
    }
    const added = result.doc.areas[result.doc.areas.length - 1];
    edit(addArea);
    return added?.id ?? null;
  };

  const handleDrop = (item: DragItem, target: DropTarget): void => {
    if (item.kind === "fuda") {
      if (target.kind === "stage") addStageAt(item.fudaId, { kind: "before", stageId: target.stageId });
      else if (target.kind === "areaEnd") addStageAt(item.fudaId, { kind: "end", areaId: target.areaId });
      else if (target.kind === "fuda") edit((doc) => moveFuda(doc, item.fudaId, target.fudaId));
      else edit((doc) => moveFuda(doc, item.fudaId, null));
      return;
    }
    if (target.kind === "stage") {
      edit((doc) => moveStage(doc, item.stageId, { kind: "before", stageId: target.stageId }), item.stageId);
    } else if (target.kind === "areaEnd") {
      edit((doc) => moveStage(doc, item.stageId, { kind: "end", areaId: target.areaId }), item.stageId);
    }
  };

  // ---- 札・段階・特効の編集（部品へ渡す） ----

  const fudaActions = {
    add: (input: Omit<AddFudaInput, "newFudaId">): EditError | null =>
      applyEdit((doc) => addFuda(doc, { ...input, newFudaId: newId("fuda") })),
    update: (fudaId: string, patch: FudaPatch): EditError | null => applyEdit((doc) => updateFuda(doc, fudaId, patch)),
    remove: (fudaId: string): EditError | null => applyEdit((doc) => deleteFuda(doc, fudaId)),
  };

  const stageActions = {
    update: (stageId: string, patch: StagePatch): void => {
      edit((doc) => updateStage(doc, stageId, patch));
    },
    remove: (stageId: string): void => {
      edit((doc) => deleteStage(doc, stageId), stageToSelectAfterDelete(ws.doc, stageId));
    },
    addGroup: (stageId: string, shipNames?: readonly string[]): string | null => {
      const newGroupId = newId("boost");
      return edit((doc) => addBoostGroup(doc, { stageId, newGroupId, shipNames })) ? newGroupId : null;
    },
    updateGroup: (groupId: string, patch: BoostGroupPatch): void => {
      edit((doc) => updateBoostGroup(doc, groupId, patch));
    },
    removeGroup: (groupId: string): void => {
      edit((doc) => deleteBoostGroup(doc, groupId));
    },
    addShips: (groupId: string, shipNames: readonly string[]): void => {
      edit((doc) => addShipNames(doc, groupId, shipNames));
    },
    removeShip: (groupId: string, shipName: string): void => {
      edit((doc) => removeShipName(doc, groupId, shipName));
    },
    setNationalities: (groupId: string, nationalities: readonly BoostNationality[]): void => {
      edit((doc) => setGroupNationalities(doc, groupId, nationalities));
    },
  };

  // ---- 新規作成と既存を更新の切り替え ----

  const switchMode = (next: EditMode): void => {
    if (next === mode) return;
    // 保存・公開の途中は切り替えない（radio のほか、終了の案内の「新しいイベントを作成」など、どの経路からでも。PR-14）
    if (busy !== null) return;
    // 確認のウィンドウが出ている間は切り替えない（衝突したワークスペースから離れると、確認が解けなくなるため）
    if (dialogOpen) return;
    if (next === "update" && state.workspaces.update === null) return;
    // 新規作成に初めて切り替えたとき：未公開の新規イベントがあればその続き、なければ E1 だけの空の状態
    const fresh =
      next === "create" && state.workspaces.create === null
        ? state.unpublished === null
          ? emptyCreateWorkspace()
          : workspaceFromEvent(state.unpublished)
        : null;
    setState((prev) => {
      if (next === "create" && prev.workspaces.create === null && fresh !== null) {
        return { mode: next, workspaces: { ...prev.workspaces, create: fresh }, unpublished: null };
      }
      return { ...prev, mode: next };
    });
    setTexts(EMPTY_TEXTS);
    setTriedSubmit(false);
    setNotice(null);
  };

  // ---- 新規作成の元にするイベント ----

  const chooseBase = (baseEventId: string): void => {
    if (!canChooseBase) return;
    const target = mode;
    const eventId = ws.doc.event.id;
    // 要求ごとの番号。選ぶたびに進め、読み込みの結果はいちばん新しい要求のものだけを使う
    // （同じイベントを選び直したときも、古い要求の結果で文書や選択を変えない）
    baseRequestRef.current += 1;
    const request = baseRequestRef.current;
    setNotice(null);
    if (baseEventId === "") {
      updateWorkspace(target, (current) => ({
        ...current,
        baseEventId: "",
        loadingBaseEventId: null,
        doc: withEventMeta(createDefinition({ eventId }), current.meta),
        selectedStageId: null,
      }));
      return;
    }
    // 読み込めるまでは選んだ値を「読み込みの途中」として持つ（選択欄はこの値を出し、状態の文と文書は前のまま）
    updateWorkspace(target, (current) => ({ ...current, loadingBaseEventId: baseEventId }));
    repository.loadEventContent(baseEventId).then(
      (base) => {
        // 読み込みの間に選び直していたら（同じイベントを選び直した場合も）捨てる
        if (request !== baseRequestRef.current) return;
        updateWorkspace(target, (current) => {
          // 読み込みの間にイベントを作成していたら、作成したイベントの文書を置き換えない
          if (current.eventId !== null) return { ...current, loadingBaseEventId: null };
          return {
            ...current,
            baseEventId,
            loadingBaseEventId: null,
            doc: withEventMeta(createDefinition({ eventId, base }), current.meta),
            selectedStageId: null,
          };
        });
      },
      (error: unknown) => {
        // 読み込みの間に選び直していたら、古い要求の失敗は知らせず、選択もそのままにする
        if (request !== baseRequestRef.current) return;
        // 選択を前の値（今の文書の元にしたイベント）に戻す
        updateWorkspace(target, (current) => ({ ...current, loadingBaseEventId: null }));
        setNotice({ tone: "error", text: `元にするイベントを読み込めませんでした：${errorMessage(error)}` });
      },
    );
  };

  // ---- イベント名・日時 ----

  /**
   * イベント名・日時を確定する（作成済みのイベントなら updateEventMeta で保存する）。
   * 更新は列の最後に足し、前の更新が終わってから送る（後の更新は、それまでに確定した値をすべて持つ）
   */
  const saveMeta = (nextMeta: EventMeta, field: EventField): void => {
    // 保存・公開の途中は確定しない（欄は操作できないが、念のため。入力欄の値は残す）
    if (metaLocked) return;
    const target = mode;
    const prevMeta = ws.meta;
    const { eventId } = ws;
    if (eventId !== null) {
      // 誤りがあれば保存しない（入力欄の値は残し、その場の検証の文で知らせる）
      if (eventInfoErrors(target, nextMeta, new Date()).length > 0) return;
    }
    updateWorkspace(target, (current) => ({ ...current, meta: nextMeta, doc: withEventMeta(current.doc, nextMeta) }));
    setTexts((current) => withText(current, field, null));
    if (eventId === null) return;
    setNotice(null);
    const confirmed = confirmedMetaRef.current;
    // このイベントの初めての更新なら、今の値（読み込んだ・作成したときの値）が保管庫で確定している値
    if (!confirmed.has(eventId)) confirmed.set(eventId, prevMeta);
    metaQueueRef.current = metaQueueRef.current.then(async () => {
      try {
        await repository.updateEventMeta({ eventId, ...nextMeta });
        confirmed.set(eventId, nextMeta);
      } catch (error: unknown) {
        // 失敗したら、表示を保管庫で確定している値に戻す（その後に別の値へ変えていれば、その更新が送るので戻さない）
        const saved = confirmed.get(eventId) ?? prevMeta;
        updateWorkspace(target, (current) => {
          if (current.meta !== nextMeta) return current;
          const doc = withEventMeta(current.doc, nextMeta) === current.doc ? withEventMeta(current.doc, saved) : current.doc;
          return { ...current, meta: saved, doc };
        });
        setNotice({ tone: "error", text: `イベント名・期間を更新できませんでした：${errorMessage(error)}` });
      }
    });
  };

  const commitField = (field: EventField): void => {
    const text = texts[field];
    if (text === null) return;
    if (isUnchanged(ws.meta, field, text)) {
      setTexts((current) => withText(current, field, null));
      return;
    }
    saveMeta(metaWithField(ws.meta, candidate, field), field);
  };

  const clearEnd = (): void => {
    saveMeta({ ...ws.meta, endAt: null }, "endAt");
  };

  // ---- 下書きの保存・公開 ----

  /** 保存する内容を組み立てる。新規作成でイベント名・日時に誤りがあれば null（理由はその場の検証の文で出す） */
  const prepare = (target: EditMode, current: Workspace): Prepared | null => {
    if (target === "update") return { content: current.doc, meta: current.meta, texts };
    const meta = candidateMeta(current.meta, texts);
    if (eventInfoErrors("create", meta, new Date()).length > 0) {
      setTriedSubmit(true);
      return null;
    }
    return { content: withEventMeta(current.doc, meta), meta, texts };
  };

  /**
   * イベント名・日時の更新の列が終わるまで待ち、保管庫で確定した値を文書の写しに入れる
   * （更新の途中に押された保存・公開を、更新が終わってから行うため。更新に失敗していても続ける）
   */
  const settleMeta = async (eventId: string | null, prepared: Prepared): Promise<Prepared> => {
    await metaQueueRef.current;
    const confirmed = eventId === null ? undefined : confirmedMetaRef.current.get(eventId);
    if (confirmed === undefined) return prepared;
    return { ...prepared, content: withEventMeta(prepared.content, confirmed), meta: confirmed };
  };

  /** 下書きの検証に通らなければ理由を出して false */
  const checkDraft = (content: DefinitionDoc): boolean => {
    const checked = validateDraftDefinition(content);
    if (checked.ok) return true;
    const reasons = checked.errors.map((error) => describeDraftError(content, error)).join("／");
    setNotice({ tone: "error", text: `下書きを保存できません。${reasons}` });
    return false;
  };

  /**
   * 相手の変更を合わせて保存した後の状態にする。編集中の文書は、保存を押した後に編集していなければ保存した文書にし、
   * 編集していれば、その編集を保存した文書に重ねる。自動で合わせた段階の印を残す
   */
  const applyMergedSave = (context: MergeContext, version: number, content: DefinitionDoc): void => {
    const marks = context.mergedItems.flatMap((item) => (item.stageId === null ? [] : [[item.stageId, item.name] as const]));
    const draftNote = { updatedByName: user.displayName, updatedAt: nowIso() };
    updateWorkspace(context.target, (latest) => {
      const doc =
        latest.doc === context.editedFrom
          ? content
          : mergeDefinitions({ base: context.editedFrom, mine: latest.doc, theirs: content }).merged;
      const mergedStages = new Map(latest.mergedStages);
      for (const [stageId, name] of marks) mergedStages.set(stageId, name);
      return { ...latest, baseVersion: version, savedDoc: content, doc, draftNote, mergedStages };
    });
  };

  /**
   * 合わせた文書（doc）を、相手の版（theirs）を開いたときの版として保存し直す。
   * 保存の記録は、相手の内容から doc への変更（自分が足した変更）だけにする。
   * また別の人が先に保存していたら、新しい相手の内容に対して同じ流れ（自動で合わせる → 必要なら確認）をくり返す
   */
  const saveMerged = async (context: MergeContext, doc: DefinitionDoc, theirs: TheirsDraft): Promise<SaveOutcome | null> => {
    if (!checkDraft(doc)) return null;
    const result = await repository.saveDraft({
      eventId: context.eventId,
      baseVersion: theirs.version,
      content: doc,
      logs: saveLogs(theirs.content, doc),
    });
    if (result.status === "conflict") return mergeWith(context, theirs.content, doc, theirsOf(result));
    applyMergedSave(context, result.version, doc);
    return {
      eventId: context.eventId,
      version: result.version,
      content: doc,
      // 保存した文書にない段階（相手が削除した段階など）には「場所を見る」を出さない
      mergedWith: { names: context.names, items: placesIn(context.mergedItems, doc) },
    };
  };

  /**
   * 開いたときの版（base）・自分の内容（mine）・相手の内容（theirs）を 3 方向に合わせる。
   * - 衝突がなく、合わせた文書に問題もなければ、確認せずに保存し直す
   * - 衝突があれば、確認のウィンドウを出して null（選んで保存するのは handleConfirmConflict）
   * - 合わせた文書に問題があれば、理由を出して null
   * イベント名・日時の写し（event）は、正が events 表なので比べない（相手と開いたときの版を自分の写しにそろえる）
   */
  const mergeWith = async (
    context: MergeContext,
    base: DefinitionDoc,
    mine: DefinitionDoc,
    theirsDraft: TheirsDraft,
  ): Promise<SaveOutcome | null> => {
    const input: MergeInput = {
      base: alignEvent(base, mine.event),
      mine,
      theirs: alignEvent(theirsDraft.content, mine.event),
    };
    const theirs: TheirsDraft = { ...theirsDraft, content: input.theirs };
    const merge = mergeDefinitions(input);
    if (merge.conflicts.length > 0) {
      // 保存の途中にモードを切り替えていたら、衝突したワークスペースのモードに戻す（確認のウィンドウが見えて解けるように）
      if (modeRef.current !== context.target) {
        modeRef.current = context.target;
        setState((prev) => ({ ...prev, mode: context.target }));
        setTexts(EMPTY_TEXTS);
        setTriedSubmit(false);
      }
      setConflict({ context, input, merge, theirs, choices: {} });
      return null;
    }
    if (merge.issues.length > 0) {
      // 確認のウィンドウから保存し直して 3 人目と合わせた結果なら、古い版のウィンドウは残さない（閉じて理由を出す）
      setConflict(null);
      const reasons = merge.issues.map((issue) => issueMessage(merge.merged, issue)).join("／");
      setNotice({
        tone: "error",
        text: `下書きを保存できません。開いた後に${theirs.name}が保存した内容と合わせると、${reasons}`,
      });
      return null;
    }
    return saveMerged(withMerged(context, merge, theirs.name), merge.merged, theirs);
  };

  /**
   * 下書きを保存する（まだイベントを作っていなければ作成する）。保存できなければ理由を出して null。
   * fromPublish は「変更を公開する」から呼んだか（衝突して合わせて保存した後の知らせに使う）
   */
  const saveDraftCore = async (
    target: EditMode,
    current: Workspace,
    prepared: Prepared,
    fromPublish: boolean,
  ): Promise<SaveOutcome | null> => {
    const { content, meta } = prepared;
    if (!checkDraft(content)) return null;
    const draftNote = { updatedByName: user.displayName, updatedAt: nowIso() };

    if (current.eventId === null) {
      const created = await repository.createEvent({ name: meta.name, startAt: meta.startAt, endAt: meta.endAt, content });
      const saved: DefinitionDoc = { ...content, event: { ...content.event, id: created.eventId } };
      updateWorkspace(target, (latest) => ({
        ...latest,
        eventId: created.eventId,
        baseVersion: created.draftVersion,
        savedDoc: saved,
        doc: latest.doc === current.doc ? saved : { ...latest.doc, event: { ...latest.doc.event, id: created.eventId } },
        meta,
        draftNote,
      }));
      // 作成に使った値のままの入力欄だけを確定済みに戻す（作成した後に入力した値は消さない）
      setTexts((latest) => clearSentTexts(latest, prepared.texts));
      return { eventId: created.eventId, version: created.draftVersion, content: saved, mergedWith: null };
    }

    const result = await repository.saveDraft({
      eventId: current.eventId,
      baseVersion: current.baseVersion ?? 0,
      content,
      logs: current.savedDoc === null ? [] : saveLogs(current.savedDoc, content),
    });
    if (result.status === "conflict") {
      // 開いた後に他の人が保存していた：開いたときの版・自分の内容・相手の内容を合わせる（要件 3.7「同時編集」）
      const context: MergeContext = {
        target,
        eventId: current.eventId,
        editedFrom: current.doc,
        fromPublish,
        mergedItems: [],
        names: [],
      };
      return mergeWith(context, current.savedDoc ?? result.content, content, theirsOf(result));
    }
    updateWorkspace(target, (latest) => ({
      ...latest,
      baseVersion: result.version,
      savedDoc: content,
      draftNote,
    }));
    return { eventId: current.eventId, version: result.version, content, mergedWith: null };
  };

  /** 相手の変更を合わせて保存したときの知らせ（extra は後ろに足す文） */
  const noticeMerged = (mergedWith: MergedWith, extra = ""): Notice => ({
    tone: "success",
    text: `${savedWithTheirsText(mergedWith.names)}${extra}`,
    mergedItems: mergedWith.items,
  });

  /** 保存・公開を押したボタンを覚える（確認のウィンドウを閉じた後に、フォーカスを戻すため） */
  const rememberTrigger = (): void => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (saveDisabled) return;
    const target = mode;
    const current = ws;
    rememberTrigger();
    setNotice(null);
    const prepared = prepare(target, current);
    if (prepared === null) return;
    setBusy({ kind: "save", target });
    try {
      const ready = await settleMeta(current.eventId, prepared);
      const saved = await saveDraftCore(target, current, ready, false);
      if (saved !== null) {
        setNotice(saved.mergedWith === null ? { tone: "success", text: MSG_SAVED } : noticeMerged(saved.mergedWith));
      }
    } catch (error: unknown) {
      setNotice({ tone: "error", text: `下書きを保存できませんでした：${errorMessage(error)}` });
    } finally {
      setBusy(null);
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (publishDisabled) return;
    const target = mode;
    const current = ws;
    rememberTrigger();
    setNotice(null);
    const prepared = prepare(target, current);
    if (prepared === null) return;
    setBusy({ kind: "publish", target });
    try {
      const ready = await settleMeta(current.eventId, prepared);
      // 保存していない変更があれば先に下書きを保存する（公開するのは保存済みの下書き）
      let saved: SaveOutcome | null =
        current.eventId !== null && current.baseVersion !== null && current.savedDoc !== null && !hasUnsavedChanges(current)
          ? { eventId: current.eventId, version: current.baseVersion, content: current.savedDoc, mergedWith: null }
          : null;
      if (saved === null) {
        saved = await saveDraftCore(target, current, ready, true);
        // 保存できなかった・確認のウィンドウを出した：公開しない（選んで保存した後に公開し直すのは利用者）
        if (saved === null) return;
        // 相手の変更を合わせて保存した：合わせた内容を確かめてもらうため、公開しない
        if (saved.mergedWith !== null) {
          setNotice(noticeMerged(saved.mergedWith, `。${MSG_PUBLISH_AFTER_MERGE}`));
          return;
        }
      }
      const makeLatest = target === "create";
      const result = await repository.publish({ eventId: saved.eventId, baseVersion: saved.version, makeLatest });
      const published = { versionDate: result.versionDate, content: saved.content };
      const label = versionLabel(result.versionDate);
      if (makeLatest) {
        // 新しいイベントが最新になった：「既存を更新」に切り替えて、そのイベントの更新を続ける
        setState((prev) => {
          const created = prev.workspaces.create;
          if (created === null) return prev;
          return { mode: "update", workspaces: { update: { ...created, published }, create: null }, unpublished: null };
        });
        // 同じイベントの編集を続けるので、入力欄の値はそのまま残す（作成に使った値は作成したときに確定済み）
        setTriedSubmit(false);
        setNotice({
          tone: "success",
          text: `公開して、${ready.meta.name}を最新のイベントにしました（${label}）。${MSG_REACH_GENERAL}`,
        });
      } else {
        updateWorkspace(target, (latest) => ({ ...latest, published }));
        // 一般の画面への反映（Deploy Hook）は DB の Webhook が行う（docs/design/database.md 6 章）
        setNotice({ tone: "success", text: `変更を公開しました。${MSG_REACH_GENERAL}` });
      }
    } catch (error: unknown) {
      setNotice({ tone: "error", text: `公開できませんでした：${errorMessage(error)}` });
    } finally {
      setBusy(null);
    }
  };

  // ---- 保存の確認のウィンドウ ----

  const chooseConflict = (conflictId: string, choice: ConflictChoice): void => {
    setConflict((current) =>
      current === null ? current : { ...current, choices: { ...current.choices, [conflictId]: choice } },
    );
  };

  const seePlace = (target: EditMode, stageId: string): void => {
    updateWorkspace(target, (current) => ({ ...current, selectedStageId: stageId }));
  };

  const cancelConflict = (): void => {
    // 保存し直さない（自分の編集はそのまま残す。次に保存すると、また相手の内容と合わせる）
    setConflict(null);
  };

  /** 選んだとおりに作った文書を、相手の版で保存する */
  const handleConfirmConflict = async (): Promise<void> => {
    if (conflict === null || busy !== null) return;
    const resolved = resolveMerge(conflict.input, conflict.choices);
    if (!resolved.ok) return;
    const { context, merge, theirs } = conflict;
    const choseTheirs = Object.values(conflict.choices).includes("theirs");
    setBusy({ kind: "save", target: context.target });
    setNotice(null);
    try {
      const saved = await saveMerged(withMerged(context, merge, theirs.name, choseTheirs), resolved.doc, theirs);
      // null なら、また別の人が先に保存していて確認のウィンドウを入れ替えたか、保存できない理由を出した
      if (saved !== null && saved.mergedWith !== null) {
        setConflict(null);
        // 「変更を公開する」から始めたときは公開していないので、もう一度公開してもらう
        setNotice(noticeMerged(saved.mergedWith, context.fromPublish ? `。${MSG_PUBLISH_AFTER_MERGE}` : ""));
      }
    } catch (error: unknown) {
      setNotice({ tone: "error", text: `下書きを保存できませんでした：${errorMessage(error)}` });
    } finally {
      setBusy(null);
    }
  };

  // ---- 描画 ----

  const selectedStageId = effectiveStageId(ws);
  const selectedStage = ws.doc.stages.find((s) => s.id === selectedStageId) ?? null;
  const publishLabel = mode === "create" ? "公開して最新にする" : "変更を公開する";
  const latestName = state.workspaces.update?.meta.name ?? null;
  // イベント名の横の状態（モックの「開催中」「新規」）。開始日時が読めなければ出さない。
  // 「開催中」は保存済みの終了日時を過ぎていないときだけ（終了したイベントは終了の表示だけを出す）
  const startMs = Date.parse(ws.meta.startAt);
  let nameSuffix: string | null = null;
  if (mode === "create") nameSuffix = "新規";
  else if (!Number.isNaN(startMs)) {
    if (startMs > now.getTime()) nameSuffix = "開始前";
    else if (!perms.ended) nameSuffix = "開催中";
  }

  // 確認のウィンドウ（今のモードのワークスペースの衝突のときだけ出す）
  const shownConflict = conflict !== null && conflict.context.target === mode ? conflict : null;
  // 確認のウィンドウに並べる自動で合わせた所（3 人目と合わせ直したときは、前に合わせた所も含める）。
  // 「場所を見る」は、編集中の文書（攻略の流れに今ある段階）と合わせた文書の両方にある段階だけに出す
  // （相手が足した段階は、保存するまで攻略の流れにないので選べない）
  const pendingMergedItems =
    shownConflict === null
      ? []
      : placesIn(
          placesIn(
            [...shownConflict.context.mergedItems, ...mergedItemsOf(shownConflict.merge, shownConflict.theirs.name)],
            shownConflict.merge.merged,
          ),
          ws.doc,
        );
  // 攻略の流れの段階の印：自動で合わせた段階（保存した後も残す）に、確認の間は相手だけが変えた段階・衝突した段階を重ねる
  const stageMarks = new Map<string, StageMark>();
  for (const [stageId, name] of ws.mergedStages) stageMarks.set(stageId, { kind: "merged", name });
  for (const item of pendingMergedItems) {
    if (item.stageId !== null) stageMarks.set(item.stageId, { kind: "merged", name: item.name });
  }
  for (const item of shownConflict?.merge.conflicts ?? []) {
    if (item.stageId !== null) stageMarks.set(item.stageId, { kind: "conflict" });
  }
  // すべて選んだが、選んだ結果の文書に問題があるときの理由（「この内容で保存」を押せなくして、理由を出す）
  let conflictProblem: string | null = null;
  if (shownConflict !== null) {
    const resolved = resolveMerge(shownConflict.input, shownConflict.choices);
    if (!resolved.ok && resolved.code === "issues") {
      conflictProblem = resolved.issues.map((issue) => issueMessage(resolved.doc, issue)).join("／");
    }
  }
  // 本文を操作できない：終了したイベント、または新規作成の元にするイベントの読み込み中
  const workLocked = !perms.canEditContent || baseLoading;

  // PR-12：既存の更新のときだけ「保存の記録を見る」と「（名前）も編集中」を出す（終了したイベントでも出す）
  const openedEventId = mode === "update" ? ws.eventId : null;
  const shownAreaName =
    selectedStage === null ? null : (ws.doc.areas.find((area) => area.id === selectedStage.areaId)?.name ?? null);
  const draftLogSlot =
    loadSaveLogs !== undefined && openedEventId !== null ? (
      <SaveLogDialog
        loader={loadSaveLogs}
        eventId={openedEventId}
        eventName={ws.meta.name}
        areaNames={ws.doc.areas.map((area) => area.name)}
        members={data.members}
      />
    ) : undefined;
  const presenceSlot =
    connectPresence !== undefined && openedEventId !== null ? (
      <EditingPresence
        key={openedEventId}
        connect={connectPresence}
        eventId={openedEventId}
        displayName={user.displayName}
        areaName={shownAreaName}
        members={data.members}
      />
    ) : undefined;

  return (
    <div className={styles.body}>
      <EventPanel
        user={user}
        members={data.members}
        mode={mode}
        canSwitchToUpdate={state.workspaces.update !== null}
        onSwitchMode={switchMode}
        nameSuffix={nameSuffix}
        latestName={latestName}
        workspace={ws}
        permissions={perms}
        texts={texts}
        fieldError={fieldError}
        onChangeText={(field, value) => setTexts((current) => withText(current, field, value))}
        onCommitText={commitField}
        onClearEnd={clearEnd}
        metaLocked={metaLocked}
        modeLock={dialogOpen ? "confirming" : busy !== null ? "busy" : null}
        baseEventOptions={data.baseEventOptions}
        canChooseBase={canChooseBase}
        onChooseBase={chooseBase}
        pending={pending}
        issues={shownIssues.map((issue) => issueMessage(ws.doc, issue))}
        saveDisabled={saveDisabled}
        publishDisabled={publishDisabled}
        publishLabel={publishLabel}
        onSaveDraft={() => void handleSaveDraft()}
        onPublish={() => void handlePublish()}
        draftLogSlot={draftLogSlot}
        presenceSlot={presenceSlot}
      />

      {perms.ended && ws.meta.endAt !== null && (
        <div role="status" className={styles.endedBanner}>
          <span className={styles.endedTitle}>このイベントは終了しました（{formatDateTimeJst(ws.meta.endAt)} 終了）</span>
          <span className={styles.endedNote}>
            終了したイベントは更新できません。内容は見るだけです。
            {perms.canCreate ? "次のイベントは「新規作成」から作ってください。" : "次のイベントは管理者が作成するまでお待ちください。"}
          </span>
          {perms.canCreate && (
            <button
              type="button"
              className={controls.primaryButton}
              disabled={busy !== null}
              onClick={() => switchMode("create")}
            >
              新しいイベントを作成
            </button>
          )}
        </div>
      )}

      {notice !== null &&
        (notice.tone === "error" ? (
          <div role="alert" className={styles.noticeError}>
            {notice.text}
          </div>
        ) : (
          <div role="status" className={styles.noticeSuccess}>
            {notice.text}
            {notice.mergedItems !== undefined && notice.mergedItems.length > 0 && (
              <ul className={styles.noticeList}>
                {notice.mergedItems.map((item, index) => (
                  <MergedItemLine
                    key={`${item.label}-${String(index)}`}
                    item={item}
                    onSeePlace={(stageId) => seePlace(mode, stageId)}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}

      {shownConflict !== null && (
        <ConflictDialog
          key={shownConflict.theirs.version}
          theirsName={shownConflict.theirs.name}
          theirsAt={shownConflict.theirs.at}
          mergedItems={pendingMergedItems}
          conflicts={shownConflict.merge.conflicts}
          choices={shownConflict.choices}
          problem={conflictProblem}
          saving={busy !== null}
          onChoose={chooseConflict}
          onSeePlace={(stageId) => seePlace(shownConflict.context.target, stageId)}
          onConfirm={() => void handleConfirmConflict()}
          onCancel={cancelConflict}
        />
      )}

      <EditorDndProvider onDrop={handleDrop}>
        <div
          className={styles.workArea}
          inert={workLocked ? true : undefined}
          aria-disabled={perms.canEditContent ? undefined : true}
          aria-busy={baseLoading ? true : undefined}
        >
          <FlowSection
            key={`flow-${mode}`}
            doc={ws.doc}
            selectedStageId={selectedStageId}
            disabled={!perms.canEditContent}
            marks={stageMarks}
            onSelectStage={selectStage}
            onAddStage={(fudaId, areaId) => addStageAt(fudaId, { kind: "end", areaId })}
            onAddArea={handleAddArea}
            onRemoveArea={(areaId) => {
              edit((doc) => removeArea(doc, areaId));
            }}
          />
          <div className={styles.lowerRow}>
            <FudaSection key={`fuda-${mode}`} doc={ws.doc} disabled={!perms.canEditContent} actions={fudaActions} />
            {selectedStage === null ? (
              <p className={styles.noStage}>
                まだ段階がありません。上の攻略の流れで＋を押して札を選ぶと、ここで中身を編集できます
              </p>
            ) : (
              <StageDetail
                key={`${mode}:${selectedStage.id}`}
                doc={ws.doc}
                stage={selectedStage}
                publishLabel={publishLabel}
                knownShipNames={knownShipNames}
                actions={stageActions}
                onGroupInvalidChange={reportGroupInvalid}
              />
            )}
          </div>
        </div>
      </EditorDndProvider>
    </div>
  );
}

