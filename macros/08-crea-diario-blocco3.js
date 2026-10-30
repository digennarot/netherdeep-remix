// Macro (script, GM): crea il diario «Remix: blocco 3» (Emerald Grotto) con le pagine HTML del modulo.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 3", [
  ["La grande finale: perché due squadre?", "11-grande-finale-squadre.html", "NONE"],
  ["Il grande annuncio", "12-grande-annuncio.html", "NONE"]
]);
