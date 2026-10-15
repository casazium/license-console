export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    throw new Error('caught boom');
  } catch {
    return Response.json({ error: 'handled' }, { status: 500 });
  }
}
