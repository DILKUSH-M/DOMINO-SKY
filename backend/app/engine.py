from copy import deepcopy
from typing import Any
import hashlib
import json


def time_to_minutes(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":"))
    return hour * 60 + minute


def minutes_to_time(value: int) -> str:
    value %= 24 * 60
    return f"{value // 60:02d}:{value % 60:02d}"


def add_minutes(value: str, amount: int) -> str:
    return minutes_to_time(time_to_minutes(value) + amount)


class SimulationEngine:
    def __init__(self, dataset: dict[str, Any]):
        self.dataset = deepcopy(dataset)
        self.meta = dataset.get("meta", {})

    def run(
        self,
        airport: str,
        duration: int,
        start: str,
        disruption: str,
        protected_flight_ids: set[str] | None = None,
        protected_connection_ids: set[str] | None = None,
    ) -> dict[str, Any]:
        airports = {item["id"]: item for item in self.dataset["airports"]}
        if airport not in airports:
            raise ValueError(f"Unknown airport: {airport}")
        if duration < 1 or duration > 720:
            raise ValueError("Closure duration must be between 1 and 720 minutes")

        closure_start = time_to_minutes(start)
        closure_end = closure_start + duration
        protected_flight_ids = protected_flight_ids or set()
        protected_connection_ids = protected_connection_ids or set()
        flights = deepcopy(self.dataset["flights"])
        aircraft_flights: dict[str, list[dict[str, Any]]] = {}
        for flight in flights:
            aircraft_flights.setdefault(flight["tail_id"], []).append(flight)

        baseline_by_id = {flight["flight_id"]: deepcopy(flight) for flight in flights}
        simulated_by_id: dict[str, dict[str, Any]] = {}
        chains: dict[str, list[str]] = {}

        for tail_id, rotation in aircraft_flights.items():
            previous_arrival: int | None = None
            previous_flight: str | None = None
            previous_reason: str | None = None
            for flight in sorted(rotation, key=lambda item: item["leg_order"]):
                scheduled_dep = time_to_minutes(flight["dep"])
                scheduled_arr = time_to_minutes(flight["arr"])
                turnaround = flight.get("turnaround_before_min") or self.meta.get("min_turnaround_minutes", 30)
                actual_dep = scheduled_dep
                chain: list[str] = []
                reasons: list[str] = []

                if previous_arrival is not None:
                    ready_dep = previous_arrival + turnaround
                    if ready_dep > actual_dep:
                        actual_dep = ready_dep
                        chain.append(previous_flight or "")
                        reasons.append("Insufficient turnaround after late inbound aircraft")
                if (
                    flight["origin"] == airport
                    and flight["flight_id"] not in protected_flight_ids
                    and closure_start <= scheduled_dep < closure_end
                ):
                    reopen_dep = closure_end
                    if reopen_dep > actual_dep:
                        actual_dep = reopen_dep
                        reasons.append(f"{airport} airport closure")
                        chain.append("airport_closure")
                if (
                    previous_arrival is not None
                    and flight["origin"] == airport
                    and flight["flight_id"] not in protected_flight_ids
                ):
                    reopen_dep = max(closure_end, previous_arrival + turnaround)
                    if reopen_dep > actual_dep:
                        actual_dep = reopen_dep
                        if "airport_closure" not in chain:
                            chain.append("airport_closure")
                        reasons.append(f"{airport} airport closure")

                block = flight["block_minutes"]
                actual_arr = actual_dep + block
                if (
                    flight["destination"] == airport
                    and flight["flight_id"] not in protected_flight_ids
                    and closure_start <= actual_arr < closure_end
                ):
                    actual_arr = closure_end
                    reasons.append(f"{airport} airport closure")
                    chain.append("airport_closure")
                delay_dep = actual_dep - scheduled_dep
                delay_arr = actual_arr - scheduled_arr
                status = "Delayed" if delay_dep > 0 or delay_arr > 0 else "Unaffected"
                result = deepcopy(flight)
                result.update({
                    "scheduled_dep": flight["dep"],
                    "scheduled_arr": flight["arr"],
                    "actual_dep": minutes_to_time(actual_dep),
                    "actual_arr": minutes_to_time(actual_arr),
                    "delay_minutes": max(0, delay_dep),
                    "arrival_delay_minutes": max(0, delay_arr),
                    "status": status,
                    "delay_reasons": list(dict.fromkeys(reasons)),
                    "propagation_chain": [item for item in dict.fromkeys(chain) if item],
                })
                simulated_by_id[flight["flight_id"]] = result
                if chain:
                    chains[flight["flight_id"]] = chain
                previous_arrival = actual_arr
                previous_flight = flight["flight_id"]
                previous_reason = result["status"]

        missed_connections: list[dict[str, Any]] = []
        at_risk_connections: list[dict[str, Any]] = []
        for connection in self.dataset.get("connections", []):
            from_flight = simulated_by_id.get(connection["from_flight"])
            to_flight = simulated_by_id.get(connection["to_flight"])
            if not from_flight or not to_flight:
                continue
            available = time_to_minutes(to_flight["actual_dep"]) - time_to_minutes(from_flight["actual_arr"])
            item = {
                **connection,
                "available_connect_minutes": available,
                "status": "Protected" if from_flight["status"] == "Unaffected" and to_flight["status"] == "Unaffected" else "Missed",
            }
            if connection["connection_id"] in protected_connection_ids:
                item["status"] = "Protected"
                at_risk_connections.append(item)
            elif available < connection["min_connect_minutes"]:
                item["status"] = "Missed"
                missed_connections.append(item)
            elif from_flight["status"] == "Delayed" or to_flight["status"] == "Delayed":
                at_risk_connections.append(item)

        affected_passenger_ids: set[str] = set()
        stranded_passengers = 0
        for flight in simulated_by_id.values():
            if flight["status"] == "Delayed":
                affected_passenger_ids.update(f"{flight['flight_id']}:{index}" for index in range(flight["pax"]))
        for connection in missed_connections:
            stranded_passengers += connection["passengers"]

        crew_violations: list[dict[str, Any]] = []
        for crew in self.dataset.get("crews", []):
            assigned = [simulated_by_id[item] for item in crew["flight_ids"] if item in simulated_by_id]
            if not assigned:
                continue
            duty_end = time_to_minutes(max((item["actual_arr"] for item in assigned), key=time_to_minutes))
            duty_start = time_to_minutes(crew["duty_start"])
            duty_duration = duty_end - duty_start
            if duty_duration < 0:
                duty_duration += 24 * 60
            if duty_duration > crew["max_duty_mins"]:
                crew_violations.append({
                    "crew_id": crew["crew_id"],
                    "tail_id": crew["tail_id"],
                    "duty_duration": duty_duration,
                    "max_duty_mins": crew["max_duty_mins"],
                })

        flight_results = sorted(simulated_by_id.values(), key=lambda item: item["dep"])
        delayed = [item for item in flight_results if item["status"] == "Delayed"]
        on_time = [item for item in flight_results if item["status"] == "Unaffected"]
        airport_impact = []
        for airport_id, airport_data in airports.items():
            flights_at_airport = [
                item for item in flight_results
                if item["origin"] == airport_id or item["destination"] == airport_id
            ]
            impacted = [item for item in flights_at_airport if item["status"] == "Delayed"]
            airport_impact.append({
                "airport": airport_id,
                "name": airport_data["name"],
                "delayed_flights": len(impacted),
                "total_delay_minutes": sum(item["arrival_delay_minutes"] for item in impacted),
                "severity": "Critical" if len(impacted) >= 8 else "Warning" if impacted else "Normal",
            })

        payload = {
            "run_id": hashlib.sha1(
                json.dumps({"airport": airport, "duration": duration, "start": start, "disruption": disruption}, sort_keys=True).encode()
            ).hexdigest()[:12],
            "disruption": {
                "airport": airport,
                "airport_name": airports[airport]["name"],
                "duration": duration,
                "start": start,
                "end": minutes_to_time(closure_end),
                "type": disruption,
            },
            "baseline_schedule": baseline_by_id,
            "disrupted_schedule": simulated_by_id,
            "flights": flight_results,
            "propagation_chains": chains,
            "counts": {
                "total_airports": len(airports),
                "total_flights": len(flight_results),
                "available_aircraft": len({item["tail_id"] for item in flights if item["tail_id"]}),
                "delayed": len(delayed),
                "cancelled": 0,
                "on_time": len(on_time),
                "affected_passengers": len(affected_passenger_ids),
                "stranded_passengers": stranded_passengers,
                "crew_violations": len(crew_violations),
                "total_network_delay": sum(item["arrival_delay_minutes"] for item in flight_results),
            },
            "missed_connections": missed_connections,
            "at_risk_connections": at_risk_connections,
            "crew_violations": crew_violations,
            "airport_impact": airport_impact,
            "spare_aircraft": deepcopy(self.dataset.get("spare_aircraft", [])),
        }
        return payload
