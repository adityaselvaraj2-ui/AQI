"""
Source Tagging and Location Influence Engine
============================================
Provides deterministic source tagging, distance decay, wind transport alignment,
atmospheric trapping modulation (PBL suppression + thermal inversion), and
location-specific source influence ranking.

Physics Formulation:
--------------------
1. Coordinate Bearing (θ):
   Initial great-circle bearing from source (lat_s, lon_s) to target (lat_t, lon_t).

2. Meteorological Wind -> Transport Direction:
   Wind direction is reported as the direction wind blows FROM.
   Atmospheric transport heading is (wind_from_deg + 180°) mod 360°.

3. Wind Alignment (al ∈ [0, 1]):
   Angular difference Δ = |θ - transport_heading| mod 360°
   Minimum difference Δ_diff = 180° - |180° - Δ|
   Alignment = clamp((cos(rad(Δ_diff)) + 1) / 2, 0, 1)

4. Atmospheric Trapping Potential:
   pbl_factor = clamp((1200 / max(300, pbl_m))^0.35, 0.25, 3.0)
   inversion_factor = 1.25 if ΔT > 6 else 1.12 if ΔT > 3.5 else 1.04 if ΔT > 1.5 else 0.92
   trapping_factor = clamp(pbl_factor * inversion_factor, 0.65, 1.50)

5. Distance Decay:
   Decay = exp(-distance_km / 55.0)

6. Influence Score:
   Score = clamp(Decay * (0.35 + 0.65 * Alignment) * Source_Strength * Trapping_Factor, 0, 1)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional

SourceType = Literal["industry", "biomass", "traffic", "dust", "background"]
InfluenceLevel = Literal["HIGH", "MEDIUM", "LOW", "MINIMAL"]
ConfidenceLevel = Literal["HIGH", "MEDIUM", "LOW"]


def clamp(val: float, low: float = 0.0, high: float = 1.0) -> float:
    """Clamps a floating point value to [low, high]."""
    return max(low, min(high, float(val)))


def generate_source_id(
    source_type: str,
    lat: float,
    lon: float,
    extra_id: Optional[str] = None,
    name: Optional[str] = None,
) -> str:
    """
    Generates a deterministic, stable source identity string.
    Handles potential coordinate collision by combining stable identifier / name hash.
    Examples:
      IND_del-anchor-0001_28.5032_77.3068
      FIRE_30.4500_75.1200
    """
    prefix = (
        "IND" if "ind" in source_type.lower()
        else "FIRE" if "bio" in source_type.lower() or "fire" in source_type.lower()
        else "TRF" if "traf" in source_type.lower()
        else "DUST" if "dust" in source_type.lower()
        else "SRC"
    )
    if extra_id:
        clean_id = str(extra_id).strip().replace(" ", "_").replace("/", "_")[:24]
        return f"{prefix}_{clean_id}_{lat:.4f}_{lon:.4f}"
    if name:
        import hashlib
        short_hash = hashlib.md5(name.encode("utf-8")).hexdigest()[:6]
        return f"{prefix}_{short_hash}_{lat:.4f}_{lon:.4f}"
    return f"{prefix}_{lat:.4f}_{lon:.4f}"



def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometers using the Haversine formula."""
    r_earth = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return float(r_earth * c)


