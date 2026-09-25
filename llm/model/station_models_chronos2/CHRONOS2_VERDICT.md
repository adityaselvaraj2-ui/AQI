# Chronos-2 candidate verdict (Stage 6)

Every number below is read from a measured artifact (head_to_head.json,
eval_<poll>.json, metrics_summary.json). Nothing here is hand-computed.

## Governing context (Stage 0, verified from the teammate repo)

- Their headline Chronos-2 R2 ~0.96 is scored against CAMS reanalysis cells;
  26/50 of their 'stations' share one evaluation cell. Not a real-sensor number.
- Their own real-sensor model (HistGradientBoosting, 3 stations) scored R2 0.2555,
  explicitly marked "rmse_target_met": false.
- Their physics hindcast scored NSE -0.24 against CAMS (their own doc states it).

## Stage 2 feasibility (measured on this machine)

| Check | Result |
|---|---|
| License | amazon/chronos-2 verified Apache-2.0 via HF API |
| Model size | 456 MB on disk (119.5M params) |
| GPU | RTX 3050 6GB, torch 2.14.0+cu126, LoRA fit on GPU |
| Fine-tune speed | 0.27 s/step at batch 16 (600 steps ~ 3 min) |
| Per-station x5-pollutant fine-tuning | ~15 h GPU — feasible but gated on Stage 4 evidence |

## Stage 4 — win/loss by (pollutant, band)

Count of (station) wins by system on the SAME aligned (t0, h) pairs.

| Pollutant | Band | lgb_production | lgb_model | chronos | chronos_blended | hybrid | persistence | climatology |
|---|---|---|---|---|---|---|---|---|
| PM2.5 | 1-6h | 6 | 0 | 10 | 3 | 0 | 0 | 0 |
| PM2.5 | 24h | 19 | 0 | 0 | 0 | 0 | 0 | 0 |
| PM2.5 | 48-72h | 19 | 0 | 0 | 0 | 0 | 0 | 0 |
| PM2.5 | 96h | 19 | 0 | 0 | 0 | 0 | 0 | 0 |
| PM2.5 | 120h | 19 | 0 | 0 | 0 | 0 | 0 | 0 |
| PM2.5 | 144-168h | 19 | 0 | 0 | 0 | 0 | 0 | 0 |

## Stage 4 — per-(station, pollutant) overall (RMSE, aligned holdout pairs)

| Station | Poll | n | LightGBM prod | Chronos | Chronos+blend | Hybrid | Persistence | Winner | R6 |
|---|---|---|---|---|---|---|---|---|---|
| ashok_vihar | PM2.5 | 25730 | 21.6 | 26.7 | 25.8 | 21.5 | 31.0 | lgb_production | lightgbm |
| bawana | PM2.5 | 18840 | 34.7 | 47.1 | 44.6 | 34.6 | 50.4 | lgb_production | lightgbm |
| burari_crossing | PM2.5 | 20904 | 21.5 | 26.6 | 25.8 | 21.5 | 32.4 | lgb_production | lightgbm |
| crri_mathura_road | PM2.5 | 22291 | 17.3 | 26.7 | 24.9 | 17.3 | 25.2 | lgb_production | lightgbm |
| dtu | PM2.5 | 28157 | 31.2 | 38.3 | 37.0 | 31.2 | 47.3 | lgb_production | lightgbm |
| dwarka_sector_8 | PM2.5 | 25460 | 20.9 | 25.0 | 24.4 | 20.9 | 30.5 | lgb_production | lightgbm |
| ito | PM2.5 | 25027 | 20.1 | 22.2 | 21.7 | 20.0 | 26.3 | lgb_production | lightgbm |
| jahangirpuri | PM2.5 | 19175 | 36.1 | 44.9 | 42.8 | 36.1 | 49.9 | lgb_production | lightgbm |
| jawaharlal_nehru_stadium | PM2.5 | 25026 | 17.8 | 20.8 | 20.3 | 17.7 | 24.5 | lgb_production | lightgbm |
| lodhi_road | PM2.5 | 17533 | 17.8 | 22.8 | 21.8 | 17.8 | 25.4 | lgb_production | lightgbm |
| major_dhyan_chand_national_stadium | PM2.5 | 25444 | 18.4 | 21.6 | 21.0 | 18.4 | 24.8 | lgb_production | lightgbm |
| mandir_marg | PM2.5 | 17106 | 22.9 | 28.6 | 27.3 | 22.9 | 30.0 | lgb_production | lightgbm |
| najafgarh | PM2.5 | 22549 | 19.4 | 24.2 | 23.3 | 19.4 | 28.1 | lgb_production | lightgbm |
| narela | PM2.5 | 25584 | 24.1 | 32.2 | 31.0 | 24.0 | 38.1 | lgb_production | lightgbm |
| nehru_nagar | PM2.5 | 25264 | 24.3 | 34.5 | 31.9 | 24.2 | 34.1 | lgb_production | lightgbm |
| noida_sector_1 | PM2.5 | 13961 | 25.1 | 28.3 | 27.9 | 25.0 | 36.7 | lgb_production | lightgbm |
| noida_sector_116 | PM2.5 | 25029 | 23.9 | 28.4 | 27.5 | 23.9 | 34.3 | lgb_production | lightgbm |
| noida_sector_125 | PM2.5 | 20003 | 26.4 | 30.8 | 30.4 | 26.4 | 41.9 | lgb_production | lightgbm |
| noida_sector_62 | PM2.5 | 20747 | 20.9 | 25.8 | 25.0 | 20.9 | 29.3 | lgb_production | lightgbm |

