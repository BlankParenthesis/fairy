const repl = require("repl");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

const EventEmitter = require("events");


module.exports = class Repl extends EventEmitter {
	constructor(loglevel) {
		super();
		this._server = repl.start();

		this.loglevel = loglevel;

		const historyPath = path.resolve(__dirname, "..", ".node_repl_history");

		this.context.chalk = chalk;
		this.context.repl = this;

		this.context.console = console;

		fs.appendFileSync(historyPath, "");
		fs.readFileSync(historyPath).toString()
			.split("\n").reverse()
			.filter(line => line.trim())
			.map(line => this._server.history.push(line));

		this._server.on("exit", () => {
			fs.appendFileSync(historyPath, `${this._server.lines.join("\n")}\n`);
			this.emit("exit");
		});
	}

	/* eslint-disable no-underscore-dangle */
	output(string, c) {
		const color = c || (x => x);
		const lines = Math.floor((repl._prompt + this._server.line).length / this._server.output.columns);

		for(let i = 0; i < lines; i++) {
			this._server.output.write("\r\u001b[K\u001b[1A");
		}
		this._server.output.write(color(`\r\u001b[K${string}\n`));
		this._server.output.write(`${this._server._prompt}${this._server.line}`);

		//set the cursor to the correct position since the display has moved it to the end but internally it doesn't move
		/* eslint-disable-next-line no-self-assign */
		this._server.cursor = this._server.cursor;
	}
	/* eslint-enable no-underscore-dangle */

	get context() {
		return this._server.context;
	}
};
