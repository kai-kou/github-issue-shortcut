/**
 * オフラインキュー再送の重複防止（B4-4・OQ-8）を端末内で行うガード。
 *
 * P3（stateless-architecture.md §3）でサーバー（D1 の `request_ids`）から移設した。保存先が
 * localStorage ではなく **IndexedDB** なのは、Service Worker（Workbox Background Sync）と
 * ページの両方から同じ記録を参照できるようにするため（localStorage は SW から読めない）。
 * 同じ理由で、ここでは DOM API を一切使わない（SW でもそのまま動く）。
 *
 * 使い方はサーバー側の予約と同じ **claim（予約）→ 送信 → 失敗時は release（解放）**。
 * 予約が残っている＝「別のタブ / SW が同じ再送を担当している、あるいは既に送信済み」なので送らない。
 *
 * 前提と限界: レスポンスだけが届かなかった場合（サーバーには届いて Issue が作られた）を端末から
 * 見分けることはできない。旧実装ではサーバー側の予約が残ることで再送を弾いていたが、保持ゼロ化に
 * 伴いこのケースの重複は防げなくなる（設計 §6 のトレードオフに含める）。
 */

const DB_NAME = "issue-shortcut";
const DB_VERSION = 1;
const STORE = "sent-request-ids";
const SENT_AT_INDEX = "sentAt";

/**
 * 同一 client_request_id を重複とみなす照合ウィンドウ（ミリ秒）。旧サーバー実装の
 * `OFFLINE_QUEUE_DEDUPE_WINDOW`（26 時間）と同値で、キュー滞留の上限（`OFFLINE_QUEUE_TTL_MS` = 24 時間）
 * より長く保つこと（短いと、TTL 内の自動再送がガードの切れた後に走って重複起票しうる）。
 */
export const SENT_REQUEST_ID_WINDOW_MS = 26 * 60 * 60 * 1000;

export type SentRequestId = { id: string; sentAt: number };

/** 予約が有効（＝この id での送信を重複とみなす）かどうかの純関数。 */
export function isSentRequestIdFresh(record: SentRequestId | undefined, now: number): boolean {
  return record !== undefined && now - record.sentAt < SENT_REQUEST_ID_WINDOW_MS;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // 期限切れの一括削除（prune）が全件走査にならないようにする。
        store.createIndex(SENT_AT_INDEX, "sentAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 期限切れの予約を削除する（判定に使われないうえ、放置すると際限なく増えるため）。 */
async function pruneStale(store: IDBObjectStore, now: number): Promise<void> {
  const range = IDBKeyRange.upperBound(now - SENT_REQUEST_ID_WINDOW_MS);
  const keys = await requestToPromise(store.index(SENT_AT_INDEX).getAllKeys(range));
  for (const key of keys) store.delete(key);
}

/**
 * 再送の枠を予約する。`false` なら同じ client_request_id の送信が既に走っている / 済んでいる
 * （＝重複なので送らない）。IndexedDB が使えない環境（プライベートブラウジング等）では常に `true`
 * を返し、送信自体は止めない（ガードは多層防御の 1 層で、単独の必須条件ではない）。
 */
export async function claimRequestId(id: string, now: number = Date.now()): Promise<boolean> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await pruneStale(store, now);
    const existing = await requestToPromise<SentRequestId | undefined>(store.get(id));
    if (isSentRequestIdFresh(existing, now)) return false;
    // 同一トランザクション内で get → put するため、2 つのタブが同時に claim しても
    // 一方だけが予約を取る（IndexedDB の readwrite トランザクションは直列化される）。
    await requestToPromise(store.put({ id, sentAt: now } satisfies SentRequestId));
    return true;
  } catch {
    return true;
  } finally {
    db?.close();
  }
}

/** 送信が失敗したときに呼ぶ（予約を残すと、正当な再送が 26 時間ブロックされてしまう）。 */
export async function releaseRequestId(id: string): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  } catch {
    // 解放できなくても送信経路は壊れない（最大 26 時間、その id での再送が抑止されるだけ）。
  } finally {
    db?.close();
  }
}
