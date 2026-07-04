import { NextResponse } from 'next/server';

// /health minimal — le front lean ne sert plus de données ; le backend de
// données OSINT FR est un FastAPI EXTERNE. Cet endpoint sert juste au probe
// de disponibilité du front (Traefik / Docker healthcheck).
export async function GET() {
  return NextResponse.json({
    status: 'operational',
    platform: 'OSIRIS V4 LEAN (front)',
    version: '4.0.0',
    uptime: process.uptime ? Math.round(process.uptime()) : 0,
    timestamp: new Date().toISOString(),
  });
}
