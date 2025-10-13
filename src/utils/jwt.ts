import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

type Alg = 'HS256' | 'RS256';

const ALG = (process.env.CORE_JWT_ALG || 'HS256') as Alg;
const ISS = process.env.CORE_JWT_ISS || 'bubble.smartfilterpro';
const AUD = process.env.CORE_JWT_AUD || 'core.smartfilterpro';

let secretOrKey: Uint8Array | string;

if (ALG === 'HS256') {
  if (!process.env.CORE_JWT_SECRET) throw new Error('CORE_JWT_SECRET not set');
  secretOrKey = new TextEncoder().encode(process.env.CORE_JWT_SECRET);
} else if (ALG === 'RS256') {
  const pub = process.env.CORE_JWT_PUBLIC_KEY;
  if (!pub) throw new Error('CORE_JWT_PUBLIC_KEY not set');
  secretOrKey = pub; // PEM string
}

export async function verifyCoreToken(token: string): Promise<JWTPayload> {
  if (ALG === 'HS256') {
    const { payload } = await jwtVerify(token, secretOrKey as Uint8Array, {
      issuer: ISS,
      audience: AUD,
      algorithms: ['HS256']
    });
    return payload;
  } else {
    // RS256 with PEM public key
    const { payload } = await jwtVerify(token, await importPublicKey(secretOrKey as string), {
      issuer: ISS,
      audience: AUD,
      algorithms: ['RS256']
    });
    return payload;
  }
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  // @ts-ignore - subtle is available in Node >= 19 (Railway default images support this)
  return crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}
