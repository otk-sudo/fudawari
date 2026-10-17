import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  ADMIN,
  COLLAB,
  configuredSupabaseUrl,
  FakeSupabase,
  type FakeAccount,
  type FakeSupabaseOptions,
  NOW,
  SAVE_LOGS,
  signInAs,
  SPRING_EVENT_NAME,
  springDoc,
  SUMMER_DRAFT_VERSION,
  SUMMER_ENDED_AT,
  SUMMER_EVENT_ID,
  SUMMER_EVENT_NAME,
} from "../src/test/permissions-e2e";
import { summer2026Definition } from "../src/test/fixtures";

// 要件 2.3「画面と操作の可否」の表の各行を、一般・協力者・管理者の 3 つの立場で確かめる（roadmap T4-1、plan-v1 の PR-13）
//
// - 一般利用者：ログインしていない状態。Supabase には通信しない（CLAUDE.md・e2e/no-supabase.spec.ts と同じ守り）
// - 協力者・管理者：ログイン済みの状態を localStorage に入れ（signInAs）、Supabase の Auth・表・RPC を page.route の偽物で答える
//   （FakeSupabase。src/test/permissions-e2e.ts）。権限の強制（要件 2.4・RLS）は pgTAP（supabase/tests/database）で確かめ済みなので、
//   ここでは画面の出し分けと、画面が呼ぶ RPC を確かめる
// - 「保存の記録を見る」の行（PR-12）は、ウィンドウ「共有の下書きの記録」が開いて記録が出ることを確かめる（終了したイベントでも見られる）
// - 定義画面の Realtime（編集中の表示）は偽物が受けて閉じる（つながらない）。編集中の表示は出なくてよい
//
// 協力者・管理者の画面はビルドのときの接続先（NEXT_PUBLIC_SUPABASE_URL・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY）が要る。
// CI の e2e のジョブはダミーの接続先でビルドする。手元で接続先なしにビルドしたときは、協力者・管理者のテストを飛ばす（CI では飛ばさず失敗させる）

const SUPABASE_URL = configuredSupabaseUrl();
const MISSING_SUPABASE_URL =
  "NEXT_PUBLIC_SUPABASE_URL・NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を入れてビルド・実行してください（例 https://example.supabase.co と sb_publishable_dummy）";

/** 一般の画面（パスと h1） */
const GENERAL_SCREENS = [
  { path: "/", heading: "札割りプランナー" },
  { path: "/list", heading: "札割り一覧" },
  { path: "/assign", heading: "割り振り" },
  { path: "/import", heading: "艦娘の取り込み" },
  { path: "/drift", heading: "計画と実際の札" },
] as const;

const DEFINITION_PATH = "/definition";
const COLLABORATORS_PATH = "/collaborators";
const DEFINITION_DENIED = "このページは管理者・協力者のみ使えます";
const ADMIN_ONLY = "このページは管理者のみ使えます";
const ADMIN_ONLY_NOTE = "協力者の追加や削除は管理者にお願いしてください";
const ENDED_TITLE = "このイベントは終了しました（2026/10/01 12:00 終了）";
const ENDED_NOTE = "終了したイベントは更新できません。内容は見るだけです。";

// ---- 部品の探し方 ----

function sideNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "メインメニュー" });
}

function heading(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

function button(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("button", { name, exact: true });
}

function settingsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "設定" });
}

/** 定義画面の上部の欄（section aria-label="イベントの情報"） */
function eventPanel(page: Page): Locator {
  return page.getByRole("region", { name: "イベントの情報" });
}

/**
 * 定義画面の本文（攻略の流れ・札の一覧・段階の詳細）を操作できない状態か。
 * 本文の入れ物に inert（操作もフォーカスもできない）が付き、その入れ物が aria-disabled="true" なら true
 */
async function isDefinitionWorkLocked(page: Page): Promise<boolean> {
  return page.getByText("攻略の流れ", { exact: true }).evaluate((element) => {
    const area = element.closest("[inert]");
    return area !== null && area.getAttribute("aria-disabled") === "true";
  });
}

