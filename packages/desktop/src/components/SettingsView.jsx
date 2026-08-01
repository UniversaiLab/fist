import React from 'react';
import Icon from './Icon.jsx';
import CoreLogic from '@soul-connection/core-logic';
const { formatBytes } = CoreLogic;
import { Section, Toggle } from './settingsPrimitives.jsx';
import NetworkSettings from './NetworkSettings.jsx';

const INTERVAL_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 6 * 3600000, label: 'Every 6 hours' },
  { value: 12 * 3600000, label: 'Every 12 hours' },
  { value: 24 * 3600000, label: 'Every 24 hours' },
];

const LOG_LEVELS = [
  { value: 'warn', label: 'Warning (default)' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
];

function updaterStatusHint(updaterStatus) {
  switch (updaterStatus?.status) {
    case 'checking': return 'Checking…';
    case 'available': return `Version ${updaterStatus.version} is available`;
    case 'not-available': return 'You are on the latest version';
    case 'downloading': return `Downloading… ${Math.round(updaterStatus.percent || 0)}%`;
    case 'downloaded': return `Version ${updaterStatus.version} is ready to install`;
    case 'error': return `Update check failed: ${updaterStatus.message}`;
    default: return null;
  }
}

export default function SettingsView({
  settings, connectionState, profiles, appInfo, systemProxyEnabled,
  updaterStatus, onCheckForUpdates, onDownloadUpdate, onInstallUpdate,
  onUpdate, onUpdateChecked, onOpenLogsFolder,
  onExportBackup, onImportBackup, onResetUsage, onResetAllUsage,
  onSystemProxyEnable, onSystemProxyDisable, onOpenProxyFolder, onResetNetworkDefaults,
  killSwitchBlocking,
}) {
  const portsLocked = connectionState !== 'disconnected';
  const totalUsage = (profiles || []).reduce((sum, p) => sum + (p.totalBytes || 0), 0);

  return (
    <div className="settings-view">
      <Section title="Connection" icon="bolt" description="App behavior on launch and connect">
        <Toggle
          label="Launch on startup"
          hint="FIST starts automatically when you sign in"
          checked={settings.launchOnStartup}
          onChange={(v) => onUpdate({ launchOnStartup: v })}
        />
        <Toggle
          label="Start local proxy on launch"
          hint="Automatically connects to the last active server; does not turn on system proxy automatically"
          checked={settings.runLocalProxyOnStartup}
          onChange={(v) => onUpdate({ runLocalProxyOnStartup: v })}
        />
        <Toggle
          label="Start minimized"
          hint="The window isn't shown on launch"
          checked={settings.startMinimized}
          onChange={(v) => onUpdate({ startMinimized: v })}
        />
        <Toggle
          label="Minimize to tray"
          hint="Closing the window hides the app instead of quitting"
          checked={settings.minimizeToTray}
          onChange={(v) => onUpdate({ minimizeToTray: v })}
        />
        <Toggle
          label="Auto-reconnect"
          hint="Automatically retries connecting if the tunnel drops unexpectedly"
          checked={settings.autoReconnect}
          onChange={(v) => onUpdate({ autoReconnect: v })}
        />
        <Toggle
          label="Restore previous session"
          hint="The last tab, search, sort order, and expanded groups return to how you left them"
          checked={settings.restorePreviousSession}
          onChange={(v) => onUpdate({ restorePreviousSession: v })}
        />
      </Section>

      <Section title="Subscriptions" icon="refresh" description="Automatic updates">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Auto-update subscriptions</span>
          </div>
          <select
            className="setting-select"
            value={settings.subAutoUpdateInterval}
            onChange={(e) => onUpdate({ subAutoUpdateInterval: Number(e.target.value) })}
          >
            {INTERVAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </Section>

      <NetworkSettings
        settings={settings}
        connectionState={connectionState}
        systemProxyEnabled={systemProxyEnabled}
        killSwitchBlocking={killSwitchBlocking}
        onUpdate={onUpdate}
        onUpdateChecked={onUpdateChecked}
        onSystemProxyEnable={onSystemProxyEnable}
        onSystemProxyDisable={onSystemProxyDisable}
        onOpenProxyFolder={onOpenProxyFolder}
        onResetNetworkDefaults={onResetNetworkDefaults}
      />

      <Section title="Data Usage" icon="database" description="Traffic used per server">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Total usage across all servers</span>
            <span className="setting-hint mono">{formatBytes(totalUsage)}</span>
          </div>
          <button
            className="btn icon-inline-btn"
            onClick={onResetAllUsage}
            disabled={!totalUsage}
          >
            <Icon name="trash" size={14} />
            Clear
          </button>
        </div>
        {(profiles || []).filter((p) => p.totalBytes > 0).map((p) => (
          <div className="setting-row" key={p.id}>
            <div className="setting-text">
              <span className="setting-label">{p.name || p.address}</span>
              <span className="setting-hint mono">{formatBytes(p.totalBytes)}</span>
            </div>
            <button className="icon-btn" title="Reset this server" onClick={() => onResetUsage(p.id)}>
              <Icon name="refresh" size={14} />
            </button>
          </div>
        ))}
      </Section>

      <Section title="Backup" icon="shield" description="Save and restore configs and settings">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Export configs</span>
            <span className="setting-hint">Save all servers, subscriptions, and settings to a single JSON file</span>
          </div>
          <button className="btn icon-inline-btn" onClick={onExportBackup}>
            <Icon name="arrowDown" size={14} />
            Export
          </button>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Restore from backup file</span>
            <span className="setting-hint error">Your current configs will be replaced</span>
          </div>
          <button className="btn icon-inline-btn" onClick={onImportBackup} disabled={portsLocked}>
            <Icon name="arrowUp" size={14} />
            Restore
          </button>
        </div>
      </Section>

      <Section title="Advanced" icon="sliders" description="Logs and sing-box technical settings">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">sing-box log level</span>
          </div>
          <select
            className="setting-select"
            value={settings.singboxLogLevel}
            onChange={(e) => onUpdate({ singboxLogLevel: e.target.value })}
          >
            {LOG_LEVELS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Logs and active config folder</span>
          </div>
          <button className="btn icon-inline-btn" onClick={onOpenLogsFolder}>
            <Icon name="folder" size={14} />
            Open
          </button>
        </div>
      </Section>

      <Section title="About" icon="info" description="Installed version and updates">
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">FIST</span>
            <span className="setting-hint mono">Version {appInfo?.version || '—'}</span>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-text">
            <span className="setting-label">Updates</span>
            {updaterStatusHint(updaterStatus) && (
              <span className="setting-hint">{updaterStatusHint(updaterStatus)}</span>
            )}
          </div>
          {updaterStatus?.status === 'available' ? (
            <button className="btn icon-inline-btn" onClick={onDownloadUpdate}>
              <Icon name="arrowDown" size={14} />
              Download
            </button>
          ) : updaterStatus?.status === 'downloaded' ? (
            <button className="btn icon-inline-btn" onClick={onInstallUpdate}>
              <Icon name="refresh" size={14} />
              Install & Restart
            </button>
          ) : (
            <button
              className="btn icon-inline-btn"
              onClick={onCheckForUpdates}
              disabled={updaterStatus?.status === 'checking' || updaterStatus?.status === 'downloading'}
            >
              <Icon name="refresh" size={14} />
              Check for Updates
            </button>
          )}
        </div>
      </Section>
    </div>
  );
}
