export function isValidConnectorTenant(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{2,62}$/.test(value);
}

export function isBlockedBrowserHost(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '::1' || value.startsWith('127.')
    || value.startsWith('10.') || value.startsWith('192.168.') || value.startsWith('169.254.')
    || /^172\.(1[6-9]|2\d|3[01])\./.test(value);
}
