// Macro (script, GM): estrae le due squadre della grande finale dell'Emerald Grotto.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptFinaleLottery();
