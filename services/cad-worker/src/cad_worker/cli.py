import argparse
import json
import sys
from datetime import datetime, timezone


def _health_payload() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "cad-worker",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def health_cmd() -> int:
    print(json.dumps(_health_payload()))
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cad-worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health")

    args = parser.parse_args(argv)

    if args.command == "health":
        raise SystemExit(health_cmd())

    raise SystemExit(2)


if __name__ == "__main__":
    main(sys.argv[1:])

