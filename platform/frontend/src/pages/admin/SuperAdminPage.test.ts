import { describe, expect, it } from 'vitest';
import { validTenantDraft } from './SuperAdminPage';

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
