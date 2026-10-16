// 札割りのデータ（取り込んだ艦・最終取り込み・最新イベントの割り当て）の型（roadmap T2-2・T2-5、要件 5 章、U9・U17）
//
// 一般向けの画面（割り振り・一覧・差分・取り込み・ホーム）が共有する。
// 中身はブラウザ内の保存（src/lib/storage の FudawariStorage）から読み、割り当ての変更をそこへ保存する。サーバーには送らない。
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip } from "@/domain/ship/types";
import type { ImportRecord } from "@/lib/storage";

/** 札割りのデータの読み書きの失敗 */
export interface PlanDataError {
  /**
   * 何をしていて失敗したか
   * - "load"：読み込み（ブラウザ内の保存〔IndexedDB〕を開けない・読めないときを含む）
   * - "save"：割り当ての保存
   */
  operation: "load" | "save";
  /** 画面に出す理由の文（日本語。空でない） */
  message: string;
}

/** 札割りのデータの状態 */
export type PlanDataState =
  /** 読み込む対象のイベントがない（イベント ID が null：定義の読み込み中・失敗）。保存先は読まない */
  | { status: "idle" }
  /** 読み込み中 */
  | { status: "loading" }
  /** 準備完了 */
  | {
      status: "ready";
      /** 読み込んだイベントの ID（割り当ての保存先） */
      eventId: string;
      /** 取り込んだ艦の個体（取り込んでいなければ空） */
      ships: readonly OwnedShip[];
      /** 最終取り込み（取り込んでいない・削除した後は null） */
      lastImport: ImportRecord | null;
      /** このイベントの割り当て（個体 ID → 札 ID。キーがない個体は控え） */
      assignments: AssignmentMap;
      /**
       * 控えに戻した割り当ての数（今の定義の札 ID にない札に置かれていた個体。U17）。
       * 同じイベントの間は読み込み・読み直しのたびに足していき、acknowledgeReturned で 0 に戻す。
       * 別のイベントを読み込むと 0 から数え直す。0 なら知らせることはない
       */
      returnedCount: number;
      /** 直近の割り当ての保存の失敗（なければ null。次の保存が成功すると null に戻る） */
      saveError: PlanDataError | null;
    }
  /** 読み込みの失敗（理由つき） */
  | { status: "error"; error: PlanDataError };

/**
 * setAssignments に渡すもの：新しい割り当てそのもの、または今の割り当てから新しい割り当てを作る関数。
 * 関数は、その時点のストアの割り当て（同じイベント処理の中で前に変えた分を含む）を受け取る
 */
export type AssignmentUpdate = AssignmentMap | ((prev: AssignmentMap) => AssignmentMap);

/** 画面から使う操作。どれも例外を投げない（失敗は状態に入れる） */
export interface PlanDataActions {
  /**
   * 割り当てを丸ごと置き換える。状態はすぐに（保存を待たずに）変わり、その後で保存する。
   * 関数を渡すと、今の割り当てを受け取って新しい割り当てを返す（続けて呼んでも前の変更が消えない）。
   * 保存に失敗しても状態は戻さず、saveError に理由を入れる。準備完了でないときは何もしない（関数も呼ばない）
   */
  setAssignments(next: AssignmentUpdate): Promise<void>;
  /** 控えに戻した件数（returnedCount）を知らせ終えたとして 0 に戻す。準備完了でないときは何もしない */
  acknowledgeReturned(): void;
  /**
   * 保存先から読み直す（取り込み・取り込んだ艦娘データの削除の後に呼ぶ）。
   * 読み直すときも、今の定義の札 ID にない札の割り当てを控えに戻す。読み込む対象のイベントがないときは何もしない。
   * 保存に失敗した割り当てが残っていれば、読み直した値で上書きせずに残し（読み直した艦にいない個体の分は除く。
   * 艦が 0 隻のときは除かない）、保存し直す
   */
  reload(): Promise<void>;
}

/** usePlanData が返す値（状態と操作） */
export type PlanData = PlanDataState & PlanDataActions;
