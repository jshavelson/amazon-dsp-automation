const documentRoot = document;
const TOKEN_KEY = 'dsp-platform-id-token';
const EXPIRY_KEY = 'dsp-platform-token-expiry';
const VERIFIER_KEY = 'dsp-platform-pkce-verifier';
const STATE_KEY = 'dsp-platform-oauth-state';
const PKCE_CREATED_KEY = 'dsp-platform-pkce-created-at';

let authConfig;
let tenantContext;

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomValue(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function codeChallenge(verifier) {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

function currentToken() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiry = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
  if (!token || Date.now() >= expiry) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
    return null;
  }
  return token;
}

async function beginLogin() {
  const verifier = randomValue(48);
  const state = randomValue(32);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(PKCE_CREATED_KEY, String(Date.now()));
  // Some password-manager and managed-browser flows replace the browsing
  // context on the Cognito round trip. Keep one short-lived same-origin
  // fallback so the PKCE callback can still be completed safely.
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);
  localStorage.setItem(PKCE_CREATED_KEY, String(Date.now()));
  const url = new URL(authConfig.authorizationUrl);
  url.search = new URLSearchParams({
    client_id: authConfig.clientId,
    response_type: 'code',
    scope: authConfig.scopes.join(' '),
    redirect_uri: `${location.origin}/`,
    state,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier)
  });
  location.assign(url);
}

async function completeLogin(code, state) {
  const createdAt = Number(sessionStorage.getItem(PKCE_CREATED_KEY) || localStorage.getItem(PKCE_CREATED_KEY) || 0);
  const verifier = sessionStorage.getItem(VERIFIER_KEY) || localStorage.getItem(VERIFIER_KEY);
  const expectedState = sessionStorage.getItem(STATE_KEY) || localStorage.getItem(STATE_KEY);
  if (!verifier || state !== expectedState || Date.now() - createdAt > 10 * 60 * 1000) {
    throw new Error('Sign-in session expired. Select Sign in and complete one login attempt.');
  }
  const response = await fetch(authConfig.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: authConfig.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: `${location.origin}/`
    })
  });
  if (!response.ok) throw new Error('sign-in token exchange failed');
  const tokens = await response.json();
  if (!tokens.id_token) throw new Error('identity token missing');
  sessionStorage.setItem(TOKEN_KEY, tokens.id_token);
  sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + Math.max(60, Number(tokens.expires_in || 3600) - 30) * 1000));
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(PKCE_CREATED_KEY);
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
  localStorage.removeItem(PKCE_CREATED_KEY);
  history.replaceState({}, '', '/');
}

async function api(path, options = {}) {
  const token = currentToken();
  if (!token) throw new Error('sign-in required');
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      'x-tenant-id': authConfig.tenantSlug,
      ...(options.headers || {})
    }
  });
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
  }
  if (!response.ok) throw new Error(`request failed (${response.status})`);
  return response;
}

function renderContext(context) {
  tenantContext = context;
  const visible = new Map(context.modules.map((module) => [module.id, module]));
  for (const card of documentRoot.querySelectorAll('[data-module-id]')) {
    const module = visible.get(card.dataset.moduleId);
    const status = card.querySelector('.status');
    status.textContent = module ? 'Enabled' : 'Not licensed';
    status.dataset.state = module ? 'active' : 'unlicensed';
    card.querySelector('small').textContent = module ? `Licensed as ${module.billingSku}.` : 'Contact the account owner to enable this module.';
  }
  documentRoot.getElementById('status-time').textContent = `Signed in to ${context.tenant.name} as ${context.user.role}`;
  documentRoot.getElementById('session-status').textContent = `${context.user.email || 'Authenticated user'} · ${context.user.role}`;
  documentRoot.getElementById('session-button').textContent = 'Sign out';
  documentRoot.getElementById('dashboard-button').disabled = false;
  documentRoot.getElementById('dashboard-button').textContent = 'Open JECS dashboard';
  documentRoot.getElementById('pilot-dashboard-button').disabled = false;
}

async function openDashboard({ replaceCurrent = false } = {}) {
  if (replaceCurrent) {
    location.replace('/app/');
    return;
  }
  location.assign('/app/');
}

async function initialize() {
  authConfig = await fetch('/auth/config', { cache: 'no-store' }).then((response) => response.json());
  if (!authConfig.enabled) throw new Error('authentication is not configured');
  const params = new URLSearchParams(location.search);
  if (params.has('error')) throw new Error(params.get('error_description') || params.get('error'));
  if (params.has('code')) await completeLogin(params.get('code'), params.get('state'));
  const token = currentToken();
  if (token) {
    renderContext(await api('/api/context').then((response) => response.json()));
    await openDashboard({ replaceCurrent: true });
  }
}

documentRoot.getElementById('session-button').addEventListener('click', async () => {
  if (currentToken()) {
    sessionStorage.clear();
    location.reload();
  } else {
    await beginLogin();
  }
});
documentRoot.getElementById('dashboard-button').addEventListener('click', () => openDashboard());
documentRoot.getElementById('pilot-dashboard-button').addEventListener('click', () => openDashboard());

initialize().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown sign-in error';
  documentRoot.getElementById('status-time').textContent = message;
  documentRoot.getElementById('session-status').textContent = `Sign-in failed: ${message}`;
});
