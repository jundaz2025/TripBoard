"""Travel legs use explicit local clocks at each endpoint and compare in UTC."""
from datetime import timedelta
from fastapi import HTTPException
from .planning import instant


def interval(leg):
    """Resolve departure and arrival using each endpoint's own local date and time zone."""
    departure = instant(leg['departure_date'], leg['departure_time'], leg['departure_timezone'])
    arrival = instant(leg['arrival_date'], leg['arrival_time'], leg['arrival_timezone'])
    return departure, arrival


def validate(leg):
    """Compare absolute instants rather than clock strings, including overnight and cross-zone journeys."""
    departure, arrival = interval(leg)
    if arrival <= departure:
        raise HTTPException(422, 'Arrival must be after departure when both time zones are considered.')
    if arrival - departure > timedelta(days=30):
        raise HTTPException(422, 'Split journeys longer than 30 days into separate travel legs.')


def present(leg):
    """Add UTC instants and elapsed minutes for conflict detection and locale-independent client sorting."""
    departure, arrival = interval(leg)
    return {**leg, 'departure_at': departure.isoformat(), 'arrival_at': arrival.isoformat(),
            'duration_minutes': int((arrival - departure).total_seconds() / 60)}
