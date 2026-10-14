/**
 * Web Push (notifications on phones and computers), done with Node's own crypto: the message is
 * encrypted for the browser (RFC 8291, aes128gcm) and the request is signed with the server's
 * VAPID key (RFC 8292), so the browser's push service delivers it.
 */
import { createCipheriv, createECDH, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign, type ECDH } from "node:crypto";

export type VapidKeys = { publicKey: string; privateJwk: { kty: string; crv: string; x: string; y: string; d: string } };
export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

const b64u = (buffer: Buffer) => buffer.toString("base64url");
const fromB64u = (text: string) => Buffer.from(text, "base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** A new VAPID key pair: the public key (for the browser) and the private key (kept on the server). */
export function makeVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as VapidKeys["privateJwk"];
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])), privateJwk: jwk };
}

/** The signed "who's sending" header for this push service. */
export function vapidHeader(endpoint: string, keys: VapidKeys, contact: string, now = Date.now()) {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: createPrivateKey({ key: keys.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** The payload encrypted for one browser (a single aes128gcm record). */
export function encryptPayload(payload: Buffer, subscription: Subscription, salt = randomBytes(16), ecdh?: ECDH) {
  if (!ecdh) { ecdh = createECDH("prime256v1"); ecdh.generateKeys(); }
  const serverPublic = ecdh.getPublicKey();
  const clientPublic = fromB64u(subscription.keys.p256dh);
  const auth = fromB64u(subscription.keys.auth);
  const shared = ecdh.computeSecret(clientPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const key = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  // The last (and only) record ends with a 2.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = serverPublic.length;
  return Buffer.concat([head, serverPublic, body]);
}

/** Sends one notification. "gone" means the browser unsubscribed (forget it). */
export async function sendPush(subscription: Subscription, message: Record<string, unknown>, keys: VapidKeys, contact = "mailto:owner@localhost") {
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high", Authorization: vapidHeader(subscription.endpoint, keys, contact) },
    body: encryptPayload(Buffer.from(JSON.stringify(message)), subscription),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404 || response.status === 410) return "gone" as const;
  if (!response.ok) throw new Error(`Push failed: ${response.status}`);
  return "sent" as const;
}
