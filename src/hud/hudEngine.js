import { calcHandAngles } from "./clockHands.js";

function el(tag){
  return document.createElement(tag);
}

export class HudEngine {
  constructor({ overlayEl, hudLayout }){
    this.root = overlayEl;
    this.layout = hudLayout;
    this.state = {};
    this.dialogueLang = "th";

    this.stageEl = document.getElementById("stage");

    this.monthEl = el("div");
    this.dayEl = el("div");
    this.statusEl = el("div");
    this.moodEl = el("div");
    this.dialogueEl = el("div");
    this.inRoomWrap = el("div");

    this.hourHand = el("div");
    this.minHand = el("div");

    // portrait
    this.portraitEl = el("img");
    this.portraitEl.style.position = "absolute";
    this.portraitEl.style.objectFit = "contain";
    this.portraitEl.style.userSelect = "none";
    this.portraitEl.style.pointerEvents = "auto";
    this.portraitEl.style.cursor = "pointer";

    // status icon
    this.statusIconEl = el("img");
    this.statusIconEl.style.position = "absolute";
    this.statusIconEl.style.objectFit = "contain";
    this.statusIconEl.style.userSelect = "none";
    this.statusIconEl.style.pointerEvents = "none";
    this.statusIconEl.style.display = "none";

    this.root.append(
      this.monthEl, this.dayEl,
      this.statusEl, this.moodEl,
      this.dialogueEl,
      this.inRoomWrap,
      this.hourHand, this.minHand,
      this.portraitEl,
      this.statusIconEl
    );

    for(const e of [this.monthEl,this.dayEl,this.statusEl,this.moodEl,this.dialogueEl]){
      e.style.position = "absolute";
      e.style.color = "#2a2a2a";
      e.style.fontWeight = "700";
      e.style.userSelect = "none";
    }

    this.dialogueEl.style.cursor = "pointer";
    this.dialogueEl.style.display = "flex";
    this.dialogueEl.style.alignItems = "center";
    this.dialogueEl.style.justifyContent = "center";
    this.dialogueEl.style.textAlign = "center";
    this.dialogueEl.style.padding = "0.5rem";

    for(const h of [this.hourHand, this.minHand]){
      h.style.position = "absolute";
      h.style.transformOrigin = "50% 90%";
      h.style.background = "rgba(40,40,40,0.9)";
      h.style.borderRadius = "999px";
      h.style.pointerEvents = "none";
    }

    this.inRoomWrap.style.position = "absolute";
    this.inRoomWrap.style.display = "flex";
    this.inRoomWrap.style.gap = "0.5rem";

    // ===== NEW: portrait animation runtime =====
    this._portraitTimer = null;
    this._portraitFrames = [];
    this._portraitFrameIndex = 0;
    this._portraitEmotion = "normal";
    this._portraitFrameMs = 700; // default speed
    this._portraitUseNumberedFrames = false;

    // start default portrait (still image)
    this.setPortrait("normal");
  }

  resize(){
    this._applyLayout();
  }

  _stageRect(){
    return this.stageEl.getBoundingClientRect();
  }

  _applyRectPx(elm, rectPct){
    const r = this._stageRect();
    const left = (rectPct.x/100) * r.width;
    const top  = (rectPct.y/100) * r.height;
    const w    = (rectPct.w/100) * r.width;
    const h    = (rectPct.h/100) * r.height;

    elm.style.left = left + "px";
    elm.style.top  = top  + "px";
    elm.style.width  = w + "px";
    elm.style.height = h + "px";
  }

  _applyLayout(){
    const L = this.layout;

    this._applyRectPx(this.monthEl, L.calendar.month);
    this._applyRectPx(this.dayEl,   L.calendar.day);
    this._applyRectPx(this.statusEl, L.statusText);
    this._applyRectPx(this.moodEl,   L.moodText);
    this._applyRectPx(this.dialogueEl, L.dialogue);

    if (L.portrait) this._applyRectPx(this.portraitEl, L.portrait);
    if (L.statusIcon) this._applyRectPx(this.statusIconEl, L.statusIcon);

    const slots = L.inRoom.slots;
    if(slots?.length){
      const first = slots[0];
      const r = this._stageRect();
      this.inRoomWrap.style.left = ((first.x/100) * r.width) + "px";
      this.inRoomWrap.style.top  = ((first.y/100) * r.height) + "px";
    }

    const c = L.clock.center;
    const r = this._stageRect();
    const cx = (c.x/100) * r.width;
    const cy = (c.y/100) * r.height;

    const hourLen = (L.clock.hourLenPctOfScreenW/100) * window.innerWidth;
    const minLen  = (L.clock.minLenPctOfScreenW/100) * window.innerWidth;
    const t = L.clock.thicknessPx;

    this.hourHand.style.width = `${t}px`;
    this.hourHand.style.height = `${hourLen}px`;
    this.hourHand.style.left = `${cx - t/2}px`;
    this.hourHand.style.top  = `${cy - hourLen*0.9}px`;

    this.minHand.style.width = `${t}px`;
    this.minHand.style.height = `${minLen}px`;
    this.minHand.style.left = `${cx - t/2}px`;
    this.minHand.style.top  = `${cy - minLen*0.9}px`;
  }

