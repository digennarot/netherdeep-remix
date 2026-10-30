// Macro (script, GM): blocca la scena che stai guardando. Gli script del remix (scenefix, la scena a punti
// di Cael Morrow) non la toccano più, così le note e i token che hai sistemato a mano restano come sono.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.lockScene(true);
