"""Leasing: Buildium → workspace_buildium_applications / _leases / _properties /
_units / _files / _listings (listings not in the pull are deleted)."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ..context import RunContext, RunResult
from ..db import connection, new_id, upsert_rows, utc_now
from ..errors import PipelineError
from ..http import get_json

API = "https://api.buildium.com/v1"
PAGE = 1000
CAP = 25000

BED = {"Studio": "Studio", "OneBed": "1", "TwoBed": "2", "ThreeBed": "3", "FourBed": "4",
       "FiveBed": "5", "SixBed": "6", "SevenBed": "7", "EightBed": "8", "NineBedPlus": "9+", "NotSet": None}
BATH = {"OneBath": "1", "OnePointFiveBath": "1.5", "TwoBath": "2", "TwoPointFiveBath": "2.5",
        "ThreeBath": "3", "ThreePointFiveBath": "3.5", "FourBath": "4", "FourPointFiveBath": "4.5",
        "FiveBath": "5", "NotSet": None}
SECTION8_RENT_SENTINEL = 1111.0


def headers(credential: dict[str, str]) -> dict[str, str]:
    return {
        "x-buildium-client-id": credential["clientId"],
        "x-buildium-client-secret": credential["clientSecret"],
        "Content-Type": "application/json",
    }


def paginate(credential: dict[str, str], path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    offset = 0
    while offset < CAP:
        query = dict(params or {})
        query.update({"limit": PAGE, "offset": offset})
        batch = get_json(f"{API}/{path}", params=query, headers=headers(credential), timeout=45)
        if not isinstance(batch, list):
            raise PipelineError("Buildium returned an invalid page; existing data was preserved")
        out.extend(batch)
        if len(batch) < PAGE:
            return out
        offset += PAGE
        time.sleep(0.12)
    raise PipelineError("Buildium pagination limit reached; existing data was preserved")


def to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_ts(value: Any) -> datetime | None:
    """Buildium ISO timestamps (with or without zone) → naive UTC."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def to_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def application_row(ws: str, applicant: dict[str, Any], now: datetime) -> list[Any]:
    apps = applicant.get("Applications") or []
    primary = apps[0] if apps else {}
    return [
        new_id(), ws, applicant.get("Id"), primary.get("Id"), primary.get("ApplicationNumber"),
        applicant.get("Status"), primary.get("ApplicationStatus"), applicant.get("PropertyId"),
        applicant.get("UnitId"), applicant.get("TenantId"), to_ts(primary.get("ApplicationSubmittedDateTime")),
        to_ts(applicant.get("LastUpdatedDateTime")), now,
    ]


def lease_row(ws: str, lease: dict[str, Any], now: datetime) -> list[Any]:
    account = lease.get("AccountDetails") or {}
    return [
        new_id(), ws, lease.get("Id"), lease.get("PropertyId"), lease.get("UnitId"), lease.get("UnitNumber"),
        lease.get("LeaseStatus"), lease.get("LeaseType"), lease.get("TermType"),
        to_date(lease.get("LeaseFromDate")), to_date(lease.get("LeaseToDate")),
        to_float(account.get("Rent")), to_float(account.get("SecurityDeposit")),
        lease.get("CurrentNumberOfOccupants"), lease.get("IsEvictionPending"),
        to_ts(lease.get("CreatedDateTime")), to_ts(lease.get("LastUpdatedDateTime")), now,
    ]


def property_row(ws: str, prop: dict[str, Any], now: datetime) -> list[Any]:
    address = prop.get("Address") or {}
    manager = prop.get("RentalManager") or {}
    manager_name = " ".join(x for x in (manager.get("FirstName"), manager.get("LastName")) if x) or None
    return [
        new_id(), ws, prop.get("Id"), prop.get("Name"), address.get("AddressLine1"), address.get("City"),
        address.get("State"), address.get("PostalCode"), prop.get("IsActive"), prop.get("RentalType"),
        prop.get("RentalSubType"), prop.get("NumberUnits"), prop.get("YearBuilt"), prop.get("StructureDescription"),
        prop.get("OperatingBankAccountId"), to_float(prop.get("Reserve")), manager_name, now,
    ]


def unit_row(ws: str, unit: dict[str, Any], now: datetime) -> list[Any]:
    address = unit.get("Address") or {}
    return [
        new_id(), ws, unit.get("Id"), unit.get("PropertyId"), unit.get("BuildingName"), unit.get("UnitNumber"),
        unit.get("Description"), to_float(unit.get("MarketRent")), address.get("AddressLine1"), address.get("City"),
        address.get("State"), address.get("PostalCode"), BED.get(unit.get("UnitBedrooms")),
        BATH.get(unit.get("UnitBathrooms")), unit.get("UnitSize"), unit.get("IsUnitListed"), unit.get("IsUnitOccupied"), now,
    ]


def listing_row(ws: str, listing: dict[str, Any], now: datetime) -> list[Any] | None:
    prop = listing.get("Property") or {}
    address = prop.get("Address") or {}
    unit = listing.get("Unit") or {}
    if unit.get("Id") is None:
        return None
    rent = to_float(listing.get("Rent"))
    return [
        new_id(), ws, unit.get("Id"), prop.get("Id"), prop.get("Name"), address.get("AddressLine1"),
        address.get("City"), address.get("State"), address.get("PostalCode"), unit.get("UnitNumber"),
        BED.get(unit.get("UnitBedrooms")), BATH.get(unit.get("UnitBathrooms")), unit.get("UnitSize"), rent,
        to_float(listing.get("Deposit")), listing.get("LeaseTerms"), to_date(listing.get("AvailableDate")),
        to_date(listing.get("ListingDate")), rent == SECTION8_RENT_SENTINEL, listing.get("IsManagedExternally"),
        listing.get("RentalApplicationUrl"), now,
    ]


