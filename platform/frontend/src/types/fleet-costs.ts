// Fleet Costs-related types
import type { FilterParams } from './common';

export interface FleetCost {
  id: string;
  costType: CostType;
  costCategory: CostCategory;
  description: string;
  amount: number;
  currency: string;
  date: string;
  period: string;
  vanId?: string;
  driverId?: string;
  routeId?: string;
  vendor: string;
  invoiceNumber?: string;
  receiptAttached: boolean;
  receiptUrl?: string;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentDate?: string;
  paymentReference?: string;
  status: CostStatus;
  allocatedTo: AllocationTarget;
  allocationMethod: AllocationMethod;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type CostType = 
  | 'fixed'
  | 'variable'
  | 'capital'
  | 'operating'
  | 'maintenance'
  | 'insurance'
  | 'fuel'
  | 'labor';

export type CostCategory = 
  | 'fuel'
  | 'maintenance'
  | 'insurance'
  | 'leasing'
  | 'depreciation'
  | 'tolls'
  | 'parking'
  | 'tires'
  | 'batteries'
  | 'repairs'
  | 'washes'
  | 'inspections'
  | 'registrations'
  | 'taxes'
  | 'financing'
  | 'storage'
  | 'equipment'
  | 'software'
  | 'training'
  | 'safety'
  | 'other';

export type CostStatus = 
  | 'pending'
  | 'approved'
  | 'paid'
  | 'reimbursed'
  | 'rejected'
  | 'cancelled';

export type AllocationTarget = 
  | 'dsp'
  | 'van'
  | 'driver'
  | 'route'
  | 'team';

export type AllocationMethod = 
  | 'direct'
  | 'per_mile'
  | 'per_hour'
  | 'per_route'
  | 'per_van'
  | 'per_driver'
  | 'percentage';

export type PaymentMethod = 
  | 'cash'
  | 'credit_card'
  | 'debit_card'
  | 'check'
  | 'bank_transfer'
  | 'company_card'
  | 'reimbursement';

export interface FleetCostSummary {
  period: string;
  totalCost: number;
  totalFixedCost: number;
  totalVariableCost: number;
  totalCapitalCost: number;
  totalOperatingCost: number;
  costByCategory: Record<CostCategory, number>;
  costByVan: VanCostSummary[];
  costByDriver: DriverCostSummary[];
  costPerMile: number;
  costPerDay: number;
  costPerRoute: number;
  costPerDelivery: number;
  fuelEfficiency: number;
  maintenanceCostPerMile: number;
}

export interface VanCostSummary {
  vanId: string;
  vanLicensePlate: string;
  totalCost: number;
  costByCategory: Record<CostCategory, number>;
  mileage: number;
  costPerMile: number;
  utilizationRate: number;
}

export interface DriverCostSummary {
  driverId: string;
  driverName: string;
  totalCost: number;
  costByCategory: Record<CostCategory, number>;
  milesDriven: number;
  hoursWorked: number;
  costPerMile: number;
  costPerHour: number;
}

export interface CostTrend {
  period: string;
  totalCost: number;
  costByCategory: Record<CostCategory, number>;
  costPerMile: number;
  costPerDelivery: number;
}

export interface CostBudget {
  id: string;
  period: string;
  category: CostCategory;
  budgetedAmount: number;
  actualAmount: number;
  variance: number;
  variancePercentage: number;
  status: BudgetStatus;
  notes?: string;
}

export type BudgetStatus = 'under_budget' | 'on_budget' | 'over_budget' | 'not_set';

export interface CostForecast {
  period: string;
  forecastedCost: number;
  forecastedCostByCategory: Record<CostCategory, number>;
  confidenceLevel: number;
  basedOn: ForecastBasis;
}

export type ForecastBasis = 
  | 'historical'
  | 'seasonal'
  | 'trend'
  | 'manual';

export interface CostFilterParams extends FilterParams {
  costType?: CostType;
  costCategory?: CostCategory;
  vanId?: string;
  driverId?: string;
  routeId?: string;
  vendor?: string;
  minAmount?: number;
  maxAmount?: number;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface CreateFleetCostRequest {
  costType: CostType;
  costCategory: CostCategory;
  description: string;
  amount: number;
  currency: string;
  date: string;
  period: string;
  vanId?: string;
  driverId?: string;
  routeId?: string;
  vendor: string;
  invoiceNumber?: string;
  taxAmount: number;
  paymentMethod: PaymentMethod;
  allocatedTo: AllocationTarget;
  allocationMethod: AllocationMethod;
  notes?: string;
}

export interface FuelCostAnalysis {
  period: string;
  totalFuelCost: number;
  totalGallons: number;
  averagePricePerGallon: number;
  totalMiles: number;
  fuelEfficiency: number; // miles per gallon
  costPerMile: number;
  byVan: VanFuelAnalysis[];
  byDriver: DriverFuelAnalysis[];
  trends: FuelTrend[];
}

export interface VanFuelAnalysis {
  vanId: string;
  vanLicensePlate: string;
  totalFuelCost: number;
  totalGallons: number;
  averagePricePerGallon: number;
  milesDriven: number;
  fuelEfficiency: number;
  costPerMile: number;
}

export interface DriverFuelAnalysis {
  driverId: string;
  driverName: string;
  totalFuelCost: number;
  totalGallons: number;
  milesDriven: number;
  fuelEfficiency: number;
}

export interface FuelTrend {
  period: string;
  averagePricePerGallon: number;
  totalGallons: number;
  totalMiles: number;
  fuelEfficiency: number;
}

export interface MaintenanceCostAnalysis {
  period: string;
  totalMaintenanceCost: number;
  byVan: VanMaintenanceAnalysis[];
  byCategory: Record<MaintenanceType, number>;
  averageCostPerMile: number;
  averageCostPerVan: number;
  trends: MaintenanceTrend[];
}

export interface VanMaintenanceAnalysis {
  vanId: string;
  vanLicensePlate: string;
  totalMaintenanceCost: number;
  mileage: number;
  maintenanceCount: number;
  costPerMile: number;
  byCategory: Record<MaintenanceType, number>;
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

export interface MaintenanceTrend {
  period: string;
  totalCost: number;
  maintenanceCount: number;
  averageCostPerMile: number;
}