**R6 promotion verdicts: {'lightgbm': 19}** over 19 evaluated pairs.

## Hybrid significance (chronos at 1-6h where it wins + LightGBM elsewhere)

Paired 24h-block t-test on squared errors, hybrid vs LightGBM production. 
'BETTER(sig)' = hybrid's mean squared error lower with |t|>2. 
A win with 'ns' is within sampling noise.

| Station | Poll | hybrid RMSE | prod RMSE | delta | t | verdict |
|---|---|---|---|---|---|---|
| ashok_vihar | PM2.5 | 21.5 | 21.6 | +0.47% | -2.4799828195452562 | BETTER(sig) |
| bawana | PM2.5 | 34.6 | 34.7 | +0.32% | -2.1774321720642886 | BETTER(sig) |
| burari_crossing | PM2.5 | 21.5 | 21.5 | +0.00% | — | no win |
| crri_mathura_road | PM2.5 | 17.3 | 17.3 | +0.02% | -0.0714846052110158 | ns |
| dtu | PM2.5 | 31.2 | 31.2 | +0.00% | — | no win |
| dwarka_sector_8 | PM2.5 | 20.9 | 20.9 | +0.00% | — | no win |
| ito | PM2.5 | 20.0 | 20.1 | +0.79% | -2.1802645937967413 | BETTER(sig) |
| jahangirpuri | PM2.5 | 36.1 | 36.1 | +0.21% | -0.6372238805833667 | ns |
| jawaharlal_nehru_stadium | PM2.5 | 17.7 | 17.8 | +0.53% | -3.744710300027281 | BETTER(sig) |
| lodhi_road | PM2.5 | 17.8 | 17.8 | +0.00% | — | no win |
| major_dhyan_chand_national_stadium | PM2.5 | 18.4 | 18.4 | +0.00% | — | no win |
| mandir_marg | PM2.5 | 22.9 | 22.9 | +0.00% | — | no win |
| najafgarh | PM2.5 | 19.4 | 19.4 | +0.00% | — | no win |
| narela | PM2.5 | 24.0 | 24.1 | +0.34% | -2.0743984568354668 | BETTER(sig) |
| nehru_nagar | PM2.5 | 24.2 | 24.3 | +0.28% | -2.324447922491166 | BETTER(sig) |
| noida_sector_1 | PM2.5 | 25.0 | 25.1 | +0.42% | -2.2258252435745245 | BETTER(sig) |
| noida_sector_116 | PM2.5 | 23.9 | 23.9 | +0.25% | -1.57829775985187 | ns |
| noida_sector_125 | PM2.5 | 26.4 | 26.4 | +0.00% | — | no win |
| noida_sector_62 | PM2.5 | 20.9 | 20.9 | +0.19% | -0.7666864653620149 | ns |

