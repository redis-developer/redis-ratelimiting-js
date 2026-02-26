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

  // ---- Renderers ----

  const renderers = {};

  // ========== Fixed Window ==========
  renderers["fixed-window"] = {
    create(container, config) {
      const max = config.maxRequests || 10;
      const winSec = config.windowSeconds || 10;

      const statusLine = h("div", "text-center mb-5 font-mono text-sm", {
        style: { color: C.textSecondary },
        text: `Window: ${winSec.toFixed(1)}s remaining`,
      });
      container.appendChild(statusLine);

      const grid = h("div", "flex justify-center items-end gap-1 flex-wrap", {
        style: { minHeight: "80px", marginBottom: "24px" },
      });
      const slots = [];
      const slotW = Math.max(16, Math.min(32, Math.floor(380 / max) - 4));
      for (let i = 0; i < max; i++) {
        const s = h("div", "rounded transition-all duration-200", {
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

      const barBg = h("div", "w-full rounded-full", {
        style: { height: "6px", background: C.surface, marginBottom: "12px" },
      });
      const barFill = h("div", "rounded-full", {
        style: {
          height: "6px",
          width: "100%",
          background: C.skyBlue,
          transition: "width 0.15s linear",
        },
      });
      barBg.appendChild(barFill);
      container.appendChild(barBg);

      const countLine = h("div", "text-center font-mono text-xs", {
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
        const vizBox = document.querySelector(
          "#algorithm-detail .lg\\:col-span-2",
        );
        if (vizBox) {
          vizBox.classList.remove("flash-denied");
          void vizBox.offsetWidth;
          vizBox.classList.add("flash-denied");
        }
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

      const statusLine = h("div", "text-center mb-5 font-mono text-sm", {
        style: { color: C.textSecondary },
        text: `0 / ${max} requests in window`,
      });
      container.appendChild(statusLine);

      const timeline = h("div", "relative mx-auto", {
        style: {
          width: "92%",
          height: "90px",
          border: `1px solid ${C.skyBlue}50`,
          borderRadius: "8px",
          background: `${C.skyBlue}08`,
          overflow: "hidden",
        },
      });

      const midline = h("div", "absolute left-4 right-4", {
        style: {
          top: "50%",
          height: "2px",
          background: C.border,
          transform: "translateY(-50%)",
        },
      });
      timeline.appendChild(midline);

      const dotsWrap = h("div", "absolute inset-0", {
        style: { pointerEvents: "none" },
      });
      timeline.appendChild(dotsWrap);

      container.appendChild(timeline);

      const windowLabel = h(
        "div",
        "text-center font-mono text-xs mt-2 mb-1",
        {
          style: { color: C.textDim },
          text: `\u2190 ${winSec}s window \u2192`,
        },
      );
      container.appendChild(windowLabel);

      const countLine = h("div", "text-center font-mono text-xs", {
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

      // Count dots that arrived at roughly the same instant (burst detection)
      const nearbyCount = els.local.dots.filter(
        (d) => Math.abs(now - d.ts) < 10,
      ).length;

      const dot = h("div", `absolute rounded-full dot-appear${result.allowed ? " allowed" : ""}`, {
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
        const vizBox = document.querySelector(
          "#algorithm-detail .lg\\:col-span-2",
        );
        if (vizBox) {
          vizBox.classList.remove("flash-denied");
          void vizBox.offsetWidth;
          vizBox.classList.add("flash-denied");
        }
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

      const statusLine = h("div", "text-center mb-4 font-mono text-sm", {
        style: { color: C.textSecondary },
        text: `Weight: 1.00 \u2014 Effective: 0 / ${max}`,
      });
      container.appendChild(statusLine);

      // Timeline: two fixed windows side-by-side with a sliding overlay
      const timelineWrap = h("div", "relative mx-auto", {
        style: { width: "92%", height: "110px", marginBottom: "20px" },
      });

      // Previous window region (left half)
      const prevRegion = h(
        "div",
        "absolute top-0 bottom-0 rounded-l-lg overflow-hidden",
        {
          style: {
            left: "0",
            width: "50%",
            border: `1px solid ${C.violet}40`,
            background: `${C.violet}06`,
          },
        },
      );
      const prevFill = h("div", "absolute bottom-0 left-0 right-0", {
        style: {
          height: "0%",
          background: `${C.violet}30`,
          transition: "height 0.3s ease, opacity 0.3s",
        },
      });
      prevRegion.appendChild(prevFill);
      const prevLabel = h(
        "div",
        "absolute top-2 left-0 right-0 text-center font-mono",
        { style: { fontSize: "10px", color: `${C.violet}90` }, text: "prev: 0" },
      );
      prevRegion.appendChild(prevLabel);
      timelineWrap.appendChild(prevRegion);

      // Current window region (right half)
      const currRegion = h(
        "div",
        "absolute top-0 bottom-0 rounded-r-lg overflow-hidden",
        {
          style: {
            right: "0",
            width: "50%",
            border: `1px solid ${C.volt}40`,
            borderLeft: "none",
            background: `${C.volt}06`,
          },
        },
      );
      const currFill = h("div", "absolute bottom-0 left-0 right-0", {
        style: {
          height: "0%",
          background: `${C.volt}30`,
          transition: "height 0.3s ease",
        },
      });
      currRegion.appendChild(currFill);
      const currLabel = h(
        "div",
        "absolute top-2 left-0 right-0 text-center font-mono",
        { style: { fontSize: "10px", color: `${C.volt}90` }, text: "curr: 0" },
      );
      currRegion.appendChild(currLabel);
      timelineWrap.appendChild(currRegion);

      // Center boundary marker
      const boundary = h("div", "absolute top-0 bottom-0", {
        style: {
          left: "50%",
          width: "1px",
          background: `${C.textDim}50`,
          zIndex: "1",
        },
      });
      timelineWrap.appendChild(boundary);

      // Sliding window overlay
      const slider = h("div", "absolute top-0 bottom-0", {
        style: {
          width: "50%",
          left: "0%",
          border: `2px solid ${C.skyBlue}`,
          borderRadius: "6px",
          background: `${C.skyBlue}10`,
          transition: "left 0.15s linear",
          zIndex: "2",
          pointerEvents: "none",
        },
      });
      // "now" marker at right edge of slider
      const nowMarker = h("div", "absolute top-0 bottom-0", {
        style: {
          right: "-1px",
          width: "3px",
          background: C.skyBlue,
          borderRadius: "2px",
        },
      });
      slider.appendChild(nowMarker);
      const nowLabel = h("div", "absolute font-mono", {
        style: {
          top: "-16px",
          right: "-12px",
          fontSize: "9px",
          color: C.skyBlue,
        },
        text: "now",
      });
      slider.appendChild(nowLabel);
      timelineWrap.appendChild(slider);

      // Window labels below timeline
      const labelsRow = h("div", "relative mx-auto flex", {
        style: { width: "92%", marginTop: "2px" },
      });
      const prevTimeLabel = h(
        "div",
        "flex-1 text-center font-mono",
        { style: { fontSize: "9px", color: C.textDim }, text: `\u2190 ${winSec}s \u2192` },
      );
      const currTimeLabel = h(
        "div",
        "flex-1 text-center font-mono",
        { style: { fontSize: "9px", color: C.textDim }, text: `\u2190 ${winSec}s \u2192` },
      );
      labelsRow.appendChild(prevTimeLabel);
      labelsRow.appendChild(currTimeLabel);
      container.appendChild(timelineWrap);
      container.appendChild(labelsRow);

      // Formula
      const formula = h("div", "text-center font-mono text-xs mt-3 mb-2", {
        style: { color: C.textDim },
        text: `0 \u00d7 1.00 + 0 = 0 effective`,
      });
      container.appendChild(formula);

      // Effective count bar
      const effBarBg = h("div", "mx-auto rounded-full", {
        style: {
          width: "85%",
          height: "6px",
          background: C.surface,
          marginBottom: "6px",
        },
      });
      const effBarFill = h("div", "rounded-full", {
        style: {
          height: "6px",
          width: "0%",
          background: C.violet,
          transition: "width 0.3s",
        },
      });
      effBarBg.appendChild(effBarFill);
      container.appendChild(effBarBg);

      const effText = h("div", "text-center font-mono text-xs", {
        style: { color: C.textDim },
        text: `Effective: 0 / ${max}`,
      });
      container.appendChild(effText);

      return {
        slider,
        prevFill,
        prevLabel,
        currFill,
        currLabel,
        formula,
        effBarFill,
        effText,
        statusLine,
        local: {
          prevCount: 0,
          currCount: 0,
          weight: 1,
          windowStart: Date.now(),
          windowSeconds: winSec,
          maxRequests: max,
          lastWindowNum: 0,
        },
      };
    },

    update(els, result) {
      if (result.allowed) els.local.currCount++;
      const max = result.limit;
      const effective = max - result.remaining;

      const currPct = Math.min(100, (els.local.currCount / max) * 100);
      els.currFill.style.height = currPct + "%";
      els.currLabel.textContent = `curr: ${els.local.currCount}`;

      const prevPct = Math.min(100, (els.local.prevCount / max) * 100);
      els.prevFill.style.height = prevPct + "%";
      els.prevLabel.textContent = `prev: ${els.local.prevCount}`;

      const effPct = Math.min(100, (effective / max) * 100);
      els.effBarFill.style.width = effPct + "%";
      els.effText.textContent = `Effective: ${effective} / ${max}`;

      const weighted = els.local.prevCount * els.local.weight;
      els.formula.textContent = `${els.local.prevCount} \u00d7 ${els.local.weight.toFixed(2)} + ${els.local.currCount} = ${(weighted + els.local.currCount).toFixed(1)}`;
      els.statusLine.textContent = `Weight: ${els.local.weight.toFixed(2)} \u2014 Effective: ${effective} / ${max}`;

      if (!result.allowed) {
        const vizBox = document.querySelector(
          "#algorithm-detail .lg\\:col-span-2",
        );
        if (vizBox) {
          vizBox.classList.remove("flash-denied");
          void vizBox.offsetWidth;
          vizBox.classList.add("flash-denied");
        }
      }
    },

    tick(els, config, dt) {
      const winSec = config.windowSeconds || 10;
      const elapsed = (Date.now() - els.local.windowStart) / 1000;
      const currentWindowNum = Math.floor(elapsed / winSec);
      const windowProgress = (elapsed % winSec) / winSec;

      // Detect fixed-window boundary crossing
      if (currentWindowNum > els.local.lastWindowNum) {
        els.local.prevCount = els.local.currCount;
        els.local.currCount = 0;
        els.local.lastWindowNum = currentWindowNum;

        const max = config.maxRequests || 10;
        const prevPct = Math.min(
          100,
          (els.local.prevCount / max) * 100,
        );
        els.prevFill.style.height = prevPct + "%";
        els.prevLabel.textContent = `prev: ${els.local.prevCount}`;
        els.currFill.style.height = "0%";
        els.currLabel.textContent = "curr: 0";

        // Snap slider back to left instantly, then re-enable transition
        els.slider.style.transition = "none";
        els.slider.style.left = "0%";
        requestAnimationFrame(() => {
          els.slider.style.transition = "left 0.15s linear";
        });
      }

      // Slide the overlay: left edge moves from 0% to 50% as elapsed goes 0 to 1
      els.slider.style.left = windowProgress * 50 + "%";

      // Update weight and fade previous window fill accordingly
      els.local.weight = +(1 - windowProgress).toFixed(3);
      els.prevFill.style.opacity = String(0.3 + els.local.weight * 0.7);

      // Keep formula and status line in sync during idle ticks
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

      const statusLine = h("div", "text-center mb-4 font-mono text-sm", {
        style: { color: C.textSecondary },
        html: `<span style="color:${C.volt}">\u25bc</span> Refilling at ${rate} token${rate !== 1 ? "s" : ""}/s`,
      });
      container.appendChild(statusLine);

      const bucketWrap = h("div", "flex justify-center mb-4");
      const bucket = h("div", "relative overflow-hidden", {
        style: {
          width: "260px",
          height: "160px",
          borderLeft: `3px solid ${C.border}`,
          borderRight: `3px solid ${C.border}`,
          borderBottom: `3px solid ${C.border}`,
          borderRadius: "0 0 14px 14px",
        },
      });

      const tokenGrid = h(
        "div",
        "absolute bottom-0 left-0 right-0 flex flex-wrap-reverse justify-center gap-2 p-3",
      );
      const tokens = [];
      for (let i = 0; i < max; i++) {
        const t = h("div", "rounded-full", {
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

      const countLine = h("div", "text-center font-mono text-xs", {
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
        const vizBox = document.querySelector(
          "#algorithm-detail .lg\\:col-span-2",
        );
        if (vizBox) {
          vizBox.classList.remove("flash-denied");
          void vizBox.offsetWidth;
          vizBox.classList.add("flash-denied");
        }
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

      const statusLine = h("div", "text-center mb-4 font-mono text-sm", {
        style: { color: C.textSecondary },
        html: `<span style="color:${C.skyBlue}">\u25bc</span> Incoming requests`,
      });
      container.appendChild(statusLine);

      const bucketWrap = h("div", "flex justify-center mb-1");
      const bucket = h("div", "relative overflow-hidden", {
        style: {
          width: "260px",
          height: "150px",
          borderLeft: `3px solid ${C.border}`,
          borderRight: `3px solid ${C.border}`,
          borderBottom: `3px solid ${C.border}`,
          borderRadius: "0 0 14px 14px",
        },
      });

      const water = h("div", "absolute bottom-0 left-0 right-0 water-surface", {
        style: { height: "0%" },
      });
      bucket.appendChild(water);

      for (let i = 1; i <= 4; i++) {
        const marker = h("div", "absolute left-2 right-2", {
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

      const dripRow = h("div", "flex justify-center mb-3", {
        style: { height: "28px", position: "relative" },
      });
      const dripDot = h("div", "drip rounded-full mx-auto", {
        style: {
          width: "6px",
          height: "6px",
          background: C.skyBlue,
          opacity: "0",
        },
      });
      dripRow.appendChild(dripDot);
      container.appendChild(dripRow);

      const drainLabel = h("div", "text-center font-mono text-xs mb-2", {
        style: { color: C.textDim },
        text: `Draining at ${rate} req/s`,
      });
      container.appendChild(drainLabel);

      const countLine = h("div", "text-center font-mono text-xs", {
        style: { color: C.textDim },
        text: `Level: 0 / ${cap}`,
      });
      container.appendChild(countLine);

      return {
        water,
        dripDot,
        countLine,
        drainLabel,
        local: { level: 0, capacity: cap, leakRate: rate },
      };
    },

    update(els, result) {
      const level = result.limit - result.remaining;
      els.local.level = level;

      const pct = (level / els.local.capacity) * 100;
      els.water.style.height = `${pct}%`;

      if (pct > 80) {
        els.water.classList.add("danger");
      } else {
        els.water.classList.remove("danger");
      }

      if (level > 0) {
        els.dripDot.style.opacity = "0.8";
      }

      if (!result.allowed) {
        const vizBox = document.querySelector(
          "#algorithm-detail .lg\\:col-span-2",
        );
        if (vizBox) {
          vizBox.classList.remove("flash-denied");
          void vizBox.offsetWidth;
          vizBox.classList.add("flash-denied");
        }
      }

      els.countLine.textContent = `Level: ${level} / ${result.limit}`;
    },

    tick(els, config, dt) {
      const rate = config.leakRate || 1;
      const cap = config.capacity || 10;

      if (els.local.level > 0) {
        els.local.level = Math.max(0, els.local.level - rate * dt);
        const pct = (els.local.level / cap) * 100;
        els.water.style.height = pct + "%";

        if (pct > 80) els.water.classList.add("danger");
        else els.water.classList.remove("danger");

        const display = Math.ceil(els.local.level);
        els.countLine.textContent = `Level: ${display} / ${cap}`;

        if (els.local.level <= 0) {
          els.dripDot.style.opacity = "0";
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
    return data;
  }

  function addToLog(results) {
    const log = document.getElementById("result-log");
    const empty = document.getElementById("result-log-empty");
    if (!log) return;
    if (empty) empty.style.display = "none";

    results.forEach((r) => {
      const icon = r.allowed ? "\u2713" : "\u2717";
      const color = r.allowed ? C.volt : C.red;
      const text = r.allowed
        ? `Allowed \u2014 ${r.remaining}/${r.limit} remaining`
        : `Denied \u2014 retry after ${r.retryAfter}s`;

      const entry = h(
        "div",
        "flex items-center gap-2 py-1 border-b text-xs",
        { style: { borderColor: C.border + "60" } },
      );
      entry.innerHTML = `<span style="color:${color}" class="font-bold font-mono">${icon}</span><span style="color:${C.textMuted}" class="font-mono">${text}</span>`;
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
      form.addEventListener("input", () => {
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
      });
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
