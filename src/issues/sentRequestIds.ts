/**
 * オフラインキュー再送の重複防止（B4-4・OQ-8）を端末内で行うガード。
 *
 * P3（stateless-architecture.md §3）でサーバー（D1 の `request_ids`）から移設した。保存先が
 * localStorage ではなく **IndexedDB** なのは、Service Worker（Workbox Background Sync）と
 * ページの両方から同じ記録を参照できるようにするため（localStorage は SW から読めない）。
 * 同じ理由で、ここでは DOM API を一切使わない（SW でもそのまま動く）。
 *
 * ## 「送信中」と「送信済み」を区別する理由
 *
 * 旧サーバー実装の予約は「リクエストがサーバーへ届いた」証拠だったが、端末内の予約は **送信前** に
 * 書かれるため、そのままでは「送信済み」の証明にならない。予約が残っているだけで成功扱いにすると、
 * 応答到着前にタブが破棄されたケースで「GitHub には作られていないのにキューから消える」（＝起票が
 * 黙って失われる）。そこで `done` フラグを持ち、
 *
 * - `done: true`（26 時間窓内）→ **本当に送信済み**。再送は重複なので送らない
 * - `done: false` かつ直近（60 秒以内）→ **他経路が送信中**。今回は見送り、次の機会に再判定する
 * - `done: false` で 60 秒より古い → 送信元が消えた可能性が高いので **予約し直して送る**
 *
 * ## 限界（設計 §6 で受容）
 *
 * レスポンスだけが届かなかった場合（サーバーには届いて Issue が作られた）を端末から見分けることは
 * できない。旧実装ではサーバー側の予約が残ることで再送を弾いていたが、保持ゼロ化に伴いこのケースの
 * 重複は防げなくなる。
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

/**
 * 「送信中」とみなす猶予（ミリ秒）。これを過ぎた未完了の予約は、送信元（タブ・SW）が消えたものとして
 * 再予約を許す。短すぎると通信の遅い端末で二重送信を許し、長すぎると中断後の再送が待たされる。
 */
export const IN_FLIGHT_TTL_MS = 60_000;

export type SentRequestId = { id: string; sentAt: number; done: boolean };

/** 予約の判定結果。`claimed` = 送ってよい / `sent` = 送信済み（重複）/ `in-flight` = 他経路が送信中。 */
export type ClaimResult = "claimed" | "sent" | "in-flight";

/** 既存レコードから判定する純関数（時計のずれ・未来日付は「記録なし」と同じ扱いにする）。 */
export function evaluateClaim(record: SentRequestId | undefined, now: number): ClaimResult {
  if (!record) return "claimed";
  const age = now - record.sentAt;
  // 未来日付（端末の時計がずれた状態で書かれた記録）は判定に使わない。使うと、時計が戻った後に
  // その id の再送が永久にブロックされる。
  if (age < 0) return "claimed";
  if (record.done) return age < SENT_REQUEST_ID_WINDOW_MS ? "sent" : "claimed";
  return age < IN_FLIGHT_TTL_MS ? "in-flight" : "claimed";
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

/** 判定に使われない記録（期限切れ・未来日付）を削除する。 */
async function pruneStale(store: IDBObjectStore, now: number): Promise<void> {
  const index = store.index(SENT_AT_INDEX);
  const expired = await requestToPromise(index.getAllKeys(IDBKeyRange.upperBound(now - SENT_REQUEST_ID_WINDOW_MS)));
  const future = await requestToPromise(index.getAllKeys(IDBKeyRange.lowerBound(now, true)));
  for (const key of [...expired, ...future]) store.delete(key);
}

/**
 * 再送の枠を予約する。IndexedDB が使えない環境（プライベートブラウジング等）では常に `claimed`
 * を返し、送信自体は止めない（ガードは多層防御の 1 層で、単独の必須条件ではない）。
 */
export async function claimRequestId(id: string, now: number = Date.now()): Promise<ClaimResult> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await pruneStale(store, now);
    const result = evaluateClaim(await requestToPromise<SentRequestId | undefined>(store.get(id)), now);
    if (result !== "claimed") return result;
    // 同一トランザクション内で get → put するため、2 つのタブが同時に claim しても
    // 一方だけが予約を取る（IndexedDB の readwrite トランザクションは直列化される）。
    await requestToPromise(store.put({ id, sentAt: now, done: false } satisfies SentRequestId));
    return "claimed";
  } catch {
    return "claimed";
  } finally {
    db?.close();
  }
}

/** 送信が成功したときに呼ぶ。以降 26 時間、この id の再送は重複として弾かれる。 */
export async function markRequestIdSent(id: string, now: number = Date.now()): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    await requestToPromise(store.put({ id, sentAt: now, done: true } satisfies SentRequestId));
  } catch {
    // 記録できなくても送信は完了している。最悪でも別経路の再送が 1 回通る（旧実装と同じ露出）。
  } finally {
    db?.close();
  }
}

/** 送信が失敗したときに呼ぶ（予約を残すと、正当な再送が待たされてしまう）。 */
export async function releaseRequestId(id: string): Promise<void> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
  } catch {
    // 解放できなくても送信経路は壊れない（最大 60 秒、その id の再送が見送られるだけ）。
  } finally {
    db?.close();
  }
}
