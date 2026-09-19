import { api } from './api';
import {
  FleetCost,
  FleetCostSummary,
  CostTrend,
  CostBudget,
  CostForecast,
  FuelCostAnalysis,
  MaintenanceCostAnalysis,
  CostFilterParams,
  CreateFleetCostRequest,
} from '@/types/fleet-costs';
import { DriverPerformance } from '@/types/driver';
import { RouteMetrics } from '@/types/route';
import { DisputeStats, DisputeTrend } from '@/types/dispute';
import { PayrollSummary } from '@/types/payroll';
import { PaginatedResponse } from '@/types/common';

const ANALYTICS_ENDPOINTS = {
  FLEET_COSTS: '/fleet-costs',
  FLEET_COSTS_SUMMARY: '/fleet-costs/summary',
  FLEET_COSTS_FUEL: '/fleet-costs/fuel-analysis',
  FLEET_COSTS_MAINTENANCE: '/fleet-costs/maintenance-analysis',
  FLEET_COSTS_TRENDS: '/fleet-costs/trends',
  FLEET_COSTS_BUDGETS: '/fleet-costs/budgets',
  FLEET_COSTS_FORECASTS: '/fleet-costs/forecasts',
  DASHBOARD_OVERVIEW: '/dashboard/overview',
  DASHBOARD_KPIS: '/dashboard/kpis',
  DASHBOARD_CHARTS: '/dashboard/charts',
  DASHBOARD_RECENT_ACTIVITY: '/dashboard/recent-activity',
  PERFORMANCE_DASHBOARD: '/performance/dashboard',
  PERFORMANCE_METRICS: '/performance/metrics',
  PERFORMANCE_TRENDS: '/performance/trends',
  DISPUTE_STATS: '/disputes/stats',
  DISPUTE_TRENDS: '/disputes/trends',
};

