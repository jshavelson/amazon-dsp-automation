// Dispute-related types

export interface Dispute {
  id: string;
  caseNumber: string;
  driverId: string;
  driverName: string;
  vanId?: string;
  vanLicensePlate?: string;
  routeId?: string;
  routeDate: string;
  disputeType: DisputeType;
  category: DisputeCategory;
  subcategory: DisputeSubcategory;
  status: DisputeStatus;
  priority: DisputePriority;
  amount: number;
  currency: string;
  description: string;
  evidence: DisputeEvidence[];
  submissionDate: string;
  submittedBy: string;
  assignedTo?: string;
  resolutionDate?: string;
  resolutionNotes?: string;
  resolutionAmount?: number;
  confidenceScore: number;
  recommendedWording: string;
  supportingEvidenceSummary: string;
  amazonCaseId?: string;
  amazonSubmissionDate?: string;
  amazonResponseDate?: string;
  amazonStatus?: string;
  amazonConfirmationNumber?: string;
  notes?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type DisputeType = 
  | 'dcr' // Delivery Completion Rate
  | 'rts' // Route Time Score
  | 'quality' // Quality issues
  | 'safety' // Safety incidents
  | 'pod' // Proof of Delivery
  | 'dsb_dnr' // Delivery Service Bar / Did Not Route
  | 'psb' // Package Service Bar
  | 'cdf' // Customer Delivery Feedback
  | 'dvic' // Driver Vehicle Inspection Check
  | 'capacity' // Capacity issues
  | 'payroll' // Payroll discrepancies
  | 'other';

export type DisputeCategory = 
  | 'business_closed'
  | 'access_issue'
  | 'customer_unavailable'
  | 'address_issue'
  | 'package_issue'
  | 'safety_violation'
  | 'equipment_failure'
  | 'weather_delay'
  | 'traffic_delay'
  | 'system_error'
  | 'other';

export type DisputeSubcategory = 
  | 'business_closed_no_rts'
  | 'business_closed_with_rts'
  | 'gated_community'
  | 'security_guard'
  | 'customer_refused'
  | 'wrong_address'
  | 'missing_package'
  | 'damaged_package'
  | 'speeding'
  | 'seatbelt'
  | 'phone_use'
  | 'harsh_braking'
  | 'vehicle_breakdown'
  | 'gps_failure'
  | 'scanner_failure'
  | 'heavy_rain'
  | 'severe_weather'
  | 'accident'
  | 'portal_error'
  | 'other';

export type DisputeStatus = 
  | 'draft'
  | 'pending_review'
  | 'under_review'
  | 'pending_evidence'
  | 'ready_for_submission'
  | 'submitted'
  | 'amazon_review'
  | 'approved'
  | 'rejected'
  | 'appealed'
  | 'closed'
  | 'archived';

export type DisputePriority = 'low' | 'medium' | 'high' | 'urgent';

export interface DisputeEvidence {
  id: string;
  disputeId: string;
  evidenceType: EvidenceType;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  description: string;
  uploadedAt: string;
  uploadedBy: string;
  verified: boolean;
  verificationNotes?: string;
}

export type EvidenceType = 
  | 'dcr_screenshot'
  | 'rts_screenshot'
  | 'itinerary_screenshot'
  | 'cortex_screenshot'
  | 'portal_screenshot'
  | 'scorecard_screenshot'
  | 'daily_report'
  | 'gps_data'
  | 'dashcam_footage'
  | 'photo'
  | 'video'
  | 'document'
  | 'email'
  | 'other';

export interface DisputeFilterParams extends FilterParams {
  disputeType?: DisputeType;
  category?: DisputeCategory;
  status?: DisputeStatus;
  priority?: DisputePriority;
  driverId?: string;
  vanId?: string;
  minAmount?: number;
  maxAmount?: number;
  minConfidence?: number;
  search?: string;
}

export interface CreateDisputeRequest {
  driverId: string;
  routeId?: string;
  routeDate: string;
  disputeType: DisputeType;
  category: DisputeCategory;
  subcategory: DisputeSubcategory;
  priority: DisputePriority;
  amount: number;
  currency: string;
  description: string;
  recommendedWording: string;
  supportingEvidenceSummary: string;
  confidenceScore: number;
  tags?: string[];
  notes?: string;
}

export interface UpdateDisputeRequest extends Partial<CreateDisputeRequest> {
  id: string;
  status?: DisputeStatus;
  assignedTo?: string;
  resolutionDate?: string;
  resolutionNotes?: string;
  resolutionAmount?: number;
  amazonCaseId?: string;
  amazonSubmissionDate?: string;
  amazonResponseDate?: string;
  amazonStatus?: string;
  amazonConfirmationNumber?: string;
}

export interface DisputeStats {
  totalDisputes: number;
  pendingReview: number;
  underReview: number;
  readyForSubmission: number;
  submitted: number;
  approved: number;
  rejected: number;
  totalAmount: number;
  approvedAmount: number;
  rejectionRate: number;
  averageResolutionTime: number;
  successRate: number;
}

export interface DisputeTrend {
  period: string;
  count: number;
  amount: number;
  successRate: number;
  averageResolutionTime: number;
}
