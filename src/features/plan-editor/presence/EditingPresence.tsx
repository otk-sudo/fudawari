"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PresenceConnection, PresenceConnector, PresencePeer } from "./types";
import styles from "./EditingPresence.module.css";

/** 編集できる人（利用者の ID と今の表示名） */
export interface EditingMember {
  readonly userId: string;
  readonly displayName: string;
}

/** 画面に出す 1 人（表示名は編集できる人の一覧から引いたもの） */
interface ShownPeer {
  readonly userId: string;
  readonly displayName: string;
  readonly areaName: string | null;
}

export type EditingPresenceProps = {
  /** Presence のチャンネルにつなぐ関数（同じ関数を渡し続けること。変わるとつなぎ直す） */
  connect: PresenceConnector;
  /** 開いたイベントの ID（イベントが変わるときは、部品ごと作り直す〔key にイベント ID を渡す〕） */
  eventId: string;
  /** 自分の表示名 */
  displayName: string;
  /** 自分が表示中の海域の表示名（選んでいる段階の海域。なければ null） */
  areaName: string | null;
  /**
   * 編集できる人（管理者を先に、追加した順）。表示名は送られてきた値ではなくここから引き、ここにいない人は出さない
   * （送る値は誰でも書けるため）。複数人はこの並びで出す
   */
  members: readonly EditingMember[];
};

/**
 * 開いたイベントのチャンネルにつなぎ、自分以外の人の一覧を返す。
 * 表示中の海域が変わったら、つなぎ直さずに送り直す。部品が外れたら抜ける
 */
function usePresencePeers(
  connect: PresenceConnector,
  eventId: string,
  displayName: string,
  areaName: string | null,
): readonly PresencePeer[] {
  const [peers, setPeers] = useState<readonly PresencePeer[]>([]);
  const connectionRef = useRef<PresenceConnection | null>(null);
  // つなぐときに渡す海域（いちばん新しい値）と、つなぎ先に最後に渡した海域
  const areaRef = useRef(areaName);
  const sentAreaRef = useRef(areaName);

  useEffect(() => {
    // 抜けた後に届いた知らせは捨てる
    let active = true;
    const initialArea = areaRef.current;
    const connection = connect({
      eventId,
      displayName,
      areaName: initialArea,
      onPeersChange: (next) => {
        if (active) setPeers(next);
      },
    });
    connectionRef.current = connection;
    sentAreaRef.current = initialArea;
    return () => {
      active = false;
      connectionRef.current = null;
      connection.leave();
      setPeers([]);
    };
  }, [connect, eventId, displayName]);

  useEffect(() => {
    areaRef.current = areaName;
    const connection = connectionRef.current;
    if (connection === null || sentAreaRef.current === areaName) return;
    sentAreaRef.current = areaName;
    connection.setArea(areaName);
  }, [areaName]);

  return peers;
}

/**
 * 出す人：編集できる人の一覧にいる人だけを、その一覧の並びで、一覧の表示名にして返す
 * （送られてきた表示名は使わない。一覧にいない利用者の ID の人は出さない）
 */
function shownPeers(peers: readonly PresencePeer[], members: readonly EditingMember[]): ShownPeer[] {
  const byUser = new Map(peers.map((peer) => [peer.userId, peer]));
  const shown: ShownPeer[] = [];
  const added = new Set<string>();
  for (const member of members) {
    const peer = byUser.get(member.userId);
    if (peer === undefined || added.has(member.userId)) continue;
    added.add(member.userId);
    shown.push({ userId: member.userId, displayName: member.displayName, areaName: peer.areaName });
  }
  return shown;
}

/** 1 人分の文（「（名前）も編集中（E3 を表示中）」。表示中の海域がなければ「（名前）も編集中」） */
function presenceText(peer: ShownPeer): string {
  return peer.areaName === null
    ? `${peer.displayName}も編集中`
    : `${peer.displayName}も編集中（${peer.areaName} を表示中）`;
}

/**
 * 編集中の人の表示（要件 3.7「編集中の人」、モック PlanEditor.dc.html）。
 * 定義画面を開いている自分以外の人を、1 人 1 行で「（名前）も編集中（E3 を表示中）」と出す。
 * 出入りを読み上げるよう、入れ物（aria-live="polite"）は誰もいないときも描いておき、中身だけを変える
 */
export function EditingPresence({ connect, eventId, displayName, areaName, members }: EditingPresenceProps): ReactNode {
  const peers = shownPeers(usePresencePeers(connect, eventId, displayName, areaName), members);
  return (
    <div className={styles.live} aria-live="polite">
      {peers.length > 0 && (
        <ul className={styles.list} aria-label="編集中の人">
          {peers.map((peer) => (
            <li key={peer.userId} className={styles.item}>
              <span className={styles.dot} aria-hidden="true" />
              {presenceText(peer)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
