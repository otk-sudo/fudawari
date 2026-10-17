// 画像で保存で出力する画像（ExportImage。要件 3.9、モック ExportImage.dc.html、roadmap T2-10、U4・U15）のテスト
//
// 画像（1600×900 の PNG）にする前の DOM の中身を確かめる。PNG にする処理（フォントを待つ・modern-screenshot）と
// 枚数の分け方は ExportImageDialog.test.tsx と pages.test.ts で確かめる。
// 部品の探し方は src/test/list-screen.ts の冒頭にまとめてある。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicDefinition } from "@/domain/definition";
import { createShipMaster } from "@/domain/master";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import { ExportImage } from "@/features/export-image/ExportImage";
import { APP_NAME } from "@/lib/app-name";
import { expectInDocumentOrder } from "@/test/dom-order";
import { summer2026Assignments, summer2026Definition, summer2026MasterEntries, summer2026Ships } from "@/test/fixtures";
import { definitionWithEightFudas, eightFudaAssignments, manyShipsOnRengo } from "@/test/list-export";
import {
  fudaRegionNames,
  getAreaRow,
  getAreaSteps,
  getFudaRegion,
  getShipItem,
  getStep,
  levelOf,
  overflowCountOf,
  shipCountPattern,
  shipItems,
  shipNamesIn,
} from "@/test/list-screen";

// ---- 準備 ----

const master = createShipMaster(summer2026MasterEntries);

/** 画像のテスト用データの札（艦がいる 5 札。定義の順） */
const ALL_FUDA_IDS = ["s31", "tago", "rengo", "ulithi", "sixth"];

/** 画像 1 枚を描き、その入れ物を返す（省略した値はテスト用データの 1 枚目・1 枚だけ） */
function renderImage(
  options: {
    definition?: PublicDefinition;
    ships?: readonly OwnedShip[];
    assignments?: AssignmentMap;
    fudaIds?: readonly string[];
    page?: number;
    pageCount?: number;
  } = {},
): HTMLElement {
  const { container } = render(
    <ExportImage
      definition={options.definition ?? summer2026Definition}
      master={master}
      ships={options.ships ?? summer2026Ships}
      assignments={options.assignments ?? summer2026Assignments}
      fudaIds={options.fudaIds ?? ALL_FUDA_IDS}
      page={options.page ?? 1}
      pageCount={options.pageCount ?? 1}
    />,
  );
  return container;
}

/** 「1 / 2」のような何枚目かの表示 */
const PAGE_LABEL = /\d+\s*\/\s*\d+/;

// ---- テスト ----

