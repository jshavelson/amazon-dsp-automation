import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'dsp-platform-support';
const AUDIENCE = 'dsp-platform-impersonation';

export class ImpersonationService {
  #key;
  constructor(secret = crypto.randomBytes(32)) {
    this.#key = secret instanceof Uint8Array ? secret : new TextEncoder().encode(secret);
  }

  async create({ actor, tenantId, target, reason, durationMinutes = 15 }) {
    if (!actor?.isPlatformAdmin) throw new Error('platform administrator required');
    const duration = Math.min(Math.max(Number(durationMinutes) || 15, 5), 30);
    const token = await new SignJWT({
      actorSub: actor.userId,
      tenantId,
      targetSub: target.identitySubject,
      targetEmail: target.email,
      targetRole: target.role,
      reason
    }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer(ISSUER).setAudience(AUDIENCE)
      .setSubject(target.identitySubject).setIssuedAt().setExpirationTime(`${duration}m`).setJti(crypto.randomUUID()).sign(this.#key);
    return { token, expiresInSeconds: duration * 60 };
  }

  async verify(token, { actor, tenantId }) {
    if (!actor?.isPlatformAdmin) throw new Error('platform administrator required');
    const { payload } = await jwtVerify(token, this.#key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (payload.actorSub !== actor.userId || payload.tenantId !== tenantId) throw new Error('support session binding mismatch');
    if (!payload.targetSub || !payload.targetRole) throw new Error('invalid support session');
    return payload;
  }
}
