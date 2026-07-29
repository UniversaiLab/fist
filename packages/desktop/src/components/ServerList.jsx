import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import ContextMenu from './ContextMenu.jsx';
import { RenameModal, EditProfileModal, EditSubscriptionModal, SubscriptionDetailsModal, ConfirmModal } from './ManageModals.jsx';
import QrModal from './QrModal.jsx';
import SubTestModal from './SubTestModal.jsx';
import * as engine from '../finder/testEngine.js';
import CoreLogic from '@soul-connection/core-logic';
const { formatBytes, relativeTime, subUsageInfo } = CoreLogic;

function pingClass(ms) {
  if (ms === undefined) return 'na';
  if (ms === 'measuring') return 'na';
  if (ms === -1) return 'bad';
  if (ms < 150) return 'good';
  if (ms < 400) return 'mid';
  return 'bad';
}

function pingLabel(ms) {
  if (ms === undefined) return 'Ping';
  if (ms === 'measuring') return '…';
  if (ms === -1) return 'Error';
  return `${ms}ms`;
}

function groupStats(items, pings) {
  const totalBytes = items.reduce((sum, p) => sum + (p.totalBytes || 0), 0);
  const measured = items
    .map((p) => pings[p.id])
    .filter((v) => typeof v === 'number' && v > 0);
  const bestPing = measured.length ? Math.min(...measured) : undefined;
  return { totalBytes, bestPing };
}

// Memoized so a ping/traffic tick that changes one card's `ms` (or unrelated
// App state) doesn't re-render every other card in a list that can run into
// the hundreds. Relies on `onSelect`/`onDelete`/`onPing`/`onContextMenu` being
// referentially stable (useCallback'd) across unrelated re-renders.
const ServerCard = React.memo(function ServerCard({ profile, active, connected, ms, onSelect, onRequestDelete, onPing, onContextMenu }) {
  return (
    <motion.div
      layout
      className={`server-card ${active ? 'active' : ''} ${connected ? 'connected' : ''}`}
      onContextMenu={(e) => onContextMenu(e, profile)}
      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
    >
      <span className="proto-tag">{profile.protocol}</span>
      <div className="info" onClick={() => onSelect(profile.id)}>
        <div className="name">
          {connected && <span className="connected-dot" aria-hidden="true" />}
          {profile.favorite && <Icon name="star" size={10} className="fav-mark" />}
          {profile.name || profile.address}
        </div>
        <div className="addr mono">
          {profile.address}:{profile.port}
          {profile.totalBytes > 0 && <span className="usage-tag"> · {formatBytes(profile.totalBytes)}</span>}
        </div>
      </div>
      <button className={`ping ${pingClass(ms)}`} onClick={() => onPing(profile.id)}>
        {pingLabel(ms)}
      </button>
      <button className="del" onClick={() => onRequestDelete(profile)} title="Delete">
        <Icon name="close" size={13} />
      </button>
    </motion.div>
  );
});

