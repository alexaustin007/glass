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
    }

    initialize(windowPool) {
        this.windowPool = windowPool;
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
            nextStep: isMac ? 'Cmd+Enter' : 'Ctrl+Enter',
            ...(isMac ? { toggleCallerAudio: 'Cmd+Shift+L', toggleMicrophone: 'Cmd+Shift+M' } : {}),
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
        for (const action in defaults) {
            if (!keybinds[action]) {
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
                if (this.windowPool.get('ask')?.isVisible()) return;
            }
            askService.toggleAskButton();
        };
        const toggleAudio = source => {
            const askWindow = this.windowPool.get('ask');
            if (!this.allWindowVisibility || !askWindow || askWindow.isDestroyed()) return;
            if (!askWindow.isVisible()) askService.toggleAskButton();
            askWindow.webContents.send('ask:audioShortcut', source);
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

        if (keybinds.nextStep) register(keybinds.nextStep, toggleAsk);
        if (process.platform === 'darwin' && keybinds.nextStep === 'Cmd+Enter' &&
            !Object.values(keybinds).some(key => /^(Ctrl|Control)\+(Enter|Return)$/i.test(key))) {
            register('Ctrl+Enter', toggleAsk);
        }

        if (registerOnlyToggleVisibility) {
            if (keybinds.toggleVisibility) {
                globalShortcut.register(keybinds.toggleVisibility, () => this.toggleAllWindowsVisibility());
            }
            return;
        }

        // --- Hardcoded shortcuts ---
        const isMac = process.platform === 'darwin';
        const modifier = isMac ? 'Cmd' : 'Ctrl';
        
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
            if (keybinds.toggleCallerAudio) register(keybinds.toggleCallerAudio, () => toggleAudio('caller'));
            if (keybinds.toggleMicrophone) register(keybinds.toggleMicrophone, () => toggleAudio('mic'));
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
                case 'toggleCallerAudio':
                    callback = () => toggleAudio('caller');
                    break;
                case 'toggleMicrophone':
                    callback = () => toggleAudio('mic');
                    break;
                case 'scrollUp':
                    callback = () => {
                        const askWindow = this.windowPool.get('ask');
                        if (askWindow && !askWindow.isDestroyed() && askWindow.isVisible()) {
                            askWindow.webContents.send('scroll-response-up');
                        }
                    };
                    break;
                case 'scrollDown':
                    callback = () => {
                        const askWindow = this.windowPool.get('ask');
                        if (askWindow && !askWindow.isDestroyed() && askWindow.isVisible()) {
                            askWindow.webContents.send('scroll-response-down');
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
