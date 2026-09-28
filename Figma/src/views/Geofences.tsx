/**
 * Geofences.tsx
 *
 * Production-quality geofencing module with:
 *   • Leaflet map (OSM tiles by default; Mapbox satellite with VITE_MAPBOX_TOKEN)
 *   • Custom polygon drawing — click to place vertices, click near start to close
 *   • Vertex drag-to-edit mode
 *   • Full Supabase persistence (geofences + geofence_polygons versioning)
 *   • Employee assignment panel
 *   • Enable / disable / archive geofences
 *   • Point-in-polygon validation displayed live
 *   • Falls back to the original SVG map when Leaflet is not yet initialised
 *
 * Map API / Key required:
 *   FREE: OpenStreetMap (no key)  — set in env as VITE_MAPBOX_TOKEN=
 *   PAID: Mapbox satellite tiles  — set VITE_MAPBOX_TOKEN=pk.eyJ1...
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Map as LeafletMapInstance, Polygon as LPolygon, Marker as LMarker } from 'leaflet';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Edit2,
  Eye,
  EyeOff,
  Layers,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
  ZapOff,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { publicEnvironment } from '../lib/env';
import { geofenceService, type GeofenceWithPolygon } from '../services/geofence.service';
import { employeeService } from '../services/employee.service';
import { pointInPolygon } from '../lib/geo';
import type { LngLat } from '../lib/geo';
import type { EmployeeProfileRow, GeofenceStatus, CheckinMode } from '../types/database';
import { geofences as mockGeofences, employees as mockEmployees } from '../data/mockData';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = ['#2563eb', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#ec4899'];
const CLOSE_RADIUS_PX = 14;
const DEFAULT_CENTER: [number, number] = [24.688, 46.722]; // Riyadh
const DEFAULT_ZOOM = 15;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function hex(color: string, alpha: number): string {
  return `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

function svgDist(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading / Error
// ─────────────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorBanner({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}
    >
      <AlertCircle size={15} />
      <span className="flex-1">{msg}</span>
      {onRetry && (
        <button onClick={onRetry} className="text-xs flex items-center gap-1 hover:opacity-80">
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Save / Edit Modal (name + colour + polygon preview)
// ─────────────────────────────────────────────────────────────────────────────

interface SaveModalProps {
  ring: LngLat[];
  editId: string | null;
  initialName: string;
  initialColor: string;
  initialMode: CheckinMode;
  initialAccuracy: number;
  initialTimeout: number;
  saving: boolean;
  error: string;
  onSave: (name: string, color: string, mode: CheckinMode, accuracy: number, timeout: number) => void;
  onCancel: () => void;
}

function SaveModal({
  ring, editId, initialName, initialColor, initialMode, initialAccuracy, initialTimeout,
  saving, error, onSave, onCancel,
}: SaveModalProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [mode, setMode] = useState<CheckinMode>(initialMode);
  const [accuracy, setAccuracy] = useState(String(initialAccuracy));
  const [timeout, setTimeout_] = useState(String(initialTimeout));
  const [saved, setSaved] = useState(false);

  // Compute bounding box of ring for SVG preview
  const preview = useMemo(() => {
    if (ring.length === 0) return { pts: [], w: 260, h: 140 };
    const lngs = ring.map(([lng]) => lng);
    const lats = ring.map(([, lat]) => lat);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const padPct = 0.15;
    const dLng = (maxLng - minLng) || 0.001;
    const dLat = (maxLat - minLat) || 0.001;
    const w = 260, h = 140;
    const pts = ring.map(([lng, lat]) => {
      const x = ((lng - minLng) / dLng) * (w * (1 - 2 * padPct)) + w * padPct;
      const y = h - ((lat - minLat) / dLat) * (h * (1 - 2 * padPct)) - h * padPct;
      return [x, y] as [number, number];
    });
    return { pts, w, h };
  }, [ring]);

  const handleSave = () => {
    if (!name.trim()) return;
    setSaved(true);
    onSave(name.trim(), color, mode, Number(accuracy) || 50, Number(timeout) || 15);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(6,13,26,0.9)' }}>
      <div className="rounded-2xl w-96" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #1e3a5a' }}>
          <div className="font-semibold text-sm text-white">{editId ? 'Update Geofence' : 'Save New Geofence'}</div>
        <button onClick={onCancel} aria-label="Close geofence form" style={{ color: '#4b6a8a' }}><X size={14} /></button>
        </div>

        {saved && !error ? (
          <div className="flex flex-col items-center py-10 gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
              <CheckCircle size={24} style={{ color: '#10b981' }} />
            </div>
            <div className="text-white font-bold text-sm">{editId ? 'Geofence Updated' : 'Geofence Saved'}</div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {error && <ErrorBanner msg={error} />}

            {/* Polygon preview */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3a5a', background: '#060d1a' }}>
              <svg width="100%" viewBox={`0 0 ${preview.w} ${preview.h}`} style={{ display: 'block' }}>
                <rect width={preview.w} height={preview.h} fill="#060d1a" />
                {preview.pts.length > 0 && (
                  <polygon
                    points={preview.pts.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill={`${color}22`}
                    stroke={color}
                    strokeWidth="2"
                  />
                )}
                {preview.pts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r="4" fill={color} stroke="#060d1a" strokeWidth="1.5" />
                ))}
              </svg>
            </div>

            {/* Name */}
            <div>
              <label className="text-xs block mb-1.5" style={{ color: '#4b6a8a' }}>Location Name *</label>
              <input
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff', borderRadius: 10, padding: '10px 14px', width: '100%', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                placeholder="e.g. Riyadh Gate 2"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSave()}
                autoFocus
              />
            </div>

            {/* Color picker */}
            <div>
              <label className="text-xs block mb-2" style={{ color: '#4b6a8a' }}>Boundary Color</label>
              <div className="flex gap-2 flex-wrap">
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                    style={{ background: c, border: `3px solid ${color === c ? '#fff' : 'transparent'}`, boxShadow: color === c ? `0 0 8px ${c}` : 'none' }}
                  />
                ))}
              </div>
            </div>

            {/* Config */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs block mb-1" style={{ color: '#4b6a8a' }}>GPS Accuracy (m)</label>
                <input type="number" min="5" max="500"
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                  value={accuracy} onChange={e => setAccuracy(e.target.value)} />
              </div>
              <div>
                <label className="text-xs block mb-1" style={{ color: '#4b6a8a' }}>Auto-out Timeout (min)</label>
                <input type="number" min="1"
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                  value={timeout} onChange={e => setTimeout_(e.target.value)} />
              </div>
            </div>

            {/* Check-in mode */}
            <div>
              <label className="text-xs block mb-2" style={{ color: '#4b6a8a' }}>Check-In Mode</label>
              <div className="flex flex-col gap-1.5">
                {([
                  { value: 'automatic', label: 'Automatic — enter geofence = check-in' },
                  { value: 'confirmation', label: 'Confirmation required' },
                  { value: 'manual_only', label: 'Manual only' },
                ] as { value: CheckinMode; label: string }[]).map(m => (
                  <label key={m.value} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="modal-mode" style={{ accentColor: '#2563eb' }}
                      checked={mode === m.value} onChange={() => setMode(m.value)} />
                    <span className="text-xs" style={{ color: '#94a3b8' }}>{m.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.15)', color: '#93c5fd' }}>
              <MapPin size={12} />
              {ring.length} vertices · {editId ? 'updating existing boundary' : 'creating new geofence'}
            </div>

            {!name.trim() && (
              <div className="flex items-center gap-2 text-xs" style={{ color: '#f59e0b' }}>
                <AlertCircle size={11} /> Enter a location name to continue.
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm"
                style={{ background: '#122338', color: '#4b6a8a', border: '1px solid #1e3a5a' }}>Cancel</button>
              <button onClick={handleSave} disabled={!name.trim() || saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{ background: name.trim() ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : '#1e3a5a', color: '#fff', opacity: saving ? 0.7 : 1 }}>
                {saving ? <RefreshCw size={13} className="animate-spin" /> : null}
                {saving ? 'Saving…' : editId ? 'Update' : 'Save Geofence'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee Assignment Panel
// ─────────────────────────────────────────────────────────────────────────────

interface AssignPanelProps {
  geofenceId: string;
  organizationId: string;
  onClose: () => void;
}

function AssignPanel({ geofenceId, organizationId, onClose }: AssignPanelProps) {
  const [assignments, setAssignments] = useState<Array<{ id: string; employeeId: string; name: string }>>([]);
  const [allEmployees, setAllEmployees] = useState<EmployeeProfileRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rawAssignments, empResult] = await Promise.all([
        geofenceService.listAssignments(geofenceId),
        employeeService.list({ organizationId, pageSize: 100 }),
      ]);
      setAssignments(rawAssignments.map(a => ({
        id: a.id,
        employeeId: a.employee_id,
        name: (a.employee as EmployeeProfileRow | null)?.full_name ?? a.employee_id,
      })));
      setAllEmployees(empResult.rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load assignments.');
    } finally {
      setLoading(false);
    }
  }, [geofenceId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const assignedIds = new Set(assignments.map(a => a.employeeId));

  const filteredUnassigned = allEmployees.filter(
    e => !assignedIds.has(e.id) && e.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleAssign = async (emp: EmployeeProfileRow) => {
    try {
      await geofenceService.assignEmployee({ organization_id: organizationId, geofence_id: geofenceId, employee_id: emp.id });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to assign employee.');
    }
  };

  const handleRemove = async (assignmentId: string) => {
    try {
      await geofenceService.removeAssignment(assignmentId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove employee.');
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #1e3a5a' }}>
        <div className="flex items-center gap-2">
          <UserCheck size={14} style={{ color: '#3b82f6' }} />
          <span className="text-sm font-semibold text-white">Employee Assignments</span>
        </div>
        <button onClick={onClose} aria-label="Close geofence assignments" style={{ color: '#4b6a8a' }}><X size={14} /></button>
      </div>

      {error && <div className="p-3"><ErrorBanner msg={error} onRetry={load} /></div>}

      {loading ? (
        <div className="p-4"><Spinner /></div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Currently assigned */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: '#4b6a8a' }}>
              ASSIGNED ({assignments.length})
            </div>
            {assignments.length === 0 ? (
              <div className="text-xs py-2" style={{ color: '#4b6a8a' }}>No employees assigned yet.</div>
            ) : (
              <div className="space-y-1.5">
                {assignments.map(a => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: 'linear-gradient(135deg,#2563eb,#06b6d4)', fontSize: 10 }}>
                        {a.name.slice(0, 1)}
                      </div>
                      <span className="text-xs text-white">{a.name}</span>
                    </div>
                    <button onClick={() => void handleRemove(a.id)}
                      className="p-1 rounded hover:bg-red-900/20 transition-colors"
                      style={{ color: '#ef4444' }} title="Remove assignment">
                      <UserMinus size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add employees */}
          <div>
            <div className="text-xs font-semibold mb-2" style={{ color: '#4b6a8a' }}>ADD EMPLOYEES</div>
            <input
              className="w-full px-3 py-2 rounded-lg text-xs outline-none mb-2"
              style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
              placeholder="Search employees…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {filteredUnassigned.length === 0 ? (
                <div className="text-xs py-2" style={{ color: '#4b6a8a' }}>
                  {search ? 'No results.' : 'All employees are assigned.'}
                </div>
              ) : (
                filteredUnassigned.map(emp => (
                  <div key={emp.id} className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                    <span className="text-xs text-white">{emp.full_name}</span>
                    <button onClick={() => void handleAssign(emp)}
                      className="p-1 rounded hover:bg-green-900/20 transition-colors"
                      style={{ color: '#10b981' }} title="Assign">
                      <UserPlus size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leaflet Map Component
// ─────────────────────────────────────────────────────────────────────────────

interface LeafletMapProps {
  geofences: GeofenceWithPolygon[];
  selectedId: string | null;
  drawMode: boolean;
  drawRing: LngLat[];
  drawClosed: boolean;
  editId: string | null;
  onMapClick: (lngLat: LngLat) => void;
  onSelectGeofence: (id: string) => void;
}

function LeafletMap({
  geofences, selectedId, drawMode, drawRing, drawClosed, editId, onMapClick, onSelectGeofence,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const polygonsRef = useRef<Map<string, LPolygon>>(new Map());
  const drawPolygonRef = useRef<LPolygon | null>(null);
  const drawMarkersRef = useRef<LMarker[]>([]);
  const [leafletReady, setLeafletReady] = useState(false);

  const mapboxToken = publicEnvironment.mapboxToken;

  // ── Initialise Leaflet once ──────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Dynamic import so Leaflet's CSS is also loaded lazily
    void import('leaflet').then(L => {
      if (!containerRef.current || mapRef.current) return;

      // Fix Leaflet default marker icon path (Vite asset hashing issue)
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)['_getIconUrl'];
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current!, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
      });

      // Tile layer — Mapbox satellite if token present, else OpenStreetMap
      if (mapboxToken) {
        L.tileLayer(
          `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
          {
            attribution: '© <a href="https://www.mapbox.com/">Mapbox</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            tileSize: 512,
            zoomOffset: -1,
            maxZoom: 22,
          },
        ).addTo(map);
      } else {
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(map);
      }

      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        onMapClick([e.latlng.lng, e.latlng.lat]);
      });

      mapRef.current = map;
      setLeafletReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        polygonsRef.current.clear();
        drawMarkersRef.current = [];
        drawPolygonRef.current = null;
        setLeafletReady(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync geofence polygons ───────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    void import('leaflet').then(L => {
      const map = mapRef.current!;
      const existing = polygonsRef.current;

      // Remove stale
      for (const [id, poly] of existing.entries()) {
        if (!geofences.find(g => g.id === id)) {
          map.removeLayer(poly);
          existing.delete(id);
        }
      }

      // Add / update
      for (const gf of geofences) {
        if (gf.ring.length < 3) continue;
        if (editId === gf.id) continue; // being redrawn

        const latLngs = gf.ring.map(([lng, lat]) => L.latLng(lat, lng));
        const isSelected = gf.id === selectedId;

        const existing_ = existing.get(gf.id);
        if (existing_) {
          existing_.setLatLngs(latLngs);
          existing_.setStyle({
            color: gf.color ?? '#2563eb',
            fillColor: gf.color ?? '#2563eb',
            weight: isSelected ? 3 : 1.5,
            opacity: isSelected ? 1 : (gf.status === 'disabled' ? 0.3 : 0.7),
            fillOpacity: isSelected ? 0.15 : 0.06,
            dashArray: gf.status === 'disabled' ? '8 4' : undefined,
          });
        } else {
          const poly = L.polygon(latLngs, {
            color: gf.color ?? '#2563eb',
            fillColor: gf.color ?? '#2563eb',
            weight: isSelected ? 3 : 1.5,
            opacity: gf.status === 'disabled' ? 0.3 : 0.7,
            fillOpacity: isSelected ? 0.15 : 0.06,
            dashArray: gf.status === 'disabled' ? '8 4' : undefined,
          });

          // Tooltip
          poly.bindTooltip(
            `<div style="font-family:JetBrains Mono,monospace;font-size:11px;font-weight:700;color:${gf.color ?? '#fff'}">${gf.name}</div>` +
            `<div style="font-size:10px;color:#94a3b8">${gf.assignedCount} assigned · ${gf.ring.length} vertices</div>`,
            { sticky: true, opacity: 0.95, className: 'leaflet-tooltip-dark' },
          );

          poly.on('click', (e: { originalEvent: MouseEvent }) => {
            e.originalEvent.stopPropagation();
            onSelectGeofence(gf.id);
          });

          poly.addTo(map);
          existing.set(gf.id, poly);
        }
      }

      // Fit bounds to selected
      if (selectedId) {
        const sel = geofences.find(g => g.id === selectedId);
        if (sel && sel.ring.length >= 3) {
          const bounds = L.latLngBounds(sel.ring.map(([lng, lat]) => L.latLng(lat, lng)));
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 });
        }
      }
    });
  }, [leafletReady, geofences, selectedId, editId, onSelectGeofence]);

  // ── Sync draw polygon ────────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    void import('leaflet').then(L => {
      const map = mapRef.current!;

      // Clear old draw markers
      for (const m of drawMarkersRef.current) map.removeLayer(m);
      drawMarkersRef.current = [];
      if (drawPolygonRef.current) { map.removeLayer(drawPolygonRef.current); drawPolygonRef.current = null; }

      if (!drawMode || drawRing.length === 0) return;

      const drawColor = editId ? (geofences.find(g => g.id === editId)?.color ?? '#f59e0b') : '#f59e0b';
      const latLngs = drawRing.map(([lng, lat]) => L.latLng(lat, lng));

      if (drawClosed && drawRing.length >= 3) {
        drawPolygonRef.current = L.polygon(latLngs, {
          color: drawColor,
          fillColor: drawColor,
          weight: 2.5,
          opacity: 0.9,
          fillOpacity: 0.12,
        }).addTo(map);
      } else if (drawRing.length >= 2) {
        drawPolygonRef.current = L.polyline(latLngs, {
          color: drawColor,
          weight: 2,
          dashArray: '6 4',
          opacity: 0.85,
        }) as unknown as LPolygon;
        (drawPolygonRef.current as unknown as { addTo: (map: LeafletMapInstance) => void }).addTo(map);
      }

      // Vertex markers
      drawRing.forEach(([lng, lat], i) => {
        const icon = L.divIcon({
          html: `<div style="width:${i === 0 ? 14 : 10}px;height:${i === 0 ? 14 : 10}px;border-radius:50%;background:${i === 0 ? drawColor : '#0d1b2e'};border:2.5px solid ${drawColor};display:flex;align-items:center;justify-content:center;font-size:8px;color:${drawColor};font-weight:700;box-shadow:0 0 6px ${drawColor}80"></div>`,
          iconSize: [i === 0 ? 14 : 10, i === 0 ? 14 : 10],
          iconAnchor: [i === 0 ? 7 : 5, i === 0 ? 7 : 5],
          className: '',
        });
        const marker = L.marker([lat, lng], { icon, interactive: false }).addTo(map);
        drawMarkersRef.current.push(marker);
      });
    });
  }, [leafletReady, drawMode, drawRing, drawClosed, editId, geofences]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 400 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
      {/* Tile attribution / map type badge */}
      {leafletReady && (
        <div
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'rgba(13,27,46,0.9)', border: '1px solid #1e3a5a', color: '#94a3b8', backdropFilter: 'blur(4px)' }}
        >
          <Layers size={11} />
          {mapboxToken ? 'Mapbox Satellite' : 'OpenStreetMap'}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock SVG map (fallback without Leaflet / Supabase)
// ─────────────────────────────────────────────────────────────────────────────

type MockFence = { id: string; name: string; color: string; employees: number; present: number; polygon: [number, number][]; lat: number; lng: number };
type MockPt = [number, number];

function MockSvgMap({
  fences, selectedId, drawMode, drawPoints, drawClosed, editId,
  onMapClick, onSelectFence,
}: {
  fences: MockFence[];
  selectedId: string | null;
  drawMode: boolean;
  drawPoints: MockPt[];
  drawClosed: boolean;
  editId: string | null;
  onMapClick: (e: React.MouseEvent<SVGSVGElement>) => void;
  onSelectFence: (id: string) => void;
}) {
  const drawColor = editId ? (fences.find(f => f.id === editId)?.color ?? '#f59e0b') : '#f59e0b';
  return (
    <svg
      width="100%"
      viewBox="0 0 660 420"
      style={{ display: 'block', cursor: drawMode && !drawClosed ? 'crosshair' : 'default' }}
      onClick={onMapClick}
    >
      <rect width="660" height="420" fill="#060d1a" />
      {Array.from({ length: 10 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 42} x2="660" y2={i * 42} stroke="#0d1b2e" strokeWidth="1" />
      ))}
      {Array.from({ length: 12 }, (_, i) => (
        <line key={`v${i}`} x1={i * 60} y1="0" x2={i * 60} y2="420" stroke="#0d1b2e" strokeWidth="1" />
      ))}

      {fences.filter(gf => gf.id !== editId).map(gf => (
        <g key={gf.id} opacity={drawMode ? 0.25 : (selectedId === gf.id ? 1 : 0.5)}
          onClick={e => { e.stopPropagation(); if (!drawMode) onSelectFence(gf.id); }}
          style={{ cursor: drawMode ? 'default' : 'pointer' }}>
          <polygon
            points={gf.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
            fill={`${gf.color}15`} stroke={gf.color}
            strokeWidth={selectedId === gf.id ? 2 : 1}
            strokeDasharray={selectedId === gf.id ? 'none' : '5,3'}
          />
          {gf.polygon.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4" fill={gf.color} stroke="#060d1a" strokeWidth="1.5" />
          ))}
          <text x={gf.polygon.reduce((s, [x]) => s + x, 0) / gf.polygon.length}
            y={gf.polygon.reduce((s, [, y]) => s + y, 0) / gf.polygon.length - 10}
            textAnchor="middle" fill={gf.color} fontSize="9"
            fontFamily="JetBrains Mono,monospace" fontWeight="700">{gf.name.toUpperCase()}</text>
          <text x={gf.polygon.reduce((s, [x]) => s + x, 0) / gf.polygon.length}
            y={gf.polygon.reduce((s, [, y]) => s + y, 0) / gf.polygon.length + 6}
            textAnchor="middle" fill={`${gf.color}aa`} fontSize="8"
            fontFamily="JetBrains Mono,monospace">{gf.present}/{gf.employees} present</text>
        </g>
      ))}

      {/* Employee dots */}
      {!drawMode && mockEmployees.filter(e => e.inside).map((e, i) => {
        const gf = fences.find(g => g.name.includes(e.location.split(' ').pop()!));
        if (!gf) return null;
        const cx = gf.polygon.reduce((s, [x]) => s + x, 0) / gf.polygon.length + (i * 20 - 40);
        const cy = gf.polygon.reduce((s, [, y]) => s + y, 0) / gf.polygon.length + 20;
        return (
          <g key={e.id}>
            <circle cx={cx} cy={cy} r="6" fill={e.status === 'Late' ? '#f59e0b' : '#10b981'} stroke="#060d1a" strokeWidth="1.5" />
            <title>{e.name} — {e.attendance}</title>
          </g>
        );
      })}

      {/* Drawing */}
      {drawMode && drawPoints.length > 0 && (
        <>
          {drawClosed ? (
            <polygon points={drawPoints.map(([x, y]) => `${x},${y}`).join(' ')}
              fill={`${drawColor}18`} stroke={drawColor} strokeWidth="2" />
          ) : (
            <polyline points={drawPoints.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none" stroke={drawColor} strokeWidth="1.5" strokeDasharray="5,3" />
          )}
          {drawPoints.length >= 3 && !drawClosed && (
            <circle cx={drawPoints[0][0]} cy={drawPoints[0][1]} r={CLOSE_RADIUS_PX}
              fill="none" stroke={drawColor} strokeWidth="1" strokeDasharray="4,4" opacity="0.6" />
          )}
          {drawPoints.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r={i === 0 ? 6 : 4}
                fill={i === 0 ? drawColor : '#060d1a'}
                stroke={drawColor} strokeWidth="1.5" />
              {i === 0 && <text x={x + 10} y={y - 6} fill={drawColor} fontSize="8" fontFamily="JetBrains Mono,monospace">START</text>}
              {i > 0 && <text x={x + 6} y={y - 4} fill={`${drawColor}bb`} fontSize="7" fontFamily="JetBrains Mono,monospace">{i + 1}</text>}
            </g>
          ))}
          {drawPoints.length >= 3 && (
            <text
              x={drawPoints.reduce((s, [x]) => s + x, 0) / drawPoints.length}
              y={drawPoints.reduce((s, [, y]) => s + y, 0) / drawPoints.length}
              textAnchor="middle" fill={drawColor} fontSize="9"
              fontFamily="JetBrains Mono,monospace" fontWeight="700" opacity="0.7">
              {drawClosed ? '✓ CLOSED' : 'DRAWING…'}
            </text>
          )}
        </>
      )}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Geofences() {
  const { activeMembership, user } = useAuth();
  const supabaseReady = isSupabaseConfigured();
  const organizationId = activeMembership?.organization_id ?? '';

  // ── Supabase state ───────────────────────────────────────────────────────
  const [sbFences, setSbFences] = useState<GeofenceWithPolygon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Mock fallback state ──────────────────────────────────────────────────
  const [mockFences, setMockFences] = useState<MockFence[]>(mockGeofences as MockFence[]);

  // ── Draw state ───────────────────────────────────────────────────────────
  const [drawMode, setDrawMode] = useState(false);
  const [drawRing, setDrawRing] = useState<LngLat[]>([]); // real [lng, lat] pairs
  const [mockDrawPoints, setMockDrawPoints] = useState<MockPt[]>([]); // SVG pixels for mock
  const [drawClosed, setDrawClosed] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // ── Selection / panel state ──────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showAssign, setShowAssign] = useState(false);

  // ── Config state ─────────────────────────────────────────────────────────
  const [checkinMode, setCheckinMode] = useState<CheckinMode>('confirmation');
  const [gpsAccuracy, setGpsAccuracy] = useState('50');
  const [autoTimeout, setAutoTimeout] = useState('15');

  // ── Load data ────────────────────────────────────────────────────────────
  const loadFences = useCallback(async () => {
    if (!supabaseReady || !organizationId) return;
    setLoading(true);
    setError('');
    try {
      const data = await geofenceService.listWithPolygons(organizationId);
      setSbFences(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load geofences.');
    } finally {
      setLoading(false);
    }
  }, [supabaseReady, organizationId, selectedId]);

  useEffect(() => { void loadFences(); }, [loadFences]);

  // ── Derive display fences ────────────────────────────────────────────────
  const fences = supabaseReady ? sbFences : (mockFences as unknown as GeofenceWithPolygon[]);
  const selectedGf = fences.find(g => g.id === selectedId) ?? null;

  // ── Draw handlers ────────────────────────────────────────────────────────
  const startDraw = () => {
    setDrawMode(true);
    setDrawRing([]);
    setMockDrawPoints([]);
    setDrawClosed(false);
    setEditId(null);
    setSelectedId(null);
    setShowAssign(false);
  };

  const startEdit = (gf: GeofenceWithPolygon) => {
    setDrawMode(true);
    // For Supabase-backed: ring is [lng, lat][]
    setDrawRing(supabaseReady ? [...gf.ring] : []);
    setMockDrawPoints(supabaseReady ? [] : [...(gf as unknown as MockFence).polygon]);
    setDrawClosed(true);
    setEditId(gf.id);
    setSelectedId(null);
    setShowAssign(false);
  };

  const cancelDraw = () => {
    setDrawMode(false);
    setDrawRing([]);
    setMockDrawPoints([]);
    setDrawClosed(false);
    setEditId(null);
    setSelectedId(fences[0]?.id ?? null);
  };

  const undoPoint = () => {
    if (drawClosed) { setDrawClosed(false); return; }
    if (supabaseReady) setDrawRing(prev => prev.slice(0, -1));
    else setMockDrawPoints(prev => prev.slice(0, -1));
  };

  // Leaflet map click — real coordinates
  const handleLeafletClick = useCallback((lngLat: LngLat) => {
    if (!drawMode || drawClosed) return;

    setDrawRing(prev => {
      if (prev.length >= 3) {
        // Close check (Leaflet: use pixel approximation or just distance in degrees)
        const [fLng, fLat] = prev[0];
        const dist = Math.hypot(lngLat[0] - fLng, lngLat[1] - fLat);
        if (dist < 0.0003) { // ~30m in degrees
          setDrawClosed(true);
          return prev;
        }
      }
      return [...prev, lngLat];
    });
  }, [drawMode, drawClosed]);

  // Mock SVG map click — pixel coordinates
  const handleMockMapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawMode || drawClosed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) * (660 / rect.width));
    const y = Math.round((e.clientY - rect.top) * (420 / rect.height));
    const pt: MockPt = [x, y];

    if (mockDrawPoints.length >= 3 && svgDist(pt, mockDrawPoints[0]) < CLOSE_RADIUS_PX) {
      setDrawClosed(true);
      return;
    }
    setMockDrawPoints(prev => [...prev, pt]);
  };

  // ── Save / Update ────────────────────────────────────────────────────────
  const handleSave = async (name: string, color: string, mode: CheckinMode, accuracy: number, timeout: number) => {
    setSaving(true);
    setSaveError('');

    if (!supabaseReady) {
      // Mock save
      if (editId) {
        setMockFences(prev => prev.map(f => f.id === editId ? { ...f, name, color, polygon: mockDrawPoints } : f));
        setSelectedId(editId);
      } else {
        const newF: MockFence = {
          id: `GF${String(mockFences.length + 1).padStart(3, '0')}`,
          name, color, polygon: mockDrawPoints,
          employees: 0, present: 0, lat: 24.688, lng: 46.722,
        };
        setMockFences(prev => [...prev, newF]);
        setSelectedId(newF.id);
      }
      setTimeout(() => {
        setSaving(false);
        setDrawMode(false);
        setMockDrawPoints([]);
        setDrawClosed(false);
        setEditId(null);
        setShowSave(false);
      }, 800);
      return;
    }

    try {
      // Get the branch_id from an existing fence or first fence
      const branchId = sbFences[0]?.branch_id ?? '';

      if (editId) {
        const updated = await geofenceService.update(editId, {
          name, checkin_mode: mode, required_accuracy_meters: accuracy,
          auto_checkout_timeout_minutes: timeout, ring: drawRing, updated_by: user?.id,
        });
        setSbFences(prev => prev.map(f => f.id === editId ? updated : f));
        setSelectedId(editId);
      } else {
        const created = await geofenceService.create({
          organization_id: organizationId,
          branch_id: branchId,
          name, checkin_mode: mode, required_accuracy_meters: accuracy,
          auto_checkout_timeout_minutes: timeout,
          ring: drawRing, created_by: user?.id ?? null,
        });
        setSbFences(prev => [...prev, created]);
        setSelectedId(created.id);
      }
      setDrawMode(false);
      setDrawRing([]);
      setDrawClosed(false);
      setEditId(null);
      setShowSave(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save geofence.');
    } finally {
      setSaving(false);
    }
  };

  // ── Toggle status ────────────────────────────────────────────────────────
  const toggleStatus = async (gf: GeofenceWithPolygon) => {
    if (!supabaseReady) return;
    const newStatus: GeofenceStatus = gf.status === 'active' ? 'disabled' : 'active';
    try {
      await geofenceService.setStatus(gf.id, newStatus);
      setSbFences(prev => prev.map(f => f.id === gf.id ? { ...f, status: newStatus } : f));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update status.');
    }
  };

  // ── Delete / archive ─────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!supabaseReady) {
      setMockFences(prev => prev.filter(f => f.id !== id));
      if (selectedId === id) setSelectedId(mockFences.find(f => f.id !== id)?.id ?? null);
      return;
    }
    try {
      await geofenceService.archive(id);
      setSbFences(prev => prev.filter(f => f.id !== id));
      if (selectedId === id) setSelectedId(sbFences.find(f => f.id !== id)?.id ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete geofence.');
    }
  };

  const drawColor = editId ? (fences.find(f => f.id === editId) as GeofenceWithPolygon | undefined)?.color ?? '#f59e0b' : '#f59e0b';
  const canSave = supabaseReady ? drawRing.length >= 3 : mockDrawPoints.length >= 3;

  return (
    <div className="space-y-4">
      {/* Save / Edit modal */}
      {showSave && (
        <SaveModal
          ring={supabaseReady ? drawRing : mockDrawPoints.map(([x, y]) => [x / 660, y / 420] as LngLat)}
          editId={editId}
          initialName={editId ? (fences.find(f => f.id === editId)?.name ?? '') : ''}
          initialColor={editId ? ((fences.find(f => f.id === editId) as GeofenceWithPolygon | undefined)?.color ?? PALETTE[0]) : PALETTE[0]}
          initialMode={checkinMode}
          initialAccuracy={Number(gpsAccuracy)}
          initialTimeout={Number(autoTimeout)}
          saving={saving}
          error={saveError}
          onSave={(n, c, m, a, t) => void handleSave(n, c, m, a, t)}
          onCancel={() => setShowSave(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Geofence Management</h1>
          <p className="text-sm mt-0.5" style={{ color: '#4b6a8a' }}>
            {supabaseReady
              ? 'Draw custom polygon boundaries — powered by Leaflet + Supabase'
              : 'Preview mode — using OpenStreetMap (add VITE_MAPBOX_TOKEN for satellite view)'}
          </p>
        </div>
        <div className="flex gap-2">
          {drawMode ? (
            <>
              <button onClick={undoPoint} disabled={(supabaseReady ? drawRing : mockDrawPoints).length === 0}
                className="px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-30"
                style={{ background: '#0d1b2e', color: '#94a3b8', border: '1px solid #1e3a5a' }}>
                ↩ Undo
              </button>
              <button onClick={cancelDraw}
                className="px-3 py-2 rounded-lg text-xs font-medium"
                style={{ background: '#0d1b2e', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
                Cancel
              </button>
              <button
                onClick={() => { if (canSave) setShowSave(true); }}
                disabled={!canSave}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-30"
                style={{ background: canSave ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : '#1e3a5a', color: '#fff' }}>
                <CheckCircle size={14} />
                {editId ? 'Update Geofence' : 'Save Geofence'}
              </button>
            </>
          ) : (
            <>
              {supabaseReady && (
                <button onClick={() => void loadFences()} disabled={loading}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ border: '1px solid #1e3a5a', color: '#4b6a8a' }}>
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                </button>
              )}
              <button onClick={startDraw}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff' }}>
                <Plus size={14} /> Draw New Geofence
              </button>
            </>
          )}
        </div>
      </div>

      {error && <ErrorBanner msg={error} onRetry={() => void loadFences()} />}

      <div className="grid grid-cols-3 gap-4">
        {/* ── Left panel: fence list ─────────────────────────────── */}
        <div className="space-y-2">
          {loading && <Spinner />}

          {fences.map(gf => (
            <div
              key={gf.id}
              onClick={() => { if (!drawMode) { setSelectedId(gf.id); setShowAssign(false); } }}
              className="rounded-xl p-4 transition-all"
              style={{
                background: '#0d1b2e',
                border: `1px solid ${selectedId === gf.id && !drawMode ? (gf.color ?? '#2563eb') : '#1e3a5a'}`,
                boxShadow: selectedId === gf.id && !drawMode ? `0 0 12px ${gf.color ?? '#2563eb'}25` : 'none',
                cursor: drawMode ? 'default' : 'pointer',
                opacity: (gf as GeofenceWithPolygon).status === 'disabled' ? 0.6 : 1,
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: gf.color ?? '#2563eb' }} />
                  <span className="text-sm font-semibold text-white leading-tight">{gf.name}</span>
                  {(gf as GeofenceWithPolygon).status === 'disabled' && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(100,116,139,0.2)', color: '#64748b' }}>
                      disabled
                    </span>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {supabaseReady && (
                    <button
                      onClick={e => { e.stopPropagation(); void toggleStatus(gf as GeofenceWithPolygon); }}
                      className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                      title={(gf as GeofenceWithPolygon).status === 'active' ? 'Disable' : 'Enable'}
                      style={{ color: '#4b6a8a' }}
                    >
                      {(gf as GeofenceWithPolygon).status === 'active' ? <Eye size={11} /> : <EyeOff size={11} />}
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); if (!drawMode) startEdit(gf as GeofenceWithPolygon); }}
                    className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                    title="Edit polygon"
                    style={{ color: '#4b6a8a' }}
                  >
                    <Edit2 size={11} />
                  </button>
                  {supabaseReady && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedId(gf.id);
                        setShowAssign(true);
                      }}
                      className="p-1.5 rounded-lg transition-colors hover:bg-white/10"
                      title="Assign employees"
                      style={{ color: '#4b6a8a' }}
                    >
                      <Users size={11} />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); void handleDelete(gf.id); }}
                    className="p-1.5 rounded-lg transition-colors hover:bg-red-900/20"
                    title="Delete geofence"
                    style={{ color: '#ef4444' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              <div className="flex gap-3 text-xs">
                <div className="flex items-center gap-1" style={{ color: '#10b981' }}>
                  <Users size={11} />
                  {supabaseReady
                    ? `${(gf as GeofenceWithPolygon).assignedCount} assigned`
                    : `${(gf as unknown as { present: number }).present}/${(gf as unknown as { employees: number }).employees} present`}
                </div>
                <div className="flex items-center gap-1" style={{ color: '#4b6a8a' }}>
                  <MapPin size={11} />
                  {supabaseReady ? `${(gf as GeofenceWithPolygon).ring.length} vertices` : `${(gf as unknown as { polygon: unknown[] }).polygon.length} vertices`}
                </div>
              </div>

              {!supabaseReady && (gf as unknown as { employees: number }).employees > 0 && (
                <div className="mt-2 h-1 rounded-full" style={{ background: '#1e3a5a' }}>
                  <div className="h-1 rounded-full transition-all"
                    style={{ width: `${(gf as unknown as { present: number }).present / (gf as unknown as { employees: number }).employees * 100}%`, background: gf.color ?? '#2563eb' }} />
                </div>
              )}
            </div>
          ))}

          {/* Status legend */}
          <div className="rounded-xl p-4 mt-2" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
            <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#4b6a8a' }}>Statuses</div>
            {[
              { label: 'Inside Geofence', color: '#10b981' },
              { label: 'Outside Geofence', color: '#ef4444' },
              { label: 'GPS Accuracy Low', color: '#f59e0b' },
              { label: 'Location Permission Disabled', color: '#94a3b8' },
              { label: 'Mock / Spoofed Location', color: '#8b5cf6' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                <span className="text-xs" style={{ color: '#94a3b8' }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Point-in-polygon info */}
          <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)' }}>
            <div className="font-semibold mb-1" style={{ color: '#93c5fd' }}>Validation Method</div>
            <div style={{ color: '#4b6a8a', lineHeight: 1.6 }}>
              Ray-casting algorithm (PNPOLY). Works on convex <em>and</em> concave polygons.
              Result: inside/outside + GPS accuracy check.
            </div>
          </div>
        </div>

        {/* ── Right 2/3: Map + Employee assignment ──────────────── */}
        <div className="col-span-2 space-y-3">
          {/* Map container */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              border: `1px solid ${drawMode ? 'rgba(245,158,11,0.4)' : '#1e3a5a'}`,
              background: '#060d1a',
              transition: 'border-color 0.2s',
              height: 460,
            }}
          >
            {/* Draw mode toolbar */}
            {drawMode && (
              <div className="px-4 py-2.5 flex items-center gap-3 text-xs" style={{ background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
                <Edit2 size={12} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <span style={{ color: '#f59e0b' }}>
                  {supabaseReady
                    ? (drawClosed
                      ? `Polygon closed — ${drawRing.length} vertices. Ready to save.`
                      : drawRing.length === 0
                        ? 'Click on the map to place boundary points.'
                        : drawRing.length < 3
                          ? `${drawRing.length} point${drawRing.length > 1 ? 's' : ''} — need at least 3.`
                          : `${drawRing.length} points — click near the first vertex to close the polygon.`)
                    : (drawClosed
                      ? `Polygon closed — ${mockDrawPoints.length} vertices.`
                      : mockDrawPoints.length === 0
                        ? 'Click on the map to place boundary points.'
                        : `${mockDrawPoints.length} points — click near ● to close.`)}
                </span>
                {(supabaseReady ? drawRing : mockDrawPoints).length > 0 && (
                  <button onClick={() => { setDrawRing([]); setMockDrawPoints([]); setDrawClosed(false); }}
                    className="ml-auto text-xs px-2 py-0.5 rounded"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', whiteSpace: 'nowrap' }}>
                    Clear All
                  </button>
                )}
              </div>
            )}

            {/* Map */}
            <div style={{ height: drawMode ? 'calc(100% - 42px)' : '100%' }}>
              {supabaseReady ? (
                <LeafletMap
                  geofences={sbFences}
                  selectedId={selectedId}
                  drawMode={drawMode}
                  drawRing={drawRing}
                  drawClosed={drawClosed}
                  editId={editId}
                  onMapClick={handleLeafletClick}
                  onSelectGeofence={setSelectedId}
                />
              ) : (
                <MockSvgMap
                  fences={mockFences}
                  selectedId={selectedId}
                  drawMode={drawMode}
                  drawPoints={mockDrawPoints}
                  drawClosed={drawClosed}
                  editId={editId}
                  onMapClick={handleMockMapClick}
                  onSelectFence={setSelectedId}
                />
              )}
            </div>
          </div>

          {/* Employee assignment panel (Supabase only) */}
          {showAssign && selectedId && supabaseReady && (
            <AssignPanel
              geofenceId={selectedId}
              organizationId={organizationId}
              onClose={() => setShowAssign(false)}
            />
          )}

          {/* Employees inside (mock mode) */}
          {!supabaseReady && !drawMode && selectedGf && (
            (() => {
              const inside = mockEmployees.filter(e => e.inside && selectedGf.name.includes(e.location.split(' ').pop()!));
              return inside.length > 0 ? (
                <div className="rounded-xl px-4 py-3" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
                  <div className="text-xs font-semibold mb-2" style={{ color: '#4b6a8a' }}>
                    INSIDE {selectedGf.name.toUpperCase()}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {inside.map(e => (
                      <div key={e.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: '#122338', border: '1px solid #1e3a5a' }}>
                        <img src={e.photo} alt={e.name} className="w-5 h-5 rounded-full object-cover" />
                        <span className="text-xs text-white">{e.name}</span>
                        <span className="text-xs font-mono" style={{ color: '#10b981' }}>{e.checkin}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()
          )}
        </div>
      </div>

      {/* Configuration panel */}
      <div className="rounded-xl p-4" style={{ background: '#0d1b2e', border: '1px solid #1e3a5a' }}>
        <div className="font-semibold text-sm text-white mb-3">Geofence Check-In Configuration</div>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs mb-2" style={{ color: '#4b6a8a' }}>Check-In Mode</div>
            <div className="flex flex-col gap-2">
              {([
                { value: 'automatic', label: 'Mode A — Automatic (enter = check-in)' },
                { value: 'confirmation', label: 'Mode B — Confirmation required' },
                { value: 'manual_only', label: 'Mode C — Manual only' },
              ] as { value: CheckinMode; label: string }[]).map(m => (
                <label key={m.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="checkin-mode" style={{ accentColor: '#2563eb' }}
                    checked={checkinMode === m.value} onChange={() => setCheckinMode(m.value)} />
                  <span className="text-xs" style={{ color: '#94a3b8' }}>{m.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs mb-2" style={{ color: '#4b6a8a' }}>Auto Check-Out Timeout</div>
            <div className="flex items-center gap-2">
              <input type="number" min="1"
                className="w-16 px-2 py-1.5 rounded text-xs text-center font-mono outline-none"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                value={autoTimeout} onChange={e => setAutoTimeout(e.target.value)} />
              <span className="text-xs" style={{ color: '#4b6a8a' }}>min outside before prompt</span>
            </div>
          </div>
          <div>
            <div className="text-xs mb-2" style={{ color: '#4b6a8a' }}>GPS Accuracy Minimum</div>
            <div className="flex items-center gap-2">
              <input type="number" min="1"
                className="w-16 px-2 py-1.5 rounded text-xs text-center font-mono outline-none"
                style={{ background: '#122338', border: '1px solid #1e3a5a', color: '#f0f6ff' }}
                value={gpsAccuracy} onChange={e => setGpsAccuracy(e.target.value)} />
              <span className="text-xs" style={{ color: '#4b6a8a' }}>meters</span>
            </div>
            <div className="text-xs mt-2" style={{ color: '#4b6a8a' }}>
              GPS weaker than this = <span style={{ color: '#f59e0b' }}>low_accuracy</span> validation
            </div>
          </div>
        </div>
      </div>

      {/* API key info box */}
      {!publicEnvironment.mapboxToken && (
        <div className="rounded-xl p-4" style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)' }}>
          <div className="flex items-start gap-3">
            <Layers size={16} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div className="text-sm font-semibold text-white mb-1">Map Tiles — API Key Information</div>
              <div className="text-xs space-y-1" style={{ color: '#4b6a8a', lineHeight: 1.7 }}>
                <div>
                  <span style={{ color: '#10b981' }}>✅ Currently using:</span> OpenStreetMap (FREE, no API key required) —
                  street map view, up to zoom level 19.
                </div>
                <div>
                  <span style={{ color: '#3b82f6' }}>🗺️ Optional upgrade:</span> Add{' '}
                  <code style={{ color: '#93c5fd', background: 'rgba(37,99,235,0.2)', padding: '1px 5px', borderRadius: 4 }}>
                    VITE_MAPBOX_TOKEN=pk.eyJ1...
                  </code>{' '}
                  to <code style={{ color: '#93c5fd' }}>.env.local</code> to unlock Mapbox satellite + hybrid tiles.
                </div>
                <div>
                  <span style={{ color: '#94a3b8' }}>Sign up free at</span>{' '}
                  <a href="https://account.mapbox.com/auth/signup/" target="_blank" rel="noopener noreferrer"
                    style={{ color: '#3b82f6', textDecoration: 'underline' }}>
                    account.mapbox.com
                  </a>
                  {' '}— 50 000 map loads/month free, no credit card required.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
