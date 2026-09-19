"""
PAVE (Preventive Maintenance and Vehicle Evaluation) service.

This service handles integration with the PAVE system for fleet compliance
and wear & tear analysis.
"""

from typing import List, Tuple, Optional, Dict, Any
from datetime import date, datetime, timedelta
from sqlalchemy import select, and_, or_, func, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.pave import (
    PaveVehicle,
    PaveInspection,
    PaveIssue,
    PaveMaintenance,
    PavePart,
)
from ..models.van import Van
from ..schemas.pave import (
    PaveVehicleResponse,
    PaveInspectionResponse,
    PaveComplianceReport,
    PaveWearAndTearResponse,
    PaveMaintenanceResponse,
    PaveConditionSection,
    PaveWearAndTearIssue,
    PaveComplianceVehicle,
    PaveComplianceSummary,
    ConditionGrade,
    PaveStatus,
    PaveComplianceStatus,
    InspectionResult,
    IssueSeverity,
)


class PaveService:
    """Service for PAVE integration and fleet compliance management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_pave_vehicles(
        self, tenant_id: str, skip: int = 0, limit: int = 100
    ) -> Tuple[List[PaveVehicleResponse], int]:
        """Get all PAVE vehicles for a tenant."""
        result = await self.db.execute(
            select(PaveVehicle)
            .where(PaveVehicle.tenant_id == tenant_id)
            .order_by(desc(PaveVehicle.updated_at))
            .offset(skip)
            .limit(limit)
        )
        vehicles = result.scalars().all()
        
        # Get total count
        count_result = await self.db.execute(
            select(func.count(PaveVehicle.id))
            .where(PaveVehicle.tenant_id == tenant_id)
        )
        total = count_result.scalar() or 0
        
        return [PaveVehicleResponse.model_validate(v) for v in vehicles], total

    async def get_pave_vehicle_by_vin(
        self, vin: str, tenant_id: str
    ) -> Optional[PaveVehicleResponse]:
        """Get a PAVE vehicle by VIN."""
        result = await self.db.execute(
            select(PaveVehicle)
            .where(
                and_(
                    PaveVehicle.vin == vin,
                    PaveVehicle.tenant_id == tenant_id
                )
            )
        )
        vehicle = result.scalar()
        return PaveVehicleResponse.model_validate(vehicle) if vehicle else None

    async def get_pave_inspections(
        self,
        tenant_id: str,
        vin: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[PaveInspectionResponse], int]:
        """Get PAVE inspections with optional filters."""
        query = (
            select(PaveInspection)
            .where(PaveInspection.tenant_id == tenant_id)
            .order_by(desc(PaveInspection.inspection_date))
        )
        
        if vin:
            query = query.where(PaveInspection.vin == vin)
        if start_date:
            query = query.where(PaveInspection.inspection_date >= start_date)
        if end_date:
            query = query.where(PaveInspection.inspection_date <= end_date)
        
        result = await self.db.execute(query.offset(skip).limit(limit))
        inspections = result.scalars().all()
        
        # Get total count
        count_query = select(func.count(PaveInspection.id)).where(PaveInspection.tenant_id == tenant_id)
        if vin:
            count_query = count_query.where(PaveInspection.vin == vin)
        if start_date:
            count_query = count_query.where(PaveInspection.inspection_date >= start_date)
        if end_date:
            count_query = count_query.where(PaveInspection.inspection_date <= end_date)
        
        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0
        
        return [PaveInspectionResponse.model_validate(i) for i in inspections], total

    async def get_pave_inspection_by_id(
        self, inspection_id: str, tenant_id: str
    ) -> Optional[PaveInspectionResponse]:
        """Get a PAVE inspection by ID."""
        result = await self.db.execute(
            select(PaveInspection)
            .where(
                and_(
                    PaveInspection.id == inspection_id,
                    PaveInspection.tenant_id == tenant_id
                )
            )
        )
        inspection = result.scalar()
        return PaveInspectionResponse.model_validate(inspection) if inspection else None

    async def get_compliance_report(
        self, tenant_id: str, period: str = "current"
    ) -> PaveComplianceReport:
        """Generate a compliance report for all vehicles."""
        # Get all PAVE vehicles
        result = await self.db.execute(
            select(PaveVehicle)
            .where(PaveVehicle.tenant_id == tenant_id)
        )
        pave_vehicles = result.scalars().all()
        
        # Get all vans for the tenant
        van_result = await self.db.execute(
            select(Van)
            .where(Van.tenant_id == tenant_id)
        )
        vans = van_result.scalars().all()
        
        # Build compliance vehicles
        compliance_vehicles: List[PaveComplianceVehicle] = []
        compliant_count = 0
        non_compliant_count = 0
        
        for vehicle in pave_vehicles:
            # Find matching van
            matching_van = next((v for v in vans if v.vin == vehicle.vin), None)
            
            days_until_inspection = 0
            if vehicle.next_pave_inspection_due:
                days_until_inspection = (vehicle.next_pave_inspection_due - date.today()).days
            
            compliance_vehicles.append(PaveComplianceVehicle(
                vin=vehicle.vin,
                license_plate=vehicle.license_plate,
                make=vehicle.make,
                model=vehicle.model,
                compliant=vehicle.compliance_status == PaveComplianceStatus.COMPLIANT,
                compliance_issues=[],  # Would be populated from inspection data
                last_inspection_date=vehicle.last_pave_inspection_date,
                next_inspection_due=vehicle.next_pave_inspection_due,
                days_until_inspection=days_until_inspection,
                pave_score=vehicle.pave_score or 0
            ))
            
            if vehicle.compliance_status == PaveComplianceStatus.COMPLIANT:
                compliant_count += 1
            else:
                non_compliant_count += 1
        
        # Calculate compliance rate
        total_vehicles = len(pave_vehicles)
        compliance_rate = (compliant_count / total_vehicles * 100) if total_vehicles > 0 else 0
        
        # Build summary
        by_status = {
            "compliant": compliant_count,
            "non_compliant": non_compliant_count,
            "conditional": 0,
            "pending": 0
        }
        
        # Get recent inspections for top issues
        inspection_result = await self.db.execute(
            select(PaveInspection)
            .where(PaveInspection.tenant_id == tenant_id)
            .order_by(desc(PaveInspection.inspection_date))
            .limit(10)
        )
        recent_inspections = inspection_result.scalars().all()
        
        top_issues: List[Any] = []
        for inspection in recent_inspections:
            issue_result = await self.db.execute(
                select(PaveIssue)
                .where(PaveIssue.inspection_id == inspection.id)
                .order_by(desc(PaveIssue.severity))
                .limit(5)
            )
            issues = issue_result.scalars().all()
            top_issues.extend(issues)
        
        return PaveComplianceReport(
            report_id=f"pave-compliance-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
            generated_at=datetime.now(),
            period=period,
            total_vehicles=total_vehicles,
            compliant_vehicles=compliant_count,
            non_compliant_vehicles=non_compliant_count,
            compliance_rate=compliance_rate,
            vehicles=compliance_vehicles,
            summary=PaveComplianceSummary(
                by_status=by_status,
                by_severity={},
                by_category={}
            ),
            recommendations=self._generate_recommendations(compliance_rate, days_until_inspection)
        )

    def _generate_recommendations(self, compliance_rate: float, avg_days: int) -> List[str]:
        """Generate recommendations based on compliance data."""
        recommendations = []
        
        if compliance_rate < 80:
            recommendations.append("Compliance rate is below 80%. Review non-compliant vehicles and address issues.")
        
        if compliance_rate < 95:
            recommendations.append("Consider implementing additional training for drivers with non-compliant vehicles.")
        
        if avg_days < 7:
            recommendations.append("Several vehicles have inspections due within 7 days. Schedule inspections promptly.")
        
        if avg_days < 0:
            recommendations.append("URGENT: Some vehicles have overdue inspections. Address immediately.")
        
        return recommendations

    async def get_wear_and_tear(
        self, vin: str, tenant_id: str
    ) -> Optional[PaveWearAndTearResponse]:
        """Get wear and tear assessment for a vehicle."""
        # Get the PAVE vehicle
        vehicle_result = await self.db.execute(
            select(PaveVehicle)
            .where(
                and_(
                    PaveVehicle.vin == vin,
                    PaveVehicle.tenant_id == tenant_id
                )
            )
        )
        vehicle = vehicle_result.scalar()
        
        if not vehicle:
            return None
        
        # Get the most recent inspection
        inspection_result = await self.db.execute(
            select(PaveInspection)
            .where(
                and_(
                    PaveInspection.vin == vin,
                    PaveInspection.tenant_id == tenant_id
                )
            )
            .order_by(desc(PaveInspection.inspection_date))
            .limit(1)
        )
        inspection = inspection_result.scalar()
        
        # Get issues from the inspection
        issues: List[PaveWearAndTearIssue] = []
        if inspection:
            issue_result = await self.db.execute(
                select(PaveIssue)
                .where(PaveIssue.inspection_id == inspection.id)
            )
            pave_issues = issue_result.scalars().all()
            
            for issue in pave_issues:
                issues.append(PaveWearAndTearIssue(
                    id=issue.id,
                    category=issue.category.value,
                    description=issue.description,
                    severity=issue.severity,
                    location=issue.location,
                    photo_url=issue.photo_url,
                    recommended_action=issue.resolution_notes or "",
                    estimated_cost=issue.cost_to_repair
                ))
        
        # Map PAVE status to condition grades
        exterior_condition = self._map_status_to_condition(vehicle.exterior_condition)
        interior_condition = self._map_status_to_condition(vehicle.interior_condition)
        mechanical_condition = self._map_status_to_condition(vehicle.mechanical_condition)
        
        # Calculate scores (simplified - would come from actual inspection data)
        exterior_score = self._calculate_condition_score(exterior_condition)
        interior_score = self._calculate_condition_score(interior_condition)
        mechanical_score = self._calculate_condition_score(mechanical_condition)
        
        overall_score = (exterior_score + interior_score + mechanical_score) // 3
        
        return PaveWearAndTearResponse(
            vin=vehicle.vin,
            inspection_date=inspection.inspection_date if inspection else date.today(),
            inspector=inspection.inspector if inspection else "",
            exterior=PaveConditionSection(
                condition=exterior_condition,
                score=exterior_score,
                issues=[i for i in issues if i.category == "exterior"],
                photos=[]
            ),
            interior=PaveConditionSection(
                condition=interior_condition,
                score=interior_score,
                issues=[i for i in issues if i.category == "interior"],
                photos=[]
            ),
            mechanical=PaveConditionSection(
                condition=mechanical_condition,
                score=mechanical_score,
                issues=[i for i in issues if i.category in ["mechanical", "safety", "brake", "tire"]],
                photos=[]
            ),
            overall_score=overall_score,
            last_inspection_date=vehicle.last_pave_inspection_date,
            next_inspection_due=vehicle.next_pave_inspection_due,
            photos=[],
            notes=inspection.notes if inspection else None
        )

    def _map_status_to_condition(self, status: Optional[str]) -> ConditionGrade:
        """Map PAVE status to condition grade."""
        if not status:
            return ConditionGrade.GREY
        
        status_lower = status.lower()
        if status_lower == "excellent":
            return ConditionGrade.EXCELLENT
        elif status_lower == "good":
            return ConditionGrade.GOOD
        elif status_lower == "fair":
            return ConditionGrade.FAIR
        elif status_lower == "poor":
            return ConditionGrade.POOR
        elif status_lower == "unacceptable":
            return ConditionGrade.UNACCEPTABLE
        return ConditionGrade.GREY

    def _calculate_condition_score(self, condition: ConditionGrade) -> int:
        """Calculate score from condition grade."""
        scores = {
            ConditionGrade.EXCELLENT: 95,
            ConditionGrade.GOOD: 80,
            ConditionGrade.FAIR: 60,
            ConditionGrade.POOR: 40,
            ConditionGrade.UNACCEPTABLE: 20,
            ConditionGrade.GREY: 0
        }
        return scores.get(condition, 0)

    async def get_pave_maintenance(
        self,
        tenant_id: str,
        vin: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[PaveMaintenanceResponse], int]:
        """Get PAVE maintenance records with optional filters."""
        query = (
            select(PaveMaintenance)
            .where(PaveMaintenance.tenant_id == tenant_id)
            .order_by(desc(PaveMaintenance.scheduled_date))
        )
        
        if vin:
            query = query.where(PaveMaintenance.vin == vin)
        if start_date:
            query = query.where(PaveMaintenance.scheduled_date >= start_date)
        if end_date:
            query = query.where(PaveMaintenance.scheduled_date <= end_date)
        
        result = await self.db.execute(query.offset(skip).limit(limit))
        maintenance_records = result.scalars().all()
        
        # Get total count
        count_query = select(func.count(PaveMaintenance.id)).where(PaveMaintenance.tenant_id == tenant_id)
        if vin:
            count_query = count_query.where(PaveMaintenance.vin == vin)
        if start_date:
            count_query = count_query.where(PaveMaintenance.scheduled_date >= start_date)
        if end_date:
            count_query = count_query.where(PaveMaintenance.scheduled_date <= end_date)
        
        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0
        
        return [PaveMaintenanceResponse.model_validate(m) for m in maintenance_records], total

    async def sync_pave_data(self, tenant_id: str) -> Dict[str, Any]:
        """
        Sync PAVE data with local database.
        
        This is a placeholder for actual PAVE API integration.
        In production, this would:
        1. Authenticate with PAVE API
        2. Fetch all vehicles
        3. Fetch all inspections
        4. Fetch all maintenance records
        5. Update local database
        """
        # For now, return a mock response
        # In production, implement actual PAVE API calls
        
        return {
            "synced": 0,
            "failed": 0,
            "message": "PAVE sync not yet implemented. This would connect to the PAVE API."
        }
