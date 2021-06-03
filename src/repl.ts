import * as repl from "repl";
import * as fs from "fs";
import * as path from "path";
import * as chalk from "chalk";

import * as EventEmitter from "events";

export default class Repl extends EventEmitter {
	private readonly server: repl.REPLServer;
	readonly loglevel: number;

	constructor(loglevel: number) {
		super();
		this.server = repl.start();

		this.loglevel = loglevel;

		const historyPath = path.resolve(__dirname, "..", ".node_repl_history");

		this.context.chalk = chalk;
		this.context.repl = this;

		this.context.console = console;

		// TODO: use server.setupHistory
		fs.appendFileSync(historyPath, "");
		fs.readFileSync(historyPath).toString()
			.split("\n").reverse()
			.filter(line => line.trim())
			/* @ts-ignore */
			.map(line => this.server.history.push(line));

		this.server.on("exit", () => {
			/* @ts-ignore */
			fs.appendFileSync(historyPath, `${this.server.lines.join("\n")}\n`);
			this.emit("exit");
		});
	}

	// TODO: this function is a mess — it uses a ton of private things
	// and I'm pretty sure most of it doesn't work anymore: clean it up.
	/* eslint-disable no-underscore-dangle */
	output(string: string, color: (string: string) => string = _ => _) {
		/* @ts-ignore */
		const lines = Math.floor((repl._prompt + this.server.line).length / this.server.output.columns);
		
		for(let i = 0; i < lines; i++) {
			this.server.output.write("\r\u001b[K\u001b[1A");
		}
		this.server.output.write(color(`\r\u001b[K${string}\n`));
		/* @ts-ignore */
		this.server.output.write(`${this.server._prompt}${this.server.line}`);
		
		//set the cursor to the correct position since the display has moved it to the end but internally it doesn't move
		/* eslint-disable-next-line no-self-assign */ /* @ts-ignore */
		this.server.cursor = this.server.cursor;
	}
	/* eslint-enable no-underscore-dangle */

	get context() {
		return this.server.context;
	}
}
