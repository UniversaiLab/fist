import React from 'react';
import {
  Settings, X, RefreshCw, Plus, Zap, ChevronDown, Search, Trash2, Folder, Signal,
  ArrowDown, ArrowUp, Wifi, Database, Shield, SlidersHorizontal, Info, Power, Star,
  Play, Pause, Square, Filter, Gauge, Target, Globe, History, Check, Pencil, Copy,
  Radar, Minus, QrCode, Download, Eye, EyeOff, Store, Tag, Wallet, Upload,
} from 'lucide-react';

// Thin wrapper over lucide-react so every call site keeps using
// <Icon name="..." size={} /> without caring which icon set is behind it.
const ICONS = {
  settings: Settings,
  close: X,
  refresh: RefreshCw,
  plus: Plus,
  bolt: Zap,
  chevron: ChevronDown,
  search: Search,
  trash: Trash2,
  folder: Folder,
  signal: Signal,
  arrowDown: ArrowDown,
  arrowUp: ArrowUp,
  wifi: Wifi,
  database: Database,
  shield: Shield,
  sliders: SlidersHorizontal,
  info: Info,
  power: Power,
  star: Star,
  play: Play,
  pause: Pause,
  stop: Square,
  filter: Filter,
  gauge: Gauge,
  target: Target,
  globe: Globe,
  history: History,
  check: Check,
  edit: Pencil,
  copy: Copy,
  radar: Radar,
  winMinimize: Minus,
  winMaximize: Square,
  winRestore: Copy,
  qrcode: QrCode,
  download: Download,
  eye: Eye,
  eyeOff: EyeOff,
  store: Store,
  tag: Tag,
  wallet: Wallet,
  upload: Upload,
};

export default function Icon({ name, size = 16, strokeWidth = 2, className = '' }) {
  const Cmp = ICONS[name];
  if (!Cmp) return null;
  return (
    <Cmp
      className={`icon icon-${name} ${className}`}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  );
}
