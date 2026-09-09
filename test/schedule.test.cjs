/**
 * Schedule logic tests for dsh-deepseek-peak-indicator.
 * Run with: node test/schedule.test.cjs   (or `npm test`)
 *
 * The helpers below mirror lib/client.js (the bundle inlines them; keeping a
 * copy here lets the math be tested without a browser).
 */
"use strict";

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const PEAK_HOURS_BEIJING = new Set([9, 10, 11, 14, 15, 16, 17]);
const BOUNDARY_HOURS_BEIJING = [9, 12, 14, 18];

function beijingWall(date) {
	return new Date(date.getTime() + BEIJING_OFFSET_MS);
}

/** Whether the given instant falls inside official peak hours. */
function isPeakAt(date) {
	const wall = beijingWall(date);
	const day = wall.getUTCDay(); // 0 = Sunday … 6 = Saturday (Beijing day)
	if (day === 0 || day === 6) return false; // weekends are off-peak all day
	return PEAK_HOURS_BEIJING.has(wall.getUTCHours());
}

/** The next weekday window boundary strictly after `date`. */
function nextBoundary(date) {
	const now = date.getTime();
	const wall = beijingWall(date);
	for (let d = 0; d < 5; d++) {
		const day = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + d));
		const dow = day.getUTCDay();
		if (dow < 1 || dow > 5) continue;
		for (const hour of BOUNDARY_HOURS_BEIJING) {
			const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour) - BEIJING_OFFSET_MS);
			if (candidate.getTime() > now) return candidate;
		}
	}
	return null;
}

/** The most recent window boundary strictly before `date`. */
function previousBoundary(date) {
	const now = date.getTime();
	const wall = beijingWall(date);
	for (let d = 0; d < 8; d++) {
		const day = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - d));
		const dow = day.getUTCDay();
		if (dow < 1 || dow > 5) continue;
		for (let i = BOUNDARY_HOURS_BEIJING.length - 1; i >= 0; i--) {
			const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), BOUNDARY_HOURS_BEIJING[i]) - BEIJING_OFFSET_MS);
			if (candidate.getTime() < now) return candidate;
		}
	}
	return null;
}

function formatCountdown(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (n) => String(n).padStart(2, "0");
	const hms = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
	return days > 0 ? `${days}d ${hms}` : hms;
}

function formatElapsed(ms) {
	const total = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const parts = [];
	if (days > 0) parts.push(`${days} d`);
	if (hours > 0) parts.push(`${hours} h`);
	parts.push(`${minutes} min`);
	return parts.join(" ");
}

function untilShort(ms) {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) return "<1 min";
	const minutes = Math.round(totalSeconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (hours < 24) return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
	const days = Math.floor(hours / 24);
	const hr = hours % 24;
	return hr === 0 ? `${days} d` : `${days} d ${hr} h`;
}

/** Local-day segments: [{ startHour, endHour, peak }] spanning [0, 24]. */
function todaySegments(now) {
	const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const segments = [];
	let current = null;
	for (let h = 0; h < 24; h++) {
		const peak = isPeakAt(new Date(dayStart.getTime() + h * 3600 * 1000));
		if (current !== null && current.peak === peak) {
			current.endHour = h + 1;
		} else {
			if (current !== null) segments.push(current);
			current = { startHour: h, endHour: h + 1, peak };
		}
	}
	if (current !== null) segments.push(current);
	return segments;
}

// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function check(label, got, want) {
	const g = JSON.stringify(got);
	const w = JSON.stringify(want);
	if (g === w) {
		passed++;
		console.log("PASS " + label);
	} else {
		failed++;
		console.log("FAIL " + label + "\n  got:  " + g + "\n  want: " + w);
	}
}

// --- Beijing-time day basis (official notice effective 2026-08-23) ---------
check("UTC Fri 16:00 (=BJ Sat 00:00) off-peak", isPeakAt(new Date("2026-08-21T16:00:00Z")), false);
check("UTC Sat 16:00 (=BJ Sun 00:00) off-peak", isPeakAt(new Date("2026-08-22T16:00:00Z")), false);
check("UTC Sun 16:00 (=BJ Mon 00:00) off-peak", isPeakAt(new Date("2026-08-23T16:00:00Z")), false);
check("UTC Mon 01:00 (=BJ 09:00) peak", isPeakAt(new Date("2026-08-24T01:00:00Z")), true);
check("UTC Mon 03:59 peak", isPeakAt(new Date("2026-08-24T03:59:59Z")), true);
check("UTC Mon 04:00 (=BJ 12:00) off-peak", isPeakAt(new Date("2026-08-24T04:00:00Z")), false);
check("UTC Mon 06:00 (=BJ 14:00) peak", isPeakAt(new Date("2026-08-24T06:00:00Z")), true);
check("UTC Mon 09:59 peak", isPeakAt(new Date("2026-08-24T09:59:59Z")), true);
check("UTC Mon 10:00 (=BJ 18:00) off-peak", isPeakAt(new Date("2026-08-24T10:00:00Z")), false);
check("UTC Sun 08:00 (BJ Sun) off-peak", isPeakAt(new Date("2026-08-23T08:00:00Z")), false);

