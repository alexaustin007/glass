import './MainHeader.js';
import './ApiKeyHeader.js';
import './PermissionHeader.js';
import './WelcomeHeader.js';
import '../ask/AskView.js';

class HeaderTransitionManager {
    constructor() {
        this.headerContainer      = document.getElementById('header-container');
        this.currentHeaderType    = null;   // 'welcome' | 'apikey' | 'main' | 'permission'
        this.welcomeHeader        = null;
        this.apiKeyHeader         = null;
        this.mainHeader            = null;
        this.permissionHeader      = null;
        this.overlay = document.getElementById('glass-overlay');
        this.askPanel = document.getElementById('ask-panel');
        this.headerSize = { width: 353, height: 47 };
        this.conversationEpoch = 0;
        this.stateRevision = 0;

        if (window.api) {
            this.askPanel.addEventListener('capture-state', event => {
                this.capture = event.detail;
                if (this.mainHeader) this.mainHeader.capture = this.capture;
            });
            window.api.askView.onAskStateUpdate((_, { isVisible }) => {
                if (isVisible && window.api.platform.isMacOS && !this.conversationOpened) return;
                if (this.mainHeader) this.mainHeader.panelOpen = isVisible;
                if (isVisible === !this.askPanel.hidden) return;
                this.askPanel.hidden = !isVisible;
                this.overlay.classList.toggle('expanded', isVisible);
                this.applyWindowSize();
                if (isVisible) this.askPanel.firstElementChild.focusTextInput();
            });
            const resizeObserver = new ResizeObserver(() => {
                if (!this.askPanel.hidden) this.applyWindowSize();
            });
            resizeObserver.observe(this.askPanel);
        }

        /**
         * only one header window is allowed
         * @param {'welcome'|'apikey'|'main'|'permission'} type
         */
        this.ensureHeader = (type) => {
            console.log('[HeaderController] ensureHeader: Ensuring header of type:', type);
            if (this.currentHeaderType === type) {
                console.log('[HeaderController] ensureHeader: Header of type:', type, 'already exists.');
                return;
            }

            if (type !== 'main' && this.conversationOpened) this.deactivateConversation(false);
            this.headerContainer.innerHTML = '';
            
            this.welcomeHeader = null;
            this.apiKeyHeader = null;
            this.mainHeader = null;
            this.permissionHeader = null;

            // Create new header element
            if (type === 'welcome') {
                this.welcomeHeader = document.createElement('welcome-header');
                this.welcomeHeader.loginCallback = () => this.handleLoginOption();
                this.welcomeHeader.apiKeyCallback = () => this.handleApiKeyOption();
                this.headerContainer.appendChild(this.welcomeHeader);
                console.log('[HeaderController] ensureHeader: Header of type:', type, 'created.');
            } else if (type === 'apikey') {
                this.apiKeyHeader = document.createElement('apikey-header');
                this.apiKeyHeader.stateUpdateCallback = (userState) => this.handleStateUpdate(userState);
                this.apiKeyHeader.backCallback = () => this.transitionToWelcomeHeader();
                this.apiKeyHeader.addEventListener('request-resize', e => {
                    this._resizeForApiKey(e.detail.height); 
                });
                this.headerContainer.appendChild(this.apiKeyHeader);
                console.log('[HeaderController] ensureHeader: Header of type:', type, 'created.');
            } else if (type === 'permission') {
                this.permissionHeader = document.createElement('permission-setup');
                this.permissionHeader.addEventListener('request-resize', e => {
                    this._resizeForPermissionHeader(e.detail.height); 
                });
                this.permissionHeader.continueCallback = async () => {
                    if (window.api && window.api.headerController) {
                        console.log('[HeaderController] Re-initializing model state after permission grant...');
                        await window.api.headerController.reInitializeModelState();
                    }
                    this.transitionToMainHeader();
                };
                this.headerContainer.appendChild(this.permissionHeader);
            } else {
                this.mainHeader = document.createElement('main-header');
                if (this.capture) this.mainHeader.capture = this.capture;
                this.mainHeader.panelOpen = !this.askPanel.hidden;
                this.headerContainer.appendChild(this.mainHeader);
                this.mainHeader.startSlideInAnimation?.();
            }

            this.overlay.classList.toggle('conversation', type === 'main' && !!window.api?.platform.isMacOS);
            this.currentHeaderType = type;
            this.notifyHeaderState(type === 'permission' ? 'apikey' : type); // Keep permission state as apikey for compatibility
        };

        console.log('[HeaderController] Manager initialized');

        // WelcomeHeader 콜백 메서드들
        this.handleLoginOption = this.handleLoginOption.bind(this);
        this.handleApiKeyOption = this.handleApiKeyOption.bind(this);

        this._bootstrap();

        if (window.api) {
            window.api.headerController.onUserStateChanged((event, userState) => {
                console.log('[HeaderController] Received user state change:', userState);
                this.handleStateUpdate(userState);
            });

            window.api.headerController.onAuthFailed((event, { message }) => {
                console.error('[HeaderController] Received auth failure from main process:', message);
                if (this.apiKeyHeader) {
                    this.apiKeyHeader.errorMessage = 'Authentication failed. Please try again.';
                    this.apiKeyHeader.isLoading = false;
                }
            });
            window.api.headerController.onForceShowApiKeyHeader(async () => {
                console.log('[HeaderController] Received broadcast to show apikey header. Switching now.');
                const isConfigured = await window.api.apiKeyHeader.areProvidersConfigured();
                if (!isConfigured) {
                    await this._resizeForWelcome();
                    this.ensureHeader('welcome');
                } else {
                    await this._resizeForApiKey();
                    this.ensureHeader('apikey');
                }
            });            
        }
    }

