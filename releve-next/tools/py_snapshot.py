"""
Phase 7 — snapshot de non-régression, côté PYTHON (la vérité de référence).

    python releve-next/tools/py_snapshot.py [chemin/events.jsonl] [sortie.json]

Charge un vrai journal, calcule les chiffres qui comptent (R, exposition,
drawdown, challenge, campagnes, expectancy) et les écrit en JSON canonique —
arrondis FIXES, pour qu'un flottant ne fasse jamais diverger la comparaison.
Le snapshot TS (ts_snapshot via Vitest) doit produire EXACTEMENT ce fichier.
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]     # .../saas
sys.path.insert(0, str(ROOT))

from core import metrics as M          # noqa: E402
from core.challenge import Period, compute  # noqa: E402
from core.specs import SpecBook        # noqa: E402
from core.store import Store           # noqa: E402


def q(x, places: int):
    """Decimal/None -> chaîne à `places` décimales fixes (ou None)."""
    if x is None:
        return None
    return f"{Decimal(x):.{places}f}"


def f(x, places: int):
    """float/None -> chaîne à `places` décimales fixes (ou None)."""
    if x is None:
        return None
    return f"{float(x):.{places}f}"


def main() -> None:
    journal = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "events.jsonl"
    sortie = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "releve-next" / "tools" / "snapshot.json"

    store = Store(journal)
    ideas, positions, deals = store.load()
    book = SpecBook(list(positions.values()))
    campaigns = store.campaigns()

    snap: dict = {"ideas": {}, "campaigns": {}, "global": {}}

    for iid, i in sorted(ideas.items()):
        snap["ideas"][iid] = {
            "symbol": i.symbol,
            "status": i.status.value,
            "n_positions": len(i.positions),
            "n_adds": len(i.adds),
            "pnl_net": q(i.pnl_net, 2),
            "pnl_initial": q(i.pnl_initial, 2),
            "pnl_adds": q(i.pnl_adds, 2),
            "r_multiple": q(i.r_multiple(book), 4),
            "risk_realized": q(i.risk_realized(book), 2),
            "max_concurrent_risk": q(i.max_concurrent_risk(book), 2),
            "exposure_measured": i.exposure_is_measured(),
            "discipline": i.discipline_score,
            "quadrant": i.quadrant.value,
            "off_plan": i.off_plan,
            "account_id": i.account_id,
        }

    for cid, c in sorted(campaigns.items()):
        snap["campaigns"][cid] = {
            "name": c.name,
            "instruments": list(c.instruments),
            "n_executed": len(c.executed_ideas),
            "pnl_net": q(c.pnl_net, 2),
            "r_total": q(c.r_total(book), 4),
            "r_weighted": q(c.r_weighted(book), 4),
            "abandoned": c.abandoned,
        }

    exp = M.Expectancy.of(M.r_multiples(list(ideas.values())))
    dd = M.drawdown(M.deal_curve(deals))
    st = compute(deals, Period())

    snap["global"] = {
        "n_ideas": len(ideas),
        "n_positions": len(positions),
        "n_deals": len(deals),
        "n_campaigns": len(campaigns),
        "expectancy_n": exp.n if exp else None,
        "expectancy_r": f(exp.expectancy_r, 4) if exp else None,
        "win_rate": f(exp.win_rate, 4) if exp else None,
        "total_r": f(exp.total_r, 4) if exp else None,
        "dd_pct": f(dd.max_dd_pct, 4) if dd else None,
        "dd_abs": f(dd.max_dd_abs, 2) if dd else None,
        "challenge_balance": q(st.balance, 2) if st else None,
        "challenge_margin": q(st.margin_to_floor, 2) if st else None,
        "challenge_lowest": q(st.lowest_ever, 2) if st else None,
        "challenge_dd_pct": q(st.drawdown_from_start_pct, 4) if st else None,
    }

    sortie.write_text(json.dumps(snap, ensure_ascii=False, indent=2, sort_keys=True),
                      encoding="utf-8")
    print(f"snapshot Python écrit : {sortie}")
    print(f"  {len(ideas)} idées, {len(positions)} positions, {len(deals)} deals, "
          f"{len(campaigns)} campagnes")


if __name__ == "__main__":
    main()