/** 左メニューの「設定」で設定のウィンドウを開く */
async function openSettings(page: Page): Promise<Locator> {
  await button(sideNav(page), "設定").click();
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 左メニューの「管理」の区切りの下の項目 */
const MANAGEMENT_LINKS = ["定義", "協力者"] as const;

/**
 * 一般の画面を順に開き、見出しが出て、拒否の表示が出ないことを確かめる。
 * 各画面で、左メニューの「管理」の下に managementLinks の項目だけがあることも確かめる（要件 2.2：一般の画面でも管理メニューを出し続ける）。
 * 最後に設定のウィンドウを開く（開いている間は後ろの左メニューが読み上げから外れるので、左メニューはその前に確かめる）
 */
async function expectGeneralScreensOpen(
  page: Page,
  managementLinks: readonly (typeof MANAGEMENT_LINKS)[number][],
): Promise<void> {
  for (const { path, heading: name } of GENERAL_SCREENS) {
    await test.step(`${path} を開ける`, async () => {
      await page.goto(path);
      await expect(heading(page, name)).toBeVisible();
      await expect(page.getByText(DEFINITION_DENIED)).toHaveCount(0);
      await expect(page.getByText(ADMIN_ONLY)).toHaveCount(0);
      for (const label of MANAGEMENT_LINKS) {
        await expect(sideNav(page).getByRole("link", { name: label, exact: true })).toHaveCount(
          managementLinks.includes(label) ? 1 : 0,
        );
      }
    });
  }
  await test.step("設定のウィンドウを開ける", async () => {
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "表示" })).toBeVisible();
  });
}

// ---- 保存の記録 ----

/** 2026夏イベの保存の記録（画面に出す順＝新しい順） */
const SUMMER_LOGS = SAVE_LOGS.filter((log) => log.event_id === SUMMER_EVENT_ID).sort((a, b) => b.id - a.id);
/** ほかのイベント（2026春イベ）の記録（出してはいけない） */
const OTHER_EVENT_LOGS = SAVE_LOGS.filter((log) => log.event_id !== SUMMER_EVENT_ID);

/** 定義画面の「保存の記録を見る」でウィンドウを開き、2026夏イベの記録だけが新しい順に出ることを確かめる */
async function expectSaveLogsShown(page: Page, fake: FakeSupabase): Promise<void> {
  await button(eventPanel(page), "保存の記録を見る").click();

  const dialog = page.getByRole("dialog", { name: "共有の下書きの記録" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(SUMMER_EVENT_NAME);
  const rows = dialog.getByRole("list", { name: "記録" }).getByRole("listitem");
  await expect(rows).toHaveCount(SUMMER_LOGS.length);
  for (const [index, log] of SUMMER_LOGS.entries()) {
    await expect(rows.nth(index)).toContainText(log.user_name);
    await expect(rows.nth(index)).toContainText(log.kind === "save" ? "下書き保存" : "公開");
    await expect(rows.nth(index)).toContainText(log.summary);
  }
  await expect(dialog).toContainText(`${SUMMER_LOGS.length} / ${SUMMER_LOGS.length} 件`);
  for (const log of OTHER_EVENT_LOGS) await expect(dialog).not.toContainText(log.summary);
  expect(fake.requests.filter((r) => r.path === "/rest/v1/save_logs").length).toBeGreaterThan(0);

  // 閉じられる
  await button(dialog, "閉じる").filter({ hasText: "閉じる" }).click();
  await expect(dialog).toBeHidden();
}

// ---- Supabase への通信 ----

const SUPABASE_API_PATHS = ["/auth/v1/", "/rest/v1/", "/realtime/v1/", "/storage/v1/", "/functions/v1/"];

function isSupabaseRequest(url: string): boolean {
  if (SUPABASE_URL !== null && url.startsWith(SUPABASE_URL)) return true;
  const { hostname, pathname } = new URL(url);
  return hostname.endsWith(".supabase.co") || SUPABASE_API_PATHS.some((path) => pathname.startsWith(path));
}

/** ページが出した Supabase への通信（HTTP・WebSocket）の URL を記録し始める */
function recordSupabaseRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (isSupabaseRequest(request.url())) urls.push(request.url());
  });
  page.on("websocket", (socket) => {
    if (isSupabaseRequest(socket.url())) urls.push(socket.url());
  });
  return urls;
}

// ---- 協力者・管理者の準備 ----

function requireSupabaseUrl(): string {
  if (SUPABASE_URL === null) throw new Error(`Supabase の接続先がありません。${MISSING_SUPABASE_URL}`);
  return SUPABASE_URL;
}

/** 手元で接続先なしにビルドしたときだけ飛ばす（CI では飛ばさず、requireSupabaseUrl で失敗させる） */
function skipWithoutSupabase(): void {
  test.skip(SUPABASE_URL === null && !process.env.CI, `協力者・管理者の画面は確かめられません。${MISSING_SUPABASE_URL}`);
}

const RUNNING: FakeSupabaseOptions = { summerEndsAt: null };
const ENDED: FakeSupabaseOptions = { summerEndsAt: SUMMER_ENDED_AT };

