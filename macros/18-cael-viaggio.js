// Macro (script, GM): un tratto di viaggio nel pointcrawl di Cael Morrow, con orientamento e incontri ora per ora.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptCaelTravel();
