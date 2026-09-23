#!/usr/bin/env node
const response = await fetch('http://127.0.0.1:8790/sync/fleet-condition', {
  method: 'POST', signal: AbortSignal.timeout(240_000)
}).catch((error) => { throw new Error(`Amazon persistent broker is unavailable: ${error.message}`); });
const payload = await response.json();
if (!response.ok) throw new Error(payload.code === 'needs_reauth'
  ? 'Amazon session requires reauthentication'
  : payload.error || 'Amazon Fleet Condition sync failed');
console.log(JSON.stringify(payload));
