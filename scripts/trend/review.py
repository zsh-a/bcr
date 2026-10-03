"""Export a compact, audited UI dossier. No replay, selection, or stage promotion."""
import argparse
from pathlib import Path

from artifacts import evaluation_identity, load_evidence, sha, write_once
from report import build_bundle
from study import audit_stage_receipt, reference, require, semantic_identity


def flatten(value, prefix=""):
    output = {}
    for key, item in value.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(item, dict):
            output.update(flatten(item, name))
        else:
            output[name] = item
    return output


def review_bundle(bundle, identity, receipt=None):
    """Presentation contract: all measured rows, original order and explicit missing cells."""
    plan, selection = bundle["plan"], bundle["selection"]
    findings = []
    if receipt:
        require(semantic_identity(receipt["rawIdentity"]) == semantic_identity(identity)
                and receipt["selected"] == selection["id"], "stage receipt belongs to another run")
        if receipt["stage"] == "development":
            definitions = {
                "sourceQualification": (receipt["qualification"]["status"], "passed", "开发样本与交易质量资格"),
                "basePositiveReturn": (receipt["baseReturn"], "> 0", "基础成本净收益"),
                "baseDailyDrawdown": (receipt["baseDailyDrawdown"],
                                      f">= {-plan['transferEvaluation']['maxDailyDrawdown']}", "日终最大回撤"),
            }
            for code, passed in receipt["checks"].items():
                actual, threshold, label = definitions[code]
                findings.append({"code": code, "label": label, "status": "pass" if passed else "fail",
                                 "actual": actual, "threshold": threshold, "evidence": f"stage:{receipt['cell']}"})
        else:
            findings = [{"code": row["criterion"], "label": row["criterion"],
                         "status": "pass" if row["passed"] else "fail", "actual": row["actual"],
                         "threshold": row["threshold"], "evidence": f"stage:{receipt['cell']}"}
                        for row in receipt["acceptance"]["checks"]]
        verdict = {"status": "pass" if receipt["passed"] else "fail", "stage": receipt["stage"],
                   "scope": receipt["costScope"], "cell": receipt["cell"]}
    else:
        verdict = {"status": "unbound", "stage": "unbound", "scope": "descriptive-only", "cell": None}
    qualification = selection.get("developmentQualification")
    if qualification:
        # Recorded qualification is descriptive; it cannot stand in for a stage seal.
        findings.append({"code": "recorded-development-qualification", "label": "冻结选择的开发资格",
                         "status": "info", "actual": qualification["status"], "threshold": "passed",
                         "evidence": "selection.developmentQualification"})
        for symbol, count in qualification["tradesBySymbol"].items():
            findings.append({"code": f"development-trades:{symbol}", "label": f"开发交易数 · {symbol}",
                             "status": "info", "actual": count,
                             "threshold": f">= {qualification['minimumTradesPerSymbol']}",
                             "evidence": "selection.developmentQualification"})
    candidates = [{"id": row["id"], "parameters": flatten({
        "strategy": {k: v for k, v in row.items() if k not in ("id", "riskOverrides")},
        "risk": {**plan["risk"], **row.get("riskOverrides", {})}})} for row in plan["candidates"]]
    definitions = {row["id"]: row for row in candidates}
    rows = []
    for window in plan["windows"]:
        for row in bundle["summaries"][window["id"]]:
            parameters = flatten({"strategy": row["strategy"], "risk": row.get("risk", plan["risk"])})
            if row["id"] not in definitions:
                candidate = {"id": row["id"], "parameters": parameters}
                candidates.append(candidate)
                definitions[row["id"]] = candidate
            else:
                require(definitions[row["id"]]["parameters"] == parameters, "candidate parameters change across windows")
            rows.append({"window": window["id"], "candidate": row["id"], "costScenario": row["costScenario"],
                         "netReturn": row["equalSleeveReturn"], "dailyDrawdown": row["dailyPortfolioDrawdown"],
                         "trades": row["trades"], "netExpectancy": row["netExpectancy"],
                         "profitFactor": row["profitFactor"], "meanNetR": row["meanNetR"],
                         "dailySharpe": row["dailySharpe"], "dailyMean95CI": row.get("dailyMean95CI")})
    first = next(iter(bundle["summaries"].values()))[0]
    return {"kind": "trend-research-review", "version": 1, "title": plan.get("title", "趋势研究"),
            "engine": bundle["engine"], "identity": identity, "selected": selection["id"],
            "assumptions": {"capitalMode": first["capitalMode"], "accountCapital": first["accountInitialCapital"],
                            "sleeveCapital": first["sleeveInitialCapital"], **plan["costs"]},
            "selectionRule": selection["criterion"], "symbols": list(plan["symbols"]),
            "windows": [{"id": w["id"], "role": w.get("role", "undeclared"), "start": w["start"], "end": w["end"]}
                        for w in plan["windows"]],
            "candidates": candidates, "rows": rows, "verdict": verdict, "findings": findings,
            "limitations": plan.get("limitations", []), "auditScope": bundle["auditScope"],
            "qualificationReasons": qualification["reasons"] if qualification else []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists(), "review output must be a new file")
    evidence = load_evidence(args.plan, args.manifest, args.input)
    identity = evaluation_identity(evidence)
    bundle, _ = build_bundle(evidence)
    receipt = audit_stage_receipt(args.receipt) if args.receipt else None
    value = review_bundle(bundle, identity, receipt)
    require(evaluation_identity(evidence) == identity, "inputs changed while exporting review")
    value["sources"] = {"plan": reference(args.plan), "manifest": reference(args.manifest),
                        "run": reference(args.input / "run.json"), "generatorSha256": sha(__file__)}
    if args.receipt:
        value["sources"]["receipt"] = reference(args.receipt)
    write_once(args.output, value)
    print(args.output)


if __name__ == "__main__":
    main()
