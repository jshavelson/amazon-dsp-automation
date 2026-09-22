// Payroll-related types
import type { FilterParams } from './common';

export interface PayrollPeriod {
  id: string;
  startDate: string;
  endDate: string;
  periodName: string;
  year: number;
  week: number;
  status: PayrollStatus;
  isLocked: boolean;
  processedAt?: string;
  processedBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PayrollStatus = 
  | 'draft'
  | 'open'
  | 'processing'
  | 'processed'
  | 'locked'
  | 'paid'
  | 'reversed';

export interface PayrollRecord {
  id: string;
  payrollPeriodId: string;
  driverId: string;
  driverName: string;
  employeeId: string;
  baseHours: number;
  overtimeHours: number;
  doubleOvertimeHours: number;
  regularRate: number;
  overtimeRate: number;
  doubleOvertimeRate: number;
  basePay: number;
  overtimePay: number;
  doubleOvertimePay: number;
  bonuses: PayrollBonus[];
  deductions: PayrollDeduction[];
  reimbursements: PayrollReimbursement[];
  grossPay: number;
  netPay: number;
  taxWithholdings: TaxWithholdings;
  paymentMethod: PaymentMethod;
  paymentDate?: string;
  paymentReference?: string;
  status: PayrollRecordStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type PayrollRecordStatus = 
  | 'calculated'
  | 'reviewed'
  | 'approved'
  | 'paid'
  | 'adjusted'
  | 'voided';

export type PaymentMethod = 
  | 'direct_deposit'
  | 'check'
  | 'cash'
  | 'paycard';

export interface PayrollBonus {
  id: string;
  type: BonusType;
  description: string;
  amount: number;
  calculationBasis: CalculationBasis;
  rate?: number;
  hours?: number;
  units?: number;
}

export type BonusType = 
  | 'performance'
  | 'safety'
  | 'attendance'
  | 'referral'
  | 'holiday'
  | 'weekend'
  | 'night_shift'
  | 'hazard_pay'
  | 'retention'
  | 'sign_on'
  | 'fuel'
  | 'mileage'
  | 'other';

export type CalculationBasis = 
  | 'fixed'
  | 'hourly'
  | 'per_route'
  | 'per_delivery'
  | 'per_mile'
  | 'percentage';

export interface PayrollDeduction {
  id: string;
  type: DeductionType;
  description: string;
  amount: number;
  calculationBasis: CalculationBasis;
  rate?: number;
}

export type DeductionType = 
  | 'tax_federal'
  | 'tax_state'
  | 'tax_local'
  | 'social_security'
  | 'medicare'
  | 'health_insurance'
  | 'dental_insurance'
  | 'vision_insurance'
  | 'retirement_401k'
  | 'garnishment'
  | 'uniform'
  | 'equipment'
  | 'other';

export interface PayrollReimbursement {
  id: string;
  type: ReimbursementType;
  description: string;
  amount: number;
  receiptRequired: boolean;
  receiptAttached: boolean;
  receiptUrl?: string;
}

export type ReimbursementType = 
  | 'mileage'
  | 'tolls'
  | 'parking'
  | 'meals'
  | 'lodging'
  | 'phone'
  | 'equipment'
  | 'training'
  | 'other';

export interface TaxWithholdings {
  federal: number;
  state: number;
  local: number;
  socialSecurity: number;
  medicare: number;
  total: number;
}

export interface PayrollSummary {
  payrollPeriodId: string;
  totalDrivers: number;
  totalBaseHours: number;
  totalOvertimeHours: number;
  totalDoubleOvertimeHours: number;
  totalBasePay: number;
  totalOvertimePay: number;
  totalDoubleOvertimePay: number;
  totalBonuses: number;
  totalDeductions: number;
  totalReimbursements: number;
  totalGrossPay: number;
  totalNetPay: number;
  averagePayPerDriver: number;
  averageHoursPerDriver: number;
}

export interface PayrollFilterParams extends FilterParams {
  periodId?: string;
  driverId?: string;
  status?: PayrollRecordStatus;
  paymentMethod?: PaymentMethod;
  minGrossPay?: number;
  maxGrossPay?: number;
}

export interface CreatePayrollPeriodRequest {
  startDate: string;
  endDate: string;
  periodName: string;
  year: number;
  week: number;
  notes?: string;
}

export interface ProcessPayrollRequest {
  payrollPeriodId: string;
  force?: boolean;
}

export interface PayrollAdjustment {
  id: string;
  payrollRecordId: string;
  adjustmentType: AdjustmentType;
  description: string;
  amount: number;
  reason: string;
  approvedBy?: string;
  approvedAt?: string;
  status: AdjustmentStatus;
  createdAt: string;
  updatedAt: string;
}

export type AdjustmentType = 'addition' | 'deduction' | 'correction';

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'applied';

export interface PayrollReport {
  id: string;
  reportType: PayrollReportType;
  payrollPeriodId: string;
  generatedAt: string;
  generatedBy: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  recordCount: number;
}

export type PayrollReportType = 
  | 'summary'
  | 'detailed'
  | 'by_driver'
  | 'by_van'
  | 'tax_summary'
  | 'bonus_summary'
  | 'deduction_summary';
