// Macro (script): Usa il ruidium. Per giocatori e GM.
// Agisce sul token selezionato oppure sul personaggio assegnato all'utente.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
await api.promptRuidium(actor);
