export class SkyManager {
  constructor(stage){
    this.stage = stage;
    this.textures = [];
    this.a = new PIXI.Sprite();
    this.b = new PIXI.Sprite();

    this.a.alpha = 1;
    this.b.alpha = 0;

    this.stage.addChild(this.a, this.b);

    this.currentIndex = 0;     // committed index (หลัง fade เสร็จ)
    this.targetIndex = 0;      // index ที่กำลังจะไป
    this.fadeStart = 0;
    this.fadeDurationMs = 90_000; // 90 วิ (ปรับได้)
    this.rect = { x:0, y:0, w:100, h:100 };

    // ✅ NEW: กัน fade ซ้อน/เริ่มซ้ำ
    this.isFading = false;
    this._fadeToken = 0;
  }

  async load(urls){
    this.textures = await Promise.all(
      urls.map(u => PIXI.Assets.load(u))
    );

    // ✅ สำคัญ: ตั้ง sky ให้ตรงเวลาปัจจุบันทันที
    const now = new Date();
    const idx = this._timeToIndex(now);

    this.currentIndex = idx;
    this.targetIndex = idx;

    this.a.texture = this.textures[idx];
    this.b.texture = this.textures[idx];

    // cover จะถูกเรียกจาก resizeToRect() ตอน scene.resize()
  }

  resizeToRect(rect){
    this.rect = rect;
    this._cover(this.a, rect);
    this._cover(this.b, rect);
  }

  _cover(sprite, rect){
    if(!sprite.texture?.width) return;

    const tw = sprite.texture.width;
    const th = sprite.texture.height;

    const s = Math.max(rect.w / tw, rect.h / th);
    sprite.scale.set(s);

    sprite.x = rect.x + (rect.w - tw * s) / 2;
    sprite.y = rect.y + (rect.h - th * s) / 2;
  }

  _timeToIndex(now){
    const h = now.getHours() + now.getMinutes()/60;

    if(h >= 5.5 && h < 8) return 0;      // sunrise
    if(h >= 8 && h < 17.5) return 1;     // day
    if(h >= 17.5 && h < 19) return 2;    // sunset
    if(h >= 19 && h < 22.5) return 3;    // early night
    return 4;                             // deep night
  }

  updateByTime(now){
    const idx = this._timeToIndex(now);

    // ✅ ถ้าเหมือนเดิม ไม่ต้องทำอะไร
    // - ถ้ากำลัง fade อยู่ ให้เทียบกับ targetIndex (กันเริ่มซ้ำทุกเฟรม)
    // - ถ้าไม่ได้ fade ให้เทียบกับ currentIndex (ปกติ)
    if(this.isFading){
      if(idx === this.targetIndex) return;
      // ถ้าเวลาข้ามไปช่วงใหม่ระหว่าง fade (โอกาสน้อยมาก) -> ข้ามไป retarget รอบนี้
      // (ปลอดภัยสุด: รอให้ fade เดิมจบก่อน แล้วค่อยเปลี่ยนใน tick ถัดไป)
      return;
    } else {
      if(idx === this.currentIndex) return;
    }

    // ✅ เริ่ม fade (ครั้งเดียว)
    this.isFading = true;
    const token = ++this._fadeToken;

    this.targetIndex = idx;
    this.fadeStart = performance.now();

    this.b.texture = this.textures[this.targetIndex];
    this._cover(this.b, this.rect);

    this.b.alpha = 0;
    this.a.alpha = 1;

    const animateFade = () => {
      // ✅ ถ้ามี fade ใหม่กว่าเข้ามา (กันซ้อน) ให้หยุดตัวเก่า
      if(token !== this._fadeToken) return;

      const t = (performance.now() - this.fadeStart) / this.fadeDurationMs;
      const clamped = Math.min(1, t);

      // smoothstep
      const s = clamped * clamped * (3 - 2 * clamped);

      this.b.alpha = s;
      this.a.alpha = 1 - s;

      if(clamped < 1){
        requestAnimationFrame(animateFade);
      } else {
        // commit
        this.currentIndex = this.targetIndex;
        this.a.texture = this.textures[this.currentIndex];
        this._cover(this.a, this.rect);
        this.a.alpha = 1;
        this.b.alpha = 0;

        this.isFading = false;
      }
    };

    requestAnimationFrame(animateFade);
  }
}