/** 時刻を固定し、偽物の Supabase を取り付け、ログイン済みの状態にする（ページを開く前に呼ぶ） */
async function prepareSignedIn(page: Page, account: FakeAccount, options: FakeSupabaseOptions = RUNNING): Promise<FakeSupabase> {
  const supabaseUrl = requireSupabaseUrl();
  await page.clock.setFixedTime(NOW);
  const fake = new FakeSupabase(supabaseUrl, account, options);
  await fake.install(page);
  await signInAs(page, account, supabaseUrl);
  return fake;
}

/** 定義画面を開き、読み込みが済む（「ログイン中：（名前）（権限）」が出る）まで待つ */
async function openDefinition(page: Page, account: FakeAccount): Promise<void> {
  await page.goto(DEFINITION_PATH);
  const roleLabel = account.role === "admin" ? "管理者" : "協力者";
  await expect(page.getByText(`ログイン中：${account.displayName}（${roleLabel}）`)).toBeVisible();
}

/** 段階の詳細の「大事さ」を「難所」にする（最初に選ばれている段階。テスト用データの段階はどれも「普通」） */
async function makeSelectedStageHard(page: Page): Promise<void> {
  const hard = page.getByRole("group", { name: "大事さ" }).getByRole("button", { name: "難所", exact: true });
  await expect(hard).toHaveAttribute("aria-pressed", "false");
  await hard.click();
  await expect(hard).toHaveAttribute("aria-pressed", "true");
}

/** 送った文書のうち、テスト用データから大事さが変わった段階 */
function stagesWithChangedImportance(content: unknown): { id: string; importance: string }[] {
  const stages = (content as { stages: { id: string; importance: string }[] }).stages;
  return stages.filter((stage) => {
    const original = summer2026Definition.stages.find((s) => s.id === stage.id);
    return original !== undefined && original.importance !== stage.importance;
  });
}

/** 日時の文字列の時刻（ミリ秒） */
function timeOf(value: unknown): number {
  return Date.parse(String(value));
}

// =====================================================================
// 一般利用者
// =====================================================================

test.describe("一般利用者（ログインしていない）", () => {
  test("【ホーム・一覧・割り振り・取り込み・差分・設定：○】すべて開け、Supabase に通信しない", async ({ page }) => {
    // 準備
    const supabaseRequests = recordSupabaseRequests(page);

    // 実行・検証
    await expectGeneralScreensOpen(page, []);
    expect(supabaseRequests).toEqual([]);
  });

  test("【設定の「アカウント」欄：×】設定のウィンドウにアカウント欄・ログアウト・ログインのボタンがない", async ({ page }) => {
    // 準備
    await page.goto("/");

    // 実行
    const dialog = await openSettings(page);

    // 検証
    await expect(dialog.getByRole("heading", { name: "表示" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "アカウント" })).toHaveCount(0);
    await expect(dialog.getByText(/ログイン中：|権限：/)).toHaveCount(0);
    await expect(button(dialog, "ログアウト")).toHaveCount(0);
    await expect(button(dialog, "ログイン")).toHaveCount(0);
  });

  test("【イベント定義画面を開く：×】左メニューに「定義」がなく、/definition を直接開くと拒否の表示で、編集・保存・公開・新規作成の操作がない", async ({
    page,
  }) => {
    // 準備
    const supabaseRequests = recordSupabaseRequests(page);
    await page.goto("/");
    await expect(sideNav(page)).toBeVisible();
    await expect(sideNav(page).getByRole("link", { name: "定義", exact: true })).toHaveCount(0);

    // 実行
    await page.goto(DEFINITION_PATH);

    // 検証：拒否の表示だけで、要件 2.3 の定義の操作（編集・下書きの保存・公開・終了日時・イベント名・開始日時・新規作成・終了したイベントの閲覧）が 1 つも出ない
    await expect(heading(page, "イベント定義")).toBeVisible();
    await expect(page.getByText(DEFINITION_DENIED, { exact: true })).toBeVisible();
    await expect(button(page, "下書きを保存")).toHaveCount(0);
    await expect(button(page, "変更を公開する")).toHaveCount(0);
    await expect(button(page, "公開して最新にする")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "新規作成" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "イベント名" })).toHaveCount(0);
    await expect(page.getByLabel("終了日時")).toHaveCount(0);
    await expect(page.getByText("攻略の流れ", { exact: true })).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(supabaseRequests).toEqual([]);
  });

  test("【保存の記録を見る：×】定義画面に入れないので「保存の記録を見る」もウィンドウもなく、Supabase に通信しない", async ({
    page,
  }) => {
    // 準備
    const supabaseRequests = recordSupabaseRequests(page);

    // 実行
    await page.goto(DEFINITION_PATH);

    // 検証
    await expect(page.getByText(DEFINITION_DENIED, { exact: true })).toBeVisible();
    await expect(button(page, "保存の記録を見る")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "共有の下書きの記録" })).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(supabaseRequests).toEqual([]);
  });

  test("【協力者画面：×】左メニューに「協力者」がなく、/collaborators を直接開くと「このページは管理者のみ使えます」", async ({
    page,
  }) => {
    // 準備
    const supabaseRequests = recordSupabaseRequests(page);
    await page.goto("/");
    await expect(sideNav(page)).toBeVisible();
    await expect(sideNav(page).getByRole("link", { name: "協力者", exact: true })).toHaveCount(0);

    // 実行
    await page.goto(COLLABORATORS_PATH);

    // 検証
    await expect(heading(page, "協力者")).toBeVisible();
    await expect(page.getByText(ADMIN_ONLY, { exact: true })).toBeVisible();
    await expect(page.getByText(ADMIN_ONLY_NOTE, { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "一覧に戻る" })).toBeVisible();
    await expect(button(page, "発行する")).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(supabaseRequests).toEqual([]);
  });
});