  setCalendar(now){
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    this.monthEl.textContent = months[now.getMonth()];
    this.dayEl.textContent = String(now.getDate());
  }

  setClockHands(now){
    const { hourDeg, minDeg } = calcHandAngles(now);
    this.hourHand.style.transform = `rotate(${hourDeg}deg)`;
    this.minHand.style.transform  = `rotate(${minDeg}deg)`;
  }

  // ===== STATUS ICON =====
  setStatusIcon(iconKey){
    if(!iconKey){
      this.statusIconEl.style.display = "none";
      this.statusIconEl.removeAttribute("src");
      return;
    }
    this.statusIconEl.src = `assets/icons/${iconKey}.png`;
    this.statusIconEl.style.display = "block";
  }

  // =========================================================
  // ✅ PORTRAIT (still) + PORTRAIT ANIMATION (2–3 frames)
  // =========================================================

  _stopPortraitAnim(){
    if(this._portraitTimer){
      clearInterval(this._portraitTimer);
      this._portraitTimer = null;
    }
  }

  /**
   * Set portrait emotion.
   * - If you have numbered frames: assets/portrait/<emotion>_1.png ... _N.png
   *   then call setPortraitAnim(emotion, N, frameMs)
   * - Otherwise fallback to assets/portrait/<emotion>.png (still image)
   */
  setPortrait(emotion){
    this._portraitEmotion = emotion || "normal";

    // Stop any running animation first
    this._stopPortraitAnim();

    // Default: still image
    this._portraitUseNumberedFrames = false;
    this.portraitEl.src = `assets/portrait/${this._portraitEmotion}.png`;
  }

  /**
   * Run idle animation with 2–3 frames.
   * @param {string} emotion e.g. "normal"
   * @param {number} frameCount e.g. 2 or 3
   * @param {number} frameMs time per frame in ms (e.g. 250)
   */
  setPortraitAnim(emotion, frameCount = 2, frameMs = 400){
    this._portraitEmotion = emotion || "normal";
    this._portraitFrameMs = Math.max(50, Number(frameMs) || 400);

    const n = Math.max(1, Math.min(10, Number(frameCount) || 2)); // safety cap
    this._portraitFrames = [];
    for(let i=1;i<=n;i++){
      this._portraitFrames.push(`assets/portrait/${this._portraitEmotion}_${i}.png`);
    }

    // restart
    this._stopPortraitAnim();
    this._portraitUseNumberedFrames = true;
    this._portraitFrameIndex = 0;
    this.portraitEl.src = this._portraitFrames[0];

    this._portraitTimer = setInterval(()=>{
      this._portraitFrameIndex = (this._portraitFrameIndex + 1) % this._portraitFrames.length;
      this.portraitEl.src = this._portraitFrames[this._portraitFrameIndex];
    }, this._portraitFrameMs);
  }

  /**
   * Helper: allow speed config from state:
   * - portraitFrames: 1/2/3 (default 1)
   * - portraitFrameMs: e.g. 250 (priority over fps)
   * - portraitFps: e.g. 4 => 250ms
   */
  _applyPortraitFromState(state){
    const emo = state.emotion || "normal";

    const frames = Number(state.portraitFrames || 1);
    const hasAnim = frames >= 2;

    let frameMs = state.portraitFrameMs;
    if(frameMs == null){
      const fps = Number(state.portraitFps || 0);
      if(fps > 0) frameMs = 1000 / fps;
    }
    if(frameMs == null) frameMs = this._portraitFrameMs;

    // Only restart if something changed
    const needRestart =
      (emo !== this._portraitEmotion) ||
      (hasAnim !== this._portraitUseNumberedFrames) ||
      (hasAnim && frames !== this._portraitFrames.length) ||
      (hasAnim && Math.round(frameMs) !== Math.round(this._portraitFrameMs));

    if(!needRestart) return;

    if(hasAnim){
      this.setPortraitAnim(emo, frames, frameMs);
    }else{
      this.setPortrait(emo);
    }
  }

  setState(state){
    this.state = state || {};
    this.statusEl.textContent = this.state.status || "";
    this.moodEl.textContent = this.state.mood || "";

    const dlg = this.state.dialogue || {};
    this.dialogueEl.textContent = dlg[this.dialogueLang] || "";

    // portrait (still/anim) from state
    this._applyPortraitFromState(this.state);

    // status icon from state
    this.setStatusIcon(this.state.statusIcon);

    this._renderInRoom(this.state.inRoom || []);
  }

  enableDialogueToggle(cb){
    this.dialogueEl.onclick = cb;
  }

  toggleDialogueLang(){
    this.dialogueLang = this.dialogueLang === "th" ? "en" : "th";
    this.setState(this.state);
  }

  _renderInRoom(list){
    this.inRoomWrap.innerHTML = "";
    const slots = this.layout.inRoom.slots;
    const r = this._stageRect();

    list.slice(0, slots.length).forEach((id,i)=>{
      const s = slots[i];
      const w = (s.w/100) * r.width;
      const h = (s.h/100) * r.height;

      const card = el("img");
      card.src = `assets/characters/${id}.png`;
      card.style.width = w + "px";
      card.style.height = h + "px";
      card.style.objectFit = "contain";
      card.style.borderRadius = "8px";
      card.style.userSelect = "none";

      this.inRoomWrap.appendChild(card);
    });
  }
}
