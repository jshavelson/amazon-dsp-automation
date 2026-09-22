import { describe, expect, it } from 'vitest';
import { isValidInvitation } from './AccessAdminPage';

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