// =====================================================================
// 協力者
// =====================================================================

test.describe("協力者（ログイン済み）", () => {
  skipWithoutSupabase();

  test("【ホーム・一覧・割り振り・取り込み・差分・設定：○】すべて開け、左メニューに「定義」があり「協力者」はなく、一般の画面では Supabase に通信しない", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);

    // 実行・検証
    await expectGeneralScreensOpen(page, ["定義"]);
    expect(fake.requests).toEqual([]);
  });

  test("【設定の「アカウント」欄：○】ログイン中の名前・権限「協力者」・ログアウトが出て、ログアウトすると一般利用者に戻る", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);
    await page.goto("/");
    const dialog = await openSettings(page);

    // 検証：アカウント欄
    await expect(dialog.getByRole("heading", { name: "アカウント" })).toBeVisible();
    await expect(dialog.getByText(`ログイン中：${COLLAB.displayName}`, { exact: true })).toBeVisible();
    await expect(dialog.getByText("権限：協力者", { exact: true })).toBeVisible();

    // 実行：ログアウト
    await button(dialog, "ログアウト").click();

    // 検証：アカウント欄と管理メニューが消え、Auth のログアウト（このブラウザだけ）を呼んだ
    await expect(dialog.getByRole("heading", { name: "アカウント" })).toHaveCount(0);
    await expect(sideNav(page).getByRole("link", { name: "定義", exact: true })).toHaveCount(0);
    await expect.poll(() => fake.requests.some((r) => r.method === "POST" && r.path === "/auth/v1/logout")).toBe(true);
    expect(fake.unexpected).toEqual([]);
  });

  test("【イベント定義画面を開く：○】左メニューの「定義」で開け、最新イベントの更新の表示が出る", async ({ page }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);
    await page.goto("/");

    // 実行
    await sideNav(page).getByRole("link", { name: "定義", exact: true }).click();

    // 検証
    await expect(page).toHaveURL(DEFINITION_PATH);
    await expect(page.getByText(`ログイン中：${COLLAB.displayName}（協力者）`)).toBeVisible();
    await expect(eventPanel(page)).toContainText(`更新するイベント：${SUMMER_EVENT_NAME}（最新）`);
    await expect(page.getByText(DEFINITION_DENIED)).toHaveCount(0);
    await expect(page.getByText("攻略の流れ", { exact: true })).toBeVisible();
    // 編集中の表示の Realtime（WebSocket）は偽物が受けて閉じる（本物の接続先にはつながない）。画面は失敗を出さない
    await expect.poll(() => fake.realtimeConnections.length).toBeGreaterThan(0);
    expect(fake.realtimeConnections.every((url) => new URL(url).pathname.startsWith("/realtime/v1/"))).toBe(true);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(fake.unexpected).toEqual([]);
  });

  test("【札・段階・大事さ・特効を編集し、下書きを保存する：○】大事さを変えて「下書きを保存」すると save_draft を開いたときの版で呼ぶ", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);
    await openDefinition(page, COLLAB);

    // 実行
    await makeSelectedStageHard(page);
    await button(eventPanel(page), "下書きを保存").click();

    // 検証
    await expect(page.getByRole("status").filter({ hasText: "下書きを保存しました" })).toBeVisible();
    const [call] = fake.rpcCallsNamed("save_draft");
    expect(call?.args.p_event_id).toBe(SUMMER_EVENT_ID);
    expect(call?.args.p_base_version).toBe(SUMMER_DRAFT_VERSION);
    expect(stagesWithChangedImportance(call?.args.p_content)).toEqual([
      expect.objectContaining({ importance: "hard" }),
    ]);
    expect(fake.unexpected).toEqual([]);
  });

  test("【最新イベントの変更を公開する：○】「変更を公開する」があり、押すと publish_definition を最新にせずに呼ぶ", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);
    await openDefinition(page, COLLAB);
    await makeSelectedStageHard(page);

    // 実行：保存していない変更があるので、先に下書きを保存してから公開する
    await button(eventPanel(page), "変更を公開する").click();

    // 検証
    await expect(page.getByRole("status").filter({ hasText: "変更を公開しました" })).toBeVisible();
    const [publish] = fake.rpcCallsNamed("publish_definition");
    expect(publish?.args).toEqual({
      p_event_id: SUMMER_EVENT_ID,
      p_base_version: SUMMER_DRAFT_VERSION + 1,
      p_make_latest: false,
    });
    expect(fake.unexpected).toEqual([]);
  });

  test("【最新イベントの終了日時を変える：○】終了日時を入れると update_event_meta を、イベント名・開始日時はそのままで呼ぶ", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);
    await openDefinition(page, COLLAB);
    const endAt = eventPanel(page).getByLabel("終了日時");
    await expect(endAt).toBeEnabled();

    // 実行
    await endAt.fill("2026-10-31T12:00");
    await endAt.blur();

    // 検証
    await expect.poll(() => fake.rpcCallsNamed("update_event_meta").length).toBe(1);
    const [call] = fake.rpcCallsNamed("update_event_meta");
    expect(call?.args.p_event_id).toBe(SUMMER_EVENT_ID);
    expect(call?.args.p_name).toBe(SUMMER_EVENT_NAME);
    expect(timeOf(call?.args.p_starts_at)).toBe(timeOf("2026-08-07T12:00:00+09:00"));
    expect(timeOf(call?.args.p_ends_at)).toBe(timeOf("2026-10-31T12:00:00+09:00"));
    await expect(eventPanel(page)).toContainText("期間：2026/08/07 12:00 〜 2026/10/31 12:00");
    expect(fake.unexpected).toEqual([]);
  });

  test("【最新イベントのイベント名・開始日時を変える：×】イベント名は文字で、開始日時は表示だけで、入力欄がない", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);

    // 実行
    await openDefinition(page, COLLAB);

    // 検証
    const panel = eventPanel(page);
    await expect(panel.getByRole("textbox", { name: "イベント名" })).toHaveCount(0);
    await expect(panel.getByText(SUMMER_EVENT_NAME, { exact: true })).toBeVisible();
    await expect(panel.getByLabel("開始日時")).toHaveCount(0);
    await expect(panel).toContainText("開始日時 2026/08/07 12:00");
    // 終了日時は変えられる（同じ欄に並ぶ）
    await expect(panel.getByLabel("終了日時")).toBeEnabled();
    expect(fake.unexpected).toEqual([]);
  });

  test("【イベントの新規作成：×】「既存を更新」「新規作成」の切り替えがなく、新規作成は管理者が行うと出る", async ({ page }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);

    // 実行
    await openDefinition(page, COLLAB);

    // 検証
    const panel = eventPanel(page);
    await expect(panel).toContainText("協力者は最新イベントの更新だけができます。新規作成は管理者が行います");
    await expect(page.getByRole("radiogroup", { name: "新規か更新か" })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "新規作成" })).toHaveCount(0);
    await expect(page.getByLabel("元にするイベント")).toHaveCount(0);
    await expect(button(page, "公開して最新にする")).toHaveCount(0);
    expect(fake.unexpected).toEqual([]);
  });

  test("【終了したイベントの定義を見る（閲覧のみ）：○】終了の表示が出て、内容は見えるが、保存・公開・終了日時の操作がなく本文を操作できない", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB, ENDED);

    // 実行
    await openDefinition(page, COLLAB);

    // 検証：終了の表示（協力者向けの案内）
    const banner = page.getByRole("status").filter({ hasText: ENDED_TITLE });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(ENDED_NOTE);
    await expect(banner).toContainText("次のイベントは管理者が作成するまでお待ちください。");
    await expect(button(page, "新しいイベントを作成")).toHaveCount(0);
    // 検証：内容は見える
    await expect(page.getByText("攻略の流れ", { exact: true })).toBeVisible();
    await expect(page.getByText(summer2026Definition.stages[0]?.name ?? "", { exact: true }).first()).toBeVisible();
    // 検証：保存・公開・日時の操作がなく、本文は操作できない
    await expect(button(page, "下書きを保存")).toHaveCount(0);
    await expect(button(page, "変更を公開する")).toHaveCount(0);
    await expect(page.getByLabel("終了日時")).toHaveCount(0);
    expect(await isDefinitionWorkLocked(page)).toBe(true);
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.unexpected).toEqual([]);
  });

  for (const { state, options } of [
    { state: "開催中", options: RUNNING },
    { state: "終了した", options: ENDED },
  ] as const) {
    test(`【保存の記録を見る：○】${state}イベントで「保存の記録を見る」を押すと、ウィンドウ「共有の下書きの記録」にそのイベントの記録が新しい順に出る`, async ({
      page,
    }) => {
      // 準備
      const fake = await prepareSignedIn(page, COLLAB, options);
      await openDefinition(page, COLLAB);

      // 実行・検証
      await expectSaveLogsShown(page, fake);
      expect(fake.unexpected).toEqual([]);
    });
  }

  test("【協力者画面：×】左メニューに「協力者」がなく、/collaborators を直接開くと「このページは管理者のみ使えます」で、一覧を読まない", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, COLLAB);

    // 実行
    await page.goto(COLLABORATORS_PATH);

    // 検証
    await expect(heading(page, "協力者")).toBeVisible();
    await expect(page.getByText(ADMIN_ONLY, { exact: true })).toBeVisible();
    await expect(page.getByText(ADMIN_ONLY_NOTE, { exact: true })).toBeVisible();
    await expect(sideNav(page).getByRole("link", { name: "協力者", exact: true })).toHaveCount(0);
    await expect(button(page, "発行する")).toHaveCount(0);
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(fake.requests).toEqual([]);
  });
});

