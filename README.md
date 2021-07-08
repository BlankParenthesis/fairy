Fairy
=====
Fairy is a [Discord](https://discord.com) bot for template tracking on [pxls.space](https://pxls.space).

The primary function of this bot was as personalized bot for the Pxls faction [The Cirno Embassy](https://perfectfreeze.art), but it works as a generic bot too. 
This code is run live under a bot with the name *Reimu*.
You can [invite Reimu to your Discord server](https://discord.com/api/oauth2/authorize?client_id=510854226876956723&permissions=0&scope=bot%20applications.commands) if you want.

While initially this project included several unrelated functions in one program, it has since become solely about template tracking.

Installing
----------

Fairy is a [node.js](https://nodejs.org/en/) project and requires the appropriate node packages to be downloaded before use.
This should be done by running `npm install`.

Before running the bot, it should be configured by creating a `config.json` file.
The file `example-config.json` can be used as a baseline.

As this is a Typescript project, it must be compiled into Javascript before it will function.
Ensure that `tsc` — the Typescript compiler — is installed then run `npm run build`.
This should create a `lib` directory with all the compiled files inside.

Usage
-----

After installation, the bot can be run with `npm start`.
This should start up an interactive REPL which can be used to administrate the bot.
This REPL environment has some key context variables which are vital for tinkering with its internal operation if needed:
- `servers` is a map of server IDs to abstracted server handler instances. 
  These instances are distinct from discord.js guild objects and handle the templates and summaries associated with a particular server.
- `fairy` is the discord.js client instance. 
  This can be used to fetch objects from Discord.
- `pxls` is the Pxls connection instance.
- `repl` is the abstracted Repl server instance. 
  The server instance itself can be obtained with `repl.server`.
- `update()` is a function that will immediately update all summaries.
  It is called automatically every 60 seconds but forcing an update is often useful in debugging.

### Commands

The bot only responds to Discord's [slash commands](https://discord.com/developers/docs/interactions/slash-commands). 
These commands only work in servers and not in direct messages currently.
Further, they require the MANAGE_GUILD permission of the initiating users.
This is used as a loose test of moderation/admin status.

The bot automatically registers two such commands globally:

#### /template…

Template commands change which templates the bot is tracking on behalf of that server.
“Tracked” templates are simply templates that tbe bot keeps track of itself.
This does not mean that it is displaying them anywhere.

There are two subcommands for this command:
- `/template add {template-url}` tells the bot to begin tracking the given template for this server.
  Invoking this command twice with templates of the same name will result in only the most recent one being tacked.
  This can be used to update templates in-place (though historical data will be invalidated).
- `/template remove {template-name}` tells the bot to forget about a template with the specified name.
  The given template name is used as a search string, so substrings will match.
  

#### /summary…

Summary commands create or update summary posts.
Summaries display information on specific templates which are tracked in the current server.
Templates should be added with `/template add {template-url}` before summaries become useful.

Summaries can be controlled with three subcommands:
- `/summary post {template-names}` creates a summary post in the current channel.
  `{template-names}` is a list of comma-separated search strings which will each be used to find a template by title. These do not need to match exactly and will be silently dropped if no matching template is found.
- `/summary edit {summary-message} {template-names}` changes the templates associated with a summary.
  `{summary-message}` allows two ways of specifying the summary to update:
  - The summary message ID.
  - A link to the message as obtained from the “Copy Message Link” feature.
- `/summary freeze {summary-message}` keeps the summary message, but forgets about the summary internally — it will no longer be updated.
  Freezing is permanent.

Summary messages can be safely deleted.
This is the intended way to remove summaries — there is no command to do this.
Deleting the message will remove the summary internally the next time it is updated.

### Canvas Resets
Pxls tends to reset the canvas.
This makes all data currently stored by the bot invalid.
Consequently, the bot will forget all templates and summaries when it detects changed canvas number.
