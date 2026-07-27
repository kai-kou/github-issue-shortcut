/**
 * 認証付き API 呼び出しの共通経路（ステートレス認証・docs/design/stateless-architecture.md §5）。
 *
 * Worker の API プロキシは暗黙のリフレッシュをしない（並行レスポンスの Set-Cookie が互いを
 * 上書きする事故を避けるため）。代わりにクライアントが
 *
 *   1. 呼び出し前に期限を見て、近ければ Web Locks 下で 1 回だけ `/auth/refresh`
 *   2. それでも 401 が返ったら 1 度だけリフレッシュして再送
 *
 * を担う。2 度目の 401 は再ログインが必要な状態なので、そのまま呼び出し側へ返す。
 */
import { ensureFreshAccessToken, readAccessTokenExpiry, recoverFromUnauthorized } from "./tokenRefresh";

/** 認証が要る API への fetch。Cookie を必ず載せ、access token の失効を透過的に吸収する。 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const request: RequestInit = { credentials: "same-origin", ...init };

  await ensureFreshAccessToken();
  // 401 を受け取ったときに「他タブが先にリフレッシュ済みか」を判定するための基準値。
  const expiryBefore = readAccessTokenExpiry();
  const res = await fetch(input, request);
  if (res.status !== 401) return res;

  // 期限判定がずれていた（時計ずれ・鍵ローテーション・期限 Cookie の書き換え）場合の保険。
  // サーバーの 401 を根拠に強制リフレッシュし、成功したときだけ 1 度再送する。
  // 未ログインならリフレッシュは即 false を返すため、余計な往復は発生しない。
  if (!(await recoverFromUnauthorized(expiryBefore))) return res;
  return fetch(input, request);
}
