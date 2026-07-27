"""Output layer, block naming and symbol sizing."""

OUTPUT_ELECTRICAL_LAYER_NAME = "Cambre_Electrical"
LEGACY_ELECTRICAL_LAYER_NAME = "INSTALACION_ELECTRICA"
DEFAULT_OUTLET_BLOCK_NAME = "CAMBRE_OUTLET"
DEFAULT_LAYER_COLOR_ACI = 3

# Electrical symbols are graphic annotations sized for plotting, not physical
# representations of the installed device. Block geometry is authored directly in
# millimetres of paper, so these numbers are what an architect reads on the
# printed sheet at any plot scale.
SYMBOL_PAPER_MM = 4.5
MIN_SYMBOL_PAPER_MM = 3.0
MAX_SYMBOL_PAPER_MM = 5.5

DEFAULT_PLOT_SCALE = 100.0
SUPPORTED_PLOT_SCALES = (20.0, 25.0, 33.0, 50.0, 75.0, 100.0, 125.0, 150.0, 200.0)

# Last-resort ratio cap. Unlike a metre-denominated floor it is dimensionless, so
# it still bounds the symbol when the unit resolution itself is wrong.
MAX_SYMBOL_ROOM_MINOR_RATIO = 0.15

# The legibility floor is denominated in the resolved units, so under a wrong
# unit resolution it would inflate instead of protect — the exact mechanism that
# produced 200-metre symbols. Below this confidence the dimensionless room cap
# rules alone and the symbol is allowed to come out small.
CONFIDENT_UNITS_THRESHOLD = 0.5

GENERATOR_VERSION = "cad-worker-electrical-v3"

# Blocks from superseded generations. They are purged from the electrical layer
# on every run so a reprocess can never mix symbol sizes: the v1 family carried
# absolute radii meant for millimetre drawings (a 200 m circle on a plan in
# metres) and the v2 family carried dimensionless unit radii.
LEGACY_BLOCK_NAMES = frozenset(
    {
        "CAMBRE_OUTLET",
        "CAMBRE_OUTLET_DBL",
        "CAMBRE_SWITCH",
        "CAMBRE_OUTLET_DED",
        "CAMBRE_OUTLET_EMG",
        "SYM_TOMA",
        "SYM_TOMA_ESP",
        "SYM_LLAVE",
        "SYM_CENTRO",
        "SYM_BRAZO",
        "SYM_TABLERO",
        "SYM_PAT",
    },
)