def calculate_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Initial bearing (forward azimuth) in degrees from point 1 (source) to point 2 (target).
    Returns value in [0, 360).
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_lambda = math.radians(lon2 - lon1)

    y = math.sin(d_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(d_lambda)
    bearing = math.degrees(math.atan2(y, x))
    return float((bearing + 360.0) % 360.0)


def calculate_wind_alignment(
    source_lat: float,
    source_lon: float,
    target_lat: float,
    target_lon: float,
    wind_from_deg: float,
) -> tuple[float, float, float]:
    """
    Computes:
    - bearing_deg: Direction from source to target (0-360°)
    - transport_dir_deg: Direction wind is carrying air masses (wind_from + 180°) mod 360°
    - alignment: Normalized alignment score in [0.0, 1.0] (1.0 = perfect downwind transport to target)
    """
    bearing_deg = calculate_bearing_deg(source_lat, source_lon, target_lat, target_lon)
    transport_dir_deg = float((wind_from_deg + 180.0) % 360.0)

    # Angular difference on the circle
    delta = abs((bearing_deg - transport_dir_deg + 540.0) % 360.0 - 180.0)
    # Cosine alignment: 1.0 at 0° delta, 0.5 at 90° crosswind, 0.0 at 180° opposing
    alignment = clamp((math.cos(math.radians(delta)) + 1.0) / 2.0, 0.0, 1.0)
    return bearing_deg, transport_dir_deg, alignment


def compute_atmospheric_trapping(
    pbl_height_m: float,
    inversion_delta_t: float,
    wind_speed_ms: float = 2.0,
) -> tuple[float, str, str, str]:
    """
    Evaluates atmospheric trapping potential based on boundary layer mixing volume
    and temperature inversion strength.

    Returns:
      (trapping_factor, inversion_state, mixing_category, trapping_potential)
    """
    pbl_safe = max(200.0, float(pbl_height_m))
    pbl_factor = clamp((1200.0 / pbl_safe) ** 0.35, 0.25, 3.0)

    delta_t = float(inversion_delta_t)
    if delta_t > 6.0:
        inv_factor = 1.25
        inv_state = "Strong Inversion"
    elif delta_t > 3.5:
        inv_factor = 1.12
        inv_state = "Moderate Inversion"
    elif delta_t > 1.5:
        inv_factor = 1.04
        inv_state = "Weak Inversion"
    else:
        inv_factor = 0.92
        inv_state = "Uncapped / Normal"

    # Deep vs shallow mixing category
    if pbl_safe < 500:
        mixing_category = "Shallow / Trapped"
    elif pbl_safe < 1200:
        mixing_category = "Moderate Mixing"
    else:
        mixing_category = "Deep / Well-Ventilated"

    trapping_factor = clamp(pbl_factor * inv_factor, 0.65, 1.50)

    if trapping_factor >= 1.20:
        trapping_potential = "High"
    elif trapping_factor >= 0.98:
        trapping_potential = "Moderate"
    else:
        trapping_potential = "Low"

    return trapping_factor, inv_state, mixing_category, trapping_potential


def classify_influence_level(score: float) -> InfluenceLevel:
    """Classifies estimated influence score into standard categorical bands."""
    if score >= 0.70:
        return "HIGH"
    if score >= 0.40:
        return "MEDIUM"
    if score >= 0.15:
        return "LOW"
    return "MINIMAL"


def classify_confidence_level(confidence: float) -> ConfidenceLevel:
    """Classifies confidence score into standard categorical bands."""
    if confidence >= 0.70:
        return "HIGH"
    if confidence >= 0.40:
        return "MEDIUM"
    return "LOW"


@dataclass
class TaggedSource:
    """Canonical representation of an identifiable emission or plume source."""
    source_id: str
    source_type: SourceType
    name: str
    region: str
    latitude: float
    longitude: float
    activity_status: str
    strength: float
    strength_unit: str
    observation_time: str
    data_source: str
    confidence: float
    sector: Optional[str] = None
    category: Optional[str] = None
    address: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SourceInfluenceAssessment:
    """Result of evaluating a tagged source's estimated influence on a target coordinate."""
    source: TaggedSource
    distance_km: float
    bearing_deg: float
    transport_dir_deg: float
    wind_alignment_pct: float
    influence_score: float
    influence_level: InfluenceLevel
    confidence_pct: float
    confidence_level: ConfidenceLevel
    detail_summary: str
    physics_explanation: str
    metadata: dict[str, Any] = field(default_factory=dict)


def evaluate_industry_source(
    industry_row: dict[str, Any],
    target_lat: float,
    target_lon: float,
    wind_from_deg: float,
    trapping_factor: float,
    max_radius_km: float = 140.0,
) -> Optional[SourceInfluenceAssessment]:
    """Calculates location-specific influence of an industrial facility."""
    lat = float(industry_row.get("latitude") or industry_row.get("lat", 0.0))
    lon = float(industry_row.get("longitude") or industry_row.get("lon", 0.0))
    if lat == 0.0 or lon == 0.0:
        return None

    distance_km = haversine_distance_km(lat, lon, target_lat, target_lon)
    if distance_km > max_radius_km:
        return None

    bearing_deg, transport_dir_deg, alignment = calculate_wind_alignment(
        lat, lon, target_lat, target_lon, wind_from_deg
    )

    # Base industrial strength by sector/category
    category = str(industry_row.get("category") or "").lower()
    name = str(industry_row.get("name") or industry_row.get("industry_name") or "Delhi Industrial Facility")
    sector = str(industry_row.get("sector") or industry_row.get("category") or "Industrial Source")

    # Higher initial weight for heavy combustion/power/chemical
    if any(k in category or k in name.lower() for k in ("power", "waste to energy", "chemical", "metal", "steel", "pyrolysis")):
        base_strength = 0.85
    elif any(k in category or k in name.lower() for k in ("building", "concrete", "stone", "textile", "boiler")):
        base_strength = 0.70
    else:
        base_strength = 0.55

    # Exponential distance decay with scale d0 = 55 km
    decay = math.exp(-distance_km / 55.0)
    score = clamp(decay * (0.35 + 0.65 * alignment) * base_strength * trapping_factor, 0.0, 1.0)

    if score < 0.035:
        return None

    source_id = generate_source_id("IND", lat, lon, industry_row.get("id"))
    confidence = clamp(0.45 + alignment * 0.35 + (0.12 if distance_km < 25.0 else 0.0), 0.0, 1.0)

    tagged_source = TaggedSource(
        source_id=source_id,
        source_type="industry",
        name=name,
        region="Delhi-NCR",
        latitude=lat,
        longitude=lon,
        activity_status=str(industry_row.get("status") or "Operational"),
        strength=base_strength,
        strength_unit="relative_index",
        observation_time=datetime.now(timezone.utc).isoformat(),
        data_source="DELHI_DPCC_MASTER_DIRECTORY",
        confidence=confidence,
        sector=sector,
        category=industry_row.get("category"),
        address=industry_row.get("address"),
        metadata={"distance_km": round(distance_km, 2), "bearing_deg": round(bearing_deg, 1)},
    )

    influence_level = classify_influence_level(score)
    confidence_level = classify_confidence_level(confidence)

    explanation = (
        f"{distance_km:.1f} km {bearing_deg:.0f}° upwind relative to {transport_dir_deg:.0f}° transport wind. "
        f"Wind alignment {alignment * 100:.0f}%, trapping modifier {trapping_factor:.2f}x."
    )

    return SourceInfluenceAssessment(
        source=tagged_source,
        distance_km=round(distance_km, 1),
        bearing_deg=round(bearing_deg, 1),
        transport_dir_deg=round(transport_dir_deg, 1),
        wind_alignment_pct=round(alignment * 100.0, 1),
        influence_score=round(score, 3),
        influence_level=influence_level,
        confidence_pct=round(confidence * 100.0, 1),
        confidence_level=confidence_level,
        detail_summary=sector,
        physics_explanation=explanation,
    )


def evaluate_biomass_fire_source(
    plume_dict: dict[str, Any],
    target_lat: float,
    target_lon: float,
    wind_from_deg: float,
    trapping_factor: float,
    max_radius_km: float = 450.0,
) -> Optional[SourceInfluenceAssessment]:
    """Calculates location-specific influence of a NASA FIRMS agricultural fire plume."""
    origin = plume_dict.get("origin", {})
    lat = float(origin.get("lat", 0.0))
    lon = float(origin.get("lon", 0.0))
    if lat == 0.0 or lon == 0.0:
        return None

    distance_km = haversine_distance_km(lat, lon, target_lat, target_lon)
    if distance_km > max_radius_km:
        return None

    bearing_deg, transport_dir_deg, alignment = calculate_wind_alignment(
        lat, lon, target_lat, target_lon, wind_from_deg
    )

    frp_mw = float(origin.get("frp_mw", 25.0))
    fire_strength = clamp(math.sqrt(max(0.0, frp_mw) / 100.0), 0.25, 1.0)

    # Lagrangian closest approach proximity factor
    closest_approach_km = float(plume_dict.get("closest_approach_km", distance_km))
    plume_proximity = math.exp(-max(0.0, closest_approach_km) / 22.0)

    # Effective distance decay
    decay = math.exp(-distance_km / 85.0)
    composite_strength = 0.92 * fire_strength * (0.60 + 0.40 * plume_proximity)
    score = clamp(decay * (0.30 + 0.70 * alignment) * composite_strength * trapping_factor, 0.0, 1.0)

    if score < 0.025:
        return None

    source_id = generate_source_id("FIRE", lat, lon)
    firms_conf = str(origin.get("confidence", "n")).lower()
    conf_bonus = 0.15 if firms_conf in ("h", "high") else 0.08 if firms_conf in ("n", "nominal") else 0.0
    confidence = clamp(0.45 + alignment * 0.30 + conf_bonus, 0.0, 1.0)

    state = str(origin.get("source_state") or "Punjab / Haryana")
    name = f"{state} Agricultural Biomass Fire"

    tagged_source = TaggedSource(
        source_id=source_id,
        source_type="biomass",
        name=name,
        region=state,
        latitude=lat,
        longitude=lon,
        activity_status="Active Thermal Anomaly",
        strength=round(frp_mw, 1),
        strength_unit="MW (FRP)",
        observation_time=str(origin.get("acq_date") or datetime.now(timezone.utc).isoformat()),
        data_source="NASA_FIRMS_VIIRS_NRT",
        confidence=confidence,
        sector="Crop Residue Burning",
        category="Biomass Fire",
        metadata={
            "frp_mw": frp_mw,
            "closest_approach_km": round(closest_approach_km, 1),
            "distance_km": round(distance_km, 1),
        },
    )

    influence_level = classify_influence_level(score)
    confidence_level = classify_confidence_level(confidence)

    explanation = (
        f"VIIRS thermal detection ({frp_mw:.0f} MW FRP) {distance_km:.0f} km away. "
        f"Plume closest approach {closest_approach_km:.1f} km, wind alignment {alignment * 100:.0f}%."
    )

    return SourceInfluenceAssessment(
        source=tagged_source,
        distance_km=round(distance_km, 1),
        bearing_deg=round(bearing_deg, 1),
        transport_dir_deg=round(transport_dir_deg, 1),
        wind_alignment_pct=round(alignment * 100.0, 1),
        influence_score=round(score, 3),
        influence_level=influence_level,
        confidence_pct=round(confidence * 100.0, 1),
        confidence_level=confidence_level,
        detail_summary=f"VIIRS Thermal Anomaly · {frp_mw:.0f} MW FRP",
        physics_explanation=explanation,
        metadata={"frp_mw": frp_mw, "closest_approach_km": round(closest_approach_km, 1)},
    )
