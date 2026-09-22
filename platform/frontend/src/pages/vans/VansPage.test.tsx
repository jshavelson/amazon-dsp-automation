import { describe, expect, it } from 'vitest';
import { normalizeVans } from './VansPage';

describe('normalizeVans', () => {
  it('accepts the production paginated response', () => {
    const vans = normalizeVans({
      data: [{
        id: 'fleet-1', vin: '1FTBW3XG7RKA10001', licensePlate: 'JECS-101',
        make: 'Ford', model: 'Transit', year: 2024, ownership: 'owned', status: 'active',
      }],
    });
    expect(vans).toHaveLength(1);
    expect(vans[0]).toMatchObject({ van_number: 'JECS-101', ownership: 'OWNED', status: 'ACTIVE' });
  });

  it('preserves the local bare-array response', () => {
    const vans = normalizeVans([{ id: 'fleet-2', van_number: 'CDV 2', vin: 'VIN2', ownership: 'AMAZON_OWNED', status: 'OPERATIONAL' }]);
    expect(vans[0]).toMatchObject({ van_number: 'CDV 2', ownership: 'AMAZON_OWNED', status: 'OPERATIONAL' });
  });
});
