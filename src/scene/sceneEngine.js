import { SkyManager } from "./skyManager.js";

export class SceneEngine {
  constructor({ hostEl, sceneLayout }){
    this.hostEl = hostEl;
    this.layout = sceneLayout;
    this.app = null;
    this.sky = null;
    this.sceneRectPx = null;
  }

  _percentRectToPx(rectPct, viewportW, viewportH){
    // rectPct is in %
    return {
      x: (rectPct.x/100) * viewportW,
      y: (rectPct.y/100) * viewportH,
      w: (rectPct.w/100) * viewportW,
      h: (rectPct.h/100) * viewportH
    };
  }

  async initSky(urls){
    // Pixi app init (lazy init)
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

    const vw = window.innerWidth;
    const vh = window.innerHeight; // dvh already handled by css but canvas needs real px

    // canvas full-screen (we will clip by mask for sceneRect)
    this.app.renderer.resize(vw, vh);

    // compute sceneRect from % of viewport
    this.sceneRectPx = this._percentRectToPx(this.layout.sceneRect, vw, vh);

    // apply mask so scene stays in grey area only
    const g = new PIXI.Graphics();
    g.rect(this.sceneRectPx.x, this.sceneRectPx.y, this.sceneRectPx.w, this.sceneRectPx.h);
    g.fill({ color: 0xffffff, alpha: 1 });
    this.app.stage.mask = g;
    this.app.stage.addChild(g); // keep mask graphic alive

    if(this.sky){
      this.sky.resizeToRect(this.sceneRectPx);
    }
  }

  updateSkyByTime(now){
    if(!this.sky) return;
    this.sky.updateByTime(now);
  }
}
