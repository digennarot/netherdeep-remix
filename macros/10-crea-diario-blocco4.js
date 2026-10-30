// Macro (script, GM): crea il diario «Remix: blocco 4» (La strada per Bazzoxan) con le pagine HTML del modulo.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 4", [
  ["La strada per Bazzoxan", "13-strada-per-bazzoxan.html", "NONE"],
  ["La visione dell'Apotheon", "14-visione-apotheon.html", "NONE"],
  ["Indizi verso Bazzoxan", "15-indizi-verso-bazzoxan.html", "NONE"],
  ["Dispensa: il quaderno di Galsariad", "16-quaderno-galsariad.html", "NONE"]
]);
