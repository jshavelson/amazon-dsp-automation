import { api } from './api';
import {
  Route,
  RouteStop,
  RoutePackage,
  RouteMetrics,
  RouteOptimization,
  RouteFilterParams,
  CreateRouteRequest,
  CreateRouteStopRequest,
  CreateRoutePackageRequest,
} from '@/types/route';
import { PaginatedResponse } from '@/types/common';

const ROUTE_ENDPOINTS = {
  BASE: '/routes',
  STOPS: (routeId: string) => `/routes/${routeId}/stops`,
  METRICS: (routeId: string) => `/routes/${routeId}/metrics`,
  OPTIMIZE: (routeId: string) => `/routes/${routeId}/optimize`,
  PACKAGES: (routeId: string) => `/routes/${routeId}/packages`,
};

export const routeService = {
  /**
   * Get all routes with optional filtering and pagination
   */
  async getAllRoutes(params?: RouteFilterParams): Promise<PaginatedResponse<Route>> {
    const response = await api.get<PaginatedResponse<Route>>(ROUTE_ENDPOINTS.BASE, params);
    return response;
  },

  /**
   * Get a single route by ID
   */
  async getRouteById(id: string): Promise<Route> {
    const response = await api.get<Route>(`${ROUTE_ENDPOINTS.BASE}/${id}`);
    return response;
  },

  /**
   * Create a new route
   */
  async createRoute(data: CreateRouteRequest): Promise<Route> {
    const response = await api.post<Route>(ROUTE_ENDPOINTS.BASE, data);
    return response;
  },

  /**
   * Update an existing route
   */
  async updateRoute(id: string, data: Partial<Route>): Promise<Route> {
    const response = await api.put<Route>(`${ROUTE_ENDPOINTS.BASE}/${id}`, data);
    return response;
  },

  /**
   * Delete a route
   */
  async deleteRoute(id: string): Promise<void> {
    await api.delete<void>(`${ROUTE_ENDPOINTS.BASE}/${id}`);
  },

  /**
   * Get all stops for a route
   */
  async getRouteStops(routeId: string): Promise<RouteStop[]> {
    const response = await api.get<RouteStop[]>(ROUTE_ENDPOINTS.STOPS(routeId));
    return response;
  },

  /**
   * Create a new stop for a route
   */
  async createRouteStop(routeId: string, data: CreateRouteStopRequest): Promise<RouteStop> {
    const response = await api.post<RouteStop>(ROUTE_ENDPOINTS.STOPS(routeId), data);
    return response;
  },

  /**
   * Update an existing stop
   */
  async updateRouteStop(
    routeId: string,
    stopId: string,
    data: Partial<RouteStop>
  ): Promise<RouteStop> {
    const response = await api.put<RouteStop>(
      `${ROUTE_ENDPOINTS.STOPS(routeId)}/${stopId}`,
      data
    );
    return response;
  },

  /**
   * Delete a stop from a route
   */
  async deleteRouteStop(routeId: string, stopId: string): Promise<void> {
    await api.delete<void>(`${ROUTE_ENDPOINTS.STOPS(routeId)}/${stopId}`);
  },

  /**
   * Get route metrics
   */
  async getRouteMetrics(routeId: string): Promise<RouteMetrics> {
    const response = await api.get<RouteMetrics>(ROUTE_ENDPOINTS.METRICS(routeId));
    return response;
  },

  /**
   * Optimize a route
   */
  async optimizeRoute(routeId: string): Promise<RouteOptimization> {
    const response = await api.post<RouteOptimization>(ROUTE_ENDPOINTS.OPTIMIZE(routeId));
    return response;
  },

  /**
   * Get all packages for a route
   */
  async getRoutePackages(routeId: string): Promise<RoutePackage[]> {
    const response = await api.get<RoutePackage[]>(ROUTE_ENDPOINTS.PACKAGES(routeId));
    return response;
  },

  /**
   * Update package status
   */
  async updatePackageStatus(
    routeId: string,
    packageId: string,
    status: string
  ): Promise<RoutePackage> {
    const response = await api.patch<RoutePackage>(
      `${ROUTE_ENDPOINTS.PACKAGES(routeId)}/${packageId}`,
      { status }
    );
    return response;
  },

  /**
   * Get routes by driver
   */
  async getRoutesByDriver(driverId: string): Promise<Route[]> {
    const response = await api.get<Route[]>(ROUTE_ENDPOINTS.BASE, { driverId });
    return response;
  },

  /**
   * Get routes by date
   */
  async getRoutesByDate(date: string): Promise<Route[]> {
    const response = await api.get<Route[]>(ROUTE_ENDPOINTS.BASE, { date });
    return response;
  },

  /**
   * Get routes by status
   */
  async getRoutesByStatus(status: string): Promise<Route[]> {
    const response = await api.get<Route[]>(ROUTE_ENDPOINTS.BASE, { status });
    return response;
  },

  /**
   * Get today's routes
   */
  async getTodaysRoutes(): Promise<Route[]> {
    const today = new Date().toISOString().split('T')[0];
    const response = await api.get<Route[]>(ROUTE_ENDPOINTS.BASE, { date: today });
    return response;
  },

  /**
   * Get active/in-progress routes
   */
  async getActiveRoutes(): Promise<Route[]> {
    const response = await api.get<Route[]>(ROUTE_ENDPOINTS.BASE, {
      status: 'in_progress',
    });
    return response;
  },
};

export default routeService;
