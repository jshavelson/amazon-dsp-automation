import { createRemoteJWKSet, jwtVerify } from 'jose';

export class OidcAuthenticator {
  #audience;
  #issuer;
  #jwks;

  constructor({ issuer, audience, jwksUrl }) {
    this.#issuer = issuer;
    this.#audience = audience;
    this.#jwks = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, timeoutDuration: 5_000 });
  }

  async authenticate(authorization) {
    const match = /^Bearer\s+([^\s]+)$/i.exec(authorization || '');
    if (!match) throw new Error('bearer token required');
    const { payload, protectedHeader } = await jwtVerify(match[1], this.#jwks, {
      issuer: this.#issuer,
      audience: this.#audience,
      algorithms: ['RS256', 'ES256'],
      clockTolerance: 5
    });
    if (!payload.sub) throw new Error('token subject is required');
    return Object.freeze({
      subject: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : null,
      tokenId: typeof payload.jti === 'string' ? payload.jti : null,
      algorithm: protectedHeader.alg
    });
  }
}
