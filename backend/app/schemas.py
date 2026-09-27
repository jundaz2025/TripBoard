"""Validate request boundaries before business logic. These Pydantic models are not SQLAlchemy database entities."""

from datetime import date, time
import re
from typing import Literal
from zoneinfo import ZoneInfo
from pydantic import BaseModel, Field, ConfigDict, model_validator, field_validator


class Schema(BaseModel):
    """Reject unknown request fields and trim ordinary text at the API boundary."""
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class Register(Schema):
    """Keep password bytes unchanged while normalizing identity fields and enforcing confirmation."""
    model_config = ConfigDict(str_strip_whitespace=False, extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(max_length=128)

    @field_validator("name", "email", mode="before")
    @classmethod
    def trim_identity(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("password")
    @classmethod
    def strong_password(cls, v):
        if not all(
            re.search(p, v) for p in (r"[A-Z]", r"[a-z]", r"[0-9]", r"[^A-Za-z0-9\s]")
        ):
            raise ValueError(
                "Use uppercase and lowercase letters, a number, and a symbol."
            )
        return v

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        if "@" not in v:
            raise ValueError("Enter a valid email.")
        return v.lower()


class Credentials(Schema):
    """Normalize email for lookup without trimming or changing the supplied password."""
    model_config = ConfigDict(str_strip_whitespace=False, extra="forbid")
    email: str
    password: str = Field(max_length=200)

    @field_validator("email")
    @classmethod
    def trim_email(cls, v):
        return v.strip().lower()


class DeleteAccount(Schema):
    """Require explicit confirmation, the current password and all reviewed trip versions."""
    model_config = ConfigDict(str_strip_whitespace=False, extra="forbid")
    password: str = Field(max_length=200)
    confirmation: Literal["DELETE"]
    trip_versions: dict[str, int]


class TripInput(Schema):
    """Bound trip length and validate the stored IANA zone independently of display labels."""
    title: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=200)
    destination_id: int | None = Field(default=None, gt=0)
    start_date: str
    end_date: str
    timezone: str = "America/New_York"

    @model_validator(mode="after")
    def valid(self):
        a, b = date.fromisoformat(self.start_date), date.fromisoformat(self.end_date)
        if b < a or (b - a).days > 60:
            raise ValueError("Trips must last 1–61 days.")
        try:
            ZoneInfo(self.timezone)
        except Exception:
            raise ValueError("Use an IANA time zone such as America/New_York.")
        return self


class PlaceInput(Schema):
    """Validate coordinates and optional planning constraints for a reusable saved place."""
    title: str = Field(min_length=1, max_length=160)
    location: str = Field(default="", max_length=300)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    category: Literal["sight", "food", "hotel", "other"] = "sight"
    duration: int = Field(default=60, ge=5, le=600)
    opens: str = "09:00"
    closes: str = "20:00"
    notes: str = Field(default="", max_length=3000)
    hours_confirmed: bool = True

    @model_validator(mode="after")
    def hours(self):
        a, b = time.fromisoformat(self.opens), time.fromisoformat(self.closes)
        if len(self.opens) != 5 or len(self.closes) != 5 or a >= b:
            raise ValueError("Use same-day HH:MM opening hours.")
        return self


class ActivityInput(Schema):
    """Validate one daily activity; cross-record rules are applied in planning.py."""
    title: str = Field(min_length=1, max_length=160)
    location: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=3000)
    day: str
    start: str = "09:00"
    duration: int = Field(default=60, ge=5, le=1440)
    locked: bool = False
    place_id: str | None = None
    reminder_minutes: int | None = Field(default=30, ge=0, le=10080)

    @model_validator(mode="after")
    def valid(self):
        date.fromisoformat(self.day)
        t = time.fromisoformat(self.start)
        if len(self.start) != 5 or t.tzinfo:
            raise ValueError("Use HH:MM.")
        return self


class ActivityWrite(ActivityInput):
    # Optional address selection is saved with the activity in one transaction.
    """Allow a newly selected place to be created atomically with its activity."""
    new_place: PlaceInput | None = None


