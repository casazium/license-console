export const dynamic = 'force-dynamic';
export async function GET() {
  setTimeout(() => {
    throw new Error('timer boom');
  }, 0);
  return Response.json({ ok: true });
}
