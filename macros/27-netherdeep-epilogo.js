// Macro (script, GM): dopo il finale, che cosa fanno i rivali e come reagiscono le fazioni.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptNetherdeepEpilogue();
