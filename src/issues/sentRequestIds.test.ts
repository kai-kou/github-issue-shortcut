import { describe, expect, it } from "vitest";
import { evaluateClaim, IN_FLIGHT_TTL_MS, SENT_REQUEST_ID_WINDOW_MS } from "./sentRequestIds";
import { OFFLINE_QUEUE_TTL_MS } from "./offlineQueue";

// オフラインキュー再送の重複防止（B4-4・OQ-8・P3 でサーバーの request_ids から移設）の純関数テスト。
// IndexedDB の IO はモックせず E2E に委ねる（offlineQueue.test.ts と同方針）。

const NOW = 1_800_000_000_000;

describe("evaluateClaim", () => {
  it("treats an unknown id as claimable (初回送信は通す)", () => {
    expect(evaluateClaim(undefined, NOW)).toBe("claimed");
  });

  it("blocks a resend of an id that was actually sent (26 時間窓内)", () => {
    const record = { id: "r", sentAt: NOW, done: true };
    expect(evaluateClaim(record, NOW + SENT_REQUEST_ID_WINDOW_MS - 1)).toBe("sent");
  });

  it("lets a sent reservation expire exactly at the window boundary", () => {
    const record = { id: "r", sentAt: NOW, done: true };
    expect(evaluateClaim(record, NOW + SENT_REQUEST_ID_WINDOW_MS)).toBe("claimed");
  });

  it("defers (does not consume) an id that another path is currently sending", () => {
    // 予約は「送信前」に書かれるため、done でない予約は「送信済み」ではない。ここを sent と
    // 同一視すると、応答前に落ちた送信がキューから消えて起票が失われる。
    const record = { id: "r", sentAt: NOW, done: false };
    expect(evaluateClaim(record, NOW + IN_FLIGHT_TTL_MS - 1)).toBe("in-flight");
  });

  it("re-claims an in-flight reservation whose sender disappeared (猶予を過ぎた未完了)", () => {
    const record = { id: "r", sentAt: NOW, done: false };
    expect(evaluateClaim(record, NOW + IN_FLIGHT_TTL_MS)).toBe("claimed");
  });

  it("ignores future-dated records so a clock skew cannot block a resend forever", () => {
    // 端末の時計が進んだ状態で書かれた予約は now - sentAt が負になる。単純な上限判定だけだと
    // 「常に窓内」と評価され、時計が戻った後もその id の再送が永久にブロックされる。
    expect(evaluateClaim({ id: "r", sentAt: NOW + 60_000, done: true }, NOW)).toBe("claimed");
    expect(evaluateClaim({ id: "r", sentAt: NOW + 60_000, done: false }, NOW)).toBe("claimed");
  });
});

describe("窓の大小関係（#91 の不変条件）", () => {
  it("keeps the queue TTL shorter than the dedupe window", () => {
    // TTL が窓より長いと、予約が切れた後の自動再送で重複起票しうる。
    expect(OFFLINE_QUEUE_TTL_MS).toBeLessThan(SENT_REQUEST_ID_WINDOW_MS);
  });

  it("keeps the in-flight grace far shorter than the dedupe window", () => {
    // 送信中の猶予が長すぎると、中断された送信の再送がいつまでも始まらない。
    expect(IN_FLIGHT_TTL_MS).toBeLessThan(SENT_REQUEST_ID_WINDOW_MS);
  });
});
