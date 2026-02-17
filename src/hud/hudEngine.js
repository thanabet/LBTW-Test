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

    // ===== portrait animation runtime =====
    this._portraitTimer = null;   // setTimeout id
    this._portraitKey = null;     // dedupe key
    this._portraitStop = false;   // guard

    // default portrait (static)
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

  // ===== Portrait (static) =====
  setPortrait(emotion){
    this._stopPortraitAnim();
    this._portraitKey = `static:${emotion}`;
    this.portraitEl.src = `assets/portrait/${emotion}.png`;
  }

  // ===== Portrait (animated: per-frame durations) =====
  // frames: 2-3 (หรือมากกว่านี้ก็ได้)
  // durationsMs: array เช่น [900,120,900] = เฟรม1ค้าง900ms -> เฟรม2ค้าง120ms -> เฟรม3ค้าง900ms
  setPortraitAnimated(emotion, frames = 2, durationsMs = null, defaultIntervalMs = 850){
    const n = Math.max(1, Math.min(10, Number(frames) || 1));
    const defIv = Math.max(80, Number(defaultIntervalMs) || 850);

    // normalize durations
    let ds = null;
    if (Array.isArray(durationsMs) && durationsMs.length > 0){
      ds = durationsMs.map(v => Math.max(40, Number(v) || defIv));
    }

    // ทำ key เพื่อไม่ restart ซ้ำๆ
    const key = `anim:${emotion}:${n}:${ds ? ds.join(",") : "def:"+defIv}`;
    if (this._portraitKey === key) return;

    this._stopPortraitAnim();
    this._portraitKey = key;

    if (n <= 1){
      this.portraitEl.src = `assets/portrait/${emotion}.png`;
      return;
    }

    this._portraitStop = false;
    let frameIndex = 1;

    const step = () => {
      if (this._portraitStop) return;

      // set frame image
      this.portraitEl.src = `assets/portrait/${emotion}_${frameIndex}.png`;

      // pick duration for THIS frame
      // ถ้า ds สั้นกว่า n: จะวนซ้ำตามลำดับ ds
      const d = ds ? ds[(frameIndex - 1) % ds.length] : defIv;

      // next frame
      frameIndex++;
      if (frameIndex > n) frameIndex = 1;

      this._portraitTimer = setTimeout(step, d);
    };

    step();
  }

  _stopPortraitAnim(){
    this._portraitStop = true;
    if (this._portraitTimer){
      clearTimeout(this._portraitTimer);
      this._portraitTimer = null;
    }
  }

  // ===== Status icon =====
  setStatusIcon(iconKey){
    if(!iconKey){
      this.statusIconEl.style.display = "none";
      this.statusIconEl.removeAttribute("src");
      return;
    }
    this.statusIconEl.src = `assets/icons/${iconKey}.png`;
    this.statusIconEl.style.display = "block";
  }

  setState(state){
    this.state = state || {};
    this.statusEl.textContent = this.state.status || "";
    this.moodEl.textContent = this.state.mood || "";

    const dlg = this.state.dialogue || {};
    this.dialogueEl.textContent = dlg[this.dialogueLang] || "";

    // portrait: รองรับ per-frame speed
    if (this.state.emotion) {
      const frames = Number(this.state.portraitFrames || 1);

      // ✅ ใหม่: ใส่ array ความเร็วแต่ละเฟรมได้
      const durations = Array.isArray(this.state.portraitFrameDurationsMs)
        ? this.state.portraitFrameDurationsMs
        : null;

      // fallback (กรณีไม่ได้ใส่ array)
      const defaultIntervalMs = Number(this.state.portraitIntervalMs || 850);

      if (frames >= 2) this.setPortraitAnimated(this.state.emotion, frames, durations, defaultIntervalMs);
      else this.setPortrait(this.state.emotion);
    }

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
