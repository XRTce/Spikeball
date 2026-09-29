import { Segmented } from '../ui';
import { strings } from '../i18n';
import type { MatchFormat } from '../domain/types';
import form from '../styles/forms.module.css';
import css from './MatchFormatPicker.module.css';

const s = strings;

const OPTIONS = [
  { value: 'bo1', label: s.play.bo1 },
  { value: 'bo3', label: s.play.bo3 },
] as const;

/** Bo1/Bo3 choice for a casual match, shared by the suggestion card and the manual picker. */
export function MatchFormatPicker({
  value,
  onChange,
}: {
  value: MatchFormat;
  onChange: (value: MatchFormat) => void;
}) {
  return (
    <div className={css.row}>
      <span className={form.groupTitle}>{s.play.format}</span>
      <div className={css.control}>
        <Segmented ariaLabel={s.play.format} options={OPTIONS} value={value} onChange={onChange} />
      </div>
    </div>
  );
}
