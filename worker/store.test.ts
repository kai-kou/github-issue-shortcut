import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./types";
import {
  applySchema,
  checkRateLimit,
  createSession,
  createShortcut,
  deleteAccount,
  deleteShortcut,
  deleteSession,
  getUserBySessionHash,
  listShortcuts,
  nowSeconds,
  releaseIssueLogReservation,
  releaseRefreshLock,
  releaseRequestIdReservation,
  reserveIssueLog,
  reserveRequestId,
  saveTokens,
  tryAcquireRefreshLock,
  updateShortcut,
  upsertUser,
} from "./store";

const db = (env as unknown as Env).DB;

beforeAll(async () => {
  await applySchema(db);
});

describe("upsertUser", () => {
  it("inserts then updates login on conflict, keeping the same id", async () => {
    const gh = { id: 4242, login: "octocat", avatar_url: "https://example.com/a.png" };
    const id1 = await upsertUser(db, gh);
    const id2 = await upsertUser(db, { ...gh, login: "octocat-renamed" });
    expect(id2).toBe(id1);
    const row = await db
      .prepare("SELECT login FROM users WHERE id = ?")
      .bind(id1)
      .first<{ login: string }>();
    expect(row?.login).toBe("octocat-renamed");
  });
});

describe("sessions", () => {
  it("resolves a valid session to its user and deletes on logout", async () => {
    const userId = await upsertUser(db, { id: 999, login: "sessuser", avatar_url: "" });
    const idHash = "hash-valid";
    await createSession(db, idHash, userId, 3600);
    expect((await getUserBySessionHash(db, idHash))?.login).toBe("sessuser");
    await deleteSession(db, idHash);
    expect(await getUserBySessionHash(db, idHash)).toBeNull();
  });

  it("does not resolve an expired session", async () => {
    const userId = await upsertUser(db, { id: 1000, login: "expuser", avatar_url: "" });
    const idHash = "hash-expired";
    await createSession(db, idHash, userId, 3600);
    await db
      .prepare("UPDATE sessions SET expires_at = ? WHERE id_hash = ?")
      .bind(nowSeconds() - 10, idHash)
      .run();
    expect(await getUserBySessionHash(db, idHash)).toBeNull();
  });
});

