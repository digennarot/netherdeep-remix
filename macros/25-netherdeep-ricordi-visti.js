// Macro (script, GM): segna le visioni già viste, controlla l'ordine proposto dai giocatori o azzera tutto.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptMemoryState();
