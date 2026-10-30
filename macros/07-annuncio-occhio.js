// Macro (script, GM): la voce dell'Occhio di Smeraldo proclama i vincitori e apre il passaggio dorato.
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
await api.promptEmeraldAnnouncement();
