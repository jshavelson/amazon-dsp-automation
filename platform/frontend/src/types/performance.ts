// Performance-related types
import type { FilterParams } from './common';

export interface PerformanceMetric {
  id: string;
  name: string;
  description: string;
  category: MetricCategory;
  unit: string;
  targetValue: number;
  minValue?: number;
  maxValue?: number;
  weight: number;
  isActive: boolean;
  calculationMethod: string;
  createdAt: string;
  updatedAt: string;
}

export type MetricCategory = 
  | 'delivery'
  | 'safety'
  | 'efficiency'
  | 'quality'
  | 'cost'
  | 'compliance';

export interface DriverPerformanceScore {
  driverId: string;
  driverName: string;
  period: string;
  metrics: PerformanceMetricScore[];
  overallScore: number;
  deliveryScore: number;
  safetyScore: number;
  efficiencyScore: number;
  qualityScore: number;
  costScore: number;
  complianceScore: number;
  rank: number;
  percentile: number;
  trend: PerformanceTrend;
  week?: string;
  year?: number;
  packagesPerHour?: number;
  milesPerHour?: number;
  routeCompletionRate?: number;
  overtimeHours?: number;
  fuelEfficiency?: number;
  score?: number;
  grade?: string;
  onTimeDeliveryRate?: number;
  safetyIncidents?: number;
  customerComplaints?: number;
}

export interface PerformanceMetricScore {
  metricId: string;
  metricName: string;
  category: MetricCategory;
  value: number;
  target: number;
  score: number;
  weight: number;
  weightedScore: number;
  status: PerformanceStatus;
}

export type PerformanceStatus = 'excellent' | 'good' | 'average' | 'below_average' | 'poor';

export type PerformanceTrend = 'improving' | 'stable' | 'declining' | 'new';

export interface TeamPerformance {
  teamId: string;
  teamName: string;
  period: string;
  driverCount: number;
  averageOverallScore: number;
  averageDeliveryScore: number;
  averageSafetyScore: number;
  averageEfficiencyScore: number;
  averageQualityScore: number;
  averageCostScore: number;
  averageComplianceScore: number;
  topPerformers: DriverPerformanceScore[];
  bottomPerformers: DriverPerformanceScore[];
  trend: PerformanceTrend;
}

export interface DSPPerformance {
  dspId: string;
  period: string;
  overallScore: number;
  deliveryScore: number;
  safetyScore: number;
  efficiencyScore: number;
  qualityScore: number;
  costScore: number;
  complianceScore: number;
  driverCount: number;
  vanCount: number;
  routeCount: number;
  totalMiles: number;
  totalDeliveries: number;
  onTimeDeliveryRate: number;
  customerSatisfaction: number;
  costPerDelivery: number;
  profitMargin: number;
  safetyIncidentRate: number;
  retentionRate: number;
  utilizationRate: number;
}

export interface PerformanceFilterParams extends FilterParams {
  driverId?: string;
  teamId?: string;
  metricCategory?: MetricCategory;
  period?: string;
  minScore?: number;
  maxScore?: number;
}

export interface PerformanceDashboard {
  period: string;
  dspPerformance: DSPPerformance;
  teamPerformance: TeamPerformance[];
  topDrivers: DriverPerformanceScore[];
  bottomDrivers: DriverPerformanceScore[];
  metricTrends: MetricTrend[];
  scoreDistribution: ScoreDistribution;
}

export interface MetricTrend {
  metricId: string;
  metricName: string;
  category: MetricCategory;
  periods: TrendPeriod[];
}

export interface TrendPeriod {
  period: string;
  value: number;
  target: number;
  score: number;
}

export interface ScoreDistribution {
  excellent: number;
  good: number;
  average: number;
  belowAverage: number;
  poor: number;
  total: number;
}

export interface PerformanceAlert {
  id: string;
  driverId: string;
  driverName: string;
  metricId: string;
  metricName: string;
  category: MetricCategory;
  alertType: AlertType;
  currentValue: number;
  targetValue: number;
  threshold: number;
  severity: AlertSeverity;
  message: string;
  triggeredAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

export type AlertType = 
  | 'below_target'
  | 'above_target'
  | 'trending_down'
  | 'trending_up'
  | 'out_of_range';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface PerformanceComparison {
  entityType: 'driver' | 'team' | 'dsp';
  entityId: string;
  entityName: string;
  period: string;
  currentPeriod: PerformancePeriodData;
  previousPeriod: PerformancePeriodData;
  samePeriodLastYear?: PerformancePeriodData;
  industryBenchmark?: PerformancePeriodData;
}

export interface PerformancePeriodData {
  period: string;
  overallScore: number;
  deliveryScore: number;
  safetyScore: number;
  efficiencyScore: number;
  qualityScore: number;
  costScore: number;
  complianceScore: number;
}
