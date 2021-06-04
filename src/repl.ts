import * as repl from "repl";
import * as fs from "fs";
import * as path from "path";
import { inspect } from "util";

import * as chalk from "chalk";

import * as EventEmitter from "events";

declare interface Repl {
	on(event: "setupContext", callback: (context: Record<any, any>) => void): this;
	on(event: "exit", callback: () => void): boolean;

	emit(event: "setupContext", context: Record<any, any>): boolean;
	emit(event: "exit"): boolean;
}

// /u009b indicates a control sequence ("\u001b[" would be equivalent)
const CSI = "\u009b";
// J is the control sequence for "erase display" — from cursor to end by default.
const DISPLAY_RESET = `${CSI}J`;
// A is the control sequence for "move cursor up". 
// The number preceding is the number of rows.
const MOVE_UP = (rows: number) => (!isNaN(rows) && rows > 0)
	? `${CSI}${rows}A`
	: "";

class Repl extends EventEmitter implements Repl {
	private readonly server: repl.REPLServer;
	// TODO: actually use this for something
	readonly loglevel: number;

	private static readonly prompt = "> ";
	private static readonly in = process.stdin;
	private static readonly out = process.stdout;

	constructor(loglevel: number) {
		super();
		this.server = repl.start({
			"prompt": Repl.prompt,
			"input": Repl.in,
			"output": Repl.out,
			// This clears the current line first.
			// This is because if we call output from the REPL itself,
			// the current line will contain the prompt text.
			"writer": (output) => `\r${DISPLAY_RESET}${inspect(output, { "colors": true })}`,
		});

		this.loglevel = loglevel;

		this.server.on("reset", context => this.emit("setupContext", context));
		this.server.on("exit", () => this.emit("exit"));
		this.on("setupContext", context => this.setupContext(context));

		// If we call this now, the caller won't get this instance back to setup
		// listeners. This is why it's in setImmediate.
		setImmediate(() => this.emit("setupContext", this.server.context));
	}

	async setupHistory() {
		const historyPath = path.resolve(__dirname, "..", ".node_repl_history");

		await new Promise((a, r) => this.server.setupHistory(historyPath, (e, _) => e ? r(e) : a(_)));
	}

	private setupContext(context: Record<any, any>) {
		context.chalk = chalk;
		context.repl = this;
		context.console = console;
	}

	output(string: string, color: (string: string) => string = _ => _) {
		const prompt = `${Repl.prompt}${this.server.line}`;
		const promptLines = Math.floor(prompt.length / Repl.out.columns);

		const output = `${color(string)}\n`;
		
		// deletes the prompt
		this.server.output.write(`\r${MOVE_UP(promptLines)}${DISPLAY_RESET}`);
		// writes out desired output
		this.server.output.write(output);
		// inserts enough space for the prompt again
		this.server.output.write(new Array(promptLines).fill("\n").join(""));

		this.server.displayPrompt(true);
	}
}

export default Repl;
