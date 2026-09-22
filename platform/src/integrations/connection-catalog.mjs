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
    description: 'Pulls fleet charges directly from Digits without a monthly export.',
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
    description: 'Fleet assessments, LSC cases, invoices, and Amazon notices delivered by email.',
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
    description: 'One Amazon sign-in for Logistics, Payments, Fleet Portal, routes, scorecards, disputes, and reimbursements.',
    feeds: Object.freeze(['Weekly Evaluation', 'Driver Performance', 'Routes', 'Disputes', 'Fleet Compliance', 'Fleet Costs']),
    reauthNote: 'Amazon may revoke the shared session. Complete MFA once to restore all Amazon-backed feeds.',
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
    description: 'Fallback import for Digits, QuickBooks, CSV, or spreadsheet exports.',
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
