// Macro (script, GM): sulla battle map aperta sceglie la variante (giorno, notte, con o senza carro…).
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptMapVariant();
