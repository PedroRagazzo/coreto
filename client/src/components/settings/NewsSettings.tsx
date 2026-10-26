import { CHANGELOG } from '@shared/changelog';
import { ChangelogList } from '../Changelog';

/** O histórico de novidades, da mais nova para a mais antiga. */
export function NewsSettings() {
  return <ChangelogList entries={CHANGELOG} />;
}
