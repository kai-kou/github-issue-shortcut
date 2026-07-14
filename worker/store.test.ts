import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./types";
import {
  applySchema,
  createSession,
  deleteSession,
  getUserBySessionHash,
  nowSeconds,
  releaseRefreshLock,
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
