// Macro (script, GM): crea il diario «Remix: blocco 1» con le pagine HTML del modulo.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 1", [
  ["Gestire i rivali", "01-gestire-i-rivali.html", "NONE"],
  ["Lista delle rivelazioni", "02-lista-delle-rivelazioni.html", "NONE"],
  ["Storia di Alyxian: dove seminarla", "03-storia-di-alyxian.html", "NONE"],
  ["Ruidium: le modifiche del remix", "04-ruidium-remix.html", "NONE"],
  ["Dispensa: il ruidium e la magia", "05-dispensa-ruidium-giocatori.html", "OBSERVER"]
]);
