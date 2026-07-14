/**
 * ユーザーの有効な GitHub access token を取得する（透過リフレッシュ・A1-2）。
 * リフレッシュトークンは単回使用ローテーションのため、並行リフレッシュは競合して失効する。
 * D1 の行ロック（tokens.refreshing_until への条件付き UPDATE）でユーザー単位に直列化し、
 * ロックを取れなかったリクエストは完了をポーリングで待つ（OQ-3・Durable Object は導入せず解決）。
 */
import { decryptString, encryptString } from "./crypto";
import { DEFAULT_ACCESS_TOKEN_TTL, DEFAULT_OAUTH_BASE, refreshAccessToken } from "./github";
import { getTokens, nowSeconds, releaseRefreshLock, saveTokens, tryAcquireRefreshLock } from "./store";
import type { Env } from "./types";

/** access token の期限切れ判定の前倒しバッファ（秒）。ぎりぎりでの失効を避ける。 */
const EXPIRY_BUFFER = 60;
/** リフレッシュロックの TTL（秒）。処理がクラッシュした場合にロックを自動失効させる。 */
const LOCK_TTL = 30;
/** 他リクエストがリフレッシュ中のときのポーリング間隔（ms）。 */
const POLL_INTERVAL_MS = 100;
/** ポーリングの最大試行回数。ロック保持者が LOCK_TTL いっぱい使う可能性があるため、それに合わせる。 */
const POLL_MAX_ATTEMPTS = Math.ceil((LOCK_TTL * 1000) / POLL_INTERVAL_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValid(accessExpiresAt: number): boolean {
  return accessExpiresAt > nowSeconds() + EXPIRY_BUFFER;
}

/**
 * ユーザーの有効な access token を返す。期限切れなら refresh token で自動更新する。
 * 更新済みトークンが存在しない、または refresh token がない場合は例外を投げる
 * （呼び出し側で再ログイン導線に振り分ける想定）。
 */
export async function getValidAccessToken(env: Env, userId: string): Promise<string> {
  let tokens = await getTokens(env.DB, userId);
  if (!tokens) throw new Error("no tokens saved for user");

  if (isValid(tokens.accessExpiresAt)) {
    return decryptString(env.TOKEN_ENCRYPTION_KEY, tokens.accessEnc);
  }
  if (!tokens.refreshEnc) {
    throw new Error("access token expired and no refresh token available");
  }

  const lockUntil = nowSeconds() + LOCK_TTL;
  const acquired = await tryAcquireRefreshLock(env.DB, userId, lockUntil);
  if (acquired) {
    try {
      // ロック獲得直前に他リクエストが refresh を完了させている可能性があるため再読込する。
      // 再読込せず最初に読んだ refreshEnc をそのまま使うと、既に消費済みの単回使用トークンで
      // refresh を試みて失敗する（TOCTOU）。
      const fresh = await getTokens(env.DB, userId);
      if (!fresh) throw new Error("no tokens saved for user");
      if (isValid(fresh.accessExpiresAt)) {
        await releaseRefreshLock(env.DB, userId, lockUntil);
        return decryptString(env.TOKEN_ENCRYPTION_KEY, fresh.accessEnc);
      }
      if (!fresh.refreshEnc) throw new Error("access token expired and no refresh token available");

      const refreshToken = await decryptString(env.TOKEN_ENCRYPTION_KEY, fresh.refreshEnc);
      const refreshed = await refreshAccessToken({
        oauthBase: env.GITHUB_OAUTH_BASE ?? DEFAULT_OAUTH_BASE,
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        refreshToken,
      });
      const now = nowSeconds();
      const accessEnc = await encryptString(env.TOKEN_ENCRYPTION_KEY, refreshed.access_token!);
      // GitHub がローテーション後の refresh_token を返さない場合は既存値を維持する。
      const refreshEnc = refreshed.refresh_token
        ? await encryptString(env.TOKEN_ENCRYPTION_KEY, refreshed.refresh_token)
        : fresh.refreshEnc;
      await saveTokens(env.DB, userId, {
        accessEnc,
        accessExpiresAt: now + (refreshed.expires_in ?? DEFAULT_ACCESS_TOKEN_TTL),
        refreshEnc,
        refreshExpiresAt: refreshed.refresh_token_expires_in
          ? now + refreshed.refresh_token_expires_in
          : fresh.refreshExpiresAt,
      });
      return refreshed.access_token!;
    } catch (err) {
      // lockUntil 一致時のみ解放するため、TTL 切れ後に他リクエストが獲得した
      // 新しいロックを誤って解放することはない（CAS）。
      await releaseRefreshLock(env.DB, userId, lockUntil);
      throw err;
    }
  }

  // 他リクエストがリフレッシュ中: 完了をポーリングで待ち、その結果を使う（リフレッシュは二重実行しない）。
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    tokens = await getTokens(env.DB, userId);
    if (!tokens) throw new Error("no tokens saved for user");
    if (isValid(tokens.accessExpiresAt)) {
      return decryptString(env.TOKEN_ENCRYPTION_KEY, tokens.accessEnc);
    }
    // ロックが解放済み（＝相手のリフレッシュ試行は終わっている）なのにまだ無効ならリフレッシュは
    // 失敗している。フルのポーリング予算を待たず、この呼び出し自身でリフレッシュを再試行する。
    const stillLocked = tokens.refreshingUntil !== null && tokens.refreshingUntil > nowSeconds();
    if (!stillLocked) {
      return getValidAccessToken(env, userId);
    }
  }
  throw new Error("timed out waiting for concurrent token refresh");
}
