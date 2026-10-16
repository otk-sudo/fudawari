// ブラウザ内の保存（IndexedDB。Dexie）の型（roadmap T2-2、要件 5 章、U9・U17・U21）
//
// 一般利用者の艦娘データ・割り当て・設定は、このブラウザの中だけに保存し、サーバーには送らない。
import type { ImportFilter } from "@/domain/import/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { ThemeMode } from "@/features/theme";
import type { ReturnOrphanedAssignmentsResult } from "@/domain/plan/orphan";

/** 取り込みを保存するときに渡すもの */
export interface SaveImportInput {
  /** 取り込んだ個体の一覧（parseImportText の ships） */
  ships: readonly OwnedShip[];
  /** 取り込んだ日時（ISO 8601。例 new Date().toISOString()） */
  importedAt: string;
  /** 取り込みの条件（取り込む範囲） */
  filter: ImportFilter;
  /** 個体 ID があるか（parseImportText の hasUid）。false のときは割り当てを引き継がない（U9） */
  hasUid: boolean;
}

/** 保存した取り込みの情報（最終取り込み。ホームと設定の「最終取り込み（日時） ／ n 隻」に使う） */
export interface ImportRecord {
  /** 取り込んだ日時（ISO 8601） */
  importedAt: string;
  /** 取り込みの条件 */
  filter: ImportFilter;
  /** 取り込んだ隻数（保存した個体の数） */
  shipCount: number;
  /** 個体 ID があったか */
  hasUid: boolean;
}

/** 文字の大きさ：小／標準／大（値はモック SettingsDialog.dc.html に合わせた） */
export type FontSize = "small" | "mid" | "large";

/** 控えの表示：一行／カード */
export type TrayView = "dense" | "card";

/** 控えの並び順：艦型／Lv／特効の強さ／名前 */
export type TraySort = "class" | "lv" | "boost" | "name";

/**
 * 設定（要件 3.6 の「表示」）。保存していない項目は初期値になる。
 * 初期値はモック（SettingsDialog.dc.html）どおり：ダーク・標準・一行・艦型
 */
export interface Settings {
  /** 画面モード */
  themeMode: ThemeMode;
  /** 文字の大きさ */
  fontSize: FontSize;
  /** 控えの表示 */
  trayView: TrayView;
  /** 控えの並び順 */
  traySort: TraySort;
}

/** ブラウザ内の保存の入口。openStorage（storage.ts）で開く */
export interface FudawariStorage {
  /**
   * 取り込みを保存する。個体の一覧は置き換え（前の取り込みにしかない個体は残さない）、取り込みの情報（最終取り込み）を記録する。
   * 個体の一覧・取り込みの情報・割り当ての整理は 1 つのトランザクションで行う（途中で失敗したら何も変わらない）。
   * - hasUid が true：今回の取り込みにいる個体の割り当ては残す（同じ個体 ID の割り当てを引き継ぐ。U9）。
   *   今回の取り込みにいない個体（解体した艦や、取り込む範囲から外れた艦）の割り当ては、すべてのイベントで外す
   * - hasUid が false（個体 ID がない古い形式）：引き継げないため、すべてのイベントの割り当てを消す
   *   （前に同じ個体 ID の割り当てがあっても、控えから始まる）
   * - 同じ個体 ID が複数あるときは、先の個体だけを保存する
   */
  saveImport(input: SaveImportInput): Promise<void>;
  /** 保存した個体の一覧（取り込んでいなければ空） */
  loadShips(): Promise<OwnedShip[]>;
  /** 最終取り込みの情報（取り込んでいない・削除した後は null） */
  loadLastImport(): Promise<ImportRecord | null>;
  /** 「取り込んだ艦娘データを削除」：個体と取り込みの情報を消す。割り当て（札割り）は残す */
  clearImportedShips(): Promise<void>;
  /** イベントの割り当て（保存していないイベントは空。新しいイベントは空から始まる。U17） */
  loadAssignments(eventId: string): Promise<AssignmentMap>;
  /** イベントの割り当てを丸ごと置き換えて保存する（キーを除いた個体は控えに戻る） */
  saveAssignments(eventId: string, assignments: AssignmentMap): Promise<void>;
  /**
   * 今の定義の札 ID の一覧にない札の割り当てを控えに戻して保存し、残った割り当てと戻した件数を返す（U17）。
   * ほかのイベントの割り当てには触らない
   */
  returnOrphanedAssignments(eventId: string, fudaIds: readonly string[]): Promise<ReturnOrphanedAssignmentsResult>;
  /** 設定（保存していない項目は初期値） */
  loadSettings(): Promise<Settings>;
  /** 設定の一部を保存し、保存後の設定全体を返す */
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  /** DB を閉じる（テストの後片付けなど） */
  close(): void;
}
