// 取り込みデータ（制空権シミュ形式）の解析。通信しない純粋な関数
import type { ShipMaster } from "@/domain/master/types";
import type { ImportFilter, ImportParseResult } from "./types";

/**
 * 貼り付けられた文字列を解析し、取り込む艦の個体の一覧と件数を返す（要件 3.4、U8・U9）。
 * - `svdata=` で始まる文字列と、短縮形式の JSON 配列（新しい形式・古い形式）を受け付ける
 * - 艦の ID が 0・欠けている要素、オブジェクトでない要素は飛ばす
 * - 空・壊れた JSON・想定外の形でも例外を投げず、{ ok: false, reason } を返す
 */
export function parseImportText(text: string, master: ShipMaster, filter: ImportFilter): ImportParseResult {
  void text;
  void master;
  void filter;
  throw new Error("未実装");
}
