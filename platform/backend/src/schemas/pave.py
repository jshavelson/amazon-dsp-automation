"""
PAVE (Preventive Maintenance and Vehicle Evaluation) Pydantic schemas.
"""

from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date, datetime
from enum import Enum


class PaveStatus(str, Enum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"
    GREY = "grey"


class PaveComplianceStatus(str, Enum):
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    CONDITIONAL = "conditional"
    PENDING = "pending"


class ConditionGrade(str, Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    UNACCEPTABLE = "unacceptable"


class InspectionResult(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    CONDITIONAL = "conditional"
    PENDING = "pending"


class InspectionType(str, Enum):
    PRE_TRIP = "pre_trip"
    POST_TRIP = "post_trip"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"
    DMV = "dmv"
    SAFETY = "safety"
    PAVE = "pave"
    OTHER = "other"


class IssueCategory(str, Enum):
    EXTERIOR = "exterior"
    INTERIOR = "interior"
    MECHANICAL = "mechanical"
    ELECTRICAL = "electrical"
    SAFETY = "safety"
    TIRE = "tire"
    BRAKE = "brake"
    OTHER = "other"


class IssueSeverity(str, Enum):
    MINOR = "minor"
    MODERATE = "moderate"
    MAJOR = "major"
    CRITICAL = "critical"


class IssueStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WAIVED = "waived"


class MaintenanceType(str, Enum):
    OIL_CHANGE = "oil_change"
    TIRE_ROTATION = "tire_rotation"
    TIRE_REPLACEMENT = "tire_replacement"
    BRAKE_SERVICE = "brake_service"
    BRAKE_REPLACEMENT = "brake_replacement"
    TRANSMISSION_SERVICE = "transmission_service"
    COOLANT_FLUSH = "coolant_flush"
    BATTERY_REPLACEMENT = "battery_replacement"
    INSPECTION = "inspection"
    REPAIR = "repair"
    RECALL = "recall"
    PREVENTIVE = "preventive"
    OTHER = "other"


class MaintenanceStatus(str, Enum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    OVERDUE = "overdue"


# PAVE Vehicle Schema
class PaveVehicleBase(BaseModel):
    vin: str = Field(..., description="Vehicle Identification Number")
    license_plate: str = Field(..., description="License plate number")
    make: str = Field(..., description="Vehicle make")
    model: str = Field(..., description="Vehicle model")
    year: int = Field(..., description="Manufacturing year")
    type: str = Field(..., description="Vehicle type")
    ownership: str = Field(..., description="Ownership type")
    home_station_id: str = Field(..., description="Home station ID")


class PaveVehicleCreate(PaveVehicleBase):
    pave_id: Optional[str] = Field(None, description="PAVE system ID")
    pave_status: Optional[PaveStatus] = Field(PaveStatus.GREY, description="PAVE status color")
    last_pave_inspection_date: Optional[date] = Field(None, description="Last PAVE inspection date")
    next_pave_inspection_due: Optional[date] = Field(None, description="Next PAVE inspection due date")
    pave_score: Optional[int] = Field(0, ge=0, le=100, description="PAVE score (0-100)")
    compliance_status: Optional[PaveComplianceStatus] = Field(
        PaveComplianceStatus.PENDING, description="Compliance status"
    )


class PaveVehicleResponse(PaveVehicleBase):
    id: str = Field(..., description="Database ID")
    pave_id: Optional[str] = None
    pave_status: PaveStatus = PaveStatus.GREY
    last_pave_inspection_date: Optional[date] = None
    next_pave_inspection_due: Optional[date] = None
    pave_score: int = Field(0, ge=0, le=100)
    compliance_status: PaveComplianceStatus = PaveComplianceStatus.PENDING
    exterior_condition: ConditionGrade = ConditionGrade.GREY
    interior_condition: ConditionGrade = ConditionGrade.GREY
    mechanical_condition: ConditionGrade = ConditionGrade.GREY
    last_maintenance_date: Optional[date] = None
    last_maintenance_type: Optional[str] = None
    next_maintenance_due: Optional[date] = None
    maintenance_cost_ytd: float = 0.0
    repair_cost_ytd: float = 0.0
    has_open_recalls: bool = False
    recall_count: int = 0
    has_safety_issues: bool = False
    safety_issue_count: int = 0
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    synced_at: Optional[datetime] = Field(None, description="Last sync timestamp")

    class Config:
        from_attributes = True


class PaveVehicleListResponse(BaseModel):
    items: List[PaveVehicleResponse] = Field(default_factory=list)
    total: int = Field(0, description="Total number of vehicles")
    page: int = Field(0, description="Current page")
    page_size: int = Field(100, description="Items per page")


# PAVE Compliance Schema
class PaveComplianceVehicle(BaseModel):
    vin: str = Field(..., description="Vehicle VIN")
    license_plate: str = Field(..., description="License plate")
    make: str = Field(..., description="Vehicle make")
    model: str = Field(..., description="Vehicle model")
    compliant: bool = Field(..., description="Whether vehicle is compliant")
    compliance_issues: List[str] = Field(default_factory=list, description="List of compliance issues")
    last_inspection_date: Optional[date] = Field(None, description="Last inspection date")
    next_inspection_due: Optional[date] = Field(None, description="Next inspection due date")
    days_until_inspection: int = Field(0, description="Days until next inspection")
    pave_score: int = Field(0, ge=0, le=100, description="PAVE score")


class PaveComplianceSummary(BaseModel):
    by_status: dict = Field(default_factory=dict, description="Count by compliance status")
    by_severity: dict = Field(default_factory=dict, description="Count by issue severity")
    by_category: dict = Field(default_factory=dict, description="Count by issue category")


class PaveComplianceReport(BaseModel):
    report_id: str = Field(..., description="Report ID")
    generated_at: datetime = Field(..., description="Report generation timestamp")
    period: str = Field(..., description="Reporting period")
    total_vehicles: int = Field(0, description="Total number of vehicles")
    compliant_vehicles: int = Field(0, description="Number of compliant vehicles")
    non_compliant_vehicles: int = Field(0, description="Number of non-compliant vehicles")
    compliance_rate: float = Field(0.0, ge=0, le=100, description="Compliance rate percentage")
    vehicles: List[PaveComplianceVehicle] = Field(default_factory=list, description="Vehicle compliance details")
    summary: PaveComplianceSummary = Field(..., description="Compliance summary")
    recommendations: List[str] = Field(default_factory=list, description="Recommendations")


class PaveComplianceReportResponse(BaseModel):
    report: PaveComplianceReport = Field(..., description="Compliance report")


# PAVE Wear & Tear Schema
class PaveWearAndTearIssue(BaseModel):
    id: str = Field(..., description="Issue ID")
    category: str = Field(..., description="Category")
    description: str = Field(..., description="Description")
    severity: IssueSeverity = Field(..., description="Severity")
    location: str = Field(..., description="Location")
    photo_url: Optional[str] = Field(None, description="Photo URL")
    recommended_action: str = Field(..., description="Recommended action")
    estimated_cost: Optional[float] = Field(None, description="Estimated cost")


class PaveConditionSection(BaseModel):
    condition: ConditionGrade = Field(..., description="Condition grade")
    score: int = Field(..., ge=0, le=100, description="Score (0-100)")
    issues: List[PaveWearAndTearIssue] = Field(default_factory=list, description="Issues in this section")
    photos: List[str] = Field(default_factory=list, description="Photo URLs")


class PaveWearAndTearResponse(BaseModel):
    vin: str = Field(..., description="Vehicle VIN")
    inspection_date: date = Field(..., description="Inspection date")
    inspector: str = Field(..., description="Inspector name")
    exterior: PaveConditionSection = Field(..., description="Exterior condition")
    interior: PaveConditionSection = Field(..., description="Interior condition")
    mechanical: PaveConditionSection = Field(..., description="Mechanical condition")
    overall_score: int = Field(..., ge=0, le=100, description="Overall score (0-100)")
    last_inspection_date: Optional[date] = Field(None, description="Last inspection date")
    next_inspection_due: Optional[date] = Field(None, description="Next inspection due date")
    photos: List[str] = Field(default_factory=list, description="All photo URLs")
    notes: Optional[str] = Field(None, description="Additional notes")

    class Config:
        from_attributes = True


# Sync Response
class PaveSyncResponse(BaseModel):
    synced: int = Field(0, description="Number of items synced")
    failed: int = Field(0, description="Number of items failed")
    message: str = Field(..., description="Sync message")
