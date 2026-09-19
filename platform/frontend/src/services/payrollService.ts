import { api } from './api';
import {
  PayrollPeriod,
  PayrollRecord,
  PayrollSummary,
  PayrollBonus,
  PayrollDeduction,
  PayrollReimbursement,
  PayrollAdjustment,
  PayrollReport,
  PayrollFilterParams,
  CreatePayrollPeriodRequest,
  ProcessPayrollRequest,
} from '@/types/payroll';
import { PaginatedResponse } from '@/types/common';

const PAYROLL_ENDPOINTS = {
  PERIODS: '/payroll/periods',
  RECORDS: (periodId: string) => `/payroll/periods/${periodId}/records`,
  SUMMARY: (periodId: string) => `/payroll/periods/${periodId}/summary`,
  PROCESS: (periodId: string) => `/payroll/periods/${periodId}/process`,
  ADJUSTMENTS: (recordId: string) => `/payroll/records/${recordId}/adjustments`,
  REPORTS: (periodId: string) => `/payroll/periods/${periodId}/reports`,
  GENERATE_REPORT: (periodId: string) => `/payroll/periods/${periodId}/reports`,
};

export const payrollService = {
  /**
   * Get all payroll periods
   */
  async getPayrollPeriods(params?: Record<string, unknown>): Promise<PaginatedResponse<PayrollPeriod>> {
    const response = await api.get<PaginatedResponse<PayrollPeriod>>(
      PAYROLL_ENDPOINTS.PERIODS,
      params
    );
    return response;
  },

  /**
   * Get a single payroll period by ID
   */
  async getPayrollPeriodById(id: string): Promise<PayrollPeriod> {
    const response = await api.get<PayrollPeriod>(`${PAYROLL_ENDPOINTS.PERIODS}/${id}`);
    return response;
  },

  /**
   * Create a new payroll period
   */
  async createPayrollPeriod(data: CreatePayrollPeriodRequest): Promise<PayrollPeriod> {
    const response = await api.post<PayrollPeriod>(PAYROLL_ENDPOINTS.PERIODS, data);
    return response;
  },

  /**
   * Process a payroll period
   */
  async processPayrollPeriod(id: string, force?: boolean): Promise<PayrollPeriod> {
    const response = await api.post<PayrollPeriod>(
      PAYROLL_ENDPOINTS.PROCESS(id),
      { force }
    );
    return response;
  },

  /**
   * Get all payroll records for a period
   */
  async getPayrollRecords(
    periodId: string,
    params?: PayrollFilterParams
  ): Promise<PaginatedResponse<PayrollRecord>> {
    const response = await api.get<PaginatedResponse<PayrollRecord>>(
      PAYROLL_ENDPOINTS.RECORDS(periodId),
      params
    );
    return response;
  },

  /**
   * Get a single payroll record by ID
   */
  async getPayrollRecordById(periodId: string, recordId: string): Promise<PayrollRecord> {
    const response = await api.get<PayrollRecord>(
      `${PAYROLL_ENDPOINTS.RECORDS(periodId)}/${recordId}`
    );
    return response;
  },

  /**
   * Get payroll summary for a period
   */
  async getPayrollSummary(periodId: string): Promise<PayrollSummary> {
    const response = await api.get<PayrollSummary>(PAYROLL_ENDPOINTS.SUMMARY(periodId));
    return response;
  },

  /**
   * Create a payroll adjustment
   */
  async createPayrollAdjustment(
    recordId: string,
    data: Partial<PayrollAdjustment>
  ): Promise<PayrollAdjustment> {
    const response = await api.post<PayrollAdjustment>(
      PAYROLL_ENDPOINTS.ADJUSTMENTS(recordId),
      data
    );
    return response;
  },

  /**
   * Get all payroll reports for a period
   */
  async getPayrollReports(periodId: string): Promise<PayrollReport[]> {
    const response = await api.get<PayrollReport[]>(PAYROLL_ENDPOINTS.REPORTS(periodId));
    return response;
  },

  /**
   * Generate a payroll report
   */
  async generatePayrollReport(periodId: string, reportType: string): Promise<PayrollReport> {
    const response = await api.post<PayrollReport>(
      PAYROLL_ENDPOINTS.GENERATE_REPORT(periodId),
      { reportType }
    );
    return response;
  },

  /**
   * Get current/active payroll period
   */
  async getCurrentPayrollPeriod(): Promise<PayrollPeriod | null> {
    const response = await api.get<PayrollPeriod[]>(PAYROLL_ENDPOINTS.PERIODS, {
      status: 'open',
      limit: 1,
    });
    return response.data?.[0] || null;
  },

  /**
   * Get payroll records by driver
   */
  async getPayrollRecordsByDriver(
    driverId: string,
    params?: Record<string, unknown>
  ): Promise<PayrollRecord[]> {
    const response = await api.get<PayrollRecord[]>(
      PAYROLL_ENDPOINTS.RECORDS(''),
      { driverId, ...params }
    );
    return response;
  },

  /**
   * Lock a payroll period
   */
  async lockPayrollPeriod(id: string): Promise<PayrollPeriod> {
    const response = await api.patch<PayrollPeriod>(`${PAYROLL_ENDPOINTS.PERIODS}/${id}`, {
      isLocked: true,
    });
    return response;
  },

  /**
   * Get payroll periods by year
   */
  async getPayrollPeriodsByYear(year: number): Promise<PayrollPeriod[]> {
    const response = await api.get<PayrollPeriod[]>(PAYROLL_ENDPOINTS.PERIODS, { year });
    return response;
  },
};

export default payrollService;
