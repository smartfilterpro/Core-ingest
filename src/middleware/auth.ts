import type { Request, Response, NextFunction } from 'express';
import { verifyCoreToken } from '../utils/jwt';
import pino from 'pino';

const log = pino({ name: 'auth' });

const AUTH_REQUIRED = (process.env.AUTH_REQUIRED || 'true') === 'true';

export interface AuthedRequest extends Request {
  auth?: {
    sub?: string | number;
    iss?: string;
    aud?: string | string[];
    raw?: any;
  };
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!AUTH_REQUIRED) return next();

  try {
    // Accept either Authorization: Bearer <token> or x-core-token: <token>
    const authz = req.header('authorization');
    let token = '';
    if (authz && authz.toLowerCase().startsWith('bearer ')) {
      token = authz.slice(7).trim();
    } else if (req.header('x-core-token')) {
      token = String(req.header('x-core-token'));
    }

    if (!token) {
      log.warn({ path: req.path }, 'Missing core_token');
      return res.status(401).json({ ok: false, error: 'Unauthorized: missing core_token' });
    }

    // 1️⃣ Legacy static CORE_API_KEY support
    const coreApiKey = process.env.CORE_API_KEY;
    if (coreApiKey && token === coreApiKey) {
      log.info({ path: req.path }, 'Authorized via static CORE_API_KEY');
      req.auth = {
        sub: 'api_key',
        iss: 'static',
        aud: 'core',
        raw: { method: 'api_key' }
      };
      return next();
    }

    // 2️⃣ JWT verification
    const payload = await verifyCoreToken(token);
    // Optional logging (trim large payloads)
    log.info(
      {
        path: req.path,
        iss: payload.iss,
        aud: payload.aud,
        sub: payload.sub,
        iat: payload.iat,
        exp: payload.exp
      },
      'core_token verified'
    );

    req.auth = {
      sub: payload.sub as string,
      iss: payload.iss as string,
      aud: payload.aud as string | string[],
      raw: payload
    };

    return next();
  } catch (err: any) {
    log.warn({ path: req.path, err: err?.message }, 'core_token verify failed');
    return res.status(401).json({ ok: false, error: 'Unauthorized: invalid core_token' });
    }
}
