import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./types";
import {
  applySchema,
  createSession,
  deleteAccount,
  deleteSession,
  getUserBySessionHash,
  nowSeconds,
  releaseIssueLogReservation,
  releaseRefreshLock,
  reserveIssueLog,
  saveTokens,
  tryAcquireRefreshLock,
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

describe("deleteAccount", () => {
  it("removes the user's rows from users, sessions, tokens, and issue_log (FR-12)", async () => {
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

    await deleteAccount(db, userId);

    expect(await getUserBySessionHash(db, idHash)).toBeNull();
    expect(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM sessions WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM tokens WHERE user_id = ?").bind(userId).first()).toBeNull();
    expect(await db.prepare("SELECT 1 FROM issue_log WHERE user_id = ?").bind(userId).first()).toBeNull();
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
