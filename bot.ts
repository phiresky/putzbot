import {
	DateTimeFormatter,
	Duration,
	Period,
	ZonedDateTime,
	ZoneId,
} from "@js-joda/core"
import "@js-joda/timezone"
import TimeAgo from "javascript-time-ago"
import "javascript-time-ago/load-all-locales"
import * as sugar from "sugar"
import Telegraf, { ContextMessageUpdate } from "telegraf"
import config from "./config"
const t = new TimeAgo()
function getAssignee<T>(index: number, phase: number, humans: T[]): T {
	return humans[(index + phase) % humans.length]
}

function parseDuration(d: string) {
	// hacky, but js-joda is incomplete apparently (ignores time in periods)
	try {
		return Period.parse(d)
	} catch (e) {
		return Duration.parse(d)
	}
}
function load() {
	const schedules = config.schedules.map(p => {
		const zdt = ZonedDateTime.parse(p.start)
		const start = zdt.withZoneSameLocal(ZoneId.of(p.timezone))
		const dt2 = zdt.withZoneSameInstant(ZoneId.of(p.timezone))
		if (!start.isEqual(dt2)) {
			throw Error("mismatch between timezone and date")
		}
		const interval = parseDuration(p.interval)
		const reminders = p.reminders.map(r => parseDuration(r))
		return { ...p, interval, start, reminders }
	})
	const tasks = config.tasks.map(p => {
		const schedule = schedules.find(s => s.name === p.schedule)
		if (!schedule) throw Error(`could not find schedule ${p.schedule}`)
		return { ...p, schedule }
	})
	return tasks
}
type Bot = Telegraf<ContextMessageUpdate>
type Task = ReturnType<typeof load>[0]

function getNext(
	task: Task,
	filter: (task: Task, date: ZonedDateTime) => boolean,
) {
	let printed = 0
	let index = 0
	let next = task.schedule.start
	while (printed < 1 && index < 1e5) {
		if (filter(task, next)) {
			return {
				date: next,
				task,
				assignee: getAssignee(index, task.phase, config.people),
			}
			printed++
		}
		index++
		next = next.plusTemporalAmount(task.schedule.interval)
	}
	throw Error("did not find")
}
type TaskInstance = ReturnType<typeof getNext>

function nameLink(u: { id: string; name: string }) {
	return `<a href="tg://user?id=${u.id}">${u.name}</a>`
}

function scheduleNextReminders(bot: Bot, task: Task, previous: ZonedDateTime) {
	const next = getNext(task, (_, d) => d.isAfter(previous))
	console.log("scheduleNext", task.name, previous.toString())
	console.log("next:", next.assignee.name, task.name, next.date.toString())
	const now = ZonedDateTime.now()
	for (const reminder of task.schedule.reminders) {
		const reminderDate = next.date.minusTemporalAmount(reminder)
		if (reminderDate.isAfter(now)) {
			console.log("scheduling reminder at", reminderDate.toString())
			setTimeout(
				() => remind(bot, next),
				Duration.between(now, reminderDate).toMillis(),
			)
		}
	}
	setTimeout(
		() => scheduleNextReminders(bot, task, next.date),
		Duration.between(now, next.date).toMillis(),
	)
}
function remind(bot: Bot, n: TaskInstance) {
	const u = n.assignee
	bot.telegram.sendMessage(
		config.chatId,
		`${nameLink(u)}, please clean "${n.task.name}" in the next ${t.format(
			n.date.toEpochSecond() * 1000,
			"time",
		)}`,
		{ parse_mode: "HTML" },
	)
}
function printNextTasks(bot: Bot, tasks: Task[], from = ZonedDateTime.now()) {
	const nexts = tasks.map(t => getNext(t, (_, d) => d.isAfter(from)))
	bot.telegram.sendMessage(
		config.chatId,
		`Next tasks:\n${nexts
			.map(
				n =>
					`${n.date.format(
						DateTimeFormatter.ofPattern("dd.MM."),
					)}: ${nameLink(n.assignee)}: ${n.task.name}`,
			)
			.join("\n")}`,
		{ parse_mode: "HTML" },
	)
}
function init() {
	const tasks = load()
	const bot = new Telegraf(config.botToken!)

	bot.start(ctx => ctx.reply("hello"))
	bot.use((ctx, next) => {
		if (ctx.chat && String(ctx.chat.id) === config.chatId) next?.()
		else console.log("unauthorized", ctx.chat, ctx.from, ctx.message)
	})
	bot.command("help", ctx => ctx.reply("/next\n/me\n/tasks in one week"))
	bot.command("done", ctx => ctx.reply("thx for donee"))
	bot.command("next", ctx => printNextTasks(bot, tasks))
	bot.command("me", ctx => {
		const nexts = tasks.map(t =>
			getNext(t, (_, d) => d.isAfter(ZonedDateTime.now())),
		)
		const u = config.people.find(i => i.id === String(ctx.from!.id))
		if (!u) {
			ctx.reply("user not found")
			return
		}

		const n = nexts.find(n => n.assignee === u)!
		if (!n) {
			ctx.reply("no next task found!")
			return
		}
		remind(bot, n)
	})
	bot.command("tasks", ctx => {
		if (!ctx.message?.text) return
		const parts = /^\/([^@\s]+)@?(?:(\S+)|)\s?([\s\S]+)?$/i.exec(
			ctx.message.text.trim(),
		)
		if (!parts) return
		const [_, _command, _bot, args] = parts
		const date = sugar.Date.create(args)
		if (Number.isNaN(date.getTime())) {
			ctx.reply(`Did not understand date __${args}__`, {
				parse_mode: "Markdown",
			})
			return
		}
		const date2 = ZonedDateTime.parse(date.toISOString())
		printNextTasks(bot, tasks, date2)
	})
	bot.launch()
	for (const task of tasks) {
		scheduleNextReminders(bot, task, ZonedDateTime.now())
	}
}

init()
