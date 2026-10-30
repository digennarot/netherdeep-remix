// Macro (script, GM): una visione dell'Apotheon, tirata col d20 tra quelle non ancora viste.
// Tutti vedono il testo; al GM arrivano il numero vero e un segno per metterla in ordine.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptApotheonMemory();
