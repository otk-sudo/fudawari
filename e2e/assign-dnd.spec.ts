import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  ASSIGN_PATH,
  cardIn,
  cardItemOf,
  columnOf,
  dragAndDrop,
  dragOver,
  dragOverPoint,
  drop,
  panelOf,
  routeLatestData,
  seedPlan,
  shipCountPattern,
  startDrag,
  trayCountPattern,
  trayOf,
  undoButtonOf,
} from "../src/test/assign-e2e";
import { summer2026Assignments, summer2026Ships } from "../src/test/fixtures";

// 割り振り画面のドラッグ＆ドロップ（roadmap T2-8・PR-06、要件 3.3「ドラッグ＆ドロップ」、モック Assign.dc.html）を、
// ビルドした静的書き出しで確かめる
//
// - 札の列の空いている所（列の見出し）に落とす：その札へ移動。ドラッグ中は落とす先の列を強調し（data-drop-highlight="true"）、
//   「ここに移動」を出す（今いる札の列には出さない。モックの moveHint）
// - 別の艦のカードに重ねて落とす：2 隻の札を入れ替える。重ねている間は相手のカードを包む li に「⇄ 入れ替え」を出す。
//   相手が控えの艦なら、ドラッグした艦が控えに戻り、相手がその札に入る
// - 控えに落とす（控えの見出しの所）：割り当てを外す。札に置いた艦をドラッグしているときだけ控えを強調する
// - 自分自身に落としても、今いる札の列に落としても変わらない（「元に戻す」も押せないまま）
// - ドラッグを始めると選択が外れる。押すだけ（動かさない）ならドラッグにならず選択になる
// - 再読み込みしても、ドラッグで変えた割り当てが残る（ブラウザ内に保存している）
// - PR-06 のレビューで足したこと
//   - B1：ドラッグ中は全部の札の列で「ここに移動」の場所を先に取っておき、列の大きさを変えない。
//     「ここに移動」の上へ動かして落としても、その札に入る（空の札でも、艦のいる札でも）
//   - M3：同じ場所の艦どうし（同じ札の艦どうし、控えの艦どうし）に重ねたときは、「⇄ 入れ替え」も
//     「離すと入れ替えます」の読み上げも出さない（落としても変わらないため）
//   （固定した区切りの見出しの上で落とす M1 は、控えをスクロールできる e2e/assign-many-ships.spec.ts で確かめる）
//
// テスト用データ（Vitest の AssignScreen.test.tsx と同じ）
// - 公開定義：2026夏イベ。艦船マスタ：仮マスタ（routeLatestData で差し替える）
// - 艦：モックの所持艦 31 隻。割り当て：一覧の割り当て（連合艦隊 8 隻・ウルシー攻撃部隊 3 隻など。控えは 12 隻で、
//   初めは「特効のある艦だけ」なので 11 隻を出す「11 / 12隻」）
// - よく使う艦（個体 ID）：利根改二（tone・控え）、浜波改（hamanami・控え）、時雨改二（shigure2・連合艦隊）、
//   北上改二（kitakami・連合艦隊）、不知火改二（shiranui・ウルシー攻撃部隊）、伊41改（i41・第六艦隊の 1 隻だけ）
// テストごとにブラウザのコンテキストが分かれるため、ブラウザ内の保存（IndexedDB）は毎回空から始まる

/** 札の列が 5 つとも、スクロールせずに見える大きさ（ドラッグの途中でページをスクロールしないため） */
test.use({ viewport: { width: 1920, height: 1080 } });

/** ドラッグ中に、落とす先の列に出す文 */
const MOVE_HINT = "ここに移動";
/** ドラッグ中に、重ねている相手のカードに出す文 */
const SWAP_HINT = "⇄ 入れ替え";
/** 別の艦のカードの上に来たときの読み上げ（dnd.ts の createDragAnnouncements の onDragOver）の、入れ替えを知らせる部分 */
const SWAP_ANNOUNCEMENT = "離すと入れ替えます";
/** dnd-kit の既定の英語の操作説明・読み上げ */
const DND_KIT_ENGLISH = /draggable|droppable|space bar|arrow keys|press escape|picked up|was dropped/i;

