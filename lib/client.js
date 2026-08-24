/**
 * dsh-deepseek-peak-indicator — browser half.
 *
 * Renders a small green/red status dot in the composer tool row, immediately
 * LEFT of the model-select menu (`conversation.input.model` seat):
 * ConversationRoot renders `conversation.input.right` entries just before the
 * model seat in the trailing flex row, so this occupant sits exactly where
 * requested.
 *
 *   green = DeepSeek API off-peak   red = DeepSeek API peak time
 *
 * Clicking the dot opens a dashboard widget anchored to it by a caret: mode
 * pill, live countdown of time left, a 24-hour day track with a "now" marker,
 * stat tiles, and a compact schedule footnote. Presentation follows one type
 * scale and one 16px grid; motion respects prefers-reduced-motion.
 *
 * The tier follows the official schedule
 * (https://api-docs.deepseek.com/quick_start/pricing, plus the peak/off-peak
 * billing notice effective 2026-08-23): peak hours are 09:00–12:00 and
 * 14:00–18:00 Beijing time (01:00–04:00 and 06:00–10:00 UTC), Monday through
 * Friday in Beijing time; weekends (Saturday and Sunday, Beijing time) are
 * off-peak all day. The day-of-week check is evaluated on the Beijing wall
 * clock. The indicator is computed from the local clock, so it works offline
 * and flips at the exact boundary.
 *
 * Bundle format: this file is served raw by the client-modules host at
 * /plugins/dsh-deepseek-peak-indicator/client.js and executed as a classic
 * script, so it must register itself through window.__ModuleLoader__.load()
 * and export the client-plugin face ({ apply, inject }), like every shipped
 * client bundle.
 */
