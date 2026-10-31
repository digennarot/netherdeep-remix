// Macro (script, GM): crea le scene di un capitolo dalle battle map del pacchetto CalloftheNetherdeep, preparate
// prima con mappack.py. Rilanciata rifà sfondi, muri, luci e pin delle scene già importate (non delle bloccate).
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptImportMapScenes();
