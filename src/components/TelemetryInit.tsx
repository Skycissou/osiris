'use client';

// Monte le tracker de télémétrie UI UNE fois (au chargement du cockpit).
// Rendu invisible ; toute la logique est fail-safe dans lib/uiTelemetry.
import { useEffect } from 'react';
import { initUiTelemetry } from '@/lib/uiTelemetry';

export default function TelemetryInit() {
  useEffect(() => {
    initUiTelemetry();
  }, []);
  return null;
}
