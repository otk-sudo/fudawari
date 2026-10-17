import { AuthApiError, type AuthError, AuthSessionMissingError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DefinitionDoc } from "@/domain/definition-edit";
import { parseDateTime } from "@/domain/definition-edit/datetime";
import { resetSupabaseClient } from "@/lib/supabase";
import { summer2026Definition } from "@/test/fixtures";
import {
  authNetworkError,
  clearSupabaseCalls,
  draftRow,
  eventRow,
  failedQuery,
  type FakeQuery,
  type FakeQueryResult,
  type FakeSupabase,
  installFakeSupabase,
  networkFailure,
  postgrestFailure,
  profileRow,
  publishedDefinitionRow,
  rpcFailure,
  rpcSuccess,
  setLatestEvent,
  stubSupabaseEnv,
  stubSupabaseEnvWithout,
} from "@/test/supabase-fake";
import { isSessionExpiredError } from "./repository-errors";
import { createSupabaseDefinitionRepository } from "./supabase-repository";
import { autumn2025Definition, makeDoc } from "./test-helpers";
import type {
  CreateEventInput,
  DefinitionRepository,
  PlanEditorData,
  PublishInput,
  SaveDraftInput,
  UpdateEventMetaInput,
} from "./types";

// supabase-js の createClient を偽物に差し替える（Supabase に通信しない）
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: vi.fn(),
}));

// イベント定義の保管庫の Supabase の実装（createSupabaseDefinitionRepository。PR-11b、docs/design/database.md 3・4 章）
//
// - load：RLS で読める表（profiles・app_state・events・drafts・published_definitions）から組み立てる
//   - ログイン中の人：profiles の自分の行（auth の利用者の ID で探す）の表示名・権限
//   - 最新のイベント：app_state.latest_event_id の events の行、その drafts の行、published_definitions のそのイベントの最新の 1 件
//     （版の日付は version_label「YYYY/MM/DD 版」から "YYYY-MM-DD"）。下書きを保存した人の表示名は profiles から（いなければ「不明」）
//   - 未公開の新規イベント：管理者のときだけ。published_definitions に行がない events（最新以外）のうち最後に作ったもの
//   - 編集できる人：profiles の全行（管理者を先に、追加した順。協力者画面の表と同じ並び）
//   - 元にするイベントの候補：最新のイベントを含む既存のイベントすべて（新しい順。PR-11c で親が決定）
// - 書き込みは RPC と 1 対 1：save_draft・publish_definition・create_event・update_event_meta
// - 例外のコード（FD001〜FD011・42501 など）と通信の失敗は、画面に出す理由の文（日本語）を message に持つ Error にする
//
// テストで決めたこと（実装の担当・親の確認用）
// - 日時（events の starts_at・ends_at、drafts の updated_at、save_draft の conflict の updatedAt）は、PostgREST が返す形
//   （"2026-10-15T13:40:00.345678+00:00" のように秒の小数が付く）のままにせず、同じ時刻を表す「時差つきで秒の小数のない」形
//   （公開定義の検証・formatDateTimeJst が読める形。例 "2026-10-15T22:40:00+09:00"）にして返す。
//   秒の小数が残ると、画面の日時の表示（formatDateTimeJst）が読めずに元の文字列を出し、文書の検証にも通らないため
// - 理由の文：FD002 は types.ts の例と同じ「このイベントは終了したため、更新できません」。ほかは言葉の要点だけを確かめる
//   （FD001「権限がありません」、FD003「最新のイベントでは…」、FD004「版が違…」、FD005「入力…」、FD009「見つかりません」、
//   42501・PGRST301・状態コード 401「ログインし直してください」、状態コード 0・5xx・例外「通信に失敗しました」、
//   セッションがない「ログインし直してください」、接続先の設定がない「設定がありません」）
// - 元にするイベントの候補は、最新のイベントも含める（新規作成から見ると最新のイベントも過去のイベント。PR-11c で親が決定）

// ---- 人 ----

const ADMIRAL = { userId: "user-admiral", email: "admiral@fudawari.invalid", password: "admiral-pass-0001" } as const;
const AKANE = { userId: "user-akane", email: "akane@fudawari.invalid", password: "akane-pass-00001" } as const;
/** profiles に行がない（定義を編集する権限がない）ログイン利用者 */
const STRANGER = { userId: "user-stranger", email: "stranger@fudawari.invalid", password: "stranger-pass-01" } as const;

// ---- イベント ----

const SUMMER_ID = "2026-summer";
const AUTUMN25_ID = "2025-autumn";
const SPRING25_ID = "2025-spring";
const AUTUMN26_ID = "2026-autumn";
const WINTER26_ID = "2026-winter";

/** 最新のイベントの下書き（公開中の版と見分けられるよう、E2 ゲージ3 の大事さを「重要」にしてある） */
const SUMMER_DRAFT = makeDoc((draft) => {
  const stage = draft.stages.find((s) => s.id === "E2-3");
  if (stage === undefined) throw new Error("テスト用の定義に段階がありません");
  stage.importance = "important";
});

