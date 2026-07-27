/**
 * 認証で使う暗号ユーティリティ（WebCrypto ベース）。
 * - state / PKCE verifier のランダム生成
 * - PKCE code_challenge（S256・NFR-4）
 * - GitHub トークンの AES-256-GCM 暗号化・復号（NFR-7）
 * - 鍵バージョン付きの封入・開封（トークン Cookie 用・鍵ローテーション可能・stateless-architecture.md §4）
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

/**
 * TOKEN_ENCRYPTION_KEY が有効（base64 で 32 バイトにデコードされる）かを返す。
 * 設定の自己診断（/api/ready）で使う。不正な鍵は暗号化時に例外→500 になるため事前検知する。
 */
export function isValidEncryptionKey(base64Key: string | undefined): boolean {
  if (!base64Key) return false;
  try {
    return base64ToBytes(base64Key).byteLength === 32;
  } catch {
    return false;
  }
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

/** 鍵バージョンとして表現できる範囲（先頭 1 バイトに埋め込む）。 */
export const MIN_KEY_VERSION = 1;
export const MAX_KEY_VERSION = 255;

/** 鍵バージョンが現行と異なる blob を開こうとしたときに送出する（＝再ログインが必要）。 */
export class KeyVersionMismatchError extends Error {
  readonly found: number;
  readonly expected: number;

  constructor(found: number, expected: number) {
    super(`key version mismatch: found ${found}, expected ${expected}`);
    this.name = "KeyVersionMismatchError";
    this.found = found;
    this.expected = expected;
  }
}

/** 鍵バージョンとして妥当な整数か（1〜255）。 */
export function isValidKeyVersion(version: number): boolean {
  return Number.isInteger(version) && version >= MIN_KEY_VERSION && version <= MAX_KEY_VERSION;
}

/**
 * 平文を「鍵バージョン付き」で封入する（トークン Cookie 用・stateless-architecture.md §4）。
 * 形式は `base64url( keyVersion(1B) || iv(12B) || AES-256-GCM(plaintext) )`。
 * 鍵バージョンは AAD として GCM の認証対象に含めるため、バージョンバイトだけを差し替える
 * 改ざんは復号時に検出される（バージョン混同攻撃の防止）。
 */
export async function sealVersioned(base64Key: string, keyVersion: number, plaintext: string): Promise<string> {
  if (!isValidKeyVersion(keyVersion)) {
    throw new Error(`key version must be an integer in ${MIN_KEY_VERSION}..${MAX_KEY_VERSION}`);
  }
  const key = await importAesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const version = new Uint8Array([keyVersion]);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: version }, key, encoder.encode(plaintext)),
  );
  const combined = new Uint8Array(1 + iv.byteLength + cipher.byteLength);
  combined.set(version, 0);
  combined.set(iv, 1);
  combined.set(cipher, 1 + iv.byteLength);
  return bytesToBase64url(combined);
}

/**
 * `sealVersioned` で作った blob を開封する。鍵バージョンが期待値と異なる場合は復号を試みずに
 * `KeyVersionMismatchError` を投げる（旧鍵で封入された Cookie は復号せず再ログインへ倒す）。
 * 改ざん・鍵不一致時も例外を投げる。
 */
export async function openVersioned(base64Key: string, keyVersion: number, blob: string): Promise<string> {
  const combined = base64urlToBytes(blob);
  if (combined.byteLength <= 1 + 12) throw new Error("sealed value too short");
  const found = combined[0];
  if (found !== keyVersion) throw new KeyVersionMismatchError(found, keyVersion);
  const key = await importAesKey(base64Key);
  const iv = combined.slice(1, 13);
  const cipher = combined.slice(13);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: new Uint8Array([found]) },
    key,
    cipher,
  );
  return decoder.decode(plain);
}
