const { globalShortcut, screen } = require('electron');
const shortcutsRepository = require('./repositories');
const internalBridge = require('../../bridge/internalBridge');
const askService = require('../ask/askService');


class ShortcutsService {
    constructor() {
        this.lastVisibleWindows = new Set(['header']);
        this.mouseEventsIgnored = false;
        this.windowPool = null;
        this.allWindowVisibility = true;
        this.focusedShortcuts = new Map();
    }

    initialize(windowPool) {
        this.windowPool = windowPool;
        const header = windowPool.get('header');
        header.webContents.on('before-input-event', (event, input) => {
            if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return;
            const key = /^Key[A-Z]$/.test(input.code) ? input.code.slice(3) : input.key;
            const accelerator = [input.meta && 'Cmd', input.control && 'Ctrl', input.alt && 'Alt', input.shift && 'Shift', key]
                .filter(Boolean).join('+').toLowerCase();
            const callback = this.focusedShortcuts.get(accelerator);
            if (!callback) return;
            event.preventDefault();
            callback();
        });
        internalBridge.on('reregister-shortcuts', () => {
            console.log('[ShortcutsService] Reregistering shortcuts due to header state change.');
            this.registerShortcuts();
        });
        console.log('[ShortcutsService] Initialized with dependencies and event listener.');
    }

    async openShortcutSettingsWindow () {
        const keybinds = await this.loadKeybinds();
        const shortcutWin = this.windowPool.get('shortcut-settings');
        shortcutWin.webContents.send('shortcut:loadShortcuts', keybinds);

        globalShortcut.unregisterAll();
        internalBridge.emit('window:requestVisibility', { name: 'shortcut-settings', visible: true });
        console.log('[ShortcutsService] Shortcut settings window opened.');
        return { success: true };
    }

    async closeShortcutSettingsWindow () {
        await this.registerShortcuts();
        internalBridge.emit('window:requestVisibility', { name: 'shortcut-settings', visible: false });
        console.log('[ShortcutsService] Shortcut settings window closed.');
        return { success: true };
    }

    async handleSaveShortcuts(newKeybinds) {
        try {
            await this.saveKeybinds(newKeybinds);
            await this.closeShortcutSettingsWindow();
            return { success: true };
        } catch (error) {
            console.error("Failed to save shortcuts:", error);
            await this.closeShortcutSettingsWindow();
            return { success: false, error: error.message };
        }
    }

    async handleRestoreDefaults() {
        const defaults = this.getDefaultKeybinds();
        return defaults;
    }

    getDefaultKeybinds() {
        const isMac = process.platform === 'darwin';
        return {
            moveUp: isMac ? 'Cmd+Up' : 'Ctrl+Up',
            moveDown: isMac ? 'Cmd+Down' : 'Ctrl+Down',
            moveLeft: isMac ? 'Cmd+Left' : 'Ctrl+Left',
            moveRight: isMac ? 'Cmd+Right' : 'Ctrl+Right',
            toggleVisibility: isMac ? 'Cmd+\\' : 'Ctrl+\\',
            toggleClickThrough: isMac ? 'Cmd+M' : 'Ctrl+M',
            nextStep: 'Ctrl+Enter',
            ...(isMac ? { toggleCallerAudio: 'Ctrl+L', toggleMicrophone: 'Ctrl+M' } : {}),
            manualScreenshot: isMac ? 'Cmd+Shift+S' : 'Ctrl+Shift+S',
            previousResponse: isMac ? 'Cmd+[' : 'Ctrl+[',
            nextResponse: isMac ? 'Cmd+]' : 'Ctrl+]',
            scrollUp: isMac ? 'Cmd+Shift+Up' : 'Ctrl+Shift+Up',
            scrollDown: isMac ? 'Cmd+Shift+Down' : 'Ctrl+Shift+Down',
        };
    }

