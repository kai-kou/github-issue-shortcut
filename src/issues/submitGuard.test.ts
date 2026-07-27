import { describe, expect, it } from "vitest";
import {
  claimSubmissionRecord,
  DUPLICATE_SUBMISSION_WINDOW_MS,
  pruneSubmissions,
  releaseSubmissionRecord,
  submissionKey,
  type SubmissionRecord,
} from "./submitGuard";

// 端末内の二重送信防止（FR-24・P3 でサーバーの issue_log から移設）の純関数テスト。
// localStorage の IO はモックせず E2E に委ねる（offlineQueue.test.ts と同方針）。

const input = { repo: "kai-kou/alpha", title: "タイトル", body: "本文", labels: ["bug"] };
const NOW = 1_800_000_000_000;

describe("submissionKey", () => {
  it("treats the same content as the same key", async () => {
    expect(await submissionKey(input)).toBe(await submissionKey({ ...input, labels: ["bug"] }));
  });

  it("distinguishes content that differs in any field", async () => {
    const base = await submissionKey(input);
    expect(base).not.toBe(await submissionKey({ ...input, title: "別のタイトル" }));
    expect(base).not.toBe(await submissionKey({ ...input, body: "別の本文" }));
    expect(base).not.toBe(await submissionKey({ ...input, repo: "kai-kou/beta" }));
    expect(base).not.toBe(await submissionKey({ ...input, labels: [] }));
  });

  it("does not blur field boundaries (改行を含む値で隣のフィールドと混ざらない)", async () => {
    // repo="a", title="b\nc" と repo="a\nb", title="c" が同じキーになる素朴な連結を避ける。
    const a = await submissionKey({ repo: "a", title: "b\nc", body: "", labels: [] });
    const b = await submissionKey({ repo: "a\nb", title: "c", body: "", labels: [] });
    expect(a).not.toBe(b);
  });

  it("does not keep the issue title/body in the key (端末に平文を残さない)", async () => {
    const key = await submissionKey(input);
    expect(key).not.toContain(input.title);
    expect(key).not.toContain(input.body);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("claimSubmissionRecord", () => {
  it("claims a slot when nothing identical was submitted recently", () => {
    const next = claimSubmissionRecord([], "k", NOW);
    expect(next).toEqual([{ key: "k", at: NOW }]);
  });

  it("rejects an identical submission inside the window (再タップ・押し直し)", () => {
    const records: SubmissionRecord[] = [{ key: "k", at: NOW }];
    expect(claimSubmissionRecord(records, "k", NOW + DUPLICATE_SUBMISSION_WINDOW_MS - 1)).toBeNull();
  });

  it("allows an identical submission once the window has elapsed (境界: ちょうど窓幅)", () => {
    const records: SubmissionRecord[] = [{ key: "k", at: NOW }];
    const next = claimSubmissionRecord(records, "k", NOW + DUPLICATE_SUBMISSION_WINDOW_MS);
    expect(next).toEqual([{ key: "k", at: NOW + DUPLICATE_SUBMISSION_WINDOW_MS }]);
  });

  it("does not block different content submitted in the same window (連続起票を止めない)", () => {
    const records: SubmissionRecord[] = [{ key: "k1", at: NOW }];
    const next = claimSubmissionRecord(records, "k2", NOW + 1_000);
    expect(next).toHaveLength(2);
  });

  it("ignores a future-dated record so a clock skew cannot block the content forever", () => {
    // 端末の時計が進んだ状態で書かれた記録は now - at が負になる。単純な上限判定だけだと
    // 「常に窓内」と評価され、時計が戻った後もその内容の送信が永久にブロックされる。
    const records: SubmissionRecord[] = [{ key: "k", at: NOW + 60_000 }];
    expect(claimSubmissionRecord(records, "k", NOW)).toEqual([{ key: "k", at: NOW }]);
  });

  it("drops expired records while claiming so the store cannot grow without bound", () => {
    const records: SubmissionRecord[] = [
      { key: "old", at: NOW - DUPLICATE_SUBMISSION_WINDOW_MS },
      { key: "recent", at: NOW },
    ];
    expect(claimSubmissionRecord(records, "new", NOW)).toEqual([
      { key: "recent", at: NOW },
      { key: "new", at: NOW },
    ]);
  });
});

describe("releaseSubmissionRecord", () => {
  it("removes the reservation so a genuine retry is allowed right away", () => {
    const records: SubmissionRecord[] = [{ key: "k", at: NOW }];
    const released = releaseSubmissionRecord(records, "k");
    expect(released).toEqual([]);
    expect(claimSubmissionRecord(released, "k", NOW + 1)).not.toBeNull();
  });

  it("keeps other reservations intact", () => {
    const records: SubmissionRecord[] = [
      { key: "k1", at: NOW },
      { key: "k2", at: NOW },
    ];
    expect(releaseSubmissionRecord(records, "k1")).toEqual([{ key: "k2", at: NOW }]);
  });
});

describe("pruneSubmissions", () => {
  it("keeps only records inside the window", () => {
    const records: SubmissionRecord[] = [
      { key: "expired", at: NOW - DUPLICATE_SUBMISSION_WINDOW_MS - 1 },
      { key: "future", at: NOW + 1 },
      { key: "fresh", at: NOW - 1 },
    ];
    expect(pruneSubmissions(records, NOW)).toEqual([{ key: "fresh", at: NOW - 1 }]);
  });
});