describe("issue_log (reserveIssueLog / releaseIssueLogReservation)", () => {
  it("reserves a fresh key and blocks a second reservation within the window", async () => {
    const userId = await upsertUser(db, { id: 2001, login: "loguser", avatar_url: "" });
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-a", 30)).toBe(true);
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-a", 30)).toBe(false);
  });

  it("allows reservation again once the existing record has gone stale", async () => {
    const userId = await upsertUser(db, { id: 2002, login: "loguser2", avatar_url: "" });
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-b", 30)).toBe(true);
    // ウィンドウが経過した体で古いタイムスタンプに書き換える（reserveIssueLog 自体は now() を内部で使うため）。
    await db
      .prepare("UPDATE issue_log SET created_at = ? WHERE user_id = ? AND repo = ? AND content_hash = ?")
      .bind(nowSeconds() - 60, userId, "kai-kou/alpha", "hash-b")
      .run();
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-b", 30)).toBe(true);
  });

  it("scopes reservations by user, repo, and content hash independently", async () => {
    const userId = await upsertUser(db, { id: 2003, login: "loguser3", avatar_url: "" });
    const otherUserId = await upsertUser(db, { id: 2004, login: "loguser4", avatar_url: "" });
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-c", 30)).toBe(true);

    expect(await reserveIssueLog(db, userId, "kai-kou/beta", "hash-c", 30)).toBe(true);
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-d", 30)).toBe(true);
    expect(await reserveIssueLog(db, otherUserId, "kai-kou/alpha", "hash-c", 30)).toBe(true);
  });

  it("lets a subsequent reservation succeed immediately after release", async () => {
    const userId = await upsertUser(db, { id: 2005, login: "loguser5", avatar_url: "" });
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-e", 30)).toBe(true);
    await releaseIssueLogReservation(db, userId, "kai-kou/alpha", "hash-e");
    expect(await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-e", 30)).toBe(true);
  });

  it("lets only one of two concurrent reservations for the same key succeed (atomicity)", async () => {
    const userId = await upsertUser(db, { id: 2006, login: "loguser6", avatar_url: "" });
    const [a, b] = await Promise.all([
      reserveIssueLog(db, userId, "kai-kou/alpha", "hash-f", 30),
      reserveIssueLog(db, userId, "kai-kou/alpha", "hash-f", 30),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("request_ids (reserveRequestId / releaseRequestIdReservation) — B4-4/OQ-8", () => {
  it("reserves a fresh client_request_id and blocks a second reservation within the long window", async () => {
    const userId = await upsertUser(db, { id: 2101, login: "requser1", avatar_url: "" });
    expect(await reserveRequestId(db, userId, "req-a", 26 * 60 * 60)).toBe(true);
    expect(await reserveRequestId(db, userId, "req-a", 26 * 60 * 60)).toBe(false);
  });

  it("still blocks a resubmission of the same client_request_id after the short FR-24 window (30s) has passed", async () => {
    // Background Sync（最大24h保持）経由の再送は content_hash の短時間窓（30秒）を超えて起こりうるが、
    // client_request_id が同じなら長時間窓で重複と判定し続けなければならない（B4-4 の主眼）。
    const userId = await upsertUser(db, { id: 2102, login: "requser2", avatar_url: "" });
    expect(await reserveRequestId(db, userId, "req-b", 26 * 60 * 60)).toBe(true);
    await db
      .prepare("UPDATE request_ids SET created_at = ? WHERE user_id = ? AND client_request_id = ?")
      .bind(nowSeconds() - 60, userId, "req-b")
      .run();
    expect(await reserveRequestId(db, userId, "req-b", 26 * 60 * 60)).toBe(false);
  });

  it("allows reservation again once the existing record has gone stale beyond the long window", async () => {
    const userId = await upsertUser(db, { id: 2103, login: "requser3", avatar_url: "" });
    expect(await reserveRequestId(db, userId, "req-c", 30)).toBe(true);
    await db
      .prepare("UPDATE request_ids SET created_at = ? WHERE user_id = ? AND client_request_id = ?")
      .bind(nowSeconds() - 60, userId, "req-c")
      .run();
    expect(await reserveRequestId(db, userId, "req-c", 30)).toBe(true);
  });

  it("scopes reservations by user independently", async () => {
    const userId = await upsertUser(db, { id: 2104, login: "requser4", avatar_url: "" });
    const otherUserId = await upsertUser(db, { id: 2105, login: "requser5", avatar_url: "" });
    expect(await reserveRequestId(db, userId, "req-shared", 26 * 60 * 60)).toBe(true);
    expect(await reserveRequestId(db, otherUserId, "req-shared", 26 * 60 * 60)).toBe(true);
  });

  it("lets a subsequent reservation succeed immediately after release", async () => {
    const userId = await upsertUser(db, { id: 2106, login: "requser6", avatar_url: "" });
    expect(await reserveRequestId(db, userId, "req-d", 26 * 60 * 60)).toBe(true);
    await releaseRequestIdReservation(db, userId, "req-d");
    expect(await reserveRequestId(db, userId, "req-d", 26 * 60 * 60)).toBe(true);
  });

  it("lets only one of two concurrent reservations for the same key succeed (atomicity)", async () => {
    const userId = await upsertUser(db, { id: 2107, login: "requser7", avatar_url: "" });
    const [a, b] = await Promise.all([
      reserveRequestId(db, userId, "req-e", 26 * 60 * 60),
      reserveRequestId(db, userId, "req-e", 26 * 60 * 60),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe("deleteAccount", () => {
  it("removes the user's rows from users, sessions, tokens, issue_log, request_ids, rate_limits, and shortcuts (FR-12)", async () => {
    const userId = await upsertUser(db, { id: 5001, login: "delme", avatar_url: "" });
    const idHash = "hash-delme";
    await createSession(db, idHash, userId, 3600);
    await saveTokens(db, userId, {
      accessEnc: "enc",
      accessExpiresAt: nowSeconds() + 3600,
      refreshEnc: null,
      refreshExpiresAt: null,
    });
    await reserveIssueLog(db, userId, "kai-kou/alpha", "hash-delme", 30);
    await reserveRequestId(db, userId, "req-delme", 26 * 60 * 60);
    await checkRateLimit(db, userId, 60, 10);
    await createShortcut(db, userId, { repo: "kai-kou/alpha", labels: ["bug"], title: "" });

    await deleteAccount(db, userId);

    expect(await getUserBySessionHash(db, idHash)).toBeNull();
    expect(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM sessions WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM tokens WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM issue_log WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM request_ids WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM rate_limits WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM shortcuts WHERE user_id = ?").bind(userId).first()).toBeNull();
  });
});

describe("shortcuts (C1-1・FR-16)", () => {
  it("creates, lists, updates, and deletes a preset scoped to its owner", async () => {
    const userId = await upsertUser(db, { id: 7001, login: "shortcutuser", avatar_url: "" });
    const otherUserId = await upsertUser(db, { id: 7002, login: "otheruser", avatar_url: "" });

    const created = await createShortcut(db, userId, {
      repo: "kai-kou/alpha",
      labels: ["bug", "P1"],
      title: "バグ報告",
    });
    expect(created.repo).toBe("kai-kou/alpha");
    expect(created.labels).toEqual(["bug", "P1"]);

    expect(await listShortcuts(db, userId)).toEqual([created]);
    expect(await listShortcuts(db, otherUserId)).toEqual([]);

    const updated = await updateShortcut(db, userId, created.id, {
      repo: "kai-kou/beta",
      labels: [],
      title: "改善案",
    });
    expect(updated).toBe(true);
    expect(await listShortcuts(db, userId)).toEqual([{ id: created.id, repo: "kai-kou/beta", labels: [], title: "改善案" }]);

    // 所有者が一致しない更新・削除は 0 行で失敗する。
    expect(await updateShortcut(db, otherUserId, created.id, { repo: "x", labels: [], title: "" })).toBe(false);
    expect(await deleteShortcut(db, otherUserId, created.id)).toBe(false);

    expect(await deleteShortcut(db, userId, created.id)).toBe(true);
    expect(await listShortcuts(db, userId)).toEqual([]);
  });

  it("round-trips a label containing a comma without splitting it (JSON serialization, not comma-join)", async () => {
    const userId = await upsertUser(db, { id: 7003, login: "commalabeluser", avatar_url: "" });
    const created = await createShortcut(db, userId, { repo: "kai-kou/alpha", labels: ["a,b", "c"], title: "" });
    expect(created.labels).toEqual(["a,b", "c"]);
    expect(await listShortcuts(db, userId)).toEqual([created]);
  });
});

describe("checkRateLimit (不正利用対策・PR-4/OQ-6)", () => {
  it("allows requests up to the limit within a window and blocks the next one", async () => {
    const userId = await upsertUser(db, { id: 6001, login: "rluser", avatar_url: "" });
    for (let i = 0; i < 3; i++) {
      expect((await checkRateLimit(db, userId, 60, 3)).allowed).toBe(true);
    }
    const blocked = await checkRateLimit(db, userId, 60, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("scopes the counter independently per user", async () => {
    const userA = await upsertUser(db, { id: 6002, login: "rlusera", avatar_url: "" });
    const userB = await upsertUser(db, { id: 6003, login: "rluserb", avatar_url: "" });
    expect((await checkRateLimit(db, userA, 60, 1)).allowed).toBe(true);
    expect((await checkRateLimit(db, userA, 60, 1)).allowed).toBe(false);
    expect((await checkRateLimit(db, userB, 60, 1)).allowed).toBe(true);
  });

  it("resets once a new window starts", async () => {
    const userId = await upsertUser(db, { id: 6004, login: "rluserc", avatar_url: "" });
    expect((await checkRateLimit(db, userId, 60, 1)).allowed).toBe(true);
    expect((await checkRateLimit(db, userId, 60, 1)).allowed).toBe(false);
    // 前のウィンドウの行を過去へずらして、新しいウィンドウが始まった体にする。
    await db.prepare("UPDATE rate_limits SET window_start = window_start - 60 WHERE user_id = ?").bind(userId).run();
    expect((await checkRateLimit(db, userId, 60, 1)).allowed).toBe(true);
  });

  it("cleans up stale windows for the same user once a new window is checked", async () => {
    const userId = await upsertUser(db, { id: 6005, login: "rluserd", avatar_url: "" });
    await checkRateLimit(db, userId, 60, 10);
    await db.prepare("UPDATE rate_limits SET window_start = window_start - 120 WHERE user_id = ?").bind(userId).run();
    await checkRateLimit(db, userId, 60, 10);
    const rows = await db.prepare("SELECT window_start FROM rate_limits WHERE user_id = ?").bind(userId).all();
    expect(rows.results).toHaveLength(1);
  });
});

describe("refresh lock (tryAcquireRefreshLock / releaseRefreshLock)", () => {
  async function makeTokenUser(): Promise<string> {
    const userId = await upsertUser(db, {
      id: Math.floor(Math.random() * 1e9),
      login: "lockuser",
      avatar_url: "",
    });
    await saveTokens(db, userId, {
      accessEnc: "enc",
      accessExpiresAt: nowSeconds() - 10,
      refreshEnc: "enc",
      refreshExpiresAt: nowSeconds() + 1000,
    });
    return userId;
  }

  it("only lets one caller acquire the lock at a time", async () => {
    const userId = await makeTokenUser();
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(true);
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(false);
  });

  it("allows re-acquiring after release", async () => {
    const userId = await makeTokenUser();
    const lockUntil = nowSeconds() + 30;
    expect(await tryAcquireRefreshLock(db, userId, lockUntil)).toBe(true);
    await releaseRefreshLock(db, userId, lockUntil);
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(true);
  });

  it("allows re-acquiring once a stale lock's TTL has passed (crash recovery)", async () => {
    const userId = await makeTokenUser();
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() - 1)).toBe(true);
    // 直前のロックは既に期限切れなので、解放されていなくても再獲得できる。
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(true);
  });

  it("does not release a lock acquired by someone else after its own lockUntil is stale (CAS)", async () => {
    const userId = await makeTokenUser();
    const staleLockUntil = nowSeconds() - 1;
    expect(await tryAcquireRefreshLock(db, userId, staleLockUntil)).toBe(true);
    // 別リクエストが期限切れロックを引き継いで新しいロックを獲得する。
    const newLockUntil = nowSeconds() + 30;
    expect(await tryAcquireRefreshLock(db, userId, newLockUntil)).toBe(true);
    // 最初のリクエストが（自分の古い lockUntil で）解放を試みても、他者の新しいロックは消えない。
    await releaseRefreshLock(db, userId, staleLockUntil);
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(false);
  });

  it("clears the lock when saveTokens persists a fresh token", async () => {
    const userId = await makeTokenUser();
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(true);
    await saveTokens(db, userId, {
      accessEnc: "enc2",
      accessExpiresAt: nowSeconds() + 3600,
      refreshEnc: "enc2",
      refreshExpiresAt: nowSeconds() + 1000,
    });
    expect(await tryAcquireRefreshLock(db, userId, nowSeconds() + 30)).toBe(true);
  });
});
