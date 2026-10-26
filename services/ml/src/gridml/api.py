"""Internal HTTP API used by the Go gateway (and Cloud Scheduler for ingestion)."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import date
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from gridml import algorithms, artifacts, db, forecasting, jsonutil, training
from gridml.features import FEATURE_GROUPS
from gridml.ingest import runner
from gridml.scenario import Scenario
from gridml.training import Split, TrainRequest
from gridml.warehouse import zones

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)

# One job at a time keeps memory bounded on a small (free-tier) instance.
_train_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="train")
_ingest_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ingest")


@asynccontextmanager
async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    # Runs interrupted by a restart will never finish; mark them failed.
    try:
        db.execute(
            "update grid.training_runs set status = 'failed', error = 'interrupted by restart', "
            "finished_at = now() where status in ('queued', 'running')"
        )
        db.execute(
            "update grid.ingestion_runs set status = 'failed', message = 'interrupted by restart',"
            " finished_at = now() where status = 'running'"
        )
    except Exception:
        log.warning("database not reachable at startup", exc_info=True)
    yield


app = FastAPI(title="gridml", version="0.1.0", lifespan=lifespan)


def ok(payload: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(jsonutil.clean(payload), status_code=status)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/catalog")
def catalog() -> JSONResponse:
    return ok(
        {
            "algorithms": algorithms.describe(),
            "feature_groups": [{"key": k, "description": v} for k, v in FEATURE_GROUPS.items()],
            "zones": zones(),
            "default_split": Split().model_dump(mode="json"),
            "ingest_sources": list(runner.SOURCES),
            "scenario_defaults": Scenario().model_dump(),
        }
    )


class IngestRequest(BaseModel):
    sources: list[str] | None = None
    start: date | None = None
    end: date | None = None
    wait: bool = False


@app.post("/ingest")
async def ingest(req: IngestRequest) -> JSONResponse:
    unknown = set(req.sources or []) - set(runner.SOURCES)
    if unknown:
        raise HTTPException(422, f"unknown sources: {sorted(unknown)}")
    if req.wait:
        # Cloud Scheduler waits on the request, which keeps a Cloud Run instance busy.
        results = await run_in_threadpool(runner.run, req.sources, req.start, req.end)
        return ok({"results": results})
    _ingest_pool.submit(runner.run, req.sources, req.start, req.end)
    return ok({"status": "accepted"}, 202)


@app.post("/train")
def train(req: TrainRequest) -> JSONResponse:
    try:
        algo = algorithms.get(req.algorithm)
        algo.resolve(req.params)
        if req.target_zone not in zones():
            raise ValueError(f"unknown zone {req.target_zone!r}")
        training.FeatureConfig(horizon_hours=req.horizon_hours, groups=tuple(req.feature_groups))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    run_id = training.create_run(req)
    _train_pool.submit(training.execute_run, run_id, req)
    return ok({"run_id": run_id, "status": "queued"}, 202)


@app.post("/forecast")
async def forecast(req: forecasting.ForecastRequest) -> JSONResponse:
    try:
        result = await run_in_threadpool(forecasting.run_forecast, req)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return ok(result)


@app.delete("/models/{model_id}")
def delete_model(model_id: str) -> JSONResponse:
    rows = db.execute("delete from grid.models where id = %s returning artifact_uri", (model_id,))
    if not rows:
        raise HTTPException(404, "model not found")
    forecasting.forget_bundle(model_id)
    try:
        artifacts.delete(rows[0]["artifact_uri"])
    except Exception:
        log.warning("could not delete artifact %s", rows[0]["artifact_uri"], exc_info=True)
    return ok({"deleted": model_id})
