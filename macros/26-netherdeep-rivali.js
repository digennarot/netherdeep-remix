// Macro (script, GM): le posizioni dei rivali nel dibattito finale, con argomenti e punti deboli.
// Può pescare anche una traccia dei rivali o un trucco dell'Apotheon.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptRivalsFinale();
