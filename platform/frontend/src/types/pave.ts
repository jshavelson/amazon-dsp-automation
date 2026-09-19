// PAVE (Preventive Maintenance and Vehicle Evaluation) types

export interface PaveVehicle {
  id: string;
  vin: string;
  licensePlate: string;
  make: string;
  model: string;
  year: number;
  type: string;
  ownership: string;
  status: PaveVehicleStatus;
  homeStationId: string;
  // PAVE-specific fields
  paveId: string;
  paveStatus: PaveStatus;
  lastPaveInspectionDate: string;
  nextPaveInspectionDue: string;
  paveScore: number; // 0-100
  complianceStatus: PaveComplianceStatus;
  // Wear and tear
  exteriorCondition: ConditionGrade;
  interiorCondition: ConditionGrade;
  mechanicalCondition: ConditionGrade;
  // Maintenance
  lastMaintenanceDate: string;
  lastMaintenanceType: string;
  nextMaintenanceDue: string;
  maintenanceHistory: PaveMaintenance[];
  // Inspection
  lastInspectionDate: string;
  lastInspectionResult: InspectionResult;
  inspectionHistory: PaveInspection[];
  // Costs
  maintenanceCostYTD: number;
  repairCostYTD: number;
  // Flags
  hasOpenRecalls: boolean;
  recallCount: number;
  hasSafetyIssues: boolean;
  safetyIssueCount: number;
  // Metadata
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
}

export type PaveVehicleStatus = 'active' | 'inactive' | 'maintenance' | 'inspection' | 'retired';

export type PaveStatus = 'green' | 'yellow' | 'red' | 'grey';

export type PaveComplianceStatus = 'compliant' | 'non_compliant' | 'conditional' | 'pending';

export type ConditionGrade = 'excellent' | 'good' | 'fair' | 'poor' | 'unacceptable';

export type InspectionResult = 'pass' | 'fail' | 'conditional' | 'pending';

export interface PaveInspection {
  id: string;
  vehicleId: string;
  vin: string;
  inspectionDate: string;
  inspectionType: InspectionType;
  inspector: string;
  result: InspectionResult;
  score: number; // 0-100
  notes: string;
  issuesFound: PaveIssue[];
  photos: string[]; // URLs
  status: string;
  createdAt: string;
  updatedAt: string;
}

export type InspectionType =
  | 'pre_trip'
  | 'post_trip'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'annual'
  | 'dmv'
  | 'safety'
  | 'pave'
  | 'other';

export interface PaveIssue {
  id: string;
  inspectionId: string;
  category: IssueCategory;
  severity: IssueSeverity;
  description: string;
  location: string;
  photoUrl?: string;
  status: IssueStatus;
  resolvedAt?: string;
  resolutionNotes?: string;
  costToRepair?: number;
}

export type IssueCategory =
  | 'exterior'
  | 'interior'
  | 'mechanical'
  | 'electrical'
  | 'safety'
  | 'tire'
  | 'brake'
  | 'other';

export type IssueSeverity = 'minor' | 'moderate' | 'major' | 'critical';

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'waived';

export interface PaveComplianceReport {
  reportId: string;
  generatedAt: string;
  period: string;
  totalVehicles: number;
  compliantVehicles: number;
  nonCompliantVehicles: number;
  complianceRate: number; // percentage
  vehicles: PaveComplianceVehicle[];
  summary: PaveComplianceSummary;
  recommendations: string[];
}

export interface PaveComplianceVehicle {
  vin: string;
  licensePlate: string;
  make: string;
  model: string;
  compliant: boolean;
  complianceIssues: string[];
  lastInspectionDate: string;
  nextInspectionDue: string;
  daysUntilInspection: number;
  paveScore: number;
}

export interface PaveComplianceSummary {
  byStatus: Record<PaveComplianceStatus, number>;
  bySeverity: Record<IssueSeverity, number>;
  byCategory: Record<IssueCategory, number>;
  topIssues: PaveIssue[];
}

export interface PaveWearAndTear {
  vin: string;
  inspectionDate: string;
  inspector: string;
  exterior: PaveConditionSection;
  interior: PaveConditionSection;
  mechanical: PaveConditionSection;
  overallScore: number; // 0-100
  lastInspectionDate: string;
  nextInspectionDue: string;
  photos: string[];
  notes: string;
}

export interface PaveConditionSection {
  condition: ConditionGrade;
  score: number; // 0-100
  issues: PaveWearAndTearIssue[];
  photos: string[];
}

export interface PaveWearAndTearIssue {
  id: string;
  category: string;
  description: string;
  severity: IssueSeverity;
  location: string;
  photoUrl?: string;
  recommendedAction: string;
  estimatedCost?: number;
}

export interface PaveMaintenance {
  id: string;
  vehicleId: string;
  vin: string;
  maintenanceType: MaintenanceType;
  description: string;
  mileage: number;
  cost: number;
  vendor: string;
  invoiceNumber?: string;
  status: MaintenanceStatus;
  scheduledDate: string;
  completedDate?: string;
  notes?: string;
  partsUsed: PavePart[];
  laborHours?: number;
  warrantyClaim?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MaintenanceType =
  | 'oil_change'
  | 'tire_rotation'
  | 'tire_replacement'
  | 'brake_service'
  | 'brake_replacement'
  | 'transmission_service'
  | 'coolant_flush'
  | 'battery_replacement'
  | 'inspection'
  | 'repair'
  | 'recall'
  | 'preventive'
  | 'other';

export type MaintenanceStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';

export interface PavePart {
  id: string;
  partNumber: string;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  vendor: string;
}

export interface PaveVehicleListResponse {
  items: PaveVehicle[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaveComplianceResponse {
  report: PaveComplianceReport;
}

// Wear and tear guideline types
export interface WearAndTearGuideline {
  category: string;
  acceptable: string[];
  unacceptable: string[];
  scoringCriteria: ScoringCriteria[];
}

export interface ScoringCriteria {
  description: string;
  score: number; // 0-100
  weight: number; // 0-1
}

export interface FleetComplianceDashboard {
  totalVehicles: number;
  compliantCount: number;
  nonCompliantCount: number;
  complianceRate: number;
  vehiclesNeedingAttention: PaveVehicle[];
  recentInspections: PaveInspection[];
  upcomingMaintenance: PaveMaintenance[];
  wearAndTearSummary: WearAndTearSummary;
}

export interface WearAndTearSummary {
  byCondition: Record<ConditionGrade, number>;
  averageScore: number;
  trending: 'improving' | 'stable' | 'declining';
}
