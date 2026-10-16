"use client";

// 割り振り画面の中身（roadmap T2-7、要件 3.3、モック Assign.dc.html・ShipCard.dc.html）
//
// いまは画面テスト（AssignScreen.test.tsx、src/app/assign/page.test.tsx）を先に書くための空の入れ物で、何も描かない。
// 中身（ヘッダー・控え・艦カード・札の列・選択中の艦のパネル・お知らせ）は実装の担当が作る。
// テストが探す形（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
//
// 読み込み（公開定義・艦船マスタ・札割りのデータ・設定）と、読み込み中・失敗・未取り込みの表示はページ（src/app/assign/page.tsx）が受け持ち、
// すべて読めて艦が 1 隻以上あるときに、この部品を描く想定。
import type { ReactNode } from "react";
import type { PublicDefinition } from "@/domain/definition/types";
import type { ShipMaster } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { SaveAssignments } from "./assign-store";
import type { TrayOptionsInit } from "./tray";

/** 割り振り画面の中身に渡すもの */
export interface AssignScreenProps {
  /** 最新イベントの公開定義（札・段階・特効、イベント名、特効データの版の日付） */
  definition: PublicDefinition;
  /** 艦船マスタ（艦名・艦種・艦型・改造状態・図鑑番号） */
  master: ShipMaster;
  /** 取り込んだ艦の個体（控えと札の列に出す） */
  ships: readonly OwnedShip[];
  /**
   * 初めの割り当て（保存から読んだもの。定義から消えた札の割り当ては控えに戻した後のもの）。
   * 画面を開いている間の割り当ては画面の中（createAssignStore）で持つ
   */
  initialAssignments: AssignmentMap;
  /**
   * 割り当てが変わるたびに呼ぶ保存の関数（createAssignStore に渡す。イベント ID は definition.event.id）。
   * 失敗したら理由の文をメッセージに持つエラーで reject する（画面は「保存できませんでした」と理由を出す）
   */
  save: SaveAssignments;
  /** 読み込みのときに控えに戻した割り当ての件数（U17。0 なら知らせない） */
  returnedCount: number;
  /** 控えの並び順・表示（一行／カード）の初期値（設定の traySort・trayView）。省略すると艦型・一行 */
  trayInit?: TrayOptionsInit;
}

/** 割り振り画面の中身（いまは空の入れ物。何も描かない） */
export const AssignScreen: (props: AssignScreenProps) => ReactNode = () => null;
