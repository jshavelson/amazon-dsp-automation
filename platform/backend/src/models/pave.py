"""
PAVE (Preventive Maintenance and Vehicle Evaluation) database models.
"""

from sqlalchemy import Column, String, Integer, Float, Boolean, Date, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from datetime import date, datetime
from enum import Enum as PyEnum

from .base import Base


class PaveStatus(PyEnum):
    GREEN = "green"
    YELLOW = "yellow"
    RED = "red"
    GREY = "grey"


class PaveComplianceStatus(PyEnum):
    COMPLIANT = "compliant"
    NON_COMPLIANT = "non_compliant"
    CONDITIONAL = "conditional"
    PENDING = "pending"


class ConditionGrade(PyEnum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"
    UNACCEPTABLE = "unacceptable"


class InspectionResult(PyEnum):
    PASS = "pass"
    FAIL = "fail"
    CONDITIONAL = "conditional"
    PENDING = "pending"


class InspectionType(PyEnum):
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


class IssueCategory(PyEnum):
    EXTERIOR = "exterior"
    INTERIOR = "interior"
    MECHANICAL = "mechanical"
    ELECTRICAL = "electrical"
    SAFETY = "safety"
    TIRE = "tire"
    BRAKE = "brake"
    OTHER = "other"


class IssueSeverity(PyEnum):
    MINOR = "minor"
    MODERATE = "moderate"
    MAJOR = "major"
    CRITICAL = "critical"


class IssueStatus(PyEnum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    WAIVED = "waived"


class MaintenanceType(PyEnum):
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


class MaintenanceStatus(PyEnum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    OVERDUE = "overdue"


class PaveVehicle(Base):
    """PAVE vehicle record."""
    
    __tablename__ = "pave_vehicles"
    
    id = Column(String, primary_key=True, index=True)
    tenant_id = Column(String, index=True, nullable=False)
    
    # Vehicle identification
    vin = Column(String, unique=True, index=True, nullable=False)
    license_plate = Column(String, index=True, nullable=False)
    make = Column(String, nullable=False)
    model = Column(String, nullable=False)
    year = Column(Integer, nullable=False)
    type = Column(String, nullable=False)
    ownership = Column(String, nullable=False)
    home_station_id = Column(String, nullable=False)
    
    # PAVE-specific fields
    pave_id = Column(String, unique=True, nullable=True)
    pave_status = Column(Enum(PaveStatus), default=PaveStatus.GREY, nullable=False)
    last_pave_inspection_date = Column(Date, nullable=True)
    next_pave_inspection_due = Column(Date, nullable=True)
    pave_score = Column(Integer, default=0, nullable=False)  # 0-100
    compliance_status = Column(Enum(PaveComplianceStatus), default=PaveComplianceStatus.PENDING, nullable=False)
    
    # Condition grades
    exterior_condition = Column(Enum(ConditionGrade), default=ConditionGrade.GREY, nullable=False)
    interior_condition = Column(Enum(ConditionGrade), default=ConditionGrade.GREY, nullable=False)
    mechanical_condition = Column(Enum(ConditionGrade), default=ConditionGrade.GREY, nullable=False)
    
    # Maintenance info
    last_maintenance_date = Column(Date, nullable=True)
    last_maintenance_type = Column(String, nullable=True)
    next_maintenance_due = Column(Date, nullable=True)
    maintenance_cost_ytd = Column(Float, default=0.0, nullable=False)
    repair_cost_ytd = Column(Float, default=0.0, nullable=False)
    
    # Flags
    has_open_recalls = Column(Boolean, default=False, nullable=False)
    recall_count = Column(Integer, default=0, nullable=False)
    has_safety_issues = Column(Boolean, default=False, nullable=False)
    safety_issue_count = Column(Integer, default=0, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    synced_at = Column(DateTime, nullable=True)
    
    # Relationships
    inspections = relationship("PaveInspection", back_populates="vehicle", cascade="all, delete-orphan")
    maintenance_records = relationship("PaveMaintenance", back_populates="vehicle", cascade="all, delete-orphan")


class PaveInspection(Base):
    """PAVE inspection record."""
    
    __tablename__ = "pave_inspections"
    
    id = Column(String, primary_key=True, index=True)
    tenant_id = Column(String, index=True, nullable=False)
    
    # Vehicle reference
    vehicle_id = Column(String, ForeignKey("pave_vehicles.id"), nullable=False)
    vin = Column(String, index=True, nullable=False)
    
    # Inspection details
    inspection_date = Column(Date, nullable=False)
    inspection_type = Column(Enum(InspectionType), nullable=False)
    inspector = Column(String, nullable=False)
    result = Column(Enum(InspectionResult), nullable=False)
    score = Column(Integer, nullable=False)  # 0-100
    notes = Column(Text, nullable=True)
    status = Column(String, default="completed", nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    vehicle = relationship("PaveVehicle", back_populates="inspections")
    issues = relationship("PaveIssue", back_populates="inspection", cascade="all, delete-orphan")


class PaveIssue(Base):
    """Issue found during PAVE inspection."""
    
    __tablename__ = "pave_issues"
    
    id = Column(String, primary_key=True, index=True)
    tenant_id = Column(String, index=True, nullable=False)
    
    # Inspection reference
    inspection_id = Column(String, ForeignKey("pave_inspections.id"), nullable=False)
    
    # Issue details
    category = Column(Enum(IssueCategory), nullable=False)
    severity = Column(Enum(IssueSeverity), nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String, nullable=False)
    photo_url = Column(String, nullable=True)
    status = Column(Enum(IssueStatus), default=IssueStatus.OPEN, nullable=False)
    resolved_at = Column(DateTime, nullable=True)
    resolution_notes = Column(Text, nullable=True)
    cost_to_repair = Column(Float, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    inspection = relationship("PaveInspection", back_populates="issues")


class PaveMaintenance(Base):
    """PAVE maintenance record."""
    
    __tablename__ = "pave_maintenance"
    
    id = Column(String, primary_key=True, index=True)
    tenant_id = Column(String, index=True, nullable=False)
    
    # Vehicle reference
    vehicle_id = Column(String, ForeignKey("pave_vehicles.id"), nullable=False)
    vin = Column(String, index=True, nullable=False)
    
    # Maintenance details
    maintenance_type = Column(Enum(MaintenanceType), nullable=False)
    description = Column(Text, nullable=False)
    mileage = Column(Integer, nullable=False)
    cost = Column(Float, nullable=False)
    vendor = Column(String, nullable=False)
    invoice_number = Column(String, nullable=True)
    status = Column(Enum(MaintenanceStatus), default=MaintenanceStatus.SCHEDULED, nullable=False)
    scheduled_date = Column(Date, nullable=False)
    completed_date = Column(Date, nullable=True)
    notes = Column(Text, nullable=True)
    labor_hours = Column(Float, nullable=True)
    warranty_claim = Column(Boolean, default=False, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Relationships
    vehicle = relationship("PaveVehicle", back_populates="maintenance_records")
    parts_used = relationship("PavePart", back_populates="maintenance", cascade="all, delete-orphan")


class PavePart(Base):
    """Part used in PAVE maintenance."""
    
    __tablename__ = "pave_parts"
    
    id = Column(String, primary_key=True, index=True)
    tenant_id = Column(String, index=True, nullable=False)
    
    # Maintenance reference
    maintenance_id = Column(String, ForeignKey("pave_maintenance.id"), nullable=False)
    
    # Part details
    part_number = Column(String, nullable=False)
    description = Column(String, nullable=False)
    quantity = Column(Integer, default=1, nullable=False)
    unit_cost = Column(Float, nullable=False)
    total_cost = Column(Float, nullable=False)
    vendor = Column(String, nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Relationships
    maintenance = relationship("PaveMaintenance", back_populates="parts_used")
