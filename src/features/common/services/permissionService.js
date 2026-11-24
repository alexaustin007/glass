const { systemPreferences } = require('electron');
const permissionRepository = require('../repositories/permission');

class PermissionService {
  _getAuthService() {
    return require('./authService');
  }

  async checkSystemPermissions() {
    const permissions = {
      microphone: 'unknown',
      screen: 'unknown',
      keychain: 'unknown',
      needsSetup: true
    };

    try {
      if (process.platform === 'darwin') {
        permissions.microphone = systemPreferences.getMediaAccessStatus('microphone');
        permissions.screen = systemPreferences.getMediaAccessStatus('screen');
        permissions.keychain = await this.checkKeychainCompleted(this._getAuthService().getCurrentUserId()) ? 'granted' : 'unknown';
        permissions.needsSetup = permissions.keychain !== 'granted';
      } else {
        permissions.microphone = 'granted';
        permissions.screen = 'granted';
        permissions.keychain = 'granted';
        permissions.needsSetup = false;
      }

      console.log('[Permissions] System permissions status:', permissions);
      return permissions;
    } catch (error) {
      console.error('[Permissions] Error checking permissions:', error);
      return {
        microphone: 'unknown',
        screen: 'unknown',
        keychain: 'unknown',
        needsSetup: true,
        error: error.message
      };
    }
  }

  async ensureAudioPermission(source) {
    const permissions = await this.checkSystemPermissions();
    if (permissions.needsSetup) throw new Error('Finish Glass keychain setup first.');
    if (source === 'caller' && permissions.screen !== 'granted') {
      throw new Error('Open System Settings → Privacy & Security → Screen & System Audio Recording. Enable Glass, then reopen it to hear the caller.');
    }
    if (source === 'mic' && permissions.microphone !== 'granted') {
      const granted = permissions.microphone === 'not-determined'
        && (await this.requestMicrophonePermission()).success;
      if (!granted) throw new Error('Open System Settings → Privacy & Security → Microphone. Enable Glass to use your microphone.');
    }
  }

  async requestMicrophonePermission() {
    if (process.platform !== 'darwin') {
      return { success: true };
    }

    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      console.log('[Permissions] Microphone status:', status);
      if (status === 'granted') {
        return { success: true, status: 'granted' };
      }

      const granted = await systemPreferences.askForMediaAccess('microphone');
      return {
        success: granted,
        status: granted ? 'granted' : 'denied'
      };
    } catch (error) {
      console.error('[Permissions] Error requesting microphone permission:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async markKeychainCompleted() {
    try {
      await permissionRepository.markKeychainCompleted(this._getAuthService().getCurrentUserId());
      console.log('[Permissions] Marked keychain as completed');
      return { success: true };
    } catch (error) {
      console.error('[Permissions] Error marking keychain as completed:', error);
      return { success: false, error: error.message };
    }
  }

  async checkKeychainCompleted(uid) {
    if (uid === "default_user") {
      return true;
    }
    try {
      const completed = permissionRepository.checkKeychainCompleted(uid);
      console.log('[Permissions] Keychain completed status:', completed);
      return completed;
    } catch (error) {
      console.error('[Permissions] Error checking keychain completed status:', error);
      return false;
    }
  }
}

const permissionService = new PermissionService();
module.exports = permissionService;
