import { describe, expect, it } from 'vitest';
import { canResendInvitation, isValidInvitation } from './AccessAdminPage';

describe('add user validation', () => {
  const roles = ['admin', 'reviewer', 'analyst', 'viewer'];

  it('accepts a complete tenant invitation', () => {
    expect(isValidInvitation({ givenName: 'Alex', familyName: 'Driver', email: 'alex@example.com', role: 'viewer', roles })).toBe(true);
  });

  it('rejects missing names, invalid email, and unauthorized roles', () => {
    expect(isValidInvitation({ givenName: '', familyName: 'Driver', email: 'alex@example.com', role: 'viewer', roles })).toBe(false);
    expect(isValidInvitation({ givenName: 'Alex', familyName: 'Driver', email: 'invalid', role: 'viewer', roles })).toBe(false);
    expect(isValidInvitation({ givenName: 'Alex', familyName: 'Driver', email: 'alex@example.com', role: 'owner', roles })).toBe(false);
  });
});

describe('invitation resend visibility', () => {
  it('is available only while a membership is still invited', () => {
    expect(canResendInvitation({ status: 'invited' })).toBe(true);
    expect(canResendInvitation({ status: 'active' })).toBe(false);
    expect(canResendInvitation({ status: 'disabled' })).toBe(false);
  });
});