class HotelInput(Schema):
    """Store an existing reservation and source provenance; missing policy times remain unset."""
    name: str = Field(min_length=1, max_length=160)
    address: str = Field(default="", max_length=300)
    check_in: str
    check_out: str
    check_in_time: str | None = None
    check_out_time: str | None = None
    hotel_website: str = Field(default="", max_length=2000)
    policy_source_url: str = Field(default="", max_length=2000)
    policy_checked_at: str = Field(default="", max_length=80)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    link: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=3000)

    @field_validator("check_in_time", "check_out_time")
    @classmethod
    def clock_time(cls, value):
        if value is not None:
            parsed = time.fromisoformat(value)
            if len(value) != 5 or parsed.tzinfo:
                raise ValueError("Use HH:MM hotel times.")
        return value

    @field_validator("hotel_website", "policy_source_url")
    @classmethod
    def website(cls, value):
        if value and not value.startswith(("http://", "https://")):
            raise ValueError("Use an HTTP or HTTPS hotel website.")
        return value

    @model_validator(mode="after")
    def valid(self):
        if date.fromisoformat(self.check_out) <= date.fromisoformat(self.check_in):
            raise ValueError("Check-out must follow check-in.")
        if self.link and not self.link.startswith(("http://", "https://")):
            raise ValueError("Use an HTTP or HTTPS link.")
        return self


class TransportInput(Schema):
    """Keep separate local dates, clocks and zones for both journey endpoints."""
    title: str = Field(min_length=1, max_length=160)
    direction: Literal["outbound", "return"] = "outbound"
    mode: Literal["flight", "driving", "train", "bus", "ferry", "other"] = "flight"
    origin: str = Field(min_length=1, max_length=200)
    destination: str = Field(min_length=1, max_length=200)
    departure_city_id: int | None = Field(default=None, gt=0)
    arrival_city_id: int | None = Field(default=None, gt=0)
    departure_point: str = Field(default="", max_length=300)
    arrival_point: str = Field(default="", max_length=300)
    departure_date: str
    departure_time: str
    departure_timezone: str
    arrival_date: str
    arrival_time: str
    arrival_timezone: str
    carrier: str = Field(default="", max_length=160)
    number: str = Field(default="", max_length=80)
    reference: str = Field(default="", max_length=160)
    link: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=3000)

    @model_validator(mode="after")
    def valid_schedule(self):
        for day in (self.departure_date, self.arrival_date):
            if date.fromisoformat(day).isoformat() != day:
                raise ValueError("Use YYYY-MM-DD dates.")
        for clock in (self.departure_time, self.arrival_time):
            parsed = time.fromisoformat(clock)
            if len(clock) != 5 or parsed.tzinfo:
                raise ValueError("Use HH:MM local times.")
        for zone in (self.departure_timezone, self.arrival_timezone):
            try:
                ZoneInfo(zone)
            except Exception:
                raise ValueError("Choose a valid IANA time zone for each endpoint.")
        if self.link and not self.link.startswith(("https://", "http://")):
            raise ValueError("Reservation links must use https:// or http://.")
        return self


class HotelPolicyInput(Schema):
    """Require enough hotel identity information for website lookup or automatic discovery."""
    name: str = Field(min_length=1, max_length=160)
    website: str = Field(default="", max_length=2000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def location_or_website(self):
        if not self.website and (self.lat is None or self.lon is None):
            raise ValueError("Select a hotel from the search results first.")
        return self


class InviteInput(Schema):
    """Only editor/viewer roles are assignable; ownership cannot be granted by invitation."""
    role: Literal["editor", "viewer"] = "editor"


class JoinInput(Schema):
    """Accept the opaque invitation token, whose digest and expiry are checked server-side."""
    token: str


class AIInput(Schema):
    """Constrain supported AI workflows and cap untrusted user prompt length."""
    mode: Literal["draft", "edit", "next"]
    prompt: str = Field(min_length=1, max_length=3000)
    day: str
    start: str = "09:00"
    end: str = "20:00"
    source: Literal["estimate", "live"] = "estimate"


class RouteInput(Schema):
    """Describe the selected day/window and optional hotel depot for a route proposal."""
    day: str
    start: str = "09:00"
    end: str = "20:00"
    source: Literal["estimate", "live"] = "estimate"
    hotel_id: str | None = None