// --- boundaries ------------------------------------------------------------
check("next after Mon 02:00 UTC", nextBoundary(new Date("2026-08-24T02:00:00Z")).toISOString(), "2026-08-24T04:00:00.000Z");
check("next after Fri 10:00 UTC (weekend ahead)", nextBoundary(new Date("2026-08-28T10:00:00Z")).toISOString(), "2026-08-31T01:00:00.000Z");
check("prev before Mon 00:30 UTC", previousBoundary(new Date("2026-08-24T00:30:00Z")).toISOString(), "2026-08-21T10:00:00.000Z");
check("prev before Sat 15:00 UTC", previousBoundary(new Date("2026-08-22T15:00:00Z")).toISOString(), "2026-08-21T10:00:00.000Z");

// --- formatting ------------------------------------------------------------
check("countdown 2h14m33s", formatCountdown(2 * 3600e3 + 14 * 60e3 + 33e3), "02:14:33");
check("countdown 63h (weekend)", formatCountdown(63 * 3600e3 + 5 * 60e3), "2d 15:05:00");
check("elapsed 2h14m", formatElapsed(2 * 3600e3 + 14 * 60e3), "2 h 14 min");
check("elapsed 63h5m", formatElapsed(63 * 3600e3 + 5 * 60e3), "2 d 15 h 5 min");
check("until 9.5min", untilShort(9 * 60e3 + 30e3), "10 min");
check("until 2h5m", untilShort((2 * 60 + 5) * 60e3), "2 h 5 min");
check("until 30s", untilShort(30e3), "<1 min");

// --- local-day segments (timezone-dependent) --------------------------------
// Defaults to the machine's local timezone; also run with TZ=UTC /
// TZ=Asia/Shanghai for the full matrix (see package.json test scripts).
const tz = process.env.TZ || "(system)";
if (tz === "Asia/Shanghai") {
	check("BJ Mon segments", todaySegments(new Date(2026, 7, 24)), [
		{ startHour: 0, endHour: 9, peak: false },
		{ startHour: 9, endHour: 12, peak: true },
		{ startHour: 12, endHour: 14, peak: false },
		{ startHour: 14, endHour: 18, peak: true },
		{ startHour: 18, endHour: 24, peak: false },
	]);
	check("BJ Sun segments (all green)", todaySegments(new Date(2026, 7, 23)), [
		{ startHour: 0, endHour: 24, peak: false },
	]);
} else if (tz === "UTC") {
	check("UTC Mon segments", todaySegments(new Date(Date.UTC(2026, 7, 24))), [
		{ startHour: 0, endHour: 1, peak: false },
		{ startHour: 1, endHour: 4, peak: true },
		{ startHour: 4, endHour: 6, peak: false },
		{ startHour: 6, endHour: 10, peak: true },
		{ startHour: 10, endHour: 24, peak: false },
	]);
}

// --- token rates -----------------------------------------------------------
const USD_PER_YUAN = 7.0;
const RATES_YUAN = {
	cacheHit: { off: 0.02, peak: 0.04 },
	input: { off: 1, peak: 2 },
	output: { off: 4, peak: 8 },
};

function formatAmount(value, decimals) {
	return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function ratePair(usd) {
	const pick = (row) => {
		const y = RATES_YUAN[row.key];
		if (!usd) return { off: y.off, peak: y.peak, dec: 2 };
		return { off: y.off / USD_PER_YUAN, peak: y.peak / USD_PER_YUAN, dec: 3 };
	};
	return Object.entries(RATES_YUAN).map(([key, y]) => ({ key, ...pick({ key, ...y }) }));
}

check("CNY format 0.02", formatAmount(0.02, 2), "0.02");
check("CNY format 1", formatAmount(1, 2), "1");
check("CNY format 4", formatAmount(4, 2), "4");
check("CNY peak = 2x cache-hit", ratePair(false)[0].peak, 0.04);
check("CNY output off", ratePair(false)[2].off, 4);
check("USD cache-hit off derived", formatAmount(ratePair(true)[0].off, 3), "0.003");
check("USD input off derived", formatAmount(ratePair(true)[1].off, 3), "0.143");
check("USD output off derived", formatAmount(ratePair(true)[2].off, 3), "0.571");


console.log(`\n${passed} passed, ${failed} failed (TZ=${tz})`);
process.exit(failed === 0 ? 0 : 1);
