/* ==========================================================================
   OpenOS · apps/index.js — register every built-in application
   ========================================================================== */

import registry from '../core/registry.js';

import finder from './finder.js';
import terminal from './terminal.js';
import studio from './studio.js';
import settingsApp from './settings-app.js';
import texteditor from './texteditor.js';
import notes from './notes.js';
import calculator from './calculator.jsx';
import browser from './openbrow.js';
import photos from './photos.js';
import calendar from './calendar.js';
import appstore from './appstore.js';
import agenthub from './agenthub.js';
import cloudapp from './cloudapp.js';
import graphics from './graphics.js';
import clock from './clock.js';
import storage from './storage.js';
import paint from './paint.js';
import weather from './weather.js';
import capture from './capture.js';
import misc from './misc.js';
import taskmanager from './taskmanager.js';

export const BUILTIN = [
  finder, terminal, studio, settingsApp, texteditor, notes, calculator,
  browser, photos, calendar, appstore, cloudapp, agenthub, graphics,
  clock, weather, storage, paint, taskmanager, ...capture, ...misc,
];

export function registerBuiltins() {
  BUILTIN.forEach(app => registry.register(app));
  return registry;
}

export default registerBuiltins;
