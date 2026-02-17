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

    // portrait animation
    this._portraitAnimTimer = null;
    this._portraitAnimIndex = 0;
    this._portraitAnimSig = null;
    this._lastEmotion = null;

    // status icon
    this.statusIconEl = el("img");
    this.statusIconEl.style.position = "absolute";
    this.statusIconEl.style.objectFit = "contain";
    this.statusIconEl.style.userSelect = "none";
    this.statusIconEl.style.pointerEvents = "none";
    this.statusIconEl.style.display = "none";

    // ✅ NEW: status icon animation (เหมือน portrait)
    this._statusAnimTimer = null;
    this._statusAnimIndex = 0;
    this._statusAnimSig = null;
    this._lastStatusIcon = null;

    // logo hotspot (optional)
    this.logoHotspotEl = el("div");
    this.logoHotspotEl.style.position = "absolute";
    this.logoHotspotEl.style.background = "transparent";
    this.logoHotspotEl.style.pointerEvents = "auto";
    this.logoHotspotEl.style.cursor = "pointer";
    this.logoHotspotEl.style.display = "none";

    this.root.append(
      this.monthEl, this.dayEl,
      this.statusEl, this.moodEl,
      this.dialogueEl,
      this.inRoomWrap,
      this.hourHand, this.minHand,
      this.portraitEl,
      this.statusIconEl,
      this.logoHotspotEl
    );

    for(const e of [this.monthEl,this.dayEl,this.statusEl,this.moodEl,this.dialogueEl]){
      e.style.position = "absolute";
      e.style.color = "#2a2a2a";
      e.style.fontWeight = "700";
      e.style.userSelect = "none";
    }

    // calendar clickable
    this.monthEl.style.cursor = "pointer";
    this.dayEl.style.cursor = "pointer";

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

    // modal system
    this._initModal();

    // click portrait -> profile card
    this.portraitEl.addEventListener("click", () => {
      const src = this._getProfileCardSrc();
      if (src) this._openModal(src);
    });

    // click calendar -> schedule card
    const openSchedule = () => {
      const src = this._getScheduleCardSrc();
      if (src) this._openModal(src);
    };
    this.monthEl.addEventListener("click", openSchedule);
    this.dayEl.addEventListener("click", openSchedule);

    // click logo -> intromie url
    this.logoHotspotEl.addEventListener("click", () => {
      const url = this._getIntromieUrl();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });

    this.setPortrait("normal");
  }

  /* ---------------- Modal (Popup Card) ---------------- */

  _initModal(){
    this.modalBackdrop = el("div");
    this.modalBackdrop.style.position = "fixed";
    this.modalBackdrop.style.left = "0";
    this.modalBackdrop.style.top = "0";
    this.modalBackdrop.style.width = "100vw";
    this.modalBackdrop.style.height = "100vh";
    this.modalBackdrop.style.display = "none";
    this.modalBackdrop.style.alignItems = "center";
    this.modalBackdrop.style.justifyContent = "center";
    this.modalBackdrop.style.background = "rgba(0,0,0,0.55)";
    this.modalBackdrop.style.zIndex = "999999";

    this.modalCard = el("div");
    this.modalCard.style.position = "relative";
    this.modalCard.style.maxWidth = "92vw";
    this.modalCard.style.maxHeight = "88vh";

    this.modalImg = el("img");
    this.modalImg.style.display = "block";
    this.modalImg.style.maxWidth = "92vw";
    this.modalImg.style.maxHeight = "88vh";
    this.modalImg.style.borderRadius = "16px";
    this.modalImg.style.userSelect = "none";
    this.modalImg.style.webkitUserSelect = "none";

    this.modalClose = el("button");
    this.modalClose.type = "button";
    this.modalClose.textContent = "✕";
    this.modalClose.style.position = "absolute";
    this.modalClose.style.right = "10px";
    this.modalClose.style.top = "10px";
    this.modalClose.style.width = "36px";
    this.modalClose.style.height = "36px";
    this.modalClose.style.borderRadius = "999px";
    this.modalClose.style.border = "none";
    this.modalClose.style.cursor = "pointer";
    this.modalClose.style.background = "rgba(0,0,0,0.65)";
    this.modalClose.style.color = "#fff";
    this.modalClose.style.fontSize = "18px";
    this.modalClose.style.lineHeight = "36px";

    this.modalCard.appendChild(this.modalImg);
    this.modalCard.appendChild(this.modalClose);
    this.modalBackdrop.appendChild(this.modalCard);
    document.body.appendChild(this.modalBackdrop);

    this.modalClose.addEventListener("click", () => this._closeModal());
    this.modalBackdrop.addEventListener("click", (e) => {
      if (e.target === this.modalBackdrop) this._closeModal();
    });
  }

  _openModal(imgSrc){
    this.modalImg.src = imgSrc;
    this.modalBackdrop.style.display = "flex";
  }

  _closeModal(){
    this.modalBackdrop.style.display = "none";
  }

  _getProfileCardSrc(){
    return (
      this.state.profileCardSrc ||
      this.layout.profileCardSrc ||
      "assets/cards/profile_card.png"
    );
  }

  _getScheduleCardSrc(){
    return (
      this.state.scheduleCardSrc ||
      this.layout.scheduleCardSrc ||
      "assets/cards/schedule_card.png"
    );
  }

  _getIntromieUrl(){
    return this.layout.intromieUrl || null;
  }

  /* ---------------- Layout / Resize ---------------- */

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

    if (L.logoHotspot) {
      this.logoHotspotEl.style.display = "block";
      this._applyRectPx(this.logoHotspotEl, L.logoHotspot);
    } else {
      this.logoHotspotEl.style.display = "none";
    }

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

  /* ---------------- Time / Text ---------------- */

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

  /* ---------------- Shared Anim Signature ---------------- */

  _makeAnimSig(anim){
    const frames = (anim.frames || []).join("|");
    const durs = (anim.durationsMs || []).join(",");
    const loop = anim.loop ? "1" : "0";
    return `${frames}::${durs}::${loop}`;
  }

  /* ---------------- Portrait Anim ---------------- */

  _stopPortraitAnim(){
    if(this._portraitAnimTimer){
      clearTimeout(this._portraitAnimTimer);
      this._portraitAnimTimer = null;
    }
  }

  _playPortraitAnim(anim){
    this._stopPortraitAnim();
    if(!anim?.frames?.length) return;

    this._portraitAnimIndex = 0;

    const playFrame = () => {
      const frameName = anim.frames[this._portraitAnimIndex];
      const duration = anim.durationsMs?.[this._portraitAnimIndex] ?? 500;

      this.portraitEl.src = `assets/portrait/${frameName}.png`;

      this._portraitAnimIndex++;
      if(this._portraitAnimIndex >= anim.frames.length){
        if(anim.loop) this._portraitAnimIndex = 0;
        else return;
      }

      this._portraitAnimTimer = setTimeout(playFrame, duration);
    };

    playFrame();
  }

  setPortrait(emotion){
    this._stopPortraitAnim();
    this._portraitAnimSig = null;
    this.portraitEl.src = `assets/portrait/${emotion}.png`;
  }

  /* ---------------- Status Icon Anim ---------------- */

  _stopStatusAnim(){
    if(this._statusAnimTimer){
      clearTimeout(this._statusAnimTimer);
      this._statusAnimTimer = null;
    }
  }

  _playStatusAnim(anim){
    this._stopStatusAnim();
    if(!anim?.frames?.length) return;

    this._statusAnimIndex = 0;
    this.statusIconEl.style.display = "block";

    const playFrame = () => {
      const frameName = anim.frames[this._statusAnimIndex];
      const duration = anim.durationsMs?.[this._statusAnimIndex] ?? 400;

      this.statusIconEl.src = `assets/icons/${frameName}.png`;

      this._statusAnimIndex++;
      if(this._statusAnimIndex >= anim.frames.length){
        if(anim.loop) this._statusAnimIndex = 0;
        else return;
      }

      this._statusAnimTimer = setTimeout(playFrame, duration);
    };

    playFrame();
  }

  setStatusIcon(iconKey){
    // ถ้าใช้รูปนิ่ง → หยุด anim ก่อน
    this._stopStatusAnim();
    this._statusAnimSig = null;

    if(!iconKey){
      this.statusIconEl.style.display = "none";
      this.statusIconEl.removeAttribute("src");
      return;
    }
    this.statusIconEl.src = `assets/icons/${iconKey}.png`;
    this.statusIconEl.style.display = "block";
  }

  /* ---------------- State ---------------- */

  setState(state){
    this.state = state || {};
    this.statusEl.textContent = this.state.status || "";
    this.moodEl.textContent = this.state.mood || "";

    const dlg = this.state.dialogue || {};
    this.dialogueEl.textContent = dlg[this.dialogueLang] || "";

    // portrait
    if (this.state.portraitAnim){
      const sig = this._makeAnimSig(this.state.portraitAnim);
      if(sig !== this._portraitAnimSig){
        this._portraitAnimSig = sig;
        this._lastEmotion = this.state.emotion || null;
        this._playPortraitAnim(this.state.portraitAnim);
      }
    } else if (this.state.emotion) {
      if(this.state.emotion !== this._lastEmotion){
        this._lastEmotion = this.state.emotion;
        this.setPortrait(this.state.emotion);
      }
    }

    // ✅ status icon (anim has priority)
    if (this.state.statusIconAnim){
      const sig = this._makeAnimSig(this.state.statusIconAnim);
      if(sig !== this._statusAnimSig){
        this._statusAnimSig = sig;
        this._lastStatusIcon = this.state.statusIcon || null;
        this._playStatusAnim(this.state.statusIconAnim);
      }
    } else {
      if(this.state.statusIcon !== this._lastStatusIcon){
        this._lastStatusIcon = this.state.statusIcon;
        this.setStatusIcon(this.state.statusIcon);
      }
    }

    // in room
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
