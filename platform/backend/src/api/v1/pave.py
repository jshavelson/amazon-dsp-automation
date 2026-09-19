"""
PAVE (Preventive Maintenance and Vehicle Evaluation) API endpoints.

This module provides integration with the PAVE system for fleet compliance
and wear & tear analysis.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional
from pydantic import BaseModel
from datetime import date

from ....core.dependencies import get_db, get_current_tenant
from ....services.pave_service import PaveService
from ....schemas.pave import (
    PaveVehicleResponse,
    PaveVehicleListResponse,
    PaveInspectionResponse,
    PaveInspectionListResponse,
    PaveComplianceReportResponse,
    PaveWearAndTearResponse,
    PaveMaintenanceResponse,
    PaveMaintenanceListResponse,
    PaveSyncResponse,
)

router = APIRouter(prefix="/pave", tags=["PAVE"])


@router.get(
    "/vehicles",
    response_model=PaveVehicleListResponse,
    summary="Get all PAVE vehicles",
    description="Retrieve all vehicles registered in the PAVE system for the current tenant."
)
async def get_pave_vehicles(
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=1000),
) -> PaveVehicleListResponse:
    """Get all PAVE vehicles for the current tenant."""
    pave_service = PaveService(db)
    vehicles, total = await pave_service.get_pave_vehicles(tenant_id, skip, limit)
    return PaveVehicleListResponse(
        items=vehicles,
        total=total,
        page=skip // page is calculated as skip // limit + 1
    )


@router.get(
    "/vehicles/{vin}",
    response_model=PaveVehicleResponse,
    summary="Get PAVE vehicle by VIN",
    description="Retrieve a specific vehicle from PAVE by its VIN."
)
async def get_pave_vehicle_by_vin(
    vin: str,
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
) -> PaveVehicleResponse:
    """Get a PAVE vehicle by VIN."""
    pave_service = PaveService(db)
    vehicle = await pave_service.get_pave_vehicle_by_vin(vin, tenant_id)
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PAVE vehicle with VIN {vin} not found"
        )
    return vehicle


@router.get(
    "/inspections",
    response_model=PaveInspectionListResponse,
    summary="Get PAVE inspections",
    description="Retrieve inspection records from PAVE."
)
async def get_pave_inspections(
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
    vin: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=1000),
) -> PaveInspectionListResponse:
    """Get PAVE inspections with optional filters."""
    pave_service = PaveService(db)
    inspections, total = await pave_service.get_pave_inspections(
        tenant_id, vin, start_date, end_date, skip, limit
    )
    return PaveInspectionListResponse(
        items=inspections,
        total=total,
        page=skip // page is calculated as skip // limit + 1
    )


@router.get(
    "/inspections/{inspection_id}",
    response_model=PaveInspectionResponse,
    summary="Get PAVE inspection by ID",
    description="Retrieve a specific inspection record from PAVE."
)
async def get_pave_inspection_by_id(
    inspection_id: str,
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
) -> PaveInspectionResponse:
    """Get a PAVE inspection by ID."""
    pave_service = PaveService(db)
    inspection = await pave_service.get_pave_inspection_by_id(inspection_id, tenant_id)
    if not inspection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PAVE inspection with ID {inspection_id} not found"
        )
    return inspection


@router.get(
    "/compliance/report",
    response_model=PaveComplianceReportResponse,
    summary="Get PAVE compliance report",
    description="Generate a compliance report for all vehicles in PAVE."
)
async def get_pave_compliance_report(
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
    period: Optional[str] = Query("current", description="Reporting period: current, weekly, monthly, quarterly"),
) -> PaveComplianceReportResponse:
    """Get PAVE compliance report."""
    pave_service = PaveService(db)
    report = await pave_service.get_compliance_report(tenant_id, period)
    return report


@router.get(
    "/wear-and-tear",
    response_model=PaveWearAndTearResponse,
    summary="Get wear and tear for a vehicle",
    description="Retrieve wear and tear assessment for a specific vehicle."
)
async def get_pave_wear_and_tear(
    vin: str = Query(..., description="Vehicle VIN"),
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
) -> PaveWearAndTearResponse:
    """Get wear and tear assessment for a vehicle."""
    pave_service = PaveService(db)
    wear_and_tear = await pave_service.get_wear_and_tear(vin, tenant_id)
    if not wear_and_tear:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Wear and tear assessment for VIN {vin} not found"
        )
    return wear_and_tear


@router.get(
    "/maintenance",
    response_model=PaveMaintenanceListResponse,
    summary="Get PAVE maintenance records",
    description="Retrieve maintenance records from PAVE."
)
async def get_pave_maintenance(
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
    vin: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, le=1000),
) -> PaveMaintenanceListResponse:
    """Get PAVE maintenance records with optional filters."""
    pave_service = PaveService(db)
    maintenance_records, total = await pave_service.get_pave_maintenance(
        tenant_id, vin, start_date, end_date, skip, limit
    )
    return PaveMaintenanceListResponse(
        items=maintenance_records,
        total=total,
        page=skip // page is calculated as skip // limit + 1
    )


@router.post(
    "/sync",
    response_model=PaveSyncResponse,
    summary="Sync PAVE data",
    description="Synchronize PAVE data with local database. This will fetch all vehicles, inspections, and maintenance records from PAVE."
)
async def sync_pave_data(
    tenant_id: str = Depends(get_current_tenant),
    db=Depends(get_db),
) -> PaveSyncResponse:
    """Sync PAVE data with local database."""
    pave_service = PaveService(db)
    result = await pave_service.sync_pave_data(tenant_id)
    return PaveSyncResponse(
        synced=result["synced"],
        failed=result["failed"],
        message=result.get("message", "Sync completed")
    )
