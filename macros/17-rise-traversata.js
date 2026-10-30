// Macro (script, GM): la traversata del Betrayers' Rise con uno studioso come guida, in tempo astratto, fino alla Cisti di Avandra.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptRiseCrossing();
