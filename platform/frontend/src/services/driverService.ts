import { api } from './api';
import {
  Driver,
  DriverPerformance,
  DriverStats,
  DriverAvailability,
  DriverDocument,
  DriverFilterParams,
  CreateDriverRequest,
  UpdateDriverRequest,
} from '@/types/driver';
import { PaginatedResponse } from '@/types/common';

const DRIVER_ENDPOINTS = {
  BASE: '/drivers',
  PERFORMANCE: (driverId: string) => `/drivers/${driverId}/performance`,
  STATS: (driverId: string) => `/drivers/${driverId}/stats`,
  AVAILABILITY: (driverId: string) => `/drivers/${driverId}/availability`,
  DOCUMENTS: (driverId: string) => `/drivers/${driverId}/documents`,
  UPLOAD_DOCUMENT: (driverId: string) => `/drivers/${driverId}/documents`,
};

export const driverService = {
  /**
   * Get all drivers with optional filtering and pagination
   */
  async getAllDrivers(params?: DriverFilterParams): Promise<PaginatedResponse<Driver>> {
    const response = await api.get<PaginatedResponse<Driver>>(DRIVER_ENDPOINTS.BASE, params);
    return response;
  },

  /**
   * Get a single driver by ID
   */
  async getDriverById(id: string): Promise<Driver> {
    const response = await api.get<Driver>(`${DRIVER_ENDPOINTS.BASE}/${id}`);
    return response;
  },

  /**
   * Create a new driver
   */
  async createDriver(data: CreateDriverRequest): Promise<Driver> {
    const response = await api.post<Driver>(DRIVER_ENDPOINTS.BASE, data);
    return response;
  },

  /**
   * Update an existing driver
   */
  async updateDriver(id: string, data: UpdateDriverRequest): Promise<Driver> {
    const response = await api.put<Driver>(`${DRIVER_ENDPOINTS.BASE}/${id}`, data);
    return response;
  },

  /**
   * Delete a driver
   */
  async deleteDriver(id: string): Promise<void> {
    await api.delete<void>(`${DRIVER_ENDPOINTS.BASE}/${id}`);
  },

  /**
   * Get driver performance for a specific period
   */
  async getDriverPerformance(driverId: string, period?: string): Promise<DriverPerformance> {
    const response = await api.get<DriverPerformance>(
      DRIVER_ENDPOINTS.PERFORMANCE(driverId),
      { period }
    );
    return response;
  },

  /**
   * Get driver statistics
   */
  async getDriverStats(driverId: string): Promise<DriverStats> {
    const response = await api.get<DriverStats>(DRIVER_ENDPOINTS.STATS(driverId));
    return response;
  },

  /**
   * Get driver availability
   */
  async getDriverAvailability(driverId: string, date?: string): Promise<DriverAvailability> {
    const response = await api.get<DriverAvailability>(
      DRIVER_ENDPOINTS.AVAILABILITY(driverId),
      { date }
    );
    return response;
  },

  /**
   * Update driver availability
   */
  async updateDriverAvailability(driverId: string, data: Partial<DriverAvailability>): Promise<DriverAvailability> {
    const response = await api.put<DriverAvailability>(
      DRIVER_ENDPOINTS.AVAILABILITY(driverId),
      data
    );
    return response;
  },

  /**
   * Get all documents for a driver
   */
  async getDriverDocuments(driverId: string): Promise<DriverDocument[]> {
    const response = await api.get<DriverDocument[]>(DRIVER_ENDPOINTS.DOCUMENTS(driverId));
    return response;
  },

  /**
   * Upload a document for a driver
   */
  async uploadDriverDocument(
    driverId: string,
    file: File,
    documentType: string
  ): Promise<DriverDocument> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    
    const response = await api.post<DriverDocument>(
      DRIVER_ENDPOINTS.UPLOAD_DOCUMENT(driverId),
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response;
  },

  /**
   * Search drivers by name or employee ID
   */
  async searchDrivers(query: string): Promise<Driver[]> {
    const response = await api.get<Driver[]>(DRIVER_ENDPOINTS.BASE, { search: query });
    return response;
  },
};

export default driverService;
