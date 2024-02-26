Fairy
=====
Fairy is a [Discord](https://discord.com) bot for template tracking on [pxls.space](https://pxls.space).

The primary function of this bot was as personalized bot for the Pxls faction [The Cirno Embassy](https://perfectfreeze.art), but it works as a generic bot too. 
This code is run live under a bot with the name *Reimu*.
You can [invite Reimu to your Discord server](https://discord.com/api/oauth2/authorize?client_id=1211467289501765632&permissions=0&scope=bot%20applications.commands) if you want.

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
- `discord` is the discord.js client instance. 
  This can be used to fetch objects from Discord.
- `pxls` is the Pxls connection instance.
- `repl` is the abstracted REPL server instance. 
  The server instance itself can be obtained with `repl.server`.
- `update()` is a function that will update all summaries.
  It is called automatically every 60 seconds but forcing an update is often useful in debugging.
- `pruneUnused()` is a function that will delete templates and designs not used in any summaries.
  It is called automatically every 15 minutes.
- `designs` is an array of all different template designs currently in use.
- `templates` is an array of all different templates.
- `summaries` is an array of all tracked summaries.
- `commands` is an array of the bot's internal command instances.

### Commands

The bot only responds to Discord's [slash commands](https://discord.com/developers/docs/interactions/slash-commands). 
These commands only work in servers and in direct messages.
In servers, they require the `MANAGE_GUILD` permission of the initiating user.
This is used as a loose test of moderation/admin status.

The bot automatically registers one command with server subcommands:

#### /summary…

Summary commands create or update summary posts.
Summaries display activity information and completion progress for templates.

Summaries can be controlled with three subcommands:
- `/summary post {template-link} [more-template-links]…` creates a summary post in the current channel.
  `{template-link}` (and every subsequent optional parameter) accepts a template URL.
  The summary will show information for every template specified, in the other they were specified.
- `/summary edit {template-link} [more-template-links]…` changes the templates associated with a summary.
  The format is the same as `/summary post…`, accepting template URLs.
  If more than one summary could be edited, a followup message will be sent with options on which summary to choose.
- `/summary freeze` forgets about a summary internally, but keeps the message.
  Freezing is permanent and cannot be reversed without internal interference by a bot admin.
  As with edits, choices of summary will be given if appropriate.

**Summary messages can be safely deleted.**
This is the intended way to remove summaries — there is no command to do this.
Deleting the message will remove the summary internally the next time it is updated.

### Canvas Resets
Pxls tends to reset the canvas.
This makes all data currently stored by the bot invalid.
Consequently, the bot will freeze all summaries when it detects changed canvas number.
