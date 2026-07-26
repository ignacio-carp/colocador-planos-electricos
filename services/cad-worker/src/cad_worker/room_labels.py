"""Room-name labels drawn in the DXF, classified without a model.

Architects name every room in the drawing. The Cambre corpus carries 38 of them
on ``_NOM - LOCALES``: COCINA, DORMITORIO, BAÑO SUITE, VESTIDOR, LAVADERO...
Reading that layer replaces a vision model guessing room polygons and room types
from a raster: the answer is already in the file, exact and free.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

# Layers whose text is a room name. Matched as substrings, case-insensitive.
ROOM_LABEL_LAYER_TOKENS = (
    "local",
    "ambiente",
    "recinto",
    "room name",
    "nombre de local",
)

# Text that lives on a room-name layer but does not name a habitable room.
NON_ROOM_TEXTS = (
    "lucarna",
    "claraboya",
    "divisor",
    "texto",
    "vacio",
    "doble altura",
    "proyeccion",
    "nivel",
    "cota",
    "escala",
    "planta",
    "corte",
    "vista",
    "ref",
    "n/a",
)

# Substring -> room_type understood by the normative rulesets. Matched longest
# first, so "sala de maquinas" wins over "sala".
NAME_TO_ROOM_TYPE: tuple[tuple[str, str], ...] = (
    ("sala de maquinas", "deposito"),
    ("sala de tanques", "deposito"),
    ("area maniobras", "deposito"),
    ("estar comedor", "estar_comedor"),
    ("hall suite", "paso_circulacion"),
    # Wet rooms first: "BAÑO SUITE" is a bathroom, not a bedroom, and "TOILETTE
    # DE SERVICIO" is not a service room. Matching them before the bedroom and
    # room-qualifier entries keeps the compound names on the right rule.
    ("bano serv", "bano"),
    ("bano suite", "bano"),
    ("bano en suite", "bano"),
    ("toilette", "bano"),
    ("toilet", "bano"),
    ("bathroom", "bano"),
    ("bano", "bano"),
    ("dormitorio", "dormitorio"),
    ("habitacion", "dormitorio"),
    ("recamara", "dormitorio"),
    ("bedroom", "dormitorio"),
    ("cuarto", "dormitorio"),
    ("suite", "dormitorio"),
    ("cocina", "cocina"),
    ("kitchen", "cocina"),
    ("comedor", "estar_comedor"),
    ("living", "estar_comedor"),
    ("family", "estar_comedor"),
    ("playroom", "estar_comedor"),
    ("quincho", "galeria"),
    ("estar", "estar_comedor"),
    ("salon", "estar_comedor"),
    ("lavadero", "lavadero"),
    ("laundry", "lavadero"),
    ("tendedero", "lavadero"),
    ("vestidor", "vestidor"),
    ("placard", "vestidor"),
    ("closet", "vestidor"),
    ("despensa", "deposito"),
    ("deposito", "deposito"),
    ("baulera", "deposito"),
    ("bodega", "deposito"),
    ("escalera", "escalera"),
    ("pasillo", "paso_circulacion"),
    ("circulacion", "paso_circulacion"),
    ("recepcion", "paso_circulacion"),
    ("vestibulo", "paso_circulacion"),
    ("acceso", "paso_circulacion"),
    ("hall", "paso_circulacion"),
    ("paso", "paso_circulacion"),
    ("oficina", "office"),
    ("escritorio", "office"),
    ("estudio", "office"),
    ("office", "office"),
    ("cochera", "garaje"),
    ("garage", "garaje"),
    ("garaje", "garaje"),
    ("galeria", "galeria"),
    ("terraza", "exterior"),
    ("balcon", "exterior"),
    ("pergola", "exterior"),
    ("patio", "exterior"),
    ("jardin", "exterior"),
    ("parrilla", "galeria"),
)

# Room types that are outdoors or unusable: detected and reported, never wired.
NON_WIRED_ROOM_TYPES = frozenset({"exterior"})

DEFAULT_ROOM_TYPE = "generico"

# Plausible floor area per room type, in m². A detected region outside its range
# is still returned — it is real geometry — but carries a warning, because the
# usual cause is a fill that stopped at a wardrobe or ran through a doorway.
PLAUSIBLE_AREA_M2: dict[str, tuple[float, float]] = {
    "dormitorio": (5.0, 45.0),
    "cocina": (3.0, 60.0),
    "estar_comedor": (6.0, 120.0),
    "bano": (1.2, 15.0),
    "lavadero": (1.5, 25.0),
    "vestidor": (1.5, 25.0),
    "office": (3.0, 40.0),
    "paso_circulacion": (0.8, 30.0),
    "escalera": (1.5, 30.0),
    "deposito": (0.8, 80.0),
    "galeria": (2.0, 120.0),
}

WARN_AREA_IMPLAUSIBLE = "ROOM_AREA_IMPLAUSIBLE_FOR_TYPE"


def area_warning(room_type: str, area_m2: float) -> str | None:
    """Warning when a room's area does not match what its name implies."""
    bounds = PLAUSIBLE_AREA_M2.get(room_type)
    if bounds is None:
        return None
    low, high = bounds
    if area_m2 < low or area_m2 > high:
        return f"{WARN_AREA_IMPLAUSIBLE}: {room_type} {area_m2:.1f} m2 fuera de [{low}, {high}]"
    return None