export default function ServerList({
  profiles, subscriptions, activeProfileId, connectionState, pings, updatingSubs, refreshingSubIds,
  onSelect, onDelete, onPing, onPingAll, onAdd,
  onRefreshSubscription, onUpdateAllSubscriptions, onDeleteSubscription,
  onConnectTo, onDisconnect, onRenameProfile, onEditProfile, onUpdateSubscription, onToast,
  initialQuery, initialSortBy, initialCollapsed, onSessionChange,
}) {
  const [query, setQuery] = useState(initialQuery || '');
  const [sortBy, setSortBy] = useState(initialSortBy || 'default');
  const [collapsed, setCollapsed] = useState(initialCollapsed || {});
  const [ctxMenu, setCtxMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [testModal, setTestModal] = useState(null); // { sub, mode, autoConnectBest }

  // "Restore Previous Session" -- reports query/sortBy/collapsed up (debounced)
  // whenever they change, so App.jsx can persist them; a no-op when the
  // feature is off (onSessionChange is undefined in that case).
  useEffect(() => {
    if (!onSessionChange) return undefined;
    const t = setTimeout(() => onSessionChange({ query, sortBy, collapsed }), 300);
    return () => clearTimeout(t);
  }, [query, sortBy, collapsed, onSessionChange]);

  // Signals the global Ctrl+V handler in App.jsx that a menu/modal owned by
  // this component is open, so it doesn't add clipboard content behind it.
  useEffect(() => {
    document.body.dataset.modalOpen = (modal || ctxMenu || confirmDelete || testModal) ? 'true' : 'false';
    return () => { document.body.dataset.modalOpen = 'false'; };
  }, [modal, ctxMenu, confirmDelete, testModal]);

  const requestDeleteProfile = useCallback((profile) => {
    setConfirmDelete({ type: 'profile', id: profile.id, label: profile.name || profile.address });
  }, []);

  const requestDeleteSubscription = useCallback((sub) => {
    setConfirmDelete({ type: 'subscription', id: sub.id, label: sub.name });
  }, []);

  // Both "Ping All Servers" and "Connect to Best Server" run a scoped batch
  // through the shared Server Finder engine — only one batch can run at a
  // time app-wide, so bail out with a toast instead of hijacking one that's
  // already in flight (e.g. started from the finder).
  const startSubTest = useCallback((sub, mode, autoConnectBest) => {
    if (engine.getSnapshot().status !== 'idle') {
      onToast?.('Another test is already running — wait for it to finish', 'error');
      return;
    }
    const subProfiles = profiles.filter((p) => p.subId === sub.id);
    if (!subProfiles.length) {
      onToast?.('This subscription has no configs', 'error');
      return;
    }
    setTestModal({ sub, mode, autoConnectBest });
  }, [profiles, onToast]);

  // useCallback'd (with only truly-hot-changing deps) so this stays a stable
  // reference across ping/traffic-driven re-renders, letting ServerCard's
  // React.memo actually skip re-rendering unaffected cards.
  const copyText = useCallback((text, msg) => {
    navigator.clipboard?.writeText(text)
      .then(() => onToast?.(msg))
      .catch(() => onToast?.('Copy failed', 'error'));
  }, [onToast]);

  const openProfileMenu = useCallback((e, profile) => {
    e.preventDefault();
    const isActiveConnected = profile.id === activeProfileId && (connectionState === 'connected' || connectionState === 'connecting');
    const items = [
      isActiveConnected
        ? { icon: 'stop', label: 'Disconnect', onClick: () => onDisconnect() }
        : { icon: 'power', label: 'Connect', onClick: () => onConnectTo(profile.id) },
      { icon: 'gauge', label: 'Show ping', onClick: () => onPing(profile.id) },
      { icon: 'edit', label: 'Edit', sepBefore: true, onClick: () => setModal({ type: 'editProfile', profile }) },
      { icon: 'edit', label: 'Rename', onClick: () => setModal({ type: 'renameProfile', profile }) },
      { icon: 'copy', label: 'Copy', onClick: () => copyText(profile.link, 'Link copied') },
      { icon: 'arrowUp', label: 'Share / Export', onClick: () => copyText(profile.link, 'Link copied for sharing') },
      { icon: 'qrcode', label: 'Share via QR', onClick: () => setModal({ type: 'qr', value: profile.link, title: profile.name || profile.address, subtitle: `${profile.address}:${profile.port}` }) },
      { icon: 'trash', label: 'Delete', danger: true, sepBefore: true, onClick: () => requestDeleteProfile(profile) },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, title: profile.name || profile.address, items });
  }, [activeProfileId, connectionState, onDisconnect, onConnectTo, onPing, requestDeleteProfile, copyText]);

  const openSubMenu = useCallback((e, sub) => {
    e.preventDefault();
    const items = [
      { icon: 'bolt', label: 'Connect to best server', onClick: () => startSubTest(sub, 'ping', true) },
      { icon: 'gauge', label: 'Ping all servers', onClick: () => startSubTest(sub, 'ping', false) },
      { icon: 'refresh', label: 'Update subscription', sepBefore: true, onClick: () => onRefreshSubscription(sub.id) },
      { icon: 'edit', label: 'Edit', sepBefore: true, onClick: () => setModal({ type: 'editSub', sub }) },
      { icon: 'edit', label: 'Rename', onClick: () => setModal({ type: 'renameSub', sub }) },
      { icon: 'copy', label: 'Copy link', onClick: () => copyText(sub.url, 'Subscription link copied') },
      { icon: 'qrcode', label: 'Share via QR', onClick: () => setModal({ type: 'qr', value: sub.url, title: sub.name, subtitle: `${sub.configCount ?? 0} configs` }) },
      { icon: 'info', label: 'View details', onClick: () => setModal({ type: 'details', sub }) },
      { icon: 'trash', label: 'Delete', danger: true, sepBefore: true, onClick: () => requestDeleteSubscription(sub) },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, title: sub.name, items });
  }, [onRefreshSubscription, requestDeleteSubscription, copyText, startSubTest]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = !q ? profiles : profiles.filter((p) =>
      (p.name || '').toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q)
    );
    if (sortBy === 'name') {
      list = [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'ping') {
      list = [...list].sort((a, b) => {
        const ma = pings[a.id]; const mb = pings[b.id];
        const va = typeof ma === 'number' && ma > 0 ? ma : Infinity;
        const vb = typeof mb === 'number' && mb > 0 ? mb : Infinity;
        return va - vb;
      });
    }
    return list;
  }, [profiles, query, sortBy, pings]);

  const groups = useMemoGroups(filtered, subscriptions, pings);

  if (!profiles.length) {
    return (
      <div className="empty-state">
        <div className="empty-glyph">
          <Icon name="signal" size={30} strokeWidth={2.25} />
        </div>
        <h3>No servers yet</h3>
        <p>Add a config link or a subscription address to make your first connection.</p>
        <button className="btn primary empty-cta" onClick={onAdd}>
          <Icon name="plus" size={15} />
          Add Config
        </button>
      </div>
    );
  }

  return (
    <div className="list-wrap">
      <div className="list-toolbar">
        <div className="search-box">
          <Icon name="search" size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="default">Default</option>
          <option value="ping">Ping</option>
          <option value="name">Name</option>
        </select>
        <button className="icon-btn" title="Ping all" onClick={() => onPingAll(filtered.map((p) => p.id))}>
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {subscriptions.length > 0 && (
        <button className="update-all-btn" onClick={onUpdateAllSubscriptions} disabled={updatingSubs}>
          {updatingSubs && <span className="icon-spinner" aria-hidden="true" />}
          {updatingSubs ? 'Updating…' : 'Update All Subscriptions'}
        </button>
      )}

      <div className="list">
        {groups.map((group) => {
          const usageInfo = !group.local ? subUsageInfo(group.sub) : null;
          const critical = usageInfo && (usageInfo.expired || usageInfo.exhausted);
          return (
          <div key={group.key} className={`server-group ${group.local ? 'local-group' : ''}`}>
            {(group.sub || group.local) && (
              <div
                className={`group-head ${group.local ? 'local' : ''} ${critical ? 'critical' : ''}`}
                onContextMenu={!group.local ? (e) => openSubMenu(e, group.sub) : undefined}
              >
                <div className="group-head-row">
                  <button
                    className="group-toggle"
                    onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !c[group.key] }))}
                  >
                    <span className={`chev ${collapsed[group.key] ? 'closed' : ''}`}>
                      <Icon name="chevron" size={12} />
                    </span>
                    {group.local && <Icon name="folder" size={12} className="local-icon" />}
                    <span className="group-name">{group.local ? 'Local' : group.sub.name}</span>
                    <span className="group-stats">
                      {group.stats.totalBytes > 0 && (
                        <span className="stat-chip size">{formatBytes(group.stats.totalBytes)}</span>
                      )}
                      <span className={`stat-chip ping ${pingClass(group.stats.bestPing)}`}>
                        {group.stats.bestPing !== undefined ? `${group.stats.bestPing}ms` : '—'}
                      </span>
                    </span>
                    {!group.local && <span className="group-meta">{relativeTime(group.sub.lastUpdated)}</span>}
                  </button>
                  {!group.local && (
                    <>
                      <button
                        className="group-action"
                        onClick={() => onRefreshSubscription(group.sub.id)}
                        disabled={refreshingSubIds?.has(group.sub.id)}
                        title="Update"
                      >
                        {refreshingSubIds?.has(group.sub.id)
                          ? <span className="icon-spinner" aria-hidden="true" />
                          : <Icon name="refresh" size={13} />}
                      </button>
                      <button className="group-action danger" onClick={() => requestDeleteSubscription(group.sub)} title="Delete subscription">
                        <Icon name="close" size={13} />
                      </button>
                    </>
                  )}
                </div>
                {usageInfo && (
                  <div className="sub-usage">
                    <div className="usage-bar-track">
                      <div
                        className={`usage-bar-fill ${critical ? 'critical' : ''}`}
                        style={{ transform: `scaleX(${Math.max(usageInfo.total > 0 ? usageInfo.pct : 0, usageInfo.total > 0 ? 2 : 0) / 100})` }}
                      />
                    </div>
                    <div className="usage-row">
                      <span className="usage-text">
                        {usageInfo.total > 0
                          ? `${formatBytes(usageInfo.used)} / ${formatBytes(usageInfo.total)}`
                          : formatBytes(usageInfo.used)}
                      </span>
                      {usageInfo.daysLeft !== null && (
                        <span className={`usage-expiry ${usageInfo.expired ? 'critical' : ''}`}>
                          {usageInfo.expired ? 'Expired' : `${usageInfo.daysLeft} days left`}
                        </span>
                      )}
                    </div>
                    {critical && (
                      <div className="usage-warn">
                        <Icon name="info" size={11} />
                        {usageInfo.expired ? 'This subscription has expired' : 'This subscription has run out of data'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {!collapsed[group.key] && group.items.map((p) => (
              <ServerCard
                key={p.id}
                profile={p}
                active={p.id === activeProfileId}
                connected={p.id === activeProfileId && connectionState === 'connected'}
                ms={pings[p.id]}
                onSelect={onSelect}
                onRequestDelete={requestDeleteProfile}
                onPing={onPing}
                onContextMenu={openProfileMenu}
              />
            ))}
          </div>
          );
        })}
      </div>

      {ctxMenu && <ContextMenu {...ctxMenu} onClose={() => setCtxMenu(null)} />}

      {modal?.type === 'renameProfile' && (
        <RenameModal
          title="Rename Config"
          initialValue={modal.profile.name}
          onClose={() => setModal(null)}
          onSubmit={(name) => onRenameProfile(modal.profile.id, name)}
        />
      )}
      {modal?.type === 'editProfile' && (
        <EditProfileModal
          profile={modal.profile}
          onClose={() => setModal(null)}
          onSubmit={(link) => onEditProfile(modal.profile.id, link)}
        />
      )}
      {modal?.type === 'renameSub' && (
        <RenameModal
          title="Rename Subscription"
          initialValue={modal.sub.name}
          onClose={() => setModal(null)}
          onSubmit={(name) => onUpdateSubscription(modal.sub.id, { name })}
        />
      )}
      {modal?.type === 'editSub' && (
        <EditSubscriptionModal
          sub={modal.sub}
          onClose={() => setModal(null)}
          onSubmit={(patch) => onUpdateSubscription(modal.sub.id, patch)}
        />
      )}
      {modal?.type === 'details' && (
        <SubscriptionDetailsModal sub={modal.sub} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'qr' && (
        <QrModal
          title={modal.title}
          subtitle={modal.subtitle}
          value={modal.value}
          onClose={() => setModal(null)}
          onToast={onToast}
        />
      )}

      {testModal && (
        <SubTestModal
          sub={testModal.sub}
          profiles={profiles}
          mode={testModal.mode}
          autoConnectBest={testModal.autoConnectBest}
          activeProfileId={activeProfileId}
          connectionState={connectionState}
          onConnect={onConnectTo}
          onClose={() => setTestModal(null)}
          onToast={onToast}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={confirmDelete.type === 'subscription' ? 'Delete Subscription' : 'Delete Config'}
          message={
            `Are you sure you want to delete ${confirmDelete.label ? `"${confirmDelete.label}"` : 'this item'}? ` +
            'This action cannot be undone.'
          }
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => {
            if (confirmDelete.type === 'subscription') onDeleteSubscription(confirmDelete.id);
            else onDelete(confirmDelete.id);
          }}
        />
      )}
    </div>
  );
}

function useMemoGroups(filtered, subscriptions, pings) {
  return useMemo(() => {
    const bySub = new Map();
    const noGroup = [];
    for (const p of filtered) {
      if (p.subId) {
        if (!bySub.has(p.subId)) bySub.set(p.subId, []);
        bySub.get(p.subId).push(p);
      } else {
        noGroup.push(p);
      }
    }
    const groups = [];
    if (noGroup.length) groups.push({ key: 'none', sub: null, local: true, items: noGroup, stats: groupStats(noGroup, pings) });
    for (const sub of subscriptions) {
      const items = bySub.get(sub.id) || [];
      if (items.length) groups.push({ key: sub.id, sub, items, stats: groupStats(items, pings) });
    }
    return groups;
  }, [filtered, subscriptions, pings]);
}
