import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { ApiError } from '@/types/common';
import type { PaginatedResponse } from '@/types/common';
import type { Driver, DriverStats, DriverPerformance, DriverAvailability, DriverDocument } from '@/types/driver';
import type { User } from '@/types/auth';
import type { DriverPerformanceScore, TeamPerformance, DSPPerformance, PerformanceDashboard, PerformanceAlert, PerformanceComparison } from '@/types/performance';
import type { Dispute } from '@/types/dispute';
import type { PayrollPeriod, PayrollRecord, PayrollSummary } from '@/types/payroll';
import type { Route } from '@/types/route';
import type { Van, MaintenanceRecord } from '@/types/van';

// API Configuration
// Use relative path for Vite dev server proxy to work
const API_BASE_URL = '/api';
const API_TIMEOUT = 30000;

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('dsp-platform-id-token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
      config.headers['x-tenant-id'] = sessionStorage.getItem('dsp-active-tenant') || 'jecs';
      const supportSession = sessionStorage.getItem('dsp-support-session');
      if (supportSession) config.headers['x-support-session'] = supportSession;
    }
    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    // Handle specific error cases
    if (error.response) {
      const { status, data } = error.response;
      
      switch (status) {
        case 401:
          // Local development has an intentional no-token fallback. A stale
          // production/Cognito token must not cause a hard navigation loop
          // between /login and /dashboard while the local API is starting or
          // running without Cognito. AuthContext will establish the dev user.
          if (import.meta.env.DEV) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('token_expires_at');
            sessionStorage.removeItem('dsp-platform-id-token');
            sessionStorage.removeItem('dsp-platform-token-expiry');
            break;
          }
          // An expired or invalid support session must end impersonation without
          // destroying the platform administrator's primary Cognito session.
          if (sessionStorage.getItem('dsp-support-session')) {
            sessionStorage.removeItem('dsp-support-session');
            window.location.href = import.meta.env.PROD ? '/app/users' : '/users';
            break;
          }
          // Unauthorized - clear token and redirect to login
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          sessionStorage.removeItem('dsp-platform-id-token');
          sessionStorage.removeItem('dsp-platform-token-expiry');
          window.location.href = import.meta.env.PROD ? '/' : '/login';
          break;
        case 403:
          // Forbidden - user doesn't have permission
          console.error('Access forbidden:', data?.message || 'No permission');
          break;
        case 404:
          // Not found
          console.error('Resource not found:', data?.message || 'Not found');
          break;
        case 429:
          // Rate limiting
          console.error('Rate limited:', data?.message || 'Too many requests');
          break;
        case 500:
          // Server error
          console.error('Server error:', data?.message || 'Internal server error');
          break;
        default:
          console.error('API error:', data?.message || 'Unknown error');
      }
    } else if (error.request) {
      // Network error
      console.error('Network error:', error.message);
    }
    
    return Promise.reject(error);
  }
);

// Generic API methods
export const api = {
  get: async <T>(url: string, params?: object, config?: Record<string, unknown>): Promise<T> => {
    const response = await apiClient.get<T>(url, { params, ...config });
    return response.data;
  },

  post: async <T>(url: string, data?: unknown, config?: Record<string, unknown>): Promise<T> => {
    // FormData must keep the browser-generated multipart boundary, so the
    // instance-level JSON content type is removed for file uploads.
    const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
    const requestConfig = isFormData
      ? { ...config, headers: { ...(config?.headers as Record<string, string> | undefined), 'Content-Type': undefined } }
      : config;
    const response = await apiClient.post<T>(url, data, requestConfig);
    return response.data;
  },

  put: async <T>(url: string, data?: unknown, config?: Record<string, unknown>): Promise<T> => {
    const response = await apiClient.put<T>(url, data, config);
    return response.data;
  },

  patch: async <T>(url: string, data?: unknown, config?: Record<string, unknown>): Promise<T> => {
    const response = await apiClient.patch<T>(url, data, config);
    return response.data;
  },

  delete: async <T>(url: string, config?: Record<string, unknown>): Promise<T> => {
    const response = await apiClient.delete<T>(url, config);
    return response.data;
  },
};

