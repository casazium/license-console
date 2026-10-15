import { failingAction, rejectedTenantAction } from './actions';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <>
      <form action={rejectedTenantAction}><button>rejected</button></form>
      <form action={failingAction}><button>fail</button></form>
    </>
  );
}
