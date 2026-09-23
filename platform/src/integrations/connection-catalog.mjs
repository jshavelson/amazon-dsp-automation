const field = (name, label, options = {}) => Object.freeze({
  name,
  label,
  secret: options.secret !== false,
  placeholder: options.placeholder || ''
});

export const CONNECTION_CATALOG = Object.freeze([
  Object.freeze({
    id: 'digits_api',
    displayName: 'Digits API',
    authKind: 'api_credentials',
    category: 'Unattended',
    schedule: 'Daily 06:00',
    description: 'Pulls the tenant’s actual fleet expenses from Digits. These charges are compared with Amazon Payments coverage; they never replace it.',
    feeds: Object.freeze(['Fleet Costs']),
    reauthNote: 'Replace the API client credentials if Digits revokes or rotates them.',
    credentialFields: Object.freeze([
      field('clientId', 'Client ID', { secret: false }),
      field('clientSecret', 'Client secret')
    ]),
    environments: Object.freeze(['development', 'production']),
    testable: true
  }),
  Object.freeze({
    id: 'adp',
    displayName: 'ADP Workforce',
    authKind: 'api_credentials',
    category: 'Unattended',
    schedule: 'Every 4 hours',
    description: 'Roster, timecards, and payroll registers.',
    feeds: Object.freeze(['Time & Attendance', 'Payroll', 'Workforce KPIs']),
    reauthNote: 'Certificate and OAuth provisioning are required before unattended synchronization.',
    credentialFields: Object.freeze([
      field('clientId', 'Client ID', { secret: false }),
      field('clientSecret', 'Client secret'),
      field('certificatePem', 'Client certificate (PEM)'),
      field('privateKeyPem', 'Private key (PEM)')
    ]),
    environments: Object.freeze(['production']),
    testable: false
  }),
  Object.freeze({
    id: 'email_imap',
    displayName: 'Report Email (IMAP)',
    authKind: 'imap_password',
    category: 'Unattended',
    schedule: 'Every 15 minutes',
    description: 'Scans Fleet Condition Assessment notices and LSC case correspondence. Email corroborates Cortex Supplemental Reports and PAVE; it is not the sole FCA source.',
    feeds: Object.freeze(['Fleet Compliance', 'Wear & Tear', 'LSC cases']),
    reauthNote: 'Replace the app password if the mailbox owner revokes it.',
    credentialFields: Object.freeze([
      field('host', 'IMAP host', { secret: false }),
      field('port', 'IMAP port', { secret: false }),
      field('username', 'Mailbox username', { secret: false }),
      field('appPassword', 'App password')
    ]),
    environments: Object.freeze(['production']),
    testable: false
  }),
  Object.freeze({
    id: 'amazon',
    displayName: 'Amazon DSP',
    authKind: 'browser_session',
    category: 'Amazon',
    schedule: 'Daily checks + weekly reports',
    description: 'Tenant-isolated managed browser for scorecards, Cortex Fleet Dashboard readiness, Cortex Payments coverage, Supplemental FCA reports, routes, disputes, and reimbursements.',
    feeds: Object.freeze(['Weekly Evaluation', 'Driver Performance', 'Routes', 'Disputes', 'Fleet Compliance', 'Fleet Costs']),
    reauthNote: 'Amazon may revoke a tenant browser session. The tenant owner completes MFA in a private, expiring reconnect session.',
    reconnectLabel: 'Amazon',
    credentialFields: Object.freeze([]),
    testable: false
  }),
  Object.freeze({
    id: 'pave',
    displayName: 'PAVE',
    authKind: 'browser_session',
    category: 'Fleet',
    schedule: 'Daily 04:00',
    description: 'Separate PAVE website connection for vehicle assessments, inspection evidence, and wear-and-tear results.',
    feeds: Object.freeze(['Vans', 'Fleet Compliance', 'Wear & Tear']),
    reauthNote: 'PAVE authentication is separate from Amazon. Reconnect when PAVE revokes the saved browser session.',
    reconnectLabel: 'PAVE',
    credentialFields: Object.freeze([
      field('username', 'PAVE username', { secret: false, placeholder: 'PAVE username' }),
      field('password', 'PAVE password', { placeholder: 'PAVE password' })
    ]),
    environments: Object.freeze(['production']),
    testable: false
  }),
  Object.freeze({
    id: 'financial_charges',
    displayName: 'Accounting export',
    authKind: 'manual_upload',
    category: 'Manual upload',
    schedule: 'On upload',
    description: 'Fallback source for actual fleet expenses when an accounting API is not connected. Accepts Digits, QuickBooks, CSV, or spreadsheet exports.',
    feeds: Object.freeze(['Fleet Costs']),
    reauthNote: 'No credentials required.',
    credentialFields: Object.freeze([]),
    acceptedProviders: Object.freeze(['Digits', 'QuickBooks', 'CSV or spreadsheet']),
    testable: false
  })
]);

export function connectionDefinition(id) {
  const definition = CONNECTION_CATALOG.find((item) => item.id === id);
  if (!definition) throw new Error('unknown integration');
  return definition;
}
