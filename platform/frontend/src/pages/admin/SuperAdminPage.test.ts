import { describe, expect, it } from 'vitest';
import { validMemberDraft, validTenantDraft } from './SuperAdminPage';

describe('tenant provisioning validation', () => {
  it('accepts a complete tenant and owner identity', () => {
    expect(validTenantDraft({
      slug: 'new-dsp', displayName: 'New DSP', ownerEmail: 'owner@example.com',
      ownerGivenName: 'New', ownerFamilyName: 'Owner'
    })).toBe(true);
  });

  it('rejects unsafe slugs and invalid owner email', () => {
    expect(validTenantDraft({
      slug: '../other', displayName: 'Other', ownerEmail: 'not-an-email',
      ownerGivenName: 'New', ownerFamilyName: 'Owner'
    })).toBe(false);
  });
});

describe('tenant member validation', () => {
  it('requires a named member, valid email, and supported tenant role', () => {
    expect(validMemberDraft({ givenName: 'Alex', familyName: 'Driver', email: 'alex@example.com', role: 'viewer' })).toBe(true);
    expect(validMemberDraft({ givenName: '', familyName: 'Driver', email: 'invalid', role: 'root' })).toBe(false);
  });
});