@dataclass(frozen=True)
class RoomLabel:
    """A room name read from the drawing, with its insertion point."""

    text: str
    x: float
    y: float
    layer: str
    room_type: str
    slug: str


def normalize_text(value: str) -> str:
    """Casefold, strip accents and collapse whitespace for robust matching."""
    decomposed = unicodedata.normalize("NFD", value)
    stripped = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return " ".join(stripped.lower().split())


def slugify(value: str) -> str:
    normalized = normalize_text(value)
    out = "".join(char if char.isalnum() else "-" for char in normalized)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")[:40] or "sin-nombre"


def is_room_label_layer(layer: str | None) -> bool:
    if not layer:
        return False
    normalized = normalize_text(layer)
    return any(token in normalized for token in ROOM_LABEL_LAYER_TOKENS)


def classify_room_name(text: str) -> str | None:
    """Room type for a label text, or None when the text does not name a room."""
    normalized = normalize_text(text)
    if not normalized or len(normalized) > 60:
        return None
    if any(token in normalized for token in NON_ROOM_TEXTS):
        return None
    # Bare numbers, level marks and symbols are annotations, not room names.
    if not any(char.isalpha() for char in normalized):
        return None
    for needle, room_type in NAME_TO_ROOM_TYPE:
        if needle in normalized:
            return room_type
    return None


def collect_room_labels(etiquetas: object) -> list[RoomLabel]:
    """Room-name labels from ``geometry_extract.etiquetas_texto``.

    A label qualifies when its layer is a room-name layer or its text matches the
    room vocabulary. Labels on a room-name layer whose text is not in the
    vocabulary (studio-specific names like "FAMILY" or a person's name) are kept
    as generic rooms — they are rooms, just unclassifiable. Annotations such as
    "lucarna" are rejected by NON_ROOM_TEXTS in both paths.
    """
    if not isinstance(etiquetas, list):
        return []
    labels: list[RoomLabel] = []
    for raw in etiquetas:
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("texto") or "").strip()
        position = raw.get("posicion")
        if not text or not isinstance(position, (list, tuple)) or len(position) < 2:
            continue
        try:
            x, y = float(position[0]), float(position[1])
        except (TypeError, ValueError):
            continue
        layer = str(raw.get("capa") or "")
        room_type = classify_room_name(text)
        on_room_layer = is_room_label_layer(layer)
        if room_type is None:
            if not on_room_layer:
                continue
            # Reject annotations even when they sit on the room-name layer.
            normalized = normalize_text(text)
            if not normalized or any(token in normalized for token in NON_ROOM_TEXTS):
                continue
            if not any(char.isalpha() for char in normalized):
                continue
            room_type = DEFAULT_ROOM_TYPE
        labels.append(
            RoomLabel(
                text=text,
                x=x,
                y=y,
                layer=layer,
                room_type=room_type,
                slug=slugify(text),
            ),
        )
    return labels
