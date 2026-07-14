/**
 * 認証で使う暗号ユーティリティ（WebCrypto ベース）。
 * - セッション ID / state / PKCE verifier のランダム生成
 * - セッション ID のハッシュ化（サーバー側はハッシュのみ保存・NFR-6）
 * - PKCE code_challenge（S256・NFR-4）
 * - GitHub トークンの AES-256-GCM 暗号化・復号（NFR-7）
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 暗号学的乱数を base64url 文字列で返す（既定 32 バイト = 256bit）。 */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

/** 入力を SHA-256 でハッシュし base64url で返す。 */
export async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return bytesToBase64url(new Uint8Array(digest));
}

/** セッション ID をサーバー保存用にハッシュ化する（生の ID は Cookie にのみ存在）。 */
export const hashSessionId = sha256Base64url;

/** PKCE code_verifier を生成する（43〜128 文字の base64url）。 */
export function createCodeVerifier(): string {
  return randomToken(32);
}

/** PKCE code_challenge（S256）= base64url(SHA-256(verifier))。 */
export function codeChallengeS256(verifier: string): Promise<string> {
  return sha256Base64url(verifier);
}

async function importAesKey(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToBytes(base64Key);
  if (raw.byteLength !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to 32 bytes (base64-encoded 256-bit key)");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** 平文を AES-256-GCM で暗号化し、base64url(iv(12B) || ciphertext) を返す。 */
export async function encryptString(base64Key: string, plaintext: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext)),
  );
  const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(cipher, iv.byteLength);
  return bytesToBase64url(combined);
}

/** encryptString で作った blob を復号する。改ざん・鍵不一致時は例外を投げる。 */
export async function decryptString(base64Key: string, blob: string): Promise<string> {
  const key = await importAesKey(base64Key);
  const combined = base64urlToBytes(blob);
  if (combined.byteLength <= 12) throw new Error("ciphertext too short");
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return decoder.decode(plain);
}
