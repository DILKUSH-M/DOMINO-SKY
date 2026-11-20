from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from copy import deepcopy
from pathlib import Path
import json
from typing import Any

from .engine import SimulationEngine


DATASET_PATH = Path(__file__).resolve().parents[1] / "datasets" / "sample" / "flight_network.json"
active_dataset: dict[str, Any] | None = None
dataset_mode = "sample"


class SimulationRequest(BaseModel):
    airport: str = Field(min_length=3, max_length=3)
    duration: int = Field(ge=1, le=720)
    start: str = "08:00"
    disruption: str = "Thunderstorm"


class RecoveryRequest(BaseModel):
    action: str
    tail_id: str | None = None
    flight_id: str | None = None


def load_dataset() -> dict[str, Any]:
    if active_dataset is not None:
        return active_dataset
    with DATASET_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


app = FastAPI(title="DOMINO SKY API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
simulations: dict[str, dict[str, Any]] = {}


@app.get("/api/health")
def health():
    return {"status": "ok", "dataset": "sample"}


@app.post("/api/datasets/import")
async def import_dataset(file: UploadFile = File(...)):
    global active_dataset, dataset_mode
    if file.size is not None and file.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Dataset exceeds the 5 MB upload limit")
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=422, detail="Only JSON datasets are supported")
    try:
        data = json.loads((await file.read()).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=422, detail="The uploaded file is not valid JSON") from error

    required = {"meta", "airports", "flights", "connections", "crews", "spare_aircraft"}
    missing = sorted(required - set(data))
    if missing:
        raise HTTPException(status_code=422, detail=f"Missing required sections: {', '.join(missing)}")
    if not data["airports"] or not data["flights"]:
        raise HTTPException(status_code=422, detail="The dataset must contain airports and flights")

    airport_ids = {item.get("id") for item in data["airports"]}
    flight_ids = {item.get("flight_id") for item in data["flights"]}
    errors = []
    for flight in data["flights"]:
        if flight.get("origin") not in airport_ids or flight.get("destination") not in airport_ids:
            errors.append(f"Flight {flight.get('flight_id', 'unknown')} has an unknown airport")
    for connection in data["connections"]:
        if connection.get("from_flight") not in flight_ids or connection.get("to_flight") not in flight_ids:
            errors.append(f"Connection {connection.get('connection_id', 'unknown')} references an unknown flight")
    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors[:20]))

    active_dataset = data
    dataset_mode = "official-upload"
    return {
        "status": "imported",
        "mode": dataset_mode,
        "airports": len(data["airports"]),
        "flights": len(data["flights"]),
        "connections": len(data["connections"]),
    }


@app.get("/api/airports")
def airports():
    dataset = load_dataset()
    return dataset["airports"]


@app.get("/api/flights")
def flights():
    dataset = load_dataset()
    return dataset["flights"]


@app.get("/api/aircraft")
def aircraft():
    dataset = load_dataset()
    return dataset["spare_aircraft"]


@app.get("/api/crew")
def crew():
    dataset = load_dataset()
    return dataset["crews"]


@app.get("/api/datasets/status")
def dataset_status():
    dataset = load_dataset()
    return {
        "mode": dataset_mode,
        "label": "Official uploaded dataset" if dataset_mode == "official-upload" else "Sample dataset",
        "airports": len(dataset["airports"]),
        "flights": len(dataset["flights"]),
        "aircraft": len({item["tail_id"] for item in dataset["flights"]}),
        "connections": len(dataset["connections"]),
    }


@app.get("/api/dashboard")
def dashboard():
    dataset = load_dataset()
    baseline = SimulationEngine(dataset).run("BOM", 90, "08:00", "Thunderstorm")
    return {"baseline": baseline, "dataset": dataset}


