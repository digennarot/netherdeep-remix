// Macro (script, GM): crea il diario «Remix: blocco 6» (Betrayers' Rise) e le tabelle dei rivali e della traversata.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 6", [
  ["Betrayers' Rise: il remix", "23-betrayers-rise-remix.html", "NONE"],
  ["Alyxian nel Betrayers' Rise", "24-alyxian-nel-rise.html", "NONE"],
  ["Dispensa: il bassorilievo dei Barbed Fields", "25-dispensa-bassorilievo.html", "OBSERVER"],
  ["Dispensa: la statua di Torog", "26-dispensa-statua-torog.html", "OBSERVER"]
], { tables: "tabelle-blocco6.json" });
