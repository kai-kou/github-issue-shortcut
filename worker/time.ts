/**
 * Worker 内で使う時刻ユーティリティ。
 *
 * ここで返す UNIX 秒は **機械処理用の UTC 基準**（トークンの有効期限計算・Cookie の Max-Age）で、
 * 表示・記録用の日時ではない（datetime-rules.md §1 の例外に該当する）。
 */

/** 現在時刻を UNIX 秒で返す。 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
