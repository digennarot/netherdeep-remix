// Macro (script, GM): segna l'atteggiamento dei ricercatori verso personaggi e rivali e manda un riepilogo privato.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptScholarAttitudes();
