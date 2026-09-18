/**********************************************************************
 * Copyright (C) 2022-2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { Tray } from 'electron';
import { app, nativeImage, nativeTheme } from 'electron';

import product from '/@product.json' with { type: 'json' };

import { isLinux, isMac, isWindows } from './util.js';

const LINUX_SNI_THEME_INDEX = `[Icon Theme]
Name=ElectronStatusNotifier
Comment=Makes Electron StatusNotifier PNGs visible to GNOME AppIndicators
Directories=16x16/apps,22x22/apps,24x24/apps,32x32/apps

[16x16/apps]
Size=16
Context=Applications
Type=Fixed

[22x22/apps]
Size=22
Context=Applications
Type=Fixed

[24x24/apps]
Size=24
Context=Applications
Type=Fixed

[32x32/apps]
Size=32
Context=Applications
Type=Fixed
`;

export type TrayIconStatus = 'initialized' | 'updating' | 'error' | 'ready';

export class AnimatedTray {
  private status: TrayIconStatus;
  private trayIconLoopId = 0;
  private animatedInterval: NodeJS.Timeout | undefined = undefined;
  private tray: Tray | undefined = undefined;
  private color = 'default'; // default, light, dark
  private linuxThemeTimer: NodeJS.Timeout | undefined = undefined;
  private readonly onThemeUpdated: () => void;
  static readonly MAIN_ASSETS_FOLDER = 'packages/main/src/assets';

  constructor() {
    this.status = 'initialized';
    this.updateIcon();

    // refresh icon when theme is being updated (especially for Windows as for macOS we always use template icon and on linux the menu bar is not related to the theme)
    this.onThemeUpdated = (): void => {
      this.updateIcon();
    };
    nativeTheme.on('updated', this.onThemeUpdated);
  }

  protected isProd(): boolean {
    return import.meta.env.PROD;
  }

  protected getAssetsFolder(): string {
    return path.resolve(app.getAppPath(), AnimatedTray.MAIN_ASSETS_FOLDER);
  }

  protected animateTrayIcon(): void {
    if (this.trayIconLoopId === 4) {
      this.trayIconLoopId = 0;
    }
    const imagePath = this.getIconPath(`step${this.trayIconLoopId}`);
    this.trayIconLoopId++;
    this.setTrayImage(imagePath);
  }

  /**
   * Electron's Linux StatusNotifierItem writes tray frames as loose
   * `status_icon_N.png` files in a temp dir and sets that dir as IconThemePath.
   * GNOME AppIndicators only resolves GTK icon themes, so those frames show as a
   * gear. Drop a minimal index.theme (+ sized copies) so lookup succeeds and
   * follows IconName updates.
   */
  protected publishLinuxStatusNotifierTheme(): void {
    if (!isLinux()) {
      return;
    }

    const roots = new Set<string>();
    if (process.env.XDG_RUNTIME_DIR) {
      roots.add(process.env.XDG_RUNTIME_DIR);
    }
    roots.add(tmpdir());

    for (const root of roots) {
      if (!existsSync(root)) {
        continue;
      }
      let names: string[] = [];
      try {
        names = readdirSync(root);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.includes('Chromium') && !name.includes('chromium')) {
          continue;
        }
        const dir = path.join(root, name);
        let files: string[] = [];
        try {
          files = readdirSync(dir);
        } catch {
          continue;
        }
        const pngs = files.filter(file => file.startsWith('status_icon_') && file.endsWith('.png'));
        if (pngs.length === 0) {
          continue;
        }
        try {
          writeFileSync(path.join(dir, 'index.theme'), LINUX_SNI_THEME_INDEX, { encoding: 'utf8' });
          for (const size of [16, 22, 24, 32]) {
            const destDir = path.join(dir, `${size}x${size}`, 'apps');
            mkdirSync(destDir, { recursive: true });
            for (const png of pngs) {
              copyFileSync(path.join(dir, png), path.join(destDir, png));
            }
          }
        } catch (error) {
          console.warn('Unable to publish Linux tray icon theme', error);
        }
      }
    }
  }

  protected scheduleLinuxTrayThemePublish(): void {
    if (!isLinux()) {
      return;
    }
    this.publishLinuxStatusNotifierTheme();
    if (this.linuxThemeTimer) {
      clearTimeout(this.linuxThemeTimer);
    }
    this.linuxThemeTimer = setTimeout(() => {
      this.publishLinuxStatusNotifierTheme();
    }, 50);
  }

  protected setTrayImage(image: string | Electron.NativeImage): void {
    this.tray?.setImage(image);
    this.scheduleLinuxTrayThemePublish();
  }

  public setTray(tray: Tray): void {
    this.tray = tray;
    this.updateIcon();
  }

  // set the color of the icon if we're manually overriding the theme
  // and then update the current icon
  public setColor(color: string): void {
    this.color = color;
    this.updateIcon();
  }

  // provide the path to the icon depending on theme and platform
  protected getIconPath(iconName: string): string | Electron.NativeImage {
    let name: string;
    if (iconName === 'default') {
      name = '';
    } else {
      name = `-${iconName}`;
    }
    let suffix = '';
    // on Mac, always pickup template icon
    if (isMac()) {
      suffix = 'Template';
    }
    // on Windows and Linux, always use regular icon (no suffix)

    // Regardless what is the theme, if the user has set the color to light, we use the light icon, same as dark, etc.
    if (this.color === 'light') {
      suffix = 'Template';
    } else if (this.color === 'dark') {
      suffix = 'Dark';
    }

    const assetsFolder = this.getAssetsFolder();

    // On Windows, addRepresentation is silently ignored by Electron so we load
    // the @2x asset directly via createFromBuffer with explicit logical dimensions
    // to ensure sharp rendering on HiDPI displays (e.g. 200% scaling at 5K)
    if (isWindows()) {
      const path2x = path.resolve(assetsFolder, `tray-icon${name}${suffix}@2x.png`);
      return nativeImage.createFromBuffer(readFileSync(path2x), {
        width: 16,
        height: 16,
        scaleFactor: 1.0,
      });
    }

    return path.resolve(assetsFolder, `tray-icon${name}${suffix}.png`);
  }

  protected updateIcon(): void {
    // do nothing until we have a tray
    if (!this.tray) {
      return;
    }

    // stop any existing interval
    if (this.animatedInterval) {
      clearInterval(this.animatedInterval);
    }
    switch (this.status) {
      case 'initialized':
        this.setTrayImage(this.getIconPath('empty'));
        this.tray.setToolTip(`${product.name} is initialized`);
        break;
      case 'error':
        this.setTrayImage(this.getIconPath('error'));
        this.tray.setToolTip(`${product.name} has an error`);
        break;
      case 'ready':
        this.setTrayImage(this.getIconPath('default'));
        this.tray.setToolTip(`${product.name} is ready`);
        break;
      case 'updating':
        this.animatedInterval = setInterval(this.animateTrayIcon.bind(this), 1000);
        this.tray.setToolTip(`${product.name}: resources are being updated`);
        break;
    }
  }

  getDefaultImage(): string | Electron.NativeImage {
    return this.getIconPath('empty');
  }

  setStatus(status: TrayIconStatus): void {
    this.status = status;
    this.updateIcon();
  }

  dispose(): void {
    if (this.animatedInterval) {
      clearInterval(this.animatedInterval);
      this.animatedInterval = undefined;
    }
    if (this.linuxThemeTimer) {
      clearTimeout(this.linuxThemeTimer);
      this.linuxThemeTimer = undefined;
    }
    nativeTheme.off('updated', this.onThemeUpdated);
  }
}
