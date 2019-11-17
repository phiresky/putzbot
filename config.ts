import localConfig from "./config.local"

const config = {
	botToken: null as string | null,
	chatId: "-XXXXXXX",

	tasks: [{ name: "Küche", schedule: "weekly", phase: 1 }],
	schedules: [
		{
			name: "weekly",
			start: "2019-11-03T23:59:59+01:00",
			timezone: "Europe/Berlin",
			interval: "P1W",
			reminders: ["PT12H", "PT4H"],
		},
	],
	people: [{ name: "Peter", id: "1XXXXXXX" }],
}
export type Config = typeof config

export default { ...config, ...localConfig }
