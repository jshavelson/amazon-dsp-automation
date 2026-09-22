import { describe, expect, it } from 'vitest';
import { isFeatureAvailable, isRootTenant, type PlatformFeature } from './usePlatformContext';

const feature = (overrides: Partial<PlatformFeature> = {}): PlatformFeature => ({
  id: 'payroll',
  displayName: 'Payroll',
  route: '/payroll',
  status: 'implemented',
  permission: 'module.read',
  enabled: true,
  ...overrides,
});

describe('tenant feature visibility', () => {
  it('allows only implemented and enabled features', () => {
    expect(isFeatureAvailable(feature())).toBe(true);
    expect(isFeatureAvailable(feature({ enabled: false }))).toBe(false);
    expect(isFeatureAvailable(feature({ status: 'planned' }))).toBe(false);
    expect(isFeatureAvailable(undefined)).toBe(false);
  });

  it('identifies non-root tenant contexts for the header indicator', () => {
    expect(isRootTenant({ id: 'jecs', name: 'JEC Logistics Solutions' })).toBe(true);
    expect(isRootTenant({ id: 'funk', name: 'Funk' })).toBe(false);
  });
});
