/**********************************************************************
 * Copyright (C) 2023-2026 Red Hat, Inc.
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
import * as path from 'node:path';

import { app, nativeImage, nativeTheme } from 'electron';
import { beforeEach, expect, test, vi } from 'vitest';

import { AnimatedTray } from './tray-animate-icon.js';
import * as util from './util.js';

// to call protected methods
class TestAnimatedTray extends AnimatedTray {
  override getAssetsFolder(): string {
    return super.getAssetsFolder();
  }

  override isProd(): boolean {
    return super.isProd();
  }

  override getIconPath(iconName: string): string | Electron.NativeImage {
    return super.getIconPath(iconName);
  }

  override publishLinuxStatusNotifierTheme(): void {
    super.publishLinuxStatusNotifierTheme();
  }
}

let testAnimatedTray: TestAnimatedTray;

vi.mock(import('node:fs'), () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('')),
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

vi.mock(import('./util.js'), () => ({
  isMac: vi.fn(),
  isWindows: vi.fn(),
  isLinux: vi.fn(),
}));

const setShouldUseDarkColors = (value: boolean): void => {
  Object.defineProperty(nativeTheme, 'shouldUseDarkColors', {
    value,
    writable: true,
    configurable: true,
  });
};

beforeEach(() => {
  testAnimatedTray = new TestAnimatedTray();
  vi.clearAllMocks();

  // Reset platform detection to false by default
  vi.mocked(util.isMac).mockReturnValue(false);
  vi.mocked(util.isWindows).mockReturnValue(false);
  vi.mocked(util.isLinux).mockReturnValue(false);

  // Reset theme to light by default
  setShouldUseDarkColors(false);
});

test('valid path for icons', () => {
  // ensure we are not in prod mode
  const appPathValue = path.resolve(__dirname, 'appPath-value');

  const spyElectronGetAppPath = vi.spyOn(app, 'getAppPath').mockReturnValue(appPathValue);

  const assetFolder = testAnimatedTray.getAssetsFolder();
  expect(assetFolder).toBe(path.resolve(appPathValue, AnimatedTray.MAIN_ASSETS_FOLDER));
  expect(spyElectronGetAppPath).toHaveBeenCalled();
});

test('macOS should always use template icon', () => {
  vi.mocked(util.isMac).mockReturnValue(true);

  const iconPath = testAnimatedTray.getIconPath('default');

  expect(iconPath).toContain('tray-iconTemplate.png');
});

test('macOS should use template icon for all states', () => {
  vi.mocked(util.isMac).mockReturnValue(true);

  expect(testAnimatedTray.getIconPath('default')).toContain('tray-iconTemplate.png');
  expect(testAnimatedTray.getIconPath('empty')).toContain('tray-icon-emptyTemplate.png');
  expect(testAnimatedTray.getIconPath('error')).toContain('tray-icon-errorTemplate.png');
  expect(testAnimatedTray.getIconPath('step0')).toContain('tray-icon-step0Template.png');
});

test('Linux should always use regular icon', () => {
  // Linux is the default (non-Mac) path, no mock needed

  const iconPath = testAnimatedTray.getIconPath('default');

  expect(iconPath).toContain('tray-icon.png');
  expect(iconPath).not.toContain('Dark');
  expect(iconPath).not.toContain('Template');
});

test('Linux should use regular icon for all states', () => {
  // Linux is the default (non-Mac) path, no mock needed

  expect(testAnimatedTray.getIconPath('default')).toContain('tray-icon.png');
  expect(testAnimatedTray.getIconPath('empty')).toContain('tray-icon-empty.png');
  expect(testAnimatedTray.getIconPath('error')).toContain('tray-icon-error.png');
  expect(testAnimatedTray.getIconPath('step0')).toContain('tray-icon-step0.png');

  // Ensure none contain Template or Dark suffix
  expect(testAnimatedTray.getIconPath('default')).not.toContain('Template');
  expect(testAnimatedTray.getIconPath('default')).not.toContain('Dark');
});

test('Windows should return a NativeImage not a string', () => {
  vi.mocked(util.isWindows).mockReturnValue(true);

  const result = testAnimatedTray.getIconPath('default');

  expect(typeof result).not.toBe('string');
  expect(nativeImage.createFromBuffer).toHaveBeenCalled();
});

test('Windows should load the @2x asset', () => {
  vi.mocked(util.isWindows).mockReturnValue(true);

  testAnimatedTray.getIconPath('default');
  const calledPath = vi.mocked(readFileSync).mock.calls[0]?.[0] as string;

  expect(calledPath).toContain('@2x');
});

test('Windows should call createFromBuffer with correct logical dimensions', () => {
  vi.mocked(util.isWindows).mockReturnValue(true);

  testAnimatedTray.getIconPath('default');

  expect(nativeImage.createFromBuffer).toHaveBeenCalledWith(expect.anything(), {
    width: 16,
    height: 16,
    scaleFactor: 1.0,
  });
});

test('Windows should load @2x asset for all states', () => {
  vi.mocked(util.isWindows).mockReturnValue(true);

  testAnimatedTray.getIconPath('default');
  testAnimatedTray.getIconPath('empty');
  testAnimatedTray.getIconPath('error');
  testAnimatedTray.getIconPath('step0');

  const calledPaths = vi.mocked(readFileSync).mock.calls.map(c => c[0] as string);
  expect(calledPaths.every(p => p.includes('@2x'))).toBe(true);
});

test('manual color override to light should use template icon', () => {
  vi.mocked(util.isWindows).mockReturnValue(true);

  testAnimatedTray.setColor('light');
  testAnimatedTray.getIconPath('default');

  const calledPath = vi.mocked(readFileSync).mock.calls[0]?.[0] as string;
  expect(calledPath).toContain('Template');
  expect(calledPath).toContain('@2x');
});

test('manual color override to dark should use dark icon', () => {
  vi.mocked(util.isWindows).mockReturnValue(true);
  setShouldUseDarkColors(false);

  testAnimatedTray.setColor('dark');
  testAnimatedTray.getIconPath('default');

  const calledPath = vi.mocked(readFileSync).mock.calls[0]?.[0] as string;
  expect(calledPath).toContain('Dark');
  expect(calledPath).toContain('@2x');
});

test('dispose should remove nativeTheme listener', () => {
  testAnimatedTray.dispose();

  expect(nativeTheme.off).toHaveBeenCalledWith('updated', expect.any(Function));
});

test('Linux should write a GTK icon theme next to Electron status_icon PNGs', () => {
  vi.mocked(util.isLinux).mockReturnValue(true);
  const runtimeDir = '/run/user/1000';
  const chromeDir = 'org.chromium.Chromium.abc123';
  vi.stubEnv('XDG_RUNTIME_DIR', runtimeDir);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdirSync)
    .mockReturnValueOnce([chromeDir] as never)
    .mockReturnValueOnce(['status_icon_8.png'] as never);

  testAnimatedTray.publishLinuxStatusNotifierTheme();

  expect(writeFileSync).toHaveBeenCalledWith(
    path.join(runtimeDir, chromeDir, 'index.theme'),
    expect.stringContaining('[Icon Theme]'),
    expect.anything(),
  );
  expect(mkdirSync).toHaveBeenCalled();
  expect(copyFileSync).toHaveBeenCalled();
  vi.unstubAllEnvs();
});

test('non-Linux should not write a tray icon theme', () => {
  vi.mocked(util.isLinux).mockReturnValue(false);
  testAnimatedTray.publishLinuxStatusNotifierTheme();
  expect(writeFileSync).not.toHaveBeenCalled();
});