def file_row(ws: str, file: dict[str, Any], now: datetime) -> list[Any]:
    entity = file.get("FileEntity") or {}
    return [
        new_id(), ws, file.get("Id"), entity.get("Id"), entity.get("EntityType"), file.get("CategoryId"),
        file.get("Title"), file.get("Description"), file.get("PhysicalFileName"), to_ts(file.get("UploadedDateTime")), now,
    ]


APPLICATION_COLUMNS = ["id", "workspaceId", "applicantId", "applicationId", "applicationNumber", "status", "applicationStatus", "propertyId", "unitId", "tenantId", "submittedAt", "lastUpdated", "updatedAt"]
LEASE_COLUMNS = ["id", "workspaceId", "leaseId", "propertyId", "unitId", "unitNumber", "status", "leaseType", "termType", "leaseFrom", "leaseTo", "rent", "securityDeposit", "numberOfOccupants", "isEvictionPending", "sourceCreatedAt", "lastUpdated", "updatedAt"]
PROPERTY_COLUMNS = ["id", "workspaceId", "propertyId", "name", "addressLine", "city", "state", "postalCode", "isActive", "rentalType", "rentalSubType", "numberUnits", "yearBuilt", "structureDescription", "operatingBankAccountId", "reserve", "rentalManager", "updatedAt"]
UNIT_COLUMNS = ["id", "workspaceId", "unitId", "propertyId", "buildingName", "unitNumber", "description", "marketRent", "addressLine", "city", "state", "postalCode", "bedrooms", "bathrooms", "unitSize", "isListed", "isOccupied", "updatedAt"]
LISTING_COLUMNS = ["id", "workspaceId", "unitId", "propertyId", "propertyName", "addressLine", "city", "state", "postalCode", "unitNumber", "bedrooms", "bathrooms", "unitSize", "rent", "deposit", "leaseTerms", "availableDate", "listingDate", "isSection8", "isManagedExternally", "applicationUrl", "updatedAt"]
FILE_COLUMNS = ["id", "workspaceId", "fileId", "entityId", "entityType", "categoryId", "title", "description", "physicalFileName", "uploadedAt", "updatedAt"]


def run(context: RunContext) -> RunResult:
    credential = context.credential("buildium")
    if not credential.get("clientId") or not credential.get("clientSecret"):
        raise PipelineError("buildium credential needs clientId and clientSecret")
    ws = context.workspace_id
    now = utc_now()

    applicants = paginate(credential, "applicants")
    leases = paginate(credential, "leases")
    properties = paginate(credential, "rentals")
    listings = paginate(credential, "rentals/units/listings")
    units = paginate(credential, "rentals/units")

    application_rows = [application_row(ws, a, now) for a in applicants]
    lease_rows = [lease_row(ws, lease, now) for lease in leases]
    property_rows = [property_row(ws, p, now) for p in properties]
    unit_rows = [unit_row(ws, u, now) for u in units]
    listing_rows = [row for row in (listing_row(ws, x, now) for x in listings) if row]
    if len(listing_rows) != len(listings):
        raise PipelineError("Buildium listing is missing its unit id; existing data was preserved")

    with connection() as conn:
        cur = conn.cursor()
        upsert_rows(cur, "workspace_buildium_applications", APPLICATION_COLUMNS, application_rows, ["workspaceId", "applicantId"])
        upsert_rows(cur, "workspace_buildium_leases", LEASE_COLUMNS, lease_rows, ["workspaceId", "leaseId"])
        upsert_rows(cur, "workspace_buildium_properties", PROPERTY_COLUMNS, property_rows, ["workspaceId", "propertyId"])
        upsert_rows(cur, "workspace_buildium_units", UNIT_COLUMNS, unit_rows, ["workspaceId", "unitId"])

        # Files: incremental from the newest stored upload with a 7-day overlap.
        cur.execute('select max("uploadedAt") from workspace_buildium_files where "workspaceId" = %s', (ws,))
        watermark = cur.fetchone()[0]
        uploaded_from = (watermark - timedelta(days=7)).strftime("%Y-%m-%d") if watermark else "2010-01-01"
        files = paginate(credential, "files", {"uploadedfrom": uploaded_from})
        file_rows = [file_row(ws, f, now) for f in files]
        upsert_rows(cur, "workspace_buildium_files", FILE_COLUMNS, file_rows, ["workspaceId", "fileId"])

        upsert_rows(cur, "workspace_buildium_listings", LISTING_COLUMNS, listing_rows, ["workspaceId", "unitId"])
        active_units = [row[2] for row in listing_rows]
        cur.execute(
            'delete from workspace_buildium_listings where "workspaceId" = %s and not ("unitId" = any(%s))',
            (ws, active_units),
        )
        pruned = cur.rowcount
        cur.close()
    total = len(application_rows) + len(lease_rows) + len(property_rows) + len(unit_rows) + len(listing_rows) + len(file_rows)
    return RunResult(
        records_loaded=total,
        notes=(
            f"applications={len(application_rows)} leases={len(lease_rows)} properties={len(property_rows)} "
            f"units={len(unit_rows)} listings={len(listing_rows)} (pruned {pruned}) files={len(file_rows)}"
        ),
    )