test.beforeEach(async ({ page }) => {
  await routeLatestData(page);
  await seedPlan(page, { ships: summer2026Ships, assignments: summer2026Assignments });
  await openAssignScreen(page);
});

/** 割り振り画面を開き、控えに艦カードが出るまで待つ */
async function openAssignScreen(page: Page): Promise<void> {
  await page.goto(ASSIGN_PATH);
  await expect(cardIn(trayOf(page), "tone")).toBeVisible();
}

/** 札の列の見出し（札名。列の中の、艦カードのない所） */
function columnHeadingOf(page: Page, fudaName: string): Locator {
  return columnOf(page, fudaName).getByRole("heading", { name: fudaName, exact: true });
}

/** 控えの見出し「控え」（控えの中の、艦カードのない所） */
function trayHeadingOf(page: Page): Locator {
  return trayOf(page).getByRole("heading", { name: "控え", exact: true });
}

/** 落とす先として強調している region */
function highlightedRegions(page: Page): Locator {
  return page.locator('[data-drop-highlight="true"]');
}

/**
 * container の中の、見えている「ここに移動」。
 * ドラッグ中は全部の札の列に「ここに移動」の場所を先に取っておく（PR-06 のレビュー B1）ので、
 * 出していない列にも見えない要素が残ることがある。見えているものだけを数える
 */
function visibleMoveHintIn(container: Locator): Locator {
  return container.getByText(MOVE_HINT, { exact: true }).filter({ visible: true });
}

/** 要素の画面上の位置と大きさ（見えていなければテストを失敗させる。スクロールはしない） */
async function boxOf(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("要素が画面に見えていない");
  return box;
}

/**
 * 描き直しが済むまで待つ（requestAnimationFrame を 3 回）。
 * 「出ないこと」を確かめる前に使う（出るはずのものが、描き直す前に調べて見落とされないように）
 */
