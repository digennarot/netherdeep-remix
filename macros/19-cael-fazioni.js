// Macro (script, GM): segna chi controlla e chi conosce ogni punto di Cael Morrow, il tipo dei percorsi, l'allerta e la posizione del gruppo.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptCaelControl();
