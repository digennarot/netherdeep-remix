// Macro (script, GM): propone in privato un piano per il colpo al Gioiello del ricercatore nemico.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptHeistPlan();