    notifyHeaderState(stateOverride) {
        const state = stateOverride || this.currentHeaderType || 'apikey';
        if (window.api) {
            window.api.headerController.sendHeaderStateChanged(state);
        }
    }

    async _bootstrap() {
        // The initial state will be sent by the main process via 'user-state-changed'
        // We just need to request it.
        if (window.api) {
            const userState = await window.api.common.getCurrentUser();
            console.log('[HeaderController] Bootstrapping with initial user state:', userState);
            this.handleStateUpdate(userState);
        } else {
            // Fallback for non-electron environment (testing/web)
            this.ensureHeader('welcome');
        }
    }


    //////// after_modelStateService ////////
    async handleStateUpdate(userState) {
        const revision = ++this.stateRevision;
        if (window.api.platform.isMacOS && userState?.uid) {
            const accountChanged = this.userId && this.userId !== userState.uid;
            this.userId = userState.uid;
            if (accountChanged) await this.deactivateConversation(true);
        }
        const isConfigured = await window.api.apiKeyHeader.areProvidersConfigured();
        if (revision !== this.stateRevision) return;
        if (isConfigured) {
            // If providers are configured, always check permissions regardless of login state.
            const permissionResult = await this.checkPermissions();
            if (revision !== this.stateRevision) return;
            if (permissionResult.success) {
                this.transitionToMainHeader();
            } else {
                this.transitionToPermissionHeader();
            }
        } else {
            // If no providers are configured, show the welcome header to prompt for setup.
            await this._resizeForWelcome();
            this.ensureHeader('welcome');
        }
    }

    // WelcomeHeader 콜백 메서드들
    async handleLoginOption() {
        console.log('[HeaderController] Login option selected');
        if (window.api) {
            await window.api.common.startFirebaseAuth();
        }
    }

    async handleApiKeyOption() {
        console.log('[HeaderController] API key option selected');
        await this._resizeForApiKey(400);
        this.ensureHeader('apikey');
        // ApiKeyHeader에 뒤로가기 콜백 설정
        if (this.apiKeyHeader) {
            this.apiKeyHeader.backCallback = () => this.transitionToWelcomeHeader();
        }
    }

