import { MessageEmbed, Message, Snowflake } from "discord.js";

import { SavedTrackedTemplate, TrackableTemplate, TrackedTemplate } from "./template";
import { SaveableAs } from "./util";

export interface Summarizable {
	name: string;
	summary: string;
}

export default class Summary {
	constructor(
		private fields: Summarizable[],
		readonly message: Message,
	) {}

	embed(final = false) {
		const embedObject = new MessageEmbed();

		embedObject.setTitle("Template progress");
		embedObject.setDescription("");
		embedObject.setColor([179, 0, 0]); // Kaide`'s Reimu color ⛩
		embedObject.setTimestamp();
		if(!final) {
			embedObject.setFooter("updated every minute");
		}

		// TODO: ensure list stays within Discord's embed count limit
		for(const field of this.fields) {
			embedObject.addField(field.name, field.summary, true);
		}

		return embedObject;
	}

	get id() {
		return this.message.id;
	}

	get size() {
		return this.fields.length;
	}

	async update(final = false) {
		await this.message.edit({ 
			"embeds": [this.embed(final)],
		});
	}

	async modify(fields: Summarizable[]) {
		this.fields = fields;

		await this.update();
	}

	async finalize() {
		await this.update(true);
	}

	toJSON(): SaveableAs<SavedSummary> {
		return {
			"channel": this.message.channel.id,
			"message": this.message.id,
			"fields": this.fields.map(f => f as TrackedTemplate),
		};
	}

	displays(template: TrackableTemplate) {
		return this.fields.some(field => {
			if(field instanceof TrackedTemplate) {
				return field.template.equals(template);
			} else {
				return false;
			}
		});
	}
}

export interface SavedSummary {
	channel: Snowflake;
	message: Snowflake;
	fields: SavedTrackedTemplate[];
}