async function waitForFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const tick = (): void => {
          frames += 1;
          if (frames >= 3) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** 「ここに移動」の下端から、列の外（落とす先のない所）へ出るときに下へ離す距離（px） */
const BELOW_COLUMN_OFFSET = 150;

/**
 * 列の大きさが変わった後、dnd-kit が落とす先の範囲を測り直すまで待つ時間（ミリ秒）。
 * dnd-kit の useDroppable は、ドラッグ中に要素の大きさが変わると 100ms 後に測り直す（ResizeObserver）ので、それより長く待つ
 */
const REMEASURE_WAIT_MS = 300;

/**
 * 控えの利根改二をドラッグして札の列 fudaName の見出しの上へ動かし、出てきた「ここに移動」の位置を覚える。
 * いったん列の真下（落とす先のない所）へ出て、dnd-kit が列を測り直すまで待ってから、
 * 下から「ここに移動」の中ほどへ戻り（列の見出しや艦カードを通らずに）、落とす。
 * 「ここに移動」の上でも、その列を強調して「ここに移動」を出したままであることを確かめてから落とす
 * （「ここに移動」の場所を先に取っておかないと、列の外に出たときに列が縮み、測り直した範囲に「ここに移動」の場所が入らない）
 */
async function dropToneOnMoveHint(page: Page, fudaName: string): Promise<void> {
  const column = columnOf(page, fudaName);
  await startDrag(page, cardIn(trayOf(page), "tone"));
  await dragOver(page, columnHeadingOf(page, fudaName));
  await expect(visibleMoveHintIn(column), "前提：列の見出しの上で「ここに移動」が出ること").toBeVisible();
  const hint = await boxOf(visibleMoveHintIn(column));
  const hintCenter = { x: hint.x + hint.width / 2, y: hint.y + hint.height / 2 };

  // 列の真下へ出る（列の強調が消える）。列を測り直すまで待つ
  await dragOverPoint(page, { x: hintCenter.x, y: hint.y + hint.height + BELOW_COLUMN_OFFSET });
  await expect(column, "前提：列の外に出たこと").not.toHaveAttribute("data-drop-highlight", "true");
  await page.waitForTimeout(REMEASURE_WAIT_MS);

  // 下から「ここに移動」の中ほどへ戻る
  await dragOverPoint(page, hintCenter);
  await waitForFrames(page);

  // 「ここに移動」の上でも、落とす先はその列のまま
  await expect(column).toHaveAttribute("data-drop-highlight", "true");
  await expect(visibleMoveHintIn(column)).toBeVisible();
  await drop(page);
}

test.describe("割り振り画面のドラッグ＆ドロップ", () => {
  test("控えの艦を札の列へドラッグすると、ドラッグ中は列を強調して「ここに移動」を出し、落とすとその札へ移る（控えから消え、列の隻数が増える）", async ({
    page,
  }) => {
    // 準備
    const tray = trayOf(page);
    const rengo = columnOf(page, "連合艦隊");
    await expect(rengo).toContainText(shipCountPattern(8));

    // 実行：利根改二を連合艦隊の見出しの上へ
    await startDrag(page, cardIn(tray, "tone"));
    await dragOver(page, columnHeadingOf(page, "連合艦隊"));

    // 検証：ドラッグ中は連合艦隊だけを強調し、「ここに移動」を出す
    await expect(rengo).toHaveAttribute("data-drop-highlight", "true");
    await expect(visibleMoveHintIn(rengo)).toBeVisible();
    await expect(highlightedRegions(page)).toHaveCount(1);

    // 実行：落とす
    await drop(page);

    // 検証：移った。強調と「ここに移動」は消える
    await expect(cardIn(rengo, "tone")).toBeVisible();
    await expect(cardIn(tray, "tone")).toHaveCount(0);
    await expect(rengo).toContainText(shipCountPattern(9));
    await expect(tray).toContainText(trayCountPattern(10, 11));
    await expect(page.getByText(MOVE_HINT, { exact: true })).toHaveCount(0);
    await expect(highlightedRegions(page)).toHaveCount(0);
  });

  test("札の艦を別の札の艦のカードに重ねると「⇄ 入れ替え」を出し（「ここに移動」は出さない）、落とすと 2 隻の札が入れ替わる", async ({
    page,
  }) => {
    // 準備
    const rengo = columnOf(page, "連合艦隊");
    const ulithi = columnOf(page, "ウルシー攻撃部隊");
    const shiranui = cardIn(ulithi, "shiranui");

    // 実行：連合艦隊の時雨改二を、ウルシー攻撃部隊の不知火改二に重ねる
    await startDrag(page, cardIn(rengo, "shigure2"));
    await dragOver(page, shiranui);

    // 検証
    await expect(cardItemOf(shiranui).getByText(SWAP_HINT, { exact: true })).toBeVisible();
    await expect(page.getByText(SWAP_HINT, { exact: true })).toHaveCount(1);
    await expect(visibleMoveHintIn(page.locator("body"))).toHaveCount(0);

    // 実行：落とす
    await drop(page);

    // 検証：入れ替わった（隻数は変わらない）
    await expect(cardIn(ulithi, "shigure2")).toBeVisible();
    await expect(cardIn(rengo, "shiranui")).toBeVisible();
    await expect(cardIn(rengo, "shigure2")).toHaveCount(0);
    await expect(cardIn(ulithi, "shiranui")).toHaveCount(0);
    await expect(rengo).toContainText(shipCountPattern(8));
    await expect(ulithi).toContainText(shipCountPattern(3));
    await expect(page.getByText(SWAP_HINT, { exact: true })).toHaveCount(0);
  });

  test("札の艦を控えの艦のカードに重ねて落とすと、ドラッグした艦が控えに戻り、相手がその札に入る", async ({ page }) => {
    // 準備
    const tray = trayOf(page);
    const rengo = columnOf(page, "連合艦隊");
    const tone = cardIn(tray, "tone");

    // 実行：連合艦隊の時雨改二を、控えの利根改二に重ねる
    await startDrag(page, cardIn(rengo, "shigure2"));
    await dragOver(page, tone);
    await expect(cardItemOf(tone).getByText(SWAP_HINT, { exact: true })).toBeVisible();
    await drop(page);

    // 検証
    await expect(cardIn(tray, "shigure2")).toBeVisible();
    await expect(cardIn(rengo, "tone")).toBeVisible();
    await expect(cardIn(rengo, "shigure2")).toHaveCount(0);
    await expect(cardIn(tray, "tone")).toHaveCount(0);
    await expect(rengo).toContainText(shipCountPattern(8));
    await expect(tray).toContainText(trayCountPattern(11, 12));
  });

  test("札の艦を控えへドラッグすると、ドラッグ中は控えを強調し、落とすと割り当てが外れて控えに戻る", async ({ page }) => {
    // 準備
    const tray = trayOf(page);
    const rengo = columnOf(page, "連合艦隊");

    // 実行：連合艦隊の時雨改二を、控えの見出しの上へ
    await startDrag(page, cardIn(rengo, "shigure2"));
    await dragOver(page, trayHeadingOf(page));

    // 検証：控えを強調する
    await expect(tray).toHaveAttribute("data-drop-highlight", "true");

    // 実行：落とす
    await drop(page);

    // 検証
    await expect(cardIn(tray, "shigure2")).toBeVisible();
    await expect(cardIn(rengo, "shigure2")).toHaveCount(0);
    await expect(rengo).toContainText(shipCountPattern(7));
    await expect(tray).toContainText(trayCountPattern(12, 13));
    await expect(highlightedRegions(page)).toHaveCount(0);
  });

  test("控えの艦をドラッグしているときは、控えの上に来ても控えを強調せず、落としても変わらない", async ({ page }) => {
    // 準備
    const tray = trayOf(page);

    // 実行：控えの利根改二を、控えの見出しの上へ
    await startDrag(page, cardIn(tray, "tone"));
    await dragOver(page, trayHeadingOf(page));

    // 検証：ドラッグを始めたこと（落とす先の列の強調）は、列の上へ動かして確かめる。
    // 控えの上では控えを強調しない
    await expect(tray).not.toHaveAttribute("data-drop-highlight", "true");
    await dragOver(page, columnHeadingOf(page, "第六艦隊"));
    await expect(columnOf(page, "第六艦隊")).toHaveAttribute("data-drop-highlight", "true");
    await dragOver(page, trayHeadingOf(page));
    await expect(tray).not.toHaveAttribute("data-drop-highlight", "true");

    // 実行：控えの上で落とす
    await drop(page);

    // 検証
    await expect(cardIn(tray, "tone")).toBeVisible();
    await expect(tray).toContainText(trayCountPattern(11, 12));
    await expect(undoButtonOf(page)).toBeDisabled();
  });

  test("艦を自分自身に落としても変わらず、「⇄ 入れ替え」も出さない", async ({ page }) => {
    // 準備
    const rengo = columnOf(page, "連合艦隊");
    const shigure2 = cardIn(rengo, "shigure2");

    // 実行：時雨改二をドラッグし、第六艦隊の上を通ってから、押した所（自分の元の位置）に戻す
    const start = await startDrag(page, shigure2);
    await dragOver(page, columnHeadingOf(page, "第六艦隊"));
    await expect(columnOf(page, "第六艦隊"), "前提：ドラッグが始まっていること").toHaveAttribute(
      "data-drop-highlight",
      "true",
    );
    await dragOverPoint(page, start);

    // 検証：自分には「⇄ 入れ替え」を出さない（第六艦隊の強調が消える＝自分の上に来たのを画面が受け取った後に見る）
    await expect(columnOf(page, "第六艦隊")).not.toHaveAttribute("data-drop-highlight", "true");
    await expect(page.getByText(SWAP_HINT, { exact: true })).toHaveCount(0);

    // 実行：落とす
    await drop(page);

    // 検証
    await expect(cardIn(rengo, "shigure2")).toBeVisible();
    await expect(rengo).toContainText(shipCountPattern(8));
    await expect(undoButtonOf(page)).toBeDisabled();
  });

  test("札の艦を今いる札の列に落としても変わらず、その列には「ここに移動」を出さない", async ({ page }) => {
    // 準備
    const rengo = columnOf(page, "連合艦隊");

    // 実行：連合艦隊の時雨改二を、連合艦隊の見出しの上へ
    await startDrag(page, cardIn(rengo, "shigure2"));
    await dragOver(page, columnHeadingOf(page, "第六艦隊"));
    await expect(columnOf(page, "第六艦隊"), "前提：ドラッグが始まっていること").toHaveAttribute(
      "data-drop-highlight",
      "true",
    );
    await dragOver(page, columnHeadingOf(page, "連合艦隊"));

    // 検証：今いる列には「ここに移動」を出さない（第六艦隊の強調が消える＝連合艦隊の上に来たのを画面が受け取った後に見る）
    await expect(columnOf(page, "第六艦隊")).not.toHaveAttribute("data-drop-highlight", "true");
    await expect(visibleMoveHintIn(rengo)).toHaveCount(0);

    // 実行：落とす
    await drop(page);

    // 検証
    await expect(cardIn(rengo, "shigure2")).toBeVisible();
    await expect(rengo).toContainText(shipCountPattern(8));
    await expect(undoButtonOf(page)).toBeDisabled();
  });

  test("ドラッグを始めると、選んでいた艦の選択が外れる（パネルが消える）", async ({ page }) => {
    // 準備：控えの浜波改を選ぶ
    const tray = trayOf(page);
    await cardIn(tray, "hamanami").click();
    await expect(panelOf(page)).toBeVisible();

    // 実行：利根改二のドラッグを始め、連合艦隊の見出しの上へ
    await startDrag(page, cardIn(tray, "tone"));
    await dragOver(page, columnHeadingOf(page, "連合艦隊"));

    // 検証：ドラッグ中に選択が外れる
    await expect(columnOf(page, "連合艦隊"), "前提：ドラッグが始まっていること").toHaveAttribute(
      "data-drop-highlight",
      "true",
    );
    await expect(panelOf(page)).toHaveCount(0);
    await expect(cardIn(tray, "hamanami")).toHaveAttribute("aria-pressed", "false");

    // 実行・検証：落とした後も選択は外れたまま
    await drop(page);
    await expect(cardIn(columnOf(page, "連合艦隊"), "tone")).toBeVisible();
    await expect(panelOf(page)).toHaveCount(0);
  });

  test("艦カードを押すだけ（動かさない）なら、ドラッグにならずに選択になる", async ({ page }) => {
    // 準備
    const tone = cardIn(trayOf(page), "tone");

    // 実行
    await tone.click();

    // 検証
    await expect(tone).toHaveAttribute("aria-pressed", "true");
    await expect(panelOf(page)).toBeVisible();
    await expect(highlightedRegions(page)).toHaveCount(0);
  });

  test("ドラッグで動かした後に「元に戻す」を押すと、元の札に戻る", async ({ page }) => {
    // 準備：利根改二を連合艦隊へ
    const tray = trayOf(page);
    const rengo = columnOf(page, "連合艦隊");
    await dragAndDrop(page, cardIn(tray, "tone"), columnHeadingOf(page, "連合艦隊"));
    await expect(cardIn(rengo, "tone")).toBeVisible();

    // 実行
    await undoButtonOf(page).click();

    // 検証
    await expect(cardIn(tray, "tone")).toBeVisible();
    await expect(cardIn(rengo, "tone")).toHaveCount(0);
    await expect(rengo).toContainText(shipCountPattern(8));
  });

  test("ドラッグで変えた割り当ては、再読み込みしても残る（ブラウザ内に保存している）", async ({ page }) => {
    // 準備：利根改二を連合艦隊へ、北上改二を控えへ
    const rengo = columnOf(page, "連合艦隊");
    await dragAndDrop(page, cardIn(trayOf(page), "tone"), columnHeadingOf(page, "連合艦隊"));
    await expect(cardIn(rengo, "tone")).toBeVisible();
    await dragAndDrop(page, cardIn(rengo, "kitakami"), trayHeadingOf(page));
    await expect(cardIn(trayOf(page), "kitakami")).toBeVisible();

    // 実行
    await page.reload();

    // 検証
    await expect(cardIn(columnOf(page, "連合艦隊"), "tone")).toBeVisible();
    await expect(cardIn(trayOf(page), "kitakami")).toBeVisible();
    await expect(cardIn(columnOf(page, "連合艦隊"), "kitakami")).toHaveCount(0);
    await expect(columnOf(page, "連合艦隊")).toContainText(shipCountPattern(8));
  });

  test("ドラッグ中も、dnd-kit の既定の英語の操作説明・読み上げを出さない", async ({ page }) => {
    // 実行：利根改二を連合艦隊の見出しの上へ
    await startDrag(page, cardIn(trayOf(page), "tone"));
    await dragOver(page, columnHeadingOf(page, "連合艦隊"));
    await expect(columnOf(page, "連合艦隊"), "前提：ドラッグが始まっていること").toHaveAttribute(
      "data-drop-highlight",
      "true",
    );

    // 検証：画面に見えない読み上げ用の文も含めて調べる
    expect(await page.locator("body").textContent()).not.toMatch(DND_KIT_ENGLISH);

    // 後片付け
    await drop(page);
  });
});

test.describe("「ここに移動」の上で落とす（PR-06 のレビュー B1）", () => {
  test("ドラッグ中は、「ここに移動」を出している列も出していない列も、大きさが変わらない（場所を先に取っておく）", async ({
    page,
  }) => {
    // 準備
    const rengo = columnOf(page, "連合艦隊");
    const sixth = columnOf(page, "第六艦隊");

    // 実行：利根改二をドラッグし、第六艦隊の見出しの上へ（第六艦隊に「ここに移動」を出す）
    await startDrag(page, cardIn(trayOf(page), "tone"));
    await dragOver(page, columnHeadingOf(page, "第六艦隊"));
    await expect(visibleMoveHintIn(sixth)).toBeVisible();
    await expect(visibleMoveHintIn(rengo)).toHaveCount(0);
    const overSixth = { rengo: (await boxOf(rengo)).height, sixth: (await boxOf(sixth)).height };

    // 実行：連合艦隊の見出しの上へ（連合艦隊に「ここに移動」を出し、第六艦隊からは消す）
    await dragOver(page, columnHeadingOf(page, "連合艦隊"));
    await expect(visibleMoveHintIn(rengo)).toBeVisible();
    await expect(visibleMoveHintIn(sixth)).toHaveCount(0);
    const overRengo = { rengo: (await boxOf(rengo)).height, sixth: (await boxOf(sixth)).height };

    // 検証：どちらの列も高さが変わらない（ドラッグを始めたときに測った落とす先の範囲と、画面の列の範囲がずれない）
    expect(overRengo.rengo, "連合艦隊の高さ（「ここに移動」を出しても変わらない）").toBeCloseTo(overSixth.rengo, 0);
    expect(overRengo.sixth, "第六艦隊の高さ（「ここに移動」を消しても変わらない）").toBeCloseTo(overSixth.sixth, 0);

    // 後片付け
    await drop(page);
  });

  test("控えの艦を、艦のいる札（連合艦隊）の「ここに移動」の上へ動かして落とすと、その札に入る", async ({ page }) => {
    // 準備
    const tray = trayOf(page);
    const rengo = columnOf(page, "連合艦隊");
    await expect(rengo).toContainText(shipCountPattern(8));

    // 実行
    await dropToneOnMoveHint(page, "連合艦隊");

    // 検証
    await expect(cardIn(rengo, "tone")).toBeVisible();
    await expect(cardIn(tray, "tone")).toHaveCount(0);
    await expect(rengo).toContainText(shipCountPattern(9));
    await expect(tray).toContainText(trayCountPattern(10, 11));
  });

  test("控えの艦を、空の札（第六艦隊）の「ここに移動」の上へ動かして落とすと、その札に入る", async ({ page }) => {
    // 準備：第六艦隊の伊41改を控えへ戻して、第六艦隊を空にする
    const tray = trayOf(page);
    const sixth = columnOf(page, "第六艦隊");
    await dragAndDrop(page, cardIn(sixth, "i41"), trayHeadingOf(page));
    await expect(cardIn(sixth, "i41")).toHaveCount(0);
    await expect(sixth).toContainText(shipCountPattern(0));

    // 実行
    await dropToneOnMoveHint(page, "第六艦隊");

    // 検証
    await expect(cardIn(sixth, "tone")).toBeVisible();
    await expect(cardIn(tray, "tone")).toHaveCount(0);
    await expect(sixth).toContainText(shipCountPattern(1));
  });
});

test.describe("同じ場所の艦どうしに重ねる（PR-06 のレビュー M3・Codex の指摘 DraggableShipItem.tsx:56）", () => {
  test("札の艦を同じ札の別の艦のカードに重ねても、「⇄ 入れ替え」も「離すと入れ替えます」の読み上げも出さず、落としても変わらない", async ({
    page,
  }) => {
    // 準備
    const rengo = columnOf(page, "連合艦隊");
    const kitakami = cardIn(rengo, "kitakami");

    // 実行：連合艦隊の時雨改二をドラッグし、第六艦隊の上を通ってから、同じ連合艦隊の北上改二に重ねる
    await startDrag(page, cardIn(rengo, "shigure2"));
    await dragOver(page, columnHeadingOf(page, "第六艦隊"));
    await expect(columnOf(page, "第六艦隊"), "前提：ドラッグが始まっていること").toHaveAttribute(
      "data-drop-highlight",
      "true",
    );
    await dragOver(page, kitakami);
    await expect(columnOf(page, "第六艦隊")).not.toHaveAttribute("data-drop-highlight", "true");
    await waitForFrames(page);

    // 検証：入れ替えの表示も読み上げも出さない
    await expect(page.getByText(SWAP_HINT, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: SWAP_ANNOUNCEMENT })).toHaveCount(0);

    // 実行：落とす
    await drop(page);

    // 検証：変わらない
    await expect(cardIn(rengo, "shigure2")).toBeVisible();
    await expect(kitakami).toBeVisible();
    await expect(rengo).toContainText(shipCountPattern(8));
    await expect(undoButtonOf(page)).toBeDisabled();
  });

  test("控えの艦を控えの別の艦のカードに重ねても、「⇄ 入れ替え」も「離すと入れ替えます」の読み上げも出さず、落としても変わらない", async ({
    page,
  }) => {
    // 準備
    const tray = trayOf(page);
    const hamanami = cardIn(tray, "hamanami");
    await expect(hamanami, "前提：浜波改のカードがスクロールせずに見えていること").toBeInViewport();

    // 実行：控えの利根改二をドラッグし、第六艦隊の上を通ってから、控えの浜波改に重ねる
    await startDrag(page, cardIn(tray, "tone"));
    await dragOver(page, columnHeadingOf(page, "第六艦隊"));
    await expect(columnOf(page, "第六艦隊"), "前提：ドラッグが始まっていること").toHaveAttribute(
      "data-drop-highlight",
      "true",
    );
    await dragOver(page, hamanami);
    await expect(columnOf(page, "第六艦隊")).not.toHaveAttribute("data-drop-highlight", "true");
    await waitForFrames(page);

    // 検証：入れ替えの表示も読み上げも出さない
    await expect(page.getByText(SWAP_HINT, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: SWAP_ANNOUNCEMENT })).toHaveCount(0);

    // 実行：落とす
    await drop(page);

    // 検証：変わらない
    await expect(cardIn(tray, "tone")).toBeVisible();
    await expect(hamanami).toBeVisible();
    await expect(tray).toContainText(trayCountPattern(11, 12));
    await expect(undoButtonOf(page)).toBeDisabled();
  });
});
