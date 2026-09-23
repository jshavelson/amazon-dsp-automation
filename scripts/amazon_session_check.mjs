#!/usr/bin/env node
const response = await fetch('http://127.0.0.1:8790/health', { signal: AbortSignal.timeout(90_000) }).catch((error) => {
  throw new Error(`Amazon persistent broker is unavailable: ${error.message}`);
});
const payload = await response.json();
if (!response.ok) throw new Error(payload.code === 'needs_reauth'
  ? 'Amazon requires sign-in or MFA. Run npm run amazon:login once to renew the persistent session.'
  : payload.error || 'Amazon persistent broker health check failed.');
console.log(JSON.stringify(payload, null, 2));
