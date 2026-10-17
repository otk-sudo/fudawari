// 編集中の表示（要件 3.7「編集中の人」、roadmap T3-9、plan-v1 の PR-12）の型
//
// - Supabase Realtime の Presence で、イベントごとのチャンネルに「自分の profile の ID・表示名・表示中の海域」を載せる
//   （docs/design/database.md 5 章）
// - 画面は PresenceConnector だけを通してつなぐ（テストでは偽物に差し替える）。Supabase の実装は supabase-presence.ts

/** 定義画面を開いている、自分以外の人 */
export interface PresencePeer {
  /** profiles.user_id */
  readonly userId: string;
  /** 表示名（profiles.display_name） */
  readonly displayName: string;
  /** 表示中の海域の表示名（例 "E3"。選んでいる段階がなければ null） */
  readonly areaName: string | null;
}

/** つないだ後の操作 */
export interface PresenceConnection {
  /** 表示中の海域が変わったときに送り直す */
  setArea(areaName: string | null): void;
  /** 抜ける（画面を閉じたとき。何度呼んでもよい。つなぎ終わる前に呼ばれても、後で必ず抜ける） */
  leave(): void;
}

/** つなぐときに渡すもの */
export interface PresenceConnectOptions {
  /** イベント ID（チャンネルはイベントごと） */
  readonly eventId: string;
  /** 自分の表示名 */
  readonly displayName: string;
  /** 自分が表示中の海域の表示名 */
  readonly areaName: string | null;
  /** 自分以外の、定義画面を開いている人が変わったとき（自分は含めない。同じ人は 1 件） */
  readonly onPeersChange: (peers: readonly PresencePeer[]) => void;
}

/** 編集中の表示のチャンネルにつなぐ（すぐに操作を返し、つなぐ処理は裏で進める） */
export type PresenceConnector = (options: PresenceConnectOptions) => PresenceConnection;
