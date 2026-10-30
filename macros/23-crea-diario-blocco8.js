// Macro (script, GM): crea il diario «Remix: blocco 8» (missioni di fazione) e la tabella delle mosse delle fazioni.
// Se il diario esiste già, chiede se aggiornarlo invece di crearne un altro.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createJournal("Remix: blocco 8", [
  ["Missioni di fazione: il remix", "32-missioni-di-fazione-remix.html", "NONE"],
  ["Ank'Harel: posta in gioco e rivelazioni", "33-ankharel-posta-e-rivelazioni.html", "NONE"],
  ["Le contese di Ank'Harel", "34-contese-di-ankharel.html", "NONE"],
  ["Le contese di Cael Morrow", "35-contese-di-cael-morrow.html", "NONE"],
  ["Squadre, orologi e mosse delle fazioni", "36-squadre-orologi-mosse.html", "NONE"],
  ["Dispensa: le fazioni di Ank'Harel", "37-dispensa-fazioni-ankharel.html", "OBSERVER"]
], { tables: "tabelle-blocco8.json" });
