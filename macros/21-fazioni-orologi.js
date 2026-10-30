// Macro (script, GM): fazione dei personaggi e dei rivali, orologi delle contese, orologi da mostrare ai giocatori.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptFactionClocks();
