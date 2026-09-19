import { assertTenantSecretReference } from './secret-reference.mjs';

export class SecretResolver {
  #providers;

  constructor(providers = {}) {
    this.#providers = new Map(Object.entries(providers));
  }

  async withSecret({ tenantId, reference, purpose }, operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    if (!purpose || purpose.length < 3) throw new Error('secret access purpose is required');
    const parsed = assertTenantSecretReference(reference, tenantId);
    const provider = this.#providers.get(parsed.provider);
    if (!provider) throw new Error(`secret provider is not configured: ${parsed.provider}`);
    const secret = await provider.read(parsed, { tenantId, purpose });
    if (typeof secret !== 'string' || secret.length === 0) throw new Error('secret provider returned an empty value');
    try {
      return await operation(secret);
    } finally {
      // JavaScript strings cannot be reliably zeroed. Keep the value scoped to
      // this callback and never return, cache, serialize, or log it.
    }
  }
}

export class DisabledSecretProvider {
  async read() {
    throw new Error('managed secret storage is required');
  }
}
