/* eslint-disable react/prop-types -- presentational component; the project does not use PropTypes */
import { ObjectRow } from './ObjectList'

/**
 * Tabbed lists of map objects. Each tab:
 *   { id, label, rows (ObjectRow props with `key`), empty: { text, actionLabel?, onAction? }, onSetAllHidden(hide) }
 */
export function ObjectTabs({ tabs, active, onChange, filter, onFilter }) {
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]
  const allHidden = tab.rows.length > 0 && tab.rows.every((r) => r.hidden)

  return (
    <section className="gf-tabs-wrap">
      <div className="gf-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab.id}
            className={t.id === tab.id ? 'on' : ''}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            <span className="gf-count">{t.total}</span>
          </button>
        ))}
      </div>

      <div className="gf-tab-tools">
        <input className="gf-search" placeholder={`Search ${tab.label.toLowerCase()}`} value={filter} onChange={(e) => onFilter(e.target.value)} aria-label={`Search ${tab.label}`} />
        {tab.rows.length > 0 && (
          <button type="button" className="gf-link" onClick={() => tab.onSetAllHidden(!allHidden)}>
            {allHidden ? 'Show all' : 'Hide all'}
          </button>
        )}
      </div>

      <div role="tabpanel" aria-label={tab.label}>
        {tab.rows.length ? (
          <ul className="gf-list">
            {tab.rows.map(({ key, ...row }) => (
              <ObjectRow key={key} {...row} />
            ))}
          </ul>
        ) : (
          <div className="gf-empty-state">
            <p>{filter ? `Nothing matches “${filter}”.` : tab.empty.text}</p>
            {!filter && tab.empty.actionLabel && (
              <button type="button" className="gf-btn primary" onClick={tab.empty.onAction}>
                {tab.empty.actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