## Chronos-2 raw holdout scores, every evaluated station (real sensors)


### PM2.5 — 22 stations, 22 with negative R2

| Station | pooled R2 | RMSE | n |
|---|---|---|---|
| crri_mathura_road | -1.628403658495038 | 33.24590966590772 | 31462 |
| nehru_nagar | -0.7460654793211354 | 33.49846060200962 | 33844 |
| anand_vihar | -0.6632748535192392 | 47.356424304247625 | 29384 |
| bawana | -0.6255952688701489 | 46.640780717193316 | 30928 |
| lodhi_road | -0.6088949234727068 | 23.52458044821712 | 30740 |
| mandir_marg | -0.572956713604597 | 27.586420376360294 | 30080 |
| noida_sector_62 | -0.5430029514933477 | 27.216323432954212 | 31518 |
| ashok_vihar | -0.4634704804711878 | 27.21407363956045 | 33566 |
| jahangirpuri | -0.4446712334083116 | 44.300818961091736 | 30367 |
| ito | -0.40844930624750453 | 23.378650627437413 | 32570 |
| burari_crossing | -0.36866805322008767 | 26.318351229552924 | 31688 |
| major_dhyan_chand_national_stadium | -0.34532030820001425 | 21.811932851945976 | 34038 |
| najafgarh | -0.3311212952695639 | 24.101842200554007 | 33103 |
| jawaharlal_nehru_stadium | -0.3060361471209092 | 20.968462269434852 | 34180 |
| noida_sector_116 | -0.2967001665381024 | 28.643430961827523 | 33311 |
| alipur | -0.2910338133149566 | 29.679602892027056 | 27138 |
| dtu | -0.28664340840570435 | 38.76073652183043 | 34997 |
| okhla_phase_2 | -0.27377431541983044 | 21.57960566746456 | 34495 |
| noida_sector_125 | -0.16861639955254848 | 31.30786325583871 | 32495 |
| noida_sector_1 | -0.14369905727754095 | 27.241978582723416 | 27835 |
| narela | -0.13139208026023286 | 31.866312117687684 | 33583 |
| dwarka_sector_8 | -0.0992835067029827 | 24.32712324606096 | 34342 |

## Stage 3b — coverage of the Chronos candidate vs the production fleet

- Production LightGBM pairs trained: 45 stations
- Chronos pairs evaluated so far: 22
- Stations without a Chronos eval (insufficient contiguous history for
  the 336h-context protocol — honest partial coverage, NOT zone-level substitution):
  17, 50, 301, 5404, 5586, 5610, 5650, 5665, 6359, 6924, 6934, 6960, 6978, 7005, 8475, 8915, 10484, 10820, 10825, 10831, 10900, 10908, 10919

## R1-R6 compliance

- **R1** every decision metric scored against real station observations: YES
  (head_to_head y-values come from the stations' own merged frames; CAMS numbers
  appear only as the labeled `cams_cell` diagnostic in the transparency view).
- **R2** true per-station granularity: YES — one evaluation per (station, pollutant)
  on that station's own holdout origins; nothing pooled to a zone.
- **R3** contract_check.py unmodified: YES — run as-is on any mixed-fleet summary;
  thresholds untouched.
- **R4** same feature/target pipeline: YES — Chronos inputs are built from
  features.py's frame_for_horizon (asserted equal per station, both CAMS regimes);
  context = the station's own observation history; LightGBM side of the
  comparison uses train_all.assemble_samples directly.
- **R5** 5 pollutants only, CO excluded: YES.
- **R6** per-(station, pollutant) promotion gate: applied exactly as specified;
  current evidence promotes 0 pairs (LightGBM keeps serving every evaluated slice).

