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
import { FlowSection } from "./FlowSection";
import { FudaSection } from "./FudaSection";
import { StageDetail } from "./StageDetail";
import type { DefinitionRepository, EditableEvent, PlanEditorData } from "./types";
import controls from "./controls.module.css";
import styles from "./PlanEditor.module.css";

export type DefinitionEditorProps = {
  /** 画面を開いたときに読んだもの */
  data: PlanEditorData;
  /** 定義の保管庫 */
  repository: DefinitionRepository;
  /** 艦船マスタにある改装段階を問わない艦名（なければ知らない艦名を警告しない） */
  knownShipNames: ReadonlySet<string> | undefined;
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
}

/** 保存・公開の途中（kind：操作、target：保存するワークスペースのモード） */
interface Busy {
  readonly kind: "save" | "publish";
  readonly target: EditMode;
}

/** 下書きの保存の結果（保存した版と文書） */
interface SaveOutcome {
  readonly eventId: string;
  readonly version: number;
  readonly content: DefinitionDoc;
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
 */
export function DefinitionEditor({ data, repository, knownShipNames }: DefinitionEditorProps): ReactNode {
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
  const saveDisabled = busy !== null || saveBlocked || inputInvalid || baseLoading;
  const publishDisabled = busy !== null || publishBlocked || inputInvalid || baseLoading;

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
  };

  // ---- 新規作成と既存を更新の切り替え ----

  const switchMode = (next: EditMode): void => {
    if (next === mode) return;
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

  /** 下書きを保存する（まだイベントを作っていなければ作成する）。保存できなければ理由を出して null */
  const saveDraftCore = async (target: EditMode, current: Workspace, prepared: Prepared): Promise<SaveOutcome | null> => {
    const { content, meta } = prepared;
    const checked = validateDraftDefinition(content);
    if (!checked.ok) {
      const reasons = checked.errors.map((error) => describeDraftError(content, error)).join("／");
      setNotice({ tone: "error", text: `下書きを保存できません。${reasons}` });
      return null;
    }
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
      return { eventId: created.eventId, version: created.draftVersion, content: saved };
    }

    const result = await repository.saveDraft({
      eventId: current.eventId,
      baseVersion: current.baseVersion ?? 0,
      content,
      logs: current.savedDoc === null ? [] : saveLogs(current.savedDoc, content),
    });
    if (result.status === "conflict") {
      // 3 方向マージと衝突の確認のウィンドウは PR-11b で作る
      setNotice({
        tone: "error",
        text: `開いた後に${result.updatedByName}が下書きを保存していたため、保存していません。合わせて保存する機能はまだありません`,
      });
      return null;
    }
    updateWorkspace(target, (latest) => ({
      ...latest,
      baseVersion: result.version,
      savedDoc: content,
      draftNote,
    }));
    return { eventId: current.eventId, version: result.version, content };
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (saveDisabled) return;
    const target = mode;
    const current = ws;
    setNotice(null);
    const prepared = prepare(target, current);
    if (prepared === null) return;
    setBusy({ kind: "save", target });
    try {
      const ready = await settleMeta(current.eventId, prepared);
      if ((await saveDraftCore(target, current, ready)) !== null) setNotice({ tone: "success", text: MSG_SAVED });
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
    setNotice(null);
    const prepared = prepare(target, current);
    if (prepared === null) return;
    setBusy({ kind: "publish", target });
    try {
      const ready = await settleMeta(current.eventId, prepared);
      // 保存していない変更があれば先に下書きを保存する（公開するのは保存済みの下書き）
      let saved: SaveOutcome | null =
        current.eventId !== null && current.baseVersion !== null && current.savedDoc !== null && !hasUnsavedChanges(current)
          ? { eventId: current.eventId, version: current.baseVersion, content: current.savedDoc }
          : null;
      if (saved === null) {
        saved = await saveDraftCore(target, current, ready);
        if (saved === null) return;
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
        setNotice({ tone: "success", text: `公開して、${ready.meta.name}を最新のイベントにしました（${label}）` });
      } else {
        updateWorkspace(target, (latest) => ({ ...latest, published }));
        setNotice({ tone: "success", text: `変更を公開しました（${label}）。一般の画面に反映されるまで数分かかります` });
      }
    } catch (error: unknown) {
      setNotice({ tone: "error", text: `公開できませんでした：${errorMessage(error)}` });
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
      />

      {perms.ended && ws.meta.endAt !== null && (
        <div role="status" className={styles.endedBanner}>
          <span className={styles.endedTitle}>このイベントは終了しました（{formatDateTimeJst(ws.meta.endAt)} 終了）</span>
          <span className={styles.endedNote}>
            終了したイベントは更新できません。内容は見るだけです。
            {perms.canCreate ? "次のイベントは「新規作成」から作ってください。" : "次のイベントは管理者が作成するまでお待ちください。"}
          </span>
          {perms.canCreate && (
            <button type="button" className={controls.primaryButton} onClick={() => switchMode("create")}>
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
          </div>
        ))}

      <EditorDndProvider onDrop={handleDrop}>
        <div
          className={styles.workArea}
          inert={perms.canEditContent ? undefined : true}
          aria-disabled={perms.canEditContent ? undefined : true}
        >
          <FlowSection
            key={`flow-${mode}`}
            doc={ws.doc}
            selectedStageId={selectedStageId}
            disabled={!perms.canEditContent}
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

