import { calcHandAngles } from "./clockHands.js";

function el(tag, className){
  const e = document.createElement(tag);
  if(className) e.className = className;
  return e;
}

export class HudEngine {
  constructor({ overlayEl, hudLayout }){
    this.root = overlayEl;
    this.layout = hudLayout;
    this.state = {};
    this.dialogueLang = "th";

    // elements
    this.monthEl = el("div");
    this.dayEl = el("div");
    this.statusEl = el("div");
    this.moodEl = el("div");

    this.dialogueEl = el("div");
    this.inRoomWrap = el("div");

    // clock hands
    this.hourHand = el("div");
    this.minHand = el("div");

    // append
    this.root.append(
      this.monthEl, this.dayEl,
      this.statusEl, this.moodEl,
      this.dialogueEl,
      this.inRoomWrap,
      this.hourHand, this.minHand
    );

    // base styles
    for(const e of [this.monthEl,this.dayEl,this.statusEl,this.moodEl,this.dialogueEl]){
      e.style.position = "absolute";
      e.style.color = "#2a2a2a";
      e.style.fontWeight = "700";
      e.style.textShadow = "0 1px 0 rgba(255,255,255,0.25)";
      e.style.userSelect = "none";
    }

    // dialogue tap
    this.dialogueEl.style.cursor = "pointer";
    this.dialogueEl.style.display = "flex";
    this.dialogueEl.style.alignItems = "center";
    this.dialogueEl.style.justifyContent = "center";
    this.dialogueEl.style.textAlign = "center";
    this.dialogueEl.style.padding = "0.5rem";

    // hands
    for(const h of [this.hourHand, this.minHand]){
      h.style.position = "absolute";
      h.style.transformOrigin = "50% 90%";
      h.style.background = "rgba(40,40,40,0.9)";
      h.style.borderRadius = "999px";
      h.style.pointerEvents = "none";
    }

    // in-room
    this.inRoomWrap.style.position = "absolute";
    this.inRoomWrap.style.display = "flex";
    this.inRoomWrap.style.gap = "0.5rem";
    this.inRoomWrap.style.pointerEvents = "auto";
  }

  resize(){
    // positions are computed every frame-safe, but okay to do here
    this._applyLayout();
  }

  _applyRect(elm, rect){
    elm.style.left = rect.x + "vw";
    elm.style.top = rect.y + "vh";
    elm.style.width = rect.w + "vw";
    elm.style.height = rect.h + "vh";
  }

  _applyLayout(){
    // Convert % (of template) -> viewport units.
    // เราใช้ vw/vh แบบง่ายก่อน (เพราะ template cover เต็มจอ)
    // ถ้าอยาก “เป๊ะขั้นสุด” เราจะย้ายไปคำนวณจาก boundingClientRect ของรูป template ได้
    const L = this.layout;

    // calendar
    this._applyRect(this.monthEl, L.calendar.month);
    this._applyRect(this.dayEl,   L.calendar.day);

    // status/mood
    this._applyRect(this.statusEl, L.statusText);
    this._applyRect(this.moodEl,   L.moodText);

    // dialogue
    this._applyRect(this.dialogueEl, L.dialogue);

    // in-room slots area: ใช้ตำแหน่ง slot แรกเป็น anchor
    const slots = L.inRoom.slots;
    if(slots?.length){
      const minX = Math.min(...slots.map(s=>s.x));
      const topY = slots[0].y;
      this.inRoomWrap.style.left = `${minX}vw`;
      this.inRoomWrap.style.top = `${topY}vh`;
    }

    // clock hands: set center & size
    const c = L.clock.center;
    const vw = window.innerWidth;
    const hourLen = (L.clock.hourLenPctOfScreenW/100) * vw;
    const minLen  = (L.clock.minLenPctOfScreenW/100) * vw;
    const t = L.clock.thicknessPx;

    // hour hand
    this.hourHand.style.width = `${t}px`;
    this.hourHand.style.height = `${hourLen}px`;
    this.hourHand.style.left = `calc(${c.x}vw - ${t/2}px)`;
    this.hourHand.style.top  = `calc(${c.y}vh - ${hourLen*0.9}px)`;

    // minute hand
    this.minHand.style.width = `${t}px`;
    this.minHand.style.height = `${minLen}px`;
    this.minHand.style.left = `calc(${c.x}vw - ${t/2}px)`;
    this.minHand.style.top  = `calc(${c.y}vh - ${minLen*0.9}px)`;

    // font sizes (หยาบก่อน เดี๋ยวปรับตามตา)
    this.monthEl.style.fontSize = "14px";
    this.dayEl.style.fontSize = "28px";
    this.statusEl.style.fontSize = "16px";
    this.moodEl.style.fontSize = "16px";
    this.dialogueEl.style.fontSize = "16px";
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

    // dialogue
    const dlg = this.state.dialogue || {};
    this.dialogueEl.textContent = (dlg[this.dialogueLang] || "") || "";

    // in-room cards (demo เป็นกล่องชื่อก่อน)
    this._renderInRoom(this.state.inRoom || []);
  }

  enableDialogueToggle(onToggle){
    this.dialogueEl.addEventListener("click", () => onToggle?.());
  }

  toggleDialogueLang(){
    this.dialogueLang = (this.dialogueLang === "th") ? "en" : "th";
    this.setState(this.state);
  }

  _renderInRoom(list){
    const slots = this.layout.inRoom.slots || [];
    this.inRoomWrap.innerHTML = "";

    list.slice(0, slots.length).forEach((id, i) => {
      const s = slots[i];
      const card = el("div");
      card.textContent = id.toUpperCase();
      card.style.width = `${s.w}vw`;
      card.style.height = `${s.h}vh`;
      card.style.display = "flex";
      card.style.alignItems = "center";
      card.style.justifyContent = "center";
      card.style.borderRadius = "10px";
      card.style.background = "rgba(0,0,0,0.08)";
      card.style.color = "#2a2a2a";
      card.style.fontWeight = "800";
      card.style.cursor = "pointer";
      card.addEventListener("click", () => alert(`Character: ${id}`));
      this.inRoomWrap.appendChild(card);
    });
  }
}
