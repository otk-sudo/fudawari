// 割り振り画面の中身（AssignScreen。roadmap T2-7、要件 3.3、U17・U22、モック Assign.dc.html・ShipCard.dc.html）の画面テスト
//
// 部品に定義・マスタ・艦・割り当て・保存の関数を直接渡して描き、Testing Library で利用者と同じように操作する。
// 読み込み（公開定義・艦船マスタ・札割りのデータ・設定）と保存先への保存は src/app/assign/page.test.tsx で確かめる。
// ドラッグ＆ドロップと 600 隻の性能は PR-06（T2-8）で確かめるので、ここでは書かない。
// 部品の探し方（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
//
// テスト用データ（特に断らなければ）
// - 定義：2026夏イベ（summer2026Definition）。札は定義の順に
//   第三十一戦隊（s31・#8B93A1）、多号作戦部隊（tago・#5FB0E8）、連合艦隊（rengo・#4C8DF6）、
//   ウルシー攻撃部隊（ulithi・#3FB37F）、第六艦隊（sixth・#A97EF0）。段階の表示名は「海域名 段階名」（例「E2 ゲージ3」）
// - 艦：モックの所持艦 31 隻（summer2026Ships）。マスタは仮マスタ（summer2026MasterEntries）
// - 割り当て：一覧の割り当て（summer2026Assignments）。19 隻を札に置き（第三十一戦隊 4・多号作戦部隊 3・連合艦隊 8・
//   ウルシー攻撃部隊 3・第六艦隊 1）、控えは 12 隻。初めは「特効のある艦だけ」が ON なので、
//   特効のないあきつ丸改を除く 11 隻を出す（「11 / 12隻」）
// - よく使う艦（スコアは src/domain/boost のとおり）
//   - 利根改二（tone・控え・航巡・Lv150 運35）：連合艦隊 +82（E2 ゲージ2 ×1.14、E2 ゲージ3 ×1.18）、
//     ウルシー攻撃部隊 +24（E3 ゲージ4 ×1.08）
//   - 速吸改（hayasui・控え・補給・Lv90 運18）：ウルシー攻撃部隊 +56（E3 ゲージ1 ×1.14、E3 ゲージ4 ×1.14）だけ
//   - 伊168改（i168・控え・潜水）：第六艦隊 +48 だけ
//   - 浜波改（hamanami・控え・駆逐・Lv110 運23）。あきつ丸改（akitsumaru・控え・揚陸・Lv88 運40・どの札でも特効なし）
//   - 時雨改二（shigure2・連合艦隊・駆逐・Lv98 運22）：連合艦隊 +110（E2 ゲージ2 ×1.19、E2 ゲージ3 ×1.24）、
//     ウルシー攻撃部隊 +56（E3 ゲージ1 ×1.14、E3 ゲージ4 ×1.14）
//   - 涼風改二（suzukaze・第三十一戦隊・どの札でも特効なし）、北上改二（kitakami・連合艦隊・雷巡・Lv160 運40）
//   - 朝霜改二が 2 隻（asashimo：多号作戦部隊・Lv140 運34、asashimo2：控え・Lv92 運20）
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, type Mock, vi } from "vitest";
import type { PublicDefinition } from "@/domain/definition/types";
import { createShipMaster } from "@/domain/master";
import type { ShipMaster, ShipMasterEntry } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { AssignScreen } from "@/features/assign/AssignScreen";
import type { SaveAssignments } from "@/features/assign/assign-store";
import type { TrayOptionsInit } from "@/features/assign/tray";
import {
  findCards,
  getCard,
  getColumn,
  getGroupHeader,
  getHeader,
  getPanel,
  getTray,
  MULTIPLIER,
  queryCard,
  queryPanel,
  queryPlaceButton,
  shipCountPattern,
  trayCountPattern,
} from "@/test/assign-screen";
import { expectInDocumentOrder } from "@/test/dom-order";
import {
  cloneSummer2026Definition,
  shipByUid,
  summer2026Assignments,
  summer2026Definition,
  summer2026DefinitionWithExtraFudas,
  summer2026MasterEntries,
  summer2026Ships,
  unknownShip,
} from "@/test/fixtures";

// ---- テスト用のデータ ----

/** 最新イベントの ID（"2026-summer"。保存の関数に渡る） */
const EVENT_ID = summer2026Definition.event.id;
/** 仮マスタの索引 */
const MASTER = createShipMaster(summer2026MasterEntries);
/** 定義の札名（定義の順） */
const FUDA_NAMES = summer2026Definition.fudas.map((fuda) => fuda.name);

/** 札の色（定義の値） */
const COLOR = {
  s31: "#8B93A1",
  rengo: "#4C8DF6",
  ulithi: "#3FB37F",
  sixth: "#A97EF0",
} as const;

/** 英字の名前の艦（検索で大文字・小文字を区別しないことを確かめる。仮マスタにない艦 ID・どの特効にも入っていない） */
const WARSPITE_ENTRY: ShipMasterEntry = {
  id: 439,
  name: "Warspite改",
  baseName: "Warspite",
  yomi: "うぉーすぱいと",
  shipTypeId: 9,
  shipClassId: 67,
  shipClassName: "Queen Elizabeth級",
  nationality: "uk",
  remodelStage: "final",
  sortNo: 1100,
  luckBase: 10,
};
const WARSPITE: OwnedShip = { uid: "warspite", shipId: 439, level: 99, luck: 12, sallyArea: 0 };

// ---- 補助 ----

interface RenderOptions {
  definition?: PublicDefinition;
  master?: ShipMaster;
  ships?: readonly OwnedShip[];
  assignments?: AssignmentMap;
  save?: Mock<SaveAssignments>;
  returnedCount?: number;
  trayInit?: TrayOptionsInit;
}

/** 割り振り画面の中身を描く（省略した値はテスト用データ）。保存の関数は偽物（すぐに成功する） */
function renderAssignScreen(options: RenderOptions = {}) {
  const save = options.save ?? vi.fn<SaveAssignments>(() => Promise.resolve());
  const user = userEvent.setup();
  const view = render(
    <AssignScreen
      definition={options.definition ?? summer2026Definition}
      master={options.master ?? MASTER}
      ships={options.ships ?? summer2026Ships}
      initialAssignments={options.assignments ?? summer2026Assignments}
      save={save}
      returnedCount={options.returnedCount ?? 0}
      trayInit={options.trayInit}
    />,
  );
  return { ...view, user, save };
}

/** ボタン「元に戻す」 */
function getUndoButton(): HTMLElement {
  return within(getHeader()).getByRole("button", { name: "元に戻す" });
}

/** 控えの検索欄 */
function getSearchBox(): HTMLElement {
  return within(getTray()).getByRole("searchbox", { name: "図鑑ID・名称で検索" });
}

/** ボタン「絞り込み」（名前は「絞り込み」とバッジの数） */
function getFilterButton(): HTMLElement {
  return within(getTray()).getByRole("button", { name: /^絞り込み\s*\d*$/ });
}

/** 並び順のプルダウン */
function getSortSelect(): HTMLElement {
  return within(getTray()).getByRole("combobox", { name: "並び順" });
}

/** 艦種タブ */
function getTab(label: string): HTMLElement {
  return within(within(getTray()).getByRole("tablist", { name: "艦種" })).getByRole("tab", { name: label });
}

/** 表示の詰め具合のボタン（「一行」「カード」） */
function getViewButton(label: "一行" | "カード"): HTMLElement {
  return within(within(getTray()).getByRole("group", { name: "表示の詰め具合" })).getByRole("button", { name: label });
}

