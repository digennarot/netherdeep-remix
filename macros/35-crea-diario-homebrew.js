// Macro (script, GM): crea il diario «Homebrew mappe» con i documenti tradotti del pacchetto di battle map.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Homebrew mappe", [
  ["Ruins of Sorrow", "45-ruins-of-sorrow.html", "NONE"],
  ["Stanze extra del Betrayers' Rise", "44-stanze-extra-rise.html", "NONE"],
  ["On a Red Rock Trail", "46-red-rock-trail.html", "NONE"],
  ["Guida al Guided District e ai templi", "48-guided-district.html", "NONE"],
  ["Il Cuore della Disperazione, rivisto", "47-cuore-rivisto.html", "NONE"]
]);