@app.post("/api/simulations")
def simulate(request: SimulationRequest):
    try:
        result = SimulationEngine(load_dataset()).run(
            request.airport.upper(), request.duration, request.start, request.disruption
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    simulations[result["run_id"]] = result
    return result


@app.get("/api/simulations/{run_id}")
def get_simulation(run_id: str):
    if run_id not in simulations:
        raise HTTPException(status_code=404, detail="Simulation run not found")
    return simulations[run_id]


@app.post("/api/dispatcher/recommendations")
def recommendations(payload: dict[str, str]):
    run_id = payload.get("run_id")
    if run_id not in simulations:
        raise HTTPException(status_code=404, detail="Simulation run not found")
    result = simulations[run_id]
    recommendations_list = []
    if result["counts"]["delayed"]:
        spare = result["spare_aircraft"][0] if result["spare_aircraft"] else None
        if spare:
            recommendations_list.append({
                "id": "spare-aircraft",
                "priority": "High",
                "title": f"Assign spare aircraft {spare['tail_id']}",
                "explanation": f"{spare['tail_id']} is available from {spare['available_from']} at {spare['base']}.",
                "action": {"action": "spare_assignment", "tail_id": spare["tail_id"]},
                "status": "available",
            })
    missed = result["missed_connections"]
    if missed:
        recommendations_list.append({
            "id": "protect-connections",
            "priority": "High",
            "title": "Protect critical passenger connections",
            "explanation": f"{len(missed)} connections are currently missed, involving {sum(item['passengers'] for item in missed)} passengers.",
            "action": {"action": "protect_connections"},
            "status": "available",
        })
    if not recommendations_list:
        recommendations_list.append({
            "id": "monitor",
            "priority": "Low",
            "title": "Continue monitoring",
            "explanation": "The deterministic simulation found no material downstream disruption.",
            "action": {"action": "none"},
            "status": "available",
        })
    return {
        "mode": "deterministic-fallback",
        "recommendations": recommendations_list,
        "calculated_facts": result["counts"],
    }


@app.post("/api/recoveries/{run_id}/apply")
def apply_recovery(run_id: str, request: RecoveryRequest):
    if run_id not in simulations:
        raise HTTPException(status_code=404, detail="Simulation run not found")
    baseline = simulations[run_id]
    if request.action == "spare_assignment":
        spare = next(
            (item for item in baseline["spare_aircraft"] if item["tail_id"] == request.tail_id),
            None,
        )
        if spare is None:
            raise HTTPException(status_code=422, detail="The requested spare aircraft is not available")
        protected_flight = next(
            (
                flight["flight_id"]
                for flight in baseline["flights"]
                if flight["status"] == "Delayed"
                and flight["origin"] == baseline["disruption"]["airport"]
            ),
            baseline["flights"][0]["flight_id"] if baseline["flights"] else None,
        )
        if protected_flight is None:
            raise HTTPException(status_code=422, detail="No affected flight is available for spare assignment")
        disruption = baseline["disruption"]
        recovered = SimulationEngine(load_dataset()).run(
            disruption["airport"],
            disruption["duration"],
            disruption["start"],
            disruption["type"],
            protected_flight_ids={protected_flight},
        )
        recovered["applied_actions"] = [f"Assigned spare aircraft {spare['tail_id']} to {protected_flight}"]
        if (
            recovered["counts"]["total_network_delay"] >= baseline["counts"]["total_network_delay"]
            or recovered["counts"]["delayed"] >= baseline["counts"]["delayed"]
        ):
            return {
                "status": "no_improvement",
                "reason": "The recalculated plan does not improve the network and was not applied.",
                "baseline": baseline,
                "recovered": baseline,
            }
        return {"status": "applied", "baseline": baseline, "recovered": recovered}
    if request.action == "protect_connections":
        disruption = baseline["disruption"]
        protected_connection_ids = {
            connection["connection_id"] for connection in baseline["missed_connections"]
        }
        recovered = SimulationEngine(load_dataset()).run(
            disruption["airport"],
            disruption["duration"],
            disruption["start"],
            disruption["type"],
            protected_connection_ids=protected_connection_ids,
        )
        recovered["applied_actions"] = [
            f"Protected {len(protected_connection_ids)} passenger connections"
        ]
        if (
            recovered["counts"]["total_network_delay"] >= baseline["counts"]["total_network_delay"]
            or recovered["counts"]["stranded_passengers"] >= baseline["counts"]["stranded_passengers"]
        ):
            return {
                "status": "no_improvement",
                "reason": "Passenger protection was not approved because the recalculation did not reduce stranded passengers.",
                "baseline": baseline,
                "recovered": baseline,
            }
        return {"status": "applied", "baseline": baseline, "recovered": recovered}
    if request.action == "none":
        return {"status": "no_action", "baseline": baseline, "recovered": baseline}
    raise HTTPException(status_code=422, detail="Unsupported recovery action")
