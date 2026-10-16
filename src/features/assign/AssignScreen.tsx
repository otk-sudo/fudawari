"use client";

// 割り振り画面の中身（roadmap T2-7、要件 3.3、U17・U22、モック Assign.dc.html・ShipCard.dc.html）
//
// 読み込み（公開定義・艦船マスタ・札割りのデータ・設定）と、読み込み中・失敗・未取り込みの表示はページ
// （src/app/assign/page.tsx → AssignPageContent）が受け持ち、すべて読めて艦が 1 隻以上あるときに、この部品を描く。
//
// 画面の構成
// - ヘッダー：画面名・最新イベント名・操作の説明・「特効データ：YYYY/MM/DD 版」・「元に戻す」・「一覧で確認」
// - お知らせ：保存の失敗（role="alert"）、読み込みのときに控えに戻した割り当ての件数（U17）
// - 控え（TrayPanel）・札の列（FudaColumn）・選択中の艦のパネル（SelectedShipPanel）
//
// 割り当て・選択・開閉・「元に戻す」・保存はストア（createAssignStore。画面を開くたびに作る）が持つ。
// 置いた後は移った艦のカード、「×」の後は選んでいた艦のカードにフォーカスを移す（押したボタンが消えても document.body に落とさない）。
// カードが描かれていない（区切りの折りたたみ・検索・絞り込み）ときは、控えの検索欄に移す。
// テストが探す形（role・名前・属性）は src/test/assign-screen.ts の冒頭にまとめてある。
// ドラッグ＆ドロップと 600 隻の仮想スクロールは PR-06（T2-8）で、TrayGroupList・FudaColumn・ShipCard を包む形で足す。
import Link from "next/link";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { ScreenHeader } from "@/components/ScreenHeader";
import type { PublicDefinition } from "@/domain/definition/types";
import type { ShipMaster } from "@/domain/master/types";
import type { AssignmentMap } from "@/domain/plan/types";
import type { OwnedShip, ShipUid } from "@/domain/ship/types";
import { ROUTES } from "@/lib/routes";
import { createAssignStore, type SaveAssignments } from "./assign-store";
import { FudaColumn, type PlaceButtonKind } from "./FudaColumn";
import { SelectedShipPanel } from "./SelectedShipPanel";
import { ShipCard } from "./ShipCard";
import {
  type BoostLine,
  boostIn,
  boostLines,
  formatVersionDate,
  fudaMapOf,
  fudaStageLabels,
  hasBoostIn,
  placedFudaOf,
  shipEntryOf,
  shipsByFuda,
  shipTypeLabel,
} from "./ship-view";
import { ASSIGN_SCREEN_TITLE } from "./title";
import type { TrayEntry, TrayOptionsInit } from "./tray";
import { TrayPanel } from "./TrayPanel";
import styles from "./AssignScreen.module.css";

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
   * 失敗したら理由の文をメッセージに持つエラーで reject する（画面は「保存できませんでした」と理由を出す）。
   * 最初の描画で渡した関数を使い続ける（後から別の関数を渡しても切り替わらない）ので、何度描いても同じ関数を渡す
   */
  save: SaveAssignments;
  /** 読み込みのときに控えに戻した割り当ての件数（U17。0 なら知らせない） */
  returnedCount: number;
  /** 控えの並び順・表示（一行／カード）の初期値（設定の traySort・trayView）。省略すると艦型・一行 */
  trayInit?: TrayOptionsInit;
}

/** 控えの艦を開いたときに、どの札でも効かなければ出す文 */
const TRAY_NO_BOOST_TEXT = "特効なし";
/** 札の列の艦を開いたときに、その札で効かなければ出す文 */
const COLUMN_NO_BOOST_TEXT = "この札では特効なし";
/** 閉じているカードに渡す段階の倍率（毎回同じ配列を渡して、ShipCard の memo を効かせる） */
const EMPTY_LINES: readonly BoostLine[] = [];

/** フォーカスを移す先の艦（頼むたびに新しいオブジェクトにする。同じ艦を続けて頼んでも移す） */
interface FocusRequest {
  readonly uid: ShipUid;
}

