"""Command line: `gridml ingest`, `gridml train`, `gridml serve`."""

from __future__ import annotations

import argparse
import json
import logging
from datetime import date

from gridml.ingest import runner


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="gridml")
    sub = parser.add_subparsers(dest="cmd", required=True)

    ing = sub.add_parser("ingest", help="pull sources into the warehouse")
    ing.add_argument("--sources", nargs="*", choices=runner.SOURCES)
    ing.add_argument("--start", type=date.fromisoformat, help="default: incremental")
    ing.add_argument("--end", type=date.fromisoformat, help="default: today")

    tr = sub.add_parser("train", help="train a model synchronously")
    tr.add_argument("--algorithm", default="random_forest")
    tr.add_argument("--zone", default="Ottawa")
    tr.add_argument("--horizon", type=int, default=24)
    tr.add_argument("--params", default="{}", help="JSON object of hyperparameters")
    tr.add_argument("--search", type=int, default=0, help="random-search iterations")

    srv = sub.add_parser("serve", help="run the HTTP API")
    srv.add_argument("--host", default="0.0.0.0")
    srv.add_argument("--port", type=int, default=8000)

    args = parser.parse_args(argv)
    if args.cmd == "ingest":
        print(json.dumps(runner.run(args.sources, args.start, args.end), indent=2, default=str))
    elif args.cmd == "train":
        from gridml import training

        req = training.TrainRequest(
            algorithm=args.algorithm,
            target_zone=args.zone,
            horizon_hours=args.horizon,
            params=json.loads(args.params),
            search_iterations=args.search,
        )
        run_id = training.create_run(req)
        training.execute_run(run_id, req)
        print(f"training run {run_id} finished")
    elif args.cmd == "serve":
        import uvicorn

        uvicorn.run("gridml.api:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