/** 最新のイベントの古い公開版（2026/08/01 版・2026/08/02 版。最新の公開版〔2026/08/04 版〕と見分けられるよう段階の名前を変えてある） */
function olderSummerPublished(versionDate: string, stageName: string): DefinitionDoc {
  return makeDoc((draft) => {
    draft.event.versionDate = versionDate;
    const stage = draft.stages.find((s) => s.id === "E2-3");
    if (stage === undefined) throw new Error("テスト用の定義に段階がありません");
    stage.name = stageName;
  });
}

/** 別のイベントの文書（2025秋イベの文書の event だけを書き換える） */
function otherEventDoc(id: string, name: string): DefinitionDoc {
  return { ...autumn2025Definition, event: { ...autumn2025Definition.event, id, name } };
}

const SPRING25_DOC = otherEventDoc(SPRING25_ID, "2025春イベ");
const AUTUMN26_DRAFT = otherEventDoc(AUTUMN26_ID, "2026秋イベ");
const WINTER26_DRAFT = otherEventDoc(WINTER26_ID, "2026冬イベ");

/**
 * 偽物のサーバーに、人・イベント・下書き・公開版を入れる。行は並び順に頼れないよう、わざと順不同に入れる
 * - profiles：あかね（協力者・07/09 追加）、副提督（管理者・08/01）、協力者B（協力者・07/05）、提督（管理者・06/30）
 * - 最新のイベント：2026夏イベ（開始 2026/08/07 12:00、終了日時は未定）。下書きは版 7（あかねが 10/15 22:40 に保存）。
 *   公開版は 2026/08/01・2026/08/04・2026/08/02 の 3 件（最新は 2026/08/04 版）
 * - 過去のイベント：2025春イベ、2025秋イベ（公開済み）
 * - unpublished が true なら、まだ公開していないイベント 2026冬イベ（10/16 13:00 作成）・2026秋イベ（10/16 12:00 作成）も入れる
 */
function seedServer(fake: FakeSupabase, options: { unpublished?: boolean } = {}): void {
  fake.server.accounts.push(
    { userId: ADMIRAL.userId, email: ADMIRAL.email, password: ADMIRAL.password },
    { userId: AKANE.userId, email: AKANE.email, password: AKANE.password },
    { userId: STRANGER.userId, email: STRANGER.email, password: STRANGER.password },
  );
  fake.server.profiles.push(
    profileRow({ user_id: AKANE.userId, display_name: "あかね", role: "collab", created_at: "2026-07-09T16:30:00+00:00" }),
    profileRow({ user_id: "user-vice", display_name: "副提督", role: "admin", created_at: "2026-08-01T00:00:00+00:00" }),
    profileRow({ user_id: "user-b", display_name: "協力者B", role: "collab", created_at: "2026-07-05T01:00:00+00:00" }),
    profileRow({ user_id: ADMIRAL.userId, display_name: "提督", role: "admin", created_at: "2026-06-30T15:10:00+00:00" }),
  );

  fake.server.events.push(
    eventRow({
      id: SPRING25_ID,
      name: "2025春イベ",
      starts_at: "2025-05-30T03:00:00+00:00",
      ends_at: "2025-06-20T02:00:00+00:00",
      created_at: "2025-05-20T10:00:00+00:00",
    }),
    eventRow({
      id: SUMMER_ID,
      name: "2026夏イベ",
      starts_at: "2026-08-07T03:00:00+00:00",
      ends_at: null,
      created_at: "2026-07-20T10:00:00.123456+00:00",
    }),
    eventRow({
      id: AUTUMN25_ID,
      name: "2025秋イベ",
      starts_at: "2025-11-14T02:00:00+00:00",
      ends_at: "2025-12-02T02:00:00+00:00",
      created_at: "2025-11-01T10:00:00+00:00",
    }),
  );
  setLatestEvent(fake, SUMMER_ID);

  fake.server.drafts.push(
    draftRow({ event_id: SPRING25_ID, version: 2, content: SPRING25_DOC }),
    draftRow({
      event_id: SUMMER_ID,
      version: 7,
      content: SUMMER_DRAFT,
      updated_by: AKANE.userId,
      updated_at: "2026-10-15T13:40:00.345678+00:00",
    }),
    draftRow({ event_id: AUTUMN25_ID, version: 3, content: autumn2025Definition }),
  );

  fake.server.publishedDefinitions.push(
    publishedDefinitionRow({
      id: "pub-summer-0801",
      event_id: SUMMER_ID,
      version_label: "2026/08/01 版",
      content: olderSummerPublished("2026-08-01", "ゲージ3（08/01 版）"),
      published_at: "2026-08-01T11:00:00+00:00",
    }),
    publishedDefinitionRow({
      id: "pub-summer-0804",
      event_id: SUMMER_ID,
      version_label: "2026/08/04 版",
      content: summer2026Definition,
      published_at: "2026-08-04T11:10:00.5+00:00",
    }),
    publishedDefinitionRow({
      id: "pub-summer-0802",
      event_id: SUMMER_ID,
      version_label: "2026/08/02 版",
      content: olderSummerPublished("2026-08-02", "ゲージ3（08/02 版）"),
      published_at: "2026-08-02T11:00:00+00:00",
    }),
    publishedDefinitionRow({
      id: "pub-autumn25",
      event_id: AUTUMN25_ID,
      version_label: "2025/12/02 版",
      content: autumn2025Definition,
      published_at: "2025-12-02T01:00:00+00:00",
    }),
    publishedDefinitionRow({
      id: "pub-spring25",
      event_id: SPRING25_ID,
      version_label: "2025/06/20 版",
      content: SPRING25_DOC,
      published_at: "2025-06-20T01:00:00+00:00",
    }),
  );

  if (options.unpublished === true) {
    fake.server.events.push(
      eventRow({
        id: WINTER26_ID,
        name: "2026冬イベ",
        starts_at: "2027-01-15T02:00:00+00:00",
        created_at: "2026-10-16T13:00:00+00:00",
      }),
      eventRow({
        id: AUTUMN26_ID,
        name: "2026秋イベ",
        starts_at: "2026-11-14T02:00:00+00:00",
        created_at: "2026-10-16T12:00:00+00:00",
      }),
    );
    fake.server.drafts.push(
      draftRow({
        event_id: WINTER26_ID,
        version: 4,
        content: WINTER26_DRAFT,
        updated_by: ADMIRAL.userId,
        updated_at: "2026-10-16T14:00:00+00:00",
      }),
      draftRow({ event_id: AUTUMN26_ID, version: 1, content: AUTUMN26_DRAFT, updated_by: ADMIRAL.userId }),
    );
  }
}

