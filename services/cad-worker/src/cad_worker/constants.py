"""US-009 output layer and block naming."""

OUTPUT_ELECTRICAL_LAYER_NAME = "Cambre_Electrical"
LEGACY_ELECTRICAL_LAYER_NAME = "INSTALACION_ELECTRICA"
DEFAULT_OUTLET_BLOCK_NAME = "CAMBRE_OUTLET"
DEFAULT_LAYER_COLOR_ACI = 3
OUTLET_BLOCK_RADIUS = 1.0

# Electrical symbols are graphic annotations sized for plotting, not physical
# representations of the installed device.
SYMBOL_PAPER_MM = 4.5
ASSUMED_PLOT_SCALE = 100
MIN_SYMBOL_DIAMETER_M = 0.15
MAX_SYMBOL_ROOM_MINOR_RATIO = 0.15
MAX_SYMBOL_CLASSIFIED_SPAN_RATIO = 0.01
# Below this unit-resolution confidence, metre-denominated bounds (the 0.15 m
# floor) are untrustworthy and only unit-free room-relative caps may apply.
CONFIDENT_UNITS_THRESHOLD = 0.5

GENERATOR_VERSION = "cad-worker-electrical-v2"
LEGACY_BLOCK_NAMES = frozenset(
    {
        "CAMBRE_OUTLET",
        "CAMBRE_OUTLET_DBL",
        "CAMBRE_SWITCH",
        "CAMBRE_OUTLET_DED",
        "CAMBRE_OUTLET_EMG",
    },
)
