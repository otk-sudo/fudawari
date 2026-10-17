"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { PresenceConnection, PresenceConnector, PresencePeer } from "./types";
import styles from "./EditingPresence.module.css";

export type EditingPresenceProps = {
  /** Presence のチャンネルにつなぐ関数（同じ関数を渡し続けること。変わるとつなぎ直す） */
  connect: PresenceConnector;
  /** 開いたイベントの ID（イベントが変わるときは、部品ごと作り直す〔key にイベント ID を渡す〕） */
  eventId: string;
  /** 自分の表示名 */
  displayName: string;
  /** 自分が表示中の海域の表示名（選んでいる段階の海域。なければ null） */
  areaName: string | null;
  /** 編集できる人の表示名（管理者を先に、追加した順）。複数人はこの並びで出す */
  memberNames: readonly string[];
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

/** 人の並び：編集できる人の並び → そこにいない人は表示名の順 */
function sortPeers(peers: readonly PresencePeer[], memberNames: readonly string[]): PresencePeer[] {
  const rank = (peer: PresencePeer): number => {
    const index = memberNames.indexOf(peer.displayName);
    return index === -1 ? memberNames.length : index;
  };
  return [...peers].sort((a, b) => rank(a) - rank(b) || a.displayName.localeCompare(b.displayName, "ja"));
}

/** 1 人分の文（「（名前）も編集中（E3 を表示中）」。表示中の海域がなければ「（名前）も編集中」） */
function presenceText(peer: PresencePeer): string {
  return peer.areaName === null
    ? `${peer.displayName}も編集中`
    : `${peer.displayName}も編集中（${peer.areaName} を表示中）`;
}

/**
 * 編集中の人の表示（要件 3.7「編集中の人」、モック PlanEditor.dc.html）。
 * 定義画面を開いている自分以外の人を、1 人 1 行で「（名前）も編集中（E3 を表示中）」と出す（誰もいなければ何も出さない）
 */
export function EditingPresence({ connect, eventId, displayName, areaName, memberNames }: EditingPresenceProps): ReactNode {
  const peers = usePresencePeers(connect, eventId, displayName, areaName);
  if (peers.length === 0) return null;
  return (
    <ul className={styles.list} aria-label="編集中の人">
      {sortPeers(peers, memberNames).map((peer) => (
        <li key={peer.userId} className={styles.item}>
          <span className={styles.dot} aria-hidden="true" />
          {presenceText(peer)}
        </li>
      ))}
    </ul>
  );
}