// =====================================================================
// 管理者
// =====================================================================

test.describe("管理者（ログイン済み）", () => {
  skipWithoutSupabase();

  test("【ホーム・一覧・割り振り・取り込み・差分・設定：○】すべて開け、左メニューに「定義」「協力者」があり、一般の画面では Supabase に通信しない", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);

    // 実行・検証
    await expectGeneralScreensOpen(page, ["定義", "協力者"]);
    expect(fake.requests).toEqual([]);
  });

  test("【設定の「アカウント」欄：○】ログイン中の名前・権限「管理者」・ログアウトが出る", async ({ page }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);
    await page.goto("/");

    // 実行
    const dialog = await openSettings(page);

    // 検証
    await expect(dialog.getByRole("heading", { name: "アカウント" })).toBeVisible();
    await expect(dialog.getByText(`ログイン中：${ADMIN.displayName}`, { exact: true })).toBeVisible();
    await expect(dialog.getByText("権限：管理者", { exact: true })).toBeVisible();
    await expect(button(dialog, "ログアウト")).toBeEnabled();
    expect(fake.unexpected).toEqual([]);
  });

  test("【イベント定義画面を開く／編集し下書きを保存する／公開する：○】大事さを変えて保存・公開すると save_draft・publish_definition を呼ぶ", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);
    await page.goto("/");
    await sideNav(page).getByRole("link", { name: "定義", exact: true }).click();
    await expect(page.getByText(`ログイン中：${ADMIN.displayName}（管理者）`)).toBeVisible();
    await expect(eventPanel(page)).toContainText(`更新するイベント：${SUMMER_EVENT_NAME}（最新）`);

    // 実行：編集して下書きを保存する
    await makeSelectedStageHard(page);
    await button(eventPanel(page), "下書きを保存").click();

    // 検証
    await expect(page.getByRole("status").filter({ hasText: "下書きを保存しました" })).toBeVisible();
    const [save] = fake.rpcCallsNamed("save_draft");
    expect(save?.args.p_base_version).toBe(SUMMER_DRAFT_VERSION);
    expect(stagesWithChangedImportance(save?.args.p_content)).toEqual([expect.objectContaining({ importance: "hard" })]);

    // 実行：公開する
    await button(eventPanel(page), "変更を公開する").click();

    // 検証
    await expect(page.getByRole("status").filter({ hasText: "変更を公開しました" })).toBeVisible();
    expect(fake.rpcCallsNamed("publish_definition").map((call) => call.args)).toEqual([
      { p_event_id: SUMMER_EVENT_ID, p_base_version: SUMMER_DRAFT_VERSION + 1, p_make_latest: false },
    ]);
    expect(fake.unexpected).toEqual([]);
  });

  test("【最新イベントの終了日時を変える：○】終了日時を入れると update_event_meta を呼ぶ", async ({ page }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);
    await openDefinition(page, ADMIN);
    const endAt = eventPanel(page).getByLabel("終了日時");

    // 実行
    await endAt.fill("2026-10-31T12:00");
    await endAt.blur();

    // 検証
    await expect.poll(() => fake.rpcCallsNamed("update_event_meta").length).toBe(1);
    const [call] = fake.rpcCallsNamed("update_event_meta");
    expect(call?.args.p_name).toBe(SUMMER_EVENT_NAME);
    expect(timeOf(call?.args.p_ends_at)).toBe(timeOf("2026-10-31T12:00:00+09:00"));
    expect(fake.unexpected).toEqual([]);
  });

  test("【最新イベントのイベント名・開始日時を変える：○】イベント名・開始日時の入力欄があり、変えると update_event_meta で送る", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);
    await openDefinition(page, ADMIN);
    const panel = eventPanel(page);
    const name = panel.getByRole("textbox", { name: "イベント名" });
    const startAt = panel.getByLabel("開始日時");
    await expect(name).toHaveValue(SUMMER_EVENT_NAME);
    await expect(startAt).toBeEnabled();

    // 実行：イベント名を変える
    await name.fill("2026夏イベ（後段）");
    await name.press("Enter");

    // 検証
    await expect.poll(() => fake.rpcCallsNamed("update_event_meta").length).toBe(1);
    expect(fake.rpcCallsNamed("update_event_meta")[0]?.args.p_name).toBe("2026夏イベ（後段）");

    // 実行：開始日時を変える
    await startAt.fill("2026-08-07T13:00");
    await startAt.blur();

    // 検証：後の更新は、先に確定したイベント名も持つ
    await expect.poll(() => fake.rpcCallsNamed("update_event_meta").length).toBe(2);
    const second = fake.rpcCallsNamed("update_event_meta")[1];
    expect(second?.args.p_name).toBe("2026夏イベ（後段）");
    expect(timeOf(second?.args.p_starts_at)).toBe(timeOf("2026-08-07T13:00:00+09:00"));
    expect(fake.unexpected).toEqual([]);
  });

  test("【イベントの新規作成：○】「新規作成」に切り替え、過去のイベントを元に選んで「下書きを保存」すると create_event を写した札・段階で呼ぶ", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);
    await openDefinition(page, ADMIN);

    // 実行：新規作成に切り替え、元にするイベントに過去のイベント（2026春イベ）を選ぶ
    await page.getByRole("radio", { name: "新規作成" }).check();
    const base = page.getByLabel("元にするイベント");
    await expect(base.getByRole("option", { name: SPRING_EVENT_NAME })).toHaveCount(1);
    await base.selectOption({ label: SPRING_EVENT_NAME });
    await expect(eventPanel(page)).toContainText(`まだ公開していません（${SPRING_EVENT_NAME}を元に作成）`);
    await expect(button(eventPanel(page), "公開して最新にする")).toBeVisible();

    // 実行：イベント名・開始日時を入れて下書きを保存する
    const name = eventPanel(page).getByRole("textbox", { name: "イベント名" });
    await name.fill("2026秋イベ");
    await name.press("Enter");
    const startAt = eventPanel(page).getByLabel("開始日時");
    await startAt.fill("2026-11-20T12:00");
    await startAt.blur();
    await button(eventPanel(page), "下書きを保存").click();

    // 検証：create_event に、春イベの札・段階を写し、特効を空にした文書を渡す
    await expect(page.getByRole("status").filter({ hasText: "下書きを保存しました" })).toBeVisible();
    const [call] = fake.rpcCallsNamed("create_event");
    expect(call?.args.p_name).toBe("2026秋イベ");
    expect(timeOf(call?.args.p_starts_at)).toBe(timeOf("2026-11-20T12:00:00+09:00"));
    expect(call?.args.p_ends_at).toBeNull();
    const content = call?.args.p_content as { fudas: unknown[]; stages: { id: string; boosts: unknown[] }[] };
    expect(content.fudas).toEqual(springDoc().fudas);
    expect(content.stages.map((stage) => stage.id)).toEqual(springDoc().stages.map((stage) => stage.id));
    expect(content.stages.every((stage) => stage.boosts.length === 0)).toBe(true);
    expect(fake.unexpected).toEqual([]);
  });

  test("【終了したイベントの定義を見る（閲覧のみ）：○】終了の表示と「新しいイベントを作成」が出て、保存・公開の操作がなく本文を操作できない", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN, ENDED);

    // 実行
    await openDefinition(page, ADMIN);

    // 検証：終了の表示（管理者向けの案内）
    const banner = page.getByRole("status").filter({ hasText: ENDED_TITLE });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(ENDED_NOTE);
    await expect(banner).toContainText("次のイベントは「新規作成」から作ってください。");
    // 検証：内容は見えるが、保存・公開・イベント名・日時の操作がなく、本文は操作できない
    await expect(page.getByText("攻略の流れ", { exact: true })).toBeVisible();
    await expect(button(page, "下書きを保存")).toHaveCount(0);
    await expect(button(page, "変更を公開する")).toHaveCount(0);
    await expect(eventPanel(page).getByRole("textbox", { name: "イベント名" })).toHaveCount(0);
    await expect(eventPanel(page).getByLabel("終了日時")).toHaveCount(0);
    expect(await isDefinitionWorkLocked(page)).toBe(true);

    // 実行：終了後も新規作成はできる
    await button(banner, "新しいイベントを作成").click();

    // 検証
    await expect(page.getByRole("radio", { name: "新規作成" })).toBeChecked();
    await expect(button(eventPanel(page), "公開して最新にする")).toBeVisible();
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.unexpected).toEqual([]);
  });

  for (const { state, options } of [
    { state: "開催中", options: RUNNING },
    { state: "終了した", options: ENDED },
  ] as const) {
    test(`【保存の記録を見る：○】${state}イベントで「保存の記録を見る」を押すと、ウィンドウ「共有の下書きの記録」にそのイベントの記録が新しい順に出る`, async ({
      page,
    }) => {
      // 準備
      const fake = await prepareSignedIn(page, ADMIN, options);
      await openDefinition(page, ADMIN);

      // 実行・検証
      await expectSaveLogsShown(page, fake);
      expect(fake.unexpected).toEqual([]);
    });
  }

  test("【協力者画面（ID とパスワードの発行、協力者を外す）：○】一覧が出て、発行すると register_collaborator、外すと remove_collaborator を呼ぶ", async ({
    page,
  }) => {
    // 準備
    const fake = await prepareSignedIn(page, ADMIN);
    await page.goto("/");
    await sideNav(page).getByRole("link", { name: "協力者", exact: true }).click();
    await expect(page).toHaveURL(COLLABORATORS_PATH);

    // 検証：編集できる人の表（管理者の行には「外す」を出さない）
    const table = page.getByRole("table");
    await expect(table.getByRole("row").filter({ hasText: ADMIN.displayName })).toBeVisible();
    await expect(table.getByRole("row").filter({ hasText: COLLAB.displayName })).toBeVisible();
    await expect(button(page, `${ADMIN.displayName} を外す`)).toHaveCount(0);
    await expect(page.getByText(ADMIN_ONLY)).toHaveCount(0);

    // 実行：ID とパスワードを発行する
    await page.getByLabel("ID", { exact: true }).fill("jiro-02");
    await page.getByLabel("表示名", { exact: true }).fill("協力 次郎");
    await button(page, "発行する").click();

    // 検証
    await expect(page.getByText("発行しました。次の ID とパスワードを相手に伝えてください")).toBeVisible();
    await expect(page.locator("code").filter({ hasText: "jiro-02" })).toBeVisible();
    expect(fake.requests.some((r) => r.method === "POST" && r.path === "/auth/v1/signup")).toBe(true);
    expect(fake.rpcCallsNamed("register_collaborator").map((call) => call.args.p_display_name)).toEqual(["協力 次郎"]);

    // 実行：協力者を外す（確認のチェックを入れてから）
    await button(page, `${COLLAB.displayName} を外す`).click();
    const confirm = page.getByRole("alertdialog", { name: `${COLLAB.displayName} を協力者から外しますか？` });
    await expect(button(confirm, "外す")).toBeDisabled();
    await confirm.getByRole("checkbox", { name: `${COLLAB.displayName} を外すことを確認しました` }).check();
    await button(confirm, "外す").click();

    // 検証
    await expect(table.getByRole("row").filter({ hasText: COLLAB.displayName })).toHaveCount(0);
    expect(fake.rpcCallsNamed("remove_collaborator").map((call) => call.args)).toEqual([{ p_user_id: COLLAB.userId }]);
    expect(fake.unexpected).toEqual([]);
  });
});
