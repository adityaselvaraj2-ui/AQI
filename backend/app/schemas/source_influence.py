"""
Source Influence Schemas
========================
Pydantic response and request models for Location Intelligence and Source Tagged Influence.
"""
from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field


class TaggedSourceSchema(BaseModel):
    """Identifiable pollution source with deterministic identity."""
    source_id: str = Field(..., description="Deterministic source identifier e.g. IND_28.6139_77.2090")
    source_type: str = Field(..., description="Source type: industry, biomass, traffic, dust, background")
    name: str = Field(..., description="Human-readable name")
    region: str = Field(default="Delhi-NCR", description="Geographical region or administrative state")
    latitude: float = Field(..., description="Latitude coordinate")
    longitude: float = Field(..., description="Longitude coordinate")
    activity_status: str = Field(default="Operational", description="Current activity status")
    strength: float = Field(..., description="Source emission strength or proxy index")
    strength_unit: str = Field(default="index", description="Measurement unit (e.g. MW FRP, relative_index)")
    observation_time: str = Field(..., description="Timestamp of observation or detection")
    data_source: str = Field(..., description="Underlying catalog / satellite product")
    confidence: float = Field(default=0.7, ge=0.0, le=1.0, description="Source data confidence [0, 1]")
    sector: Optional[str] = Field(default=None, description="Industry sector or emission category")
    category: Optional[str] = Field(default=None, description="Broad category")
    address: Optional[str] = Field(default=None, description="Facility address or location description")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional source attributes")


class SourceInfluenceItem(BaseModel):
    """Calculated influence of an individual source on a target location."""
    source: TaggedSourceSchema
    distance_km: float = Field(..., description="Great-circle distance in kilometers to target")
    bearing_deg: float = Field(..., description="Direction from source toward target (0-360°)")
    transport_dir_deg: float = Field(..., description="Atmospheric wind transport heading (0-360°)")
    wind_alignment_pct: float = Field(..., ge=0.0, le=100.0, description="Wind alignment percentage (100% = perfectly downwind)")
    influence_score: float = Field(..., ge=0.0, le=1.0, description="Calculated influence score [0, 1]")
    influence_level: str = Field(..., description="Influence tier: HIGH, MEDIUM, LOW, MINIMAL")
    confidence_pct: float = Field(..., ge=0.0, le=100.0, description="Confidence percentage")
    confidence_level: str = Field(..., description="Confidence tier: HIGH, MEDIUM, LOW")
    detail_summary: str = Field(..., description="Short summary description")
    physics_explanation: str = Field(..., description="Physical explanation of the influence ranking")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Detailed computation metrics")


class AtmosphericConditionsSummary(BaseModel):
    """Atmospheric context influencing pollutant transport and dispersion."""
    wind_speed_ms: float = Field(..., description="Wind speed in meters per second")
    wind_direction_deg: float = Field(..., description="Meteorological wind direction (from where wind blows, 0-360°)")
    transport_direction_deg: float = Field(..., description="Advection direction (towards where air moves, 0-360°)")
    pbl_height_m: float = Field(..., description="Planetary Boundary Layer height in meters")
    inversion_delta_t_celsius: float = Field(..., description="Temperature inversion strength ΔT (T925 - T1000 °C)")
    inversion_state: str = Field(..., description="Inversion classification (Strong, Moderate, Weak, None)")
    mixing_category: str = Field(..., description="Atmospheric mixing category (Shallow / Trapped, Moderate, Deep)")
    trapping_potential: str = Field(..., description="Trapping potential rating: High, Moderate, Low")
    trapping_factor: float = Field(..., description="Composite atmospheric trapping multiplier")


class TargetLocation(BaseModel):
    """Target evaluation coordinates and label."""
    name: str = Field(default="Selected Location", description="Location name or station label")
    latitude: float = Field(..., description="Target latitude coordinate")
    longitude: float = Field(..., description="Target longitude coordinate")


class SourceInfluenceResponse(BaseModel):
    """Response payload for GET /api/v1/source-influence."""
    generated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    target_location: TargetLocation
    atmospheric_conditions: AtmosphericConditionsSummary
    ranked_sources: list[SourceInfluenceItem] = Field(default_factory=list)
    source_count: int = Field(default=0)
    dominant_source_type: Optional[str] = Field(default=None)
    methodology: str = Field(
        default="Lagrangian transport alignment, distance decay (55km scale), and PBL/inversion entrapment modulation."
    )
    disclaimer: str = Field(
        default="Model-estimated influence scores indicate relative downwind potential and transport alignment. These are not chemically resolved mass contribution percentages."
    )
