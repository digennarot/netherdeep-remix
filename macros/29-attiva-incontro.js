// Macro (script, GM): attiva un incontro sulla scena aperta. Usa i token selezionati; senza selezione
// chiede di cliccare il centro dell'area e prende i token nascosti nel raggio. Li rivela, li mette nel
// combattimento (con i personaggi giocanti, se vuoi) e tira l'iniziativa dei PNG.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptActivateEncounter();