window.__ModuleLoader__.load({
	id: "dsh-deepseek-peak-indicator",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// --- DeepSeek API peak/off-peak schedule -------------------------
		// Official (https://api-docs.deepseek.com/quick_start/pricing, plus the
		// peak/off-peak billing notice effective 2026-08-23): peak hours are
		// 09:00–12:00 and 14:00–18:00 Beijing time (01–04 & 06–10 UTC), Monday
		// through Friday in Beijing time; weekends (Saturday & Sunday, Beijing
		// time) are off-peak all day.
		//
		// The rule is evaluated on the Beijing wall clock: shift the instant by
		// +8h, then read UTC day/hour fields off the shifted Date. (Equivalent
		// to a raw-UTC rule today because the windows never straddle a UTC day
		// boundary, but stays correct if the windows ever change shape.)
		const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
		const PEAK_HOURS_BEIJING = new Set([9, 10, 11, 14, 15, 16, 17]);
		const BOUNDARY_HOURS_BEIJING = [9, 12, 14, 18];

		/** `date` shifted into Beijing wall-clock time (UTC getters read Beijing fields). */
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

		/** The next weekday window boundary strictly after `date` — exactly the
		 * instant the current tier flips. */
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

		/** The most recent window boundary strictly before `date` — the instant
		 * the current mode started (used for "in this mode"). */
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

		// --- formatting ---------------------------------------------------
		/** "12:24 PM"-style local time. */
		function formatLocal(date) {
			return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		}

		/** "Mon, Aug 24"-style local date. */
		function formatDayShort(date) {
			return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
		}

		/** HH:MM:SS countdown; "Nd HH:MM:SS" when 24h or more. */
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

		/** "2 d 3 h 14 min"-style duration. */
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

		/** "14 h 36 min"-style remaining time (no leading "in"). */
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

		/** "09"-style hour label. */
		function padHour(hour) {
			return String(hour).padStart(2, "0");
		}

		/** Merge the local 24h day into same-tier hour segments: each local hour
		 * is tiered by the schedule in effect at its start, adjacent same-tier
		 * hours merge. Returns [{ startHour, endHour, peak }] spanning [0, 24]. */
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

		/** One seamless linear-gradient for the 24h track: hard color stops at
		 * every window boundary. Colors come from theme-aware CSS variables so
		 * the track mutes appropriately in dark mode. */
		function trackGradient(segments) {
			const stops = [];
			let acc = 0;
			for (const s of segments) {
				const width = ((s.endHour - s.startHour) / 24) * 100;
				const color = s.peak
					? "var(--dpk-track-peak, var(--dsw-alias-state-error-primary, #ef4444))"
					: "var(--dpk-track-offpeak, var(--dsw-alias-state-success-primary, #22c55e))";
				stops.push(`${color} ${acc}%`, `${color} ${acc + width}%`);
				acc += width;
			}
			return `linear-gradient(90deg, ${stops.join(", ")})`;
		}

		// --- styles -------------------------------------------------------
		// One scoped stylesheet (class prefix `dpk-`), injected on activation
		// and removed on unload. Single type scale + single 16px gutter; the
		// mode tint / track colors are CSS variables so dark mode can mute them.
		const STYLE_ID = "dsh-deepseek-peak-indicator";
		const STYLES = [
			".dpk-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;flex:none;padding:0;margin:0;border:none;border-radius:6px;background:transparent;cursor:pointer;transition:background-color 140ms ease-out,box-shadow 140ms ease-out,transform 140ms ease-out}",
			".dpk-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}",
			".dpk-btn:active{transform:scale(.88)}",
			".dpk-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}",
			".dpk-dot{display:block;width:8px;height:8px;border-radius:50%;transition:box-shadow 140ms ease-out}",
			".dpk-dot-peak{background:var(--dsw-alias-state-error-primary,#ef4444);box-shadow:0 0 0 3px rgba(239,68,68,.16)}",
			".dpk-dot-offpeak{background:var(--dsw-alias-state-success-primary,#22c55e);box-shadow:0 0 0 3px rgba(34,197,94,.16)}",
			".dpk-btn:hover .dpk-dot-peak{box-shadow:0 0 0 5px rgba(239,68,68,.22)}",
			".dpk-btn:hover .dpk-dot-offpeak{box-shadow:0 0 0 5px rgba(34,197,94,.22)}",
			// Panel: rounded widget; mode tint as a CSS variable so the caret and
			// wash share one color, and the track can mute in dark mode.
			".dpk-panel{position:fixed;width:300px;max-width:calc(100vw - 16px);box-sizing:border-box;z-index:1000;border-radius:18px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-shadow-lv3,0 16px 40px rgba(0,0,0,.22));outline:none;display:flex;flex-direction:column;font:var(--dsw-font-xs-13,13px/1.5 system-ui,sans-serif);transition:background-color 200ms ease-out;--dpk-tint:var(--dsw-alias-state-success-primary,#22c55e);--dpk-track-peak:var(--dsw-alias-state-error-primary,#ef4444);--dpk-track-offpeak:var(--dsw-alias-state-success-primary,#22c55e);--dpk-panel-bg:color-mix(in srgb,var(--dpk-tint) 5%,var(--dsw-alias-bg-layer-2,#fff));background:var(--dpk-panel-bg)}",
			".dpk-panel.dpk-peak{--dpk-tint:var(--dsw-alias-state-error-primary,#ef4444)}",
			"body[data-ds-dark-theme] .dpk-panel{--dpk-track-peak:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 72%,var(--dsw-alias-bg-layer-2,#000));--dpk-track-offpeak:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 72%,var(--dsw-alias-bg-layer-2,#000));--dpk-panel-bg:color-mix(in srgb,var(--dpk-tint) 6%,var(--dsw-alias-bg-layer-2,#000))}",
			// Subtle inset hairline accent that follows the rounded corners.
			".dpk-panel:before{content:\"\";position:absolute;top:0;left:10px;right:10px;height:2px;border-radius:0 0 2px 2px;background:linear-gradient(90deg,var(--dpk-tint),color-mix(in srgb,var(--dpk-tint) 45%,transparent));opacity:.55;pointer-events:none;z-index:1}",
			// Caret pointing down at the dot.
			".dpk-caret{position:absolute;bottom:-7px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:7px solid var(--dpk-panel-bg);transform:translateX(-50%);filter:drop-shadow(0 1px 1px rgba(0,0,0,.05));z-index:0}",
			"@media (prefers-reduced-motion:no-preference){.dpk-panel{animation:dpk-in 160ms cubic-bezier(.2,.8,.2,1)}}",
			"@keyframes dpk-in{from{opacity:0;transform:translateY(8px) scale(.98);filter:blur(4px)}}",
			".dpk-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px 0}",
			".dpk-eyebrow{color:var(--dsw-alias-label-secondary,#555);font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dpk-datetime{color:var(--dsw-alias-label-tertiary,#777);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;white-space:nowrap}",
			".dpk-close{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;flex:none;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,#777);font-size:14px;line-height:1;cursor:pointer;transition:background-color 120ms ease-out,color 120ms ease-out}",
			".dpk-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}",
			".dpk-close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}",
			".dpk-status{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 16px 0}",
			".dpk-pill{display:inline-flex;align-items:center;gap:7px;padding:3px 10px;border-radius:999px;font-size:11px;line-height:16px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}",
			".dpk-peak .dpk-pill{color:var(--dsw-alias-state-error-primary,#ef4444);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 12%,transparent)}",
			".dpk-offpeak .dpk-pill{color:var(--dsw-alias-state-success-primary,#22c55e);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 12%,transparent)}",
			// Light theme: the vivid status hues fail contrast on pale tints —
			// deepen the text color only where the dark-theme attribute is absent.
			"body:not([data-ds-dark-theme]) .dpk-peak .dpk-pill{color:#b91c1c}",
			"body:not([data-ds-dark-theme]) .dpk-offpeak .dpk-pill{color:#15803d}",
			".dpk-pill-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}",
			"@media (prefers-reduced-motion:no-preference){.dpk-pill{animation:dpk-pill-in 260ms cubic-bezier(.2,.8,.2,1)}}",
			"@keyframes dpk-pill-in{0%{transform:scale(.88)}60%{transform:scale(1.06)}100%{transform:scale(1)}}",
			".dpk-hero{padding:12px 16px 0}",
			".dpk-hero-card{display:flex;flex-direction:column;gap:2px;background:var(--dsw-alias-bg-layer-1,#f8f8f8);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.05));border-radius:12px;padding:9px 12px}",
			".dpk-hero-label{color:var(--dsw-alias-label-secondary,#555);font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:.1em}",
			".dpk-hero-numeral{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;line-height:38px;font-weight:300;font-variant-numeric:tabular-nums;letter-spacing:-.02em}",
			".dpk-hero-caption{color:var(--dsw-alias-label-secondary,#555);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}",
			".dpk-hero-urgent .dpk-hero-numeral{color:var(--dsw-alias-state-warn-primary,#f59e0b)}",
			"@media (prefers-reduced-motion:no-preference){.dpk-hero-urgent .dpk-hero-numeral{animation:dpk-urgent 1s ease-in-out infinite}}",
			"@keyframes dpk-urgent{0%,100%{opacity:1}50%{opacity:.55}}",
			".dpk-day{padding:12px 16px 0;display:flex;flex-direction:column}",
			".dpk-day-stage{position:relative;padding-top:8px}",
			".dpk-day-track{position:relative;height:16px;border-radius:999px;overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.22)}",
			".dpk-day-marker{position:absolute;top:0;bottom:0;z-index:2;transition:left 320ms ease-out}",
			".dpk-day-pip{position:absolute;top:0;left:-5px;width:10px;height:10px;box-sizing:border-box;border-radius:50%;background:var(--dsw-alias-label-primary,#111);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}",
			".dpk-day-line{position:absolute;top:9px;height:13px;left:-1px;width:2px;border-radius:1px;background:var(--dsw-alias-label-primary,#111);opacity:.9}",
			".dpk-day-ticks{position:relative;height:12px;margin:3px 0 0}",
			".dpk-tick{position:absolute;top:0;font-size:10px;line-height:12px;color:var(--dsw-alias-label-tertiary,#777);font-variant-numeric:tabular-nums;transform:translateX(-50%)}",
			".dpk-tick-first{transform:none}",
			".dpk-tick-last{transform:translateX(-100%)}",
			".dpk-summary{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#555);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dpk-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:11px 16px 0}",
			".dpk-tile{position:relative;display:flex;flex-direction:column;gap:1px;min-width:0;padding:8px 10px 8px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));background:var(--dsw-alias-bg-layer-1,#f8f8f8)}",
			".dpk-tile:before{content:\"\";position:absolute;left:6px;top:8px;bottom:8px;width:2px;border-radius:1px;background:color-mix(in srgb,var(--dpk-tint) 35%,transparent)}",
			".dpk-tile-label{color:var(--dsw-alias-label-secondary,#555);font-size:10px;line-height:14px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dpk-tile-value{color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:18px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dpk-tile-sub{color:var(--dsw-alias-label-secondary,#555);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".dpk-foot{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));margin-top:10px;padding:8px 16px 10px;display:flex;flex-direction:column;gap:1px;color:var(--dsw-alias-label-secondary,#555);font-size:10.5px;line-height:15px}",
			"@media (prefers-reduced-motion:reduce){.dpk-panel{transition:none;animation:none}.dpk-day-marker{transition:none}.dpk-pill{animation:none}.dpk-hero-urgent .dpk-hero-numeral{animation:none}}"
		].join("\n");

		/** Inject the scoped stylesheet once; returns a disposer. */
		function injectStyles() {
			const existing = document.querySelector(`style[data-dpk="${STYLE_ID}"]`);
			if (existing !== null) return () => {};
			const tag = document.createElement("style");
			tag.dataset.dpk = STYLE_ID;
			tag.textContent = STYLES;
			document.head.appendChild(tag);
			return () => tag.remove();
		}

		// --- the panel ----------------------------------------------------
		const PANEL_WIDTH = 300;

		/** Position plus the caret x measured against the panel. */
		function panelStyle(rect) {
			const spaceAbove = rect.top;
			const spaceBelow = typeof window !== "undefined" ? window.innerHeight - rect.bottom : 0;
			const above = spaceAbove > 260 || spaceBelow <= 260;
			const rightOffset = Math.max(8, window.innerWidth - rect.right);
			const panelLeft = window.innerWidth - rightOffset - PANEL_WIDTH;
			const caretLeft = rect.left + rect.width / 2 - panelLeft;
			return {
				right: rightOffset,
				...(above ? { bottom: window.innerHeight - rect.top + 10 } : { top: rect.bottom + 10 }),
				caretLeft: Math.min(PANEL_WIDTH - 14, Math.max(14, caretLeft))
			};
		}

		/** The 24h day track: seamless red/green gradient + now marker + ticks. */
		function DayBar({ now }) {
			const segments = todaySegments(now);
			const markerPct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
			const peakWindows = segments
				.filter((s) => s.peak)
				.map((s) => `${padHour(s.startHour)}:00–${padHour(s.endHour)}:00`);
			const summary = peakWindows.length === 0
				? "No peak hours today (weekend)"
				: `Peak today: ${peakWindows.join(" · ")}`;
			const ticks = ["00", "06", "12", "18", "24"];
			const tickPct = [0, 25, 50, 75, 100];
			return react.createElement("div", {
				"data-deepseek-daybar": true,
				role: "img",
				"aria-label": `${summary}. Now ${formatLocal(now)}.`,
				className: "dpk-day"
			}, [
				react.createElement("div", { className: "dpk-day-stage" }, [
					react.createElement("div", {
						className: "dpk-day-track",
						"data-deepseek-track": true,
						style: { background: trackGradient(segments) }
					}),
					react.createElement("span", {
						className: "dpk-day-marker",
						"data-deepseek-now-marker": true,
						style: { left: `${markerPct}%` }
					}, [
						react.createElement("span", { className: "dpk-day-pip" }),
						react.createElement("span", { className: "dpk-day-line" })
					])
				]),
				react.createElement("div", { className: "dpk-day-ticks" }, ticks.map((tick, i) => react.createElement("span", {
					key: tick,
					className: `dpk-tick${i === 0 ? " dpk-tick-first" : i === ticks.length - 1 ? " dpk-tick-last" : ""}`,
					style: { left: `${tickPct[i]}%` }
				}, tick))),
				react.createElement("span", { className: "dpk-summary", "data-deepseek-summary": true }, summary)
			]);
		}

		/** Panel body: caret, header, pill, hero countdown, day bar, tiles, footnote. */
		function Dashboard({ peak, now, onClose, caretLeft }) {
			const boundary = nextBoundary(now);
			const started = previousBoundary(now);
			const remaining = boundary === null ? null : boundary.getTime() - now.getTime();
			const elapsed = started === null ? null : now.getTime() - started.getTime();
			const heroCaption = boundary === null
				? "—"
				: `${peak ? "until off-peak" : "until next peak"} · ${formatLocal(boundary)}`;
			const urgent = remaining !== null && remaining < 60_000;
			return [
				react.createElement("div", { key: "caret", className: "dpk-caret", style: { left: caretLeft } }),
				react.createElement("div", { className: "dpk-head", key: "head" }, [
					react.createElement("span", { className: "dpk-eyebrow" }, "DeepSeek · Status"),
					react.createElement("button", {
						type: "button",
						className: "dpk-close",
						"aria-label": "Close",
						onClick: (event) => {
							event.stopPropagation();
							onClose();
						}
					}, "✕")
				]),
				react.createElement("div", { className: "dpk-status", key: "status" }, [
					react.createElement("span", {
						key: peak ? "peak" : "off",
						className: "dpk-pill",
						"data-deepseek-pill": true
					}, [
						react.createElement("span", { className: "dpk-pill-dot" }),
						peak ? "PEAK" : "OFF-PEAK"
					]),
					react.createElement("span", { className: "dpk-datetime" }, `${formatDayShort(now)} · ${formatLocal(now)}`)
				]),
				react.createElement("div", {
					className: urgent ? "dpk-hero dpk-hero-urgent" : "dpk-hero",
					key: "hero"
				}, [
					react.createElement("div", { className: "dpk-hero-card" }, [
						react.createElement("span", { className: "dpk-hero-label" }, "Time remaining"),
						react.createElement("span", { className: "dpk-hero-numeral" }, [
							react.createElement("span", { "data-deepseek-countdown": true }, remaining === null ? "—" : formatCountdown(remaining))
						]),
						react.createElement("span", { className: "dpk-hero-caption" }, heroCaption)
					])
				]),
				react.createElement(DayBar, { now, key: "day" }),
				react.createElement("div", { className: "dpk-meta", key: "meta" }, [
					react.createElement("div", { className: "dpk-tile" }, [
						react.createElement("span", { className: "dpk-tile-label" }, "In this mode"),
						react.createElement("span", { className: "dpk-tile-value" }, elapsed === null ? "—" : formatElapsed(elapsed)),
						react.createElement("span", { className: "dpk-tile-sub" }, started === null ? "" : `since ${formatLocal(started)}`)
					]),
					react.createElement("div", { className: "dpk-tile" }, [
						react.createElement("span", { className: "dpk-tile-label" }, "Next"),
						react.createElement("span", { className: "dpk-tile-value" }, remaining === null ? "—" : untilShort(remaining)),
						react.createElement("span", { className: "dpk-tile-sub" }, boundary === null ? "" : formatLocal(boundary))
					])
				]),
				react.createElement("div", { className: "dpk-foot", key: "foot" }, [
					react.createElement("span", null, "Peak: Mon–Fri 09–12 & 14–18 Beijing"),
					react.createElement("span", null, "Weekends off-peak · UTC 01–04 & 06–10")
				])
			];
		}

		// --- the seat component ------------------------------------------
		/** Refresh cadence while the panel is closed; open ticks every second. */
		const REFRESH_MS = 30_000;
		const TICK_MS = 1_000;

		function PeakIndicator() {
			const [now, setNow] = react.useState(() => new Date());
			const [open, setOpen] = react.useState(false);
			const [rect, setRect] = react.useState(null);
			const anchorRef = react.useRef(null);
			const panelRef = react.useRef(null);

			// Keep the clock fresh: per-second while the panel is open (live
			// countdown + marker), 30s otherwise (dot color stays current).
			react.useEffect(() => {
				const timer = setInterval(() => setNow(new Date()), open ? TICK_MS : REFRESH_MS);
				return () => clearInterval(timer);
			}, [open]);

			// Measure the dot while the panel is open; reposition on scroll/resize.
			react.useEffect(() => {
				if (!open) return;
				const measure = () => {
					const el = anchorRef.current;
					if (!el) return;
					setRect(el.getBoundingClientRect());
				};
				measure();
				window.addEventListener("resize", measure);
				document.addEventListener("scroll", measure, true);
				return () => {
					window.removeEventListener("resize", measure);
					document.removeEventListener("scroll", measure, true);
				};
			}, [open]);

			// Close on outside pointer-down or Escape; Tab cycles the panel's
			// two controls (dot button ↔ close button).
			react.useEffect(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					const target = event.target;
					const anchor = anchorRef.current;
					const panel = panelRef.current;
					if (anchor && anchor.contains(target)) return;
					if (panel && panel.contains(target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						setOpen(false);
						return;
					}
					if (event.key !== "Tab") return;
					const active = document.activeElement;
					const dot = anchorRef.current;
					const panel = panelRef.current;
					const inside = (panel !== null && panel.contains(active)) || active === dot;
					if (!inside) return;
					event.preventDefault();
					const close = panel === null ? null : panel.querySelector(".dpk-close");
					if (event.shiftKey) {
						(active === dot ? close : dot)?.focus();
					} else {
						(active === close ? dot : close)?.focus();
					}
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);

			// Focus the panel on open, return focus to the dot on close.
			react.useEffect(() => {
				if (open) {
					panelRef.current?.focus();
				} else if (anchorRef.current) {
					anchorRef.current.focus();
				}
			}, [open]);

			const peak = isPeakAt(now);
			const style = open && rect !== null ? panelStyle(rect) : null;
			return react.createElement(react.Fragment, null, [
				react.createElement("button", {
					ref: anchorRef,
					type: "button",
					className: "dpk-btn",
					onClick: (event) => {
						event.stopPropagation();
						setOpen((value) => !value);
					},
					"aria-label": peak
						? "DeepSeek API peak time — show details"
						: "DeepSeek API off-peak — show details",
					"aria-expanded": open,
					"aria-haspopup": "dialog",
					"data-deepseek-peak": peak ? "peak" : "off-peak"
				}, react.createElement("span", { className: `dpk-dot ${peak ? "dpk-dot-peak" : "dpk-dot-offpeak"}` })),
				open && style !== null
					? react.createElement("div", {
							ref: panelRef,
							role: "dialog",
							"aria-label": "DeepSeek API peak status",
							tabIndex: -1,
							className: `dpk-panel ${peak ? "dpk-peak" : "dpk-offpeak"}`,
							"data-deepseek-panel": true,
							style: { right: style.right, ...(style.top !== undefined ? { top: style.top } : { bottom: style.bottom }) }
						}, Dashboard({ peak, now, onClose: () => setOpen(false), caretLeft: style.caretLeft }))
					: null
			]);
		}

		// --- client plugin body ------------------------------------------
		/** Client cordis services this module needs on its ctx. */
		const inject = ["slots"];

		/**
		 * Register the dot into the composer tool row. `slots.inject` waits for
		 * the `conversation.input.right` declaration (ui-conversation, loaded
		 * before this bundle), so no ordering race.
		 */
		function apply(ctx) {
			try {
				ctx.effect(injectStyles, "dsh-deepseek-peak-indicator: styles");
				ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
					name: "conversation.input.right",
					id: "deepseek-peak-indicator",
					order: 10
				}, PeakIndicator));
			} catch (error) {
				console.error("[dsh-deepseek-peak-indicator] registration failed:", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
