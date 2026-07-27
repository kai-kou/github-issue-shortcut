import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./types";
import {
  applySchema,
  checkRateLimit,
  cleanupStaleIssueLog,
  nowSeconds,
  releaseIssueLogReservation,
  releaseRequestIdReservation,
  reserveIssueLog,
  reserveRequestId,
} from "./store";

const db = (env as unknown as Env).DB;

beforeAll(async () => {
  await applySchema(db);
});

/** 利用者キーは GitHub の数値ユーザー ID（P2 以降は内部 UUID・users テーブルを持たない）。 */
let nextUserKey = 2000;
function userKey(): string {
  return String(nextUserKey++);
}

describe("issue_log (reserveIssueLog / releaseIssueLogReservation)", () => {
  it("reserves a fresh key and blocks a second reservation within the window", async () => {
    const user = userKey();
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-a", 30)).toBe(true);
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-a", 30)).toBe(false);
  });

  it("allows reservation again once the existing record has gone stale", async () => {
    const user = userKey();
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-b", 30)).toBe(true);
    // ウィンドウが経過した体で古いタイムスタンプに書き換える（reserveIssueLog 自体は now() を内部で使うため）。
    await db
      .prepare("UPDATE issue_log SET created_at = ? WHERE user_key = ? AND repo = ? AND content_hash = ?")
      .bind(nowSeconds() - 60, user, "kai-kou/alpha", "hash-b")
      .run();
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-b", 30)).toBe(true);
  });

  it("scopes reservations by user, repo, and content hash independently", async () => {
    const user = userKey();
    const otherUser = userKey();
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-c", 30)).toBe(true);

    expect(await reserveIssueLog(db, user, "kai-kou/beta", "hash-c", 30)).toBe(true);
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-d", 30)).toBe(true);
    expect(await reserveIssueLog(db, otherUser, "kai-kou/alpha", "hash-c", 30)).toBe(true);
  });

  it("lets a subsequent reservation succeed immediately after release", async () => {
    const user = userKey();
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-e", 30)).toBe(true);
    await releaseIssueLogReservation(db, user, "kai-kou/alpha", "hash-e");
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-e", 30)).toBe(true);
  });

  it("lets only one of two concurrent reservations for the same key succeed (atomicity)", async () => {
    const user = userKey();
    const [a, b] = await Promise.all([
      reserveIssueLog(db, user, "kai-kou/alpha", "hash-f", 30),
      reserveIssueLog(db, user, "kai-kou/alpha", "hash-f", 30),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("cleanupStaleIssueLog (issue_log 保持期間ポリシー・#71)", () => {
  it("deletes only rows older than the retention window, keeping fresh ones", async () => {
    const user = userKey();
    await reserveIssueLog(db, user, "kai-kou/alpha", "hash-old", 30);
    await reserveIssueLog(db, user, "kai-kou/alpha", "hash-fresh", 30);
    await db
      .prepare("UPDATE issue_log SET created_at = ? WHERE user_key = ? AND repo = ? AND content_hash = ?")
      .bind(nowSeconds() - 8 * 24 * 60 * 60, user, "kai-kou/alpha", "hash-old")
      .run();

    const deleted = await cleanupStaleIssueLog(db, 7 * 24 * 60 * 60);

    expect(deleted).toBe(1);
    // 保持期間内の行は再予約がブロックされたまま（削除されていない証拠）。
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-fresh", 30)).toBe(false);
    // 保持期間外だった行は削除済みのため、再予約が新規に成功する。
    expect(await reserveIssueLog(db, user, "kai-kou/alpha", "hash-old", 30)).toBe(true);
  });

  it("returns 0 when there is nothing stale to delete", async () => {
    const user = userKey();
    await reserveIssueLog(db, user, "kai-kou/alpha", "hash-nostale", 30);

    expect(await cleanupStaleIssueLog(db, 7 * 24 * 60 * 60)).toBe(0);
  });
});

describe("request_ids (reserveRequestId / releaseRequestIdReservation) — B4-4/OQ-8", () => {
  it("reserves a fresh client_request_id and blocks a second reservation within the long window", async () => {
    const user = userKey();
    expect(await reserveRequestId(db, user, "req-a", 26 * 60 * 60)).toBe(true);
    expect(await reserveRequestId(db, user, "req-a", 26 * 60 * 60)).toBe(false);
  });

  it("still blocks a resubmission of the same client_request_id after the short FR-24 window (30s) has passed", async () => {
    // Background Sync（最大24h保持）経由の再送は content_hash の短時間窓（30秒）を超えて起こりうるが、
    // client_request_id が同じなら長時間窓で重複と判定し続けなければならない（B4-4 の主眼）。
    const user = userKey();
    expect(await reserveRequestId(db, user, "req-b", 26 * 60 * 60)).toBe(true);
    await db
      .prepare("UPDATE request_ids SET created_at = ? WHERE user_key = ? AND client_request_id = ?")
      .bind(nowSeconds() - 60, user, "req-b")
      .run();
    expect(await reserveRequestId(db, user, "req-b", 26 * 60 * 60)).toBe(false);
  });

  it("allows reservation again once the existing record has gone stale beyond the long window", async () => {
    const user = userKey();
    expect(await reserveRequestId(db, user, "req-c", 30)).toBe(true);
    await db
      .prepare("UPDATE request_ids SET created_at = ? WHERE user_key = ? AND client_request_id = ?")
      .bind(nowSeconds() - 60, user, "req-c")
      .run();
    expect(await reserveRequestId(db, user, "req-c", 30)).toBe(true);
  });

  it("scopes reservations by user independently", async () => {
    const user = userKey();
    const otherUser = userKey();
    expect(await reserveRequestId(db, user, "req-shared", 26 * 60 * 60)).toBe(true);
    expect(await reserveRequestId(db, otherUser, "req-shared", 26 * 60 * 60)).toBe(true);
  });

  it("lets a subsequent reservation succeed immediately after release", async () => {
    const user = userKey();
    expect(await reserveRequestId(db, user, "req-d", 26 * 60 * 60)).toBe(true);
    await releaseRequestIdReservation(db, user, "req-d");
    expect(await reserveRequestId(db, user, "req-d", 26 * 60 * 60)).toBe(true);
  });

  it("lets only one of two concurrent reservations for the same key succeed (atomicity)", async () => {
    const user = userKey();
    const [a, b] = await Promise.all([
      reserveRequestId(db, user, "req-e", 26 * 60 * 60),
      reserveRequestId(db, user, "req-e", 26 * 60 * 60),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("checkRateLimit (不正利用対策・PR-4/OQ-6)", () => {
  it("allows requests up to the limit within a window and blocks the next one", async () => {
    const user = userKey();
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(db, user, 60, 3)).allowed).toBe(true);
    }
    const blocked = await checkRateLimit(db, user, 60, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("scopes the counter independently per user", async () => {
    const userA = userKey();
    const userB = userKey();
    expect((await checkRateLimit(db, userA, 60, 1)).allowed).toBe(true);
    expect((await checkRateLimit(db, userA, 60, 1)).allowed).toBe(false);
    expect((await checkRateLimit(db, userB, 60, 1)).allowed).toBe(true);
  });

  it("resets once a new window starts", async () => {
    const user = userKey();
    expect((await checkRateLimit(db, user, 60, 1)).allowed).toBe(true);
    expect((await checkRateLimit(db, user, 60, 1)).allowed).toBe(false);
    // 前のウィンドウの行を過去へずらして、新しいウィンドウが始まった体にする。
    await db.prepare("UPDATE rate_limits SET window_start = window_start - 60 WHERE user_key = ?").bind(user).run();
    expect((await checkRateLimit(db, user, 60, 1)).allowed).toBe(true);
  });

  it("cleans up stale windows for the same user once a new window is checked", async () => {
    const user = userKey();
    await checkRateLimit(db, user, 60, 10);
    await db.prepare("UPDATE rate_limits SET window_start = window_start - 120 WHERE user_key = ?").bind(user).run();
    await checkRateLimit(db, user, 60, 10);
    const rows = await db.prepare("SELECT window_start FROM rate_limits WHERE user_key = ?").bind(user).all();
    expect(rows.results).toHaveLength(1);
  });
});

describe("個人データ保持ゼロ（Epic #162 P2）", () => {
  it("no longer defines tables that hold personal data (users / sessions / tokens / shortcuts)", async () => {
    await applySchema(db);
    const rows = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users','sessions','tokens','shortcuts','shortcut_rate_limits')")
      .all<{ name: string }>();
    expect(rows.results ?? []).toEqual([]);
  });
});
