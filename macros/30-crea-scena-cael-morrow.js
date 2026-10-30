// Macro (script, GM): crea la scena «Cael Morrow: mappa a punti» dalla mappa del remix, con una nota per
// ogni punto che apre la pagina del blocco 7 sul punto giusto. Se la scena esiste già, rifà solo le note.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.createCaelScene();
