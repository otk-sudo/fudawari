// 編集中の表示の Supabase Realtime（Presence）の実装（docs/design/database.md 5 章、roadmap T3-9）
//
// - チャンネルはイベントごと（"plan-editor:（イベント ID）"）。private チャンネル（Realtime Authorization）にし、
//   参加できる人は realtime.messages の RLS で管理者・協力者に絞る（マイグレーションは別に置く）
// - Presence の key は自分の profile の ID（Auth の利用者の ID）。同じ人の複数のタブは同じ key の下に並ぶ
// - 送る値は { userId, displayName, areaName }（ほかのブラウザの同じ実装が読む形）
// - 参加の前に、ログイン中のセッションのトークンを Realtime に渡す。supabase-js 2.118 は accessToken のコールバックと
//   ログインの出来事でも渡すが、参加の要求（join）より先に確実に渡すため明示する
// - 失敗（設定・セッションがない、参加できない）は画面に出さない（編集中の表示は補助の情報なので、出せなければ出さない）
// - この部品は supabase-js を読み込むので、画面は lazy.ts から遅延読み込みする
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import type { PresenceConnection, PresenceConnectOptions, PresencePeer } from "./types";

/** チャンネルの名前の前置き */
const CHANNEL_PREFIX = "plan-editor:";

/** チャンネルの名前（イベントごと） */
export function presenceChannelName(eventId: string): string {
  return `${CHANNEL_PREFIX}${eventId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Presence の 1 件（他のブラウザが送った値）を読む。形が違えば null */
function toPeer(meta: unknown): PresencePeer | null {
  if (!isRecord(meta)) return null;
  const { userId, displayName, areaName } = meta;
  if (typeof userId !== "string" || userId === "" || typeof displayName !== "string") return null;
  if (areaName !== null && typeof areaName !== "string") return null;
  return { userId, displayName, areaName };
}

/**
 * Presence の状態（key ごとの値の一覧）から、自分以外の人を 1 人 1 件で取り出す。
 * 同じ人（同じ userId）が複数のタブで開いていれば、最後に更新された値（一覧の後ろ。Realtime は更新した値を後ろに足す）を使う
 */
export function peersFromPresenceState(state: Record<string, unknown>, selfUserId: string): PresencePeer[] {
  const byUser = new Map<string, PresencePeer>();
  for (const metas of Object.values(state)) {
    if (!Array.isArray(metas)) continue;
    for (const meta of metas) {
      const peer = toPeer(meta);
      if (peer === null || peer.userId === selfUserId) continue;
      // 後から来た値で置き換える（Map は最初に入れた順を保つので、人の並びは変わらない）
      byUser.set(peer.userId, peer);
    }
  }
  return [...byUser.values()];
}

/** Realtime の setAuth（テストの偽物のクライアントは realtime を持たないため、ないこともある形で読む） */
type RealtimeAuth = { setAuth?: (token?: string | null) => Promise<void> };

/** 参加の前に、セッションのトークンを Realtime に渡す（渡せなくても参加は試す。断られたら表示が出ないだけ） */
async function passTokenToRealtime(client: SupabaseClient, token: string): Promise<void> {
  const realtime: RealtimeAuth | undefined = client.realtime;
  if (realtime?.setAuth === undefined) return;
  try {
    await realtime.setAuth(token);
  } catch {
    // 渡せなかったときは supabase-js の accessToken のコールバックに任せる
  }
}

/** ログイン中の人のセッション（なければ null） */
async function currentSession(client: SupabaseClient): Promise<{ userId: string; accessToken: string } | null> {
  try {
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (session === null) return null;
    return { userId: session.user.id, accessToken: session.access_token };
  } catch {
    return null;
  }
}

/** イベントごとの Presence のチャンネルにつなぐ（PresenceConnector の Supabase の実装） */
export function connectSupabasePresence(options: PresenceConnectOptions): PresenceConnection {
  const { eventId, displayName, onPeersChange } = options;
  let areaName = options.areaName;
  let left = false;
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;
  let selfUserId: string | null = null;
  // 参加中か（参加の前の setArea は送らず、参加したときに最新の海域を送る）
  let joined = false;

  const sendSelf = (): void => {
    if (left || channel === null || selfUserId === null || !joined) return;
    void channel.track({ userId: selfUserId, displayName, areaName }).catch(() => {
      // 送れなかったときは次の送り直し（海域の変更・参加し直し）に任せる
    });
  };

  const start = async (): Promise<void> => {
    const found = getSupabaseClient();
    if (found === null) return;
    const session = await currentSession(found);
    if (session === null || left) return;
    await passTokenToRealtime(found, session.accessToken);
    if (left) return;

    const userId = session.userId;
    const created = found.channel(presenceChannelName(eventId), {
      config: { private: true, presence: { key: userId } },
    });
    client = found;
    channel = created;
    selfUserId = userId;
    created.on("presence", { event: "sync" }, () => {
      if (left) return;
      onPeersChange(peersFromPresenceState(created.presenceState(), userId));
    });
    created.subscribe((status) => {
      if (left) return;
      if (status === "SUBSCRIBED") {
        joined = true;
        sendSelf();
        return;
      }
      // 参加できない・切れた：誰がいるか分からないので表示を消す（Realtime が参加し直したら SUBSCRIBED でまた送る）
      joined = false;
      onPeersChange([]);
    });
  };

  void start().catch(() => {
    // 失敗は出さない（編集中の表示が出ないだけ）
  });

  return {
    setArea(next) {
      if (areaName === next) return;
      areaName = next;
      sendSelf();
    },
    leave() {
      if (left) return;
      left = true;
      joined = false;
      if (client !== null && channel !== null) {
        void client.removeChannel(channel).catch(() => {
          // 抜けられなかったときも、以後は知らせない（left で止めている）
        });
      }
      client = null;
      channel = null;
    },
  };
}
