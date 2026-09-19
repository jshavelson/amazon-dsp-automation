// Van/Fleet-related types

export interface Van {
  id: string;
  vin: string;
  licensePlate: string;
  make: string;
  model: string;
  year: number;
  type: VanType;
  ownership: OwnershipType;
  status: VanStatus;
  currentDriverId?: string;
  homeStationId: string;
  color: string;
  mileage: number;
  fuelType: FuelType;
  fuelCapacity: number;
  currentFuelLevel: number;
  maintenanceSchedule: MaintenanceSchedule;
  lastMaintenanceDate?: string;
  nextMaintenanceDate: string;
  lastInspectionDate?: string;
  nextInspectionDate: string;
  insuranceExpiration: string;
  registrationExpiration: string;
  gpsTrackerId?: string;
  dashcamId?: string;
  features: VanFeature[];
  dailyRate: number;
  hourlyRate: number;
  purchaseDate?: string;
  purchasePrice?: number;
  residualValue?: number;
  depreciationRate: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type VanType = 
  | 'cargo_van'
  | 'sprinter'
  | 'box_truck'
  | 'refrigerated'
  | 'electric';

export type OwnershipType = 
  | 'owned'
  | 'leased'
  | 'rented'
  | 'amazon_lmr';

export type VanStatus = 
  | 'active'
  | 'inactive'
  | 'maintenance'
  | 'inspection'
  | 'reserved'
  | 'retired';

export type FuelType = 
  | 'gasoline'
  | 'diesel'
  | 'electric'
  | 'hybrid'
  | 'cng';

export interface VanFeature {
  id: string;
  name: string;
  description: string;
  installedAt: string;
  lastServiceDate?: string;
}

export interface MaintenanceSchedule {
  oilChange: number; // miles
  tireRotation: number; // miles
  brakeInspection: number; // miles
  transmissionService: number; // miles
  coolantFlush: number; // miles
  batteryCheck: number; // months
  stateInspection: number; // months
}

export interface MaintenanceRecord {
  id: string;
  vanId: string;
  type: MaintenanceType;
  description: string;
  mileage: number;
  cost: number;
  vendor: string;
  invoiceNumber?: string;
  status: MaintenanceStatus;
  scheduledDate: string;
  completedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type MaintenanceType = 
  | 'oil_change'
  | 'tire_rotation'
  | 'tire_replacement'
  | 'brake_service'
  | 'transmission_service'
  | 'coolant_flush'
  | 'battery_replacement'
  | 'inspection'
  | 'repair'
  | 'recall'
  | 'other';

export type MaintenanceStatus = 
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface VanLocation {
  vanId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number;
  heading?: number;
  address?: string;
}

export interface VanFuelLog {
  id: string;
  vanId: string;
  date: string;
  fuelAmount: number;
  fuelCost: number;
  pricePerGallon: number;
  mileage: number;
  fuelType: FuelType;
  vendor: string;
  receiptNumber?: string;
  notes?: string;
  createdAt: string;
}

export interface VanCostAnalysis {
  vanId: string;
  period: string;
  totalCost: number;
  fuelCost: number;
  maintenanceCost: number;
  insuranceCost: number;
  depreciationCost: number;
  leaseCost?: number;
  rentalCost?: number;
  costPerMile: number;
  costPerDay: number;
  utilizationRate: number;
}

export interface VanFilterParams extends FilterParams {
  type?: VanType;
  ownership?: OwnershipType;
  status?: VanStatus;
  homeStationId?: string;
  minMileage?: number;
  maxMileage?: number;
  search?: string;
}

export interface CreateVanRequest {
  vin: string;
  licensePlate: string;
  make: string;
  model: string;
  year: number;
  type: VanType;
  ownership: OwnershipType;
  homeStationId: string;
  color: string;
  mileage: number;
  fuelType: FuelType;
  fuelCapacity: number;
  currentFuelLevel: number;
  insuranceExpiration: string;
  registrationExpiration: string;
  dailyRate: number;
  hourlyRate: number;
  purchaseDate?: string;
  purchasePrice?: number;
  features?: VanFeature[];
  notes?: string;
}

export interface UpdateVanRequest extends Partial<CreateVanRequest> {
  id: string;
  status?: VanStatus;
  currentDriverId?: string;
  nextMaintenanceDate?: string;
  nextInspectionDate?: string;
}
