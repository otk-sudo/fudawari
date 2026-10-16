// 公開定義 JSON（一般の画面と管理者側の契約。要件 4.3）の型
//
// - 一般の画面は、最新イベントの公開版をこの形の JSON 1 つとして読む（要件 5 章）。
// - 読み込んだ JSON は validatePublicDefinition（validate.ts）で検証してから使う。
// - 定義は不変の値として扱う（特効の計算〔boost.ts〕が定義・段階のオブジェクトごとに索引を覚えるため）。
//   項目はすべて readonly、配列は readonly T[] にして書き換えを型の誤りにし、検証後の値は実行時にも深く凍結する。
//   内容を変えるときは新しいオブジェクトを作る。
// - 並び順は配列の順で表す（areas・fudas は配列の順がそのまま並び順。
//   stages は同じ海域の段階どうしの配列の中での前後が、その海域の中の並び順）。
// - 特効は「段階のボスで効く艦名グループ × 倍率」だけを持つ（U11）。
//   艦種補正・国籍・装備・道中・海域全体の倍率は持たない。

/** 公開定義 JSON の形式の版。形を変えるときに上げる */
export type DefinitionSchemaVersion = 1;

/** 大事さ。普通／重要／難所（重み 1／2／3。importance.ts の importanceWeight で重みに変える） */
export type Importance = "normal" | "important" | "hard";

/** イベント（要件 4.1） */
export interface EventInfo {
  /** イベント ID */
  readonly id: string;
  /** イベント名（例「2026夏イベ」） */
  readonly name: string;
  /** 開始日時（必須）。ISO 8601 の時差つき（例 "2026-08-07T12:00:00+09:00"。秒は省略可） */
  readonly startAt: string;
  /**
   * 終了日時（任意）。未定なら null。形式は startAt と同じで、startAt より後。
   * JSON では省略してもよく、検証後の値では null になる
   */
  readonly endAt: string | null;
  /** 特効データの版の日付（公開した日。"YYYY-MM-DD"。画面では「2026/08/04 版」） */
  readonly versionDate: string;
}

/** 海域（E1、E2…） */
export interface Area {
  /** 海域 ID */
  readonly id: string;
  /** 表示名（例「E1」） */
  readonly name: string;
}

/** 札（出撃札） */
export interface Fuda {
  /** 札 ID */
  readonly id: string;
  /** 札名（例「連合艦隊」） */
  readonly name: string;
  /** 札の色（"#RRGGBB"） */
  readonly color: string;
  /**
   * ゲーム内の札番号（U10。取り込みデータの api_sally_area／area の値と対応する）。
   * 未入力なら null。JSON では省略してもよく、検証後の値では null になる。1 以上の整数で、札どうしで重複しない
   */
  readonly gameNumber: number | null;
}

/** 特効グループ（この段階のボスで効く艦名の集合 × 倍率） */
export interface BoostGroup {
  /** グループ ID（定義全体で重複しない） */
  readonly id: string;
  /** グループ名（例「連合艦隊C」）。空でもよい（ほかの名前と違い、空は誤りにしない） */
  readonly name: string;
  /** 倍率（例 1.27）。1 以上の有限の数 */
  readonly multiplier: number;
  /** 艦名（改装段階を問わない艦名。例「時雨」は 時雨改二・時雨改三 にも効く） */
  readonly shipNames: readonly string[];
}

/** 攻略段階（段階） */
export interface Stage {
  /** 段階 ID */
  readonly id: string;
  /** 属する海域の ID（areas のどれか） */
  readonly areaId: string;
  /** 段階名（例「ゲージ3」） */
  readonly name: string;
  /** この段階で使う札の ID（fudas のどれか） */
  readonly fudaId: string;
  /** 大事さ */
  readonly importance: Importance;
  /** この段階のボスで効く特効グループ（未入力なら空配列） */
  readonly boosts: readonly BoostGroup[];
}

/** 公開定義（最新イベントの公開版） */
export interface PublicDefinition {
  readonly schemaVersion: DefinitionSchemaVersion;
  readonly event: EventInfo;
  /** 海域（配列の順が並び順） */
  readonly areas: readonly Area[];
  /** 札（配列の順が並び順） */
  readonly fudas: readonly Fuda[];
  /** 段階（同じ海域の段階どうしの前後が、その海域の中の並び順） */
  readonly stages: readonly Stage[];
}

/**
 * 検証エラーの種類
 * - invalid_json：JSON として読めない（parsePublicDefinition だけ）
 * - invalid_type：型が違う（例：倍率が文字列、NaN・Infinity、配列のはずがオブジェクト）
 * - missing_field：必須の項目がない
 * - invalid_value：値が範囲外・形式違い・許されない値（例：倍率が 1 未満、大事さが 3 種以外、色や日時の形式違い、空の名前）
 * - duplicate_id：ID が重複している
 * - duplicate_value：重複してはいけない値が重複している（例：ゲーム内の札番号）
 * - unknown_reference：存在しない海域・札を参照している
 * - unsupported_version：schemaVersion が対応していない値
 */
export type DefinitionErrorCode =
  | "invalid_json"
  | "invalid_type"
  | "missing_field"
  | "invalid_value"
  | "duplicate_id"
  | "duplicate_value"
  | "unknown_reference"
  | "unsupported_version";

/** 検証エラー 1 件 */
export interface DefinitionError {
  code: DefinitionErrorCode;
  /**
   * 問題の場所。ルートは ""、それ以外は "event.name"、"stages[4].fudaId"、
   * "stages[4].boosts[0].multiplier" の形。重複は 2 つ目以降の場所を指す
   */
  path: string;
  /** 利用者・管理者に見せる理由の文（日本語） */
  message: string;
}

/** 検証の結果。例外は投げず、この形で返す */
export type DefinitionValidationResult =
  | { ok: true; value: PublicDefinition }
  | { ok: false; errors: DefinitionError[] };
