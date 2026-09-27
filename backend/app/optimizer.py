"""Create a time-window-constrained route proposal; applying it is a separate version-checked operation."""

from .planning import opening_window
import asyncio
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from fastapi import HTTPException
from .planning import minutes, clock
from .providers import matrix


async def optimize(
    s, day, start="09:00", end="20:00", source="estimate", hotel_id=None
):
    """Solve one day with travel times, visit durations and fixed appointments; return a reviewable proposal."""
    activities = [a for a in s["activities"] if a["day"] == day]
    if not 2 <= len(activities) <= 10:
        raise HTTPException(422, "Select a day with 2–10 activities.")
    if minutes(start) >= minutes(end):
        raise HTTPException(422, "End time must follow start time.")
    places = {p["id"]: p for p in s["places"]}
    if any(a["place_id"] not in places for a in activities):
        raise HTTPException(422, "Every activity needs a saved place with coordinates.")
    points = [places[a["place_id"]] for a in activities]
    hotel = next((h for h in s["hotels"] if h["id"] == hotel_id), None)
    if hotel_id and not hotel:
        raise HTTPException(422, "Hotel not found.")
    if hotel and not hotel["check_in"] <= day <= hotel["check_out"]:
        raise HTTPException(422, "Hotel is not booked for this day.")
    if hotel:
        points = [hotel] + points
    values, label = await matrix(points, source)
    # A virtual depot with zero travel cost lets an unconstrained day start/end at any activity.
    if not hotel:
        values = [[0] * (len(values) + 1)] + [[0] + row for row in values]
    manager = pywrapcp.RoutingIndexManager(len(activities) + 1, 1, 0)
    routing = pywrapcp.RoutingModel(manager)
    # Travel cost drives optimization; elapsed time also includes the visit at the departing stop.
    duration = [0] + [a["duration"] for a in activities]
    cost = routing.RegisterTransitCallback(
        lambda i, j: values[manager.IndexToNode(i)][manager.IndexToNode(j)]
    )
    transit = routing.RegisterTransitCallback(
        lambda i, j: values[manager.IndexToNode(i)][manager.IndexToNode(j)]
        + duration[manager.IndexToNode(i)]
    )
    routing.SetArcCostEvaluatorOfAllVehicles(cost)
    routing.AddDimension(transit, 1440, 1440, False, "Time")
    dimension = routing.GetDimensionOrDie("Time")
    for i, a in enumerate(activities, 1):
        p = places[a["place_id"]]
        low = max(minutes(start), opening_window(p)[0])
        high = min(minutes(end) - a["duration"], opening_window(p)[1] - a["duration"])
        # A fixed reservation has a zero-width arrival window and cannot be rescheduled.
        if a["locked"]:
            low = high = minutes(a["start"])
        if (
            low > high
            or low < minutes(start)
            or high + a["duration"] > minutes(end)
            or low < opening_window(p)[0]
            or high + a["duration"] > opening_window(p)[1]
        ):
            raise HTTPException(
                422, "A reservation cannot fit in this planning window."
            )
        dimension.CumulVar(manager.NodeToIndex(i)).SetRange(low, high)
    dimension.CumulVar(routing.Start(0)).SetRange(minutes(start), minutes(end))
    dimension.CumulVar(routing.End(0)).SetRange(minutes(start), minutes(end))
    routing.AddVariableMinimizedByFinalizer(dimension.CumulVar(routing.Start(0)))
    routing.AddVariableMinimizedByFinalizer(dimension.CumulVar(routing.End(0)))
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    # Bound solver latency and release the event loop; a feasible result is not a proof of global optimality.
    params.time_limit.seconds = 2
    result = await asyncio.to_thread(routing.SolveWithParameters, params)
    if not result:
        raise HTTPException(
            422,
            "No feasible route found within the time limit. Adjust the window or reservations.",
        )
    index = routing.Start(0)
    operations = []
    order = []
    total = 0
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node:
            a = activities[node - 1]
            arrival = clock(result.Value(dimension.CumulVar(index)))
            order.append({"id": a["id"], "title": a["title"], "start": arrival})
            if not a["locked"]:
                operations.append({"kind": "update", "id": a["id"], "start": arrival})
        nxt = result.Value(routing.NextVar(index))
        total += values[node][manager.IndexToNode(nxt)]
        index = nxt
    old = (
        [0]
        + [
            i + 1
            for i, a in sorted(enumerate(activities), key=lambda pair: pair[1]["start"])
        ]
        + [0]
    )
    return {
        "operations": operations,
        "explanation": f"Route suggestion using {label}. Global optimality is not guaranteed.",
        "metrics": {
            "before_minutes": sum(values[a][b] for a, b in zip(old, old[1:])),
            "after_minutes": total,
            "source": label,
            "order": order,
            "hotel": hotel["name"] if hotel else None,
        },
    }
