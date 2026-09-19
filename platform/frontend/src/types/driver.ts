// Driver-related types

export interface Driver {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: DriverStatus;
  employmentType: EmploymentType;
  hireDate: string;
  terminationDate?: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  backgroundCheckStatus: BackgroundCheckStatus;
  drugTestStatus: DrugTestStatus;
  currentVanId?: string;
  homeStationId: string;
  teamId?: string;
  mentorId?: string;
  isMentor: boolean;
  performanceRating: number;
  reliabilityScore: number;
  safetyScore: number;
  totalRoutes: number;
  totalMiles: number;
  totalDeliveries: number;
  averageRouteCompletion: number;
  lastRouteDate?: string;
  notes?: string;
  emergencyContact: EmergencyContact;
  address: Address;
  createdAt: string;
  updatedAt: string;
}

export type DriverStatus = 
  | 'active'
  | 'on_leave'
  | 'terminated'
  | 'suspended'
  | 'pending_onboarding'
  | 'inactive';

export type EmploymentType = 
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'temporary';

export type BackgroundCheckStatus = 
  | 'pending'
  | 'cleared'
  | 'failed'
  | 'expired';

export type DrugTestStatus = 
  | 'pending'
  | 'passed'
  | 'failed'
  | 'expired';

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface DriverPerformance {
  driverId: string;
  week: string;
  year: number;
  onTimeDeliveryRate: number;
  packagesPerHour: number;
  milesPerHour: number;
  safetyIncidents: number;
  customerComplaints: number;
  routeCompletionRate: number;
  overtimeHours: number;
  fuelEfficiency: number;
  score: number;
  grade: PerformanceGrade;
}

export type PerformanceGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface DriverStats {
  driverId: string;
  totalRoutes: number;
  totalMiles: number;
  totalDeliveries: number;
  totalStops: number;
  averageRouteTime: number;
  averageMilesPerRoute: number;
  averageDeliveriesPerRoute: number;
  onTimePercentage: number;
  safetyIncidentCount: number;
  customerComplaintCount: number;
  fuelEfficiency: number;
  overtimeHours: number;
}

export interface DriverAvailability {
  driverId: string;
  date: string;
  available: boolean;
  shiftPreference?: ShiftPreference;
  notes?: string;
}

export type ShiftPreference = 
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'any';

export interface DriverDocument {
  id: string;
  driverId: string;
  documentType: DocumentType;
  fileName: string;
  fileUrl: string;
  expirationDate?: string;
  status: DocumentStatus;
  uploadedAt: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

export type DocumentType = 
  | 'license'
  | 'background_check'
  | 'drug_test'
  | 'medical_card'
  | 'insurance'
  | 'w4'
  | 'i9'
  | 'other';

export type DocumentStatus = 
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'expired';

export interface DriverFilterParams extends FilterParams {
  status?: DriverStatus;
  employmentType?: EmploymentType;
  homeStationId?: string;
  teamId?: string;
  minPerformanceRating?: number;
  search?: string;
}

export interface CreateDriverRequest {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employmentType: EmploymentType;
  hireDate: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  homeStationId: string;
  teamId?: string;
  mentorId?: string;
  emergencyContact: EmergencyContact;
  address: Address;
  notes?: string;
}

export interface UpdateDriverRequest extends Partial<CreateDriverRequest> {
  id: string;
  status?: DriverStatus;
  terminationDate?: string;
  isMentor?: boolean;
}
