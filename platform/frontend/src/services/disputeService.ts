import { api } from './api';
import {
  Dispute,
  DisputeEvidence,
  DisputeStats,
  DisputeTrend,
  DisputeFilterParams,
  CreateDisputeRequest,
  UpdateDisputeRequest,
} from '@/types/dispute';
import { PaginatedResponse } from '@/types/common';

const DISPUTE_ENDPOINTS = {
  BASE: '/disputes',
  STATS: '/disputes/stats',
  TRENDS: '/disputes/trends',
  SUBMIT: (id: string) => `/disputes/${id}/submit`,
  EVIDENCE: (id: string) => `/disputes/${id}/evidence`,
};

export const disputeService = {
  /**
   * Get all disputes with optional filtering and pagination
   */
  async getAllDisputes(params?: DisputeFilterParams): Promise<PaginatedResponse<Dispute>> {
    const response = await api.get<PaginatedResponse<Dispute>>(DISPUTE_ENDPOINTS.BASE, params);
    return response;
  },

  /**
   * Get a single dispute by ID
   */
  async getDisputeById(id: string): Promise<Dispute> {
    const response = await api.get<Dispute>(`${DISPUTE_ENDPOINTS.BASE}/${id}`);
    return response;
  },

  /**
   * Create a new dispute
   */
  async createDispute(data: CreateDisputeRequest): Promise<Dispute> {
    const response = await api.post<Dispute>(DISPUTE_ENDPOINTS.BASE, data);
    return response;
  },

  /**
   * Update an existing dispute
   */
  async updateDispute(id: string, data: UpdateDisputeRequest): Promise<Dispute> {
    const response = await api.put<Dispute>(`${DISPUTE_ENDPOINTS.BASE}/${id}`, data);
    return response;
  },

  /**
   * Delete a dispute
   */
  async deleteDispute(id: string): Promise<void> {
    await api.delete<void>(`${DISPUTE_ENDPOINTS.BASE}/${id}`);
  },

  /**
   * Submit a dispute to Amazon
   */
  async submitDisputeToAmazon(id: string): Promise<Dispute> {
    const response = await api.post<Dispute>(DISPUTE_ENDPOINTS.SUBMIT(id));
    return response;
  },

  /**
   * Get dispute statistics
   */
  async getDisputeStats(): Promise<DisputeStats> {
    const response = await api.get<DisputeStats>(DISPUTE_ENDPOINTS.STATS);
    return response;
  },

  /**
   * Get dispute trends
   */
  async getDisputeTrends(period?: string): Promise<DisputeTrend[]> {
    const response = await api.get<DisputeTrend[]>(DISPUTE_ENDPOINTS.TRENDS, { period });
    return response;
  },

  /**
   * Upload evidence for a dispute
   */
  async uploadDisputeEvidence(
    disputeId: string,
    file: File,
    evidenceType: string
  ): Promise<DisputeEvidence> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('evidenceType', evidenceType);
    
    const response = await api.post<DisputeEvidence>(
      DISPUTE_ENDPOINTS.EVIDENCE(disputeId),
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      }
    );
    return response;
  },

  /**
   * Get disputes by driver
   */
  async getDisputesByDriver(driverId: string): Promise<Dispute[]> {
    const response = await api.get<Dispute[]>(DISPUTE_ENDPOINTS.BASE, { driverId });
    return response;
  },

  /**
   * Get disputes by status
   */
  async getDisputesByStatus(status: string): Promise<Dispute[]> {
    const response = await api.get<Dispute[]>(DISPUTE_ENDPOINTS.BASE, { status });
    return response;
  },

  /**
   * Get disputes by type
   */
  async getDisputesByType(disputeType: string): Promise<Dispute[]> {
    const response = await api.get<Dispute[]>(DISPUTE_ENDPOINTS.BASE, { disputeType });
    return response;
  },

  /**
   * Update dispute status
   */
  async updateDisputeStatus(id: string, status: string): Promise<Dispute> {
    const response = await api.patch<Dispute>(`${DISPUTE_ENDPOINTS.BASE}/${id}`, { status });
    return response;
  },

  /**
   * Get pending disputes (ready for submission)
   */
  async getPendingDisputes(): Promise<Dispute[]> {
    const response = await api.get<Dispute[]>(DISPUTE_ENDPOINTS.BASE, { 
      status: 'ready_for_submission'
    });
    return response;
  },
};

export default disputeService;