/** ふだんのクライアントでログインする（呼んだ記録は消す） */
async function signInAs(fake: FakeSupabase, account: { email: string; password: string }): Promise<void> {
  await fake.main.auth.signInWithPassword({ email: account.email, password: account.password });
  clearSupabaseCalls(fake);
}

// ---- 結果の確かめ方 ----

/** load が成功することを確かめ、読んだものを返す（失敗なら、理由を見せて検証の失敗にする） */
async function loadData(repository: DefinitionRepository): Promise<PlanEditorData> {
  const outcome = await repository.load().then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => ({ ok: false as const, error: String(error) }),
  );
  expect(outcome, "load が成功すること").toEqual(expect.objectContaining({ ok: true }));
  if (!outcome.ok) throw new Error("load が失敗しました");
  return outcome.data;
}

/** 日時の文字列が、時差つきで秒の小数のない形（公開定義の検証が読める形）で、expected と同じ時刻を表すことを確かめる */
function expectInstant(actual: string | null | undefined, expected: string): void {
  expect(typeof actual, "日時の文字列").toBe("string");
  const actualMs = parseDateTime(actual ?? "");
  expect(actualMs, `「${String(actual)}」が時差つきの日時として読めること（秒の小数は付けない）`).not.toBeUndefined();
  expect(actualMs, `「${String(actual)}」が ${expected} と同じ時刻であること`).toBe(parseDateTime(expected));
}

/** 呼ばれた表の名前（from に渡したもの） */
function readTables(fake: FakeSupabase): string[] {
  return fake.main.from.mock.calls.map(([table]) => table);
}

/** 1 つの表の読み取りだけを、決まった結果（失敗など）にする（ほかの表はふだんどおり読む） */
function failTable(fake: FakeSupabase, table: string, result: FakeQueryResult): void {
  const original = fake.main.from.getMockImplementation();
  if (original === undefined) throw new Error("偽物の from に返し方がありません");
  fake.main.from.mockImplementation((name: string): FakeQuery => (name === table ? failedQuery(result) : original(name)));
}

// ---- 書き込みの入力 ----

const SAVE_INPUT: SaveDraftInput = {
  eventId: SUMMER_ID,
  baseVersion: 7,
  content: summer2026Definition,
  logs: [
    { mapLabel: "E2", summary: "E2 ゲージ3 の大事さを「重要」→「難所」" },
    { mapLabel: null, summary: "札の並び順を変更" },
  ],
};

const PUBLISH_INPUT: PublishInput = { eventId: SUMMER_ID, baseVersion: 8, makeLatest: false };

const CREATE_INPUT: CreateEventInput = {
  name: "2026秋イベ",
  startAt: "2026-11-14T11:00+09:00",
  endAt: null,
  content: AUTUMN26_DRAFT,
};

const META_INPUT: UpdateEventMetaInput = {
  eventId: SUMMER_ID,
  name: "2026夏イベ",
  startAt: "2026-08-07T12:00:00+09:00",
  endAt: "2026-10-20T11:00+09:00",
};

