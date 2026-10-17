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

/** 海域が変わってから送るまでの待ち（続けて切り替えたときは最後の値だけを送る） */
export const PRESENCE_SEND_DELAY_MS = 1000;
/** 送れなかった（track が ok 以外・例外）ときに送り直すまでの最初の待ち。続けて失敗したら倍にし、上限で止める */
export const PRESENCE_RETRY_DELAY_MS = 3000;
const PRESENCE_RETRY_MAX_DELAY_MS = 30_000;

/**
 * 外している途中のチャンネル（クライアントごと・チャンネル名ごと）。
 * supabase-js は、同じ名前のチャンネルが外し終わるまで、新しく作らずにそれ（抜けている途中のもの）を返すため、
 * 同じイベントにすぐつなぎ直すときは、外し終わるのを待ってから作る
 */
const pendingRemovals = new WeakMap<SupabaseClient, Map<string, Promise<void>>>();

function removalsOf(client: SupabaseClient): Map<string, Promise<void>> {
  let removals = pendingRemovals.get(client);
  if (removals === undefined) {
    removals = new Map();
    pendingRemovals.set(client, removals);
  }
  return removals;
}

/** チャンネルを外す（外し終わるまで、同じ名前でつなぐ処理を待たせる。失敗しても待ちは解く） */
function removeChannelTracked(client: SupabaseClient, channel: RealtimeChannel, name: string): void {
  const removals = removalsOf(client);
  const previous = removals.get(name) ?? Promise.resolve();
  const removal: Promise<void> = previous
    .then(() => client.removeChannel(channel))
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (removals.get(name) === removal) removals.delete(name);
    });
  removals.set(name, removal);
}

/** 同じ名前のチャンネルを外している途中なら、外し終わるまで待つ */
async function waitForRemoval(client: SupabaseClient, name: string): Promise<void> {
  for (let pending = removalsOf(client).get(name); pending !== undefined; pending = removalsOf(client).get(name)) {
    await pending;
  }
}

/** 参加の前に、セッションのトークンを Realtime に渡す（渡せなくても参加は試す。断られたら表示が出ないだけ） */
async function passTokenToRealtime(client: SupabaseClient, token: string): Promise<void> {
  try {
    await client.realtime.setAuth(token);
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

/**
 * イベントごとの Presence のチャンネルにつなぐ（PresenceConnector の Supabase の実装）。
 * - 参加したら、すぐに自分の値を送る
 * - 海域の変更は PRESENCE_SEND_DELAY_MS 待ってから、最後の値だけを送る
 * - 送れなかったら（ok 以外・例外）、少し後にその時点の最新の値を送り直す（届いたら止める）
 */
export function connectSupabasePresence(options: PresenceConnectOptions): PresenceConnection {
  const { eventId, displayName, onPeersChange } = options;
  const name = presenceChannelName(eventId);
  let areaName = options.areaName;
  let left = false;
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;
  let selfUserId: string | null = null;
  // 参加中か（参加の前の setArea は送らず、参加したときに最新の海域を送る）
  let joined = false;
  // 海域の変更をまとめる待ち・送り直しの待ち
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = PRESENCE_RETRY_DELAY_MS;
  // 送った回の通し番号（古い回の結果で送り直しを決めない）
  let sendCount = 0;

  const clearTimers = (): void => {
    if (sendTimer !== null) clearTimeout(sendTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    sendTimer = null;
    retryTimer = null;
  };

  const scheduleRetry = (): void => {
    if (left || retryTimer !== null) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, PRESENCE_RETRY_MAX_DELAY_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      sendSelf();
    }, delay);
  };

  /** 今の値（最新の海域）を送る。参加していなければ送らない（参加したときに送る） */
  function sendSelf(): void {
    if (sendTimer !== null) clearTimeout(sendTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    sendTimer = null;
    retryTimer = null;
    if (left || channel === null || selfUserId === null || !joined) return;
    sendCount += 1;
    const thisSend = sendCount;
    channel.track({ userId: selfUserId, displayName, areaName }).then(
      (response) => {
        if (thisSend !== sendCount) return;
        if (response === "ok") retryDelay = PRESENCE_RETRY_DELAY_MS;
        else scheduleRetry();
      },
      () => {
        if (thisSend === sendCount) scheduleRetry();
      },
    );
  }

  const start = async (): Promise<void> => {
    const found = getSupabaseClient();
    if (found === null) return;
    const session = await currentSession(found);
    if (session === null || left) return;
    await passTokenToRealtime(found, session.accessToken);
    if (left) return;
    // 同じイベントのチャンネルを外している途中なら、外し終わってから作る
    await waitForRemoval(found, name);
    if (left) return;

    const userId = session.userId;
    const created = found.channel(name, {
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
      if (sendTimer !== null) clearTimeout(sendTimer);
      sendTimer = setTimeout(sendSelf, PRESENCE_SEND_DELAY_MS);
    },
    leave() {
      if (left) return;
      left = true;
      joined = false;
      clearTimers();
      if (client !== null && channel !== null) removeChannelTracked(client, channel, name);
      client = null;
      channel = null;
    },
  };
}