    async loadKeybinds() {
        let keybindsArray = await shortcutsRepository.getAllKeybinds();

        if (!keybindsArray || keybindsArray.length === 0) {
            console.log(`[Shortcuts] No keybinds found. Loading defaults.`);
            const defaults = this.getDefaultKeybinds();
            await this.saveKeybinds(defaults); 
            return defaults;
        }

        const keybinds = {};
        keybindsArray.forEach(k => {
            keybinds[k.action] = k.accelerator;
        });

        const defaults = this.getDefaultKeybinds();
        let needsUpdate = false;
        const previousMacDefaults = { nextStep: 'Cmd+Enter', toggleCallerAudio: 'Cmd+Shift+L', toggleMicrophone: 'Cmd+Shift+M' };
        for (const action in defaults) {
            if (!keybinds[action] || (process.platform === 'darwin' && keybinds[action] === previousMacDefaults[action])) {
                keybinds[action] = defaults[action];
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            console.log('[Shortcuts] Updating missing keybinds with defaults.');
            await this.saveKeybinds(keybinds);
        }

        return keybinds;
    }

    async saveKeybinds(newKeybinds) {
        const keybindsToSave = [];
        for (const action in newKeybinds) {
            if (Object.prototype.hasOwnProperty.call(newKeybinds, action)) {
                keybindsToSave.push({
                    action: action,
                    accelerator: newKeybinds[action],
                });
            }
        }
        await shortcutsRepository.upsertKeybinds(keybindsToSave);
        console.log(`[Shortcuts] Saved keybinds.`);
    }

    async toggleAllWindowsVisibility() {
        const targetVisibility = !this.allWindowVisibility;
        internalBridge.emit('window:requestToggleAllWindowsVisibility', {
            targetVisibility: targetVisibility
        });

        if (this.allWindowVisibility) {
            await this.registerShortcuts(true);
        } else {
            await this.registerShortcuts();
        }

        this.allWindowVisibility = !this.allWindowVisibility;
    }

    async registerShortcuts(registerOnlyToggleVisibility = false) {
        if (!this.windowPool) {
            console.error('[Shortcuts] Service not initialized. Cannot register shortcuts.');
            return;
        }
        const keybinds = await this.loadKeybinds();
        globalShortcut.unregisterAll();
        this.focusedShortcuts.clear();
        
        const header = this.windowPool.get('header');
        const mainWindow = header;

        const sendToRenderer = (channel, ...args) => {
            this.windowPool.forEach(win => {
                if (win && !win.isDestroyed()) {
                    try {
                        win.webContents.send(channel, ...args);
                    } catch (e) {
                        // Ignore errors for destroyed windows
                    }
                }
            });
        };
        
        sendToRenderer('shortcuts-updated', keybinds);

        const toggleAsk = async () => {
            if (!this.allWindowVisibility) {
                await this.toggleAllWindowsVisibility();
                if (askService.isPanelVisible()) return;
            }
            askService.toggleAskButton();
        };
        const toggleAudio = source => {
            if (!this.allWindowVisibility || !header || header.isDestroyed()) return;
            if (!askService.isPanelVisible()) askService.setPanelVisible(true);
            header.webContents.send('ask:audioShortcut', source);
        };

        const register = (accelerator, callback) => {
            try {
                if (!globalShortcut.register(accelerator, callback)) {
                    console.warn(`[Shortcuts] Shortcut unavailable: ${accelerator}`);
                }
            } catch (error) {
                console.warn(`[Shortcuts] Invalid shortcut ${accelerator}: ${error.message}`);
            }
        };

        const registerOverlay = (action, callback, alias) => {
            let previous = -Infinity;
            const invoke = () => {
                const now = performance.now();
                if (now - previous < 150) return;
                previous = now;
                Promise.resolve(callback()).catch(console.error);
            };
            const accelerator = keybinds[action];
            if (!accelerator) return;
            for (const shortcut of [accelerator, alias].filter(Boolean)) {
                if (shortcut === alias && shortcut !== accelerator && Object.values(keybinds).includes(shortcut)) continue;
                const terms = shortcut.toLowerCase().split('+');
                const key = terms.pop();
                const modifiers = ['cmd', 'ctrl', 'alt', 'shift'].filter(value => terms.includes(value));
                this.focusedShortcuts.set([...modifiers, key === 'return' ? 'enter' : key].join('+'), invoke);
                register(shortcut, invoke);
            }
        };

        const isMac = process.platform === 'darwin';
        registerOverlay('nextStep', toggleAsk, isMac && 'Cmd+Enter');

        if (registerOnlyToggleVisibility) {
            if (keybinds.toggleVisibility) {
                globalShortcut.register(keybinds.toggleVisibility, () => this.toggleAllWindowsVisibility());
            }
            return;
        }

        // --- Hardcoded shortcuts ---
        const modifier = isMac ? 'Cmd' : 'Ctrl';
        if (isMac) {
            registerOverlay('toggleCallerAudio', () => toggleAudio('caller'), 'Cmd+Shift+L');
            registerOverlay('toggleMicrophone', () => toggleAudio('mic'), 'Cmd+Shift+M');
        }
        
        // Monitor switching
        const displays = screen.getAllDisplays();
        if (displays.length > 1) {
            displays.forEach((display, index) => {
                const key = `${modifier}+Shift+${index + 1}`;
                globalShortcut.register(key, () => internalBridge.emit('window:moveToDisplay', { displayId: display.id }));
            });
        }

        // Edge snapping
        const edgeDirections = [
            { key: `${modifier}+Shift+Left`, direction: 'left' },
            { key: `${modifier}+Shift+Right`, direction: 'right' },
        ];
        edgeDirections.forEach(({ key, direction }) => {
            globalShortcut.register(key, () => {
                if (header && header.isVisible()) internalBridge.emit('window:moveToEdge', { direction });
            });
        });

        // --- User-configurable shortcuts ---
        if (header?.currentHeaderState === 'apikey') {
            if (keybinds.toggleVisibility) {
                globalShortcut.register(keybinds.toggleVisibility, () => this.toggleAllWindowsVisibility());
            }
            return;
        }

        for (const action in keybinds) {
            const accelerator = keybinds[action];
            if (!accelerator) continue;

            let callback;
            switch(action) {
                case 'toggleVisibility':
                    callback = () => this.toggleAllWindowsVisibility();
                    break;
                case 'scrollUp':
                    callback = () => {
                        if (header?.isVisible() && askService.isPanelVisible()) {
                            header.webContents.send('ask:scrollResponseUp');
                        }
                    };
                    break;
                case 'scrollDown':
                    callback = () => {
                        if (header?.isVisible() && askService.isPanelVisible()) {
                            header.webContents.send('ask:scrollResponseDown');
                        }
                    };
                    break;
                case 'moveUp':
                    callback = () => { if (header && header.isVisible()) internalBridge.emit('window:moveStep', { direction: 'up' }); };
                    break;
                case 'moveDown':
                    callback = () => { if (header && header.isVisible()) internalBridge.emit('window:moveStep', { direction: 'down' }); };
                    break;
                case 'moveLeft':
                    callback = () => { if (header && header.isVisible()) internalBridge.emit('window:moveStep', { direction: 'left' }); };
                    break;
                case 'moveRight':
                    callback = () => { if (header && header.isVisible()) internalBridge.emit('window:moveStep', { direction: 'right' }); };
                    break;
                case 'toggleClickThrough':
                     callback = () => {
                        this.mouseEventsIgnored = !this.mouseEventsIgnored;
                        if(mainWindow && !mainWindow.isDestroyed()){
                            mainWindow.setIgnoreMouseEvents(this.mouseEventsIgnored, { forward: true });
                            mainWindow.webContents.send('click-through-toggled', this.mouseEventsIgnored);
                        }
                     };
                     break;
                case 'manualScreenshot':
                    callback = () => {
                        if(mainWindow && !mainWindow.isDestroyed()) {
                             mainWindow.webContents.executeJavaScript('window.captureManualScreenshot && window.captureManualScreenshot();');
                        }
                    };
                    break;
                case 'previousResponse':
                    callback = () => sendToRenderer('navigate-previous-response');
                    break;
                case 'nextResponse':
                    callback = () => sendToRenderer('navigate-next-response');
                    break;
            }
            
            if (callback) register(accelerator, callback);
        }
        console.log('[Shortcuts] All shortcuts have been registered.');
    }

    unregisterAll() {
        globalShortcut.unregisterAll();
        console.log('[Shortcuts] All shortcuts have been unregistered.');
    }
}


const shortcutsService = new ShortcutsService();

module.exports = shortcutsService;
