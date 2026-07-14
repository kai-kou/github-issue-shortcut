import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "./types";
import {
  applySchema,
  createSession,
  deleteSession,
  getUserBySessionHash,
  nowSeconds,
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
