"""One discoverable entry point for the existing trend research tools.

Dispatch only: each tool owns its arguments, validation and output contract.
No implicit build, download, replay, candidate selection or stage promotion.
"""
import argparse
import os
from pathlib import Path
import sys


TOOLS = {
    "data": ("download", "Fetch and verify the archives of an explicit plan"),
    "study": ("study", "Catalog, preflight, compile and seal isolated study cells"),
    "run": ("research", "Replay a plan with an explicitly selected native binary"),
    "report": ("report", "Render audited account results without reselection"),
    "review": ("review", "Export audited findings and measured candidates for the research UI"),
    "plot": ("plot", "Plot a published result and its recorded curves"),
    "audit": ("audit", "Check immutable snapshots or native-run receipts"),
}
GROUPS = {
    "evaluate": ("Evaluate a predeclared statistical protocol", {
        "transfer": ("transfer_evaluation", "Evaluate frozen-choice transfer acceptance"),
        "mechanism": ("mechanism_evaluation", "Describe fixed mechanism comparisons"),
        "search": ("search_evaluation", "Evaluate a declared candidate family"),
    }),
    "diagnose": ("Inspect evidence without selecting a strategy", {
        "trades": ("trade_diagnostics", "Attribute completed account trades and costs"),
        "setups": ("setup_diagnostics", "Audit account-path setup snapshots and counts"),
        "opportunities": ("opportunity_diagnostics", "Label independent structured opportunities"),
        "breakouts": ("breakout_study", "Compare the frozen channel breakout event definitions"),
    }),
}


def add_tools(subcommands, tools):
    for name, (module, description) in tools.items():
        # Leaf help and every argument are interpreted by the actual tool.
        leaf = subcommands.add_parser(name, help=description, add_help=False)
        leaf.set_defaults(script=module + ".py")


def command(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    add_tools(subcommands, TOOLS)
    for name, (description, tools) in GROUPS.items():
        group = subcommands.add_parser(name, help=description, description=description)
        add_tools(group.add_subparsers(dest="operation", required=True), tools)
    args, remaining = parser.parse_known_args(argv)
    return [sys.executable, str(Path(__file__).resolve().with_name(args.script)), *remaining]


def main():
    invocation = command()
    # Replacing this process preserves the tool's exit status and signal handling.
    os.execv(invocation[0], invocation)


if __name__ == "__main__":
    main()