describe("イベント定義の保管庫の Supabase の実装（createSupabaseDefinitionRepository）", () => {
  let fake: FakeSupabase;

  beforeEach(async () => {
    stubSupabaseEnv();
    fake = installFakeSupabase();
    resetSupabaseClient();
    seedServer(fake);
    await signInAs(fake, ADMIRAL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("保管庫を作っただけでは Supabase のクライアントを作らず、load を呼んだときに表を読む", async () => {
    // 準備・実行
    const repository = createSupabaseDefinitionRepository();

    // 検証：作っただけでは通信しない
    expect(fake.createClient).not.toHaveBeenCalled();

    // 実行
    await loadData(repository);

    // 検証
    expect(readTables(fake)).toEqual(expect.arrayContaining(["profiles", "app_state", "events", "drafts", "published_definitions"]));
  });

  describe("load：定義画面を開いたときに読む", () => {
    it("ログイン中の人の表示名と権限を、profiles の自分の行から返す（管理者）", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.user).toEqual({ displayName: "提督", role: "admin" });
    });

    it("協力者でログインしていれば、協力者の表示名と権限を返す", async () => {
      // 準備
      await signInAs(fake, AKANE);
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.user).toEqual({ displayName: "あかね", role: "collab" });
    });

    it("最新のイベント（app_state.latest_event_id）の ID・名前・開始日時・終了日時（未定は null）を events から返す", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.latestEvent?.id).toBe(SUMMER_ID);
      expect(data.latestEvent?.name).toBe("2026夏イベ");
      expectInstant(data.latestEvent?.startAt, "2026-08-07T12:00:00+09:00");
      expect(data.latestEvent?.endAt).toBeNull();
    });

    it("終了日時があれば、同じ時刻を表す日時で返す", async () => {
      // 準備
      const summer = fake.server.events.find((row) => row.id === SUMMER_ID);
      if (summer === undefined) throw new Error("テスト用のイベントがありません");
      summer.ends_at = "2026-10-20T02:00:00+00:00";
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expectInstant(data.latestEvent?.endAt, "2026-10-20T11:00:00+09:00");
    });

    it("最新のイベントの共有の下書きの版・内容・保存した人の表示名・保存した日時（秒の小数を除いた形）を返す", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      const draft = data.latestEvent?.draft;
      expect(draft?.version).toBe(7);
      expect(draft?.content).toEqual(SUMMER_DRAFT);
      expect(draft?.updatedByName).toBe("あかね");
      expectInstant(draft?.updatedAt, "2026-10-15T22:40:00+09:00");
    });

    it("下書きを保存した人が profiles にいなければ（外された協力者）、保存した人の表示名を「不明」にする", async () => {
      // 準備
      const draft = fake.server.drafts.find((row) => row.event_id === SUMMER_ID);
      if (draft === undefined) throw new Error("テスト用の下書きがありません");
      draft.updated_by = "user-removed";
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.latestEvent?.draft.updatedByName).toBe("不明");
    });

    it("公開中の版は、そのイベントの公開版のうち最新の 1 件（版の日付は version_label の「2026/08/04 版」から 2026-08-04）", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.latestEvent?.published).toEqual({ versionDate: "2026-08-04", content: summer2026Definition });
    });

    it("編集できる人を profiles の全行から、管理者を先に、追加した順で返す", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.members).toEqual([
        { displayName: "提督", role: "admin" },
        { displayName: "副提督", role: "admin" },
        { displayName: "協力者B", role: "collab" },
        { displayName: "あかね", role: "collab" },
      ]);
    });

    it("元にするイベントの候補に、最新のイベントを含む既存のイベントすべてを新しい順に（ID と名前）並べる", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証：最新のイベント（2026夏イベ）も候補に含める（PR-11c で親が決定）
      expect(data.baseEventOptions).toEqual([
        { id: SUMMER_ID, name: "2026夏イベ" },
        { id: AUTUMN25_ID, name: "2025秋イベ" },
        { id: SPRING25_ID, name: "2025春イベ" },
      ]);
    });

    it("管理者には、まだ公開していないイベントのうち最後に作ったもの（2026冬イベ）を、その下書きとともに返す（公開中の版はなし）", async () => {
      // 準備
      seedServer(installFakeSupabaseAgain(), { unpublished: true });
      await signInAs(fake, ADMIRAL);
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      const unpublished = data.unpublishedEvent;
      expect(unpublished?.id).toBe(WINTER26_ID);
      expect(unpublished?.name).toBe("2026冬イベ");
      expectInstant(unpublished?.startAt, "2027-01-15T11:00:00+09:00");
      expect(unpublished?.endAt).toBeNull();
      expect(unpublished?.draft.version).toBe(4);
      expect(unpublished?.draft.content).toEqual(WINTER26_DRAFT);
      expect(unpublished?.draft.updatedByName).toBe("提督");
      expect(unpublished?.published).toBeNull();
      // 最新のイベントは変わらない
      expect(data.latestEvent?.id).toBe(SUMMER_ID);
    });

    it.each<[string, readonly string[]]>([
      ["先に作った方を先に入れた", [AUTUMN26_ID, WINTER26_ID]],
      ["後に作った方を先に入れた", [WINTER26_ID, AUTUMN26_ID]],
    ])(
      "まだ公開していないイベントが同じ秒に 2 つ作られていても、作った日時の秒の小数で新しい方（2026冬イベ）を返す（%s。Codex 4301057828）",
      async (_label, order) => {
        // 準備：2026秋イベは 13:00:00.2、2026冬イベは 13:00:00.7 に作った（秒までは同じ）
        seedServer(installFakeSupabaseAgain(), { unpublished: true });
        const createdAt: Readonly<Record<string, string>> = {
          [AUTUMN26_ID]: "2026-10-16T13:00:00.2+00:00",
          [WINTER26_ID]: "2026-10-16T13:00:00.7+00:00",
        };
        const unpublishedRows = fake.server.events.filter((row) => Object.hasOwn(createdAt, row.id));
        fake.server.events = [
          ...fake.server.events.filter((row) => !Object.hasOwn(createdAt, row.id)),
          ...order.map((id) => {
            const row = unpublishedRows.find((r) => r.id === id);
            if (row === undefined) throw new Error(`テスト用のイベント ${id} がありません`);
            return { ...row, created_at: createdAt[id] ?? row.created_at };
          }),
        ];
        await signInAs(fake, ADMIRAL);
        const repository = createSupabaseDefinitionRepository();

        // 実行
        const data = await loadData(repository);

        // 検証：日時の表示は秒の小数なしのまま
        expect(data.unpublishedEvent?.id).toBe(WINTER26_ID);
        expectInstant(data.unpublishedEvent?.startAt, "2027-01-15T11:00:00+09:00");
        expectInstant(data.unpublishedEvent?.draft.updatedAt, "2026-10-16T23:00:00+09:00");
      },
    );

    it("協力者には、まだ公開していないイベントがあっても返さない（null。U18：未公開の新規イベントは管理者だけが編集する）", async () => {
      // 準備
      seedServer(installFakeSupabaseAgain(), { unpublished: true });
      await signInAs(fake, AKANE);
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.unpublishedEvent).toBeNull();
      expect(data.latestEvent?.id).toBe(SUMMER_ID);
    });

    it("まだ公開していないイベントがなければ、管理者にも null を返す", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.unpublishedEvent).toBeNull();
    });

    it("最新のイベントがまだない（latest_event_id が null）なら latestEvent は null。管理者の未公開のイベントは返す", async () => {
      // 準備：初めてのイベント（2026秋イベ）を作ったが、まだ公開していない
      fake = installFakeSupabaseAgain();
      fake.server.accounts.push({ userId: ADMIRAL.userId, email: ADMIRAL.email, password: ADMIRAL.password });
      fake.server.profiles.push(profileRow({ user_id: ADMIRAL.userId, display_name: "提督", role: "admin" }));
      fake.server.events.push(eventRow({ id: AUTUMN26_ID, name: "2026秋イベ", starts_at: "2026-11-14T02:00:00+00:00" }));
      fake.server.drafts.push(draftRow({ event_id: AUTUMN26_ID, version: 1, content: AUTUMN26_DRAFT }));
      await signInAs(fake, ADMIRAL);
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const data = await loadData(repository);

      // 検証
      expect(data.latestEvent).toBeNull();
      expect(data.unpublishedEvent?.id).toBe(AUTUMN26_ID);
      expect(data.members).toEqual([{ displayName: "提督", role: "admin" }]);
    });

    it("ログインしていなければ（セッションがない）、「ログインし直してください」の理由で失敗し、イベントと下書きを読まない", async () => {
      // 準備
      await fake.main.auth.signOut();
      clearSupabaseCalls(fake);
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.load()).rejects.toThrow(/ログインし直してください/);
      expect(readTables(fake)).not.toContain("events");
      expect(readTables(fake)).not.toContain("drafts");
    });

    it("ログインしていても profiles に自分の行がなければ、「権限がありません」の理由で失敗する", async () => {
      // 準備
      await signInAs(fake, STRANGER);
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.load()).rejects.toThrow(/権限がありません/);
    });

    it("接続先の設定（環境変数）がなければ、「設定がありません」の理由で失敗し、クライアントを作らない", async () => {
      // 準備
      stubSupabaseEnvWithout("NEXT_PUBLIC_SUPABASE_URL");
      resetSupabaseClient();
      clearSupabaseCalls(fake);
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.load()).rejects.toThrow(/設定がありません/);
      expect(fake.createClient).not.toHaveBeenCalled();
    });

    it("表の読み取りが通信に失敗したら、「通信に失敗しました」の理由で失敗する", async () => {
      // 準備
      failTable(fake, "drafts", networkFailure());
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.load()).rejects.toThrow(/通信に失敗しました/);
    });

    it.each<[string, () => FakeQueryResult]>([
      ["42501（権限がない）", () => postgrestFailure("42501", 403, "permission denied")],
      ["PGRST301（JWT の期限切れ）", () => postgrestFailure("PGRST301", 401, "JWT expired")],
      ["状態コード 401", () => postgrestFailure("", 401, "Unauthorized")],
    ])("表の読み取りが %s で断られたら、「ログインし直してください」の理由で失敗する", async (_label, failure) => {
      // 準備
      failTable(fake, "events", failure());
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.load()).rejects.toThrow(/ログインし直してください/);
    });
  });

  describe("セッション切れ（SessionExpiredError）の見分け方（PR-11c：P4・M2-7・M2-8）", () => {
    /** load の失敗（成功したら検証の失敗にする） */
    async function loadFailure(repository: DefinitionRepository): Promise<unknown> {
      const outcome = await repository.load().then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect(outcome.ok, "load が失敗すること").toBe(false);
      return outcome.ok ? undefined : outcome.error;
    }

    /** auth.getUser が error を返すようにする */
    function failGetUser(error: AuthError): void {
      fake.main.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error });
    }

    it.each<[string, () => AuthError]>([
      ["AuthApiError 401", () => new AuthApiError("Unauthorized", 401, undefined)],
      ["AuthApiError 403（bad_jwt）", () => new AuthApiError("invalid JWT", 403, "bad_jwt")],
      ["AuthApiError 403（session_not_found）", () => new AuthApiError("Session not found", 403, "session_not_found")],
      ["セッションがない（AuthSessionMissingError）", () => new AuthSessionMissingError()],
    ])("auth.getUser が %s を返したら、SessionExpiredError で失敗し、イベントを読まない", async (_label, error) => {
      // 準備
      failGetUser(error());
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const failure = await loadFailure(repository);

      // 検証
      expect(isSessionExpiredError(failure)).toBe(true);
      expect(readTables(fake)).not.toContain("events");
    });

    it.each<[string, () => AuthError]>([
      ["届かなかった（AuthRetryableFetchError）", authNetworkError],
      ["Auth のサーバーの障害（AuthApiError 500）", () => new AuthApiError("Internal Server Error", 500, "unexpected_failure")],
      ["Auth のサーバーの障害（AuthApiError 503）", () => new AuthApiError("Service Unavailable", 503, undefined)],
    ])("auth.getUser が %s を返したら、SessionExpiredError にせず「通信に失敗しました」で失敗する", async (_label, error) => {
      // 準備
      failGetUser(error());
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const failure = await loadFailure(repository);

      // 検証
      expect(isSessionExpiredError(failure)).toBe(false);
      expect(String(failure)).toMatch(/通信に失敗しました/);
    });

    it("auth.getUser が回数の上限（AuthApiError 429）を返したら、SessionExpiredError にせず「しばらくしてから」やり直す失敗にする", async () => {
      // 準備
      failGetUser(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"));
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const failure = await loadFailure(repository);

      // 検証
      expect(isSessionExpiredError(failure)).toBe(false);
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toMatch(/しばらくしてから/);
    });

    it("auth.getUser が例外を投げたら（fetch の失敗など）、SessionExpiredError にせず「通信に失敗しました」で失敗する", async () => {
      // 準備
      fake.main.auth.getUser.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const failure = await loadFailure(repository);

      // 検証
      expect(isSessionExpiredError(failure)).toBe(false);
      expect(String(failure)).toMatch(/通信に失敗しました/);
    });

    it("表の読み取りが 42501（権限がない）で断られたら、SessionExpiredError にせず「権限がありません」で失敗する", async () => {
      // 準備
      failTable(fake, "events", postgrestFailure("42501", 403, "permission denied"));
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const failure = await loadFailure(repository);

      // 検証
      expect(isSessionExpiredError(failure)).toBe(false);
      expect(String(failure)).toMatch(/権限がありません/);
    });

    it("下書きの保存が 42501（権限がない）で断られても、SessionExpiredError にしない", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(postgrestFailure("42501", 403, "permission denied"));
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const failure = await repository.saveDraft(SAVE_INPUT).then(
        () => undefined,
        (error: unknown) => error,
      );

      // 検証
      expect(failure).toBeInstanceOf(Error);
      expect(isSessionExpiredError(failure)).toBe(false);
      expect(String(failure)).toMatch(/権限がありません/);
    });

    it.each<[string, () => FakeQueryResult]>([
      ["PGRST301（JWT の期限切れ）", () => postgrestFailure("PGRST301", 401, "JWT expired")],
      ["状態コード 401", () => postgrestFailure("", 401, "Unauthorized")],
    ])("表の読み取りが %s で断られたら、SessionExpiredError で失敗する", async (_label, failure) => {
      // 準備
      failTable(fake, "events", failure());
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      expect(isSessionExpiredError(await loadFailure(repository))).toBe(true);
    });
  });

  describe("saveDraft：下書きの保存（save_draft）", () => {
    it("イベント ID・開いたときの版・文書・保存の記録を、save_draft の引数（p_event_id・p_base_version・p_content・p_logs）にして呼ぶ", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcSuccess({ status: "saved", version: 8 }));
      const repository = createSupabaseDefinitionRepository();

      // 実行
      await repository.saveDraft(SAVE_INPUT).catch(() => undefined);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("save_draft", {
        p_event_id: SUMMER_ID,
        p_base_version: 7,
        p_content: summer2026Definition,
        p_logs: [
          { mapLabel: "E2", summary: "E2 ゲージ3 の大事さを「重要」→「難所」" },
          { mapLabel: null, summary: "札の並び順を変更" },
        ],
      });
    });

    it("保存できたら、新しい版を返す（status saved）", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcSuccess({ status: "saved", version: 8 }));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.saveDraft(SAVE_INPUT)).resolves.toEqual({ status: "saved", version: 8 });
    });

    it("開いた後に他の人が保存していたら（status conflict）、今の版・内容・保存した人・日時（秒の小数を除いた形）を返す", async () => {
      // 準備
      const theirs = makeDoc((draft) => {
        const stage = draft.stages.find((s) => s.id === "E3-4");
        if (stage === undefined) throw new Error("テスト用の定義に段階がありません");
        stage.importance = "important";
      });
      fake.main.rpc.mockResolvedValueOnce(
        rpcSuccess({
          status: "conflict",
          version: 8,
          content: theirs,
          updatedByName: "協力者B",
          updatedAt: "2026-10-17T02:52:00.254321+00:00",
        }),
      );
      const repository = createSupabaseDefinitionRepository();

      // 実行
      const outcome = await repository.saveDraft(SAVE_INPUT).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error: String(error) }),
      );

      // 検証
      expect(outcome, "saveDraft が成功すること").toEqual(expect.objectContaining({ ok: true }));
      if (!outcome.ok) return;
      expect(outcome.result).toEqual(
        expect.objectContaining({ status: "conflict", version: 8, content: theirs, updatedByName: "協力者B" }),
      );
      if (outcome.result.status !== "conflict") return;
      expectInstant(outcome.result.updatedAt, "2026-10-17T11:52:00+09:00");
    });
  });

  describe("publish：公開（publish_definition）", () => {
    it("イベント ID・公開する版・最新にするかを、publish_definition の引数（p_event_id・p_base_version・p_make_latest）にして呼ぶ", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(
        rpcSuccess({ status: "published", id: "pub-1", versionLabel: "2026/10/17 版", versionDate: "2026-10-17" }),
      );
      const repository = createSupabaseDefinitionRepository();

      // 実行
      await repository.publish({ eventId: AUTUMN26_ID, baseVersion: 1, makeLatest: true }).catch(() => undefined);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("publish_definition", {
        p_event_id: AUTUMN26_ID,
        p_base_version: 1,
        p_make_latest: true,
      });
    });

    it("公開できたら、公開版の ID・版の表示・版の日付を返す", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(
        rpcSuccess({ status: "published", id: "pub-1", versionLabel: "2026/10/17 版", versionDate: "2026-10-17" }),
      );
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.publish(PUBLISH_INPUT)).resolves.toEqual({
        status: "published",
        id: "pub-1",
        versionLabel: "2026/10/17 版",
        versionDate: "2026-10-17",
      });
    });
  });

  describe("createEvent：イベントの作成（create_event）", () => {
    it("名前・開始日時・終了日時・初期の文書を、create_event の引数（p_name・p_starts_at・p_ends_at・p_content）にして呼ぶ", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcSuccess("new-event-uuid"));
      const repository = createSupabaseDefinitionRepository();

      // 実行
      await repository.createEvent(CREATE_INPUT).catch(() => undefined);

      // 検証
      expect(fake.main.rpc).toHaveBeenCalledWith("create_event", {
        p_name: "2026秋イベ",
        p_starts_at: "2026-11-14T11:00+09:00",
        p_ends_at: null,
        p_content: AUTUMN26_DRAFT,
      });
    });

    it("作成できたら、返ったイベント ID と、下書きの版 1 を返す", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcSuccess("new-event-uuid"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.createEvent(CREATE_INPUT)).resolves.toEqual({ eventId: "new-event-uuid", draftVersion: 1 });
    });
  });

  describe("updateEventMeta：イベントの名前・期間の更新（update_event_meta）", () => {
    it("イベント ID・名前・開始日時・終了日時を、update_event_meta の引数（p_event_id・p_name・p_starts_at・p_ends_at）にして呼び、成功したら何も返さない", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcSuccess(null, 204));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.updateEventMeta(META_INPUT)).resolves.toBeUndefined();
      expect(fake.main.rpc).toHaveBeenCalledWith("update_event_meta", {
        p_event_id: SUMMER_ID,
        p_name: "2026夏イベ",
        p_starts_at: "2026-08-07T12:00:00+09:00",
        p_ends_at: "2026-10-20T11:00+09:00",
      });
    });
  });

  describe("loadEventContent：元にするイベントの文書", () => {
    it("そのイベントの公開版のうち最新のものの文書を返す", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.loadEventContent(SUMMER_ID)).resolves.toEqual(summer2026Definition);
    });

    it("まだ公開していないイベントなら、下書きの文書を返す", async () => {
      // 準備
      seedServer(installFakeSupabaseAgain(), { unpublished: true });
      await signInAs(fake, ADMIRAL);
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.loadEventContent(AUTUMN26_ID)).resolves.toEqual(AUTUMN26_DRAFT);
    });

    it("公開版も下書きもないイベントなら、「見つかりません」の理由で失敗する", async () => {
      // 準備
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.loadEventContent("no-such-event")).rejects.toThrow(/見つかりません/);
    });
  });

  describe("例外のコードと通信の失敗を、画面に出す理由の文にする", () => {
    it.each<[string, string, string | RegExp]>([
      ["FD001（権限がない）", "FD001", /権限がありません/],
      ["FD002（イベントが終了している）", "FD002", "このイベントは終了したため、更新できません"],
      ["FD003（更新できるイベントではない）", "FD003", /最新のイベントでは/],
      ["FD004（版が違う）", "FD004", /版が違/],
      ["FD005（入力が不正）", "FD005", /入力/],
      ["FD009（見つからない）", "FD009", /見つかりません/],
    ])("下書きの保存が %s で失敗したら、その理由の Error にする", async (_label, code, message) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure(code));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.saveDraft(SAVE_INPUT)).rejects.toThrow(message);
    });

    it.each<[string, () => FakeQueryResult]>([
      ["42501（権限がない）", () => postgrestFailure("42501", 403, "permission denied")],
      ["PGRST301（JWT の期限切れ）", () => postgrestFailure("PGRST301", 401, "JWT expired")],
      ["状態コード 401", () => postgrestFailure("", 401, "Unauthorized")],
    ])("下書きの保存が %s で断られたら、「ログインし直してください」の理由にする", async (_label, failure) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(failure());
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.saveDraft(SAVE_INPUT)).rejects.toThrow(/ログインし直してください/);
    });

    it.each<[string, () => FakeQueryResult]>([
      ["届かなかった（状態コード 0）", networkFailure],
      ["サーバーの障害（状態コード 503）", () => postgrestFailure("", 503, "Service Unavailable")],
    ])("下書きの保存が通信に失敗したら（%s）、「通信に失敗しました」の理由にする", async (_label, failure) => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(failure());
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.saveDraft(SAVE_INPUT)).rejects.toThrow(/通信に失敗しました/);
    });

    it("呼び出しが例外を投げたら（fetch の失敗など）、「通信に失敗しました」の理由にする", async () => {
      // 準備
      fake.main.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.saveDraft(SAVE_INPUT)).rejects.toThrow(/通信に失敗しました/);
    });

    it("公開が FD004（下書きの版が違う）で失敗したら、その理由にする", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure("FD004"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.publish(PUBLISH_INPUT)).rejects.toThrow(/版が違/);
    });

    it("公開が FD003（最新でないイベントを最新にせずに公開した）で失敗したら、その理由にする", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure("FD003"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.publish(PUBLISH_INPUT)).rejects.toThrow(/最新のイベントでは/);
    });

    it("イベントの作成が FD005（入力が不正）で失敗したら、その理由にする", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure("FD005", "終了日時は今より後にしてください"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.createEvent(CREATE_INPUT)).rejects.toThrow(/入力/);
    });

    it("名前・期間の更新が FD001（協力者が名前・開始日時を変えた）で失敗したら、その理由にする", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure("FD001"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.updateEventMeta(META_INPUT)).rejects.toThrow(/権限がありません/);
    });

    it("名前・期間の更新が FD002（終了したイベント）で失敗したら、その理由にする", async () => {
      // 準備
      fake.main.rpc.mockResolvedValueOnce(rpcFailure("FD002"));
      const repository = createSupabaseDefinitionRepository();

      // 実行・検証
      await expect(repository.updateEventMeta(META_INPUT)).rejects.toThrow("このイベントは終了したため、更新できません");
    });
  });

  /** 偽物のサーバーとクライアントを作り直す（中身が空のサーバーから入れ直すとき） */
  function installFakeSupabaseAgain(): FakeSupabase {
    fake = installFakeSupabase();
    resetSupabaseClient();
    return fake;
  }
});