/** root の中の、個体 ID が uid の艦カード（ShipCard の data-ship-uid）。描かれていなければ null */
function findShipCard(root: HTMLElement | null, uid: ShipUid): HTMLElement | null {
  if (root === null) return null;
  // 個体 ID をセレクターに埋め込まずに比べる（ID の文字を CSS の書き方に直さなくてよいように）
  for (const card of root.querySelectorAll<HTMLElement>("[data-ship-uid]")) {
    if (card.dataset.shipUid === uid) return card;
  }
  return null;
}

/** 割り振り画面の中身 */
export function AssignScreen({
  definition,
  master,
  ships,
  initialAssignments,
  save,
  returnedCount,
  trayInit,
}: AssignScreenProps): ReactNode {
  // ストアは最初の描画で 1 回だけ作る（初めの割り当て・保存の関数・イベント ID は、そのときの値を使い続ける）
  const [store] = useState(() =>
    createAssignStore({ eventId: definition.event.id, assignments: initialAssignments, save }),
  );

  const assignments = useStore(store, (state) => state.assignments);
  const selectedUid = useStore(store, (state) => state.selectedUid);
  const openUids = useStore(store, (state) => state.openUids);
  const canUndo = useStore(store, (state) => state.canUndo);
  const saveError = useStore(store, (state) => state.saveError);
  // 操作はストアを作ったときから変わらない
  const pressShip = useStore(store, (state) => state.pressShip);
  const clearSelection = useStore(store, (state) => state.clearSelection);
  const closeAll = useStore(store, (state) => state.closeAll);
  const placeSelected = useStore(store, (state) => state.placeSelected);
  const undo = useStore(store, (state) => state.undo);

  const screenRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  // 頼まれた艦のカードにフォーカスを移す（描き直した後。カードが描かれていなければ控えの検索欄）
  useLayoutEffect(() => {
    if (focusRequest === null) return;
    (findShipCard(screenRef.current, focusRequest.uid) ?? searchRef.current)?.focus();
  }, [focusRequest]);

  /** 「ここに置く」「（札名）に置く」：選択中の艦をその札へ移し、移った艦のカードにフォーカスを移す */
  const placeAndFocus = (fudaId: string): void => {
    const uid = store.getState().selectedUid;
    placeSelected(fudaId);
    if (uid !== null) setFocusRequest({ uid });
  };

  /** 「×」（選択をやめる）：選んでいた艦のカードにフォーカスを戻す */
  const clearAndFocus = (): void => {
    const uid = store.getState().selectedUid;
    clearSelection();
    if (uid !== null) setFocusRequest({ uid });
  };

  const fudas = useMemo(() => fudaMapOf(definition), [definition]);
  const fudaIds = useMemo(() => new Set(fudas.keys()), [fudas]);
  const stageLabelsByFuda = useMemo(
    () => new Map(definition.fudas.map((fuda) => [fuda.id, fudaStageLabels(definition, fuda.id)])),
    [definition],
  );
  const entries = useMemo(
    () => new Map(ships.map((ship) => [ship.uid, shipEntryOf(definition, master, ship)])),
    [definition, master, ships],
  );
  const membersByFuda = useMemo(() => shipsByFuda(definition, ships, assignments), [definition, ships, assignments]);
  const openSet = useMemo(() => new Set(openUids), [openUids]);

  const selected = selectedUid === null ? undefined : entries.get(selectedUid);
  const selectedFudaId = selected === undefined ? null : placedFudaOf(assignments, selected.ship.uid, fudaIds);

  /** 控えの艦のカード：左端は一番効く札の色、開いたら効く札のスコアの高い順に効く段階をすべて並べる */
  const renderTrayCard = (entry: TrayEntry, dense: boolean): ReactNode => {
    const { ship, info, boost } = entry;
    const expanded = openSet.has(ship.uid);
    const best = boost.effective.at(0);
    return (
      <ShipCard
        uid={ship.uid}
        name={info.name}
        typeLabel={shipTypeLabel(info)}
        level={ship.level}
        luck={ship.luck}
        dense={dense}
        hasBoost={best !== undefined}
        stripeColor={best === undefined ? null : (fudas.get(best.fudaId)?.color ?? null)}
        selected={ship.uid === selectedUid}
        expanded={expanded}
        lines={expanded ? boostLines(definition, fudas, boost.effective) : EMPTY_LINES}
        noBoostText={TRAY_NO_BOOST_TEXT}
        onPress={pressShip}
      />
    );
  };

  /** 札の列の艦のカード：いつもカード表示で、左端はその札の色、開いたらその札の段階で効くものだけを並べる */
  const renderColumnCard = (entry: TrayEntry, fudaId: string, color: string): ReactNode => {
    const { ship, info } = entry;
    const expanded = openSet.has(ship.uid);
    const boost = boostIn(entry, fudaId);
    return (
      <ShipCard
        uid={ship.uid}
        name={info.name}
        typeLabel={shipTypeLabel(info)}
        level={ship.level}
        luck={ship.luck}
        dense={false}
        hasBoost={boost !== undefined}
        stripeColor={color}
        selected={ship.uid === selectedUid}
        expanded={expanded}
        lines={expanded && boost !== undefined ? boostLines(definition, fudas, [boost]) : EMPTY_LINES}
        noBoostText={COLUMN_NO_BOOST_TEXT}
        onPress={pressShip}
      />
    );
  };

  return (
    <div ref={screenRef} className={styles.screen}>
      <ScreenHeader title={ASSIGN_SCREEN_TITLE} eventName={definition.event.name}>
        <span className={styles.headerNote}>ドラッグで別の札へ移動、カードに重ねると入れ替え</span>
        <span className={styles.headerNote}>特効データ：{formatVersionDate(definition.event.versionDate)} 版</span>
        <span className={styles.headerSpacer} />
        <button type="button" className={styles.undoButton} disabled={!canUndo} onClick={undo}>
          元に戻す
        </button>
        <Link href={ROUTES.list} className={styles.listLink}>
          一覧で確認
        </Link>
      </ScreenHeader>

      {(saveError !== null || returnedCount > 0) && (
        <div className={styles.notices}>
          {saveError !== null && (
            <div role="alert" className={styles.alert}>
              <p className={styles.alertTitle}>保存できませんでした</p>
              <p className={styles.alertReason}>{saveError}</p>
            </div>
          )}
          {returnedCount > 0 && (
            <p role="status" className={styles.notice}>
              イベントの定義から消えた札に置いていた {returnedCount} 件の割り当てを、控えに戻しました
            </p>
          )}
        </div>
      )}

      <div className={styles.body}>
        <TrayPanel
          definition={definition}
          master={master}
          ships={ships}
          assignments={assignments}
          trayInit={trayInit}
          openCount={openUids.length}
          onCloseAll={closeAll}
          renderCard={renderTrayCard}
          searchRef={searchRef}
        />

        <div className={styles.columns}>
          {definition.fudas.map((fuda) => {
            const members = membersByFuda.get(fuda.id) ?? [];
            const isHere = selected !== undefined && selectedFudaId === fuda.id;
            const boosted = selected !== undefined && hasBoostIn(selected, fuda.id);
            const place: PlaceButtonKind = selected === undefined || isHere ? null : boosted ? "boost" : "no-boost";
            return (
              <FudaColumn
                key={fuda.id}
                fuda={fuda}
                stageLabels={stageLabelsByFuda.get(fuda.id) ?? []}
                count={members.length}
                place={place}
                dimmed={selected !== undefined && !boosted && !isHere}
                onPlace={() => placeAndFocus(fuda.id)}
              >
                {members.map((ship) => {
                  const entry = entries.get(ship.uid);
                  return entry === undefined ? null : (
                    <li key={ship.uid}>{renderColumnCard(entry, fuda.id, fuda.color)}</li>
                  );
                })}
              </FudaColumn>
            );
          })}
        </div>

        <div className={styles.side}>
          {selected !== undefined && (
            <SelectedShipPanel
              definition={definition}
              fudas={fudas}
              entry={selected}
              placedFudaId={selectedFudaId}
              onPlace={placeAndFocus}
              onClose={clearAndFocus}
            />
          )}
        </div>
      </div>
    </div>
  );
}
