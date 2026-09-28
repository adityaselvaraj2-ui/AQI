# Known Limitations

Scope boundaries of the current AirLens build, stated plainly.

- Single column, no gridded field: one physics column represents Delhi NCR; the map interpolates live station observations and shows no spatial forecast field.
- Physics surrogate, not a chemistry-transport model: a prognostic two-reservoir column box model (`backend/app/physics/box_model.py`) driven by an inversion engine, deliberately not WRF-Chem/CMAQ.
- No gas-phase chemistry: ground-level O3 is diagnosed (background + in-situ production − NO titration); NOx, SO2 and CO do not react with each other.
- Ingestion is a stub: `POST /ingest/observation` validates and acknowledges (202) without persistence or assimilation.
- Hand-set constants: box-model emission fluxes and backgrounds (`box_model.SPECIES`) reproduce the order of magnitude and diurnal shape of CPCB climatology, not a gridded inventory; the plume chain uses published factors (Wooster 2005, Andreae & Merlet) with `max(Pasquill–Gifford, Heffter 1965)` dispersion.
- Wind does not respond to aerosols: the feedback alters boundary-layer depth and surface temperature; an aerosol→wind response needs a momentum equation this model does not have.
- PBL floor: boundary-layer depth is floored at 150 m (`PBL_MIN_M`), below which a uniformly mixed box stops being meaningful.
- Single-process state: response cache and rate limiter are in-memory, hence `--workers 1`; scaling out requires externalising both.
- Fire hotspots need a key: without `FIRMS_API_KEY` the hotspot list is empty and plume contribution is zero — reported as such, never substituted with synthetic fires.
- Validation coverage differs by component: the LightGBM and Chronos-2 station models report holdout metrics in `llm/model/station_models/metrics_summary.json` and `llm/model/station_models_chronos2/CHRONOS2_VERDICT.md`; the physics engine is validated behaviourally (`backend/tests/`, `scripts/verify/`) but has no backtest against withheld historical observations.