    async transitionToWelcomeHeader() {
        if (this.currentHeaderType === 'welcome') {
            return this._resizeForWelcome();
        }

        await this._resizeForWelcome();
        this.ensureHeader('welcome');
    }
    //////// after_modelStateService ////////

    async transitionToPermissionHeader() {
        // Prevent duplicate transitions
        if (this.currentHeaderType === 'permission') {
            console.log('[HeaderController] Already showing permission setup, skipping transition');
            return;
        }

        await this._resizeForPermissionHeader(220);
        this.ensureHeader('permission');
    }

    deactivateConversation(accountChanged) {
        ++this.conversationEpoch;
        this.conversationOpened = false;
        this.askPanel.hidden = true;
        this.overlay.classList.remove('expanded');
        if (this.mainHeader) this.mainHeader.panelOpen = false;
        this.applyWindowSize();
        const prior = this.conversationCleanup;
        const paused = this.askPanel.firstElementChild.setConversationEnabled(false);
        this.conversationCleanup = Promise.all([prior, paused]).then(() => accountChanged
            ? window.api.askView.resetConversation() : window.api.askView.closeAskWindow());
        return this.conversationCleanup;
    }

    async transitionToMainHeader() {
        const epoch = this.conversationEpoch;
        await this._resizeForMain();
        if (epoch !== this.conversationEpoch) return;
        this.ensureHeader('main');
        if (!window.api?.platform.isMacOS || this.conversationOpened) return;
        await this.conversationCleanup;
        if (epoch !== this.conversationEpoch || this.currentHeaderType !== 'main' || this.conversationOpened) return;
        this.conversationOpened = true;
        const view = this.askPanel.firstElementChild;
        await view.setConversationEnabled(true);
        if (epoch !== this.conversationEpoch) return;
        await window.api.askView.openPanel();
        if (epoch === this.conversationEpoch) await view.startListening();
    }

    async _resizeForMain() {
        if (!window.api) return;
        console.log('[HeaderController] _resizeForMain: Resizing window to 353x47');
        return this.setHeaderSize(353, 47);
    }

    async _resizeForApiKey(height = 370) {
        if (!window.api) return;
        console.log(`[HeaderController] _resizeForApiKey: Resizing window to 456x${height}`);
        return this.setHeaderSize(456, height);
    }

    async _resizeForPermissionHeader(height) {
        if (!window.api) return;
        const finalHeight = height || 220;
        return this.setHeaderSize(285, finalHeight);
    }

    async _resizeForWelcome() {
        if (!window.api) return;
        console.log('[HeaderController] _resizeForWelcome: Resizing window to 456x370');
        return this.setHeaderSize(456, 400);
    }

    setHeaderSize(width, height) {
        this.headerSize = { width, height };
        return this.applyWindowSize();
    }

    applyWindowSize() {
        const { width, height } = this.headerSize;
        const available = Math.max(130, window.screen.availHeight - height);
        this.askPanel.style.maxHeight = `${available}px`;
        this.askPanel.style.setProperty('--ask-available-height', `${available}px`);
        const totalHeight = height + (this.askPanel.hidden ? 0 : this.askPanel.offsetHeight);
        if (this.lastSize?.width === width && this.lastSize?.height === totalHeight) return;
        this.lastSize = { width, height: totalHeight };
        return window.api.headerController.resizeHeaderWindow({ width, height: totalHeight }).catch(console.error);
    }

    async checkPermissions() {
        if (!window.api) {
            return { success: true };
        }
        
        try {
            const permissions = await window.api.headerController.checkSystemPermissions();
            console.log('[HeaderController] Current permissions:', permissions);
            
            return { success: !permissions.needsSetup };
        } catch (error) {
            console.error('[HeaderController] Error checking permissions:', error);
            return { 
                success: false, 
                error: 'Failed to check permissions' 
            };
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new HeaderTransitionManager();
});