/** 絞り込みの条件のチェックボックス（group の名前とチェックボックスの名前で探す） */
function getFilterCheckbox(groupName: string, label: string): HTMLElement {
  return within(within(getTray()).getByRole("group", { name: groupName })).getByRole("checkbox", { name: label });
}

/** 「絞り込み」を押して条件を開く */
async function openFilter(user: UserEvent): Promise<void> {
  await user.click(getFilterButton());
}

/** 「リセット」を押す（「特効のある艦だけ」が OFF になり、特効のない艦も控えに出る） */
async function pressReset(user: UserEvent): Promise<void> {
  await user.click(within(getTray()).getByRole("button", { name: "リセット" }));
}

/** 「特効を表示中：n隻」の帯の文（なければ null） */
function queryOpenBand(): HTMLElement | null {
  return within(getTray()).queryByText(/特効を表示中/);
}

/** 「特効を表示中：n隻」の帯の文 */
function getOpenBand(): HTMLElement {
  return within(getTray()).getByText(/特効を表示中/);
}

/** 画面のどこかにある、艦名が shipName の艦カード（控えか札の列のどちらか。パネルの艦名は艦カードではないので数えない） */
function getCardAnywhere(shipName: string, level?: number): HTMLElement {
  return getCard(document.body, shipName, level);
}

// ---- テスト ----

