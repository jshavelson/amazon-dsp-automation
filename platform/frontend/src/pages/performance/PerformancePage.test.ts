import { describe, expect, it } from 'vitest';
import { formatPerformanceMetric } from './PerformancePage';

describe('formatPerformanceMetric', () => {
  it('formats available scorecard metrics', () => {
    expect(formatPerformanceMetric(95.4)).toBe('95.4');
    expect(formatPerformanceMetric(99.47, '%')).toBe('99.5%');
  });

  it('renders missing metrics safely instead of crashing the page', () => {
    expect(formatPerformanceMetric(undefined)).toBe('N/A');
    expect(formatPerformanceMetric(null)).toBe('N/A');
    expect(formatPerformanceMetric(Number.NaN)).toBe('N/A');
  });
});
