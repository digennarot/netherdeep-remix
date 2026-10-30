// Macro (script, GM): mostra a tutti la visione di Alyxian (E12) con l'ultima battuta scelta.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptApotheonVision();
