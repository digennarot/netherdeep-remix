// Macro (script, GM): tira le tabelle «Dov'è…?» e dice in privato dove si trova ciascun ricercatore di Ank'Harel.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
await api.scholarsWhereabouts();
