import { expect, type Locator, type Page, type Request, test } from "@playwright/test";
import { kyouka, svShip, toSvdataText } from "../src/test/fixtures/importSamples";

// 取り込み画面（roadmap T2-4、要件 3.4・5 章・11 章）を、ビルドした静的書き出しで確かめる
//
// - 貼り付け → 取り込む → 隻数が表示される（再読み込みしても、ブラウザ内に保存した最終取り込みが出る）
// - 取り込みの操作の間に、貼り付けた内容を含む通信や、外への送信が起きない（静的ファイルの取得だけ）
//
// 艦船マスタはビルドで生成した実データ（public/data/ship-master.json）を使う。
// マスタの中身（名前が分からない艦の数など）に左右されないよう、隻数だけを確かめる。
// テストごとにブラウザのコンテキストが分かれるため、ブラウザ内の保存（IndexedDB）は毎回空から始まる

/** 艦船マスタの置き場所（src/lib/ship-master の SHIP_MASTER_PATH） */
const SHIP_MASTER_PATH = "/data/ship-master.json";

/** 貼り付けた内容が通信に乗っていないかを調べるための目印（取り込みの解析では使わない項目に入れる） */
const MARKER = "fudawari-e2e-paste-marker-7f3a9c";

/** 貼り付ける内容（svdata 形式の 3 隻。すべての艦娘・Lv1 以上なら 3 隻を取り込む） */
const PASTED_TEXT = toSvdataText([
  svShip({ api_id: 9001, api_ship_id: 961, api_lv: 175, api_kyouka: kyouka(39), api_locked: 1, api_memo: MARKER }),
  svShip({ api_id: 9002, api_ship_id: 145, api_lv: 99, api_kyouka: kyouka(7), api_sally_area: 3, api_locked: 1 }),
  svShip({ api_id: 9003, api_ship_id: 656, api_lv: 168, api_kyouka: kyouka(20), api_locked: 0 }),
]);

/** 取り込みの画面を開き、艦船マスタの取得が済むまで待つ */
async function openImportScreen(page: Page): Promise<void> {
  const masterLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === SHIP_MASTER_PATH && response.ok(),
  );
  await page.goto("/import");
  await masterLoaded;
}

/** 貼り付け欄 */
function pasteBox(page: Page): Locator {
  return page.getByRole("textbox", { name: "艦娘の情報を貼り付け" });
}

/** 「取り込む」ボタン */
function importButton(page: Page): Locator {
  return page.getByRole("button", { name: "取り込む", exact: true });
}

/** 完了の表示（見出し「取り込みました」を含む role="status" の領域） */
function doneRegion(page: Page): Locator {
  return page
    .getByRole("status")
    .filter({ has: page.getByRole("heading", { name: "取り込みました", exact: true }) });
}

/** 失敗したときに読めるよう、リクエストを「メソッド URL」の形にする */
function describeRequest(request: Request): string {
  return `${request.method()} ${request.url()}`;
}

test.describe("取り込み画面", () => {
  test("貼り付けて「取り込む」を押すと、「取り込みました」と隻数（艦娘 3隻）が表示される", async ({ page }) => {
    // 準備
    await openImportScreen(page);

    // 実行
    await pasteBox(page).fill(PASTED_TEXT);
    await expect(page.getByText(new RegExp(`貼り付けました（\\s*${PASTED_TEXT.length}\\s*文字）`))).toBeVisible();
    await importButton(page).click();

    // 検証
    const done = doneRegion(page);
    await expect(done).toBeVisible();
    await expect(done).toContainText(/艦娘\s*3\s*隻/);
  });

  test("取り込んだ後に再読み込みしても、最終取り込みに今回の隻数（3隻）が出る（ブラウザ内に保存している）", async ({
    page,
  }) => {
    // 準備：取り込む
    await openImportScreen(page);
    await pasteBox(page).fill(PASTED_TEXT);
    await importButton(page).click();
    await expect(doneRegion(page)).toBeVisible();

    // 実行
    await page.reload();

    // 検証
    await expect(page.getByText(/最終取り込み.*3\s*隻/)).toBeVisible();
  });

  test("取り込みの操作の間に、貼り付けた内容を含む通信や外への送信は起きない（同じサイトの静的ファイルの取得だけ）", async ({
    page,
    baseURL,
  }) => {
    // 準備：画面を開いた後から、ページが出すリクエストをすべて記録する
    await openImportScreen(page);
    const requests: Request[] = [];
    page.on("request", (request) => requests.push(request));

    // 実行：貼り付けて取り込み、完了の表示が出るまで待つ
    await pasteBox(page).fill(PASTED_TEXT);
    await importButton(page).click();
    await expect(doneRegion(page)).toBeVisible();

    // 検証：貼り付けた内容（目印）を URL にも本文にも含むリクエストがない
    const leaking = requests.filter(
      (request) => request.url().includes(MARKER) || (request.postData() ?? "").includes(MARKER),
    );
    expect(leaking.map(describeRequest)).toEqual([]);
    // 検証：取得（GET）以外のリクエスト（POST・sendBeacon など、何かを送るもの）がない
    expect(requests.filter((request) => request.method() !== "GET").map(describeRequest)).toEqual([]);
    // 検証：ほかのサイトへのリクエストがない（あるのは同じサイトの静的ファイルの取得だけ）。
    // data: と blob: の URL はブラウザの中だけで読むもので外へ出ない（オリジンは "null"）ため、数えない
    const siteOrigin = new URL(baseURL ?? "").origin;
    const leavesBrowser = (request: Request): boolean => !/^(data|blob):/.test(request.url());
    expect(
      requests
        .filter(leavesBrowser)
        .filter((request) => new URL(request.url()).origin !== siteOrigin)
        .map(describeRequest),
    ).toEqual([]);
  });
});