describe("出力する画像（ExportImage）", () => {
  describe("上部", () => {
    it("イベント名（定義のイベント名）と「札割り」を出し、1 枚だけのときは「n / m」を出さない", () => {
      // 準備・実行
      const image = renderImage();

      // 検証
      expect(screen.getByText("2026夏イベ")).toBeInTheDocument();
      expect(screen.getByText("札割り")).toBeInTheDocument();
      expect(image).not.toHaveTextContent(PAGE_LABEL);
    });

    it("複数枚のときは「n / m」（例「2 / 2」）を出す", () => {
      // 準備・実行
      const image = renderImage({
        definition: definitionWithEightFudas(),
        assignments: eightFudaAssignments,
        fudaIds: ["frmed", "eurocomb"],
        page: 2,
        pageCount: 2,
      });

      // 検証
      expect(image).toHaveTextContent(/2\s*\/\s*2/);
    });
  });

  describe("攻略の流れ", () => {
    it("この画像の札に関係なく全海域・全段階を入れ、段階ごとに札名と段階名を札の色で出す", () => {
      // 準備・実行：第六艦隊だけの画像
      const image = renderImage({ fudaIds: ["sixth"] });

      // 検証
      expectInDocumentOrder([getAreaRow(image, "E1"), getAreaRow(image, "E2"), getAreaRow(image, "E3")]);
      expect(getAreaSteps(image, "E1")).toHaveLength(1);
      expect(getAreaSteps(image, "E2")).toHaveLength(4);
      expect(getAreaSteps(image, "E3")).toHaveLength(5);
      const e2Gauge3 = getStep(image, "E2", "ゲージ3", "連合艦隊");
      expect(e2Gauge3).toHaveAttribute("data-fuda-color", "#4C8DF6");
      expect(getStep(image, "E1", "ギミック〜ゲージ3", "第三十一戦隊")).toHaveAttribute("data-fuda-color", "#8B93A1");
    });
  });

  describe("札ごとの列", () => {
    it("渡した札の順に列を並べ（渡していない札の列は作らない）、列に札の色・札名・「n隻」を出す", () => {
      // 準備・実行
      const image = renderImage({ fudaIds: ["rengo", "s31"] });

      // 検証
      expect(fudaRegionNames(image)).toEqual(["連合艦隊", "第三十一戦隊"]);
      const rengo = getFudaRegion(image, "連合艦隊");
      expect(rengo).toHaveAttribute("data-fuda-color", "#4C8DF6");
      expect(rengo).toHaveTextContent(shipCountPattern(8));
      expect(getFudaRegion(image, "第三十一戦隊")).toHaveTextContent(shipCountPattern(4));
    });

    it("艦は Lv の高い順に、艦名・Lv・運と、その札で特効があれば「特効」、なければ「－」を出す", () => {
      // 準備・実行
      const image = renderImage({ fudaIds: ["s31"] });

      // 検証
      const s31 = getFudaRegion(image, "第三十一戦隊");
      expect(shipNamesIn(s31)).toEqual(["五十鈴改二", "初霜改二", "冬月改", "涼風改二"]);
      const isuzu = getShipItem(s31, "五十鈴改二");
      expect(isuzu).toHaveTextContent(/Lv\s*140/);
      expect(isuzu).toHaveTextContent(/運\s*24/);
      expect(isuzu).toHaveTextContent("特効");
      const suzukaze = getShipItem(s31, "涼風改二");
      expect(suzukaze).not.toHaveTextContent("特効");
      expect(suzukaze).toHaveTextContent(/[－–-]/);
    });

    it("艦に載せるのは Lv・運・特効あり／なしだけ（倍率「×1.27」などは載せない）", () => {
      // 準備・実行
      const image = renderImage();

      // 検証：倍率が 1 より大きい艦（潮改二 ×1.27）も「特効」だけを出す
      expect(getShipItem(getFudaRegion(image, "連合艦隊"), "潮改二")).toHaveTextContent("特効");
      expect(image).not.toHaveTextContent(/×\s*\d/);
      expect(image).not.toHaveTextContent(/サブ/);
    });

    it("列に入らない隻数の艦は、Lv の高い艦から入るだけ載せ、残りを「ほか n 隻」と書く（U15）。列の「n隻」は全隻数", () => {
      // 準備：連合艦隊に 40 隻（Lv 100〜139。どの大きさでも 900px の高さに入らない数）
      const many = manyShipsOnRengo(40);

      // 実行
      const image = renderImage({ ships: many.ships, assignments: many.assignments, fudaIds: ["rengo"] });

      // 検証
      const rengo = getFudaRegion(image, "連合艦隊");
      expect(rengo).toHaveTextContent(shipCountPattern(40));
      const rows = shipItems(rengo);
      const rest = overflowCountOf(rengo);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(40);
      expect(rest, "「ほか n 隻」があること").not.toBeNull();
      expect(rows.length + (rest ?? 0)).toBe(40);
      // 載せたのは Lv の高い方から順に（139, 138, …）
      expect(rows.map(levelOf)).toEqual(Array.from({ length: rows.length }, (_, i) => 139 - i));
    });

    it("列に入る隻数なら、すべて載せて「ほか n 隻」を書かない", () => {
      // 準備・実行
      const image = renderImage({ fudaIds: ["rengo", "s31"] });

      // 検証
      expect(shipItems(getFudaRegion(image, "連合艦隊"))).toHaveLength(8);
      expect(shipItems(getFudaRegion(image, "第三十一戦隊"))).toHaveLength(4);
      expect(overflowCountOf(image)).toBeNull();
    });
  });

  describe("下部", () => {
    it("「札」のロゴ、ツール名「札割りプランナー」（U4。モックの旧名「札割り振りプランナー」ではない）と凡例を出す", () => {
      // 準備・実行
      const image = renderImage();

      // 検証
      expect(screen.getByText(APP_NAME)).toBeInTheDocument();
      expect(image).not.toHaveTextContent("札割り振りプランナー");
      expect(screen.getByText("札")).toBeInTheDocument();
      expect(image).toHaveTextContent("その札で特効あり");
      expect(image).toHaveTextContent("特効なし");
    });
  });
});
