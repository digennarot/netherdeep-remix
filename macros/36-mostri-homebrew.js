// Macro (script, GM): crea gli attori dei mostri homebrew del pacchetto di mappe (nuovi mostri del Netherdeep
// e Alyxian rivisti) nella cartella «Remix Netherdeep». Rilanciata, li rifà; gli Alyxian del libro non vengono toccati.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.importHomebrewActors();
