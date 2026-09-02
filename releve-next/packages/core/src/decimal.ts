import Decimal from "decimal.js";

// DÉCIMAL, JAMAIS FLOAT.
//
// Tout montant financier de Relevé (R, risque, exposition, drawdown, P&L, valeur
// du point) était en `decimal.Decimal` Python. On configure decimal.js pour
// s'aligner sur le contexte par défaut de Python :
//   - precision 28 chiffres significatifs (idem `decimal.getcontext().prec`)
//   - arrondi PAIR / banquier (ROUND_HALF_EVEN, idem `ROUND_HALF_EVEN` Python)
//
// La parité fine (au centième, sur le vrai journal) sera verrouillée par le diff
// de la phase 6 (non-régression Python vs TS). Ce module est le SEUL endroit où
// l'on configure decimal.js — tout le moteur importe `Decimal` d'ici.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };
