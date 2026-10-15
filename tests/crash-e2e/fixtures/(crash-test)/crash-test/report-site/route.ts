import { reportError } from '@/lib/crash-reporter';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    throw new Error('site boom');
  } catch (err) {
    reportError(err, 'crash test site failed', '/crash-test/report-site');
  }
  return Response.json({ ok: true });
}
