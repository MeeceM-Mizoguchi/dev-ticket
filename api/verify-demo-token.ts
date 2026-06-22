import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHmac } from 'crypto';

const TOKEN_SECRET = process.env.DEMO_TOKEN_SECRET ?? 'demo-secret-change-me';

export default function handler(req: VercelRequest, res: VercelResponse) {
  const { t } = req.query;
  if (typeof t !== 'string' || !t) {
    return res.status(400).json({ valid: false, reason: 'missing token' });
  }

  try {
    const decoded = Buffer.from(t, 'base64url').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 3) {
      return res.status(400).json({ valid: false, reason: 'malformed token' });
    }
    const [expiry, nonce, sig] = parts;
    const payload = `${expiry}:${nonce}`;
    const expected = createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
    if (expected !== sig) {
      return res.status(401).json({ valid: false, reason: 'invalid signature' });
    }
    if (Date.now() > Number(expiry)) {
      return res.status(401).json({ valid: false, reason: 'token expired' });
    }
    return res.status(200).json({ valid: true });
  } catch {
    return res.status(400).json({ valid: false, reason: 'decode error' });
  }
}
