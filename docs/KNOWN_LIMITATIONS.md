# Known Limitations

Scope boundaries of the current AirLens build, stated plainly so reviewers do not
have to discover them.

- **Single column, no gridded field.** The physics engine forecasts one column
  representing Delhi NCR. The map interpolates live station observations; there
  is no spatial forecast field and no downscaling.
- **Physics surrogate, not a chemistry-transport model.** The core is a
  prognostic two-reservoir column box model (`backend/app/physics/box_model.py`)
  driven by an inversion engine (`backend/app/physics/inversion_engine.py`) —
  deliberately not WRF-Chem or CMAQ.
- **No gas-phase chemistry.** Ground-level O3 is diagnosed (regional background +
  in-situ production − NO titration, reading the post-aerosol shortwave flux).
  NOx, SO2 and CO are transported and deposited but do not react with each other.
- **Ingestion endpoint is a stub.** `POST /ingest/observation` validates and
  acknowledges (202) but does not persist or assimilate; there is no
  time-series store in this deployment.
- **Hand-set emission constants.** Column-model emission fluxes and backgrounds
  (`box_model.SPECIES`) are set to reproduce the order of magnitude and diurnal
  shape of CPCB climatology, not derived from a gridded inventory. The plume
  emission chain uses published factors (Wooster 2005 dry-matter yield;
  Andreae & Merlet PM2.5 emission coefficient) with dispersion taken as
  `max(Pasquill–Gifford, Heffter 1965)`.
- **Wind does not respond to aerosols.** Meteorology drives dispersion and the
  aerosol feedback alters boundary-layer depth and surface temperature; a
  genuine aerosol → wind response would need a momentum equation this model
  does not have.
- **PBL floor is a model limit.** Boundary-layer depth is floored at 150 m
  (`PBL_MIN_M`), below which a uniformly mixed box stops being meaningful.
- **Single-process state.** Response cache and rate limiter are in-memory, which
  is why the server runs one worker; scaling out requires externalising both.
- **Fire hotspots need a key.** Without `FIRMS_API_KEY` the hotspot list is
  empty and the plume contribution is zero; the dashboard says so rather than
  substituting synthetic fires.
- **Validation coverage differs by component.** The LightGBM and Chronos-2
  station models report holdout metrics in `llm/model/station_models/metrics_summary.json`
  and `llm/model/station_models_chronos2/CHRONOS2_VERDICT.md`, measured on the
  holdout periods stated there. The physics engine itself is validated
  behaviourally (unit suite in `backend/tests/`, scripts in `scripts/verify/`)
  but has no backtest against withheld historical observations.
