import type { Member, User } from '@shared/models';
import { useRealtime } from '../state/realtime';
import { displayNameOf, roleColorOf } from '../state/selectors';
import { Avatar } from './Avatar';

interface Entry {
  member: Member;
  user: User;
  name: string;
}

export function MemberList() {
  const { state } = useRealtime();
  const { snapshot } = state;
  if (!snapshot) return null;

  const entries: Entry[] = snapshot.members.flatMap((member) => {
    const user = state.users[member.userId];
    return user ? [{ member, user, name: displayNameOf(snapshot, state.users, member.userId) }] : [];
  });
  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, 'pt-BR');
  const online = entries.filter((e) => e.user.status !== 'offline').sort(byName);
  const offline = entries.filter((e) => e.user.status === 'offline').sort(byName);

  return (
    <aside aria-label="Membros" className="hidden w-60 shrink-0 overflow-y-auto bg-sidebar px-2 py-4 lg:block">
      <MemberGroup title="Online" entries={online} />
      <MemberGroup title="Indisponível" entries={offline} dimmed />
    </aside>
  );
}

function MemberGroup({ title, entries, dimmed = false }: { title: string; entries: Entry[]; dimmed?: boolean }) {
  const { state } = useRealtime();
  if (entries.length === 0) return null;

  return (
    <section className="mb-5">
      <h3 className="px-2 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">
        {title} — {entries.length}
      </h3>
      <ul>
        {entries.map(({ user, name }) => (
          <li
            key={user.id}
            className={`flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover/60 ${dimmed ? 'opacity-45' : ''}`}
          >
            <Avatar name={name} color={user.avatarColor} status={user.status} size="sm" />
            <span
              className="truncate text-[15px] font-medium text-muted"
              style={{ color: roleColorOf(state.snapshot, user.id) ?? undefined }}
            >
              {name}
            </span>
            {user.isBot && (
              <span className="shrink-0 rounded bg-accent px-1 text-[10px] font-semibold text-white">ROBÔ</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
