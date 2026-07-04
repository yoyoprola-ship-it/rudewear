'use client';
import { useEffect, useRef, useState } from 'react';
import { DELIVERY_ORIGIN_COORDS, MAX_DELIVERY_RADIUS_MILES } from '@/app/lib/pricing';

// Google Places autocomplete usando PlaceAutocompleteElement (API nueva).
// Mismo patrón que Lafayette Market — carga el script una sola vez y
// devuelve al padre el address formateado + coords cuando el user
// selecciona una sugerencia. Bias hacia Lafayette LA para priorizar
// resultados cercanos.

interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onCoordsChange?: (coords: { lat: number; lng: number } | null) => void;
  onZipChange?: (zip: string | null) => void;
  placeholder?: string;
}

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

let mapsScriptLoading = false;
const mapsReadyCallbacks: (() => void)[] = [];

function loadGoogleMaps(callback: () => void) {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { google?: { maps?: { importLibrary?: unknown } } };
  if (w.google?.maps?.importLibrary) {
    callback();
    return;
  }
  mapsReadyCallbacks.push(callback);
  if (mapsScriptLoading) return;
  mapsScriptLoading = true;
  (window as unknown as { onGoogleMapsReady?: () => void }).onGoogleMapsReady = () => {
    mapsScriptLoading = false;
    mapsReadyCallbacks.forEach((cb) => cb());
    mapsReadyCallbacks.length = 0;
  };
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&libraries=places&loading=async&callback=onGoogleMapsReady`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

export default function AddressInput({
  value,
  onChange,
  onCoordsChange,
  onZipChange,
  placeholder,
}: AddressInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const cbRef = useRef({ onChange, onCoordsChange, onZipChange });
  cbRef.current = { onChange, onCoordsChange, onZipChange };

  useEffect(() => {
    let cancelled = false;

    const handlePlace = async (place: unknown) => {
      try {
        if (!place || typeof place !== 'object') return;
        const p = place as {
          fetchFields: (opts: { fields: string[] }) => Promise<void>;
          formattedAddress?: string;
          location?: { lat: () => number; lng: () => number };
          addressComponents?: Array<{
            types: string[];
            longText?: string;
            shortText?: string;
          }>;
        };
        await p.fetchFields({
          fields: ['formattedAddress', 'location', 'addressComponents'],
        });
        const { onChange: oc, onCoordsChange: occ, onZipChange: ozc } = cbRef.current;
        const addr = p.formattedAddress || '';
        if (addr) oc(addr);
        if (occ) {
          occ(
            p.location
              ? { lat: p.location.lat(), lng: p.location.lng() }
              : null
          );
        }
        if (ozc) {
          const comps = p.addressComponents || [];
          const zipC = comps.find(
            (c) => Array.isArray(c.types) && c.types.includes('postal_code')
          );
          const raw = zipC ? zipC.longText || zipC.shortText || '' : '';
          ozc(raw ? raw.match(/^\d{5}/)?.[0] || null : null);
        }
      } catch (e) {
        console.error('[AddressInput] place select failed:', e);
      }
    };

    loadGoogleMaps(async () => {
      if (cancelled || !containerRef.current) return;
      const w = window as unknown as {
        google?: {
          maps?: {
            importLibrary: (name: string) => Promise<{
              PlaceAutocompleteElement: new (opts: unknown) => HTMLElement;
            }>;
          };
        };
      };
      const google = w.google;
      if (!google?.maps?.importLibrary) return;
      try {
        const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
        if (cancelled || !containerRef.current) return;

        const biasRadius = Math.min(
          50000,
          Math.round(MAX_DELIVERY_RADIUS_MILES * 1609.34)
        );
        const pac = new PlaceAutocompleteElement({
          includedRegionCodes: ['us'],
          locationBias: {
            center: {
              lat: DELIVERY_ORIGIN_COORDS.lat,
              lng: DELIVERY_ORIGIN_COORDS.lng,
            },
            radius: biasRadius,
          },
        });
        pac.style.width = '100%';
        if (placeholder) {
          try {
            pac.setAttribute('placeholder', placeholder);
          } catch {
            /* ignore */
          }
        }

        pac.addEventListener('gmp-select', async (event: Event) => {
          const evt = event as unknown as {
            placePrediction?: { toPlace: () => unknown };
            place?: unknown;
          };
          const prediction = evt.placePrediction;
          if (prediction?.toPlace) {
            await handlePlace(prediction.toPlace());
          } else if (evt.place) {
            await handlePlace(evt.place);
          }
        });
        pac.addEventListener('gmp-placeselect', async (event: Event) => {
          const evt = event as unknown as { place?: unknown };
          if (evt.place) await handlePlace(evt.place);
        });

        containerRef.current.appendChild(pac);
        elRef.current = pac;
        setMapsReady(true);
      } catch (e) {
        console.error('[AddressInput] init failed:', e);
      }
    });

    return () => {
      cancelled = true;
      if (elRef.current?.parentNode) {
        try {
          elRef.current.parentNode.removeChild(elRef.current);
        } catch {
          /* ignore */
        }
      }
      elRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width: '100%' }}>
      {/* Estilos para el shadow-DOM del web component. Sin esto se
          renderiza con inputs transparentes. */}
      <style>{`
        gmp-place-autocomplete {
          width: 100%;
          display: block;
        }
        gmp-place-autocomplete::part(input) {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #262626;
          border-radius: 6px;
          font-size: 15px;
          color: #ffffff;
          background: #171717;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s ease;
        }
        gmp-place-autocomplete::part(input):hover {
          border-color: #404040;
        }
        gmp-place-autocomplete::part(input):focus {
          border-color: #dc2626;
        }
        gmp-place-autocomplete::part(prediction-item) {
          padding: 10px 12px;
          font-size: 14px;
        }
      `}</style>
      <div ref={containerRef} style={{ width: '100%', minHeight: '46px' }} />
      {!mapsReady && (
        <div className="px-4 py-3 border border-neutral-800 rounded text-sm text-neutral-500 bg-neutral-900">
          Loading map…
        </div>
      )}
      {value && (
        <p className="text-xs text-neutral-500 mt-1">
          📍 <strong className="text-neutral-300">Selected:</strong> {value}
        </p>
      )}
    </div>
  );
}
