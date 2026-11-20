from app.engine import SimulationEngine
import json
from pathlib import Path


def dataset():
    path = Path(__file__).parents[1] / "datasets" / "sample" / "flight_network.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_mumbai_closure_is_reproducible():
    engine = SimulationEngine(dataset())
    first = engine.run("BOM", 90, "08:00", "Thunderstorm")
    second = engine.run("BOM", 90, "08:00", "Thunderstorm")
    assert first["run_id"] == second["run_id"]
    assert first["counts"]["delayed"] >= 1
    assert first["disruption"]["airport"] == "BOM"
    assert first["disruption"]["duration"] == 90


def test_no_closure_when_duration_is_zero_is_invalid():
    try:
        SimulationEngine(dataset()).run("BOM", 0, "08:00", "Thunderstorm")
        assert False
    except ValueError:
        assert True


def test_delhi_closure_updates_schedule_without_mutating_dataset():
    original = json.dumps(dataset(), sort_keys=True)
    engine = SimulationEngine(dataset())
    result = engine.run("DEL", 60, "09:00", "Fog")
    assert result["counts"]["delayed"] >= 1
    assert json.dumps(dataset(), sort_keys=True) == original


def test_inbound_arrival_during_closure_is_delayed():
    result = SimulationEngine(dataset()).run("BOM", 90, "08:00", "Thunderstorm")
    arrivals = [
        flight for flight in result["flights"]
        if flight["destination"] == "BOM"
        and flight["arrival_delay_minutes"] > 0
    ]
    assert arrivals


def test_protected_flight_reduces_delays():
    engine = SimulationEngine(dataset())
    baseline = engine.run("BOM", 90, "08:00", "Thunderstorm")
    protected_id = next(
        flight["flight_id"]
        for flight in baseline["flights"]
        if flight["origin"] == "BOM" and flight["status"] == "Delayed"
    )
    recovered = engine.run(
        "BOM",
        90,
        "08:00",
        "Thunderstorm",
        protected_flight_ids={protected_id},
    )
    assert recovered["counts"]["delayed"] < baseline["counts"]["delayed"]
