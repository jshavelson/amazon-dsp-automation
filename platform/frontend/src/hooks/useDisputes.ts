import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { disputeApi } from '@/services/api';
import { Dispute, DisputeFilterParams, CreateDisputeRequest, UpdateDisputeRequest } from '@/types/dispute';
import { PaginatedResponse, PaginationParams } from '@/types/common';

// Query keys
const DISPUTE_KEYS = {
  all: ['disputes'],
  list: (params?: DisputeFilterParams & PaginationParams) => ['disputes', 'list', params],
  detail: (id: string) => ['disputes', 'detail', id],
  stats: ['disputes', 'stats'],
  trends: (period?: string) => ['disputes', 'trends', period],
};

// Hook to get all disputes with pagination and filtering
export const useDisputes = (params?: DisputeFilterParams & PaginationParams) => {
  return useQuery<PaginatedResponse<Dispute>>({
    queryKey: DISPUTE_KEYS.list(params),
    queryFn: () => disputeApi.getAll(params),
    staleTime: 1 * 60 * 1000, // 1 minute
  });
};

// Hook to get a single dispute by ID
export const useDispute = (id: string, enabled: boolean = true) => {
  return useQuery<Dispute>({
    queryKey: DISPUTE_KEYS.detail(id),
    queryFn: () => disputeApi.getById(id),
    enabled: enabled && !!id,
    staleTime: 5 * 60 * 1000,
  });
};

// Hook to get dispute statistics
export const useDisputeStats = () => {
  return useQuery({
    queryKey: DISPUTE_KEYS.stats,
    queryFn: () => disputeApi.getStats(),
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to get dispute trends
export const useDisputeTrends = (period?: string) => {
  return useQuery({
    queryKey: DISPUTE_KEYS.trends(period),
    queryFn: () => disputeApi.getTrends(period),
    staleTime: 10 * 60 * 1000,
  });
};

// Hook to create a dispute
export const useCreateDispute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateDisputeRequest) => disputeApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.stats });
    },
    onError: (error) => {
      console.error('Create dispute failed:', error);
    },
  });
};

// Hook to update a dispute
export const useUpdateDispute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateDisputeRequest) => disputeApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.detail(variables.id) });
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.stats });
    },
    onError: (error) => {
      console.error('Update dispute failed:', error);
    },
  });
};

// Hook to delete a dispute
export const useDeleteDispute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => disputeApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.stats });
    },
    onError: (error) => {
      console.error('Delete dispute failed:', error);
    },
  });
};

// Hook to submit dispute to Amazon
export const useSubmitDispute = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => disputeApi.submitToAmazon(id),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.detail(variables) });
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.all });
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.stats });
    },
    onError: (error) => {
      console.error('Submit dispute failed:', error);
    },
  });
};

// Hook to upload dispute evidence
export const useUploadDisputeEvidence = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ disputeId, file, evidenceType }: { 
      disputeId: string; 
      file: File; 
      evidenceType: string 
    }) => disputeApi.uploadEvidence(disputeId, file, evidenceType),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: DISPUTE_KEYS.detail(variables.disputeId) });
    },
    onError: (error) => {
      console.error('Upload evidence failed:', error);
    },
  });
};
