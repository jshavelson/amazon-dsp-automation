const SECRET_REF = /^secret:\/\/([a-z][a-z0-9-]{2,62})\/([a-z][a-z0-9-]{2,62})\/([a-z][a-z0-9-]{1,62})\/([a-zA-Z0-9._-]{1,128})$/;

export function parseSecretReference(value) {
  const match = SECRET_REF.exec(value || '');
  if (!match) throw new Error('invalid secret reference');
  const [, tenantId, provider, integration, name] = match;
  return Object.freeze({ tenantId, provider, integration, name, value });
}

export function assertTenantSecretReference(value, tenantId) {
  const parsed = parseSecretReference(value);
  if (parsed.tenantId !== tenantId) throw new Error('cross-tenant secret reference denied');
  return parsed;
}

export function redactSecretReference(value) {
  const parsed = parseSecretReference(value);
  return `secret://${parsed.tenantId}/${parsed.provider}/${parsed.integration}/***`;
}
