// Macro (script, GM): crea il diario «Remix: blocco 5» (Gli studiosi di Ank'Harel) e le sue tabelle casuali.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 5", [
  ["Gli studiosi di Ank'Harel", "17-studiosi-di-ankharel.html", "NONE"],
  ["Scheda: Prolix Yusaf", "18-scheda-prolix.html", "NONE"],
  ["Scheda: Question", "19-scheda-question.html", "NONE"],
  ["Scheda: Aloysia Telfan", "20-scheda-aloysia.html", "NONE"],
  ["Intrecci, luoghi e indizi", "21-intrecci-luoghi-indizi.html", "NONE"],
  ["Il nemico tra gli studiosi", "22-il-nemico-tra-gli-studiosi.html", "NONE"]
], { tables: "tabelle-blocco5.json" });
