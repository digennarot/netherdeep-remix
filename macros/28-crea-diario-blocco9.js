// Macro (script, GM): crea il diario «Remix: blocco 9» (il Netherdeep) e la tabella dei rivali.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 9", [
  ["Il Netherdeep: il remix", "38-netherdeep-remix.html", "NONE"],
  ["Ricordi dell'Apotheon: visioni fuori ordine", "39-ricordi-fuori-ordine.html", "NONE"],
  ["I rivali al finale", "40-rivali-al-finale.html", "NONE"],
  ["Le missioni 6: entrare nel Netherdeep", "41-missioni-6.html", "NONE"],
  ["Epiloghi: fazioni e rivali", "42-epiloghi.html", "NONE"],
  ["Dispensa: ricordi dell'Apotheon", "43-dispensa-ricordi.html", "OBSERVER"]
], { tables: "tabelle-blocco9.json" });
