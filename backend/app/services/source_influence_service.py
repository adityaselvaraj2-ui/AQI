"""
Source Influence Service
========================
Coordinates atmospheric diagnostics, industry registries, and FIRMS biomass fire plumes
to calculate location-specific, wind-aligned source influence rankings.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from app.physics.inversion_engine import compute_inversion_series, fetch_inversion_data
from app.physics.plume_advection import compute_plume_vectors
from app.physics.source_tagging import (
    compute_atmospheric_trapping,
    evaluate_biomass_fire_source,
    evaluate_industry_source,
)
from app.schemas.source_influence import (
    AtmosphericConditionsSummary,
    SourceInfluenceItem,
    SourceInfluenceResponse,
    TaggedSourceSchema,
    TargetLocation,
)
from app.services.industry_service import fetch_delhi_industries

logger = logging.getLogger(__name__)


async def calculate_source_influence(
    target_lat: float = 28.6139,
    target_lon: float = 77.2090,
    target_name: str = "Delhi-NCR",
    hour_idx: Optional[int] = None,
    limit: int = 15,
) -> SourceInfluenceResponse:
    """
    Computes location-specific source influence for the given target coordinates.
    """
    # 1. Fetch atmospheric parameters (wind, PBL, inversion)
    wind_speed_ms = 3.2
    wind_direction_deg = 315.0  # NW default in post-monsoon Delhi
    pbl_height_m = 650.0
    inversion_delta_t = 3.8

    try:
        inv_data = await fetch_inversion_data()
        inv_series = compute_inversion_series(inv_data)
        if inv_series:
            # Pick the specified forecast hour or the current (0th) hour
            idx = max(0, min(len(inv_series) - 1, hour_idx if hour_idx is not None else 0))
            h = inv_series[idx]
            if isinstance(h, dict):
                pbl_height_m = float(h.get("pbl_height_m", pbl_height_m))
                inversion_delta_t = float(h.get("delta_t_celsius", inversion_delta_t))
                wind_speed_ms = float(h.get("wind_speed_ms") or wind_speed_ms)
                wind_direction_deg = float(h.get("wind_direction_deg") or wind_direction_deg)
            else:
                pbl_height_m = float(getattr(h, "pbl_height_m", pbl_height_m))
                inversion_delta_t = float(getattr(h, "delta_t_celsius", inversion_delta_t))
                wind_speed_ms = float(getattr(h, "wind_speed_ms", wind_speed_ms) or wind_speed_ms)
                wind_direction_deg = float(getattr(h, "wind_direction_deg", wind_direction_deg) or wind_direction_deg)
    except Exception as e:
        logger.warning("Could not fetch live atmospheric profile: %s. Using standard defaults.", e)

    # 2. Evaluate atmospheric trapping potential
    (
        trapping_factor,
        inversion_state,
        mixing_category,
        trapping_potential,
    ) = compute_atmospheric_trapping(
        pbl_height_m=pbl_height_m,
        inversion_delta_t=inversion_delta_t,
        wind_speed_ms=wind_speed_ms,
    )
    transport_direction_deg = float((wind_direction_deg + 180.0) % 360.0)

    atm_summary = AtmosphericConditionsSummary(
        wind_speed_ms=round(wind_speed_ms, 1),
        wind_direction_deg=round(wind_direction_deg, 1),
        transport_direction_deg=round(transport_direction_deg, 1),
        pbl_height_m=round(pbl_height_m, 0),
        inversion_delta_t_celsius=round(inversion_delta_t, 2),
        inversion_state=inversion_state,
        mixing_category=mixing_category,
        trapping_potential=trapping_potential,
        trapping_factor=round(trapping_factor, 2),
    )

    # 3. Gather industrial facilities (from bundled 534+ Delhi dataset + Supabase)
    industry_resp = await fetch_delhi_industries()
    raw_industries = industry_resp.records

    # 4. Gather fire plumes (NASA FIRMS / Lagrangian trajectories)
    fire_plumes: list[dict] = []
    try:
        plume_resp = await compute_plume_vectors()
        if isinstance(plume_resp, dict):
            fire_plumes = plume_resp.get("plumes", [])
        elif hasattr(plume_resp, "model_dump"):
            fire_plumes = plume_resp.model_dump().get("plumes", [])
        elif hasattr(plume_resp, "plumes"):
            fire_plumes = [p.model_dump() if hasattr(p, "model_dump") else p for p in plume_resp.plumes]
    except Exception as e:
        logger.warning("Error loading fire plumes for source influence: %s", e)
        fire_plumes = []

    # 5. Evaluate all sources
    ranked_assessments = []

    # Evaluate industries
    for ind in raw_industries:
        row_dict = ind.model_dump()
        assessment = evaluate_industry_source(
            industry_row=row_dict,
            target_lat=target_lat,
            target_lon=target_lon,
            wind_from_deg=wind_direction_deg,
            trapping_factor=trapping_factor,
        )
        if assessment:
            ranked_assessments.append(assessment)

    # Evaluate biomass fires
    for pl in fire_plumes:
        assessment = evaluate_biomass_fire_source(
            plume_dict=pl,
            target_lat=target_lat,
            target_lon=target_lon,
            wind_from_deg=wind_direction_deg,
            trapping_factor=trapping_factor,
        )
        if assessment:
            ranked_assessments.append(assessment)

    # 6. Sort by influence score descending
    ranked_assessments.sort(key=lambda x: x.influence_score, reverse=True)
    top_assessments = ranked_assessments[: max(1, min(50, limit))]

    # Convert to response items
    items: list[SourceInfluenceItem] = []
    dominant_type = None
    type_counts: dict[str, float] = {}

    for a in top_assessments:
        s = a.source
        src_schema = TaggedSourceSchema(
            source_id=s.source_id,
            source_type=s.source_type,
            name=s.name,
            region=s.region,
            latitude=s.latitude,
            longitude=s.longitude,
            activity_status=s.activity_status,
            strength=s.strength,
            strength_unit=s.strength_unit,
            observation_time=s.observation_time,
            data_source=s.data_source,
            confidence=s.confidence,
            sector=s.sector,
            category=s.category,
            address=s.address,
            metadata=s.metadata,
        )
        items.append(
            SourceInfluenceItem(
                source=src_schema,
                distance_km=a.distance_km,
                bearing_deg=a.bearing_deg,
                transport_dir_deg=a.transport_dir_deg,
                wind_alignment_pct=a.wind_alignment_pct,
                influence_score=a.influence_score,
                influence_level=a.influence_level,
                confidence_pct=a.confidence_pct,
                confidence_level=a.confidence_level,
                detail_summary=a.detail_summary,
                physics_explanation=a.physics_explanation,
                metadata=a.metadata,
            )
        )
        type_counts[s.source_type] = type_counts.get(s.source_type, 0.0) + a.influence_score

    if type_counts:
        dominant_type = max(type_counts.items(), key=lambda kv: kv[1])[0]

    return SourceInfluenceResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        target_location=TargetLocation(
            name=target_name,
            latitude=round(target_lat, 4),
            longitude=round(target_lon, 4),
        ),
        atmospheric_conditions=atm_summary,
        ranked_sources=items,
        source_count=len(items),
        dominant_source_type=dominant_type,
    )
