export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  throw new Error('metadata boom');
}
export default function Page() {
  return <p>metadata page</p>;
}
