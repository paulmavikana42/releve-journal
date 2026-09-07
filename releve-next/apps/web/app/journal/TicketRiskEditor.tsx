"use client";

import { useState } from "react";
import { saveTicketRisk } from "./actions";
import SubmitButton from "../components/SubmitButton";

/**
 * Préciser le risque d'un ticket rattaché, depuis le détail :
 *  · le stop réel (un renfort n'hérite jamais du stop du noyau — décision [H ter]) ;
 *  · pour un renfort, si le noyau était au breakeven à son ouverture ([H quater]).
 * Déplié d'office quand une réponse manque (stop absent, ou breakeven non tranché),
 * pour nudger sans bloquer.
 */
export default function TicketRiskEditor({
  ideaId,
  positionUid,
  isAdd,
  defaultStop,
  needsStop,
  securedAnswered,
  securedValue,
}: {
  ideaId: string;
  positionUid: string;
  isAdd: boolean;
  defaultStop: string;
  needsStop: boolean;
  securedAnswered: boolean;
  securedValue: boolean;
}) {
  const mustAsk = needsStop || (isAdd && !securedAnswered);
  const [open, setOpen] = useState(mustAsk);

  if (!open) {
    return (
      <button type="button" className="ghost add-risk-toggle" onClick={() => setOpen(true)}>
        Préciser le risque de ce {isAdd ? "renfort" : "ticket"}
      </button>
    );
  }

  return (
    <form action={saveTicketRisk} className="add-risk">
      <input type="hidden" name="ideaId" value={ideaId} />
      <input type="hidden" name="positionUid" value={positionUid} />
      <div className="add-risk-fields">
        <div>
          <label>
            Stop réel {isAdd ? "de ce renfort" : "de ce ticket"}
            <span className="help" data-tip="Le prix d'invalidation réellement placé. Un renforcement peut être pris plus serré que le noyau : sans son stop propre, le R de l'idée reste incalculable.">?</span>
          </label>
          <input name="stop" inputMode="decimal" defaultValue={defaultStop} placeholder="ex. 1.0895" style={{ width: "100%" }} />
        </div>
        {isAdd && (
          <>
            <input type="hidden" name="with_secured" value="1" />
            <label className="row add-be" style={{ gap: 8 }}>
              <input type="checkbox" name="core_secured" defaultChecked={securedValue} />
              <span>Le noyau était déjà au <b>breakeven</b> quand ce renfort s&apos;est ouvert</span>
            </label>
          </>
        )}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 2 }}>
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
        {!mustAsk && (
          <button type="button" className="ghost" onClick={() => setOpen(false)}>Annuler</button>
        )}
      </div>
      {isAdd && (
        <div className="note" style={{ marginTop: 2 }}>
          Sans réponse au breakeven, l&apos;exposition simultanée reste un <b>majorant</b> (elle montre pire que la réalité).
        </div>
      )}
    </form>
  );
}
