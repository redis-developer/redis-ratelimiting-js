(function () {
  "use strict";

  const C = {
    volt: "#DCFF1E",
    voltDim: "rgba(220, 255, 30, 0.25)",
    red: "#FF4438",
    redDim: "rgba(255, 68, 56, 0.25)",
    skyBlue: "#80DBFF",
    skyBlueDim: "rgba(128, 219, 255, 0.2)",
    violet: "#C795E3",
    violetDim: "rgba(199, 149, 227, 0.25)",
    border: "#2D4754",
    surface: "#163341",
    midnight: "#091A23",
    textPrimary: "#D9D9D9",
    textSecondary: "#B9C2C6",
    textMuted: "#8A99A0",
    textDim: "#5C707A",
  };

  let current = null;
  let animFrame = null;
  let lastTime = 0;

  // ---- DOM helpers ----

  function h(tag, className, props) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "text") e.textContent = v;
        else if (k === "html") e.innerHTML = v;
        else if (k === "style" && typeof v === "object")
          Object.assign(e.style, v);
        else e.setAttribute(k, String(v));
      }
    }
    return e;
  }

  function colorForPct(pct) {
    if (pct > 0.6) return C.volt;
    if (pct > 0.25) return C.violet;
    return C.red;
  }

  function flashVizPanel() {
    const vizBox = document.querySelector("#algorithm-detail .viz-panel");
    if (vizBox) {
      vizBox.classList.remove("flash-denied");
      void vizBox.offsetWidth;
      vizBox.classList.add("flash-denied");
    }
  }

  // ---- Renderers ----

  const renderers = {};

  // ========== Fixed Window ==========
  renderers["fixed-window"] = {
    create(container, config) {
      const max = config.maxRequests || 10;
      const winSec = config.windowSeconds || 10;

      const statusLine = h("div", "viz-status", {
        style: { color: C.textSecondary },
        text: `Window: ${winSec.toFixed(1)}s remaining`,
      });
      container.appendChild(statusLine);

      const grid = h("div", "slot-grid");
      const slots = [];
      const slotW = Math.max(16, Math.min(32, Math.floor(380 / max) - 4));
      for (let i = 0; i < max; i++) {
        const s = h("div", "slot", {
          style: {
            width: slotW + "px",
            height: "56px",
            border: `2px solid ${C.border}`,
            background: "transparent",
          },
        });
        grid.appendChild(s);
        slots.push(s);
      }
      container.appendChild(grid);

      const barBg = h("div", "progress-bar", {
        style: { height: "6px", background: C.surface, marginBottom: "12px" },
      });
      const barFill = h("div", "progress-fill", {
        style: {
          height: "6px",
          width: "100%",
          background: C.skyBlue,
          transition: "width 0.15s linear",
        },
      });
      barBg.appendChild(barFill);
      container.appendChild(barBg);

      const countLine = h("div", "viz-count", {
        style: { color: C.textDim },
        text: `0 / ${max} requests used`,
      });
      container.appendChild(countLine);

      return {
        slots,
        barFill,
        statusLine,
        countLine,
        local: {
          used: 0,
          timeLeft: winSec,
          active: false,
          windowSeconds: winSec,
        },
      };
    },

    update(els, result) {
      const used = result.limit - result.remaining;
      els.local.used = used;
      els.local.active = true;
      if (result.retryAfter !== null) els.local.timeLeft = result.retryAfter;

      els.slots.forEach((s, i) => {
        if (i < used) {
          const color = colorForPct(1 - i / result.limit);
          s.style.background = color;
          s.style.borderColor = color;
        } else {
          s.style.background = "transparent";
          s.style.borderColor = C.border;
        }
      });

      if (used > 0 && used <= els.slots.length) {
        const slot = els.slots[used - 1];
        slot.classList.remove("slot-pop");
        void slot.offsetWidth;
        slot.classList.add("slot-pop");
      }

      if (!result.allowed) {
        flashVizPanel();
      }

      els.countLine.textContent = `${used} / ${result.limit} requests used`;
    },

    tick(els, config, dt) {
      if (!els.local.active) return;
      const winSec = config.windowSeconds || 10;

      els.local.timeLeft -= dt;
      if (els.local.timeLeft <= 0) {
        els.local.timeLeft = winSec;
        els.local.used = 0;
        els.local.active = false;
        els.slots.forEach((s) => {
          s.style.background = "transparent";
          s.style.borderColor = C.border;
        });
        els.countLine.textContent = `0 / ${config.maxRequests || 10} requests used`;
      }

      const pct = Math.max(0, els.local.timeLeft / winSec);
      els.barFill.style.width = `${pct * 100}%`;
      els.statusLine.textContent = `Window: ${Math.max(0, els.local.timeLeft).toFixed(1)}s remaining`;
    },
  };

  // ========== Sliding Window Log ==========
  renderers["sliding-window-log"] = {
    create(container, config) {
      const max = config.maxRequests || 10;
      const winSec = config.windowSeconds || 10;

      const statusLine = h("div", "viz-status", {
        style: { color: C.textSecondary },
        text: `0 / ${max} requests in window`,
      });
      container.appendChild(statusLine);

      const timeline = h("div", "timeline", {
        style: {
          height: "90px",
          border: `1px solid ${C.skyBlue}50`,
          borderRadius: "8px",
          background: `${C.skyBlue}08`,
          overflow: "hidden",
        },
      });

      const midline = h("div", "timeline-line", {
        style: {
          top: "50%",
          height: "2px",
          background: C.border,
          transform: "translateY(-50%)",
        },
      });
      timeline.appendChild(midline);

      const dotsWrap = h("div", "dots-layer");
      timeline.appendChild(dotsWrap);

      container.appendChild(timeline);

      const windowLabel = h("div", "viz-label", {
        style: { color: C.textDim },
        text: `\u2190 ${winSec}s window \u2192`,
      });
      container.appendChild(windowLabel);

      const countLine = h("div", "viz-count", {
        style: { color: C.textDim },
        text: `0 / ${max} requests in window`,
      });
      container.appendChild(countLine);

      return {
        timeline,
        dotsWrap,
        statusLine,
        countLine,
        local: { dots: [], windowSeconds: winSec, maxRequests: max },
      };
    },

    update(els, result) {
      const now = Date.now();

      const nearbyCount = els.local.dots.filter(
        (d) => Math.abs(now - d.ts) < 10,
      ).length;

      const dot = h("div", `dot dot-appear${result.allowed ? " allowed" : ""}`, {
        style: {
          width: `${10 + nearbyCount * 2}px`,
          height: `${10 + nearbyCount * 2}px`,
          top: "50%",
          right: "10px",
          background: result.allowed ? C.volt : C.red,
          boxShadow: `0 0 6px ${result.allowed ? C.voltDim : C.redDim}`,
          transform: "translateY(-50%) scale(0)",
        },
      });
      els.dotsWrap.appendChild(dot);
      els.local.dots.push({ ts: now, el: dot });

      if (!result.allowed) {
        flashVizPanel();
      }

      const count = result.limit - result.remaining;
      els.statusLine.textContent = `${count} / ${result.limit} requests in window`;
      els.countLine.textContent = `${count} / ${result.limit} requests in window`;
    },

    tick(els, config, dt) {
      const now = Date.now();
      const winMs = (config.windowSeconds || 10) * 1000;
      const tw = els.timeline.offsetWidth || 400;
      let count = 0;

      els.local.dots = els.local.dots.filter((d) => {
        const age = now - d.ts;
        if (age > winMs) {
          d.el.style.opacity = "0";
          d.el.style.transition = "opacity 0.4s";
          setTimeout(() => d.el.remove(), 400);
          return false;
        }
        const pct = Math.max(0, age / winMs);
        d.el.style.right = 10 + pct * (tw - 30) + "px";

        if (d.el.classList.contains("allowed")) {
          count++;
        }

        return true;
      });

      els.statusLine.textContent = els.statusLine.textContent.replace(/^\d+/, count);
      els.countLine.textContent = els.countLine.textContent.replace(/^\d+/, count);
    },
  };

  // ========== Sliding Window Counter ==========
  renderers["sliding-window-counter"] = {
    create(container, config) {
      const max = config.maxRequests || 10;
      const winSec = config.windowSeconds || 10;

      const statusLine = h("div", "viz-status", {
        style: { color: C.textSecondary },
        text: `Weight: 1.00 \u2014 Effective: 0 / ${max}`,
      });
      container.appendChild(statusLine);

      const frame = h("div", "timeline", {
        style: {
          height: "90px",
          border: `1px solid ${C.skyBlue}50`,
          borderRadius: "8px",
          background: `${C.skyBlue}08`,
          overflow: "hidden",
        },
      });

      const track = h("div", "track", {
        style: {
          width: "200%",
          left: "0",
          transform: "translateX(0%)",
          transition: "transform 0.15s linear",
        },
      });

      function makeWindow(label, bg, labelColor) {
        const win = h("div", "window-half", {
          style: { width: "50%", background: bg },
        });
        const lbl = h("div", "window-label", {
          style: { color: labelColor },
          text: label,
        });
        win.appendChild(lbl);
        const line = h("div", "window-line", {
          style: {
            top: "50%",
            height: "2px",
            background: C.border,
            transform: "translateY(-50%)",
          },
        });
        win.appendChild(line);
        const dots = h("div", "dots-layer");
        win.appendChild(dots);
        return { win, lbl, dots };
      }

      const prev = makeWindow(
        "Previous Window",
        `${C.violet}0a`,
        `${C.violet}90`,
      );
      prev.win.style.left = "0";
      track.appendChild(prev.win);

      const curr = makeWindow(
        "Current Window",
        `${C.volt}08`,
        `${C.volt}90`,
      );
      curr.win.style.left = "50%";
      track.appendChild(curr.win);

      const boundary = h("div", "track-boundary", {
        style: {
          left: "50%",
          width: "0px",
          borderLeft: `1px dashed ${C.textDim}60`,
        },
      });
      track.appendChild(boundary);

      frame.appendChild(track);
      container.appendChild(frame);

      const windowLabel = h("div", "viz-label", {
        style: { color: C.skyBlue },
        text: `\u2190 ${winSec}s sliding window \u2192`,
      });
      container.appendChild(windowLabel);

      const formula = h("div", "viz-formula", {
        style: { color: C.textDim },
        text: "0 \u00d7 1.00 + 0 = 0 effective",
      });
      container.appendChild(formula);

      return {
        track,
        prev,
        curr,
        formula,
        statusLine,
        local: {
          prevCount: 0,
          currCount: 0,
          prevDots: [],
          currDots: [],
          weight: 1,
          windowStart: Date.now(),
          windowSeconds: winSec,
          maxRequests: max,
          lastWindowNum: 0,
        },
      };
    },

    update(els, result) {
      const now = Date.now();
      els.local.currCount++;

      const winSec = els.local.windowSeconds;
      const rawElapsed = (now - els.local.windowStart) / 1000;
      const nearbyCount = els.local.currDots.filter(
        (d) => Math.abs(now - d.ts) < 50,
      ).length;
      const adjusted = rawElapsed + nearbyCount * 0.018;
      const progress = (adjusted % winSec) / winSec;
      const xPct = 4 + progress * 92;

      const lanes = [-28, -14, 0, 14, 28];
      const yOffset = lanes[nearbyCount % lanes.length];

      const dot = h("div", `dot dot-appear${result.allowed ? " allowed" : ""}`, {
        style: {
          width: `${10 + nearbyCount * 2}px`,
          height: `${10 + nearbyCount * 2}px`,
          left: xPct + "%",
          top: "50%",
          background: result.allowed ? C.volt : C.red,
          boxShadow: `0 0 6px ${result.allowed ? C.voltDim : C.redDim}`,
          transform: "translateY(-50%) scale(0)",
        },
      });
      els.curr.dots.appendChild(dot);
      els.local.currDots.push({ el: dot, ts: now });

      const max = result.limit;
      const effective = max - result.remaining;
      els.curr.lbl.textContent = `Current Window (${els.local.currCount})`;
      els.prev.lbl.textContent = `Previous Window (${els.local.prevCount})`;

      const weighted = els.local.prevCount * els.local.weight;
      els.formula.textContent = `${els.local.prevCount} \u00d7 ${els.local.weight.toFixed(2)} + ${els.local.currCount} = ${(weighted + els.local.currCount).toFixed(1)}`;
      els.statusLine.textContent = `Weight: ${els.local.weight.toFixed(2)} \u2014 Effective: ${effective} / ${max}`;

      if (!result.allowed) {
        flashVizPanel();
      }
    },

    tick(els, config, dt) {
      const winSec = config.windowSeconds || 10;
      const elapsed = (Date.now() - els.local.windowStart) / 1000;
      const currentWindowNum = Math.floor(elapsed / winSec);
      const windowProgress = (elapsed % winSec) / winSec;

      if (currentWindowNum > els.local.lastWindowNum) {
        els.local.lastWindowNum = currentWindowNum;
        els.local.prevCount = els.local.currCount;
        els.local.currCount = 0;

        els.prev.dots.innerHTML = "";
        els.local.prevDots.forEach((d) => d.el.remove());
        els.local.prevDots = els.local.currDots;
        els.local.currDots = [];
        els.local.prevDots.forEach((d) => els.prev.dots.appendChild(d.el));
        els.curr.dots.innerHTML = "";

        els.prev.lbl.textContent = `Previous Window (${els.local.prevCount})`;
        els.curr.lbl.textContent = "Current Window (0)";

        els.track.style.transition = "none";
        els.track.style.transform = "translateX(0%)";
        requestAnimationFrame(() => {
          els.track.style.transition = "transform 0.15s linear";
        });
      }

      els.track.style.transform = `translateX(${-windowProgress * 50}%)`;

      els.local.weight = +(1 - windowProgress).toFixed(3);
      els.prev.dots.style.opacity = String(0.3 + els.local.weight * 0.7);

      const weighted = els.local.prevCount * els.local.weight;
      const effective = weighted + els.local.currCount;
      const max = config.maxRequests || 10;
      els.formula.textContent = `${els.local.prevCount} \u00d7 ${els.local.weight.toFixed(2)} + ${els.local.currCount} = ${effective.toFixed(1)}`;
      els.statusLine.textContent = `Weight: ${els.local.weight.toFixed(2)} \u2014 Effective: ${effective.toFixed(1)} / ${max}`;
    },
  };

  // ========== Token Bucket ==========
  renderers["token-bucket"] = {
    create(container, config) {
      const max = config.maxTokens || 10;
      const rate = config.refillRate || 1;

      const statusLine = h("div", "viz-status", {
        style: { color: C.textSecondary },
        html: `<span style="color:${C.volt}">\u25bc</span> Refilling at ${rate} token${rate !== 1 ? "s" : ""}/s`,
      });
      container.appendChild(statusLine);

      const bucketWrap = h("div", "bucket-wrap");
      const bucket = h("div", "bucket", {
        style: {
          width: "260px",
          height: "160px",
          borderLeft: `3px solid ${C.border}`,
          borderRight: `3px solid ${C.border}`,
          borderBottom: `3px solid ${C.border}`,
          borderRadius: "0 0 14px 14px",
        },
      });

      const tokenGrid = h("div", "token-grid");
      const tokens = [];
      for (let i = 0; i < max; i++) {
        const t = h("div", "token", {
          style: {
            width: "22px",
            height: "22px",
            background: C.volt,
            boxShadow: `0 0 6px ${C.voltDim}`,
            transition: "transform 0.3s, opacity 0.3s",
          },
        });
        tokenGrid.appendChild(t);
        tokens.push(t);
      }
      bucket.appendChild(tokenGrid);
      bucketWrap.appendChild(bucket);
      container.appendChild(bucketWrap);

      const countLine = h("div", "viz-count", {
        style: { color: C.textDim },
        text: `${max} / ${max} tokens`,
      });
      container.appendChild(countLine);

      return {
        tokens,
        countLine,
        statusLine,
        local: { count: max, maxTokens: max, refillRate: rate, fractional: 0 },
      };
    },

    update(els, result) {
      els.local.count = result.remaining;
      els.local.fractional = 0;

      els.tokens.forEach((t, i) => {
        if (i < result.remaining) {
          t.style.background = C.volt;
          t.style.boxShadow = `0 0 6px ${C.voltDim}`;
          t.style.transform = "scale(1)";
          t.style.opacity = "1";
          t.classList.remove("token-consume");
        } else {
          t.classList.remove("token-consume", "token-appear");
          void t.offsetWidth;
          if (i === result.remaining) {
            t.classList.add("token-consume");
          } else {
            t.style.transform = "scale(0)";
            t.style.opacity = "0.15";
            t.style.background = C.border;
            t.style.boxShadow = "none";
          }
        }
      });

      if (!result.allowed) {
        flashVizPanel();
      }

      els.countLine.textContent = `${result.remaining} / ${result.limit} tokens`;
    },

    tick(els, config, dt) {
      const max = config.maxTokens || 10;
      const rate = config.refillRate || 1;

      if (els.local.count >= max) return;

      els.local.fractional += rate * dt;
      if (els.local.fractional >= 1) {
        const toAdd = Math.floor(els.local.fractional);
        els.local.fractional -= toAdd;
        const newCount = Math.min(max, els.local.count + toAdd);

        for (let i = els.local.count; i < newCount; i++) {
          if (els.tokens[i]) {
            const t = els.tokens[i];
            t.classList.remove("token-consume");
            t.style.background = C.volt;
            t.style.boxShadow = `0 0 6px ${C.voltDim}`;
            t.style.transform = "scale(1)";
            t.style.opacity = "1";
            t.classList.add("token-appear");
          }
        }

        els.local.count = newCount;
        els.countLine.textContent = `${newCount} / ${max} tokens`;
      }
    },
  };

  // ========== Leaky Bucket ==========
  renderers["leaky-bucket"] = {
    create(container, config) {
      const cap = config.capacity || 10;
      const rate = config.leakRate || 1;
      const mode = config.mode || "policing";
      const isShaping = mode === "shaping";

      const statusLine = h("div", "viz-status", {
        style: { color: C.textSecondary },
        html: isShaping
          ? `<span style="color:${C.violet}">\u29D7</span> Shaping \u2014 requests queued`
          : `<span style="color:${C.skyBlue}">\u25bc</span> Policing \u2014 excess dropped`,
      });
      container.appendChild(statusLine);

      const bucketWrap = h("div", "bucket-wrap-sm");
      const bucket = h("div", "bucket", {
        style: {
          width: "260px",
          height: "150px",
          borderLeft: `3px solid ${C.border}`,
          borderRight: `3px solid ${C.border}`,
          borderBottom: `3px solid ${C.border}`,
          borderRadius: "0 0 14px 14px",
        },
      });

      const water = h("div", `water-surface water-fill${isShaping ? " shaping" : ""}`, {
        style: { height: "0%" },
      });
      bucket.appendChild(water);

      for (let i = 1; i <= 4; i++) {
        const marker = h("div", "bucket-marker", {
          style: {
            bottom: `${(i / 5) * 100}%`,
            height: "1px",
            background: `${C.border}80`,
          },
        });
        bucket.appendChild(marker);
      }

      bucketWrap.appendChild(bucket);
      container.appendChild(bucketWrap);

      const dripRow = h("div", "drip-row");
      const dripDot = h("div", "drip drip-dot", {
        style: {
          width: "6px",
          height: "6px",
          background: isShaping ? C.violet : C.skyBlue,
          opacity: "0",
        },
      });
      dripRow.appendChild(dripDot);
      container.appendChild(dripRow);

      const drainLabel = h("div", "viz-label-drain", {
        style: { color: C.textDim },
        text: isShaping
          ? `Processing at ${rate} req/s`
          : `Draining at ${rate} req/s`,
      });
      container.appendChild(drainLabel);

      const countLine = h("div", "viz-count", {
        style: { color: C.textDim },
        text: isShaping ? `Queue: 0 / ${cap}` : `Level: 0 / ${cap}`,
      });
      container.appendChild(countLine);

      return {
        water,
        dripDot,
        countLine,
        drainLabel,
        statusLine,
        local: { level: 0, capacity: cap, leakRate: rate, mode },
      };
    },

    update(els, result) {
      const level = result.limit - result.remaining;
      els.local.level = level;
      const isShaping = els.local.mode === "shaping";

      const pct = (level / els.local.capacity) * 100;
      els.water.style.height = `${pct}%`;

      if (isShaping) {
        els.water.classList.remove("danger");
      } else if (pct > 80) {
        els.water.classList.add("danger");
      } else {
        els.water.classList.remove("danger");
      }

      if (level > 0) {
        els.dripDot.style.opacity = "0.8";
      }

      if (!result.allowed) {
        flashVizPanel();
      }

      const label = isShaping ? "Queue" : "Level";
      els.countLine.textContent = `${label}: ${level} / ${result.limit}`;

      if (isShaping && result.delay != null && result.delay > 0) {
        els.statusLine.innerHTML =
          `<span style="color:${C.violet}">\u29D7</span> Shaping \u2014 delay: ${result.delay.toFixed(1)}s`;
      }
    },

    tick(els, config, dt) {
      const rate = config.leakRate || 1;
      const cap = config.capacity || 10;
      const isShaping = els.local.mode === "shaping";

      if (els.local.level > 0) {
        els.local.level = Math.max(0, els.local.level - rate * dt);
        const pct = (els.local.level / cap) * 100;
        els.water.style.height = pct + "%";

        if (!isShaping) {
          if (pct > 80) els.water.classList.add("danger");
          else els.water.classList.remove("danger");
        }

        const display = Math.ceil(els.local.level);
        const label = isShaping ? "Queue" : "Level";
        els.countLine.textContent = `${label}: ${display} / ${cap}`;

        if (els.local.level <= 0) {
          els.dripDot.style.opacity = "0";
          if (isShaping) {
            els.statusLine.innerHTML =
              `<span style="color:${C.violet}">\u29D7</span> Shaping \u2014 requests queued`;
          }
        }
      }
    },
  };

  // ---- API helpers ----

  function getConfig() {
    const form = document.getElementById("config-form");
    if (!form) return current?.config || {};
    const data = {};
    form.querySelectorAll("input[name]").forEach((input) => {
      data[input.name] = parseFloat(input.value) || 0;
    });
    form.querySelectorAll("select[name]").forEach((select) => {
      data[select.name] = select.value;
    });
    return data;
  }

  function addToLog(results) {
    const log = document.getElementById("result-log");
    const empty = document.getElementById("result-log-empty");
    if (!log) return;
    if (empty) empty.style.display = "none";

    results.forEach((r) => {
      const hasDelay = r.delay != null && r.delay > 0;
      const icon = r.allowed ? (hasDelay ? "\u29D7" : "\u2713") : "\u2717";
      const color = r.allowed ? (hasDelay ? C.violet : C.volt) : C.red;
      let text;
      if (!r.allowed) {
        text = `Denied \u2014 retry after ${r.retryAfter}s`;
      } else if (hasDelay) {
        text = `Queued +${r.delay.toFixed(1)}s \u2014 ${r.remaining}/${r.limit} remaining`;
      } else {
        text = `Allowed \u2014 ${r.remaining}/${r.limit} remaining`;
      }

      const entry = h("div", "log-entry", {
        style: { borderColor: C.border + "60" },
      });
      entry.innerHTML = `<span style="color:${color}" class="log-icon">${icon}</span><span style="color:${C.textMuted}" class="log-text">${text}</span>`;
      log.insertBefore(entry, log.firstChild);
    });

    while (log.children.length > 60) {
      log.removeChild(log.lastChild);
    }
  }

  async function sendRequest() {
    if (!current) return;
    const config = getConfig();
    try {
      const resp = await fetch(`/api/rate-limit/${current.algorithm}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const result = await resp.json();
      renderers[current.algorithm].update(current.elements, result);
      addToLog([result]);
    } catch (err) {
      console.error("Request failed:", err);
    }
  }

  async function sendBurst() {
    if (!current) return;
    const config = getConfig();
    const count =
      parseInt(document.getElementById("burst-count")?.value || "5", 10) || 5;
    try {
      const resp = await fetch(`/api/rate-limit/${current.algorithm}/burst`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, count }),
      });
      const results = await resp.json();
      results.forEach((r) =>
        renderers[current.algorithm].update(current.elements, r),
      );
      addToLog(results);
    } catch (err) {
      console.error("Burst failed:", err);
    }
  }

  async function resetAlgorithm() {
    if (!current) return;
    try {
      await fetch("/api/rate-limit/reset", { method: "POST" });
      const container = document.getElementById("viz-container");
      if (container) {
        container.innerHTML = "";
        current.elements = renderers[current.algorithm].create(
          container,
          getConfig(),
        );
      }
      const log = document.getElementById("result-log");
      if (log) log.innerHTML = "";
      const empty = document.getElementById("result-log-empty");
      if (empty) empty.style.display = "";
    } catch (err) {
      console.error("Reset failed:", err);
    }
  }

  // ---- Animation loop ----

  function animate(time) {
    if (!current) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.25) : 0;
    lastTime = time;

    const renderer = renderers[current.algorithm];
    if (renderer?.tick && current.elements) {
      renderer.tick(current.elements, getConfig(), dt);
    }

    animFrame = requestAnimationFrame(animate);
  }

  // ---- Lifecycle ----

  function init(algorithm, config) {
    destroy();

    const container = document.getElementById("viz-container");
    if (!container || !renderers[algorithm]) return;

    container.innerHTML = "";
    const elements = renderers[algorithm].create(container, config);

    current = { algorithm, config, elements };
    lastTime = 0;
    animFrame = requestAnimationFrame(animate);

    document.querySelectorAll("[data-algo-card]").forEach((card) => {
      card.classList.toggle("active", card.dataset.algoCard === algorithm);
    });

    const form = document.getElementById("config-form");
    if (form) {
      let debounce;
      const onConfigChange = () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const newConfig = getConfig();
          current.config = newConfig;
          container.innerHTML = "";
          current.elements = renderers[algorithm].create(container, newConfig);
          await fetch("/api/rate-limit/reset", { method: "POST" });
          const log = document.getElementById("result-log");
          if (log) log.innerHTML = "";
          const empty = document.getElementById("result-log-empty");
          if (empty) empty.style.display = "";
        }, 600);
      };
      form.addEventListener("input", onConfigChange);
      form.addEventListener("change", onConfigChange);
    }
  }

  function destroy() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = null;
    current = null;
    lastTime = 0;
  }

  window.App = { init, destroy, sendRequest, sendBurst, resetAlgorithm };
})();
