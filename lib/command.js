class Command {
	constructor(r, guard, exec) {
		this.regex = r;
		this.allow = guard;
		this.exec = exec;
	}

	async run(m) {
		if(!this.allow(m)) return false;
		const matched = this.regex.exec(m.content);
		if(matched) await this.exec(matched, m);
		else return false;
		return true;
	}
}

module.exports = {
	Command
};
