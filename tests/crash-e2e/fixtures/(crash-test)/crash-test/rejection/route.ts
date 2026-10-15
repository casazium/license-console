export const dynamic = 'force-dynamic';
export async function GET() {
  void Promise.reject(new Error('late rejection'));
  return Response.json({ ok: true });
}
