Fairy
=====
Fairy is a [discord](https://discord.com) bot for template tracking on [pxls.space](https://pxls.space).

The primary function of this bot is as personalized bot for the Pxls faction [The Cirno Embassy](https://perfectfreeze.art). 
This code is run there as a bot under the name *Reimu*. 
It is not intended for use by others, but has been publicly released after much interest in the project.

Installing
----------

Fairy is a node project and requires the appropriate node packages to be downloaded before use.
This should be done by running `npm install`.

Before running the bot, it should be configured by creating a `config.json` file.
The file `example-config.json` can be used as a baseline.
Admins are specified by user ID.

Usage
-----

The bot can be run with `npm start`.
If by some miracle you manage to get everything working, actually using the bot requires some basic knowledge:

### Commands
The bot reacts to well-formed messages that mention it.
A mention constitutes a discord mention or use of the bot's username or nickname in a message.
For a message to be well-formed it must have one of the following must be a substring:
- `(use|new|add) [a] [new] template [[called|named] name] <link>`
- `(delete|remove) template [[called|named] name] <link>`

Since those may be hard to read, here's an example of adding a template:

```
@Reimu#9004 add template Smoking Is Cool <https://pxls.space/#x=132&y=1296&scale=4.09&template=https%3A%2F%2Fcdn.discordapp.com%2Fattachments%2F513464079977938964%2F831555895459708968%2FSmoking_Is_Cool_template_135.png&ox=3&oy=1158&tw=135&oo=1&title=Smoking%20Is%20Cool>
```

And here's an example of removing it:

```
@Reimu#9004 delete template Smoking Is Cool
```

As implied, many other forms work but these are the only formats really used in practice.

The bot should deal with different template styles without issue but will die tragically if you give it a template with a bounding box outside of the canvas bounds.

### Confirmation
The bot uses reactions for confirmation.
The user who initiated the command has a time window in which they can react to the bot's last message to confirm their intent.
The bot will place the reactions on there so confirmation should be as easy as one click.

*Note: sometimes the bot either fails to see the user reaction or sees the wrong one.* I have no idea how or why, but it is a known uncommon bug that I haven't bothered to fix.

### Tracker Embed
In order to have the bot actually display anything, you'll need to have it post a summary in a channel.
**Each channel may only have one summary at a time.**

This must be done *from the bot's internal REPL console*.
This console has some useful functions which make this a little easier.
The regular method for adding a summary to a channel is to call `postSummary`.
This function takes two arguments — the first is a reference to a channel object.

Such a reference is usually obtained by calling `guild().channels.get("channel-id")`, though `channel("channel-id")` might also work (I don't use it because I have vague memories of it not working for some reason).

The second argument is an array of case-insensitive substrings of template names to display in the summary.
For example, a complete call might look like this:

```
postSummary(guild().channels.get("441614554862977044"), ["smoking"])
```

**Newly posted summaries delete the previous one posted in that channel.**

To modify this summary afterwards, you must access the persistent data directly.
*You should probably not do any more than change what templates are available in the summary.*
To do this, you can simply manipulate the array of templates.
This can be accessed through `persistent.summaries["channel-id"].templates`.

### Canvas Resets
Pxls tends to reset the canvas.
This makes all data currently stored by the bot invalid.
**The bot will not automatically invalidate this data.**
*You must do so manually.*
The easiest way to do this is to simply replace the current `persistent.json` file with one containing the empty object: `{}`.