import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Layers, MapPin } from 'lucide-react';
import type { Map as LeafletMapInstance, Polygon as LPolygon, Marker as LMarker } from 'leaflet';
import { publicEnvironment } from '../lib/env';
import type { GeofenceWithPolygon } from '../services/geofence.service';
import type { WorkforcePosition } from '../services/dashboard.service';

// Riyadh — matches the Geofences view default so an empty map isn't lost at sea.
const DEFAULT_CENTER: [number, number] = [24.688, 46.722];
const DEFAULT_ZOOM = 15;

const INSIDE_COLOR = '#10b981';
const OUTSIDE_COLOR = '#ef4444';

interface WorkforceMapProps {
  geofences: GeofenceWithPolygon[];
  positions: WorkforcePosition[];
}

function markerHtml(color: string, approximate: boolean): string {
  const ring = approximate
    ? `border:2px dashed ${color};`
    : `border:2px solid #fff;`;
  return (
    `<div style="position:relative;width:16px;height:16px">` +
    `<div style="width:16px;height:16px;border-radius:50%;background:${color};${ring}box-shadow:0 0 0 4px ${color}33,0 1px 4px rgba(0,0,0,.5)"></div>` +
    `</div>`
  );
}

function popupHtml(p: WorkforcePosition): string {
  const color = p.inside ? INSIDE_COLOR : OUTSIDE_COLOR;
  const state = p.inside ? 'Inside geofence' : 'Outside geofence';
  const approx = p.approximate ? ' · approx.' : '';
  const fence = p.geofenceName ? `<div style="font-size:10px;color:#94a3b8">${p.geofenceName}</div>` : '';
  const status = p.status ? `<div style="font-size:10px;color:#94a3b8;text-transform:capitalize">${p.status}</div>` : '';
  return (
    `<div style="font-family:system-ui,sans-serif;min-width:120px">` +
    `<div style="font-size:12px;font-weight:700;color:#f0f6ff">${p.name}</div>` +
    fence +
    status +
    `<div style="font-size:11px;font-weight:600;color:${color};margin-top:3px">${state}${approx}</div>` +
    `</div>`
  );
}

/**
 * Read-only Leaflet map for the dashboard. Renders geofence polygons and a live
 * pin per employee, coloured green (inside) / red (outside). Leaflet is loaded
 * dynamically so its bundle and CSS stay off the initial dashboard load.
 */
export default function WorkforceMap({ geofences, positions }: WorkforceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const polygonsRef = useRef<Map<string, LPolygon>>(new Map());
  const markersRef = useRef<LMarker[]>([]);
  const [leafletReady, setLeafletReady] = useState(false);

  const mapboxToken = publicEnvironment.mapboxToken;

  // ── Initialise Leaflet once ───────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    void import('leaflet').then(L => {
      if (!containerRef.current || mapRef.current) return;

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

      mapRef.current = map;
      setLeafletReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        polygonsRef.current.clear();
        markersRef.current = [];
        setLeafletReady(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the map sized correctly when the container first appears / resizes.
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    const frame = window.requestAnimationFrame(() => mapRef.current?.invalidateSize());
    return () => window.cancelAnimationFrame(frame);
  }, [leafletReady]);

  // ── Sync geofence polygons ────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    void import('leaflet').then(L => {
      const map = mapRef.current!;
      const existing = polygonsRef.current;

      for (const [id, poly] of existing.entries()) {
        if (!geofences.find(g => g.id === id)) {
          map.removeLayer(poly);
          existing.delete(id);
        }
      }

      for (const gf of geofences) {
        if (gf.ring.length < 3) continue;
        const latLngs = gf.ring.map(([lng, lat]) => L.latLng(lat, lng));
        const color = gf.color ?? '#2563eb';
        const style = {
          color,
          fillColor: color,
          weight: 1.5,
          opacity: gf.status === 'disabled' ? 0.3 : 0.7,
          fillOpacity: 0.06,
          dashArray: gf.status === 'disabled' ? '8 4' : undefined,
        };

        const prev = existing.get(gf.id);
        if (prev) {
          prev.setLatLngs(latLngs);
          prev.setStyle(style);
        } else {
          const poly = L.polygon(latLngs, style);
          poly.bindTooltip(
            `<div style="font-family:system-ui,sans-serif;font-size:11px;font-weight:700;color:${color}">${gf.name}</div>` +
            `<div style="font-size:10px;color:#94a3b8">${gf.assignedCount} assigned</div>`,
            { sticky: true, opacity: 0.95, className: 'leaflet-tooltip-dark' },
          );
          poly.addTo(map);
          existing.set(gf.id, poly);
        }
      }
    });
  }, [leafletReady, geofences]);

  // ── Sync employee markers ─────────────────────────────────────────────────
  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    void import('leaflet').then(L => {
      const map = mapRef.current!;

      for (const m of markersRef.current) map.removeLayer(m);
      markersRef.current = [];

      for (const p of positions) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        const color = p.inside ? INSIDE_COLOR : OUTSIDE_COLOR;
        const icon = L.divIcon({
          html: markerHtml(color, p.approximate),
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          className: '',
        });
        const marker = L.marker([p.lat, p.lng], { icon, title: p.name });
        marker.bindPopup(popupHtml(p), { closeButton: false });
        marker.addTo(map);
        markersRef.current.push(marker);
      }

      // Fit bounds to everything we can see.
      const pts: Array<[number, number]> = [];
      for (const gf of geofences) for (const [lng, lat] of gf.ring) pts.push([lat, lng]);
      for (const p of positions) if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) pts.push([p.lat, p.lng]);
      if (pts.length > 0) {
        map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 18 });
      }
    });
  }, [leafletReady, positions, geofences]);

  const insideCount = positions.filter(p => p.inside).length;
  const outsideCount = positions.length - insideCount;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />

      {/* Tile-type badge */}
      {leafletReady && (
        <div
          className="absolute top-3 right-3 z-[500] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: 'rgba(13,27,46,0.9)', border: '1px solid #1e3a5a', color: '#94a3b8', backdropFilter: 'blur(4px)' }}
        >
          <Layers size={11} />
          {mapboxToken ? 'Mapbox Satellite' : 'OpenStreetMap'}
        </div>
      )}

      {/* Legend */}
      <div
        className="absolute bottom-3 left-3 z-[500] flex flex-col gap-1 px-2.5 py-2 rounded-lg text-xs"
        style={{ background: 'rgba(13,27,46,0.9)', border: '1px solid #1e3a5a', color: '#f0f6ff', backdropFilter: 'blur(4px)' }}
      >
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: INSIDE_COLOR }} />
          Inside <span style={{ color: '#94a3b8' }}>· {insideCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: OUTSIDE_COLOR }} />
          Outside <span style={{ color: '#94a3b8' }}>· {outsideCount}</span>
        </div>
        <div className="flex items-center gap-1.5" style={{ color: '#94a3b8' }}>
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'transparent', border: `2px dashed ${INSIDE_COLOR}` }} />
          Approx. location
        </div>
      </div>

      {/* Empty state */}
      {leafletReady && geofences.length === 0 && positions.length === 0 && (
        <div
          className="absolute inset-0 z-[400] flex flex-col items-center justify-center gap-2 pointer-events-none"
          style={{ background: 'rgba(6,13,26,0.55)', color: '#94a3b8' }}
        >
          <MapPin size={22} />
          <div className="text-sm font-medium">No geofences configured yet</div>
          <div className="text-xs">Add a geofence from the Geofences page to see the workforce map.</div>
        </div>
      )}
    </div>
  );
}
