"""AirLens physics engine — the coupled column model.

Modules:
    box_model         prognostic two-reservoir column (mixed + residual layer)
    inversion_engine  inversion diagnostics + met<->chemistry coupling kernels
    plume_advection   FIRMS stubble plumes advected on 850 hPa winds
    source_tagging    upwind source attribution

Integrated hour-by-hour by services/aqi_service.py, which closes the two-way
met<->chemistry feedback loop (PM2.5 -> AOD -> shortwave loss -> cooling ->
shallower PBL -> higher PM2.5) by Picard iteration. This package is the core
of the AirLens framework; see ARCHITECTURE.md for the full scope statement.
"""
