// Macro (script, GM): sblocca la scena che stai guardando, così gli script del remix possono di nuovo aggiornarla.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.lockScene(false);
