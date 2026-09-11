/* ==========================================================================
   OpenOS · registry.js — the application registry
   Native apps register themselves; OpenSharp apps are loaded from the VFS.
   ========================================================================== */

import { Bus } from './util.js';

export const CATEGORIES = {
  system: 'Sistem', work: 'Çalışma', dev: 'Geliştirme',
  media: 'Medya', internet: 'İnternet', util: 'Araçlar', user: 'Uygulamalarım',
};

class Registry {
  constructor() {
    this.bus = new Bus();
    this.apps = new Map();
  }

  /** register({id, name, glyph, tint, category, mount}) */
  register(def) {
    if (!def || !def.id) throw new Error('App needs an id');
    const app = {
      name: def.id, glyph: 'window', tint: ['#8e8e93', '#5a5a60'],
      category: 'util', singleton: true, resizable: true,
      width: 760, height: 520, minWidth: 320, minHeight: 220,
      hideInLaunchpad: false, kind: 'native', ...def,
    };
    this.apps.set(app.id, app);
    this.bus.emit('register', app);
    return app;
  }

  unregister(id) {
    const a = this.apps.get(id);
    if (a) { this.apps.delete(id); this.bus.emit('unregister', a); }
    return !!a;
  }

  get(id) { return this.apps.get(id) || null; }
  has(id) { return this.apps.has(id); }
  all() { return [...this.apps.values()]; }
  visible() { return this.all().filter(a => !a.hideInLaunchpad); }
  byCategory() {
    const out = {};
    for (const a of this.visible()) (out[a.category] ||= []).push(a);
    for (const k in out) out[k].sort((x, y) => x.name.localeCompare(y.name));
    return out;
  }
  search(q) {
    const s = q.toLowerCase().trim();
    if (!s) return [];
    return this.visible()
      .filter(a => a.name.toLowerCase().includes(s) || a.id.includes(s) ||
                   (a.keywords || []).some(k => k.includes(s)))
      .slice(0, 12);
  }
}

export const registry = new Registry();
export default registry;
