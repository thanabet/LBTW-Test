import { calcHandAngles } from "./clockHands.js";

function el(tag){
  const e = document.createElement(tag);
  return e;
}

export class HudEngine {
  constructor({ overlayEl, hudLayout }){
    this.root = overlayEl;
    this.layout = hudLayout;
    this.state = {};
    this.dialogueLang = "th";

    this.templateImg = document.getElementById("template");

    // elements
    this.monthEl = el("div");
    this.dayEl = el("div");
    this.statusEl = el("div");
    this.moodEl = el("div");
    this.dialogueEl = el("div");
    this.inRoomWrap = el("div");

    this.hourHand = el("div");
    this.minHand = el("div");

    this.root.append(
      this.monthEl, this.dayEl,
      this.statusEl, this.moodEl,
      this.dialogueEl,
      this.inRoomWrap,
      this.hourHand, this.minHand
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
  }

  resize(){
    this._applyLayout();
  }

  _templateRect(){
    return this.templateImg.getBoundingClientRect();
  }

  _applyRectPx(elm, rectPct){
    const r = this._templateRect();

    const left = r.left + (rectPct.x/100) * r.width;
    const top  = r.top  + (rectPct.y/100) * r.height;
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

    const slots = L.inRoom.slots;
    if(slots?.length){
      const first = slots[0];
      const r = this._templateRect();

      const left = r.left + (first.x/100) * r.width;
      const top  = r.top  + (first.y/100) * r.height;

      this.inRoomWrap.style.left = left + "px";
      this.inRoomWrap.style.top  = top + "px";
    }

    // clock hands
    const c = L.clock.center;
    const r = this._templateRect();

    const cx = r.left + (c.x/100) * r.width;
    const cy = r.top  + (c.y/100) * r.height;

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

  setState(state){
    this.state = state || {};
    this.statusEl.textContent = this.state.status || "";
    this.moodEl.textContent = this.state.mood || "";

    const dlg = this.state.dialogue || {};
    this.dialogueEl.textContent = dlg[this.dialogueLang] || "";

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

    list.slice(0, slots.length).forEach((id,i)=>{
      const s = slots[i];
      const r = this._templateRect();

      const w = (s.w/100)*r.width;
      const h = (s.h/100)*r.height;

      const card = el("div");
      card.textContent = id.toUpperCase();
      card.style.width = w + "px";
      card.style.height = h + "px";
      card.style.display = "flex";
      card.style.alignItems = "center";
      card.style.justifyContent = "center";
      card.style.background = "rgba(0,0,0,0.08)";
      card.style.borderRadius = "10px";
      card.style.fontWeight = "800";
      card.style.color = "#2a2a2a";

      this.inRoomWrap.appendChild(card);
    });
  }
}
