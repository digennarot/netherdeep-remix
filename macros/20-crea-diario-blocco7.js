// Macro (script, GM): crea il diario «Remix: blocco 7» (Cael Morrow) e le tabelle degli incontri e delle tracce.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 7", [
  ["Cael Morrow: il remix", "27-cael-morrow-remix.html", "NONE"],
  ["Mappa a punti di Cael Morrow", "28-mappa-a-punti.html", "NONE"],
  ["Accesso a Cael Morrow e sicurezza", "29-accesso-e-sicurezza.html", "NONE"],
  ["Controllo territoriale", "30-controllo-territoriale.html", "NONE"],
  ["Dispensa: rilievo dell'Allegiance", "31-dispensa-rilievo.html", "OBSERVER"]
], { tables: "tabelle-blocco7.json" });
