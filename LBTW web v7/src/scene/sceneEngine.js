import { SkyManager } from "./skyManager.js";

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;
    this.app = null;
    this.sky = null;
    this.sceneRectPx = null;
  }

  _percentRectToPx(rectPct, w, h){
    return {
      x: (rectPct.x/100) * w,
      y: (rectPct.y/100) * h,
      w: (rectPct.w/100) * w,
      h: (rectPct.h/100) * h
    };
  }

  async initSky(urls){
    if(!this.app){
      this.app = new PIXI.Application();
      await this.app.init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.max(1, window.devicePixelRatio || 1),
        autoDensity: true
      });
      this.hostEl.appendChild(this.app.canvas);
    }

    this.sky = new SkyManager(this.app.stage);
    await this.sky.load(urls);
  }

  resize(){
    if(!this.app) return;

    // ✅ ใช้ขนาดของ stage จริง (scene-host อยู่ใน stage แล้ว)
    const rect = this.hostEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this.app.renderer.resize(w, h);

    // ✅ sceneRect อิงจาก stage (ไม่ใช่ viewport)
    this.sceneRectPx = this._percentRectToPx(this.layout.sceneRect, w, h);

    // mask เฉพาะพื้นที่สีเทา
    const g = new PIXI.Graphics();
    g.rect(this.sceneRectPx.x, this.sceneRectPx.y, this.sceneRectPx.w, this.sceneRectPx.h);
    g.fill({ color: 0xffffff, alpha: 1 });

    this.app.stage.mask = g;
    this.app.stage.addChild(g);

    if(this.sky){
      this.sky.resizeToRect(this.sceneRectPx);
    }
  }

  updateSkyByTime(now){
    if(!this.sky) return;
    this.sky.updateByTime(now);
  }
}
