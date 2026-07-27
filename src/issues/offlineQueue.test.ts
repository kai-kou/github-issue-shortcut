import { describe, expect, it } from "vitest";
import {
  expireStaleEntries,
  isOfflineQueueEntryExpired,
  OFFLINE_QUEUE_TTL_MS,
  QUEUE_EXPIRED_ERROR_CODE,
  type QueuedIssue,
} from "./offlineQueue";

// offlineQueue の localStorage 依存部（load/persist/enqueue/remove）は Workers プールに localStorage が
// 無いため authCache/reposCache と同様 E2E（e2e/offline-queue.spec.ts）で検証する。ここでは TTL 判定の
// 純関数（#91・重複起票の防止境界）をユニットテストで固める。

const NOW = 1_700_000_000_000;

function entry(overrides: Partial<QueuedIssue> = {}): QueuedIssue {
  return {
    id: "req-1",
    repo: "octocat/hello",
    title: "バグ報告",
    body: "",
    labels: [],
    queuedAt: NOW,
    status: "pending",
    ...overrides,
  };
}

describe("OFFLINE_QUEUE_TTL_MS", () => {
  // クライアント TTL が端末内の重複防止窓（sentRequestIds.ts の SENT_REQUEST_ID_WINDOW_MS = 26h）
  // 以上になると、窓が切れた後の自動再送で重複起票しうる（#91 のリスクシナリオ）。
  it("stays shorter than the on-device dedupe window (26h)", () => {
    expect(OFFLINE_QUEUE_TTL_MS).toBeLessThan(26 * 60 * 60 * 1000);
  });
});

describe("isOfflineQueueEntryExpired", () => {
  it("treats an entry queued just now as not expired", () => {
    expect(isOfflineQueueEntryExpired(entry(), NOW)).toBe(false);
  });

  it("treats an entry just under the TTL as not expired", () => {
    expect(isOfflineQueueEntryExpired(entry(), NOW + OFFLINE_QUEUE_TTL_MS - 1)).toBe(false);
  });

  it("treats an entry at or past the TTL as expired", () => {
    expect(isOfflineQueueEntryExpired(entry(), NOW + OFFLINE_QUEUE_TTL_MS)).toBe(true);
    expect(isOfflineQueueEntryExpired(entry(), NOW + OFFLINE_QUEUE_TTL_MS * 2)).toBe(true);
  });
});

describe("expireStaleEntries", () => {
  const past = NOW + OFFLINE_QUEUE_TTL_MS;

  it("marks expired pending entries as failed with the queue_expired code", () => {
    const result = expireStaleEntries([entry()], past);
    expect(result.expiredIds).toEqual(["req-1"]);
    expect(result.queue[0]).toMatchObject({
      id: "req-1",
      status: "failed",
      errorCode: QUEUE_EXPIRED_ERROR_CODE,
      // errorCode は次の送信試行の結果で上書きされるため、期限切れは独立したフラグでも保持する
      // （これが無いと 2 回目以降の手動再送で重複起票の確認が出なくなる）。
      expired: true,
    });
  });

  it("keeps fresh pending entries untouched", () => {
    const queue = [entry()];
    const result = expireStaleEntries(queue, NOW + 1000);
    expect(result.expiredIds).toEqual([]);
    // 変更なしのときは同一参照を返す（不要な再描画・永続化を避ける）。
    expect(result.queue).toBe(queue);
  });

  it("does not overwrite the error code of entries that already failed", () => {
    const queue = [entry({ status: "failed", errorCode: "upstream_failed" })];
    const result = expireStaleEntries(queue, past);
    expect(result.expiredIds).toEqual([]);
    expect(result.queue[0].errorCode).toBe("upstream_failed");
  });

  it("expires only the stale entries in a mixed queue", () => {
    const result = expireStaleEntries(
      [entry({ id: "stale", queuedAt: NOW }), entry({ id: "fresh", queuedAt: past })],
      past,
    );
    expect(result.expiredIds).toEqual(["stale"]);
    expect(result.queue.find((q) => q.id === "fresh")?.status).toBe("pending");
  });

  it("returns an empty result for an empty queue", () => {
    const result = expireStaleEntries([], past);
    expect(result.expiredIds).toEqual([]);
    expect(result.queue).toEqual([]);
  });
});
