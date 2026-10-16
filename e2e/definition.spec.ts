import { expect, type Locator, type Page, test } from "@playwright/test";
import { parsePublicDefinition } from "../src/domain/definition";

// 最新イベントの公開定義の読み込み（roadmap T2-3、PR-03b）を、ビルドした静的書き出しで確かめる
//
// 前提：public/data/latest-definition.json にテスト用の 2026夏イベの定義を置いている
// （2026-08-07 12:00〔日本時間〕開始・終了日時は未定）。終了日時が未定なので、開始後はずっと開催中になる。
// 実行する日に左右されないよう、ブラウザの時刻を 2026-10-16 12:00（日本時間。開催中）に固定する

const LATEST_DEFINITION = "/data/latest-definition.json";
const EVENT_NAME = "2026夏イベ";
/** 2026夏イベの開催中の時刻 */
const WHILE_RUNNING = new Date("2026-10-16T12:00:00+09:00");

// 画面名（h1）を含むヘッダー帯
function headerOf(page: Page, heading: string): Locator {
  return page
    .locator("header")
    .filter({ has: page.getByRole("heading", { level: 1, name: heading, exact: true }) });
}

// 画面（左メニューの右の本文）の中の警告（role="alert"）。
// Next.js が body の末尾に置く画面移動の読み上げ用の要素（next-route-announcer。role="alert"）を拾わないよう、main の中に絞る
function screenAlert(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

test.describe("最新イベントの公開定義の静的ファイル", () => {
  test("/data/latest-definition.json が配信され、検証を通る 2026夏イベの定義である", async ({
    request,
  }) => {
    // 準備・実行
    const response = await request.get(LATEST_DEFINITION);

    // 検証
    expect(response.status()).toBe(200);
    const result = parsePublicDefinition(await response.text());
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.ok && result.value.event.name).toBe(EVENT_NAME);
  });
});

test.describe("ホームの「開催中：（イベント名）」", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
  });

  test("ホームを開くと、置いた定義の 2026夏イベが開催中なので、ヘッダーに「開催中：2026夏イベ」が出る", async ({
    page,
  }) => {
    // 準備・実行
    await page.goto("/");

    // 検証
    await expect(headerOf(page, "札割りプランナー")).toContainText(`開催中：${EVENT_NAME}`);
  });

  test("一般の画面が取得するのは同じサイトの静的ファイルで、Supabase には通信しない", async ({
    page,
    baseURL,
  }) => {
    // 準備：ページが出したリクエストをすべて記録する
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));

    // 実行：ホームと一覧を開き、定義の読み込みが済むまで待つ
    await page.goto("/");
    await expect(headerOf(page, "札割りプランナー")).toContainText(`開催中：${EVENT_NAME}`);
    await page.goto("/list");
    await expect(headerOf(page, "札割り一覧").getByText(EVENT_NAME, { exact: true })).toBeVisible();

    // 検証：同じサイトの /data/latest-definition.json を取得している（問い合わせ文字列の有無は問わない）。
    // Supabase（*.supabase.co など）へのリクエストは 1 つもない
    const siteOrigin = new URL(baseURL ?? "").origin;
    const definitionRequests = requestedUrls
      .map((url) => new URL(url))
      .filter((url) => url.origin === siteOrigin && url.pathname === LATEST_DEFINITION);
    expect(definitionRequests.length).toBeGreaterThan(0);
    expect(requestedUrls.filter((url) => new URL(url).hostname.includes("supabase"))).toEqual([]);
  });
});

test.describe("各画面のヘッダーの最新イベント名", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(WHILE_RUNNING);
  });

  for (const { path, heading } of [
    { path: "/list", heading: "札割り一覧" },
    { path: "/assign", heading: "割り振り" },
    { path: "/drift", heading: "計画と実際の札" },
  ]) {
    test(`${path} を開くと、ヘッダー（見出し「${heading}」）に最新イベント名「2026夏イベ」が出る`, async ({
      page,
    }) => {
      // 準備・実行
      await page.goto(path);

      // 検証
      await expect(headerOf(page, heading).getByText(EVENT_NAME, { exact: true })).toBeVisible();
      await expect(screenAlert(page)).toHaveCount(0);
    });
  }

  test("静的ファイルが取得できない（404）と、一覧の画面に「イベントの定義を読み込めませんでした」と理由が出る", async ({
    page,
  }) => {
    // 準備：静的ファイルへの取得だけを 404 にする
    await page.route(`**${LATEST_DEFINITION}`, (route) =>
      route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" }),
    );

    // 実行
    await page.goto("/list");

    // 検証
    const alert = screenAlert(page);
    await expect(alert).toContainText("イベントの定義を読み込めませんでした");
    await expect(alert).toContainText("404");
    await expect(headerOf(page, "札割り一覧").getByText(EVENT_NAME, { exact: true })).toHaveCount(0);
  });
});
