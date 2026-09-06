import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button, Icon } from '../ui';
import { strings } from '../i18n';
import css from './UpdatePrompt.module.css';

/**
 * A service worker update is never applied mid-evening without asking - a
 * reload during result entry would be the worst possible moment.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    <div className={css.bar} role="status">
      <Icon name="refresh" size={20} />
      <span className={css.text}>{strings.settings.update}</span>
      <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
        {strings.settings.updateAction}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon="close"
        aria-label={strings.common.close}
        onClick={() => setNeedRefresh(false)}
      />
    </div>
  );
}