export const analyticsService = {
  // Fleet Costs Analytics
  /**
   * Get all fleet costs with filtering
   */
  async getFleetCosts(params?: CostFilterParams): Promise<PaginatedResponse<FleetCost>> {
    const response = await api.get<PaginatedResponse<FleetCost>>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS,
      params
    );
    return response;
  },

  /**
   * Get fleet cost by ID
   */
  async getFleetCostById(id: string): Promise<FleetCost> {
    const response = await api.get<FleetCost>(`${ANALYTICS_ENDPOINTS.FLEET_COSTS}/${id}`);
    return response;
  },

  /**
   * Create a fleet cost record
   */
  async createFleetCost(data: CreateFleetCostRequest): Promise<FleetCost> {
    const response = await api.post<FleetCost>(ANALYTICS_ENDPOINTS.FLEET_COSTS, data);
    return response;
  },

  /**
   * Update a fleet cost record
   */
  async updateFleetCost(id: string, data: Partial<FleetCost>): Promise<FleetCost> {
    const response = await api.put<FleetCost>(
      `${ANALYTICS_ENDPOINTS.FLEET_COSTS}/${id}`,
      data
    );
    return response;
  },

  /**
   * Delete a fleet cost record
   */
  async deleteFleetCost(id: string): Promise<void> {
    await api.delete<void>(`${ANALYTICS_ENDPOINTS.FLEET_COSTS}/${id}`);
  },

  /**
   * Get fleet cost summary
   */
  async getFleetCostSummary(period?: string): Promise<FleetCostSummary> {
    const response = await api.get<FleetCostSummary>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS_SUMMARY,
      { period }
    );
    return response;
  },

  /**
   * Get fuel cost analysis
   */
  async getFuelCostAnalysis(period?: string): Promise<FuelCostAnalysis> {
    const response = await api.get<FuelCostAnalysis>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS_FUEL,
      { period }
    );
    return response;
  },

  /**
   * Get maintenance cost analysis
   */
  async getMaintenanceCostAnalysis(period?: string): Promise<MaintenanceCostAnalysis> {
    const response = await api.get<MaintenanceCostAnalysis>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS_MAINTENANCE,
      { period }
    );
    return response;
  },

  /**
   * Get cost trends
   */
  async getCostTrends(period?: string): Promise<CostTrend[]> {
    const response = await api.get<CostTrend[]>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS_TRENDS,
      { period }
    );
    return response;
  },

  /**
   * Get cost budgets
   */
  async getCostBudgets(period?: string): Promise<CostBudget[]> {
    const response = await api.get<CostBudget[]>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS_BUDGETS,
      { period }
    );
    return response;
  },

  /**
   * Get cost forecasts
   */
  async getCostForecasts(period?: string): Promise<CostForecast[]> {
    const response = await api.get<CostForecast[]>(
      ANALYTICS_ENDPOINTS.FLEET_COSTS_FORECASTS,
      { period }
    );
    return response;
  },

  // Dashboard Analytics
  /**
   * Get dashboard overview
   */
  async getDashboardOverview(): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(ANALYTICS_ENDPOINTS.DASHBOARD_OVERVIEW);
    return response;
  },

  /**
   * Get KPIs for dashboard
   */
  async getDashboardKPIs(period?: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(
      ANALYTICS_ENDPOINTS.DASHBOARD_KPIS,
      { period }
    );
    return response;
  },

  /**
   * Get chart data for dashboard
   */
  async getDashboardCharts(period?: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(
      ANALYTICS_ENDPOINTS.DASHBOARD_CHARTS,
      { period }
    );
    return response;
  },

  /**
   * Get recent activity
   */
  async getRecentActivity(limit?: number): Promise<Record<string, unknown>[]> {
    const response = await api.get<Record<string, unknown>[]>(
      ANALYTICS_ENDPOINTS.DASHBOARD_RECENT_ACTIVITY,
      { limit }
    );
    return response;
  },

  // Performance Analytics
  /**
   * Get performance dashboard data
   */
  async getPerformanceDashboard(period?: string): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(
      ANALYTICS_ENDPOINTS.PERFORMANCE_DASHBOARD,
      { period }
    );
    return response;
  },

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>(
      ANALYTICS_ENDPOINTS.PERFORMANCE_METRICS,
      params
    );
    return response;
  },

  // Dispute Analytics
  /**
   * Get dispute statistics
   */
  async getDisputeStats(): Promise<DisputeStats> {
    const response = await api.get<DisputeStats>(ANALYTICS_ENDPOINTS.DISPUTE_STATS);
    return response;
  },

  /**
   * Get dispute trends
   */
  async getDisputeTrends(period?: string): Promise<DisputeTrend[]> {
    const response = await api.get<DisputeTrend[]>(
      ANALYTICS_ENDPOINTS.DISPUTE_TRENDS,
      { period }
    );
    return response;
  },

  // Combined Analytics
  /**
   * Get comprehensive analytics overview
   */
  async getAnalyticsOverview(period?: string): Promise<Record<string, unknown>> {
    const [
      fleetCostSummary,
      fuelAnalysis,
      maintenanceAnalysis,
      costTrends,
      disputeStats,
      disputeTrends,
    ] = await Promise.all([
      this.getFleetCostSummary(period),
      this.getFuelCostAnalysis(period),
      this.getMaintenanceCostAnalysis(period),
      this.getCostTrends(period),
      this.getDisputeStats(),
      this.getDisputeTrends(period),
    ]);

    return {
      fleetCostSummary,
      fuelAnalysis,
      maintenanceAnalysis,
      costTrends,
      disputeStats,
      disputeTrends,
    };
  },

  /**
   * Get cost breakdown by category
   */
  async getCostBreakdownByCategory(period?: string): Promise<Record<string, number>> {
    const summary = await this.getFleetCostSummary(period);
    return summary.costByCategory;
  },

  /**
   * Get cost breakdown by van
   */
  async getCostBreakdownByVan(period?: string): Promise<Record<string, number>> {
    const summary = await this.getFleetCostSummary(period);
    const breakdown: Record<string, number> = {};
    summary.costByVan?.forEach((van) => {
      breakdown[van.vanId] = van.totalCost;
    });
    return breakdown;
  },

  /**
   * Get cost breakdown by driver
   */
  async getCostBreakdownByDriver(period?: string): Promise<Record<string, number>> {
    const summary = await this.getFleetCostSummary(period);
    const breakdown: Record<string, number> = {};
    summary.costByDriver?.forEach((driver) => {
      breakdown[driver.driverId] = driver.totalCost;
    });
    return breakdown;
  },
};

export default analyticsService;
