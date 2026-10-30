// Macro (script, GM): crea il diario «Remix: blocco 2» (Jigow e Festival del Merito) e le sue tabelle casuali.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 2", [
  ["Jigow: la città che si muove", "06-jigow-citta-in-movimento.html", "NONE"],
  ["Il Festival del Merito: due strutture", "07-festival-del-merito.html", "NONE"],
  ["Eventi in più e indizi", "08-eventi-e-indizi-festival.html", "NONE"],
  ["Labirinto e indovinelli", "09-labirinto-e-indovinelli.html", "NONE"],
  ["Dispensa: gli indovinelli di Colbu Kaz", "10-dispensa-indovinelli.html", "OBSERVER"]
], { tables: "tabelle-blocco2.json" });
