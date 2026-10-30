// Macro (script, GM): una mossa per ogni fazione e uno spicchio in più ai loro orologi, alla fine della giornata.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptFactionTurn();