describe("割り振り画面の中身（AssignScreen）", () => {
  describe("ヘッダー", () => {
    it("ヘッダーに見出し「割り振り」（h1）と最新イベント名「2026夏イベ」を出す", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(within(getHeader()).getByText("2026夏イベ")).toBeInTheDocument();
    });

    it("操作の説明「ドラッグで別の札へ移動、カードに重ねると入れ替え」を出す", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(getHeader()).toHaveTextContent("ドラッグで別の札へ移動、カードに重ねると入れ替え");
    });

    it.each([
      ["2026-08-04", /特効データ：\s*2026\/08\/04\s*版/],
      ["2026-09-15", /特効データ：\s*2026\/09\/15\s*版/],
    ])("特効データの版の日付（定義の versionDate が %s）を「特効データ：YYYY/MM/DD 版」の形で出す", (versionDate, expected) => {
      // 準備
      const definition = cloneSummer2026Definition();
      definition.event.versionDate = versionDate;

      // 実行
      renderAssignScreen({ definition });

      // 検証
      expect(getHeader()).toHaveTextContent(expected);
    });

    it("「一覧で確認」は一覧の画面（/list）へのリンク", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(within(getHeader()).getByRole("link", { name: "一覧で確認" })).toHaveAttribute("href", "/list");
    });

    it("「元に戻す」は、まだ何も変えていないときは押せない", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(getUndoButton()).toBeDisabled();
    });
  });

  describe("控えの見出しと表示の切り替え", () => {
    it("見出し「控え」と「表示数 / 控えの総数隻」を出す（初めは特効のある艦だけなので 11 / 12隻）", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      const tray = getTray();
      expect(within(tray).getByRole("heading", { name: "控え" })).toBeInTheDocument();
      expect(tray).toHaveTextContent(trayCountPattern(11, 12));
    });

    it("表示の詰め具合は初め「一行」で、「カード」を押すとカードに切り替わる", async () => {
      // 準備
      const { user } = renderAssignScreen();
      expect(getViewButton("一行")).toHaveAttribute("aria-pressed", "true");
      expect(getViewButton("カード")).toHaveAttribute("aria-pressed", "false");

      // 実行
      await user.click(getViewButton("カード"));

      // 検証
      expect(getViewButton("一行")).toHaveAttribute("aria-pressed", "false");
      expect(getViewButton("カード")).toHaveAttribute("aria-pressed", "true");
      expect(getCard(getTray(), "浜波改")).toHaveTextContent(/駆逐\s*・\s*Lv\s*110\s*・\s*運\s*23/);
    });

    it("並び順と表示の初期値を外から渡せる（設定の traySort・trayView）", () => {
      // 準備・実行：並び順 Lv・表示 カード
      renderAssignScreen({ trayInit: { sort: "lv", view: "card" } });

      // 検証
      expect(getSortSelect()).toHaveDisplayValue("Lv");
      expect(getViewButton("カード")).toHaveAttribute("aria-pressed", "true");
      expect(getGroupHeader("Lv 110 以上")).toBeInTheDocument();
      expect(getCard(getTray(), "浜波改")).toHaveTextContent(/駆逐\s*・\s*Lv\s*110\s*・\s*運\s*23/);
    });

    it("初期値を渡さなければ、並び順は艦型・表示は一行", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(getSortSelect()).toHaveDisplayValue("艦型");
      expect(getViewButton("一行")).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("検索", () => {
    it("検索欄（虫眼鏡付き「図鑑ID 名称検索」）に名称の一部を入れると、その艦だけに絞る", async () => {
      // 準備
      const { user } = renderAssignScreen();
      expect(getSearchBox()).toHaveAttribute("placeholder", "図鑑ID 名称検索");

      // 実行
      await user.type(getSearchBox(), "浜波");

      // 検証
      await waitFor(() => expect(getTray()).toHaveTextContent(trayCountPattern(1, 12)));
      expect(getCard(getTray(), "浜波改")).toBeInTheDocument();
      expect(queryCard(getTray(), "利根改二")).toBeNull();
    });

    it("図鑑 ID（図鑑番号）でも探せる（1033 は速吸改）", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.type(getSearchBox(), "1033");

      // 検証
      await waitFor(() => expect(getTray()).toHaveTextContent(trayCountPattern(1, 12)));
      expect(getCard(getTray(), "速吸改")).toBeInTheDocument();
    });

    it.each(["warspite", "WARSPITE"])("英字の大文字・小文字を区別しない（「%s」で Warspite改 が見つかる）", async (query) => {
      // 準備：英字の名前の艦を足し、「リセット」で特効のない艦も出す（控えは 13 隻）
      const { user } = renderAssignScreen({
        master: createShipMaster([...summer2026MasterEntries, WARSPITE_ENTRY]),
        ships: [...summer2026Ships, WARSPITE],
      });
      await pressReset(user);

      // 実行
      await user.type(getSearchBox(), query);

      // 検証
      await waitFor(() => expect(getTray()).toHaveTextContent(trayCountPattern(1, 13)));
      expect(getCard(getTray(), "Warspite改")).toBeInTheDocument();
    });

    it("条件に合う艦がいなければ「条件に合う艦はいません」と出し、表示数は 0", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.type(getSearchBox(), "存在しない艦");

      // 検証
      await waitFor(() => expect(getTray()).toHaveTextContent(trayCountPattern(0, 12)));
      expect(within(getTray()).getByText("条件に合う艦はいません")).toBeInTheDocument();
    });

    it("条件に合う艦がいれば「条件に合う艦はいません」を出さない", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(within(getTray()).queryByText("条件に合う艦はいません")).not.toBeInTheDocument();
    });

    it("検索しても札の列の艦は変わらない（控えだけを絞る）", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.type(getSearchBox(), "浜波");

      // 検証：連合艦隊の 8 隻はそのまま
      await waitFor(() => expect(getTray()).toHaveTextContent(trayCountPattern(1, 12)));
      const rengo = getColumn("連合艦隊");
      expect(rengo).toHaveTextContent(shipCountPattern(8));
      expect(getCard(rengo, "時雨改二")).toBeInTheDocument();
    });
  });

  describe("絞り込み", () => {
    it("「絞り込み」は初め閉じていて、押すと改造状態・特効・特効が効く札の条件が開く（初期値：改造状態はすべて ON、「特効のある艦だけ」ON、札は未選択）", async () => {
      // 準備
      const { user } = renderAssignScreen();
      expect(getFilterButton()).toHaveAttribute("aria-expanded", "false");
      expect(within(getTray()).queryByRole("group", { name: "改造状態" })).not.toBeInTheDocument();

      // 実行
      await openFilter(user);

      // 検証
      expect(getFilterButton()).toHaveAttribute("aria-expanded", "true");
      for (const label of ["未改造", "中間改造", "最終改造"]) {
        expect(getFilterCheckbox("改造状態", label)).toBeChecked();
      }
      expect(getFilterCheckbox("特効", "特効のある艦だけ")).toBeChecked();
      // 特効が効く札：定義の札ごとに 1 つ（名前は札名）、定義の順で並び、どれも選ばれていない
      const fudaGroup = within(getTray()).getByRole("group", { name: "特効が効く札" });
      expect(within(fudaGroup).getAllByRole("checkbox")).toHaveLength(FUDA_NAMES.length);
      const fudaBoxes = FUDA_NAMES.map((name) => within(fudaGroup).getByRole("checkbox", { name }));
      expectInDocumentOrder(fudaBoxes);
      for (const box of fudaBoxes) {
        expect(box).not.toBeChecked();
      }
    });

    it("条件の数のバッジは、初め 1（「特効のある艦だけ」ON）", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(getFilterButton()).toHaveTextContent(/絞り込み\D*1(?!\d)/);
    });

    it("改造状態の「最終改造」を外すと、最終改造の艦が控えから消え、バッジが 2 になる", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await openFilter(user);

      // 実行
      await user.click(getFilterCheckbox("改造状態", "最終改造"));

      // 検証：控えの特効のある艦のうち、最終改造でないのは雪風改（中間改造）と大鯨（未改造）だけ
      expect(getTray()).toHaveTextContent(trayCountPattern(2, 12));
      expect(getCard(getTray(), "雪風改")).toBeInTheDocument();
      expect(getCard(getTray(), "大鯨")).toBeInTheDocument();
      expect(queryCard(getTray(), "浜波改")).toBeNull();
      expect(getFilterButton()).toHaveTextContent(/絞り込み\D*2(?!\d)/);
    });

    it("「特効のある艦だけ」を外すと、特効のない艦（あきつ丸改）も出て、バッジが消える", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await openFilter(user);
      expect(queryCard(getTray(), "あきつ丸改")).toBeNull();

      // 実行
      await user.click(getFilterCheckbox("特効", "特効のある艦だけ"));

      // 検証
      expect(getTray()).toHaveTextContent(trayCountPattern(12, 12));
      expect(getCard(getTray(), "あきつ丸改")).toBeInTheDocument();
      expect(getFilterButton().textContent ?? "").not.toMatch(/\d/);
    });

    it("「特効が効く札」で第六艦隊を選ぶと、第六艦隊で特効のある艦（伊168改）だけになり、バッジが 2 になる", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await openFilter(user);

      // 実行
      await user.click(getFilterCheckbox("特効が効く札", "第六艦隊"));

      // 検証
      expect(getTray()).toHaveTextContent(trayCountPattern(1, 12));
      expect(getCard(getTray(), "伊168改")).toBeInTheDocument();
      expect(getFilterButton()).toHaveTextContent(/絞り込み\D*2(?!\d)/);
    });

    it("「リセット」で、艦種タブ ALL・並び順 艦型・改造状態すべて ON・「特効のある艦だけ」OFF・札の選択なしに戻る（検索欄はそのまま）", async () => {
      // 準備：検索・艦種タブ・並び順・改造状態・札をそれぞれ変えておく
      const { user } = renderAssignScreen();
      await user.type(getSearchBox(), "浜");
      await user.click(getTab("駆逐"));
      await user.selectOptions(getSortSelect(), "Lv");
      await openFilter(user);
      await user.click(getFilterCheckbox("改造状態", "最終改造"));
      await user.click(getFilterCheckbox("特効が効く札", "第六艦隊"));

      // 実行
      await pressReset(user);

      // 検証
      expect(getTab("ALL")).toHaveAttribute("aria-selected", "true");
      expect(getTab("駆逐")).toHaveAttribute("aria-selected", "false");
      expect(getSortSelect()).toHaveDisplayValue("艦型");
      for (const label of ["未改造", "中間改造", "最終改造"]) {
        expect(getFilterCheckbox("改造状態", label)).toBeChecked();
      }
      expect(getFilterCheckbox("特効", "特効のある艦だけ")).not.toBeChecked();
      expect(getFilterCheckbox("特効が効く札", "第六艦隊")).not.toBeChecked();
      expect(getFilterButton().textContent ?? "").not.toMatch(/\d/);
      // 検索欄は「浜」のまま（条件を外したので、名前に「浜」を含む浜波改だけ）
      expect(getSearchBox()).toHaveValue("浜");
      expect(getTray()).toHaveTextContent(trayCountPattern(1, 12));
    });
  });

  describe("艦種タブ", () => {
    it("13 のタブ（ALL・空母・軽母・戦艦・航戦・重巡・航巡・軽巡・駆逐・海防・潜水・水母・その他）がこの順で並び、初めは ALL が選ばれている", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      const tabs = within(within(getTray()).getByRole("tablist", { name: "艦種" })).getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
        "ALL", "空母", "軽母", "戦艦", "航戦", "重巡", "航巡", "軽巡", "駆逐", "海防", "潜水", "水母", "その他",
      ]);
      expect(getTab("ALL")).toHaveAttribute("aria-selected", "true");
    });

    it("「駆逐」を選ぶと、駆逐艦（雪風改・朝霜改二・浜波改）だけになる", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.click(getTab("駆逐"));

      // 検証
      expect(getTab("駆逐")).toHaveAttribute("aria-selected", "true");
      expect(getTab("ALL")).toHaveAttribute("aria-selected", "false");
      const tray = getTray();
      expect(tray).toHaveTextContent(trayCountPattern(3, 12));
      expect(getCard(tray, "雪風改")).toBeInTheDocument();
      expect(getCard(tray, "朝霜改二")).toBeInTheDocument();
      expect(getCard(tray, "浜波改")).toBeInTheDocument();
      expect(queryCard(tray, "利根改二")).toBeNull();
    });

    it("矢印キー（左右）で隣のタブを選んでフォーカスを移し、端では反対の端へ回る。Home で最初（ALL）、End で最後（その他）のタブ", async () => {
      // 準備：ALL のタブにフォーカスを置く
      const { user } = renderAssignScreen();
      await user.click(getTab("ALL"));
      expect(getTab("ALL")).toHaveFocus();

      /** 選ばれているタブがちょうど label の 1 つで、そこにフォーカスがあることを確かめる */
      const expectSelected = (label: string): void => {
        const tabs = within(within(getTray()).getByRole("tablist", { name: "艦種" })).getAllByRole("tab");
        const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
        expect(selected.map((tab) => tab.textContent?.trim())).toEqual([label]);
        expect(getTab(label)).toHaveFocus();
      };

      // 実行・検証：右へ（ALL → 空母）、左へ（空母 → ALL）
      await user.keyboard("{ArrowRight}");
      expectSelected("空母");
      await user.keyboard("{ArrowLeft}");
      expectSelected("ALL");

      // 実行・検証：最初のタブで左へ → 最後（その他）、最後のタブで右へ → 最初（ALL）
      await user.keyboard("{ArrowLeft}");
      expectSelected("その他");
      await user.keyboard("{ArrowRight}");
      expectSelected("ALL");

      // 実行・検証：End → その他（控えもその他の艦〔大鯨・速吸改・明石改〕に絞る）、Home → ALL
      await user.keyboard("{End}");
      expectSelected("その他");
      expect(getTray()).toHaveTextContent(trayCountPattern(3, 12));
      await user.keyboard("{Home}");
      expectSelected("ALL");
      expect(getTray()).toHaveTextContent(trayCountPattern(11, 12));
    });
  });

  describe("並び順と区切りの見出し", () => {
    it("並び順のプルダウンには艦型・Lv・特効の強さ・名前がこの順で並び、初めは艦型で、艦型ごとの見出し（隻数つき）で区切る", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      const options = within(getSortSelect()).getAllByRole("option");
      expect(options.map((option) => option.textContent?.trim())).toEqual(["艦型", "Lv", "特効の強さ", "名前"]);
      // 夕雲型：朝霜改二（Lv92）・浜波改（Lv110）の 2 隻
      expect(getGroupHeader("夕雲型")).toHaveTextContent(shipCountPattern(2));
      expect(getGroupHeader("利根型")).toHaveTextContent(shipCountPattern(1));
    });

    it("並び順を「Lv」にすると、「Lv 90 以上」のような 10 刻みの見出しで区切る", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.selectOptions(getSortSelect(), "Lv");

      // 検証：Lv 90 以上は 朝霜改二（92）・明石改（99）・秋津洲改（95）・速吸改（90）の 4 隻
      expect(getGroupHeader("Lv 90 以上")).toHaveTextContent(shipCountPattern(4));
      expect(getGroupHeader("Lv 150 以上")).toHaveTextContent(shipCountPattern(1));
      expectInDocumentOrder([getGroupHeader("Lv 150 以上"), getGroupHeader("Lv 90 以上")]);
    });

    it("並び順を「特効の強さ」にすると「（札名）で効く」、「名前」にすると「名前順」の見出しで区切る", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行・検証：特効の強さ（一番効く札が連合艦隊なのは 雪風改・朝霜改二・浜波改・利根改二・日向改二・大鯨・瑞鳳改二乙 の 7 隻）
      await user.selectOptions(getSortSelect(), "特効の強さ");
      expect(getGroupHeader("連合艦隊で効く")).toHaveTextContent(shipCountPattern(7));

      // 実行・検証：名前
      await user.selectOptions(getSortSelect(), "名前");
      expect(getGroupHeader("名前順")).toHaveTextContent(shipCountPattern(11));
    });

    it("区切りの見出しを押すとその区切りを折りたたみ、もう一度押すと開く", async () => {
      // 準備
      const { user } = renderAssignScreen();
      expect(getGroupHeader("夕雲型")).toHaveAttribute("aria-expanded", "true");

      // 実行：折りたたむ
      await user.click(getGroupHeader("夕雲型"));

      // 検証：夕雲型の艦は見えなくなり、ほかの区切りの艦は見えたまま
      expect(getGroupHeader("夕雲型")).toHaveAttribute("aria-expanded", "false");
      expect(queryCard(getTray(), "浜波改")).toBeNull();
      expect(queryCard(getTray(), "朝霜改二")).toBeNull();
      expect(getCard(getTray(), "利根改二")).toBeInTheDocument();

      // 実行：開く
      await user.click(getGroupHeader("夕雲型"));

      // 検証
      expect(getGroupHeader("夕雲型")).toHaveAttribute("aria-expanded", "true");
      expect(getCard(getTray(), "浜波改")).toBeInTheDocument();
    });
  });

  describe("艦カード", () => {
    it("一行表示：艦名・「Lv 運」・特効の印「特効」を出す（2 行目の艦種は出さない）", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      const card = getCard(getTray(), "浜波改");
      expect(card).toHaveTextContent(/Lv\s*110\s*運\s*23/);
      expect(card).toHaveTextContent("特効");
      expect(card).not.toHaveTextContent("特効あり");
      expect(card).not.toHaveTextContent(/駆逐\s*・/);
    });

    it("一行表示：特効のない艦の印は「－」", async () => {
      // 準備：「リセット」で特効のない艦も出す
      const { user } = renderAssignScreen();
      await pressReset(user);

      // 検証
      const card = getCard(getTray(), "あきつ丸改");
      expect(card).toHaveTextContent(/Lv\s*88\s*運\s*40/);
      expect(card).toHaveTextContent("－");
      expect(card).not.toHaveTextContent("特効");
    });

    it("カード表示：艦名・特効の印「特効あり」／「特効なし」・2 行目「艦種 ・ Lv ・ 運」を出す", async () => {
      // 準備：表示をカードにし、「リセット」で特効のない艦も出す
      const { user } = renderAssignScreen({ trayInit: { view: "card" } });
      await pressReset(user);

      // 検証
      const hamanami = getCard(getTray(), "浜波改");
      expect(hamanami).toHaveTextContent("特効あり");
      expect(hamanami).toHaveTextContent(/駆逐\s*・\s*Lv\s*110\s*・\s*運\s*23/);
      const akitsumaru = getCard(getTray(), "あきつ丸改");
      expect(akitsumaru).toHaveTextContent("特効なし");
      expect(akitsumaru).toHaveTextContent(/揚陸\s*・\s*Lv\s*88\s*・\s*運\s*40/);
    });

    it("札の列の艦は（控えが一行表示でも）カード表示で、艦種の略称を出す（雷巡・戦艦・正空・潜水）", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      const kitakami = getCard(getColumn("連合艦隊"), "北上改二");
      expect(kitakami).toHaveTextContent("特効あり");
      expect(kitakami).toHaveTextContent(/雷巡\s*・\s*Lv\s*160\s*・\s*運\s*40/);
      expect(getCard(getColumn("ウルシー攻撃部隊"), "大和改二重")).toHaveTextContent(/戦艦\s*・\s*Lv\s*175\s*・\s*運\s*61/);
      expect(getCard(getColumn("連合艦隊"), "瑞鶴改二甲")).toHaveTextContent(/正空\s*・\s*Lv\s*165\s*・\s*運\s*80/);
      expect(getCard(getColumn("第六艦隊"), "伊41改")).toHaveTextContent(/潜水\s*・\s*Lv\s*120\s*・\s*運\s*30/);
    });

    it("札の列の艦の特効の印は、その札での特効の有無（ほかの札で効く速吸改も、連合艦隊では「特効なし」）", () => {
      // 準備・実行：速吸改（ウルシー攻撃部隊だけで効く）を連合艦隊に置いておく
      renderAssignScreen({ assignments: { ...summer2026Assignments, hayasui: "rengo" } });

      // 検証
      const card = getCard(getColumn("連合艦隊"), "速吸改");
      expect(card).toHaveTextContent("特効なし");
      expect(card).not.toHaveTextContent("特効あり");
    });

    it("左端の色：控えの艦は一番効く札の色、特効のない控えの艦は灰色", async () => {
      // 準備：「リセット」で特効のない艦も出す
      const { user } = renderAssignScreen();
      await pressReset(user);

      // 検証
      const tray = getTray();
      expect(getCard(tray, "利根改二")).toHaveAttribute("data-stripe-color", COLOR.rengo);
      expect(getCard(tray, "速吸改")).toHaveAttribute("data-stripe-color", COLOR.ulithi);
      expect(getCard(tray, "伊168改")).toHaveAttribute("data-stripe-color", COLOR.sixth);
      expect(getCard(tray, "あきつ丸改")).toHaveAttribute("data-stripe-color", "none");
    });

    it("左端の色：札に置いた艦はその札の色（その札で特効がなくても）", () => {
      // 準備・実行：速吸改を連合艦隊に置いておく
      renderAssignScreen({ assignments: { ...summer2026Assignments, hayasui: "rengo" } });

      // 検証
      expect(getCard(getColumn("連合艦隊"), "北上改二")).toHaveAttribute("data-stripe-color", COLOR.rengo);
      expect(getCard(getColumn("連合艦隊"), "速吸改")).toHaveAttribute("data-stripe-color", COLOR.rengo);
      expect(getCard(getColumn("第三十一戦隊"), "涼風改二")).toHaveAttribute("data-stripe-color", COLOR.s31);
    });

    it("選ぶ前は特効の有無だけを出し、倍率は出さない（どのカードも閉じている）", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(getTray()).not.toHaveTextContent(MULTIPLIER);
      for (const name of FUDA_NAMES) {
        expect(getColumn(name)).not.toHaveTextContent(MULTIPLIER);
      }
      expect(getCard(getTray(), "利根改二")).toHaveAttribute("aria-expanded", "false");
      expect(getCard(getTray(), "利根改二")).toHaveAttribute("aria-pressed", "false");
    });

    it("控えの艦を選ぶと、そのカードが開き、効く札のスコアの高い順に、効く段階の倍率をすべて並べる", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.click(getCard(getTray(), "利根改二"));

      // 検証：連合艦隊（+82）の 2 段階 → ウルシー攻撃部隊（+24）の 1 段階
      const card = getCard(getTray(), "利根改二");
      expect(card).toHaveAttribute("aria-pressed", "true");
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(card).toHaveTextContent(/E2 ゲージ2\s*×1\.14.*E2 ゲージ3\s*×1\.18.*E3 ゲージ4\s*×1\.08/);
    });

    it("控えの特効のない艦を選ぶと、開いたカードに「特効なし」と出す", async () => {
      // 準備：「リセット」で特効のない艦も出す
      const { user } = renderAssignScreen();
      await pressReset(user);

      // 実行
      await user.click(getCard(getTray(), "あきつ丸改"));

      // 検証
      const card = getCard(getTray(), "あきつ丸改");
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(card).toHaveTextContent("特効なし");
      expect(card).not.toHaveTextContent(MULTIPLIER);
    });

    it("札に置いた艦を選ぶと、その札の段階で効くものだけを並べる（ほかの札の段階は出さない）", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 検証：連合艦隊の E2 ゲージ2 ×1.19・E2 ゲージ3 ×1.24 だけ（ウルシー攻撃部隊の E3 ゲージ1・ゲージ4 は出さない）
      const card = getCard(getColumn("連合艦隊"), "時雨改二");
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(card).toHaveTextContent(/E2 ゲージ2\s*×1\.19.*E2 ゲージ3\s*×1\.24/);
      expect(card).not.toHaveTextContent("E3 ゲージ1");
      expect(card).not.toHaveTextContent("E3 ゲージ4");
    });

    it.each([
      ["速吸改（ほかの札では効く）を連合艦隊に置いた", "連合艦隊", "速吸改"],
      ["涼風改二（どの札でも効かない）を第三十一戦隊に置いた", "第三十一戦隊", "涼風改二"],
    ])("札の段階で効かない艦（%s）を選ぶと「この札では特効なし」と出す", async (_label, fudaName, shipName) => {
      // 準備
      const { user } = renderAssignScreen({ assignments: { ...summer2026Assignments, hayasui: "rengo" } });

      // 実行
      await user.click(getCard(getColumn(fudaName), shipName));

      // 検証
      const card = getCard(getColumn(fudaName), shipName);
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(card).toHaveTextContent("この札では特効なし");
      expect(card).not.toHaveTextContent(MULTIPLIER);
    });

    it("サブ艦の表記を出さず、同名艦（朝霜改二 2 隻）は Lv と運で見分けられる", () => {
      // 準備・実行
      const { container } = renderAssignScreen();

      // 検証
      expect(getCard(getColumn("多号作戦部隊"), "朝霜改二", 140)).toHaveTextContent(/運\s*34/);
      expect(getCard(getTray(), "朝霜改二", 92)).toHaveTextContent(/運\s*20/);
      expect(container).not.toHaveTextContent("サブ");
    });

    it("マスタにない艦も「名前が分からない艦」として札の列に出し、選ぶと「この札では特効なし」と出す", async () => {
      // 準備：マスタにない艦（Lv1 運10）を連合艦隊に置いておく
      const { user } = renderAssignScreen({
        ships: [...summer2026Ships, unknownShip],
        assignments: { ...summer2026Assignments, [unknownShip.uid]: "rengo" },
      });
      const rengo = getColumn("連合艦隊");
      expect(rengo).toHaveTextContent(shipCountPattern(9));
      const card = getCard(rengo, "名前が分からない艦");
      expect(card).toHaveTextContent("特効なし");
      expect(card).toHaveTextContent(/Lv\s*1(?!\d)/);
      expect(card).toHaveTextContent(/運\s*10/);
      expect(card).toHaveAttribute("data-stripe-color", COLOR.rengo);

      // 実行
      await user.click(card);

      // 検証
      expect(getCard(getColumn("連合艦隊"), "名前が分からない艦")).toHaveTextContent("この札では特効なし");
    });

    it("マスタにない控えの艦は、特効のない艦も出す条件（リセット後）で「名前が分からない艦」として控えに出す", async () => {
      // 準備
      const { user } = renderAssignScreen({ ships: [...summer2026Ships, unknownShip] });
      expect(queryCard(getTray(), "名前が分からない艦")).toBeNull();

      // 実行
      await pressReset(user);

      // 検証
      expect(getTray()).toHaveTextContent(trayCountPattern(13, 13));
      const card = getCard(getTray(), "名前が分からない艦");
      expect(card).toHaveTextContent("－");
      expect(card).toHaveAttribute("data-stripe-color", "none");
    });
  });

  describe("札の列", () => {
    it("定義の札ごとに 1 列を定義の順に並べ、見出しに札名・使う段階・隻数を出す", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expectInDocumentOrder(FUDA_NAMES.map((name) => getColumn(name)));
      const s31 = getColumn("第三十一戦隊");
      expect(s31).toHaveTextContent(/E1 ギミック〜ゲージ3.*E2 ギミック.*E3 ギミック.*E3 ゲージ2 輸送/);
      expect(s31).toHaveTextContent(shipCountPattern(4));
      const rengo = getColumn("連合艦隊");
      expect(rengo).toHaveTextContent(/E2 ゲージ2.*E2 ゲージ3/);
      expect(rengo).toHaveTextContent(shipCountPattern(8));
      expect(getColumn("多号作戦部隊")).toHaveTextContent(shipCountPattern(3));
      expect(getColumn("ウルシー攻撃部隊")).toHaveTextContent(shipCountPattern(3));
      expect(getColumn("第六艦隊")).toHaveTextContent(/E3 ゲージ3/);
      expect(getColumn("第六艦隊")).toHaveTextContent(shipCountPattern(1));
    });

    it("札の列は定義から組み立てる（札を足した定義なら列も増え、艦のいない札は 0 隻）", () => {
      // 準備・実行：未使用の札と札番号なしの札（E4 ゲージ1）を足した定義
      renderAssignScreen({ definition: summer2026DefinitionWithExtraFudas });

      // 検証
      const names = summer2026DefinitionWithExtraFudas.fudas.map((fuda) => fuda.name);
      expect(names).toHaveLength(7);
      expectInDocumentOrder(names.map((name) => getColumn(name)));
      expect(getColumn("未使用の札")).toHaveTextContent(shipCountPattern(0));
      expect(getColumn("札番号なしの札")).toHaveTextContent(/E4 ゲージ1/);
    });

    it("艦を選んでいないときは、どの列にも「ここに置く」を出さず、どの列も薄くしない", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      for (const name of FUDA_NAMES) {
        expect(queryPlaceButton(getColumn(name))).toBeNull();
        expect(getColumn(name)).not.toHaveAttribute("data-dimmed", "true");
      }
    });

    it("控えの艦を選ぶと、すべての列に「ここに置く（特効あり）」／「ここに置く（特効なし）」を出し、特効のない札の列を薄くする", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行：利根改二（連合艦隊・ウルシー攻撃部隊で効く）
      await user.click(getCard(getTray(), "利根改二"));

      // 検証
      for (const name of ["連合艦隊", "ウルシー攻撃部隊"]) {
        const column = getColumn(name);
        expect(within(column).getByRole("button", { name: "ここに置く（特効あり）" })).toBeInTheDocument();
        expect(column).not.toHaveAttribute("data-dimmed", "true");
      }
      for (const name of ["第三十一戦隊", "多号作戦部隊", "第六艦隊"]) {
        const column = getColumn(name);
        expect(within(column).getByRole("button", { name: "ここに置く（特効なし）" })).toBeInTheDocument();
        expect(column).toHaveAttribute("data-dimmed", "true");
      }
    });

    it("特効のない艦を選ぶと、すべての列が「ここに置く（特効なし）」で薄くなる", async () => {
      // 準備：「リセット」で特効のない艦も出す
      const { user } = renderAssignScreen();
      await pressReset(user);

      // 実行
      await user.click(getCard(getTray(), "あきつ丸改"));

      // 検証
      for (const name of FUDA_NAMES) {
        const column = getColumn(name);
        expect(within(column).getByRole("button", { name: "ここに置く（特効なし）" })).toBeInTheDocument();
        expect(column).toHaveAttribute("data-dimmed", "true");
      }
    });

    it("札に置いた艦を選ぶと、その艦がいる列には「ここに置く」を出さない（ほかの列には出す）", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行：連合艦隊の時雨改二
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 検証
      expect(queryPlaceButton(getColumn("連合艦隊"))).toBeNull();
      expect(
        within(getColumn("ウルシー攻撃部隊")).getByRole("button", { name: "ここに置く（特効あり）" }),
      ).toBeInTheDocument();
      for (const name of ["第三十一戦隊", "多号作戦部隊", "第六艦隊"]) {
        expect(within(getColumn(name)).getByRole("button", { name: "ここに置く（特効なし）" })).toBeInTheDocument();
      }
    });

    it.each([
      ["涼風改二（どの札でも効かない）", "第三十一戦隊", "涼風改二", ["多号作戦部隊", "連合艦隊", "ウルシー攻撃部隊", "第六艦隊"]],
      ["速吸改（ウルシー攻撃部隊だけで効く）", "連合艦隊", "速吸改", ["第三十一戦隊", "多号作戦部隊", "第六艦隊"]],
    ])(
      "選んだ艦が今いる列は、その札で特効がなくても薄くしない（%s。ほかの特効のない札の列は薄くする）",
      async (_label, here, shipName, dimmedNames) => {
        // 準備：速吸改は連合艦隊に置いておく
        const { user } = renderAssignScreen({ assignments: { ...summer2026Assignments, hayasui: "rengo" } });

        // 実行
        await user.click(getCard(getColumn(here), shipName));

        // 検証
        expect(getColumn(here)).not.toHaveAttribute("data-dimmed", "true");
        expect(queryPlaceButton(getColumn(here))).toBeNull();
        for (const name of dimmedNames) {
          expect(getColumn(name), name).toHaveAttribute("data-dimmed", "true");
        }
      },
    );
  });

  describe("選択中の艦のパネル", () => {
    it("艦を選んでいないときはパネルを出さない", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証：画面（控え）が出ていることを確かめてから、パネルがないことを見る
      expect(getTray()).toBeInTheDocument();
      expect(queryPanel()).not.toBeInTheDocument();
    });

    it("控えの艦を選ぶと、艦名・「艦種 ・ Lv ・ いま：控え」・効く札ごとのブロック（スコアの高い順。札名・スコア・段階の倍率・「（札名）に置く」）・「特効なし：（札名）」を出す", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.click(getCard(getTray(), "利根改二"));

      // 検証
      const panel = getPanel();
      expect(within(panel).getByText("利根改二")).toBeInTheDocument();
      expect(panel).toHaveTextContent(/航巡\s*・\s*Lv\s*150\s*・\s*いま：\s*控え/);
      expect(panel).toHaveTextContent("この艦の特効（効く札の順）");
      expect(panel).toHaveTextContent(
        /連合艦隊\s*\+82.*E2 ゲージ2\s*×1\.14.*E2 ゲージ3\s*×1\.18.*連合艦隊に置く.*ウルシー攻撃部隊\s*\+24.*E3 ゲージ4\s*×1\.08.*ウルシー攻撃部隊に置く/,
      );
      expect(within(panel).getByRole("button", { name: "連合艦隊に置く" })).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "ウルシー攻撃部隊に置く" })).toBeInTheDocument();
      // 特効がない札にはブロックも「に置く」も作らず、最後に 1 行にまとめる（定義の札の順）
      expect(within(panel).queryByRole("button", { name: "第三十一戦隊に置く" })).not.toBeInTheDocument();
      expect(panel).toHaveTextContent(/特効なし：\s*第三十一戦隊、多号作戦部隊、第六艦隊/);
      expect(within(panel).getByRole("button", { name: "選択をやめる" })).toBeInTheDocument();
    });

    it("札に置いた艦を選ぶと「いま：（札名）」を出し、その札のブロックはボタンの代わりに「いまこの札にいます」と出す", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 検証
      const panel = getPanel();
      expect(panel).toHaveTextContent(/駆逐\s*・\s*Lv\s*98\s*・\s*いま：\s*連合艦隊/);
      expect(panel).toHaveTextContent(/連合艦隊\s*\+110.*いまこの札にいます.*ウルシー攻撃部隊\s*\+56/);
      expect(within(panel).queryByRole("button", { name: "連合艦隊に置く" })).not.toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: "ウルシー攻撃部隊に置く" })).toBeInTheDocument();
    });

    it("特効のない艦を選ぶと、ブロックも「に置く」も出さず「特効なし：」にすべての札を並べる", async () => {
      // 準備：「リセット」で特効のない艦も出す
      const { user } = renderAssignScreen();
      await pressReset(user);

      // 実行
      await user.click(getCard(getTray(), "あきつ丸改"));

      // 検証
      const panel = getPanel();
      expect(panel).toHaveTextContent(/特効なし：\s*第三十一戦隊、多号作戦部隊、連合艦隊、ウルシー攻撃部隊、第六艦隊/);
      expect(within(panel).queryAllByRole("button", { name: /に置く$/ })).toHaveLength(0);
    });

    it("「×」（選択をやめる）でパネルを閉じ、選択を外す。開いたカードは開いたまま", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getPanel()).getByRole("button", { name: "選択をやめる" }));

      // 検証
      expect(queryPanel()).not.toBeInTheDocument();
      const card = getCard(getTray(), "利根改二");
      expect(card).toHaveAttribute("aria-pressed", "false");
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(queryPlaceButton(getColumn("連合艦隊"))).toBeNull();
    });
  });

  describe("選択と開閉、「特効を表示中」の帯", () => {
    it("初めは「特効を表示中」の帯と「すべて閉じる」を出さない", () => {
      // 準備・実行
      renderAssignScreen();

      // 検証
      expect(queryOpenBand()).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "すべて閉じる" })).not.toBeInTheDocument();
    });

    it("艦を選ぶと、控えの艦の一覧の上に「特効を表示中：1隻」の帯と「すべて閉じる」を出す", async () => {
      // 準備
      const { user } = renderAssignScreen();

      // 実行
      await user.click(getCard(getTray(), "利根改二"));

      // 検証：帯は最初の区切り（伊勢型）より上
      expect(getOpenBand()).toHaveTextContent(/特効を表示中：\s*1\s*隻/);
      expect(within(getTray()).getByRole("button", { name: "すべて閉じる" })).toBeInTheDocument();
      expectInDocumentOrder([getOpenBand(), getGroupHeader("伊勢型")]);
    });

    it("同じ艦をもう一度押すと、選択を外して閉じる（パネルと帯も消える）", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(getCard(getTray(), "利根改二"));

      // 検証
      const card = getCard(getTray(), "利根改二");
      expect(card).toHaveAttribute("aria-pressed", "false");
      expect(card).toHaveAttribute("aria-expanded", "false");
      expect(card).not.toHaveTextContent(MULTIPLIER);
      expect(queryPanel()).not.toBeInTheDocument();
      expect(queryOpenBand()).not.toBeInTheDocument();
    });

    it("別の艦を選んでも前に開いた艦は閉じず（選択だけが移る）、帯の隻数が増える", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 検証
      const tone = getCard(getTray(), "利根改二");
      expect(tone).toHaveAttribute("aria-pressed", "false");
      expect(tone).toHaveAttribute("aria-expanded", "true");
      const shigure2 = getCard(getColumn("連合艦隊"), "時雨改二");
      expect(shigure2).toHaveAttribute("aria-pressed", "true");
      expect(shigure2).toHaveAttribute("aria-expanded", "true");
      expect(getOpenBand()).toHaveTextContent(/特効を表示中：\s*2\s*隻/);
      expect(within(getPanel()).getByText("時雨改二")).toBeInTheDocument();
    });

    it("「すべて閉じる」で開いたカードをすべて閉じ、選択も外す（パネルと帯も消える）", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 実行
      await user.click(within(getTray()).getByRole("button", { name: "すべて閉じる" }));

      // 検証
      for (const card of [getCard(getTray(), "利根改二"), getCard(getColumn("連合艦隊"), "時雨改二")]) {
        expect(card).toHaveAttribute("aria-pressed", "false");
        expect(card).toHaveAttribute("aria-expanded", "false");
      }
      expect(queryPanel()).not.toBeInTheDocument();
      expect(queryOpenBand()).not.toBeInTheDocument();
    });
  });

  describe("置く", () => {
    it("「ここに置く」で選んだ艦をその札へ移し（控えから消え、列の隻数が増える）、選択を外し、割り当てを保存する", async () => {
      // 準備
      const { user, save } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

      // 検証：移った
      const rengo = getColumn("連合艦隊");
      expect(getCard(rengo, "利根改二")).toBeInTheDocument();
      expect(rengo).toHaveTextContent(shipCountPattern(9));
      expect(queryCard(getTray(), "利根改二")).toBeNull();
      expect(getTray()).toHaveTextContent(trayCountPattern(10, 11));
      // 選択が外れた（パネルも「ここに置く」も消える）
      expect(getCard(rengo, "利根改二")).toHaveAttribute("aria-pressed", "false");
      expect(queryPanel()).not.toBeInTheDocument();
      expect(screen.queryAllByRole("button", { name: /^ここに置く/ })).toHaveLength(0);
      // 保存した
      expect(save).toHaveBeenLastCalledWith(EVENT_ID, { ...summer2026Assignments, tone: "rengo" });
    });

    it("置いた艦のカードは閉じ、押して開き直すと、移った札の段階の倍率だけを並べる", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行：置く（カードは閉じる）→ 移った札の列のカードを押して開く
      await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));
      expect(getCard(getColumn("連合艦隊"), "利根改二")).toHaveAttribute("aria-expanded", "false");
      await user.click(getCard(getColumn("連合艦隊"), "利根改二"));

      // 検証
      const card = getCard(getColumn("連合艦隊"), "利根改二");
      expect(card).toHaveAttribute("aria-expanded", "true");
      expect(card).toHaveTextContent(/E2 ゲージ2\s*×1\.14.*E2 ゲージ3\s*×1\.18/);
      expect(card).not.toHaveTextContent("E3 ゲージ4");
      expect(getOpenBand()).toHaveTextContent(/特効を表示中：\s*1\s*隻/);
    });

    it("パネルの「（札名）に置く」でその札へ移し、割り当てを保存する", async () => {
      // 準備
      const { user, save } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

      // 検証
      expect(getCard(getColumn("ウルシー攻撃部隊"), "利根改二")).toBeInTheDocument();
      expect(getColumn("ウルシー攻撃部隊")).toHaveTextContent(shipCountPattern(4));
      expect(queryPanel()).not.toBeInTheDocument();
      expect(save).toHaveBeenLastCalledWith(EVENT_ID, { ...summer2026Assignments, tone: "ulithi" });
    });

    it("札に置いた艦を別の札の「ここに置く」で移せる（元の列から消える）", async () => {
      // 準備
      const { user, save } = renderAssignScreen();
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 実行
      await user.click(within(getColumn("ウルシー攻撃部隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

      // 検証
      expect(queryCard(getColumn("連合艦隊"), "時雨改二")).toBeNull();
      expect(getColumn("連合艦隊")).toHaveTextContent(shipCountPattern(7));
      expect(getCard(getColumn("ウルシー攻撃部隊"), "時雨改二")).toBeInTheDocument();
      expect(getColumn("ウルシー攻撃部隊")).toHaveTextContent(shipCountPattern(4));
      expect(save).toHaveBeenLastCalledWith(EVENT_ID, { ...summer2026Assignments, shigure2: "ulithi" });
    });

    it("選んだり閉じたりするだけでは保存しない", async () => {
      // 準備
      const { user, save } = renderAssignScreen();

      // 実行
      await user.click(getCard(getTray(), "利根改二"));
      await user.click(within(getTray()).getByRole("button", { name: "すべて閉じる" }));

      // 検証
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe("置いた後・閉じた後のフォーカス（レビュー提案 3。押したボタンが消えても、フォーカスを document.body に落とさない）", () => {
    /** 今フォーカスのある要素を短く書く（失敗したときに画面全体を書き出さないため） */
    function describeFocus(): string {
      const focused = document.activeElement;
      if (focused === null || focused === document.body) return "document.body";
      const label = focused.getAttribute("aria-label") ?? focused.textContent ?? "";
      return `${focused.tagName.toLowerCase()}「${label.trim().slice(0, 40)}」`;
    }

    /** フォーカスが card にあり、document.body に落ちていないことを確かめる（移す処理が描いた後でもよいように待つ） */
    async function expectFocusOn(findCard: () => HTMLElement): Promise<void> {
      await waitFor(() => {
        const card = findCard();
        const name = (card.textContent ?? "").trim().slice(0, 20);
        expect(document.activeElement === card, `「${name}」のカードにフォーカスがあること（今のフォーカス：${describeFocus()}）`).toBe(true);
      });
      expect(document.activeElement).not.toBe(document.body);
    }

    it("控えの艦を「ここに置く」で置いた後は、移った艦のカード（札の列の中）にフォーカスがある", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

      // 検証
      await expectFocusOn(() => getCard(getColumn("連合艦隊"), "利根改二"));
    });

    it("パネルの「（札名）に置く」で置いた後は、移った艦のカード（札の列の中）にフォーカスがある", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

      // 検証
      await expectFocusOn(() => getCard(getColumn("ウルシー攻撃部隊"), "利根改二"));
    });

    it("札に置いた艦を別の札の「ここに置く」で移した後は、移った先の列のカードにフォーカスがある", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 実行
      await user.click(within(getColumn("ウルシー攻撃部隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

      // 検証
      await expectFocusOn(() => getCard(getColumn("ウルシー攻撃部隊"), "時雨改二"));
    });

    it("パネルの「選択をやめる」（×）の後は、選んでいた艦のカード（控え）にフォーカスが戻る", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getPanel()).getByRole("button", { name: "選択をやめる" }));

      // 検証
      expect(queryPanel()).not.toBeInTheDocument();
      await expectFocusOn(() => getCard(getTray(), "利根改二"));
    });

    it("パネルの「選択をやめる」（×）の後は、選んでいた艦のカード（札の列）にフォーカスが戻る", async () => {
      // 準備
      const { user } = renderAssignScreen();
      await user.click(getCard(getColumn("連合艦隊"), "時雨改二"));

      // 実行
      await user.click(within(getPanel()).getByRole("button", { name: "選択をやめる" }));

      // 検証
      await expectFocusOn(() => getCard(getColumn("連合艦隊"), "時雨改二"));
    });
  });

  describe("元に戻す（U22）", () => {
    it("置いた後は押せるようになり、押すと直前の変更が戻り（控えに戻る）、戻した割り当てを保存し、戻すものがなくなると押せない", async () => {
      // 準備
      const { user, save } = renderAssignScreen();
      await user.click(getCard(getTray(), "利根改二"));
      await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));
      expect(getUndoButton()).toBeEnabled();

      // 実行
      await user.click(getUndoButton());

      // 検証
      expect(getCard(getTray(), "利根改二")).toBeInTheDocument();
      expect(queryCard(getColumn("連合艦隊"), "利根改二")).toBeNull();
      expect(getColumn("連合艦隊")).toHaveTextContent(shipCountPattern(8));
      expect(getTray()).toHaveTextContent(trayCountPattern(11, 12));
      expect(save).toHaveBeenLastCalledWith(EVENT_ID, summer2026Assignments);
      expect(getUndoButton()).toBeDisabled();
    });

    it("20 手まで戻せる（21 手動かしても、戻せるのは直近の 20 手）", { timeout: 20_000 }, async () => {
      // 準備：利根改二だけを控えに置いた画面で、連合艦隊とウルシー攻撃部隊の間を 21 回動かす
      // （1 手目で連合艦隊、2 手目でウルシー攻撃部隊、…、21 手目で連合艦隊）
      const { user, save } = renderAssignScreen({ ships: [shipByUid("tone")], assignments: {} });
      for (let move = 1; move <= 21; move += 1) {
        await user.click(getCardAnywhere("利根改二"));
        const target = move % 2 === 1 ? "連合艦隊に置く" : "ウルシー攻撃部隊に置く";
        await user.click(within(getPanel()).getByRole("button", { name: target }));
      }

      // 実行：19 回戻す
      for (let undo = 1; undo <= 19; undo += 1) {
        await user.click(getUndoButton());
      }

      // 検証：まだ戻せる
      expect(getUndoButton()).toBeEnabled();

      // 実行：20 回目
      await user.click(getUndoButton());

      // 検証：20 手戻すと押せなくなり、1 手目の後（連合艦隊）で止まる（控えには戻らない）
      expect(getUndoButton()).toBeDisabled();
      expect(getCard(getColumn("連合艦隊"), "利根改二")).toBeInTheDocument();
      expect(save).toHaveBeenLastCalledWith(EVENT_ID, { tone: "rengo" });
    });
  });

  describe("お知らせ", () => {
    it("定義から消えた札の割り当てを控えに戻していたら（U17）、その件数を控えの一覧より上に知らせる", () => {
      // 準備・実行
      renderAssignScreen({ returnedCount: 2 });

      // 検証
      const notice = screen.getByText(/控えに戻しました/);
      expect(notice).toHaveTextContent(/(?<!\d)2\s*件/);
      expectInDocumentOrder([notice, getSearchBox()]);
    });

    it("控えに戻した割り当てがなければ（0 件）知らせない", () => {
      // 準備・実行
      renderAssignScreen({ returnedCount: 0 });

      // 検証
      expect(getTray()).toBeInTheDocument();
      expect(screen.queryByText(/控えに戻しました/)).not.toBeInTheDocument();
    });

    it("保存に失敗したら「保存できませんでした」と理由（保存の関数のエラーの文）を出し、画面の割り当ては変えたまま", async () => {
      // 準備：1 回目の保存だけ失敗させる
      const save = vi.fn<SaveAssignments>(() => Promise.resolve());
      save.mockRejectedValueOnce(new Error("QuotaExceededError"));
      const { user } = renderAssignScreen({ save });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await user.click(getCard(getTray(), "利根改二"));

      // 実行
      await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));

      // 検証
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("保存できませんでした");
      expect(alert).toHaveTextContent("QuotaExceededError");
      expect(getCard(getColumn("連合艦隊"), "利根改二")).toBeInTheDocument();
    });

    it("保存に失敗した後、次の保存が成功したら「保存できませんでした」を消す", async () => {
      // 準備：1 回目の保存だけ失敗させ、失敗の知らせが出るまで進める
      const save = vi.fn<SaveAssignments>(() => Promise.resolve());
      save.mockRejectedValueOnce(new Error("QuotaExceededError"));
      const { user } = renderAssignScreen({ save });
      await user.click(getCard(getTray(), "利根改二"));
      await user.click(within(getColumn("連合艦隊")).getByRole("button", { name: "ここに置く（特効あり）" }));
      await screen.findByRole("alert");

      // 実行：もう一度動かす（ウルシー攻撃部隊へ）
      await user.click(getCard(getColumn("連合艦隊"), "利根改二"));
      await user.click(within(getPanel()).getByRole("button", { name: "ウルシー攻撃部隊に置く" }));

      // 検証
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(save).toHaveBeenCalledTimes(2);
    });
  });

  it("画面のどこにも同じ艦のカードを 2 つ出さない（控えと札の列で重ならない）", () => {
    // 準備・実行
    renderAssignScreen();

    // 検証：控えの利根改二・札の列の時雨改二は、画面全体で 1 つずつ
    expect(findCards(document.body, "利根改二")).toHaveLength(1);
    expect(findCards(document.body, "時雨改二")).toHaveLength(1);
  });
});

// PR #45 の独立レビュー：ヘッダー帯の下に重なった要素にフォーカスが移ったとき、ページのスクロールでヘッダー帯の下まで見せる（WCAG 2.4.11）
describe("割り振り画面：ページのスクロールの scroll-padding-top", () => {
  it("画面を出している間は <html> に、ヘッダー帯の高さ＋間の分の scroll-padding-top を付け、画面を離れたら外す", () => {
    // 準備・実行
    const { unmount } = renderAssignScreen();

    // 検証：CSS を読まないテストの環境では既定の値（ヘッダー帯 51px＋間 12px。jsdom は calc を 63px にまとめる）
    expect(document.documentElement.style.scrollPaddingTop).toMatch(/^calc\((51px \+ 12px|63px)\)$/);

    // 実行：画面を離れる
    unmount();

    // 検証
    expect(document.documentElement.style.scrollPaddingTop).toBe("");
  });
});
