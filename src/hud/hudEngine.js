// src/hud/hudEngine.js

const DEBUG_PICKER = false; // 🔥 เปิดตอนจูน layout = true

export class HudEngine {
  constructor(rootEl, layout) {
    this.root = rootEl;
    this.layout = layout;
    this.refs = {};

    this.build();
    this.applyLayout();

    if (DEBUG_PICKER) {
      this.enablePicker();
    }
  }

  build() {
    this.root.innerHTML = "";

    // Template background
    const bg = document.createElement("img");
    bg.src = "assets/hud_template.png";
    bg.className = "hud-bg";
    this.root.appendChild(bg);

    // Overlay container
    const overlay = document.createElement("div");
    overlay.className = "hud-overlay";
    this.root.appendChild(overlay);

    // === Create dynamic elements ===

    this.refs.status = this.makeText("status");
    this.refs.mood = this.makeText("mood");
    this.refs.dialogue = this.makeText("dialogue");

    this.refs.calendar = this.makeText("calendar");
    this.refs.clockHand = this.makeClockHand();

    overlay.append(
      this.refs.status,
      this.refs.mood,
      this.refs.dialogue,
      this.refs.calendar,
      this.refs.clockHand
    );
  }

  makeText(key) {
    const el = document.createElement("div");
    el.className = `hud-${key}`;
    el.dataset.key = key;
    return el;
  }

  makeClockHand() {
    const el = document.createElement("div");
    el.className = "hud-clock-hand";
    return el;
  }

  applyLayout() {
    const overlay = this.root.querySelector(".hud-overlay");

    Object.entries(this.layout).forEach(([key, cfg]) => {
      const el = this.refs[key];
      if (!el) return;

      el.style.position = "absolute";
      el.style.left = cfg.x + "%";
      el.style.top = cfg.y + "%";
      el.style.transform = "translate(-50%, -50%)";
    });
  }

  update(data) {
    if (data.status) this.refs.status.textContent = data.status;
    if (data.mood) this.refs.mood.textContent = data.mood;
    if (data.dialogue) this.refs.dialogue.textContent = data.dialogue;
    if (data.calendar) this.refs.calendar.textContent = data.calendar;

    if (data.clockAngle !== undefined) {
      this.refs.clockHand.style.transform =
        `translate(-50%, -50%) rotate(${data.clockAngle}deg)`;
    }
  }

  // ==========================
  // 🔥 DEBUG PICKER SYSTEM
  // ==========================
  enablePicker() {
    console.log("🟢 DEBUG_PICKER ON");

    this.root.addEventListener("click", (ev) => {
      const rect = this.root.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;

      const xp = (x / rect.width) * 100;
      const yp = (y / rect.height) * 100;

      const msg = `[PICK] x:${xp.toFixed(2)}% y:${yp.toFixed(2)}%`;
      console.log(msg);

      this.showBadge(msg);
    });
  }

  showBadge(text) {
    let badge = document.getElementById("pick-badge");

    if (!badge) {
      badge = document.createElement("div");
      badge.id = "pick-badge";
      badge.style.position = "fixed";
      badge.style.left = "12px";
      badge.style.top = "12px";
      badge.style.zIndex = "999999";
      badge.style.background = "rgba(0,0,0,0.8)";
      badge.style.color = "#fff";
      badge.style.padding = "8px 10px";
      badge.style.borderRadius = "10px";
      badge.style.font = "12px ui-monospace, monospace";
      badge.style.pointerEvents = "none";
      document.body.appendChild(badge);
    }

    badge.textContent = text;
  }
}
