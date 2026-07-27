import { describe, expect, it } from "vitest";
import { isSentRequestIdFresh, SENT_REQUEST_ID_WINDOW_MS } from "./sentRequestIds";
import { OFFLINE_QUEUE_TTL_MS } from "./offlineQueue";

// オフラインキュー再送の重複防止（B4-4・OQ-8・P3 でサーバーの request_ids から移設）の純関数テスト。
// IndexedDB の IO はモックせず E2E に委ねる（offlineQueue.test.ts と同方針）。

const NOW = 1_800_000_000_000;

describe("isSentRequestIdFresh", () => {
  it("treats an unknown id as not reserved (初回送信は通す)", () => {
    expect(isSentRequestIdFresh(undefined, NOW)).toBe(false);
  });

  it("treats a reservation inside the window as duplicate", () => {
    expect(isSentRequestIdFresh({ id: "r", sentAt: NOW }, NOW + SENT_REQUEST_ID_WINDOW_MS - 1)).toBe(true);
  });

  it("lets the reservation expire exactly at the window boundary", () => {
    expect(isSentRequestIdFresh({ id: "r", sentAt: NOW }, NOW + SENT_REQUEST_ID_WINDOW_MS)).toBe(false);
  });
});

describe("窓の大小関係（#91 の不変条件）", () => {
  it("keeps the queue TTL shorter than the dedupe window", () => {
    // TTL が窓より長いと、予約が切れた後の自動再送で重複起票しうる。
    expect(OFFLINE_QUEUE_TTL_MS).toBeLessThan(SENT_REQUEST_ID_WINDOW_MS);
  });
});
