// The front door: a conversation with Remy. `id` is absent for a new chat. Built in work package 4.
export function Chat({ id }: { id?: string }) {
  return (
    <div className="mx-auto max-w-[760px] px-5 pt-32">
      <p className="m-0 text-muted">{id ? `Chat ${id}` : 'New chat'}</p>
    </div>
  );
}
