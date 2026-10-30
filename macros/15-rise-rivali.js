// Macro (script, GM): sceglie che cosa fanno i rivali nel Betrayers' Rise e per chi lavorano, poi propone in privato la scena.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptRisePlan();
