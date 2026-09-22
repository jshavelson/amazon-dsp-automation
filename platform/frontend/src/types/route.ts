// Route-related types
import type { FilterParams } from './common';

export interface Route {
  id: string;
  routeNumber: string;
  routeName: string;
  date: string;
  driverId: string;
  driverName: string;
  vanId: string;
  vanLicensePlate: string;
  status: RouteStatus;
  startTime: string;
  endTime?: string;
  plannedStartTime: string;
  plannedEndTime: string;
  actualStartTime?: string;
  actualEndTime?: string;
  startLocation: Location;
  endLocation: Location;
  totalStops: number;
  completedStops: number;
  totalPackages: number;
  deliveredPackages: number;
  totalMiles: number;
  actualMiles: number;
  plannedDuration: number; // minutes
  actualDuration?: number; // minutes
  breakDuration: number; // minutes
  onTimeDeliveryRate: number;
  routeTimeScore: number;
  deliveryCompletionRate: number;
  safetyIncidents: number;
  customerComplaints: number;
  fuelConsumption: number;
  fuelCost: number;
  tollCost: number;
  parkingCost: number;
  otherExpenses: number;
  totalExpenses: number;
  revenue: number;
  profit: number;
  notes?: string;
  weatherConditions?: string;
  trafficConditions?: string;
  createdAt: string;
  updatedAt: string;
}

export type RouteStatus = 
  | 'planned'
  | 'assigned'
  | 'in_progress'
  | 'on_break'
  | 'completed'
  | 'cancelled'
  | 'delayed'
  | 'rescheduled';

export interface Location {
  address: string;
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface RouteStop {
  id: string;
  routeId: string;
  stopNumber: number;
  stopType: StopType;
  location: Location;
  plannedArrivalTime: string;
  plannedDepartureTime: string;
  actualArrivalTime?: string;
  actualDepartureTime?: string;
  status: StopStatus;
  packages: RoutePackage[];
  totalPackages: number;
  deliveredPackages: number;
  stopDuration: number; // minutes
  actualStopDuration?: number; // minutes
  customerName?: string;
  customerPhone?: string;
  deliveryInstructions?: string;
  accessCode?: string;
  gateCode?: string;
  isBusiness: boolean;
  businessHours?: BusinessHours;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type StopType = 
  | 'delivery'
  | 'pickup'
  | 'break'
  | 'fuel'
  | 'rest'
  | 'meal'
  | 'other';

export type StopStatus = 
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'cancelled';

export interface BusinessHours {
  monday?: TimeRange[];
  tuesday?: TimeRange[];
  wednesday?: TimeRange[];
  thursday?: TimeRange[];
  friday?: TimeRange[];
  saturday?: TimeRange[];
  sunday?: TimeRange[];
  holidays?: Holiday[];
}

export interface TimeRange {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface Holiday {
  date: string;
  name: string;
  closed: boolean;
}

export interface RoutePackage {
  id: string;
  trackingNumber: string;
  packageType: PackageType;
  weight: number;
  dimensions: Dimensions;
  deliveryWindow?: TimeRange;
  status: PackageStatus;
  scanEvents: ScanEvent[];
  customerName?: string;
  customerPhone?: string;
  deliveryInstructions?: string;
  signatureRequired: boolean;
  insuranceAmount?: number;
  declaredValue?: number;
  notes?: string;
}

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: 'in' | 'cm';
}

export type PackageType = 
  | 'standard'
  | 'oversize'
  | 'fragile'
  | 'hazardous'
  | 'refrigerated'
  | 'express'
  | 'other';

export type PackageStatus = 
  | 'pending'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'exception';

export interface ScanEvent {
  id: string;
  packageId: string;
  eventType: ScanEventType;
  timestamp: string;
  location: Location;
  scannedBy?: string;
  notes?: string;
}

export type ScanEventType = 
  | 'pickup'
  | 'arrival_at_hub'
  | 'departure_from_hub'
  | 'arrival_at_stop'
  | 'out_for_delivery'
  | 'delivery_attempt'
  | 'delivered'
  | 'failed_delivery'
  | 'returned'
  | 'exception';

export interface RouteFilterParams extends FilterParams {
  driverId?: string;
  vanId?: string;
  status?: RouteStatus;
  date?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  minOnTimeRate?: number;
  maxOnTimeRate?: number;
  search?: string;
}

export interface RouteMetrics {
  routeId: string;
  onTimeDeliveryRate: number;
  packagesPerHour: number;
  milesPerHour: number;
  stopsPerHour: number;
  fuelEfficiency: number;
  costPerPackage: number;
  profitPerPackage: number;
  safetyScore: number;
}

export interface RouteOptimization {
  routeId: string;
  optimizedRoute: string[]; // ordered stop IDs
  originalDistance: number;
  optimizedDistance: number;
  distanceSaved: number;
  originalDuration: number;
  optimizedDuration: number;
  timeSaved: number;
  fuelSaved: number;
}

export interface CreateRouteRequest {
  routeNumber: string;
  routeName: string;
  date: string;
  driverId: string;
  vanId: string;
  plannedStartTime: string;
  plannedEndTime: string;
  startLocation: Location;
  endLocation: Location;
  stops: CreateRouteStopRequest[];
  notes?: string;
}

export interface CreateRouteStopRequest {
  stopNumber: number;
  stopType: StopType;
  location: Location;
  plannedArrivalTime: string;
  plannedDepartureTime: string;
  packages?: CreateRoutePackageRequest[];
  customerName?: string;
  customerPhone?: string;
  deliveryInstructions?: string;
  isBusiness: boolean;
  businessHours?: BusinessHours;
}

export interface CreateRoutePackageRequest {
  trackingNumber: string;
  packageType: PackageType;
  weight: number;
  dimensions: Dimensions;
  deliveryWindow?: TimeRange;
  customerName?: string;
  signatureRequired: boolean;
  insuranceAmount?: number;
}
