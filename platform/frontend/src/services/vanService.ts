import { api } from './api';
import {
  Van,
  MaintenanceRecord,
  VanLocation,
  VanFuelLog,
  VanCostAnalysis,
  VanFilterParams,
  CreateVanRequest,
  UpdateVanRequest,
} from '@/types/van';
import { PaginatedResponse } from '@/types/common';

const VAN_ENDPOINTS = {
  BASE: '/vans',
  MAINTENANCE: (vanId: string) => `/vans/${vanId}/maintenance`,
  FUEL_LOGS: (vanId: string) => `/vans/${vanId}/fuel-logs`,
  LOCATION: (vanId: string) => `/vans/${vanId}/location`,
  COSTS: (vanId: string) => `/vans/${vanId}/costs`,
};

export const vanService = {
  /**
   * Get all vans with optional filtering and pagination
   */
  async getAllVans(params?: VanFilterParams): Promise<PaginatedResponse<Van>> {
    const response = await api.get<PaginatedResponse<Van>>(VAN_ENDPOINTS.BASE, params);
    return response;
  },

  /**
   * Get a single van by ID
   */
  async getVanById(id: string): Promise<Van> {
    const response = await api.get<Van>(`${VAN_ENDPOINTS.BASE}/${id}`);
    return response;
  },

  /**
   * Create a new van
   */
  async createVan(data: CreateVanRequest): Promise<Van> {
    const response = await api.post<Van>(VAN_ENDPOINTS.BASE, data);
    return response;
  },

  /**
   * Update an existing van
   */
  async updateVan(id: string, data: UpdateVanRequest): Promise<Van> {
    const response = await api.put<Van>(`${VAN_ENDPOINTS.BASE}/${id}`, data);
    return response;
  },

  /**
   * Delete a van
   */
  async deleteVan(id: string): Promise<void> {
    await api.delete<void>(`${VAN_ENDPOINTS.BASE}/${id}`);
  },

  /**
   * Get maintenance records for a van
   */
  async getVanMaintenance(vanId: string): Promise<MaintenanceRecord[]> {
    const response = await api.get<MaintenanceRecord[]>(VAN_ENDPOINTS.MAINTENANCE(vanId));
    return response;
  },

  /**
   * Create a maintenance record for a van
   */
  async createVanMaintenance(vanId: string, data: Partial<MaintenanceRecord>): Promise<MaintenanceRecord> {
    const response = await api.post<MaintenanceRecord>(
      VAN_ENDPOINTS.MAINTENANCE(vanId),
      data
    );
    return response;
  },

  /**
   * Get fuel logs for a van
   */
  async getVanFuelLogs(vanId: string, params?: Record<string, unknown>): Promise<VanFuelLog[]> {
    const response = await api.get<VanFuelLog[]>(VAN_ENDPOINTS.FUEL_LOGS(vanId), params);
    return response;
  },

  /**
   * Create a fuel log for a van
   */
  async createVanFuelLog(vanId: string, data: Partial<VanFuelLog>): Promise<VanFuelLog> {
    const response = await api.post<VanFuelLog>(VAN_ENDPOINTS.FUEL_LOGS(vanId), data);
    return response;
  },

  /**
   * Get current location of a van
   */
  async getVanLocation(vanId: string): Promise<VanLocation> {
    const response = await api.get<VanLocation>(VAN_ENDPOINTS.LOCATION(vanId));
    return response;
  },

  /**
   * Get cost analysis for a van
   */
  async getVanCostAnalysis(vanId: string, period?: string): Promise<VanCostAnalysis> {
    const response = await api.get<VanCostAnalysis>(VAN_ENDPOINTS.COSTS(vanId), { period });
    return response;
  },

  /**
   * Get vans by status
   */
  async getVansByStatus(status: string): Promise<Van[]> {
    const response = await api.get<Van[]>(VAN_ENDPOINTS.BASE, { status });
    return response;
  },

  /**
   * Get available vans (active and not assigned)
   */
  async getAvailableVans(): Promise<Van[]> {
    const response = await api.get<Van[]>(VAN_ENDPOINTS.BASE, { 
      status: 'active',
      currentDriverId: null
    });
    return response;
  },

  /**
   * Update van status
   */
  async updateVanStatus(vanId: string, status: string): Promise<Van> {
    const response = await api.patch<Van>(`${VAN_ENDPOINTS.BASE}/${vanId}`, { status });
    return response;
  },
};

export default vanService;