// Auth API endpoints
export const authApi = {
  login: (credentials: { email: string; password: string; rememberMe?: boolean }) =>
    api.post<{ user: User; token: string; refreshToken: string; expiresIn: number }>('/auth/login', credentials),

  logout: () => api.post<void>('/auth/logout'),

  refreshToken: (refreshToken: string) =>
    api.post<{ token: string; refreshToken: string; expiresIn: number }>('/auth/refresh', { refreshToken }),

  getCurrentUser: () => api.get<User>('/auth/me'),

  forgotPassword: (email: string) => api.post<void>('/auth/forgot-password', { email }),

  resetPassword: (data: { token: string; password: string; confirmPassword: string }) =>
    api.post<void>('/auth/reset-password', data),

  register: (data: unknown) => api.post<void>('/auth/register', data),

  changePassword: (data: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
    api.post<void>('/auth/change-password', data),
};

// Driver API endpoints
export const driverApi = {
  getAll: (params?: object) => api.get<PaginatedResponse<Driver>>('/drivers', params),
  getById: (id: string) => api.get<Driver>(`/drivers/${id}`),
  create: (data: unknown) => api.post<unknown>('/drivers', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/drivers/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/drivers/${id}`),
  getPerformance: (driverId: string, period?: string) => 
    api.get<DriverPerformance>(`/drivers/${driverId}/performance`, { period }),
  getStats: (driverId: string) => api.get<DriverStats>(`/drivers/${driverId}/stats`),
  getAvailability: (driverId: string, date?: string) => 
    api.get<DriverAvailability>(`/drivers/${driverId}/availability`, { date }),
  updateAvailability: (driverId: string, data: unknown) => 
    api.put<unknown>(`/drivers/${driverId}/availability`, data),
  getDocuments: (driverId: string) => api.get<DriverDocument[]>(`/drivers/${driverId}/documents`),
  uploadDocument: (driverId: string, file: File, documentType: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    return api.post<unknown>(`/drivers/${driverId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Van API endpoints
export const vanApi = {
  getAll: (params?: object) => api.get<PaginatedResponse<Van>>('/vans', params),
  getById: (id: string) => api.get<Van>(`/vans/${id}`),
  create: (data: unknown) => api.post<unknown>('/vans', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/vans/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/vans/${id}`),
  getMaintenance: (vanId: string) => api.get<MaintenanceRecord[]>(`/vans/${vanId}/maintenance`),
  createMaintenance: (vanId: string, data: unknown) => 
    api.post<unknown>(`/vans/${vanId}/maintenance`, data),
  getFuelLogs: (vanId: string, params?: object) =>
    api.get<PaginatedResponse<unknown>>(`/vans/${vanId}/fuel-logs`, params),
  createFuelLog: (vanId: string, data: unknown) => 
    api.post<unknown>(`/vans/${vanId}/fuel-logs`, data),
  getLocation: (vanId: string) => api.get<unknown>(`/vans/${vanId}/location`),
  getCostAnalysis: (vanId: string, period?: string) => 
    api.get<unknown>(`/vans/${vanId}/costs`, { period }),
};

// Dispute API endpoints
export const disputeApi = {
  getAll: (params?: object) => api.get<PaginatedResponse<Dispute>>('/disputes', params),
  getById: (id: string) => api.get<Dispute>(`/disputes/${id}`),
  create: (data: unknown) => api.post<unknown>('/disputes', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/disputes/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/disputes/${id}`),
  submitToAmazon: (id: string) => api.post<unknown>(`/disputes/${id}/submit`),
  getStats: () => api.get<unknown>('/disputes/stats'),
  getTrends: (period?: string) => api.get<unknown>('/disputes/trends', { period }),
  uploadEvidence: (disputeId: string, file: File, evidenceType: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('evidenceType', evidenceType);
    return api.post<unknown>(`/disputes/${disputeId}/evidence`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Payroll API endpoints
export const payrollApi = {
  getPeriods: (params?: object) => api.get<PaginatedResponse<PayrollPeriod>>('/payroll/periods', params),
  getPeriodById: (id: string) => api.get<PayrollPeriod>(`/payroll/periods/${id}`),
  createPeriod: (data: unknown) => api.post<unknown>('/payroll/periods', data),
  processPeriod: (id: string, force?: boolean) => 
    api.post<unknown>(`/payroll/periods/${id}/process`, { force }),
  getRecords: (periodId: string, params?: object) =>
    api.get<PaginatedResponse<PayrollRecord>>(`/payroll/periods/${periodId}/records`, params),
  getRecordById: (periodId: string, recordId: string) => 
    api.get<PayrollRecord>(`/payroll/periods/${periodId}/records/${recordId}`),
  getSummary: (periodId: string) => api.get<PayrollSummary>(`/payroll/periods/${periodId}/summary`),
  createAdjustment: (recordId: string, data: unknown) => 
    api.post<unknown>(`/payroll/records/${recordId}/adjustments`, data),
  getReports: (periodId: string) => api.get<unknown>(`/payroll/periods/${periodId}/reports`),
  generateReport: (periodId: string, reportType: string) => 
    api.post<unknown>(`/payroll/periods/${periodId}/reports`, { reportType }),
  deletePeriod: (id: string) => api.delete<void>(`/payroll/periods/${id}`),
};

// Route API endpoints
export const routeApi = {
  getAll: (params?: object) => api.get<PaginatedResponse<Route>>('/routes', params),
  getById: (id: string) => api.get<Route>(`/routes/${id}`),
  create: (data: unknown) => api.post<unknown>('/routes', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/routes/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/routes/${id}`),
  getStops: (routeId: string) => api.get<unknown>(`/routes/${routeId}/stops`),
  createStop: (routeId: string, data: unknown) => 
    api.post<unknown>(`/routes/${routeId}/stops`, data),
  updateStop: (routeId: string, stopId: string, data: unknown) => 
    api.put<unknown>(`/routes/${routeId}/stops/${stopId}`, data),
  deleteStop: (routeId: string, stopId: string) => 
    api.delete<unknown>(`/routes/${routeId}/stops/${stopId}`),
  getMetrics: (routeId: string) => api.get<unknown>(`/routes/${routeId}/metrics`),
  optimize: (routeId: string) => api.post<unknown>(`/routes/${routeId}/optimize`),
  getPackages: (routeId: string) => api.get<unknown>(`/routes/${routeId}/packages`),
  updatePackageStatus: (routeId: string, packageId: string, status: string) => 
    api.patch<unknown>(`/routes/${routeId}/packages/${packageId}`, { status }),
};

// Performance API endpoints
export const performanceApi = {
  getDriverPerformance: (driverId: string, period?: string) => 
    api.get<DriverPerformanceScore>(`/performance/drivers/${driverId}`, { period }),
  getTeamPerformance: (teamId: string, period?: string) => 
    api.get<TeamPerformance>(`/performance/teams/${teamId}`, { period }),
  getDSPPerformance: (period?: string) => api.get<DSPPerformance>('/performance/dsp', { period }),
  getDashboard: (period?: string) => api.get<PerformanceDashboard>('/performance/dashboard', { period }),
  getMetrics: (params?: object) => api.get<unknown>('/performance/metrics', params),
  getAlerts: (params?: object) => api.get<PaginatedResponse<PerformanceAlert>>('/performance/alerts', params),
  getTrends: (metricId: string, period?: string) => 
    api.get<unknown>(`/performance/metrics/${metricId}/trends`, { period }),
  getComparisons: (entityType: string, entityId: string, period?: string) => 
    api.get<PerformanceComparison>(`/performance/${entityType}/${entityId}/comparisons`, { period }),
};

// Fleet Costs API endpoints
export const fleetCostApi = {
  getAll: (params?: Record<string, unknown>) => api.get<unknown>('/fleet-costs/records', params),
  getById: (id: string) => api.get<unknown>(`/fleet-costs/${id}`),
  create: (data: unknown) => api.post<unknown>('/fleet-costs', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/fleet-costs/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/fleet-costs/${id}`),
  getSummary: (period?: string) => api.get<unknown>('/fleet-costs/summary', { period }),
  getFuelAnalysis: (period?: string) => api.get<unknown>('/fleet-costs/fuel-analysis', { period }),
  getMaintenanceAnalysis: (period?: string) => 
    api.get<unknown>('/fleet-costs/maintenance-analysis', { period }),
  getTrends: (period?: string) => api.get<unknown>('/fleet-costs/trends', { period }),
  getBudgets: (period?: string) => api.get<unknown>('/fleet-costs/budgets', { period }),
  getForecasts: (period?: string) => api.get<unknown>('/fleet-costs/forecasts', { period }),
};

// Dashboard API endpoints
export const dashboardApi = {
  getOverview: () => api.get<unknown>('/dashboard/overview'),
  getKPIs: (period?: string) => api.get<unknown>('/dashboard/kpis', { period }),
  getCharts: (period?: string) => api.get<unknown>('/dashboard/charts', { period }),
  getRecentActivity: (limit?: number) => api.get<unknown>('/dashboard/recent-activity', { limit }),
  getNotifications: (limit?: number) => api.get<unknown>('/dashboard/notifications', { limit }),
};

// Station API endpoints
export const stationApi = {
  getAll: () => api.get<unknown>('/stations'),
  getById: (id: string) => api.get<unknown>(`/stations/${id}`),
  create: (data: unknown) => api.post<unknown>('/stations', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/stations/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/stations/${id}`),
};

// Team API endpoints
export const teamApi = {
  getAll: () => api.get<unknown>('/teams'),
  getById: (id: string) => api.get<unknown>(`/teams/${id}`),
  create: (data: unknown) => api.post<unknown>('/teams', data),
  update: (id: string, data: unknown) => api.put<unknown>(`/teams/${id}`, data),
  delete: (id: string) => api.delete<unknown>(`/teams/${id}`),
  getDrivers: (teamId: string) => api.get<unknown>(`/teams/${teamId}/drivers`),
  addDriver: (teamId: string, driverId: string) => 
    api.post<unknown>(`/teams/${teamId}/drivers`, { driverId }),
  removeDriver: (teamId: string, driverId: string) => 
    api.delete<unknown>(`/teams/${teamId}/drivers/${driverId}`),
};

// Export all API clients
export {
  apiClient,
  API_BASE_URL,
};
export default apiClient;
